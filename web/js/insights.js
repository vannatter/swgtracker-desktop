/* Sales Insights page — analytics over your uploaded sales.
   Pulls one aggregated payload from api/sales.php?action=stats (bundle-only, via
   the gateway) and renders KPIs, a revenue trend, a buy-time heatmap, and the
   top items / customers / vendors. All charting is hand-drawn (canvas + CSS) to
   match the server-pulse sparkline — no external chart library. */

const DOW_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const DOW_SHORT = ['S', 'M', 'T', 'W', 'T', 'F', 'S'];

const insState = { days: 90, data: null };

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
  });
}
