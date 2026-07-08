"""
Offline dataset sync — mirrors swgtracker.com's static exports into the local DB.

The server cron publishes pre-gzipped, sha256-gated dumps:
  exports/manifest.json                 {generated_at, datasets: {name: {url, url_gz, sha256, count, ...}}}
  exports/resources.json(.gz)           every visible resource (~90k rows, ~15MB gz)
  exports/schematics.json(.gz)          every active schematic (~2k rows)

A dataset is re-downloaded only when its manifest sha256 differs from the one we
last ingested. categories.php (public, small) is cached alongside so the offline
category filter can expand a tree code into leaf type codes.
"""
from __future__ import annotations

import gzip
import hashlib
import json
import logging
import threading
import time

import requests

logger = logging.getLogger(__name__)

BASE_URL = "https://swgtracker.com"
PLANET_COLS = frozenset((
    "planet_corellia", "planet_dantooine", "planet_dathomir", "planet_endor",
    "planet_lok", "planet_naboo", "planet_rori", "planet_talus",
    "planet_tatooine", "planet_yavin4", "planet_kashyyyk", "planet_mustafar",
))


class DatasetSync:
    """Downloads the export datasets into LocalDB; safe to poke from any thread."""

    def __init__(self, local_db, base_url: str = BASE_URL):
        self.db = local_db
        self.base_url = base_url.rstrip("/")
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        # volatile bits the Settings page polls; persisted bits live in sync_meta
        self.in_progress = False
        self.last_error: str | None = None

    # --- public API ---

    def status(self) -> dict:
        counts = self.db.ds_counts()
        return {
            "in_progress": self.in_progress,
            "last_error": self.last_error,
            "last_checked": int(self.db.get_meta("ds_last_checked", "0")),
            "datasets": {
                name: {
                    "synced_at": int(self.db.get_meta(f"ds_{name}_synced", "0")),
                    "sha256": self.db.get_meta(f"ds_{name}_sha256", ""),
                    "count": counts.get(name, 0),
                }
                for name in ("resources", "schematics", "schematic_details")
            },
        }

    def sync_now(self, force: bool = False) -> dict:
        """Run one sync pass. Returns {"ok", "updated": [names], "error"}."""
        if not self._lock.acquire(blocking=False):
            return {"ok": False, "updated": [], "error": "sync already running"}
        self.in_progress = True
        self.last_error = None
        updated: list[str] = []
        try:
            manifest = requests.get(
                f"{self.base_url}/exports/manifest.json", timeout=30).json()
            datasets = manifest.get("datasets", {})
            for name in ("resources", "schematics", "schematic_details"):
                info = datasets.get(name)
                if not info:
                    continue
                if not force and info.get("sha256") == self.db.get_meta(f"ds_{name}_sha256"):
                    continue  # unchanged since last ingest
                self._ingest(name, info)
                updated.append(name)
            self._cache_categories()
            self.db.set_meta("ds_last_checked", str(int(time.time())))
            return {"ok": True, "updated": updated, "error": None}
        except Exception as e:  # noqa: BLE001 — surface any failure to the UI
            logger.error("Dataset sync failed: %s", e, exc_info=True)
            self.last_error = str(e)
            return {"ok": False, "updated": updated, "error": str(e)}
        finally:
            self.in_progress = False
            self._lock.release()

    def start_background(self, interval_hours: float = 6.0):
        """First sync shortly after launch, then re-check every interval_hours."""
        if self._thread and self._thread.is_alive():
            return

        def loop():
            time.sleep(5)  # let the window come up before hitting the network
            while not self._stop.is_set():
                self.sync_now()
                if self._stop.wait(interval_hours * 3600):
                    break

        self._thread = threading.Thread(target=loop, name="dataset-sync", daemon=True)
        self._thread.start()

    def stop(self):
        self._stop.set()

    # --- category expansion (offline filter support) ---

    def expand_category(self, code: str) -> list[str] | None:
        """Tree code -> leaf type codes beneath it (None = no tree cached, don't filter)."""
        raw = self.db.get_meta("ds_categories_json")
        if not raw:
            return None
        try:
            flat = json.loads(raw).get("resource_tree_flat", [])
        except ValueError:
            return None
        out = []
        for row in flat:
            levels = (row.get("level1"), row.get("level2"), row.get("level3"),
                      row.get("level4"), row.get("level5"), row.get("level6"))
            if code == row.get("code") or code in levels:
                out.append(row["code"])
        return out

    def ancestors(self, type_code: str) -> list[str]:
        """Tree codes above (and including) a leaf type code — the section codes a
        resource of that type can satisfy. Empty if no category cache."""
        raw = self.db.get_meta("ds_categories_json")
        if not raw:
            return [type_code]
        try:
            flat = json.loads(raw).get("resource_tree_flat", [])
        except ValueError:
            return [type_code]
        for row in flat:
            if row.get("code") == type_code:
                lv = [row.get(f"level{i}") for i in range(1, 7)]
                return [type_code] + [c for c in lv if c]
        return [type_code]

    # --- internals ---

    def _ingest(self, name: str, info: dict):
        url = info.get("url_gz") or info.get("url")
        blob = requests.get(f"{self.base_url}{url}", timeout=300).content
        if (info.get("url_gz") and not url.endswith("json")) or blob[:2] == b"\x1f\x8b":
            blob = gzip.decompress(blob)

        # manifest sha256 is of the uncompressed json; a mismatch usually means the
        # cron regenerated between our manifest read and this download — skip, the
        # next poll picks it up cleanly.
        digest = hashlib.sha256(blob).hexdigest()
        if info.get("sha256") and digest != info["sha256"]:
            raise ValueError(f"{name}: sha256 mismatch (expected {info['sha256'][:12]}…, got {digest[:12]}…)")

        # ~137MB decompressed for resources — transient, parsed then dropped.
        rows = json.loads(blob).get("results", [])
        del blob
        started = time.time()
        if name == "resources":
            self.db.replace_ds_resources(rows)
        elif name == "schematic_details":
            self.db.replace_ds_schematic_details(rows or {})  # {id: payload} map
        else:
            self.db.replace_ds_schematics(rows)
        self.db.set_meta(f"ds_{name}_sha256", info["sha256"])
        self.db.set_meta(f"ds_{name}_synced", str(int(time.time())))
        logger.info("Dataset %s: ingested %d rows in %.1fs", name, len(rows), time.time() - started)

    def _cache_categories(self):
        """categories.php is public and small; cached for offline category filtering."""
        try:
            r = requests.get(f"{self.base_url}/api/categories.php", timeout=30)
            if r.ok:
                self.db.set_meta("ds_categories_json", r.text)
        except requests.RequestException:
            pass  # non-fatal — offline filter just degrades to no category expansion
