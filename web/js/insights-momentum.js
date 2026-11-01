/* Sales Insights → Items: Heating up / Cooling off and Time to sell.
   One fetch of api/sales.php?action=momentum per Insights load (fixed windows —
   14 days vs the 60 before for momentum, the inventory log's history for time to
   sell — so it doesn't follow the range picker). The server does the math
   (includes/insights_momentum.php); this only renders. */

const insMom = { seq: 0 };

// seconds → "40 min" / "18 h" / "3.5 days"
function insMomDur(s) {
  const h = safeInt(s) / 3600;
  if (h < 1) return `${Math.max(1, Math.round(h * 60))} min`;
  if (h < 48) return `${Math.round(h)} h`;
  const d = h / 24;
  return `${d < 10 ? d.toFixed(1).replace(/\.0$/, '') : Math.round(d)} days`;
}

const insMomRate = (v) => (v >= 10 ? Math.round(v) : Number(v).toFixed(1).replace(/\.0$/, ''));

function insMomList(sel, rows, up) {
  const box = $(sel);
  if (!rows.length) {
    box.innerHTML = `<div class="empty-state is-compact">${up ? 'Nothing selling well above its usual pace.' : 'Nothing selling well below its usual pace.'}</div>`;
    return;
  }
  box.innerHTML = rows.map((r) => {
    const nm = String(r.name);
    const badge = r.ratio === null ? 'new' : !r.recent ? 'stopped' : `${Number(r.ratio).toFixed(1).replace(/\.0$/, '')}×`;
    const was = r.ratio === null ? `none in the ${insMom.base} days before` : `usually ${insMomRate(r.base_wk)}/wk`;
    return `<div class="ins-lead ins-mom-row" data-insjump="${escapeHtml(nm)}" title="Show “${escapeHtml(nm)}” in My Sales">
        <span class="ins-lead-rank ${up ? 'ins-up' : 'ins-down'}">${up ? '▲' : '▼'}</span>
        <span class="ins-lead-name">${escapeHtml(nm)}</span>
        <span class="ins-lead-val ${up ? 'ins-up' : 'ins-down'}">${badge}</span>
        <span class="ins-lead-sub">${insMomRate(r.recent_wk)}/wk now · ${was} · ${fmtNum(r.recent)} sold lately</span>
      </div>`;
  }).join('');
}

function renderInsSellTime(st) {
  const items = st.items || [];
  $('#ins-sell-sub').textContent = items.length
    ? `how long a restock takes to sell out · median of ${items.length === 1 ? 'its' : 'each item’s'} batches over the last ${st.log_days} days`
    : `needs ${st.min_batches}+ restocks of an item that sold all the way out (last ${st.log_days} days)`;
  $('#ins-sell-body').innerHTML = items.map((r) => `
    <tr data-insjump="${escapeHtml(r.name)}" title="Show “${escapeHtml(r.name)}” in My Sales">
      <td class="col-name">${escapeHtml(r.name)}</td>
      <td>${escapeHtml(r.vendor || '—')}</td>
      <td class="stat">${fmtNum(r.batches)}</td>
      <td class="stat"><b>${insMomDur(r.median_s)}</b></td>
      <td class="stat">${insMomDur(r.fast_s)}</td>
      <td class="stat">${insMomDur(r.slow_s)}</td>
      <td class="stat">${r.on_hand ? fmtNum(r.on_hand) : '<span class="stat_off">0</span>'}</td>
    </tr>`).join('')
    || `<tr><td colspan="7"><div class="empty-state is-compact">No item has sold through ${st.min_batches} restocks yet — log restocks in My Inventory and they'll show here.</div></td></tr>`;
}

async function insMomLoad() {
  const seq = ++insMom.seq;
  let res;
  try { res = await apiFetch('GET', 'api/sales.php', { params: { action: 'momentum' } }); }
  catch (e) { res = { ok: false }; }
  if (seq !== insMom.seq) return;   // a newer load won
  // an older site without the action: keep both panels hidden
  const d = res.ok && res.data && res.data.momentum ? res.data : null;
  $('#ins-mom').hidden = !d;
  $('#ins-sell').hidden = !d || !d.sell_time;
  if (!d) return;
  const m = d.momentum;
  insMom.base = m.base_days;
  document.querySelectorAll('#ins-mom .ins-mom-sub').forEach((el) => {
    el.textContent = `last ${m.recent_days} days vs the ${m.base_days} before`;
  });
  insMomList('#ins-mom-up', m.heating || [], true);
  insMomList('#ins-mom-down', m.cooling || [], false);
  if (d.sell_time) renderInsSellTime(d.sell_time);
}

['#ins-mom', '#ins-sell-body'].forEach((sel) => {
  $(sel).addEventListener('click', (e) => {
    const row = e.target.closest('[data-insjump]');
    if (row) insFilterSales(row.dataset.insjump);
  });
});
