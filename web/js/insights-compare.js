/* Sales Insights — compare to the previous period + this month's projection.
   Reads the `compare` key of api/sales.php?action=stats (includes/insights_compare.php):
   each KPI tile gets a ▲/▼ against the equal-length window just before, the
   revenue trend can overlay that window as a faint dashed line, and a strip
   under the tiles projects the current calendar month at the last 28 days'
   pace. Loaded after insights.js; wraps renderInsKpis and answers the trend
   chart's overlay hooks (insCompareOverlayVals / Draw / PriorTip). */

insState.cmpOverlay = (() => {
  try { return localStorage.getItem('insCmpOverlay') !== '0'; } catch (_) { return true; }
})();

const insCmpWindow = () => (insState.days ? `prior ${insState.days} days` : '');

// ▲ 12% / ▼ 8% against the earlier window; tone 'good' colors up green and down
// red, 'neutral' keeps both muted (a lower average sale isn't necessarily bad)
function insCmpDelta(cur, prev, tone, p) {
  const span = insCmpWindow();
  const range = `${fmtDate(p.since).split(',')[0]} – ${fmtDate(p.until).split(',')[0]}`;
  if (prev <= 0) {
    return cur > 0
      ? `<span class="stat_off" title="${escapeHtml(range)}">nothing in the ${escapeHtml(span)}</span>` : '';
  }
  const pct = Math.round((cur / prev - 1) * 100);
  const partial = p.partial
    ? ` title="Tracking started ${escapeHtml(fmtDate(p.first_sale).split(',')[0])}, partway into the ${escapeHtml(span)} (${escapeHtml(range)}) — so this overstates the change"`
    : ` title="vs ${fmtShort(prev)} over ${escapeHtml(range)}"`;
  const arrow = pct === 0 ? '±0%' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%`;
  const cls = pct === 0 || tone === 'neutral' || p.partial ? 'stat_off' : pct > 0 ? 'ins-up' : 'ins-down';
  return `<span class="${cls}"${partial}>${arrow}</span> <span class="ins-kpi-vs">${p.partial ? `vs prior ${insState.days}d · partial` : `vs ${escapeHtml(span)}`}</span>`;
}

function insCmpKpis(data) {
  const p = data?.compare?.prior;
  const k = data?.kpis || {};
  const tiles = $('#ins-kpis') ? [...$('#ins-kpis').querySelectorAll('.ins-kpi')] : [];
  if (p) {
    const was = p.busiest_hour?.hour != null ? `was ${insHourLabel(p.busiest_hour.hour)}` : '';
    const spec = {
      'Revenue':   () => insCmpDelta(safeInt(k.total_revenue), safeInt(p.total_revenue), 'good', p),
      'Sales':     () => insCmpDelta(safeInt(k.total_sales), safeInt(p.total_sales), 'good', p),
      'Avg sale':  () => insCmpDelta(safeInt(k.avg_sale), safeInt(p.avg_sale), 'neutral', p),
      'Customers': () => insCmpDelta(safeInt(k.unique_buyers), safeInt(p.unique_buyers), 'good', p),
      'Best day':  () => insCmpDelta(safeInt(k.best_day?.total), safeInt(p.best_day), 'good', p),
      'Peak hour': () => (was && p.busiest_hour.hour !== k.busiest_hour?.hour
        ? `<span class="stat_off">${was}</span> <span class="ins-kpi-vs">in the ${escapeHtml(insCmpWindow())}</span>`
        : was ? `<span class="stat_off">same as the ${escapeHtml(insCmpWindow())}</span>` : ''),
    };
    tiles.forEach((t) => {
      const fn = spec[t.querySelector('.ins-kpi-label')?.textContent.trim()];
      const html = fn ? fn() : '';
      if (html) t.insertAdjacentHTML('beforeend', `<div class="ins-kpi-delta">${html}</div>`);
    });
  }
  insCmpProjection(data?.compare?.month);
  insCmpToggle(!!p);
}

// "November projection ≈ 56m" — month so far plus the days left at the last
// 28 full days' pace, against last month's total
function insCmpProjection(m) {
  let el = $('#ins-proj');
  if (!m) { if (el) el.hidden = true; return; }
  if (!el) {
    $('#ins-kpis').insertAdjacentHTML('afterend', '<div class="ins-proj" id="ins-proj"></div>');
    el = $('#ins-proj');
  }
  const vsLast = safeInt(m.last_month) > 0
    ? (() => {
        const pct = Math.round((safeInt(m.projected) / safeInt(m.last_month) - 1) * 100);
        const cls = pct > 0 ? 'ins-up' : pct < 0 ? 'ins-down' : 'stat_off';
        return ` <span class="${cls}">${pct === 0 ? '±0%' : `${pct > 0 ? '▲' : '▼'} ${Math.abs(pct)}%`}</span>`;
      })()
    : '';
  el.hidden = false;
  el.title = `A projection, not a promise: ${fmtNum(m.so_far)} so far this month plus ${m.days_left} more days at `
    + `${fmtNum(m.pace_per_day)}/day — your average over the last ${m.pace_days} full days`;
  el.innerHTML = `<i class="fa-solid fa-chart-line"></i>
    <span class="ins-proj-main">${escapeHtml(m.label)} projection <b>≈ ${fmtShort(m.projected)}</b></span>
    <span class="ins-proj-part">${fmtShort(m.so_far)} so far · ~${fmtShort(m.pace_per_day)}/day at your last-${m.pace_days}-day pace</span>
    ${safeInt(m.last_month) > 0 ? `<span class="ins-proj-part">${escapeHtml(m.last_label)}: ${fmtShort(m.last_month)}${vsLast}</span>` : ''}`;
}

// "vs prior" on/off beside Per period / Cumulative — hidden for all-time
function insCmpToggle(available) {
  let btn = $('#ins-cmp-toggle');
  if (!btn) {
    const seg = $('#ins-trend-mode');
    if (!seg) return;
    seg.insertAdjacentHTML('beforebegin',
      '<div class="ins-seg ins-cmp-seg"><button type="button" id="ins-cmp-toggle" title="Overlay the previous period as a dashed line">vs prior</button></div>');
    btn = $('#ins-cmp-toggle');
    btn.addEventListener('click', () => {
      insState.cmpOverlay = !insState.cmpOverlay;
      try { localStorage.setItem('insCmpOverlay', insState.cmpOverlay ? '1' : '0'); } catch (_) { /* ignore */ }
      btn.classList.toggle('active', insState.cmpOverlay);
      if (insState.data) drawInsTrend(insState.data.trend, insState.data.weekly);
    });
  }
  btn.parentElement.hidden = !available;
  btn.classList.toggle('active', insState.cmpOverlay);
}

// ---- trend chart hooks (called from drawInsTrend / insTrendHover) ----------

function insCompareOverlayVals(cumulative) {
  const pt = insState.data?.compare?.prior_trend;
  if (!insState.cmpOverlay || !Array.isArray(pt) || !insState.days) return [];
  if (!cumulative) return pt.map(safeInt);
  let run = 0;
  return pt.map((v) => (run += safeInt(v)));
}

function insCompareOverlayDraw(ctx, x, y, cumulative) {
  const vals = insCompareOverlayVals(cumulative);
  if (vals.length < 2) return;
  ctx.save();
  ctx.beginPath();
  vals.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(0), y(v))));
  ctx.setLineDash([4, 3]);
  ctx.strokeStyle = 'rgba(255,255,255,.28)'; ctx.lineWidth = 1.25;
  ctx.lineJoin = 'round'; ctx.stroke();
  ctx.restore();
}

function insComparePriorTip(best) {
  const vals = insCompareOverlayVals(best.cumulative);
  const i = (insState.trendPts || []).indexOf(best);
  if (!vals.length || i < 0 || vals[i] === undefined) return '';
  return `<br><span class="stat_off">${escapeHtml(insCmpWindow())}: ${fmtNum(vals[i])}</span>`;
}

// renderInsKpis is a plain global — chain onto it so the tiles pick up deltas
// whenever insights.js redraws them
{
  const base = renderInsKpis;
  renderInsKpis = function (k, data) { base(k, data); insCmpKpis(data); };
}
