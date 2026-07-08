"""
File watcher for monitoring SWG mail directory
"""
from __future__ import annotations

import os
import time
import logging
from typing import Callable, Optional
from watchdog.observers import Observer
from watchdog.events import FileSystemEventHandler, FileSystemEvent

logger = logging.getLogger(__name__)


class MailFileHandler(FileSystemEventHandler):
    """Handle file system events for mail files"""

    def __init__(self, callback: Callable[[str], None]):
        super().__init__()
        self.callback = callback

    def on_created(self, event: FileSystemEvent) -> None:
        if event.is_directory:
            return

        file_path = event.src_path
        logger.info(f"New file detected: {file_path}")
        time.sleep(0.1)

        try:
            self.callback(file_path)
        except Exception as e:
            logger.error(f"Error in file callback: {e}", exc_info=True)


class MailFileWatcher:
    """Watch for new mail files in SWG directory"""

    def __init__(self, watch_path: str, callback: Callable[[str], None]):
        self.watch_path = watch_path
        self.callback = callback
        self.observer: Optional[Observer] = None
        self.is_running = False

    def start(self) -> tuple[bool, str]:
        if self.is_running:
            return False, "Watcher is already running"

        if not os.path.exists(self.watch_path):
            return False, f"Watch path does not exist: {self.watch_path}"

        if not os.path.isdir(self.watch_path):
            return False, f"Watch path is not a directory: {self.watch_path}"

        try:
            self.observer = Observer()
            event_handler = MailFileHandler(self.callback)
            self.observer.schedule(event_handler, self.watch_path, recursive=True)
            self.observer.start()
            self.is_running = True
            logger.info(f"Started watching: {self.watch_path}")
            return True, f"Monitoring started: {self.watch_path}"
        except Exception as e:
            self.is_running = False
            return False, f"Failed to start watcher: {str(e)}"

    def stop(self) -> tuple[bool, str]:
        if not self.is_running:
            return False, "Watcher is not running"

        try:
            if self.observer:
                self.observer.stop()
                self.observer.join(timeout=5)
                self.observer = None
            self.is_running = False
            return True, "Monitoring stopped"
        except Exception as e:
            return False, f"Error stopping watcher: {str(e)}"

    def is_active(self) -> bool:
        return self.is_running and self.observer is not None
