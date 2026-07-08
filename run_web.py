"""
SWG Tracker Desktop — pywebview entry point (web UI).

Runs the same src/core/* backend behind a native webview window. The legacy
CustomTkinter app (src/main.py) is left untouched for side-by-side comparison.
"""
from __future__ import annotations

import logging
import sys
from pathlib import Path

import webview

ROOT = Path(__file__).parent
sys.path.insert(0, str(ROOT))

from src.core.config_manager import ConfigManager
from src.core.api_client import SWGTrackerAPI
from src.core.dataset_sync import DatasetSync
from src.core.local_db import LocalDB
from src.web_api import WebApi

APP_VERSION = "0.9.24"  # keep in sync with pyproject.toml — bump with every change batch

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.FileHandler("swg_tracker_desktop.log"), logging.StreamHandler()],
)
logger = logging.getLogger(__name__)

INDEX = ROOT / "web" / "index.html"


def _set_mac_dock_icon():
    """Dev runs launch through the bare interpreter, so the Dock shows Python's
    rocket. Point NSApplication at our icon instead (the packaged .app doesn't
    need this — its bundle carries the icon)."""
    if sys.platform != "darwin":
        return
    try:
        from AppKit import NSApplication, NSImage
        img = NSImage.alloc().initWithContentsOfFile_(str(ROOT / "src" / "resources" / "icon.png"))
        if img:
            NSApplication.sharedApplication().setApplicationIconImage_(img)
    except Exception:  # noqa: BLE001 — cosmetic only, never block launch
        logger.debug("couldn't set Dock icon", exc_info=True)


def main():
    _set_mac_dock_icon()
    config = ConfigManager()
    api_client = SWGTrackerAPI(config.get("api_key", "") or "")
    local_db = LocalDB()

    dataset_sync = DatasetSync(local_db)
    dataset_sync.start_background()  # offline mirror of exports/* (resources, schematics)

    bridge = WebApi(config_manager=config, api_client=api_client, local_db=local_db,
                    app_version=APP_VERSION, dataset_sync=dataset_sync)

    logger.info("SWG Tracker Desktop (web UI) starting")
    webview.create_window(
        "SWG Tracker Desktop",
        url=str(INDEX),
        js_api=bridge,
        width=1200,
        height=800,
        min_size=(960, 650),
        background_color="#14161d",
    )
    # --debug enables the webview inspector (right-click → Inspect Element)
    webview.start(debug="--debug" in sys.argv)  # blocks until the window closes


if __name__ == "__main__":
    main()
