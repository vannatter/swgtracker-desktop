"""
API Client for swgtracker.com communication.

Auth: X-API-Key header (required for mail/sales/purchases, optional for resources/schematics).
"""
from __future__ import annotations

import json
import logging
import requests
from typing import Optional

logger = logging.getLogger(__name__)

BASE_URL = "https://swgtracker.com"


class SWGTrackerAPI:
    """Handle all API communication with swgtracker.com"""

    TIMEOUT = 15

    def __init__(self, api_key: str):
        self.api_key = api_key
        # Testing hook (Settings → Offline Data): fail every request as if the
        # network were down, so the offline fallbacks/banner can be exercised.
        self.simulate_offline = False
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'Accept': 'application/json',
            'X-API-Key': api_key,
        })

    def _request(self, method: str, endpoint: str, data: Optional[dict] = None,
                 params: Optional[dict] = None) -> tuple[bool, dict | str]:
        """Make an authenticated request to the API."""
        if self.simulate_offline:
            return False, "Connection error (simulated offline)"
        url = f"{BASE_URL}/{endpoint}"

        try:
            if method == 'GET':
                response = self.session.get(url, params=params, timeout=self.TIMEOUT)
            elif method == 'PUT':
                response = self.session.put(
                    url, data=json.dumps(data or {}), timeout=self.TIMEOUT
                )
            elif method == 'DELETE':
                response = self.session.delete(
                    url, data=json.dumps(data or {}), timeout=self.TIMEOUT
                )
            else:
                response = self.session.post(
                    url, data=json.dumps(data or {}), timeout=self.TIMEOUT
                )

            response.raise_for_status()

            try:
                return True, response.json()
            except ValueError:
                return True, response.text

        except requests.exceptions.Timeout:
            logger.error(f"Request timed out: {endpoint}")
            return False, "Request timed out"
        except requests.exceptions.ConnectionError:
            logger.error(f"Connection error: {endpoint}")
            return False, "Connection error - check your internet connection"
        except requests.exceptions.HTTPError as e:
            status = e.response.status_code
            # The API returns {"error": "..."} bodies — surface the real message.
            message = None
            try:
                message = e.response.json().get("error")
            except Exception:
                pass
            if status == 401:
                return False, message or "Invalid API key"
            logger.error(f"HTTP error: {status} for {endpoint} - {message}")
            return False, message or f"HTTP error: {status}"
        except Exception as e:
            logger.error(f"Unexpected error: {e}", exc_info=True)
            return False, f"Unexpected error: {str(e)}"

    # --- Mail upload (requires auth) ---

    def send_mail_content(self, mail_content: str) -> tuple[bool, str]:
        """POST /api/mail.php - Send mail file content."""
        success, result = self._request('POST', 'api/mail.php', data={
            'incomingData': mail_content
        })
        if success:
            return True, "Uploaded successfully"
        # 409 duplicates now come back as failures with the server's message
        if isinstance(result, str) and "uplicate" in result:
            return True, "Already processed (duplicate)"
        return False, result if isinstance(result, str) else "Upload failed"

    def test_connection(self) -> tuple[bool, str]:
        """Test API connection and key validity via mail endpoint."""
        success, result = self._request('POST', 'api/mail.php', data={
            'incomingData': 'CONNECTION_TEST'
        })
        if success:
            return True, "Connection successful - API key valid"
        if isinstance(result, str) and "Invalid API key" in result:
            return False, "Invalid API key"
        return False, f"Connection failed: {result}"

    # --- Search (no auth) ---

    def search(self, query: str) -> tuple[bool, dict | str]:
        """GET /api/search.php?q= - Quick search across everything."""
        return self._request('GET', 'api/search.php', params={"q": query})

    # --- Resources (auth optional) ---

    def get_resource(self, name: str) -> tuple[bool, dict | str]:
        """GET /api/resources.php?name= - Single resource detail by name."""
        return self._request('GET', 'api/resources.php', params={"name": name})

    def search_resources(self, search: str = "", planet: str = "",
                         category: str = "", status: str = "active",
                         page: int = 1, perpage: int = 50,
                         sort: str = "", order: str = "") -> tuple[bool, dict | str]:
        """GET /api/resources.php - Resource list/search with filters + server-side sort."""
        params = {"page": str(page), "perpage": str(perpage)}
        if search:
            params["search"] = search
        if planet:
            params["planet"] = planet
        if category:
            params["category"] = category
        if status:
            params["status"] = status
        if sort:
            params["sort"] = sort
        if order:
            params["order"] = order
        return self._request('GET', 'api/resources.php', params=params)

    def get_resource_by_name(self, name: str) -> tuple[bool, dict | str]:
        """GET /api/resources.php?name= - Single resource detail.

        Returns {resource: {... + score/score_rank/score_of/score_percentile},
        top_uses: [...], used_ins: [...], similar: [...]}.
        """
        return self._request('GET', 'api/resources.php', params={"name": name})

    # --- Schematics (auth optional) ---

    def get_schematic(self, schematic_id: str) -> tuple[bool, dict | str]:
        """GET /api/schematics.php?id= - Single schematic detail."""
        return self._request('GET', 'api/schematics.php', params={"id": schematic_id})

    def search_schematics(self, search: str = "", category: str = "",
                          page: int = 1) -> tuple[bool, dict | str]:
        """GET /api/schematics.php?search= - Schematic list/search."""
        params = {"page": str(page)}
        if search:
            params["search"] = search
        if category:
            params["category"] = category
        return self._request('GET', 'api/schematics.php', params=params)

    # --- Cities (no auth) ---

    def search_cities(self, search: str = "") -> tuple[bool, dict | str]:
        """GET /api/cities.php?search= - City list/search."""
        params = {}
        if search:
            params["search"] = search
        return self._request('GET', 'api/cities.php', params=params)

    # --- Guilds (no auth) ---

    def search_guilds(self, search: str = "") -> tuple[bool, dict | str]:
        """GET /api/guilds.php?search= - Guild list/search."""
        params = {}
        if search:
            params["search"] = search
        return self._request('GET', 'api/guilds.php', params=params)

    # --- Sales & Purchases (requires auth) ---

    def get_sales(self, search: str = "", sale_type: str = "",
                  page: int = 1, limit: int = 50,
                  sort: str = "", order: str = "") -> tuple[bool, dict | str]:
        """GET /api/sales.php - User's sales history."""
        params = {"page": str(page), "limit": str(limit)}
        if search:
            params["search"] = search
        if sale_type:
            params["type"] = sale_type
        if sort:
            params["sort"] = sort
        if order:
            params["order"] = order
        return self._request('GET', 'api/sales.php', params=params)

    def get_purchases(self) -> tuple[bool, dict | str]:
        """GET /api/purchases.php - User's purchase history."""
        return self._request('GET', 'api/purchases.php')

    # --- Alerts / Spawn checking ---

    def check_spawns(self, since_minutes: int = 30) -> tuple[bool, dict | str]:
        """GET /api/new_spawns.php - Check for new resource spawns."""
        return self._request('GET', 'api/new_spawns.php', params={"since": str(since_minutes)})

    # --- Server status / pulse ---

    def get_server_status(self) -> tuple[bool, dict | str]:
        """GET /api/server_status.php - Population and status."""
        return self._request('GET', 'api/server_status.php')

    def get_pulse(self) -> tuple[bool, dict | str]:
        """GET /api/pulse.php - Server pulse: online count, top resources, cities, GCW."""
        return self._request('GET', 'api/pulse.php')

    # --- Stockpile (requires auth) ---

    def get_stockpile(self, search: str = "", page: int = 1, perpage: int = 100,
                      sort: str = "name", order: str = "ASC") -> tuple[bool, dict | str]:
        """GET /api/stockpile.php - User's resource stockpile."""
        params = {"page": str(page), "perpage": str(perpage), "sort": sort, "order": order}
        if search:
            params["search"] = search
        return self._request('GET', 'api/stockpile.php', params=params)

    def add_to_stockpile(self, resource_id: int) -> tuple[bool, dict | str]:
        """POST /api/stockpile.php - Add a resource to stockpile."""
        return self._request('POST', 'api/stockpile.php', data={"resource_id": resource_id})

    def update_stockpile(self, stockpile_id: int, stock=None, my_cpu="__unset__") -> tuple[bool, dict | str]:
        """PUT /api/stockpile.php - Update stock and/or my_cpu (personal cost/unit;
        None clears it, 0 = self-mined)."""
        data = {"stockpile_id": stockpile_id}
        if stock is not None:
            data["stock"] = int(stock)
        if my_cpu != "__unset__":
            data["my_cpu"] = my_cpu
        return self._request('PUT', 'api/stockpile.php', data=data)

    def remove_from_stockpile(self, stockpile_id: int) -> tuple[bool, dict | str]:
        """DELETE /api/stockpile.php - Remove from stockpile."""
        return self._request('DELETE', 'api/stockpile.php', data={"stockpile_id": stockpile_id})

    # --- Wishlist (requires auth; same table as stockpile, status >= 5) ---

    def get_wishlist(self, search: str = "", page: int = 1, perpage: int = 100,
                     sort: str = "", order: str = "") -> tuple[bool, dict | str]:
        """GET /api/wishlist.php - List wishlist (resource records + wishlist_id, score)."""
        params = {"page": str(page), "perpage": str(perpage)}
        if search:
            params["search"] = search
        if sort:
            params["sort"] = sort
        if order:
            params["order"] = order
        return self._request('GET', 'api/wishlist.php', params=params)

    def add_to_wishlist(self, resource_id: int) -> tuple[bool, dict | str]:
        """POST /api/wishlist.php - Add; 409 says which list it's already on."""
        return self._request('POST', 'api/wishlist.php', data={"resource_id": resource_id})

    def promote_wishlist(self, wishlist_id: int) -> tuple[bool, dict | str]:
        """PUT /api/wishlist.php - Promote wishlist entry to the stockpile.

        NOTE: a BARE wishlist_id body means promote; update_wishlist_item always
        sends extra fields so the server can tell the two apart.
        """
        return self._request('PUT', 'api/wishlist.php', data={"wishlist_id": wishlist_id})

    def update_wishlist_item(self, wishlist_id: int, wtb_amount: int | None = None,
                             wtb_cpu: float | None = None,
                             is_private: int | None = None) -> tuple[bool, dict | str]:
        """PUT /api/wishlist.php - Update WTB amount/CPU or the public flag.

        Contract assumed (id + at least one field = update, never promote);
        field names wtb_amount / wtb_cpu / isPrivate — confirm on deploy.
        """
        data: dict = {"wishlist_id": wishlist_id}
        if wtb_amount is not None:
            data["wtb_amount"] = wtb_amount
        if wtb_cpu is not None:
            data["wtb_cpu"] = wtb_cpu
        if is_private is not None:
            data["isPrivate"] = is_private
        if len(data) == 1:
            return False, "No fields to update"
        return self._request('PUT', 'api/wishlist.php', data=data)

    def remove_from_wishlist(self, wishlist_id: int) -> tuple[bool, dict | str]:
        """DELETE /api/wishlist.php - Remove from wishlist."""
        return self._request('DELETE', 'api/wishlist.php', data={"wishlist_id": wishlist_id})

    # --- My Schematics (requires auth; crafting list + per-ingredient resources) ---

    def get_my_schematics(self, search: str = "", page: int = 1,
                          perpage: int = 100) -> tuple[bool, dict | str]:
        """GET /api/my_schematics.php - Crafting list.

        Rows: user_schematic_id, schematic_id, name, formulas, formula_labels,
        resources[] {id, resource_type, type_name, resource_label, resource_name,
        resource: {id, score, oq, in_spawn} | null}.
        NOTE: write methods TBD — endpoint not yet deployed to production.
        """
        params = {"page": str(page), "perpage": str(perpage)}
        if search:
            params["search"] = search
        return self._request('GET', 'api/my_schematics.php', params=params)

    def add_to_my_schematics(self, schematic_id: int, formulas: str = "",
                             custom_name: str = "") -> tuple[bool, dict | str]:
        """POST /api/my_schematics.php - Add a schematic to the crafting list.

        formulas: CSV of formula ids (weights the upgrade analysis). custom_name:
        optional label so the same schematic can be tracked twice with different
        formulas/resources (multi-loadout). Duplicates are allowed by the server.
        """
        data: dict = {"schematic_id": schematic_id}
        if formulas:
            data["formulas"] = formulas
        if custom_name:
            data["custom_name"] = custom_name
        return self._request('POST', 'api/my_schematics.php', data=data)

    def rename_my_schematic(self, user_schematic_id: int,
                            custom_name: str) -> tuple[bool, dict | str]:
        """PUT /api/my_schematics.php - Rename a crafting entry (loadout label)."""
        return self._request('PUT', 'api/my_schematics.php',
                             data={"user_schematic_id": user_schematic_id, "custom_name": custom_name})

    def update_my_schematic_resource(self, row_id: int,
                                     resource_name: str) -> tuple[bool, dict | str]:
        """PUT /api/my_schematics.php - Set the resource used for one ingredient.

        Contract confirmed against the live endpoint: resource_row_id + resource_name.
        """
        return self._request('PUT', 'api/my_schematics.php',
                             data={"resource_row_id": row_id, "resource_name": resource_name})

    def accept_my_schematic_resource(self, row_id: int, accepted: bool) -> tuple[bool, dict | str]:
        """PUT /api/my_schematics.php - mute/unmute upgrade nags for one slot."""
        return self._request('PUT', 'api/my_schematics.php',
                             data={"resource_row_id": int(row_id), "accepted": 1 if accepted else 0})

    def remove_from_my_schematics(self, user_schematic_id: int) -> tuple[bool, dict | str]:
        """DELETE /api/my_schematics.php - Remove a schematic from the crafting list.

        Body shape assumed ({"user_schematic_id": N}) pending the full endpoint docs.
        """
        return self._request('DELETE', 'api/my_schematics.php',
                             data={"user_schematic_id": user_schematic_id})

    # --- Inventory (requires auth; crafted-item stock) ---

    def get_inventory(self, search: str = "", page: int = 1, perpage: int = 100,
                      sort: str = "", order: str = "", inventory_type: str = "",
                      threshold: int | None = None) -> tuple[bool, dict | str]:
        """GET /api/inventory.php - List crafted-item inventory."""
        params = {"page": str(page), "perpage": str(perpage)}
        if search:
            params["search"] = search
        if sort:
            params["sort"] = sort
        if order:
            params["order"] = order
        if inventory_type:
            params["inventory_type"] = inventory_type
        if threshold is not None:
            params["threshold"] = str(threshold)
        return self._request('GET', 'api/inventory.php', params=params)

    def add_inventory_item(self, item_name: str, stocked: int | None = None,
                           threshold: int | None = None) -> tuple[bool, dict | str]:
        """POST /api/inventory.php - Add an item (defaults: stocked 10, threshold 1)."""
        data: dict = {"item_name": item_name}
        if stocked is not None:
            data["stocked"] = stocked
        if threshold is not None:
            data["threshold"] = threshold
        return self._request('POST', 'api/inventory.php', data=data)

    def update_inventory_item(self, inventory_id: int, stocked: int | None = None,
                              threshold: int | None = None, vendor: str | None = None,
                              match_price: str | None = None) -> tuple[bool, dict | str]:
        """PUT /api/inventory.php - Update any subset of stocked/threshold/vendor/match_price."""
        data: dict = {"inventory_id": inventory_id}
        if stocked is not None:
            data["stocked"] = stocked
        if threshold is not None:
            data["threshold"] = threshold
        if vendor is not None:
            data["vendor"] = vendor
        if match_price is not None:
            data["match_price"] = match_price
        return self._request('PUT', 'api/inventory.php', data=data)

    def remove_inventory_item(self, inventory_id: int) -> tuple[bool, dict | str]:
        """DELETE /api/inventory.php - Remove an item (clears its sales links)."""
        return self._request('DELETE', 'api/inventory.php', data={"inventory_id": inventory_id})

    # --- Spawn alerts (server-evaluated rules + hits feed) ---

    def get_alerts(self, since_id: int = 0) -> tuple[bool, dict | str]:
        """GET /api/alerts.php - rules + latest hits (+unseen count)."""
        params = {"since_id": since_id} if since_id else None
        return self._request('GET', 'api/alerts.php', params=params)

    def get_bundle_history(self) -> tuple[bool, dict | str]:
        """GET /app/bundle-history.json - public UI release history."""
        return self._request('GET', 'app/bundle-history.json')

    def get_sale_buyers(self, days: int = 0) -> tuple[bool, dict | str]:
        """GET /api/sales.php?action=buyers - distinct customers (optionally windowed)."""
        extra = f'&days={int(days)}' if days else ''
        return self._request('GET', f'api/sales.php?action=buyers{extra}')

    def get_inventory_sales(self, inventory_id: int) -> tuple[bool, dict | str]:
        """GET /api/inventory.php?action=sales - sales that depleted one item."""
        return self._request('GET', f'api/inventory.php?action=sales&id={int(inventory_id)}')

    def delete_mail(self, mail_id: str) -> tuple[bool, dict | str]:
        """DELETE /api/mail.php - purge a mail server-side (incoming_mail, sales, purchases)."""
        from urllib.parse import quote
        return self._request('DELETE', f'api/mail.php?mail_id={quote(str(mail_id))}')

    def save_alert(self, rule: dict) -> tuple[bool, dict | str]:
        """POST /api/alerts.php - create/update a rule; returns rule + backfill."""
        return self._request('POST', 'api/alerts.php', data={"rule": rule})

    def delete_alert(self, rule_id: int) -> tuple[bool, dict | str]:
        return self._request('DELETE', f'api/alerts.php?id={int(rule_id)}')

    def mark_alerts_seen(self, ids="all") -> tuple[bool, dict | str]:
        return self._request('POST', 'api/alerts.php', data={"seen": ids})

    # --- Categories / resource types ---

    def get_categories(self) -> tuple[bool, dict | str]:
        """GET /api/categories.php - Resource types, tree, and schematic categories."""
        return self._request('GET', 'api/categories.php')
