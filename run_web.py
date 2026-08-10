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

APP_VERSION = "0.12.7"  # keep in sync with pyproject.toml — bump with every change batch

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


def _setup_tray(window, config):
    """Windows only: make the Settings 'Minimize to system tray' toggle real —
    minimizing or closing the window tucks the app into the tray (mail
    monitoring and alert polling keep running); the tray icon reopens it or
    quits for good. macOS keeps its normal window/Dock behavior. Returns the
    pystray icon so main() can stop it on exit, or None."""
    if sys.platform != "win32":
        return None
    try:
        import pystray
        from PIL import Image
        img = Image.open(str(ROOT / "src" / "resources" / "icon.png"))
    except Exception:  # noqa: BLE001 — no tray beats no app
        logger.info("tray unavailable", exc_info=True)
        return None

    quitting = {"flag": False}

    def _show(icon=None, item=None):
        try:
            window.restore()
            window.show()
        except Exception:  # noqa: BLE001
            logger.error("tray show failed", exc_info=True)

    def _quit(icon=None, item=None):
        quitting["flag"] = True
        try:
            window.destroy()
        except Exception:  # noqa: BLE001 — the window may already be gone
            import os
            os._exit(0)

    icon = pystray.Icon(
        "swgtracker", img, "SWG Tracker Desktop",
        menu=pystray.Menu(
            pystray.MenuItem("Open SWG Tracker", _show, default=True),  # double-click
            pystray.MenuItem("Quit", _quit),
        ),
    )
    icon.run_detached()

    def _on_minimized():
        if config.get("minimize_to_tray", True):
            try:
                window.hide()
            except Exception:  # noqa: BLE001
                pass

    def _on_closing():
        # X button: hide to tray instead of quitting — unless the user is
        # quitting from the tray menu or has the setting off. The live
        # config read means a Settings change applies without a restart.
        if quitting["flag"] or not config.get("minimize_to_tray", True):
            return True
        try:
            window.hide()
        except Exception:  # noqa: BLE001 — if hiding fails, let the close happen
            return True
        return False  # cancels the close

    window.events.minimized += _on_minimized
    window.events.closing += _on_closing
    return icon


def main():
    _set_mac_dock_icon()
    config = ConfigManager(str(DATA_DIR / "config.json"))
    # dev version mimicry (Settings → Developer) survives restarts on purpose —
    # gate testing needs the fake version announced from the very first call
    fake_ver = str(config.get("dev_fake_version") or "").strip()
    api_client = SWGTrackerAPI(config.get("api_key", "") or "", app_version=fake_ver or APP_VERSION)
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

    # In-game scanner: global hotkey → screen region → native OCR → review
    # queue. Import is guarded — a machine without pynput/OCR just runs
    # without the feature (scan_get_config reports available: false).
    try:
        from src.core.scanner import Scanner
        bridge.scanner = Scanner(config, notify=lambda t, m: bridge.notify(t, m))
        if config.get("scan_enabled", False):
            bridge.scanner.start_hotkey()
    except Exception:  # noqa: BLE001
        logging.getLogger(__name__).info("scanner unavailable", exc_info=True)
    if config.get("auto_start_monitoring", False):
        monitor.start_monitoring()

    # server-side cron evaluates alert rules into alert_hits; this polls that
    # feed on the "check for new spawns every N minutes" setting and notifies
    alert_poller = AlertPoller(config, api_client,
                               notifier=lambda t, m: bridge.notify(t, m))
    alert_poller.start()

    logger.info("SWG Tracker Desktop v%s starting — ui: %s (%s)",
                APP_VERSION, bundles.active_version or "builtin", bundles.active_source)
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

    tray_icon = _setup_tray(window, config)

    # --debug enables the webview inspector (right-click → Inspect Element)
    webview.start(debug="--debug" in sys.argv)  # blocks until the window closes
    if tray_icon:
        tray_icon.stop()
    bundles.stop()


if __name__ == "__main__":
    main()
