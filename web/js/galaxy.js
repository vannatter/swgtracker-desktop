/* Galaxy — server-wide data views ported from the website: Cities, Guilds,
   Wealth, GCW, Professions, Titles. All read-only, all from public endpoints
   on swgtracker.com (api/cities.php, guilds.php, wealth.php, gcw.php,
   professions.php, titles.php) via the generic apiFetch gateway. */

// ---- shared helpers ----
const gxNum = (n) => Number(n || 0).toLocaleString();
// compact credits for cramped axis labels: 1.2B / 465M / 12K
function gxCompact(n) {
  const v = Number(n) || 0, a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(a >= 1e10 ? 0 : 1) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(a >= 1e7 ? 0 : 1) + 'M';
  if (a >= 1e3) return (v / 1e3).toFixed(a >= 1e4 ? 0 : 1) + 'K';
  return String(Math.round(v));
}
// downsample an array to at most `max` evenly-spaced points (keeps endpoints)
function gxDownsample(arr, max = 80) {
  const n = arr.length;
  if (n <= max) return arr.slice();
  const out = [];
  for (let i = 0; i < max; i++) out.push(arr[Math.floor(i * (n - 1) / (max - 1))]);
  return out;
}
function gxAgo(ts) {
  if (!ts) return '';
  const s = Math.floor(Date.now() / 1000 - Number(ts));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30); return mo < 12 ? `${mo}mo ago` : `${Math.floor(mo / 12)}y ago`;
}
function gxUpdated(sel, ts) {
  const el = $(sel);
  if (el) el.textContent = ts ? `updated ${gxAgo(ts)}` : '';
}
// tiny inline-SVG sparkline from an array of numbers
function gxSpark(vals, { w = 260, h = 44, color = 'var(--accent)', fill = false } = {}) {
  const nums = (vals || []).map(Number).filter((n) => !Number.isNaN(n));
  if (nums.length < 2) return '';
  const min = Math.min(...nums), max = Math.max(...nums), span = (max - min) || 1;
  const pts = nums.map((v, i) => {
    const x = (i / (nums.length - 1)) * (w - 2) + 1;
    const y = h - 1 - ((v - min) / span) * (h - 2);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  const area = fill ? `<polygon points="1,${h} ${pts.join(' ')} ${w - 1},${h}" fill="${color}" opacity="0.12"/>` : '';
  return `<svg class="gx-spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" width="100%" height="${h}">
    ${area}<polyline points="${pts.join(' ')}" fill="none" stroke="${color}" stroke-width="1.5" stroke-linejoin="round"/></svg>`;
}
// multi-series inline-SVG line chart with y-axis labels, gridlines, legend, and
// hover (vertical cursor + value tooltip). `opts.w` should be the container's
// pixel width so the viewBox matches 1:1 and text/strokes aren't upscaled.
function gxLineChart(series, opts = {}) {
  const w = Math.max(280, opts.w || 580), h = opts.h || 200, padL = 46, padR = 10, padT = 10, padB = 6;
  const all = series.flatMap((s) => (s.values || []).map(Number).filter((v) => !Number.isNaN(v)));
  if (all.length < 2) return '<div class="settings-sub">not enough history yet</div>';
  let min = Math.min(...all), max = Math.max(...all);
  if (min === max) { min = Math.max(0, min - 1); max += 1; }
  const span = (max - min) || 1;
  const iw = w - padL - padR, ih = h - padT - padB;
  const n = Math.max(...series.map((s) => (s.values || []).length));
  const xAt = (i) => padL + (n <= 1 ? 0 : (i / (n - 1)) * iw);
  // invert flips the axis (used by the rank "bump" chart so #1 sits at the top)
  const yAt = (v) => opts.invert
    ? padT + ((v - min) / span) * ih
    : padT + ih - ((v - min) / span) * ih;
  const ticks = 4;
  let grid = '';
  for (let t = 0; t <= ticks; t++) {
    const val = min + (span * t / ticks);
    const yy = yAt(val);
    grid += `<line x1="${padL}" y1="${yy.toFixed(1)}" x2="${w - padR}" y2="${yy.toFixed(1)}" class="gx-grid"/>`;
    const yl = opts.yFormat ? opts.yFormat(val) : Math.round(val).toLocaleString();
    grid += `<text x="${padL - 6}" y="${(yy + 3).toFixed(1)}" class="gx-ylabel">${yl}</text>`;
  }
  const paths = series.map((s) => {
    const pts = (s.values || []).map((v, i) => (v == null || Number.isNaN(Number(v))) ? null : `${xAt(i).toFixed(1)},${yAt(Number(v)).toFixed(1)}`).filter(Boolean);
    if (pts.length < 2) return '';
    const area = s.fill ? `<polygon points="${padL},${h - padB} ${pts.join(' ')} ${(w - padR).toFixed(1)},${h - padB}" fill="${s.color}" opacity="0.1"/>` : '';
    return `${area}<polyline points="${pts.join(' ')}" fill="none" stroke="${s.color}" stroke-width="1.6" stroke-linejoin="round"/>`;
  }).join('');
  const legend = series.filter((s) => s.name).map((s) => `<span class="gx-legend-item"><span class="gx-legend-sw" style="background:${s.color}"></span>${escapeHtml(s.name)}</span>`).join('');
  const meta = { w, h, padL, padR, padT, padB, min, max, n, labels: opts.labels || [], series: series.map((s) => ({ name: s.name || '', color: s.color, values: s.values || [] })) };
  return `${legend ? `<div class="gx-legend">${legend}</div>` : ''}<div class="gx-chartwrap">
    <svg class="gx-linechart" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none" data-gxmeta='${escapeHtml(JSON.stringify(meta))}'>
      ${grid}${paths}
      <line class="gx-cursor" x1="0" y1="${padT}" x2="0" y2="${h - padB}" style="display:none"/>
    </svg>
    <div class="gx-tip" hidden></div>
  </div>`;
}
// one delegated hover handler for every line chart
let gxChartHoverWired = false;
function gxInitChartHover() {
  if (gxChartHoverWired) return;
  gxChartHoverWired = true;
  document.addEventListener('mousemove', (e) => {
    const svg = e.target.closest ? e.target.closest('.gx-linechart') : null;
    if (!svg || !svg.dataset.gxmeta) return;
    let m; try { m = JSON.parse(svg.dataset.gxmeta); } catch (_) { return; }
    const rect = svg.getBoundingClientRect();
    const scale = rect.width / m.w;
    const vx = (e.clientX - rect.left) / scale;
    const iw = m.w - m.padL - m.padR, ih = m.h - m.padT - m.padB;
    const frac = Math.min(1, Math.max(0, (vx - m.padL) / (iw || 1)));
    const idx = Math.round(frac * (m.n - 1));
    const cx = m.padL + (m.n <= 1 ? 0 : (idx / (m.n - 1)) * iw);
    const cursor = svg.querySelector('.gx-cursor');
    if (cursor) { cursor.setAttribute('x1', cx); cursor.setAttribute('x2', cx); cursor.style.display = ''; }
    const wrap = svg.closest('.gx-chartwrap'); const tip = wrap && wrap.querySelector('.gx-tip');
    if (!tip) return;
    const lines = m.series.filter((s) => s.values[idx] != null && !Number.isNaN(Number(s.values[idx])))
      .map((s) => `<span class="gx-tip-row"><span class="gx-tip-sw" style="background:${s.color}"></span>${s.name ? escapeHtml(s.name) + ' ' : ''}<b>${Number(s.values[idx]).toLocaleString()}</b></span>`).join('');
    tip.innerHTML = `${m.labels[idx] ? `<div class="gx-tip-label">${escapeHtml(m.labels[idx])}</div>` : ''}${lines}`;
    tip.hidden = false;
    // follow the mouse (offset to the bottom-right, flipped near the right edge)
    const wrapRect = wrap.getBoundingClientRect();
    let tx = e.clientX - wrapRect.left + 14;
    let ty = e.clientY - wrapRect.top + 14;
    if (tx + tip.offsetWidth > wrapRect.width - 2) tx = e.clientX - wrapRect.left - tip.offsetWidth - 14;
    if (ty + tip.offsetHeight > wrapRect.height - 2) ty = e.clientY - wrapRect.top - tip.offsetHeight - 14;
    tip.style.left = `${Math.max(0, tx)}px`;
    tip.style.top = `${Math.max(0, ty)}px`;
  });
  document.addEventListener('mouseout', (e) => {
    const svg = e.target.closest ? e.target.closest('.gx-linechart') : null;
    if (!svg) return;
    const wrap = svg.closest('.gx-chartwrap');
    if (wrap && !wrap.contains(e.relatedTarget)) {
      const c = svg.querySelector('.gx-cursor'); if (c) c.style.display = 'none';
      const t = wrap.querySelector('.gx-tip'); if (t) t.hidden = true;
    }
  });
}

function gxSortClick(state, headSel, rerender) {
  $(headSel).addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const f = th.dataset.sort;
    if (state.sortField === f) state.sortOrder = state.sortOrder === 'ASC' ? 'DESC' : 'ASC';
    else { state.sortField = f; state.sortOrder = 'DESC'; }
    rerender();
  });
}
function gxSortRows(rows, field, order, numeric) {
  const dir = order === 'ASC' ? 1 : -1;
  return [...rows].sort((a, b) => numeric.has(field)
    ? dir * (safeInt(a[field]) - safeInt(b[field]))
    : dir * String(a[field] ?? '').toLowerCase().localeCompare(String(b[field] ?? '').toLowerCase()));
}

// ---- pins (favorite a city/guild to float it to the top; config-backed) ----
const gxPins = { cities: new Set(), guilds: new Set() };
function gxCityKey(c) { return `${c.name}|${c.planet}`; }
function gxGuildKey(g) { return String(g.abbrev || g.name); }
async function gxLoadPins() {
  try { const p = JSON.parse(localStorage.getItem('galaxy_pins') || 'null'); if (p) { gxPins.cities = new Set(p.cities || []); gxPins.guilds = new Set(p.guilds || []); } } catch (_) { /* ignore */ }
  try {
    const cfg = await api().get_config();
    const p = cfg && cfg.ok && cfg.data && cfg.data.galaxy_pins;
    if (p) {
      gxPins.cities = new Set(p.cities || []); gxPins.guilds = new Set(p.guilds || []);
      if (citiesState.loaded) renderCities();
      if (guildsState.loaded) renderGuilds();
    }
  } catch (_) { /* localStorage stands */ }
}
function gxSavePins() {
  const p = { cities: [...gxPins.cities], guilds: [...gxPins.guilds] };
  try { localStorage.setItem('galaxy_pins', JSON.stringify(p)); } catch (_) { /* ignore */ }
  try { api().set_config('galaxy_pins', p); } catch (_) { /* ignore */ }
}
function gxPinFirst(rows, pinSet, keyFn) {
  const pinned = rows.filter((r) => pinSet.has(keyFn(r)));
  const rest = rows.filter((r) => !pinSet.has(keyFn(r)));
  return [...pinned, ...rest];
}
function gxPinCell(kind, key, pinned) {
  return `<td class="pin-cell"><i class="fa-solid fa-thumbtack gx-pin ${pinned ? 'pinned-star' : ''}" data-gxpin="${escapeHtml(key)}" data-gxkind="${kind}" title="${pinned ? 'Unpin' : 'Pin to top'}"></i></td>`;
}

// ---- city/guild detail modal with history sparklines ----
async function openGxDetail(kind, item) {
  const modal = $('#gx-detail-modal'); const body = $('#gx-detail-body');
  $('#gx-detail-title').textContent = kind === 'city'
    ? `${item.name} — ${item.planet}`
    : `${item.name}${item.abbrev ? ` [${item.abbrev}]` : ''}`;
  body.innerHTML = '<div class="settings-sub">Loading history…</div>';
  modal.hidden = false;
  const ep = kind === 'city'
    ? `api/city_history.php?name=${encodeURIComponent(item.name)}&planet=${encodeURIComponent(item.planet)}`
    : `api/guild_history.php?abbrev=${encodeURIComponent(item.abbrev)}`;
  let res;
  try { res = await apiFetch('GET', ep); } catch (e) { res = { ok: false }; }
  if (!res.ok || !res.data || res.data.error) { body.innerHTML = '<div class="settings-sub">Could not load history.</div>'; return; }
  if (kind === 'city') renderCityDetail(body, res.data, item); else renderGuildDetail(body, res.data, item);
}
function gxDStat(label, val, small) {
  return `<div class="gx-dstat"><div class="gx-dstat-l">${escapeHtml(label)}</div><div class="gx-dstat-v ${small ? 'gx-dstat-sm' : ''}">${val}</div></div>`;
}
function renderCityDetail(body, d, item) {
  const h = d.history || []; const s = d.stats || {}; const c = Object.assign({}, item, d.city || {});
  const cit = h.map((x) => x.citizens); const act = h.map((x) => x.active);
  const lastChange = act.length >= 2 ? act[act.length - 1] - act[act.length - 2] : null;
  const netGrowth = act.length >= 2 ? act[act.length - 1] - act[0] : null;
  const chart = gxLineChart([
    { values: cit, color: '#5b9bd5', name: 'Citizens' },
    { values: act, color: '#e24350', fill: true, name: 'Active' },
  ], { h: 150, w: 980, labels: h.map((x) => x.label) });
  const recent = h.slice(-12).reverse();
  const rows = recent.map((r) => `<tr><td>${escapeHtml(r.label)}</td><td class="col-num">${gxNum(r.citizens)}</td><td class="col-num">${gxNum(r.active)}</td><td class="col-num">${r.level ?? '—'}</td></tr>`).join('');
  body.innerHTML = `
    <div class="gx-detail-stats gx-detail-stats-8">
      ${gxDStat('Mayor', escapeHtml(c.mayor || '—'), true)}
      ${gxDStat('Faction', escapeHtml(c.faction || 'None'), true)}
      ${gxDStat('Citizens', gxNum(c.citizens))}
      ${gxDStat('Active', gxNum(c.active_citizens))}
      ${gxDStat('Peak citizens', gxNum(s.peak_citizens))}
      ${gxDStat('Peak active', gxNum(s.peak_active))}
      ${gxDStat('Last change', gxDelta(lastChange))}
      ${gxDStat('Net growth', gxDelta(netGrowth))}
    </div>
    ${c.specializations ? `<div class="gx-badges"><span class="gx-badge">${escapeHtml(c.specializations)}</span></div>` : ''}
    <div class="gx-chart">${chart}</div>
    <div class="gx-rechist">
      <div class="gx-chart-h">Record history</div>
      <table class="data-grid gx-rechist-table"><thead><tr><th>When</th><th class="col-num">Citizens</th><th class="col-num">Active</th><th class="col-num">Level</th></tr></thead><tbody>${rows}</tbody></table>
    </div>
    ${item.waypoint ? `<div class="gx-detail-foot"><span class="gx-wp" data-gxcopy="${escapeHtml(item.waypoint)}" title="Copy waypoint"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(item.waypoint)}</span></div>` : ''}`;
}
function gxDelta(n) {
  if (n == null) return '<span class="gx-muted">—</span>';
  if (n === 0) return '<span class="gx-muted">0</span>';
  return `<span class="${n > 0 ? 'gx-up' : 'gx-down'}">${n > 0 ? '+' : ''}${gxNum(n)}</span>`;
}
function renderGuildDetail(body, d, item) {
  const h = d.history || []; const s = d.stats || {}; const g = Object.assign({}, item, d.guild || {}); const det = d.details;
  const act = h.map((x) => x.active); const mem = h.map((x) => x.members);
  const lastChange = act.length >= 2 ? act[act.length - 1] - act[act.length - 2] : null;
  const netGrowth = act.length >= 2 ? act[act.length - 1] - act[0] : null;
  const profile = det ? `
    <div class="gx-badges">
      ${det.recruiting ? '<span class="gx-badge gx-badge-recruit">Recruiting</span>' : ''}
      ${det.city ? `<span class="gx-badge">City: ${escapeHtml(det.city)}</span>` : ''}
    </div>
    ${det.bio ? `<p class="gx-prof-bio">${escapeHtml(det.bio)}</p>` : ''}
    <div class="gx-prof-links">
      ${det.alt_contacts ? `<span class="gx-muted">Contacts: ${escapeHtml(det.alt_contacts)}</span>` : ''}
      ${det.discord ? `<span><i class="fa-brands fa-discord"></i> ${escapeHtml(det.discord)}</span>` : ''}
      ${det.website ? `<span><i class="fa-solid fa-globe"></i> ${escapeHtml(det.website)}</span>` : ''}
    </div>` : '';
  const chart = gxLineChart([
    { values: act, color: '#e24350', fill: true, name: 'Active' },
    { values: mem, color: '#5b9bd5', name: 'Members' },
  ], { h: 150, w: 980, labels: h.map((x) => x.label) });
  const recent = h.slice(-12).reverse();
  const rows = recent.map((r) => {
    const pct = r.members > 0 ? (r.active / r.members * 100).toFixed(1) + '%' : '—';
    return `<tr><td>${escapeHtml(r.label)}</td><td class="col-num">${gxNum(r.members)}</td><td class="col-num">${gxNum(r.active)}</td><td class="col-num">${pct}</td></tr>`;
  }).join('');
  body.innerHTML = `
    <div class="gx-detail-stats gx-detail-stats-8">
      ${gxDStat('Faction', escapeHtml(g.faction || 'None'), true)}
      ${gxDStat('Leader', escapeHtml(g.leader || '—'), true)}
      ${gxDStat('Active', `${gxNum(g.active)} <span class="gx-muted">${g.active_pct != null ? `(${g.active_pct}%)` : ''}</span>`)}
      ${gxDStat('Members', gxNum(g.members))}
      ${gxDStat('Peak active', gxNum(s.peak_active))}
      ${gxDStat('Peak members', gxNum(s.peak_members))}
      ${gxDStat('Last change', gxDelta(lastChange))}
      ${gxDStat('Net growth', gxDelta(netGrowth))}
    </div>
    ${profile}
    <div class="gx-chart">${chart}</div>
    <div class="gx-rechist">
      <div class="gx-chart-h">Record history</div>
      <table class="data-grid gx-rechist-table"><thead><tr><th>When</th><th class="col-num">Members</th><th class="col-num">Active</th><th class="col-num">Active %</th></tr></thead><tbody>${rows}</tbody></table>
    </div>`;
}

// ===================== Cities =====================
const citiesState = { items: [], aggregate: null, planets: [], aggTab: 'active', planet: '', sortField: 'active_citizens', sortOrder: 'DESC', loaded: false };
const GX_PLANET_COLORS = ['#e24350', '#5b9bd5', '#45e97e', '#e9b445', '#a05cf7', '#2fbf71', '#e05b9b', '#5bd6e2', '#e8a35b', '#9aa3b2', '#7a6348', '#626ba3'];
const CITIES_COLUMNS = [
  ['City', 'name', 'col-text'], ['Planet', 'planet', 'col-text'], ['Faction', 'faction', 'col-text'],
  ['Citizens', 'citizens', 'col-num'], ['Active', 'active_citizens', 'col-num'],
  ['Mayor', 'mayor', 'col-text'], ['Specializations', 'specializations', 'col-text'],
  ['Taxes', 'income_tax', 'col-num'], ['Waypoint', 'waypoint', 'col-text'],
];
const CITIES_NUM = new Set(['citizens', 'active_citizens', 'income_tax', 'level']);

async function loadCities() {
  if (citiesState.loaded) { renderCities(); return; }
  $('#cities-loading').hidden = false; $('#cities-empty').hidden = true;
  const agg = document.querySelector('#page-cities .gx-aggchart'); if (agg) agg.hidden = true;
  let res;
  try { res = await apiFetch('GET', 'api/cities.php'); } catch (e) { res = { ok: false, error: String(e) }; }
  $('#cities-loading').hidden = true;
  if (!res.ok) { $('#cities-empty').textContent = res.error || 'Could not load cities.'; $('#cities-empty').hidden = false; return; }
  if (agg) agg.hidden = false;
  citiesState.items = (res.data && res.data.results) || [];
  citiesState.aggregate = (res.data && res.data.aggregate) || null;
  citiesState.planets = (res.data && res.data.planets) || [];
  citiesState.loaded = true;
  gxUpdated('#cities-updated', res.data && res.data.last_updated);
  const psel = $('#cities-planet');
  if (psel) {
    psel.innerHTML = '<option value="">All planets</option>' + citiesState.planets.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
    psel.value = citiesState.planet;
  }
  renderCitiesAgg();
  renderCities();
}
function renderCitiesAgg() {
  const host = $('#cities-aggbody');
  const a = citiesState.aggregate;
  if (!host) return;
  if (!a || !a.labels || a.labels.length < 2) { host.innerHTML = '<div class="settings-sub">Not enough history yet.</div>'; return; }
  document.querySelectorAll('#cities-aggtabs .gx-aggtab').forEach((b) => b.classList.toggle('active', b.dataset.aggtab === citiesState.aggTab));
  let series;
  if (citiesState.aggTab === 'planet') {
    const planets = Object.keys(a.planet || {});
    series = planets.map((p, i) => ({ values: a.planet[p], color: GX_PLANET_COLORS[i % GX_PLANET_COLORS.length], name: p }));
  } else {
    const label = { active: 'Active citizens', cities: 'Cities', level: 'Avg level' }[citiesState.aggTab] || 'Active';
    series = [{ values: a[citiesState.aggTab], color: 'var(--accent)', fill: true, name: label }];
  }
  host.innerHTML = gxLineChart(series, { h: 220, w: Math.round(host.getBoundingClientRect().width) || 900, labels: a.labels });
}
function renderCities() {
  $('#cities-head').innerHTML = sortableHeaderHtml(CITIES_COLUMNS, citiesState.sortField, citiesState.sortOrder, '<th class="pin-cell"></th>') + '<th>Movement</th>';
  const q = ($('#cities-search')?.value || '').trim().toLowerCase();
  let rows = citiesState.items;
  if (citiesState.planet) rows = rows.filter((c) => c.planet === citiesState.planet);
  if (q) rows = rows.filter((c) => [c.name, c.planet, c.mayor, c.faction, c.specializations]
    .some((v) => String(v || '').toLowerCase().includes(q)));
  rows = gxSortRows(rows, citiesState.sortField, citiesState.sortOrder, CITIES_NUM);
  rows = gxPinFirst(rows, gxPins.cities, gxCityKey);
  const body = $('#cities-body');
  if (!rows.length) { body.innerHTML = ''; $('#cities-empty').textContent = 'No cities match.'; $('#cities-empty').hidden = false; return; }
  $('#cities-empty').hidden = true;
  body.innerHTML = rows.map((c) => {
    const taxTip = `Income ${c.income_tax || 0} · Property ${c.property_tax || 0} · Sales ${c.sales_tax || 0}`;
    const key = gxCityKey(c);
    const spark = (c.spark && c.spark.length > 1)
      ? gxSpark(c.spark, { w: 120, h: 26, color: safeInt(c.active_citizens) >= (c.spark[0] || 0) ? '#45e97e' : '#e24350' }) : '';
    return `<tr class="gx-rowlink" data-gxdetail="city" data-gxkey="${escapeHtml(key)}">
      ${gxPinCell('city', key, gxPins.cities.has(key))}
      <td class="col-text"><b class="gx-detail-link">${escapeHtml(c.name)}</b>${c.guild ? ` <span class="gx-citytag">[${escapeHtml(c.guild)}]</span>` : ''}</td>
      <td class="col-text">${escapeHtml(c.planet || '')}</td>
      <td class="col-text">${escapeHtml(c.faction || '—')}</td>
      <td class="col-num">${gxNum(c.citizens)}</td>
      <td class="col-num">${gxNum(c.active_citizens)}</td>
      <td class="col-text">${escapeHtml(c.mayor || '—')}</td>
      <td class="col-text gx-spec">${escapeHtml(c.specializations || '—')}</td>
      <td class="col-num" title="${escapeHtml(taxTip)}">${gxNum(c.income_tax)}</td>
      <td class="col-text"><span class="gx-wp" data-gxcopy="${escapeHtml(c.waypoint || '')}" title="Copy waypoint"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(c.waypoint || '')}</span></td>
      <td class="gx-movecell">${spark}</td>
    </tr>`;
  }).join('');
}

// ===================== Guilds =====================
const guildsState = { items: [], aggregate: null, factions: [], aggTab: 'active', faction: '', sortField: 'active', sortOrder: 'DESC', loaded: false };
const GUILDS_COLUMNS = [
  ['Guild', 'name', 'col-text'], ['Tag', 'abbrev', 'col-text'], ['Faction', 'faction', 'col-text'],
  ['Leader', 'leader', 'col-text'], ['Members', 'members', 'col-num'],
  ['Active', 'active', 'col-num'],
];
const GUILDS_NUM = new Set(['members', 'active', 'active_pct']);

async function loadGuilds() {
  if (guildsState.loaded) { renderGuilds(); return; }
  $('#guilds-loading').hidden = false; $('#guilds-empty').hidden = true;
  const agg = document.querySelector('#page-guilds .gx-aggchart'); if (agg) agg.hidden = true;
  let res;
  try { res = await apiFetch('GET', 'api/guilds.php'); } catch (e) { res = { ok: false, error: String(e) }; }
  $('#guilds-loading').hidden = true;
  if (!res.ok) { $('#guilds-empty').textContent = res.error || 'Could not load guilds.'; $('#guilds-empty').hidden = false; return; }
  if (agg) agg.hidden = false;
  guildsState.items = (res.data && res.data.results) || [];
  guildsState.aggregate = (res.data && res.data.aggregate) || null;
  guildsState.factions = (res.data && res.data.factions) || [];
  guildsState.loaded = true;
  // faction filter options
  const fsel = $('#guilds-faction');
  if (fsel) {
    fsel.innerHTML = '<option value="">All factions</option>' + guildsState.factions.map((f) => `<option value="${escapeHtml(f)}">${escapeHtml(f)}</option>`).join('');
    fsel.value = guildsState.faction;
  }
  renderGuildsAgg();
  renderGuilds();
}

// top server-wide aggregate chart, driven by the active toggle tab
function renderGuildsAgg() {
  const host = $('#guilds-aggbody');
  const a = guildsState.aggregate;
  if (!host) return;
  if (!a || !a.labels || a.labels.length < 2) { host.innerHTML = '<div class="settings-sub">Not enough history yet.</div>'; return; }
  document.querySelectorAll('#guilds-aggtabs .gx-aggtab').forEach((b) => b.classList.toggle('active', b.dataset.aggtab === guildsState.aggTab));
  let series;
  if (guildsState.aggTab === 'faction') {
    series = [
      { values: a.faction.Imperial, color: '#5b9bd5', name: 'Imperial' },
      { values: a.faction.Rebel, color: '#e24350', name: 'Rebel' },
      { values: a.faction.Neutral, color: '#9aa3b2', name: 'Neutral' },
    ];
  } else {
    const label = { active: 'Active members', members: 'Total members', guilds: 'Guilds' }[guildsState.aggTab] || 'Active';
    series = [{ values: a[guildsState.aggTab], color: 'var(--accent)', fill: true, name: label }];
  }
  host.innerHTML = gxLineChart(series, { h: 220, w: Math.round(host.getBoundingClientRect().width) || 900, labels: a.labels });
}
function renderGuilds() {
  $('#guilds-head').innerHTML = sortableHeaderHtml(GUILDS_COLUMNS, guildsState.sortField, guildsState.sortOrder, '<th class="pin-cell"></th>') + '<th>Movement</th>';
  const q = ($('#guilds-search')?.value || '').trim().toLowerCase();
  let rows = guildsState.items;
  if (guildsState.faction) rows = rows.filter((g) => g.faction === guildsState.faction);
  if (q) rows = rows.filter((g) => [g.name, g.abbrev, g.leader, g.faction]
    .some((v) => String(v || '').toLowerCase().includes(q)));
  rows = gxSortRows(rows, guildsState.sortField, guildsState.sortOrder, GUILDS_NUM);
  rows = gxPinFirst(rows, gxPins.guilds, gxGuildKey);
  const body = $('#guilds-body');
  if (!rows.length) { body.innerHTML = ''; $('#guilds-empty').textContent = 'No guilds match.'; $('#guilds-empty').hidden = false; return; }
  $('#guilds-empty').hidden = true;
  body.innerHTML = rows.map((g) => {
    const key = gxGuildKey(g);
    const spark = (g.spark && g.spark.length > 1)
      ? gxSpark(g.spark, { w: 120, h: 26, color: g.active >= (g.spark[0] || 0) ? '#45e97e' : '#e24350' }) : '';
    return `<tr class="gx-rowlink" data-gxdetail="guild" data-gxkey="${escapeHtml(key)}">
      ${gxPinCell('guild', key, gxPins.guilds.has(key))}
      <td class="col-text"><b class="gx-detail-link">${escapeHtml(g.name)}</b>${g.recruiting ? ' <span class="gx-badge gx-badge-recruit gx-badge-sm">Recruiting</span>' : ''}</td>
      <td class="col-text">${escapeHtml(g.abbrev || '')}</td>
      <td class="col-text">${escapeHtml(g.faction || '—')}</td>
      <td class="col-text">${escapeHtml(g.leader || '—')}</td>
      <td class="col-num">${gxNum(g.members)}</td>
      <td class="col-num">${gxNum(g.active)} <span class="gx-muted">${g.active_pct != null ? g.active_pct + '%' : ''}</span></td>
      <td class="gx-movecell">${spark}</td>
    </tr>`;
  }).join('');
}

// ===================== Wealth =====================
const wealthState = { snapshot: null, history: [], series: [], labels: [], chartTab: 'avg', chartCollapsed: false, loaded: false };
// muted theme palette for the top ranks, matching the website's wealth chart
const WEALTH_COLORS = ['#e24350', '#e0a44a', '#45e97e', '#5b9bd5', '#b07be0', '#4fd1c5',
  '#f06595', '#9aa3b2', '#a3c057', '#e8794a', '#64b5f6', '#ce93d8'];
// short unix → 'M/D/YY' for chart x-labels
function wealthDateLabel(ts) {
  const d = new Date(safeInt(ts) * 1000);
  return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(2)}`;
}
// Chart collapse preference — remembered across relaunches (config, with a
// localStorage fast path) so the leaderboard stays full-height if you prefer it.
function wealthLoadCollapsePref() {
  try { wealthState.chartCollapsed = localStorage.getItem('wealth-chart-collapsed') === '1'; } catch (_) { wealthState.chartCollapsed = false; }
  wealthApplyCollapsed();
  (async () => {
    try {
      const cfg = await api().get_config();
      const v = cfg && cfg.ok && cfg.data ? cfg.data.wealth_chart_collapsed : undefined;
      if (v === undefined || !!v === wealthState.chartCollapsed) return;
      wealthState.chartCollapsed = !!v;
      try { localStorage.setItem('wealth-chart-collapsed', v ? '1' : '0'); } catch (_) { /* ignore */ }
      wealthApplyCollapsed();
    } catch (_) { /* no config bridge — localStorage stands */ }
  })();
}
function wealthApplyCollapsed() {
  const wrap = $('#wealth-chartwrap');
  if (wrap) wrap.classList.toggle('collapsed', !!wealthState.chartCollapsed);
  const btn = $('#wealth-chartcollapse');
  if (btn) {
    btn.innerHTML = wealthState.chartCollapsed ? '<i class="fa-solid fa-chevron-down"></i>' : '<i class="fa-solid fa-chevron-up"></i>';
    btn.title = wealthState.chartCollapsed ? 'Show charts' : 'Collapse charts for more table room';
  }
}
function wealthSetCollapsed(v) {
  wealthState.chartCollapsed = !!v;
  try { localStorage.setItem('wealth-chart-collapsed', v ? '1' : '0'); } catch (_) { /* ignore */ }
  try { api().set_config('wealth_chart_collapsed', !!v); } catch (_) { /* ignore */ }
  wealthApplyCollapsed();
  if (!v) renderWealthChart(); // re-measure width when expanding back
}

async function loadWealth() {
  if (wealthState.loaded) { renderWealth(); return; }
  $('#wealth-loading').hidden = false; $('#wealth-empty').hidden = true;
  // blank-chart frames look broken while fetching — hide them until data's in
  const aggs = document.querySelectorAll('#page-wealth .gx-aggchart');
  aggs.forEach((a) => { a.hidden = true; });
  let res;
  try { res = await apiFetch('GET', 'api/wealth.php'); } catch (e) { res = { ok: false, error: String(e) }; }
  $('#wealth-loading').hidden = true;
  aggs.forEach((a) => { a.hidden = false; });
  if (!res.ok) { $('#wealth-empty').textContent = res.error || 'Could not load wealth data.'; $('#wealth-empty').hidden = false; return; }
  wealthState.snapshot = res.data && res.data.snapshot;
  wealthState.history = (res.data && res.data.history) || [];
  wealthState.series = (res.data && res.data.series) || [];
  wealthState.labels = (res.data && res.data.labels) || [];
  wealthState.loaded = true;
  gxUpdated('#wealth-updated', res.data && res.data.last_updated);
  renderWealth();
}
function renderWealth() {
  const s = wealthState.snapshot;
  if (!s) { $('#wealth-empty').textContent = 'No wealth data yet.'; $('#wealth-empty').hidden = false; return; }
  $('#wealth-empty').hidden = true;
  // Stat cards: big number + "± since last scan" delta (vs the previous snapshot).
  const h = wealthState.history || [];
  const last = h[h.length - 1], prev = h[h.length - 2];
  const avgDelta = (last && prev) ? last.avg - prev.avg : null;
  const medDelta = (last && prev) ? last.med - prev.med : null;
  const wealthiest = (s.richest[0] || {}).credits || 0;
  const wealthiestDelta = (s.richest[0] || {}).change;
  const top20 = s.richest.reduce((a, r) => a + (r.credits || 0), 0);
  // group delta: sum of the per-character changes we could match to the prior scan
  const top20Delta = s.richest.reduce((a, r) => a + (r.change == null ? 0 : r.change), 0);
  const deltaHtml = (d) => {
    if (d == null) return '<div class="wealth-delta wealth-delta-flat">—<div class="wealth-delta-sub">since last scan</div></div>';
    const cls = d > 0 ? 'wealth-delta-up' : d < 0 ? 'wealth-delta-down' : 'wealth-delta-flat';
    return `<div class="wealth-delta ${cls}">${d > 0 ? '+' : ''}${gxNum(d)}<div class="wealth-delta-sub">since last scan</div></div>`;
  };
  // faint trend sparklines bleeding to the bottom of each card (pulse-style, not interactive)
  const avgTrend = h.map((x) => x.avg);
  const medTrend = h.map((x) => x.med);
  const topChar = (wealthState.series || []).find((x) => x.latest_rank === 1) || (wealthState.series || [])[0];
  const topCharTrend = topChar ? topChar.credits.filter((v) => v != null) : [];
  const total20Trend = (wealthState.labels || []).map((_, i) =>
    (wealthState.series || []).reduce((a, sx) => a + (sx.credits[i] || 0), 0)).filter((v) => v > 0);
  const spark = (vals, color) => {
    const sv = gxDownsample((vals || []).filter((v) => v != null), 48);
    const svg = gxSpark(sv, { w: 240, h: 40, color, fill: true });
    return svg ? `<div class="wealth-spark">${svg}</div>` : '';
  };
  const card = (num, label, delta, trend, color) =>
    `<div class="wealth-statcard"><div class="wealth-stat-num">${gxNum(num)}</div><div class="wealth-stat-label">${label}</div>${deltaHtml(delta)}${spark(trend, color)}</div>`;
  $('#wealth-cards').innerHTML =
    card(s.avg, 'character average wealth', avgDelta, avgTrend, 'var(--accent)')
    + card(s.med, 'character median wealth', medDelta, medTrend, '#45e97e')
    + card(wealthiest, 'wealthiest character', wealthiestDelta, topCharTrend, 'var(--accent)')
    + card(top20, 'top 20 total wealth', top20Delta, total20Trend, 'var(--accent)');
  renderWealthChart();
  $('#wealth-body').innerHTML = s.richest.map((r) => {
    const chg = r.change == null ? '<span class="gx-muted">—</span>'
      : `<span class="${r.change >= 0 ? 'gx-up' : 'gx-down'}">${r.change >= 0 ? '+' : ''}${gxNum(r.change)}</span>`;
    let move = '<span class="gx-muted">—</span>';
    if (r.is_new) move = '<span class="gx-new">new</span>';
    else if (r.rank_move > 0) move = `<span class="gx-up">▲ ${r.rank_move}</span>`;
    else if (r.rank_move < 0) move = `<span class="gx-down">▼ ${Math.abs(r.rank_move)}</span>`;
    else if (r.rank_move === 0) move = '<span class="gx-muted">—</span>';
    const who = r.short
      ? `<span class="gx-charid">${escapeHtml(r.short)}</span>` : '<span class="gx-muted">—</span>';
    const hist = r.id
      ? `<i class="fa-solid fa-clock-rotate-left gx-histicon" title="View this character's wealth history"></i>` : '';
    const rowAttr = r.id ? ` class="gx-rowlink" data-wealthid="${escapeHtml(r.id)}"` : '';
    return `<tr${rowAttr}><td class="col-num gx-rank">#${r.rank}</td><td class="col-text">${who}</td><td class="col-num"><b>${gxNum(r.credits)}</b></td><td class="col-num">${chg}</td><td class="col-num">${move}</td><td class="col-num">${hist}</td></tr>`;
  }).join('');
}

// One chart, five views (tabs): Average / Median server trend, and the richest
// characters' Wealth / Rank / Movement journeys. Series are downsampled so the
// lines stay legible, and credit axes use compact (1.2B) labels so they don't clip.
function renderWealthChart() {
  const host = $('#wealth-chartbody');
  if (!host) return;
  const tab = wealthState.chartTab;
  document.querySelectorAll('#wealth-charttabs .gx-aggtab').forEach((b) => b.classList.toggle('active', b.dataset.wtab === tab));
  const w = Math.round(host.getBoundingClientRect().width) || 900;
  const credFmt = { yFormat: gxCompact, h: 260, w };

  // Average / Median: server-wide economy trend (one filled line)
  if (tab === 'avg' || tab === 'med') {
    const h = wealthState.history || [];
    if (h.length < 2) { host.innerHTML = '<div class="settings-sub">Not enough history yet.</div>'; return; }
    const labels = gxDownsample(h.map((x) => wealthDateLabel(x.timestamp)));
    const vals = gxDownsample(h.map((x) => (tab === 'avg' ? x.avg : x.med)));
    const color = tab === 'avg' ? 'var(--accent)' : '#45e97e';
    host.innerHTML = gxLineChart([{ values: vals, color, fill: true, name: tab === 'avg' ? 'Average wealth' : 'Median wealth' }], { ...credFmt, labels });
    return;
  }

  // Richest journeys (Wealth / Rank / Movement) — top 12 currently-ranked characters
  const lbls = wealthState.labels || [];
  const tracked = (wealthState.series || []).filter((s) => s.latest_rank != null).slice(0, 12);
  if (lbls.length < 2 || !tracked.length) { host.innerHTML = '<div class="settings-sub">Not enough per-character history yet.</div>'; return; }
  const colorFor = (s) => WEALTH_COLORS[((s.latest_rank || 1) - 1) % WEALTH_COLORS.length];
  const idx = gxDownsample(lbls.map((_, i) => i)); // the sampled snapshot indices
  const labels = idx.map((i) => wealthDateLabel(lbls[i]));

  if (tab === 'wealth') {
    const series = tracked.map((s) => ({ values: idx.map((i) => s.credits[i]), color: colorFor(s), name: s.short }));
    host.innerHTML = gxLineChart(series, { ...credFmt, h: 300, labels });
  } else if (tab === 'rank') {
    const all = wealthState.series;
    const rankSeries = tracked.map((s) => {
      const vals = idx.map((i) => {
        const c = s.credits[i];
        if (c == null) return null;
        let r = 1; all.forEach((o) => { const v = o.credits[i]; if (v != null && v > c) r++; });
        return r;
      });
      return { values: vals, color: colorFor(s), name: s.short };
    });
    host.innerHTML = gxLineChart(rankSeries, { h: 300, w, labels, invert: true });
  } else {
    // movement: first vs latest known wealth in the window (a slope per character)
    const firstLast = (arr) => {
      const f = arr.find((v) => v != null) ?? null;
      let l = null; for (let i = arr.length - 1; i >= 0; i--) { if (arr[i] != null) { l = arr[i]; break; } }
      return [f, l];
    };
    const series = tracked.map((s) => ({ values: firstLast(s.credits), color: colorFor(s), name: s.short }));
    host.innerHTML = gxLineChart(series, { ...credFmt, h: 300, labels: ['First', 'Latest'] });
  }
}

// Single-character "wealth journey" modal (reuses the galaxy detail modal shell)
function openWealthJourney(id) {
  const s = (wealthState.series || []).find((x) => x.id === id);
  if (!s) return;
  const labels = (wealthState.labels || []).map(wealthDateLabel);
  const vals = s.credits.filter((v) => v != null);
  const peak = vals.length ? Math.max(...vals) : 0;
  const cur = (() => { for (let i = s.credits.length - 1; i >= 0; i--) if (s.credits[i] != null) return s.credits[i]; return 0; })();
  const first = s.credits.find((v) => v != null) ?? 0;
  const net = cur - first;
  $('#gx-detail-title').textContent = `Wealth Journey — ${s.short}`;
  $('#gx-detail-body').innerHTML = `
    <div class="gx-detail-stats gx-detail-stats-8">
      <div class="gx-dstat"><div class="gx-dstat-label">Current rank</div><div class="gx-dstat-val">${s.latest_rank != null ? '#' + s.latest_rank : '—'}</div></div>
      <div class="gx-dstat"><div class="gx-dstat-label">Current wealth</div><div class="gx-dstat-val">${gxNum(cur)}</div></div>
      <div class="gx-dstat"><div class="gx-dstat-label">Peak wealth</div><div class="gx-dstat-val">${gxNum(peak)}</div></div>
      <div class="gx-dstat"><div class="gx-dstat-label">Net change</div><div class="gx-dstat-val ${net >= 0 ? 'gx-up' : 'gx-down'}">${net >= 0 ? '+' : ''}${gxNum(net)}</div></div>
    </div>
    <div class="gx-chart"><div class="gx-chart-h">Wealth over time</div>${gxLineChart([{ values: s.credits, color: 'var(--accent)', fill: true, name: s.short }], { h: 260, w: 940, labels })}</div>`;
  $('#gx-detail-modal').hidden = false;
}

// ===================== GCW =====================
const gcwState = { results: [], latest: null, loaded: false };
async function loadGcw() {
  if (gcwState.loaded) { renderGcw(); return; }
  let res;
  try { res = await apiFetch('GET', 'api/gcw.php'); } catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) { $('#gcw-empty').textContent = res.error || 'Could not load GCW data.'; $('#gcw-empty').hidden = false; return; }
  gcwState.results = (res.data && res.data.results) || [];
  gcwState.latest = res.data && res.data.latest;
  gcwState.loaded = true;
  gxUpdated('#gcw-updated', res.data && res.data.last_updated);
  renderGcw();
}
function renderGcw() {
  const l = gcwState.latest;
  if (!l) { $('#gcw-empty').textContent = 'No GCW data yet.'; $('#gcw-empty').hidden = false; return; }
  $('#gcw-empty').hidden = true;
  const total = (l.imperial + l.rebel) || 1;
  const impPct = Math.round((l.imperial / total) * 100);
  $('#gcw-cards').innerHTML = `
    <div class="gx-card gx-imp"><div class="gx-card-label">Imperial</div><div class="gx-card-val">${gxNum(l.imperial)}</div><div class="gx-card-sub">${impPct}% of active</div></div>
    <div class="gx-card gx-reb"><div class="gx-card-label">Rebel</div><div class="gx-card-val">${gxNum(l.rebel)}</div><div class="gx-card-sub">${100 - impPct}% of active</div></div>`;
  // Dual line chart: Imperial vs Rebel on one set of axes so the crossovers and the
  // gap between them are visible (the whole point of tracking both factions).
  const host = $('#gcw-trend');
  const labels = gcwState.results.map((r) => (r.timestamp ? wealthDateLabel(r.timestamp) : ''));
  const chart = gxLineChart([
    { values: gcwState.results.map((r) => r.imperial), color: '#5b9bd5', name: 'Imperial' },
    { values: gcwState.results.map((r) => r.rebel), color: '#e24350', name: 'Rebel' },
  ], { h: 260, w: Math.round(host.getBoundingClientRect().width) || 900, labels });
  host.innerHTML = `
    <div class="gx-balance"><div class="gx-balance-imp" style="width:${impPct}%"></div><div class="gx-balance-reb" style="width:${100 - impPct}%"></div></div>
    <div class="gx-balance-legend"><span class="gx-imp-txt">Imperial ${impPct}%</span><span class="gx-reb-txt">Rebel ${100 - impPct}%</span></div>
    ${chart}`;
}

// ===================== Professions =====================
// labels = shared timestamp axis; history[key] = counts aligned to it. The compare
// chart overlays the selected classes, and a class row opens a per-class detail modal;
// both honor the selected range (7/30/90 days or All).
const profState = { items: [], total: 0, labels: [], history: {}, range: '30', compare: new Set(), collapsedGroups: new Set(), loaded: false };

// Profession families (mirrors the website's 7 groups) — the list is organized under
// these headers, and a whole family can be added to the compare chart as one summed line.
const PROF_GROUPS = [
  { key: 'crafter', name: 'Crafter', color: '#A0AB71', keys: ['architect', 'artisan', 'armorsmith', 'weaponsmith', 'shipwright', 'droid_engineer', 'chef', 'merchant', 'tailor'] },
  { key: 'ranged', name: 'Ranged', color: '#626BA3', keys: ['carbineer', 'sharpshooter', 'sniper', 'pistoleer'] },
  { key: 'melee', name: 'Melee', color: '#7A6348', keys: ['berserker', 'brawler', 'lancer', 'tkm', 'fencer'] },
  { key: 'healing', name: 'Healing', color: '#477778', keys: ['combat_medic', 'bio_engineer', 'doctor', 'medic'] },
  { key: 'space', name: 'Space', color: '#487A5A', keys: ['pilot_imp', 'pilot_rebel', 'pilot_neutral'] },
  { key: 'hybrid', name: 'Hybrid', color: '#7A484E', keys: ['sl', 'commando', 'creature_handler', 'bounty_hunter', 'scout', 'smuggler'] },
  { key: 'social', name: 'Social', color: '#624778', keys: ['dancer', 'entertainer', 'musician', 'image_designer'] },
];
const profGroupOf = (key) => PROF_GROUPS.find((g) => g.keys.includes(key));

async function loadProfessions() {
  if (profState.loaded) { renderProfessions(); return; }
  let res;
  try { res = await apiFetch('GET', 'api/professions.php'); } catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) { $('#prof-empty').textContent = res.error || 'Could not load professions.'; $('#prof-empty').hidden = false; return; }
  profState.items = (res.data && res.data.professions) || [];
  profState.total = (res.data && res.data.total) || 0;
  profState.labels = (res.data && res.data.labels) || [];
  profState.history = (res.data && res.data.history) || {};
  // default the compare overlay to the three biggest classes
  if (!profState.compare.size) {
    [...profState.items].sort((a, b) => b.count - a.count).slice(0, 3).forEach((p) => profState.compare.add(p.key));
  }
  profState.loaded = true;
  gxUpdated('#prof-updated', res.data && res.data.last_updated);
  renderProfessions();
}

// the indices of profState.labels within the selected range (All = everything)
function profRangeIdx() {
  const lbls = profState.labels || [];
  if (profState.range === 'all') return lbls.map((_, i) => i);
  const days = safeInt(profState.range) || 30;
  const cutoff = (Date.now() / 1000) - days * 86400;
  const idx = [];
  lbls.forEach((ts, i) => { if (ts >= cutoff) idx.push(i); });
  return idx.length >= 2 ? idx : lbls.map((_, i) => i); // fall back to all if the window is too thin
}
const profSeries = (key, idx) => (profState.history[key] || []).filter((_, i) => idx.includes(i));

function renderProfessions() {
  renderProfCompare();
  const q = ($('#prof-search')?.value || '').trim().toLowerCase();
  const all = profState.items.filter((p) => p.count > 0 || !q);
  const matches = q ? all.filter((p) => p.name.toLowerCase().includes(q)) : all;
  if (!matches.length) { $('#prof-list').innerHTML = ''; $('#prof-empty').textContent = 'No classes match.'; $('#prof-empty').hidden = false; return; }
  $('#prof-empty').hidden = true;
  const max = Math.max(1, ...all.map((p) => p.count)); // bars scale against the whole server, not per group
  const byKey = Object.fromEntries(profState.items.map((p) => [p.key, p]));

  // When searching, show a flat ranked list; otherwise group by family (collapsible).
  if (q) {
    $('#prof-list').innerHTML = [...matches].sort((a, b) => b.count - a.count).map((p) => profRowHtml(p, max)).join('');
    return;
  }
  const html = PROF_GROUPS.map((g) => {
    const members = g.keys.map((k) => byKey[k]).filter(Boolean).sort((a, b) => b.count - a.count);
    if (!members.length) return '';
    const gTotal = members.reduce((s, p) => s + p.count, 0);
    const gShare = profState.total ? ((gTotal / profState.total) * 100).toFixed(1) : '0';
    const collapsed = profState.collapsedGroups.has(g.key);
    const head = `<div class="gx-prof-grouphead${collapsed ? ' collapsed' : ''}" data-profgroup="${g.key}">
      <i class="fa-solid fa-chevron-down gx-prof-gcaret"></i>
      <span class="gx-pdot" style="background:${g.color}"></span>
      <span class="gx-prof-gname">${g.name}</span>
      <span class="gx-prof-gcount">${gxNum(gTotal)} <span class="gx-muted">· ${gShare}%</span></span>
      <i class="fa-solid fa-chart-line gx-prof-gcmp" data-profgroupcompare="${g.key}" title="Add the whole ${g.name} family to the compare chart"></i>
    </div>`;
    const body = collapsed ? '' : `<div class="gx-prof-gbody">${members.map((p) => profRowHtml(p, max)).join('')}</div>`;
    return head + body;
  }).join('');
  $('#prof-list').innerHTML = html;
}

function profRowHtml(p, max) {
  const pct = Math.round((p.count / max) * 100);
  const share = profState.total ? ((p.count / profState.total) * 100).toFixed(1) : '0';
  const chg = p.change_recent == null || p.change_recent === 0 ? ''
    : `<span class="${p.change_recent > 0 ? 'gx-up' : 'gx-down'} gx-prof-chg">${p.change_recent > 0 ? '+' : ''}${p.change_recent}</span>`;
  // new endpoint: history map; older endpoint: per-item p.history — support both
  const hist = (profState.history[p.key] || p.history || []).filter((v) => v != null);
  const spark = (hist.length > 1) ? gxSpark(hist.slice(-40), { w: 90, h: 22, color: p.color, fill: true }) : '';
  const cmp = profState.compare.has(p.key);
  return `<div class="gx-prof-row">
    <i class="fa-solid fa-chart-line gx-prof-cmp${cmp ? ' on' : ''}" data-profcompare="${escapeHtml(p.key)}" title="${cmp ? 'Remove from compare chart' : 'Add to compare chart'}" style="${cmp ? `color:${escapeHtml(p.color)}` : ''}"></i>
    <div class="gx-prof-name gx-prof-detaillink" data-profdetail="${escapeHtml(p.key)}" title="View ${escapeHtml(p.name)} history">${escapeHtml(p.name)}</div>
    <div class="gx-prof-barwrap"><div class="gx-prof-bar" style="width:${pct}%;background:${escapeHtml(p.color)}"></div></div>
    <div class="gx-prof-spark" title="Population trend (recent)">${spark}</div>
    <div class="gx-prof-count">${gxNum(p.count)} <span class="gx-muted">· ${share}%</span> ${chg}</div>
  </div>`;
}

// one compare entry → {name, color, series} for an idx window. A key prefixed "g:"
// is a whole family (its member counts summed); otherwise a single class.
function profCompareEntry(k, idx, byKey) {
  if (k.startsWith('g:')) {
    const g = PROF_GROUPS.find((x) => x.key === k.slice(2));
    if (!g) return null;
    const sums = idx.map((i) => g.keys.reduce((s, mk) => s + ((profState.history[mk] || [])[i] || 0), 0));
    return { name: `${g.name} family`, color: g.color, values: sums };
  }
  if (!byKey[k]) return null;
  return { name: byKey[k].name, color: byKey[k].color, values: profSeries(k, idx) };
}

// overlay chart of the selected classes/families over the chosen range + removable chips
function renderProfCompare() {
  document.querySelectorAll('#prof-rangetabs .gx-aggtab').forEach((b) => b.classList.toggle('active', b.dataset.profrange === profState.range));
  const chipHost = $('#prof-compare-chips');
  const host = $('#prof-chartbody');
  if (!chipHost || !host) return;
  const byKey = Object.fromEntries(profState.items.map((p) => [p.key, p]));
  const idxAll = profState.labels.map((_, i) => i);
  const keys = [...profState.compare].map((k) => ({ k, e: profCompareEntry(k, idxAll, byKey) })).filter((x) => x.e);
  chipHost.innerHTML = keys.length
    ? keys.map(({ k, e }) => `<span class="gx-prof-chip" style="border-color:${escapeHtml(e.color)}"><span class="gx-pdot" style="background:${escapeHtml(e.color)}"></span>${escapeHtml(e.name)} <i class="fa-solid fa-xmark" data-profuncompare="${escapeHtml(k)}" title="Remove"></i></span>`).join('')
    : '<span class="settings-sub">Add a class or a whole family to compare them here — use the chart icon on a row or a group header.</span>';
  if (!keys.length) { host.innerHTML = ''; return; }
  if (!profState.labels.length) { host.innerHTML = '<div class="settings-sub">Population history isn\'t available yet — pending a site update.</div>'; return; }
  const idx = profRangeIdx();
  const labels = gxDownsample(idx.map((i) => wealthDateLabel(profState.labels[i])));
  const series = keys.map(({ k }) => {
    const e = profCompareEntry(k, idx, byKey);
    return { values: gxDownsample(e.values), color: e.color, name: e.name };
  });
  host.innerHTML = gxLineChart(series, { h: 260, w: Math.round(host.getBoundingClientRect().width) || 900, labels });
}

// per-class history detail modal (reuses the galaxy detail modal shell)
function openProfDetail(key) {
  const p = profState.items.find((x) => x.key === key);
  if (!p) return;
  const idx = profRangeIdx();
  const vals = profSeries(key, idx).filter((v) => v != null);
  const peak = vals.length ? Math.max(...vals) : 0;
  const low = vals.length ? Math.min(...vals) : 0;
  const first = vals.length ? vals[0] : 0;
  const net = p.count - first;
  const ranked = [...profState.items].sort((a, b) => b.count - a.count);
  const rank = ranked.findIndex((x) => x.key === key) + 1;
  const labels = gxDownsample(idx.map((i) => wealthDateLabel(profState.labels[i])));
  const chart = gxLineChart([{ values: gxDownsample(profSeries(key, idx)), color: p.color, fill: true, name: p.name }],
    { h: 260, w: 940, labels });
  $('#gx-detail-title').textContent = `${p.name} — population history`;
  $('#gx-detail-body').innerHTML = `
    <div class="gx-detail-stats gx-detail-stats-8">
      <div class="gx-dstat"><div class="gx-dstat-label">Current</div><div class="gx-dstat-val">${gxNum(p.count)}</div></div>
      <div class="gx-dstat"><div class="gx-dstat-label">Rank</div><div class="gx-dstat-val">#${rank} of ${profState.items.length}</div></div>
      <div class="gx-dstat"><div class="gx-dstat-label">Share</div><div class="gx-dstat-val">${profState.total ? ((p.count / profState.total) * 100).toFixed(1) : '0'}%</div></div>
      <div class="gx-dstat"><div class="gx-dstat-label">Net (range)</div><div class="gx-dstat-val ${net >= 0 ? 'gx-up' : 'gx-down'}">${net >= 0 ? '+' : ''}${gxNum(net)}</div></div>
      <div class="gx-dstat"><div class="gx-dstat-label">Peak (range)</div><div class="gx-dstat-val">${gxNum(peak)}</div></div>
      <div class="gx-dstat"><div class="gx-dstat-label">Low (range)</div><div class="gx-dstat-val">${gxNum(low)}</div></div>
    </div>
    <div class="gx-chart"><div class="gx-chart-h">Characters mastering ${escapeHtml(p.name)} — ${profRangeLabel()}</div>${chart}</div>`;
  $('#gx-detail-modal').hidden = false;
}
function profRangeLabel() {
  return profState.range === 'all' ? 'all history' : `last ${profState.range} days`;
}

// ===================== Titles =====================
const titlesState = { items: [], sortField: 'friendly', sortOrder: 'ASC', loaded: false };
const TITLES_COLUMNS = [['Title', 'friendly', 'col-text'], ['Key', 'titlekey', 'col-text'], ['Command', 'command', 'col-text']];
async function loadTitles() {
  if (titlesState.loaded) { renderTitles(); return; }
  $('#titles-loading').hidden = false; $('#titles-empty').hidden = true;
  let res;
  try { res = await apiFetch('GET', 'api/titles.php'); } catch (e) { res = { ok: false, error: String(e) }; }
  $('#titles-loading').hidden = true;
  if (!res.ok) { $('#titles-empty').textContent = res.error || 'Could not load titles.'; $('#titles-empty').hidden = false; return; }
  titlesState.items = (res.data && res.data.results) || [];
  titlesState.loaded = true;
  renderTitles();
}
function renderTitles() {
  $('#titles-head').innerHTML = sortableHeaderHtml(TITLES_COLUMNS, titlesState.sortField, titlesState.sortOrder);
  const q = ($('#titles-search')?.value || '').trim().toLowerCase();
  let rows = titlesState.items;
  if (q) rows = rows.filter((t) => String(t.friendly || '').toLowerCase().includes(q) || String(t.titlekey || '').toLowerCase().includes(q));
  rows = gxSortRows(rows, titlesState.sortField, titlesState.sortOrder, new Set());
  const body = $('#titles-body');
  if (!rows.length) { body.innerHTML = ''; $('#titles-empty').textContent = 'No titles match.'; $('#titles-empty').hidden = false; return; }
  $('#titles-empty').hidden = true;
  body.innerHTML = rows.map((t) => `<tr>
      <td class="col-text"><b>${escapeHtml(t.friendly || t.titlekey)}</b></td>
      <td class="col-text gx-muted">${escapeHtml(t.titlekey)}</td>
      <td class="col-text"><span class="gx-cmd" data-gxcopy="${escapeHtml(t.command)}" title="Copy command"><i class="fa-solid fa-copy"></i> ${escapeHtml(t.command)}</span></td>
    </tr>`).join('');
}

// ===================== init =====================
function initGalaxy() {
  gxInitChartHover();
  // collapsible nav group
  const head = document.querySelector('.nav-group-head[data-navgroup="galaxy"]');
  if (head) {
    const apply = (collapsed) => {
      head.classList.toggle('collapsed', collapsed);
      document.querySelectorAll('.galaxy-item').forEach((el) => { el.style.display = collapsed ? 'none' : ''; });
    };
    head.addEventListener('click', () => {
      const c = !head.classList.contains('collapsed');
      apply(c);
      // localStorage is the instant path; config is durable (WKWebView can drop
      // localStorage across restarts, which left the group re-expanding on launch)
      try { localStorage.setItem('galaxy-collapsed', c ? '1' : ''); } catch (e) { /* ignore */ }
      try { api().set_config('galaxy_collapsed', c); } catch (e) { /* ignore */ }
    });
    let ls = false;
    try { ls = localStorage.getItem('galaxy-collapsed') === '1'; } catch (e) { /* ignore */ }
    if (ls) apply(true);
    // honor the durable copy once it answers (it wins over a cleared localStorage)
    (async () => {
      try {
        const cfg = await api().get_config();
        const v = cfg && cfg.ok && cfg.data ? cfg.data.galaxy_collapsed : undefined;
        if (v === undefined || !!v === head.classList.contains('collapsed')) return;
        apply(!!v);
        try { localStorage.setItem('galaxy-collapsed', v ? '1' : ''); } catch (e) { /* ignore */ }
      } catch (e) { /* no config bridge — localStorage stands */ }
    })();
  }

  // copy-on-click for waypoints + commands (delegated, whole Galaxy)
  document.addEventListener('click', (e) => {
    const c = e.target.closest('[data-gxcopy]');
    if (!c) return;
    const txt = c.dataset.gxcopy;
    if (!txt) return;
    try { navigator.clipboard.writeText(txt); toast('Copied to clipboard'); } catch (_) { /* ignore */ }
  });

  gxLoadPins();

  // pin / open-detail for cities + guilds (delegated per table)
  const wireGxTable = (bodySel, state, pinSet, keyFn, kind, rerender) => {
    $(bodySel).addEventListener('click', (e) => {
      const pin = e.target.closest('[data-gxpin]');
      if (pin) {
        const k = pin.dataset.gxpin;
        if (pinSet.has(k)) pinSet.delete(k); else pinSet.add(k);
        gxSavePins();
        rerender();
        return;
      }
      if (e.target.closest('[data-gxcopy]')) return; // waypoint copy, not a row-open
      const link = e.target.closest('[data-gxdetail]');
      if (link) {
        const item = state.items.find((x) => keyFn(x) === link.dataset.gxkey);
        if (item) openGxDetail(kind, item);
      }
    });
  };
  wireGxTable('#cities-body', citiesState, gxPins.cities, gxCityKey, 'city', renderCities);
  wireGxTable('#guilds-body', guildsState, gxPins.guilds, gxGuildKey, 'guild', renderGuilds);
  $('#gx-detail-x').addEventListener('click', () => { $('#gx-detail-modal').hidden = true; });
  $('#gx-detail-modal').addEventListener('click', (e) => { if (e.target === $('#gx-detail-modal')) $('#gx-detail-modal').hidden = true; });

  // Cities
  $('#cities-search').addEventListener('input', renderCities);
  $('#cities-reload').addEventListener('click', () => { citiesState.loaded = false; loadCities(); });
  gxSortClick(citiesState, '#cities-head', renderCities);
  $('#cities-planet').addEventListener('change', () => { citiesState.planet = $('#cities-planet').value; renderCities(); });
  $('#cities-aggtabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-aggtab]');
    if (b) { citiesState.aggTab = b.dataset.aggtab; renderCitiesAgg(); }
  });
  // Guilds
  $('#guilds-search').addEventListener('input', renderGuilds);
  $('#guilds-reload').addEventListener('click', () => { guildsState.loaded = false; loadGuilds(); });
  gxSortClick(guildsState, '#guilds-head', renderGuilds);
  $('#guilds-faction').addEventListener('change', () => { guildsState.faction = $('#guilds-faction').value; renderGuilds(); });
  $('#guilds-aggtabs').addEventListener('click', (e) => {
    const b = e.target.closest('[data-aggtab]');
    if (b) { guildsState.aggTab = b.dataset.aggtab; renderGuildsAgg(); }
  });
  // Wealth
  $('#wealth-reload').addEventListener('click', () => { wealthState.loaded = false; loadWealth(); });
  $('#wealth-charttabs').addEventListener('click', (e) => {
    if (e.target.closest('#wealth-chartcollapse')) { wealthSetCollapsed(!wealthState.chartCollapsed); return; }
    const t = e.target.closest('[data-wtab]'); if (!t) return;
    const wasCollapsed = wealthState.chartCollapsed;
    wealthState.chartTab = t.dataset.wtab;
    if (wasCollapsed) { wealthSetCollapsed(false); return; } // picking a view expands + renders
    renderWealthChart();
  });
  wealthLoadCollapsePref();
  $('#wealth-body').addEventListener('click', (e) => {
    const h = e.target.closest('[data-wealthid]');
    if (h) openWealthJourney(h.dataset.wealthid);
  });
  // GCW
  $('#gcw-reload').addEventListener('click', () => { gcwState.loaded = false; loadGcw(); });
  // Professions
  $('#prof-search').addEventListener('input', renderProfessions);
  $('#prof-reload').addEventListener('click', () => { profState.loaded = false; loadProfessions(); });
  // range buttons (7/30/90/All) + collapse toggle
  $('#prof-rangetabs').addEventListener('click', (e) => {
    if (e.target.closest('#prof-chartcollapse')) {
      const wrap = $('#prof-chartwrap'); const on = wrap.classList.toggle('collapsed');
      $('#prof-chartcollapse').innerHTML = on ? '<i class="fa-solid fa-chevron-down"></i>' : '<i class="fa-solid fa-chevron-up"></i>';
      return;
    }
    const t = e.target.closest('[data-profrange]'); if (!t) return;
    profState.range = t.dataset.profrange; renderProfCompare();
  });
  // compare toggles, group collapse, and open-detail on the list rows
  $('#prof-list').addEventListener('click', (e) => {
    const gcmp = e.target.closest('[data-profgroupcompare]');
    if (gcmp) {
      const k = 'g:' + gcmp.dataset.profgroupcompare;
      if (profState.compare.has(k)) profState.compare.delete(k); else profState.compare.add(k);
      renderProfessions();
      return;
    }
    const ghead = e.target.closest('[data-profgroup]');
    if (ghead) {
      const g = ghead.dataset.profgroup;
      if (profState.collapsedGroups.has(g)) profState.collapsedGroups.delete(g); else profState.collapsedGroups.add(g);
      renderProfessions();
      return;
    }
    const cmp = e.target.closest('[data-profcompare]');
    if (cmp) {
      const k = cmp.dataset.profcompare;
      if (profState.compare.has(k)) profState.compare.delete(k); else profState.compare.add(k);
      renderProfessions();
      return;
    }
    const det = e.target.closest('[data-profdetail]');
    if (det) openProfDetail(det.dataset.profdetail);
  });
  // remove a class from the compare chart via its chip
  $('#prof-compare-chips').addEventListener('click', (e) => {
    const x = e.target.closest('[data-profuncompare]'); if (!x) return;
    profState.compare.delete(x.dataset.profuncompare);
    renderProfessions();
  });
  // Titles
  $('#titles-search').addEventListener('input', renderTitles);
  $('#titles-reload').addEventListener('click', () => { titlesState.loaded = false; loadTitles(); });
  gxSortClick(titlesState, '#titles-head', renderTitles);
}
