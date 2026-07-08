"""
Bundle manager — the thin-client half of the update story.

The shell (Python + pywebview) changes rarely; the web/ UI ships as a
versioned zip ("bundle") hosted at swgtracker.com. This manager keeps a local
bundle store, checks a tiny manifest, downloads/verifies/installs new bundles
atomically, and rolls back on boot failure.

Layout under ~/.swgtracker/bundles/:
    <version>/web/index.html      an installed bundle
    <version>/.boot_attempted     written just before the shell loads it
    <version>/.boot_ok            written when the UI reports a clean boot
    current                       text file: version the shell should load
    previous                      text file: last known-good version

A bundle that was attempted but never confirmed OK is treated as broken on the
next launch: the shell falls back to `previous`, or to the web/ copy packaged
with the shell itself, which always exists.
"""
from __future__ import annotations

import hashlib
import json
import logging
import shutil
import tempfile
import threading
import zipfile
from pathlib import Path

import requests

logger = logging.getLogger(__name__)

DEFAULT_MANIFEST_URL = "https://swgtracker.com/app/bundle-manifest.json"
CHECK_INTERVAL = 3600  # background re-check cadence, seconds (manifest is tiny)


def _vtuple(v) -> tuple:
    """Dotted version string -> comparable int tuple ('2026.07.08.1' safe)."""
    out = []
    for part in str(v or "").split("."):
        digits = "".join(ch for ch in part if ch.isdigit())
        out.append(int(digits) if digits else 0)
    return tuple(out) or (0,)


class BundleManager:
    def __init__(self, config, shell_version: str, builtin_web: Path,
                 store: Path | None = None):
        self.config = config
        self.shell_version = shell_version
        self.builtin_web = builtin_web            # packaged web/ — the eternal fallback
        self.store = store or (Path.home() / ".swgtracker" / "bundles")
        self.active_version: str | None = None    # set by resolve_index()
        self.active_source = "builtin"
        self.pending: dict | None = None           # installed-this-session, awaiting apply
        self._stop = threading.Event()
        self._lock = threading.Lock()

    # ---- config ----

    def enabled(self) -> bool:
        """'auto' = on when running frozen (packaged), off from source —
        source checkouts edit web/ directly and would fight the bundle store."""
        mode = self.config.get("bundles_enabled", "auto")
        if mode in (True, "on", "true", 1):
            return True
        if mode in (False, "off", "false", 0):
            return False
        import sys
        return bool(getattr(sys, "frozen", False))

    def manifest_url(self) -> str:
        return self.config.get("bundle_manifest_url", "") or DEFAULT_MANIFEST_URL

    # ---- pointers ----

    def _read_ptr(self, name: str) -> str:
        try:
            return (self.store / name).read_text(encoding="utf-8").strip()
        except OSError:
            return ""

    def _write_ptr(self, name: str, value: str):
        self.store.mkdir(parents=True, exist_ok=True)
        tmp = self.store / f".{name}.tmp"
        tmp.write_text(value, encoding="utf-8")
        tmp.replace(self.store / name)  # atomic on the same filesystem

    def _bundle_index(self, version: str) -> Path:
        return self.store / version / "web" / "index.html"

    # ---- boot resolution ----

    def resolve_index(self) -> Path:
        """Pick the index.html to load. Handles crash rollback: a bundle that
        was attempted but never confirmed gets benched before it loads again."""
        if not self.enabled():
            self.active_source = "builtin"
            return self.builtin_web / "index.html"

        cur = self._read_ptr("current")
        if cur and self._bundle_index(cur).is_file():
            bdir = self.store / cur
            attempted = (bdir / ".boot_attempted").exists()
            confirmed = (bdir / ".boot_ok").exists()
            if attempted and not confirmed:
                logger.warning("bundle %s never confirmed boot — rolling back", cur)
                prev = self._read_ptr("previous")
                self._write_ptr("current", prev if prev and self._bundle_index(prev).is_file() else "")
                return self.resolve_index()
            try:
                (bdir / ".boot_attempted").touch()
            except OSError:
                pass
            self.active_version = cur
            self.active_source = "bundle"
            return self._bundle_index(cur)

        self.active_source = "builtin"
        return self.builtin_web / "index.html"

    def mark_boot_ok(self):
        """UI booted cleanly — the active bundle is now known-good."""
        if self.active_source != "bundle" or not self.active_version:
            return
        bdir = self.store / self.active_version
        try:
            (bdir / ".boot_ok").touch()
            (bdir / ".boot_attempted").unlink(missing_ok=True)
        except OSError:
            logger.warning("couldn't write boot markers", exc_info=True)

    # ---- update pipeline ----

    def check(self) -> dict | None:
        """Fetch the manifest; return update info when a newer, shell-compatible
        bundle exists, else None."""
        try:
            resp = requests.get(self.manifest_url(), timeout=10)
            resp.raise_for_status()
            m = resp.json()
        except (requests.RequestException, ValueError) as e:
            logger.debug("bundle manifest check failed: %s", e)
            return None
        version = str(m.get("bundle_version") or "")
        if not version or not m.get("url") or not m.get("sha256"):
            return None
        min_shell = str(m.get("min_shell") or "")
        if min_shell and _vtuple(min_shell) > _vtuple(self.shell_version):
            logger.info("bundle %s needs shell %s (running %s) — skipping",
                        version, min_shell, self.shell_version)
            return None
        active = self.active_version if self.active_source == "bundle" else ""
        if _vtuple(version) <= _vtuple(active):
            return None
        return {"version": version, "url": m["url"], "sha256": m["sha256"],
                "notes": str(m.get("notes") or "")}

    def install(self, info: dict) -> bool:
        """Download, sha256-verify, unpack, sanity-check, then flip `current`.
        The swap is pointer-based, so a half-written download can never be live."""
        with self._lock:
            version = info["version"]
            try:
                resp = requests.get(info["url"], timeout=60)
                resp.raise_for_status()
                blob = resp.content
            except requests.RequestException as e:
                logger.error("bundle download failed: %s", e)
                return False
            digest = hashlib.sha256(blob).hexdigest()
            if digest != str(info["sha256"]).lower():
                logger.error("bundle %s sha mismatch (got %s)", version, digest[:12])
                return False

            target = self.store / version
            try:
                with tempfile.TemporaryDirectory(dir=str(self.store.parent
                        if self.store.exists() else Path.home())) as td:
                    tmp = Path(td)
                    zpath = tmp / "bundle.zip"
                    zpath.write_bytes(blob)
                    with zipfile.ZipFile(zpath) as z:
                        # zip-slip guard: every member must stay inside the dir
                        for n in z.namelist():
                            if n.startswith("/") or ".." in Path(n).parts:
                                raise ValueError(f"suspicious zip member: {n}")
                        z.extractall(tmp / "x")
                    root = tmp / "x"
                    # accept both zip layouts: web/index.html or bare index.html
                    web = root / "web" if (root / "web" / "index.html").is_file() else root
                    if not (web / "index.html").is_file():
                        raise ValueError("bundle has no index.html")
                    self.store.mkdir(parents=True, exist_ok=True)
                    if target.exists():
                        shutil.rmtree(target)
                    target.mkdir(parents=True)
                    shutil.copytree(web, target / "web")
            except (OSError, zipfile.BadZipFile, ValueError) as e:
                logger.error("bundle %s install failed: %s", version, e)
                shutil.rmtree(target, ignore_errors=True)
                return False

            try:  # keep the manifest beside the bundle — About shows its notes
                (target / "manifest.json").write_text(
                    json.dumps(info, indent=2), encoding="utf-8")
            except OSError:
                pass
            cur = self._read_ptr("current")
            if cur and cur != version:
                self._write_ptr("previous", cur)
            self._write_ptr("current", version)
            self.pending = dict(info)
            self._prune(keep={version, self._read_ptr("previous")})
            logger.info("bundle %s installed (pending apply)", version)
            return True

    def _prune(self, keep: set):
        try:
            for d in self.store.iterdir():
                if d.is_dir() and d.name not in keep:
                    shutil.rmtree(d, ignore_errors=True)
        except OSError:
            pass

    # ---- background loop ----

    def start_background(self):
        if not self.enabled():
            return
        threading.Thread(target=self._loop, name="bundle-check", daemon=True).start()

    def stop(self):
        self._stop.set()

    def _loop(self):
        self._stop.wait(15)  # let the app finish booting first
        while not self._stop.is_set():
            try:
                info = self.check()
                if info and not (self.pending and self.pending.get("version") == info["version"]):
                    self.install(info)  # flips `current`; UI offers hot-apply via bundle_state()
            except Exception:  # noqa: BLE001 — the loop must survive anything
                logger.error("bundle check failed", exc_info=True)
            self._stop.wait(CHECK_INTERVAL)

    # ---- bridge-facing state ----

    def active_notes(self) -> str:
        if self.active_source != "bundle" or not self.active_version:
            return ""
        try:
            m = json.loads((self.store / self.active_version / "manifest.json")
                           .read_text(encoding="utf-8"))
            return str(m.get("notes") or "")
        except (OSError, ValueError):
            return ""

    def state(self) -> dict:
        return {
            "enabled": self.enabled(),
            "source": self.active_source,
            "active_version": self.active_version,
            "active_notes": self.active_notes(),
            "pending": self.pending,
        }
