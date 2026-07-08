"""
Stockpile tab - Manage personal resource stockpile with local caching.
"""
import tkinter as tk
from tkinter import ttk
import customtkinter as ctk
import threading
import logging
import time
from datetime import datetime
from .theme import COLORS, FONTS

logger = logging.getLogger(__name__)

COLUMNS = [
    ("Name", "name", 180, "w"),
    ("Type", "type_name", 170, "w"),
    ("Stock", "stock", 70, "center"),
    ("OQ", "oq", 50, "center"),
    ("CR", "cr", 50, "center"),
    ("CD", "cd", 50, "center"),
    ("DR", "dr", 50, "center"),
    ("HR", "hr", 50, "center"),
    ("MA", "ma", 50, "center"),
    ("SR", "sr", 50, "center"),
    ("UT", "ut", 50, "center"),
    ("FL", "fl", 50, "center"),
    ("PE", "pe", 50, "center"),
    ("Rating", "rating", 60, "center"),
    ("Planets", "planet_list", 100, "w"),
]

STAT_FIELDS = {'oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe', 'rating'}


def _safe_int(val) -> int:
    try:
        return int(val or 0)
    except (ValueError, TypeError):
        return 0


def _configure_stockpile_style():
    style = ttk.Style()
    style.theme_use("clam")

    style.configure("Stockpile.Treeview",
                     background=COLORS['bg_primary'],
                     foreground=COLORS['text_primary'],
                     fieldbackground=COLORS['bg_primary'],
                     borderwidth=0,
                     font=('Helvetica', 11),
                     rowheight=26)

    style.configure("Stockpile.Treeview.Heading",
                     background=COLORS['btn_primary'],
                     foreground=COLORS['text_hover'],
                     borderwidth=0,
                     font=('Helvetica', 10, 'bold'),
                     relief="flat")

    style.map("Stockpile.Treeview",
              background=[("selected", COLORS['border'])],
              foreground=[("selected", COLORS['text_hover'])])

    style.map("Stockpile.Treeview.Heading",
              background=[("active", COLORS['btn_primary_hover'])],
              foreground=[("active", COLORS['text_hover'])])

    style.layout("Stockpile.Treeview", [
        ("Stockpile.Treeview.treearea", {"sticky": "nswe"})
    ])


class StockpileTab(ctk.CTkFrame):
    """Resource stockpile with local SQLite cache and server sync."""

    def __init__(self, master, config_manager, api_client, local_db):
        super().__init__(master)
        self.config_manager = config_manager
        self.api_client = api_client
        self.local_db = local_db
        self._loaded = False
        self._is_loading = False
        self._stockpile_data = []
        self.sort_field = "name"
        self.sort_order = "ASC"

        self.configure(fg_color=COLORS['bg_primary'])
        _configure_stockpile_style()
        self._create_widgets()
        self.bind("<Map>", self._on_show)

    def _on_show(self, event=None):
        if not self._loaded:
            self._loaded = True
            self._load_and_sync()

    def _create_widgets(self):
        container = ctk.CTkFrame(self, fg_color=COLORS['bg_primary'])
        container.pack(fill="both", expand=True, padx=20, pady=20)

        # Title row
        title_row = ctk.CTkFrame(container, fg_color="transparent")
        title_row.pack(fill="x", pady=(0, 10))

        ctk.CTkLabel(
            title_row, text="My Stockpile", font=FONTS['title'],
            text_color=COLORS['text_hover']
        ).pack(side="left")

        ctk.CTkButton(
            title_row, text="⟳", command=self._sync_from_server,
            font=('Helvetica', 24), width=36, height=36,
            fg_color=COLORS['btn_secondary'], hover_color=COLORS['btn_secondary_hover'],
            border_width=1, border_color=COLORS['btn_secondary_border']
        ).pack(side="left", padx=(10, 0))

        self.sync_label = ctk.CTkLabel(
            title_row, text="", font=FONTS['small'],
            text_color=COLORS['text_muted']
        )
        self.sync_label.pack(side="left", padx=(10, 0))

        # Search + actions
        search_frame = ctk.CTkFrame(title_row, fg_color="transparent")
        search_frame.pack(side="right")

        self.search_entry = ctk.CTkEntry(
            search_frame, placeholder_text="Search stockpile...",
            font=FONTS['body'], height=30, width=200
        )
        self.search_entry.pack(side="left", padx=(0, 8))
        self.search_entry.bind("<Return>", lambda e: self._filter_local())

        ctk.CTkButton(
            search_frame, text="Search", command=self._filter_local,
            font=FONTS['body'], height=30, width=70,
            fg_color=COLORS['btn_primary'], hover_color=COLORS['btn_primary_hover']
        ).pack(side="left")

        # --- Treeview ---
        table_container = ctk.CTkFrame(container, fg_color=COLORS['bg_secondary'], corner_radius=8)
        table_container.pack(fill="both", expand=True, pady=(10, 0))

        tree_frame = tk.Frame(table_container, bg=COLORS['bg_primary'])
        tree_frame.pack(fill="both", expand=True, padx=2, pady=(2, 0))

        col_ids = [c[1] for c in COLUMNS]
        self.tree = ttk.Treeview(
            tree_frame, columns=col_ids, show="headings",
            style="Stockpile.Treeview", selectmode="browse"
        )

        scrollbar = ttk.Scrollbar(tree_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)

        for col_label, col_field, col_width, col_anchor in COLUMNS:
            self.tree.heading(col_field, text=col_label,
                              command=lambda f=col_field: self._sort_by(f))
            self.tree.column(col_field, width=col_width, minwidth=30, anchor=col_anchor)

        self.tree.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        self.tree.tag_configure("even", background=COLORS['bg_primary'])
        self.tree.tag_configure("odd", background=COLORS['bg_card'])
        self.tree.tag_configure("dirty", foreground=COLORS['quality_good'])

        # Double-click to edit stock
        self.tree.bind("<Double-1>", self._on_double_click)

        # Loading pill
        self._loading_pill = tk.Frame(tree_frame, bg=COLORS['bg_secondary'],
                                       highlightbackground=COLORS['border'], highlightthickness=1)
        self._loading_label = tk.Label(
            self._loading_pill, text="  Loading...  ",
            font=('Helvetica', 13, 'bold'), fg=COLORS['text_hover'],
            bg=COLORS['bg_secondary'], padx=20, pady=10
        )
        self._loading_label.pack()
        self._spinner_frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
        self._spinner_idx = 0
        self._spinner_after_id = None

        # Bottom bar
        bottom = ctk.CTkFrame(table_container, fg_color=COLORS['bg_tertiary'], height=36, corner_radius=0)
        bottom.pack(fill="x")
        bottom.pack_propagate(False)

        self.status_label = ctk.CTkLabel(
            bottom, text="", font=FONTS['small'],
            text_color=COLORS['text_muted']
        )
        self.status_label.pack(side="left", padx=10)

        # Delete button
        ctk.CTkButton(
            bottom, text="Remove Selected", command=self._remove_selected,
            font=FONTS['small'], height=24, width=120,
            fg_color=COLORS['btn_secondary'], hover_color=COLORS['accent'],
            border_width=1, border_color=COLORS['btn_secondary_border']
        ).pack(side="right", padx=10)

    # --- Loading overlay ---

    def _show_loading(self):
        self._is_loading = True
        self._loading_pill.place(relx=0.5, rely=0.4, anchor="center")
        self._loading_pill.lift()
        self.tree.configure(selectmode="none")
        self._spinner_idx = 0
        self._animate_spinner()

    def _hide_loading(self):
        self._is_loading = False
        if self._spinner_after_id:
            self.after_cancel(self._spinner_after_id)
            self._spinner_after_id = None
        self._loading_pill.place_forget()
        self.tree.configure(selectmode="browse")

    def _animate_spinner(self):
        if not self._is_loading:
            return
        frame = self._spinner_frames[self._spinner_idx % len(self._spinner_frames)]
        self._loading_label.configure(text=f"  {frame}  Loading...  ")
        self._spinner_idx += 1
        self._spinner_after_id = self.after(100, self._animate_spinner)

    # --- Data loading ---

    def _load_and_sync(self):
        """Load from local DB first (instant), then sync with server in background."""
        self._display_local()
        self._sync_from_server()

    def _display_local(self, search: str = ""):
        """Display stockpile from local SQLite cache."""
        self.tree.delete(*self.tree.get_children())
        items = self.local_db.get_stockpile(search=search)
        self._stockpile_data = items

        if not items:
            self.status_label.configure(text="Stockpile empty. Syncing with server...")
            return

        for i, item in enumerate(items):
            tag = "even" if i % 2 == 0 else "odd"
            tags = (tag,)
            if item.get('dirty'):
                tags = (tag, "dirty")
            values = self._format_item(item)
            self.tree.insert("", "end", iid=str(i), values=values, tags=tags)

        last_sync = self.local_db.get_last_sync_time()
        sync_text = ""
        if last_sync:
            sync_text = f"Last synced: {datetime.fromtimestamp(last_sync).strftime('%m/%d %I:%M %p')}"
        self.sync_label.configure(text=sync_text)
        self.status_label.configure(text=f"{len(items)} items in stockpile")

    def _format_item(self, item: dict) -> tuple:
        name = item.get('name', '')
        type_name = item.get('type_name', '')
        stock = _safe_int(item.get('stock', 0))
        oq = _safe_int(item.get('oq'))
        cr = _safe_int(item.get('cr'))
        cd = _safe_int(item.get('cd'))
        dr = _safe_int(item.get('dr'))
        hr = _safe_int(item.get('hr'))
        ma = _safe_int(item.get('ma'))
        sr = _safe_int(item.get('sr'))
        ut = _safe_int(item.get('ut'))
        fl = _safe_int(item.get('fl'))
        pe = _safe_int(item.get('pe'))
        rating = _safe_int(item.get('rating'))
        planets = item.get('planet_list', '')

        def fmt(v):
            return str(v) if v > 0 else ""

        return (name, type_name, str(stock) if stock else "0",
                fmt(oq), fmt(cr), fmt(cd), fmt(dr), fmt(hr),
                fmt(ma), fmt(sr), fmt(ut), fmt(fl), fmt(pe),
                fmt(rating), planets)

    def _filter_local(self):
        """Filter stockpile from local cache (instant, no API call)."""
        search = self.search_entry.get().strip()
        self._display_local(search=search)

    # --- Server sync ---

    def _sync_from_server(self):
        """Fetch full stockpile from API and update local cache."""
        self._show_loading()

        # First push any dirty local changes
        dirty_items = self.local_db.get_dirty_items()
        threading.Thread(
            target=self._do_sync, args=(dirty_items,), daemon=True
        ).start()

    def _do_sync(self, dirty_items):
        try:
            # Push dirty items first
            for item in dirty_items:
                sid = item['stockpile_id']
                stock = item['stock']
                success, _ = self.api_client.update_stockpile(sid, stock)
                if success:
                    self.local_db.mark_synced(sid)

            # Then pull fresh data — get all pages
            all_results = []
            page = 1
            while True:
                success, data = self.api_client.get_stockpile(page=page, perpage=500)
                if not success or not isinstance(data, dict):
                    break
                results = data.get('results', [])
                all_results.extend(results)
                if len(results) < 500:
                    break
                page += 1

            if all_results or page == 1:
                self.local_db.sync_from_api(all_results)

            self.after(0, lambda: self._on_sync_complete(True, len(all_results)))
        except Exception as e:
            logger.error(f"Stockpile sync error: {e}", exc_info=True)
            self.after(0, lambda: self._on_sync_complete(False, 0))

    def _on_sync_complete(self, success: bool, count: int):
        self._hide_loading()
        search = self.search_entry.get().strip()
        self._display_local(search=search)
        if success:
            self.status_label.configure(text=f"Synced {count} items from server")
        else:
            self.status_label.configure(text="Sync failed — showing cached data")

    # --- Edit stock ---

    def _on_double_click(self, event):
        """Double-click a row to edit the stock quantity."""
        item_id = self.tree.focus()
        if not item_id:
            return

        col = self.tree.identify_column(event.x)
        # Column #3 is "Stock"
        if col != '#3':
            return

        idx = int(item_id)
        if idx >= len(self._stockpile_data):
            return

        item = self._stockpile_data[idx]
        current_stock = _safe_int(item.get('stock', 0))
        stockpile_id = item.get('stockpile_id', 0)

        # Show inline edit
        self._show_stock_editor(item_id, stockpile_id, current_stock)

    def _show_stock_editor(self, tree_item_id: str, stockpile_id: int, current_stock: int):
        """Show a small entry widget over the stock cell for inline editing."""
        bbox = self.tree.bbox(tree_item_id, column="stock")
        if not bbox:
            return
        x, y, w, h = bbox

        entry = tk.Entry(self.tree, font=('Helvetica', 11), justify="center",
                         bg=COLORS['bg_input'], fg=COLORS['text_hover'],
                         insertbackground=COLORS['text_hover'],
                         relief="solid", bd=1)
        entry.insert(0, str(current_stock))
        entry.select_range(0, "end")
        entry.place(x=x, y=y, width=w, height=h)
        entry.focus_set()

        def _save(event=None):
            try:
                new_stock = int(entry.get())
            except ValueError:
                new_stock = current_stock
            entry.destroy()

            if new_stock != current_stock:
                # Update local DB immediately
                self.local_db.update_stock_local(stockpile_id, new_stock)
                # Refresh display
                self._display_local(search=self.search_entry.get().strip())
                # Push to server in background
                threading.Thread(
                    target=self._push_stock_update,
                    args=(stockpile_id, new_stock),
                    daemon=True
                ).start()

        def _cancel(event=None):
            entry.destroy()

        entry.bind("<Return>", _save)
        entry.bind("<Escape>", _cancel)
        entry.bind("<FocusOut>", _save)

    def _push_stock_update(self, stockpile_id: int, stock: int):
        success, _ = self.api_client.update_stockpile(stockpile_id, stock)
        if success:
            self.local_db.mark_synced(stockpile_id)
            self.after(0, lambda: self.status_label.configure(text="Stock updated"))

    # --- Remove ---

    def _remove_selected(self):
        """Remove selected item from stockpile."""
        item_id = self.tree.focus()
        if not item_id:
            return

        idx = int(item_id)
        if idx >= len(self._stockpile_data):
            return

        item = self._stockpile_data[idx]
        stockpile_id = item.get('stockpile_id', 0)
        name = item.get('name', 'Unknown')

        # Remove locally
        self.local_db.remove_local(stockpile_id)
        self._display_local(search=self.search_entry.get().strip())

        # Remove on server in background
        threading.Thread(
            target=self._push_remove,
            args=(stockpile_id, name),
            daemon=True
        ).start()

    def _push_remove(self, stockpile_id: int, name: str):
        success, _ = self.api_client.remove_from_stockpile(stockpile_id)
        if success:
            self.after(0, lambda: self.status_label.configure(text=f"Removed {name}"))
        else:
            self.after(0, lambda: self.status_label.configure(text=f"Failed to remove {name} from server"))

    # --- Sort ---

    def _sort_by(self, field: str):
        if self.sort_field == field:
            self.sort_order = "ASC" if self.sort_order == "DESC" else "DESC"
        else:
            self.sort_field = field
            self.sort_order = "DESC" if field in STAT_FIELDS else "ASC"

        # Update headers
        for col_label, col_field, _, _ in COLUMNS:
            if col_field == field:
                arrow = " ▲" if self.sort_order == "ASC" else " ▼"
                self.tree.heading(col_field, text=col_label + arrow)
            else:
                self.tree.heading(col_field, text=col_label)

        # Sort locally
        reverse = self.sort_order == "DESC"
        try:
            if field in STAT_FIELDS or field == 'stock':
                self._stockpile_data.sort(
                    key=lambda x: _safe_int(x.get(field, 0)), reverse=reverse
                )
            else:
                self._stockpile_data.sort(
                    key=lambda x: str(x.get(field, '')).lower(), reverse=reverse
                )
        except Exception:
            pass

        self.tree.delete(*self.tree.get_children())
        for i, item in enumerate(self._stockpile_data):
            tag = "even" if i % 2 == 0 else "odd"
            tags = (tag,)
            if item.get('dirty'):
                tags = (tag, "dirty")
            values = self._format_item(item)
            self.tree.insert("", "end", iid=str(i), values=values, tags=tags)
