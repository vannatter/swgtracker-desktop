/* Stockpile page — mirrors src/gui/stockpile_tab.py.
   Pulls the full stockpile from the server once, then filters/sorts locally.
   Stock edits and removals push to the server immediately.

   Folders/buckets: server-persisted groups (synced with the website). Buckets are
   opt-in — with none, the grid is a flat list exactly as before. Create one and the
   grid splits into collapsible sections; multi-select (checkboxes) + drag a selection
   onto a section header to file it. bucket_id null = the "Unfiled" section. */

const STK_COLUMNS = [
  ['Name', 'name', 'col-name'],
  ['Type', 'type_name', 'col-text'],
  ['Score', 'score', 'stat'],
  ['OQ', 'oq', 'stat'], ['CR', 'cr', 'stat'], ['CD', 'cd', 'stat'],
  ['DR', 'dr', 'stat'], ['HR', 'hr', 'stat'], ['MA', 'ma', 'stat'],
  ['SR', 'sr', 'stat'], ['UT', 'ut', 'stat'], ['FL', 'fl', 'stat'],
  ['PE', 'pe', 'stat'],
  ['Amount', 'stock', 'stat', 'Click a value to edit — supports shorthand like 300k / 4.5m'],
  ['My CPU', 'my_cpu', 'stat', 'Your cost per unit — what you paid (0 = mined it yourself). Click to edit; the Lab uses this for cost math.'],
  ['Added', 'date_added', 'col-text', 'When you stockpiled it — click the header to sort newest first'],
];
const STK_NUMERIC = new Set([...STAT_FIELDS, 'stock', 'score', 'my_cpu']);

// resourceIds: resource ids currently stocked — drives the ✓ marks in other grids
const stkState = {
  items: [], sortField: 'name', sortOrder: 'ASC', resourceIds: new Set(),
  buckets: [],           // [{id, name, sort_order}] — item counts derived locally
  collapsed: new Set(),  // group keys collapsed: 'unfiled' or String(bucketId)
  selection: new Set(),  // selected stockpile_ids (strings)
  lastSid: null,         // anchor row for shift-range select
  dragBucket: null,      // bucket key being dragged to reorder (null = dragging items)
  expanded: new Set(),   // stockpile_ids with their notes/schematics detail open
  mySchems: null,        // the user's My Schematics list (lazy-loaded once, for the detail panel)
  _mySchemsPromise: null,
};

const stkHasBuckets = () => stkState.buckets.length > 0;
const UNFILED = 'unfiled';

// total column count so group headers can colspan across the grid
function stkColCount() {
  // [select?] + data columns + [notes] + [remove]
  return (stkHasBuckets() ? 1 : 0) + STK_COLUMNS.length + 2;
}

function buildStkHeader() {
  const sel = stkHasBuckets()
    ? '<th class="stk-sel-cell" title="Select all shown"><input type="checkbox" class="stk-selall"></th>'
    : '';
  $('#stk-head').innerHTML = sel + sortableHeaderHtml(
    STK_COLUMNS, stkState.sortField, stkState.sortOrder)
    + '<th class="pin-cell"></th><th class="pin-cell"></th>'; // notes + remove
}

function stkRowHtml(item, idx) {
  const cells = STK_COLUMNS.map(([, field]) => {
    if (field === 'name') return `<td class="col-name res-name">${escapeHtml(item.name || '')}</td>`;
    if (field === 'type_name') return `<td class="col-text res-type">${escapeHtml(item.type_name || '')}</td>`;
    if (field === 'stock') return `<td class="stat stk-stock" data-stock="${idx}">${fmtNum(item.stock)}</td>`;
    if (field === 'date_added') return `<td class="col-text">${fmtAgoTip(item.date_added)}</td>`;
    if (field === 'my_cpu') {
      const has = item.my_cpu !== null && item.my_cpu !== undefined && item.my_cpu !== '';
      return `<td class="stat stk-stock" data-mycpu="${idx}" title="Your cost per unit — what you paid (0 = mined it yourself)">${has ? Number(item.my_cpu) : '—'}</td>`;
    }
    if (field === 'score') {
      const v = safeInt(item.score); // 0–100, already a percent
      return `<td class="stat ${qualityClass(v)}">${v}</td>`;
    }
    return statCell(item[field], item[`${field}_max`]);
  }).join('');

  const buckets = stkHasBuckets();
  const sid = String(item.stockpile_id);
  const selected = stkState.selection.has(sid);
  const selCell = buckets
    ? `<td class="stk-sel-cell"><input type="checkbox" class="stk-sel" data-sid="${sid}"${selected ? ' checked' : ''}></td>`
    : '';
  const group = item.bucket_id != null ? String(item.bucket_id) : UNFILED;
  const hasNotes = item.notes && String(item.notes).trim();
  const open = stkState.expanded.has(sid);
  const noteCell = `<td class="pin-cell stk-note-cell${open ? ' open' : ''}" data-notes="${idx}" title="${hasNotes ? 'Notes + linked schematics' : 'Notes / linked schematics'}"><i class="fa-${hasNotes ? 'solid' : 'regular'} fa-note-sticky${hasNotes ? ' stk-has-notes' : ''}"></i></td>`;
  return `<tr data-idx="${idx}" data-sid="${sid}"${buckets ? ` data-group="${group}" draggable="true"` : ''} class="stk-row${selected ? ' stk-selected' : ''}${open ? ' stk-row-open' : ''}">
    ${selCell}${cells}
    ${noteCell}
    <td class="pin-cell" data-remove="${idx}" title="Remove from stockpile"><i class="fa-solid fa-trash-can"></i></td>
  </tr>`;
}

// item row + (when expanded) its notes/schematics detail row
function stkRowsHtml(item, idx) {
  let html = stkRowHtml(item, idx);
  if (stkState.expanded.has(String(item.stockpile_id))) html += stkDetailRowHtml(item);
  return html;
}

function stkDetailRowHtml(item) {
  const sid = String(item.stockpile_id);
  return `<tr class="stk-detail" data-detailfor="${sid}">
    <td colspan="${stkColCount()}">
      <div class="stk-detail-panel">
        <div class="stk-detail-col stk-detail-notes">
          <div class="stk-detail-label"><i class="fa-solid fa-pen"></i> Notes</div>
          <textarea class="stk-notes-input" data-notesfor="${sid}" rows="3"
            placeholder="Notes for ${escapeHtml(item.name)}…">${escapeHtml(item.notes || '')}</textarea>
        </div>
        <div class="stk-detail-col stk-detail-schems">
          <div class="stk-detail-label"><i class="fa-solid fa-scroll"></i> Your schematics using this</div>
          <div class="stk-schem-list" data-schemfor="${item.id}" data-resname="${escapeHtml(item.name)}">
            <span class="stat_off">Loading…</span>
          </div>
        </div>
      </div>
    </td>
  </tr>`;
}

// the user's crafting-list schematics (loaded once) so the detail panel can show
// which of THEIR schematics a resource is assigned to
async function stkGetMySchems() {
  if (stkState.mySchems) return stkState.mySchems;
  if (!stkState._mySchemsPromise) {
    stkState._mySchemsPromise = (async () => {
      const all = [];
      let page = 1;
      while (true) {
        let res;
        try { res = await api().get_my_schematics({ page, perpage: 200 }); }
        catch (_) { break; }
        if (!res.ok || !res.data) break;
        const rows = res.data.results || [];
        all.push(...rows);
        if (rows.length < 200) break;
        page++;
      }
      stkState.mySchems = all;
      return all;
    })();
  }
  return stkState._mySchemsPromise;
}

// show the user's schematics where this resource is the assigned pick for an ingredient
async function stkLoadSchems(el) {
  const resId = String(el.dataset.schemfor);
  const resName = el.dataset.resname;
  let mine;
  try { mine = await stkGetMySchems(); }
  catch (_) { el.innerHTML = '<span class="stat_off">Couldn’t load your schematics.</span>'; return; }
  const using = (mine || []).filter((s) => (s.resources || []).some((r) =>
    (r.resource && String(r.resource.id) === resId) || (r.resource_name && r.resource_name === resName)));
  if (!using.length) { el.innerHTML = '<span class="stat_off">—</span>'; return; }
  el.innerHTML = using.map((s) => {
    const label = s.custom_name ? `${s.name} · ${s.custom_name}` : (s.name || '');
    return `<span class="stk-schem-chip" data-usid="${escapeHtml(String(s.user_schematic_id))}">${escapeHtml(label)}</span>`;
  }).join('');
}

async function stkSaveNotes(sid, value) {
  const item = stkState.items.find((i) => String(i.stockpile_id) === String(sid));
  if (!item) return;
  const v = (value || '').trim();
  if ((item.notes || '') === v) return; // unchanged
  item.notes = v; // optimistic
  // flip the note icon indicator in place (avoid a re-render that would drop focus)
  const ico = $(`#stk-body tr[data-sid="${sid}"] .stk-note-cell i`);
  if (ico) ico.className = v ? 'fa-solid fa-note-sticky stk-has-notes' : 'fa-regular fa-note-sticky';
  try {
    const res = await api().update_stockpile_notes(item.stockpile_id, v);
    $('#stk-status').textContent = res.ok ? `Notes saved — ${item.name}` : `Failed to save notes: ${res.error || 'server error'}`;
  } catch (e) { $('#stk-status').textContent = `Failed to save notes: ${e}`; }
}

function stkGroupHeaderHtml(key, name, count, deletable) {
  const collapsed = stkState.collapsed.has(key);
  const nameHtml = deletable
    ? `<span class="stk-group-name" data-renamebucket="${key}" title="Click to rename">${escapeHtml(name)}</span>`
    : `<span class="stk-group-name stk-group-unfiled">${escapeHtml(name)}</span>`;
  // trash lives in a trailing pin-cell so it lines up with the per-row remove column
  const delCell = deletable
    ? `<td class="pin-cell"><button class="stk-bucket-del" data-delbucket="${key}" title="Delete folder (its items become Unfiled)"><i class="fa-solid fa-trash-can"></i></button></td>`
    : '<td class="pin-cell"></td>';
  return `<tr class="stk-group${deletable ? ' stk-group-draggable' : ''}" data-group="${key}" data-drop="${key}"${deletable ? ' draggable="true"' : ''}>
    <td colspan="${stkColCount() - 1}">
      <div class="stk-group-main">
        <span class="stk-group-left">
          <i class="fa-solid ${collapsed ? 'fa-caret-right' : 'fa-caret-down'} stk-caret" data-togglebucket="${key}"></i>
          ${nameHtml}
          <span class="stk-group-count">${count} item${count === 1 ? '' : 's'}</span>
        </span>
      </div>
    </td>
    ${delCell}
  </tr>`;
}

// drop bucket `dragKey` at the position of `targetKey` (UNFILED = move to the end)
async function stkReorderBucket(dragKey, targetKey) {
  if (String(dragKey) === String(targetKey)) return;
  const ordered = [...stkState.buckets].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
  const from = ordered.findIndex((b) => String(b.id) === String(dragKey));
  if (from < 0) return;
  const [moved] = ordered.splice(from, 1);
  let to = (targetKey === UNFILED) ? ordered.length
    : ordered.findIndex((b) => String(b.id) === String(targetKey));
  if (to < 0) to = ordered.length;
  ordered.splice(to, 0, moved);
  ordered.forEach((b, k) => { b.sort_order = k; });
  renderStockpile();
  try {
    await Promise.all(ordered.map((b) => api().update_stockpile_bucket(b.id, null, b.sort_order)));
  } catch (e) { toast(String(e), false); await syncStockpile(); }
}

function stkVisibleItems() {
  const q = $('#stk-search').value.trim().toLowerCase();
  let items = stkState.items;
  if (q) {
    items = items.filter((i) =>
      String(i.name || '').toLowerCase().includes(q) ||
      String(i.type_name || '').toLowerCase().includes(q));
  }
  const { sortField, sortOrder } = stkState;
  const dir = sortOrder === 'DESC' ? -1 : 1;
  return [...items].sort((a, b) => {
    // added-order lives in the auto-increment id — also right for rows
    // stockpiled before date_added existed
    if (sortField === 'date_added') return dir * (safeInt(a.stockpile_id) - safeInt(b.stockpile_id));
    if (STK_NUMERIC.has(sortField)) return dir * (safeInt(a[sortField]) - safeInt(b[sortField]));
    return dir * String(a[sortField] ?? '').toLowerCase().localeCompare(String(b[sortField] ?? '').toLowerCase());
  });
}

function renderStockpile(statusMsg) {
  buildStkHeader();
  const items = stkVisibleItems();
  const idxOf = (item) => stkState.items.indexOf(item); // data-idx points into the master list

  let rowsHtml;
  if (!stkHasBuckets()) {
    rowsHtml = items.map((item) => stkRowsHtml(item, idxOf(item))).join('');
  } else {
    // one section per bucket (in sort order), then Unfiled
    const byGroup = new Map();
    stkState.buckets.forEach((b) => byGroup.set(String(b.id), []));
    byGroup.set(UNFILED, []);
    items.forEach((item) => {
      const key = item.bucket_id != null ? String(item.bucket_id) : UNFILED;
      (byGroup.get(key) || byGroup.get(UNFILED)).push(item);
    });
    const parts = [];
    const spacer = `<tr class="stk-group-gap"><td colspan="${stkColCount()}"></td></tr>`;
    const ordered = [...stkState.buckets].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
    ordered.forEach((b) => {
      const key = String(b.id);
      const list = byGroup.get(key) || [];
      if (parts.length) parts.push(spacer); // slight gap between folders
      parts.push(stkGroupHeaderHtml(key, b.name, list.length, true));
      if (!stkState.collapsed.has(key)) parts.push(...list.map((item) => stkRowsHtml(item, idxOf(item))));
    });
    const unfiled = byGroup.get(UNFILED) || [];
    if (parts.length) parts.push(spacer);
    parts.push(stkGroupHeaderHtml(UNFILED, 'Unfiled', unfiled.length, false));
    if (!stkState.collapsed.has(UNFILED)) parts.push(...unfiled.map((item) => stkRowsHtml(item, idxOf(item))));
    rowsHtml = parts.join('');
  }
  $('#stk-body').innerHTML = rowsHtml;
  // fill any open detail panels with their linked schematics (cached after first load)
  $('#stk-body').querySelectorAll('.stk-schem-list').forEach((el) => stkLoadSchems(el));

  const empty = $('#stk-empty');
  if (!items.length && !stkHasBuckets()) {
    empty.textContent = stkState.items.length ? 'No matches in your stockpile.' : 'Your stockpile is empty.';
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }

  // keep the header select-all in sync so it reads (and toggles) correctly
  const selall = $('#stk-head .stk-selall');
  if (selall) {
    const vis = [...$('#stk-body').querySelectorAll('tr.stk-row')];
    const selCount = vis.filter((r) => stkState.selection.has(r.dataset.sid)).length;
    selall.checked = vis.length > 0 && selCount === vis.length;
    selall.indeterminate = selCount > 0 && selCount < vis.length;
  }

  const sel = stkState.selection.size;
  $('#stk-status').textContent = statusMsg
    || (sel ? `${sel} selected — drag onto a folder to file` : null)
    || `${items.length}${items.length === stkState.items.length ? '' : ` of ${stkState.items.length}`} items in stockpile`;
}

async function syncStockpile() {
  showGridLoading('#stk-loading');
  $('#stk-empty').hidden = true;

  // Pull every page (perpage 500, same as the Tk app's sync)
  const all = [];
  let page = 1, error = null;
  while (true) {
    let res;
    try { res = await api().get_stockpile({ page, perpage: 500 }); }
    catch (e) { res = { ok: false, error: String(e) }; }
    if (!res.ok || !res.data) { error = res.error; break; }
    const results = (res.data.results) || [];
    all.push(...results);
    if (results.length < 500) break;
    page++;
  }

  // Buckets are best-effort: if the endpoint isn't there (older server) just show a flat list.
  try {
    const br = await api().get_stockpile_buckets();
    stkState.buckets = (br.ok && br.data && Array.isArray(br.data.buckets)) ? br.data.buckets : [];
  } catch (_) { stkState.buckets = []; }
  // drop selection/collapsed state that no longer maps to a live bucket
  const liveKeys = new Set(stkState.buckets.map((b) => String(b.id)).concat(UNFILED));
  [...stkState.collapsed].forEach((k) => { if (!liveKeys.has(k)) stkState.collapsed.delete(k); });
  stkState.selection.clear();
  stkState.mySchems = null; stkState._mySchemsPromise = null; // refresh the detail-panel schematics too

  $('#stk-loading').hidden = true;

  if (error) {
    // Never mask a failed sync behind cached data — say it loudly.
    toast(`Stockpile sync failed: ${error}`, false);
    checkAuthError(error);
    if (!all.length) {
      renderStockpile(`Sync failed: ${error}`);
      return;
    }
  }

  // Older rows may lack the public `score` alias — fall back to value_rating
  all.forEach((i) => { if (i.score == null) i.score = safeInt(i.value_rating); });
  stkState.items = all;
  stkState.resourceIds = new Set(all.map((i) => String(i.id)));
  renderStockpile(`Synced ${all.length} items from server`);
  refreshAddIcons();
}

// --- Inline stock editor ---

function openStockEditor(cell) {
  if (cell.querySelector('input')) return;
  const idx = safeInt(cell.dataset.stock);
  const item = stkState.items[idx];
  if (!item) return;

  const current = safeInt(item.stock);
  // text input, not number: shorthand like 300k / 4.5m must be typeable
  cell.innerHTML = `<input type="text" inputmode="decimal" class="stock-input" value="${current}"
    title="Supports shorthand: 300k, 4m, 4.5m">`;
  const input = cell.querySelector('input');
  input.focus();
  input.select();

  let done = false;
  const finish = (save) => {
    if (done) return;
    done = true;
    const parsed = Math.round(parseAmount(input.value));
    const bad = save && Number.isNaN(parsed);
    const value = save && !bad ? parsed : current;
    cell.textContent = fmtNum(value); // commas in view mode, plain while editing
    if (bad) toast(`Couldn't read "${input.value}" — try 300000, 300k, or 4.5m`, false);
    else if (save && value !== current) pushStockUpdate(item, value);
  };

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

function openMyCpuEditor(cell) {
  if (cell.querySelector('input')) return;
  const idx = safeInt(cell.dataset.mycpu);
  const item = stkState.items[idx];
  if (!item) return;
  const has = item.my_cpu !== null && item.my_cpu !== undefined && item.my_cpu !== '';
  const current = has ? Number(item.my_cpu) : '';
  cell.innerHTML = `<input type="text" inputmode="decimal" class="stock-input" value="${current}"
    title="Cost per unit — 0 = self-mined, blank clears">`;
  const input = cell.querySelector('input');
  input.focus();
  input.select();

  let done = false;
  const finish = async (save) => {
    if (done) return;
    done = true;
    const raw = input.value.trim();
    const value = raw === '' ? null : Number(raw);
    const bad = save && raw !== '' && (Number.isNaN(value) || value < 0);
    if (!save || bad) {
      cell.textContent = has ? current : '—';
      if (bad) toast(`"${input.value}" isn't a cost — use a number like 2 or 4.5`, false);
      return;
    }
    item.my_cpu = value; // optimistic
    cell.textContent = value === null ? '—' : value;
    try {
      const res = await api().update_stockpile(item.stockpile_id, null, value);
      $('#stk-status').textContent = res.ok
        ? `My CPU updated — ${item.name}: ${value === null ? 'cleared' : value}`
        : `Failed to update ${item.name}: ${res.error || 'server error'}`;
    } catch (e) {
      $('#stk-status').textContent = `Failed to update ${item.name}: ${e}`;
    }
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

async function pushStockUpdate(item, stock) {
  item.stock = stock; // optimistic — grid already shows the new value
  try {
    const res = await api().update_stockpile(item.stockpile_id, stock);
    $('#stk-status').textContent = res.ok
      ? `Stock updated — ${item.name}: ${fmtNum(stock)}`
      : `Failed to update ${item.name}: ${res.error || 'server error'}`;
  } catch (e) {
    $('#stk-status').textContent = `Failed to update ${item.name}: ${e}`;
  }
}

async function removeStockItem(idx) {
  const item = stkState.items[idx];
  if (!item) return;
  await removeFromStockpileByResource(item.id, item.name); // shared.js — updates grid + icons
}

// --- Buckets: selection, drag-to-file, and folder CRUD ---

function stkSetSelected(sid, on) {
  sid = String(sid);
  if (on) stkState.selection.add(sid); else stkState.selection.delete(sid);
  const row = $(`#stk-body tr[data-sid="${sid}"]`);
  if (row) {
    row.classList.toggle('stk-selected', on);
    const cb = row.querySelector('.stk-sel');
    if (cb) cb.checked = on;
  }
}

function stkToggleSelect(sid, shift) {
  const order = [...$('#stk-body').querySelectorAll('tr.stk-row')].map((r) => r.dataset.sid);
  if (shift && stkState.lastSid && order.includes(stkState.lastSid)) {
    const a = order.indexOf(stkState.lastSid);
    const b = order.indexOf(String(sid));
    if (a >= 0 && b >= 0) {
      const [lo, hi] = a < b ? [a, b] : [b, a];
      for (let i = lo; i <= hi; i++) stkSetSelected(order[i], true);
    }
  } else {
    stkSetSelected(sid, !stkState.selection.has(String(sid)));
    stkState.lastSid = String(sid);
  }
  renderStockpile();
}

async function stkAssignSelectionTo(groupKey) {
  const sids = [...stkState.selection];
  if (!sids.length) return;
  const bucketId = groupKey === UNFILED ? null : Number(groupKey);
  const sidSet = new Set(sids.map(String));
  // optimistic move
  stkState.items.forEach((it) => { if (sidSet.has(String(it.stockpile_id))) it.bucket_id = bucketId; });
  stkState.selection.clear();
  stkState.lastSid = null;
  const dest = bucketId == null ? 'Unfiled' : (stkState.buckets.find((b) => b.id === bucketId)?.name || 'folder');
  renderStockpile(`Moved ${sids.length} to ${dest}`);
  try {
    const res = await api().assign_stockpile_bucket(sids, bucketId);
    if (!res.ok) { toast(res.error || 'Move failed — resyncing', false); await syncStockpile(); }
  } catch (e) { toast(String(e), false); await syncStockpile(); }
}

async function stkNewBucket() {
  let res;
  try { res = await api().create_stockpile_bucket('New folder'); }
  catch (e) { toast(String(e), false); return; }
  if (!res.ok) { toast(res.error || 'Could not create folder', false); return; }
  stkState.buckets.push({ id: res.data.id, name: res.data.name, sort_order: res.data.sort_order });
  renderStockpile();
  stkBeginRename(String(res.data.id));
}

function stkBeginRename(key) {
  const span = $(`#stk-body [data-renamebucket="${key}"]`);
  if (!span) return;
  const bucket = stkState.buckets.find((b) => String(b.id) === String(key));
  if (!bucket) return;
  span.outerHTML = `<input type="text" class="form-control filter-input stk-rename-input" data-renamein="${key}" value="${escapeHtml(bucket.name)}" maxlength="100">`;
  const inp = $(`#stk-body [data-renamein="${key}"]`);
  inp.focus();
  inp.select();
}

async function stkCommitRename(key, value) {
  const bucket = stkState.buckets.find((b) => String(b.id) === String(key));
  if (!bucket) { renderStockpile(); return; }
  const name = value.trim();
  if (name && name !== bucket.name) {
    bucket.name = name; // optimistic
    renderStockpile();
    try {
      const res = await api().update_stockpile_bucket(bucket.id, name);
      if (!res.ok) { toast(res.error || 'Rename failed', false); await syncStockpile(); }
    } catch (e) { toast(String(e), false); }
  } else {
    renderStockpile();
  }
}

async function stkDeleteBucket(key) {
  const id = Number(key);
  const bucket = stkState.buckets.find((b) => b.id === id);
  if (!bucket) return;
  stkState.buckets = stkState.buckets.filter((b) => b.id !== id);
  stkState.items.forEach((it) => { if (Number(it.bucket_id) === id) it.bucket_id = null; }); // fall to Unfiled
  stkState.collapsed.delete(key);
  renderStockpile(`Deleted folder "${bucket.name}"`);
  try {
    const res = await api().delete_stockpile_bucket(id);
    if (!res.ok) { toast(res.error || 'Delete failed — resyncing', false); await syncStockpile(); }
  } catch (e) { toast(String(e), false); await syncStockpile(); }
}

function initStockpile() {
  buildStkHeader();

  $('#stk-search').addEventListener('input', () => renderStockpile());
  $('[data-refresh="stockpile"]').addEventListener('click', () => syncStockpile());
  $('#stk-new-bucket')?.addEventListener('click', () => stkNewBucket());

  // Column sort (+ select-all lives in the header when buckets are on)
  $('#stk-head').addEventListener('click', (e) => {
    const selall = e.target.closest('.stk-selall');
    if (selall) {
      const rows = [...$('#stk-body').querySelectorAll('tr.stk-row')];
      const turnOn = selall.checked;
      stkState.selection.clear();
      if (turnOn) rows.forEach((r) => stkState.selection.add(r.dataset.sid));
      renderStockpile();
      return;
    }
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const field = th.dataset.sort;
    if (stkState.sortField === field) {
      stkState.sortOrder = stkState.sortOrder === 'DESC' ? 'ASC' : 'DESC';
    } else {
      stkState.sortField = field;
      stkState.sortOrder = (STK_NUMERIC.has(field) || field === 'date_added') ? 'DESC' : 'ASC'; // Added: newest first
    }
    renderStockpile();
  });

  // Body clicks: selection, folder controls, inline edits, remove, name → resource page
  $('#stk-body').addEventListener('click', (e) => {
    const cb = e.target.closest('.stk-sel');
    if (cb) { stkToggleSelect(cb.dataset.sid, e.shiftKey); return; }

    // folder header: rename (name) and delete keep their own behavior; clicking
    // anywhere else on the header row collapses/expands it.
    const grp = e.target.closest('tr.stk-group');
    if (grp) {
      if (e.target.closest('[data-renamein]')) return; // typing in the rename box
      const rename = e.target.closest('[data-renamebucket]');
      if (rename) { stkBeginRename(rename.dataset.renamebucket); return; }
      const del = e.target.closest('[data-delbucket]');
      if (del) {
        if (confirmArm(del, 'Click again to delete this folder')) stkDeleteBucket(del.dataset.delbucket);
        return;
      }
      const key = grp.dataset.group;
      if (stkState.collapsed.has(key)) stkState.collapsed.delete(key); else stkState.collapsed.add(key);
      renderStockpile();
      return;
    }

    // notes/schematics detail toggle + clicking a linked-schematic chip
    const noteCell = e.target.closest('[data-notes]');
    if (noteCell) {
      const item = stkState.items[safeInt(noteCell.dataset.notes)];
      if (item) {
        const sid = String(item.stockpile_id);
        if (stkState.expanded.has(sid)) stkState.expanded.delete(sid); else stkState.expanded.add(sid);
        renderStockpile();
      }
      return;
    }
    const chip = e.target.closest('.stk-schem-chip');
    if (chip && chip.dataset.usid) {
      const item = (stkState.mySchems || []).find((s) => String(s.user_schematic_id) === String(chip.dataset.usid));
      if (item) openMySchematicPage(item);
      return;
    }

    const stockCell = e.target.closest('[data-stock]');
    if (stockCell) { openStockEditor(stockCell); return; }
    const cpuCell = e.target.closest('[data-mycpu]');
    if (cpuCell) { openMyCpuEditor(cpuCell); return; }
    const removeCell = e.target.closest('[data-remove]');
    if (removeCell) {
      if (confirmArm(removeCell, 'Click again to remove from stockpile')) {
        removeStockItem(safeInt(removeCell.dataset.remove));
      }
      return;
    }
    const nameCell = e.target.closest('td.res-name');
    if (nameCell) openResourcePage(nameCell.textContent);
  });

  // Rename commit on blur / Enter / Escape; notes save on blur
  $('#stk-body').addEventListener('focusout', (e) => {
    const inp = e.target.closest('[data-renamein]');
    if (inp) { stkCommitRename(inp.dataset.renamein, inp.value); return; }
    const notes = e.target.closest('[data-notesfor]');
    if (notes) stkSaveNotes(notes.dataset.notesfor, notes.value);
  });
  $('#stk-body').addEventListener('keydown', (e) => {
    const inp = e.target.closest('[data-renamein]');
    if (inp && (e.key === 'Enter' || e.key === 'Escape')) {
      if (e.key === 'Escape') inp.value = ''; // discard — commit ignores empty
      inp.blur();
    }
  });

  // Drag any row (grab anywhere except the link/editable cells/actions) onto a folder
  // header to file it — no need to select first. If rows ARE multi-selected, the whole
  // selection moves together.
  $('#stk-body').addEventListener('dragstart', (e) => {
    // dragging a FOLDER HEADER reorders buckets
    const grpRow = e.target.closest('tr.stk-group[draggable="true"]');
    if (grpRow) {
      if (e.target.closest('[data-delbucket], [data-renamein]')) { e.preventDefault(); return; }
      stkState.dragBucket = grpRow.dataset.group;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', 'bucket:' + stkState.dragBucket);
      const name = grpRow.querySelector('.stk-group-name');
      const ghost = document.createElement('div');
      ghost.className = 'stk-drag-ghost';
      ghost.textContent = name ? name.textContent : 'folder';
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, -12, -8);
      setTimeout(() => ghost.remove(), 0);
      return;
    }
    stkState.dragBucket = null;
    const row = e.target.closest('tr.stk-row[draggable="true"]');
    if (!row) return;
    // the name link, amount/cpu editors, remove, and the checkbox keep their own behavior
    if (e.target.closest('[data-stock], [data-mycpu], [data-remove], [data-notes], td.res-name, .stk-sel')) {
      e.preventDefault();
      return;
    }
    const sid = row.dataset.sid;
    if (!stkState.selection.has(sid)) {
      // grab just this row — update the DOM in place; a full re-render here would
      // replace the dragged element and abort the drag.
      $('#stk-body').querySelectorAll('tr.stk-row.stk-selected').forEach((r) => {
        r.classList.remove('stk-selected');
        const cb = r.querySelector('.stk-sel'); if (cb) cb.checked = false;
      });
      stkState.selection.clear();
      stkState.selection.add(sid);
      row.classList.add('stk-selected');
      const cb = row.querySelector('.stk-sel'); if (cb) cb.checked = true;
    }
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', [...stkState.selection].join(','));
    // a solid chip as the drag image — rows drag as transparent text otherwise
    const n = stkState.selection.size;
    const ghost = document.createElement('div');
    ghost.className = 'stk-drag-ghost';
    ghost.textContent = `${n} item${n === 1 ? '' : 's'}`;
    document.body.appendChild(ghost);
    e.dataTransfer.setDragImage(ghost, -12, -8);
    setTimeout(() => ghost.remove(), 0);
  });
  // double-click a row (not on the link/editable cells) to toggle its selection,
  // so you can pick several and drag them together
  $('#stk-body').addEventListener('dblclick', (e) => {
    if (!stkHasBuckets()) return;
    const row = e.target.closest('tr.stk-row');
    if (!row) return;
    if (e.target.closest('[data-stock], [data-mycpu], [data-remove], td.res-name, .stk-sel')) return;
    stkToggleSelect(row.dataset.sid, e.shiftKey);
  });
  const clearDropHover = () => $('#stk-body').querySelectorAll('.stk-drop-hover, .stk-reorder-over')
    .forEach((el) => el.classList.remove('stk-drop-hover', 'stk-reorder-over'));
  $('#stk-body').addEventListener('dragover', (e) => {
    const zone = e.target.closest('[data-group]');
    if (!zone) return;
    const key = zone.dataset.group;
    const header = $(`#stk-body tr.stk-group[data-drop="${key}"]`);
    if (stkState.dragBucket) {
      // reordering a folder — highlight the header we'd drop before
      if (key === stkState.dragBucket) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDropHover();
      header?.classList.add('stk-reorder-over');
    } else if (stkState.selection.size) {
      // filing items into a folder
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      clearDropHover();
      header?.classList.add('stk-drop-hover');
    }
  });
  $('#stk-body').addEventListener('dragleave', (e) => {
    if (!e.relatedTarget || !$('#stk-body').contains(e.relatedTarget)) clearDropHover();
  });
  $('#stk-body').addEventListener('drop', (e) => {
    const zone = e.target.closest('[data-group]');
    clearDropHover();
    if (!zone) return;
    e.preventDefault();
    if (stkState.dragBucket) {
      stkReorderBucket(stkState.dragBucket, zone.dataset.group);
      stkState.dragBucket = null;
    } else if (stkState.selection.size) {
      stkAssignSelectionTo(zone.dataset.group);
    }
  });
  $('#stk-body').addEventListener('dragend', () => { stkState.dragBucket = null; clearDropHover(); });
}
