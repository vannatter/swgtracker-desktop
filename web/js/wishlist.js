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
const wishState = { items: [], sortField: 'score', sortOrder: 'DESC', resourceIds: new Set(),
                    groups: [], grpCollapsed: new Set(), tagFilter: null,
                    checked: new Set(), lastSel: null }; // checkbox selection (bulk tags) + shift anchor

const wishColCount = () => WISH_COLUMNS.length + 4; // select + promote + visibility + remove pin-cells

const wishTags = (i) => String(i.tags || '').split(',').map((t) => t.trim()).filter(Boolean);

// selection bar + select-all + per-group checkboxes track the checked set
function wishSyncSel() {
  const vis = wishVisibleItems().map((i) => String(i.wishlist_id));
  const on = vis.filter((id) => wishState.checked.has(id)).length;
  const all = $('#wish-selall');
  if (all) {
    all.checked = vis.length > 0 && on === vis.length;
    all.indeterminate = on > 0 && on < vis.length;
  }
  const n = wishState.checked.size;
  $('#wish-selbar').hidden = !n;
  if (n) $('#wish-selbar-n').textContent = `${n} selected`;
  document.querySelectorAll('#wish-body [data-grpselect]').forEach((cb) => {
    const key = cb.dataset.grpselect;
    const members = wishState.items.filter((i) =>
      (i.group_id != null && String(i.group_id) !== '0' ? String(i.group_id) : 'un') === key);
    const sel = members.filter((i) => wishState.checked.has(String(i.wishlist_id))).length;
    cb.checked = members.length > 0 && sel === members.length;
    cb.indeterminate = sel > 0 && sel < members.length;
  });
}

function buildWishHeader() {
  $('#wish-head').innerHTML = sortableHeaderHtml(
    WISH_COLUMNS, wishState.sortField, wishState.sortOrder,
    '<th class="pin-cell"><input type="checkbox" id="wish-selall" title="Select every visible resource"></th><th class="pin-cell"></th>')
    + '<th class="pin-cell"></th><th class="pin-cell"></th>';
}

function wishRowHtml(item, idx) {
  const cells = WISH_COLUMNS.map(([, field]) => {
    if (field === 'name') return `<td class="col-name res-name"><span class="stk-tagslot">${wishTags(item).length
      ? `<i class="fa-solid fa-tag stk-tagind" title="${escapeHtml(wishTags(item).join(', '))}"></i>` : ''}</span>${escapeHtml(item.name || '')}</td>`;
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
  const tags = wishTags(item);
  return `<tr data-idx="${idx}" data-wid="${escapeHtml(String(item.wishlist_id))}"${wishState.groups.length ? ' draggable="true"' : ''}>
    <td class="pin-cell wish-sel-cell"><input type="checkbox" class="wish-sel" data-selid="${escapeHtml(String(item.wishlist_id))}"${wishState.checked.has(String(item.wishlist_id)) ? ' checked' : ''}></td>
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
  if (wishState.tagFilter) items = items.filter((i) => wishTags(i).includes(wishState.tagFilter));
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
  // folders, gold-standard style (shared header rows + wiring)
  const sections = grpSections(wishState.groups, indexed, ([i]) => i.group_id);
  const spacer = `<tr class="stk-group-gap"><td colspan="${wishColCount()}"></td></tr>`;
  const parts = [];
  sections.forEach((sec) => {
    const collapsed = wishState.grpCollapsed.has(sec.key);
    if (sec.key !== 'un' || sections.length > 1) {
      if (parts.length) parts.push(spacer);
      parts.push(grpTableHeaderHtml(sec.key, sec.name, sec.items.length, collapsed, sec.key !== 'un', wishColCount(), 'pin-cell', sec.key !== 'un', true));
    }
    if (!collapsed) parts.push(...sec.items.map(([item, idx]) => wishRowHtml(item, idx)));
  });
  $('#wish-body').innerHTML = parts.join('');

  const empty = $('#wish-empty');
  if (!items.length) {
    empty.textContent = wishState.items.length ? 'No matches on your wishlist.' : 'Your wishlist is empty — click a ♥ on any resource.';
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }
  $('#wish-status').textContent = statusMsg ||
    `${items.length}${items.length === wishState.items.length ? '' : ` of ${wishState.items.length}`} resources on wishlist`;

  // tag cloud from every item so an active filter can always be unclicked
  const allTags = [...new Set(wishState.items.flatMap(wishTags))];
  if (wishState.tagFilter && !allTags.includes(wishState.tagFilter)) wishState.tagFilter = null;
  const tagbar = $('#wish-tagbar');
  tagbar.hidden = !allTags.length;
  tagbar.innerHTML = allTags.length
    ? '<span class="fac-tagbar-label"><i class="fa-solid fa-tags"></i></span>'
      + allTags.map((t) => `<span class="fac-tag${wishState.tagFilter === t ? ' active' : ''}"
          data-wishtag="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('')
    : '';
  wishSyncSel();
}

async function syncWishlist() {
  showGridLoading('#wish-loading');
  $('#wish-empty').hidden = true;

  grpList('wishlist').then((groups) => {
    wishState.groups = groups || [];
    renderWishlist();
  }).catch(() => { /* older site deploy — flat list */ });

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

  // folders: create + the shared gold-standard header wiring
  $('#wish-newgroup').addEventListener('click', async () => {
    const res = await grpApi({ action: 'create', kind: 'wishlist' });
    if (!res.ok || !res.data) { toast(res.error || 'Could not create group — site update pending?', false); return; }
    wishState.groups.push({ id: res.data.id, name: res.data.name, sort_order: res.data.sort_order });
    renderWishlist();
    grpBeginRename('#wish-body', String(res.data.id),
      wishState.groups[wishState.groups.length - 1], renderWishlist);
  });
  grpWireGroups('#wish-body', {
    groups: () => wishState.groups,
    collapsed: () => wishState.grpCollapsed,
    render: renderWishlist,
    onDelete: (key) => {
      const gid = safeInt(key);
      grpApi({ action: 'remove', id: gid }).then((res) => {
        if (!res.ok) return;
        wishState.groups = wishState.groups.filter((g) => g.id !== gid);
        wishState.items.forEach((i) => { if (Number(i.group_id) === gid) i.group_id = null; });
        renderWishlist();
      });
    },
  });

  // tag chips filter the list
  $('#wish-tagbar').addEventListener('click', (e) => {
    const t = e.target.closest('[data-wishtag]');
    if (!t) return;
    wishState.tagFilter = wishState.tagFilter === t.dataset.wishtag ? null : t.dataset.wishtag;
    renderWishlist();
  });

  // checkbox selection: shift-click ranges; select-all; group-header checkbox;
  // the bar bulk-adds tags (merge, never replace)
  $('#wish-body').addEventListener('click', (e) => {
    const cb = e.target.closest('.wish-sel');
    if (!cb) return;
    const wid = cb.dataset.selid;
    if (e.shiftKey && wishState.lastSel && wishState.lastSel !== wid) {
      const vis = wishVisibleItems().map((i) => String(i.wishlist_id));
      const a = vis.indexOf(wishState.lastSel), b = vis.indexOf(wid);
      if (a >= 0 && b >= 0) {
        const on = cb.checked;
        vis.slice(Math.min(a, b), Math.max(a, b) + 1)
          .forEach((id) => { if (on) wishState.checked.add(id); else wishState.checked.delete(id); });
        renderWishlist();
        wishState.lastSel = wid;
        return;
      }
    }
    if (cb.checked) wishState.checked.add(wid);
    else wishState.checked.delete(wid);
    wishState.lastSel = wid;
    wishSyncSel();
  });
  $('#wish-head').addEventListener('change', (e) => {
    if (!e.target.closest('#wish-selall')) return;
    const vis = wishVisibleItems().map((i) => String(i.wishlist_id));
    if (e.target.checked) vis.forEach((id) => wishState.checked.add(id));
    else vis.forEach((id) => wishState.checked.delete(id));
    renderWishlist();
  });
  $('#wish-body').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-grpselect]');
    if (!cb) return;
    wishState.items.filter((i) =>
      (i.group_id != null && String(i.group_id) !== '0' ? String(i.group_id) : 'un') === cb.dataset.grpselect)
      .forEach((i) => {
        if (cb.checked) wishState.checked.add(String(i.wishlist_id));
        else wishState.checked.delete(String(i.wishlist_id));
      });
    renderWishlist();
  });
  $('#wish-bulk-apply').addEventListener('click', async () => {
    const addTags = $('#wish-bulk-tags').value.trim();
    if (!addTags || !wishState.checked.size) return;
    const rows = wishState.items.filter((i) => wishState.checked.has(String(i.wishlist_id)));
    const results = await Promise.all(rows.map((i) => {
      i.tags = mergeTags(i.tags, addTags);
      return apiFetch('PUT', 'api/wishlist.php',
        { data: { wishlist_id: safeInt(i.wishlist_id), tags: i.tags } }).catch((err) => ({ ok: false, error: String(err) }));
    }));
    const failed = results.filter((r) => !r.ok).length;
    if (failed) { toast(`${failed} tag update${failed > 1 ? 's' : ''} failed — site update pending?`, false); return; }
    toast(`Tagged ${rows.length} resource${rows.length === 1 ? '' : 's'}`);
    wishState.checked.clear();
    $('#wish-bulk-tags').value = '';
    renderWishlist();
  });
  $('#wish-bulk-tags').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#wish-bulk-apply').click(); });
  $('#wish-sel-clear').addEventListener('click', () => {
    wishState.checked.clear();
    renderWishlist();
  });

  // drag a row onto (or under) a folder row to file it — same as My Inventory
  $('#wish-body').addEventListener('dragstart', (e) => {
    const el = e.target.closest('tr[data-wid]');
    if (!el) return;
    if (e.target.closest('.wish-sel-cell')) { e.preventDefault(); return; } // checkbox stays clickable
    el.classList.add('wish-dragging');
    if (wishState.checked.has(el.dataset.wid) && wishState.checked.size > 1) {
      const ghost = document.createElement('div');
      ghost.className = 'stk-drag-ghost';
      ghost.textContent = `${wishState.checked.size} items`;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, -12, -8);
      setTimeout(() => ghost.remove(), 0);
    }
  });
  $('#wish-body').addEventListener('dragover', (e) => {
    const dragging = document.querySelector('#wish-body tr.wish-dragging');
    if (!dragging) return;
    e.preventDefault();
    const hd = e.target.closest('tr[data-grpkey]');
    if (hd) { hd.parentNode.insertBefore(dragging, hd.nextSibling); return; }
    const over = e.target.closest('tr[data-wid]');
    if (over && over !== dragging) {
      const rect = over.getBoundingClientRect();
      over.parentNode.insertBefore(dragging, e.clientY < rect.top + rect.height / 2 ? over : over.nextSibling);
    }
  });
  $('#wish-body').addEventListener('dragend', async () => {
    const dragging = document.querySelector('#wish-body tr.wish-dragging');
    if (!dragging) return;
    dragging.classList.remove('wish-dragging');
    const item = wishState.items[safeInt(dragging.dataset.idx)];
    let p = dragging.previousElementSibling;         // section = nearest divider above
    while (p && !p.hasAttribute('data-grpkey')) p = p.previousElementSibling;
    const key = p ? p.dataset.grpkey : 'un';
    if (item) {
      const gid = key === 'un' ? null : safeInt(key);
      // the dragged row being checked pulls the whole checked set with it.
      // Via the gateway, NOT api().update_wishlist_item — the shell bridge
      // whitelists fields and would silently drop group_id.
      const ids = wishState.checked.has(String(item.wishlist_id)) && wishState.checked.size > 1
        ? [...wishState.checked] : [String(item.wishlist_id)];
      const movers = wishState.items.filter((i) =>
        ids.includes(String(i.wishlist_id)) && (i.group_id || null) !== gid);
      movers.forEach((i) => { i.group_id = gid; }); // optimistic
      const results = await Promise.all(movers.map((i) =>
        apiFetch('PUT', 'api/wishlist.php', { data: { wishlist_id: i.wishlist_id, group_id: gid } })
          .catch((err) => ({ ok: false, error: String(err) }))));
      const failed = results.filter((r) => !r.ok).length;
      if (failed) toast(`${failed} item${failed > 1 ? 's' : ''} could not move — site update pending?`, false);
      else if (movers.length > 1) toast(`Filed ${movers.length} resources`);
    }
    renderWishlist();
  });

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
