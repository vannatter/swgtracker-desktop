/* Schematics page — mirrors src/gui/schematics_tab.py.
   Search + pinned-only grid; click a row to load its best-resource detail. */

// sortField null = the default most-viewed order
const schState = { page: 1, pinned: new Set(), rows: [], sortField: null, sortOrder: 'ASC' };
const SCH_COLUMNS = [['Name', 'name', 'col-name'], ['Category', 'parent', 'col-text']];

function buildSchHeader() {
  $('#sch-head').innerHTML =
    `<th class="pin-cell pin-reset ${schState.sortField ? '' : 'active'}" data-pinsort
       title="Pinned first (default order) — click to reset sort"><i class="fa-solid fa-star"></i></th>` +
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
  $('#sch-body').innerHTML = schState.rows.map(schRowHtml).join('');
}

function schRowHtml(schem, idx) {
  const id = String(schem.id ?? schem.schematic_id ?? '');
  const isPinned = schState.pinned.has(id);
  const star = isPinned ? 'fa-solid fa-star' : 'fa-regular fa-star';
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

  let res;
  try {
    res = await api().search_schematics({
      search: $('#sch-search').value.trim(),
      category: $('#sch-category').value,
      page: schState.page,
    });
  } catch (e) { res = { ok: false, error: String(e) }; }

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
// activeFormulas: Set of formula index strings currently checked (drives the
// live Quality recompute). formulaDefs: [{weights}] parallel to s.formula.
const scdState = { schematic: null, tab: 'best', id: null, activeFormulas: new Set(), formulaDefs: [] };

// Quality for a spawn under the currently-checked formulas; falls back to the
// server's all-formula resourceQuality when none are toggled on.
function scdSpawnQuality(spawn) {
  const weights = [...scdState.activeFormulas]
    .map((i) => scdState.formulaDefs[i]).filter(Boolean);
  if (!weights.length) return Number(spawn.resourceQuality) || 0;
  const q = weightedQuality(spawn, weights);
  return q == null ? (Number(spawn.resourceQuality) || 0) : q;
}

function scdSpawnAge(ts) {
  const n = safeInt(ts);
  if (n <= 0) return '';
  const days = Math.max(0, Math.floor((Date.now() / 1000 - n) / 86400));
  return days === 0 ? '(<1d in spawn)' : `(${days}d in spawn)`;
}

// One stat cell, "--" like the site's .stat_off.blank when the stat doesn't apply
function scdStatCell(spawn, field) {
  const v = safeInt(spawn[field]);
  if (v <= 0) return '<td class="stat stat_off">--</td>';
  return statCell(v, spawn[`${field}_max`]);
}

function scdSpawnRowHtml(spawn, group, highlight) {
  const q = scdSpawnQuality(spawn);
  return `<tr class="scd-row ${highlight ? 'activeResource' : ''}" data-group="${group}">
    ${addCellHtml(safeInt(spawn.resourceId), spawn.resourceName)}
    ${wishCellHtml(safeInt(spawn.resourceId), spawn.resourceName)}
    <td class="col-text"><span class="scd-reslink" data-res="${escapeHtml(spawn.resourceName || '')}"
      title="Open resource page">${escapeHtml(spawn.resourceName || '')}</span></td>
    <td class="stat ${qualityClass(q / 10)}">${q.toFixed(2)}</td>
    ${SCD_STATS.map((f) => scdStatCell(spawn, f)).join('')}
  </tr>`;
}

function renderScdTable() {
  const s = scdState.schematic;
  if (!s) return;
  $('#scd-loading').hidden = true;

  $('#scd-head').innerHTML =
    '<th class="pin-cell"></th><th class="pin-cell"></th><th class="col-name">Resource Name</th><th>Quality</th>' +
    SCD_STATS.map((f) => `<th>${f.toUpperCase()}</th>`).join('');

  const listKey = scdState.tab === 'current' ? 'currentBestResourceList' : 'serverBestResourceList';
  const groups = (s.resourceDtoList || []).map((dto) => {
    // Re-sort by the currently-active-formula quality (best first), so toggling
    // formulas reorders the list the way the site does.
    const spawns = [...(dto[listKey] || [])].sort((a, b) => scdSpawnQuality(b) - scdSpawnQuality(a));
    const age = scdState.tab === 'current' && spawns.length ? scdSpawnAge(spawns[0].timestamp) : '';
    const header = `<tr class="scd-group" data-toggle="${dto.resourceTypeCode}">
      <td class="col-text" colspan="${SCD_STATS.length + 4}">
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
      return scdSpawnRowHtml(sp, dto.resourceTypeCode, highlight);
    }).join('');
  });

  $('#scd-body').innerHTML = groups.join('');
}

function renderSchematicPage(s) {
  scdState.schematic = s;

  // Breadcrumb — Schematics › Parent › Category › Name (no href: see scd-tabs note)
  $('#scd-crumbs').innerHTML = [
    '<a role="button" data-nav="schematics">Schematics</a>',
    escapeHtml(s.schematicCategoryParent || ''),
    escapeHtml(s.schematicCategory || ''),
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
  $('#scd-resneeded').innerHTML = needed.map((r) =>
    `<div class="scd-line">${safeInt(r.units)} of <span class="scd-restype" title="${escapeHtml(r.desc || '')}">${escapeHtml(r.resourceName || '')}</span></div>`
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

  // Formula switches (display-only for now; the site recalculates weights live)
  // Formula toggles drive the live Quality recompute; active-by-default ones on.
  scdState.formulaDefs = (s.formula || []).map((f) => parseFormulaWeights(f.formulaDescription));
  scdState.activeFormulas = new Set(
    (s.formula || []).map((f, i) => [f, i]).filter(([f]) => f.active !== false).map(([, i]) => String(i)));
  $('#scd-formulas').innerHTML = (s.formula || []).map((f, i) => `
    <div class="form-check form-switch scd-formula">
      <input class="form-check-input" type="checkbox" id="scd-f${i}" data-scdfid="${i}" ${f.active !== false ? 'checked' : ''}>
      <label class="form-check-label" for="scd-f${i}">${escapeHtml(f.formulaDescription || '')}</label>
    </div>`).join('');

  renderScdTable();
  updateScdMysButton();
}

async function openSchematicPage(id, name) {
  scdState.id = String(id);
  showPage('schematic');
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

  const s = res.ok && res.data ? (res.data.schematic || res.data) : null;
  if (!s || !s.schematicName) {
    $('#scd-name').textContent = 'Failed to load schematic';
    $('#scd-desc').textContent = res.error || 'Unexpected response from the server.';
    return;
  }
  renderSchematicPage(s);
}

function initSchematicPage() {
  // Breadcrumb back-nav
  $('#scd-crumbs').addEventListener('click', (e) => {
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

  // Formula toggles recompute the resource Quality columns live
  $('#scd-formulas').addEventListener('change', (e) => {
    const cb = e.target.closest('[data-scdfid]');
    if (!cb) return;
    if (cb.checked) scdState.activeFormulas.add(cb.dataset.scdfid);
    else scdState.activeFormulas.delete(cb.dataset.scdfid);
    renderScdTable();
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
    if (addCell) { handleAddCellClick(addCell); return; }
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
  $('#sch-body').addEventListener('click', async (e) => {
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
    const row = e.target.closest('tr[data-idx]');
    if (!row) return;
    const schem = schState.rows[safeInt(row.dataset.idx)];
    if (schem && row.dataset.id) openSchematicPage(row.dataset.id, schem.name);
  });

  initSchematicPage();
}
