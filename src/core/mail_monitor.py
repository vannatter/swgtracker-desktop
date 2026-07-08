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
import threading
import time
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

IMPORT_URL = "https://swgtracker.com/import_mailcontent.php"
SCAN_INTERVAL = 5  # seconds between folder sweeps
SALE_SUBJECT = "Vendor Sale Complete"


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
        out = []
        for entry in self.config.get("mail_paths", []) or []:
            raw = entry.get("path") if isinstance(entry, dict) else entry
            if raw:
                out.append(Path(str(raw)).expanduser())
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

    def _sweep(self):
        delete_after = bool(self.config.get("delete_mail_after_upload", False))
        for folder in self._paths():
            if not folder.is_dir():
                continue
            for f in sorted(folder.glob("*.mail")):
                if self._stop.is_set():
                    return
                mail_id = f.stem
                if self.db.mail_ledger_has(mail_id):
                    if mail_id in self._need_raw:
                        # uploaded before we kept raw copies — grab it while the file exists
                        try:
                            self.db.mail_set_raw(mail_id, f.read_text(encoding="utf-8", errors="replace"))
                        except OSError:
                            pass
                        self._need_raw.discard(mail_id)
                    if delete_after:
                        self._delete(f)
                    continue
                self._upload(f, mail_id, delete_after)

    def _upload(self, f: Path, mail_id: str, delete_after: bool):
        try:
            content = f.read_text(encoding="utf-8", errors="replace")
        except OSError:
            logger.warning("unreadable mail file: %s", f)
            return
        subject = content.split("\n")[2].strip() if content.count("\n") >= 2 else ""
        try:
            resp = requests.post(
                IMPORT_URL,
                data=json.dumps({"incomingData": content,
                                 "scannerUserKey": self.api.api_key}),
                headers={"Content-type": "application/json", "Accept": "text/plain"},
                timeout=15,
            )
            resp.raise_for_status()
        except requests.RequestException as e:
            self.session_failed += 1
            self._event("error", f.name, f"upload failed: {e}")
            return

        kind = "sale" if subject == SALE_SUBJECT else "mail"
        detail = ""
        if kind == "sale":
            # "Vendor: X has sold ITEM to BUYER for N credits."
            body = content.split("\n", 4)[-1]
            try:
                after = body.split(" has sold ", 1)[1]
                item, rest = after.rsplit(" to ", 1)  # item names can contain " to "
                buyer = rest.split(" for ", 1)[0]
                credits = rest.split(" for ", 1)[1].split(" credits", 1)[0]
                detail = f"{item} → {buyer} — {credits} credits"
                if self.notifier:
                    self.notifier("Vendor sale", f"{item} — {credits} credits")
            except (IndexError, ValueError):
                if self.notifier:
                    self.notifier("Vendor sale", "New sale uploaded")
        self.db.mail_ledger_add(mail_id, subject, detail, kind, raw=content)
        self.session_uploaded += 1
        self._event(kind, f.name, detail or subject)
        if delete_after:
            self._delete(f)

    def _delete(self, f: Path):
        try:
            f.unlink()
        except OSError:
            logger.warning("couldn't delete %s", f)

    def _event(self, kind: str, name: str, detail: str):
        self.recent.insert(0, {"kind": kind, "file": name, "detail": detail,
                               "ts": int(time.time())})
        del self.recent[50:]
