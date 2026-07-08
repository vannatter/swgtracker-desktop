"""
Settings tab for configuration management.
"""
import customtkinter as ctk
from tkinter import filedialog
import logging
from typing import Callable, List, Dict
from .theme import COLORS, FONTS

logger = logging.getLogger(__name__)


class MailPathEntry(ctk.CTkFrame):
    """Individual mail path entry widget."""

    def __init__(self, master, index: int, on_remove: Callable, **kwargs):
        super().__init__(master, fg_color="transparent", **kwargs)
        self.index = index
        self.on_remove = on_remove

        label_frame = ctk.CTkFrame(self, fg_color="transparent")
        label_frame.pack(fill="x", pady=(10, 5))

        ctk.CTkLabel(
            label_frame, text=f"Character {index + 1} Name (optional)",
            font=FONTS['body'], text_color=COLORS['text_muted']
        ).pack(side="left")

        self.label_entry = ctk.CTkEntry(
            label_frame, placeholder_text="e.g., Main Tank, Trader",
            font=FONTS['body'], height=35, width=250
        )
        self.label_entry.pack(side="right")

        path_frame = ctk.CTkFrame(self, fg_color="transparent")
        path_frame.pack(fill="x", pady=(0, 5))

        self.path_entry = ctk.CTkEntry(
            path_frame,
            placeholder_text="C:\\SWG Restoration III\\profiles\\character\\mail_CharacterName",
            font=FONTS['body'], height=35
        )
        self.path_entry.pack(side="left", fill="x", expand=True, padx=(0, 10))

        ctk.CTkButton(
            path_frame, text="Browse", command=self._browse_directory,
            font=FONTS['body'], width=80, height=35
        ).pack(side="left", padx=(0, 5))

        if index > 0:
            ctk.CTkButton(
                path_frame, text="X", command=lambda: on_remove(self),
                font=('Helvetica', 16, 'bold'), width=35, height=35,
                fg_color=COLORS['accent'], hover_color=COLORS['accent_hover']
            ).pack(side="left")

    def _browse_directory(self):
        directory = filedialog.askdirectory(
            title="Select SWG Mail Directory",
            initialdir=self.path_entry.get() or ""
        )
        if directory:
            self.path_entry.delete(0, "end")
            self.path_entry.insert(0, directory)

    def get_values(self) -> Dict[str, str]:
        return {
            "path": self.path_entry.get().strip(),
            "label": self.label_entry.get().strip()
        }

    def set_values(self, path: str, label: str):
        self.path_entry.delete(0, "end")
        self.path_entry.insert(0, path)
        self.label_entry.delete(0, "end")
        self.label_entry.insert(0, label)


class SettingsTab(ctk.CTkFrame):
    """Settings configuration tab."""

    MAX_MAIL_PATHS = 4

    def __init__(self, master, config_manager, on_save_callback: Callable = None):
        super().__init__(master)
        self.config_manager = config_manager
        self.on_save_callback = on_save_callback
        self.mail_path_entries: List[MailPathEntry] = []

        self.configure(fg_color=COLORS['bg_primary'])
        self._create_widgets()
        self._load_settings()

    def _create_widgets(self):
        scrollable = ctk.CTkScrollableFrame(
            self, fg_color=COLORS['bg_primary'],
            scrollbar_button_color=COLORS['bg_tertiary'],
            scrollbar_button_hover_color=COLORS['border']
        )
        scrollable.pack(fill="both", expand=True)

        container = ctk.CTkFrame(scrollable, fg_color="transparent")
        container.pack(fill="both", expand=True, padx=20, pady=(10, 20))

        ctk.CTkLabel(container, text="Settings", font=FONTS['title'],
                     text_color=COLORS['text_primary']).pack(anchor="w", pady=(0, 10))

        # --- API Key Section ---
        api_section = ctk.CTkFrame(container, fg_color=COLORS['bg_secondary'], corner_radius=8)
        api_section.pack(fill="x", pady=(0, 10))

        ctk.CTkLabel(api_section, text="SWGTracker.com API Key", font=FONTS['heading'],
                     text_color=COLORS['text_primary']).pack(anchor="w", padx=15, pady=(12, 5))

        ctk.CTkLabel(api_section, text="Required for all features. Get your key from swgtracker.com.",
                     font=FONTS['small'], text_color=COLORS['text_muted']).pack(anchor="w", padx=15, pady=(0, 5))

        self.user_key_entry = ctk.CTkEntry(
            api_section, placeholder_text="Enter your API Key",
            font=FONTS['body'], show="*", height=35
        )
        self.user_key_entry.pack(fill="x", padx=15, pady=(0, 12))

        # --- Mail Paths Section ---
        mail_section = ctk.CTkFrame(container, fg_color=COLORS['bg_secondary'], corner_radius=8)
        mail_section.pack(fill="x", pady=(0, 10))

        ctk.CTkLabel(mail_section, text="SWG Mail Directories (up to 4 characters)",
                     font=FONTS['heading'], text_color=COLORS['text_primary']
                     ).pack(anchor="w", padx=15, pady=(12, 5))

        self.mail_paths_container = ctk.CTkFrame(mail_section, fg_color="transparent")
        self.mail_paths_container.pack(fill="x", padx=15, pady=(0, 5))

        self._add_mail_path_entry()

        self.add_button = ctk.CTkButton(
            mail_section, text="+ Add Character", command=self._add_mail_path_entry,
            font=FONTS['body'], height=35,
            fg_color=COLORS['btn_secondary'], hover_color=COLORS['btn_secondary_hover'],
            border_width=1, border_color=COLORS['btn_secondary_border']
        )
        self.add_button.pack(padx=15, pady=(5, 12))

        # --- Alert Settings ---
        alert_section = ctk.CTkFrame(container, fg_color=COLORS['bg_secondary'], corner_radius=8)
        alert_section.pack(fill="x", pady=(0, 10))

        ctk.CTkLabel(alert_section, text="Alert Settings", font=FONTS['heading'],
                     text_color=COLORS['text_primary']).pack(anchor="w", padx=15, pady=(12, 8))

        poll_frame = ctk.CTkFrame(alert_section, fg_color="transparent")
        poll_frame.pack(fill="x", padx=15, pady=(0, 12))

        ctk.CTkLabel(poll_frame, text="Check for new spawns every:",
                     font=FONTS['body'], text_color=COLORS['text_muted']).pack(side="left")

        self.poll_interval_var = ctk.StringVar(value="5")
        ctk.CTkOptionMenu(
            poll_frame, variable=self.poll_interval_var,
            values=["1", "2", "5", "10", "15", "30"],
            font=FONTS['body'], height=30, width=70,
            fg_color=COLORS['bg_tertiary'], button_color=COLORS['border'],
            dropdown_fg_color=COLORS['bg_secondary']
        ).pack(side="left", padx=8)

        ctk.CTkLabel(poll_frame, text="minutes",
                     font=FONTS['body'], text_color=COLORS['text_muted']).pack(side="left")

        # --- Preferences ---
        prefs_section = ctk.CTkFrame(container, fg_color=COLORS['bg_secondary'], corner_radius=8)
        prefs_section.pack(fill="x", pady=(0, 10))

        ctk.CTkLabel(prefs_section, text="Preferences", font=FONTS['heading'],
                     text_color=COLORS['text_primary']).pack(anchor="w", padx=15, pady=(12, 8))

        self.minimize_tray_var = ctk.BooleanVar()
        ctk.CTkSwitch(prefs_section, text="Minimize to system tray",
                      variable=self.minimize_tray_var, font=FONTS['body'],
                      progress_color=COLORS['btn_primary']).pack(anchor="w", padx=15, pady=5)

        self.show_notifications_var = ctk.BooleanVar()
        ctk.CTkSwitch(prefs_section, text="Show desktop notifications",
                      variable=self.show_notifications_var, font=FONTS['body'],
                      progress_color=COLORS['btn_primary']).pack(anchor="w", padx=15, pady=5)

        self.auto_start_var = ctk.BooleanVar()
        ctk.CTkSwitch(prefs_section, text="Auto-start mail monitoring on launch",
                      variable=self.auto_start_var, font=FONTS['body'],
                      progress_color=COLORS['btn_primary']).pack(anchor="w", padx=15, pady=(5, 12))

        # Save button
        ctk.CTkButton(
            container, text="Save Settings", command=self._save_settings,
            font=FONTS['heading'], height=40,
            fg_color=COLORS['btn_primary'], hover_color=COLORS['btn_primary_hover']
        ).pack(fill="x", pady=(5, 0))

        self.status_label = ctk.CTkLabel(container, text="", font=FONTS['small'],
                                          text_color=COLORS['text_muted'])
        self.status_label.pack(anchor="w", pady=(10, 0))

    def _add_mail_path_entry(self):
        if len(self.mail_path_entries) >= self.MAX_MAIL_PATHS:
            self._show_status(f"Maximum {self.MAX_MAIL_PATHS} characters allowed", COLORS['error'])
            return

        index = len(self.mail_path_entries)
        entry = MailPathEntry(self.mail_paths_container, index=index,
                              on_remove=self._remove_mail_path_entry)
        entry.pack(fill="x", pady=(0, 10))
        self.mail_path_entries.append(entry)

        if len(self.mail_path_entries) >= self.MAX_MAIL_PATHS:
            self.add_button.configure(state="disabled")

    def _remove_mail_path_entry(self, entry: MailPathEntry):
        if entry in self.mail_path_entries:
            self.mail_path_entries.remove(entry)
            entry.destroy()
            for i, e in enumerate(self.mail_path_entries):
                e.index = i
            if len(self.mail_path_entries) < self.MAX_MAIL_PATHS:
                self.add_button.configure(state="normal")

    def _load_settings(self):
        config = self.config_manager.get_all()

        mail_paths = config.get('mail_paths', [])
        if mail_paths:
            for entry in self.mail_path_entries:
                entry.destroy()
            self.mail_path_entries.clear()

            for i, mail_entry in enumerate(mail_paths):
                if i >= self.MAX_MAIL_PATHS:
                    break
                self._add_mail_path_entry()
                if isinstance(mail_entry, dict):
                    self.mail_path_entries[i].set_values(
                        mail_entry.get("path", ""), mail_entry.get("label", "")
                    )

        self.user_key_entry.insert(0, config.get('api_key', ''))

        poll_seconds = config.get('alert_poll_interval', 300)
        self.poll_interval_var.set(str(poll_seconds // 60))

        self.minimize_tray_var.set(config.get('minimize_to_tray', True))
        self.show_notifications_var.set(config.get('show_notifications', True))
        self.auto_start_var.set(config.get('auto_start_monitoring', False))

    def _save_settings(self):
        try:
            mail_paths = []
            for entry in self.mail_path_entries:
                values = entry.get_values()
                if values["path"]:
                    mail_paths.append(values)

            self.config_manager.set('mail_paths', mail_paths)
            self.config_manager.set('api_key', self.user_key_entry.get())

            poll_minutes = int(self.poll_interval_var.get())
            self.config_manager.set('alert_poll_interval', poll_minutes * 60)

            self.config_manager.set('minimize_to_tray', self.minimize_tray_var.get())
            self.config_manager.set('show_notifications', self.show_notifications_var.get())
            self.config_manager.set('auto_start_monitoring', self.auto_start_var.get())

            if self.config_manager.save():
                self._show_status("Settings saved successfully", COLORS['success'])
                if self.on_save_callback:
                    self.on_save_callback()
            else:
                self._show_status("Failed to save settings", COLORS['error'])
        except Exception as e:
            logger.error(f"Error saving settings: {e}")
            self._show_status(f"Error: {str(e)}", COLORS['error'])

    def _show_status(self, message: str, color: str):
        self.status_label.configure(text=message, text_color=color)
        self.after(3000, lambda: self.status_label.configure(text=""))
