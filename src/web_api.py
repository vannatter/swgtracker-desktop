"""
JS <-> Python bridge for the pywebview UI.

Every method here is reachable from the frontend as
``window.pywebview.api.<method>(...)`` and returns a JSON-serializable dict
shaped ``{"ok": bool, "data": ..., "error": str}``. The heavy lifting still
lives in src/core/* — this is a thin adapter so the web layer never imports
the API client or DB directly.
"""
from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def _ok(data):
    return {"ok": True, "data": data, "error": None}


def _parse_formula_weights(formulas):
    """'... OQ=33% SR=66%' -> [{'oq': 33, 'sr': 66}, ...] for active formulas —
    mirrors mysParseWeights in web/js/myschematics.js."""
    import re
    out = []
    for f in formulas:
        if f.get("active") is False:
            continue
        w = {m[0].lower(): int(m[1])
             for m in re.findall(r"([A-Z]{2})=(\d+)%", str(f.get("formulaDescription") or ""))}
        if w:
            out.append(w)
    return out


def _weighted_q(row, weights):
    """Mean over formulas of sum(stat/cap * 1000 * pct/100) — mirrors
    weightedQuality in web/js/shared.js. None when there are no weights."""
    if not weights:
        return None
    per = []
    for w in weights:
        q = 0.0
        for stat, pct in w.items():
            cap = row.get(f"{stat}_max") or 1000
            q += ((row.get(stat) or 0) / cap) * 1000 * (pct / 100)
        per.append(q)
    return sum(per) / len(per)


def _spawn_entry(row, weights):
    """ds_resources row -> spawn-list entry shaped like the live API's."""
    quality = _weighted_q(row, weights)
    if quality is None:
        quality = float(row.get("rating") or 0)
    entry = {
        "resourceId": str(row["id"]),
        "resourceName": row.get("name", ""),
        "resourceQuality": round(quality, 1),
        "active": "1" if row.get("status") == 1 else "0",
        "timestamp": row.get("timestamp") or 0,
    }
    for stat in ("oq", "cr", "cd", "dr", "hr", "ma", "sr", "ut", "fl", "pe"):
        entry[stat] = row.get(stat) or 0
        entry[f"{stat}_max"] = row.get(f"{stat}_max") or 0
    return entry


def _err(message):
    return {"ok": False, "data": None, "error": str(message)}


def _wrap(success: bool, data):
    """Adapt the core's (success, data) tuples into the bridge envelope."""
    if success:
        return _ok(data)
    return _err(data if isinstance(data, str) else "Request failed")


class WebApi:
    """Methods exposed to JavaScript via pywebview's js_api."""

    def __init__(self, config_manager, api_client, local_db=None, controller=None,
                 app_version="0.0.0", dataset_sync=None):
        self.config = config_manager
        self.api = api_client
        self.local_db = local_db
        self.app_version = app_version
        # Optional app controller (mail monitor start/stop, connection test).
        self.controller = controller
        # Optional offline dataset mirror (dataset_sync.py).
        self.dataset_sync = dataset_sync

    # --- Offline datasets ---

    def dataset_sync_status(self):
        if not self.dataset_sync:
            return _err("Dataset sync unavailable")
        try:
            return _ok(self.dataset_sync.status())
        except Exception as e:
            return _err(e)

    def dataset_sync_now(self):
        """Kick a sync in the background; the UI polls dataset_sync_status."""
        if not self.dataset_sync:
            return _err("Dataset sync unavailable")
        try:
            import threading
            threading.Thread(target=self.dataset_sync.sync_now,
                             kwargs={"force": True}, daemon=True).start()
            return _ok({"started": True})
        except Exception as e:
            return _err(e)

    def set_simulate_offline(self, on):
        """Testing switch: make every live API call fail like a network outage."""
        try:
            self.api.simulate_offline = bool(on)
            return _ok(self.api.simulate_offline)
        except Exception as e:
            return _err(e)

    def _offline_ok(self, error) -> bool:
        """Fall back to the mirror only for transport-ish failures, not auth ones."""
        if not (self.dataset_sync and self.local_db):
            return False
        msg = str(error or "").lower()
        return not any(t in msg for t in ("401", "403", "key", "unauthorized"))

    # --- App updates ---

    def app_info(self):
        """Running version/build — shown in the header, no network needed."""
        return _ok({"version": self.app_version})

    def check_update(self):
        """Compare the running version against swgtracker.com/app/version.json.

        Expected file: {"version": "0.2.0", "url": "https://swgtracker.com/app",
        "notes": "..."} — a 404 simply means no update channel yet.
        """
        try:
            success, data = self.api._request('GET', 'app/version.json')
            if not success or not isinstance(data, dict):
                return _ok({"current": self.app_version, "latest": None})

            def vtuple(v):
                return tuple(int(x) for x in str(v or "0").split(".") if x.isdigit())

            latest = str(data.get("version", ""))
            return _ok({
                "current": self.app_version,
                "latest": latest,
                "update_available": vtuple(latest) > vtuple(self.app_version),
                "url": data.get("url", "https://swgtracker.com"),
                "notes": data.get("notes", ""),
            })
        except Exception as e:
            return _err(e)

    # --- Diagnostics ---

    def log_js(self, level, message):
        """Frontend error reporting — the webview has no visible JS console."""
        logger.log(logging.ERROR if level == "error" else logging.INFO, "JS %s: %s", level, message)
        return _ok(True)

    # --- Server pulse ---

    def get_pulse(self):
        try:
            return _wrap(*self.api.get_pulse())
        except Exception as e:
            logger.error("get_pulse failed: %s", e, exc_info=True)
            return _err(e)

    # --- Resources ---

    def search_resources(self, params=None):
        params = params or {}
        try:
            success, data = self.api.search_resources(
                search=params.get("search", ""),
                planet=params.get("planet", ""),
                category=params.get("category", ""),
                status=params.get("status", "active"),
                page=int(params.get("page", 1)),
                perpage=int(params.get("perpage", 50)),
                sort=params.get("sort", ""),
                order=params.get("order", ""),
            )
            if not success and self._offline_ok(data):
                return self._search_resources_offline(params, data)
            return _wrap(success, data)
        except Exception as e:
            logger.error("search_resources failed: %s", e, exc_info=True)
            if self._offline_ok(e):
                return self._search_resources_offline(params, e)
            return _err(e)

    def _search_resources_offline(self, params, original_error):
        try:
            category = params.get("category", "")
            type_codes = self.dataset_sync.expand_category(category) if category else None
            data = self.local_db.search_ds_resources(
                search=params.get("search", ""),
                planet=params.get("planet", ""),
                type_codes=type_codes,
                status=params.get("status", "active"),
                page=int(params.get("page", 1)),
                perpage=int(params.get("perpage", 50)),
                sort=params.get("sort", ""),
                order=params.get("order", ""),
            )
            if not data["results"] and not self.local_db.ds_counts()["resources"]:
                return _err(original_error)  # mirror is empty — real error is more useful
            logger.info("search_resources served from offline mirror")
            return _ok(data)
        except Exception as e:
            logger.error("offline resources fallback failed: %s", e, exc_info=True)
            return _err(original_error)

    def get_pinned_resources(self):
        try:
            return _ok(self.config.get_pinned_resources())
        except Exception as e:
            return _err(e)

    def toggle_pin_resource(self, resource_id):
        try:
            self.config.toggle_pinned_resource(str(resource_id))
            return _ok(self.config.get_pinned_resources())
        except Exception as e:
            return _err(e)

    def get_resource(self, name):
        try:
            success, data = self.api.get_resource_by_name(str(name))
            if not success and self._offline_ok(data):
                return self._get_resource_offline(name, data)
            return _wrap(success, data)
        except Exception as e:
            if self._offline_ok(e):
                return self._get_resource_offline(name, e)
            return _err(e)

    def _get_resource_offline(self, name, original_error):
        """Detail from the mirror: stats/planets/score, other-type spawns, and the
        schematic tabs (top uses / used in / related) computed locally from the
        schematic_details mirror against class pools in ds_resources."""
        try:
            row = self.local_db.get_ds_resource(str(name))
            if not row:
                return _err(original_error)
            similar = []
            if row.get("type_code"):
                sim = self.local_db.search_ds_resources(
                    type_codes=[row["type_code"]], status="", perpage=100,
                    sort="timestamp", order="DESC")
                similar = [r for r in sim["results"] if r["id"] != row["id"]]
            top_uses, used_ins, related = self._offline_rd_tabs(row)
            return _ok({"resource": row, "top_uses": top_uses, "used_ins": used_ins,
                        "related_schematics": related, "similar": similar, "offline": True})
        except Exception:
            logger.error("offline resource detail failed", exc_info=True)
            return _err(original_error)

    def _offline_rd_tabs(self, row):
        """(top_uses, used_ins, related_schematics) for one mirror resource.

        A schematic section is relevant when its class code sits on the resource's
        type ancestry. Rank = position of this resource's weighted quality within
        the section's full class pool. Pools of sorted qualities are cached per
        (class code, weights signature) until the datasets resync.
        """
        import json as _json
        from bisect import bisect_right

        tc = row.get("type_code") or ""
        if not tc:
            return [], [], []
        stamp = (self.local_db.get_meta("ds_schematic_details_synced", "0") + "/"
                 + self.local_db.get_meta("ds_resources_synced", "0"))
        if getattr(self, "_rd_stamp", None) != stamp:
            self._rd_stamp = stamp
            self._rd_details = None
            self._rd_pools = {}     # (code, weights_sig) -> ascending [quality]
            self._rd_pool_rows = {} # code -> mirror rows of that class
        if self._rd_details is None:
            self._rd_details = self.local_db.all_ds_schematic_details()

        matching = set(self.dataset_sync.ancestors(tc))

        def pool_qs(code, weights, sig):
            key = (code, sig)
            if key not in self._rd_pools:
                if code not in self._rd_pool_rows:
                    leafs = self.dataset_sync.expand_category(code) or [code]
                    self._rd_pool_rows[code] = self.local_db.search_ds_resources(
                        type_codes=leafs, status="", perpage=5000)["results"]
                self._rd_pools[key] = sorted(
                    _weighted_q(r, weights) for r in self._rd_pool_rows[code])
            return self._rd_pools[key]

        def rank_of(q, qs):
            return len(qs) - bisect_right(qs, q) + 1  # strictly-better count + 1

        top_uses, used_ins, related = [], [], []
        for det in self._rd_details:
            formulas = [f for f in (det.get("formula") or []) if f.get("active") is not False]
            all_weights = _parse_formula_weights(formulas)
            for block in det.get("resourceDtoList") or []:
                code = block.get("resourceTypeCode") or ""
                if code not in matching:
                    continue
                # per-formula ranks -> Top Uses
                for f in formulas:
                    w = _parse_formula_weights([f])
                    if not w:
                        continue
                    q = _weighted_q(row, w)
                    r = rank_of(q, pool_qs(code, w, str(sorted(w[0].items()))))
                    if r <= 10:
                        top_uses.append({
                            "schematic_id": det.get("schematicId"),
                            "schematic_name": det.get("schematicName", ""),
                            "section": block.get("resourceTypeName", ""),
                            "formula_description": f.get("formulaDescription", ""),
                            "rank": r,
                        })
                # combined-formula quality -> Used In (rank) + Related (>800)
                if not all_weights:
                    continue
                q = _weighted_q(row, all_weights)
                sig = str([sorted(w.items()) for w in all_weights])
                r = rank_of(q, pool_qs(code, all_weights, sig))
                if r <= 10:
                    used_ins.append({
                        "schematicId": det.get("schematicId"),
                        "schematicName": det.get("schematicName", ""),
                        "resourceClassName": block.get("resourceTypeName", ""),
                        "ranking": r,
                    })
                if q > 800:
                    related.append({
                        "schematicId": det.get("schematicId"),
                        "schematicName": det.get("schematicName", ""),
                        "resourceQuality": round(q, 1),
                        "formulaExpDescription": "; ".join(
                            f.get("formulaDescription", "").strip() for f in formulas),
                        "resourceClass": block.get("resourceTypeName", ""),
                        "resourceClassCode": code,
                    })
        return top_uses, used_ins, related

    def open_external(self, url):
        """Open a URL in the system browser (webview links stay in-app)."""
        try:
            if not str(url).startswith(("http://", "https://")):
                return _err("Only http(s) URLs allowed")
            import webbrowser
            webbrowser.open(str(url))
            return _ok(True)
        except Exception as e:
            return _err(e)

    # --- Schematics ---

    def search_schematics(self, params=None):
        params = params or {}
        try:
            success, data = self.api.search_schematics(
                search=params.get("search", ""),
                category=params.get("category", ""),
                page=int(params.get("page", 1)),
            )
            if not success and self._offline_ok(data):
                return self._search_schematics_offline(params, data)
            return _wrap(success, data)
        except Exception as e:
            if self._offline_ok(e):
                return self._search_schematics_offline(params, e)
            return _err(e)

    def _search_schematics_offline(self, params, original_error):
        try:
            data = self.local_db.search_ds_schematics(
                search=params.get("search", ""),
                category=params.get("category", ""),
                page=int(params.get("page", 1)),
            )
            if not data["results"] and not self.local_db.ds_counts()["schematics"]:
                return _err(original_error)
            logger.info("search_schematics served from offline mirror")
            return _ok(data)
        except Exception as e:
            logger.error("offline schematics fallback failed: %s", e, exc_info=True)
            return _err(original_error)

    def get_schematic(self, schematic_id):
        try:
            success, data = self.api.get_schematic(str(schematic_id))
            if not success and self._offline_ok(data):
                return self._get_schematic_offline(schematic_id, data)
            return _wrap(success, data)
        except Exception as e:
            if self._offline_ok(e):
                return self._get_schematic_offline(schematic_id, e)
            return _err(e)

    def _get_schematic_offline(self, schematic_id, original_error):
        """Full detail from the mirror when the schematic_details export is synced:
        ingredients/components/formulas from the slim payload, current/best resource
        lists recomputed from ds_resources with the same weighted-quality math the
        frontend uses. Falls back to catalog-only when details aren't synced yet."""
        try:
            row = self.local_db.get_ds_schematic(schematic_id)
            detail = self.local_db.get_ds_schematic_detail(schematic_id)
            if not row and not detail:
                return _err(original_error)

            if not detail:
                return _ok({"schematic": {
                    "schematicId": row.get("id"),
                    "schematicName": row.get("name", ""),
                    "schematicCategoryParent": row.get("parent", ""),
                    "crateSize": row.get("crate_size", 0),
                }, "offline": True})

            schematic = dict(detail)
            if row:  # catalog carries the community crate override
                schematic["crateSize"] = row.get("crate_size") or schematic.get("crateSize") or 100
                schematic.setdefault("schematicCategoryParent", row.get("parent", ""))

            weights = _parse_formula_weights(schematic.get("formula") or [])
            for block in schematic.get("resourceDtoList") or []:
                code = block.get("resourceTypeCode") or ""
                if not code:
                    continue
                leafs = self.dataset_sync.expand_category(code) or [code]
                pool = self.local_db.search_ds_resources(
                    type_codes=leafs, status="", perpage=3000)["results"]
                spawns = sorted(
                    (_spawn_entry(r, weights) for r in pool),
                    key=lambda s: s["resourceQuality"], reverse=True)
                block["serverBestResourceList"] = spawns[:10]
                block["currentBestResourceList"] = [s for s in spawns if s["active"] == "1"][:10]

            logger.info("get_schematic %s served from offline mirror", schematic_id)
            return _ok({"schematic": schematic, "spawn_data": {}, "offline": True})
        except Exception:
            logger.error("offline schematic detail failed", exc_info=True)
            return _err(original_error)

    def get_pinned_schematics(self):
        try:
            return _ok(self.config.get_pinned_schematics())
        except Exception as e:
            return _err(e)

    def toggle_pin_schematic(self, schematic_id):
        try:
            self.config.toggle_pinned_schematic(str(schematic_id))
            return _ok(self.config.get_pinned_schematics())
        except Exception as e:
            return _err(e)

    # --- Sales ---

    def get_sales(self, params=None):
        params = params or {}
        try:
            return _wrap(*self.api.get_sales(
                search=params.get("search", ""),
                sale_type=params.get("type", ""),
                page=int(params.get("page", 1)),
                limit=int(params.get("limit", 50)),
                sort=params.get("sort", ""),
                order=params.get("order", ""),
            ))
        except Exception as e:
            return _err(e)

    # --- Stockpile ---

    def get_stockpile(self, params=None):
        params = params or {}
        try:
            return _wrap(*self.api.get_stockpile(
                search=params.get("search", ""),
                page=int(params.get("page", 1)),
                perpage=int(params.get("perpage", 100)),
                sort=params.get("sort", "name"),
                order=params.get("order", "ASC"),
            ))
        except Exception as e:
            return _err(e)

    def add_to_stockpile(self, resource_id):
        try:
            return _wrap(*self.api.add_to_stockpile(int(resource_id)))
        except Exception as e:
            return _err(e)

    def update_stockpile(self, stockpile_id, stock=None, my_cpu="__unset__"):
        try:
            return _wrap(*self.api.update_stockpile(
                int(stockpile_id),
                stock=int(stock) if stock is not None else None,
                my_cpu=my_cpu))
        except Exception as e:
            return _err(e)

    def remove_from_stockpile(self, stockpile_id):
        try:
            return _wrap(*self.api.remove_from_stockpile(int(stockpile_id)))
        except Exception as e:
            return _err(e)

    # --- Wishlist ---

    def get_wishlist(self, params=None):
        params = params or {}
        try:
            return _wrap(*self.api.get_wishlist(
                search=params.get("search", ""),
                page=int(params.get("page", 1)),
                perpage=int(params.get("perpage", 100)),
                sort=params.get("sort", ""),
                order=params.get("order", ""),
            ))
        except Exception as e:
            return _err(e)

    def add_to_wishlist(self, resource_id):
        try:
            return _wrap(*self.api.add_to_wishlist(int(resource_id)))
        except Exception as e:
            return _err(e)

    def promote_wishlist(self, wishlist_id):
        try:
            return _wrap(*self.api.promote_wishlist(int(wishlist_id)))
        except Exception as e:
            return _err(e)

    def update_wishlist_item(self, params=None):
        params = params or {}
        try:
            wtb_amount = params.get("wtb_amount")
            wtb_cpu = params.get("wtb_cpu")
            is_private = params.get("isPrivate")
            return _wrap(*self.api.update_wishlist_item(
                wishlist_id=int(params.get("wishlist_id")),
                wtb_amount=int(wtb_amount) if wtb_amount is not None else None,
                wtb_cpu=float(wtb_cpu) if wtb_cpu is not None else None,
                is_private=int(is_private) if is_private is not None else None,
            ))
        except Exception as e:
            return _err(e)

    def remove_from_wishlist(self, wishlist_id):
        try:
            return _wrap(*self.api.remove_from_wishlist(int(wishlist_id)))
        except Exception as e:
            return _err(e)

    # --- My Schematics ---

    def get_my_schematics(self, params=None):
        params = params or {}
        try:
            return _wrap(*self.api.get_my_schematics(
                search=params.get("search", ""),
                page=int(params.get("page", 1)),
                perpage=int(params.get("perpage", 100)),
            ))
        except Exception as e:
            return _err(e)

    def add_to_my_schematics(self, params=None):
        # Back-compat: a bare schematic_id (int/str) still works.
        if not isinstance(params, dict):
            params = {"schematic_id": params}
        try:
            return _wrap(*self.api.add_to_my_schematics(
                int(params.get("schematic_id")),
                formulas=str(params.get("formulas", "")),
                custom_name=str(params.get("custom_name", "")),
            ))
        except Exception as e:
            return _err(e)

    def rename_my_schematic(self, params=None):
        params = params or {}
        try:
            return _wrap(*self.api.rename_my_schematic(
                int(params.get("user_schematic_id")),
                str(params.get("custom_name", "")),
            ))
        except Exception as e:
            return _err(e)

    def remove_from_my_schematics(self, user_schematic_id):
        try:
            return _wrap(*self.api.remove_from_my_schematics(int(user_schematic_id)))
        except Exception as e:
            return _err(e)

    def accept_my_schematic_resource(self, params=None):
        params = params or {}
        try:
            return _wrap(*self.api.accept_my_schematic_resource(
                int(params.get("id")), bool(params.get("accepted"))))
        except Exception as e:
            return _err(e)

    def update_my_schematic_resource(self, params=None):
        params = params or {}
        try:
            return _wrap(*self.api.update_my_schematic_resource(
                row_id=int(params.get("id")),
                resource_name=str(params.get("resource_name", "")).strip(),
            ))
        except Exception as e:
            return _err(e)

    # --- Inventory ---

    def get_inventory(self, params=None):
        params = params or {}
        try:
            threshold = params.get("threshold")
            return _wrap(*self.api.get_inventory(
                search=params.get("search", ""),
                page=int(params.get("page", 1)),
                perpage=int(params.get("perpage", 100)),
                sort=params.get("sort", ""),
                order=params.get("order", ""),
                inventory_type=params.get("inventory_type", ""),
                threshold=int(threshold) if threshold is not None else None,
            ))
        except Exception as e:
            return _err(e)

    def add_inventory_item(self, params=None):
        params = params or {}
        try:
            stocked = params.get("stocked")
            threshold = params.get("threshold")
            return _wrap(*self.api.add_inventory_item(
                item_name=str(params.get("item_name", "")).strip(),
                stocked=int(stocked) if stocked is not None else None,
                threshold=int(threshold) if threshold is not None else None,
            ))
        except Exception as e:
            return _err(e)

    def update_inventory_item(self, params=None):
        params = params or {}
        try:
            stocked = params.get("stocked")
            threshold = params.get("threshold")
            return _wrap(*self.api.update_inventory_item(
                inventory_id=int(params.get("inventory_id")),
                stocked=int(stocked) if stocked is not None else None,
                threshold=int(threshold) if threshold is not None else None,
                vendor=params.get("vendor"),
                match_price=params.get("match_price"),
            ))
        except Exception as e:
            return _err(e)

    def sale_buyers(self, days=0):
        """Distinct customers from your sales — for in-game mailings."""
        try:
            return _wrap(*self.api.get_sale_buyers(int(days or 0)))
        except Exception as e:
            return _err(e)

    def inventory_sales(self, inventory_id):
        """Sales linked to one inventory item (what auto-depleted it)."""
        try:
            return _wrap(*self.api.get_inventory_sales(int(inventory_id)))
        except Exception as e:
            return _err(e)

    def remove_inventory_item(self, inventory_id):
        try:
            return _wrap(*self.api.remove_inventory_item(int(inventory_id)))
        except Exception as e:
            return _err(e)

    def get_class_pool(self, class_code, active_only=False):
        """All mirror resources under a class code (any tree depth), with stats,
        caps, eCPU, spawn state — the Laboratory computes rates client-side."""
        try:
            leafs = self.dataset_sync.expand_category(str(class_code)) or [str(class_code)]
            data = self.local_db.search_ds_resources(
                type_codes=leafs, status="active" if active_only else "",
                perpage=5000, sort="timestamp", order="DESC")
            return _ok(data)
        except Exception as e:
            return _err(e)

    _POOL_FIELDS = ("id", "name", "type_name", "status", "cpu", "planet_mustafar",
                    "oq", "cr", "cd", "dr", "hr", "ma", "sr", "ut", "fl", "pe",
                    "oq_max", "cr_max", "cd_max", "dr_max", "hr_max", "ma_max",
                    "sr_max", "ut_max", "fl_max", "pe_max")

    def get_class_pool(self, code, limit=4000):
        """Every mirror resource under a class code — the Lab's per-slot pools.
        Mirror-backed and slimmed to Lab fields (big classes were ~4MB otherwise,
        heavy enough to drop js_api responses)."""
        try:
            leafs = self.dataset_sync.expand_category(str(code)) or [str(code)]
            data = self.local_db.search_ds_resources(
                type_codes=leafs, status="", perpage=int(limit),
                sort="timestamp", order="DESC")
            return _ok([{k: r.get(k) for k in self._POOL_FIELDS} for r in data["results"]])
        except Exception as e:
            return _err(e)

    def get_schematic_names(self, ids=None):
        """Resolve schematic ids -> names from the offline mirror (no network).
        Used by the alert editor to label pinned schematics instantly."""
        try:
            out = {}
            for sid in (ids or [])[:100]:
                row = self.local_db.get_ds_schematic(sid) if self.local_db else None
                if row:
                    out[str(sid)] = {"name": row.get("name", ""), "parent": row.get("parent", "")}
            return _ok(out)
        except Exception as e:
            return _err(e)

    # --- Spawn alerts ---

    def get_alerts(self, params=None):
        params = params or {}
        try:
            return _wrap(*self.api.get_alerts(since_id=int(params.get("since_id", 0))))
        except Exception as e:
            return _err(e)

    def save_alert(self, rule=None):
        try:
            return _wrap(*self.api.save_alert(rule or {}))
        except Exception as e:
            return _err(e)

    def delete_alert(self, rule_id):
        try:
            return _wrap(*self.api.delete_alert(int(rule_id)))
        except Exception as e:
            return _err(e)

    def mark_alerts_seen(self, ids="all"):
        try:
            return _wrap(*self.api.mark_alerts_seen(ids))
        except Exception as e:
            return _err(e)

    def notify(self, title, message):
        """Native desktop notification (gated by the show_notifications setting)."""
        try:
            if not self.config.get("show_notifications", True):
                return _ok(False)
            import subprocess, sys
            title, message = str(title)[:80], str(message)[:200]
            if sys.platform == "darwin":
                # osascript: thread-safe and always shows. NSUserNotification
                # looked nicer (our logo) but delivers silently into the void
                # from a background thread / unauthorized bare-python process —
                # the packaged .app gets proper branded banners instead
                subprocess.Popen(["osascript", "-e",
                    'display notification "{}" with title "{}" sound name "Glass"'.format(
                        message.replace('"', "'"), title.replace('"', "'"))])
            elif sys.platform == "win32":
                ps = ("[Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType=WindowsRuntime] > $null;"
                      "$t=[Windows.UI.Notifications.ToastNotificationManager]::GetTemplateContent([Windows.UI.Notifications.ToastTemplateType]::ToastText02);"
                      "$t.GetElementsByTagName('text')[0].AppendChild($t.CreateTextNode('{0}')) > $null;"
                      "$t.GetElementsByTagName('text')[1].AppendChild($t.CreateTextNode('{1}')) > $null;"
                      "[Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier('SWG Tracker Desktop').Show("
                      "[Windows.UI.Notifications.ToastNotification]::new($t))").format(
                          title.replace("'", ""), message.replace("'", ""))
                subprocess.Popen(["powershell", "-NoProfile", "-Command", ps],
                                 creationflags=0x08000000)  # CREATE_NO_WINDOW
            return _ok(True)
        except Exception as e:
            logger.error("notify failed: %s", e)
            return _err(e)

    # --- Shared lookups ---

    def get_categories(self):
        try:
            return _wrap(*self.api.get_categories())
        except Exception as e:
            return _err(e)

    def search(self, query):
        try:
            return _wrap(*self.api.search(query))
        except Exception as e:
            return _err(e)

    # --- Config ---

    def get_config(self):
        try:
            cfg = self.config.get_all()
            return _ok({
                # The key belongs to the local user; Settings shows it masked with a reveal toggle.
                "api_key": cfg.get("api_key", ""),
                "has_api_key": bool(cfg.get("api_key")),
                "show_notifications": cfg.get("show_notifications", True),
                "minimize_to_tray": cfg.get("minimize_to_tray", True),
                "auto_start_monitoring": cfg.get("auto_start_monitoring", False),
                # honored by the mail monitor once it lands: uploaded .mail files
                # are deleted from the SWG profile folder to keep it small
                "delete_mail_after_upload": cfg.get("delete_mail_after_upload", False),
                "has_deploy_token": bool(cfg.get("deploy_token")),  # boolean only — the token stays out of JS
                "alert_poll_interval": cfg.get("alert_poll_interval", 300),
                "mail_paths": cfg.get("mail_paths", []),
                "alerts": cfg.get("alerts", []),
                # Laboratory: saved experiments (picks + notes) and boost/cap settings
                "lab_experiments": cfg.get("lab_experiments", []),
                "lab_settings": cfg.get("lab_settings", {}),
            })
        except Exception as e:
            return _err(e)

    def set_config(self, key, value):
        try:
            self.config.set(key, value)
            self.config.save()
            # A new API key must take effect without restarting the app.
            if key == "api_key":
                self.api.api_key = value
                self.api.session.headers["X-API-Key"] = value
            return _ok(True)
        except Exception as e:
            return _err(e)

    # --- Connection / monitoring (delegated to the app controller) ---

    def test_connection(self):
        try:
            if self.controller:
                success, message = self.controller.test_connection()
            else:
                success, message = self.api.test_connection()
            return {"ok": bool(success), "data": message, "error": None if success else message}
        except Exception as e:
            return _err(e)

    def dev_deploy_bundle(self, notes=""):
        """Dev tool: build + deploy the current web/ as a live bundle by
        running build/publish_bundle.py --deploy (the tested pipeline).
        Only useful on a source checkout with deploy_token configured."""
        try:
            if not self.config.get("deploy_token"):
                return _err("No deploy_token configured")
            import subprocess
            import sys
            from pathlib import Path
            root = Path(__file__).resolve().parent.parent
            script = root / "build" / "publish_bundle.py"
            if not script.is_file():
                return _err("publish_bundle.py not found (packaged build?)")
            proc = subprocess.run(
                [sys.executable, str(script), "--deploy", "--notes", str(notes or "")],
                capture_output=True, text=True, timeout=120, cwd=str(root))
            out = (proc.stdout + proc.stderr).strip()
            if proc.returncode != 0:
                return _err(out.splitlines()[-1] if out else "deploy failed")
            import re
            m = re.search(r"DEPLOYED — (\S+)", out)
            ver = re.search(r"bundles/([0-9.]+)\.zip", m.group(1)) if m else None
            return _ok({"version": ver.group(1) if ver else "?",
                        "url": m.group(1) if m else ""})
        except Exception as e:
            return _err(e)

    def bundle_history(self):
        """Public UI release history (version · published · notes)."""
        try:
            return _wrap(*self.api.get_bundle_history())
        except Exception as e:
            return _err(e)

    def bundle_state(self):
        """Thin-client state: active UI source/version + any pending update."""
        try:
            b = getattr(self, "bundles", None)
            return _ok(b.state() if b else {"enabled": False})
        except Exception as e:
            return _err(e)

    def bundle_check_now(self):
        """Manual check+install; returns the new pending version if any."""
        try:
            b = getattr(self, "bundles", None)
            if not b or not b.enabled():
                return _ok(None)
            info = b.check()
            if info and b.install(info):
                return _ok(b.state())
            return _ok(b.state())
        except Exception as e:
            return _err(e)

    def bundle_apply(self):
        """Hot-swap the UI to the freshly installed bundle."""
        try:
            b = getattr(self, "bundles", None)
            reload_ui = getattr(self, "reload_ui", None)
            if not b or not b.pending or not callable(reload_ui):
                return _err("nothing to apply")
            b.pending = None
            import threading
            # let this bridge call return before the page unloads beneath it
            threading.Timer(0.2, reload_ui).start()
            return _ok(True)
        except Exception as e:
            return _err(e)

    def bundle_mark_ok(self):
        """UI boot completed — confirm the active bundle as known-good."""
        try:
            b = getattr(self, "bundles", None)
            if b:
                b.mark_boot_ok()
            return _ok(True)
        except Exception as e:
            return _err(e)

    def mail_history(self, limit=200):
        """Uploaded-mail ledger, newest first — the Mail page's table."""
        try:
            return _ok(self.local_db.mail_history(int(limit)))
        except Exception as e:
            return _err(e)

    def mail_raw(self, mail_id):
        """Full original mail file content for the raw viewer."""
        try:
            return _ok(self.local_db.mail_raw(str(mail_id)))
        except Exception as e:
            return _err(e)

    def delete_mail(self, mail_id):
        """Remove a mail everywhere: server rows (incoming_mail/sales/purchases,
        restocking any depleted inventory), the local ledger row, and the .mail
        file itself (else the next sweep would just re-upload it)."""
        try:
            mail_id = str(mail_id).strip()
            if not mail_id or "/" in mail_id or ".." in mail_id:
                return _err("bad mail id")
            ok, data = self.api.delete_mail(mail_id)
            if not ok:
                return _err(data)
            self.local_db.mail_ledger_delete(mail_id)
            from pathlib import Path
            for entry in self.config.get("mail_paths", []) or []:
                raw = entry.get("path") if isinstance(entry, dict) else entry
                if not raw:
                    continue
                f = Path(str(raw)).expanduser() / f"{mail_id}.mail"
                if f.is_file():
                    try:
                        f.unlink()
                    except OSError:
                        pass
            return _ok(data)
        except Exception as e:
            return _err(e)

    def dev_make_test_mail(self):
        """Dev tool: drop a faker vendor-sale .mail into the first configured
        folder. Ids are test-prefixed and items [TEST]-marked so everything is
        easy to purge later — locally and in the server tables."""
        try:
            import random
            import time as _time
            from pathlib import Path
            paths = self.config.get("mail_paths", []) or []
            raw = paths[0].get("path") if paths and isinstance(paths[0], dict) else (paths[0] if paths else None)
            if not raw:
                return _err("No mail folder configured — add one in Settings")
            folder = Path(str(raw)).expanduser()
            if not folder.is_dir():
                return _err(f"Folder not found: {folder}")
            mail_id = f"test{int(_time.time() * 1000)}"
            # prefer a real My Inventory item so the sale exercises the whole
            # pipeline: upload → cron parse → sales row → inventory depletion
            item = None
            credits = None
            try:
                ok, data = self.api.get_inventory(perpage=500)
                rows = (data or {}).get("results") if ok and isinstance(data, dict) else None
                if rows:
                    pick = random.choice(rows)
                    item = str(pick.get("item_name") or "").strip() or None
                    mp = str(pick.get("match_price") or "").strip()
                    if mp.isdigit():
                        credits = int(mp)  # price-tier matching needs the exact amount
            except Exception:
                logger.debug("test mail: inventory lookup failed", exc_info=True)
            if not item:
                item = "[TEST] " + random.choice([
                    "DE-10 Pistol 750+120 - 88 - 2.10",
                    "UL Composite Armor Helmet 7000/5000/6000",
                    "CL54 'Shockfire' CDEF Carbine 753+160",
                ])
            buyer = random.choice(["Thake Darkcloud", "Ariana Morassi", "Nitoetao", "Vyrul Thane", "Remiella Witka"])
            if credits is None:
                credits = random.randrange(500, 50001, 25)
            ts = int(_time.time())
            content = (f"{mail_id}\n"
                       "SWG.Restoration.auctioner\n"
                       "Vendor Sale Complete\n"
                       f"TIMESTAMP: {ts}\n"
                       f"Vendor: Test Vendor has sold {item} to {buyer} for {credits} credits.")
            (folder / f"{mail_id}.mail").write_text(content, encoding="utf-8")
            return _ok({"file": f"{mail_id}.mail", "item": item, "credits": credits})
        except Exception as e:
            return _err(e)

    def monitor_state(self):
        """Live mail-monitor status for the header/status polling."""
        if not self.controller or not hasattr(self.controller, "state"):
            return _err("Monitoring controller unavailable")
        try:
            return _ok(self.controller.state())
        except Exception as e:
            return _err(e)

    def pick_folder(self):
        """Native folder picker (Finder/Explorer) for the Settings mail paths."""
        try:
            import webview
            res = webview.windows[0].create_file_dialog(webview.FOLDER_DIALOG)
            return _ok(res[0] if res else None)
        except Exception as e:
            return _err(e)

    def start_monitoring(self):
        if not self.controller:
            return _err("Monitoring controller unavailable")
        try:
            success, message = self.controller.start_monitoring()
            return {"ok": bool(success), "data": message, "error": None if success else message}
        except Exception as e:
            return _err(e)

    def stop_monitoring(self):
        if not self.controller:
            return _err("Monitoring controller unavailable")
        try:
            success, message = self.controller.stop_monitoring()
            return {"ok": bool(success), "data": message, "error": None if success else message}
        except Exception as e:
            return _err(e)
