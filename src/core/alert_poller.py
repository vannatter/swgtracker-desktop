"""
Alert poller — the app half of spawn alerts. The server evaluates rules every
cron tick and stores matches in alert_hits; this thread checks that feed every
`alert_poll_interval` seconds and fires a desktop notification for anything new.

The watermark starts at the current max hit id, so launching the app never
replays old alerts, and backfill hits (created when a rule is saved) are
skipped — those aren't "new spawn" news.
"""
from __future__ import annotations

import logging
import threading

logger = logging.getLogger(__name__)


class AlertPoller:
    def __init__(self, config, api_client, notifier):
        self.config = config
        self.api = api_client
        self.notifier = notifier          # callable(title, message)
        self._stop = threading.Event()
        self._watermark: int | None = None  # None until the first successful fetch

    def start(self):
        threading.Thread(target=self._loop, name="alert-poller", daemon=True).start()

    def stop(self):
        self._stop.set()

    def _interval(self) -> int:
        try:
            return max(60, int(self.config.get("alert_poll_interval", 300)))
        except (TypeError, ValueError):
            return 300

    def _loop(self):
        logger.info("Alert poller started")
        self._check()  # sets the watermark; notifies nothing on first pass
        # re-read the interval every wait so a Settings change applies live
        while not self._stop.wait(self._interval()):
            try:
                self._check()
            except Exception:  # noqa: BLE001 — the loop must survive anything
                logger.error("alert poll failed", exc_info=True)

    def _check(self):
        ok, data = self.api.get_alerts()
        if not ok or not isinstance(data, dict):
            return
        hits = data.get("hits") or []
        top = max((int(h.get("id", 0)) for h in hits), default=0)
        if self._watermark is None:
            self._watermark = top
            return
        fresh = [h for h in hits
                 if int(h.get("id", 0)) > self._watermark
                 and not int(h.get("is_backfill", 0) or 0)]
        self._watermark = max(self._watermark, top)
        if not fresh:
            return
        if len(fresh) == 1:
            h = fresh[0]
            detail = h.get("detail") or ""
            self.notifier(
                f"Spawn alert: {h.get('rule_name', 'rule')}",
                f"{h.get('resource_name', 'Resource')}"
                + (f" — {detail}" if detail else ""),
            )
        else:
            names = ", ".join(h.get("resource_name", "?") for h in fresh[:4])
            more = f" +{len(fresh) - 4} more" if len(fresh) > 4 else ""
            self.notifier(f"{len(fresh)} new spawn alerts", names + more)
