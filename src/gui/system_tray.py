"""
System tray integration (Windows only).
"""
import logging
from typing import Callable, Optional
from PIL import Image, ImageDraw

logger = logging.getLogger(__name__)

try:
    import pystray
    PYSTRAY_AVAILABLE = True
except ImportError:
    PYSTRAY_AVAILABLE = False
    logger.info("pystray not available - system tray disabled")


class SystemTray:
    """System tray icon and menu."""

    def __init__(self, on_show: Callable, on_hide: Callable,
                 on_start: Callable, on_stop: Callable, on_exit: Callable):
        self.on_show = on_show
        self.on_hide = on_hide
        self.on_start = on_start
        self.on_stop = on_stop
        self.on_exit = on_exit
        self.icon = None
        self.is_monitoring = False

    def create_icon(self):
        try:
            from pathlib import Path
            from src.utils import get_resource_path
            icon_path = get_resource_path("resources/icon.png")
            if Path(icon_path).exists():
                image = Image.open(icon_path)
                return image.resize((64, 64), Image.Resampling.LANCZOS)
        except Exception as e:
            logger.warning(f"Could not load logo for system tray: {e}")

        # Fallback icon
        image = Image.new('RGB', (64, 64), (10, 15, 10))
        draw = ImageDraw.Draw(image)
        draw.ellipse([12, 12, 52, 52], fill=(22, 163, 74), outline=(255, 255, 255))
        return image

    def setup(self):
        if not PYSTRAY_AVAILABLE:
            logger.warning("Cannot setup system tray - pystray not available")
            return

        try:
            icon_image = self.create_icon()
            menu = pystray.Menu(
                pystray.MenuItem("Show", self._handle_show, default=True),
                pystray.MenuItem("Start Monitoring", self._handle_start,
                                 visible=lambda item: not self.is_monitoring),
                pystray.MenuItem("Stop Monitoring", self._handle_stop,
                                 visible=lambda item: self.is_monitoring),
                pystray.Menu.SEPARATOR,
                pystray.MenuItem("Exit", self._handle_exit)
            )
            self.icon = pystray.Icon("SWGTrackerDesktop", icon_image,
                                     "SWG Tracker Desktop", menu)
        except Exception as e:
            logger.error(f"Error creating system tray icon: {e}")

    def run(self):
        if self.icon:
            try:
                self.icon.run()
            except Exception as e:
                logger.error(f"Error running system tray: {e}")

    def stop(self):
        if self.icon:
            try:
                self.icon.stop()
            except Exception as e:
                logger.error(f"Error stopping system tray: {e}")

    def update_monitoring_status(self, is_monitoring: bool):
        self.is_monitoring = is_monitoring
        if self.icon:
            self.icon.update_menu()

    def _handle_show(self, icon, item):
        self.on_show()

    def _handle_start(self, icon, item):
        self.on_start()

    def _handle_stop(self, icon, item):
        self.on_stop()

    def _handle_exit(self, icon, item):
        self.on_exit()
