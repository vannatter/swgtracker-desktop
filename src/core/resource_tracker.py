"""
Resource tracker - polls for new spawns and checks against user alert criteria.
"""
from __future__ import annotations

import logging
import threading
import time
from typing import Callable, Optional

logger = logging.getLogger(__name__)


class ResourceTracker:
    """Background service that polls for new resource spawns and triggers alerts."""

    def __init__(self, api_client, config_manager, on_alert: Callable[[dict, dict], None]):
        """
        Args:
            api_client: SWGTrackerAPI instance
            config_manager: ConfigManager instance
            on_alert: Callback when a spawn matches an alert rule.
                      Called with (spawn_data, matching_alert_rule).
        """
        self.api = api_client
        self.config = config_manager
        self.on_alert = on_alert
        self._thread: Optional[threading.Thread] = None
        self._stop_event = threading.Event()
        self.is_running = False

    def start(self) -> tuple[bool, str]:
        if self.is_running:
            return False, "Tracker is already running"

        self._stop_event.clear()
        self._thread = threading.Thread(target=self._poll_loop, daemon=True)
        self._thread.start()
        self.is_running = True
        logger.info("Resource tracker started")
        return True, "Resource tracker started"

    def stop(self) -> tuple[bool, str]:
        if not self.is_running:
            return False, "Tracker is not running"

        self._stop_event.set()
        if self._thread:
            self._thread.join(timeout=10)
            self._thread = None
        self.is_running = False
        logger.info("Resource tracker stopped")
        return True, "Resource tracker stopped"

    def check_now(self) -> list[tuple[dict, dict]]:
        """Run a single check immediately. Returns list of (spawn, alert) matches."""
        return self._check_spawns()

    def _poll_loop(self):
        """Background polling loop."""
        while not self._stop_event.is_set():
            try:
                self._check_spawns()
            except Exception as e:
                logger.error(f"Error in resource tracker poll: {e}", exc_info=True)

            interval = self.config.get('alert_poll_interval', 300)
            self._stop_event.wait(timeout=interval)

    def _check_spawns(self) -> list[tuple[dict, dict]]:
        """Check new spawns against alert rules."""
        alerts = self.config.get_alerts()
        if not alerts:
            return []

        interval = self.config.get('alert_poll_interval', 300)
        # Check spawns from a window slightly larger than poll interval
        since_minutes = max(int(interval / 60) + 5, 10)

        success, data = self.api.check_spawns(since_minutes=since_minutes)
        if not success or not isinstance(data, dict):
            logger.warning(f"Failed to fetch new spawns: {data}")
            return []

        new_spawns = data.get('new_spawns', [])
        if not new_spawns:
            return []

        matches = []
        for spawn in new_spawns:
            for alert in alerts:
                if self._spawn_matches_alert(spawn, alert):
                    matches.append((spawn, alert))
                    try:
                        self.on_alert(spawn, alert)
                    except Exception as e:
                        logger.error(f"Error in alert callback: {e}")

        if matches:
            logger.info(f"Found {len(matches)} spawn alert matches")

        return matches

    @staticmethod
    def _spawn_matches_alert(spawn: dict, alert: dict) -> bool:
        """
        Check if a spawn matches an alert rule.

        Alert rule format:
        {
            "name": "Great Copper",
            "enabled": true,
            "resource_type": "Copper",     # optional, empty = any
            "planet": "",                   # optional, empty = any planet
            "min_oq": 900,                  # optional stat minimums
            "min_cr": 0,
            "min_cd": 0,
            ...
        }
        """
        if not alert.get('enabled', True):
            return False

        # Check resource type
        alert_type = alert.get('resource_type', '').lower()
        if alert_type:
            spawn_category = spawn.get('category', '').lower()
            if alert_type not in spawn_category:
                return False

        # Check planet
        alert_planet = alert.get('planet', '').lower()
        if alert_planet:
            spawn_planet = spawn.get('planet', '').lower()
            if alert_planet != spawn_planet:
                return False

        # Check stat minimums
        stat_fields = ['oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe']
        for stat in stat_fields:
            min_val = alert.get(f'min_{stat}', 0)
            if min_val and min_val > 0:
                spawn_val = spawn.get(stat, 0)
                if spawn_val < min_val:
                    return False

        return True
