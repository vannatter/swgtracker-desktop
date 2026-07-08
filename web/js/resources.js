/* Resources page — mirrors src/gui/resources_tab.py. */

const PLANETS = ['Corellia', 'Dantooine', 'Dathomir', 'Endor', 'Kashyyyk',
  'Lok', 'Mustafar', 'Naboo', 'Rori', 'Tatooine', 'Yavin IV'];
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
  ['Score', 'score', 'stat'],
  ['OQ', 'oq', 'stat'], ['CR', 'cr', 'stat'], ['CD', 'cd', 'stat'],
  ['DR', 'dr', 'stat'], ['HR', 'hr', 'stat'], ['MA', 'ma', 'stat'],
  ['SR', 'sr', 'stat'], ['UT', 'ut', 'stat'], ['FL', 'fl', 'stat'],
  ['PE', 'pe', 'stat'],
  ['Planets', 'planets', 'col-text'],
];

// sortField '' = the server's default order
const resState = { page: 1, perPage: 50, hasNext: false, pinned: new Set(), sortField: '', sortOrder: 'DESC' };

function buildResHeader() {
  const head = $('#res-head');
  head.innerHTML =
    `<th class="pin-cell pin-reset ${resState.sortField ? '' : 'active'}" data-pinsort
       title="Pinned first (default order) — click to reset sort"><i class="fa-solid fa-star"></i></th>` +
    '<th class="pin-cell"></th><th class="pin-cell"></th>' +
    RES_COLUMNS.map(([label, field, cls]) => {
      const sortable = field !== 'planets'; // no server column for planets
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
  const isActive = String(res.active ?? res.is_active ?? '0') === '1';

  const cells = RES_COLUMNS.map(([, field]) => {
    if (field === 'name') return `<td class="col-name res-name">${escapeHtml(res.name || '')}</td>`;
    if (field === 'type_name') return `<td class="col-text res-type">${escapeHtml(res.type_name || '')}</td>`;
    if (field === 'planets') return `<td class="col-text col-planets">${planetsHtml(res)}</td>`;
    if (field === 'score') {
      const v = res.score; // 0–100, null when unscored
      return v == null ? '<td class="stat stat_off">—</td>'
        : `<td class="stat ${qualityClass(safeInt(v))}">${safeInt(v)}</td>`;
    }
    if (STAT_FIELDS.has(field)) return statCell(res[field], res[`${field}_max`]);
    return `<td>${escapeHtml(String(res[field] ?? ''))}</td>`;
  }).join('');

  const star = isPinned ? 'fa-solid fa-star' : 'fa-regular fa-star';
  const rowCls = [isActive ? 'activeResource' : '', isPinned ? 'pinned' : ''].filter(Boolean).join(' ');
  return `<tr class="${rowCls}" data-id="${id}">
    <td class="pin-cell ${isPinned ? 'pinned-star' : ''}" data-pin="${id}" title="Pin"><i class="${star}"></i></td>
    ${addCellHtml(id, res.name)}
    ${wishCellHtml(id, res.name)}
    ${cells}
  </tr>`;
}

async function loadResources() {
  $('#res-loading').hidden = false;
  $('#res-empty').hidden = true;

  const search = $('#res-search').value.trim();
  const params = {
    search,
    // A name search should find despawned resources too (they're often exactly
    // what you're looking up); plain browsing stays active-spawns-only.
    status: search ? 'all' : 'active',
    planet: $('#res-planet').value,
    category: $('#res-category').value,
    page: resState.page,
    // 'score' is the public alias; the sortable server column is value_rating
    sort: resState.sortField === 'score' ? 'value_rating' : resState.sortField,
    order: resState.sortField ? resState.sortOrder : '',
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

function initResources() {
  buildResHeader();
  populateFilters();

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
    if (addCell) { handleAddCellClick(addCell); return; }
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
    const nameCell = e.target.closest('td.res-name');
    if (nameCell) openResourcePage(nameCell.textContent);
  });

  initResourcePage();
}
