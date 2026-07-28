/* My Inventory page — crafted-item stock (api/inventory.php).
   Server-side list with filters/sort; inline edit of stocked/threshold. */

const INV_COLUMNS = [
  ['Stocked', 'stocked', 'stat'],
  ['Item', 'item_name', 'col-name'],
  ['Threshold', 'threshold', 'stat'],
  ['Vendor', 'vendor', 'col-text'],
  ['Match Price', 'match_price', 'col-num'],
  ['Sales', 'sales_count', 'stat', 'Sales the mail parser matched to this item — click a count to see them'],
  ['Updated', 'last_updated', 'col-text'],
];

// expanded: inventory_ids whose notes row is open. Lives in state, not the DOM,
// so it survives the re-render after a save. Notes is deliberately NOT in
// INV_COLUMNS — the list is server-sorted and api/inventory.php's sort allowlist
// has no `notes`, so a sortable notes header would silently sort by item_name.
const invState = { page: 1, perPage: 100, hasNext: false, sortField: 'item_name', sortOrder: 'ASC', items: [],
                   noteFor: null,   // inventory id open in the notes dialog
                   groups: [], grpCollapsed: new Set(), tagFilter: null };

// tags live as one comma-separated string server-side, like stockpile/factories
const invTags = (i) => String(i.tags || '').split(',').map((t) => t.trim()).filter(Boolean);

const invColCount = () => INV_COLUMNS.length + 2; // + envelope pin-cell + actions cell

function buildInvHeader() {
  $('#inv-head').innerHTML = sortableHeaderHtml(INV_COLUMNS, invState.sortField, invState.sortOrder) +
    '<th class="pin-cell"></th><th class="col-actions"></th>'; // restock-email envelope + actions
}

// page-head "Email all" checkbox mirrors the per-row envelopes: checked when
// every tracked item is opted in, dash (indeterminate) when only some are
function invSyncAllToggle() {
  const box = $('#inv-alert-all');
  if (!box) return;
  const on = invState.items.filter((i) => Number(i.notify_email)).length;
  box.checked = invState.items.length > 0 && on === invState.items.length;
  box.indeterminate = on > 0 && on < invState.items.length;
}

// your distinct SELL vendors (from api/sales.php) — cached for the styled
// suggestion dropdown. A native <datalist> was ugly AND merged WKWebView autofill
// history (which pulled in purchase-seller names), so we render our own.
async function invLoadVendorSuggestions() {
  try {
    const res = await apiFetch('GET', 'api/sales.php', { params: { action: 'vendors' } });
    invState.vendors = ((res.ok && res.data && res.data.results) || []).map((r) => r.vendor);
  } catch (_) { invState.vendors = []; }
}

// filtered vendor suggestions under the vendor input (most-sold first)
function invRenderVendorSug() {
  const box = $('#inv-vendor-sug');
  const q = $('#inv-new-vendor').value.trim().toLowerCase();
  const hits = (invState.vendors || [])
    .filter((v) => !q || v.toLowerCase().includes(q))
    .slice(0, 8);
  if (!hits.length) { box.hidden = true; return; }
  box.innerHTML = hits.map((v) =>
    `<div class="inv-vendor-opt" data-vendor="${escapeHtml(v)}">${escapeHtml(v)}</div>`).join('');
  box.hidden = false;
}

function invRowHtml(item, idx) {
  const stocked = safeInt(item.stocked);
  const threshold = safeInt(item.threshold);
  const stockCls = stocked < 0 ? 'inv-neg' : stocked <= threshold ? 'inv-low' : '';
  const iid = String(item.id);
  const notePreview = labNotesText(item.notes);   // rich notes -> plain text for the tooltip
  const hasNotes = !!notePreview;
  const tagged = invTags(item).length > 0;
  return `<tr data-idx="${idx}" data-iid="${iid}"${invState.groups.length ? ' draggable="true"' : ''}>
    <td class="stat inv-edit ${stockCls}" data-edit="stocked" data-idx="${idx}" title="Click to edit">${fmtNum(stocked)}</td>
    <td class="col-name res-name"><span class="stk-tagslot">${tagged
      ? `<i class="fa-solid fa-tag stk-tagind" data-invtaghover="${idx}"></i>` : ''}</span>${escapeHtml(item.item_name || '')}</td>
    <td class="stat inv-edit" data-edit="threshold" data-idx="${idx}" title="Click to edit">${fmtNum(threshold)}</td>
    <td class="col-text">${escapeHtml(item.vendor || '') || '<span class="stat_off">—</span>'}</td>
    <td class="col-num">${item.match_price != null && item.match_price !== '' ? fmtNum(item.match_price) : '<span class="stat_off">—</span>'}</td>
    <td class="stat ${safeInt(item.sales_count) ? 'inv-sales' : ''}" ${safeInt(item.sales_count) ? `data-sales="${idx}" title="Click to see the matched sales"` : ''}>${safeInt(item.sales_count) ? fmtNum(item.sales_count) : '<span class="stat_off">—</span>'}</td>
    <td class="col-text res-type">${fmtAgoTip(item.last_updated)}</td>
    <td class="pin-cell" data-invalert="${idx}" title="${Number(item.notify_email)
        ? 'Emailing you when this drops to its threshold or oversells — click to stop'
        : 'Email me when this needs restocking (below threshold or negative)'}"><i
        class="fa-${Number(item.notify_email) ? 'solid' : 'regular'} fa-envelope${Number(item.notify_email) ? ' mys-alert-on' : ''}"></i></td>
    <td class="col-actions">
      <button class="btn btn-icon" data-notes="${idx}" title="${hasNotes ? escapeHtml(notePreview) : 'Add notes'}"><i class="fa-${hasNotes ? 'solid' : 'regular'} fa-note-sticky${hasNotes ? ' has-notes' : ''}"></i></button>
      <button class="btn btn-icon" data-iclone="${idx}" title="Clone — same numbers, tweak the name"><i class="fa-solid fa-clone"></i></button>
      <button class="btn btn-icon" data-iedit="${idx}" title="Edit vendor / stock"><i class="fa-solid fa-pen"></i></button>
      <button class="btn btn-icon" data-iremove="${idx}" title="Remove item"><i class="fa-solid fa-trash-can"></i></button>
    </td>
  </tr>`;
}

const invRowsHtml = (item, idx) => invRowHtml(item, idx);

// Re-render from state — no refetch. Folder rows split the page's rows into
// sections (rename/collapse/delete inline); ungrouped-only = a flat list.
function renderInvRows() {
  let pairs = invState.items.map((item, idx) => [item, idx]);
  if (invState.tagFilter) pairs = pairs.filter(([i]) => invTags(i).includes(invState.tagFilter));
  const sections = grpSections(invState.groups, pairs, ([i]) => i.group_id);
  const spacer = `<tr class="stk-group-gap"><td colspan="${invColCount()}"></td></tr>`;
  const parts = [];
  sections.forEach((sec) => {
    const collapsed = invState.grpCollapsed.has(sec.key);
    if (sec.key !== 'un' || sections.length > 1) {
      if (parts.length) parts.push(spacer);
      parts.push(grpTableHeaderHtml(sec.key, sec.name, sec.items.length, collapsed, sec.key !== 'un', invColCount(), 'col-actions'));
    }
    if (!collapsed) parts.push(...sec.items.map(([item, idx]) => invRowsHtml(item, idx)));
  });
  $('#inv-body').innerHTML = parts.join('');

  // tag cloud from this page's items; an active filter can always be unclicked
  const allTags = [...new Set(invState.items.flatMap(invTags))];
  if (invState.tagFilter && !allTags.includes(invState.tagFilter)) invState.tagFilter = null;
  const tagbar = $('#inv-tagbar');
  tagbar.hidden = !allTags.length;
  tagbar.innerHTML = allTags.length
    ? '<span class="fac-tagbar-label"><i class="fa-solid fa-tags"></i></span>'
      + allTags.map((t) => `<span class="fac-tag${invState.tagFilter === t ? ' active' : ''}"
          data-invtag="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('')
    : '';
}

// ---- notes dialog: hover the icon to preview, click to edit (matches the
// stockpile / My Schematics pattern — the old inline expander row is gone) ----

function invOpenNoteDialog(item) {
  invState.noteFor = String(item.id);
  $('#inv-note-title').textContent = item.item_name || 'Notes';
  $('#inv-note-text').innerHTML = labNotesHtml(item.notes);  // rich (lab WYSIWYG)
  $('#inv-note-tags').value = item.tags || '';
  $('#inv-note-modal').hidden = false;
  $('#inv-note-text').focus();
}

async function invSaveNoteDialog() {
  const item = invState.items.find((i) => String(i.id) === invState.noteFor);
  $('#inv-note-modal').hidden = true;
  if (!item) return;
  const v = richNotesValue($('#inv-note-text'));
  const tags = $('#inv-note-tags').value.trim();
  if ((item.notes || '') === v && (item.tags || '') === tags) return; // unchanged
  item.notes = v; // optimistic
  item.tags = tags;
  renderInvRows();
  try {
    // apiFetch, not the shell bridge — this ships as a UI bundle with no client download
    const res = await apiFetch('PUT', 'api/inventory.php', { data: { inventory_id: safeInt(invState.noteFor), notes: v, tags } });
    $('#inv-status').textContent = res.ok
      ? `Notes saved — ${item.item_name}`
      : `Failed to save notes: ${res.error || 'server error'}`;
  } catch (e) { $('#inv-status').textContent = `Failed to save notes: ${e}`; }
}

// ---- restock alerts (bell + native): EDGE-triggered so they can't spam.
// A previous-stock map in localStorage detects the actual crossing (above →
// at/below threshold, or non-negative → negative); an item re-alerts only
// after recovering, with a 24h per-item floor as a second belt.
async function invNotifySweep() {
  let rows = [];
  try {
    const res = await api().get_inventory({ perpage: 500 });
    rows = (res.ok && res.data && res.data.results) || [];
  } catch (_) { return; }
  if (!rows.length) return;
  let prev = {};
  let fired = {};
  try { prev = JSON.parse(localStorage.getItem('inv_notify_state') || '{}'); } catch (_) {}
  try { fired = JSON.parse(localStorage.getItem('inv_notify_fired') || '{}'); } catch (_) {}
  const now = Math.floor(Date.now() / 1000);
  const next = {};
  for (const it of rows) {
    const id = String(it.id);
    const s = safeInt(it.stocked), t = safeInt(it.threshold);
    next[id] = s;
    if (!(id in prev)) continue;              // first sight — record, never announce
    const p = safeInt(prev[id]);
    const crossedNeg = p >= 0 && s < 0;
    const crossedLow = !crossedNeg && s >= 0 && t > 0 && s <= t && p > t;
    if (!crossedNeg && !crossedLow) continue;
    const key = `inv:${id}:${crossedNeg ? 'neg' : 'low'}`;
    if (fired[key] && now - fired[key] < 86400) continue;
    fired[key] = now;
    appLocalAlert(`Restock ${it.item_name}`,
      crossedNeg ? `oversold — ${s} in stock${it.vendor ? ` at ${it.vendor}` : ''}`
                 : `${s} left (threshold ${t})${it.vendor ? ` at ${it.vendor}` : ''}`);
  }
  try {
    localStorage.setItem('inv_notify_state', JSON.stringify(next));
    localStorage.setItem('inv_notify_fired', JSON.stringify(fired));
  } catch (_) {}
}

async function loadInventory() {
  showGridLoading('#inv-loading');
  $('#inv-empty').hidden = true;

  const filter = $('#inv-filter').value;
  const params = {
    search: $('#inv-search').value.trim(),
    page: invState.page,
    perpage: invState.perPage,
    sort: invState.sortField,
    order: invState.sortOrder,
  };
  if (filter === 'negative_stock') params.inventory_type = 'negative_stock';
  else if (filter === 'low') params.threshold = safeInt($('#inv-low').value);

  let res, groups;
  try {
    [res, groups] = await Promise.all([api().get_inventory(params), grpList('inventory')]);
  } catch (e) { res = { ok: false, error: String(e) }; groups = invState.groups; }
  invState.groups = groups || [];

  $('#inv-loading').hidden = true;

  if (!res.ok || !res.data) {
    $('#inv-body').innerHTML = '';
    const empty = $('#inv-empty');
    empty.textContent = `Error: ${res.error || 'failed to load'}`;
    empty.hidden = false;
    checkAuthError(res.error);
    return;
  }

  const rows = res.data.results || [];
  const page = res.data.page ?? invState.page;
  invState.perPage = res.data.per_page ?? invState.perPage;
  invState.hasNext = rows.length >= invState.perPage;
  invState.items = rows;

  buildInvHeader();
  invSyncAllToggle();
  invNotifySweep(); // manual stock edits + fresh sale matches alert immediately
  if (!rows.length) {
    // still render folder rows (if any) so an empty list can be organized
    renderInvRows();
    const empty = $('#inv-empty');
    empty.textContent = filter || params.search ? 'No matching items.' : 'No items yet — add one above.';
    empty.hidden = invState.groups.length > 0;
    $('#inv-status').textContent = '';
  } else {
    renderInvRows();
    $('#inv-status').textContent = `Page ${page} — ${rows.length} items`;
  }
  $('#inv-prev').disabled = page <= 1;
  $('#inv-next').disabled = !invState.hasNext;
}

// Inline editor for stocked/threshold cells
function openInvEditor(cell) {
  if (cell.querySelector('input')) return;
  const idx = safeInt(cell.dataset.idx);
  const field = cell.dataset.edit;
  const item = invState.items[idx];
  if (!item) return;

  const current = safeInt(item[field]);
  cell.innerHTML = `<input type="number" class="stock-input" value="${current}">`;
  const input = cell.querySelector('input');
  input.focus();
  input.select();

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const value = save ? safeInt(input.value) : current;
    cell.textContent = fmtNum(value); // commas in view mode
    if (save && value !== current) {
      let res;
      try { res = await api().update_inventory_item({ inventory_id: item.id, [field]: value }); }
      catch (e) { res = { ok: false, error: String(e) }; }
      if (res.ok) {
        item[field] = value;
        toast(`${item.item_name}: ${field} → ${value}`);
        loadInventory(); // re-render for low/negative highlighting
      } else {
        cell.textContent = String(current);
        toast(`Update failed: ${res.error || 'server error'}`, false);
        checkAuthError(res.error);
      }
    }
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

async function removeInvItem(idx) {
  const item = invState.items[idx];
  if (!item) return;
  let res;
  try { res = await api().remove_inventory_item(item.id); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (res.ok) {
    toast(`${item.item_name} removed from inventory`);
    loadInventory();
  } else {
    toast(`Couldn't remove ${item.item_name}: ${res.error || 'server error'}`, false);
    checkAuthError(res.error);
  }
}

async function addInvItem() {
  const name = $('#inv-new-name').value.trim();
  if (!name) { toast('Enter an item name first', false); return; }
  const btn = $('#inv-add');
  btn.disabled = true;
  const editId = $('#inv-add-modal').dataset.editId || '';
  let res;
  try {
    // gateway (not the shell bridge): it carries the vendor field. POST for a
    // new item (server dedupes per item+vendor); PUT to update an existing one.
    if (editId) {
      res = await apiFetch('PUT', 'api/inventory.php', { data: {
        inventory_id: safeInt(editId),
        item_name: name,
        vendor: $('#inv-new-vendor').value.trim(),
        stocked: safeInt($('#inv-new-stocked').value),
        threshold: safeInt($('#inv-new-threshold').value),
      } });
    } else {
      res = await apiFetch('POST', 'api/inventory.php', { data: {
        item_name: name,
        vendor: $('#inv-new-vendor').value.trim(),
        stocked: safeInt($('#inv-new-stocked').value),
        threshold: safeInt($('#inv-new-threshold').value),
      } });
    }
  } catch (e) { res = { ok: false, error: String(e) }; }
  btn.disabled = false;
  if (res.ok) {
    toast(editId ? `${name} updated` : `${name} added to inventory`);
    $('#inv-add-modal').hidden = true;
    loadInventory();
  } else {
    toast(`Couldn't save ${name}: ${res.error || 'server error'}`, false); // 409 = duplicate
    checkAuthError(res.error);
  }
}

// open the shared dialog: no item = add mode, item = edit mode (name locked,
// since a rename would orphan the sales that match on it), item + clone =
// add mode prefilled from the row — name selected for a quick "Style 2" tweak
function openInvDialog(item = null, clone = false) {
  invLoadVendorSuggestions();
  const modal = $('#inv-add-modal');
  const nameInput = $('#inv-new-name');
  nameInput.readOnly = false;
  if (item && !clone) {
    modal.dataset.editId = String(item.id);
    $('#inv-modal-title').textContent = 'Edit Inventory Item';
    $('#inv-add').innerHTML = '<i class="fa-solid fa-check"></i> Save';
    nameInput.value = item.item_name || '';
    $('#inv-new-vendor').value = item.vendor || '';
    $('#inv-new-stocked').value = String(safeInt(item.stocked));
    $('#inv-new-threshold').value = String(safeInt(item.threshold));
  } else {
    delete modal.dataset.editId;
    $('#inv-modal-title').textContent = clone ? 'Clone Inventory Item' : 'Add Inventory Item';
    $('#inv-add').innerHTML = '<i class="fa-solid fa-plus"></i> Add Item';
    nameInput.value = clone && item ? (item.item_name || '') : '';
    $('#inv-new-vendor').value = clone && item ? (item.vendor || '') : '';
    $('#inv-new-stocked').value = clone && item ? String(safeInt(item.stocked)) : '10';
    $('#inv-new-threshold').value = clone && item ? String(safeInt(item.threshold)) : '1';
  }
  modal.hidden = false;
  ((item && !clone) ? $('#inv-new-vendor') : nameInput).focus();
  if (clone) nameInput.select();
}

function initInventory() {
  buildInvHeader();

  // restock alerts fire even if the user never opens this page — sales deplete
  // stock server-side while they play. Delay the first pass so boot stays snappy.
  setTimeout(invNotifySweep, 20000);
  setInterval(invNotifySweep, 10 * 60 * 1000);

  // Typeahead (server-side search, so debounced) + Enter for the impatient
  let invSearchTimer = null;
  $('#inv-search').addEventListener('input', () => {
    clearTimeout(invSearchTimer);
    invSearchTimer = setTimeout(() => { invState.page = 1; loadInventory(); }, 300);
  });
  $('#inv-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(invSearchTimer); invState.page = 1; loadInventory(); }
  });
  $('#inv-filter').addEventListener('change', () => {
    $('#inv-low').hidden = $('#inv-filter').value !== 'low';
    invState.page = 1;
    loadInventory();
  });
  $('#inv-low').addEventListener('change', () => { invState.page = 1; loadInventory(); });
  $('[data-refresh="inventory"]').addEventListener('click', () => loadInventory());
  $('#inv-prev').addEventListener('click', () => { if (invState.page > 1) { invState.page--; loadInventory(); } });
  $('#inv-next').addEventListener('click', () => { if (invState.hasNext) { invState.page++; loadInventory(); } });
  $('#inv-add-open').addEventListener('click', () => openInvDialog());
  // styled vendor suggestions (own dropdown, not native datalist)
  $('#inv-new-vendor').addEventListener('focus', invRenderVendorSug);
  $('#inv-new-vendor').addEventListener('input', invRenderVendorSug);
  $('#inv-new-vendor').addEventListener('blur', () => setTimeout(() => { $('#inv-vendor-sug').hidden = true; }, 150));
  $('#inv-vendor-sug').addEventListener('mousedown', (e) => {
    const opt = e.target.closest('[data-vendor]');
    if (!opt) return;
    e.preventDefault();
    $('#inv-new-vendor').value = opt.dataset.vendor;
    $('#inv-vendor-sug').hidden = true;
  });
  $('#inv-add-cancel').addEventListener('click', () => { $('#inv-add-modal').hidden = true; });
  bindBackdropClose($('#inv-add-modal'), () => { $('#inv-add-modal').hidden = true; });
  // Sales expander: one open at a time, click the count again to close
  $('#inv-sales-close').addEventListener('click', () => { $('#inv-sales-modal').hidden = true; });
  bindBackdropClose($('#inv-sales-modal'), () => { $('#inv-sales-modal').hidden = true; });
  // Notes: hover the icon previews, click opens the dialog
  $('#inv-body').addEventListener('click', (e) => {
    const noteCell = e.target.closest('[data-notes]');
    if (!noteCell) return;
    const item = invState.items[safeInt(noteCell.dataset.notes)];
    if (item) invOpenNoteDialog(item);
  });
  $('#inv-note-save').addEventListener('click', () => invSaveNoteDialog());
  $('#inv-note-cancel').addEventListener('click', () => { $('#inv-note-modal').hidden = true; });
  wireRichToolbar($('#inv-note-modal'));
  bindBackdropClose($('#inv-note-modal'), () => { $('#inv-note-modal').hidden = true; });

  $('#inv-body').addEventListener('click', async (e) => {
    const cell = e.target.closest('[data-sales]');
    if (!cell) return;
    const item = invState.items[Number(cell.dataset.sales)];
    if (!item) return;
    $('#inv-sales-title').textContent = `Sales — ${item.item_name}`;
    $('#inv-sales-body').innerHTML = 'Loading…';
    $('#inv-sales-modal').hidden = false;
    let rows = [];
    try {
      const res = await api().inventory_sales(item.id);
      rows = (res.ok && res.data && res.data.results) || [];
    } catch (_) { /* renders the empty message */ }
    $('#inv-sales-body').innerHTML = rows.length
      ? `<table class="inv-sales-table"><thead><tr>
           <th>When</th><th>Buyer</th><th>Vendor</th><th class="col-num">Amount</th>
         </tr></thead><tbody>${rows.map((s) => `<tr>
           <td>${fmtAgoTip(s.sale_timestamp)}</td>
           <td>${escapeHtml(s.buyer || '')}</td>
           <td>${escapeHtml(s.vendor || '')}</td>
           <td class="col-num sale-amount">${fmtNum(s.sale_amount)} cr</td>
         </tr>`).join('')}</tbody></table>`
      : '<span class="stat_off">No matched sales recorded for this item.</span>';
  });

  // folders: create, collapse, rename, delete, drag rows in
  $('#inv-newgroup').addEventListener('click', async () => {
    const res = await grpApi({ action: 'create', kind: 'inventory' });
    if (!res.ok || !res.data) { toast(res.error || 'Could not create group — site update pending?', false); return; }
    invState.groups.push({ id: res.data.id, name: res.data.name, sort_order: res.data.sort_order });
    renderInvRows();
    grpBeginRename('#inv-body', String(res.data.id),
      invState.groups[invState.groups.length - 1], renderInvRows);
  });
  $('#inv-tagbar').addEventListener('click', (e) => {
    const tag = e.target.closest('[data-invtag]');
    if (!tag) return;
    invState.tagFilter = invState.tagFilter === tag.dataset.invtag ? null : tag.dataset.invtag;
    renderInvRows();
  });

  // tag indicator popover — identical to stockpile's (same popover element +
  // hide timers); chips filter this list
  $('#inv-body').addEventListener('mouseover', (e) => {
    const tag = e.target.closest('[data-invtaghover]');
    if (!tag) return;
    const item = invState.items[safeInt(tag.dataset.invtaghover)];
    if (!item) return;
    clearTimeout(stkPopHide);
    const pop = $('#stk-schem-pop');
    pop.innerHTML = `<div class="fac-tagbar" style="margin:0">${invTags(item).map((t) =>
      `<span class="fac-tag${invState.tagFilter === t ? ' active' : ''}" data-invtag="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('')}</div>`;
    const r = tag.getBoundingClientRect();
    pop.hidden = false;
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 328))}px`;
    pop.style.top = r.bottom + pop.offsetHeight + 8 < window.innerHeight
      ? `${r.bottom + 4}px` : `${r.top - pop.offsetHeight - 4}px`;
  });
  $('#inv-body').addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-invtaghover]')) stkScheduleSchemPopHide();
  });
  $('#stk-schem-pop').addEventListener('click', (e) => {
    const t = e.target.closest('[data-invtag]');
    if (!t) return;
    $('#stk-schem-pop').hidden = true;
    invState.tagFilter = invState.tagFilter === t.dataset.invtag ? null : t.dataset.invtag;
    renderInvRows();
  });
  $('#inv-body').addEventListener('click', (e) => {
    const tog = e.target.closest('[data-grptoggle]');
    if (tog) {
      const k = tog.dataset.grptoggle;
      invState.grpCollapsed.has(k) ? invState.grpCollapsed.delete(k) : invState.grpCollapsed.add(k);
      renderInvRows();
      return;
    }
    const ren = e.target.closest('[data-grprename]');
    if (ren) {
      grpBeginRename('#inv-body', ren.dataset.grprename,
        invState.groups.find((g) => String(g.id) === ren.dataset.grprename), renderInvRows);
      return;
    }
    const gdel = e.target.closest('[data-grpdel]');
    if (gdel) {
      if (!confirmArmLabeled(gdel, 'Delete group?')) return;
      const gid = safeInt(gdel.dataset.grpdel);
      grpApi({ action: 'remove', id: gid }).then((res) => {
        if (!res.ok) return;
        invState.groups = invState.groups.filter((g) => g.id !== gid);
        invState.items.forEach((i) => { if (Number(i.group_id) === gid) i.group_id = null; });
        renderInvRows();
      });
    }
  });
  // drag a row onto (or under) a folder row to file it
  $('#inv-body').addEventListener('dragstart', (e) => {
    const el = e.target.closest('tr[data-iid]');
    if (el) el.classList.add('inv-dragging');
  });
  $('#inv-body').addEventListener('dragover', (e) => {
    const dragging = document.querySelector('#inv-body tr.inv-dragging');
    if (!dragging) return;
    e.preventDefault();
    const hd = e.target.closest('tr[data-grpkey]');
    if (hd) { hd.parentNode.insertBefore(dragging, hd.nextSibling); return; }
    const over = e.target.closest('tr[data-iid]');
    if (over && over !== dragging) {
      const rect = over.getBoundingClientRect();
      over.parentNode.insertBefore(dragging, e.clientY < rect.top + rect.height / 2 ? over : over.nextSibling);
    }
  });
  $('#inv-body').addEventListener('dragend', async () => {
    const dragging = document.querySelector('#inv-body tr.inv-dragging');
    if (!dragging) return;
    dragging.classList.remove('inv-dragging');
    const item = invState.items[safeInt(dragging.dataset.idx)];
    let p = dragging.previousElementSibling;         // section = nearest divider above
    while (p && !p.hasAttribute('data-grpkey')) p = p.previousElementSibling;
    const key = p ? p.dataset.grpkey : 'un';
    if (item) {
      const gid = key === 'un' ? null : safeInt(key);
      if ((item.group_id || null) !== gid) {
        item.group_id = gid;
        const res = await apiFetch('PUT', 'api/inventory.php', {
          data: { inventory_id: safeInt(item.id), group_id: gid } });
        if (!res.ok) toast(res.error || 'Could not move — site update pending?', false);
      }
    }
    renderInvRows();
  });

  $('#inv-add').addEventListener('click', addInvItem);
  // Enter anywhere in the dialog submits
  $('#inv-add-modal').addEventListener('keydown', (e) => { if (e.key === 'Enter') addInvItem(); });

  // Server-side sort
  $('#inv-head').addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const field = th.dataset.sort;
    if (invState.sortField === field) {
      invState.sortOrder = invState.sortOrder === 'DESC' ? 'ASC' : 'DESC';
    } else {
      invState.sortField = field;
      invState.sortOrder = field === 'item_name' || field === 'vendor' ? 'ASC' : 'DESC';
    }
    invState.page = 1;
    loadInventory();
  });

  // page-head "Email all" checkbox: restock emails for EVERY tracked item
  $('#inv-alert-all').addEventListener('change', () => {
    const turnOn = $('#inv-alert-all').checked;
    apiFetch('PUT', 'api/inventory.php', { data: { notify_email_all: turnOn ? 1 : 0 } }).then((res) => {
      if (!res.ok) { toast(res.error || 'Could not update — site update pending?', false); invSyncAllToggle(); return; }
      invState.items.forEach((i) => { i.notify_email = turnOn ? 1 : 0; });
      invSyncAllToggle();
      renderInvRows();
      toast(turnOn ? `Restock emails ON for all ${fmtNum(safeInt(res.data?.changed))} tracked items`
                   : 'Restock emails off for all items');
    }).catch((err) => { toast(String(err), false); invSyncAllToggle(); });
  });

  // Inline edits + two-step delete (arm, then confirm within 2.5s)
  $('#inv-body').addEventListener('click', (e) => {
    const alertBtn = e.target.closest('[data-invalert]');
    if (alertBtn) {
      const item = invState.items[safeInt(alertBtn.dataset.invalert)];
      if (!item) return;
      item.notify_email = Number(item.notify_email) ? 0 : 1; // optimistic
      invSyncAllToggle(); // the Email-all checkbox may flip state
      renderInvRows();
      apiFetch('PUT', 'api/inventory.php', {
        data: { inventory_id: safeInt(item.id), notify_email: item.notify_email },
      }).then((res) => {
        if (!res.ok) toast(res.error || 'Could not save the alert toggle — site update pending?', false);
        else toast(item.notify_email
          ? `Restock emails ON — ${item.item_name}`
          : `Restock emails off — ${item.item_name}`);
      }).catch((err) => toast(String(err), false));
      return;
    }
    const editRow = e.target.closest('[data-iedit]');
    if (editRow) { openInvDialog(invState.items[safeInt(editRow.dataset.iedit)]); return; }
    const cloneRow = e.target.closest('[data-iclone]');
    if (cloneRow) { openInvDialog(invState.items[safeInt(cloneRow.dataset.iclone)], true); return; }
    const editCell = e.target.closest('[data-edit]');
    if (editCell) { openInvEditor(editCell); return; }
    const removeCell = e.target.closest('[data-iremove]');
    if (removeCell && confirmArm(removeCell)) removeInvItem(safeInt(removeCell.dataset.iremove));
  });
}
