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

const invState = { page: 1, perPage: 100, hasNext: false, sortField: 'item_name', sortOrder: 'ASC', items: [] };

function buildInvHeader() {
  $('#inv-head').innerHTML = sortableHeaderHtml(INV_COLUMNS, invState.sortField, invState.sortOrder) +
    '<th class="col-actions"></th>';
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
  return `<tr data-idx="${idx}">
    <td class="stat inv-edit ${stockCls}" data-edit="stocked" data-idx="${idx}" title="Click to edit">${fmtNum(stocked)}</td>
    <td class="col-name res-name">${escapeHtml(item.item_name || '')}</td>
    <td class="stat inv-edit" data-edit="threshold" data-idx="${idx}" title="Click to edit">${fmtNum(threshold)}</td>
    <td class="col-text">${escapeHtml(item.vendor || '') || '<span class="stat_off">—</span>'}</td>
    <td class="col-num">${item.match_price != null && item.match_price !== '' ? fmtNum(item.match_price) : '<span class="stat_off">—</span>'}</td>
    <td class="stat ${safeInt(item.sales_count) ? 'inv-sales' : ''}" ${safeInt(item.sales_count) ? `data-sales="${idx}" title="Click to see the matched sales"` : ''}>${safeInt(item.sales_count) ? fmtNum(item.sales_count) : '<span class="stat_off">—</span>'}</td>
    <td class="col-text res-type">${fmtAgoTip(item.last_updated)}</td>
    <td class="col-actions">
      <button class="btn btn-icon" data-iedit="${idx}" title="Edit vendor / stock"><i class="fa-solid fa-pen"></i></button>
      <button class="btn btn-icon" data-iremove="${idx}" title="Remove item"><i class="fa-solid fa-trash-can"></i></button>
    </td>
  </tr>`;
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

  let res;
  try { res = await api().get_inventory(params); }
  catch (e) { res = { ok: false, error: String(e) }; }

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
  if (!rows.length) {
    $('#inv-body').innerHTML = '';
    const empty = $('#inv-empty');
    empty.textContent = filter || params.search ? 'No matching items.' : 'No items yet — add one above.';
    empty.hidden = false;
    $('#inv-status').textContent = '';
  } else {
    $('#inv-body').innerHTML = rows.map(invRowHtml).join('');
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
// since a rename would orphan the sales that match on it)
function openInvDialog(item = null) {
  invLoadVendorSuggestions();
  const modal = $('#inv-add-modal');
  const nameInput = $('#inv-new-name');
  nameInput.readOnly = false;
  if (item) {
    modal.dataset.editId = String(item.id);
    $('#inv-modal-title').textContent = 'Edit Inventory Item';
    $('#inv-add').innerHTML = '<i class="fa-solid fa-check"></i> Save';
    nameInput.value = item.item_name || '';
    $('#inv-new-vendor').value = item.vendor || '';
    $('#inv-new-stocked').value = String(safeInt(item.stocked));
    $('#inv-new-threshold').value = String(safeInt(item.threshold));
  } else {
    delete modal.dataset.editId;
    $('#inv-modal-title').textContent = 'Add Inventory Item';
    $('#inv-add').innerHTML = '<i class="fa-solid fa-plus"></i> Add Item';
    nameInput.value = '';
    $('#inv-new-vendor').value = '';
    $('#inv-new-stocked').value = '10';
    $('#inv-new-threshold').value = '1';
  }
  modal.hidden = false;
  (item ? $('#inv-new-vendor') : nameInput).focus();
}

function initInventory() {
  buildInvHeader();

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
  $('#inv-add-modal').addEventListener('click', (e) => {
    if (e.target === $('#inv-add-modal')) $('#inv-add-modal').hidden = true;
  });
  // Sales expander: one open at a time, click the count again to close
  $('#inv-sales-close').addEventListener('click', () => { $('#inv-sales-modal').hidden = true; });
  $('#inv-sales-modal').addEventListener('click', (e) => {
    if (e.target === $('#inv-sales-modal')) $('#inv-sales-modal').hidden = true;
  });
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

  // Inline edits + two-step delete (arm, then confirm within 2.5s)
  $('#inv-body').addEventListener('click', (e) => {
    const editRow = e.target.closest('[data-iedit]');
    if (editRow) { openInvDialog(invState.items[safeInt(editRow.dataset.iedit)]); return; }
    const editCell = e.target.closest('[data-edit]');
    if (editCell) { openInvEditor(editCell); return; }
    const removeCell = e.target.closest('[data-iremove]');
    if (removeCell && confirmArm(removeCell)) removeInvItem(safeInt(removeCell.dataset.iremove));
  });
}
