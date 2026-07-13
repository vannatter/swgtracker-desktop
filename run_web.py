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

FROZEN = bool(getattr(sys, "frozen", False))
# frozen: bundled read-only assets live in the PyInstaller extraction/Resources
# dir; mutable data (config/db/log) moves to ~/.swgtracker
ROOT = Path(getattr(sys, "_MEIPASS", Path(__file__).parent))
DATA_DIR = Path.home() / ".swgtracker" if FROZEN else Path(__file__).parent
DATA_DIR.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(ROOT))

from src.core.config_manager import ConfigManager
from src.core.api_client import SWGTrackerAPI
from src.core.dataset_sync import DatasetSync
from src.core.local_db import LocalDB
from src.core.mail_monitor import MailMonitor
from src.core.alert_poller import AlertPoller
from src.core.bundle_manager import BundleManager
from src.web_api import WebApi

APP_VERSION = "0.11.27"  # keep in sync with pyproject.toml — bump with every change batch

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s - %(name)s - %(levelname)s - %(message)s",
    handlers=[logging.FileHandler(str(DATA_DIR / "swg_tracker_desktop.log")),
              logging.StreamHandler()],
)
logger = logging.getLogger(__name__)



def _set_mac_dock_icon():
    """Dev runs launch through the bare interpreter, so the Dock shows Python's
    rocket and the app answers to 'Python'. Point NSApplication at our icon and
    rewrite the bundle name (the packaged .app doesn't need this — its bundle
    carries both)."""
    if sys.platform != "darwin":
        return
    try:
        from AppKit import NSApplication, NSImage
        from Foundation import NSBundle
        img = NSImage.alloc().initWithContentsOfFile_(str(ROOT / "src" / "resources" / "icon.png"))
        if img:
            NSApplication.sharedApplication().setApplicationIconImage_(img)
        info = NSBundle.mainBundle().localizedInfoDictionary() or NSBundle.mainBundle().infoDictionary()
        if info is not None:
            info["CFBundleName"] = "SWG Tracker Desktop"
            # the About panel reads these too — otherwise it shows Python 3.12.x/PSF
            info["CFBundleShortVersionString"] = APP_VERSION
            info["CFBundleVersion"] = APP_VERSION
            info["NSHumanReadableCopyright"] = "swgtracker.com companion"
    except Exception:  # noqa: BLE001 — cosmetic only, never block launch
        logger.debug("couldn't set Dock identity", exc_info=True)


def main():
    _set_mac_dock_icon()
    config = ConfigManager(str(DATA_DIR / "config.json"))
    api_client = SWGTrackerAPI(config.get("api_key", "") or "")
    local_db = LocalDB(str(DATA_DIR / "swgtracker_local.db"))

    # thin client: the web UI can ship as a server-hosted bundle; the packaged
    # web/ dir is the always-works fallback (and the whole story when running
    # from source, unless bundles_enabled is forced on in config)
    bundles = BundleManager(config, APP_VERSION, ROOT / "web")
    index = bundles.resolve_index()
    bundles.start_background()

    dataset_sync = DatasetSync(local_db)
    dataset_sync.start_background()  # offline mirror of exports/* (resources, schematics)

    bridge = WebApi(config_manager=config, api_client=api_client, local_db=local_db,
                    app_version=APP_VERSION, dataset_sync=dataset_sync)
    bridge.bundles = bundles

    monitor = MailMonitor(config, api_client, local_db,
                          notifier=lambda t, m: bridge.notify(t, m))
    bridge.controller = monitor
    if config.get("auto_start_monitoring", False):
        monitor.start_monitoring()

    # server-side cron evaluates alert rules into alert_hits; this polls that
    # feed on the "check for new spawns every N minutes" setting and notifies
    alert_poller = AlertPoller(config, api_client,
                               notifier=lambda t, m: bridge.notify(t, m))
    alert_poller.start()

    logger.info("SWG Tracker Desktop (web UI) starting — ui: %s (%s)",
                bundles.active_version or "builtin", bundles.active_source)
    window = webview.create_window(
        "SWG Tracker Desktop",
        url=str(index),
        js_api=bridge,
        width=1200,
        height=800,
        min_size=(960, 650),
        background_color="#14161d",
    )
    # hot-apply: bundle_apply() re-resolves and reloads the webview in place.
    # Windows relaunches instead — WebView2 silently refuses the in-place
    # navigation that WKWebView accepts, and a boot picks the bundle anyway.
    def _reload_ui():
        try:
            if sys.platform == "win32":
                import os
                import subprocess
                logger.info("applying UI bundle via relaunch")
                args = [sys.executable] if getattr(sys, "frozen", False) \
                    else [sys.executable, str(Path(__file__).resolve())]
                subprocess.Popen(args, close_fds=True)
                os._exit(0)
            idx = bundles.resolve_index()
            logger.info("applying UI bundle in place: %s", idx)
            window.load_url(str(idx))
        except Exception:  # noqa: BLE001 — never die silently in the timer thread
            logger.error("bundle apply failed", exc_info=True)
    bridge.reload_ui = _reload_ui

    # --debug enables the webview inspector (right-click → Inspect Element)
    webview.start(debug="--debug" in sys.argv)  # blocks until the window closes
    bundles.stop()


if __name__ == "__main__":
    main()
