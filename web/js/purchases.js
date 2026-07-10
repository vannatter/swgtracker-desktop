/* My Purchases page — mirrors portal/purchases.php (and the My Sales layout).
   Summary cards + server-side sorted, paginated table. Data rides the generic
   API gateway (apiFetch) — the first page built with no shell method at all. */

const PUR_COLUMNS = [
  ['Item', 'item', 'col-name'],
  ['Seller', 'seller', 'col-text'],
  ['Amount', 'purchase_amount', 'col-num'],
  ['Date', 'purchase_timestamp', 'col-text'],
];
const PUR_PERIODS = [['7 Day', '7_day'], ['30 Day', '30_day'], ['90 Day', '90_day'], ['180 Day', '180_day']];

const purState = { page: 1, sortField: 'purchase_timestamp', sortOrder: 'DESC' };

function buildPurHeader() {
  $('#pur-head').innerHTML = sortableHeaderHtml(PUR_COLUMNS, purState.sortField, purState.sortOrder);
}

function buildPurCards() {
  $('#pur-cards').innerHTML = PUR_PERIODS.map(([label, key]) => `
    <div class="sum-card" data-purperiod="${key}">
      <div class="sum-avg">--</div>
      <div class="sum-label">${label} avg / day</div>
      <div class="sum-total">--</div>
      <div class="sum-label">${label} total</div>
    </div>`).join('');
}

function updatePurFilterNote() {
  const q = $('#pur-search').value.trim();
  $('#pur-search-clear').hidden = !q;
  const note = $('#pur-fnote');
  if (!q) { note.hidden = true; note.innerHTML = ''; return; }
  note.hidden = false;
  note.innerHTML = `<span class="res-pills-label">Totals filtered to</span>`
    + `<span class="res-pill">${escapeHtml(q)}`
    + `<button type="button" id="pur-fclear" class="res-pill-x" title="Clear filter"><i class="fa-solid fa-xmark"></i></button>`
    + `</span>`;
}

function updatePurCards(summaries) {
  PUR_PERIODS.forEach(([, key]) => {
    const card = $(`[data-purperiod="${key}"]`);
    if (!card) return;
    const p = (summaries || {})[key] || {};
    card.querySelector('.sum-avg').textContent = fmtNum(p.average || 0);
    card.querySelector('.sum-total').textContent = fmtNum(p.total || 0);
  });
}

function purRowHtml(row) {
  // item/seller click-filter the page (aggregates follow), like My Sales
  const f = (v, cls = 'col-text') => v
    ? `<td class="${cls} sales-cell" data-purfilter="${escapeHtml(v)}" title="Filter purchases to “${escapeHtml(v)}”">${escapeHtml(v)}</td>`
    : `<td class="${cls}"></td>`;
  return `<tr>
    ${f(row.item || '', 'col-name res-name')}
    ${f(row.seller || '')}
    <td class="col-num sale-amount">${fmtNum(row.purchase_amount)}</td>
    <td class="col-text">${fmtDate(row.purchase_timestamp)}</td>
  </tr>`;
}

async function loadPurchases() {
  showGridLoading('#pur-loading');
  $('#pur-empty').hidden = true;

  let res;
  try {
    res = await apiFetch('GET', 'api/purchases.php', { params: {
      search: $('#pur-search').value.trim(),
      page: purState.page,
      sort: purState.sortField,
      order: purState.sortOrder,
    } });
  } catch (e) { res = { ok: false, error: String(e) }; }

  $('#pur-loading').hidden = true;
  updatePurFilterNote();

  if (!res.ok || !res.data) {
    showPurEmpty(`Error: ${res.error || 'failed to load'}`);
    checkAuthError(res.error);
    return;
  }

  const data = res.data;
  updatePurCards(data.summaries);

  const rows = data.results || [];
  const page = data.page ?? purState.page;
  const total = data.total_results ?? rows.length;
  const totalPages = data.total_pages ?? 1;

  if (!rows.length) {
    showPurEmpty($('#pur-search').value.trim()
      ? 'No purchases match this filter.' : 'No purchases found.');
    $('#pur-status').textContent = '';
  } else {
    $('#pur-body').innerHTML = rows.map(purRowHtml).join('');
    $('#pur-status').textContent = `Page ${page} of ${totalPages} — ${fmtNum(total)} total purchases`;
  }

  $('#pur-prev').disabled = page <= 1;
  $('#pur-next').disabled = page >= totalPages;
}

function showPurEmpty(msg) {
  $('#pur-body').innerHTML = '';
  const el = $('#pur-empty');
  el.textContent = msg;
  el.hidden = false;
}

function initPurchases() {
  buildPurHeader();
  buildPurCards();

  // click an item/seller cell to filter to it
  $('#pur-body').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-purfilter]');
    if (!cell) return;
    $('#pur-search').value = cell.dataset.purfilter;
    purState.page = 1;
    loadPurchases();
  });
  $('#pur-fnote').addEventListener('click', (e) => {
    if (!e.target.closest('#pur-fclear')) return;
    $('#pur-search').value = '';
    purState.page = 1;
    loadPurchases();
  });
  $('#pur-search-clear').addEventListener('click', () => {
    $('#pur-search').value = '';
    purState.page = 1;
    loadPurchases();
  });

  let purTimer = null;
  $('#pur-search').addEventListener('input', () => {
    clearTimeout(purTimer);
    purTimer = setTimeout(() => { purState.page = 1; loadPurchases(); }, 300);
  });

  // column sort (server-side)
  $('#pur-head').addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const field = th.dataset.sort;
    if (purState.sortField === field) {
      purState.sortOrder = purState.sortOrder === 'DESC' ? 'ASC' : 'DESC';
    } else {
      purState.sortField = field;
      purState.sortOrder = 'DESC';
    }
    buildPurHeader();
    purState.page = 1;
    loadPurchases();
  });

  $('#pur-prev').addEventListener('click', () => { if (purState.page > 1) { purState.page--; loadPurchases(); } });
  $('#pur-next').addEventListener('click', () => { purState.page++; loadPurchases(); });
  $('[data-refresh="purchases"]').addEventListener('click', () => loadPurchases());
}
