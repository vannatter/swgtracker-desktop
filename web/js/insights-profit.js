/* Sales Insights → Items: Profit by item, and → Vendors: Same item, different
   vendors. One fetch of api/sales.php?action=profit per Insights load (follows
   the range picker). The server works out each sale's cost
   (includes/insights_profit.php): a unit cost you set on the item, else your
   average price for it in My Purchases, else none — uncosted sales are left out
   of profit, never counted as free. Both panels are built here so the page
   markup stays untouched. */

const insProfit = { seq: 0, data: null, sort: ['revenue', -1], filter: '', saving: new Set() };

const INS_PROFIT_SRC = {
  set: ['You set this', 'ins-prof-src-set'],
  purchases: ['Average price you paid in My Purchases', 'ins-prof-src-buy'],
  mixed: ['Partly your cost, partly My Purchases', 'ins-prof-src-buy'],
};

function insProfitMount() {
  if ($('#ins-profit')) return;
  const items = $('[data-inspane="items"]');
  const sell = $('#ins-sell');
  const panel = document.createElement('div');
  panel.className = 'ins-panel';
  panel.id = 'ins-profit';
  panel.hidden = true;
  panel.innerHTML = `
    <div class="ins-panel-head"><h2>Profit by item</h2><span id="ins-profit-sub" class="ins-sub"></span>
      <input id="ins-profit-filter" type="text" class="form-control filter-input ins-tab-filter"
             placeholder="Filter items…" autocomplete="off" spellcheck="false"></div>
    <div class="ins-panel-body">
      <div class="ins-prof-strip" id="ins-profit-strip"></div>
      <div class="ins-prof-note">Type what one costs you to make in <b>Unit cost</b> — it applies to every sale of that item, buckets included.
        Items you resell use what you paid in My Purchases until you set one. Items with no cost stay out of the totals.</div>
      <div class="table-wrap ins-tablewrap">
        <table class="data-grid"><thead><tr id="ins-profit-head"></tr></thead>
          <tbody id="ins-profit-body"></tbody></table>
      </div>
    </div>`;
  items.insertBefore(panel, sell || null);

  const vend = document.createElement('div');
  vend.className = 'ins-panel';
  vend.id = 'ins-vcmp';
  vend.hidden = true;
  vend.innerHTML = `
    <div class="ins-panel-head"><h2>Same item, different vendors</h2><span id="ins-vcmp-sub" class="ins-sub"></span></div>
    <div class="ins-panel-body">
      <div class="table-wrap">
        <table class="data-grid"><thead><tr>
          <th class="col-name">Item / vendor</th><th>Sales</th>
          <th title="Sales per week over the window">Per week</th>
          <th>Avg price</th><th>Revenue</th><th>Last sale</th>
        </tr></thead><tbody id="ins-vcmp-body"></tbody></table>
      </div>
    </div>`;
  $('[data-inspane="vendors"]').appendChild(vend);

  $('#ins-profit-filter').addEventListener('input', (e) => { insProfit.filter = e.target.value; renderInsProfit(); });
  $('#ins-profit-head').addEventListener('click', (e) => {
    const th = e.target.closest('[data-profsort]');
    if (!th) return;
    const k = th.dataset.profsort;
    insProfit.sort = insProfit.sort[0] === k ? [k, -insProfit.sort[1]] : [k, k === 'name' ? 1 : -1];
    renderInsProfit();
  });
  const body = $('#ins-profit-body');
  body.addEventListener('click', (e) => {
    if (e.target.closest('input')) return;
    const row = e.target.closest('[data-insjump]');
    if (row) insFilterSales(row.dataset.insjump);
  });
  body.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.matches('.ins-prof-cost')) e.target.blur();
    if (e.key === 'Escape' && e.target.matches('.ins-prof-cost')) { e.target.value = e.target.dataset.was; e.target.blur(); }
  });
  body.addEventListener('focusout', (e) => { if (e.target.matches('.ins-prof-cost')) insProfitSave(e.target); });
  $('#ins-vcmp-body').addEventListener('click', (e) => {
    const row = e.target.closest('[data-insjump]');
    if (row) insFilterSales(row.dataset.insjump);
  });
}

async function insProfitLoad() {
  insProfitMount();
  const seq = ++insProfit.seq;
  let res;
  try {
    res = await apiFetch('GET', 'api/sales.php', { params: { action: 'profit', days: insState.days } });
  } catch (e) { res = { ok: false, error: String(e) }; }
  if (seq !== insProfit.seq) return;   // a newer range won
  // an older site without the action: leave both panels hidden
  if (!res.ok || !res.data || !Array.isArray(res.data.items)) {
    $('#ins-profit').hidden = true; $('#ins-vcmp').hidden = true;
    insProfit.data = null;
    return;
  }
  insProfit.data = res.data;
  renderInsProfit();
  renderInsVendorCompare();
}

function insProfitPct(v) {
  return v === null || v === undefined ? '—' : `${Number(v).toFixed(Math.abs(v) < 10 ? 1 : 0).replace(/\.0$/, '')}%`;
}

function renderInsProfit() {
  const d = insProfit.data;
  if (!d) return;
  $('#ins-profit').hidden = false;
  const cov = d.coverage || {}, tot = d.totals || {};
  const covPct = safeInt(cov.revenue) ? safeInt(cov.covered_revenue) / safeInt(cov.revenue) * 100 : 0;
  const profitCls = safeInt(tot.profit) < 0 ? 'ins-down' : safeInt(tot.profit) > 0 ? 'ins-up' : '';
  $('#ins-profit-strip').innerHTML = safeInt(cov.covered_sales)
    ? `<div><span class="ins-kpi-label">Profit</span><b class="${profitCls}">${fmtShort(tot.profit)}</b></div>
       <div><span class="ins-kpi-label">Margin</span><b class="${profitCls}">${insProfitPct(tot.margin)}</b></div>
       <div><span class="ins-kpi-label">Cost</span><b>${fmtShort(tot.cost)}</b></div>
       <div title="Share of the window's revenue that has a cost behind it — profit and margin only count these sales">
         <span class="ins-kpi-label">Costs known for</span><b>${Math.round(covPct)}% of revenue</b>
         <span class="ins-sub">${fmtNum(cov.covered_sales)} of ${fmtNum(cov.sales)} sales</span></div>`
    : '<div class="ins-sub">No costs yet — set a unit cost on an item below to see its profit.</div>';

  $('#ins-profit-head').innerHTML = [
    ['name', 'Item'], ['count', 'Sold'], ['revenue', 'Revenue'], ['avg', 'Avg price'],
    ['unit_cost', 'Unit cost', 'What one costs you — click to set it'],
    ['profit', 'Profit', 'Revenue minus cost, over the sales that have a cost'],
    ['margin', 'Margin'],
  ].map(([k, label, title]) => `<th data-profsort="${k}" class="${k === 'name' ? 'col-name' : ''}" ${title ? `title="${title}"` : ''}
      style="cursor:pointer">${label}${insProfit.sort[0] === k ? (insProfit.sort[1] > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');

  const q = insProfit.filter.trim().toLowerCase();
  const [sk, dir] = insProfit.sort;
  const val = (r) => (sk === 'name' ? String(r.name).toLowerCase()
    : sk === 'unit_cost' ? (r.unit_cost ?? r.avg_cost ?? -Infinity)
      : (r[sk] ?? -Infinity));   // no cost sinks below any number
  const rows = d.items.filter((r) => !q || String(r.name).toLowerCase().includes(q))
    .sort((a, b) => { const av = val(a), bv = val(b); return (av < bv ? -1 : av > bv ? 1 : 0) * dir; });
  $('#ins-profit-sub').textContent = `${rows.length}${q ? ` of ${d.items.length}` : ''} item${rows.length === 1 ? '' : 's'} · ${insState.days ? `last ${insState.days} days` : 'all time'}`;

  $('#ins-profit-body').innerHTML = rows.map((r) => {
    const src = INS_PROFIT_SRC[r.cost_source];
    const shown = r.unit_cost ?? '';
    const partial = r.covered && r.covered < r.count
      ? ` <span class="ins-sub" title="Only ${fmtNum(r.covered)} of ${fmtNum(r.count)} sales have a cost">· ${fmtNum(r.covered)}/${fmtNum(r.count)}</span>` : '';
    const pcls = !r.profit ? '' : r.profit < 0 ? 'ins-down' : 'ins-up';
    return `<tr data-insjump="${escapeHtml(r.name)}" title="Show “${escapeHtml(r.name)}” in My Sales">
      <td class="col-name">${escapeHtml(r.name)}${r.inventory_id ? ' <i class="fa-solid fa-warehouse ins-prof-inv" title="Counts against this My Inventory item"></i>' : ''}</td>
      <td class="stat">${fmtNum(r.count)}</td>
      <td class="stat">${fmtShort(r.revenue)}</td>
      <td class="stat">${fmtShort(r.avg)}</td>
      <td class="stat ins-prof-costcell">
        <input type="text" inputmode="numeric" class="ins-prof-cost" data-key="${escapeHtml(r.key)}"
               data-was="${shown === '' ? '' : fmtNum(shown)}" value="${shown === '' ? '' : fmtNum(shown)}" placeholder="${r.cost_source === 'purchases' ? fmtShort(r.avg_cost) : 'Set…'}"
               ${insProfit.saving.has(r.key) ? 'disabled' : ''} aria-label="Unit cost for ${escapeHtml(r.name)}">
        ${src && r.cost_source !== 'set' ? `<i class="fa-solid fa-cart-shopping ${src[1]}" title="${src[0]}"></i>` : ''}
      </td>
      <td class="stat ${pcls}">${r.profit === null ? '<span class="stat_off" title="No cost for this item yet">no cost</span>' : fmtShort(r.profit)}${partial}</td>
      <td class="stat ${pcls}">${r.profit === null ? '<span class="stat_off">—</span>' : insProfitPct(r.margin)}</td>
    </tr>`;
  }).join('') || '<tr><td colspan="9"><div class="empty-state is-compact">No sales in this window.</div></td></tr>';
}

async function insProfitSave(input) {
  const key = input.dataset.key;
  const raw = input.value.trim();
  if (raw === input.dataset.was) return;
  // "15,000" / "15k" / "1.5m" all work
  const m = raw.replace(/[,\s]/g, '').toLowerCase().match(/^(\d+(?:\.\d+)?)([km]?)$/);
  const cost = raw === '' ? null : m ? Math.round(Number(m[1]) * ({ k: 1e3, m: 1e6 }[m[2]] || 1)) : NaN;
  if (cost !== null && !Number.isFinite(cost)) {
    toast('Unit cost must be a number, like 15000 or 15k', false);
    input.value = input.dataset.was;
    return;
  }
  insProfit.saving.add(key);
  input.disabled = true;
  let res;
  try {
    res = await apiFetch('POST', 'api/sales.php', { data: { action: 'set_cost', key, unit_cost: cost } });
  } catch (e) { res = { ok: false, error: String(e) }; }
  insProfit.saving.delete(key);
  if (!res.ok) {
    toast(`Couldn't save the cost: ${res.error || 'server error'}`, false);
    input.disabled = false;
    input.value = input.dataset.was;
    return;
  }
  toast(cost === null ? 'Unit cost cleared' : `Unit cost set to ${fmtNum(cost)}`);
  insProfitLoad();
}

function renderInsVendorCompare() {
  const list = (insProfit.data && insProfit.data.vendor_compare) || [];
  $('#ins-vcmp').hidden = false;
  $('#ins-vcmp-sub').textContent = list.length
    ? `${list.length} item${list.length === 1 ? '' : 's'} sold from more than one vendor · fastest seller marked`
    : '';
  $('#ins-vcmp-body').innerHTML = list.map((it) => {
    const best = Math.max(...it.vendors.map((v) => Number(v.per_week)));
    return `<tr class="ins-vcmp-item" data-insjump="${escapeHtml(it.name)}" title="Show “${escapeHtml(it.name)}” in My Sales">
        <td class="col-name">${escapeHtml(it.name)}</td>
        <td class="stat">${fmtNum(it.count)}</td><td></td><td></td>
        <td class="stat">${fmtShort(it.revenue)}</td><td></td>
      </tr>` + it.vendors.map((v) => {
      const top = Number(v.per_week) === best;
      return `<tr class="ins-vcmp-vendor" data-insjump="${escapeHtml(v.name)}" title="Show “${escapeHtml(v.name)}” in My Sales">
        <td class="col-name">${top ? '<i class="fa-solid fa-trophy ins-up" title="Sells fastest here"></i> ' : ''}${escapeHtml(v.name)}</td>
        <td class="stat">${fmtNum(v.count)}</td>
        <td class="stat ${top ? 'ins-up' : ''}">${Number(v.per_week) >= 10 ? Math.round(v.per_week) : Number(v.per_week).toFixed(1).replace(/\.0$/, '')}</td>
        <td class="stat">${fmtShort(v.avg)}</td>
        <td class="stat">${fmtShort(v.revenue)}</td>
        <td class="stat">${insAgo(v.last)}</td>
      </tr>`;
    }).join('');
  }).join('') || '<tr><td colspan="6"><div class="empty-state is-compact">Every item in this window sold from a single vendor.</div></td></tr>';
}
