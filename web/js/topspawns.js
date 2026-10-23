/* Top Spawns — the website's top.php in the app: every active resource that
   ranks top-5 for a schematic, with the schematic, formula, category, section
   and rank. One fetch per filter change (api/topspawns.php), sorted
   client-side like the other full-dataset grids. The three breakdowns mirror
   the site's charts and double as filters. */

const TOP_COLUMNS = [
  ['Resource', 'name', 'col-name'],
  ['Type', 'type_name', 'col-text'],
  ['Schematic', 'schematic_name', 'col-name'],
  ['Formula', 'formula_description', 'col-text'],
  ['Category', 'schematic_category', 'col-text'],
  ['Section', 'section', 'col-text'],
  ['Rank', 'rank', 'stat'],
  ['Score', 'value_rating', 'stat', 'Schematic-weighted value vs others of this class'],
  ['OQ', 'oq', 'stat'], ['CR', 'cr', 'stat'], ['CD', 'cd', 'stat'], ['DR', 'dr', 'stat'], ['HR', 'hr', 'stat'],
  ['MA', 'ma', 'stat'], ['SR', 'sr', 'stat'], ['UT', 'ut', 'stat'], ['FL', 'fl', 'stat'], ['PE', 'pe', 'stat'],
  ['Planets', 'planets', 'col-text'],
  ['Age', 'timestamp', 'col-text'],
];
const TOP_NUMERIC = new Set(['rank', 'value_rating', 'oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe', 'timestamp']);
const TOP_PAGE = 150;   // rows per "show more" step — the full set can run to thousands

const topCols = makeColLayout({ key: 'top-colpref', columns: TOP_COLUMNS, locked: ['name'] });
const topState = {
  rows: [], breakdown: null, categories: [], loaded: false, loading: false,
  view: localStorage.getItem('top-view') || 'list',   // list | cards | tree
  treeCollapsed: new Set(),
  search: '', category: '', rank: '', rankEq: '', section: '', hideMustafar: false,
  sortField: 'schematic_name', sortOrder: 'ASC', shown: TOP_PAGE,
  chartsOpen: localStorage.getItem('top_charts') !== '0',
};

// ---- "new since you looked": a pill on the Top Spawns menu row counts resources that
// entered the top spawns since you last opened the page; opening it clears the pill and
// the newcomers wear a NEW chip for that visit (Dustin). Seen ids live in config (durable)
// + localStorage (instant); the set is pruned to what's currently ranking so it can't grow.
const topSeen = { ids: null, fresh: new Set(), loaded: false };
async function topSeenLoad() {
  if (topSeen.loaded) return;
  topSeen.loaded = true;
  try { const a = JSON.parse(localStorage.getItem('topspawns_seen') || 'null'); if (Array.isArray(a)) topSeen.ids = new Set(a.map(String)); } catch (_) {}
  try {
    const cfg = await api().get_config();
    const a = cfg && cfg.ok && cfg.data ? cfg.data.topspawns_seen : undefined;
    if (Array.isArray(a)) topSeen.ids = new Set(a.map(String)); // the durable copy wins
  } catch (_) {}
}
function topSeenSave() {
  const arr = [...(topSeen.ids || [])];
  try { localStorage.setItem('topspawns_seen', JSON.stringify(arr)); } catch (_) {}
  try { api().set_config('topspawns_seen', arr); } catch (_) {}
}
function topSetPill(n) {
  const p = $('#nav-top-pill');
  if (!p) return;
  p.textContent = n;
  p.hidden = n <= 0;
  p.title = `${n} resource${n === 1 ? '' : 's'} new to the top spawns since you last looked`;
  if (typeof syncNavTips === 'function') syncNavTips();
  if (typeof syncNavGroupDots === 'function') syncNavGroupDots();
}
// everything ranking right now counts as seen (the page is open, or it's the very first run)
function topMarkSeen(ids) {
  topSeen.ids = new Set(ids.map(String));
  topSeenSave();
  topSetPill(0);
}
async function topSpawnsSweep() {
  await topSeenLoad();
  let res;
  try { res = await apiFetch('GET', 'api/topspawns.php'); } catch (_) { return; }
  const rows = (res.ok && res.data && res.data.results) || [];
  if (!res.ok || !rows.length) return;
  const ids = [...new Set(rows.map((r) => String(r.id ?? '')).filter(Boolean))];
  const onPage = document.getElementById('page-topspawns')?.classList.contains('active');
  if (!topSeen.ids || onPage) { topMarkSeen(ids); return; } // first run / already looking: nothing to flag
  const fresh = ids.filter((id) => !topSeen.ids.has(id));
  topSeen.fresh = new Set(fresh);
  // prune: ids that dropped out of the top spawns stop mattering
  const live = new Set(ids);
  topSeen.ids = new Set([...topSeen.ids].filter((id) => live.has(id)));
  topSetPill(fresh.length);
}

async function loadTopSpawns(force = false) {
  if (topState.loaded && !force) { renderTopSpawns(); return; }
  if (topState.loading) return;
  topState.loading = true;
  $('#top-loading').hidden = false; $('#top-empty').hidden = true;
  const params = {};
  if (topState.search) params.search = topState.search;
  if (topState.category) params.category = topState.category;
  if (topState.rankEq) params.rank_eq = topState.rankEq;   // one slice of the rank chart
  else if (topState.rank) params.rank = topState.rank;
  if (topState.section) params.section = topState.section;
  if (topState.hideMustafar) params.mustafar = '0';
  let res;
  try { res = await apiFetch('GET', 'api/topspawns.php', { params }); } catch (e) { res = { ok: false, error: String(e) }; }
  topState.loading = false;
  $('#top-loading').hidden = true;
  if (!res.ok || !res.data) {
    $('#top-empty').textContent = String(res.error || '').includes('404')
      ? 'Top Spawns needs the site update (api/topspawns.php) — it lights up once swgtracker.com deploys.'
      : `Error: ${res.error || 'failed to load'}`;
    $('#top-empty').hidden = false;
    $('#top-body').innerHTML = '';
    return;
  }
  topState.rows = res.data.results || [];
  topState.breakdown = res.data.breakdown || null;
  topState.hottest = res.data.hottest || null;
  topState.categories = res.data.categories || [];
  topState.hideMustafar = !!safeInt(res.data.hide_mustafar);
  topState.loaded = true;
  topState.shown = TOP_PAGE;
  topFillCategories();
  renderTopSpawns();
  topSeenLoad().then(() => {
    const ids = [...new Set(topState.rows.map((r) => String(r.id ?? '')).filter(Boolean))];
    const unfiltered = !topState.search && !topState.category && !topState.rank && !topState.rankEq && !topState.section;
    if (unfiltered) topMarkSeen([...new Set([...(topSeen.ids || []), ...ids])]); // a filtered load only adds what it showed
    else { ids.forEach((id) => topSeen.ids && topSeen.ids.add(id)); topSeenSave(); }
  });
}

function topFillCategories() {
  const sel = $('#top-category');
  const cur = topState.category;
  sel.innerHTML = '<option value="">All categories</option>'
    + topState.categories.map((c) => `<option value="${escapeHtml(c)}"${c === cur ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
}

const topRankClass = (r) => ({ 1: 'q-great', 2: 'q-good', 3: 'q-fair' }[safeInt(r)] || 'q-ok');

// one cell, by field — shared by the list rows and the tree's compact rows
function topCellHtml(r, f) {
    if (f === 'name') return `<td class="col-name res-name" data-resname="${escapeHtml(r.name || '')}">${escapeHtml(r.name || '')}${topSeen.fresh.has(String(r.id ?? '')) ? '<span class="top-newchip" title="New to the top spawns since you last looked">new</span>' : ''}</td>`;
    if (f === 'type_name') return `<td class="col-text res-type">${escapeHtml(r.type_name || '')}</td>`;
    if (f === 'schematic_name') return `<td class="col-name"><span class="top-schem" data-topschem="${safeInt(r.schematic_id)}" data-topschemname="${escapeHtml(r.schematic_name || '')}">${escapeHtml(r.schematic_name || '')}</span></td>`;
    if (f === 'formula_description') return `<td class="col-text top-formula" title="${escapeHtml(r.formula_description || '')}">${escapeHtml(r.formula_description || '')}</td>`;
    if (f === 'schematic_category') return `<td class="col-text"><span class="top-cat" data-topcat="${escapeHtml(r.schematic_category || '')}">${escapeHtml(r.schematic_category || '')}</span></td>`;
    if (f === 'section') return `<td class="col-text">${escapeHtml(r.section || '')}</td>`;
    if (f === 'rank') return `<td class="stat ${topRankClass(r.rank)}">#${safeInt(r.rank)}</td>`;
    if (f === 'value_rating') { const v = r.value_rating; return v == null || v === '' ? '<td class="stat stat_off">—</td>' : `<td class="stat ${qualityClass(safeInt(v))}">${safeInt(v)}</td>`; }
    if (f === 'planets') return `<td class="col-text col-planets">${planetsEditHtml(r)}</td>`;
    if (f === 'timestamp') return `<td class="col-text">${fmtAgoTip(safeInt(r.timestamp))}</td>`;
    return statCell(r[f], r[`${f}_max`]);
}
// Columns actually shown: the user's picks, minus any stat column that is blank
// for every row on screen — filter to Armor and FL/PE/CD vanish, filter to Chef
// and HR goes; a Chef resource that does carry HR brings the column back (Dustin).
function topLiveCols(rows) {
  const empty = new Set();
  for (const f of STAT_FIELDS) if (!rows.some((r) => safeInt(r[f]) > 0)) empty.add(f);
  return topCols.visible().filter(([, f]) => !empty.has(f));
}
function topRowHtml(r, cols) {
  const id = r.id ?? '';
  const cells = (cols || topCols.visible()).map(([, f]) => topCellHtml(r, f)).join('');
  return `<tr data-id="${id}"${topSeen.fresh.has(String(id)) ? ' class="top-new"' : ''}>${cells}</tr>`;
}
// the three breakdowns in the resource page's chart-card style (rd-pcard):
// horizontal bars with gridlines + axis for category and section, a donut for
// rank. Bars are HTML (labels never stretch); the donut is SVG at a fixed size.
// Every slice filters the list (click again to clear); each chart keeps all its
// slices while one is selected.
const TOP_RANK_COLORS = { 1: '#e24350', 2: '#7a8190', 3: '#555b68', 4: '#454a56', 5: '#353944' };
function topNiceStep(max) {
  const raw = max / 5; const pow = Math.pow(10, Math.floor(Math.log10(raw || 1)));
  const n = raw / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}
function topBarChart(items, key, activeVal) {
  const rows = items.slice(0, 8);
  if (!rows.length) return '<div class="empty-state is-compact">Nothing here yet.</div>';
  const max = Math.max(1, ...rows.map((x) => x.count));
  const step = topNiceStep(max), top = Math.ceil(max / step) * step || 1;
  const ticks = [];
  for (let v = 0; v <= top; v += step) ticks.push(v);
  const grid = ticks.map((v) => `<span class="top-gridline" style="left:${((v / top) * 100).toFixed(2)}%"></span>`).join('');
  const axis = ticks.map((v) => `<span class="top-tick" style="left:${((v / top) * 100).toFixed(2)}%">${v}</span>`).join('');
  const bars = rows.map((it) => `<div class="top-row${activeVal === it.name ? ' active' : ''}" data-topfilter="${key}" data-topval="${escapeHtml(it.name)}" title="${escapeHtml(it.name)} — ${fmtNum(it.count)}">
      <span class="top-label">${escapeHtml(it.name)}</span>
      <span class="top-track"><span class="top-fill" style="width:${((it.count / top) * 100).toFixed(2)}%"></span></span>
    </div>`).join('');
  return `<div class="top-hbars"><div class="top-plot"><div class="top-gridlayer">${grid}</div>${bars}</div><div class="top-axis"><span class="top-label"></span><span class="top-axisarea">${axis}</span></div></div>`;
}
function topDonut(ranks) {
  if (!ranks.length) return '<div class="empty-state is-compact">Nothing here yet.</div>';
  const total = ranks.reduce((s, r) => s + r.count, 0) || 1;
  const size = 176, cx = 88, cy = 88, r = 76, inner = 46;
  let a0 = -Math.PI / 2;
  const slices = ranks.map((rk) => {
    const frac = rk.count / total;
    const a1 = a0 + frac * Math.PI * 2;
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0), x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const xi0 = cx + inner * Math.cos(a1), yi0 = cy + inner * Math.sin(a1), xi1 = cx + inner * Math.cos(a0), yi1 = cy + inner * Math.sin(a0);
    const d = ranks.length === 1
      ? `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z M ${cx} ${cy - inner} A ${inner} ${inner} 0 1 0 ${cx} ${cy + inner} A ${inner} ${inner} 0 1 0 ${cx} ${cy - inner} Z`
      : `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi0} ${yi0} A ${inner} ${inner} 0 ${large} 0 ${xi1} ${yi1} Z`;
    a0 = a1;
    const active = String(topState.rankEq) === String(rk.rank);
    return `<path class="rd-pslice top-slice${active ? ' active' : ''}" d="${d}" fill="${TOP_RANK_COLORS[rk.rank] || '#777'}" fill-rule="evenodd" stroke="var(--bg-card)" stroke-width="2"
      data-topfilter="rank" data-topval="${rk.rank}"><title>Rank ${rk.rank} — ${fmtNum(rk.count)} (${Math.round(frac * 100)}%)</title></path>`;
  }).join('');
  const legend = `<ul class="rd-plegend">${ranks.map((rk) => `<li class="top-legend-item${String(topState.rankEq) === String(rk.rank) ? ' active' : ''}" data-topfilter="rank" data-topval="${rk.rank}"><span class="rd-pdot" style="background:${TOP_RANK_COLORS[rk.rank] || '#777'}"></span>Rank ${rk.rank} <span class="rd-pmuted">${fmtNum(rk.count)}</span></li>`).join('')}</ul>`;
  return `<div class="rd-pchart rd-pdonutwrap top-donutwrap"><svg class="rd-pdonut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${slices}</svg>${legend}</div>`;
}
// the strip under the charts: who tops the most schematics, which schematics
// have the most top resources — over the whole board (the server's list), so
// a filter highlights rather than shrinks it
function topHottestHtml() {
  const h = topState.hottest || { resources: [], schematics: [] };
  // each entry a step fainter than the one before — the leader stands out on its own
  const res = (h.resources || []).slice(0, 5).map((x, i) => `<span class="top-hot top-hot-${i} res-name" data-resname="${escapeHtml(x.name)}">${escapeHtml(x.name)}<span class="top-hot-n">${x.count}</span></span>`).join('');
  const sch = (h.schematics || []).slice(0, 5).map((x, i) => `<span class="top-hot top-hot-${i} top-schem" data-topschem="${safeInt(x.id)}" data-topschemname="${escapeHtml(x.name)}">${escapeHtml(x.name)}<span class="top-hot-n">${x.count}</span></span>`).join('');
  if (!res && !sch) return '';
  return `<div class="rd-pcard top-hotcard"><h6 class="rd-ptitle"><i class="fa-solid fa-fire"></i> Hottest resources</h6><div class="top-hotlist">${res}</div></div>
    <div class="rd-pcard top-hotcard"><h6 class="rd-ptitle"><i class="fa-solid fa-scroll"></i> Hottest schematics</h6><div class="top-hotlist">${sch}</div></div>`;
}
function topBreakdownHtml() {
  const b = topState.breakdown;
  if (!b) return '';
  const card = (icon, title, html) => `<div class="rd-pcard"><h6 class="rd-ptitle"><i class="fa-solid ${icon}"></i> ${title} <span class="rd-pmuted">(click to filter)</span></h6>${html}</div>`;
  return `<div class="top-charts">${card('fa-layer-group', 'By category', topBarChart(b.categories || [], 'category', topState.category))}${card('fa-cubes', 'By section', topBarChart(b.sections || [], 'section', topState.section))}${card('fa-ranking-star', 'By rank', topDonut(b.ranks || []))}</div>
    <div class="top-hotrow">${topHottestHtml()}</div>`;
}

// cards: resource + schematic, rank badge, score + the visible stats as mini bars, planets
function topCardHtml(r) {
  const show = new Set(topCols.visible().map((c) => c[1]));
  const bars = [];
  for (const [, f] of topCols.visible()) {
    if (!STAT_FIELDS.has(f) && f !== 'value_rating') continue;
    const raw = f === 'value_rating' ? r.value_rating : r[f];
    const v = safeInt(raw);
    if (raw == null || v <= 0) continue;
    const pct = f === 'value_rating' ? v : (v / (safeInt(r[`${f}_max`]) || 1000)) * 100;
    const q = qualityClass(pct);
    bars.push(`<div class="res-cbar"><span class="res-cbar-l">${f === 'value_rating' ? 'Score' : f.toUpperCase()}</span><span class="res-cbar-track" title="${pct.toFixed(0)}% of cap"><span class="res-cbar-fill ${q}" style="width:${Math.max(3, Math.min(100, Math.round(pct)))}%"></span></span><span class="res-cbar-v ${q}">${v}</span></div>`);
  }
  return `<div class="res-card top-card" data-id="${r.id ?? ''}">
    <div class="res-card-head">
      <span class="top-card-rank ${topRankClass(r.rank)}">#${safeInt(r.rank)}</span>
      <span class="res-card-name res-name" data-resname="${escapeHtml(r.name || '')}">${escapeHtml(r.name || '')}</span>
    </div>
    ${show.has('type_name') ? `<div class="res-card-type">${escapeHtml(r.type_name || '')}</div>` : ''}
    ${show.has('schematic_name') ? `<div class="top-card-schem">for <span class="top-schem" data-topschem="${safeInt(r.schematic_id)}" data-topschemname="${escapeHtml(r.schematic_name || '')}">${escapeHtml(r.schematic_name || '')}</span>${show.has('schematic_category') && r.schematic_category ? ` <span class="top-card-cat top-cat" data-topcat="${escapeHtml(r.schematic_category)}">${escapeHtml(r.schematic_category)}</span>` : ''}</div>` : ''}
    ${show.has('formula_description') && r.formula_description ? `<div class="top-card-formula">${escapeHtml(r.formula_description)}</div>` : ''}
    ${bars.length ? `<div class="res-card-bars">${bars.join('')}</div>` : ''}
    <div class="res-card-foot">${show.has('timestamp') ? `<span class="res-card-days" title="${escapeHtml(agoText(r.timestamp, 'Spawned'))}"><i class="fa-solid fa-clock"></i> ${escapeHtml(resCardDays(r))}</span>` : '<span></span>'}${show.has('planets') ? `<span class="res-card-planets">${planetsEditHtml(r)}</span>` : ''}</div>
  </div>`;
}
// tree: schematic category › schematic › its top resources (compact rows)
function topTreeHtml(rows) {
  const cats = new Map();
  rows.forEach((r) => {
    const cat = r.schematic_category || 'Other';
    if (!cats.has(cat)) cats.set(cat, new Map());
    const sch = cats.get(cat);
    const k = `${r.schematic_id}|${r.schematic_name}`;
    if (!sch.has(k)) sch.set(k, []);
    sch.get(k).push(r);
  });
  const col = topState.treeCollapsed;
  const node = (code, label, count, depth, extra = '') => `<div class="res-tree-node" data-treecode="${escapeHtml(code)}" style="padding-left:${depth * 15 + 8}px">
      <i class="fa-solid ${col.has(code) ? 'fa-caret-right' : 'fa-caret-down'} res-tree-caret"></i>
      <span class="res-tree-name">${label}</span>${extra}<span class="res-tree-count">${count}</span></div>`;
  const leaf = (r, depth) => `<div class="top-tree-item" style="padding-left:${depth * 15 + 8}px">
      <span class="top-card-rank ${topRankClass(r.rank)}">#${safeInt(r.rank)}</span>
      <span class="res-name top-tree-name" data-resname="${escapeHtml(r.name || '')}">${escapeHtml(r.name || '')}</span>
      <span class="res-type top-tree-type">${escapeHtml(r.type_name || '')}</span>
      <span class="top-tree-formula" title="${escapeHtml(r.formula_description || '')}">${escapeHtml(r.formula_description || '')}</span>
      <span class="stat ${qualityClass(safeInt(r.value_rating))} top-tree-score" title="Score">${r.value_rating == null || r.value_rating === '' ? '—' : safeInt(r.value_rating)}</span>
      <span class="top-tree-planets">${planetsHtml(r)}</span></div>`;
  let html = '';
  [...cats.entries()].sort((a, b) => a[0].localeCompare(b[0])).forEach(([cat, sch]) => {
    const catCode = `cat:${cat}`;
    const n = [...sch.values()].reduce((s, a) => s + a.length, 0);
    html += node(catCode, escapeHtml(cat), n, 0);
    if (col.has(catCode)) return;
    [...sch.entries()].sort((a, b) => a[0].split('|')[1].localeCompare(b[0].split('|')[1])).forEach(([k, items]) => {
      const [id, name] = k.split('|');
      const schCode = `sch:${id}`;
      html += node(schCode, `<span class="top-schem" data-topschem="${safeInt(id)}" data-topschemname="${escapeHtml(name)}">${escapeHtml(name)}</span>`, items.length, 1);
      if (col.has(schCode)) return;
      html += items.slice().sort((a, b) => safeInt(a.rank) - safeInt(b.rank)).map((r) => leaf(r, 2)).join('');
    });
  });
  return html || '<div class="empty-state">Nothing matches these filters.</div>';
}

function renderTopSpawns() {
  const liveCols = topLiveCols(topState.rows);
  $('#top-head').innerHTML = sortableHeaderHtml(liveCols, topState.sortField, topState.sortOrder);
  $('#top-breakdown').innerHTML = topBreakdownHtml();
  $('#top-breakdown').hidden = !topState.chartsOpen;
  $('#top-breakdown-section').classList.toggle('collapsed', !topState.chartsOpen);
  $('#top-mustafar').classList.toggle('active', topState.hideMustafar);
  $('#top-mustafar').title = topState.hideMustafar ? 'Mustafarian resources hidden — click to show them' : 'Hide Mustafarian resources';
  const rows = gxSortRows(topState.rows, topState.sortField, topState.sortOrder, TOP_NUMERIC);
  const shown = rows.slice(0, topState.shown);
  const view = topState.view;
  document.querySelectorAll('#top-view-switch .res-view-btn').forEach((b) => b.classList.toggle('active', b.dataset.topview === view));
  $('#top-grid').hidden = view !== 'list';
  $('#top-cards').hidden = view === 'list';
  $('#top-cards').classList.toggle('res-treewrap', view === 'tree');
  if (view === 'list') $('#top-body').innerHTML = shown.map((r) => topRowHtml(r, liveCols)).join('');
  else if (view === 'cards') $('#top-cards').innerHTML = shown.length ? `<div class="res-card-grid">${shown.map(topCardHtml).join('')}</div>` : '';
  else $('#top-cards').innerHTML = topTreeHtml(rows);   // the tree shows everything — it's already grouped
  $('#top-more').hidden = view === 'tree';
  $('#top-count').textContent = rows.length ? `${fmtNum(rows.length)} top spawn${rows.length === 1 ? '' : 's'}` : '';
  const more = $('#top-more');
  if (view !== 'tree') more.hidden = rows.length <= topState.shown;
  if (!more.hidden) more.textContent = `Show ${fmtNum(Math.min(TOP_PAGE, rows.length - topState.shown))} more of ${fmtNum(rows.length - topState.shown)}`;
  $('#top-empty').textContent = 'Nothing matches these filters.';
  $('#top-empty').hidden = rows.length > 0;
}

function initTopSpawns() {
  // the NEW chips last for one visit: leaving the page forgets them
  document.addEventListener('page:show', (e) => { if (e.detail?.key !== 'topspawns' && topSeen.fresh.size) topSeen.fresh = new Set(); });
  let searchTimer = null;
  $('#top-search').addEventListener('input', () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => { topState.search = $('#top-search').value.trim(); loadTopSpawns(true); }, 300);
  });
  $('#top-category').addEventListener('change', () => { topState.category = $('#top-category').value; loadTopSpawns(true); });
  $('#top-rank').addEventListener('change', () => { topState.rank = $('#top-rank').value; loadTopSpawns(true); });
  $('#top-mustafar').addEventListener('click', () => { topState.hideMustafar = !topState.hideMustafar; loadTopSpawns(true); });
  $('#top-reload').addEventListener('click', () => loadTopSpawns(true));
  $('#top-more').addEventListener('click', () => { topState.shown += TOP_PAGE; renderTopSpawns(); });
  gxSortClick(topState, '#top-head', () => { topState.shown = TOP_PAGE; renderTopSpawns(); });
  $('#top-view-switch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-topview]');
    if (!b) return;
    topState.view = b.dataset.topview;
    try { localStorage.setItem('top-view', topState.view); } catch (_) {}
    renderTopSpawns();
  });
  wireColPicker(topCols, { btn: '#top-cols-btn', modal: '#top-cols-modal', list: '#top-cols-list', reset: '#top-cols-reset', close: '#top-cols-x', rerender: renderTopSpawns });
  wirePlanetEdit('#top-cards', () => topState.rows);
  $('#top-cards').addEventListener('click', (e) => {
    if (e.target.closest('[data-planetedit]')) return;
    const node = e.target.closest('.res-tree-node[data-treecode]');
    if (node && !e.target.closest('[data-topschem]')) {
      const c = node.dataset.treecode;
      if (topState.treeCollapsed.has(c)) topState.treeCollapsed.delete(c); else topState.treeCollapsed.add(c);
      renderTopSpawns(); return;
    }
    const schem = e.target.closest('[data-topschem]');
    if (schem) { openSchematicPage(safeInt(schem.dataset.topschem), schem.dataset.topschemname); return; }
    const cat = e.target.closest('[data-topcat]');
    if (cat) { topState.category = cat.dataset.topcat; $('#top-category').value = topState.category; loadTopSpawns(true); return; }
    const name = e.target.closest('[data-resname]');
    if (name) openResourcePage(name.dataset.resname);
  });

  // every chart filters the list (click again to clear); the rank picker is
  // "at or above", a rank slice is exactly that rank
  $('#top-breakdown').addEventListener('click', (e) => {
    const schem = e.target.closest('[data-topschem]');
    if (schem) { openSchematicPage(safeInt(schem.dataset.topschem), schem.dataset.topschemname); return; }
    const name = e.target.closest('[data-resname]');
    if (name) { openResourcePage(name.dataset.resname); return; }
    const el = e.target.closest('[data-topfilter]');
    if (!el) return;
    const v = el.dataset.topval;
    if (el.dataset.topfilter === 'category') { topState.category = topState.category === v ? '' : v; $('#top-category').value = topState.category; }
    else if (el.dataset.topfilter === 'section') { topState.section = topState.section === v ? '' : v; }
    else { topState.rankEq = String(topState.rankEq) === v ? '' : v; topState.rank = ''; $('#top-rank').value = ''; }
    loadTopSpawns(true);
  });
  $('#top-rank').addEventListener('change', () => { topState.rankEq = ''; });
  $('#top-charts-toggle').addEventListener('click', () => {
    topState.chartsOpen = !topState.chartsOpen;
    try { localStorage.setItem('top_charts', topState.chartsOpen ? '1' : '0'); } catch (_) {}
    renderTopSpawns();
  });

  wirePlanetEdit('#top-body', () => topState.rows);
  $('#top-body').addEventListener('click', async (e) => {
    if (e.target.closest('[data-planetedit]')) return;
    const schem = e.target.closest('[data-topschem]');
    if (schem) { openSchematicPage(safeInt(schem.dataset.topschem), schem.dataset.topschemname); return; }
    const cat = e.target.closest('[data-topcat]');
    if (cat) { topState.category = cat.dataset.topcat; $('#top-category').value = topState.category; loadTopSpawns(true); return; }
    const name = e.target.closest('[data-resname]');
    if (name) openResourcePage(name.dataset.resname);
  });
}
