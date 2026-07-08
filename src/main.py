"""
SWG Tracker Desktop - Main Application Entry Point
"""
from __future__ import annotations

import sys
import os
import logging
import threading
from pathlib import Path

# Add parent directory to path for imports
sys.path.insert(0, str(Path(__file__).parent.parent))

import customtkinter as ctk
from src.core.config_manager import ConfigManager
from src.core.file_watcher import MailFileWatcher
from src.core.api_client import SWGTrackerAPI
from src.core.resource_tracker import ResourceTracker
from src.core.local_db import LocalDB
from src.gui.main_window import MainWindow
from src.gui.system_tray import SystemTray

logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s',
    handlers=[
        logging.FileHandler('swg_tracker_desktop.log'),
        logging.StreamHandler()
    ]
)

logger = logging.getLogger(__name__)


class SWGTrackerDesktopApp:
    """Main application controller."""

    def __init__(self):
        self.config_manager = ConfigManager()
        self.file_watchers = []
        self.api_client = None
        self.resource_tracker = None
        self.main_window = None
        self.system_tray = None
        self.is_running = True

        # Create API client (always, even without full config validation)
        user_key = self.config_manager.get('api_key', '')
        if user_key:
            self.api_client = SWGTrackerAPI(user_key)
        else:
            self.api_client = SWGTrackerAPI('')

        # Local SQLite cache
        self.local_db = LocalDB()

        logger.info("SWG Tracker Desktop started")

    def start(self):
        """Start the application."""
        self.main_window = MainWindow(
            config_manager=self.config_manager,
            api_client=self.api_client,
            on_start_monitoring=self.start_monitoring,
            on_stop_monitoring=self.stop_monitoring,
            on_test_connection=self.test_connection,
            on_close=self.quit_application,
            local_db=self.local_db
        )

        self.setup_system_tray()
        self._setup_resource_tracker()

        # Auto-start monitoring if enabled
        if self.config_manager.get('auto_start_monitoring', False):
            self.main_window.after(1000, self._auto_start)

        self.main_window.mainloop()

    def setup_system_tray(self):
        if sys.platform != 'win32':
            logger.info("System tray disabled on non-Windows platform")
            return

        try:
            self.system_tray = SystemTray(
                on_show=self.show_window,
                on_hide=self.hide_window,
                on_start=lambda: self.start_monitoring(),
                on_stop=lambda: self.stop_monitoring(),
                on_exit=self.quit_application
            )
            self.system_tray.setup()
            tray_thread = threading.Thread(target=self.system_tray.run, daemon=True)
            tray_thread.start()
            logger.info("System tray initialized")
        except Exception as e:
            logger.error(f"Failed to initialize system tray: {e}")

    def _setup_resource_tracker(self):
        """Set up background resource tracker for spawn alerts."""
        if not self.api_client:
            return

        self.resource_tracker = ResourceTracker(
            api_client=self.api_client,
            config_manager=self.config_manager,
            on_alert=self._on_spawn_alert
        )

        # Wire it to the alerts tab
        alerts_tab = self.main_window.get_alerts_tab()
        alerts_tab.resource_tracker = self.resource_tracker

        # Auto-start if there are alerts configured
        if self.config_manager.get_alerts():
            self.resource_tracker.start()
            logger.info("Resource tracker auto-started (alerts configured)")

    def _on_spawn_alert(self, spawn: dict, alert: dict):
        """Handle a spawn alert match."""
        logger.info(f"Spawn alert: {spawn.get('name')} matched {alert.get('name')}")

        # Update UI on main thread
        if self.main_window:
            self.main_window.after(0, lambda: self._show_spawn_alert(spawn, alert))

    def _show_spawn_alert(self, spawn: dict, alert: dict):
        """Show spawn alert in the UI."""
        alerts_tab = self.main_window.get_alerts_tab()
        alerts_tab.log_triggered_alert(spawn, alert)

        # Also log to the monitor tab
        monitor_tab = self.main_window.get_monitor_tab()
        resource_name = spawn.get('name', 'Unknown')
        alert_name = alert.get('name', 'Alert')
        monitor_tab.log_message(
            f"SPAWN ALERT: {alert_name} - {resource_name}", "warning"
        )

    # --- Mail monitoring ---

    def start_monitoring(self) -> tuple[bool, str]:
        try:
            is_valid, errors = self.config_manager.validate()
            if not is_valid:
                return False, "Invalid configuration: " + ", ".join(errors)

            mail_paths = self.config_manager.get('mail_paths', [])
            user_key = self.config_manager.get('api_key')
            self.api_client = SWGTrackerAPI(user_key)

            started_paths = []
            for mail_entry in mail_paths:
                if isinstance(mail_entry, dict):
                    path = mail_entry.get("path", "")
                    label = mail_entry.get("label", "")
                    if not path or not os.path.exists(path):
                        continue

                    watcher = MailFileWatcher(watch_path=path, callback=self.on_new_mail_file)
                    success, msg = watcher.start()
                    if success:
                        self.file_watchers.append(watcher)
                        display_name = f"{label} ({path})" if label else path
                        started_paths.append(display_name)

            if not self.file_watchers:
                return False, "Failed to start monitoring any directories"

            if self.system_tray:
                self.system_tray.update_monitoring_status(True)

            message = f"Monitoring {len(started_paths)} director{'y' if len(started_paths) == 1 else 'ies'}"
            return True, message

        except Exception as e:
            logger.error(f"Failed to start monitoring: {e}", exc_info=True)
            return False, f"Failed to start monitoring: {str(e)}"

    def stop_monitoring(self) -> tuple[bool, str]:
        try:
            if not self.file_watchers:
                return False, "Monitoring is not active"

            stopped = 0
            for watcher in self.file_watchers:
                success, _ = watcher.stop()
                if success:
                    stopped += 1

            self.file_watchers = []

            if self.system_tray:
                self.system_tray.update_monitoring_status(False)

            return True, f"Stopped monitoring {stopped} director{'y' if stopped == 1 else 'ies'}"

        except Exception as e:
            return False, f"Failed to stop monitoring: {str(e)}"

    def on_new_mail_file(self, file_path: str):
        logger.info(f"Processing new mail file: {file_path}")
        monitor_tab = self.main_window.get_monitor_tab()

        try:
            monitor_tab.update_stats('files_processed')

            with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
                content = f.read()

            if not content.strip():
                monitor_tab.log_message(f"Skipped empty file: {os.path.basename(file_path)}", "warning")
                return

            monitor_tab.log_message(f"Uploading: {os.path.basename(file_path)}", "info")
            success, message = self.api_client.send_mail_content(content)

            if success:
                monitor_tab.update_stats('files_uploaded')
                monitor_tab.log_message(f"Uploaded: {os.path.basename(file_path)}", "success")
            else:
                monitor_tab.update_stats('errors')
                monitor_tab.log_message(f"Failed: {os.path.basename(file_path)} - {message}", "error")

        except Exception as e:
            monitor_tab.update_stats('errors')
            monitor_tab.log_message(f"Error: {os.path.basename(file_path)} - {str(e)}", "error")

    def test_connection(self) -> tuple[bool, str]:
        try:
            user_key = self.config_manager.get('api_key')
            if not user_key:
                return False, "API Key is required"
            api = SWGTrackerAPI(user_key)
            return api.test_connection()
        except Exception as e:
            return False, f"Connection test failed: {str(e)}"

    # --- Window management ---

    def show_window(self):
        if self.main_window:
            self.main_window.show_window()

    def hide_window(self):
        if self.main_window:
            self.main_window.hide_window()

    def quit_application(self):
        logger.info("Shutting down application")

        if self.resource_tracker and self.resource_tracker.is_running:
            self.resource_tracker.stop()

        if self.file_watchers:
            self.stop_monitoring()

        if self.system_tray:
            self.system_tray.stop()

        if self.main_window:
            self.main_window.quit()
            self.main_window.destroy()

        self.is_running = False
        sys.exit(0)

    def _auto_start(self):
        success, message = self.start_monitoring()
        if success:
            self.main_window.update_monitoring_status(True)
            self.main_window.get_monitor_tab().set_monitoring_status(True, message)
            self.main_window.get_monitor_tab().log_message(f"Auto-started: {message}", "success")
        else:
            self.main_window.get_monitor_tab().log_message(f"Auto-start failed: {message}", "error")


def main():
    try:
        app = SWGTrackerDesktopApp()
        app.start()
    except KeyboardInterrupt:
        logger.info("Application interrupted by user")
        sys.exit(0)
    except Exception as e:
        logger.error(f"Fatal error: {e}", exc_info=True)
        sys.exit(1)


if __name__ == "__main__":
    main()
