"""
Configuration manager for the application
"""
from __future__ import annotations

import json
import os
import logging
from pathlib import Path
from typing import Dict, Any

logger = logging.getLogger(__name__)


class ConfigManager:
    """Manage application configuration"""

    DEFAULT_CONFIG = {
        "mail_paths": [],
        "api_key": "",
        "start_with_windows": False,
        "minimize_to_tray": True,
        "show_notifications": True,
        "auto_start_monitoring": False,
        "alert_poll_interval": 300,
        "alerts": [],
        "pinned_schematics": [],
        "pinned_resources": [],
    }

    def __init__(self, config_file: str = "config.json"):
        self.config_file = Path(config_file)
        self.config: Dict[str, Any] = {}
        self.load()

    def load(self) -> bool:
        try:
            if self.config_file.exists():
                with open(self.config_file, 'r') as f:
                    loaded_config = json.load(f)
                self.config = {**self.DEFAULT_CONFIG, **loaded_config}
                self._migrate_mail_path()
                logger.info(f"Configuration loaded from {self.config_file}")
                return True
            else:
                logger.info("No config file found, using defaults")
                self.config = self.DEFAULT_CONFIG.copy()
                return False
        except json.JSONDecodeError as e:
            logger.error(f"Invalid JSON in config file: {e}")
            self.config = self.DEFAULT_CONFIG.copy()
            return False
        except Exception as e:
            logger.error(f"Error loading config: {e}")
            self.config = self.DEFAULT_CONFIG.copy()
            return False

    def save(self) -> bool:
        try:
            with open(self.config_file, 'w') as f:
                json.dump(self.config, f, indent=4)
            logger.info(f"Configuration saved to {self.config_file}")
            return True
        except Exception as e:
            logger.error(f"Error saving config: {e}")
            return False

    def get(self, key: str, default: Any = None) -> Any:
        return self.config.get(key, default)

    def set(self, key: str, value: Any) -> None:
        self.config[key] = value

    def get_all(self) -> Dict[str, Any]:
        return self.config.copy()

    def validate(self) -> tuple[bool, list[str]]:
        errors = []
        mail_paths = self.get("mail_paths", [])
        if not mail_paths:
            errors.append("At least one mail directory is required")
        else:
            valid_paths = 0
            for i, mail_entry in enumerate(mail_paths):
                if isinstance(mail_entry, dict):
                    path = mail_entry.get("path", "")
                    if path and os.path.exists(path):
                        valid_paths += 1
                    elif path:
                        errors.append(f"Mail path {i+1} does not exist: {path}")
            if valid_paths == 0:
                errors.append("At least one valid mail directory is required")

        if not self.get("api_key"):
            errors.append("API Key is required")

        return len(errors) == 0, errors

    def validate_api_key(self) -> tuple[bool, list[str]]:
        """Validate just the API key is present (for non-mail features)."""
        errors = []
        if not self.get("api_key"):
            errors.append("API Key is required")
        return len(errors) == 0, errors

    # --- Alert management ---

    def get_alerts(self) -> list[dict]:
        return self.get("alerts", [])

    def add_alert(self, alert: dict) -> None:
        alerts = self.get_alerts()
        alerts.append(alert)
        self.set("alerts", alerts)
        self.save()

    def remove_alert(self, index: int) -> None:
        alerts = self.get_alerts()
        if 0 <= index < len(alerts):
            alerts.pop(index)
            self.set("alerts", alerts)
            self.save()

    # --- Pinned resources ---

    def get_pinned_resources(self) -> list[str]:
        return self.get("pinned_resources", [])

    def toggle_pinned_resource(self, resource_id: str) -> bool:
        """Toggle pin state. Returns True if now pinned."""
        pinned = self.get_pinned_resources()
        if resource_id in pinned:
            pinned.remove(resource_id)
            self.set("pinned_resources", pinned)
            self.save()
            return False
        else:
            pinned.append(resource_id)
            self.set("pinned_resources", pinned)
            self.save()
            return True

    # --- Pinned schematics ---

    def get_pinned_schematics(self) -> list[str]:
        return self.get("pinned_schematics", [])

    def toggle_pinned_schematic(self, schematic_id: str) -> bool:
        """Toggle pin state. Returns True if now pinned."""
        pinned = self.get_pinned_schematics()
        if schematic_id in pinned:
            pinned.remove(schematic_id)
            self.set("pinned_schematics", pinned)
            self.save()
            return False
        else:
            pinned.append(schematic_id)
            self.set("pinned_schematics", pinned)
            self.save()
            return True

    # --- Migration ---

    def _migrate_mail_path(self) -> None:
        if "mail_path" in self.config and not self.config.get("mail_paths"):
            old_path = self.config.get("mail_path", "")
            if old_path:
                self.config["mail_paths"] = [{"path": old_path, "label": ""}]
                logger.info("Migrated old mail_path to mail_paths format")
            del self.config["mail_path"]
