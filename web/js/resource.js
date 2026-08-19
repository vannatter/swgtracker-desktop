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
  // Community editing is rep-gated server-side; an older server omits can_edit
  // (then the buttons stay live and the server still enforces on save).
  // Locked buttons stay clickable (a real `disabled` swallows hover, killing
  // the tooltip in WKWebView) — the click just explains the gate.
  rdState.canEdit = data.can_edit === undefined || safeInt(data.can_edit) === 1;
  rdState.lockTip = rdState.canEdit ? '' : `Unlocks at rep ${safeInt(data.rep_needed)} — you're at ${data.editor_rep ?? 0}. `
    + 'Rep grows as you use the tracker: harvesters, factories, inventory, stockpiles, schematics.';
  [['#rd-edit', 'fa-pen', "Fix this resource's stats — community data, changes apply for everyone"],
   ['#rd-disable', 'fa-ban', 'Disable a bad/bogus resource — hides it for everyone (recoverable, nothing is deleted)'],
  ].forEach(([sel, icon, tip]) => {
    const btn = $(sel);
    btn.hidden = false;
    btn.classList.toggle('rd-locked', !rdState.canEdit);
    btn.title = rdState.canEdit ? tip : rdState.lockTip;
    delete btn.dataset.tip; // initTooltips caches title→data-tip on hover; drop stale copies
    btn.querySelector('i').className = `fa-solid ${rdState.canEdit ? icon : 'fa-lock'}`;
  });

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

  // your stockpile tags for this resource — click one to open My Stockpile
  // filtered to it (stockpile may still be syncing; fills in when it lands)
  rdRenderStockTags(r.id);

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

// Stockpile tags on the resource page: only when this resource is in YOUR
// stockpile and tagged. Syncs the stockpile lazily on first need.
function rdRenderStockTags(resourceId) {
  const el = $('#rd-stktags');
  el.innerHTML = '';
  if (typeof stkState === 'undefined') return;
  const paint = () => {
    if (String(rdState.id) !== String(resourceId)) return; // navigated away meanwhile
    const item = (stkState.items || []).find((i) => String(i.id) === String(resourceId));
    const tags = item ? stkTags(item) : [];
    el.innerHTML = tags.length
      ? `<span class="rd-planets-label"><i class="fa-solid fa-tags"></i> Your tags:</span> `
        + tags.map((t) => `<span class="fac-tag" data-rdstktag="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join(' ')
      : '';
  };
  if (!stkState.items.length && typeof syncStockpile === 'function') {
    syncStockpile().then(paint).catch(() => {});
  } else {
    paint();
  }
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
  $('#rd-tabnote').hidden = true; // only the Used In branch fills it

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
    // fresh spawns rank on a rolling rebuild — an in-spawn resource with no
    // rows yet is almost always "not computed yet", not "ranks nowhere"
    emptyMsg = rdIsActive(d.resource || {})
      ? 'No rankings yet — Top Uses for a new spawn can take a few hours to compute. For immediate notices, Spawn Alerts and My Schematics evaluate new spawns the moment they land.'
      : 'This resource is not a top-ranked spawn for any schematic formula.';

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
    // rank-ascending default front-loads the #1 rows, which reads as "it says
    // #1 for everything" (Philosophy's report) — the distribution line shows
    // the real spread, and the meaning of Rank gets said out loud
    const dist = {};
    (d.used_ins || []).forEach((u) => { const r = safeInt(u.ranking); dist[r] = (dist[r] || 0) + 1; });
    const distTxt = Object.keys(dist).map(Number).sort((a, b) => a - b)
      .map((r) => `<b class="${rankClass(r)}">#${r}</b> in ${fmtNum(dist[r])}`).join(' · ');
    const note = $('#rd-tabnote');
    note.hidden = !distTxt;
    note.innerHTML = distTxt
      ? `Rank = where this resource places among <b>currently spawned</b> resources of the needed class, per schematic — ${distTxt}`
      : '';
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
  $('#rd-edit').hidden = true;
  $('#rd-disable').hidden = true;
  $('#rd-scoreline').textContent = '';
  $('#rd-cards').innerHTML = `<div class="rd-card"><div class="rd-value">${escapeHtml(name || '')}</div><div class="rd-label">Loading…</div></div>`;
  $('#rd-planets').innerHTML = '';
  $('#rd-stktags').innerHTML = '';
  $('#rd-tabs').innerHTML = '';
  $('#rd-head').innerHTML = '';
  $('#rd-body').innerHTML = '';
  $('#rd-empty').hidden = true;
  showGridLoading('#rd-loading');

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

// ---- Community editing: fix bad stats / disable bogus resources ----
// Stats are community data; edits go through the authenticated PUT on
// api/resources.php, which validates against the class caps, recomputes the
// weighted profession values, and records every change in resource_edits.
// Disable is a soft delete (resources.deleted = 1) — nothing is ever removed.

function openResEditDialog() {
  const r = (rdState.data || {}).resource;
  if (!r) return;
  // one input per stat the class actually has (cap > 0), prefilled + capped
  const fields = RD_STATS
    .map((f) => ({ f, cap: safeInt(r[`${f}_max`]), val: safeInt(r[f]) }))
    .filter((s) => s.cap > 0);
  if (!fields.length) { toast('This resource class has no editable stats', false); return; }
  $('#res-edit-title').textContent = rdState.name;
  $('#res-edit-grid').innerHTML = fields.map((s) => `
    <div class="inv-add-field">
      <label class="sp-field-label">${s.f.toUpperCase()} <span class="settings-sub">max ${s.cap}</span></label>
      <input type="number" class="form-control filter-input" data-resedit="${s.f}"
             value="${s.val}" min="1" max="${s.cap}" autocomplete="off">
    </div>`).join('');
  $('#res-edit-modal').hidden = false;
  const first = document.querySelector('#res-edit-grid input');
  if (first) { first.focus(); first.select(); }
}

async function saveResEdit() {
  const r = (rdState.data || {}).resource;
  if (!r) return;
  const stats = {};
  const bad = [];
  document.querySelectorAll('#res-edit-grid [data-resedit]').forEach((inp) => {
    const f = inp.dataset.resedit;
    const cap = safeInt(r[`${f}_max`]);
    const v = parseInt(inp.value, 10);
    if (!Number.isFinite(v) || v < 1 || v > cap) { bad.push(f.toUpperCase()); return; }
    if (v !== safeInt(r[f])) stats[f] = v;
  });
  if (bad.length) { toast(`${bad.join(', ')}: enter a whole number within the class cap`, false); return; }
  if (!Object.keys(stats).length) { $('#res-edit-modal').hidden = true; return; }

  const btn = $('#res-edit-save');
  btn.disabled = true;
  const res = await apiFetch('PUT', 'api/resources.php', { data: { id: rdState.id, stats } });
  btn.disabled = false;
  // require an explicit success flag — an older server answers PUT with the
  // browse payload, which must not read as "saved"
  if (!res.ok || !res.data || !res.data.success) {
    toast(res.data?.error || res.error || 'Update failed', false);
    return;
  }
  $('#res-edit-modal').hidden = true;
  toast('Stats updated for everyone — score refreshes on the next site update');
  openResourcePage(rdState.name); // repaint cards from the server's view
}

async function disableResource(btn) {
  const res = await apiFetch('PUT', 'api/resources.php', { data: { id: rdState.id, deleted: 1 } });
  if (!res.ok || !res.data || !res.data.success) {
    toast(res.data?.error || res.error || 'Disable failed', false);
    btn.disabled = false;
    return;
  }
  toast(`"${rdState.name}" disabled — it is hidden for everyone but recoverable`);
  showPage('resources');
  if (typeof loadResources === 'function') loadResources();
}

function initResourcePage() {
  $('#rd-edit').addEventListener('click', () => {
    if (!rdState.canEdit) { toast(rdState.lockTip, false); return; }
    openResEditDialog();
  });
  $('#res-edit-cancel').addEventListener('click', () => { $('#res-edit-modal').hidden = true; });
  $('#res-edit-modal').addEventListener('click', (e) => {
    if (e.target.id === 'res-edit-modal') $('#res-edit-modal').hidden = true;
  });
  $('#res-edit-save').addEventListener('click', saveResEdit);
  $('#res-edit-grid').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveResEdit();
  });

  $('#rd-disable').addEventListener('click', async () => {
    if (!rdState.id) return;
    if (!rdState.canEdit) { toast(rdState.lockTip, false); return; }
    const btn = $('#rd-disable');
    if (!confirmArmLabeled(btn, 'Disable for everyone?')) return;
    btn.disabled = true;
    await disableResource(btn);
  });

  // stockpile tag pill → My Stockpile filtered to that tag
  $('#rd-stktags').addEventListener('click', (e) => {
    const tag = e.target.closest('[data-rdstktag]');
    if (!tag || typeof stkState === 'undefined') return;
    stkState.tagFilter = tag.dataset.rdstktag;
    showPage('stockpile');
    if (typeof renderStockpile === 'function' && stkState.items.length) renderStockpile();
  });

  $('#rd-crumbs').addEventListener('click', async (e) => {
    const ext = e.target.closest('[data-ext]');
    if (ext) {
      try { await api().open_external(ext.dataset.ext); } catch (_) { /* ignore */ }
      return;
    }
    const cat = e.target.closest('[data-navcat]');
    if (cat) {
      // jump to the resources grid, filtered to this resource's type/category
      showPage('resources');
      applyCategoryFilter(cat.dataset.navcat, cat.textContent.trim());
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
    if (addCell) { handleAddCellClick(addCell, e); return; }
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
      updateRdAddButton();
      updateRdWishButton();
    } else {
      // Dialog collects an optional amount + CPU; adds (and promotes if wished) on close.
      openStockpileAddDialog(rdState.id, rdState.name, () => {
        updateRdAddButton();
        updateRdWishButton();
      });
    }
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
