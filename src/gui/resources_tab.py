"""
Resources tab - Browse, search, and filter active resource spawns.
"""
import tkinter as tk
from tkinter import ttk
import customtkinter as ctk
import threading
import logging
from .theme import COLORS, FONTS, PLANETS, RESOURCE_CATEGORIES, RESOURCE_STATS

logger = logging.getLogger(__name__)

# Planet columns in the API response
PLANET_MAP = [
    ('planet_corellia', 'Cor'), ('planet_dantooine', 'Dan'),
    ('planet_dathomir', 'Dat'), ('planet_endor', 'End'),
    ('planet_lok', 'Lok'), ('planet_naboo', 'Nab'),
    ('planet_rori', 'Ror'), ('planet_talus', 'Tal'),
    ('planet_tatooine', 'Tat'), ('planet_yavin4', 'Yav'),
    ('planet_kashyyyk', 'Kas'), ('planet_mustafar', 'Mus'),
]

# Treeview columns: (label, field, width, anchor)
COLUMNS = [
    ("Name", "name", 160, "w"),
    ("Type", "type_name", 170, "w"),
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
    ("Planets", "planets", 120, "w"),
]

STAT_FIELDS = {'oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe', 'rating'}


def _configure_resource_style():
    """Configure ttk Treeview style for the resources table."""
    style = ttk.Style()
    style.theme_use("clam")

    style.configure("Resources.Treeview",
                     background=COLORS['bg_primary'],
                     foreground=COLORS['text_primary'],
                     fieldbackground=COLORS['bg_primary'],
                     borderwidth=0,
                     font=('Helvetica', 11),
                     rowheight=26)

    style.configure("Resources.Treeview.Heading",
                     background=COLORS['btn_primary'],
                     foreground=COLORS['text_hover'],
                     borderwidth=0,
                     font=('Helvetica', 10, 'bold'),
                     relief="flat")

    style.map("Resources.Treeview",
              background=[("selected", COLORS['border'])],
              foreground=[("selected", COLORS['text_hover'])])

    style.map("Resources.Treeview.Heading",
              background=[("active", COLORS['btn_primary_hover'])],
              foreground=[("active", COLORS['text_hover'])])

    style.layout("Resources.Treeview", [
        ("Resources.Treeview.treearea", {"sticky": "nswe"})
    ])


def _safe_int(val) -> int:
    try:
        return int(val or 0)
    except (ValueError, TypeError):
        return 0


def _planets_str(resource: dict) -> str:
    """Build short planet string from planet_* columns."""
    parts = []
    for key, abbrev in PLANET_MAP:
        if str(resource.get(key, '0')) == '1':
            parts.append(abbrev)
    return ' '.join(parts)


class ResourcesTab(ctk.CTkFrame):
    """Resource browser tab."""

    def __init__(self, master, config_manager, api_client):
        super().__init__(master)
        self.config_manager = config_manager
        self.api_client = api_client
        self.current_resources = []
        self.current_page = 1
        self._loaded = False
        self._is_loading = False

        self.configure(fg_color=COLORS['bg_primary'])
        _configure_resource_style()
        self._create_widgets()
        self.bind("<Map>", self._on_show)

    def _create_widgets(self):
        container = ctk.CTkFrame(self, fg_color=COLORS['bg_primary'])
        container.pack(fill="both", expand=True, padx=20, pady=20)

        # Title row
        title_row = ctk.CTkFrame(container, fg_color="transparent")
        title_row.pack(fill="x", pady=(0, 10))

        ctk.CTkLabel(
            title_row, text="Resources", font=FONTS['title'],
            text_color=COLORS['text_primary']
        ).pack(side="left")

        ctk.CTkButton(
            title_row, text="⟳", command=self._do_search,
            font=('Helvetica', 24), width=36, height=36,
            fg_color=COLORS['btn_secondary'], hover_color=COLORS['btn_secondary_hover'],
            border_width=1, border_color=COLORS['btn_secondary_border']
        ).pack(side="left", padx=(10, 0))

        # Filter bar
        filter_frame = ctk.CTkFrame(container, fg_color=COLORS['bg_secondary'], corner_radius=8)
        filter_frame.pack(fill="x", pady=(0, 10))

        filter_inner = ctk.CTkFrame(filter_frame, fg_color="transparent")
        filter_inner.pack(fill="x", padx=15, pady=12)

        self.search_entry = ctk.CTkEntry(
            filter_inner, placeholder_text="Search resources...",
            font=FONTS['body'], height=32, width=200
        )
        self.search_entry.pack(side="left", padx=(0, 10))
        self.search_entry.bind("<Return>", lambda e: self._do_search())

        self.planet_var = ctk.StringVar(value="All Planets")
        ctk.CTkOptionMenu(
            filter_inner, variable=self.planet_var,
            values=["All Planets"] + PLANETS,
            font=FONTS['body'], height=32, width=140,
            fg_color=COLORS['bg_tertiary'], button_color=COLORS['border'],
            dropdown_fg_color=COLORS['bg_secondary']
        ).pack(side="left", padx=(0, 10))

        self.category_var = ctk.StringVar(value="All")
        ctk.CTkOptionMenu(
            filter_inner, variable=self.category_var,
            values=RESOURCE_CATEGORIES,
            font=FONTS['body'], height=32, width=140,
            fg_color=COLORS['bg_tertiary'], button_color=COLORS['border'],
            dropdown_fg_color=COLORS['bg_secondary']
        ).pack(side="left", padx=(0, 10))

        ctk.CTkButton(
            filter_inner, text="Search", command=self._do_search,
            font=FONTS['body'], height=32, width=80,
            fg_color=COLORS['btn_primary'], hover_color=COLORS['btn_primary_hover']
        ).pack(side="left", padx=(0, 10))

        self.pinned_only_var = ctk.BooleanVar(value=False)
        ctk.CTkSwitch(
            filter_inner, text="Pinned Only",
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
            style="Resources.Treeview", selectmode="browse"
        )

        scrollbar = ttk.Scrollbar(tree_frame, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)

        for col_label, col_field, col_width, col_anchor in COLUMNS:
            self.tree.heading(col_field, text=col_label)
            self.tree.column(col_field, width=col_width, minwidth=30, anchor=col_anchor)

        self.tree.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        self.tree.tag_configure("even", background=COLORS['bg_primary'])
        self.tree.tag_configure("odd", background=COLORS['bg_card'])

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

        # Pagination bar
        page_frame = ctk.CTkFrame(table_container, fg_color=COLORS['bg_tertiary'],
                                  height=36, corner_radius=0)
        page_frame.pack(fill="x")
        page_frame.pack_propagate(False)

        self.status_label = ctk.CTkLabel(
            page_frame, text="", font=FONTS['small'],
            text_color=COLORS['text_muted']
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

    def _on_show(self, event=None):
        if not self._loaded:
            self._loaded = True
            self._do_search()

    def load_initial(self):
        if not self._loaded:
            self._loaded = True
            self._do_search()

    def _do_search(self):
        self._show_loading()

        query = self.search_entry.get().strip()
        planet = self.planet_var.get()
        category = self.category_var.get()
        page = self.current_page

        if planet == "All Planets":
            planet = ""
        if category == "All":
            category = ""

        threading.Thread(
            target=self._fetch_resources,
            args=(query, planet, category, page),
            daemon=True
        ).start()

    def _fetch_resources(self, query, planet, category, page):
        try:
            success, data = self.api_client.search_resources(
                search=query, planet=planet, category=category, page=page
            )
            self.after(0, lambda: self._display_results(success, data))
        except Exception as e:
            logger.error(f"Error fetching resources: {e}", exc_info=True)
            self.after(0, lambda: self._on_fetch_error(str(e)))

    def _on_fetch_error(self, msg):
        self._hide_loading()
        self.status_label.configure(text=f"Error: {msg}")

    def _display_results(self, success: bool, data):
        self._hide_loading()
        self.tree.delete(*self.tree.get_children())

        if not success:
            self.status_label.configure(
                text=f"Error: {data}" if isinstance(data, str) else "Failed to load resources."
            )
            return

        if isinstance(data, dict):
            resources = data.get('results', data.get('resources', []))
            total = data.get('total_results', data.get('total', len(resources)))
            total_pages = data.get('total_pages', 1)
            page = data.get('page', 1)
        elif isinstance(data, list):
            resources = data
            total = len(resources)
            total_pages = 1
            page = 1
        else:
            self.status_label.configure(text="Unexpected response format.")
            return

        # Filter pinned only
        pinned_ids = self.config_manager.get_pinned_resources()
        if self.pinned_only_var.get():
            resources = [r for r in resources if r.get('id', '') in pinned_ids]

        if not resources:
            self.status_label.configure(text="No resources found.")
            return

        self.current_resources = resources

        for i, res in enumerate(resources):
            tag = "even" if i % 2 == 0 else "odd"
            values = self._format_resource(res)
            self.tree.insert("", "end", values=values, tags=(tag,))

        self.status_label.configure(
            text=f"Page {page} of {total_pages} — {total:,} total resources"
        )
        self.prev_btn.configure(state="normal" if page > 1 else "disabled")
        self.next_btn.configure(state="normal" if page < total_pages else "disabled")

    def _format_resource(self, res: dict) -> tuple:
        """Format a resource dict into treeview display values."""
        name = res.get('name', '')
        type_name = res.get('type_name', '')
        oq = _safe_int(res.get('oq'))
        cr = _safe_int(res.get('cr'))
        cd = _safe_int(res.get('cd'))
        dr = _safe_int(res.get('dr'))
        hr = _safe_int(res.get('hr'))
        ma = _safe_int(res.get('ma'))
        sr = _safe_int(res.get('sr'))
        ut = _safe_int(res.get('ut'))
        fl = _safe_int(res.get('fl'))
        pe = _safe_int(res.get('pe'))
        rating = _safe_int(res.get('rating'))
        planets = _planets_str(res)

        # Show 0 stats as empty for cleaner look
        def fmt(v):
            return str(v) if v > 0 else ""

        return (name, type_name,
                fmt(oq), fmt(cr), fmt(cd), fmt(dr), fmt(hr),
                fmt(ma), fmt(sr), fmt(ut), fmt(fl), fmt(pe),
                fmt(rating), planets)

    def _toggle_pin(self, resource_id: str):
        self.config_manager.toggle_pinned_resource(resource_id)
        self._do_search()

    def _prev_page(self):
        if self.current_page > 1:
            self.current_page -= 1
            self._do_search()

    def _next_page(self):
        self.current_page += 1
        self._do_search()
