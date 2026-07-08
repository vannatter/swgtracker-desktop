"""
Theme configuration matching swgtracker.com
"""

# Color palette - exact match to swgtracker.com
COLORS = {
    # Backgrounds
    'bg_primary': '#14161d',       # Body background (dark navy/charcoal)
    'bg_secondary': '#20222F',     # Header/bars/cards
    'bg_tertiary': '#091211',      # Sidebar, table headers (near-black green tint)
    'bg_card': '#20232d',          # Card highlight / slightly lighter
    'bg_input': '#323546',         # Input field backgrounds
    'border': '#2f3442',           # Borders, selected rows (dark steel blue)

    # Accent
    'accent': '#e24350',           # Primary brand color (coral red)
    'accent_hover': '#e35965',     # Lighter coral hover
    'accent_dark': '#D8404E',      # Darker red
    'accent_darkest': '#AF3846',   # Darkest muted red
    'accent_green': '#4b7967',     # Positive status indicator (muted green)

    # Buttons
    'btn_primary': '#AF3846',      # Primary action (save, search, start, add)
    'btn_primary_hover': '#D8404E',
    'btn_secondary': '#20222F',    # Secondary (stop, cancel, test, clear)
    'btn_secondary_hover': '#2b2e3e',
    'btn_secondary_border': '#2e3142',

    # Text
    'text_primary': '#cccccc',     # Primary text (light grey)
    'text_hover': '#eeeeee',       # Hover text (near white)
    'text_muted': '#777777',       # Muted/disabled
    'text_dark': '#333333',        # Very dark text

    # Status
    'success': '#4b7967',          # Positive/success (muted green)
    'error': '#D8404E',            # Error (red accent)
    'info': '#2e6ae2',             # Info blue
    'warning': '#e24350',          # Warning (coral)

    # Resource stat quality colors (matching swgtracker.com exactly)
    'quality_great': '#fe614f',    # Red-orange (best)
    'quality_good': '#ffff6e',     # Yellow
    'quality_fair': '#88fba5',     # Green
    'quality_better': '#2e6ae2',   # Blue
    'quality_ok': '#cccccc',       # Grey
    'quality_poor': '#777777',     # Dark grey
    'quality_blank': '#333333',    # Near invisible

    # GCW
    'imperial': '#e24350',
    'rebel': '#374392',

    # Active resource highlight
    'row_active': '#1b3129',       # Dark green tint
    'row_pinned': '#2c3144',       # Dark navy highlight
}

# Planet badge colors (background, text)
PLANET_COLORS = {
    'Corellia': ('#2190ac', '#000'),
    'Dantooine': ('#6a006a', '#ccc'),
    'Dathomir': ('#8f5120', '#ccc'),
    'Endor': ('#6f9975', '#000'),
    'Kashyyyk': ('#146e54', '#ccc'),
    'Lok': ('#a84909', '#ccc'),
    'Mustafar': ('#67120d', '#ccc'),
    'Naboo': ('#415c71', '#ccc'),
    'Rori': ('#827660', '#000'),
    'Tatooine': ('#e0c37b', '#000'),
    'Yavin IV': ('#71bb9a', '#000'),
}

# Font settings - system font stack matching Bootstrap/swgtracker.com
FONTS = {
    'title': ('Helvetica', 15, 'bold'),
    'heading': ('Helvetica', 13, 'bold'),
    'body': ('Helvetica', 12),
    'small': ('Helvetica', 10),
    'mono': ('Courier', 11),
    'stat_value': ('Helvetica', 11, 'bold'),
    'stat_label': ('Helvetica', 9),
    'nav': ('Helvetica', 13),
    'nav_active': ('Helvetica', 13, 'bold'),
}

# SWG resource stat names
RESOURCE_STATS = ['OQ', 'CR', 'CD', 'DR', 'HR', 'MA', 'SR', 'UT', 'FL', 'PE']

# SWG planets
PLANETS = [
    'Corellia', 'Dantooine', 'Dathomir', 'Endor', 'Kashyyyk',
    'Lok', 'Mustafar', 'Naboo', 'Rori', 'Tatooine', 'Yavin IV',
]

# Top-level resource categories
RESOURCE_CATEGORIES = [
    'All', 'Chemical', 'Creature Resources', 'Energy', 'Flora Resources',
    'Gas', 'Geothermal', 'Metal', 'Mineral', 'Organic', 'Water', 'Wind',
]
