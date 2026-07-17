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
const resState = {
  page: 1, perPage: 50, hasNext: false, pinned: new Set(),
  sortField: '', sortOrder: 'DESC', filters: [], savedSearches: [],
  statusFilter: null, // null = auto (active, or all when filtering); or 'active'/'inactive'/'all'
};

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
    RES_COLUMNS.map(([label, field, cls]) => {
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

  const cells = RES_COLUMNS.map(([, field]) => {
    if (field === 'name') return `<td class="col-name res-name">${escapeHtml(res.name || '')}</td>`;
    if (field === 'status') return `<td class="col-status"><i class="fa-solid fa-circle res-status ${isActive ? 'on' : 'off'}" title="${isActive ? 'Active — in spawn' : 'Inactive — despawned'}"></i></td>`;
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
    sort,
    order,
  };

  let res;
  try { res = await api().search_resources(params); }
  catch (e) { res = { ok: false, error: String(e) }; }

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

  $('#res-body').innerHTML = rows.map(resRowHtml).join('');
  $('#res-status').textContent = `Page ${page} — showing ${rows.length}${fetched === rows.length ? '' : ` of ${fetched}`} resources`
    + (data.offline ? ' · offline data' : '');
  if (data.offline) setOffline(true); // don't wait for the next pulse poll
  updateResPager(page);
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

function initResources() {
  buildResHeader();
  populateFilters();
  loadSavedSearches();

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
    if (e.target.closest('.res-pill-status')) toggleFilterMenu(true); // jump to the status controls
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
    if (nameCell) openResourcePage(nameCell.textContent);
  });

  initResourcePage();
}
