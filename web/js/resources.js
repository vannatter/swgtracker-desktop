/* Resources page — mirrors src/gui/resources_tab.py. */

const PLANETS = ['Corellia', 'Dantooine', 'Dathomir', 'Endor', 'Kashyyyk',
  'Lok', 'Mustafar', 'Naboo', 'Rori', 'Talus', 'Tatooine', 'Yavin IV'];
// Fallback if categories.php is unreachable — codes the server's category filter
// accepts (it matches level codes, not display names).
const RESOURCE_CATEGORY_FALLBACK = [
  ['regy', 'Renewable Energy'], ['chm', 'Chemical'], ['gas', 'Gas'], ['min', 'Mineral'],
  ['wtr', 'Water Vapor'], ['crs', 'Creature Resources'], ['frs', 'Flora Resource'],
  ['achm', 'Asteroidal Chemical'], ['agas', 'Asteroidal Gas'],
  ['agem', 'Asteroidal Gemstone'], ['amin', 'Asteroidal Mineral'],
];

// Restoration's 8 JTL space-resource classes (wiki + the site's gen_restree.php):
// higher caps (stats run 1–1000), long 13–21 day spawns, one planet at a time.
const JTL_CODES = new Set(['bistl', 'hastl', 'pealu', 'cbcpr', 'grfib', 'uoktv', 'fesil', 'hpkrd']);
const JTL_TIP = 'JTL (Jump to Lightspeed) space resource — higher caps (stats run 1–1000), '
  + 'long 13–21 day spawns, and only one planet at a time';
function jtlChip(typeCode) {
  return JTL_CODES.has(String(typeCode || '')) ? ` <span class="res-jtl" title="${JTL_TIP}">JTL</span>` : '';
}

// planet_* columns in site display order; badge shows the first letter like the site
// (color disambiguates the D/D and T/T pairs; full name in the tooltip)
const PLANET_KEYS = [
  'planet_corellia', 'planet_dantooine', 'planet_dathomir', 'planet_endor',
  'planet_lok', 'planet_naboo', 'planet_rori', 'planet_talus',
  'planet_tatooine', 'planet_yavin4', 'planet_kashyyyk', 'planet_mustafar',
];

// (label, field, css-class) — stat columns get quality coloring
const RES_COLUMNS = [
  ['Name', 'name', 'col-name'],
  ['Type', 'type_name', 'col-text'],
  ['<i class="fa-solid fa-circle-half-stroke" title="In spawn (active) / despawned (inactive)"></i>', 'status', 'col-status'],
  ['Score', 'score', 'stat'],
  ['OQ', 'oq', 'stat'], ['CR', 'cr', 'stat'], ['CD', 'cd', 'stat'],
  ['DR', 'dr', 'stat'], ['HR', 'hr', 'stat'], ['MA', 'ma', 'stat'],
  ['SR', 'sr', 'stat'], ['UT', 'ut', 'stat'], ['FL', 'fl', 'stat'],
  ['PE', 'pe', 'stat'],
  ['Planets', 'planets', 'col-text'],
];

// sortField '' = the server's default order
// filters: structured search terms (stat / ignore / date) composed into the
//   server `search` param alongside the name box. savedSearches: named filter
//   sets persisted to config.
// the site's 16 recycled canonical types (source=9 server-side; the mirror
// doesn't carry source, but these class codes hold nothing except that row)
const RES_RECYCLED_CODES = new Set(['hmlk', 'pmet', 'gbne', 'ghrn', 'shid', 'pcer', 'mveg', 'mfrt',
  'bwod', 'cchm', 'swtr', 'dspc', 'crad', 'sfer', 'snfr', 'lgem']);

const resState = {
  page: 1, perPage: 50, hasNext: false, pinned: new Set(),
  sortField: '', sortOrder: 'DESC', filters: [], savedSearches: [],
  statusFilter: null, // null = auto (active, or all when filtering); or 'active'/'inactive'/'all'
  colOrder: null, colHidden: new Set(), // user column layout (persisted to localStorage)
};

// --- column layout (show/hide + reorder, saved per machine) ---
// 'name' is locked visible; everything else is user-toggleable. A plain-English
// label for the stat codes so the column picker reads clearly.
const RES_COL_LABELS = {
  name: 'Name', type_name: 'Type', status: 'In spawn', score: 'Score',
  oq: 'Overall Quality (OQ)', cr: 'Cold Resist (CR)', cd: 'Conductivity (CD)',
  dr: 'Decay Resist (DR)', hr: 'Heat Resist (HR)', ma: 'Malleability (MA)',
  sr: 'Shock Resist (SR)', ut: 'Unit Toughness (UT)', fl: 'Flavor (FL)',
  pe: 'Potential Energy (PE)', planets: 'Planets',
};
const RES_COL_LOCKED = new Set(['name']);

function resColLabel(field) { return RES_COL_LABELS[field] || field; }
function resDefaultColOrder() { return RES_COLUMNS.map((c) => c[1]); }

function resLoadColPref() {
  try {
    const p = JSON.parse(localStorage.getItem('res-colpref') || 'null');
    if (p && Array.isArray(p.order)) {
      resState.colOrder = p.order;
      resState.colHidden = new Set(Array.isArray(p.hidden) ? p.hidden : []);
      return;
    }
  } catch (_) { /* fall through to defaults */ }
  resState.colOrder = resDefaultColOrder();
  resState.colHidden = new Set();
}
function resSaveColPref() {
  try {
    localStorage.setItem('res-colpref',
      JSON.stringify({ order: resState.colOrder, hidden: [...resState.colHidden] }));
  } catch (_) { /* best effort */ }
}

// Effective column tuples [label, field, cls] in the user's order, hidden ones
// dropped. New columns added to RES_COLUMNS later still appear (appended).
function resCols() {
  if (!resState.colOrder) resLoadColPref();
  const byField = new Map(RES_COLUMNS.map((c) => [c[1], c]));
  const ordered = [];
  const seen = new Set();
  for (const f of resState.colOrder) { if (byField.has(f) && !seen.has(f)) { ordered.push(byField.get(f)); seen.add(f); } }
  for (const c of RES_COLUMNS) { if (!seen.has(c[1])) ordered.push(c); }
  return ordered.filter((c) => RES_COL_LOCKED.has(c[1]) || !resState.colHidden.has(c[1]));
}

// the full column list in the user's current order (hidden ones included) —
// what the picker shows
function resColsAll() {
  if (!resState.colOrder) resLoadColPref();
  const byField = new Map(RES_COLUMNS.map((c) => [c[1], c]));
  const out = []; const seen = new Set();
  for (const f of resState.colOrder) { if (byField.has(f) && !seen.has(f)) { out.push(byField.get(f)); seen.add(f); } }
  for (const c of RES_COLUMNS) { if (!seen.has(c[1])) out.push(c); }
  return out;
}

// re-render the grid/cards in place after a column or view change (no refetch)
function resRerender() {
  buildResHeader();
  const rows = resState.lastRows || [];
  $('#res-body').innerHTML = rows.map(resRowHtml).join('');
  resWpCounts().then(resAnnotateWaypoints);
  resApplyView();
}

// ---- view modes: list (table) | cards | grouped-by-type ----
function resLoadView() {
  try { resState.view = localStorage.getItem('res-view') || 'list'; } catch (_) { resState.view = 'list'; }
  // a persisted tree view needs the bigger page size before the first load
  if (resState.view === 'tree') { resState.prevPerPage = 50; resState.perPage = 500; }
  // config is the durable store (survives even if the WebView clears localStorage);
  // honor it once it answers, re-rendering only if it differs from what we loaded
  (async () => {
    try {
      const cfg = await api().get_config();
      const v = cfg && cfg.ok && cfg.data && cfg.data.resource_view;
      if (!v || v === resState.view) return;
      resState.view = v;
      try { localStorage.setItem('res-view', v); } catch (_) { /* ignore */ }
      if (v === 'tree' && resState.perPage !== 500) {
        resState.prevPerPage = 50; resState.perPage = 500; resState.page = 1; loadResources();
      } else {
        resApplyView();
      }
    } catch (_) { /* no config bridge — localStorage stands */ }
  })();
}
function resSaveView(v) {
  try { localStorage.setItem('res-view', v); } catch (_) { /* ignore */ }
  try { api().set_config('resource_view', v); } catch (_) { /* ignore */ }
}
// "N days in spawn" (human) for active rows; despawned rows say so
function resCardDays(res) {
  const isActive = String(res.status ?? res.active ?? res.is_active ?? '0') === '1';
  if (!isActive) return 'Despawned';
  const ts = safeInt(res.timestamp);
  if (ts <= 0) return '';
  const days = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 86400));
  if (days === 0) return 'In spawn <1 day';
  return `${days} day${days === 1 ? '' : 's'} in spawn`;
}

function resCardHtml(res) {
  const id = res.id ?? '';
  const isActive = String(res.status ?? res.active ?? res.is_active ?? '0') === '1';
  const cols = resCols().map((c) => c[1]);
  const show = (f) => cols.includes(f);
  // mini quality bars for visible score+stat columns; zeros/blanks hidden
  const bars = [];
  for (const [, f] of resCols()) {
    if (f !== 'score' && !STAT_FIELDS.has(f)) continue;
    const raw = f === 'score' ? res.score : res[f];
    const v = safeInt(raw);
    if (raw == null || v <= 0) continue; // hide anything that's 0 or blank
    // quality is value vs the stat's CAP (score is already a 0–100 overall score)
    const pctQ = f === 'score' ? v : (v / (safeInt(res[`${f}_max`]) || 1000)) * 100;
    const q = qualityClass(pctQ);
    const width = Math.max(3, Math.min(100, Math.round(pctQ)));
    bars.push(`<div class="res-cbar">
      <span class="res-cbar-l">${f === 'score' ? 'Score' : f.toUpperCase()}</span>
      <span class="res-cbar-track" title="${pctQ.toFixed(0)}% of cap"><span class="res-cbar-fill ${q}" style="width:${width}%"></span></span>
      <span class="res-cbar-v ${q}">${v}</span>
    </div>`);
  }
  const type = show('type_name') && res.type_name
    ? (res.type_code
      ? `<div class="res-card-type"><span class="res-typelink" data-navcat="${escapeHtml(res.type_code)}">${escapeHtml(res.type_name)}</span></div>`
      : `<div class="res-card-type">${escapeHtml(res.type_name)}</div>`)
    : '';
  const days = resCardDays(res);
  const planets = show('planets') ? `<span class="res-card-planets">${planetsHtml(res)}</span>` : '';
  const spawnTip = isActive ? ` title="${escapeHtml(agoText(res.timestamp))}"` : '';
  const foot = (days || planets)
    ? `<div class="res-card-foot">
        ${days ? `<span class="res-card-days ${isActive ? '' : 'res-card-gone'}"${spawnTip}><i class="fa-solid fa-clock"></i> ${escapeHtml(days)}</span>` : '<span></span>'}
        ${planets}
      </div>`
    : '';
  const isPinned = resState.pinned.has(String(id));
  const isWished = typeof wishState !== 'undefined' && wishState.resourceIds.has(String(id));
  const isStocked = typeof stkState !== 'undefined' && stkState.resourceIds.has(String(id));
  const isHot = safeInt(res.topcount) > 0; // top spawn — the list view shows a sub-count
  const mark = isPinned ? 'res-card-pinned' : isStocked ? 'res-card-stocked' : isWished ? 'res-card-wished' : '';
  return `<div class="res-card ${mark}${isHot ? ' res-card-hot' : ''}" data-id="${id}">
    <div class="res-card-head">
      <i class="fa-solid fa-thumbtack res-card-pin ${isPinned ? 'pinned-star' : ''}" data-pin="${escapeHtml(String(id))}" title="Pin"></i>
      ${isHot ? `<i class="fa-solid fa-fire res-card-flame" title="Hot — top resource for ${safeInt(res.topcount)} schematic${safeInt(res.topcount) === 1 ? '' : 's'}"></i>` : ''}
      <span class="res-card-name res-name" data-resname="${escapeHtml(res.name || '')}" data-resid="${escapeHtml(String(id))}">${escapeHtml(res.name || '')}</span>
      ${isStocked ? '<i class="fa-solid fa-cubes res-card-mark res-card-stock" title="In your stockpile"></i>' : ''}
      ${isWished ? '<i class="fa-solid fa-heart res-card-mark res-card-wish" title="On your wishlist"></i>' : ''}
      ${show('status') ? `<i class="fa-solid fa-circle res-status ${isActive ? 'on' : 'off'}" title="${isActive ? 'Active — in spawn' : 'Inactive — despawned'}"></i>` : ''}
    </div>
    ${type}
    ${bars.length ? `<div class="res-card-bars">${bars.join('')}</div>` : ''}
    ${foot}
  </div>`;
}
function resApplyView() {
  const view = resState.view || 'list';
  resSyncSort();
  // the tree sorts by category hierarchy, so the flat sort control doesn't apply
  const showSort = view !== 'tree';
  const ss = $('#res-sort'); const sd = $('#res-sort-dir');
  if (ss) ss.style.display = showSort ? '' : 'none';
  if (sd) sd.style.display = showSort ? '' : 'none';
  document.querySelectorAll('#res-view-switch .res-view-btn').forEach((b) => b.classList.toggle('active', b.dataset.resview === view));
  const tw = $('#res-tablewrap'); const cards = $('#res-cards');
  const pager = document.querySelector('#page-resources .pager');
  if (pager) pager.style.display = view === 'tree' ? 'none' : ''; // tree isn't paginated
  if (view === 'list') { if (tw) tw.style.display = ''; if (cards) { cards.hidden = true; cards.classList.remove('res-treewrap'); } return; }
  if (tw) tw.style.display = 'none';
  if (!cards) return;
  cards.hidden = false;
  const rows = resState.lastRows || [];
  if (view === 'tree') { renderResTree(cards, rows); return; }
  cards.classList.remove('res-treewrap');
  if (!rows.length) { cards.innerHTML = '<div class="grid-empty">No resources.</div>'; return; }
  cards.innerHTML = `<div class="res-card-grid">${rows.map(resCardHtml).join('')}</div>`;
}

// ---- category tree view ----
// Build (and cache) the class hierarchy as code -> {desc, parent, children, isType}.
async function resEnsureCatTree() {
  if (resState.catTree) return resState.catTree;
  let flat = null; let types = [];
  try {
    const res = await api().get_categories();
    flat = res.ok ? (res.data && res.data.resource_tree_flat) : null;
    types = (res.ok && res.data && res.data.resource_types) || [];
  } catch (_) { /* offline */ }
  if (!flat || !flat.length) return null;
  const typeName = new Map(types.map((t) => [t.resource_code, t.resource_name || '']));
  const nodes = new Map();
  for (const row of flat) {
    const chain = [];
    for (let i = 1; i <= 6; i++) { const c = row[`level${i}`], d = row[`level${i}_description`]; if (!c || !d) break; chain.push([c, d]); }
    chain.forEach(([c, d], i) => { if (!nodes.has(c)) nodes.set(c, { code: c, desc: d, parent: i ? chain[i - 1][0] : null, children: [], isType: false }); });
    if (chain.length && row.code && !nodes.has(row.code)) {
      const tn = (typeName.get(row.code) || '').trim();
      if (tn) nodes.set(row.code, { code: row.code, desc: tn, parent: chain[chain.length - 1][0], children: [], isType: true });
    }
  }
  const roots = [];
  for (const [code, n] of nodes) { if (n.parent && nodes.has(n.parent)) nodes.get(n.parent).children.push(code); else roots.push(code); }
  resState.catTree = { nodes, roots };
  return resState.catTree;
}

// the score + stat columns currently visible (user's column order), for the
// tree's fixed stat columns — stats matter more than planets, so planets trails
function resTreeStatCols() {
  return resCols().filter(([, f]) => f === 'score' || STAT_FIELDS.has(f));
}
function resTreeShowPlanets() { return resCols().some(([, f]) => f === 'planets'); }
function resTreeColLabel(f) { return f === 'score' ? 'SC' : f.toUpperCase(); }

function resTreeHeaderHtml() {
  const cells = resTreeStatCols().map(([, f]) => `<span class="res-tree-cell">${resTreeColLabel(f)}</span>`).join('');
  return `<div class="res-tree-header">
    <span class="res-tree-h-name">Resource</span>
    <span class="res-tree-cells">${cells}${resTreeShowPlanets() ? '<span class="res-tree-planetscell">Planets</span>' : ''}</span>
  </div>`;
}

function resTreeItemHtml(r, depth) {
  const isActive = String(r.status ?? r.active ?? r.is_active ?? '0') === '1';
  const cells = resTreeStatCols().map(([, f]) => {
    const raw = f === 'score' ? r.score : r[f];
    const v = safeInt(raw);
    if (raw == null || v <= 0) return '<span class="res-tree-cell stat_off">—</span>';
    const pctQ = f === 'score' ? v : (v / (safeInt(r[`${f}_max`]) || 1000)) * 100;
    return `<span class="res-tree-cell ${qualityClass(pctQ)}">${v}</span>`;
  }).join('');
  const planets = resTreeShowPlanets() ? `<span class="res-tree-planetscell">${planetsHtml(r)}</span>` : '';
  return `<div class="res-tree-item">
    <span class="res-tree-itemlabel" style="padding-left:${depth * 15 + 12}px">
      <i class="fa-solid fa-thumbtack res-tree-pin ${resState.pinned.has(String(r.id)) ? 'pinned-star' : ''}" data-pin="${escapeHtml(String(r.id ?? ''))}" title="Pin"></i>
      <i class="fa-solid fa-circle res-status ${isActive ? 'on' : 'off'}"${isActive ? ` title="${escapeHtml(agoText(r.timestamp))}"` : ''}></i>
      <span class="res-name res-tree-itemname" data-resname="${escapeHtml(r.name || '')}" data-resid="${escapeHtml(String(r.id ?? ''))}">${escapeHtml(r.name || '')}</span>
    </span>
    <span class="res-tree-cells">${cells}${planets}</span>
  </div>`;
}

async function renderResTree(container, rows) {
  if (!resState.treeCollapsed) resState.treeCollapsed = new Set();
  const tree = await resEnsureCatTree();
  if (!tree) { container.innerHTML = '<div class="grid-empty">Category tree unavailable offline.</div>'; return; }
  if (resState.view !== 'tree') return; // navigated away while fetching
  container.classList.add('res-treewrap');
  const { nodes, roots } = tree;
  const byNode = new Map(); const unmatched = new Map();
  for (const r of rows) {
    const code = r.type_code;
    if (code && nodes.has(code)) { if (!byNode.has(code)) byNode.set(code, []); byNode.get(code).push(r); }
    else { const k = r.type_name || 'Other'; if (!unmatched.has(k)) unmatched.set(k, []); unmatched.get(k).push(r); }
  }
  const countCache = new Map();
  const subCount = (code) => {
    if (countCache.has(code)) return countCache.get(code);
    const n = nodes.get(code);
    let c = (byNode.get(code) || []).length;
    for (const ch of n.children) c += subCount(ch);
    countCache.set(code, c); return c;
  };
  const byDesc = (a, b) => nodes.get(a).desc.localeCompare(nodes.get(b).desc);
  const collapsed = resState.treeCollapsed;
  const liveKids = (code) => nodes.get(code).children.filter((ch) => subCount(ch) > 0).sort(byDesc);
  const renderNode = (code, depth) => {
    const cnt = subCount(code);
    if (!cnt) return ''; // prune branches with no matching in-spawn resources
    // collapse a linear chain of single-child categories into one breadcrumb row
    // (SWG class paths are deep; this kills the one-child-per-row sprawl)
    const labels = [nodes.get(code).desc];
    let cur = code;
    while ((byNode.get(cur) || []).length === 0 && liveKids(cur).length === 1) {
      cur = liveKids(cur)[0];
      labels.push(nodes.get(cur).desc);
    }
    const isCol = collapsed.has(cur);
    const label = labels.map(escapeHtml).join(' <span class="res-tree-sep">›</span> ');
    const head = `<div class="res-tree-node" data-treecode="${escapeHtml(cur)}" style="padding-left:${depth * 15 + 8}px">
      <i class="fa-solid ${isCol ? 'fa-caret-right' : 'fa-caret-down'} res-tree-caret"></i>
      <span class="res-tree-name">${label}</span>
      <span class="res-tree-count">${cnt}</span></div>`;
    if (isCol) return head;
    const kids = liveKids(cur).map((ch) => renderNode(ch, depth + 1)).join('');
    const own = (byNode.get(cur) || []).slice().sort((a, b) => safeInt(b.score) - safeInt(a.score))
      .map((r) => resTreeItemHtml(r, depth + 1)).join('');
    return head + kids + own;
  };
  let body = roots.slice().sort(byDesc).map((c) => renderNode(c, 0)).join('');
  for (const [name, items] of unmatched) {
    body += `<div class="res-tree-node res-tree-unmatched" style="padding-left:8px">
      <span class="res-tree-name">${escapeHtml(name)}</span><span class="res-tree-count">${items.length}</span></div>`;
    body += items.slice().sort((a, b) => safeInt(b.score) - safeInt(a.score)).map((r) => resTreeItemHtml(r, 1)).join('');
  }
  container.innerHTML = body
    ? resTreeHeaderHtml() + body
    : '<div class="grid-empty">No resources match.</div>';
}

// sort control (drives the server sort for every view — the only way to sort
// cards/tree, which have no column headers)
const RES_SORT_FIELDS = ['score', 'timestamp', 'oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe', 'name', 'type_name'];
const RES_SORT_LABELS = { timestamp: 'Spawn date' };
function resPopulateSort() {
  const sel = $('#res-sort');
  if (!sel) return;
  sel.innerHTML = '<option value="">Default order</option>'
    + RES_SORT_FIELDS.map((f) => `<option value="${f}">${escapeHtml(RES_SORT_LABELS[f] || resColLabel(f))}</option>`).join('');
}
function resSyncSort() {
  const sel = $('#res-sort');
  if (sel) sel.value = resState.sortField || '';
  const i = document.querySelector('#res-sort-dir i');
  if (i) i.className = `fa-solid fa-arrow-${resState.sortOrder === 'ASC' ? 'up-short-wide' : 'down-wide-short'}`;
}

function initResViews() {
  resLoadView();
  resPopulateSort();
  resSyncSort();
  $('#res-sort').addEventListener('change', () => {
    resState.sortField = $('#res-sort').value;
    resState.page = 1;
    loadResources();
  });
  $('#res-sort-dir').addEventListener('click', () => {
    resState.sortOrder = resState.sortOrder === 'ASC' ? 'DESC' : 'ASC';
    resState.page = 1;
    loadResources();
  });
  $('#res-view-switch').addEventListener('click', (e) => {
    const b = e.target.closest('[data-resview]');
    if (!b) return;
    const next = b.dataset.resview;
    const wasTree = resState.view === 'tree';
    resState.view = next;
    resSaveView(next);
    // Tree pulls the whole (filtered) in-spawn set so branches are complete, not
    // just the current 50-row page; switching away restores normal paging.
    if (next === 'tree') {
      resState.prevPerPage = resState.perPage;
      resState.perPage = 500;
      resState.page = 1;
      loadResources();
      return;
    }
    if (wasTree) {
      resState.perPage = resState.prevPerPage || 50;
      resState.page = 1;
      loadResources();
      return;
    }
    resApplyView();
  });
  // clicks inside the card/tree container: pin, collapse nodes, open resource pages
  $('#res-cards').addEventListener('click', async (e) => {
    const pin = e.target.closest('[data-pin]');
    if (pin) {
      e.stopPropagation();
      try {
        const res = await api().toggle_pin_resource(pin.dataset.pin);
        if (res.ok) {
          resState.pinned = new Set((res.data || []).map(String));
          const pid = String(pin.dataset.pin);
          const nowPinned = resState.pinned.has(pid);
          pin.classList.toggle('pinned-star', nowPinned);
          const card = pin.closest('.res-card');
          if (card) {
            const stocked = typeof stkState !== 'undefined' && stkState.resourceIds.has(pid);
            const wished = typeof wishState !== 'undefined' && wishState.resourceIds.has(pid);
            card.classList.remove('res-card-pinned', 'res-card-stocked', 'res-card-wished');
            const cls = nowPinned ? 'res-card-pinned' : stocked ? 'res-card-stocked' : wished ? 'res-card-wished' : '';
            if (cls) card.classList.add(cls);
          }
        }
      } catch (_) { /* ignore */ }
      return;
    }
    const typeLink = e.target.closest('[data-navcat]');
    if (typeLink) { applyCategoryFilter(typeLink.dataset.navcat, typeLink.textContent.trim()); return; }
    const node = e.target.closest('.res-tree-node[data-treecode]');
    if (node) {
      const code = node.dataset.treecode;
      if (!resState.treeCollapsed) resState.treeCollapsed = new Set();
      if (resState.treeCollapsed.has(code)) resState.treeCollapsed.delete(code); else resState.treeCollapsed.add(code);
      renderResTree($('#res-cards'), resState.lastRows || []);
      return;
    }
    const name = e.target.closest('.res-name');
    if (name) openResourcePage(name.dataset.resname || name.textContent.trim());
  });
}

// ---- column picker dialog ----
function resRenderColsList() {
  const host = $('#res-cols-list');
  if (!host) return;
  host.innerHTML = resColsAll().map(([, field]) => {
    const locked = RES_COL_LOCKED.has(field);
    const visible = locked || !resState.colHidden.has(field);
    return `<div class="rescol-row" draggable="true" data-colfield="${escapeHtml(field)}">
      <i class="fa-solid fa-grip-vertical rescol-grip"></i>
      <label class="rescol-label">
        <input type="checkbox" ${visible ? 'checked' : ''} ${locked ? 'disabled' : ''} data-coltoggle="${escapeHtml(field)}">
        <span>${escapeHtml(resColLabel(field))}</span>
      </label>
      ${locked ? '<span class="rescol-lock">always on</span>' : ''}
    </div>`;
  }).join('');
}

function initResCols() {
  resLoadColPref();
  $('#res-cols-btn').addEventListener('click', () => { resRenderColsList(); $('#res-cols-modal').hidden = false; });
  $('#res-cols-x').addEventListener('click', () => { $('#res-cols-modal').hidden = true; });
  $('#res-cols-modal').addEventListener('click', (e) => { if (e.target === $('#res-cols-modal')) $('#res-cols-modal').hidden = true; });
  $('#res-cols-reset').addEventListener('click', () => {
    resState.colOrder = resDefaultColOrder();
    resState.colHidden = new Set();
    resSaveColPref();
    resRenderColsList();
    resRerender();
  });
  // show/hide
  $('#res-cols-list').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-coltoggle]');
    if (!cb) return;
    const f = cb.dataset.coltoggle;
    if (cb.checked) resState.colHidden.delete(f); else resState.colHidden.add(f);
    resSaveColPref();
    resRerender();
  });
  // drag to reorder
  let dragField = null;
  $('#res-cols-list').addEventListener('dragstart', (e) => {
    const row = e.target.closest('[data-colfield]');
    if (!row) return;
    dragField = row.dataset.colfield;
    e.dataTransfer.effectAllowed = 'move';
    row.classList.add('rescol-dragging');
  });
  $('#res-cols-list').addEventListener('dragend', (e) => {
    const row = e.target.closest('[data-colfield]');
    if (row) row.classList.remove('rescol-dragging');
    document.querySelectorAll('#res-cols-list .rescol-over').forEach((el) => el.classList.remove('rescol-over'));
  });
  $('#res-cols-list').addEventListener('dragover', (e) => {
    const row = e.target.closest('[data-colfield]');
    if (!row || !dragField || row.dataset.colfield === dragField) return;
    e.preventDefault();
    document.querySelectorAll('#res-cols-list .rescol-over').forEach((el) => el.classList.remove('rescol-over'));
    row.classList.add('rescol-over');
  });
  $('#res-cols-list').addEventListener('drop', (e) => {
    const row = e.target.closest('[data-colfield]');
    if (!row || !dragField) return;
    e.preventDefault();
    const targetField = row.dataset.colfield;
    const order = resColsAll().map((c) => c[1]).filter((f) => f !== dragField);
    const at = order.indexOf(targetField);
    order.splice(at < 0 ? order.length : at, 0, dragField);
    resState.colOrder = order;
    dragField = null;
    resSaveColPref();
    resRenderColsList();
    resRerender();
  });
}

// active/inactive/all: an explicit user choice wins; otherwise any active filter
// widens to 'all' (despawned bests matter), plain browsing stays 'active'.
function effectiveStatus() {
  if (resState.statusFilter) return resState.statusFilter;
  const hasFilters = $('#res-search').value.trim() || resState.filters.length || $('#res-category').value;
  return hasFilters ? 'all' : 'active';
}

// The stats the custom builder / stat: syntax accept ('any' = all stats).
const RES_STAT_KEYS = ['any', 'oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe'];

// A structured filter -> the server search token it composes into.
function filterToken(f) {
  if (f.t === 'stat') return `stat:${f.stat}${f.op}${f.val}`;
  if (f.t === 'ignore') return `ignore:${f.val}`;
  if (f.t === 'date') return `date:-${f.val}days`;
  return '';
}

// A structured filter -> its human pill label.
function filterLabel(f) {
  if (f.t === 'stat') return `${f.stat === 'any' ? 'any' : f.stat.toUpperCase()} ${f.op} ${f.val}`;
  if (f.t === 'ignore') return f.val === 'planet_mustafar' ? 'Ignore Mustafar' : `Ignore ${f.val.replace('planet_', '')}`;
  if (f.t === 'date') return `Last ${f.val} days`;
  return filterToken(f);
}

function sameFilter(a, b) { return filterToken(a) === filterToken(b); }

// Add a filter unless an identical one is already present.
function addResFilter(f) {
  if (!resState.filters.some((x) => sameFilter(x, f))) resState.filters.push(f);
}

// Pull any typed stat:/ignore:/date: tokens out of the name box into structured
// filters, so power users can type syntax and still get pills. Returns the
// remaining free text (the actual name search).
function absorbTypedTokens() {
  let text = $('#res-search').value;
  const patterns = [
    [/\bstat:(any|oq|cr|cd|dr|hr|ma|sr|ut|fl|pe)\s*([<>]=?)\s*(\d+)/gi,
      (m) => ({ t: 'stat', stat: m[1].toLowerCase(), op: m[2], val: parseInt(m[3], 10) })],
    [/\bignore:(planet_[a-z0-9]+)/gi, (m) => ({ t: 'ignore', val: m[1].toLowerCase() })],
    [/\bdate:-(\d+)days/gi, (m) => ({ t: 'date', val: parseInt(m[1], 10) })],
  ];
  let changed = false;
  for (const [re, make] of patterns) {
    text = text.replace(re, (...args) => { addResFilter(make(args)); changed = true; return ''; });
  }
  if (changed) $('#res-search').value = text.replace(/\s+/g, ' ').trim();
  return $('#res-search').value.trim();
}

function buildResHeader() {
  const head = $('#res-head');
  head.innerHTML =
    `<th class="pin-cell pin-reset ${resState.sortField ? '' : 'active'}" data-pinsort
       title="Pinned first (default order) — click to reset sort"><i class="fa-solid fa-thumbtack"></i></th>` +
    '<th class="pin-cell"></th><th class="pin-cell"></th>' +
    resCols().map(([label, field, cls]) => {
      const sortable = field !== 'planets' && field !== 'status'; // no server sort column for these
      const arrow = field === resState.sortField ? (resState.sortOrder === 'ASC' ? ' ▲' : ' ▼') : '';
      return `<th class="${cls}"${sortable ? ` data-sort="${field}"` : ''}>${label}${arrow}</th>`;
    }).join('');
}

function populateFilters() {
  $('#res-planet').innerHTML =
    ['All Planets', ...PLANETS].map((p) => `<option value="${p === 'All Planets' ? '' : p}">${p}</option>`).join('');
  $('#res-category').innerHTML =
    '<option value="">All Categories</option>' +
    RESOURCE_CATEGORY_FALLBACK.map(([code, desc]) => `<option value="${code}">${desc}</option>`).join('');
  populateCategoryTree(); // upgrade in place once categories.php answers
}

// Full-depth category tree (all 6 levels) as indented <option> html, matching the
// site's dropdown. Built from resource_tree_flat: every row's level1..level6
// ancestor chain registers the tree nodes; leaf TYPE codes (the rows themselves)
// never appear as ancestors, so they stay out of the list. Returns null offline.
// Shared by the Resources filter and Spawn Alerts editor; also fills
// categoryNameByCode so rules can render class names.
const categoryNameByCode = new Map();
const typeNameByCode = new Map(); // leaf type code -> "Gravitonic Fiberplast"

// Ordered DFS of the class tree as [{code, desc, depth}], optionally including
// exact resource types as deepest leaves. Null offline.
async function fetchCategoryNodes(includeTypes = false) {
  let flat;
  try {
    const res = await api().get_categories();
    flat = res.ok ? (res.data?.resource_tree_flat || []) : null;
    (res.ok ? (res.data?.resource_types || []) : [])
      .forEach((t) => typeNameByCode.set(t.resource_code, t.resource_name || ''));
  } catch (_) { /* offline */ }
  if (!flat || !flat.length) return null;

  const nodes = new Map(); // code -> {desc, parent, children: []}
  for (const row of flat) {
    const chain = [];
    for (let i = 1; i <= 6; i++) {
      const c = row[`level${i}`], d = row[`level${i}_description`];
      if (!c || !d) break;
      chain.push([c, d]);
    }
    chain.forEach(([c, d], i) => {
      if (!nodes.has(c)) nodes.set(c, { desc: d, parent: i ? chain[i - 1][0] : null, children: [] });
    });
    // exact resource types (e.g. Gravitonic Fiberplast) as leaves under their class —
    // the alerts editor needs type precision; the Resources filter mirrors the site
    if (includeTypes && chain.length && row.code && !nodes.has(row.code)) {
      const typeName = (typeNameByCode.get(row.code) || '').trim();
      if (typeName) nodes.set(row.code, { desc: typeName, parent: chain[chain.length - 1][0], children: [] });
    }
  }
  if (!nodes.size) return null;

  const roots = [];
  for (const [code, n] of nodes) {
    categoryNameByCode.set(code, n.desc);
    if (n.parent && nodes.has(n.parent)) nodes.get(n.parent).children.push(code);
    else roots.push(code);
  }
  const byDesc = (a, b) => nodes.get(a).desc.localeCompare(nodes.get(b).desc);
  const out = [];
  const emit = (code, depth) => {
    const n = nodes.get(code);
    out.push({ code, desc: n.desc, depth });
    n.children.sort(byDesc).forEach((c) => emit(c, depth + 1));
  };
  roots.sort(byDesc).forEach((c) => emit(c, 0));
  return out;
}

async function fetchCategoryOptionsHtml(anyLabel = 'All Categories', includeTypes = false) {
  const nodes = await fetchCategoryNodes(includeTypes);
  if (!nodes) return null;
  return `<option value="">${escapeHtml(anyLabel)}</option>` + nodes.map((n) =>
    `<option value="${escapeHtml(n.code)}">${'&nbsp; '.repeat(n.depth)}${escapeHtml(n.desc)}</option>`).join('');
}

async function populateCategoryTree() {
  const html = await fetchCategoryOptionsHtml();
  if (!html) return; // offline — keep fallback options
  const sel = $('#res-category');
  const keep = sel.value; // don't clobber an in-flight selection
  sel.innerHTML = html;
  sel.value = keep;
  if (sel.value !== keep) sel.value = ''; // old fallback code vanished — reset cleanly
}

function planetsHtml(res) {
  return PLANET_KEYS
    .filter((key) => String(res[key] ?? '0') === '1')
    .map((key) => `<span class="planet ${planetClass(key)}" title="${PLANET_FULL[key]}">${PLANET_FULL[key][0]}</span>`)
    .join('');
}

function resRowHtml(res) {
  const id = res.id ?? '';
  const isPinned = resState.pinned.has(String(id));
  // '1' = currently in spawn; the live-API list rows carry `status` (active/is_active are fallbacks)
  const isActive = String(res.status ?? res.active ?? res.is_active ?? '0') === '1';

  const cells = resCols().map(([, field]) => {
    // superscript top-count matches the website: how many schematic formulas
    // rank this spawn top-5 right now — requested by Philosophy/Eponine.
    // data-resname carries the clean name: the cell's TEXT now ends with the
    // count digits, so textContent would navigate to "Aqui13"
    if (field === 'name') return `<td class="col-name res-name" data-resname="${escapeHtml(res.name || '')}" data-resid="${escapeHtml(String(id))}">${escapeHtml(res.name || '')}${safeInt(res.topcount) > 0
      ? `<sup class="res-topcount" title="Top resource for ${safeInt(res.topcount)} schematic${safeInt(res.topcount) === 1 ? '' : 's'} — see its Top Uses tab">${safeInt(res.topcount)}</sup>` : ''}</td>`;
    if (field === 'status') return `<td class="col-status"><i class="fa-solid fa-circle res-status ${isActive ? 'on' : 'off'}" title="${isActive ? escapeHtml(agoText(res.timestamp)) : 'Inactive — despawned'}"></i></td>`;
    if (field === 'type_name') {
      const name = escapeHtml(res.type_name || '');
      return res.type_code
        ? `<td class="col-text res-type"><span class="res-typelink" data-navcat="${escapeHtml(res.type_code)}">${name}</span></td>`
        : `<td class="col-text res-type">${name}</td>`;
    }
    if (field === 'planets') return `<td class="col-text col-planets">${planetsHtml(res)}</td>`;
    if (field === 'score') {
      const v = res.score; // 0–100, null when unscored
      return v == null ? '<td class="stat stat_off">—</td>'
        : `<td class="stat ${qualityClass(safeInt(v))}">${safeInt(v)}</td>`;
    }
    if (STAT_FIELDS.has(field)) return statCell(res[field], res[`${field}_max`]);
    return `<td>${escapeHtml(String(res[field] ?? ''))}</td>`;
  }).join('');

  const star = 'fa-solid fa-thumbtack'; // pin; color (red when pinned) via .pinned-star
  const rowCls = [isActive ? 'activeResource' : '', isPinned ? 'pinned' : ''].filter(Boolean).join(' ');
  return `<tr class="${rowCls}" data-id="${id}">
    <td class="pin-cell ${isPinned ? 'pinned-star' : ''}" data-pin="${id}" title="Pin"><i class="${star}"></i></td>
    ${addCellHtml(id, res.name)}
    ${wishCellHtml(id, res.name)}
    ${cells}
  </tr>`;
}

async function loadResources() {
  showGridLoading('#res-loading');
  $('#res-empty').hidden = true;

  // name box (minus any typed filter syntax) + the structured filter tokens,
  // space-joined into the one `search` param the server parses.
  const nameText = absorbTypedTokens();
  const tokens = resState.filters.map(filterToken).filter(Boolean);
  const search = [nameText, ...tokens].join(' ').trim();
  renderResPills();
  const status = effectiveStatus();
  // 'score' is the public alias; the sortable server column is value_rating
  let sort = resState.sortField === 'score' ? 'value_rating' : resState.sortField;
  let order = resState.sortField ? resState.sortOrder : '';
  // Default order (no column chosen) while showing every status: the server would
  // sort by rating and bury low-quality *active* spawns pages deep. Sort active-first
  // so currently-harvestable resources surface instead of only historical bests.
  if (!resState.sortField && status === 'all') { sort = 'status'; order = 'DESC'; }
  const params = {
    search,
    status,
    planet: $('#res-planet').value,
    category: $('#res-category').value,
    page: resState.page,
    perpage: Math.min(resState.perPage || 50, 500), // server caps at 500 (tree view uses it)
    sort,
    order,
  };

  let res;
  const stockedIds = $('#res-stocked-only').checked && typeof stkState !== 'undefined' ? [...(stkState.resourceIds || [])] : [];
  if ($('#res-pinned-only').checked && resState.pinned.size) {
    // Pinned view fetches the pinned ids DIRECTLY (status/pages ignored) — the
    // old filter-the-current-page approach lost pins that were despawned or
    // ranked pages deep (Jylin's Duroomevris). Via the gateway: the shell's
    // search bridge whitelists params and would drop `ids`.
    try { res = await apiFetch('GET', 'api/resources.php', { params: { ids: [...resState.pinned].join(',') } }); }
    catch (e) { res = { ok: false, error: String(e) }; }
    if (res.ok && res.data && !(res.data.results || []).length && resState.pinned.size) {
      // older site deploy without the ids filter would return page 1 unfiltered;
      // the client-side pinned filter below still keeps the view honest
      res.data.results = (res.data.results || []);
    }
  } else if (stockedIds.length) {
    // Stockpiled filter likewise fetches the stockpiled ids DIRECTLY so despawned
    // or deep-ranked stockpile resources still show (not just the active page).
    try { res = await apiFetch('GET', 'api/resources.php', { params: { ids: stockedIds.join(',') } }); }
    catch (e) { res = { ok: false, error: String(e) }; }
  } else {
    try { res = await api().search_resources(params); }
    catch (e) { res = { ok: false, error: String(e) }; }
  }

  $('#res-loading').hidden = true;

  if (!res.ok) {
    showResEmpty(`Error: ${res.error || 'failed to load'}`);
    checkAuthError(res.error);
    return;
  }

  const data = res.data || {};
  let rows = data.results || data.resources || (Array.isArray(data) ? data : []);
  const page = data.page ?? resState.page;
  resState.perPage = data.per_page ?? resState.perPage;
  // The endpoint returns no total/total_pages, so infer "more pages" from a full page.
  resState.hasNext = rows.length >= resState.perPage;
  const fetched = rows.length;

  if ($('#res-pinned-only').checked) {
    rows = rows.filter((r) => resState.pinned.has(String(r.id)));
  }
  if ($('#res-stocked-only').checked) {
    rows = rows.filter((r) => stkState.resourceIds.has(String(r.id)));
    // the id-based stockpile fetch ignores the status/search filters server-side,
    // so honor them here (pinned intentionally shows everything, so skip then)
    if (!$('#res-pinned-only').checked) {
      const st = effectiveStatus();
      if (st === 'active') rows = rows.filter((r) => String(r.status ?? '0') === '1');
      else if (st === 'inactive') rows = rows.filter((r) => String(r.status ?? '0') !== '1');
      const q = $('#res-search').value.trim().toLowerCase();
      if (q) rows = rows.filter((r) => String(r.name || '').toLowerCase().includes(q)
        || String(r.type_name || '').toLowerCase().includes(q));
    }
  }

  // Pinned rows float to the top only in the DEFAULT order — an explicit
  // column sort means exactly that sort, pins land wherever they land.
  if (!resState.sortField) {
    rows = [
      ...rows.filter((r) => resState.pinned.has(String(r.id))),
      ...rows.filter((r) => !resState.pinned.has(String(r.id))),
    ];
  }

  if (!rows.length) {
    const filtered = $('#res-pinned-only').checked || $('#res-stocked-only').checked;
    showResEmpty(filtered ? 'No matching resources on this page.' : 'No resources found.');
    $('#res-status').textContent = '';
    updateResPager(page);
    return;
  }

  // recycled canonical rows (Homogenized Milk & co) are permanently "active"
  // so pickers can offer them, but they're not spawns — keep them out of the
  // browse list unless the user searches by name (same rule as the website)
  if (!$('#res-search').value.trim()) {
    rows = rows.filter((r) => !RES_RECYCLED_CODES.has(String(r.type_code)));
  }
  resState.lastRows = rows; // the waypoints→note export scopes to what's on screen
  $('#res-body').innerHTML = rows.map(resRowHtml).join('');
  resWpCounts().then(resAnnotateWaypoints); // waypoint badges land when the (cached) pool answers
  $('#res-status').textContent = `Page ${page} — showing ${rows.length}${fetched === rows.length ? '' : ` of ${fetched}`} resources`
    + (data.offline ? ' · offline data' : '');
  if (data.offline) setOffline(true); // don't wait for the next pulse poll
  updateResPager(page);
  resApplyView(); // reflect the chosen view (cards/grouped) on every load
}

function showResEmpty(msg) {
  $('#res-body').innerHTML = '';
  const el = $('#res-empty');
  el.textContent = msg;
  el.hidden = false;
}

function updateResPager(page) {
  $('#res-prev').disabled = page <= 1;
  $('#res-next').disabled = !resState.hasNext;
}

// ---- Filter pills (the active-filter row; each × clears one filter) ----
function resPillHtml(label, kind, i) {
  return `<span class="res-pill">${escapeHtml(label)}`
    + `<button class="res-pill-x" data-clear="${kind}"${i != null ? ` data-i="${i}"` : ''} title="Remove">`
    + '<i class="fa-solid fa-xmark"></i></button></span>';
}

function renderResPills() {
  const wrap = $('#res-filter-pills');
  if (!wrap) return;
  const pills = [];
  const nameText = $('#res-search').value.trim();
  if (nameText) pills.push(resPillHtml(`Name: ${nameText}`, 'search'));
  const planet = $('#res-planet').value;
  if (planet) pills.push(resPillHtml(planet, 'planet'));
  const catSel = $('#res-category');
  if (catSel.value) {
    pills.push(resPillHtml(catSel.options[catSel.selectedIndex]?.text?.trim() || catSel.value, 'category'));
  }
  resState.filters.forEach((f, i) => pills.push(resPillHtml(filterLabel(f), 'filter', i)));
  // The status pill is always shown (reflects the effective active/inactive/all);
  // the save/clear controls only appear when there's something real to act on.
  const hasReal = pills.length > 0 || !!resState.statusFilter;
  wrap.hidden = false;
  wrap.innerHTML = `<span class="res-pills-label">Filters:</span>${statusPillHtml()}${pills.join('')}`
    + (hasReal
      ? '<button class="res-pill-icon" data-savebm title="Save as a search"><i class="fa-solid fa-bookmark"></i></button>'
        + '<button class="res-pill-icon res-pill-clearall" data-clear="all" title="Clear all filters"><i class="fa-solid fa-circle-xmark"></i></button>'
      : '');
}

// Always-visible pill showing the effective active/inactive/all status. Clicking
// it opens the Filter menu; when overridden it also gets an × to return to auto.
function statusPillHtml() {
  const label = { active: 'Active only', inactive: 'Inactive only', all: 'All resources' }[effectiveStatus()];
  const x = resState.statusFilter
    ? '<button class="res-pill-x" data-clear="status" title="Back to auto"><i class="fa-solid fa-xmark"></i></button>'
    : '';
  return `<span class="res-pill res-pill-status" title="Change status">${escapeHtml(label)}${x}</span>`;
}

// Filter the grid to a resource category/type code — shared by the Type-column
// links and the resource-detail breadcrumb. The dropdown holds class-tree codes,
// not leaf TYPE codes, so inject the option on demand (the server accepts a leaf
// type_code). loadResources() renders the pill.
function applyCategoryFilter(code, label) {
  if (!code) return;
  const sel = $('#res-category');
  if (![...sel.options].some((o) => o.value === code)) sel.add(new Option(label || code, code));
  sel.value = code;
  resState.page = 1;
  loadResources();
}

function clearResFilter(kind, i) {
  if (kind === 'search') $('#res-search').value = '';
  else if (kind === 'planet') $('#res-planet').value = '';
  else if (kind === 'category') $('#res-category').value = '';
  else if (kind === 'status') resState.statusFilter = null;
  else if (kind === 'filter') resState.filters.splice(i, 1);
  else if (kind === 'all') {
    $('#res-search').value = ''; $('#res-planet').value = ''; $('#res-category').value = '';
    resState.filters = []; resState.statusFilter = null;
  }
  resState.page = 1;
  loadResources();
}

// ---- Filter menu (quick presets + custom stat builder) ----
function renderFilterMenu() {
  const menu = $('#res-filter-menu');
  if (!menu) return;
  const preset = (label, f) => `<button type="button" class="rfm-preset" data-preset='${escapeHtml(JSON.stringify(f))}'>${escapeHtml(label)}</button>`;
  const statOpts = RES_STAT_KEYS.map((s) => `<option value="${s}">${s === 'any' ? 'any' : s.toUpperCase()}</option>`).join('');
  const eff = effectiveStatus();
  const statusBtn = (v, label) => `<button type="button" class="rfm-preset${eff === v ? ' on' : ''}" data-status="${v}">${label}</button>`;
  menu.innerHTML = `
    <div class="rfm-sec-label">Status</div>
    <div class="rfm-presets">${statusBtn('active', 'Active')}${statusBtn('inactive', 'Inactive')}${statusBtn('all', 'All')}</div>
    <div class="rfm-sep"></div>`;
  menu.innerHTML += `
    <div class="rfm-sec-label">Quick add</div>
    <div class="rfm-presets">
      ${preset('OQ > 960', { t: 'stat', stat: 'oq', op: '>', val: 960 })}
      ${preset('SR > 960', { t: 'stat', stat: 'sr', op: '>', val: 960 })}
      ${preset('CD > 960', { t: 'stat', stat: 'cd', op: '>', val: 960 })}
      ${preset('any > 960', { t: 'stat', stat: 'any', op: '>', val: 960 })}
      ${preset('Ignore Mustafar', { t: 'ignore', val: 'planet_mustafar' })}
      ${preset('Last 7 days', { t: 'date', val: 7 })}
      ${preset('Last 30 days', { t: 'date', val: 30 })}
    </div>
    <div class="rfm-sep"></div>
    <div class="rfm-sec-label">Custom stat</div>
    <div class="rfm-custom">
      <select id="rfm-stat" class="form-select form-select-sm">${statOpts}</select>
      <select id="rfm-op" class="form-select form-select-sm">
        <option value="&gt;">&gt;</option><option value="&lt;">&lt;</option>
        <option value="&gt;=">&ge;</option><option value="&lt;=">&le;</option>
      </select>
      <input id="rfm-val" type="number" class="form-control form-control-sm" value="960" min="0" max="1000">
      <button type="button" class="btn btn-sm btn-accent" id="rfm-add">Add</button>
    </div>
  `;
}

function toggleFilterMenu(show) {
  const menu = $('#res-filter-menu');
  if (!menu) return;
  const willShow = show === undefined ? menu.hidden : show;
  if (willShow) { toggleBookmarkMenu(false); renderFilterMenu(); menu.hidden = false; } else menu.hidden = true;
}

// ---- Bookmark menu (browse/apply saved searches) — saving happens from the
// pills row via the save dialog below. ----
function renderBookmarkMenu() {
  const menu = $('#res-bookmark-menu');
  if (!menu) return;
  const saved = resState.savedSearches.length
    ? resState.savedSearches.map((s, i) =>
      `<div class="rfm-saved-row"><button type="button" class="rfm-saved" data-saved="${i}" title="Apply">${escapeHtml(s.name)}</button>`
      + `<button type="button" class="rfm-saved-del" data-savedel="${i}" title="Delete"><i class="fa-solid fa-xmark"></i></button></div>`).join('')
    : '<div class="rfm-empty">No saved searches yet — build filters, then bookmark them.</div>';
  menu.innerHTML = `<div class="rfm-sec-label">Saved searches</div><div class="rfm-saved-list">${saved}</div>`;
}

function toggleBookmarkMenu(show) {
  const menu = $('#res-bookmark-menu');
  if (!menu) return;
  const willShow = show === undefined ? menu.hidden : show;
  if (willShow) { toggleFilterMenu(false); renderBookmarkMenu(); menu.hidden = false; } else menu.hidden = true;
}

// ---- Save-search dialog (named from the pills-row bookmark icon) ----
function openSaveDialog() {
  const modal = $('#res-save-modal');
  if (!modal) return;
  $('#res-save-name').value = '';
  modal.hidden = false;
  $('#res-save-name').focus();
}

function closeSaveDialog() {
  const modal = $('#res-save-modal');
  if (modal) modal.hidden = true;
}

function confirmSaveDialog() {
  const name = $('#res-save-name').value.trim();
  if (!name) { $('#res-save-name').focus(); return; }
  saveCurrentSearch(name);
  closeSaveDialog();
}

// ---- Saved searches (persisted to config, like lab experiments) ----
function persistSavedSearches() {
  try { api().set_config('resource_saved_searches', resState.savedSearches); }
  catch (_) { /* non-fatal */ }
}

function saveCurrentSearch(name) {
  const catSel = $('#res-category');
  resState.savedSearches.push({
    name,
    search: $('#res-search').value.trim(),
    planet: $('#res-planet').value,
    category: catSel.value,
    categoryLabel: catSel.value ? (catSel.options[catSel.selectedIndex]?.text || '') : '',
    statusFilter: resState.statusFilter,
    filters: JSON.parse(JSON.stringify(resState.filters)),
  });
  persistSavedSearches();
  toast(`Saved “${name}”`, true);
}

function applySavedSearch(i) {
  const s = resState.savedSearches[i];
  if (!s) return;
  $('#res-search').value = s.search || '';
  $('#res-planet').value = s.planet || '';
  const catSel = $('#res-category');
  if (s.category && ![...catSel.options].some((o) => o.value === s.category)) {
    catSel.add(new Option(s.categoryLabel || s.category, s.category));
  }
  catSel.value = s.category || '';
  resState.statusFilter = s.statusFilter || null;
  resState.filters = JSON.parse(JSON.stringify(s.filters || []));
  resState.page = 1;
  loadResources();
}

async function loadSavedSearches() {
  try {
    const res = await api().get_config();
    if (res?.ok && Array.isArray(res.data?.resource_saved_searches)) {
      resState.savedSearches = res.data.resource_saved_searches;
    }
  } catch (_) { /* offline / no config — leave empty */ }
}

// community waypoint counts (resource_id -> n), cached a few minutes — one
// tiny API call decorates every page of results and feeds nothing else
async function resWpCounts() {
  const now = Date.now();
  if (resState.wpCounts && now - (resState.wpAt || 0) < 5 * 60 * 1000) return resState.wpCounts;
  try {
    const res = await apiFetch('GET', 'api/waypoints.php');
    const m = new Map();
    const byRes = new Map();
    for (const w of ((res.ok && res.data && res.data.results) || [])) {
      const k = String(w.resource_id);
      m.set(k, (m.get(k) || 0) + 1);
      if (!byRes.has(k)) byRes.set(k, []);
      byRes.get(k).push(w);
    }
    resState.wpCounts = m;
    resState.wpByResource = byRes;
    resState.wpAt = now;
  } catch (_) { /* badges just don't show */ }
  return resState.wpCounts || new Map();
}

// a small popover listing a resource's shared waypoints — click a line to copy
function showWpPopover(anchor, resId) {
  let pop = $('#res-wp-pop');
  if (!pop) {
    pop = document.createElement('div');
    pop.id = 'res-wp-pop';
    pop.className = 'res-wp-pop';
    document.body.appendChild(pop);
    pop.addEventListener('click', (e) => {
      const line = e.target.closest('[data-wpcopy]');
      if (line) { try { navigator.clipboard.writeText(line.dataset.wpcopy); toast('Waypoint copied'); } catch (_) { /* ignore */ } }
    });
  }
  const list = (resState.wpByResource && resState.wpByResource.get(String(resId))) || [];
  if (!list.length) { pop.hidden = true; return; }
  pop.innerHTML = `<div class="res-wp-pop-head">${list.length} shared waypoint${list.length === 1 ? '' : 's'} <span class="settings-sub">click to copy</span></div>`
    + list.map((w) => `<div class="res-wp-pop-row" data-wpcopy="${escapeHtml(w.waypoint || '')}">
        <i class="fa-solid fa-location-dot"></i>
        <span class="res-wp-pop-wp">${escapeHtml(w.waypoint || '')}</span>
        ${w.concentration ? `<span class="res-wp-pop-conc">${safeInt(w.concentration)}%</span>` : ''}
      </div>`).join('');
  const r = anchor.getBoundingClientRect();
  pop.hidden = false;
  // place below the badge, clamped to the viewport
  const pw = pop.offsetWidth;
  let left = r.left;
  if (left + pw > window.innerWidth - 10) left = window.innerWidth - pw - 10;
  pop.style.left = `${Math.max(10, left)}px`;
  pop.style.top = `${r.bottom + 6}px`;
}
function hideWpPopover() { const p = $('#res-wp-pop'); if (p) p.hidden = true; }

// location-dot badge on rows whose resource has shared waypoints; icon only —
// the name cell's trailing text must stay clean for the click navigation
function resAnnotateWaypoints() {
  const m = resState.wpCounts;
  if (!m || !m.size) return;
  document.querySelectorAll('#res-body .res-name[data-resid]').forEach((td) => {
    if (td.querySelector('.res-wpmark')) return;
    const n = m.get(td.dataset.resid);
    if (!n) return;
    const sup = document.createElement('sup');
    sup.className = 'res-wpmark';
    sup.dataset.wpfor = td.dataset.resid;
    sup.title = `${n} shared waypoint${n === 1 ? '' : 's'} — click to view (or “Waypoints → note” to collect)`;
    sup.innerHTML = '<i class="fa-solid fa-location-dot"></i>';
    td.appendChild(sup);
  });
}

function initResources() {
  resLoadColPref();
  buildResHeader();
  initResCols();
  initResViews();
  populateFilters();
  loadSavedSearches();

  // community waypoints for the on-screen resources -> one note, /wp per line
  $('#res-wp-note').addEventListener('click', async () => {
    const btn = $('#res-wp-note');
    btn.disabled = true;
    try {
      const res = await apiFetch('GET', 'api/waypoints.php');
      const all = (res.ok && res.data && res.data.results) || [];
      const ids = new Set((resState.lastRows || []).map((r) => String(r.id)));
      const mine = all.filter((w) => ids.has(String(w.resource_id)));
      if (!mine.length) {
        // say WHY: despawned resources can't have waypoints (the community pool
        // only keeps them for active spawns), active ones just have none shared
        const rowsNow = resState.lastRows || [];
        const activeN = rowsNow.filter((x) => safeInt(x.status) === 1).length;
        const despawnedN = rowsNow.length - activeN;
        let msg;
        if (!rowsNow.length) {
          msg = 'No resources on screen to look up';
        } else if (!activeN) {
          msg = `The ${despawnedN === 1 ? 'resource' : `${despawnedN} resources`} on screen ${despawnedN === 1 ? 'has' : 'have all'} despawned — waypoints only exist for resources still in spawn`;
        } else {
          msg = `Nobody has shared a waypoint for the active resource${activeN === 1 ? '' : 's'} on screen yet`
            + (despawnedN ? ` (the ${despawnedN} despawned one${despawnedN === 1 ? '' : 's'} can't have any)` : '')
            + ` — the community pool holds ${all.length} waypoint${all.length === 1 ? '' : 's'} right now`;
        }
        toast(msg, false);
        return;
      }
      const lines = mine.map((w) => `${w.waypoint} ${w.resource_name}${w.concentration ? ` ${w.concentration}%` : ''}`);
      const r = await notesAddFromText('Resource waypoints', lines.join('\n') + '\n');
      showPage('notes');
      toast(r.merged
        ? (r.added ? `Added ${r.added} new waypoint${r.added === 1 ? '' : 's'} to the note` : 'Already in the note — nothing new to add')
        : `Saved ${lines.length} waypoint${lines.length === 1 ? '' : 's'} as a note`);
    } catch (_) {
      toast('Fetching waypoints failed', false);
    } finally {
      btn.disabled = false;
    }
  });

  // Filter menu: open/close, quick presets, custom stat builder
  $('#res-filter-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleFilterMenu(); });
  $('#res-filter-menu').addEventListener('click', (e) => {
    const st = e.target.closest('[data-status]');
    if (st) { resState.statusFilter = st.dataset.status; resState.page = 1; loadResources(); renderFilterMenu(); return; }
    const preset = e.target.closest('[data-preset]');
    if (preset) { addResFilter(JSON.parse(preset.dataset.preset)); resState.page = 1; loadResources(); return; }
    if (e.target.closest('#rfm-add')) {
      const val = parseInt($('#rfm-val').value, 10);
      if (Number.isFinite(val)) {
        addResFilter({ t: 'stat', stat: $('#rfm-stat').value, op: $('#rfm-op').value, val });
        resState.page = 1; loadResources();
      }
    }
  });

  // Bookmark menu: open/close, apply/delete saved searches, save current filters
  $('#res-bookmark-btn').addEventListener('click', (e) => { e.stopPropagation(); toggleBookmarkMenu(); });
  $('#res-bookmark-menu').addEventListener('click', (e) => {
    const apply = e.target.closest('[data-saved]');
    if (apply) { applySavedSearch(parseInt(apply.dataset.saved, 10)); toggleBookmarkMenu(false); return; }
    const del = e.target.closest('[data-savedel]');
    if (del) { resState.savedSearches.splice(parseInt(del.dataset.savedel, 10), 1); persistSavedSearches(); renderBookmarkMenu(); return; }
  });

  // click outside closes whichever menu is open
  document.addEventListener('click', (e) => {
    const fm = $('#res-filter-menu');
    if (fm && !fm.hidden && !e.target.closest('#res-filter-wrap')) toggleFilterMenu(false);
    const bm = $('#res-bookmark-menu');
    if (bm && !bm.hidden && !e.target.closest('#res-bookmark-wrap')) toggleBookmarkMenu(false);
  });

  // Filter pills: each × clears one filter; bookmark icon saves the current set
  $('#res-filter-pills').addEventListener('click', (e) => {
    if (e.target.closest('[data-savebm]')) { openSaveDialog(); return; }
    const btn = e.target.closest('[data-clear]');
    if (btn) { clearResFilter(btn.dataset.clear, btn.dataset.i != null ? parseInt(btn.dataset.i, 10) : null); return; }
    if (e.target.closest('.res-pill-status')) {
      e.stopPropagation(); // the document click-away would close the menu this same click just opened
      toggleFilterMenu(true); // jump to the status controls
    }
  });

  // Save-search dialog
  const saveModal = $('#res-save-modal');
  $('#res-save-cancel').addEventListener('click', closeSaveDialog);
  saveModal.addEventListener('click', (e) => { if (e.target === saveModal) closeSaveDialog(); });
  $('#res-save-confirm').addEventListener('click', confirmSaveDialog);
  $('#res-save-name').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') confirmSaveDialog();
    else if (e.key === 'Escape') closeSaveDialog();
  });

  // Server-side column sort; third click on a column returns to the default order
  $('#res-head').addEventListener('click', (e) => {
    const pinReset = e.target.closest('[data-pinsort]');
    if (pinReset) {
      if (!resState.sortField) return; // already default
      resState.sortField = '';
      buildResHeader();
      resState.page = 1;
      loadResources();
      return;
    }
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const field = th.dataset.sort;
    const firstOrder = field === 'name' || field === 'type_name' ? 'ASC' : 'DESC';
    if (resState.sortField !== field) {
      resState.sortField = field;
      resState.sortOrder = firstOrder;
    } else if (resState.sortOrder === firstOrder) {
      resState.sortOrder = firstOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
      resState.sortField = ''; // back to server default
    }
    buildResHeader();
    resState.page = 1;
    loadResources();
  });

  $('#res-search-btn').addEventListener('click', () => { resState.page = 1; loadResources(); });
  // typeahead (server-side search → debounced) + Enter for instant
  let resSearchTimer = null;
  $('#res-search').addEventListener('input', () => {
    clearTimeout(resSearchTimer);
    resSearchTimer = setTimeout(() => { resState.page = 1; loadResources(); }, 300);
  });
  $('#res-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(resSearchTimer); resState.page = 1; loadResources(); }
  });
  $('#res-planet').addEventListener('change', () => { resState.page = 1; loadResources(); });
  $('#res-category').addEventListener('change', () => { resState.page = 1; loadResources(); });
  $('#res-pinned-only').addEventListener('change', () => loadResources());
  $('#res-stocked-only').addEventListener('change', () => loadResources());
  $('[data-refresh="resources"]').addEventListener('click', () => loadResources());
  $('#res-prev').addEventListener('click', () => { if (resState.page > 1) { resState.page--; loadResources(); } });
  $('#res-next').addEventListener('click', () => { if (resState.hasNext) { resState.page++; loadResources(); } });

  // Pin toggle + add-to-stockpile + name → resource detail page (event delegation)
  $('#res-body').addEventListener('click', async (e) => {
    const wp = e.target.closest('.res-wpmark[data-wpfor]');
    if (wp) { e.stopPropagation(); showWpPopover(wp, wp.dataset.wpfor); return; }
    const addCell = e.target.closest('[data-add]');
    if (addCell) { handleAddCellClick(addCell, e); return; }
    const wishCell = e.target.closest('[data-wish]');
    if (wishCell) { handleWishCellClick(wishCell); return; }
    const cell = e.target.closest('[data-pin]');
    if (cell) {
      const id = cell.dataset.pin;
      try {
        const res = await api().toggle_pin_resource(id);
        if (res.ok) resState.pinned = new Set((res.data || []).map(String));
        loadResources();
      } catch (_) { /* ignore */ }
      return;
    }
    const typeLink = e.target.closest('[data-navcat]');
    if (typeLink) { applyCategoryFilter(typeLink.dataset.navcat, typeLink.textContent.trim()); return; }
    const nameCell = e.target.closest('td.res-name');
    if (nameCell) openResourcePage(nameCell.dataset.resname || nameCell.textContent.trim());
  });

  // dismiss the waypoint popover on any outside click / scroll
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#res-wp-pop') && !e.target.closest('.res-wpmark')) hideWpPopover();
  });

  initResourcePage();
}
