/* My Components — crafting stock between raw resources (My Stockpile) and the
   shop shelf (My Inventory): factory-made subcomponents, looted add-ins
   (scales, hides, crystals…), bought parts. api/components.php keeps it in its
   OWN tables so parts never reach sales matching, restock emails or the Home
   restock tile; stock only crosses to Inventory through Move → Inventory.

   A row is one item at one location. Locations are the grouping (no folders):
   a named house / container / backpack, or a factory's hopper. */

const CMP_SOURCES = {
  factory: ['fa-industry', 'Factory run'],
  crafted: ['fa-hammer', 'Hand-crafted'],
  looted: ['fa-dragon', 'Looted'],
  bought: ['fa-cart-shopping', 'Bought'],
};
const CMP_VIEW_KEY = 'cmp-view';

const cmpState = {
  rows: [], locations: [], items: [], factories: [], loaded: false,
  view: 'item',            // 'item' | 'location' — what the group rows are
  collapsed: new Set(),    // group keys folded shut
  editId: null,            // row open in the add/edit dialog (null = adding)
  move: null,              // row being moved
  inv: null,               // inventory items for the move dialog (fetched on demand)
  threshFor: null,         // item name in the threshold dialog
};
try { cmpState.view = localStorage.getItem(CMP_VIEW_KEY) === 'location' ? 'location' : 'item'; } catch (_) {}

const cmpTags = (r) => String(r.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
const cmpLoc = (id) => cmpState.locations.find((l) => String(l.id) === String(id)) || null;
const cmpLocName = (id) => (cmpLoc(id) || {}).name || 'Unsorted';
const cmpItem = (name) => cmpState.items.find((i) => String(i.item_name).toLowerCase() === String(name).toLowerCase()) || null;
const cmpThreshold = (name) => { const i = cmpItem(name); return i ? safeInt(i.threshold) : -1; };

// "5 crates" / "5 crates +3" for a unit count at a crate size (no size → '')
function cmpCrates(units, cs) {
  cs = safeInt(cs);
  if (cs <= 1) return '';
  const c = Math.floor(units / cs), rest = units % cs;
  return `${fmtNum(c)}${rest ? ` +${fmtNum(rest)}` : ''}`;
}

// totals per item across EVERY location (thresholds are on the total, not the filtered view)
function cmpTotals(rows = cmpState.rows) {
  const t = new Map();
  rows.forEach((r) => {
    const k = String(r.item_name).toLowerCase();
    const e = t.get(k) || { name: r.item_name, units: 0, cs: 0, locs: new Set() };
    e.units += safeInt(r.units);
    if (safeInt(r.crate_size) > 1) e.cs = e.cs && e.cs !== safeInt(r.crate_size) ? -1 : safeInt(r.crate_size); // -1 = mixed sizes
    e.locs.add(String(r.location_id ?? ''));
    t.set(k, e);
  });
  return t;
}

async function cmpFetch() {
  const res = await apiFetch('GET', 'api/components.php');
  if (!res.ok || !res.data) return res;
  cmpState.rows = res.data.components || [];
  cmpState.locations = res.data.locations || [];
  cmpState.items = res.data.items || [];
  cmpState.factories = res.data.factories || [];
  cmpState.loaded = true;
  return res;
}

async function loadComponents() {
  showGridLoading('#cmp-loading');
  $('#cmp-empty').hidden = true;
  let res;
  try { res = await cmpFetch(); } catch (e) { res = { ok: false, error: String(e) }; }
  $('#cmp-loading').hidden = true;
  if (!res.ok) {
    $('#cmp-body').innerHTML = '';
    const empty = $('#cmp-empty');
    empty.textContent = `Error: ${res.error || 'failed to load'}`;
    empty.hidden = false;
    checkAuthError(res.error);
    return;
  }
  cmpFillLocFilter();
  renderComponents();
  cmpNotifySweep(cmpState.rows);
}

function cmpFillLocFilter() {
  const sel = $('#cmp-locfilter');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All locations</option><option value="0">Unsorted</option>'
    + cmpState.locations.map((l) => `<option value="${safeInt(l.id)}">${escapeHtml(l.name)}</option>`).join('');
  if ([...sel.options].some((o) => o.value === cur)) sel.value = cur;
}

function cmpFiltered() {
  const loc = $('#cmp-locfilter').value, src = $('#cmp-srcfilter').value;
  const q = $('#cmp-search').value.trim().toLowerCase();
  return cmpState.rows.filter((r) => {
    if (loc !== '' && String(safeInt(r.location_id)) !== loc) return false;
    if (src && r.source !== src) return false;
    if (q && ![r.item_name, r.notes, r.tags, cmpLocName(r.location_id)].some((v) => String(v || '').toLowerCase().includes(q))) return false;
    return true;
  });
}

const CMP_COLS = 8; // first (location or item), source, units, crates, quality, notes, updated, actions

function cmpHeadHtml() {
  const first = cmpState.view === 'item' ? 'Location' : 'Item';
  return `<th class="col-name">${first}</th><th class="pin-cell">Source</th><th class="stat">Units</th>
    <th class="stat" title="Whole crates at the row's crate size, plus loose units">Crates</th><th class="stat">Quality</th>
    <th class="col-text">Stats / notes</th><th class="col-text">Updated</th><th class="col-actions"></th>`;
}

function cmpRowHtml(r) {
  const [ico, srcLabel] = CMP_SOURCES[r.source] || CMP_SOURCES.crafted;
  const tagged = cmpTags(r).length > 0;
  const loc = cmpLoc(r.location_id);
  const firstTxt = cmpState.view === 'item'
    ? (loc ? `${loc.factory_id ? '<i class="fa-solid fa-industry cmp-hopico" title="Factory hopper"></i> ' : ''}${escapeHtml(loc.name)}${loc.planet ? ` <span class="cmp-planet">${escapeHtml(loc.planet)}</span>` : ''}`
      : '<span class="stat_off">Unsorted</span>')
    : escapeHtml(r.item_name);
  const notes = String(r.notes || '').trim();
  const crates = cmpCrates(safeInt(r.units), r.crate_size);
  return `<tr data-cid="${safeInt(r.id)}">
    <td class="col-name res-name"><span class="stk-tagslot">${tagged
      ? `<i class="fa-solid fa-tag stk-tagind" title="${escapeHtml(cmpTags(r).join(', '))}"></i>` : ''}</span>${firstTxt}</td>
    <td class="pin-cell cmp-src" title="${srcLabel}"><i class="fa-solid ${ico}"></i></td>
    <td class="stat">${fmtNum(safeInt(r.units))}</td>
    <td class="stat"${crates ? ` title="${fmtNum(safeInt(r.crate_size))} a crate"` : ''}>${crates || '<span class="stat_off">—</span>'}</td>
    <td class="stat">${r.quality != null && r.quality !== '' ? fmtNum(r.quality) : '<span class="stat_off">—</span>'}</td>
    <td class="col-text cmp-notes" title="${escapeHtml(notes)}">${notes ? escapeHtml(notes) : '<span class="stat_off">—</span>'}</td>
    <td class="col-text res-type">${fmtAgoTip(r.updated_at)}</td>
    <td class="col-actions">
      <button class="btn btn-icon" data-cmove="${safeInt(r.id)}" title="Move — to another location, or onto a vendor (Inventory)"><i class="fa-solid fa-right-left"></i></button>
      <button class="btn btn-icon" data-cedit="${safeInt(r.id)}" title="Edit"><i class="fa-solid fa-pen"></i></button>
      <button class="btn btn-icon" data-cdel="${safeInt(r.id)}" title="Remove"><i class="fa-solid fa-trash-can"></i></button>
    </td>
  </tr>`;
}

function cmpItemHeadHtml(key, name, rows, totals, collapsed) {
  const t = totals.get(String(name).toLowerCase()) || { units: 0, cs: 0, locs: new Set() };
  const th = cmpThreshold(name);
  const low = th >= 0 && t.units <= th;
  const crates = t.cs > 1 ? ` · ${cmpCrates(t.units, t.cs)} crates` : '';
  const nLocs = t.locs.size;
  const it = cmpItem(name);
  const inv = it && it.inventory_id && it.inventory_name
    ? `<span class="cmp-invchip" title="Moves to Inventory restock “${escapeHtml(it.inventory_name)}”${it.inventory_vendor ? ` at ${escapeHtml(it.inventory_vendor)}` : ''} — ${fmtNum(safeInt(it.inventory_stocked))} on the shelf"><i class="fa-solid fa-store"></i> ${fmtNum(safeInt(it.inventory_stocked))} on vendor</span>` : '';
  return `<tr class="stk-group cmp-grp" data-cgrp="${escapeHtml(key)}">
    <td colspan="${CMP_COLS - 1}">
      <div class="stk-group-main"><span class="stk-group-left">
        <span class="stk-group-name stk-group-unfiled">${escapeHtml(name)}</span>
        <span class="stk-group-count${low ? ' inv-low' : ''}">${low ? '<i class="fa-solid fa-triangle-exclamation" title="At or below your low-stock warning"></i> ' : ''}${fmtNum(t.units)} total${crates}${nLocs > 1 ? ` · ${nLocs} places` : ''}</span>
        ${inv}
        <i class="fa-solid ${collapsed ? 'fa-caret-right' : 'fa-caret-down'} stk-caret stk-caret-trail" data-cgtoggle="${escapeHtml(key)}"></i>
      </span></div>
    </td>
    <td class="col-actions"><button class="btn btn-icon${th >= 0 ? ' mys-alert-on' : ''}" data-cthresh="${escapeHtml(name)}"
      title="${th >= 0 ? `Warns at ${fmtNum(th)} or fewer in total — click to change` : 'Set a low-stock warning on this item’s total'}"><i class="fa-${th >= 0 ? 'solid' : 'regular'} fa-bell"></i></button></td>
  </tr>`;
}

function cmpLocHeadHtml(key, name, loc, count, collapsed) {
  return `<tr class="stk-group cmp-grp" data-cgrp="${escapeHtml(key)}">
    <td colspan="${CMP_COLS}">
      <div class="stk-group-main"><span class="stk-group-left">
        <span class="stk-group-name stk-group-unfiled">${loc && loc.factory_id ? '<i class="fa-solid fa-industry cmp-hopico"></i> ' : ''}${escapeHtml(name)}</span>
        ${loc && loc.planet ? `<span class="cmp-planet">${escapeHtml(loc.planet)}</span>` : ''}
        <span class="stk-group-count">${count} item${count === 1 ? '' : 's'}</span>
        <i class="fa-solid ${collapsed ? 'fa-caret-right' : 'fa-caret-down'} stk-caret stk-caret-trail" data-cgtoggle="${escapeHtml(key)}"></i>
      </span></div>
    </td>
  </tr>`;
}

function renderComponents() {
  $('#cmp-head').innerHTML = cmpHeadHtml();
  document.querySelectorAll('#cmp-view [data-cview]').forEach((b) => b.classList.toggle('active', b.dataset.cview === cmpState.view));
  const rows = cmpFiltered();
  const totals = cmpTotals();
  const parts = [];
  const gap = `<tr class="stk-group-gap"><td colspan="${CMP_COLS}"></td></tr>`;
  if (cmpState.view === 'item') {
    const groups = new Map();
    rows.forEach((r) => {
      const k = `i:${String(r.item_name).toLowerCase()}`;
      if (!groups.has(k)) groups.set(k, { name: r.item_name, rows: [] });
      groups.get(k).rows.push(r);
    });
    [...groups.entries()].sort((a, b) => a[1].name.localeCompare(b[1].name)).forEach(([k, g]) => {
      if (parts.length) parts.push(gap);
      const collapsed = cmpState.collapsed.has(k);
      parts.push(cmpItemHeadHtml(k, g.name, g.rows, totals, collapsed));
      if (!collapsed) {
        g.rows.sort((a, b) => cmpLocName(a.location_id).localeCompare(cmpLocName(b.location_id)));
        parts.push(...g.rows.map(cmpRowHtml));
      }
    });
  } else {
    // every location shows (empty ones too, unless a filter is narrowing the list)
    const narrowing = $('#cmp-srcfilter').value || $('#cmp-search').value.trim();
    const order = [...cmpState.locations.map((l) => String(l.id)), '0'];
    const locSel = $('#cmp-locfilter').value;
    order.forEach((lid) => {
      if (locSel !== '' && locSel !== lid) return;
      const mine = rows.filter((r) => String(safeInt(r.location_id)) === lid);
      if (!mine.length && (narrowing || lid === '0')) return;
      const k = `l:${lid}`;
      const collapsed = cmpState.collapsed.has(k);
      if (parts.length) parts.push(gap);
      parts.push(cmpLocHeadHtml(k, lid === '0' ? 'Unsorted' : cmpLocName(lid), cmpLoc(lid), mine.length, collapsed));
      if (!collapsed) parts.push(...mine.sort((a, b) => String(a.item_name).localeCompare(String(b.item_name))).map(cmpRowHtml));
    });
  }
  $('#cmp-body').innerHTML = parts.join('');
  const empty = $('#cmp-empty');
  if (!cmpState.rows.length && (cmpState.view === 'item' || !cmpState.locations.length)) {
    empty.innerHTML = 'No components yet — <b>Add Component</b> to track the parts you keep in hoppers, houses and backpacks.';
    empty.hidden = false;
  } else if (!rows.length && cmpState.view === 'item') {
    empty.textContent = 'Nothing matches these filters.';
    empty.hidden = false;
  } else empty.hidden = true;
  const items = new Set(rows.map((r) => String(r.item_name).toLowerCase())).size;
  $('#cmp-status').textContent = rows.length ? `${items} item${items === 1 ? '' : 's'} · ${rows.length} stack${rows.length === 1 ? '' : 's'}` : '';
}

// ---- add / edit dialog ------------------------------------------------------

// location suggestions: your spots, then each factory's hopper not set up yet
function cmpLocChoices() {
  const out = cmpState.locations.map((l) => ({ label: l.name, id: safeInt(l.id), hint: l.planet || (l.factory_id ? 'hopper' : '') }));
  const have = new Set(cmpState.locations.map((l) => String(l.factory_id || '')));
  cmpState.factories.filter((f) => !have.has(String(f.id))).forEach((f) => {
    out.push({ label: `Hopper: ${f.name || 'Factory'}`, factoryId: safeInt(f.id), hint: f.product || f.planet || 'factory' });
  });
  return out;
}

let cmpSugHover = false;
function cmpRenderLocSug(inputSel, boxSel) {
  const box = $(boxSel);
  if (cmpSugHover && !box.hidden) return; // frozen under the pointer (see inventory.js)
  const q = $(inputSel).value.trim().toLowerCase();
  const hits = cmpLocChoices().filter((c) => !q || c.label.toLowerCase().includes(q)).slice(0, 10);
  if (!hits.length) { box.hidden = true; return; }
  box.innerHTML = hits.map((c) => `<div class="inv-vendor-opt" data-cloc="${escapeHtml(c.label)}">${escapeHtml(c.label)}${c.hint ? ` <span class="cmp-planet">${escapeHtml(c.hint)}</span>` : ''}</div>`).join('');
  box.hidden = false;
}
function cmpBindLocSug(inputSel, boxSel) {
  const input = $(inputSel), box = $(boxSel);
  let suppress = false;
  input.addEventListener('focus', () => { suppress = false; cmpRenderLocSug(inputSel, boxSel); });
  input.addEventListener('input', () => { suppress = false; cmpRenderLocSug(inputSel, boxSel); });
  input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; }, 150));
  box.addEventListener('mouseenter', () => { cmpSugHover = true; });
  box.addEventListener('mouseleave', () => { cmpSugHover = false; if (!suppress) cmpRenderLocSug(inputSel, boxSel); });
  box.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('[data-cloc]');
    if (!opt) return;
    e.preventDefault();
    suppress = true; cmpSugHover = false;
    input.value = opt.dataset.cloc;
    box.hidden = true;
  });
}

// the typed location → { location_id } or { location_name }; a hopper choice is created first
async function cmpResolveLoc(text) {
  const t = text.trim();
  if (!t) return { location_id: 0 };
  const c = cmpLocChoices().find((x) => x.label.toLowerCase() === t.toLowerCase());
  if (c && c.id) return { location_id: c.id };
  if (c && c.factoryId) {
    const res = await apiFetch('POST', 'api/components.php', { data: { action: 'loc_add', factory_id: c.factoryId } });
    if (!res.ok) throw new Error(res.error || 'could not add the hopper');
    return { location_id: safeInt(res.data.id) };
  }
  return { location_name: t };
}

async function openCmpDialog(row = null, preset = null) {
  if (!cmpState.loaded) { try { await cmpFetch(); } catch (_) {} }
  cmpState.editId = row ? safeInt(row.id) : null;
  const v = row || preset || {};
  $('#cmp-modal-title').textContent = row ? 'Edit Component' : 'Add Component';
  $('#cmp-save').innerHTML = row ? '<i class="fa-solid fa-check"></i> Save' : '<i class="fa-solid fa-plus"></i> Add Component';
  $('#cmp-new-name').value = v.item_name || '';
  $('#cmp-new-units').value = String(v.units != null ? safeInt(v.units) : 1);
  $('#cmp-new-crate').value = safeInt(v.crate_size) > 1 ? String(safeInt(v.crate_size)) : '';
  $('#cmp-new-loc').value = row ? (row.location_id ? cmpLocName(row.location_id) : '') : (v.location || '');
  $('#cmp-new-source').value = CMP_SOURCES[v.source] ? v.source : 'crafted';
  $('#cmp-new-quality').value = v.quality != null && v.quality !== '' ? String(v.quality) : '';
  $('#cmp-new-notes').value = v.notes || '';
  $('#cmp-new-tags').value = v.tags || '';
  $('#cmp-add-modal').hidden = false;
  (row ? $('#cmp-new-units') : (v.item_name ? $('#cmp-new-loc') : $('#cmp-new-name'))).focus();
}

async function saveCmpDialog() {
  const name = $('#cmp-new-name').value.trim();
  if (!name) { toast('Enter the component name first', false); return; }
  const btn = $('#cmp-save');
  btn.disabled = true;
  let res;
  try {
    const loc = await cmpResolveLoc($('#cmp-new-loc').value);
    const q = $('#cmp-new-quality').value.trim();
    const data = {
      item_name: name,
      units: Math.max(0, safeInt($('#cmp-new-units').value)),
      crate_size: safeInt($('#cmp-new-crate').value),
      source: $('#cmp-new-source').value,
      quality: q === '' ? null : safeInt(q),
      notes: $('#cmp-new-notes').value.trim(),
      tags: $('#cmp-new-tags').value.trim(),
      ...loc,
    };
    res = await apiFetch('POST', 'api/components.php', { data: cmpState.editId
      ? { action: 'update', id: cmpState.editId, ...data } : { action: 'add', ...data } });
  } catch (e) { res = { ok: false, error: e.message || String(e) }; }
  btn.disabled = false;
  if (!res.ok) { toast(`Couldn't save ${name}: ${res.error || 'server error'}`, false); checkAuthError(res.error); return; }
  toast(cmpState.editId ? `${name} updated` : `${name} added to Components`);
  $('#cmp-add-modal').hidden = true;
  loadComponents();
}

async function removeCmpRow(id) {
  const r = cmpState.rows.find((x) => safeInt(x.id) === id);
  if (!r) return;
  const ok = await confirmDialog({
    title: `Remove ${r.item_name}?`,
    message: `${fmtNum(safeInt(r.units))} at ${cmpLocName(r.location_id)} come off your Components list.`,
    confirmLabel: 'Remove',
  });
  if (!ok) return;
  const res = await apiFetch('POST', 'api/components.php', { data: { action: 'remove', ids: [id] } });
  if (!res.ok) { toast(res.error || 'Remove failed', false); return; }
  toast(`${r.item_name} removed`);
  loadComponents();
}

// ---- move dialog: another location, a new one, or onto a vendor (Inventory) ----

async function cmpLoadInventory() {
  const all = [];
  for (let page = 1; page <= 10; page++) {
    const res = await apiFetch('GET', 'api/inventory.php', { params: { page, perpage: 500, sort: 'item_name', order: 'ASC' } });
    if (!res.ok) break;
    const got = (res.data && res.data.results) || [];
    all.push(...got);
    if (got.length < 500) break;
  }
  cmpState.inv = all;
  return all;
}

function openCmpMove(id) {
  const r = cmpState.rows.find((x) => safeInt(x.id) === id);
  if (!r) return;
  cmpState.move = r;
  const cs = safeInt(r.crate_size);
  $('#cmp-move-title').textContent = `Move ${r.item_name}`;
  $('#cmp-move-from').textContent = `${fmtNum(safeInt(r.units))} at ${cmpLocName(r.location_id)}${cs > 1 ? ` (${cmpCrates(safeInt(r.units), cs)} crates of ${fmtNum(cs)})` : ''}`;
  $('#cmp-move-unit').hidden = cs <= 1;
  $('#cmp-move-unit').value = cs > 1 && safeInt(r.units) % cs === 0 ? 'crates' : 'units';
  $('#cmp-move-amt').value = String($('#cmp-move-unit').value === 'crates' ? safeInt(r.units) / cs : safeInt(r.units));
  const dest = $('#cmp-move-dest');
  dest.innerHTML = cmpLocChoices()
    .filter((c) => !(c.id && c.id === safeInt(r.location_id)))
    .map((c) => `<option value="${c.id ? `loc:${c.id}` : `fac:${c.factoryId}`}">${escapeHtml(c.label)}</option>`).join('')
    + (r.location_id ? '<option value="loc:0">Unsorted</option>' : '')
    + '<option value="new">New location…</option><option value="inventory">Inventory (for sale)</option>';
  dest.value = dest.options.length > 2 ? dest.options[0].value : 'new';
  $('#cmp-move-newloc').value = '';
  $('#cmp-move-newname').value = r.item_name;
  $('#cmp-move-newvendor').value = '';
  $('#cmp-move-modal').hidden = false;
  cmpSyncMove();
  $('#cmp-move-amt').focus();
  $('#cmp-move-amt').select();
}

// units the dialog would move, from the amount + units/crates switch
function cmpMoveUnits() {
  const r = cmpState.move;
  const n = Math.max(0, safeInt($('#cmp-move-amt').value));
  return !$('#cmp-move-unit').hidden && $('#cmp-move-unit').value === 'crates' ? n * safeInt(r.crate_size) : n;
}

async function cmpSyncMove() {
  const r = cmpState.move;
  if (!r) return;
  const dest = $('#cmp-move-dest').value;
  $('#cmp-move-newloc-wrap').hidden = dest !== 'new';
  const toInv = dest === 'inventory';
  $('#cmp-move-inv-wrap').hidden = !toInv;
  const units = cmpMoveUnits(), cs = safeInt(r.crate_size);
  let hint = '';
  if (units > safeInt(r.units)) hint = `Only ${fmtNum(safeInt(r.units))} there.`;
  else if (toInv) {
    hint = cs > 1
      ? (units % cs ? `Vendors sell whole crates — move a multiple of ${fmtNum(cs)}.` : `Adds ${fmtNum(units / cs)} crate${units / cs === 1 ? '' : 's'} to the item’s Stocked (a crate sells as one listing).`)
      : `Adds ${fmtNum(units)} to the item’s Stocked.`;
  } else if (units && units < safeInt(r.units)) hint = `${fmtNum(safeInt(r.units) - units)} stay at ${cmpLocName(r.location_id)}.`;
  $('#cmp-move-hint').textContent = hint;
  if (!toInv) return;
  const sel = $('#cmp-move-inv');
  if (!cmpState.inv) {
    sel.innerHTML = '<option value="">Loading your inventory…</option>';
    await cmpLoadInventory();
    if (cmpState.move !== r) return;
  }
  if (sel.dataset.for !== String(r.id)) {
    const it = cmpItem(r.item_name);
    const linked = it && safeInt(it.inventory_id);
    const match = cmpState.inv.find((i) => String(i.item_name).toLowerCase() === String(r.item_name).toLowerCase());
    sel.innerHTML = '<option value="new">New Inventory item…</option>'
      + cmpState.inv.map((i) => `<option value="${safeInt(i.id)}">${escapeHtml(i.item_name)}${i.vendor ? ` — ${escapeHtml(i.vendor)}` : ''} (${fmtNum(safeInt(i.stocked))})</option>`).join('');
    sel.value = String(linked && cmpState.inv.some((i) => safeInt(i.id) === linked) ? linked : match ? safeInt(match.id) : 'new');
    sel.dataset.for = String(r.id);
  }
  $('#cmp-move-new-wrap').hidden = sel.value !== 'new';
}

async function doCmpMove() {
  const r = cmpState.move;
  if (!r) return;
  const units = cmpMoveUnits();
  if (!units) { toast('Enter how many to move', false); return; }
  if (units > safeInt(r.units)) { toast(`Only ${fmtNum(safeInt(r.units))} there`, false); return; }
  const dest = $('#cmp-move-dest').value;
  const data = { action: 'move', id: safeInt(r.id), units };
  let where = '';
  if (dest === 'inventory') {
    const cs = safeInt(r.crate_size);
    if (cs > 1 && units % cs) { toast(`Move whole crates (${fmtNum(cs)} a crate) to Inventory`, false); return; }
    data.to = 'inventory';
    const pick = $('#cmp-move-inv').value;
    if (pick === 'new') {
      const nm = $('#cmp-move-newname').value.trim();
      if (!nm) { toast('Name the Inventory item', false); return; }
      data.new_item = { item_name: nm, vendor: $('#cmp-move-newvendor').value.trim() };
      where = nm;
    } else {
      data.inventory_id = safeInt(pick);
      where = (cmpState.inv.find((i) => safeInt(i.id) === data.inventory_id) || {}).item_name || 'Inventory';
    }
  } else if (dest === 'new') {
    const nm = $('#cmp-move-newloc').value.trim();
    if (!nm) { toast('Name the new location', false); return; }
    data.to_location_name = nm;
    where = nm;
  } else if (dest.startsWith('fac:')) {
    let loc;
    try { loc = await cmpResolveLoc(($('#cmp-move-dest').selectedOptions[0] || {}).textContent || ''); }
    catch (e) { toast(e.message, false); return; }
    data.to_location_id = loc.location_id;
    where = ($('#cmp-move-dest').selectedOptions[0] || {}).textContent;
  } else {
    data.to_location_id = safeInt(dest.slice(4));
    where = data.to_location_id ? cmpLocName(data.to_location_id) : 'Unsorted';
  }
  const btn = $('#cmp-move-go');
  btn.disabled = true;
  const res = await apiFetch('POST', 'api/components.php', { data });
  btn.disabled = false;
  if (!res.ok) { toast(res.error || 'Move failed', false); return; }
  $('#cmp-move-modal').hidden = true;
  if (dest === 'inventory') {
    const n = safeInt(res.data && res.data.count);
    toast(`${fmtNum(n)} added to ${where} — ${fmtNum(safeInt(res.data && res.data.stocked))} on the shelf now`);
    cmpState.inv = null; // stock changed — refetch next time
    if (typeof salesInvNames !== 'undefined') salesInvNames = null;
  } else toast(`Moved ${fmtNum(units)} ${r.item_name} to ${where}`);
  cmpState.move = null;
  loadComponents();
}

// ---- locations manager ------------------------------------------------------

function renderCmpLocs() {
  const counts = new Map();
  cmpState.rows.forEach((r) => counts.set(String(safeInt(r.location_id)), (counts.get(String(safeInt(r.location_id))) || 0) + 1));
  $('#cmp-locs-list').innerHTML = cmpState.locations.length
    ? cmpState.locations.map((l) => `<div class="cmp-loc-row" data-clid="${safeInt(l.id)}">
        <span class="cmp-loc-ico">${l.factory_id ? '<i class="fa-solid fa-industry" title="Factory hopper"></i>' : '<i class="fa-solid fa-warehouse"></i>'}</span>
        <input class="form-control filter-input cmp-loc-name" value="${escapeHtml(l.name)}" aria-label="Location name">
        <input class="form-control filter-input cmp-loc-planet" value="${escapeHtml(l.planet || '')}" placeholder="Planet" aria-label="Planet">
        <span class="cmp-loc-count">${fmtNum(counts.get(String(l.id)) || 0)}</span>
        <button class="btn btn-icon" data-clremove="${safeInt(l.id)}" title="Remove this location — its parts drop to Unsorted"><i class="fa-solid fa-trash-can"></i></button>
      </div>`).join('')
    : '<div class="settings-hint">No locations yet — add your houses, storage containers and backpacks below, or a factory’s hopper.</div>';
  const have = new Set(cmpState.locations.map((l) => String(l.factory_id || '')));
  const free = cmpState.factories.filter((f) => !have.has(String(f.id)));
  $('#cmp-loc-fac').innerHTML = free.length
    ? '<option value="">Add a factory hopper…</option>' + free.map((f) => `<option value="${safeInt(f.id)}">${escapeHtml(f.name || 'Factory')}${f.product ? ` — ${escapeHtml(f.product)}` : ''}</option>`).join('')
    : '<option value="">Every factory has its hopper</option>';
  $('#cmp-loc-fac').disabled = !free.length;
}

async function openCmpLocs() {
  if (!cmpState.loaded) { try { await cmpFetch(); } catch (_) {} }
  renderCmpLocs();
  $('#cmp-loc-newname').value = '';
  $('#cmp-loc-newplanet').value = '';
  $('#cmp-locs-modal').hidden = false;
}

async function cmpLocsReload() {
  await cmpFetch();
  renderCmpLocs();
  cmpFillLocFilter();
  renderComponents();
}

// ---- low-stock warning (on an item's total across every location) ----------

function openCmpThresh(name) {
  cmpState.threshFor = name;
  const th = cmpThreshold(name);
  $('#cmp-thresh-title').textContent = name;
  $('#cmp-thresh-val').value = th >= 0 ? String(th) : '';
  const t = cmpTotals().get(String(name).toLowerCase());
  $('#cmp-thresh-now').textContent = `You have ${fmtNum(t ? t.units : 0)} in total right now.`;
  $('#cmp-thresh-modal').hidden = false;
  $('#cmp-thresh-val').focus();
}

async function saveCmpThresh(off = false) {
  const name = cmpState.threshFor;
  if (!name) return;
  const raw = $('#cmp-thresh-val').value.trim();
  const threshold = off || raw === '' ? -1 : Math.max(0, safeInt(raw));
  const res = await apiFetch('POST', 'api/components.php', { data: { action: 'item', item_name: name, threshold } });
  if (!res.ok) { toast(res.error || 'Save failed', false); return; }
  $('#cmp-thresh-modal').hidden = true;
  toast(threshold >= 0 ? `Warns when ${name} drops to ${fmtNum(threshold)}` : `Low-stock warning off for ${name}`);
  loadComponents();
}

// EDGE-triggered like inventory.js invNotifySweep: a previous-total map in
// localStorage detects the crossing (above → at/below), with a 24h floor
async function cmpNotifySweep(rows = null) {
  if (!rows) {
    let res;
    try { res = await cmpFetch(); } catch (_) { return; }
    if (!res.ok) return;
    rows = cmpState.rows;
  }
  let prev = {}, fired = {};
  try { prev = JSON.parse(localStorage.getItem('cmp_notify_state') || '{}'); } catch (_) {}
  try { fired = JSON.parse(localStorage.getItem('cmp_notify_fired') || '{}'); } catch (_) {}
  const now = Math.floor(Date.now() / 1000);
  const next = {};
  const totals = cmpTotals(rows);
  // items with a warning but no rows left count as 0
  cmpState.items.forEach((i) => { const k = String(i.item_name).toLowerCase(); if (!totals.has(k)) totals.set(k, { name: i.item_name, units: 0 }); });
  totals.forEach((t, k) => {
    next[k] = t.units;
    const th = cmpThreshold(t.name);
    if (!(k in prev) || th < 0) return;
    if (!(t.units <= th && safeInt(prev[k]) > th)) return;
    if (fired[k] && now - fired[k] < 86400) return;
    fired[k] = now;
    appLocalAlert(`Low on ${t.name}`, `${fmtNum(t.units)} left across your locations (warns at ${fmtNum(th)})`);
  });
  try {
    localStorage.setItem('cmp_notify_state', JSON.stringify(next));
    localStorage.setItem('cmp_notify_fired', JSON.stringify(fired));
  } catch (_) {}
}

function initComponents() {
  setTimeout(() => cmpNotifySweep(), 25000);
  setInterval(() => cmpNotifySweep(), 10 * 60 * 1000);

  ['#cmp-locfilter', '#cmp-srcfilter'].forEach((s) => $(s).addEventListener('change', renderComponents));
  $('#cmp-search').addEventListener('input', renderComponents);
  $('#cmp-view').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cview]');
    if (!b) return;
    cmpState.view = b.dataset.cview;
    try { localStorage.setItem(CMP_VIEW_KEY, cmpState.view); } catch (_) {}
    renderComponents();
  });
  $('[data-refresh="components"]').addEventListener('click', () => loadComponents());
  $('#cmp-add-open').addEventListener('click', () => openCmpDialog());
  $('#cmp-locs-open').addEventListener('click', openCmpLocs);

  $('#cmp-body').addEventListener('click', (e) => {
    const t = e.target.closest('[data-cmove],[data-cedit],[data-cdel],[data-cthresh],[data-cgrp]');
    if (!t) return;
    if (t.dataset.cmove) openCmpMove(safeInt(t.dataset.cmove));
    else if (t.dataset.cedit) openCmpDialog(cmpState.rows.find((r) => safeInt(r.id) === safeInt(t.dataset.cedit)));
    else if (t.dataset.cdel) removeCmpRow(safeInt(t.dataset.cdel));
    else if (t.dataset.cthresh) openCmpThresh(t.dataset.cthresh);
    else if (t.dataset.cgrp) {   // click a group row to fold it
      const k = t.dataset.cgrp;
      if (cmpState.collapsed.has(k)) cmpState.collapsed.delete(k); else cmpState.collapsed.add(k);
      renderComponents();
    }
  });

  // add / edit
  cmpBindLocSug('#cmp-new-loc', '#cmp-loc-sug');
  $('#cmp-save').addEventListener('click', saveCmpDialog);
  $('#cmp-add-cancel').addEventListener('click', () => { $('#cmp-add-modal').hidden = true; });
  bindBackdropClose($('#cmp-add-modal'), () => { $('#cmp-add-modal').hidden = true; });
  $('#cmp-add-modal').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') saveCmpDialog(); });

  // move
  ['#cmp-move-dest', '#cmp-move-unit', '#cmp-move-inv'].forEach((s) => $(s).addEventListener('change', cmpSyncMove));
  $('#cmp-move-amt').addEventListener('input', cmpSyncMove);
  $('#cmp-move-go').addEventListener('click', doCmpMove);
  $('#cmp-move-cancel').addEventListener('click', () => { $('#cmp-move-modal').hidden = true; cmpState.move = null; });
  bindBackdropClose($('#cmp-move-modal'), () => { $('#cmp-move-modal').hidden = true; cmpState.move = null; });
  $('#cmp-move-modal').addEventListener('keydown', (e) => { if (e.key === 'Enter') doCmpMove(); });

  // locations manager — rename / planet save on change; remove asks first
  $('#cmp-locs-done').addEventListener('click', () => { $('#cmp-locs-modal').hidden = true; });
  bindBackdropClose($('#cmp-locs-modal'), () => { $('#cmp-locs-modal').hidden = true; });
  $('#cmp-locs-list').addEventListener('change', async (e) => {
    const row = e.target.closest('[data-clid]');
    if (!row) return;
    const name = row.querySelector('.cmp-loc-name').value.trim();
    if (!name) { toast('A location needs a name', false); return; }
    const res = await apiFetch('POST', 'api/components.php', { data: {
      action: 'loc_update', id: safeInt(row.dataset.clid), name, planet: row.querySelector('.cmp-loc-planet').value.trim() } });
    if (!res.ok) { toast(res.error || 'Save failed', false); return; }
    toast('Location saved');
    await cmpLocsReload();
  });
  $('#cmp-locs-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-clremove]');
    if (!b) return;
    const id = safeInt(b.dataset.clremove);
    const n = cmpState.rows.filter((r) => safeInt(r.location_id) === id).length;
    $('#cmp-locs-modal').hidden = true;
    const ok = await confirmDialog({
      title: `Remove “${cmpLocName(id)}”?`,
      message: n ? `${n === 1 ? 'The stack' : `All ${fmtNum(n)} stacks`} kept there drop to Unsorted — nothing is deleted.` : 'Nothing is kept there.',
      confirmLabel: 'Remove location',
    });
    $('#cmp-locs-modal').hidden = false;
    if (!ok) return;
    const res = await apiFetch('POST', 'api/components.php', { data: { action: 'loc_remove', id } });
    if (!res.ok) { toast(res.error || 'Remove failed', false); return; }
    await cmpLocsReload();
  });
  const addLoc = async () => {
    const name = $('#cmp-loc-newname').value.trim();
    if (!name) { toast('Name the location first', false); return; }
    const res = await apiFetch('POST', 'api/components.php', { data: { action: 'loc_add', name, planet: $('#cmp-loc-newplanet').value.trim() } });
    if (!res.ok) { toast(res.error || 'Add failed', false); return; }
    $('#cmp-loc-newname').value = ''; $('#cmp-loc-newplanet').value = '';
    await cmpLocsReload();
  };
  $('#cmp-loc-add').addEventListener('click', addLoc);
  $('#cmp-loc-newname').addEventListener('keydown', (e) => { if (e.key === 'Enter') addLoc(); });
  $('#cmp-loc-fac').addEventListener('change', async (e) => {
    const fid = safeInt(e.target.value);
    if (!fid) return;
    const res = await apiFetch('POST', 'api/components.php', { data: { action: 'loc_add', factory_id: fid } });
    if (!res.ok) { toast(res.error || 'Add failed', false); return; }
    await cmpLocsReload();
  });

  // threshold
  $('#cmp-thresh-save').addEventListener('click', () => saveCmpThresh(false));
  $('#cmp-thresh-off').addEventListener('click', () => saveCmpThresh(true));
  $('#cmp-thresh-cancel').addEventListener('click', () => { $('#cmp-thresh-modal').hidden = true; });
  bindBackdropClose($('#cmp-thresh-modal'), () => { $('#cmp-thresh-modal').hidden = true; });
  $('#cmp-thresh-val').addEventListener('keydown', (e) => { if (e.key === 'Enter') saveCmpThresh(false); });
}
