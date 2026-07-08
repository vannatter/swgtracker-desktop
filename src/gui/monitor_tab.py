"""
Monitor tab for mail tracking status and activity log.
"""
import customtkinter as ctk
from datetime import datetime
import logging
from .theme import COLORS, FONTS

logger = logging.getLogger(__name__)


class MonitorTab(ctk.CTkFrame):
    """Monitoring and status tab for mail upload."""

    def __init__(self, master, config_manager):
        super().__init__(master)
        self.config_manager = config_manager
        self.is_monitoring = False
        self.stats = {
            'files_processed': 0,
            'files_uploaded': 0,
            'errors': 0,
            'start_time': None
        }

        self.configure(fg_color=COLORS['bg_primary'])
        self._create_widgets()

    def _create_widgets(self):
        container = ctk.CTkFrame(self, fg_color=COLORS['bg_primary'])
        container.pack(fill="both", expand=True, padx=20, pady=20)

        ctk.CTkLabel(
            container, text="Mail Monitor", font=FONTS['title'],
            text_color=COLORS['text_primary']
        ).pack(anchor="w", pady=(0, 20))

        # Status Section
        status_section = ctk.CTkFrame(container, fg_color=COLORS['bg_secondary'], corner_radius=8)
        status_section.pack(fill="x", pady=(0, 15))

        ctk.CTkLabel(
            status_section, text="Status", font=FONTS['heading'],
            text_color=COLORS['text_primary']
        ).pack(anchor="w", padx=15, pady=(15, 10))

        status_frame = ctk.CTkFrame(status_section, fg_color="transparent")
        status_frame.pack(fill="x", padx=15, pady=(0, 15))

        self.status_indicator = ctk.CTkLabel(
            status_frame, text="*", font=('Helvetica', 24),
            text_color=COLORS['text_muted']
        )
        self.status_indicator.pack(side="left", padx=(0, 10))

        self.status_text = ctk.CTkLabel(
            status_frame, text="Not Monitoring", font=FONTS['body'],
            text_color=COLORS['text_muted']
        )
        self.status_text.pack(side="left")

        # Statistics Section
        stats_section = ctk.CTkFrame(container, fg_color=COLORS['bg_secondary'], corner_radius=8)
        stats_section.pack(fill="x", pady=(0, 15))

        ctk.CTkLabel(
            stats_section, text="Statistics", font=FONTS['heading'],
            text_color=COLORS['text_primary']
        ).pack(anchor="w", padx=15, pady=(15, 10))

        stats_grid = ctk.CTkFrame(stats_section, fg_color="transparent")
        stats_grid.pack(fill="x", padx=15, pady=(0, 15))

        # Files Processed
        processed_frame = ctk.CTkFrame(stats_grid, fg_color=COLORS['bg_tertiary'], corner_radius=6)
        processed_frame.pack(side="left", expand=True, fill="both", padx=(0, 10))
        ctk.CTkLabel(processed_frame, text="Files Processed", font=FONTS['stat_label'],
                     text_color=COLORS['text_muted']).pack(pady=(10, 5))
        self.processed_label = ctk.CTkLabel(processed_frame, text="0",
                                            font=('Helvetica', 20, 'bold'),
                                            text_color=COLORS['text_primary'])
        self.processed_label.pack(pady=(0, 10))

        # Files Uploaded
        uploaded_frame = ctk.CTkFrame(stats_grid, fg_color=COLORS['bg_tertiary'], corner_radius=6)
        uploaded_frame.pack(side="left", expand=True, fill="both", padx=(0, 10))
        ctk.CTkLabel(uploaded_frame, text="Uploaded", font=FONTS['stat_label'],
                     text_color=COLORS['text_muted']).pack(pady=(10, 5))
        self.uploaded_label = ctk.CTkLabel(uploaded_frame, text="0",
                                           font=('Helvetica', 20, 'bold'),
                                           text_color=COLORS['success'])
        self.uploaded_label.pack(pady=(0, 10))

        # Errors
        errors_frame = ctk.CTkFrame(stats_grid, fg_color=COLORS['bg_tertiary'], corner_radius=6)
        errors_frame.pack(side="left", expand=True, fill="both")
        ctk.CTkLabel(errors_frame, text="Errors", font=FONTS['stat_label'],
                     text_color=COLORS['text_muted']).pack(pady=(10, 5))
        self.errors_label = ctk.CTkLabel(errors_frame, text="0",
                                          font=('Helvetica', 20, 'bold'),
                                          text_color=COLORS['error'])
        self.errors_label.pack(pady=(0, 10))

        # Activity Log
        log_section = ctk.CTkFrame(container, fg_color=COLORS['bg_secondary'], corner_radius=8)
        log_section.pack(fill="both", expand=True)

        log_header = ctk.CTkFrame(log_section, fg_color="transparent")
        log_header.pack(fill="x", padx=15, pady=(15, 10))

        ctk.CTkLabel(log_header, text="Activity Log", font=FONTS['heading'],
                     text_color=COLORS['text_primary']).pack(side="left")

        ctk.CTkButton(
            log_header, text="Clear", command=self._clear_log,
            font=FONTS['small'], width=60, height=25,
            fg_color=COLORS['btn_secondary'], hover_color=COLORS['btn_secondary_hover'],
            border_width=1, border_color=COLORS['btn_secondary_border']
        ).pack(side="right")

        self.log_textbox = ctk.CTkTextbox(
            log_section, font=FONTS['mono'], wrap="word", state="disabled",
            fg_color=COLORS['bg_tertiary']
        )
        self.log_textbox.pack(fill="both", expand=True, padx=15, pady=(0, 15))
        self.log_textbox.tag_config("info", foreground=COLORS['info'])
        self.log_textbox.tag_config("success", foreground=COLORS['success'])
        self.log_textbox.tag_config("error", foreground=COLORS['error'])
        self.log_textbox.tag_config("warning", foreground=COLORS['warning'])
        self.log_textbox.tag_config("timestamp", foreground=COLORS['text_muted'])

    def set_monitoring_status(self, is_monitoring: bool, message: str = ""):
        self.is_monitoring = is_monitoring
        if is_monitoring:
            self.status_indicator.configure(text_color=COLORS['success'])
            self.status_text.configure(text=message or "Monitoring Active",
                                       text_color=COLORS['success'])
            if self.stats['start_time'] is None:
                self.stats['start_time'] = datetime.now()
        else:
            self.status_indicator.configure(text_color=COLORS['text_muted'])
            self.status_text.configure(text=message or "Not Monitoring",
                                       text_color=COLORS['text_muted'])

    def log_message(self, message: str, level: str = "info"):
        timestamp = datetime.now().strftime("%H:%M:%S")
        self.log_textbox.configure(state="normal")
        self.log_textbox.insert("end", f"[{timestamp}] ", "timestamp")
        self.log_textbox.insert("end", f"{message}\n", level)
        self.log_textbox.configure(state="disabled")
        self.log_textbox.see("end")

    def update_stats(self, stat_type: str, increment: int = 1):
        if stat_type in self.stats:
            self.stats[stat_type] += increment
            if stat_type == 'files_processed':
                self.processed_label.configure(text=str(self.stats['files_processed']))
            elif stat_type == 'files_uploaded':
                self.uploaded_label.configure(text=str(self.stats['files_uploaded']))
            elif stat_type == 'errors':
                self.errors_label.configure(text=str(self.stats['errors']))

    def _clear_log(self):
        self.log_textbox.configure(state="normal")
        self.log_textbox.delete("1.0", "end")
        self.log_textbox.configure(state="disabled")
