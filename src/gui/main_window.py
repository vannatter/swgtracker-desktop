"""
Main application window with sidebar navigation matching swgtracker.com layout.
"""
from __future__ import annotations

import sys
import customtkinter as ctk
import logging
from .theme import COLORS, FONTS
from .monitor_tab import MonitorTab
from .resources_tab import ResourcesTab
from .alerts_tab import AlertsTab
from .schematics_tab import SchematicsTab
from .sales_tab import SalesTab
from .stockpile_tab import StockpileTab
from .settings_tab import SettingsTab

logger = logging.getLogger(__name__)

SIDEBAR_WIDTH = 220
SIDEBAR_COLLAPSED = 0


class SidebarButton(ctk.CTkFrame):
    """Navigation button with accent underline for active state."""

    def __init__(self, master, text, icon_text="", command=None, **kwargs):
        super().__init__(master, fg_color="transparent", corner_radius=0, **kwargs)

        display = f"  {icon_text}  {text}" if icon_text else f"      {text}"

        self.button = ctk.CTkButton(
            self,
            text=display,
            command=command,
            font=FONTS['nav'],
            text_color=COLORS['text_primary'],
            fg_color="transparent",
            hover_color=COLORS['border'],
            anchor="w",
            height=34,
            corner_radius=0,
        )
        self.button.pack(fill="x")

        # Accent underline (hidden by default)
        self.underline = ctk.CTkFrame(
            self, fg_color=COLORS['accent'],
            height=2, corner_radius=0
        )
        # Not packed yet — shown on set_active(True)

        self._is_active = False

    def set_active(self, active: bool):
        self._is_active = active
        if active:
            self.button.configure(
                fg_color=COLORS['border'],
                text_color=COLORS['text_hover'],
                font=FONTS['nav_active']
            )
            self.underline.pack(fill="x")
        else:
            self.button.configure(
                fg_color="transparent",
                text_color=COLORS['text_primary'],
                font=FONTS['nav']
            )
            self.underline.pack_forget()


class MainWindow(ctk.CTk):
    """Main application window with sidebar navigation."""

    def __init__(self, config_manager, api_client,
                 on_start_monitoring, on_stop_monitoring,
                 on_test_connection, on_close,
                 local_db=None):
        super().__init__()

        self.config_manager = config_manager
        self.local_db = local_db
        self.api_client = api_client
        self.on_start_monitoring = on_start_monitoring
        self.on_stop_monitoring = on_stop_monitoring
        self.on_test_connection = on_test_connection
        self.on_close_callback = on_close
        self.is_monitoring = False

        self.pages = {}
        self.nav_buttons = {}
        self.current_page = None

        self._setup_window()
        self._create_layout()

    def _setup_window(self):
        self.title("SWG Tracker Desktop")

        # Windows: set AppUserModelID so taskbar uses our icon, not Python's
        if sys.platform == 'win32':
            try:
                import ctypes
                ctypes.windll.shell32.SetCurrentProcessExplicitAppUserModelID(
                    'swgtracker.desktop.companion.1'
                )
            except Exception:
                pass

        window_width = 1200
        window_height = 800
        screen_width = self.winfo_screenwidth()
        screen_height = self.winfo_screenheight()
        x = (screen_width - window_width) // 2
        y = (screen_height - window_height) // 2
        self.geometry(f"{window_width}x{window_height}+{x}+{y}")
        self.update_idletasks()
        self.minsize(960, 650)

        try:
            from pathlib import Path
            from PIL import Image
            from src.utils import get_resource_path

            icon_path = get_resource_path("resources/icon.png")
            ico_path = get_resource_path("resources/icon.ico")

            if Path(icon_path).exists():
                icon_image = Image.open(icon_path)
                self.iconphoto(True, ctk.CTkImage(
                    light_image=icon_image, dark_image=icon_image, size=(32, 32)
                )._light_image)

            # Windows: also set .ico for taskbar
            if sys.platform == 'win32' and Path(ico_path).exists():
                self.iconbitmap(str(ico_path))
        except Exception:
            pass

        self.configure(fg_color=COLORS['bg_primary'])
        ctk.set_appearance_mode("dark")
        self.protocol("WM_DELETE_WINDOW", self._on_window_close)

    def _create_layout(self):
        # --- Top header bar ---
        header = ctk.CTkFrame(self, fg_color=COLORS['bg_secondary'], height=50, corner_radius=0)
        header.pack(fill="x", side="top")
        header.pack_propagate(False)

        # Logo / title in header
        try:
            from pathlib import Path
            from PIL import Image
            from src.utils import get_resource_path
            icon_path = get_resource_path("resources/icon.png")
            if Path(icon_path).exists():
                logo_image = Image.open(icon_path)
                logo_ctk = ctk.CTkImage(light_image=logo_image, dark_image=logo_image, size=(32, 32))
                ctk.CTkLabel(header, image=logo_ctk, text="").pack(side="left", padx=(15, 8))
        except Exception:
            pass

        ctk.CTkLabel(
            header, text="SWG Tracker Desktop",
            font=('Helvetica', 16, 'bold'), text_color=COLORS['text_hover']
        ).pack(side="left")

        ctk.CTkLabel(
            header, text="swgtracker.com companion",
            font=FONTS['small'], text_color=COLORS['text_muted']
        ).pack(side="left", padx=(10, 0))

        # Mail monitor controls in header (right side)
        controls = ctk.CTkFrame(header, fg_color="transparent")
        controls.pack(side="right", padx=15)

        self.monitor_status = ctk.CTkLabel(
            controls, text="", font=FONTS['small'],
            text_color=COLORS['text_muted']
        )
        self.monitor_status.pack(side="left", padx=(0, 10))

        self.start_button = ctk.CTkButton(
            controls, text="Start Mail Monitor", command=self._handle_start,
            font=FONTS['small'], width=120, height=28,
            fg_color=COLORS['btn_primary'], hover_color=COLORS['btn_primary_hover'],
            text_color=COLORS['text_hover']
        )
        self.start_button.pack(side="left", padx=(0, 5))

        self.stop_button = ctk.CTkButton(
            controls, text="Stop", command=self._handle_stop,
            font=FONTS['small'], width=50, height=28, state="disabled",
            fg_color=COLORS['btn_secondary'], hover_color=COLORS['btn_secondary_hover'],
            border_width=1, border_color=COLORS['btn_secondary_border'],
            text_color=COLORS['text_primary']
        )
        self.stop_button.pack(side="left")

        # --- Body: sidebar + content ---
        body = ctk.CTkFrame(self, fg_color=COLORS['bg_primary'], corner_radius=0)
        body.pack(fill="both", expand=True)

        # Sidebar
        self.sidebar = ctk.CTkFrame(
            body, fg_color=COLORS['bg_tertiary'],
            width=SIDEBAR_WIDTH, corner_radius=0
        )
        self.sidebar.pack(fill="y", side="left")
        self.sidebar.pack_propagate(False)

        # Sidebar nav items
        nav_items = [
            ("Resources", "resources"),
            ("Schematics", "schematics"),
            ("My Stockpile", "stockpile"),
            ("Spawn Alerts", "alerts"),
            ("My Sales", "sales"),
            ("Mail Monitor", "monitor"),
            ("Settings", "settings"),
        ]

        # Small spacer at top
        ctk.CTkFrame(self.sidebar, fg_color="transparent", height=10).pack()

        for label, page_key in nav_items:
            btn = SidebarButton(
                self.sidebar, text=label,
                command=lambda k=page_key: self._show_page(k)
            )
            btn.pack(fill="x")
            self.nav_buttons[page_key] = btn

        # Separator before status section
        ctk.CTkFrame(self.sidebar, fg_color=COLORS['border'], height=1).pack(fill="x", pady=15, padx=15)

        # Server pulse section (bottom of sidebar)
        status_frame = ctk.CTkFrame(self.sidebar, fg_color="transparent")
        status_frame.pack(fill="x", padx=15)

        ctk.CTkLabel(
            status_frame, text="SERVER PULSE",
            font=('Helvetica', 9, 'bold'), text_color=COLORS['text_muted']
        ).pack(anchor="w", pady=(0, 5))

        self.server_status_label = ctk.CTkLabel(
            status_frame, text="--",
            font=FONTS['small'], text_color=COLORS['text_primary']
        )
        self.server_status_label.pack(anchor="w")

        self.online_label = ctk.CTkLabel(
            status_frame, text="",
            font=FONTS['small'], text_color=COLORS['text_primary']
        )
        self.online_label.pack(anchor="w")

        self.peak_label = ctk.CTkLabel(
            status_frame, text="",
            font=FONTS['small'], text_color=COLORS['text_muted']
        )
        self.peak_label.pack(anchor="w")

        self.resources_label = ctk.CTkLabel(
            status_frame, text="",
            font=FONTS['small'], text_color=COLORS['text_muted']
        )
        self.resources_label.pack(anchor="w")

        # Connection test at bottom of sidebar
        ctk.CTkFrame(self.sidebar, fg_color="transparent", height=1).pack(fill="both", expand=True)

        ctk.CTkButton(
            self.sidebar, text="Test Connection",
            command=self._handle_test,
            font=FONTS['small'], height=28, width=180,
            fg_color=COLORS['btn_secondary'], hover_color=COLORS['btn_secondary_hover'],
            border_width=1, border_color=COLORS['btn_secondary_border'],
            text_color=COLORS['text_primary']
        ).pack(pady=(0, 10))

        # --- Content area ---
        self.content_area = ctk.CTkFrame(body, fg_color=COLORS['bg_primary'], corner_radius=0)
        self.content_area.pack(fill="both", expand=True, side="left")

        # Create all pages
        self._create_pages()

        # Show default page
        self._show_page("resources")

        # Load initial resources after UI is ready
        self.after(100, self.resources_tab.load_initial)

        # Start pulse refresh (every 3 minutes, backs off on failure)
        self._pulse_interval_ms = 3 * 60 * 1000
        self._pulse_fail_count = 0
        self._fetch_pulse()

    def _create_pages(self):
        # Resources
        self.resources_tab = ResourcesTab(
            self.content_area, self.config_manager, self.api_client
        )
        self.pages["resources"] = self.resources_tab

        # Schematics
        self.schematics_tab = SchematicsTab(
            self.content_area, self.config_manager, self.api_client
        )
        self.pages["schematics"] = self.schematics_tab

        # Stockpile
        if self.local_db:
            self.stockpile_tab = StockpileTab(
                self.content_area, self.config_manager, self.api_client, self.local_db
            )
            self.pages["stockpile"] = self.stockpile_tab

        # Sales
        self.sales_tab = SalesTab(
            self.content_area, self.config_manager, self.api_client
        )
        self.pages["sales"] = self.sales_tab

        # Alerts
        self.alerts_tab = AlertsTab(
            self.content_area, self.config_manager
        )
        self.pages["alerts"] = self.alerts_tab

        # Mail Monitor
        self.monitor_tab = MonitorTab(
            self.content_area, self.config_manager
        )
        self.pages["monitor"] = self.monitor_tab

        # Settings
        self.settings_tab = SettingsTab(
            self.content_area, self.config_manager,
            on_save_callback=self._on_settings_saved
        )
        self.pages["settings"] = self.settings_tab

    def _show_page(self, page_key: str):
        if self.current_page == page_key:
            return

        # Hide all pages
        for page in self.pages.values():
            page.pack_forget()

        # Show selected page
        self.pages[page_key].pack(fill="both", expand=True)

        # Update nav button states
        for key, btn in self.nav_buttons.items():
            btn.set_active(key == page_key)

        self.current_page = page_key

    # --- Mail monitoring handlers ---

    def _handle_start(self):
        is_valid, errors = self.config_manager.validate()
        if not is_valid:
            self.monitor_tab.log_message(
                "Config errors: " + ", ".join(errors), "error"
            )
            self._show_page("settings")
            return

        success, message = self.on_start_monitoring()
        if success:
            self.is_monitoring = True
            self.start_button.configure(state="disabled")
            self.stop_button.configure(state="normal")
            self.monitor_status.configure(text="Monitoring", text_color=COLORS['accent_green'])
            self.monitor_tab.set_monitoring_status(True, message)
            self.monitor_tab.log_message(message, "success")
        else:
            self.monitor_tab.log_message(f"Failed: {message}", "error")

    def _handle_stop(self):
        success, message = self.on_stop_monitoring()
        if success:
            self.is_monitoring = False
            self.start_button.configure(state="normal")
            self.stop_button.configure(state="disabled")
            self.monitor_status.configure(text="", text_color=COLORS['text_muted'])
            self.monitor_tab.set_monitoring_status(False, message)
            self.monitor_tab.log_message(message, "info")

    def _handle_test(self):
        self.monitor_tab.log_message("Testing connection...", "info")

        def test_thread():
            success, message = self.on_test_connection()
            self.after(0, lambda: self._test_result(success, message))

        import threading
        threading.Thread(target=test_thread, daemon=True).start()

    def _test_result(self, success: bool, message: str):
        level = "success" if success else "error"
        self.monitor_tab.log_message(message, level)
        if success:
            self.server_status_label.configure(
                text="Connected", text_color=COLORS['accent_green']
            )
        else:
            self.server_status_label.configure(
                text="Disconnected", text_color=COLORS['accent']
            )

    def _fetch_pulse(self):
        """Fetch server pulse in background, schedule next refresh."""
        import threading

        def _do_fetch():
            success, data = self.api_client.get_pulse()
            self.after(0, lambda: self._update_pulse(success, data))

        threading.Thread(target=_do_fetch, daemon=True).start()

    def _update_pulse(self, success: bool, data):
        """Update sidebar with pulse data and schedule next fetch."""
        if success and isinstance(data, dict):
            self._pulse_fail_count = 0
            online_data = data.get('online', {})
            current = online_data.get('current', 0)
            peak = online_data.get('peak_today', 0)
            active_res = data.get('active_resources', 0)

            self.server_status_label.configure(
                text="Online", text_color=COLORS['accent_green']
            )
            self.online_label.configure(
                text=f"Players: {current:,}",
                text_color=COLORS['text_primary']
            )
            self.peak_label.configure(text=f"Peak today: {peak:,}")
            self.resources_label.configure(text=f"Active resources: {active_res:,}")
        else:
            self._pulse_fail_count += 1
            self.server_status_label.configure(
                text="Offline", text_color=COLORS['accent']
            )
            self.online_label.configure(text="")
            self.peak_label.configure(text="")
            self.resources_label.configure(text="")

        # Schedule next pulse — back off on repeated failures (max 30 min)
        backoff = min(self._pulse_fail_count, 10)  # 0-10
        next_interval = self._pulse_interval_ms * (1 + backoff)
        self.after(next_interval, self._fetch_pulse)

    def _on_settings_saved(self):
        self.monitor_tab.log_message("Settings saved", "success")

    def _on_window_close(self):
        if self.config_manager.get('minimize_to_tray', True):
            self.withdraw()
        else:
            self.on_close_callback()

    def show_window(self):
        self.deiconify()
        self.lift()
        self.focus_force()

    def hide_window(self):
        self.withdraw()

    def get_monitor_tab(self) -> MonitorTab:
        return self.monitor_tab

    def get_alerts_tab(self) -> AlertsTab:
        return self.alerts_tab

    def update_monitoring_status(self, is_monitoring: bool):
        self.is_monitoring = is_monitoring
        if is_monitoring:
            self.start_button.configure(state="disabled")
            self.stop_button.configure(state="normal")
            self.monitor_status.configure(text="Monitoring", text_color=COLORS['accent_green'])
        else:
            self.start_button.configure(state="normal")
            self.stop_button.configure(state="disabled")
            self.monitor_status.configure(text="")
