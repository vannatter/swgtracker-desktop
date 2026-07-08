/* My Schematics — crafting list (api/my_schematics.php).
   List page: uniform grid with an upgrade-status column.
   Detail page (#page-myschematic): per-slot resource assignment with inline
   editing (datalist of the slot's known spawns) + best-known comparison.

   Weighted quality reproduces the site exactly:
   quality = Σ weight% × (stat / stat_max × 1000), averaged over formulas.

   PUT contract assumed pending full docs: {"id": <resources[].id>, "resource_name": "..."} */

const mysState = { items: [], schematicIds: new Set(), sortField: '', sortOrder: 'ASC' };

const MYS_COLUMNS = [
  ['Schematic', 'name', 'col-name'],
  ['Formulas', 'formulas', 'col-text'],
  ['Slots', 'slots', 'stat'],
  ['Status', 'status', 'col-text'],
];

function buildMysHeader() {
  $('#mys-head').innerHTML = sortableHeaderHtml(MYS_COLUMNS, mysState.sortField, mysState.sortOrder);
}

// NB: distinct from mysStatusHtml(r, a) below, which renders detail-page rows
function mysListStatusHtml(s) {
  const an = s._an;
  if (!an) return '<span class="stat_off">comparing…</span>';
  if (an.upgrades > 0) return `<span class="mys-st-up">▲ ${an.upgrades} upgrade${an.upgrades > 1 ? 's' : ''}</span>`;
  if (an.acceptedCount > 0) return '<span class="mys-st-acc">✓ accepted</span>';
  if (an.comparable > 0) return '<span class="mys-st-ok">✓ optimal</span>';
  return '<span class="stat_off">—</span>';
}

// Search-filtered, sorted view; each entry keeps its index into mysState.items
// because row clicks and the analysis loop address items by original position.
function mysVisibleItems() {
  const q = ($('#mys-search').value || '').trim().toLowerCase();
  let list = mysState.items.map((s, idx) => [s, idx]);
  if (q) {
    list = list.filter(([s]) =>
      (s.name || '').toLowerCase().includes(q) || (s.custom_name || '').toLowerCase().includes(q));
  }
  const f = mysState.sortField;
  if (f) {
    const key = (s) =>
      f === 'name' ? `${s.name || ''} ${s.custom_name || ''}`.toLowerCase()
        : f === 'formulas' ? mysFormulaList(s).length
        : f === 'slots' ? (s.resources || []).length
        : (s._an ? s._an.upgrades : -1); // status: unanalyzed sorts last
    const dir = mysState.sortOrder === 'ASC' ? 1 : -1;
    list.sort(([a], [b]) => (key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0) * dir);
  }
  return list;
}

function renderMysList() {
  buildMysHeader();
  const visible = mysVisibleItems();
  $('#mys-body').innerHTML = visible.map(([s, idx]) => `
    <tr data-idx="${idx}" data-usid="${escapeHtml(String(s.user_schematic_id))}">
      <td class="col-name res-name">${escapeHtml(s.name || '')}${s.custom_name
        ? `<span class="mys-loadout">${escapeHtml(s.custom_name)}</span>` : ''}</td>
      <td class="col-text">${mysFormulaCell(s)}</td>
      <td class="stat">${(s.resources || []).length}</td>
      <td class="col-text" data-rowstatus>${mysListStatusHtml(s)}</td>
    </tr>`).join('');

  const empty = $('#mys-empty');
  empty.hidden = true;
  if (!visible.length) {
    empty.textContent = mysState.items.length
      ? 'No schematics match your search.'
      : 'No schematics in your crafting list yet — add them with the wrench icon on the Schematics page.';
    empty.hidden = false;
  }
  $('#mys-status').textContent = mysState.items.length
    ? `${visible.length}${visible.length === mysState.items.length ? '' : ` of ${mysState.items.length}`} schematics in your crafting list — click one to manage its resources` : '';
}
const mysdState = { item: null, analysis: null };
const mysDetailCache = new Map();   // schematic_id -> {dtoByCode} | null
const mysResourceCache = new Map(); // resource name -> full record | null

// Sync every [data-mys] cell with crafting-list membership
function refreshMysIcons() {
  document.querySelectorAll('[data-mys]').forEach((cell) => {
    const inList = mysState.schematicIds.has(String(cell.dataset.mys));
    cell.classList.toggle('in-mys', inList);
    cell.title = inList ? 'In My Schematics' : 'Add to My Schematics';
    const i = cell.querySelector('i');
    if (i) i.className = `fa-solid ${inList ? 'fa-check add-ok' : 'fa-screwdriver-wrench'}`;
  });
}

// ---- Analysis (shared by list status + detail view) ----

// formula_labels arrives as a comma-separated STRING from the server
// ("Condition OQ=50% SR=50%, General Protection …"). Normalize to an array.
function mysFormulaList(s) {
  const f = s?.formula_labels;
  if (Array.isArray(f)) return f.filter(Boolean);
  if (typeof f === 'string' && f.trim()) return f.split(',').map((x) => x.trim()).filter(Boolean);
  return [];
}
const mysFormulaText = (s) => mysFormulaList(s).join(' · ');

// Compact cell: a count chip (full list on hover); empty = "All" since the
// analysis falls back to every formula when none are chosen.
function mysFormulaCell(s) {
  const list = mysFormulaList(s);
  if (!list.length) {
    return '<span class="mys-fchip all" title="No formulas chosen — comparing against all of them">All formulas</span>';
  }
  const n = list.length;
  return `<span class="mys-fchip" title="${escapeHtml(list.join('\n'))}">${n} formula${n > 1 ? 's' : ''}</span>`;
}

function mysParseWeights(label) {
  const w = {};
  // live formulas come both with and without the percent sign
  // ("Power OQ=50% SR=50%" vs "Overall Quality OQ=100")
  for (const m of String(label || '').matchAll(/([A-Z]{2})=(\d+)%?/g)) {
    w[m[1].toLowerCase()] = safeInt(m[2]);
  }
  return Object.keys(w).length ? w : null;
}

function mysWeightedQuality(rec, weightsList) {
  if (!rec || !weightsList.length) return null;
  const per = weightsList.map((w) => {
    let q = 0;
    for (const [stat, pct] of Object.entries(w)) {
      q += (safeInt(rec[stat]) / (safeInt(rec[`${stat}_max`]) || 1000)) * 1000 * (pct / 100);
    }
    return q;
  });
  return per.reduce((a, b) => a + b, 0) / per.length;
}

async function mysGetDetail(schematicId) {
  const key = String(schematicId);
  if (mysDetailCache.has(key)) return mysDetailCache.get(key);
  let det = null;
  try {
    const res = await api().get_schematic(key);
    const s = res.ok && res.data ? (res.data.schematic || res.data) : null;
    if (s && s.resourceDtoList) {
      det = {
        dtoByCode: new Map(s.resourceDtoList.map((d) => [d.resourceTypeCode, d])),
        needed: s.resourcesNeeded || [], // for ghost rows on slotless entries
        // fallback weights from the schematic's own formulas, for entries
        // whose formula_labels is null (no formulas chosen on the entry)
        weights: (s.formula || []).filter((f) => f.active !== false)
          .map((f) => mysParseWeights(f.formulaDescription)).filter(Boolean),
      };
    }
  } catch (_) { /* ignore */ }
  mysDetailCache.set(key, det);
  return det;
}

async function mysGetResource(name) {
  if (!name) return null;
  if (mysResourceCache.has(name)) return mysResourceCache.get(name);
  let rec = null;
  try {
    const res = await api().get_resource(name);
    rec = res.ok && res.data ? res.data.resource || null : null;
  } catch (_) { /* ignore */ }
  mysResourceCache.set(name, rec);
  return rec;
}

const mysSpawnActive = (sp) =>
  sp && (sp.active === true || String(sp.active) === 'true' || String(sp.active) === '1');

// Per-ingredient comparison for one crafting entry.
// Returns {perIng: Map(ing.id -> {best, bestQ, bestActive, assignedQ, delta,
// candidates}), upgrades, comparable}
async function analyzeMySchematic(s) {
  const det = await mysGetDetail(s.schematic_id);
  let weightsList = mysFormulaList(s).map(mysParseWeights).filter(Boolean);
  if (!weightsList.length) weightsList = det?.weights || [];
  const perIng = new Map();
  let upgrades = 0, comparable = 0, acceptedCount = 0;

  for (const r of (s.resources || [])) {
    const dto = det?.dtoByCode.get(r.resource_type);
    // best EVER seen — despawned resources can still be bought/traded
    const lists = [...(dto?.serverBestResourceList || []), ...(dto?.currentBestResourceList || [])];
    const best = dto?.serverBestResourceList?.[0] || dto?.currentBestResourceList?.[0] || null;
    const bestQ = best ? Number(best.resourceQuality) || 0 : null;

    let assignedQ = null;
    if (r.resource_name) {
      // match the schematic's spawn lists by id OR name (right after a save
      // the resolved resource object is momentarily null)
      const hit = lists.find((x) =>
        (r.resource && String(x.resourceId) === String(r.resource.id)) ||
        x.resourceName === r.resource_name);
      if (hit) assignedQ = Number(hit.resourceQuality) || 0;
      else assignedQ = mysWeightedQuality(await mysGetResource(r.resource_name), weightsList);
    }

    // dedup spawn candidates by id, best quality first (for the Using editor)
    const seen = new Set();
    const options = [];
    for (const sp of lists) {
      const k = String(sp.resourceId);
      if (seen.has(k) || !sp.resourceName) continue;
      seen.add(k);
      options.push({ name: sp.resourceName, q: Number(sp.resourceQuality) || 0, active: mysSpawnActive(sp) });
    }
    options.sort((a, b) => b.q - a.q);

    const entry = {
      best, bestQ, bestActive: mysSpawnActive(best), assignedQ, delta: null, options,
      accepted: String(r.accepted) === '1',
    };
    if (!r.resource_name) {
      if (best) { entry.delta = bestQ; upgrades++; }
    } else if (assignedQ != null && bestQ != null) {
      comparable++;
      entry.delta = bestQ - assignedQ;
      if (entry.delta > 1) {
        if (entry.accepted) {
          // accepted: only a LIVE spawn beating the accepted resource re-raises it
          const live = options.find((o) => o.active && o.q > assignedQ + 1);
          if (live) { entry.liveUpgrade = live; upgrades++; }
          else { entry.acceptedMuted = true; acceptedCount++; }
        } else {
          upgrades++;
        }
      }
    } else if (bestQ != null) {
      // can't score what they're using — surface the best rather than hide it
      entry.unscored = true;
      upgrades++;
    }
    perIng.set(String(r.id), entry);
  }
  return { perIng, upgrades, comparable, acceptedCount };
}

const mysQHtml = (q) => q == null ? '' :
  `<span class="stat ${qualityClass(q / 10)}">${q.toFixed(1)}</span>`;

function mysStatusHtml(r, a) {
  if (!r.resource_name) {
    return a?.best ? '<span class="mys-st-pick">pick one</span>' : '<span class="stat_off">—</span>';
  }
  if (a?.unscored) {
    return `<span class="mys-st-up" title="Couldn't score ${escapeHtml(r.resource_name)} — best known is ${a.bestQ.toFixed(1)}">▲ ?</span>`;
  }
  if (a?.assignedQ == null || a?.bestQ == null) return '<span class="stat_off">—</span>';
  if (a.acceptedMuted) {
    return `<span class="mys-st-acc" role="button" data-unaccept="${escapeHtml(String(r.id))}"
      title="Accepted — the best ever seen beats yours by ${a.delta.toFixed(1)}, but nothing in spawn does. Click to resume upgrade suggestions">✓ accepted</span>`;
  }
  if (a.delta > 1) {
    const src = a.liveUpgrade ? 'in spawn right now' : 'ever seen';
    return `<span class="mys-st-up" title="The best ${src} beats yours by ${a.delta.toFixed(1)} quality">▲ +${Math.round(a.delta)}</span>
      <button type="button" class="mys-accept" data-acceptrow="${escapeHtml(String(r.id))}"
        title="Keep ${escapeHtml(r.resource_name)} — stop suggesting until something better spawns">keep</button>`;
  }
  return '<span class="mys-st-ok" title="Nothing ever seen beats what you have">✓ best</span>';
}

function mysBadgeState(el, an) {
  el.hidden = false;
  if (an.upgrades > 0) {
    el.textContent = `▲ ${an.upgrades} upgrade${an.upgrades > 1 ? 's' : ''} available`;
    el.className = 'mys-badge up';
  } else if (an.acceptedCount > 0) {
    el.textContent = '✓ accepted — not optimal';
    el.className = 'mys-badge acc';
  } else if (an.comparable > 0) {
    el.textContent = '✓ optimal';
    el.className = 'mys-badge ok';
  } else {
    el.hidden = true;
  }
}

// ---- List page ----

async function loadMySchematics() {
  showGridLoading('#mys-loading');
  $('#mys-empty').hidden = true;

  let res;
  try { res = await api().get_my_schematics({}); }
  catch (e) { res = { ok: false, error: String(e) }; }

  $('#mys-loading').hidden = true;

  const empty = $('#mys-empty');
  if (!res.ok || !res.data) {
    $('#mys-body').innerHTML = '';
    empty.textContent = `Error: ${res.error || 'failed to load'}`;
    empty.hidden = false;
    $('#mys-status').textContent = '';
    checkAuthError(res.error);
    return;
  }

  mysState.items = res.data.results || [];
  mysState.schematicIds = new Set(mysState.items.map((i) => String(i.schematic_id)));
  refreshMysIcons();
  renderMysList();

  // fill status column as each analysis lands; roll totals into the page badge.
  // Cells are found by user_schematic_id so search/sort re-renders don't orphan them.
  $('#mys-total-badge').hidden = true;
  let totalUp = 0, totalComparable = 0;
  await Promise.all(mysState.items.map(async (s) => {
    try {
      const an = await analyzeMySchematic(s);
      s._an = an;
      totalUp += an.upgrades;
      totalComparable += an.comparable;
      const cell = document.querySelector(
        `#mys-body tr[data-usid="${CSS.escape(String(s.user_schematic_id))}"] [data-rowstatus]`);
      if (cell) cell.innerHTML = mysListStatusHtml(s);
    } catch (_) { /* leave placeholder */ }
  }));

  const total = $('#mys-total-badge');
  if (totalUp > 0) {
    total.textContent = `▲ ${totalUp} upgrade${totalUp > 1 ? 's' : ''} available`;
    total.className = 'mys-badge up';
    total.hidden = false;
  } else if (totalComparable > 0) {
    total.textContent = '✓ everything optimal';
    total.className = 'mys-badge ok';
    total.hidden = false;
  }
}

// ---- Detail page ----

function mysdRowHtml(r) {
  const res = r.resource;
  let using;
  if (r.resource_name) {
    using = `<span class="mys-using" data-editing-ing="${escapeHtml(String(r.id))}" title="Click to change">
      ${escapeHtml(r.resource_name)}</span>
      ${res?.in_spawn ? '<span class="mys-inspawn">in spawn</span>' : ''}
      <span data-uq></span>`;
  } else {
    using = `<span class="mys-using stat_off" data-editing-ing="${escapeHtml(String(r.id))}"
      title="Click to choose a resource">none chosen — click to set</span><span hidden data-uq></span>`;
  }
  return `<tr data-ing="${escapeHtml(String(r.id))}" data-code="${escapeHtml(r.resource_type || '')}">
    <td class="col-text"><span class="detail-slot">${escapeHtml(r.resource_label || '')}</span>
      <div class="mys-type">${escapeHtml(r.type_name || '')}</div></td>
    <td class="col-text" data-using>${using}</td>
    <td class="col-text" data-best><span class="stat_off">…</span></td>
    <td class="mys-status" data-status></td>
  </tr>`;
}

async function openMySchematicPage(item) {
  mysdState.item = item;
  mysdState.analysis = null;
  showPage('myschematic');

  const title = item.custom_name ? `${item.name} · ${item.custom_name}` : (item.name || '');
  $('#mysd-crumbs').innerHTML =
    '<a role="button" data-nav="myschematics">My Schematics</a>' +
    `<span class="crumb-sep">›</span><span class="crumb-current">${escapeHtml(title)}</span>`;
  $('#mysd-badge').hidden = true;
  const fl = mysFormulaList(item);
  $('#mysd-chips').innerHTML = fl.length
    ? fl.map((l) => `<span class="mys-chip">${escapeHtml(l)}</span>`).join('')
    : '<span class="mys-chip all" title="No formulas chosen — comparing against all of them">All formulas</span>';
  $('#mysd-body').innerHTML = (item.resources || []).map(mysdRowHtml).join('');
  showGridLoading('#mysd-loading');

  const an = await analyzeMySchematic(item);
  $('#mysd-loading').hidden = true;
  if (mysdState.item !== item) return; // user navigated away mid-fetch
  mysdState.analysis = an;

  // Entries added via the API have no ingredient rows yet (server-side gap:
  // POST doesn't create user_schematic_resources). Show the schematic's real
  // slots read-only with Best Known data so the page is still useful.
  if (!(item.resources || []).length) {
    const det = await mysGetDetail(item.schematic_id);
    const cols = 4;
    const banner = `<tr><td colspan="${cols}" class="mysd-noslots">
      This entry has no ingredient slots yet — adding via the app can't create them
      until swgtracker.com's API does it on add. Slots below are read-only preview.
    </td></tr>`;
    const ghosts = (det?.needed || []).map((n) => {
      const dto = det.dtoByCode.get(n.id);
      const best = dto?.serverBestResourceList?.[0] || dto?.currentBestResourceList?.[0] || null;
      const bestQ = best ? Number(best.resourceQuality) || 0 : null;
      return `<tr class="mysd-ghost">
        <td class="col-text"><span class="detail-slot">${escapeHtml(n.desc || '')}</span>
          <div class="mys-type">${escapeHtml(n.resourceName || '')}</div></td>
        <td class="col-text stat_off">unavailable</td>
        <td class="col-text">${best
          ? `${mysdAddBadge(best.resourceId, best.resourceName)}
             <span class="scd-reslink" data-res="${escapeHtml(best.resourceName || '')}">${escapeHtml(best.resourceName || '')}</span>
             ${mysQHtml(bestQ)}
             <span class="${mysSpawnActive(best) ? 'mys-inspawn' : 'mys-despawned'}">${mysSpawnActive(best) ? 'in spawn' : 'despawned'}</span>`
          : '<span class="stat_off">none recorded</span>'}</td>
        <td class="mys-status"><span class="stat_off">—</span></td>
      </tr>`;
    }).join('');
    $('#mysd-body').innerHTML = banner + ghosts;
    $('#mysd-badge').hidden = true;
    return;
  }

  for (const r of (item.resources || [])) {
    const a = an.perIng.get(String(r.id));
    const row = $(`#mysd-body tr[data-ing="${r.id}"]`);
    if (!row || !a) continue;

    row.querySelector('[data-best]').innerHTML = a.best
      ? `${mysdAddBadge(a.best.resourceId, a.best.resourceName)}
         <span class="scd-reslink" data-res="${escapeHtml(a.best.resourceName || '')}">${escapeHtml(a.best.resourceName || '')}</span>
         ${mysQHtml(a.bestQ)}
         <span class="${a.bestActive ? 'mys-inspawn' : 'mys-despawned'}">${a.bestActive ? 'in spawn' : 'despawned'}</span>
         ${r.resource_name !== a.best.resourceName
           ? `<button type="button" class="mys-usebest" data-usebest="${escapeHtml(String(r.id))}"
                data-bestname="${escapeHtml(a.best.resourceName || '')}" title="Switch to this resource">⬅ use</button>` : ''}`
      : '<span class="stat_off">none recorded</span>';

    const uq = row.querySelector('[data-uq]');
    if (uq) uq.outerHTML = mysQHtml(a.assignedQ);
    row.querySelector('[data-status]').innerHTML = mysStatusHtml(r, a);
  }
  mysBadgeState($('#mysd-badge'), an);
}

// Inline stockpile toggle (span form, for inside cells)
function mysdAddBadge(id, name) {
  const inStock = stkState.resourceIds.has(String(id));
  return `<span class="add-cell add-inline ${inStock ? 'in-stock' : ''}" data-add="${id}"
    data-name="${escapeHtml(name || '')}" title="${inStock ? IN_STOCK_TITLE : 'Add to stockpile'}">
    <i class="fa-solid ${inStock ? 'fa-check add-ok' : 'fa-plus'}"></i></span>`;
}

// ---- Assigning a resource to a slot ----

async function mysdSetAccept(ingId, accepted) {
  const item = mysdState.item;
  const r = (item?.resources || []).find((x) => String(x.id) === String(ingId));
  if (!r) return;
  let res;
  try { res = await api().accept_my_schematic_resource({ id: r.id, accepted }); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) {
    toast(`Couldn't save: ${res.error || 'server error'}`, false);
    checkAuthError(res.error);
    return;
  }
  toast(accepted
    ? `${r.resource_label || 'Slot'}: accepted — it'll nag again when something better spawns`
    : `${r.resource_label || 'Slot'}: upgrade suggestions back on`);
  // same refresh pattern as saving a resource: server truth, then re-render
  await loadMySchematics();
  const fresh = mysState.items.find((i) =>
    String(i.user_schematic_id) === String(item.user_schematic_id));
  openMySchematicPage(fresh || item);
}

async function mysdSaveUsing(ingId, name) {
  const item = mysdState.item;
  const r = (item?.resources || []).find((x) => String(x.id) === String(ingId));
  if (!r || r.resource_name === name) return;

  let res;
  try { res = await api().update_my_schematic_resource({ id: r.id, resource_name: name }); }
  catch (e) { res = { ok: false, error: String(e) }; }

  if (!res.ok) {
    toast(`Couldn't save: ${res.error || 'server error'}`, false);
    checkAuthError(res.error);
    return;
  }
  toast(name ? `${r.resource_label || 'Slot'} → ${name}` : `${r.resource_label || 'Slot'} cleared`);
  mysResourceCache.delete(name);
  // Refresh from the server so the detail view renders resolved truth,
  // not locally-patched state (stale ▲ ? otherwise).
  await loadMySchematics();
  const fresh = mysState.items.find((i) =>
    String(i.user_schematic_id) === String(item.user_schematic_id));
  openMySchematicPage(fresh || item);
}

function mysdOpenEditor(cell, ingId) {
  if (cell.querySelector('input')) return;
  const item = mysdState.item;
  const r = (item?.resources || []).find((x) => String(x.id) === String(ingId));
  if (!r) return;
  const a = mysdState.analysis?.perIng.get(String(ingId));
  const options = a?.options || [];

  const optHtml = (o) => `<div class="mysd-opt" data-optname="${escapeHtml(o.name)}">
    <span class="mysd-opt-name">${escapeHtml(o.name)}</span>
    <span class="mysd-opt-meta">${o.active ? '<span class="mys-inspawn">in spawn</span>' : ''}
      <span class="stat ${qualityClass(o.q / 10)}">${o.q.toFixed(1)}</span></span>
  </div>`;

  cell.innerHTML = `<span class="mysd-editwrap">
    <input type="text" class="stock-input mysd-input"
      value="${escapeHtml(r.resource_name || '')}" placeholder="Resource name...">
    <div class="mysd-sug">${options.map(optHtml).join('') ||
      '<div class="mysd-opt-none">No recorded spawns — type any resource name</div>'}</div>
  </span>`;
  const input = cell.querySelector('input');
  const sug = cell.querySelector('.mysd-sug');
  input.focus();
  input.select();

  // Show ALL candidates on open; filter only once the user actually types.
  let touched = false;
  const applyFilter = () => {
    const q = touched ? input.value.trim().toLowerCase() : '';
    sug.querySelectorAll('.mysd-opt').forEach((el) => {
      el.hidden = !!q && !el.dataset.optname.toLowerCase().includes(q);
    });
  };
  input.addEventListener('input', () => { touched = true; applyFilter(); });
  applyFilter();

  let done = false;
  const finish = (save, chosen) => {
    if (done) return;
    done = true;
    const value = (chosen ?? input.value).trim();
    if (save && value !== (r.resource_name || '')) mysdSaveUsing(ingId, value);
    else openMySchematicPage(item); // restore display
  };
  // mousedown beats the input's blur, so clicking an option always lands
  sug.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('[data-optname]');
    if (!opt) return;
    e.preventDefault();
    finish(true, opt.dataset.optname);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') finish(true);
    else if (e.key === 'Escape') finish(false);
  });
  input.addEventListener('blur', () => finish(true));
}

// "Add" always opens the setup dialog — the same schematic can be tracked more
// than once (different formulas/resources), so this never toggles to remove.
async function addToMySchematics(schematicId, name) {
  return openAddSetup(schematicId, name);
}

async function removeFromMySchematics(userSchematicId, name) {
  let res;
  try { res = await api().remove_from_my_schematics(userSchematicId); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (res.ok) {
    toast(`${name || 'Schematic'} removed from My Schematics`);
    mysState.items = mysState.items.filter((i) => String(i.user_schematic_id) !== String(userSchematicId));
    mysState.schematicIds = new Set(mysState.items.map((i) => String(i.schematic_id)));
    refreshMysIcons();
    if (typeof scdState !== 'undefined' && scdState.id) updateScdMysButton();
    loadMySchematics();
  } else {
    toast(`Couldn't remove ${name || 'schematic'}: ${res.error || 'server error'}`, false);
    checkAuthError(res.error);
  }
  return res;
}

// ---- Schematic-page button (add / remove toggle) ----

function updateScdMysButton() {
  const btn = $('#scd-mys');
  if (!btn || typeof scdState === 'undefined' || !scdState.id) return;
  // Always "Add" — a schematic can be tracked as several loadouts. The count
  // hint tells you how many you already have; remove happens from My Schematics.
  const count = mysState.items.filter((i) => String(i.schematic_id) === String(scdState.id)).length;
  btn.hidden = false;
  btn.disabled = false;
  btn.className = 'btn btn-sm btn-accent';
  btn.innerHTML = `<i class="fa-solid fa-screwdriver-wrench"></i> Add to My Schematics${count ? ` (${count})` : ''}`;
}

// ---- Add setup dialog (name + formulas + slots, before the POST) ----

// Built from the schematic definition (needs no entry to exist yet). Slot
// cselects are keyed by resource_type so we can match them to the created rows.
async function openAddSetup(schematicId, name) {
  const spState = mysdState._setup = { schematicId, name };
  const det = await mysGetDetail(schematicId);
  let schem = null;
  try {
    const res = await api().get_schematic(String(schematicId));
    schem = res.ok && res.data ? (res.data.schematic || res.data) : null;
  } catch (_) { /* ignore */ }

  $('#sp-title').textContent = `Add ${name || 'schematic'}`;
  $('#sp-name').value = '';
  $('#sp-status').textContent = '';

  // Formula checkboxes — default all active-checked
  const formulas = (schem?.formula || []).filter((f) => f.active !== false);
  spState.formulas = formulas;
  $('#sp-formula-wrap').hidden = !formulas.length;
  $('#sp-formulas').innerHTML = formulas.map((f) => `
    <label class="sp-formula">
      <input type="checkbox" data-fid="${escapeHtml(String(f.formulaId))}" checked>
      <span class="sp-formula-box"><i class="fa-solid fa-check"></i></span>
      <span>${escapeHtml(f.formulaDescription || '')}</span>
    </label>`).join('');

  // Slot pickers from the schematic's ingredients (resourcesNeeded)
  const needed = schem?.resourcesNeeded || [];
  spState.slots = needed.map((n) => ({ code: n.id, label: n.desc, type_name: n.resourceName }));
  $('#sp-rows').innerHTML = needed.map((n) => {
    const dto = det?.dtoByCode.get(n.id);
    const top = (dto?.serverBestResourceList || dto?.currentBestResourceList || []).slice(0, 5)
      .map((sp) => ({ name: sp.resourceName || '', q: Number(sp.resourceQuality) || 0, active: mysSpawnActive(sp) }));
    return `<div class="sp-row">
      <span class="sp-label">${escapeHtml(n.desc || '')}
        <div class="mys-type">${escapeHtml(n.resourceName || '')}</div></span>
      ${cselectHtml(n.id, top)}
    </div>`;
  }).join('');

  $('#slot-picker').hidden = false;
  return { ok: true };
}

// ---- Custom dropdown (same look as the Using editor's suggestion panel;
// native <select> popups are OS-styled and can't show quality colors) ----

function cselectOptHtml(o) {
  return `<div class="mysd-opt cselect-opt" data-value="${escapeHtml(o.name)}">
    <span class="mysd-opt-name">${escapeHtml(o.name)}</span>
    <span class="mysd-opt-meta">${o.active ? '<span class="mys-inspawn">in spawn</span>' : ''}
      <span class="stat ${qualityClass(o.q / 10)}">${o.q.toFixed(1)}</span></span>
  </div>`;
}

function cselectHtml(rowId, options) {
  const first = options[0]; // best preselected
  const btnLabel = first ? cselectOptHtml(first) : '';
  return `<div class="cselect" data-sp="${escapeHtml(String(rowId))}"
      data-value="${first ? escapeHtml(first.name) : ''}">
    <button type="button" class="cselect-btn">
      <span class="cselect-current">${first ? btnLabel : '<span class="stat_off">— choose later —</span>'}</span>
      <i class="fa-solid fa-caret-down"></i>
    </button>
    <div class="cselect-menu" hidden>
      <div class="cselect-search">
        <input type="text" class="stock-input cselect-input" placeholder="Type any resource name…"
               title="Filter the list, or press Enter to use exactly what you typed">
      </div>
      <div class="mysd-opt cselect-opt" data-value=""><span class="stat_off">— choose later —</span></div>
      ${options.map(cselectOptHtml).join('') ||
        '<div class="mysd-opt-none">No recorded spawns for this slot</div>'}
    </div>
  </div>`;
}

function cselectPick(cs, value, html) {
  cs.dataset.value = value;
  cs.querySelector('.cselect-current').innerHTML = value
    ? (html || escapeHtml(value)) : '<span class="stat_off">— choose later —</span>';
  cs.querySelector('.cselect-menu').hidden = true;
}

function closeCselects(except) {
  document.querySelectorAll('.cselect-menu').forEach((m) => { if (m !== except) m.hidden = true; });
}

async function saveSlotPicker() {
  const st = mysdState._setup;
  if (!st) { $('#slot-picker').hidden = true; return; }

  const customName = $('#sp-name').value.trim();
  const formulaIds = [...document.querySelectorAll('#sp-formulas [data-fid]:checked')]
    .map((cb) => cb.dataset.fid);
  // cselect is keyed by resource_type code → pick per slot
  const picksByCode = new Map();
  document.querySelectorAll('#sp-rows [data-sp]').forEach((cs) => {
    if (cs.dataset.value) picksByCode.set(cs.dataset.sp, cs.dataset.value);
  });

  $('#sp-status').textContent = 'Adding…';
  $('#sp-save').disabled = true;

  // 1) create the entry with its formulas + name
  let res;
  try {
    res = await api().add_to_my_schematics({
      schematic_id: st.schematicId,
      formulas: formulaIds.join(','),
      custom_name: customName,
    });
  } catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) {
    $('#sp-save').disabled = false;
    $('#sp-status').textContent = `Couldn't add: ${res.error || 'server error'}`;
    checkAuthError(res.error);
    return;
  }

  // 2) find the new entry, match its slot rows by resource_type, assign picks
  await loadMySchematics();
  const usid = res.data?.user_schematic_id;
  const entry = mysState.items.find((i) => String(i.user_schematic_id) === String(usid));
  let failed = 0, assigned = 0;
  if (entry && picksByCode.size) {
    for (const row of (entry.resources || [])) {
      const pick = picksByCode.get(row.resource_type);
      if (!pick) continue;
      let r;
      try { r = await api().update_my_schematic_resource({ id: row.id, resource_name: pick }); }
      catch (e) { r = { ok: false }; }
      r.ok ? assigned++ : failed++;
    }
  }

  $('#sp-save').disabled = false;
  $('#slot-picker').hidden = true;
  mysdState._setup = null;
  toast(failed
    ? `Added ${st.name} — ${assigned} slot${assigned !== 1 ? 's' : ''} set, ${failed} failed`
    : `${st.name} added${assigned ? ` — ${assigned} slot${assigned > 1 ? 's' : ''} set` : ''}`, !failed);
  await loadMySchematics();
  refreshMysIcons();
  if (entry) openMySchematicPage(mysState.items.find((i) => String(i.user_schematic_id) === String(usid)) || entry);
}

function initMySchematics() {
  buildMysHeader();
  $('[data-refresh="myschematics"]').addEventListener('click', () => loadMySchematics());
  $('#mys-search').addEventListener('input', () => renderMysList()); // local list — instant typeahead
  $('#mys-head').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const field = th.dataset.sort;
    if (mysState.sortField === field) {
      mysState.sortOrder = mysState.sortOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
      mysState.sortField = field;
      mysState.sortOrder = 'ASC';
    }
    renderMysList();
  });

  // Schematic-page button: always opens the add-setup dialog (multi-loadout)
  $('#scd-mys').addEventListener('click', () => {
    const id = String(scdState.id || '');
    if (id) openAddSetup(id, scdState.schematic?.schematicName || '');
  });

  // Slot picker actions
  $('#sp-skip').addEventListener('click', () => { $('#slot-picker').hidden = true; });
  $('#sp-save').addEventListener('click', saveSlotPicker);

  // Custom dropdowns in the picker (fixed-position menus escape the scroll clip)
  $('#sp-rows').addEventListener('click', (e) => {
    const btn = e.target.closest('.cselect-btn');
    if (btn) {
      const menu = btn.closest('.cselect').querySelector('.cselect-menu');
      closeCselects(menu);
      if (menu.hidden) {
        const r = btn.getBoundingClientRect();
        menu.style.left = `${r.left}px`;
        menu.style.top = `${r.bottom + 3}px`;
        menu.style.minWidth = `${r.width}px`;
        menu.hidden = false;
        const inp = menu.querySelector('.cselect-input');
        inp.value = '';
        menu.querySelectorAll('.cselect-opt').forEach((o) => { o.hidden = false; });
        inp.focus();
      } else {
        menu.hidden = true;
      }
      return;
    }
    const opt = e.target.closest('.cselect-opt');
    if (opt) cselectPick(opt.closest('.cselect'), opt.dataset.value, opt.innerHTML);
  });

  // Free-text path: filter as you type; Enter uses the typed name verbatim
  // (they may own a lower-quality spawn that isn't in the top lists)
  $('#sp-rows').addEventListener('input', (e) => {
    const inp = e.target.closest('.cselect-input');
    if (!inp) return;
    const q = inp.value.trim().toLowerCase();
    inp.closest('.cselect-menu').querySelectorAll('.cselect-opt').forEach((o) => {
      o.hidden = !!q && !o.dataset.value.toLowerCase().includes(q);
    });
  });
  $('#sp-rows').addEventListener('keydown', (e) => {
    const inp = e.target.closest('.cselect-input');
    if (!inp) return;
    if (e.key === 'Enter') {
      const typed = inp.value.trim();
      if (typed) cselectPick(inp.closest('.cselect'), typed);
    } else if (e.key === 'Escape') {
      inp.closest('.cselect-menu').hidden = true;
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.cselect')) closeCselects();
  });
  $('#sp-rows').addEventListener('scroll', () => closeCselects());

  // list rows open the detail page
  $('#mys-body').addEventListener('click', (e) => {
    const row = e.target.closest('tr[data-idx]');
    if (row) openMySchematicPage(mysState.items[safeInt(row.dataset.idx)]);
  });

  // detail page interactions
  $('#mysd-crumbs').addEventListener('click', (e) => {
    const link = e.target.closest('[data-nav]');
    if (link) showPage(link.dataset.nav);
  });
  $('#mysd-open-schem').addEventListener('click', () => {
    if (mysdState.item) openSchematicPage(String(mysdState.item.schematic_id), mysdState.item.name);
  });
  reserveConfirmWidth($('#mysd-remove'));
  $('#mysd-remove').addEventListener('click', async (e) => {
    const item = mysdState.item;
    if (!item) return;
    if (!confirmArmLabeled(e.currentTarget, 'Confirm remove?')) return;
    await removeFromMySchematics(item.user_schematic_id, item.custom_name || item.name);
    showPage('myschematics');
  });
  $('#mysd-body').addEventListener('click', (e) => {
    const useBest = e.target.closest('[data-usebest]');
    if (useBest) { mysdSaveUsing(useBest.dataset.usebest, useBest.dataset.bestname); return; }
    const acc = e.target.closest('[data-acceptrow]');
    if (acc) { mysdSetAccept(acc.dataset.acceptrow, true); return; }
    const unacc = e.target.closest('[data-unaccept]');
    if (unacc) { mysdSetAccept(unacc.dataset.unaccept, false); return; }
    const editCell = e.target.closest('[data-editing-ing]');
    if (editCell) { mysdOpenEditor(editCell.closest('[data-using]'), editCell.dataset.editingIng); return; }
    const addBadge = e.target.closest('[data-add]');
    if (addBadge) { handleAddCellClick(addBadge); return; }
    const resLink = e.target.closest('[data-res]');
    if (resLink) openResourcePage(resLink.dataset.res);
  });
}
