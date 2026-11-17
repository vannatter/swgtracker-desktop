/* Price Guide — anonymous going rates from everyone's tracked sales
   (api/price_guide.php; the website's /prices.php mirrors this page).
   Server-built nightly from the last 90 days: an item only shows when at least
   3 different sellers back it, no one seller dominates, and prices are rounded —
   so nobody's own prices can be picked out. Prices are per unit; "usually ×25"
   is the stack size it sells in. Also: the quiet "below/above market" chip on
   My Inventory (pgInvChip), and the contribute-my-sales switch (Settings + the
   page footer, same server pref). */

const pgState = { items: [], total: 0, built: 0, open: null, detail: new Map(), seq: 0,
                  hints: null, hintsAt: 0, optout: null };

function pgPrice(v) { return `${fmtNum(Math.round(v))}`; }   // full credits — there's room, and 18k hides 18,450

function pgTrendHtml(t) {
  if (t === null || t === undefined) return '<span class="stat_off">—</span>';
  if (Math.abs(t) < 5) return '<span class="pg-trend pg-flat" title="Within 5% of the 60 days before">steady</span>';
  return `<span class="pg-trend ${t > 0 ? 'pg-up' : 'pg-down'}" title="Last 30 days against the 60 before">${t > 0 ? '▲' : '▼'} ${Math.abs(t)}%</span>`;
}

function pgRowHtml(it) {
  const open = pgState.open === it.key;
  return `<tr class="pg-row${open ? ' pg-open' : ''}" data-pgkey="${escapeHtml(it.key)}">
    <td class="col-name res-name">${escapeHtml(it.name)}</td>
    <td class="col-num pg-med">${pgPrice(it.median)}</td>
    <td class="col-num pg-range">${it.p25 === it.p75 ? pgPrice(it.p25) : `${pgPrice(it.p25)} – ${pgPrice(it.p75)}`}</td>
    <td class="col-num pg-qty">${it.qty > 1 ? `×${fmtNum(it.qty)}` : '<span class="stat_off">single</span>'}</td>
    <td class="col-num pg-sales">${fmtNum(it.sales)} <span class="pg-sellers">· ${fmtNum(it.sellers)} sellers</span></td>
    <td class="col-num pg-tr"><span class="pg-tr-wrap">${pgSparkLine(it)}${pgTrendHtml(it.trend)}</span></td>
  </tr>${open ? `<tr class="pg-detail-row"><td colspan="6">${pgDetailHtml(it)}</td></tr>` : ''}`;
}

// 12-week sparkline for a list row (weekly medians; gaps = weeks without enough
// different sellers). One ink, the last point marked in the trend's color.
function pgSparkLine(it) {
  const pts = (it.weekly || []).map((v, i) => [i, v]).filter(([, v]) => v !== null && v !== undefined);
  if (pts.length < 2) return '<span class="pg-sl pg-sl-empty"></span>';
  const W = 84, H = 22, n = Math.max(2, (it.weekly || []).length);
  const vs = pts.map(([, v]) => v), lo = Math.min(...vs), hi = Math.max(...vs), span = hi - lo || 1;
  const x = (i) => (i / (n - 1)) * (W - 4) + 2, y = (v) => H - 3 - ((v - lo) / span) * (H - 6);
  const d = pts.map(([i, v], k) => `${k ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('');
  const [li, lv] = pts[pts.length - 1];
  const cls = it.trend === null || it.trend === undefined || Math.abs(it.trend) < 5 ? 'pg-flat' : it.trend > 0 ? 'pg-up' : 'pg-down';
  return `<svg class="pg-sl" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" aria-hidden="true">
    <title>Going rate, last ${n} weeks: ${pgPrice(lo)} – ${pgPrice(hi)}</title>
    <path d="${d}" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round"/>
    <circle class="${cls}" cx="${x(li).toFixed(1)}" cy="${y(lv).toFixed(1)}" r="2.6"/></svg>`;
}

// the opened row: weekly going rate as a line, the typical range shaded behind it
function pgWeeklyChart(it, weekly) {
  const all = weekly || [];
  const pts = all.map((v, i) => [i, v]).filter(([, v]) => v !== null && v !== undefined);
  if (pts.length < 2) return `<div class="pg-spark-empty">${pts.length
    ? `Only one week had enough different sellers to price it on its own (${pgPrice(pts[0][1])} cr) — a chart needs two.`
    : 'Not enough different sellers in any single week to chart it yet.'}</div>`;
  const W = 520, H = 150, L = 8, R = 8, T = 12, B = 22, n = Math.max(2, all.length);
  const vs = pts.map(([, v]) => v).concat([it.p25, it.p75]);
  let lo = Math.min(...vs), hi = Math.max(...vs);
  const pad = (hi - lo) * 0.12 || hi * 0.1 || 1; lo = Math.max(0, lo - pad); hi += pad;
  const x = (i) => L + (i / (n - 1)) * (W - L - R), y = (v) => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const band = `<rect class="pg-ch-band" x="${L}" width="${W - L - R}" y="${y(it.p75).toFixed(1)}" height="${Math.max(1, y(it.p25) - y(it.p75)).toFixed(1)}"/>
    <line class="pg-ch-med" x1="${L}" x2="${W - R}" y1="${y(it.median).toFixed(1)}" y2="${y(it.median).toFixed(1)}"/>`;
  // a broken line across missing weeks, so a gap reads as "no data", not a slope
  let d = '', prev = -2;
  for (const [i, v] of pts) { d += `${i === prev + 1 ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`; prev = i; }
  const dots = pts.map(([i, v]) => {
    const ago = n - 1 - i;
    return `<circle class="pg-ch-dot" cx="${x(i).toFixed(1)}" cy="${y(v).toFixed(1)}" r="4"><title>${ago === 0 ? 'This week' : ago === 1 ? 'Last week' : `${ago} weeks ago`}: ${pgPrice(v)} cr</title></circle>`;
  }).join('');
  const labels = [0, Math.floor((n - 1) / 2), n - 1].map((i) => {
    const ago = n - 1 - i;
    return `<text class="pg-ch-lbl" x="${x(i).toFixed(1)}" y="${H - 6}" text-anchor="${i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle'}">${ago ? `${ago} wk ago` : 'this week'}</text>`;
  }).join('');
  return `<svg class="pg-ch" viewBox="0 0 ${W} ${H}" role="img" aria-label="Going rate each week">
      ${band}<path class="pg-ch-line" d="${d}"/>${dots}${labels}</svg>
    <div class="pg-ch-key"><span class="pg-ch-key-line"></span> going rate each week
      <span class="pg-ch-key-band"></span> typical range (${pgPrice(it.p25)} – ${pgPrice(it.p75)} cr)</div>`;
}

function pgDetailHtml(it) {
  const d = pgState.detail.get(it.key);
  const weekly = it.weekly || (d && d.weekly);
  const each = it.qty > 1 ? ` each, usually sold ${fmtNum(it.qty)} at a time (≈ ${pgPrice(it.median * it.qty)} cr a stack)` : ' each';
  return `<div class="pg-detail">
    <div class="pg-detail-text">Most sell for about <b>${pgPrice(it.median)} cr</b>${each}; the middle half go for ${pgPrice(it.p25)} – ${pgPrice(it.p75)} cr.
      Based on ${fmtNum(it.sales)} sales from ${fmtNum(it.sellers)} different sellers in the last 90 days, last one ${fmtAgoTip(it.last_sale)}.</div>
    <div class="pg-weekly">${weekly ? pgWeeklyChart(it, weekly) : '<span class="spinner"></span>'}</div>
  </div>`;
}

// ---- market at a glance (above the list; hidden while searching) ----
function pgGlanceHtml(items) {
  const list = (title, icon, rows, right, tip) => `<div class="pg-gl-card"><h3><i class="fa-solid ${icon}"></i> ${title}</h3>${rows.length
    ? rows.map((it) => `<div class="pg-gl-row" data-pgopen="${escapeHtml(it.key)}" title="${escapeHtml(tip(it))}"><span class="pg-gl-name">${escapeHtml(it.name)}</span>${right(it)}</div>`).join('')
    : '<div class="pg-spark-empty">Nothing yet.</div>'}</div>`;
  const traded = [...items].sort((a, b) => b.sales - a.sales).slice(0, 6);
  const maxS = Math.max(1, ...traded.map((it) => it.sales));
  const moved = items.filter((it) => it.trend !== null && it.trend !== undefined && it.sales >= 10);
  const rising = moved.filter((it) => it.trend >= 5).sort((a, b) => b.trend - a.trend).slice(0, 6);
  const falling = moved.filter((it) => it.trend <= -5).sort((a, b) => a.trend - b.trend).slice(0, 6);
  return list('Most traded', 'fa-chart-simple', traded,
    (it) => `<span class="pg-gl-bar"><span style="width:${((it.sales / maxS) * 100).toFixed(1)}%"></span></span><span class="pg-gl-val">${fmtNum(it.sales)}</span>`,
    (it) => `${fmtNum(it.sales)} sales from ${fmtNum(it.sellers)} sellers in 90 days · going rate ${pgPrice(it.median)} cr`)
    + list('Rising', 'fa-arrow-trend-up', rising,
      (it) => `${pgSparkLine(it)}<span class="pg-gl-val pg-up">▲ ${it.trend}%</span>`,
      (it) => `Going rate ${pgPrice(it.median)} cr — up ${it.trend}% on the 60 days before`)
    + list('Falling', 'fa-arrow-trend-down', falling,
      (it) => `${pgSparkLine(it)}<span class="pg-gl-val pg-down">▼ ${-it.trend}%</span>`,
      (it) => `Going rate ${pgPrice(it.median)} cr — down ${-it.trend}% on the 60 days before`);
}

function renderPriceGuide() {
  const gl = $('#pg-glance');
  if (gl) {
    const show = !$('#pg-search').value.trim() && pgState.items.length >= 6;
    gl.hidden = !show;
    if (show) gl.innerHTML = pgGlanceHtml(pgState.items);
  }
  const body = $('#pg-body');
  body.innerHTML = pgState.items.map(pgRowHtml).join('');
  const empty = $('#pg-empty');
  empty.hidden = pgState.items.length > 0;
  if (!pgState.items.length) {
    empty.textContent = $('#pg-search').value.trim()
      ? 'Nothing in the guide matches — an item only shows once enough different sellers have sold it.'
      : 'The guide is empty right now.';
  }
  $('#pg-status').textContent = pgState.items.length
    ? `${fmtNum(pgState.items.length)} of ${fmtNum(pgState.total)} items${pgState.built ? ` · updated ${fmtAgo(pgState.built)}` : ''}`
    : '';
}

async function loadPriceGuide() {
  const seq = ++pgState.seq;
  $('#pg-loading').hidden = false;
  let res;
  try {
    res = await apiFetch('GET', 'api/price_guide.php', { params: { q: $('#pg-search').value.trim(), sort: $('#pg-sort').value, limit: 200 } });
  } catch (e) { res = { ok: false, error: String(e) }; }
  if (seq !== pgState.seq) return;   // a newer search won
  $('#pg-loading').hidden = true;
  if (!res.ok || !res.data || !Array.isArray(res.data.items)) {
    $('#pg-body').innerHTML = '';
    const empty = $('#pg-empty');
    empty.textContent = /404|not found/i.test(String(res.error || '')) ? 'The price guide needs the latest swgtracker.com update.' : `Error: ${res.error || 'failed to load'}`;
    empty.hidden = false;
    return;
  }
  pgState.items = res.data.items;
  pgState.total = safeInt(res.data.total);
  pgState.built = safeInt(res.data.built);
  renderPriceGuide();
  // opened from an Inventory chip: fetch that item's detail too
  if (pgState.open && !pgState.detail.has(pgState.open)) { const k = pgState.open; pgState.open = null; pgToggleRow(k); }
  pgLoadOptout();
}

async function pgToggleRow(key) {
  pgState.open = pgState.open === key ? null : key;
  renderPriceGuide();
  if (!pgState.open || pgState.detail.has(key)) return;
  let res;
  try { res = await apiFetch('GET', 'api/price_guide.php', { params: { item: key } }); } catch (e) { res = { ok: false }; }
  pgState.detail.set(key, res.ok && res.data && res.data.item ? res.data.item : { weekly: [] });
  if (pgState.open === key) renderPriceGuide();
}

// ---- contribute my sales (server pref; Settings + page footer) ---------------
function pgPaintOptout() {
  const on = pgState.optout === null ? null : !pgState.optout;
  for (const id of ['#pg-contrib', '#set-pg-contrib']) {
    const el = $(id);
    if (!el) continue;
    el.disabled = on === null;
    if (on !== null) el.checked = on;
  }
}

async function pgLoadOptout() {
  let res;
  try { res = await apiFetch('GET', 'api/price_guide.php', { params: { optout: 1 } }); } catch (e) { res = { ok: false }; }
  if (res.ok && res.data && typeof res.data.optout === 'boolean') pgState.optout = res.data.optout;
  pgPaintOptout();
}

async function pgSaveOptout(contribute) {
  let res;
  try { res = await apiFetch('POST', 'api/price_guide.php', { data: { action: 'optout', value: contribute ? 0 : 1 } }); } catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok || !res.data) { toast(res.error || 'Couldn’t save that', false); pgPaintOptout(); return; }
  pgState.optout = !!res.data.optout;
  pgPaintOptout();
  toast(pgState.optout ? 'Your sales will be left out of the price guide from the next nightly update'
                       : 'Your sales count toward the price guide again from the next nightly update');
}

// ---- My Inventory: quiet "below / above market" chip -------------------------
// Only for items priced well off a tight market (the server decides — see ?mine=1).
function pgInvChip(item) {
  const h = pgState.hints && pgState.hints.get(String(item.id));
  if (!h) return '';
  const low = h.verdict === 'low';
  const unit = h.qty > 1 ? ' each' : '';
  const tip = `${low ? 'Below' : 'Above'} the going rate — you usually get ${pgPrice(h.yours)}${unit}; most sell for ${pgPrice(h.median)}${unit} (middle half ${pgPrice(h.p25)}–${pgPrice(h.p75)}). From the Price Guide.`;
  // an icon, not a word chip: it must not wrap the name onto a second line
  return ` <i class="fa-solid ${low ? 'fa-scale-unbalanced' : 'fa-scale-unbalanced-flip'} pg-chip ${low ? 'pg-chip-low' : 'pg-chip-high'}" data-pgchip="${escapeHtml(h.key)}" title="${escapeHtml(tip + ' Click to open it.')}" aria-label="${low ? 'Below' : 'Above'} market"></i>`;
}

async function pgInvHints() {
  if (Date.now() - pgState.hintsAt < 10 * 60 * 1000) return;   // a nightly build — no need to refetch every repaint
  pgState.hintsAt = Date.now();
  let res;
  try { res = await apiFetch('GET', 'api/price_guide.php', { params: { mine: 1 } }); } catch (e) { res = { ok: false }; }
  if (!res.ok || !res.data || !Array.isArray(res.data.hints)) return;   // older site / offline: no chips, nothing else changes
  const before = pgState.hints ? pgState.hints.size : 0;
  pgState.hints = new Map(res.data.hints.map((h) => [String(h.inventory_id), h]));
  if ((pgState.hints.size || before) && typeof renderInvRows === 'function') renderInvRows();
}

function initPriceGuide() {
  let t = null;
  $('#pg-search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(loadPriceGuide, 300); });
  $('#pg-sort').addEventListener('change', loadPriceGuide);
  $('#pg-glance').addEventListener('click', (e) => {
    const r = e.target.closest('[data-pgopen]');
    if (!r) return;
    pgToggleRow(r.dataset.pgopen);
    requestAnimationFrame(() => {
      const row = document.querySelector(`#pg-body tr[data-pgkey="${CSS.escape(r.dataset.pgopen)}"]`);
      if (row) row.scrollIntoView({ block: 'center', behavior: 'smooth' });
    });
  });
  $('#pg-body').addEventListener('click', (e) => {
    const row = e.target.closest('tr.pg-row');
    if (row) pgToggleRow(row.dataset.pgkey);
  });
  for (const id of ['#pg-contrib', '#set-pg-contrib']) {
    const el = $(id);
    if (el) el.addEventListener('change', () => pgSaveOptout(el.checked));
  }
  // My Inventory: a chip click opens the guide on that item
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-pgchip]');
    if (!chip) return;
    e.stopPropagation();
    const h = [...(pgState.hints || new Map()).values()].find((x) => x.key === chip.dataset.pgchip);
    $('#pg-search').value = h ? h.name : chip.dataset.pgchip;
    pgState.open = chip.dataset.pgchip;
    showPage('prices');
    loadPriceGuide();   // showPage only loads a page on its first visit; the seq guard drops a duplicate
  }, true);
  setTimeout(pgLoadOptout, 4000);   // Settings' switch shows the saved state without its own hook
}
