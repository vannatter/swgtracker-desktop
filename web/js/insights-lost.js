/* Sales Insights — what you're losing (api/sales.php?action=lost):
   Items tab:     "Sales lost to empty stock" — time each item sat at 0 Stocked
                  (from the inventory log) × its normal pace = an estimate.
   Customers tab: "New vs returning" weekly buyers, and "Gone quiet" — regulars
                  well past their own usual gap between visits.
   Its own request beside the stats payload; it reloads whenever the main
   Insights content re-renders (any load, range change or refresh). */

const insLost = { seq: 0, data: null, allScored: null };

function insLostMount() {
  if ($('#ins-lost-panel')) return;
  const items = document.querySelector('#page-insights [data-inspane="items"]');
  const cust = document.querySelector('#page-insights [data-inspane="customers"]');
  if (!items || !cust) return;
  const caret = '<i class="ins-caret fa-solid fa-chevron-down"></i>';
  items.insertAdjacentHTML('afterbegin', `
    <div class="ins-panel" data-panel="lost" id="ins-lost-panel">
      <div class="ins-panel-head">${caret}<h2>Sales lost to empty stock</h2><span id="ins-lost-sub" class="ins-sub"></span></div>
      <div class="ins-panel-body"><div id="ins-lost"></div></div>
    </div>`);
  cust.insertAdjacentHTML('afterbegin', `
    <div class="ins-cols2 ins-lost-cols">
      <div class="ins-panel" data-panel="newret">
        <div class="ins-panel-head">${caret}<h2>New vs returning</h2><span id="ins-newret-sub" class="ins-sub"></span></div>
        <div class="ins-panel-body"><div id="ins-newret"></div></div>
      </div>
      <div class="ins-panel" data-panel="quiet">
        <div class="ins-panel-head">${caret}<h2>Gone quiet</h2><span id="ins-quiet-sub" class="ins-sub"></span></div>
        <div class="ins-panel-body"><div id="ins-quiet"></div></div>
      </div>
    </div>`);
  // the page applied saved collapse state before these panels existed
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('insCollapsed') || '[]'); } catch (_) { saved = []; }
  ['lost', 'newret', 'quiet'].forEach((k) => {
    const p = document.querySelector(`#page-insights .ins-panel[data-panel="${k}"]`);
    if (p) p.classList.toggle('collapsed', saved.includes(k));
  });

  $('#ins-lost').addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-lostitem]');
    if (!row) return;
    const box = $('#inv-search');
    if (box) box.value = row.dataset.lostitem;
    if (typeof invState !== 'undefined') invState.page = 1;
    showPage('inventory');
  });
  $('#ins-quiet').addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-quiet]');
    if (row) insLostOpenCust(row.dataset.quiet);
  });
}

async function insLostLoad() {
  insLostMount();
  if (!$('#ins-lost-panel')) return;
  const seq = ++insLost.seq;
  const loading = '<div class="empty-state is-compact">Loading…</div>';
  ['#ins-lost', '#ins-newret', '#ins-quiet'].forEach((s) => { $(s).innerHTML = loading; });
  ['#ins-lost-sub', '#ins-newret-sub', '#ins-quiet-sub'].forEach((s) => { $(s).textContent = ''; });
  let res;
  try {
    res = await apiFetch('GET', 'api/sales.php', { params: { action: 'lost', days: insState.days } });
  } catch (e) { res = { ok: false, error: String(e) }; }
  if (seq !== insLost.seq) return;              // a newer load won
  // an older site answers action=lost with the plain sales list
  const d = res.ok && res.data && typeof res.data === 'object' && 'quiet' in res.data ? res.data : null;
  insLost.data = d;
  if (!d) {
    const msg = res.ok
      ? 'This view needs the latest swgtracker.com update — check back soon.'
      : `Couldn't load: ${escapeHtml(res.error || 'server error')}`;
    ['#ins-lost', '#ins-newret', '#ins-quiet'].forEach((s) => { $(s).innerHTML = `<div class="empty-state is-compact">${msg}</div>`; });
    return;
  }
  insLostRenderStock(d.lost);
  insLostRenderWeekly(d.weekly || []);
  insLostRenderQuiet(d.quiet || []);
}

const insLostDate = (ts) => new Date(ts * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
const insLostDays = (n) => { const v = Number(n) || 0; return v < 1 ? `${Math.max(1, Math.round(v * 24))}h` : `${v % 1 ? v.toFixed(1) : v}d`; };

function insLostRenderStock(l) {
  const box = $('#ins-lost');
  if (!l || !safeInt(l.coverage_start)) {
    box.innerHTML = '<div class="empty-state is-compact">Nothing to estimate yet — this fills in once My Inventory has logged a few days of stock changes.</div>';
    return;
  }
  const from = insLostDate(l.coverage_start);
  const rows = l.items || [];
  $('#ins-lost-sub').textContent = `estimate · since ${from}`;
  if (!rows.length) {
    box.innerHTML = `<div class="empty-state is-compact">No sales lost to empty stock since ${escapeHtml(from)} — your regular sellers stayed stocked.</div>`;
    return;
  }
  const missed = Number(l.total_sales) || 0;
  box.innerHTML = `
    <div class="ins-lost-sum"><i class="fa-solid fa-box-open"></i><span>About <b>${fmtNum(Math.round(missed))}</b> sale${Math.round(missed) === 1 ? '' : 's'}
      (<b>~${fmtShort(l.total_credits)}</b>) missed while items sat empty since ${escapeHtml(from)}.
      <span class="stat_off">Out-of-stock time × how fast each item sells when stocked — the inventory log reaches back ${fmtNum(Math.round(l.coverage_days))} days.</span></span></div>
    <div class="table-wrap ins-tablewrap">
      <table class="data-grid ins-lost-grid"><thead><tr>
        <th class="col-name">Item</th><th>Vendor</th><th class="stat">Out</th>
        <th class="stat" title="Sales per week while in stock">Sells</th>
        <th class="stat">Missed</th><th class="stat">~Credits</th>
      </tr></thead><tbody>${rows.map((r) => `
        <tr data-lostitem="${escapeHtml(r.name)}" title="Open ${escapeHtml(r.name)} in My Inventory">
          <td class="col-name">${escapeHtml(r.name)}${r.out_now ? ' <span class="ins-lost-now" title="Empty right now">out now</span>' : ''}</td>
          <td>${escapeHtml(r.vendor || '—')}</td>
          <td class="stat">${insLostDays(r.out_days)}</td>
          <td class="stat">${r.pace_wk}/wk</td>
          <td class="stat">~${(Number(r.missed_sales) || 0).toFixed(1).replace(/\.0$/, '')}</td>
          <td class="stat">${fmtShort(r.missed_credits)}</td>
        </tr>`).join('')}</tbody></table>
    </div>`;
}

function insLostRenderWeekly(weeks) {
  const box = $('#ins-newret');
  const tot = weeks.reduce((s, w) => s + safeInt(w.new) + safeInt(w.returning), 0);
  if (!tot) { box.innerHTML = '<div class="empty-state is-compact">No buyers in this window.</div>'; return; }
  const max = Math.max(1, ...weeks.map((w) => safeInt(w.new) + safeInt(w.returning)));
  const nNew = weeks.reduce((s, w) => s + safeInt(w.new), 0);
  const every = Math.ceil(weeks.length / 7);
  box.innerHTML = `
    <div class="ins-newret">${weeks.map((w, i) => {
      const n = safeInt(w.new), r = safeInt(w.returning);
      return `<div class="ins-newret-col" title="Week of ${escapeHtml(w.label)} — ${fmtNum(n)} new, ${fmtNum(r)} returning">
        <div class="ins-newret-track">
          <div class="ins-newret-seg ret" style="height:${((r / max) * 100).toFixed(1)}%"></div>
          <div class="ins-newret-seg new" style="height:${((n / max) * 100).toFixed(1)}%"></div>
        </div>
        <div class="ins-newret-label">${i % every === 0 ? escapeHtml(w.label) : ''}</div>
      </div>`;
    }).join('')}</div>
    <div class="ins-loyalty-legend"><span><i class="newret-new"></i>New</span><span><i class="newret-ret"></i>Returning</span></div>`;
  $('#ins-newret-sub').textContent = `${fmtNum(nNew)} first-time buyers · weekly`;
}

function insLostRenderQuiet(rows) {
  const box = $('#ins-quiet');
  $('#ins-quiet-sub').textContent = rows.length ? `${rows.length} regular${rows.length === 1 ? '' : 's'} past their usual gap` : '';
  if (!rows.length) {
    box.innerHTML = '<div class="empty-state is-compact">No regulars have gone quiet — everyone who buys often is still coming back.</div>';
    return;
  }
  box.innerHTML = `
    <div class="table-wrap ins-tablewrap ins-quiet-wrap">
      <table class="data-grid"><thead><tr>
        <th class="col-name">Customer</th><th class="stat">Last bought</th>
        <th class="stat" title="Their median gap between buying days">Usually every</th>
        <th class="stat">Lifetime</th>
      </tr></thead><tbody>${rows.map((q) => `
        <tr data-quiet="${escapeHtml(q.name)}" title="Open ${escapeHtml(q.full_name || q.name)}'s scorecard — bought on ${fmtNum(q.visits)} different days, ${fmtNum(q.count)} purchases">
          <td class="col-name">${escapeHtml(q.full_name || q.name)}</td>
          <td class="stat">${insAgo(q.last)}</td>
          <td class="stat">${insLostDays(q.usual_gap)}</td>
          <td class="stat">${fmtShort(q.total)}</td>
        </tr>`).join('')}</tbody></table>
    </div>`;
}

// A quiet regular often hasn't bought inside the page window, so the window's
// scored list can't open them — score all-time buyers once and open from that.
async function insLostOpenCust(name) {
  const hit = insResolveBuyer(name);
  if (hit) { openInsCustCard(hit.name); return; }
  if (!insLost.allScored) {
    try {
      const res = await apiFetch('GET', 'api/sales.php', { params: { action: 'stats', days: 0 } });
      if (res.ok && res.data) insLost.allScored = insScoreBuyers(res.data.buyers || [], safeInt(res.data.since));
    } catch (_) { /* offline — reported below */ }
  }
  const b = (insLost.allScored || []).find((x) => x.name === name);
  if (!b) { toast(`Couldn't load ${name}'s scorecard`, false); return; }
  insState.custScored = [...(insState.custScored || []).filter((x) => x.name !== b.name), b];
  openInsCustCard(b.name);
}

// reload whenever the main content is shown again (each loadInsights hides it,
// then reveals it on success)
(function insLostWatch() {
  const content = document.getElementById('ins-content');
  if (!content) return;
  let wasHidden = content.hidden;
  new MutationObserver(() => {
    if (wasHidden && !content.hidden) { insLost.allScored = null; insLostLoad(); }
    wasHidden = content.hidden;
  }).observe(content, { attributes: true, attributeFilter: ['hidden'] });
}());
