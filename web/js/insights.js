/* Sales Insights page — analytics over your uploaded sales.
   Pulls one aggregated payload from api/sales.php?action=stats (bundle-only, via
   the gateway) and renders KPIs, a revenue trend, a buy-time heatmap, and the
   top items / customers / vendors. All charting is hand-drawn (canvas + CSS) to
   match the server-pulse sparkline — no external chart library. */

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const insState = { days: 90, data: null, tab: 'overview',
                   itemSort: ['total', -1], vendorSort: ['total', -1],
                   custSort: ['score', -1], custScored: [],
                   priceItem: '', pricePts: [] };

// hour 14 -> "2 PM", 0 -> "12 AM" (site is America/New_York; buckets already are)
function insHourLabel(h) {
  const ampm = h < 12 ? 'AM' : 'PM';
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12} ${ampm}`;
}

async function loadInsights() {
  $('#ins-content').hidden = true;
  $('#ins-empty').hidden = true;
  $('#ins-loading').hidden = false;

  let res;
  try {
    res = await apiFetch('GET', 'api/sales.php', { params: { action: 'stats', days: insState.days } });
  } catch (e) { res = { ok: false, error: String(e) }; }

  $('#ins-loading').hidden = true;

  if (!res.ok || !res.data) {
    $('#ins-empty').textContent = `Error: ${res.error || 'failed to load insights'}`;
    $('#ins-empty').hidden = false;
    checkAuthError(res.error);
    return;
  }

  insState.data = res.data;
  if (!safeInt(res.data.kpis?.total_sales)) {
    $('#ins-empty').textContent = insState.days
      ? 'No sales in this window yet — try a wider range.'
      : 'No sales uploaded yet. Point the Mail monitor at your in-game mail and your vendor sales will start flowing in.';
    $('#ins-empty').hidden = false;
    return;
  }

  $('#ins-content').hidden = false;
  renderInsKpis(res.data.kpis, res.data);
  drawInsTrend(res.data.trend, res.data.weekly);
  renderInsHeatmap(res.data.by_hour, res.data.by_dow, res.data.kpis);
  renderInsDow(res.data.by_dow);
  renderInsLoyalty(res.data.loyalty);
  renderInsLeaders('#ins-items', res.data.top_items, 'item');
  renderInsLeaders('#ins-buyers', res.data.top_buyers, 'buyer');
  renderInsLeaders('#ins-vendors', res.data.top_vendors, 'vendor');
  renderInsItemPerf();
  renderInsCustPerf();
  renderInsVendorPerf();
  insFillPriceItems();
  if (insState.tab === 'pricing') loadInsPrices();
}

// ---- Customer loyalty scoring ---------------------------------------------

/* RFM-style 0–100 score over the window's buyers: how much they spend and how
   often they buy (each as a percentile against your other customers), plus how
   recently they were seen. Tuned for a vendor game: regulars who keep coming
   back score high even if individual purchases are small. */
function insScoreBuyers(buyers, sinceTs) {
  const n = buyers.length;
  if (!n) return [];
  const rankOf = (arr, v) => arr.filter((x) => x < v).length / Math.max(1, n - 1);
  const totals = buyers.map((b) => safeInt(b.total));
  const counts = buyers.map((b) => safeInt(b.count));
  const nowTs = Math.floor(Date.now() / 1000);
  const windowSpan = Math.max(1, nowTs - (sinceTs || nowTs - 90 * 86400));
  return buyers.map((b) => {
    const spendR = rankOf(totals, safeInt(b.total));
    const freqR = rankOf(counts, safeInt(b.count));
    const recency = 1 - Math.min(1, (nowTs - safeInt(b.last)) / windowSpan);
    // Loyalty-weighted: coming back matters most. One-time buyers cap at 49 —
    // however big the single purchase, loyalty needs a second visit.
    let score = Math.round((spendR * 0.3 + freqR * 0.5 + recency * 0.2) * 100);
    if (safeInt(b.count) === 1) score = Math.min(score, 49);
    const tier = score >= 80 ? 'VIP' : score >= 55 ? 'Regular'
      : safeInt(b.count) > 1 ? 'Returning' : 'One-time';
    // momentum: purchases in the recent half vs the half before ("on the move")
    const hasTrend = b.recent_cnt !== undefined;
    const priorCnt = safeInt(b.count) - safeInt(b.recent_cnt);
    const trend = !hasTrend ? 0
      : priorCnt > 0 ? Math.round((safeInt(b.recent_cnt) / priorCnt - 1) * 100)
      : safeInt(b.recent_cnt) > 0 ? 1e9 : -1e9;
    return { ...b, score, tier, spendR, freqR, recency, trend, hasTrend };
  });
}

const INS_TIER_CLASS = { VIP: 'ins-tier-vip', Regular: 'ins-tier-reg',
                         Returning: 'ins-tier-ret', 'One-time': 'ins-tier-one' };

function renderInsCustPerf() {
  const data = insState.data || {};
  $('#ins-custperf-head').innerHTML = insHeadHtml([
    ['name', 'Customer'], ['score', 'Score', 'Loyalty: frequency + spend percentiles and recency'],
    ['trend', 'Trend', 'On the move? Purchases in the recent half of the window vs the half before'],
    ['total', 'Revenue'], ['count', 'Purchases'], ['avg', 'Avg buy'],
    ['last', 'Last seen'],
  ], insState.custSort);
  if (!Array.isArray(data.buyers)) { $('#ins-custperf-body').innerHTML = INS_NEEDS_SITE; return; }
  insState.custScored = insScoreBuyers(data.buyers, safeInt(data.since));
  const cq = (insState.custFilter || '').trim().toLowerCase();
  const rows = insSortRows(
    insState.custScored.filter((r) => !cq || String(r.name).toLowerCase().includes(cq)),
    insState.custSort);
  $('#ins-custperf-sub').textContent =
    `${rows.length}${cq ? ` of ${insState.custScored.length}` : ''} customer${rows.length === 1 ? '' : 's'} · click one for their scorecard`;
  $('#ins-custperf-body').innerHTML = rows.map((r) => `
    <tr data-inscust="${escapeHtml(r.name)}" title="Open ${escapeHtml(r.name)}'s scorecard">
      <td class="col-name">${escapeHtml(r.name)}</td>
      <td class="stat"><span class="ins-tier ${INS_TIER_CLASS[r.tier]}">${r.score}</span> ${r.tier}</td>
      <td class="stat">${r.hasTrend ? insGrowthHtml(r.count, safeInt(r.recent_cnt)) : '<span class="stat_off">—</span>'}</td>
      <td class="stat">${fmtShort(r.total)}</td>
      <td class="stat">${fmtNum(r.count)}</td>
      <td class="stat">${fmtShort(r.avg)}</td>
      <td class="stat">${insAgo(r.last)}</td>
    </tr>`).join('') || '<tr><td colspan="9" class="stat_off lab-pool-empty">No customers in this window.</td></tr>';
}

function insAgo(ts) {
  if (!ts) return '—';
  const d = Math.floor((Date.now() / 1000 - ts) / 86400);
  return d <= 0 ? 'today' : d === 1 ? 'yesterday' : d < 30 ? `${d}d ago`
    : d < 365 ? `${Math.round(d / 30)}mo ago` : `${(d / 365).toFixed(1)}y ago`;
}

// ---- Customer scorecard dialog --------------------------------------------

// Default quick-messages; users can rewrite them (persisted in app config).
// Templates are plain MESSAGE BODIES — {name} is replaced with the customer's
// name, and the tell/mail toggle decides whether "/tell <name> " is prefixed.
const INS_CUST_MSGS_DEFAULT = [
  ['Thank you', 'Thanks for your business, {name}! Let me know if you ever need anything crafted.'],
  ['Restock ping', 'Just restocked the vendor with fresh goods — come take a look when you\'re around!'],
  ['VIP treatment', 'You\'re one of my best customers, {name} — ask me about a discount on your next order. o7'],
];

const insMsgText = (tpl, b) => String(tpl[1]).replace(/\{name\}/g, b.name);
const insMsgOut = (tpl, b) => insState.custMsgMode === 'mail'
  ? insMsgText(tpl, b) : `/tell ${b.name} ${insMsgText(tpl, b)}`;

async function insLoadCustMsgs() {
  if (insState.custMsgs) return;
  try {
    const res = await api().get_config();
    const saved = res.ok && Array.isArray(res.data.ins_cust_msgs) ? res.data.ins_cust_msgs : null;
    insState.custMsgs = (saved && saved.length)
      ? saved : INS_CUST_MSGS_DEFAULT.map((m) => [...m]);
  } catch (_) { insState.custMsgs = INS_CUST_MSGS_DEFAULT.map((m) => [...m]); }
}

function renderInsCustMsgs(b, editing = false) {
  const host = $('#ins-cust-msgs');
  const msgs = insState.custMsgs || INS_CUST_MSGS_DEFAULT;
  const mode = insState.custMsgMode || 'tell';
  if (!editing) {
    // ONE line: caret+title · pencil · copy buttons · format toggle. The
    // caret collapses it down to just the labeled strip (sticky preference).
    host.classList.toggle('collapsed', localStorage.getItem('ins_cust_msgs_collapsed') === '1');
    host.innerHTML = `
      <div class="ins-cust-msghead">
        <span class="ins-cust-msgtoggle" data-msgtoggle title="Collapse / expand quick messages">
          <i class="ins-caret fa-solid fa-chevron-down"></i>
          <span class="ins-cust-msgtitle">Quick messages</span>
        </span>
        <button type="button" class="btn btn-icon" data-msgedit title="Customize these messages">
          <i class="fa-solid fa-pen"></i></button>
        <div class="ins-cust-msgbtns">
          ${msgs.map((tpl, i) => `
            <button type="button" class="btn btn-sm btn-outline-secondary" data-custmsg="${i}"
              title="${escapeHtml(insMsgOut(tpl, b))}">
              <i class="fa-solid fa-copy"></i> ${escapeHtml(String(tpl[0]))}</button>`).join('')}
        </div>
        <div class="ins-seg ins-msg-seg" title="How copied messages are formatted">
          <button type="button" data-msgmode="tell" class="${mode === 'tell' ? 'active' : ''}">/tell</button>
          <button type="button" data-msgmode="mail" class="${mode === 'mail' ? 'active' : ''}">Mail body</button>
        </div>
      </div>`;
    return;
  }
  host.classList.remove('collapsed');
  host.innerHTML = `<div class="ins-msgedit">
    <div class="ins-cust-msghead"><span class="ins-cust-msgtitle">Customize messages</span></div>
    <div class="ins-sub"><b>{name}</b> becomes the customer's name. Write just the message —
      the /tell prefix comes from the toggle.</div>
    ${msgs.map(([label, tpl]) => `
      <div class="ins-msgedit-row">
        <input type="text" class="form-control filter-input ins-msgedit-label" value="${escapeHtml(String(label))}"
               placeholder="Button label" maxlength="24" spellcheck="false">
        <input type="text" class="form-control filter-input ins-msgedit-tpl" value="${escapeHtml(String(tpl))}"
               placeholder="Message — {name} becomes their name" maxlength="240" spellcheck="false">
        <button type="button" class="btn btn-icon" data-msgdel title="Remove"><i class="fa-solid fa-xmark"></i></button>
      </div>`).join('')}
    <div class="ins-msgedit-actions">
      <button type="button" class="btn btn-sm btn-outline-secondary" data-msgadd><i class="fa-solid fa-plus"></i> Add message</button>
      <button type="button" class="btn btn-sm btn-accent" data-msgsave>Save</button>
      <button type="button" class="btn btn-sm btn-outline-secondary" data-msgcancel>Cancel</button>
    </div>
  </div>`;
}

// Open a customer's scorecard from ANYWHERE (e.g. the My Sales buyer cells).
// The scored list only exists after an Insights load, so fetch it on demand.
async function insOpenScorecard(name) {
  if (!(insState.custScored || []).some((b) => b.name === name)) {
    try {
      const res = await apiFetch('GET', 'api/sales.php',
        { params: { action: 'stats', days: insState.days } });
      if (res.ok && res.data) {
        insState.data = res.data;
        insState.custScored = insScoreBuyers(res.data.buyers || [], safeInt(res.data.since));
      }
    } catch (_) { /* offline — the check below reports it */ }
  }
  if ((insState.custScored || []).some((b) => b.name === name)) {
    openInsCustCard(name);
  } else {
    toast(`No scorecard for ${name} in the current Insights window — try a wider range on Sales Insights`, false);
  }
}

// Half-moon 0–100 gauge — a "gas tank" fill for the loyalty score. The fill is
// the FULL half-arc masked by stroke-dashoffset, then transitioned to the
// score on the next frame — an animated fill-up with no chart library.
const INS_GAUGE_LEN = Math.PI * 40; // arc length of the half circle, r=40
function insGaugeShow(host, score, tierClass) {
  const f = Math.max(0, Math.min(100, score)) / 100;
  host.innerHTML = `<svg viewBox="0 0 100 56" class="ins-gauge ${tierClass}">
    <path class="ins-gauge-track" d="M 10 48 A 40 40 0 0 1 90 48"/>
    <path class="ins-gauge-fill" d="M 10 48 A 40 40 0 0 1 90 48"
      style="stroke-dasharray:${INS_GAUGE_LEN.toFixed(1)};stroke-dashoffset:${INS_GAUGE_LEN.toFixed(1)}"/>
    <text x="50" y="46" text-anchor="middle" class="ins-gauge-num">${score}</text>
  </svg>`;
  const fill = host.querySelector('.ins-gauge-fill');
  requestAnimationFrame(() => requestAnimationFrame(() => {
    fill.style.strokeDashoffset = (INS_GAUGE_LEN * (1 - f)).toFixed(1);
  }));
}

// Per-customer mini charts, computed straight from their purchase list:
// spending cadence over time, a personal buy-time heatmap, and vendor split.
function renderInsCustCharts(sales) {
  const tl = $('#ins-cust-timeline'), heat = $('#ins-cust-heat'), ven = $('#ins-cust-vendors');
  if (!sales || !sales.length) {
    const none = '<div class="ins-empty-mini">No purchase data.</div>';
    tl.innerHTML = none; heat.innerHTML = none; ven.innerHTML = none;
    return;
  }
  // timeline: weekly buckets, monthly when their history spans long
  const now = Math.floor(Date.now() / 1000);
  const first = Math.min(...sales.map((s) => s.ts));
  const spanDays = Math.max(1, (now - first) / 86400);
  const monthly = spanDays > 120;
  const bucketSec = (monthly ? 30 : 7) * 86400;
  const n = Math.max(2, Math.min(16, Math.ceil((now - first) / bucketSec) + 1));
  const buckets = Array.from({ length: n }, (_, i) => ({
    total: 0, count: 0, start: now - (n - i) * bucketSec }));
  sales.forEach((s) => {
    const i = n - 1 - Math.floor((now - s.ts) / bucketSec);
    if (i >= 0 && i < n) { buckets[i].total += s.amount; buckets[i].count++; }
  });
  const maxT = Math.max(1, ...buckets.map((x) => x.total));
  tl.innerHTML = `<div class="ins-dow ins-ctl" style="grid-template-columns:repeat(${n},1fr)">`
    + buckets.map((x) => {
      const d = new Date((x.start + bucketSec) * 1000);
      const lbl = monthly ? d.toLocaleDateString('en-US', { month: 'short' })
        : `${d.getMonth() + 1}/${d.getDate()}`;
      return `<div class="ins-dow-col" title="${monthly ? 'month ending' : 'week of'} ${lbl} — ${fmtNum(x.total)} · ${fmtNum(x.count)} buy${x.count === 1 ? '' : 's'}">
        <div class="ins-dow-val">${x.total ? fmtShort(x.total) : ''}</div>
        <div class="ins-dow-track"><div class="ins-dow-fill" style="height:${(x.total / maxT * 100).toFixed(1)}%"></div></div>
        <div class="ins-dow-label">${lbl}</div></div>`;
    }).join('') + '</div>';
  // personal day×hour heatmap
  const grid = Array.from({ length: 7 }, () => Array(24).fill(0));
  sales.forEach((s) => { const d = new Date(s.ts * 1000); grid[d.getDay()][d.getHours()]++; });
  let hmax = 1;
  grid.forEach((r) => r.forEach((c) => { if (c > hmax) hmax = c; }));
  heat.innerHTML = '<div class="ins-heat-grid">' + DOW_LABELS.map((day, d) => {
    const cells = Array.from({ length: 24 }, (_, h) => {
      const c = grid[d][h];
      const a = c ? (0.15 + 0.85 * (c / hmax)).toFixed(3) : 0;
      return `<div class="ins-heat-cell${c ? '' : ' empty'}" style="${c ? `background:rgba(226,67,80,${a})` : ''}"
        title="${day} · ${insHourLabel(h)} — ${fmtNum(c)} purchase${c === 1 ? '' : 's'}"></div>`;
    }).join('');
    return `<div class="ins-heat-daylabel">${DOW_SHORT[d]}<span class="ins-heat-dayfull">${day}</span></div>
            <div class="ins-heat-cells">${cells}</div>`;
  }).join('') + '</div>';
  // vendor split — where their money lands
  const byV = {};
  sales.forEach((s) => { const v = s.vendor || '—'; byV[v] = (byV[v] || 0) + s.amount; });
  const rows = Object.entries(byV).sort((a, z) => z[1] - a[1]).slice(0, 5);
  const vmax = Math.max(1, ...rows.map((r) => r[1]));
  ven.innerHTML = rows.map(([vname, total], i) => `
    <div class="ins-lead">
      <div class="ins-lead-bar" style="width:${(total / vmax * 100).toFixed(1)}%"></div>
      <span class="ins-lead-rank">${i + 1}</span>
      <span class="ins-lead-name">${escapeHtml(vname)}</span>
      <span class="ins-lead-val">${fmtShort(total)}</span>
    </div>`).join('');
}

async function openInsCustCard(name) {
  const b = (insState.custScored || []).find((x) => x.name === name);
  if (!b) return;
  const modal = $('#ins-cust-modal');
  $('#ins-cust-name').textContent = b.name;
  // NOT the tier-chip class — that carries a tinted chip background which
  // must not paint behind the gauge; gauges get their own color hooks.
  const gaugeClass = { VIP: 'g-vip', Regular: 'g-reg', Returning: 'g-ret', 'One-time': 'g-one' };
  insGaugeShow($('#ins-cust-gauge'), b.score, gaugeClass[b.tier] || 'g-one');
  $('#ins-cust-score').innerHTML =
    `<span class="ins-tier ${INS_TIER_CLASS[b.tier]}">${b.tier}</span>`;
  const trendTxt = b.hasTrend && b.trend !== 0
    ? ` · ${b.trend >= 1e9 ? 'all activity is recent' : b.trend > 0 ? `trending ▲${b.trend}%` : b.trend <= -1e9 ? 'quiet lately' : `slowing ▼${Math.abs(b.trend)}%`}`
    : '';
  $('#ins-cust-scoreline').innerHTML =
    `<i class="fa-solid fa-lightbulb"></i><span>Spends more than <b>${Math.round(b.spendR * 100)}%</b> `
    + `of your customers and buys more often than <b>${Math.round(b.freqR * 100)}%</b>. `
    + `Last seen <b>${insAgo(b.last)}</b>${escapeHtml(trendTxt)}.</span>`;
  renderInsCustTiles(b.total, b.count, b.avg, b.first, b.last, 'in the page window');
  await insLoadCustMsgs();
  renderInsCustMsgs(b);
  $('#ins-cust-purchases').innerHTML =
    '<tr><td colspan="4" class="stat_off lab-pool-empty">Loading purchases…</td></tr>';
  $('#ins-cust-purchsub').textContent = '';
  insState.custSales = [];
  insState.custPurchFilter = '';
  $('#ins-cust-purchfilter').value = '';
  modal.hidden = false;
  insState.custOpen = b;
  // the scorecard has its OWN range (sticky, defaults to all time) — the whole
  // relationship matters here, not just the page's analysis window
  insState.custDays = safeInt(localStorage.getItem('ins_cust_days') || 0);
  $('#ins-cust-range').value = String(insState.custDays);
  insLoadCustDetail(b);
}

function renderInsCustTiles(total, count, avg, first, last, rangeTxt) {
  const tiles = [
    ['Revenue', fmtShort(total), fmtNum(total) + ' credits'],
    ['Purchases', fmtNum(count), rangeTxt],
    ['Avg buy', fmtShort(avg), 'per purchase'],
    ['First seen', first ? fmtDate(first).split(',')[0] : '—', first ? insAgo(first) : ''],
    ['Last seen', last ? fmtDate(last).split(',')[0] : '—', last ? insAgo(last) : ''],
  ];
  $('#ins-cust-tiles').innerHTML = tiles.map(([label, big, sub]) => `
    <div class="ins-kpi"><div class="ins-kpi-label">${label}</div>
      <div class="ins-kpi-val">${escapeHtml(String(big))}</div>
      <div class="ins-kpi-sub">${escapeHtml(String(sub))}</div></div>`).join('');
}

// Fetch + render everything range-dependent: tiles, charts, purchases. The
// score/gauge/insight stay tied to the PAGE window (percentiles need all
// buyers, which stats only aggregates per window).
async function insLoadCustDetail(b) {
  const days = insState.custDays;
  let res;
  try {
    res = await apiFetch('GET', 'api/sales.php',
      { params: { action: 'buyer_sales', buyer: b.name, days } });
  } catch (e) { res = { ok: false, error: String(e) }; }
  if ($('#ins-cust-modal').hidden || insState.custOpen !== b || insState.custDays !== days) return;
  const sales = (res.ok && res.data && res.data.sales) || null;
  if (!sales) {
    $('#ins-cust-purchases').innerHTML =
      '<tr><td colspan="4" class="stat_off lab-pool-empty">Purchase history needs the latest swgtracker.com update.</td></tr>';
    renderInsCustCharts([]);
    return;
  }
  const rangeTxt = days ? `last ${days} days` : 'all time';
  const total = sales.reduce((s, x) => s + x.amount, 0);
  renderInsCustTiles(total, sales.length,
    sales.length ? Math.round(total / sales.length) : 0,
    sales.length ? Math.min(...sales.map((s) => s.ts)) : 0,
    sales.length ? Math.max(...sales.map((s) => s.ts)) : 0, rangeTxt);
  renderInsCustCharts(sales);
  const byItem = {};
  sales.forEach((s) => { byItem[s.item] = (byItem[s.item] || 0) + s.amount; });
  const fav = Object.entries(byItem).sort((a, z) => z[1] - a[1])[0];
  $('#ins-cust-purchsub').textContent =
    `${fmtNum(sales.length)} purchase${sales.length === 1 ? '' : 's'} (${rangeTxt})`
    + (fav ? ` · favorite: ${fav[0]} (${fmtShort(fav[1])})` : '');
  insState.custSales = sales;
  renderInsCustPurchases();
}

function renderInsCustPurchases() {
  const sort = insState.custPurchSort || ['ts', -1];
  $('#ins-cust-purchcols').innerHTML = insHeadHtml([
    ['ts', 'Date'], ['item', 'Item'], ['amount', 'Price'], ['vendor', 'Vendor'],
  ], sort);
  const q = (insState.custPurchFilter || '').trim().toLowerCase();
  const rows = insSortRows(
    (insState.custSales || []).filter((s) => !q
      || String(s.item || '').toLowerCase().includes(q)
      || String(s.vendor || '').toLowerCase().includes(q)),
    sort);
  $('#ins-cust-purchases').innerHTML = rows.map((s) => `
    <tr><td class="stat" style="white-space:nowrap">${fmtDate(s.ts).split(',')[0]}</td>
      <td class="col-name">${escapeHtml(s.item || '')}</td>
      <td class="stat">${fmtShort(s.amount)}</td>
      <td class="col-name">${escapeHtml(s.vendor || '')}</td></tr>`).join('')
    || `<tr><td colspan="4" class="stat_off lab-pool-empty">${q ? 'No purchases match.' : 'No purchases in this window.'}</td></tr>`;
}

// ---- Items / Vendors performance tables (KPIs requested by Lativa) --------

const INS_NEEDS_SITE = '<tr><td colspan="9" class="stat_off lab-pool-empty">This view needs the latest swgtracker.com update — check back soon.</td></tr>';

// Growth: revenue in the recent half of the window vs the half before.
function insGrowthHtml(total, recentRev) {
  const prior = total - recentRev;
  if (prior <= 0 && recentRev <= 0) return '<span class="stat_off">—</span>';
  if (prior <= 0) return '<span class="ins-up" title="All activity landed in the recent half of the window">new</span>';
  const pct = Math.round((recentRev / prior - 1) * 100);
  if (pct === 0) return '<span class="stat_off">0%</span>';
  return pct > 0
    ? `<span class="ins-up">▲ ${pct}%</span>`
    : `<span class="ins-down">▼ ${Math.abs(pct)}%</span>`;
}

const INS_STR_COLS = new Set(['name', 'item', 'vendor']);
function insSortRows(rows, [key, dir]) {
  const isStr = INS_STR_COLS.has(key);
  return [...rows].sort((a, b) => {
    const av = isStr ? String(a[key] || '').toLowerCase() : safeInt(a[key]);
    const bv = isStr ? String(b[key] || '').toLowerCase() : safeInt(b[key]);
    return (av < bv ? -1 : av > bv ? 1 : 0) * dir;
  });
}

function insHeadHtml(cols, sort) {
  return cols.map(([key, label, title]) =>
    `<th data-inssort="${key}" class="${key === 'name' ? 'col-name' : ''}" ${title ? `title="${title}"` : ''}
       style="cursor:pointer">${label}${sort[0] === key ? (sort[1] > 0 ? ' ▲' : ' ▼') : ''}</th>`).join('');
}

function renderInsItemPerf() {
  const data = insState.data || {};
  const totalRev = Math.max(1, safeInt(data.kpis?.total_revenue));
  $('#ins-itemperf-head').innerHTML = insHeadHtml([
    ['name', 'Item'], ['count', 'Sold', 'Transactions in the window'],
    ['total', 'Revenue'], ['share', 'Share', 'Of total revenue in the window'],
    ['avg', 'Avg price'], ['growth', 'Growth', 'Revenue: recent half of the window vs the half before'],
  ], insState.itemSort);
  if (!Array.isArray(data.items)) { $('#ins-itemperf-body').innerHTML = INS_NEEDS_SITE; return; }
  const iq = (insState.itemFilter || '').trim().toLowerCase();
  const rows = insSortRows(
    data.items
      .filter((r) => !iq || String(r.name).toLowerCase().includes(iq))
      .map((r) => {
        // sort key must MATCH the rendered value (the percentage), not the
        // absolute credit delta — 'new' ranks above any %, no-data sinks
        const total = safeInt(r.total), recent = safeInt(r.recent_rev), prior = total - recent;
        const growth = prior > 0 ? Math.round((recent / prior - 1) * 100)
          : recent > 0 ? 1e9 : -1e9;
        return { ...r, share: total / totalRev * 1000, growth };
      }),
    insState.itemSort);
  $('#ins-itemperf-sub').textContent =
    `${rows.length}${iq ? ` of ${data.items.length}` : ''} item${rows.length === 1 ? '' : 's'} · click a row to see its sales`;
  $('#ins-itemperf-body').innerHTML = rows.map((r) => `
    <tr data-insjump="${escapeHtml(r.name)}" title="Show “${escapeHtml(r.name)}” in My Sales">
      <td class="col-name">${escapeHtml(r.name)}</td>
      <td class="stat">${fmtNum(r.count)}</td>
      <td class="stat">${fmtShort(r.total)}</td>
      <td class="stat">${(safeInt(r.total) / totalRev * 100).toFixed(1)}%</td>
      <td class="stat">${fmtShort(r.avg)}</td>
      <td class="stat">${insGrowthHtml(safeInt(r.total), safeInt(r.recent_rev))}</td>
    </tr>`).join('') || '<tr><td colspan="9" class="stat_off lab-pool-empty">No sales in this window.</td></tr>';
}

function renderInsVendorPerf() {
  const data = insState.data || {};
  $('#ins-vendorperf-head').innerHTML = insHeadHtml([
    ['name', 'Vendor'], ['total', 'Revenue'], ['count', 'Sales'],
    ['customers', 'Customers', 'Distinct buyers at this vendor'],
    ['avg', 'Avg sale'], ['best_item_rev', 'Best item', 'Highest-earning item at this vendor'],
  ], insState.vendorSort);
  if (!Array.isArray(data.vendors)) { $('#ins-vendorperf-body').innerHTML = INS_NEEDS_SITE; return; }
  const vq = (insState.vendorFilter || '').trim().toLowerCase();
  const rows = insSortRows(
    data.vendors.filter((r) => !vq
      || String(r.name).toLowerCase().includes(vq)
      || String(r.best_item || '').toLowerCase().includes(vq)),  // find "who sells X" too
    insState.vendorSort);
  $('#ins-vendorperf-sub').textContent =
    `${rows.length}${vq ? ` of ${data.vendors.length}` : ''} vendor${rows.length === 1 ? '' : 's'} · click a row to see its sales`;
  $('#ins-vendorperf-body').innerHTML = rows.map((r) => `
    <tr data-insjump="${escapeHtml(r.name)}" title="Show “${escapeHtml(r.name)}” in My Sales">
      <td class="col-name">${escapeHtml(r.name)}</td>
      <td class="stat">${fmtShort(r.total)}</td>
      <td class="stat">${fmtNum(r.count)}</td>
      <td class="stat">${fmtNum(r.customers)}</td>
      <td class="stat">${fmtShort(r.avg)}</td>
      <td class="col-name">${r.best_item ? `${escapeHtml(r.best_item)} <span class="ins-sub">(${fmtShort(r.best_item_rev)})</span>` : '<span class="stat_off">—</span>'}</td>
    </tr>`).join('') || '<tr><td colspan="9" class="stat_off lab-pool-empty">No sales in this window.</td></tr>';
}

// ---- Pricing tab ----------------------------------------------------------

// Filterable item picker (a native select is unusable with 100 long names).
function insFillPriceItems() {
  insState.priceItems = insState.data?.items || insState.data?.top_items || [];
  const keep = insState.priceItem;
  if (!keep || !insState.priceItems.some((r) => r.name === keep)) {
    insState.priceItem = insState.priceItems[0]?.name || '';
  }
  $('#ins-price-current').textContent = insState.priceItem || 'Pick an item…';
}

function insRenderPriceOpts(query = '') {
  const q = query.trim().toLowerCase();
  const rows = q
    ? (insState.priceItems || []).filter((r) => String(r.name).toLowerCase().includes(q)).slice(0, 60)
    : (insState.priceItems || []);
  $('#ins-price-opts').innerHTML = rows.map((r) => `
    <div class="mysd-opt ins-price-opt" data-priceitem="${escapeHtml(r.name)}">
      <span class="mysd-opt-name">${escapeHtml(r.name)}</span>
      <span class="ins-price-opt-rev">${fmtShort(r.total)}</span>
    </div>`).join('') || '<div class="mysd-opt-none">No items match.</div>';
}

function insClosePriceMenu() {
  $('.ins-price-menu').hidden = true;
}

function insPickPriceItem(name) {
  insState.priceItem = name;
  $('#ins-price-current').textContent = name;
  insClosePriceMenu();
  loadInsPrices();
}

async function loadInsPrices() {
  const item = insState.priceItem;
  const facts = $('#ins-price-facts');
  if (!item) { facts.innerHTML = '<div class="ins-empty-mini">No items sold in this window.</div>'; drawInsPrice([]); return; }
  let res;
  try {
    res = await apiFetch('GET', 'api/sales.php', { params: { action: 'item_prices', item, days: insState.days } });
  } catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok || !res.data || !Array.isArray(res.data.points)) {
    facts.innerHTML = '<div class="ins-empty-mini">Price history needs the latest swgtracker.com update.</div>';
    drawInsPrice([]);
    return;
  }
  insState.pricePts = res.data.points;
  drawInsPrice(res.data.points, res.data.weekly);
  // price-change + revenue-impact readout: first vs last half of the window
  const sold = res.data.points.filter((p) => p.count > 0);
  if (sold.length < 2) { facts.innerHTML = '<div class="ins-empty-mini">Not enough sales to read a trend.</div>'; return; }
  const half = Math.floor(res.data.points.length / 2);
  const agg = (pts) => {
    const c = pts.reduce((s, p) => s + p.count, 0), t = pts.reduce((s, p) => s + p.total, 0);
    return { c, t, avg: c ? t / c : 0 };
  };
  const a = agg(res.data.points.slice(0, half)), b = agg(res.data.points.slice(half));
  const pricePct = a.avg > 0 ? Math.round((b.avg / a.avg - 1) * 100) : null;
  const revPct = a.t > 0 ? Math.round((b.t / a.t - 1) * 100) : null;
  const arrow = (pct) => pct == null ? '—'
    : pct === 0 ? 'flat'
    : `<span class="${pct > 0 ? 'ins-up' : 'ins-down'}">${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%</span>`;
  facts.innerHTML = `
    <span title="Average selling price, first half vs second half of the window">
      Avg price ${fmtShort(Math.round(a.avg))} → ${fmtShort(Math.round(b.avg))} (${arrow(pricePct)})</span>
    <span title="Revenue for this item, first half vs second half of the window">
      · revenue ${fmtShort(a.t)} → ${fmtShort(b.t)} (${arrow(revPct)})</span>
    <span> · ${fmtNum(sold.reduce((s, p) => s + p.count, 0))} sales</span>`;
}

// Price chart: min–max band + average line per bucket; buckets with no sales
// leave gaps rather than dropping to zero.
function drawInsPrice(points, weekly) {
  const canvas = $('#ins-price-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 720;
  const h = canvas.clientHeight || 190;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  insState.priceDraw = [];
  const pts = points || [];
  if (pts.length < 2) return;

  const sold = pts.map((p, i) => ({ ...p, i, avg: p.count > 0 ? p.total / p.count : null }))
    .filter((p) => p.count > 0);
  if (!sold.length) return;

  // Scale to the PRICE RANGE (not zero) so level changes are visible, with
  // headroom; flat pricing still gets a sensible band via the fallback pad.
  const hi = Math.max(...sold.map((p) => p.max));
  const lo = Math.min(...sold.map((p) => p.min));
  const pad = Math.max((hi - lo) * 0.15, hi * 0.05, 1);
  const vTop = hi + pad, vBot = Math.max(0, lo - pad);

  // gridline labels first — the left gutter sizes itself to fit them. A narrow
  // range can round to duplicate short labels ("1m / 1m / 960k"); fall back to
  // exact numbers when that happens.
  ctx.font = '10px system-ui, sans-serif';
  const gvals = [vTop - pad * 0.2, (vTop + vBot) / 2, vBot + pad * 0.2];
  let glabels = gvals.map((v) => fmtShort(Math.round(v)));
  if (new Set(glabels).size < glabels.length) glabels = gvals.map((v) => fmtNum(Math.round(v)));
  const padL = Math.max(46, ...glabels.map((t) => ctx.measureText(t).width + 12));
  const padR = 12, padT = 14, padB = 22;
  const x = (i) => padL + (i / (pts.length - 1)) * (w - padL - padR);
  const y = (v) => (h - padB) - ((v - vBot) / (vTop - vBot)) * (h - padT - padB);

  gvals.forEach((v, gi) => {
    ctx.strokeStyle = 'rgba(255,255,255,.06)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, y(v)); ctx.lineTo(w - padR, y(v)); ctx.stroke();
    ctx.fillStyle = 'rgba(255,255,255,.38)';
    ctx.textAlign = 'right';
    ctx.fillText(glabels[gi], padL - 6, y(v) + 3);
  });

  // one continuous average-price line through every sold bucket — gaps are
  // bridged so sparse sellers still read as a trend, dots mark real sales
  ctx.beginPath();
  sold.forEach((p, j) => (j ? ctx.lineTo(x(p.i), y(p.avg)) : ctx.moveTo(x(p.i), y(p.avg))));
  ctx.strokeStyle = 'rgba(226, 67, 80, .55)'; ctx.lineWidth = 1.5; ctx.lineJoin = 'round';
  ctx.stroke();

  // per-bucket min–max whisker + avg dot
  for (const p of sold) {
    const px = x(p.i);
    if (p.min !== p.max) {
      ctx.strokeStyle = 'rgba(226, 67, 80, .5)'; ctx.lineWidth = 1.25;
      ctx.beginPath(); ctx.moveTo(px, y(p.min)); ctx.lineTo(px, y(p.max)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - 2.5, y(p.min)); ctx.lineTo(px + 2.5, y(p.min)); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(px - 2.5, y(p.max)); ctx.lineTo(px + 2.5, y(p.max)); ctx.stroke();
    }
    ctx.fillStyle = '#e24350';
    ctx.beginPath(); ctx.arc(px, y(p.avg), 2.75, 0, Math.PI * 2); ctx.fill();
  }

  ctx.fillStyle = 'rgba(255,255,255,.4)';
  ctx.font = '10px system-ui, sans-serif';
  const ticks = [...new Set([0, Math.floor((pts.length - 1) / 2), pts.length - 1])];
  ticks.forEach((i) => {
    ctx.textAlign = i === 0 ? 'left' : i === pts.length - 1 ? 'right' : 'center';
    ctx.fillText(pts[i].label, x(i), h - 6);
  });

  insState.priceDraw = pts.map((p, i) => ({ ...p, x: x(i),
    y: p.count > 0 ? y(p.total / p.count) : null, weekly }));
}

function insPriceHover(evt) {
  const pts = (insState.priceDraw || []).filter((p) => p.count > 0);
  const tip = $('#ins-price-tip');
  if (!pts.length) { tip.hidden = true; return; }
  const rect = evt.currentTarget.getBoundingClientRect();
  const mx = evt.clientX - rect.left;
  let best = pts[0], bd = Infinity;
  for (const p of pts) { const d = Math.abs(p.x - mx); if (d < bd) { bd = d; best = p; } }
  const avg = Math.round(best.total / best.count);
  tip.innerHTML = `<b>${best.weekly ? 'week of ' : ''}${escapeHtml(best.label)}</b>
    — avg ${fmtNum(avg)}${best.min !== best.max ? ` (${fmtNum(best.min)}–${fmtNum(best.max)})` : ''}
    · ${fmtNum(best.count)} sale${best.count === 1 ? '' : 's'} · ${fmtShort(best.total)} revenue`;
  tip.style.left = Math.min(Math.max(best.x, 60), rect.width - 60) + 'px';
  tip.hidden = false;
}

function renderInsKpis(k, data) {
  const bestDay = k.best_day?.date
    ? `${fmtShort(k.best_day.total)} · ${fmtDate(k.best_day.date + ' 12:00:00').split(',')[0]}`
    : '—';
  const busyHour = k.busiest_hour?.hour != null
    ? `${insHourLabel(k.busiest_hour.hour)} · ${fmtNum(k.busiest_hour.count)} sales`
    : '—';
  const busyDow = k.busiest_dow?.dow != null
    ? `${DOW_LABELS[k.busiest_dow.dow]} · ${fmtNum(k.busiest_dow.count)} sales`
    : '—';
  const tiles = [
    ['Revenue', fmtShort(k.total_revenue), fmtNum(k.total_revenue) + ' credits'],
    ['Sales', fmtNum(k.total_sales), 'transactions'],
    ['Avg sale', fmtShort(k.avg_sale), 'per transaction'],
    ['Customers', fmtNum(k.unique_buyers), 'unique buyers'],
    ['Best day', bestDay, 'single-day revenue'],
    ['Peak hour', busyHour, 'most sales land here'],
  ];
  $('#ins-kpis').innerHTML = tiles.map(([label, big, sub]) => `
    <div class="ins-kpi">
      <div class="ins-kpi-label">${label}</div>
      <div class="ins-kpi-val" title="${escapeHtml(String(sub))}">${escapeHtml(String(big))}</div>
      <div class="ins-kpi-sub">${escapeHtml(String(sub))}</div>
    </div>`).join('');
  const rangeText = insState.days ? `last ${insState.days} days` : 'all time';
  $('#ins-trend-sub').textContent = `${rangeText}${data.weekly ? ' · weekly' : ' · daily'}`;
  $('#ins-heat-sub').textContent = `busiest: ${busyDow} · ${busyHour}`;
}

// Revenue trend — filled area + line on canvas, with a hover readout. Mirrors
// drawPulseChart's DPR handling.
function drawInsTrend(trend, weekly) {
  const canvas = $('#ins-trend-chart');
  if (!canvas) return;
  const cumulative = insState.trendMode === 'cumulative';
  let run = 0;
  const pts = (trend || []).map((b) => {
    run += safeInt(b.total);
    return { total: safeInt(b.total), cum: run, count: safeInt(b.count), label: b.label, date: b.date };
  });
  insState.trendPts = [];
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 720;
  const h = canvas.clientHeight || 190;
  canvas.width = w * dpr; canvas.height = h * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  if (pts.length < 2) return;

  const padL = 8, padR = 8, padT = 12, padB = 22;
  const vals = pts.map((p) => (cumulative ? p.cum : p.total));
  const max = Math.max(1, ...vals);
  const x = (i) => padL + (i / (pts.length - 1)) * (w - padL - padR);
  const y = (v) => (h - padB) - (v / max) * (h - padT - padB);

  // baseline
  ctx.strokeStyle = 'rgba(255,255,255,.06)';
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(padL, h - padB); ctx.lineTo(w - padR, h - padB); ctx.stroke();

  // area fill
  ctx.beginPath();
  vals.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(0), y(v))));
  ctx.lineTo(x(vals.length - 1), h - padB);
  ctx.lineTo(x(0), h - padB);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, padT, 0, h - padB);
  grad.addColorStop(0, 'rgba(226, 67, 80, .32)');
  grad.addColorStop(1, 'rgba(226, 67, 80, 0)');
  ctx.fillStyle = grad; ctx.fill();

  // line
  ctx.beginPath();
  vals.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(0), y(v))));
  ctx.strokeStyle = '#e24350'; ctx.lineWidth = 1.75;
  ctx.lineJoin = 'round'; ctx.stroke();

  // sparse x-axis labels (first, ~middle, last)
  ctx.fillStyle = 'rgba(255,255,255,.4)';
  ctx.font = '10px system-ui, sans-serif';
  const ticks = [0, Math.floor((pts.length - 1) / 2), pts.length - 1];
  [...new Set(ticks)].forEach((i) => {
    ctx.textAlign = i === 0 ? 'left' : i === pts.length - 1 ? 'right' : 'center';
    ctx.fillText(pts[i].label, x(i), h - 6);
  });

  insState.trendPts = pts.map((p, i) => ({ ...p, x: x(i), y: y(vals[i]), weekly, cumulative }));
}

function insTrendHover(evt) {
  const pts = insState.trendPts || [];
  const tip = $('#ins-trend-tip');
  if (!pts.length) { tip.hidden = true; return; }
  const rect = evt.currentTarget.getBoundingClientRect();
  const mx = evt.clientX - rect.left;
  let best = pts[0], bd = Infinity;
  for (const p of pts) { const d = Math.abs(p.x - mx); if (d < bd) { bd = d; best = p; } }
  const span = best.weekly ? 'week of ' : '';
  tip.innerHTML = best.cumulative
    ? `<b>through ${escapeHtml(best.label)}</b> — ${fmtNum(best.cum)} total`
    : `<b>${span}${escapeHtml(best.label)}</b> — ${fmtNum(best.total)}`
      + ` · ${fmtNum(best.count)} sale${best.count === 1 ? '' : 's'}`;
  tip.style.left = Math.min(Math.max(best.x, 60), rect.width - 60) + 'px';
  tip.hidden = false;
}

// Revenue by day of week — a 7-bar chart from the by_dow marginal. Answers
// "which days actually earn?" faster than the heatmap's day axis.
function renderInsDow(byDow) {
  const rows = byDow || [];
  const max = Math.max(1, ...rows.map((b) => safeInt(b.total)));
  const totalRev = rows.reduce((s, b) => s + safeInt(b.total), 0);
  const best = rows.reduce((m, b) => (safeInt(b.total) > safeInt(m.total) ? b : m), rows[0] || {});
  $('#ins-dow').innerHTML = rows.map((b, i) => {
    const pct = (safeInt(b.total) / max) * 100;
    const shareTxt = totalRev ? ` · ${Math.round((safeInt(b.total) / totalRev) * 100)}% of week` : '';
    return `<div class="ins-dow-col" title="${DOW_LABELS[i]} — ${fmtNum(b.total)} · ${fmtNum(b.count)} sale${b.count === 1 ? '' : 's'}${shareTxt}">
        <div class="ins-dow-val">${safeInt(b.total) ? fmtShort(b.total) : ''}</div>
        <div class="ins-dow-track"><div class="ins-dow-fill" style="height:${pct.toFixed(1)}%"></div></div>
        <div class="ins-dow-label">${DOW_SHORT[i]}</div>
      </div>`;
  }).join('');
  const sub = $('#ins-dow-sub');
  if (sub) sub.textContent = best && safeInt(best.total)
    ? `best: ${DOW_LABELS[byDow.indexOf(best)]}` : '';
}

// Customer loyalty — one-time vs repeat buyers, and the revenue each group
// drives. Two split bars answer "do I live off regulars or churn?".
function renderInsLoyalty(loyalty) {
  const box = $('#ins-loyalty');
  const l = loyalty || {};
  const oB = safeInt(l.onetime_buyers), rB = safeInt(l.repeat_buyers);
  const oR = safeInt(l.onetime_rev), rR = safeInt(l.repeat_rev);
  const totB = oB + rB, totR = oR + rR;
  if (!totB) { box.innerHTML = '<div class="ins-empty-mini">No data yet.</div>'; return; }

  const splitBar = (repeatVal, oneVal, repeatTxt, oneTxt) => {
    const tot = repeatVal + oneVal;
    const rp = tot ? (repeatVal / tot) * 100 : 0;
    const op = tot ? (oneVal / tot) * 100 : 0;
    return `<div class="ins-loyalty-bar">
        <div class="ins-loyalty-seg repeat" style="width:${rp.toFixed(1)}%" title="Repeat — ${escapeHtml(repeatTxt)} (${Math.round(rp)}%)">${rp >= 14 ? Math.round(rp) + '%' : ''}</div>
        <div class="ins-loyalty-seg onetime" style="width:${op.toFixed(1)}%" title="One-time — ${escapeHtml(oneTxt)} (${Math.round(op)}%)">${op >= 14 ? Math.round(op) + '%' : ''}</div>
      </div>`;
  };

  box.innerHTML = `
    <div class="ins-loyalty-row">
      <div class="ins-loyalty-caption"><span>Customers</span><span>${fmtNum(totB)}</span></div>
      ${splitBar(rB, oB, `${fmtNum(rB)} buyers`, `${fmtNum(oB)} buyers`)}
    </div>
    <div class="ins-loyalty-row">
      <div class="ins-loyalty-caption"><span>Revenue</span><span>${fmtShort(totR)}</span></div>
      ${splitBar(rR, oR, fmtShort(rR), fmtShort(oR))}
    </div>
    <div class="ins-loyalty-legend">
      <span><i class="repeat"></i>Repeat buyers</span>
      <span><i class="onetime"></i>One-time</span>
    </div>`;

  const sub = $('#ins-loyalty-sub');
  if (sub) sub.textContent = `${fmtNum(rB)} of ${fmtNum(totB)} came back`;
}

// Persisted collapse state for the chart panels.
function insApplyCollapsed() {
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('insCollapsed') || '[]'); } catch (_) { saved = []; }
  document.querySelectorAll('#page-insights .ins-panel[data-panel]').forEach((p) => {
    p.classList.toggle('collapsed', saved.includes(p.dataset.panel));
  });
}
function insToggleCollapsed(panel) {
  const key = panel.dataset.panel;
  const collapsed = panel.classList.toggle('collapsed');
  let saved = [];
  try { saved = JSON.parse(localStorage.getItem('insCollapsed') || '[]'); } catch (_) { saved = []; }
  saved = saved.filter((k) => k !== key);
  if (collapsed) saved.push(key);
  localStorage.setItem('insCollapsed', JSON.stringify(saved));
  // the trend canvas measures 0 while hidden — redraw when it re-expands
  if (!collapsed && key === 'trend' && insState.data) drawInsTrend(insState.data.trend, insState.data.weekly);
}

// Buy-time heatmap: 7 day-rows × 24 hour-cols, opacity ~ sales count. Answers
// "when do people buy?" at a glance; the darkest cell is the sweet spot.
function renderInsHeatmap(byHour, byDow, kpis) {
  const grid = insState.data?.heatmap || [];   // [dow][hour] => count
  let max = 1;
  grid.forEach((row) => (row || []).forEach((c) => { if (c > max) max = c; }));

  // Column axis: an hour tick every 3 hours (12a, 3a, 6a … 9p).
  const axis = Array.from({ length: 24 }, (_, h) =>
    h % 3 === 0
      ? `<span class="ins-heat-tick">${h === 0 ? '12a' : h === 12 ? '12p' : (h % 12) + (h < 12 ? 'a' : 'p')}</span>`
      : '<span class="ins-heat-tick"></span>').join('');

  const rows = DOW_LABELS.map((day, d) => {
    const cells = Array.from({ length: 24 }, (_, h) => {
      const c = safeInt(grid[d]?.[h]);
      const a = c ? (0.1 + 0.9 * (c / max)).toFixed(3) : 0;
      const bg = c ? `background:rgba(226,67,80,${a})` : '';
      return `<div class="ins-heat-cell${c ? '' : ' empty'}" style="${bg}"
                 title="${day} · ${insHourLabel(h)} — ${fmtNum(c)} sale${c === 1 ? '' : 's'}"></div>`;
    }).join('');
    return `<div class="ins-heat-daylabel">${DOW_SHORT[d]}<span class="ins-heat-dayfull">${day}</span></div>
            <div class="ins-heat-cells">${cells}</div>`;
  }).join('');

  $('#ins-heat').innerHTML = `
    <div class="ins-heat-grid">${rows}</div>
    <div class="ins-heat-axis"><span class="ins-heat-axispad"></span><div class="ins-heat-axisticks">${axis}</div></div>
    <div class="ins-heat-legend">
      <span>Fewer</span>
      <i style="background:rgba(226,67,80,.1)"></i><i style="background:rgba(226,67,80,.34)"></i>
      <i style="background:rgba(226,67,80,.58)"></i><i style="background:rgba(226,67,80,.82)"></i>
      <i style="background:rgba(226,67,80,1)"></i>
      <span>More</span>
    </div>`;
}

// Leaderboard: ranked rows with a proportional bar behind each total.
function renderInsLeaders(sel, rows, kind) {
  const box = $(sel);
  const list = (rows || []).slice(0, 15);
  if (!list.length) { box.innerHTML = '<div class="ins-empty-mini">No data yet.</div>'; return; }
  const max = Math.max(1, ...list.map((r) => safeInt(r.total)));
  const sub = (r) => kind === 'item'
    ? `${fmtNum(r.count)} sold · avg ${fmtShort(r.avg)}`
    : `${fmtNum(r.count)} sale${r.count === 1 ? '' : 's'} · avg ${fmtShort(r.avg)}`;
  box.innerHTML = list.map((r, i) => {
    const pct = (safeInt(r.total) / max) * 100;
    const nm = String(r.name);
    return `<div class="ins-lead" data-filter="${escapeHtml(nm)}" title="Show “${escapeHtml(nm)}” in My Sales">
        <div class="ins-lead-bar" style="width:${pct.toFixed(1)}%"></div>
        <span class="ins-lead-rank">${i + 1}</span>
        <span class="ins-lead-name">${escapeHtml(nm)}</span>
        <span class="ins-lead-val">${fmtShort(r.total)}</span>
        <span class="ins-lead-sub">${sub(r)}</span>
      </div>`;
  }).join('');
}

// Jump to My Sales pre-filtered to a clicked item / customer / vendor. The Sales
// search box matches item, buyer, vendor and location, so one term covers all three.
function insFilterSales(term) {
  if (!term) return;
  const box = $('#sales-search');
  if (box) box.value = term;
  if (typeof salesState !== 'undefined') salesState.page = 1;
  showPage('sales');
  if (typeof loadSales === 'function') loadSales();
}

function initInsights() {
  insState.custMsgMode = localStorage.getItem('ins_cust_msg_mode') || 'tell';
  insLoadCustMsgs(); // warm the quick-message templates from config
  $('#ins-range').addEventListener('change', () => {
    insState.days = safeInt($('#ins-range').value);
    loadInsights();
  });
  $('[data-refresh="insights"]').addEventListener('click', loadInsights);

  // collapse/expand any chart panel by clicking its header (not the mode toggle)
  insApplyCollapsed();
  $('#ins-content').addEventListener('click', (e) => {
    if (e.target.closest('.ins-seg')) return;             // let the toggle work
    const head = e.target.closest('.ins-panel-head');
    if (!head) return;
    const panel = head.closest('.ins-panel[data-panel]');
    if (panel) insToggleCollapsed(panel);
  });

  // click any leaderboard row -> open My Sales filtered to that item/buyer/vendor
  ['#ins-items', '#ins-buyers', '#ins-vendors'].forEach((sel) => {
    const el = $(sel);
    if (el) el.addEventListener('click', (e) => {
      const row = e.target.closest('.ins-lead[data-filter]');
      if (row) insFilterSales(row.dataset.filter);
    });
  });
  const canvas = $('#ins-trend-chart');
  if (canvas) {
    canvas.addEventListener('mousemove', insTrendHover);
    canvas.addEventListener('mouseleave', () => { $('#ins-trend-tip').hidden = true; });
  }

  // Per-period ↔ cumulative toggle for the revenue trend
  $('#ins-trend-mode').addEventListener('click', (e) => {
    const btn = e.target.closest('button[data-mode]');
    if (!btn) return;
    insState.trendMode = btn.dataset.mode;
    $('#ins-trend-mode').querySelectorAll('button').forEach((b) =>
      b.classList.toggle('active', b === btn));
    if (insState.data) drawInsTrend(insState.data.trend, insState.data.weekly);
  });
  // redraw the trend on window resize so the canvas stays crisp
  window.addEventListener('resize', () => {
    if (!$('#page-insights').classList.contains('active') || !insState.data) return;
    drawInsTrend(insState.data.trend, insState.data.weekly);
    if (insState.tab === 'pricing') drawInsPrice(insState.pricePts, insState.data.weekly);
  });

  // ---- tabs: Overview / Items / Vendors / Pricing
  $('#ins-tabs').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-instab]');
    if (!btn) return;
    insState.tab = btn.dataset.instab;
    $('#ins-tabs').querySelectorAll('.scd-tab').forEach((b) =>
      b.classList.toggle('active', b === btn));
    document.querySelectorAll('#ins-content [data-inspane]').forEach((p) => {
      p.hidden = p.dataset.inspane !== insState.tab;
    });
    // canvases measure 0 while hidden — redraw whatever just became visible
    if (insState.tab === 'overview' && insState.data) drawInsTrend(insState.data.trend, insState.data.weekly);
    if (insState.tab === 'pricing') loadInsPrices();
  });

  // sortable headers + click-through rows on the performance tables
  const wireSort = (headSel, stateKey, render) => {
    $(headSel).addEventListener('click', (e) => {
      const th = e.target.closest('[data-inssort]');
      if (!th) return;
      const key = th.dataset.inssort;
      const [cur, dir] = insState[stateKey];
      insState[stateKey] = [key, cur === key ? -dir : (key === 'name' ? 1 : -1)];
      render();
    });
  };
  wireSort('#ins-itemperf-head', 'itemSort', renderInsItemPerf);
  wireSort('#ins-custperf-head', 'custSort', renderInsCustPerf);
  wireSort('#ins-vendorperf-head', 'vendorSort', renderInsVendorPerf);
  $('#ins-itemperf-filter').addEventListener('input', (e) => {
    insState.itemFilter = e.target.value;
    renderInsItemPerf();
  });
  $('#ins-custperf-filter').addEventListener('input', (e) => {
    insState.custFilter = e.target.value;
    renderInsCustPerf();
  });
  $('#ins-vendorperf-filter').addEventListener('input', (e) => {
    insState.vendorFilter = e.target.value;
    renderInsVendorPerf();
  });

  // scorecard range — refetch the customer's numbers for the chosen window
  $('#ins-cust-range').addEventListener('change', () => {
    insState.custDays = safeInt($('#ins-cust-range').value);
    localStorage.setItem('ins_cust_days', String(insState.custDays));
    if (insState.custOpen) insLoadCustDetail(insState.custOpen);
  });

  // scorecard purchases: sortable columns + filter box
  $('#ins-cust-purchcols').addEventListener('click', (e) => {
    const th = e.target.closest('[data-inssort]');
    if (!th) return;
    const key = th.dataset.inssort;
    const [cur, dir] = insState.custPurchSort || ['ts', -1];
    insState.custPurchSort = [key, cur === key ? -dir : (INS_STR_COLS.has(key) ? 1 : -1)];
    renderInsCustPurchases();
  });
  $('#ins-cust-purchfilter').addEventListener('input', (e) => {
    insState.custPurchFilter = e.target.value;
    renderInsCustPurchases();
  });

  // customer scorecard dialog
  $('#ins-custperf-body').addEventListener('click', (e) => {
    const row = e.target.closest('[data-inscust]');
    if (row) openInsCustCard(row.dataset.inscust);
  });
  const custClose = () => { $('#ins-cust-modal').hidden = true; insState.custOpen = null; };
  $('#ins-cust-close').addEventListener('click', custClose);
  bindBackdropClose($('#ins-cust-modal'), custClose);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !$('#ins-cust-modal').hidden) custClose();
  });
  // copy feedback: the clicked button itself flashes "✓ Copied!"
  const copyFlash = (btn) => {
    if (btn._flashT) clearTimeout(btn._flashT);
    else btn._orig = btn.innerHTML;
    btn.innerHTML = '<i class="fa-solid fa-check"></i> Copied!';
    btn.classList.add('ins-copied');
    btn._flashT = setTimeout(() => {
      btn.innerHTML = btn._orig;
      btn.classList.remove('ins-copied');
      btn._flashT = null;
    }, 1200);
  };
  $('#ins-cust-copy').addEventListener('click', async (e) => {
    const b = insState.custOpen;
    if (!b) return;
    try {
      await navigator.clipboard.writeText(b.name);
      copyFlash(e.currentTarget);
    } catch (_) { toast('Clipboard copy failed', false); }
  });
  $('#ins-cust-sales').addEventListener('click', () => {
    const b = insState.custOpen;
    if (!b) return;
    custClose();
    insFilterSales(b.name);
  });
  $('#ins-cust-msgs').addEventListener('click', async (e) => {
    const b = insState.custOpen;
    if (!b) return;
    const copyBtn = e.target.closest('[data-custmsg]');
    if (copyBtn) {
      const tpl = (insState.custMsgs || [])[safeInt(copyBtn.dataset.custmsg)];
      if (!tpl) return;
      try {
        await navigator.clipboard.writeText(insMsgOut(tpl, b));
        copyFlash(copyBtn);
      } catch (_) { toast('Clipboard copy failed', false); }
      return;
    }
    if (e.target.closest('[data-msgtoggle]')) {
      const collapsed = $('#ins-cust-msgs').classList.toggle('collapsed');
      localStorage.setItem('ins_cust_msgs_collapsed', collapsed ? '1' : '0');
      return;
    }
    const modeBtn = e.target.closest('[data-msgmode]');
    if (modeBtn) {
      insState.custMsgMode = modeBtn.dataset.msgmode;
      localStorage.setItem('ins_cust_msg_mode', insState.custMsgMode); // sticky
      renderInsCustMsgs(b);
      return;
    }
    if (e.target.closest('[data-msgedit]')) { renderInsCustMsgs(b, true); return; }
    if (e.target.closest('[data-msgcancel]')) { renderInsCustMsgs(b); return; }
    if (e.target.closest('[data-msgdel]')) { e.target.closest('.ins-msgedit-row').remove(); return; }
    if (e.target.closest('[data-msgadd]')) {
      const rows = document.querySelectorAll('#ins-cust-msgs .ins-msgedit-row');
      if (rows.length >= 8) { toast('That\'s plenty of messages — 8 max', false); return; }
      const div = document.createElement('div');
      div.className = 'ins-msgedit-row';
      div.innerHTML = `
        <input type="text" class="form-control filter-input ins-msgedit-label" value=""
               placeholder="Button label" maxlength="24" spellcheck="false">
        <input type="text" class="form-control filter-input ins-msgedit-tpl" value=""
               placeholder="Message — {name} becomes their name" maxlength="240" spellcheck="false">
        <button type="button" class="btn btn-icon" data-msgdel title="Remove"><i class="fa-solid fa-xmark"></i></button>`;
      e.target.closest('.ins-msgedit').insertBefore(div, e.target.closest('.ins-msgedit-actions'));
      div.querySelector('.ins-msgedit-label').focus();
      return;
    }
    if (e.target.closest('[data-msgsave]')) {
      const msgs = [...document.querySelectorAll('#ins-cust-msgs .ins-msgedit-row')].map((row) => [
        row.querySelector('.ins-msgedit-label').value.trim(),
        row.querySelector('.ins-msgedit-tpl').value.trim(),
      ]).filter(([label, tpl]) => label && tpl);
      insState.custMsgs = msgs.length ? msgs : INS_CUST_MSGS_DEFAULT.map((m) => [...m]);
      try { await api().set_config('ins_cust_msgs', insState.custMsgs); } catch (_) {}
      toast('Quick messages saved');
      renderInsCustMsgs(b);
    }
  });
  ['#ins-itemperf-body', '#ins-vendorperf-body'].forEach((sel) => {
    $(sel).addEventListener('click', (e) => {
      const row = e.target.closest('[data-insjump]');
      if (row) insFilterSales(row.dataset.insjump);
    });
  });

  // pricing: filterable item combo + hover readout
  $('#ins-price-btn').addEventListener('click', () => {
    const menu = $('.ins-price-menu');
    if (!menu.hidden) { menu.hidden = true; return; }
    const r = $('#ins-price-btn').getBoundingClientRect();
    menu.style.left = `${r.left}px`;
    menu.style.top = `${r.bottom + 3}px`;
    menu.style.minWidth = `${Math.max(r.width, 380)}px`;
    menu.style.maxHeight = `${Math.min(420, window.innerHeight - r.bottom - 16)}px`;
    $('#ins-price-filter').value = '';
    insRenderPriceOpts();
    menu.hidden = false;
    $('#ins-price-filter').focus();
  });
  $('#ins-price-filter').addEventListener('input', () =>
    insRenderPriceOpts($('#ins-price-filter').value));
  $('#ins-price-filter').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = document.querySelector('#ins-price-opts [data-priceitem]');
      if (first) insPickPriceItem(first.dataset.priceitem);
    } else if (e.key === 'Escape') insClosePriceMenu();
  });
  $('#ins-price-opts').addEventListener('click', (e) => {
    const opt = e.target.closest('[data-priceitem]');
    if (opt) insPickPriceItem(opt.dataset.priceitem);
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#ins-price-combo')) insClosePriceMenu();
  });
  const priceCanvas = $('#ins-price-chart');
  if (priceCanvas) {
    priceCanvas.addEventListener('mousemove', insPriceHover);
    priceCanvas.addEventListener('mouseleave', () => { $('#ins-price-tip').hidden = true; });
  }
}
