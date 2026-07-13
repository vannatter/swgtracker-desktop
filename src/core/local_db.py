"""
Local SQLite database for caching stockpile and other user data.
Provides offline access and reduces API polling.
"""
from __future__ import annotations

import sqlite3
import logging
import re
import threading
import time
from pathlib import Path
from typing import Optional

logger = logging.getLogger(__name__)

DB_FILE = "swgtracker_local.db"

# --- Mail helpers: in-game send-time + coarse category ------------------------
_MAIL_TS_RE = re.compile(r"^TIMESTAMP:\s*(\d+)", re.MULTILINE)


def parse_mail_sent_at(raw: str) -> int:
    """The in-game send time (epoch) sits on the mail's `TIMESTAMP:` line."""
    if not raw:
        return 0
    m = _MAIL_TS_RE.search(raw)
    try:
        return int(m.group(1)) if m else 0
    except (TypeError, ValueError):
        return 0


# bank /tip surcharge — 5% on money you SEND via bank wire (classic SWG rate)
BANK_TIP_FEE_RATE = 0.05


def parse_bank_transfer(raw: str):
    """A 'Bank Transfer Complete' mail body -> {dir, amount, fee, party} or None.
      sent:     'RECIPIENT has received N credits from you, via bank wire transfer.'
      received: 'N credits from SENDER have been successfully delivered from escrow...'
    """
    body = (raw or "").split("\n")[-1] if raw else ""
    m = re.search(r"^(.+?) has received ([\d,]+) credits from you", body)
    if m:
        amt = int(m.group(1 + 1).replace(",", ""))
        return {"dir": "out", "amount": amt, "fee": round(amt * BANK_TIP_FEE_RATE),
                "party": m.group(1).strip()}
    m = re.search(r"^([\d,]+) credits from (.+?) have been successfully delivered", body)
    if m:
        return {"dir": "in", "amount": int(m.group(1).replace(",", "")), "fee": 0,
                "party": m.group(2).strip()}
    return None


def mail_category(subject: str, kind: str = "mail") -> str:
    """Coarse category from a mail's subject (+ kind) so the Mail page can filter
    and bulk-delete by type. Pattern-based; unknowns fall to 'other'."""
    if kind == "sale":
        return "sale"
    if kind == "purchase":
        return "purchase"
    s = (subject or "").lower()
    if "bank transfer" in s or "wire transfer" in s:
        return "banktip"
    if "out of ingredient" in s:
        return "factory-ingredients"
    if "manufacturing station" in s or "factory" in s or "manufacturing" in s:
        return "factory"
    if "maintenance" in s or "structure" in s or "condition" in s or "eviction" in s:
        return "structure"
    if "guild" in s:
        return "guild"
    if "purchased" in s:  # "Vendor Item Purchased" / "Instant Sale Item Purchased"
        return "purchase"
    if "vendor sale" in s or "sold" in s or "auction" in s:
        return "sale"
    return "other"


class LocalDB:
    """SQLite cache for stockpile data."""

    def __init__(self, db_path: Optional[str] = None):
        self.db_path = db_path or DB_FILE
        self._conn: Optional[sqlite3.Connection] = None
        # one shared connection, many bridge threads: sqlite allows cross-thread
        # use but not CONCURRENT use — serialize every query
        self._lock = threading.RLock()
        self._init_db()

    def _init_db(self):
        """Create tables if they don't exist."""
        self._conn = sqlite3.connect(self.db_path, check_same_thread=False)
        self._conn.row_factory = sqlite3.Row
        self._conn.execute("PRAGMA journal_mode=WAL")

        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS stockpile (
                stockpile_id INTEGER PRIMARY KEY,
                resource_id INTEGER NOT NULL,
                name TEXT DEFAULT '',
                type_name TEXT DEFAULT '',
                stock INTEGER DEFAULT 0,
                stockpile_status INTEGER DEFAULT 1,
                cr INTEGER DEFAULT 0,
                cd INTEGER DEFAULT 0,
                dr INTEGER DEFAULT 0,
                hr INTEGER DEFAULT 0,
                ma INTEGER DEFAULT 0,
                oq INTEGER DEFAULT 0,
                sr INTEGER DEFAULT 0,
                ut INTEGER DEFAULT 0,
                fl INTEGER DEFAULT 0,
                pe INTEGER DEFAULT 0,
                rating INTEGER DEFAULT 0,
                planet_list TEXT DEFAULT '',
                resource_status INTEGER DEFAULT 1,
                last_synced INTEGER DEFAULT 0,
                dirty INTEGER DEFAULT 0
            );

            CREATE TABLE IF NOT EXISTS sync_meta (
                key TEXT PRIMARY KEY,
                value TEXT
            );

            -- Uploaded-mail ledger: restarts never re-send a mail the server has
            CREATE TABLE IF NOT EXISTS mail_ledger (
                mail_id TEXT PRIMARY KEY,
                subject TEXT DEFAULT '',
                detail TEXT DEFAULT '',
                kind TEXT DEFAULT 'mail',
                raw TEXT DEFAULT '',
                uploaded_at INTEGER DEFAULT 0,
                sent_at INTEGER DEFAULT 0,
                category TEXT DEFAULT 'other'
            );

        """)

        # Dataset mirrors are disposable caches: on schema change, drop them and
        # clear the sha gates so the next sync re-downloads into the new shape.
        DS_SCHEMA_VER = "3"  # v3: cpu is REAL (int() choked on "9.4" -> everything stored 0)
        row = self._conn.execute(
            "SELECT value FROM sync_meta WHERE key = 'ds_schema_ver'").fetchone()
        if (row["value"] if row else "") != DS_SCHEMA_VER:
            self._conn.executescript("""
                DROP TABLE IF EXISTS ds_resources;
                DROP TABLE IF EXISTS ds_schematics;
                DELETE FROM sync_meta WHERE key LIKE 'ds_%';
            """)
            self._conn.execute(
                "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('ds_schema_ver', ?)",
                (DS_SCHEMA_VER,))
        self._init_ds_tables()

        # mail_ledger predates its detail/kind/raw + sent_at/category columns
        for col, decl in (("detail", "TEXT DEFAULT ''"), ("kind", "TEXT DEFAULT 'mail'"),
                          ("raw", "TEXT DEFAULT ''"), ("sent_at", "INTEGER DEFAULT 0"),
                          ("category", "TEXT DEFAULT 'other'"),
                          ("character", "TEXT DEFAULT ''"),
                          ("tip_out", "INTEGER DEFAULT 0"), ("tip_in", "INTEGER DEFAULT 0"),
                          ("tip_fee", "INTEGER DEFAULT 0")):
            try:
                self._conn.execute(f"ALTER TABLE mail_ledger ADD COLUMN {col} {decl}")
            except sqlite3.OperationalError:
                pass  # already there

        # One-time back-fill of sent_at (from raw's TIMESTAMP line) + category
        # (from subject) for mails imported before these columns existed.
        # v3: 'purchase' category + upgrade old purchase rows' kind from 'mail'.
        # v4: 'banktip' category + parse tip in/out/fee from bank-transfer bodies.
        MAIL_META_VER = "4"
        row = self._conn.execute(
            "SELECT value FROM sync_meta WHERE key = 'mail_meta_ver'").fetchone()
        if (row["value"] if row else "") != MAIL_META_VER:
            for r in self._conn.execute(
                    "SELECT mail_id, subject, kind, raw FROM mail_ledger").fetchall():
                kind = r["kind"]
                if kind == "mail" and "purchased" in (r["subject"] or "").lower():
                    kind = "purchase"
                cat = mail_category(r["subject"], kind)
                t_out = t_in = t_fee = 0
                if cat == "banktip":
                    tip = parse_bank_transfer(r["raw"])
                    if tip:
                        t_out = tip["amount"] if tip["dir"] == "out" else 0
                        t_in = tip["amount"] if tip["dir"] == "in" else 0
                        t_fee = tip["fee"]
                self._conn.execute(
                    "UPDATE mail_ledger SET sent_at = ?, category = ?, kind = ?,"
                    " tip_out = ?, tip_in = ?, tip_fee = ? WHERE mail_id = ?",
                    (parse_mail_sent_at(r["raw"]), cat, kind, t_out, t_in, t_fee, r["mail_id"]))
            self._conn.execute(
                "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('mail_meta_ver', ?)",
                (MAIL_META_VER,))

        self._conn.commit()
        logger.info(f"Local database initialized: {self.db_path}")

    def _init_ds_tables(self):
        """Offline mirrors of swgtracker.com/exports/* (see dataset_sync.py).

        Columns cover everything the grids and detail pages render: stats + caps
        for quality coloring, planet flags for badges/filter, score/topcount,
        cpu/swgaide_id for the resource detail header.
        """
        self._conn.executescript("""
            CREATE TABLE IF NOT EXISTS ds_resources (
                id INTEGER PRIMARY KEY,
                name TEXT DEFAULT '',
                type_code TEXT DEFAULT '',
                type_name TEXT DEFAULT '',
                cr INTEGER DEFAULT 0, cd INTEGER DEFAULT 0, dr INTEGER DEFAULT 0,
                hr INTEGER DEFAULT 0, ma INTEGER DEFAULT 0, oq INTEGER DEFAULT 0,
                sr INTEGER DEFAULT 0, ut INTEGER DEFAULT 0, fl INTEGER DEFAULT 0,
                pe INTEGER DEFAULT 0,
                cr_max INTEGER DEFAULT 0, cd_max INTEGER DEFAULT 0, dr_max INTEGER DEFAULT 0,
                hr_max INTEGER DEFAULT 0, ma_max INTEGER DEFAULT 0, oq_max INTEGER DEFAULT 0,
                sr_max INTEGER DEFAULT 0, ut_max INTEGER DEFAULT 0, fl_max INTEGER DEFAULT 0,
                pe_max INTEGER DEFAULT 0,
                rating INTEGER DEFAULT 0,
                score INTEGER,
                topcount INTEGER DEFAULT 0,
                value_rating INTEGER DEFAULT 0,
                cpu REAL DEFAULT 0,
                swgaide_id INTEGER DEFAULT 0,
                status INTEGER DEFAULT 0,
                timestamp INTEGER DEFAULT 0,
                planet_corellia INTEGER DEFAULT 0, planet_dantooine INTEGER DEFAULT 0,
                planet_dathomir INTEGER DEFAULT 0, planet_endor INTEGER DEFAULT 0,
                planet_lok INTEGER DEFAULT 0, planet_naboo INTEGER DEFAULT 0,
                planet_rori INTEGER DEFAULT 0, planet_talus INTEGER DEFAULT 0,
                planet_tatooine INTEGER DEFAULT 0, planet_yavin4 INTEGER DEFAULT 0,
                planet_kashyyyk INTEGER DEFAULT 0, planet_mustafar INTEGER DEFAULT 0,
                planetSearch TEXT DEFAULT ''
            );
            CREATE INDEX IF NOT EXISTS idx_dsres_name ON ds_resources(name);
            CREATE INDEX IF NOT EXISTS idx_dsres_status ON ds_resources(status, timestamp);
            CREATE INDEX IF NOT EXISTS idx_dsres_type ON ds_resources(type_code);

            CREATE TABLE IF NOT EXISTS ds_schematics (
                id INTEGER PRIMARY KEY,
                name TEXT DEFAULT '',
                parent TEXT DEFAULT '',
                category INTEGER DEFAULT 0,
                active INTEGER DEFAULT 1,
                crate_size INTEGER DEFAULT 0,
                payload TEXT DEFAULT '{}'
            );
            CREATE INDEX IF NOT EXISTS idx_dssch_name ON ds_schematics(name);
            CREATE INDEX IF NOT EXISTS idx_dssch_parent ON ds_schematics(parent);

            -- Slim game payloads (ingredients/components/formulas) from
            -- exports/schematic_details.json; best lists computed from ds_resources.
            CREATE TABLE IF NOT EXISTS ds_schematic_details (
                schematic_id INTEGER PRIMARY KEY,
                payload TEXT NOT NULL
            );
        """)

    def close(self):
        if self._conn:
            self._conn.close()
            self._conn = None

    # --- Stockpile operations ---

    def get_stockpile(self, search: str = "") -> list[dict]:
        """Get all stockpile items from local cache."""
        if search:
            rows = self._conn.execute(
                "SELECT * FROM stockpile WHERE name LIKE ? OR type_name LIKE ? ORDER BY name",
                (f"%{search}%", f"%{search}%")
            ).fetchall()
        else:
            rows = self._conn.execute(
                "SELECT * FROM stockpile ORDER BY name"
            ).fetchall()
        return [dict(r) for r in rows]

    def upsert_stockpile_item(self, item: dict):
        """Insert or update a stockpile item from API data."""
        stockpile_id = int(item.get('stockpile_id', 0))
        if not stockpile_id:
            return

        # Parse planet list from planet_* columns
        planet_parts = []
        for key, abbrev in [
            ('planet_corellia', 'Cor'), ('planet_dantooine', 'Dan'),
            ('planet_dathomir', 'Dat'), ('planet_endor', 'End'),
            ('planet_lok', 'Lok'), ('planet_naboo', 'Nab'),
            ('planet_rori', 'Ror'), ('planet_talus', 'Tal'),
            ('planet_tatooine', 'Tat'), ('planet_yavin4', 'Yav'),
            ('planet_kashyyyk', 'Kas'), ('planet_mustafar', 'Mus'),
        ]:
            if str(item.get(key, '0')) == '1':
                planet_parts.append(abbrev)

        self._conn.execute("""
            INSERT INTO stockpile (
                stockpile_id, resource_id, name, type_name, stock, stockpile_status,
                cr, cd, dr, hr, ma, oq, sr, ut, fl, pe, rating,
                planet_list, resource_status, last_synced, dirty
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)
            ON CONFLICT(stockpile_id) DO UPDATE SET
                name=excluded.name, type_name=excluded.type_name,
                stock=excluded.stock, stockpile_status=excluded.stockpile_status,
                cr=excluded.cr, cd=excluded.cd, dr=excluded.dr, hr=excluded.hr,
                ma=excluded.ma, oq=excluded.oq, sr=excluded.sr, ut=excluded.ut,
                fl=excluded.fl, pe=excluded.pe, rating=excluded.rating,
                planet_list=excluded.planet_list, resource_status=excluded.resource_status,
                last_synced=excluded.last_synced,
                dirty=CASE WHEN stockpile.dirty = 1 THEN 1 ELSE 0 END
        """, (
            stockpile_id,
            _safe_int(item.get('id', item.get('resource_id', 0))),
            item.get('name', ''),
            item.get('type_name', ''),
            _safe_int(item.get('stock', 0)),
            _safe_int(item.get('stockpile_status', 1)),
            _safe_int(item.get('cr', 0)),
            _safe_int(item.get('cd', 0)),
            _safe_int(item.get('dr', 0)),
            _safe_int(item.get('hr', 0)),
            _safe_int(item.get('ma', 0)),
            _safe_int(item.get('oq', 0)),
            _safe_int(item.get('sr', 0)),
            _safe_int(item.get('ut', 0)),
            _safe_int(item.get('fl', 0)),
            _safe_int(item.get('pe', 0)),
            _safe_int(item.get('rating', 0)),
            ' '.join(planet_parts),
            _safe_int(item.get('status', 1)),
            int(time.time()),
        ))

    def sync_from_api(self, api_results: list[dict]):
        """Replace local stockpile cache with full API response."""
        # Get IDs of dirty local items (pending sync to server)
        dirty_ids = {r['stockpile_id'] for r in
                     self._conn.execute("SELECT stockpile_id FROM stockpile WHERE dirty = 1").fetchall()}

        # Clear non-dirty items and re-insert from API
        self._conn.execute("DELETE FROM stockpile WHERE dirty = 0")

        for item in api_results:
            sid = _safe_int(item.get('stockpile_id', 0))
            if sid in dirty_ids:
                continue  # Don't overwrite local changes
            self.upsert_stockpile_item(item)

        self._conn.execute(
            "INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('stockpile_last_sync', ?)",
            (str(int(time.time())),)
        )
        self._conn.commit()
        logger.info(f"Synced {len(api_results)} stockpile items from API")

    def update_stock_local(self, stockpile_id: int, stock: int):
        """Update stock quantity locally and mark as dirty."""
        self._conn.execute(
            "UPDATE stockpile SET stock = ?, dirty = 1 WHERE stockpile_id = ?",
            (stock, stockpile_id)
        )
        self._conn.commit()

    def mark_synced(self, stockpile_id: int):
        """Mark a stockpile item as synced with server."""
        self._conn.execute(
            "UPDATE stockpile SET dirty = 0, last_synced = ? WHERE stockpile_id = ?",
            (int(time.time()), stockpile_id)
        )
        self._conn.commit()

    def remove_local(self, stockpile_id: int):
        """Remove a stockpile item from local cache."""
        self._conn.execute("DELETE FROM stockpile WHERE stockpile_id = ?", (stockpile_id,))
        self._conn.commit()

    def get_dirty_items(self) -> list[dict]:
        """Get items with local changes pending sync."""
        rows = self._conn.execute("SELECT * FROM stockpile WHERE dirty = 1").fetchall()
        return [dict(r) for r in rows]

    def get_last_sync_time(self) -> int:
        """Get timestamp of last successful sync."""
        row = self._conn.execute(
            "SELECT value FROM sync_meta WHERE key = 'stockpile_last_sync'"
        ).fetchone()
        return int(row['value']) if row else 0

    # --- Mail ledger (uploaded .mail files; see mail_monitor.py) ---

    def mail_ledger_has(self, mail_id: str) -> bool:
        return self._conn.execute(
            "SELECT 1 FROM mail_ledger WHERE mail_id = ?", (str(mail_id),)).fetchone() is not None

    def mail_ledger_add(self, mail_id: str, subject: str = "", detail: str = "",
                        kind: str = "mail", raw: str = "", character: str = ""):
        category = mail_category(subject, kind)
        t_out = t_in = t_fee = 0
        if category == "banktip":
            tip = parse_bank_transfer(raw)
            if tip:
                t_out = tip["amount"] if tip["dir"] == "out" else 0
                t_in = tip["amount"] if tip["dir"] == "in" else 0
                t_fee = tip["fee"]
                if not detail:
                    detail = (f"→ {tip['party']} · {tip['amount']:,} cr"
                              f" · {tip['fee']:,} fee" if tip["dir"] == "out"
                              else f"← {tip['party']} · {tip['amount']:,} cr")
        self._conn.execute(
            "INSERT OR REPLACE INTO mail_ledger"
            " (mail_id, subject, detail, kind, raw, uploaded_at, sent_at, category, character,"
            "  tip_out, tip_in, tip_fee)"
            " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
            (str(mail_id), subject, detail, kind, raw, int(time.time()),
             parse_mail_sent_at(raw), category, str(character or ""),
             t_out, t_in, t_fee))
        self._conn.commit()

    def mail_tip_totals(self) -> dict:
        """Bank-transfer running totals for the Mail page: credits sent, received,
        and the surcharge you burned sending."""
        r = self._conn.execute(
            "SELECT COALESCE(SUM(tip_out),0) AS sent, COALESCE(SUM(tip_in),0) AS received,"
            " COALESCE(SUM(tip_fee),0) AS fees,"
            " SUM(CASE WHEN tip_out > 0 THEN 1 ELSE 0 END) AS sent_n,"
            " SUM(CASE WHEN tip_in > 0 THEN 1 ELSE 0 END) AS recv_n"
            " FROM mail_ledger WHERE category = 'banktip'").fetchone()
        return {"sent": r["sent"], "received": r["received"], "fees": r["fees"],
                "sent_count": r["sent_n"] or 0, "recv_count": r["recv_n"] or 0}

    @staticmethod
    def _mail_where(category: str, search: str, character: str = "") -> tuple[str, list]:
        """Shared WHERE for category/character + subject/detail search across the mail views."""
        clauses, params = [], []
        if category:
            clauses.append("category = ?")
            params.append(str(category))
        if character:
            clauses.append("character = ?")
            params.append(str(character))
        if search:
            like = f"%{search}%"
            clauses.append("(subject LIKE ? OR detail LIKE ?)")
            params += [like, like]
        return (" WHERE " + " AND ".join(clauses)) if clauses else "", params

    def mail_history(self, limit: int = 200, offset: int = 0,
                     category: str = "", search: str = "", character: str = "") -> list[dict]:
        # raw stays out of the list payload (big bridge responses drop in WKWebView);
        # the viewer fetches one mail at a time via mail_raw(). Ordered by the
        # in-game send time (sent_at), falling back to upload time when unknown.
        where, params = self._mail_where(category, search, character)
        rows = self._conn.execute(
            "SELECT mail_id, subject, detail, kind, uploaded_at, sent_at, category, character,"
            " (COALESCE(raw, '') != '') AS has_raw"
            " FROM mail_ledger" + where +
            " ORDER BY COALESCE(NULLIF(sent_at, 0), uploaded_at) DESC, mail_id DESC"
            " LIMIT ? OFFSET ?", params + [int(limit), int(offset)]).fetchall()
        return [dict(r) for r in rows]

    def mail_count(self, category: str = "", search: str = "", character: str = "") -> int:
        where, params = self._mail_where(category, search, character)
        return self._conn.execute(
            "SELECT COUNT(*) AS n FROM mail_ledger" + where, params).fetchone()["n"]

    def mail_category_counts(self) -> dict:
        rows = self._conn.execute(
            "SELECT category, COUNT(*) AS n FROM mail_ledger GROUP BY category").fetchall()
        return {(r["category"] or "other"): r["n"] for r in rows}

    def mail_ids_filtered(self, category: str = "", search: str = "", character: str = "") -> list[str]:
        where, params = self._mail_where(category, search, character)
        rows = self._conn.execute(
            "SELECT mail_id FROM mail_ledger" + where, params).fetchall()
        return [r["mail_id"] for r in rows]

    def mail_character_counts(self) -> dict:
        rows = self._conn.execute(
            "SELECT character, COUNT(*) AS n FROM mail_ledger"
            " WHERE COALESCE(character, '') != '' GROUP BY character").fetchall()
        return {r["character"]: r["n"] for r in rows}

    def mail_rename_character(self, old: str, new: str) -> int:
        """Re-attribute every ledgered mail from OLD to NEW — the folder's
        character changed in Settings, and history must follow it."""
        if not old or not new or old == new:
            return 0
        cur = self._conn.execute(
            "UPDATE mail_ledger SET character = ? WHERE character = ?",
            (str(new), str(old)))
        self._conn.commit()
        return cur.rowcount

    def mail_set_character(self, mail_id: str, character: str) -> None:
        """Stamp CHARACTER onto one mail if it differs — sweep self-healing for
        files still sitting in a re-labeled folder."""
        if not character:
            return
        self._conn.execute(
            "UPDATE mail_ledger SET character = ? WHERE mail_id = ? AND COALESCE(character, '') != ?",
            (str(character), str(mail_id), str(character)))
        self._conn.commit()

    def mail_attribute_unassigned(self, character: str) -> int:
        """Stamp CHARACTER onto every unattributed mail — safe only when the user
        has a single mail folder (all history must have come from it)."""
        if not character:
            return 0
        cur = self._conn.execute(
            "UPDATE mail_ledger SET character = ? WHERE COALESCE(character, '') = ''",
            (str(character),))
        self._conn.commit()
        return cur.rowcount

    def mail_sales_count(self) -> int:
        return self._conn.execute(
            "SELECT COUNT(*) AS n FROM mail_ledger WHERE kind = 'sale'").fetchone()["n"]

    def mail_raw(self, mail_id: str) -> str:
        row = self._conn.execute(
            "SELECT raw FROM mail_ledger WHERE mail_id = ?", (str(mail_id),)).fetchone()
        return (row["raw"] or "") if row else ""

    def mail_ids_missing_raw(self) -> set[str]:
        rows = self._conn.execute(
            "SELECT mail_id FROM mail_ledger WHERE COALESCE(raw, '') = ''").fetchall()
        return {r["mail_id"] for r in rows}

    def mail_set_raw(self, mail_id: str, raw: str):
        self._conn.execute(
            "UPDATE mail_ledger SET raw = ? WHERE mail_id = ?", (raw, str(mail_id)))
        self._conn.commit()

    def mail_ledger_delete(self, mail_id: str):
        self._conn.execute("DELETE FROM mail_ledger WHERE mail_id = ?", (str(mail_id),))
        self._conn.commit()

    def mail_ledger_count(self) -> int:
        return self._conn.execute("SELECT COUNT(*) AS n FROM mail_ledger").fetchone()["n"]

    # --- Offline datasets (exports/* mirrors, written by DatasetSync) ---

    _DS_RES_COLS = (
        "id", "name", "type_code", "type_name",
        "cr", "cd", "dr", "hr", "ma", "oq", "sr", "ut", "fl", "pe",
        "cr_max", "cd_max", "dr_max", "hr_max", "ma_max", "oq_max",
        "sr_max", "ut_max", "fl_max", "pe_max",
        "rating", "score", "topcount", "value_rating", "cpu", "swgaide_id",
        "status", "timestamp",
        "planet_corellia", "planet_dantooine", "planet_dathomir", "planet_endor",
        "planet_lok", "planet_naboo", "planet_rori", "planet_talus",
        "planet_tatooine", "planet_yavin4", "planet_kashyyyk", "planet_mustafar",
        "planetSearch",
    )

    def set_meta(self, key: str, value: str):
        self._conn.execute(
            "INSERT OR REPLACE INTO sync_meta (key, value) VALUES (?, ?)", (key, str(value)))
        self._conn.commit()

    def get_meta(self, key: str, default: str = "") -> str:
        row = self._conn.execute("SELECT value FROM sync_meta WHERE key = ?", (key,)).fetchone()
        return row["value"] if row else default

    def replace_ds_resources(self, rows: list[dict]):
        """Full-replace the resources mirror (one transaction; ~90k rows in seconds)."""
        def val(r, c):
            if c == "score":  # 0–100 or null when unscored — keep the null
                return None if r.get("score") is None else _safe_int(r.get("score"))
            if c == "cpu":  # decimal ("9.4") — int() would raise and zero it out
                try:
                    return float(r.get("cpu") or 0)
                except (ValueError, TypeError):
                    return 0.0
            if c in ("name", "type_code", "type_name", "planetSearch"):
                return r.get(c) or ""
            return _safe_int(r.get(c))
        cols = ", ".join(self._DS_RES_COLS)
        marks = ", ".join("?" * len(self._DS_RES_COLS))
        with self._conn:  # atomic: readers keep the old mirror until commit
            self._conn.execute("DELETE FROM ds_resources")
            self._conn.executemany(
                f"INSERT OR REPLACE INTO ds_resources ({cols}) VALUES ({marks})",
                ([val(r, c) for c in self._DS_RES_COLS] for r in rows))

    def replace_ds_schematics(self, rows: list[dict]):
        import json as _json
        with self._conn:
            self._conn.execute("DELETE FROM ds_schematics")
            self._conn.executemany(
                "INSERT OR REPLACE INTO ds_schematics (id, name, parent, category, active,"
                " crate_size, payload) VALUES (?, ?, ?, ?, ?, ?, ?)",
                ((_safe_int(r.get("id")), r.get("name") or "", r.get("parent") or "",
                  _safe_int(r.get("category")), _safe_int(r.get("active", 1)),
                  _safe_int(r.get("crate_size")), _json.dumps(r)) for r in rows))

    def replace_ds_schematic_details(self, by_id: dict):
        """Full-replace from the export's {schematic_id: payload} map."""
        import json as _json
        with self._conn:
            self._conn.execute("DELETE FROM ds_schematic_details")
            self._conn.executemany(
                "INSERT OR REPLACE INTO ds_schematic_details (schematic_id, payload) VALUES (?, ?)",
                ((_safe_int(k), _json.dumps(v)) for k, v in by_id.items()))

    def all_ds_schematic_details(self) -> list[dict]:
        import json as _json
        rows = self._conn.execute("SELECT payload FROM ds_schematic_details").fetchall()
        return [_json.loads(r["payload"]) for r in rows]

    def get_ds_schematic_detail(self, schematic_id) -> dict | None:
        import json as _json
        row = self._conn.execute(
            "SELECT payload FROM ds_schematic_details WHERE schematic_id = ?",
            (_safe_int(schematic_id),)).fetchone()
        return _json.loads(row["payload"]) if row else None

    def ds_counts(self) -> dict:
        res = self._conn.execute("SELECT COUNT(*) AS n FROM ds_resources").fetchone()["n"]
        sch = self._conn.execute("SELECT COUNT(*) AS n FROM ds_schematics").fetchone()["n"]
        det = self._conn.execute("SELECT COUNT(*) AS n FROM ds_schematic_details").fetchone()["n"]
        return {"resources": res, "schematics": sch, "schematic_details": det}

    _DS_RES_SORTABLE = {"name", "type_name", "cr", "cd", "dr", "hr", "ma", "oq", "sr",
                        "ut", "fl", "pe", "rating", "value_rating", "timestamp"}

    def search_ds_resources(self, search="", planet="", type_codes=None, status="active",
                            page=1, perpage=50, sort="", order="") -> dict:
        """Query the mirror with the live API's semantics and response shape.

        type_codes: expanded list of leaf codes for a category filter (see
        DatasetSync.expand_category), or None for all.
        """
        where, params = [], []
        if search:
            where.append("(name LIKE ? OR type_name LIKE ?)")
            params += [f"%{search}%", f"%{search}%"]
        if planet:
            col = "planet_" + planet.lower().replace(" ", "").replace("iv", "4")
            if col in ("planet_corellia", "planet_dantooine", "planet_dathomir",
                       "planet_endor", "planet_lok", "planet_naboo", "planet_rori",
                       "planet_talus", "planet_tatooine", "planet_yavin4",
                       "planet_kashyyyk", "planet_mustafar"):
                where.append(f"{col} = 1")
        if type_codes is not None:
            if not type_codes:
                return {"page": 1, "per_page": perpage, "results": [], "offline": True}
            marks = ",".join("?" * len(type_codes))
            where.append(f"type_code IN ({marks})")
            params += list(type_codes)
        if status == "active":
            where.append("status = 1")
        elif status == "inactive":
            where.append("status != 1")

        sort_col = sort if sort in self._DS_RES_SORTABLE else "timestamp"
        direction = "ASC" if str(order).upper() == "ASC" else "DESC"
        sql = "SELECT * FROM ds_resources"
        if where:
            sql += " WHERE " + " AND ".join(where)
        sql += f" ORDER BY {sort_col} {direction} LIMIT ? OFFSET ?"
        page = max(1, int(page))
        params += [int(perpage), (page - 1) * int(perpage)]

        # NB: no fabricated 'active' flag — live search rows don't carry one either,
        # and inventing it green-tints every row (activeResource is a spawn-page thing)
        rows = [dict(r) for r in self._conn.execute(sql, params).fetchall()]
        return {"page": page, "per_page": perpage, "results": rows, "offline": True}

    def ds_resources_by_ids(self, ids: list, type_codes: list | None = None) -> list[dict]:
        """Specific mirror rows by id (optionally fenced to a class's leaf codes) —
        lets class pools always include stockpiled resources that a size-capped
        best-first query would drop."""
        ids = [str(i) for i in ids if str(i).strip()]
        if not ids:
            return []
        marks = ",".join("?" * len(ids))
        sql = f"SELECT * FROM ds_resources WHERE id IN ({marks})"
        params: list = list(ids)
        if type_codes:
            tmarks = ",".join("?" * len(type_codes))
            sql += f" AND type_code IN ({tmarks})"
            params += list(type_codes)
        return [dict(r) for r in self._conn.execute(sql, params).fetchall()]

    def get_ds_resource(self, name: str) -> dict | None:
        """Single mirror row by exact name (case-insensitive), for offline detail."""
        row = self._conn.execute(
            "SELECT * FROM ds_resources WHERE name = ? COLLATE NOCASE", (name,)).fetchone()
        return dict(row) if row else None

    def get_ds_schematic(self, schematic_id) -> dict | None:
        import json as _json
        row = self._conn.execute(
            "SELECT payload FROM ds_schematics WHERE id = ?",
            (_safe_int(schematic_id),)).fetchone()
        return _json.loads(row["payload"]) if row else None

    def search_ds_schematics(self, search="", category="", page=1, perpage=50) -> dict:
        import json as _json
        where, params = ["active = 1"], []
        if search:
            where.append("name LIKE ?")
            params.append(f"%{search}%")
        if category:
            where.append("parent = ?")
            params.append(category)
        wsql = " AND ".join(where)
        total = self._conn.execute(
            f"SELECT COUNT(*) AS n FROM ds_schematics WHERE {wsql}", params).fetchone()["n"]
        page = max(1, int(page))
        rows = self._conn.execute(
            f"SELECT payload FROM ds_schematics WHERE {wsql} ORDER BY name"
            " LIMIT ? OFFSET ?", params + [int(perpage), (page - 1) * int(perpage)]).fetchall()
        return {"page": page, "per_page": perpage, "total_results": total,
                "total_pages": max(1, -(-total // int(perpage))),
                "results": [_json.loads(r["payload"]) for r in rows], "offline": True}


def _safe_int(val) -> int:
    try:
        return int(val or 0)
    except (ValueError, TypeError):
        return 0
