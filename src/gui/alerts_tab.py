"""
Alerts tab - Configure spawn alert rules and view triggered alerts.
"""
import customtkinter as ctk
import logging
from datetime import datetime
from .theme import COLORS, FONTS, PLANETS, RESOURCE_STATS

logger = logging.getLogger(__name__)


class AlertRuleRow(ctk.CTkFrame):
    """Display a single alert rule with enable/disable toggle and delete."""

    def __init__(self, master, alert: dict, index: int,
                 on_toggle, on_delete, **kwargs):
        super().__init__(master, fg_color=COLORS['bg_tertiary'], corner_radius=6, **kwargs)

        self.alert = alert
        self.index = index

        row = ctk.CTkFrame(self, fg_color="transparent")
        row.pack(fill="x", padx=10, pady=8)

        # Enable toggle
        self.enabled_var = ctk.BooleanVar(value=alert.get('enabled', True))
        toggle = ctk.CTkSwitch(
            row, text="", variable=self.enabled_var,
            width=40, progress_color=COLORS['btn_primary'],
            command=lambda: on_toggle(index, self.enabled_var.get())
        )
        toggle.pack(side="left", padx=(0, 10))

        # Alert info
        info_frame = ctk.CTkFrame(row, fg_color="transparent")
        info_frame.pack(side="left", fill="x", expand=True)

        name = alert.get('name', f'Alert {index + 1}')
        ctk.CTkLabel(
            info_frame, text=name, font=FONTS['body'],
            text_color=COLORS['text_primary'], anchor="w"
        ).pack(anchor="w")

        # Build criteria summary
        criteria_parts = []
        res_type = alert.get('resource_type', '')
        if res_type:
            criteria_parts.append(f"Type: {res_type}")
        planet = alert.get('planet', '')
        if planet:
            criteria_parts.append(f"Planet: {planet}")

        stat_criteria = []
        for stat in ['oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe']:
            min_val = alert.get(f'min_{stat}', 0)
            if min_val and min_val > 0:
                stat_criteria.append(f"{stat.upper()}>={min_val}")
        if stat_criteria:
            criteria_parts.append(", ".join(stat_criteria))

        criteria_text = "  |  ".join(criteria_parts) if criteria_parts else "Any resource"
        ctk.CTkLabel(
            info_frame, text=criteria_text, font=FONTS['small'],
            text_color=COLORS['text_muted'], anchor="w"
        ).pack(anchor="w")

        # Delete button
        ctk.CTkButton(
            row, text="Delete", width=60, height=26, font=FONTS['small'],
            fg_color=COLORS['accent'], hover_color=COLORS['accent_hover'],
            command=lambda: on_delete(index)
        ).pack(side="right")


class AlertsTab(ctk.CTkFrame):
    """Alert configuration and triggered alert history tab."""

    def __init__(self, master, config_manager, resource_tracker=None):
        super().__init__(master)
        self.config_manager = config_manager
        self.resource_tracker = resource_tracker
        self.alert_rows = []
        self.triggered_alerts = []

        self.configure(fg_color=COLORS['bg_primary'])
        self._create_widgets()
        self._load_alerts()

    def _create_widgets(self):
        container = ctk.CTkFrame(self, fg_color=COLORS['bg_primary'])
        container.pack(fill="both", expand=True, padx=20, pady=20)

        # Title
        ctk.CTkLabel(
            container, text="Spawn Alerts", font=FONTS['title'],
            text_color=COLORS['text_primary']
        ).pack(anchor="w", pady=(0, 5))

        ctk.CTkLabel(
            container, text="Get notified when new resource spawns match your criteria.",
            font=FONTS['small'], text_color=COLORS['text_muted']
        ).pack(anchor="w", pady=(0, 15))

        # --- New Alert Form ---
        form_frame = ctk.CTkFrame(container, fg_color=COLORS['bg_secondary'], corner_radius=8)
        form_frame.pack(fill="x", pady=(0, 15))

        ctk.CTkLabel(
            form_frame, text="Create Alert", font=FONTS['heading'],
            text_color=COLORS['text_primary']
        ).pack(anchor="w", padx=15, pady=(12, 8))

        form_inner = ctk.CTkFrame(form_frame, fg_color="transparent")
        form_inner.pack(fill="x", padx=15, pady=(0, 12))

        # Row 1: Name, Resource Type, Planet
        row1 = ctk.CTkFrame(form_inner, fg_color="transparent")
        row1.pack(fill="x", pady=(0, 8))

        ctk.CTkLabel(row1, text="Name:", font=FONTS['body'],
                     text_color=COLORS['text_muted']).pack(side="left")
        self.alert_name_entry = ctk.CTkEntry(
            row1, placeholder_text="e.g. Great Copper", font=FONTS['body'],
            height=30, width=150
        )
        self.alert_name_entry.pack(side="left", padx=(5, 15))

        ctk.CTkLabel(row1, text="Type:", font=FONTS['body'],
                     text_color=COLORS['text_muted']).pack(side="left")
        self.alert_type_entry = ctk.CTkEntry(
            row1, placeholder_text="e.g. Copper (blank=any)", font=FONTS['body'],
            height=30, width=160
        )
        self.alert_type_entry.pack(side="left", padx=(5, 15))

        ctk.CTkLabel(row1, text="Planet:", font=FONTS['body'],
                     text_color=COLORS['text_muted']).pack(side="left")
        self.alert_planet_var = ctk.StringVar(value="Any")
        ctk.CTkOptionMenu(
            row1, variable=self.alert_planet_var,
            values=["Any"] + PLANETS,
            font=FONTS['body'], height=30, width=130,
            fg_color=COLORS['bg_tertiary'], button_color=COLORS['border'],
            dropdown_fg_color=COLORS['bg_secondary']
        ).pack(side="left", padx=(5, 0))

        # Row 2: Stat minimums
        row2 = ctk.CTkFrame(form_inner, fg_color="transparent")
        row2.pack(fill="x", pady=(0, 8))

        ctk.CTkLabel(row2, text="Min Stats:", font=FONTS['body'],
                     text_color=COLORS['text_muted']).pack(side="left", padx=(0, 10))

        self.stat_entries = {}
        for stat in RESOURCE_STATS:
            frame = ctk.CTkFrame(row2, fg_color="transparent")
            frame.pack(side="left", padx=(0, 5))
            ctk.CTkLabel(frame, text=stat, font=('Helvetica', 9),
                         text_color=COLORS['text_muted']).pack()
            entry = ctk.CTkEntry(
                frame, placeholder_text="0", font=FONTS['small'],
                height=24, width=38, justify="center"
            )
            entry.pack()
            self.stat_entries[stat.lower()] = entry

        # Add button
        ctk.CTkButton(
            form_inner, text="+ Add Alert", command=self._add_alert,
            font=FONTS['body'], height=32, width=120,
            fg_color=COLORS['btn_primary'], hover_color=COLORS['btn_primary_hover']
        ).pack(anchor="w", pady=(4, 0))

        # --- Active Alerts List ---
        ctk.CTkLabel(
            container, text="Active Alerts", font=FONTS['heading'],
            text_color=COLORS['text_primary']
        ).pack(anchor="w", pady=(0, 8))

        self.alerts_list_frame = ctk.CTkScrollableFrame(
            container, fg_color=COLORS['bg_primary'], height=150,
            scrollbar_button_color=COLORS['bg_tertiary'],
            scrollbar_button_hover_color=COLORS['border']
        )
        self.alerts_list_frame.pack(fill="x", pady=(0, 15))

        # --- Triggered Alerts Log ---
        ctk.CTkLabel(
            container, text="Triggered Alerts", font=FONTS['heading'],
            text_color=COLORS['text_primary']
        ).pack(anchor="w", pady=(0, 8))

        self.triggered_log = ctk.CTkTextbox(
            container, font=FONTS['mono'], wrap="word", state="disabled",
            fg_color=COLORS['bg_tertiary'], height=150
        )
        self.triggered_log.pack(fill="both", expand=True)
        self.triggered_log.tag_config("alert", foreground=COLORS['warning'])
        self.triggered_log.tag_config("timestamp", foreground=COLORS['text_muted'])
        self.triggered_log.tag_config("resource", foreground=COLORS['quality_great'])

    def _load_alerts(self):
        """Load and display configured alerts."""
        for row in self.alert_rows:
            row.destroy()
        self.alert_rows.clear()

        alerts = self.config_manager.get_alerts()
        for i, alert in enumerate(alerts):
            row = AlertRuleRow(
                self.alerts_list_frame, alert, i,
                on_toggle=self._toggle_alert,
                on_delete=self._delete_alert
            )
            row.pack(fill="x", pady=2)
            self.alert_rows.append(row)

        if not alerts:
            ctk.CTkLabel(
                self.alerts_list_frame, text="No alerts configured. Create one above.",
                font=FONTS['small'], text_color=COLORS['text_muted']
            ).pack(pady=10)

    def _add_alert(self):
        """Add a new alert from the form."""
        name = self.alert_name_entry.get().strip()
        if not name:
            name = f"Alert {len(self.config_manager.get_alerts()) + 1}"

        alert = {
            'name': name,
            'enabled': True,
            'resource_type': self.alert_type_entry.get().strip(),
            'planet': self.alert_planet_var.get() if self.alert_planet_var.get() != "Any" else "",
        }

        for stat, entry in self.stat_entries.items():
            val_str = entry.get().strip()
            try:
                val = int(val_str) if val_str else 0
            except ValueError:
                val = 0
            alert[f'min_{stat}'] = val

        self.config_manager.add_alert(alert)

        # Clear form
        self.alert_name_entry.delete(0, "end")
        self.alert_type_entry.delete(0, "end")
        self.alert_planet_var.set("Any")
        for entry in self.stat_entries.values():
            entry.delete(0, "end")

        self._load_alerts()

    def _toggle_alert(self, index: int, enabled: bool):
        alerts = self.config_manager.get_alerts()
        if 0 <= index < len(alerts):
            alerts[index]['enabled'] = enabled
            self.config_manager.set("alerts", alerts)
            self.config_manager.save()

    def _delete_alert(self, index: int):
        self.config_manager.remove_alert(index)
        self._load_alerts()

    def log_triggered_alert(self, spawn: dict, alert: dict):
        """Log a triggered alert to the UI."""
        timestamp = datetime.now().strftime("%H:%M:%S")
        resource_name = spawn.get('name', 'Unknown')
        alert_name = alert.get('name', 'Alert')
        rating = spawn.get('rating', '?')

        self.triggered_log.configure(state="normal")
        self.triggered_log.insert("end", f"[{timestamp}] ", "timestamp")
        self.triggered_log.insert("end", f"{alert_name}: ", "alert")
        self.triggered_log.insert("end", f"{resource_name} (Rating: {rating}%)\n", "resource")
        self.triggered_log.configure(state="disabled")
        self.triggered_log.see("end")
