/* Schematics page — mirrors src/gui/schematics_tab.py.
   Search + pinned-only grid; click a row to load its best-resource detail. */

// sortField null = the default most-viewed order
const schState = { page: 1, pinned: new Set(), rows: [], sortField: null, sortOrder: 'ASC',
  view: localStorage.getItem('sch-view') || 'list',   // 'list' | 'cards' (3D grid, like the site)
  subcategory: '',                                    // breadcrumb navigation filter
  modelIds: null };                                   // Set of schematic ids with a .glb, null = not fetched

// the model-viewer library, loaded once on first need (detail card, zoom, card view)
function schEnsureModelLib() {
  if (document.getElementById('mv-lib')) return;
  const s = document.createElement('script');
  s.type = 'module';
  s.id = 'mv-lib';
  s.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js';
  document.head.appendChild(s);
}

// which schematics have models — one call, cached for the session
async function schLoadModelIds() {
  if (schState.modelIds) return;
  try {
    const res = await apiFetch('GET', 'api/item_list.php');
    const items = (res.ok && res.data && res.data.items) || [];
    schState.modelIds = new Set(items.filter((i) => i.model).map((i) => String(i.id)));
    if (schState.view === 'cards') renderSchRows(); // placeholders -> models
  } catch (_) { schState.modelIds = new Set(); }
}
const SCH_COLUMNS = [['Name', 'name', 'col-name'], ['Category', 'parent', 'col-text']];

function buildSchHeader() {
  $('#sch-head').innerHTML =
    `<th class="pin-cell pin-reset ${schState.sortField ? '' : 'active'}" data-pinsort
       title="Pinned first (default order) — click to reset sort"><i class="fa-solid fa-thumbtack"></i></th>` +
    '<th class="pin-cell"></th>' +
    sortableHeaderHtml(SCH_COLUMNS, schState.sortField, schState.sortOrder);
}

function renderSchRows() {
  if (schState.sortField) {
    const dir = schState.sortOrder === 'DESC' ? -1 : 1;
    schState.rows.sort((a, b) => dir * String(a[schState.sortField] ?? '').toLowerCase()
      .localeCompare(String(b[schState.sortField] ?? '').toLowerCase()));
  } else {
    schState.rows.sort((a, b) => safeInt(b.viewed) - safeInt(a.viewed)); // most-viewed default
  }
  // pinned float to the top only in the default order
  if (!schState.sortField) {
    schState.rows = [
      ...schState.rows.filter((s) => schState.pinned.has(String(s.id ?? s.schematic_id ?? ''))),
      ...schState.rows.filter((s) => !schState.pinned.has(String(s.id ?? s.schematic_id ?? ''))),
    ];
  }
  const cards = schState.view === 'cards';
  $('#sch-tablewrap').hidden = cards;
  $('#sch-cards').hidden = !cards;
  if (cards) {
    schEnsureModelLib();
    if (!schState.modelIds) schLoadModelIds();
    // the 3D grid only shows schematics that HAVE a model (like the site's
    // "3D only" view) — everything else stays reachable in list view
    const withModels = schState.modelIds
      ? schState.rows.map((s, i) => [s, i]).filter(([s]) =>
          schState.modelIds.has(String(s.id ?? s.schematic_id ?? '')))
      : [];
    $('#sch-cards').innerHTML = withModels.length
      ? withModels.map(([s, i]) => schCardHtml(s, i)).join('')
      : `<div class="al-empty sch-cards-empty">${schState.modelIds
          ? 'No 3D models among these schematics — switch to list view to see them all.'
          : 'Loading models…'}</div>`;
  } else {
    $('#sch-body').innerHTML = schState.rows.map(schRowHtml).join('');
  }
}

// card view: the site's 3D grid, app-side — models lazy-load as they scroll in
function schCardHtml(schem, idx) {
  const id = String(schem.id ?? schem.schematic_id ?? '');
  const isPinned = schState.pinned.has(id);
  const inMys = mysState.schematicIds.has(id);
  const hasModel = schState.modelIds ? schState.modelIds.has(id) : false;
  return `<div class="sch-card ${isPinned ? 'pinned' : ''}" data-idx="${idx}" data-id="${id}">
    <div class="sch-card-model">${hasModel
      ? `<model-viewer src="https://swgtracker.com/items/${id}.glb" loading="lazy" auto-rotate
           auto-rotate-delay="0" interaction-prompt="none" exposure="1.1"></model-viewer>`
      : '<i class="fa-solid fa-scroll sch-card-nomodel"></i>'}</div>
    <div class="sch-card-name">${escapeHtml(schem.name || '')}</div>
    <div class="sch-card-cat">${escapeHtml(schem.parent || '')}</div>
    <span class="sch-card-actions">
      <span class="pin-cell ${isPinned ? 'pinned-star' : ''}" data-pin="${id}" title="Pin"><i class="fa-solid fa-thumbtack"></i></span>
      <span class="pin-cell mys-add ${inMys ? 'in-mys' : ''}" data-mys="${id}" data-name="${escapeHtml(schem.name || '')}"
        title="${inMys ? 'In My Schematics' : 'Add to My Schematics'}"><i class="fa-solid ${inMys ? 'fa-check add-ok' : 'fa-screwdriver-wrench'}"></i></span>
    </span>
  </div>`;
}

function schRowHtml(schem, idx) {
  const id = String(schem.id ?? schem.schematic_id ?? '');
  const isPinned = schState.pinned.has(id);
  const star = 'fa-solid fa-thumbtack'; // pin; color (red when pinned) via .pinned-star
  return `<tr class="${isPinned ? 'pinned' : ''}" data-idx="${idx}" data-id="${id}">
    <td class="pin-cell ${isPinned ? 'pinned-star' : ''}" data-pin="${id}" title="Pin"><i class="${star}"></i></td>
    <td class="pin-cell mys-add ${mysState.schematicIds.has(id) ? 'in-mys' : ''}" data-mys="${id}"
        data-name="${escapeHtml(schem.name || '')}"
        title="${mysState.schematicIds.has(id) ? 'In My Schematics' : 'Add to My Schematics'}">
        <i class="fa-solid ${mysState.schematicIds.has(id) ? 'fa-check add-ok' : 'fa-screwdriver-wrench'}"></i></td>
    <td class="col-name res-name">${escapeHtml(schem.name || '')}</td>
    <td class="col-text res-type">${escapeHtml(schem.parent || '')}</td>
  </tr>`;
}

// ---- community review queue (unverified schematics awaiting confirmations) ----

let schReview = null; // {items, needed}, refreshed with each schematics page load

async function schLoadReview() {
  try {
    const res = await apiFetch('GET', 'api/user_schematics.php', { params: { action: 'review' } });
    if (!res.ok || !res.data || !Array.isArray(res.data.items)) return; // server predates the queue
    schReview = res.data;
  } catch (_) { return; }
  const items = schReview.items;
  // always visible once the server supports it — an empty queue says so in
  // the panel; hiding the button just made the feature undiscoverable
  $('#sch-review-btn').hidden = false;
  // the badge counts what still needs YOUR eyes: not yours, not yet voted
  const pending = items.filter((i) => !i.mine && !i.voted).length;
  const badge = $('#sch-review-count');
  badge.hidden = !pending;
  badge.textContent = String(pending);
  if (!$('#sch-review-panel').hidden) schRenderReviewPanel(); // refresh if open
}

function schRenderReviewPanel() {
  const items = schReview?.items || [];
  $('#sch-review-panel').innerHTML = `
    <div class="sch-review-head"><i class="fa-solid fa-user-check"></i>
      <b>Awaiting community review</b>
      <span class="al-comm-sub">open one, check it against its proof screenshots, and confirm — ${schReview?.needed ?? 3} confirmations make it official</span></div>
    ${items.length ? items.map((i) => `
      <div class="sch-review-row" data-revopen="${i.id}" data-name="${escapeHtml(i.name)}">
        <b>${escapeHtml(i.name)}</b>
        <span class="sch-review-cat">${escapeHtml(i.parent || '')}${i.by ? ` · by ${escapeHtml(i.by)}` : ''}</span>
        <span class="sch-review-votes">${i.votes} of ${i.needed}</span>
        ${safeInt(i.flags) ? `<span class="sb-chip sb-chip-flag" title="A reviewer flagged this as incorrect — open it to read what needs fixing"><i class="fa-solid fa-flag"></i> flagged</span>` : ''}
        ${i.mine ? '<span class="sb-chip">yours</span>'
          : i.voted ? '<span class="sb-chip sb-chip-pub">confirmed</span>'
          : '<span class="sb-chip sb-chip-todo">needs your review</span>'}
      </div>`).join('')
      : '<div class="sch-review-row stat_off">Nothing awaiting review right now — community submissions land here for verification.</div>'}`;
}

// Category dropdown from api/categories.php (12 profession parents); once per session
let schCategoriesLoaded = false;
async function loadSchCategories() {
  if (schCategoriesLoaded) return;
  schCategoriesLoaded = true;
  let res;
  try { res = await api().get_categories(); } catch (_) { return; }
  if (!res.ok || !res.data) return;
  const cats = (res.data.schematic_categories || []).map((c) => c.parent).filter(Boolean);
  $('#sch-category').innerHTML = '<option value="">All Categories</option>' +
    cats.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
}

async function loadSchematics() {
  showGridLoading('#sch-loading');
  $('#sch-empty').hidden = true;

  loadSchCategories(); // fire-and-forget; fills the dropdown on first load
  schLoadReview();     // fire-and-forget; badges the community review queue

  let res;
  try {
    res = await api().search_schematics({
      search: $('#sch-search').value.trim(),
      category: $('#sch-category').value,
      subcategory: schState.subcategory || '',
      page: schState.page,
    });
  } catch (e) { res = { ok: false, error: String(e) }; }
  // breadcrumb subcategory filter: visible + clearable while active
  const chip = $('#sch-subchip');
  chip.hidden = !schState.subcategory;
  if (schState.subcategory) {
    chip.innerHTML = `${escapeHtml(schState.subcategory)} <i class="fa-solid fa-xmark" title="Clear"></i>`;
  }

  $('#sch-loading').hidden = true;

  if (!res.ok) {
    showSchEmpty(`Error: ${res.error || 'failed to load'}`);
    checkAuthError(res.error);
    return;
  }

  const data = res.data || {};
  let rows = data.results || data.schematics || (Array.isArray(data) ? data : []);
  const total = data.total_results ?? data.total ?? rows.length;
  const totalPages = data.total_pages ?? 1;
  const page = data.page ?? schState.page;

  if ($('#sch-pinned-only').checked) {
    rows = rows.filter((s) => schState.pinned.has(String(s.id ?? s.schematic_id ?? '')));
  }

  schState.rows = rows;

  if (!rows.length) {
    showSchEmpty($('#sch-pinned-only').checked ? 'No pinned schematics on this page.' : 'No schematics found.');
    $('#sch-status').textContent = '';
  } else {
    renderSchRows();
    $('#sch-status').textContent = `Page ${page} of ${totalPages} — ${fmtNum(total)} total schematics`
      + (data.offline ? ' · offline data' : '');
    if (data.offline) setOffline(true); // don't wait for the next pulse poll
  }

  $('#sch-prev').disabled = page <= 1;
  $('#sch-next').disabled = page >= totalPages;
}

function showSchEmpty(msg) {
  $('#sch-body').innerHTML = '';
  const el = $('#sch-empty');
  el.textContent = msg;
  el.hidden = false;
}

// ---- Schematic detail PAGE — mirrors swgtracker.com/?s=<id> ----
// api/schematics.php?id= returns {schematic: {schematicName, resourcesNeeded,
// componentTypes, formula, resourceDtoList (current + server best spawns), ...}}

const SCD_STATS = ['oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe'];
// activeFormulas: Set of formula index strings currently checked. formulaIds:
// the formulaId parallel to s.formula, so a toggle re-fetches the server-ranked
// best lists for exactly the selected lines. hideMustafar: server-side filter.
const scdState = {
  schematic: null, tab: 'best', id: null,
  activeFormulas: new Set(), formulaIds: [], hideMustafar: false,
};

// The server ranks the best-resource lists by the active formulas (re-fetched on
// toggle) and by the Mustafar filter, so we just read its resourceQuality.
function scdSpawnQuality(spawn) {
  return Number(spawn.resourceQuality) || 0;
}

function scdSpawnAge(ts) {
  const n = safeInt(ts);
  if (n <= 0) return '';
  const days = Math.max(0, Math.floor((Date.now() / 1000 - n) / 86400));
  return days === 0 ? '(<1d in spawn)' : `(${days}d in spawn)`;
}

// stats that matter for the currently-checked formulas — highlighted like the lab
// bench; everything else is dimmed so the columns you're capping stand out.
function scdRelevantStats() {
  const s = scdState.schematic;
  const set = new Set();
  (s?.formula || []).forEach((f, i) => {
    if (!scdState.activeFormulas.has(String(i))) return;
    const w = mysParseWeights(f.formulaDescription);
    if (w) Object.keys(w).forEach((k) => set.add(k));
  });
  return set;
}

// One stat cell, "--" like the site's .stat_off.blank when the stat doesn't apply.
// relevant → green underline (lab-rel); irrelevant → dimmed (lab-dim).
function scdStatCell(spawn, field, relevant) {
  const cls = relevant ? 'lab-rel' : 'lab-dim';
  const v = safeInt(spawn[field]);
  if (v <= 0) return `<td class="stat stat_off ${cls}">--</td>`;
  const pct = (v / (safeInt(spawn[`${field}_max`]) || 1000)) * 100;
  return `<td class="stat ${qualityClass(pct)} ${cls}" title="${pct.toFixed(1)}%">${v}</td>`;
}

function scdSpawnRowHtml(spawn, group, highlight, rel) {
  const q = scdSpawnQuality(spawn);
  // Age like the site's Best tab ("Added 3 days ago", exact date on hover) —
  // Philosophy/Eponine's request
  const ts = safeInt(spawn.timestamp);
  return `<tr class="scd-row ${highlight ? 'activeResource' : ''}" data-group="${group}">
    ${addCellHtml(safeInt(spawn.resourceId), spawn.resourceName)}
    ${wishCellHtml(safeInt(spawn.resourceId), spawn.resourceName)}
    <td class="col-text"><span class="scd-reslink" data-res="${escapeHtml(spawn.resourceName || '')}"
      title="${escapeHtml(spawn.resourceTypeName || 'Open resource page')}">${escapeHtml(spawn.resourceName || '')}</span></td>
    <td class="stat ${qualityClass(q / 10)}">${q.toFixed(2)}</td>
    ${SCD_STATS.map((f) => scdStatCell(spawn, f, rel.has(f))).join('')}
    <td class="scd-agecell" ${ts ? `title="${escapeHtml(fmtDate(ts))}"` : ''}>${ts ? `Added ${fmtAgo(ts)}` : '--'}</td>
  </tr>`;
}

function renderScdTable() {
  const s = scdState.schematic;
  if (!s) return;
  $('#scd-loading').hidden = true;

  const rel = scdRelevantStats();
  $('#scd-head').innerHTML =
    '<th class="pin-cell"></th><th class="pin-cell"></th><th class="col-name">Resource Name</th><th>Quality</th>' +
    SCD_STATS.map((f) => `<th class="${rel.has(f) ? 'lab-rel-h' : 'lab-dim'}">${f.toUpperCase()}</th>`).join('') +
    '<th>Age</th>';

  const listKey = scdState.tab === 'current' ? 'currentBestResourceList' : 'serverBestResourceList';
  const groups = (s.resourceDtoList || []).map((dto) => {
    // Re-sort by the currently-active-formula quality (best first), so toggling
    // formulas reorders the list the way the site does.
    const spawns = [...(dto[listKey] || [])].sort((a, b) => scdSpawnQuality(b) - scdSpawnQuality(a));
    const age = scdState.tab === 'current' && spawns.length ? scdSpawnAge(spawns[0].timestamp) : '';
    const header = `<tr class="scd-group" data-toggle="${dto.resourceTypeCode}">
      <td class="col-text" colspan="${SCD_STATS.length + 5}">
        <i class="fa-solid fa-caret-down"></i> ${escapeHtml(dto.resourceTypeName || '')}
        ${age ? `<span class="scd-age">${age}</span>` : ''}
        ${spawns.length ? '' : '<span class="scd-age">(none in spawn)</span>'}
      </td>
    </tr>`;
    // Green tint semantics: Best tab = best-ever that's currently farmable;
    // Current tab = in spawn AND ranks among the all-time best (everything on
    // that tab is "current", so plain active would tint every row).
    const bestIds = new Set((dto.serverBestResourceList || []).map((x) => String(x.resourceId)));
    return header + spawns.map((sp) => {
      const active = mysSpawnActive(sp);
      const highlight = scdState.tab === 'current'
        ? active && bestIds.has(String(sp.resourceId))
        : active;
      return scdSpawnRowHtml(sp, dto.resourceTypeCode, highlight, rel);
    }).join('');
  });

  $('#scd-body').innerHTML = groups.join('');
}

function renderSchematicPage(s) {
  scdState.schematic = s;

  // Breadcrumb — every level navigates: Schematics (all) › Parent (profession
  // filter) › Category (exact subcategory filter) › Name
  $('#scd-crumbs').innerHTML = [
    '<a role="button" data-nav="schematics">Schematics</a>',
    s.schematicCategoryParent
      ? `<a role="button" data-catnav="${escapeHtml(s.schematicCategoryParent)}">${escapeHtml(s.schematicCategoryParent)}</a>` : '',
    s.schematicCategory
      ? `<a role="button" data-catnav="${escapeHtml(s.schematicCategoryParent || '')}" data-subnav="${escapeHtml(s.schematicCategory)}">${escapeHtml(s.schematicCategory)}</a>` : '',
    `<span class="crumb-current">${escapeHtml(s.schematicName || '')}</span>`,
  ].filter(Boolean).join('<span class="crumb-sep">›</span>');

  // Info card
  $('#scd-name').textContent = s.schematicName || '';
  $('#scd-desc').textContent = s.schematicDescription || '';
  $('#scd-meta').textContent = [
    s.crateSize ? `Crate Size: ${s.crateSize}` : '',
    s.schematicQuality ? `Quality: ${String(s.schematicQuality).toUpperCase()}` : '',
  ].filter(Boolean).join('   ');
  $('#scd-benefit').innerHTML = String(s.manufactured) === 'yes' || s.formula?.length
    ? '<span class="benefits">Benefits from Experimenting</span>' : '';

  // Resources needed — "40 of Beyrllius Copper" + total units
  const needed = s.resourcesNeeded || [];
  const total = needed.reduce((sum, r) => sum + safeInt(r.units), 0);
  // slot labels visible inline (not tooltip-only) so reviewers can check the
  // label ("Reaction Medium") against the class ("Reactive Gas") in the proof
  $('#scd-resneeded').innerHTML = needed.map((r) =>
    `<div class="scd-line">${safeInt(r.units)} of <span class="scd-restype">${escapeHtml(r.resourceName || '')}</span>${(r.desc || '').trim()
      ? ` <span class="scd-slotlabel">(${escapeHtml(r.desc)})</span>` : ''}</div>`
  ).join('') + (needed.length ? `<div class="scd-line scd-total">${total} Total Resource Units</div>` : '<div class="scd-line">None</div>');

  // Components needed — one line per entry, names open that schematic's page
  const comps = s.componentTypes || [];
  $('#scd-components').innerHTML = comps.length ? comps.map((c) => {
    const verb = c.optional === 'yes' ? 'Optional' : 'Requires';
    const name = c.type === 'schematic'
      ? `<a role="button" class="scd-complink" data-schem="${escapeHtml(String(c.id))}">${escapeHtml(c.desc || '')}</a>`
      : escapeHtml(c.desc || '');
    const looted = c.looted === 'yes' ? ' <span class="scd-age">(looted)</span>' : '';
    return `<div class="scd-line">${verb} ${Math.max(1, safeInt(c.number))} ${name}${looted}</div>`;
  }).join('') : '<div class="scd-line">None</div>';

  // Formula switches — toggling re-fetches the server-ranked best lists for the
  // checked lines (like the site). Track the formulaId parallel to s.formula.
  scdState.formulaIds = (s.formula || []).map((f) => f.formulaId);
  scdState.activeFormulas = new Set(
    (s.formula || []).map((f, i) => [f, i]).filter(([f]) => f.active !== false).map(([, i]) => String(i)));
  $('#scd-formulas').innerHTML = (s.formula || []).map((f, i) => `
    <div class="form-check form-switch scd-formula">
      <input class="form-check-input" type="checkbox" id="scd-f${i}" data-scdfid="${i}" ${f.active !== false ? 'checked' : ''}>
      <label class="form-check-label" for="scd-f${i}">${escapeHtml(f.formulaDescription || '')}</label>
    </div>`).join('');

  renderScdTable();
  updateScdMysButton();
  updateScdMustafarBtn();
}

function updateScdMustafarBtn() {
  const btn = $('#scd-mustafar');
  if (!btn) return;
  btn.classList.toggle('active', scdState.hideMustafar);
  btn.innerHTML = scdState.hideMustafar
    ? '<i class="fa-solid fa-fire-flame-curved"></i> Show Mustafar'
    : '<i class="fa-solid fa-fire"></i> Hide Mustafar';
}

async function openSchematicPage(id, name) {
  scdState.id = String(id);
  scdState.hideMustafar = false;
  showPage('schematic');
  $('#page-schematic').classList.add('scd-busy'); // hide empty card shells while loading
  $('#scd-mys').hidden = true;
  $('#scd-crumbs').innerHTML = '<a href="#" data-nav="schematics">Schematics</a>';
  $('#scd-name').textContent = name || 'Loading…';
  $('#scd-desc').textContent = '';
  $('#scd-meta').textContent = '';
  $('#scd-benefit').innerHTML = '';
  $('#scd-resneeded').innerHTML = '';
  $('#scd-components').innerHTML = '';
  $('#scd-formulas').innerHTML = '';
  $('#scd-body').innerHTML = '';
  $('#scd-head').innerHTML = '';
  showGridLoading('#scd-loading');

  let res;
  try { res = await api().get_schematic(id); }
  catch (e) { res = { ok: false, error: String(e) }; }

  $('#scd-loading').hidden = true;
  $('#page-schematic').classList.remove('scd-busy');

  const s = res.ok && res.data ? (res.data.schematic || res.data) : null;
  if (!s || !s.schematicName) {
    $('#scd-name').textContent = 'Failed to load schematic';
    $('#scd-desc').textContent = res.error || 'Unexpected response from the server.';
    return;
  }
  renderSchematicPage(s);
  if (typeof sbRenderVerifyBar === 'function') {
    sbRenderVerifyBar(scdState.id, !!s.communitySubmitted); // community badge + Confirm
  }
  scdRenderModel(scdState.id);
  if (s.communitySubmitted) {
    // no blackbox for community schematics — fill best/current from the mirror
    await scdComputeCommunityLists(s);
    if (String(s.schematicId) === String(scdState.id)) renderScdTable();
  }
}

// 3D model when the site has one exported (swgtracker.com/items/<id>.glb —
// same files the website's schematic pages spin). The viewer lib loads lazily
// on first use; a schematic without a model (fetch 404 / CORS pending) just
// keeps the card hidden.
function scdRenderModel(id) {
  const card = $('#scd-modelcard');
  const host = $('#scd-model');
  if (!card || !host) return;
  card.hidden = true;
  host.innerHTML = '';
  // the expand button lives on the CARD, not the host — drop the previous
  // schematic's or its zoom keeps opening the model you navigated away from
  card.querySelector('.scd-mv-expand')?.remove();
  if (!document.getElementById('mv-lib')) {
    const s = document.createElement('script');
    s.type = 'module';
    s.id = 'mv-lib';
    s.src = 'https://ajax.googleapis.com/ajax/libs/model-viewer/3.5.0/model-viewer.min.js';
    document.head.appendChild(s);
  }
  const url = `https://swgtracker.com/items/${encodeURIComponent(String(id))}.glb`;
  if (!schState.modelIds) schLoadModelIds(); // warm the has-a-model cache
  // No layout snap: when we KNOW a model exists (cached item list), the card
  // reserves its space immediately with a quiet spinner; the model itself
  // stays invisible until fully rendered, then fades in.
  const start = () => {
    if (String(id) !== String(scdState.id)) return;
    card.hidden = false;
    host.innerHTML = '<div class="scd-model-loading"><span class="spinner"></span></div>';
    const mv = document.createElement('model-viewer');
    mv.setAttribute('src', url);
    mv.setAttribute('loading', 'eager');
    mv.setAttribute('camera-controls', '');
    mv.setAttribute('auto-rotate', '');
    mv.setAttribute('auto-rotate-delay', '0');
    mv.setAttribute('shadow-intensity', '1');
    mv.setAttribute('exposure', '1.1');
    mv.setAttribute('interaction-prompt', 'none');
    mv.classList.add('scd-mv-pending');
    mv.addEventListener('load', () => {
      if (String(id) !== String(scdState.id)) return;
      host.querySelector('.scd-model-loading')?.remove();
      mv.classList.remove('scd-mv-pending');
      const btn = card.querySelector('.scd-mv-expand');
      if (btn) {
        btn.dataset.mvzoom = url; // never trust a leftover button's url
      } else {
        card.insertAdjacentHTML('beforeend',
          `<button class="btn btn-icon scd-mv-expand" data-mvzoom="${escapeHtml(url)}" title="View full size"><i class="fa-solid fa-expand"></i></button>`);
      }
    });
    mv.addEventListener('error', () => { card.hidden = true; });
    host.appendChild(mv);
  };
  if (schState.modelIds) {
    if (schState.modelIds.has(String(id))) start(); // known model — reserve instantly
    // known modelless — card stays hidden, zero probes
  } else {
    // cache not warm yet — fall back to a HEAD probe
    fetch(url, { method: 'HEAD' }).then((r) => { if (r.ok) start(); })
      .catch(() => { /* offline — card stays hidden */ });
  }
}

// full-screen model modal — drag to orbit, scroll to zoom, ✕ or backdrop closes
function scdModelZoom(url) {
  const ov = document.createElement('div');
  ov.className = 'sb-lightbox scd-mv-zoom';
  ov.innerHTML = `<model-viewer src="${escapeHtml(url)}" loading="eager" camera-controls auto-rotate
      auto-rotate-delay="0" shadow-intensity="1" exposure="1.1" interaction-prompt="none"></model-viewer>
    <button class="btn btn-icon scd-mv-close" title="Close"><i class="fa-solid fa-xmark"></i></button>`;
  ov.addEventListener('click', (e) => {
    if (e.target === ov || e.target.closest('.scd-mv-close')) ov.remove();
  });
  document.body.appendChild(ov);
}

// Community schematics have no blackbox behind them — compute the best and
// current lists from the local mirror, the same math My Schematics and the
// Lab use (weighted quality of the ACTIVE formulas against the class caps).
async function scdComputeCommunityLists(s) {
  if (!s || !s.communitySubmitted || !Array.isArray(s.resourceDtoList)) return;
  const fl = s.formula || [];
  const act = [...scdState.activeFormulas].map((i) => fl[Number(i)]).filter(Boolean);
  const weightsList = (act.length ? act : fl)
    .map((f) => mysParseWeights(f.formulaDescription)).filter(Boolean);
  for (const dto of s.resourceDtoList) {
    const code = String(dto.resourceTypeCode || '');
    if (!code) continue;
    let res;
    try { res = await classPool(code); } catch (_) { continue; }
    const rows = (res && res.ok && res.data) || [];
    const caps = typeof classCaps === 'function' ? classCaps(code) : null;
    const scored = rows.map((p) => ({
      resourceId: p.id, resourceName: p.name, resourceTypeName: p.type_name,
      resourceQuality: mysWeightedQuality(p, weightsList, caps) || 0,
      timestamp: p.timestamp, status: p.status,
      ...Object.fromEntries(SCD_STATS.flatMap((f) => [[f, p[f]], [`${f}_max`, p[`${f}_max`]]])),
    })).sort((a, b) => b.resourceQuality - a.resourceQuality);
    dto.serverBestResourceList = scored.slice(0, 10);
    dto.currentBestResourceList = scored.filter((x) => safeInt(x.status) === 1).slice(0, 10);
  }
}

// Re-fetch the best/current resource lists ranked by the checked formulas (and
// the Mustafar filter) — the server does the ranking, matching the website.
// Community schematics skip the server and recompute locally instead.
let scdReqToken = 0;
async function refetchScdBest() {
  if (!scdState.id) return;
  if (scdState.schematic?.communitySubmitted) {
    await scdComputeCommunityLists(scdState.schematic);
    renderScdTable();
    return;
  }
  const token = ++scdReqToken;
  const ids = [...scdState.activeFormulas]
    .map((i) => scdState.formulaIds[i]).filter((x) => x != null).join(',');
  showGridLoading('#scd-loading');
  let res;
  try { res = await api().get_schematic(scdState.id, ids, !scdState.hideMustafar); }
  catch (_) { res = { ok: false }; }
  if (token !== scdReqToken) return; // a newer toggle superseded this fetch
  $('#scd-loading').hidden = true;
  const s = res.ok && res.data ? (res.data.schematic || res.data) : null;
  if (s && s.resourceDtoList && scdState.schematic) {
    scdState.schematic.resourceDtoList = s.resourceDtoList;
  }
  renderScdTable();
}

function initSchematicPage() {
  // Breadcrumb back-nav: plain "Schematics", or a category-filtered list
  $('#scd-crumbs').addEventListener('click', (e) => {
    const cat = e.target.closest('[data-catnav]');
    if (cat) {
      e.preventDefault();
      $('#sch-category').value = cat.dataset.catnav || '';
      schState.subcategory = cat.dataset.subnav || '';
      schState.page = 1;
      showPage('schematics');
      loadSchematics();
      return;
    }
    const link = e.target.closest('[data-nav]');
    if (!link) return;
    e.preventDefault();
    showPage(link.dataset.nav);
  });

  // Tabs
  $('#scd-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-tab]');
    if (!tab) return;
    e.preventDefault();
    scdState.tab = tab.dataset.tab;
    document.querySelectorAll('#scd-tabs [data-tab]').forEach((t) =>
      t.classList.toggle('active', t === tab));
    renderScdTable();
  });

  // Formula toggles re-fetch the server-ranked best lists for the checked lines
  $('#scd-formulas').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-scdfid]');
    if (!cb) return;
    if (cb.checked) scdState.activeFormulas.add(cb.dataset.scdfid);
    else scdState.activeFormulas.delete(cb.dataset.scdfid);
    refetchScdBest();
  });

  // Hide/Show Mustafar resources — re-fetch with the server-side mustafar filter
  $('#scd-mustafar').addEventListener('click', () => {
    scdState.hideMustafar = !scdState.hideMustafar;
    updateScdMustafarBtn();
    refetchScdBest();
  });

  // Component links open that schematic's page
  $('#scd-components').addEventListener('click', (e) => {
    const link = e.target.closest('[data-schem]');
    if (!link) return;
    e.preventDefault();
    openSchematicPage(link.dataset.schem, link.textContent);
  });

  // Group collapse + add-to-stockpile + resource-name → resource detail page
  $('#scd-body').addEventListener('click', async (e) => {
    const addCell = e.target.closest('[data-add]');
    if (addCell) { handleAddCellClick(addCell, e); return; }
    const wishCell = e.target.closest('[data-wish]');
    if (wishCell) { handleWishCellClick(wishCell); return; }
    const group = e.target.closest('[data-toggle]');
    if (group) {
      const key = group.dataset.toggle;
      const caret = group.querySelector('i');
      const hidden = caret.classList.toggle('fa-caret-right');
      caret.classList.toggle('fa-caret-down', !hidden);
      document.querySelectorAll(`#scd-body tr.scd-row[data-group="${key}"]`)
        .forEach((r) => { r.hidden = hidden; });
      return;
    }
    const res = e.target.closest('[data-res]');
    if (res) openResourcePage(res.dataset.res);
  });
}

function initSchematics() {
  buildSchHeader();

  // Client-side column sort; third click on a column returns to most-viewed
  $('#sch-head').addEventListener('click', (e) => {
    const pinReset = e.target.closest('[data-pinsort]');
    if (pinReset) {
      if (schState.sortField === null) return; // already default
      schState.sortField = null;
      buildSchHeader();
      if (schState.rows.length) renderSchRows();
      return;
    }
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const field = th.dataset.sort;
    if (schState.sortField === field && schState.sortOrder === 'ASC') {
      schState.sortOrder = 'DESC';
    } else if (schState.sortField === field) {
      schState.sortField = null; // back to most-viewed
    } else {
      schState.sortField = field;
      schState.sortOrder = 'ASC';
    }
    buildSchHeader();
    if (schState.rows.length) renderSchRows();
  });

  $('#sch-search-btn').addEventListener('click', () => { schState.page = 1; loadSchematics(); });
  // typeahead (server-side search → debounced) + Enter for instant
  let schSearchTimer = null;
  $('#sch-search').addEventListener('input', () => {
    clearTimeout(schSearchTimer);
    schSearchTimer = setTimeout(() => { schState.page = 1; loadSchematics(); }, 300);
  });
  $('#sch-search').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { clearTimeout(schSearchTimer); schState.page = 1; loadSchematics(); }
  });
  $('#sch-category').addEventListener('change', () => { schState.page = 1; loadSchematics(); });
  $('#sch-pinned-only').addEventListener('change', () => loadSchematics());
  $('[data-refresh="schematics"]').addEventListener('click', () => loadSchematics());
  $('#sch-prev').addEventListener('click', () => { if (schState.page > 1) { schState.page--; loadSchematics(); } });
  $('#sch-next').addEventListener('click', () => { schState.page++; loadSchematics(); });

  // Pin star toggles / add to My Schematics; any other cell opens the schematic's page.
  // one dispatcher serves the table AND the card grid
  const schListClick = async (e) => {
    const mysCell = e.target.closest('[data-mys]');
    if (mysCell) {
      if (mysCell.classList.contains('in-mys')) { toast(`${mysCell.dataset.name} is already in My Schematics`); return; }
      const icon = mysCell.querySelector('i');
      icon.className = 'fa-solid fa-hourglass-half';
      await addToMySchematics(mysCell.dataset.mys, mysCell.dataset.name);
      refreshMysIcons();
      return;
    }
    const pin = e.target.closest('[data-pin]');
    if (pin) {
      try {
        const res = await api().toggle_pin_schematic(pin.dataset.pin);
        if (res.ok) schState.pinned = new Set((res.data || []).map(String));
        loadSchematics();
      } catch (_) { /* ignore */ }
      return;
    }
    const row = e.target.closest('tr[data-idx], .sch-card[data-idx]');
    if (!row) return;
    if (e.target.closest('model-viewer')) return; // orbiting a card model isn't a click-through
    const schem = schState.rows[safeInt(row.dataset.idx)];
    if (schem && row.dataset.id) openSchematicPage(row.dataset.id, schem.name);
  };
  $('#sch-body').addEventListener('click', schListClick);
  $('#sch-cards').addEventListener('click', schListClick);

  // community review queue: toggle the panel, open rows into the detail page
  $('#sch-review-btn').addEventListener('click', () => {
    const panel = $('#sch-review-panel');
    if (panel.hidden) { schRenderReviewPanel(); panel.hidden = false; }
    else panel.hidden = true;
  });
  $('#sch-review-panel').addEventListener('click', (e) => {
    const row = e.target.closest('[data-revopen]');
    if (row) openSchematicPage(row.dataset.revopen, row.dataset.name);
  });

  // list/cards toggle — same icon pair as Lab and Factories
  const schSyncViewBtn = () => {
    $('#sch-viewtoggle').innerHTML = `<i class="fa-solid ${schState.view === 'cards' ? 'fa-list' : 'fa-table-cells-large'}"></i>`;
    $('#sch-viewtoggle').title = schState.view === 'cards' ? 'Switch to list view' : 'Switch to card view (3D models)';
  };
  schSyncViewBtn();
  $('#sch-viewtoggle').addEventListener('click', () => {
    schState.view = schState.view === 'cards' ? 'list' : 'cards';
    localStorage.setItem('sch-view', schState.view);
    schSyncViewBtn();
    renderSchRows();
  });

  // subcategory chip (breadcrumb filter) — click clears it
  $('#sch-subchip').addEventListener('click', () => {
    schState.subcategory = '';
    schState.page = 1;
    loadSchematics();
  });
  $('#sch-category').addEventListener('change', () => { schState.subcategory = ''; });

  // 3D zoom modal from the detail card's expand button
  document.addEventListener('click', (e) => {
    const z = e.target.closest('[data-mvzoom]');
    if (z) scdModelZoom(z.dataset.mvzoom);
  });
  // Escape closes any full-screen lightbox (model zoom), else the frontmost
  // floating screenshot window
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const ov = document.querySelector('.sb-lightbox');
    if (ov) { ov.remove(); return; }
    const wins = [...document.querySelectorAll('.sb-shotwin')];
    if (wins.length) {
      wins.sort((a, b) => safeInt(a.style.zIndex) - safeInt(b.style.zIndex)).pop().remove();
    }
  });

  initSchematicPage();
}
