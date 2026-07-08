"""
Schematics tab - Browse and pin schematics, view best available resources.
"""
import tkinter as tk
from tkinter import ttk
import customtkinter as ctk
import threading
import logging
from .theme import COLORS, FONTS

logger = logging.getLogger(__name__)

# Treeview columns: (label, field, width, anchor)
COLUMNS = [
    ("Name", "name", 350, "w"),
    ("Category", "parent", 200, "w"),
    ("Base", "base", 100, "center"),
]


def _safe_int(val) -> int:
    try:
        return int(val or 0)
    except (ValueError, TypeError):
        return 0


def _configure_schematic_style():
    """Configure ttk Treeview style for the schematics table."""
    style = ttk.Style()
    style.theme_use("clam")

    style.configure("Schematics.Treeview",
                     background=COLORS['bg_primary'],
                     foreground=COLORS['text_primary'],
                     fieldbackground=COLORS['bg_primary'],
                     borderwidth=0,
                     font=('Helvetica', 11),
                     rowheight=26)

    style.configure("Schematics.Treeview.Heading",
                     background=COLORS['btn_primary'],
                     foreground=COLORS['text_hover'],
                     borderwidth=0,
                     font=('Helvetica', 11, 'bold'),
                     relief="flat")

    style.map("Schematics.Treeview",
              background=[("selected", COLORS['border'])],
              foreground=[("selected", COLORS['text_hover'])])

    style.map("Schematics.Treeview.Heading",
              background=[("active", COLORS['btn_primary_hover'])],
              foreground=[("active", COLORS['text_hover'])])

    style.layout("Schematics.Treeview", [
        ("Schematics.Treeview.treearea", {"sticky": "nswe"})
    ])


class SchematicsTab(ctk.CTkFrame):
    """Schematic browser and tracking tab."""

    def __init__(self, master, config_manager, api_client):
        super().__init__(master)
        self.config_manager = config_manager
        self.api_client = api_client
        self.current_page = 1
        self._loaded = False
        self._is_loading = False
        self._schematics_data = []  # keep raw data for detail lookup

        self.configure(fg_color=COLORS['bg_primary'])
        _configure_schematic_style()
        self._create_widgets()
        self.bind("<Map>", self._on_show)

    def _on_show(self, event=None):
        if not self._loaded:
            self._loaded = True
            self._do_search()

    def _create_widgets(self):
        container = ctk.CTkFrame(self, fg_color=COLORS['bg_primary'])
        container.pack(fill="both", expand=True, padx=20, pady=20)

        # Title row
        title_row = ctk.CTkFrame(container, fg_color="transparent")
        title_row.pack(fill="x", pady=(0, 5))

        ctk.CTkLabel(
            title_row, text="Schematics", font=FONTS['title'],
            text_color=COLORS['text_primary']
        ).pack(side="left")

        ctk.CTkButton(
            title_row, text="⟳", command=self._do_search,
            font=('Helvetica', 24), width=36, height=36,
            fg_color=COLORS['btn_secondary'], hover_color=COLORS['btn_secondary_hover'],
            border_width=1, border_color=COLORS['btn_secondary_border']
        ).pack(side="left", padx=(10, 0))

        ctk.CTkLabel(
            container, text="Pin schematics to track the best available resources for crafting.",
            font=FONTS['small'], text_color=COLORS['text_muted']
        ).pack(anchor="w", pady=(0, 10))

        # Search bar
        search_frame = ctk.CTkFrame(container, fg_color=COLORS['bg_secondary'], corner_radius=8)
        search_frame.pack(fill="x", pady=(0, 10))

        search_inner = ctk.CTkFrame(search_frame, fg_color="transparent")
        search_inner.pack(fill="x", padx=15, pady=12)

        self.search_entry = ctk.CTkEntry(
            search_inner, placeholder_text="Search schematics...",
            font=FONTS['body'], height=32, width=300
        )
        self.search_entry.pack(side="left", padx=(0, 10))
        self.search_entry.bind("<Return>", lambda e: self._do_search())

        ctk.CTkButton(
            search_inner, text="Search", command=self._do_search,
            font=FONTS['body'], height=32, width=80,
            fg_color=COLORS['btn_primary'], hover_color=COLORS['btn_primary_hover']
        ).pack(side="left", padx=(0, 10))

        self.pinned_only_var = ctk.BooleanVar(value=False)
        ctk.CTkSwitch(
            search_inner, text="Pinned Only",
            variable=self.pinned_only_var, font=FONTS['body'],
            progress_color=COLORS['btn_primary'],
            command=self._do_search
        ).pack(side="right")

        # --- Treeview table ---
        table_container = ctk.CTkFrame(container, fg_color=COLORS['bg_secondary'], corner_radius=8)
        table_container.pack(fill="both", expand=True, pady=(0, 10))

        tree_frame = tk.Frame(table_container, bg=COLORS['bg_primary'])
        tree_frame.pack(fill="both", expand=True, padx=2, pady=(2, 0))

        col_ids = [c[1] for c in COLUMNS]
        self.tree = ttk.Treeview(
            tree_frame, columns=col_ids, show="headings",
            style="Schematics.Treeview", selectmode="browse"
        )

        scrollbar = ttk.Scrollbar(tree_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)

        for col_label, col_field, col_width, col_anchor in COLUMNS:
            self.tree.heading(col_field, text=col_label)
            self.tree.column(col_field, width=col_width, minwidth=40, anchor=col_anchor)

        self.tree.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        self.tree.tag_configure("even", background=COLORS['bg_primary'])
        self.tree.tag_configure("odd", background=COLORS['bg_card'])

        # Double-click to view detail
        self.tree.bind("<Double-1>", self._on_tree_double_click)

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

        # Detail panel (shown below table on double-click)
        self.detail_frame = ctk.CTkFrame(container, fg_color=COLORS['bg_secondary'], corner_radius=8)

        self.detail_title = ctk.CTkLabel(
            self.detail_frame, text="", font=FONTS['heading'],
            text_color=COLORS['text_primary']
        )
        self.detail_title.pack(anchor="w", padx=15, pady=(12, 5))

        self.detail_content = ctk.CTkFrame(self.detail_frame, fg_color="transparent")
        self.detail_content.pack(fill="x", padx=15, pady=(0, 12))

        # Pagination bar
        page_frame = ctk.CTkFrame(table_container, fg_color=COLORS['bg_tertiary'],
                                  height=36, corner_radius=0)
        page_frame.pack(fill="x")
        page_frame.pack_propagate(False)

        self.status_label = ctk.CTkLabel(
            page_frame, text="Search for schematics or toggle 'Pinned Only'.",
            font=FONTS['small'], text_color=COLORS['text_muted']
        )
        self.status_label.pack(side="left", padx=10)

        nav_frame = ctk.CTkFrame(page_frame, fg_color="transparent")
        nav_frame.pack(side="right", padx=10)

        self.prev_btn = ctk.CTkButton(
            nav_frame, text="< Prev", width=60, height=28, font=FONTS['small'],
            fg_color=COLORS['btn_secondary'], hover_color=COLORS['btn_secondary_hover'],
            border_width=1, border_color=COLORS['btn_secondary_border'],
            command=self._prev_page, state="disabled"
        )
        self.prev_btn.pack(side="left", padx=(0, 5))

        self.next_btn = ctk.CTkButton(
            nav_frame, text="Next >", width=60, height=28, font=FONTS['small'],
            fg_color=COLORS['btn_secondary'], hover_color=COLORS['btn_secondary_hover'],
            border_width=1, border_color=COLORS['btn_secondary_border'],
            command=self._next_page, state="disabled"
        )
        self.next_btn.pack(side="left")

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

    # --- Data fetching ---

    def _do_search(self):
        self._show_loading()
        query = self.search_entry.get().strip()
        page = self.current_page
        pinned_only = self.pinned_only_var.get()
        threading.Thread(
            target=self._fetch_schematics, args=(query, page, pinned_only), daemon=True
        ).start()

    def _fetch_schematics(self, query, page, pinned_only):
        try:
            success, data = self.api_client.search_schematics(search=query, page=page)
            self.after(0, lambda: self._display_results(success, data, pinned_only))
        except Exception as e:
            logger.error(f"Error fetching schematics: {e}", exc_info=True)
            self.after(0, lambda: self._on_fetch_error(str(e)))

    def _on_fetch_error(self, msg):
        self._hide_loading()
        self.status_label.configure(text=f"Error: {msg}")

    def _display_results(self, success: bool, data, pinned_only: bool):
        self._hide_loading()
        self.tree.delete(*self.tree.get_children())
        self.detail_frame.pack_forget()

        if not success:
            self.status_label.configure(
                text=f"Error: {data}" if isinstance(data, str) else "Failed to load schematics."
            )
            return

        if isinstance(data, dict):
            schematics = data.get('results', data.get('schematics', []))
            total = data.get('total_results', data.get('total', len(schematics)))
            total_pages = data.get('total_pages', 1)
            page = data.get('page', 1)
        elif isinstance(data, list):
            schematics = data
            total = len(schematics)
            total_pages = 1
            page = 1
        else:
            self.status_label.configure(text="Unexpected response format.")
            return

        pinned_ids = self.config_manager.get_pinned_schematics()
        if pinned_only:
            schematics = [s for s in schematics if str(s.get('id', '')) in pinned_ids]

        if not schematics:
            self.status_label.configure(text="No schematics found.")
            return

        # Sort by most popular (views) descending
        schematics.sort(key=lambda s: _safe_int(s.get('viewed', 0)), reverse=True)

        self._schematics_data = schematics

        for i, schem in enumerate(schematics):
            tag = "even" if i % 2 == 0 else "odd"
            values = self._format_schematic(schem)
            self.tree.insert("", "end", iid=str(i), values=values, tags=(tag,))

        self.status_label.configure(
            text=f"Page {page} of {total_pages} — {total:,} total schematics"
        )
        self.prev_btn.configure(state="normal" if page > 1 else "disabled")
        self.next_btn.configure(state="normal" if page < total_pages else "disabled")

    def _format_schematic(self, schem: dict) -> tuple:
        """Format a schematic dict into treeview display values."""
        name = schem.get('name', '')
        parent = schem.get('parent', '')
        base = (schem.get('base', '') or '').upper()

        return (name, parent, base)

    # --- Detail view ---

    def _on_tree_double_click(self, event):
        selection = self.tree.selection()
        if not selection:
            return
        idx = int(selection[0])
        if idx < len(self._schematics_data):
            schem = self._schematics_data[idx]
            schem_id = str(schem.get('id', schem.get('schematic_id', '')))
            if schem_id:
                self._view_detail(schem_id)

    def _view_detail(self, schematic_id: str):
        self.detail_title.configure(text="Loading...")
        self.detail_frame.pack(fill="x", pady=(10, 0))
        threading.Thread(
            target=self._fetch_detail, args=(schematic_id,), daemon=True
        ).start()

    def _fetch_detail(self, schematic_id: str):
        success, data = self.api_client.get_schematic(schematic_id)
        self.after(0, lambda: self._display_detail(success, data))

    def _display_detail(self, success: bool, data):
        for widget in self.detail_content.winfo_children():
            widget.destroy()

        if not success or not isinstance(data, dict):
            self.detail_title.configure(text="Failed to load details")
            return

        self.detail_title.configure(text=data.get('name', 'Schematic'))

        best_resources = data.get('best_resources', [])
        if best_resources:
            for res in best_resources:
                res_frame = ctk.CTkFrame(self.detail_content, fg_color=COLORS['bg_tertiary'], corner_radius=4)
                res_frame.pack(fill="x", pady=2)

                inner = ctk.CTkFrame(res_frame, fg_color="transparent")
                inner.pack(fill="x", padx=10, pady=6)

                slot = res.get('slot', 'Unknown')
                name = res.get('resource_name', 'None available')
                score = _safe_int(res.get('score', 0))

                ctk.CTkLabel(
                    inner, text=f"{slot}:", font=FONTS['body'],
                    text_color=COLORS['text_muted'], width=120, anchor="w"
                ).pack(side="left")

                ctk.CTkLabel(
                    inner, text=name, font=FONTS['body'],
                    text_color=COLORS['text_primary']
                ).pack(side="left", padx=(0, 10))

                score_color = COLORS['quality_great'] if score >= 800 else (
                    COLORS['quality_good'] if score >= 600 else COLORS['quality_better']
                )
                ctk.CTkLabel(
                    inner, text=f"{score}", font=FONTS['stat_value'],
                    text_color=score_color
                ).pack(side="right")
        else:
            ctk.CTkLabel(
                self.detail_content,
                text="No resource data available for this schematic.",
                font=FONTS['small'], text_color=COLORS['text_muted']
            ).pack(pady=5)

    # --- Pin / pagination ---

    def _toggle_pin(self, schematic_id: str):
        self.config_manager.toggle_pinned_schematic(schematic_id)
        self._do_search()

    def _prev_page(self):
        if self.current_page > 1:
            self.current_page -= 1
            self._do_search()

    def _next_page(self):
        self.current_page += 1
        self._do_search()
