/* My Wishlist page — resources being hunted (api/wishlist.php).
   A resource lives in only one of wishlist/stockpile; promote moves it over. */

// Score always sits before OQ (Dustin's rule, applies on every grid)
const WISH_COLUMNS = [
  ['Name', 'name', 'col-name'],
  ['Type', 'type_name', 'col-text'],
  ['Score', 'score', 'stat'],
  ['OQ', 'oq', 'stat'], ['CR', 'cr', 'stat'], ['CD', 'cd', 'stat'],
  ['DR', 'dr', 'stat'], ['HR', 'hr', 'stat'], ['MA', 'ma', 'stat'],
  ['SR', 'sr', 'stat'], ['UT', 'ut', 'stat'], ['FL', 'fl', 'stat'],
  ['PE', 'pe', 'stat'], ['Rating', 'rating', 'stat'],
  ['WTB Amt', 'wtb_amount', 'stat'],
  ['WTB CPU', 'wtb_cpu', 'stat'],
];
const WISH_NUMERIC = new Set([...STAT_FIELDS, 'score', 'wtb_amount', 'wtb_cpu']);

// resourceIds drives the ♥ marks in other grids (same pattern as stkState)
const wishState = { items: [], sortField: 'score', sortOrder: 'DESC', resourceIds: new Set() };

function buildWishHeader() {
  $('#wish-head').innerHTML = sortableHeaderHtml(
    WISH_COLUMNS, wishState.sortField, wishState.sortOrder,
    '<th class="pin-cell"></th>') + '<th class="pin-cell"></th><th class="pin-cell"></th>';
}

function wishRowHtml(item, idx) {
  const cells = WISH_COLUMNS.map(([, field]) => {
    if (field === 'name') return `<td class="col-name res-name">${escapeHtml(item.name || '')}</td>`;
    if (field === 'type_name') return `<td class="col-text res-type">${escapeHtml(item.type_name || '')}</td>`;
    if (field === 'rating') {
      const v = safeInt(item.rating);
      return v > 0 ? `<td class="stat ${qualityClass(v / 10)}">${v}</td>` : '<td class="stat stat_off">—</td>';
    }
    if (field === 'score') {
      const v = safeInt(item.score);
      return `<td class="stat ${qualityClass(v)}">${v}</td>`; // score is already 0–100
    }
    if (field === 'wtb_amount' || field === 'wtb_cpu') {
      const raw = item[field];
      const shown = raw == null || raw === '' ? '—' : fmtNum(raw);
      return `<td class="stat inv-edit" data-wedit="${field}" data-idx="${idx}" title="Click to edit">${shown}</td>`;
    }
    return statCell(item[field], item[`${field}_max`]);
  }).join('');

  const isPrivate = String(item.isPrivate ?? '0') === '1';
  return `<tr data-idx="${idx}">
    <td class="pin-cell promote-cell" data-promote="${idx}" title="Got it — move to stockpile"><i class="fa-solid fa-cubes"></i></td>
    ${cells}
    <td class="pin-cell ${isPrivate ? '' : 'wish-public'}" data-wvis="${idx}"
        title="${isPrivate ? 'Private — click to show on the public wishlist page' : 'Public — visible on the community wishlist page (click to make private)'}">
        <i class="fa-solid ${isPrivate ? 'fa-eye-slash' : 'fa-eye'}"></i></td>
    <td class="pin-cell" data-wremove="${idx}" title="Remove from wishlist"><i class="fa-solid fa-trash-can"></i></td>
  </tr>`;
}

function wishVisibleItems() {
  const q = $('#wish-search').value.trim().toLowerCase();
  let items = wishState.items;
  if (q) {
    items = items.filter((i) =>
      String(i.name || '').toLowerCase().includes(q) ||
      String(i.type_name || '').toLowerCase().includes(q));
  }
  const { sortField, sortOrder } = wishState;
  const dir = sortOrder === 'DESC' ? -1 : 1;
  return [...items].sort((a, b) => {
    if (WISH_NUMERIC.has(sortField)) return dir * (safeInt(a[sortField]) - safeInt(b[sortField]));
    return dir * String(a[sortField] ?? '').toLowerCase().localeCompare(String(b[sortField] ?? '').toLowerCase());
  });
}

function renderWishlist(statusMsg) {
  buildWishHeader();
  const items = wishVisibleItems();
  const indexed = items.map((item) => [item, wishState.items.indexOf(item)]);
  $('#wish-body').innerHTML = indexed.map(([item, idx]) => wishRowHtml(item, idx)).join('');

  const empty = $('#wish-empty');
  if (!items.length) {
    empty.textContent = wishState.items.length ? 'No matches on your wishlist.' : 'Your wishlist is empty — click a ♥ on any resource.';
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }
  $('#wish-status').textContent = statusMsg ||
    `${items.length}${items.length === wishState.items.length ? '' : ` of ${wishState.items.length}`} resources on wishlist`;
}

async function syncWishlist() {
  $('#wish-loading').hidden = false;
  $('#wish-empty').hidden = true;

  const all = [];
  let page = 1, error = null;
  while (true) {
    let res;
    try { res = await api().get_wishlist({ page, perpage: 500 }); }
    catch (e) { res = { ok: false, error: String(e) }; }
    if (!res.ok || !res.data) { error = res.error; break; }
    const results = res.data.results || [];
    all.push(...results);
    if (results.length < 500) break;
    page++;
  }

  $('#wish-loading').hidden = true;

  if (error) {
    toast(`Wishlist sync failed: ${error}`, false);
    checkAuthError(error);
    if (!all.length) { renderWishlist(`Sync failed: ${error}`); return; }
  }

  wishState.items = all;
  wishState.resourceIds = new Set(all.map((i) => String(i.id)));
  renderWishlist(`Synced ${all.length} resources from server`);
  refreshWishIcons();
}

// Promote: same row becomes a stockpile entry server-side.
async function promoteWishItem(idx) {
  const item = wishState.items[idx];
  if (!item) return { ok: false };
  let res;
  try { res = await api().promote_wishlist(item.wishlist_id); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (res.ok) {
    wishState.items.splice(idx, 1);
    wishState.resourceIds.delete(String(item.id));
    stkState.resourceIds.add(String(item.id)); // optimistic; sync below confirms
    renderWishlist();
    refreshWishIcons();
    refreshAddIcons();
    toast(`${item.name} promoted to your stockpile`);
    syncStockpile();
  } else {
    toast(`Couldn't promote ${item.name}: ${res.error || 'server error'}`, false);
    checkAuthError(res.error);
  }
  return res;
}

// ---- WTB fields + visibility ----
// Server support confirmed 2026-07-04: PUT {wishlist_id + fields} → "updated"
// (row stays on the wishlist); bare {wishlist_id} still promotes.
const WISH_UPDATES_ENABLED = true;
const WISH_UPDATE_MSG = 'Editing needs a wishlist-update API on swgtracker.com — today this call would promote the item to your stockpile instead. Disabled until the server supports it.';

function openWishEditor(cell) {
  if (!WISH_UPDATES_ENABLED) { toast(WISH_UPDATE_MSG, false); return; }
  if (cell.querySelector('input')) return;
  const idx = safeInt(cell.dataset.idx);
  const field = cell.dataset.wedit;
  const item = wishState.items[idx];
  if (!item) return;

  const current = item[field] == null || item[field] === '' ? '' : String(item[field]);
  // text input: shorthand like 300k / 4.5m is allowed
  cell.innerHTML = `<input type="text" inputmode="decimal" class="stock-input" value="${escapeHtml(current)}"
    title="Supports shorthand: 300k, 4m, 4.5m">`;
  const input = cell.querySelector('input');
  input.focus();
  input.select();

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const value = input.value.trim();
    if (!save || value === current) { renderWishlist(); return; }
    const parsed = parseAmount(value);
    if (Number.isNaN(parsed)) {
      toast(`Couldn't read "${value}" — try 300000, 300k, or 4.5m`, false);
      renderWishlist();
      return;
    }
    // CPU keeps decimals (credits per unit); amounts round to whole units
    const num = field === 'wtb_cpu' ? parsed : Math.round(parsed);
    let res;
    try { res = await api().update_wishlist_item({ wishlist_id: item.wishlist_id, [field]: num }); }
    catch (e) { res = { ok: false, error: String(e) }; }
    if (res.ok) {
      item[field] = num;
      toast(`${item.name}: ${field === 'wtb_cpu' ? 'WTB CPU' : 'WTB amount'} → ${fmtNum(num)}`);
    } else {
      toast(`Update failed: ${res.error || 'server error'}`, false);
      checkAuthError(res.error);
    }
    renderWishlist();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

async function toggleWishVisibility(idx) {
  if (!WISH_UPDATES_ENABLED) { toast(WISH_UPDATE_MSG, false); return; }
  const item = wishState.items[idx];
  if (!item) return;
  const newPrivate = String(item.isPrivate ?? '0') === '1' ? 0 : 1;
  let res;
  try { res = await api().update_wishlist_item({ wishlist_id: item.wishlist_id, isPrivate: newPrivate }); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (res.ok) {
    item.isPrivate = String(newPrivate);
    toast(`${item.name} is now ${newPrivate ? 'private' : 'public'}`);
  } else {
    toast(`Couldn't change visibility: ${res.error || 'server error'}`, false);
    checkAuthError(res.error);
  }
  renderWishlist();
}

function initWishlist() {
  buildWishHeader();

  $('#wish-search').addEventListener('input', () => renderWishlist());
  $('[data-refresh="wishlist"]').addEventListener('click', () => syncWishlist());

  $('#wish-head').addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const field = th.dataset.sort;
    if (wishState.sortField === field) {
      wishState.sortOrder = wishState.sortOrder === 'DESC' ? 'ASC' : 'DESC';
    } else {
      wishState.sortField = field;
      wishState.sortOrder = WISH_NUMERIC.has(field) ? 'DESC' : 'ASC';
    }
    renderWishlist();
  });

  $('#wish-body').addEventListener('click', (e) => {
    const promote = e.target.closest('[data-promote]');
    if (promote) { promoteWishItem(safeInt(promote.dataset.promote)); return; }
    const edit = e.target.closest('[data-wedit]');
    if (edit) { openWishEditor(edit); return; }
    const vis = e.target.closest('[data-wvis]');
    if (vis) { toggleWishVisibility(safeInt(vis.dataset.wvis)); return; }
    const remove = e.target.closest('[data-wremove]');
    if (remove) {
      if (!confirmArm(remove, 'Click again to remove from wishlist')) return;
      const item = wishState.items[safeInt(remove.dataset.wremove)];
      if (item) removeFromWishlistByResource(item.id, item.name);
      return;
    }
    const nameCell = e.target.closest('td.res-name');
    if (nameCell) openResourcePage(nameCell.textContent);
  });
}
