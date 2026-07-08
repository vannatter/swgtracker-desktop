/* Resource detail page — mirrors swgtracker.com/?r=<name>.
   Data via WebApi.get_resource -> {resource, top_uses, used_ins}. */

const RD_STATS = ['oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe'];
const rdState = { id: null, name: null, data: null };
// PLANET_FULL lives in shared.js

// The header button toggles stockpile membership for the shown resource.
function updateRdAddButton() {
  const btn = $('#rd-add');
  const inStock = typeof stkState !== 'undefined' && stkState.resourceIds.has(String(rdState.id));
  btn.hidden = false;
  btn.disabled = false;
  btn.classList.toggle('btn-accent', !inStock);
  btn.classList.toggle('btn-outline-secondary', inStock);
  btn.innerHTML = inStock
    ? '<i class="fa-solid fa-check"></i> In Stockpile — Remove'
    : '<i class="fa-solid fa-plus"></i> Add to Stockpile';
  if (inStock) reserveConfirmWidth(btn);
}

function updateRdWishButton() {
  const btn = $('#rd-wish');
  const wished = typeof wishState !== 'undefined' && wishState.resourceIds.has(String(rdState.id));
  const stocked = typeof stkState !== 'undefined' && stkState.resourceIds.has(String(rdState.id));
  btn.hidden = stocked; // one-list rule: stocked resources can't be wished
  btn.disabled = false;
  btn.innerHTML = wished
    ? '<i class="fa-solid fa-heart"></i> On Wishlist — Remove'
    : '<i class="fa-regular fa-heart"></i> Wishlist';
  if (wished) reserveConfirmWidth(btn);
}

// Card with the site's thin colored progress bar on top. pct in [0,100].
function rdCardHtml(value, label, pct, cls) {
  return `<div class="rd-card">
    <div class="rd-bar"><span class="rd-bar-fill ${cls}" style="width:${Math.max(0, Math.min(100, pct))}%"></span></div>
    <div class="rd-value ${cls}" title="${pct.toFixed(1)}%">${value}</div>
    <div class="rd-label">${label}</div>
  </div>`;
}

// status: '1' = currently in spawn, '0' = despawned (inactive_at is unreliable/null)
function rdIsActive(r) {
  return String(r.status ?? '0') === '1';
}

function rdAgeText(r) {
  const ts = safeInt(r.timestamp);
  const added = ts > 0 ? fmtDate(ts) : '';
  let spawn;
  if (!rdIsActive(r)) {
    const inactiveAt = safeInt(r.inactive_at);
    spawn = inactiveAt > 0 ? `Despawned ${fmtDate(inactiveAt)}` : 'Despawned';
  } else if (ts > 0) {
    const days = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 86400));
    spawn = days === 0 ? '<1d in spawn' : `${days}d in spawn`;
  }
  return [r.id ? `ID: ${r.id}` : '', added ? `Added ${added}` : '', spawn || '']
    .filter(Boolean).join('   ·   ');
}

function renderResourcePage(data) {
  const r = data.resource || {};
  rdState.id = safeInt(r.id);
  rdState.name = r.name || '';
  updateRdAddButton();
  updateRdWishButton();

  // Breadcrumb — Resources › Type › Name (+ swgaide external link)
  const ext = safeInt(r.swgaide_id) > 0
    ? ` <a role="button" class="rd-ext" data-ext="https://swgaide.com/resources/view.php?rid=${safeInt(r.swgaide_id)}"
         title="View on SWGAide"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>`
    : '';
  $('#rd-crumbs').innerHTML = [
    '<a role="button" data-nav="resources">Resources</a>',
    r.type_code
      ? `<a role="button" data-navcat="${escapeHtml(r.type_code)}" title="See all ${escapeHtml(r.type_name || '')} spawns">${escapeHtml(r.type_name || '')}</a>`
      : escapeHtml(r.type_name || ''),
    `<span class="crumb-current">${escapeHtml(r.name || '')}</span>${ext}`,
  ].filter(Boolean).join('<span class="crumb-sep">›</span>');

  $('#rd-meta').innerHTML = escapeHtml(rdAgeText(r));

  // Stat cards: eCPU, Score, then non-zero stats (name lives in the breadcrumb)
  const cards = [];
  // site rules (colorCodeCPU/pctTitle): tiers at 15/9/5/3/1, bar scaled to /40
  const cpu = ecpuClamp(r.cpu, rdIsActive(r), String(r.planet_mustafar ?? '0') === '1');
  const cpuCls = cpu >= 15 ? 'q-great' : cpu >= 9 ? 'q-good' : cpu >= 5 ? 'q-fair'
    : cpu >= 3 ? 'q-ok' : cpu >= 1 ? 'q-poor' : 'rd-muted';
  cards.push(rdCardHtml(cpu || '—', 'eCPU', (cpu / 40) * 100, cpuCls));
  const score = safeInt(r.score ?? r.value_rating); // 0–100, already a percent
  cards.push(rdCardHtml(score, 'Score', score, qualityClass(score)));
  RD_STATS.forEach((f) => {
    const v = safeInt(r[f]);
    if (v <= 0) return;
    const max = safeInt(r[`${f}_max`]) || 1000;
    const pct = (v / max) * 100;
    cards.push(rdCardHtml(v, f.toUpperCase(), pct, qualityClass(pct)));
  });
  const rating = safeInt(r.rating);
  if (rating > 0) cards.push(rdCardHtml(rating, 'Rating', rating / 10, qualityClass(rating / 10)));
  $('#rd-cards').innerHTML = cards.join('');

  // Score rank context — type name lives in the breadcrumb, keep this short
  $('#rd-scoreline').textContent = safeInt(r.score_rank) > 0
    ? `Score rank #${r.score_rank} of ${r.score_of} seen (top ${100 - safeInt(r.score_percentile)}%)`
    : '';

  // Planet badges
  const planets = Object.entries(PLANET_FULL)
    .filter(([key]) => String(r[key] ?? '0') === '1')
    .map(([key, label]) => `<span class="planet rd-planet ${planetClass(key)}">${label}</span>`);
  $('#rd-planets').innerHTML = planets.length
    ? `<span class="rd-planets-label">${rdIsActive(r) ? 'Spawning on:' : 'Last seen on:'}</span> ${planets.join('')}` : '';

  // Bottom tabs: Top Uses / Other <type> / Related (>800) / Used In
  rdState.data = data;
  // land on the first tab that actually has rows (tab order: top, other, related, used)
  rdTabState.tab = (data.top_uses || []).length ? 'top'
    : (data.similar || []).length ? 'other'
    : (data.related_schematics || []).length ? 'related'
    : (data.used_ins || []).length ? 'used' : 'top';
  rdTabState.sortField = ''; // fresh resource, natural order
  renderRdTabs();
  renderRdTable();
}

// ---- Bottom tabs (mirror the site's resource page) ----

const rdTabState = { tab: 'top', sortField: '', sortOrder: 'ASC' };

// Sortable header cell + generic client-side sort for the detail tabs (all tab
// data is already local). Empty sortField keeps each tab's natural order.
function rdSortableTh(label, field, cls = '') {
  const arrow = field === rdTabState.sortField ? (rdTabState.sortOrder === 'ASC' ? ' ▲' : ' ▼') : '';
  return `<th class="${cls}" data-sort="${field}">${label}${arrow}</th>`;
}
function rdSorted(list, accessors) {
  const f = rdTabState.sortField;
  if (!f || !accessors[f]) return list;
  const dir = rdTabState.sortOrder === 'ASC' ? 1 : -1;
  return [...list].sort((a, b) => {
    const x = accessors[f](a), y = accessors[f](b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}
const lc = (v) => String(v || '').toLowerCase();
// Site ladder (verified on /?r pages): #1 great, #2 good, #3 fair; deeper ranks fade
const rankClass = (rank) =>
  rank <= 1 ? 'q-great' : rank === 2 ? 'q-good' : rank === 3 ? 'q-fair' : rank <= 10 ? 'q-ok' : 'q-poor';

function renderRdTabs() {
  const d = rdState.data || {};
  const r = d.resource || {};
  const tabs = [
    ['top', `Top Uses (${(d.top_uses || []).length})`],
    ['other', `Other ${escapeHtml(r.type_name || 'Spawns')} (${(d.similar || []).length})`],
    ['related', `Related Schematics (${(d.related_schematics || []).length})`],
    ['used', `Used In (${(d.used_ins || []).length})`],
  ];
  $('#rd-tabs').innerHTML = tabs.map(([k, label]) =>
    `<li><button type="button" class="scd-tab ${rdTabState.tab === k ? 'active' : ''}" data-rdtab="${k}">${label}</button></li>`
  ).join('');
}

function renderRdTable() {
  const d = rdState.data || {};
  const empty = $('#rd-empty');
  empty.hidden = true;
  let head = '', body = '', emptyMsg = '';

  if (rdTabState.tab === 'top') {
    // Best-ranked spawns per schematic experimentation formula
    head = rdSortableTh('Schematic', 'schematic_name', 'col-name')
      + rdSortableTh('Section', 'section', 'col-text')
      + rdSortableTh('Formula', 'formula_description', 'col-text')
      + rdSortableTh('Rank', 'rank');
    const uses = rdSorted(
      [...(d.top_uses || [])].sort((a, b) => safeInt(a.rank) - safeInt(b.rank)), {
        schematic_name: (u) => lc(u.schematic_name),
        section: (u) => lc(u.section),
        formula_description: (u) => lc(u.formula_description),
        rank: (u) => safeInt(u.rank),
      });
    body = uses.map((u) => `
      <tr data-schem="${escapeHtml(String(u.schematic_id || ''))}" data-sname="${escapeHtml(u.schematic_name || '')}">
        <td class="col-name res-name">${escapeHtml(u.schematic_name || '')}</td>
        <td class="col-text res-type">${escapeHtml(u.section || '')}</td>
        <td class="col-text">${escapeHtml(u.formula_description || '')}</td>
        <td class="stat ${rankClass(safeInt(u.rank))}">#${safeInt(u.rank)}</td>
      </tr>`).join('');
    emptyMsg = 'This resource is not a top-ranked spawn for any schematic formula.';

  } else if (rdTabState.tab === 'other') {
    // Other spawns of the same resource type (API `similar`)
    head = '<th class="pin-cell"></th><th class="pin-cell"></th>'
      + rdSortableTh('Name', 'name', 'col-name') + rdSortableTh('Score', 'score')
      + RD_STATS.map((f) => rdSortableTh(f.toUpperCase(), f)).join('')
      + rdSortableTh('Rating', 'rating');
    const accessors = {
      name: (s) => lc(s.name),
      score: (s) => safeInt(s.score ?? s.value_rating),
      rating: (s) => safeInt(s.rating),
    };
    RD_STATS.forEach((f) => { accessors[f] = (s) => safeInt(s[f]); });
    body = rdSorted(d.similar || [], accessors).map((s) => {
      const isActive = String(s.status ?? '0') === '1';
      const rating = safeInt(s.rating);
      const score = safeInt(s.score ?? s.value_rating);
      return `<tr class="${isActive ? 'activeResource' : ''}">
        ${addCellHtml(s.id, s.name)}
        ${wishCellHtml(s.id, s.name)}
        <td class="col-name res-name" data-rname="${escapeHtml(s.name || '')}">${escapeHtml(s.name || '')}</td>
        <td class="stat ${qualityClass(score)}">${score}</td>
        ${RD_STATS.map((f) => statCell(s[f], s[`${f}_max`])).join('')}
        ${rating > 0 ? `<td class="stat ${qualityClass(rating / 10)}">${rating}</td>` : '<td class="stat stat_off">—</td>'}
      </tr>`;
    }).join('');
    emptyMsg = 'No other spawns of this type recorded.';

  } else if (rdTabState.tab === 'related') {
    // Schematics whose weighted quality with this resource beats 800 (server-computed)
    head = rdSortableTh('Schematic', 'schematicName', 'col-name')
      + rdSortableTh('Quality', 'resourceQuality')
      + rdSortableTh('Formula', 'formulaExpDescription', 'col-text')
      + rdSortableTh('Class', 'resourceClass', 'col-text');
    const rel = rdSorted(
      [...(d.related_schematics || [])]
        .sort((a, b) => (Number(b.resourceQuality) || 0) - (Number(a.resourceQuality) || 0)), {
        schematicName: (s) => lc(s.schematicName),
        resourceQuality: (s) => Number(s.resourceQuality) || 0,
        formulaExpDescription: (s) => lc(s.formulaExpDescription),
        resourceClass: (s) => lc(s.resourceClass),
      });
    body = rel.map((s) => {
      const q = Number(s.resourceQuality) || 0;
      return `<tr data-schem="${escapeHtml(String(s.schematicId ?? ''))}" data-sname="${escapeHtml(s.schematicName || '')}">
        <td class="col-name res-name">${escapeHtml(s.schematicName || '')}</td>
        <td class="stat ${qualityClass(q / 10)}">${q.toFixed(1)}</td>
        <td class="col-text">${escapeHtml(s.formulaExpDescription || '')}</td>
        <td class="col-text res-type">${escapeHtml(s.resourceClass || '')}</td>
      </tr>`;
    }).join('');
    emptyMsg = 'No schematic scores above 800 with this resource.';

  } else { // used
    head = rdSortableTh('Schematic', 'schematicName', 'col-name')
      + rdSortableTh('As', 'resourceClassName', 'col-text')
      + rdSortableTh('Rank', 'ranking');
    const uses = rdSorted(
      [...(d.used_ins || [])].sort((a, b) => safeInt(a.ranking) - safeInt(b.ranking)), {
        schematicName: (u) => lc(u.schematicName),
        resourceClassName: (u) => lc(u.resourceClassName),
        ranking: (u) => safeInt(u.ranking),
      });
    body = uses.map((u) => `
      <tr data-schem="${escapeHtml(String(u.schematicId || ''))}" data-sname="${escapeHtml(u.schematicName || '')}">
        <td class="col-name res-name">${escapeHtml(u.schematicName || '')}</td>
        <td class="col-text res-type">${escapeHtml(u.resourceClassName || '')}</td>
        <td class="stat ${rankClass(safeInt(u.ranking))}">#${safeInt(u.ranking)}</td>
      </tr>`).join('');
    emptyMsg = 'No schematics currently rank this resource.';
  }

  $('#rd-head').innerHTML = head;
  $('#rd-body').innerHTML = body;
  if (!body) {
    empty.textContent = emptyMsg;
    empty.hidden = false;
  }
}

async function openResourcePage(name) {
  showPage('resource');
  $('#rd-crumbs').innerHTML = '<a role="button" data-nav="resources">Resources</a>';
  $('#rd-meta').textContent = '';
  $('#rd-add').hidden = true;
  $('#rd-wish').hidden = true;
  $('#rd-scoreline').textContent = '';
  $('#rd-cards').innerHTML = `<div class="rd-card"><div class="rd-value">${escapeHtml(name || '')}</div><div class="rd-label">Loading…</div></div>`;
  $('#rd-planets').innerHTML = '';
  $('#rd-tabs').innerHTML = '';
  $('#rd-head').innerHTML = '';
  $('#rd-body').innerHTML = '';
  $('#rd-empty').hidden = true;
  $('#rd-loading').hidden = false;

  let res;
  try { res = await api().get_resource(name); }
  catch (e) { res = { ok: false, error: String(e) }; }

  $('#rd-loading').hidden = true;

  if (!res.ok || !res.data || !res.data.resource) {
    $('#rd-cards').innerHTML = '';
    const empty = $('#rd-empty');
    empty.textContent = `Failed to load "${name}": ${res.error || 'unexpected response'}`;
    empty.hidden = false;
    return;
  }
  renderResourcePage(res.data);
}

function initResourcePage() {
  $('#rd-crumbs').addEventListener('click', async (e) => {
    const ext = e.target.closest('[data-ext]');
    if (ext) {
      try { await api().open_external(ext.dataset.ext); } catch (_) { /* ignore */ }
      return;
    }
    const cat = e.target.closest('[data-navcat]');
    if (cat) {
      // jump to the resources grid pre-filtered to this category
      const sel = $('#res-category');
      if ([...sel.options].some((o) => o.value === cat.dataset.navcat)) {
        sel.value = cat.dataset.navcat;
      }
      resState.page = 1;
      showPage('resources');
      loadResources();
      return;
    }
    const link = e.target.closest('[data-nav]');
    if (link) showPage(link.dataset.nav);
  });

  // Tab switching (each tab starts back in its natural order)
  $('#rd-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-rdtab]');
    if (!tab) return;
    rdTabState.tab = tab.dataset.rdtab;
    rdTabState.sortField = '';
    document.querySelectorAll('#rd-tabs [data-rdtab]').forEach((t) =>
      t.classList.toggle('active', t === tab));
    renderRdTable();
  });

  // Column sorting within a tab
  $('#rd-head').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const field = th.dataset.sort;
    if (rdTabState.sortField === field) {
      rdTabState.sortOrder = rdTabState.sortOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
      rdTabState.sortField = field;
      // stats feel right starting high-to-low; text A-to-Z; ranks best-first
      rdTabState.sortOrder = ['schematic_name', 'section', 'formula_description', 'name',
        'schematicName', 'formulaExpDescription', 'resourceClass', 'resourceClassName',
        'rank', 'ranking'].includes(field) ? 'ASC' : 'DESC';
    }
    renderRdTable();
  });

  // Row actions: stockpile/wishlist toggles, schematic rows, other-spawn names
  $('#rd-body').addEventListener('click', (e) => {
    const addCell = e.target.closest('[data-add]');
    if (addCell) { handleAddCellClick(addCell); return; }
    const wishCell = e.target.closest('[data-wish]');
    if (wishCell) { handleWishCellClick(wishCell); return; }
    const schemRow = e.target.closest('tr[data-schem]');
    if (schemRow && schemRow.dataset.schem) { openSchematicPage(schemRow.dataset.schem, schemRow.dataset.sname); return; }
    const nameCell = e.target.closest('[data-rname]');
    if (nameCell) openResourcePage(nameCell.dataset.rname);
  });

  $('#rd-add').addEventListener('click', async () => {
    if (!rdState.id) return;
    const btn = $('#rd-add');
    if (stkState.resourceIds.has(String(rdState.id))) {
      if (!confirmArmLabeled(btn, 'Confirm remove?')) return; // removal confirms
      btn.disabled = true;
      await removeFromStockpileByResource(rdState.id, rdState.name);
    } else {
      btn.disabled = true;
      await addToStockpile(rdState.id, rdState.name); // promotes if wished
    }
    updateRdAddButton();
    updateRdWishButton();
  });

  $('#rd-wish').addEventListener('click', async () => {
    if (!rdState.id) return;
    const btn = $('#rd-wish');
    if (wishState.resourceIds.has(String(rdState.id))) {
      if (!confirmArmLabeled(btn, 'Confirm remove?')) return;
      btn.disabled = true;
      await removeFromWishlistByResource(rdState.id, rdState.name);
    } else {
      btn.disabled = true;
      await addToWishlist(rdState.id, rdState.name);
    }
    updateRdAddButton();
    updateRdWishButton();
  });
}
