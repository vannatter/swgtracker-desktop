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
  return `<tr>
    <td class="col-name res-name">${escapeHtml(sale.item || '')}</td>
    <td>${escapeHtml(typeText)}</td>
    <td class="col-text">${escapeHtml(sale.buyer || '')}</td>
    <td class="col-text">${escapeHtml(sale.vendor || '')}</td>
    <td class="col-text">${escapeHtml(sale.location || '')}</td>
    <td class="col-num sale-amount">${fmtNum(sale.sale_amount)}</td>
    <td class="col-text">${fmtDate(sale.sale_timestamp)}</td>
  </tr>`;
}

async function loadSales() {
  $('#sales-loading').hidden = false;
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
    showSalesEmpty('No sales found.');
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

let custBuyers = [];
async function loadCustomers() {
  const days = safeInt($('#cust-days').value);
  $('#cust-body').innerHTML = 'Loading…';
  let rows = [];
  try {
    const res = await api().sale_buyers(days);
    rows = (res.ok && res.data && res.data.results) || [];
  } catch (_) { /* renders empty below */ }
  custBuyers = rows.map((r) => r.buyer);
  $('#cust-count').textContent = rows.length
    ? `${rows.length} customer${rows.length > 1 ? 's' : ''}` : '';
  $('#cust-body').innerHTML = rows.length
    ? `<table class="inv-sales-table"><thead><tr>
         <th>Customer</th><th class="col-num">Purchases</th><th class="col-num">Total</th><th>Last</th>
       </tr></thead><tbody>${rows.map((r) => `<tr>
         <td>${escapeHtml(r.buyer)}</td>
         <td class="col-num">${fmtNum(r.purchases)}</td>
         <td class="col-num sale-amount">${fmtNum(r.total)} cr</td>
         <td>${fmtAgoTip(r.last_purchase)}</td>
       </tr>`).join('')}</tbody></table>`
    : '<span class="stat_off">No customers in this window.</span>';
}

function initSales() {
  buildSalesCards();
  buildSalesHeader();

  $('#sales-customers').addEventListener('click', () => {
    $('#cust-modal').hidden = false;
    loadCustomers();
  });
  $('#cust-days').addEventListener('change', loadCustomers);
  $('#cust-close').addEventListener('click', () => { $('#cust-modal').hidden = true; });
  $('#cust-modal').addEventListener('click', (e) => {
    if (e.target === $('#cust-modal')) $('#cust-modal').hidden = true;
  });
  $('#cust-copy').addEventListener('click', async () => {
    // "; " is the in-game mail To-field separator
    const list = custBuyers.join('; ');
    if (!list) { toast('No customers to copy', false); return; }
    try {
      await navigator.clipboard.writeText(list);
    } catch (_) { // WKWebView can refuse the async API — legacy path
      const ta = document.createElement('textarea');
      ta.value = list; document.body.appendChild(ta);
      ta.select(); document.execCommand('copy'); ta.remove();
    }
    toast(`Copied ${custBuyers.length} names for in-game mail`);
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
