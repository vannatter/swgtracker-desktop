"""
Sales tab - View sales history with summary stats, matching the portal/sales.php layout.
"""
from __future__ import annotations

import tkinter as tk
from tkinter import ttk
import customtkinter as ctk
import threading
import logging
from datetime import datetime
from .theme import COLORS, FONTS

logger = logging.getLogger(__name__)

# Column definitions: (display_label, field_key, width, anchor)
COLUMNS = [
    ("Item", "item", 220, "w"),
    ("Type", "sale_type", 70, "center"),
    ("Buyer", "buyer", 140, "w"),
    ("Vendor", "vendor", 140, "w"),
    ("Location", "location", 160, "w"),
    ("Amount", "sale_amount", 100, "e"),
    ("Date", "sale_timestamp", 140, "w"),
]


def _configure_table_style():
    """Configure ttk Treeview style to match the dark theme."""
    style = ttk.Style()
    style.theme_use("clam")

    style.configure("Sales.Treeview",
                     background=COLORS['bg_primary'],
                     foreground=COLORS['text_primary'],
                     fieldbackground=COLORS['bg_primary'],
                     borderwidth=0,
                     font=('Helvetica', 11),
                     rowheight=28)

    style.configure("Sales.Treeview.Heading",
                     background=COLORS['btn_primary'],
                     foreground=COLORS['text_hover'],
                     borderwidth=0,
                     font=('Helvetica', 11, 'bold'),
                     relief="flat")

    style.map("Sales.Treeview",
              background=[("selected", COLORS['border'])],
              foreground=[("selected", COLORS['text_hover'])])

    style.map("Sales.Treeview.Heading",
              background=[("active", COLORS['btn_primary_hover'])],
              foreground=[("active", COLORS['text_hover'])])

    # Remove the borders around the treeview
    style.layout("Sales.Treeview", [
        ("Sales.Treeview.treearea", {"sticky": "nswe"})
    ])


class SalesTab(ctk.CTkFrame):
    """Sales dashboard with summary cards and transaction table."""

    def __init__(self, master, config_manager, api_client):
        super().__init__(master)
        self.config_manager = config_manager
        self.api_client = api_client
        self.current_page = 1
        self.sort_field = "sale_timestamp"
        self.sort_order = "DESC"

        self._loaded = False
        self._is_loading = False

        self.configure(fg_color=COLORS['bg_primary'])
        _configure_table_style()
        self._create_widgets()
        self.bind("<Map>", self._on_show)

    def _on_show(self, event=None):
        """Fetch data when tab is first shown."""
        if not self._loaded:
            self._loaded = True
            self._fetch_data()

    def _create_widgets(self):
        container = ctk.CTkFrame(self, fg_color=COLORS['bg_primary'])
        container.pack(fill="both", expand=True, padx=20, pady=20)

        # Title row
        title_row = ctk.CTkFrame(container, fg_color="transparent")
        title_row.pack(fill="x", pady=(0, 15))

        ctk.CTkLabel(
            title_row, text="My Sales", font=FONTS['title'],
            text_color=COLORS['text_hover']
        ).pack(side="left")

        self.refresh_btn = ctk.CTkButton(
            title_row, text="⟳", command=self._reset_and_fetch,
            font=('Helvetica', 24), width=36, height=36,
            fg_color=COLORS['btn_secondary'], hover_color=COLORS['btn_secondary_hover'],
            border_width=1, border_color=COLORS['btn_secondary_border']
        )
        self.refresh_btn.pack(side="left", padx=(10, 0))

        # Search bar
        search_frame = ctk.CTkFrame(title_row, fg_color="transparent")
        search_frame.pack(side="right")

        self.search_entry = ctk.CTkEntry(
            search_frame, placeholder_text="Search item, buyer, vendor...",
            font=FONTS['body'], height=30, width=250
        )
        self.search_entry.pack(side="left", padx=(0, 8))
        self.search_entry.bind("<Return>", lambda e: self._do_search())

        self.sale_type_var = ctk.StringVar(value="All Types")
        ctk.CTkOptionMenu(
            search_frame, variable=self.sale_type_var,
            values=["All Types", "Vendor", "Bazaar"],
            font=FONTS['body'], height=30, width=110,
            fg_color=COLORS['bg_input'], button_color=COLORS['border'],
            dropdown_fg_color=COLORS['bg_secondary'],
            command=lambda _: self._do_search()
        ).pack(side="left", padx=(0, 8))

        ctk.CTkButton(
            search_frame, text="Search", command=self._do_search,
            font=FONTS['body'], height=30, width=70,
            fg_color=COLORS['btn_primary'], hover_color=COLORS['btn_primary_hover']
        ).pack(side="left")

        # --- Summary Cards ---
        self.cards_frame = ctk.CTkFrame(container, fg_color="transparent")
        self.cards_frame.pack(fill="x", pady=(0, 15))

        self.summary_cards = {}
        periods = [
            ("7 Day", "7_day"),
            ("30 Day", "30_day"),
            ("90 Day", "90_day"),
            ("180 Day", "180_day"),
        ]
        for label, key in periods:
            card = self._create_summary_card(self.cards_frame, label)
            card.pack(side="left", expand=True, fill="both", padx=(0, 8))
            self.summary_cards[key] = card

        # --- Sales Table (Treeview) ---
        table_container = ctk.CTkFrame(container, fg_color=COLORS['bg_secondary'], corner_radius=8)
        table_container.pack(fill="both", expand=True)

        # Treeview + scrollbar inside a container that supports overlay
        self.tree_wrapper = tk.Frame(table_container, bg=COLORS['bg_primary'])
        self.tree_wrapper.pack(fill="both", expand=True, padx=2, pady=(2, 0))

        col_ids = [c[1] for c in COLUMNS]
        self.tree = ttk.Treeview(
            self.tree_wrapper, columns=col_ids, show="headings",
            style="Sales.Treeview", selectmode="browse"
        )

        scrollbar = ttk.Scrollbar(self.tree_wrapper, orient="vertical", command=self.tree.yview)
        self.tree.configure(yscrollcommand=scrollbar.set)

        for col_label, col_field, col_width, col_anchor in COLUMNS:
            self.tree.heading(col_field, text=col_label,
                              command=lambda f=col_field: self._sort_by(f))
            self.tree.column(col_field, width=col_width, minwidth=50, anchor=col_anchor)

        self.tree.pack(side="left", fill="both", expand=True)
        scrollbar.pack(side="right", fill="y")

        # Loading pill — small centered indicator, data stays visible
        self._loading_pill = tk.Frame(
            self.tree_wrapper, bg=COLORS['bg_secondary'],
            highlightbackground=COLORS['border'], highlightthickness=1
        )
        self._loading_label = tk.Label(
            self._loading_pill, text="  Loading...  ",
            font=('Helvetica', 13, 'bold'), fg=COLORS['text_hover'],
            bg=COLORS['bg_secondary'], padx=20, pady=10
        )
        self._loading_label.pack()

        self._spinner_frames = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]
        self._spinner_idx = 0
        self._spinner_after_id = None

        # Alternating row colors
        self.tree.tag_configure("even", background=COLORS['bg_primary'])
        self.tree.tag_configure("odd", background=COLORS['bg_card'])

        # Pagination
        page_frame = ctk.CTkFrame(table_container, fg_color=COLORS['bg_tertiary'],
                                  height=36, corner_radius=0)
        page_frame.pack(fill="x")
        page_frame.pack_propagate(False)

        self.page_label = ctk.CTkLabel(
            page_frame, text="", font=FONTS['small'],
            text_color=COLORS['text_muted']
        )
        self.page_label.pack(side="left", padx=10)

        nav = ctk.CTkFrame(page_frame, fg_color="transparent")
        nav.pack(side="right", padx=10)

        self.prev_btn = ctk.CTkButton(
            nav, text="< Prev", width=60, height=24, font=FONTS['small'],
            fg_color=COLORS['btn_secondary'], hover_color=COLORS['btn_secondary_hover'],
            border_width=1, border_color=COLORS['btn_secondary_border'],
            command=self._prev_page, state="disabled"
        )
        self.prev_btn.pack(side="left", padx=(0, 5))

        self.next_btn = ctk.CTkButton(
            nav, text="Next >", width=60, height=24, font=FONTS['small'],
            fg_color=COLORS['btn_secondary'], hover_color=COLORS['btn_secondary_hover'],
            border_width=1, border_color=COLORS['btn_secondary_border'],
            command=self._next_page, state="disabled"
        )
        self.next_btn.pack(side="left")

    def _create_summary_card(self, parent, period_label: str) -> ctk.CTkFrame:
        """Create a summary stat card matching the portal layout."""
        card = ctk.CTkFrame(parent, fg_color=COLORS['bg_secondary'], corner_radius=8)

        inner = ctk.CTkFrame(card, fg_color="transparent")
        inner.pack(padx=12, pady=10)

        avg_value = ctk.CTkLabel(
            inner, text="--", font=('Helvetica', 26, 'bold'),
            text_color=COLORS['accent']
        )
        avg_value.pack()
        card._avg_label = avg_value

        ctk.CTkLabel(
            inner, text=f"{period_label} avg / sale",
            font=FONTS['stat_label'], text_color=COLORS['text_muted']
        ).pack()

        total_value = ctk.CTkLabel(
            inner, text="--", font=('Helvetica', 14, 'bold'),
            text_color=COLORS['text_primary']
        )
        total_value.pack(pady=(8, 0))
        card._total_label = total_value

        ctk.CTkLabel(
            inner, text=f"{period_label} total",
            font=FONTS['stat_label'], text_color=COLORS['text_muted']
        ).pack()

        return card

    def _reset_and_fetch(self):
        """Reset all filters, sort, and pagination to defaults."""
        self.current_page = 1
        self.sort_field = "sale_timestamp"
        self.sort_order = "DESC"
        self.search_entry.delete(0, "end")
        self.sale_type_var.set("All Types")
        self._update_sort_headers()
        self._fetch_data()

    def _do_search(self):
        self.current_page = 1
        self._fetch_data()

    def _fetch_data(self):
        self._show_loading()

        # Read UI values on main thread
        query = self.search_entry.get().strip()
        sale_type_raw = self.sale_type_var.get()
        sale_type = ""
        if sale_type_raw == "Vendor":
            sale_type = "1"
        elif sale_type_raw == "Bazaar":
            sale_type = "2"

        args = (query, sale_type, self.current_page, self.sort_field, self.sort_order)
        threading.Thread(target=self._fetch_sales, args=args, daemon=True).start()

    def _fetch_sales(self, query, sale_type, page, sort_field, sort_order):
        success, data = self.api_client.get_sales(
            search=query, sale_type=sale_type,
            page=page, sort=sort_field, order=sort_order
        )
        self.after(0, lambda: self._display_results(success, data))

    def _display_results(self, success: bool, data):
        self._hide_loading()
        # Clear existing rows
        self.tree.delete(*self.tree.get_children())

        if not success:
            self.page_label.configure(
                text=f"Error: {data}" if isinstance(data, str) else "Failed to load sales."
            )
            return

        if not isinstance(data, dict):
            self.page_label.configure(text="Unexpected response format.")
            return

        # Update summary cards
        summaries = data.get('summaries', {})
        for key, card in self.summary_cards.items():
            period_data = summaries.get(key, {})
            avg = period_data.get('average', 0)
            total = period_data.get('total', 0)
            card._avg_label.configure(text=f"{avg:,}")
            card._total_label.configure(text=f"{total:,}")

        sales = data.get('results', [])

        if not sales:
            self.page_label.configure(text="No sales found.")
            return

        page = data.get('page', 1)
        total_results = data.get('total_results', data.get('total', len(sales)))
        total_pages = data.get('total_pages', 1)

        self.page_label.configure(
            text=f"Page {page} of {total_pages} — {total_results:,} total sales"
        )
        self.prev_btn.configure(state="normal" if page > 1 else "disabled")
        self.next_btn.configure(state="normal" if page < total_pages else "disabled")

        # Insert rows into the treeview
        for i, sale in enumerate(sales):
            tag = "even" if i % 2 == 0 else "odd"
            values = self._format_sale_values(sale)
            self.tree.insert("", "end", values=values, tags=(tag,))

    def _format_sale_values(self, sale: dict) -> tuple:
        """Format a sale dict into a tuple of display values for the treeview."""
        item = sale.get('item', '')

        sale_type = sale.get('sale_type', '')
        type_text = "Vendor" if str(sale_type) == "1" else \
                    "Bazaar" if str(sale_type) == "2" else str(sale_type)

        buyer = sale.get('buyer', '')
        vendor = sale.get('vendor', '')
        location = sale.get('location', '')

        amount = sale.get('sale_amount', 0)
        try:
            amount_text = f"{int(amount):,}"
        except (ValueError, TypeError):
            amount_text = str(amount)

        timestamp = sale.get('sale_timestamp', 0)
        try:
            date_text = datetime.fromtimestamp(int(timestamp)).strftime("%m/%d/%y %I:%M %p")
        except (ValueError, TypeError, OSError):
            date_text = str(timestamp)

        return (item, type_text, buyer, vendor, location, amount_text, date_text)

    def _show_loading(self):
        """Show loading pill centered over the table, disable tree interaction."""
        self._is_loading = True
        self._loading_pill.place(relx=0.5, rely=0.4, anchor="center")
        self._loading_pill.lift()
        # Disable tree so clicks/scrolls are ignored
        self.tree.configure(selectmode="none")
        self.tree.unbind("<ButtonRelease-1>")
        self._spinner_idx = 0
        self._animate_spinner()

    def _hide_loading(self):
        """Hide the loading pill, re-enable tree."""
        self._is_loading = False
        if self._spinner_after_id:
            self.after_cancel(self._spinner_after_id)
            self._spinner_after_id = None
        self._loading_pill.place_forget()
        self.tree.configure(selectmode="browse")

    def _animate_spinner(self):
        """Cycle through braille spinner frames."""
        if not self._is_loading:
            return
        frame = self._spinner_frames[self._spinner_idx % len(self._spinner_frames)]
        self._loading_label.configure(text=f"  {frame}  Loading...  ")
        self._spinner_idx += 1
        self._spinner_after_id = self.after(100, self._animate_spinner)

    def _sort_by(self, field: str):
        if self.sort_field == field:
            self.sort_order = "ASC" if self.sort_order == "DESC" else "DESC"
        else:
            self.sort_field = field
            self.sort_order = "DESC"

        self._update_sort_headers()
        self._fetch_data()

    def _update_sort_headers(self):
        """Show sort arrow on the active column header."""
        for col_label, col_field, _, _ in COLUMNS:
            if col_field == self.sort_field:
                arrow = " ▲" if self.sort_order == "ASC" else " ▼"
                self.tree.heading(col_field, text=col_label + arrow)
            else:
                self.tree.heading(col_field, text=col_label)

    def _prev_page(self):
        if self.current_page > 1:
            self.current_page -= 1
            self._fetch_data()

    def _next_page(self):
        self.current_page += 1
        self._fetch_data()
