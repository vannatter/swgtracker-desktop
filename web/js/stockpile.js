/* Stockpile page — mirrors src/gui/stockpile_tab.py.
   Pulls the full stockpile from the server once, then filters/sorts locally.
   Stock edits and removals push to the server immediately. */

const STK_COLUMNS = [
  ['Name', 'name', 'col-name'],
  ['Type', 'type_name', 'col-text'],
  ['Score', 'score', 'stat'],
  ['OQ', 'oq', 'stat'], ['CR', 'cr', 'stat'], ['CD', 'cd', 'stat'],
  ['DR', 'dr', 'stat'], ['HR', 'hr', 'stat'], ['MA', 'ma', 'stat'],
  ['SR', 'sr', 'stat'], ['UT', 'ut', 'stat'], ['FL', 'fl', 'stat'],
  ['PE', 'pe', 'stat'],
  ['Amount', 'stock', 'stat', 'Click a value to edit — supports shorthand like 300k / 4.5m'],
  ['Added', 'date_added', 'col-text', 'When you stockpiled it — click to see your newest first'],
  ['My CPU', 'my_cpu', 'stat', 'Your cost per unit — what you paid (0 = mined it yourself). Click to edit; the Lab uses this for cost math.'],
];
const STK_NUMERIC = new Set([...STAT_FIELDS, 'stock', 'score', 'my_cpu']);

// resourceIds: resource ids currently stocked — drives the ✓ marks in other grids
const stkState = { items: [], sortField: 'name', sortOrder: 'ASC', resourceIds: new Set() };

function buildStkHeader() {
  $('#stk-head').innerHTML = sortableHeaderHtml(
    STK_COLUMNS, stkState.sortField, stkState.sortOrder) + '<th class="pin-cell"></th>';
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

  return `<tr data-idx="${idx}">
    ${cells}
    <td class="pin-cell" data-remove="${idx}" title="Remove from stockpile"><i class="fa-solid fa-trash-can"></i></td>
  </tr>`;
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

  // data-idx points into stkState.items so edits/removals hit the right item
  const indexed = items.map((item) => [item, stkState.items.indexOf(item)]);
  $('#stk-body').innerHTML = indexed.map(([item, idx]) => stkRowHtml(item, idx)).join('');

  const empty = $('#stk-empty');
  if (!items.length) {
    empty.textContent = stkState.items.length ? 'No matches in your stockpile.' : 'Your stockpile is empty.';
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }

  $('#stk-status').textContent = statusMsg ||
    `${items.length}${items.length === stkState.items.length ? '' : ` of ${stkState.items.length}`} items in stockpile`;
}

async function syncStockpile() {
  $('#stk-loading').hidden = false;
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

function initStockpile() {
  buildStkHeader();

  $('#stk-search').addEventListener('input', () => renderStockpile());
  $('[data-refresh="stockpile"]').addEventListener('click', () => syncStockpile());

  // Column sort
  $('#stk-head').addEventListener('click', (e) => {
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

  // Stock edit + remove + name → resource detail page (event delegation)
  $('#stk-body').addEventListener('click', (e) => {
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
}
