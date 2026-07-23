/* My Sales page — mirrors src/gui/sales_tab.py (portal/sales.php layout).
   Summary cards + server-side sorted, paginated transaction table. */

const SALES_COLUMNS = [
  ['Item', 'item', 'col-name'],
  ['Type', 'sale_type', ''],
  ['Buyer', 'buyer', 'col-text'],
  ['Vendor', 'vendor', 'col-text'],
  ['Location', 'location', 'col-text'],
  ['Amount', 'sale_amount', 'col-num'],
  ['Date', 'sale_timestamp', 'col-text'],
];
const SALES_PERIODS = [['7 Day', '7_day'], ['30 Day', '30_day'], ['90 Day', '90_day'], ['180 Day', '180_day']];

const salesState = { page: 1, sortField: 'sale_timestamp', sortOrder: 'DESC' };

function buildSalesHeader() {
  $('#sales-head').innerHTML = sortableHeaderHtml(SALES_COLUMNS, salesState.sortField, salesState.sortOrder);
}

function buildSalesCards() {
  $('#sales-cards').innerHTML = SALES_PERIODS.map(([label, key]) => `
    <div class="sum-card" data-period="${key}">
      <div class="sum-avg">--</div>
      <div class="sum-label">${label} avg / sale</div>
      <div class="sum-total">--</div>
      <div class="sum-label">${label} total</div>
    </div>`).join('');
}

function updateSalesFilterNote() {
  const q = $('#sales-search').value.trim();
  $('#sales-search-clear').hidden = !q;
  const note = $('#sales-fnote');
  if (!q) { note.hidden = true; note.innerHTML = ''; return; }
  note.hidden = false;
  note.innerHTML = `<span class="res-pills-label">Totals filtered to</span>`
    + `<span class="res-pill">${escapeHtml(q)}`
    + `<button type="button" id="sales-fclear" class="res-pill-x" title="Clear filter"><i class="fa-solid fa-xmark"></i></button>`
    + `</span>`;
}

function updateSalesCards(summaries) {
  SALES_PERIODS.forEach(([, key]) => {
    const card = $(`[data-period="${key}"]`);
    if (!card) return;
    const p = (summaries || {})[key] || {};
    card.querySelector('.sum-avg').textContent = fmtNum(p.average || 0);
    card.querySelector('.sum-total').textContent = fmtNum(p.total || 0);
  });
}

function saleRowHtml(sale) {
  const type = String(sale.sale_type ?? '');
  const typeText = type === '1' ? 'Vendor' : type === '2' ? 'Bazaar' : type;
  // item/buyer/vendor/location click-filter the page (aggregates follow)
  const f = (v, cls = 'col-text') => v
    ? `<td class="${cls} sales-cell" data-filter="${escapeHtml(v)}" title="Filter sales to “${escapeHtml(v)}”">${escapeHtml(v)}</td>`
    : `<td class="${cls}"></td>`;
  // buyer cell: name click filters (like the others), the card icon opens the
  // customer scorecard from Sales Insights
  const buyerCell = sale.buyer
    ? `<td class="col-text sales-cell" data-filter="${escapeHtml(sale.buyer)}" title="Filter sales to “${escapeHtml(sale.buyer)}”">${escapeHtml(sale.buyer)}
        <i class="fa-solid fa-address-card sales-scorecard" data-scorecard="${escapeHtml(sale.buyer)}"
           title="Open ${escapeHtml(sale.buyer)}'s customer scorecard"></i></td>`
    : '<td class="col-text"></td>';
  return `<tr>
    ${f(sale.item || '', 'col-name res-name')}
    <td>${escapeHtml(typeText)}</td>
    ${buyerCell}
    ${f(sale.vendor || '')}
    ${f(sale.location || '')}
    <td class="col-num sale-amount">${fmtNum(sale.sale_amount)}</td>
    <td class="col-text">${fmtDate(sale.sale_timestamp)}</td>
  </tr>`;
}

async function loadSales() {
  showGridLoading('#sales-loading');
  $('#sales-empty').hidden = true;

  let res;
  try {
    res = await api().get_sales({
      search: $('#sales-search').value.trim(),
      type: $('#sales-type').value,
      page: salesState.page,
      sort: salesState.sortField,
      order: salesState.sortOrder,
    });
  } catch (e) { res = { ok: false, error: String(e) }; }

  $('#sales-loading').hidden = true;
  updateSalesFilterNote(); // every path — a zero-result filter still needs its × out

  if (!res.ok || !res.data) {
    showSalesEmpty(`Error: ${res.error || 'failed to load'}`);
    checkAuthError(res.error);
    return;
  }

  const data = res.data;
  updateSalesCards(data.summaries);

  const sales = data.results || [];
  const page = data.page ?? salesState.page;
  const total = data.total_results ?? data.total ?? sales.length;
  const totalPages = data.total_pages ?? 1;

  if (!sales.length) {
    showSalesEmpty($('#sales-search').value.trim()
      ? 'No sales match this filter.' : 'No sales found.');
    $('#sales-status').textContent = '';
  } else {
    $('#sales-body').innerHTML = sales.map(saleRowHtml).join('');
    $('#sales-status').textContent = `Page ${page} of ${totalPages} — ${fmtNum(total)} total sales`;
  }

  $('#sales-prev').disabled = page <= 1;
  $('#sales-next').disabled = page >= totalPages;
}

function showSalesEmpty(msg) {
  $('#sales-body').innerHTML = '';
  const el = $('#sales-empty');
  el.textContent = msg;
  el.hidden = false;
}

const custState = { rows: [], visible: [], sortField: 'total', sortOrder: 'DESC' };

function renderCustomers() {
  const min = Math.max(1, safeInt($('#cust-min').value) || 1);
  const { sortField, sortOrder } = custState;
  const dir = sortOrder === 'DESC' ? -1 : 1;
  const rows = custState.rows
    .filter((r) => safeInt(r.purchases) >= min)
    .sort((a, b) => sortField === 'buyer'
      ? dir * String(a.buyer).toLowerCase().localeCompare(String(b.buyer).toLowerCase())
      : dir * (safeInt(a[sortField]) - safeInt(b[sortField])));
  custState.visible = rows.map((r) => r.buyer); // copy copies what you see
  $('#cust-count').textContent =
    `${rows.length} of ${custState.rows.length} customer${custState.rows.length === 1 ? '' : 's'}`;
  const arrow = (f) => (f === sortField ? (sortOrder === 'DESC' ? ' ▼' : ' ▲') : '');
  $('#cust-body').innerHTML = rows.length
    ? `<table class="inv-sales-table"><thead><tr>
         <th data-csort="buyer">Customer${arrow('buyer')}</th>
         <th class="col-num" data-csort="purchases">Purchases${arrow('purchases')}</th>
         <th class="col-num" data-csort="total">Total${arrow('total')}</th>
         <th data-csort="last_purchase">Last${arrow('last_purchase')}</th>
       </tr></thead><tbody>${rows.map((r) => `<tr>
         <td>${escapeHtml(r.buyer)}
           <i class="fa-solid fa-address-card sales-scorecard" data-scorecard="${escapeHtml(r.buyer)}"
              title="Open ${escapeHtml(r.buyer)}'s customer scorecard"></i></td>
         <td class="col-num">${fmtNum(r.purchases)}</td>
         <td class="col-num sale-amount">${fmtNum(r.total)} cr</td>
         <td>${fmtAgoTip(r.last_purchase)}</td>
       </tr>`).join('')}</tbody></table>`
    : '<span class="stat_off">No customers match this window/threshold.</span>';
}

async function loadCustomers() {
  $('#cust-body').innerHTML = 'Loading…';
  let rows = [];
  try {
    const res = await api().sale_buyers(safeInt($('#cust-days').value));
    rows = (res.ok && res.data && res.data.results) || [];
  } catch (_) { /* renders empty below */ }
  custState.rows = rows;
  renderCustomers();
}

function initSales() {
  buildSalesCards();
  buildSalesHeader();

  $('#sales-body').addEventListener('click', (e) => {
    const card = e.target.closest('[data-scorecard]');
    if (card) { insOpenScorecard(card.dataset.scorecard); return; }
    const cell = e.target.closest('[data-filter]');
    if (!cell) return;
    $('#sales-search').value = cell.dataset.filter;
    salesState.page = 1;
    loadSales();
  });
  $('#sales-fnote').addEventListener('click', (e) => {
    if (!e.target.closest('#sales-fclear')) return;
    $('#sales-search').value = '';
    salesState.page = 1;
    loadSales();
  });
  $('#sales-search-clear').addEventListener('click', () => {
    $('#sales-search').value = '';
    salesState.page = 1;
    loadSales();
  });

  $('#sales-customers').addEventListener('click', () => {
    $('#cust-modal').hidden = false;
    loadCustomers();
  });
  $('#cust-days').addEventListener('change', loadCustomers);
  $('#cust-min').addEventListener('input', renderCustomers);
  $('#cust-body').addEventListener('click', (e) => {
    const card = e.target.closest('[data-scorecard]');
    if (card) { insOpenScorecard(card.dataset.scorecard); return; }
    const th = e.target.closest('[data-csort]');
    if (!th) return;
    const f = th.dataset.csort;
    if (custState.sortField === f) {
      custState.sortOrder = custState.sortOrder === 'DESC' ? 'ASC' : 'DESC';
    } else {
      custState.sortField = f;
      custState.sortOrder = f === 'buyer' ? 'ASC' : 'DESC';
    }
    renderCustomers();
  });
  $('#cust-close').addEventListener('click', () => { $('#cust-modal').hidden = true; });
  bindBackdropClose($('#cust-modal'), () => { $('#cust-modal').hidden = true; });
  $('#cust-copy').addEventListener('click', async () => {
    // in-game mail addresses by FIRST name only (unique per server) — and
    // "; " is the To-field separator
    const firsts = [...new Set(custState.visible
      .map((n) => String(n).trim().split(/\s+/)[0])
      .filter(Boolean))];
    const list = firsts.join('; ');
    if (!list) { toast('No customers to copy', false); return; }
    try {
      await navigator.clipboard.writeText(list);
    } catch (_) { // WKWebView can refuse the async API — legacy path
      const ta = document.createElement('textarea');
      ta.value = list; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast(`Copied ${firsts.length} first names for in-game mail`);
  });

  // typeahead (server-side search → debounced) + Enter for instant
  let salesSearchTimer = null;
  $('#sales-search').addEventListener('input', () => {
    clearTimeout(salesSearchTimer);
    salesSearchTimer = setTimeout(() => { salesState.page = 1; loadSales(); }, 300);
  });
  $('#sales-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(salesSearchTimer); salesState.page = 1; loadSales(); }
  });
  $('#sales-type').addEventListener('change', () => { salesState.page = 1; loadSales(); });
  $('#sales-prev').addEventListener('click', () => { if (salesState.page > 1) { salesState.page--; loadSales(); } });
  $('#sales-next').addEventListener('click', () => { salesState.page++; loadSales(); });

  // Refresh resets filters/sort/page, like the Tk tab's ⟳
  $('[data-refresh="sales"]').addEventListener('click', () => {
    salesState.page = 1;
    salesState.sortField = 'sale_timestamp';
    salesState.sortOrder = 'DESC';
    $('#sales-search').value = '';
    $('#sales-type').value = '';
    buildSalesHeader();
    loadSales();
  });

  // Server-side column sort
  $('#sales-head').addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const field = th.dataset.sort;
    if (salesState.sortField === field) {
      salesState.sortOrder = salesState.sortOrder === 'DESC' ? 'ASC' : 'DESC';
    } else {
      salesState.sortField = field;
      salesState.sortOrder = 'DESC';
    }
    salesState.page = 1;
    buildSalesHeader();
    loadSales();
  });
}
