"""
Mail monitor — watches SWG mail folders and ships new .mail files to
swgtracker.com, which parses/dedupes them server-side (import_mailcontent.php,
same protocol as the retired standalone swg-mail-tracker).

The uploaded ledger lives in the local DB so restarts never re-send, and the
optional delete_mail_after_upload setting trims the game's mail folders.
"""
from __future__ import annotations

import json
import logging
import shutil
import threading
import time
import zipfile
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

IMPORT_URL = "https://swgtracker.com/import_mailcontent.php"
SCAN_INTERVAL = 5  # seconds between folder sweeps
FAIL_RETRY_SECS = 300  # don't re-attempt a failing file every sweep
def archive_name(mtime: float) -> str:
    """Month-stamped from the FILE's time, not today's: each mail files into its
    own month's archive (swgt_mail_archive_2026-08.zip), so loose stragglers
    from earlier months settle into their proper zips on any later sweep —
    the rotation cleans itself up with no rollover logic."""
    return f"swgt_mail_archive_{time.strftime('%Y-%m', time.localtime(mtime))}.zip"
SALE_SUBJECT = "Vendor Sale Complete"
# both share the body format: ... of "ITEM" from "SELLER" for N credits ...
PURCHASE_SUBJECTS = ("Vendor Item Purchased", "Instant Sale Item Purchased")


class MailMonitor:
    """Folder watcher + uploader. Doubles as the bridge 'controller'
    (start_monitoring / stop_monitoring / test_connection)."""

    def __init__(self, config, api_client, local_db, notifier=None):
        self.config = config
        self.api = api_client
        self.db = local_db
        self.notifier = notifier          # callable(title, message) — optional
        self._thread: threading.Thread | None = None
        self._stop = threading.Event()
        self._lock = threading.Lock()
        self.running = False
        self.session_uploaded = 0
        self.session_failed = 0
        self.recent: list[dict] = []      # newest-first event feed for the UI
        self._need_raw: set[str] = set()  # ledgered mails uploaded before raw was stored
        self._fail_at: dict[str, float] = {}  # mail_id -> last failed attempt (backoff)
        self._zip_cache: dict[str, tuple[tuple, set]] = {}  # zip path -> (stat sig, namelist)

    # --- controller interface (web_api expects these) ---

    def test_connection(self):
        return self.api.test_connection()

    def start_monitoring(self):
        with self._lock:
            if self.running:
                return True, "Already monitoring"
            paths = self._paths()
            if not paths:
                return False, "No mail folders configured — add one in Settings"
            missing = [str(p) for p in paths if not p.is_dir()]
            if missing:
                return False, f"Folder not found: {missing[0]}"
            self._stop.clear()
            self._thread = threading.Thread(target=self._loop, name="mail-monitor", daemon=True)
            self._thread.start()
            self.running = True
            self.session_uploaded = 0
            self.session_failed = 0
            n = len(paths)
            return True, f"Monitoring {n} folder{'s' if n > 1 else ''}"

    def stop_monitoring(self):
        with self._lock:
            if not self.running:
                return True, "Not monitoring"
            self._stop.set()
            self.running = False
            return True, "Monitoring stopped"

    def state(self) -> dict:
        return {
            "running": self.running,
            "folders": [str(p) for p in self._paths()],
            "uploaded": self.session_uploaded,
            "failed": self.session_failed,
            "total": self.db.mail_ledger_count(),
            "recent": self.recent[:20],
        }

    # --- internals ---

    def _paths(self) -> list[Path]:
        return [p for p, _ in self._folders()]

    def _folders(self) -> list[tuple[Path, str]]:
        """(folder, character) pairs. Character = the Settings label, else derived
        from the folder name (SWG mailsave dirs are usually mail_<Character>)."""
        out = []
        for entry in self.config.get("mail_paths", []) or []:
            raw = entry.get("path") if isinstance(entry, dict) else entry
            if not raw:
                continue
            p = Path(str(raw)).expanduser()
            label = (entry.get("label") or "").strip() if isinstance(entry, dict) else ""
            if not label:
                base = p.name
                label = base[5:] if base.lower().startswith("mail_") else base
            out.append((p, label))
        return out

    def _loop(self):
        logger.info("Mail monitor started")
        self._need_raw = self.db.mail_ids_missing_raw()
        while not self._stop.is_set():
            try:
                self._sweep()
            except Exception:  # noqa: BLE001 — the loop must survive anything
                logger.error("mail sweep failed", exc_info=True)
            self._stop.wait(SCAN_INTERVAL)
        logger.info("Mail monitor stopped")

    def _disposition(self):
        """(disp, move_dir, zip_after, zip_remove): what happens to a mail file
        once it's uploaded. 'move' without a destination degrades to 'keep' —
        never move blindly. zip_after is a modifier on keep/move (meaningless
        with delete): a copy lands in the monthly archive zip; zip_remove
        additionally drops the loose file once it's safely archived.
        Legacy configs only have the delete boolean."""
        disp = str(self.config.get("mail_disposition", "") or "").strip().lower()
        if disp not in ("keep", "delete", "move"):
            disp = "delete" if self.config.get("delete_mail_after_upload", False) else "keep"
        move_dir = None
        if disp == "move":
            raw = str(self.config.get("mail_move_dir", "") or "").strip()
            if raw:
                move_dir = Path(raw).expanduser()
            else:
                disp = "keep"
        zip_after = bool(self.config.get("mail_zip", False)) and disp != "delete"
        zip_remove = zip_after and bool(self.config.get("mail_zip_remove", False))
        return disp, move_dir, zip_after, zip_remove

    def _sweep(self):
        disp, move_dir, zip_after, zip_remove = self._disposition()
        self._sweep_sales = []  # (item, credits) uploaded this pass — notified in one batch
        for folder, character in self._folders():
            if not folder.is_dir():
                continue
            for f in sorted(folder.glob("*.mail")):
                if self._stop.is_set():
                    return
                mail_id = f.stem
                if self.db.mail_ledger_has(mail_id):
                    # folder re-labeled since upload? files still here follow it
                    self.db.mail_set_character(mail_id, character)
                    if mail_id in self._need_raw:
                        # uploaded before we kept raw copies — grab it while the file exists
                        try:
                            self.db.mail_set_raw(mail_id, f.read_text(encoding="utf-8", errors="replace"))
                        except OSError:
                            pass
                        self._need_raw.discard(mail_id)
                    self._dispose(f, disp, move_dir, zip_after, zip_remove)
                    continue
                self._upload(f, mail_id, disp, move_dir, character, zip_after, zip_remove)
        self._notify_sales()

    def _upload(self, f: Path, mail_id: str, disp: str = "keep", move_dir=None,
                character: str = "", zip_after: bool = False, zip_remove: bool = False):
        # backoff: a file that just failed doesn't get retried every 5s sweep
        last_fail = self._fail_at.get(mail_id, 0)
        if last_fail and time.time() - last_fail < FAIL_RETRY_SECS:
            return
        try:
            content = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            logger.warning("unreadable mail file: %s", f)
            return
        subject = content.split("\n")[2].strip() if content.count("\n") >= 2 else ""
        duplicate = False
        try:
            resp = requests.post(
                IMPORT_URL,
                data=json.dumps({"incomingData": content,
                                 "scannerUserKey": self.api.api_key}),
                headers={"Content-type": "application/json", "Accept": "text/plain"},
                # the site's anti-scraper gate 418s cookie-less non-browser
                # requests to root-level .php — identify as a passed check
                cookies={"swgt_ok": "1"},
                timeout=15,
            )
            if resp.status_code == 409:
                # server already has it (fresh install over an old mail folder) —
                # that's sync success, not failure: ledger it and never resend
                duplicate = True
            else:
                resp.raise_for_status()
        except requests.RequestException as e:
            self.session_failed += 1
            self._fail_at[mail_id] = time.time()
            self._event("error", f.name, f"upload failed: {e}")
            return
        self._fail_at.pop(mail_id, None)

        kind = "sale" if subject == SALE_SUBJECT else (
            "purchase" if subject in PURCHASE_SUBJECTS else
            "banktip" if "bank transfer" in subject.lower() or "wire transfer" in subject.lower()
            else "mail")
        detail = ""
        if kind == "banktip":
            # detail + tip amounts get parsed in local_db.mail_ledger_add from raw
            pass
        if kind == "sale":
            # "Vendor: X has sold ITEM to BUYER for N credits."
            body = content.split("\n", 4)[-1]
            try:
                after = body.split(" has sold ", 1)[1]
                item, rest = after.rsplit(" to ", 1)  # item names can contain " to "
                buyer = rest.split(" for ", 1)[0]
                credits = rest.split(" for ", 1)[1].split(" credits", 1)[0]
                detail = f"{item} → {buyer} — {credits} credits"
                if not duplicate:
                    self._sweep_sales.append((item, credits))
            except (IndexError, ValueError):
                if not duplicate:
                    self._sweep_sales.append(("New sale", ""))
        elif kind == "purchase":
            # 'You have purchased N of "ITEM" from "SELLER" for N credits.'
            body = content.split("\n", 4)[-1]
            try:
                after = body.split(' of "', 1)[1]
                item, rest = after.split('" from "', 1)
                seller = rest.split('" for ', 1)[0]
                credits = rest.split('" for ', 1)[1].split(" credits", 1)[0]
                detail = f"{item} ← {seller} — {credits} credits"
            except (IndexError, ValueError):
                pass  # unparsed purchase still ledgers with its subject
        self.db.mail_ledger_add(mail_id, subject, detail, kind, raw=content, character=character)
        if duplicate:
            self._event(kind, f.name, f"already on server — {detail or subject}")
        else:
            self.session_uploaded += 1
            self._event(kind, f.name, detail or subject)
        self._dispose(f, disp, move_dir, zip_after, zip_remove)

    def _notify_sales(self):
        """One notification per sweep: a lone sale gets its detail, a backlog
        (fresh install, first start of the day) gets a single summary instead
        of one toast per mail."""
        sales = self._sweep_sales
        self._sweep_sales = []
        if not sales or not self.notifier:
            return
        if len(sales) == 1:
            item, credits = sales[0]
            self.notifier("Vendor sale", f"{item} — {credits} credits" if credits else item)
            return
        total = 0
        for _, c in sales:
            try:
                total += int(str(c).replace(",", ""))
            except ValueError:
                pass
        summary = f"{total:,} credits total" if total else "see the Mail page"
        self.notifier(f"{len(sales)} vendor sales uploaded", summary)

    def _delete(self, f: Path):
        try:
            f.unlink()
        except OSError:
            logger.warning("couldn't delete %s", f)

    def _zip_names(self, zpath: Path) -> set | None:
        """The archive's namelist behind a stat-validated cache (None = archive
        exists but is unreadable). Backup mode leaves the loose files in place,
        so every sweep re-checks each of them — that must not reopen the zip
        thousands of times."""
        key = str(zpath)
        try:
            st = zpath.stat()
            sig = (st.st_mtime_ns, st.st_size)
        except OSError:  # no archive yet
            self._zip_cache.pop(key, None)
            return set()
        cached = self._zip_cache.get(key)
        if cached and cached[0] == sig:
            return cached[1]
        try:
            with zipfile.ZipFile(zpath) as z:
                names = set(z.namelist())
        except (OSError, zipfile.BadZipFile):
            logger.warning("unreadable archive %s — leaving mail files alone", zpath)
            return None
        self._zip_cache[key] = (sig, names)
        return names

    def _zip(self, f: Path, target_dir: Path) -> bool:
        """Fold the mail into its month's archive zip in target_dir. Entries are
        stored under the source folder's name (mail ids are only unique per
        character, and several watched folders can share one move destination).
        Returns True only once the mail is verifiably in the archive — callers
        never remove a loose file on a False."""
        try:
            zpath = target_dir / archive_name(f.stat().st_mtime)
        except OSError:
            return False
        arcname = f"{f.parent.name}/{f.name}"
        names = self._zip_names(zpath)
        if names is None:
            return False
        if arcname in names:
            return True
        try:
            target_dir.mkdir(parents=True, exist_ok=True)
            with zipfile.ZipFile(zpath, "a", zipfile.ZIP_DEFLATED) as z:
                z.write(f, arcname)
        except (OSError, zipfile.BadZipFile):
            logger.warning("couldn't archive %s into %s", f, zpath)
            self._zip_cache.pop(str(zpath), None)
            return False
        names.add(arcname)
        try:
            st = zpath.stat()
            self._zip_cache[str(zpath)] = ((st.st_mtime_ns, st.st_size), names)
        except OSError:
            self._zip_cache.pop(str(zpath), None)
        return True

    def _dispose(self, f: Path, disp: str, move_dir, zip_after: bool = False,
                 zip_remove: bool = False):
        """Post-upload file handling: keep (default), delete, or move to the
        user's processed-mail folder (collision-safe rename). zip_after is a
        modifier on keep/move: a copy lands in the monthly archive zip at the
        file's destination (watched folder for keep, chosen folder for move).
        zip_remove then drops the loose file — but only once it's safely in
        the archive."""
        if disp == "delete":
            self._delete(f)
            return
        if zip_after:
            target = move_dir if (disp == "move" and move_dir is not None) else f.parent
            if not self._zip(f, target):
                return  # not safely archived — leave the file where it is
            if zip_remove:
                self._delete(f)
                return
            if disp != "move":
                return  # keep + backup zip: the loose file stays too
            # zip without remove on a move: the loose copy still moves below
        if disp != "move" or move_dir is None:
            return
        try:
            if f.parent.resolve() == move_dir.resolve():
                return  # destination IS the watched folder — nothing to do
            move_dir.mkdir(parents=True, exist_ok=True)
            dest = move_dir / f.name
            n = 1
            while dest.exists():
                dest = move_dir / f"{f.stem}_{n}{f.suffix}"
                n += 1
            shutil.move(str(f), str(dest))
        except OSError:
            logger.warning("couldn't move %s to %s", f, move_dir)

    def _event(self, kind: str, name: str, detail: str):
        self.recent.insert(0, {"kind": kind, "file": name, "detail": detail,
                               "ts": int(time.time())})
        del self.recent[50:]
