/* My Schematics — crafting list (api/my_schematics.php).
   List page: uniform grid with an upgrade-status column.
   Detail page (#page-myschematic): per-slot resource assignment with inline
   editing (datalist of the slot's known spawns) + best-known comparison.

   Weighted quality reproduces the site exactly:
   quality = Σ weight% × (stat / stat_max × 1000), averaged over formulas.

   PUT contract assumed pending full docs: {"id": <resources[].id>, "resource_name": "..."} */

const mysState = { items: [], schematicIds: new Set(), sortField: '', sortOrder: 'ASC',
  groups: [], grpCollapsed: new Set(), tagFilter: null };

// tags live as one comma-separated string server-side, like stockpile/factories
const mysTags = (s) => String(s.tags || '').split(',').map((t) => t.trim()).filter(Boolean);

const MYS_COLUMNS = [
  ['Schematic', 'name', 'col-name'],
  ['Formulas', 'formulas', 'col-text'],
  ['Slots', 'slots', 'stat'],
  ['Status', 'status', 'col-text'],
];

function buildMysHeader() {
  $('#mys-head').innerHTML = sortableHeaderHtml(MYS_COLUMNS, mysState.sortField, mysState.sortOrder)
    + '<th class="pin-cell"></th><th class="pin-cell"></th><th class="pin-cell"></th>'; // alerts + notes + remove
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
      (s.name || '').toLowerCase().includes(q) || (s.custom_name || '').toLowerCase().includes(q)
      || String(s.tags || '').toLowerCase().includes(q)
      || (mysState.groups.find((g) => g.id === Number(s.group_id))?.name || '').toLowerCase().includes(q));
  }
  if (mysState.tagFilter) list = list.filter(([s]) => mysTags(s).includes(mysState.tagFilter));
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
  const canDrag = mysState.groups.length > 0;
  const rowFor = ([s, idx]) => {
    const tagged = mysTags(s).length > 0;
    return `
    <tr data-idx="${idx}" data-usid="${escapeHtml(String(s.user_schematic_id))}"${canDrag ? ' draggable="true"' : ''}>
      <td class="col-name res-name"><span class="stk-tagslot">${tagged
        ? `<i class="fa-solid fa-tag stk-tagind" data-mystaghover="${idx}"></i>` : ''}</span>${escapeHtml(s.name || '')}${s.custom_name
        ? `<span class="mys-loadout">${escapeHtml(s.custom_name)}</span>` : ''}</td>
      <td class="col-text">${mysFormulaCell(s)}</td>
      <td class="stat">${(s.resources || []).length}</td>
      <td class="col-text" data-rowstatus>${mysListStatusHtml(s)}</td>
      <td class="pin-cell" data-mysalert="${idx}"
          title="${Number(s.notify_email) ? 'Emailing you when an upgrade spawns for this schematic — click to stop' : 'Email me when a better resource spawns for one of this schematic’s slots'}"><i
          class="fa-${Number(s.notify_email) ? 'solid' : 'regular'} fa-envelope${Number(s.notify_email) ? ' mys-alert-on' : ''}"></i></td>
      <td class="pin-cell note-cell" data-mysnote="${idx}"
          title="${labNotesText(s.notes) ? escapeHtml(labNotesText(s.notes)) : 'Add notes / tags'}"><i
          class="fa-${labNotesText(s.notes) ? 'solid' : 'regular'} fa-note-sticky${labNotesText(s.notes) ? ' has-notes' : ''}"></i></td>
      <td class="pin-cell" data-mysdel="${idx}" title="Remove from My Schematics"><i class="fa-solid fa-trash-can"></i></td>
    </tr>`;
  };
  // grouped: stockpile-style folder rows split the table (rename/collapse/
  // delete inline, gap between folders); ungrouped-only = a flat list
  const sections = grpSections(mysState.groups, visible, ([s]) => s.group_id);
  const spacer = '<tr class="stk-group-gap"><td colspan="7"></td></tr>';
  const parts = [];
  sections.forEach((sec) => {
    const collapsed = mysState.grpCollapsed.has(sec.key);
    if (sec.key !== 'un' || sections.length > 1) {
      if (parts.length) parts.push(spacer);
      parts.push(grpTableHeaderHtml(sec.key, sec.name, sec.items.length, collapsed, sec.key !== 'un', 7));
    }
    if (!collapsed) parts.push(...sec.items.map(rowFor));
  });
  $('#mys-body').innerHTML = parts.join('');

  // tag cloud built from every item so an active filter can always be unclicked
  const allTags = [...new Set(mysState.items.flatMap(mysTags))];
  if (mysState.tagFilter && !allTags.includes(mysState.tagFilter)) mysState.tagFilter = null;
  const tagbar = $('#mys-tagbar');
  tagbar.hidden = !allTags.length;
  tagbar.innerHTML = allTags.length
    ? '<span class="fac-tagbar-label"><i class="fa-solid fa-tags"></i></span>'
      + allTags.map((t) => `<span class="fac-tag${mysState.tagFilter === t ? ' active' : ''}"
          data-mystag="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('')
    : '';

  const empty = $('#mys-empty');
  empty.hidden = true;
  if (!visible.length && !mysState.groups.length) {
    empty.textContent = mysState.items.length
      ? 'No schematics match your search.'
      : 'No schematics in your crafting list yet — add them with the wrench icon on the Schematics page.';
    empty.hidden = false;
  }
  $('#mys-status').textContent = mysState.items.length
    ? `${visible.length}${visible.length === mysState.items.length ? '' : ` of ${mysState.items.length}`} schematics in your crafting list — click one to manage its resources` : '';
}
// ---- notes dialog (hover the icon to preview, click to edit) ---------------
let mysNoteFor = null;

function mysOpenNoteDialog(item) {
  if (!item) return;
  mysNoteFor = String(item.user_schematic_id);
  $('#mys-note-title').textContent = item.custom_name ? `${item.name} · ${item.custom_name}` : (item.name || 'Notes');
  $('#mys-note-text').innerHTML = labNotesHtml(item.notes);  // rich (lab WYSIWYG)
  $('#mys-note-tags').value = item.tags || '';
  $('#mys-note-modal').hidden = false;
  $('#mys-note-text').focus();
}

async function mysSaveNoteDialog() {
  const item = mysState.items.find((s) => String(s.user_schematic_id) === mysNoteFor);
  $('#mys-note-modal').hidden = true;
  if (!item) return;
  const notes = richNotesValue($('#mys-note-text'));
  const tags = $('#mys-note-tags').value.trim();
  if ((item.notes || '') === notes && (item.tags || '') === tags) return;
  item.notes = notes; // optimistic
  item.tags = tags;
  renderMysList();
  // the detail page shows the same notes — keep it in step when it's open
  if (mysdState.item && String(mysdState.item.user_schematic_id) === mysNoteFor) mysdRenderNotes(item);
  try {
    const res = await apiFetch('PUT', 'api/my_schematics.php', {
      data: { user_schematic_id: safeInt(mysNoteFor), notes, tags },
    });
    if (!res.ok) toast(res.error || 'Failed to save notes — is the site update deployed?', false);
  } catch (e) { toast(String(e), false); }
}

// ---- Cost to Make (snickerfritz's request) ---------------------------------
// Two prices across the assigned slots: the market eCPU from the resource DB,
// and what YOU actually paid (stockpile my-CPU) where known — each times the
// slot's unit count. Also flags required sub-component schematics that aren't
// in My Schematics yet (their resource costs can't be counted).
async function mysdRenderCost(item) {
  const el = $('#mysd-cost');
  el.hidden = true;
  const det = await mysGetDetail(item.schematic_id, item.formulas || '');
  if (mysdState.item !== item || !det) return;
  // my-CPU lives on stockpile rows — make sure they're here before pricing
  if (typeof stkState !== 'undefined' && !stkState.items.length) {
    try { await syncStockpile(); } catch (_) { /* market prices still render */ }
  }
  if (mysdState.item !== item) return;

  const unitsByCode = new Map((det.needed || []).map((n) => [String(n.id), safeInt(n.units)]));
  let market = 0, mine = 0, mineKnown = 0, priced = 0, unpriced = 0;
  const lines = [];
  for (const r of (item.resources || [])) {
    const units = unitsByCode.get(String(r.resource_type)) || 0;
    const rec = r.resource_name ? await mysGetResource(r.resource_name) : null;
    if (mysdState.item !== item) return;
    if (!rec || !units) { unpriced++; continue; }
    const mkt = ecpuClamp(rec.cpu, safeInt(rec.status) === 1, safeInt(rec.planet_mustafar) === 1) || 1;
    const my = labMyCpu(rec);
    market += mkt * units;
    mine += (my !== null ? my : mkt) * units; // no personal price — market stands in
    if (my !== null) mineKnown++;
    priced++;
    lines.push(`${r.resource_name} × ${fmtNum(units)} — market ${fmtNum(mkt * units)} cr`
      + (my !== null ? ` · yours ${fmtNum(my * units)} cr` : ''));
  }

  const req = (det.components || []).filter((c) => c.type === 'schematic' && c.optional !== 'yes');
  const have = new Set(mysState.items.map((i) => String(i.schematic_id)));
  const missing = req.filter((c) => !have.has(String(c.id)));

  if (!priced && !missing.length) return; // nothing to say yet
  const bits = [];
  if (priced) {
    bits.push(`market ~<b>${fmtNum(market)}</b> cr`);
    if (mineKnown) {
      bits.push(`your stockpile prices ~<b>${fmtNum(mine)}</b> cr${mineKnown < priced ? ' <span class="mysd-cost-dim">(partly market — not everything has a my-CPU)</span>' : ''}`);
    }
    if (unpriced) bits.push(`<span class="mysd-cost-dim">${unpriced} slot${unpriced > 1 ? 's' : ''} unpriced</span>`);
  }
  el.innerHTML = (priced
    ? `<span class="mysd-cost-line" title="${escapeHtml(lines.join('\n'))}"><i class="fa-solid fa-coins"></i> Cost to make: ${bits.join(' · ')}</span>`
    : '')
    + (missing.length
      ? `<div class="mysd-cost-missing"><i class="fa-solid fa-triangle-exclamation"></i>
          Needs component schematics not in your My Schematics yet:
          ${missing.map((c) => `<a role="button" data-copen="${escapeHtml(String(c.id))}" data-cname="${escapeHtml(c.desc || '')}">${escapeHtml(c.desc || '')}</a>`).join(', ')}
          — their resource costs aren't included</div>`
      : '');
  el.hidden = false;
}

// the schematic's notes on its own detail page — click to edit via the same
// dialog the list's sticky-note icon opens (Philosophy/Eponine's request)
function mysdRenderNotes(item) {
  const el = $('#mysd-notes');
  const has = !!labNotesText(item.notes);
  el.hidden = false;
  el.innerHTML = has
    ? `<div class="mysd-notes-body" data-mysdnotes title="Click to edit notes">${labNotesHtml(item.notes)}</div>`
    : '<a role="button" class="mysd-notes-add" data-mysdnotes><i class="fa-regular fa-note-sticky"></i> Add notes</a>';
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

// The game's math (see weightedQuality in shared.js): stats normalize against
// the INGREDIENT's required class caps, a missing stat's weight redistributes,
// all-present uses the printed percents /100.
function mysWeightedQuality(rec, weightsList, caps = null) {
  if (!rec || !weightsList.length) return null;
  return weightedQuality(rec, weightsList, caps);
}

// hover chip for picker options — name — full class — score — age, like the lab
function mysResTipHtml(o) {
  const t = safeInt(o.ts);
  const days = t ? Math.max(0, Math.floor((Date.now() / 1000 - t) / 86400)) : null;
  return [
    `<b>${escapeHtml(o.name)}</b>`,
    escapeHtml(o.type || ''),
    o.score != null ? `<span class="${qualityClass(o.score)}">score ${o.score}</span>` : '',
    days === null ? '' : (days === 0 ? 'spawned today' : `${days} day${days === 1 ? '' : 's'} old`),
  ].filter(Boolean).join(' — ');
}

// formulas: the entry's CSV of formula ids, so the server ranks Best Known by the
// selected experimentation lines (empty = all). Cached per (schematic, formulas).
async function mysGetDetail(schematicId, formulas = '') {
  const key = `${schematicId}|${formulas}`;
  if (mysDetailCache.has(key)) return mysDetailCache.get(key);
  let det = null;
  try {
    const res = await api().get_schematic(String(schematicId), String(formulas || ''));
    const s = res.ok && res.data ? (res.data.schematic || res.data) : null;
    if (s && s.resourceDtoList) {
      det = {
        dtoByCode: new Map(s.resourceDtoList.map((d) => [d.resourceTypeCode, d])),
        needed: s.resourcesNeeded || [], // for ghost rows on slotless entries
        components: s.componentTypes || [], // sub-component check on the detail page
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
  await loadPrefs(); // Mustafarian-ignore pref gates the candidate lists below
  const det = await mysGetDetail(s.schematic_id, s.formulas || '');
  let weightsList = mysFormulaList(s).map(mysParseWeights).filter(Boolean);
  if (!weightsList.length) weightsList = det?.weights || [];
  const perIng = new Map();
  let upgrades = 0, comparable = 0, acceptedCount = 0;

  for (const r of (s.resources || [])) {
    const dto = det?.dtoByCode.get(r.resource_type);
    // best EVER seen — despawned resources can still be bought/traded.
    // Mustafarian candidates drop out for users who ignore them (unless the
    // slot itself wants a Mustafarian class).
    const mflt = (arr) => (arr || []).filter((sp) => !hideMustafarian(sp.resourceTypeName, r.type_name));
    const sbl = mflt(dto?.serverBestResourceList);
    const cbl = mflt(dto?.currentBestResourceList);
    const lists = [...sbl, ...cbl];
    const best = sbl[0] || cbl[0] || null;
    const bestQ = best ? Number(best.resourceQuality) || 0 : null;

    let assignedQ = null;
    if (r.resource_name) {
      // match the schematic's spawn lists by id OR name (right after a save
      // the resolved resource object is momentarily null)
      const hit = lists.find((x) =>
        (r.resource && String(x.resourceId) === String(r.resource.id)) ||
        x.resourceName === r.resource_name);
      if (hit) assignedQ = Number(hit.resourceQuality) || 0;
      else assignedQ = mysWeightedQuality(await mysGetResource(r.resource_name), weightsList, classCaps(r.resource_type));
    }

    // dedup spawn candidates by id, best quality first (for the Using editor).
    // A resource in BOTH lists keeps the active copy — first-wins used to let a
    // stale serverBest duplicate hide that a candidate is in spawn.
    const seen = new Map();
    for (const sp of lists) {
      if (!sp.resourceName) continue;
      const k = String(sp.resourceId);
      const prev = seen.get(k);
      if (!prev || (mysSpawnActive(sp) && !prev.active)) {
        seen.set(k, { name: sp.resourceName, q: Number(sp.resourceQuality) || 0, active: mysSpawnActive(sp),
          type: sp.resourceTypeName || '', ts: sp.timestamp });
      }
    }
    const options = [...seen.values()].sort((a, b) => b.q - a.q);

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
          // accepted: only a LIVE spawn beating what was around AT ACCEPT TIME
          // re-raises it (accepted_q) — else the very upgrade being dismissed
          // undid the accept instantly
          // +1 on the watermark too: list vs detail can weight quality a hair
          // differently, and jitter must not re-raise an accepted slot
          const floor = Math.max(assignedQ + 1, (Number(r.accepted_q) || 0) + 1);
          const live = options.find((o) => o.active && o.q > floor);
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

  let res, groups;
  try {
    [res, groups] = await Promise.all([api().get_my_schematics({}), grpList('myschem'), loadPrefs()]);
  } catch (e) { res = { ok: false, error: String(e) }; groups = mysState.groups; }
  mysState.groups = groups || [];

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

  // sidebar pill mirrors the total — gone the moment everything's optimal
  const pill = $('#nav-mys-pill');
  if (pill) {
    pill.textContent = totalUp;
    pill.hidden = totalUp <= 0;
  }
}

// ---- Detail page ----

function mysdRowHtml(r) {
  const res = r.resource;
  let using;
  if (r.resource_name) {
    // same stockpile add/manage cell the Best Known column has (⌘/Ctrl-click
    // opens the amount/CPU dialog) — only when the name resolved to a real id
    using = `${res?.id ? mysdAddBadge(res.id, r.resource_name) : ''}
      <span class="mys-using" data-editing-ing="${escapeHtml(String(r.id))}" title="Click to change">
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
  mysdState.stockedByType = null;
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
  mysdRenderNotes(item);
  mysdRenderCost(item); // fire-and-forget — prices fill in when the fetches land
  $('#mysd-body').innerHTML = (item.resources || []).map(mysdRowHtml).join('');
  showGridLoading('#mysd-loading');

  const an = await analyzeMySchematic(item);
  $('#mysd-loading').hidden = true;
  if (mysdState.item !== item) return; // user navigated away mid-fetch
  mysdState.analysis = an;

  // Load the FULL class pool per slot (like the Lab) so the Using editor can
  // search ANY resource of the class, not just stockpile + recorded spawns.
  // Fire-and-forget: the page is interactive now; editors get the extra
  // options once this lands. Rating is lazy (done on render), so this just
  // caches raw rows + the caps/weights they'll be rated with.
  (async () => {
    if (typeof stkState !== 'undefined' && !stkState.items.length) {
      try { await syncStockpile(); } catch (_) { /* stock chips just won't show */ }
    }
    let weightsList = mysFormulaList(item).map(mysParseWeights).filter(Boolean);
    if (!weightsList.length) weightsList = (await mysGetDetail(item.schematic_id, item.formulas || ''))?.weights || [];
    mysdState.weightsList = weightsList;
    const stockIds = (typeof stkState !== 'undefined' && stkState.resourceIds) ? [...stkState.resourceIds] : [];
    const poolByType = {};
    const stockedByType = {};
    for (const code of [...new Set((item.resources || []).map((r) => r.resource_type))]) {
      if (mysdState.item !== item) return; // navigated away
      try {
        const res = await classPool(String(code), stockIds);
        const rows = (res.ok && res.data) || [];
        poolByType[code] = rows;
        // stocked shortlist (rated) — leads the default editor view
        stockedByType[code] = rows
          .filter((p) => stkState && stkState.resourceIds && stkState.resourceIds.has(String(p.id)))
          .map((p) => mysdPoolOpt(p, code))
          .sort((a, b) => b.q - a.q)
          .slice(0, 8);
      } catch (_) { /* that slot just shows recorded spawns */ }
    }
    if (mysdState.item === item) {
      mysdState.poolByType = poolByType;
      mysdState.stockedByType = stockedByType;
    }
  })();

  // Entries added via the API have no ingredient rows yet (server-side gap:
  // POST doesn't create user_schematic_resources). Show the schematic's real
  // slots read-only with Best Known data so the page is still useful.
  if (!(item.resources || []).length) {
    const det = await mysGetDetail(item.schematic_id, item.formulas || '');
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
    data-name="${escapeHtml(name || '')}" title="${inStock ? IN_STOCK_TITLE : ADD_TITLE}">
    <i class="fa-solid ${inStock ? 'fa-check add-ok' : 'fa-plus'}"></i></span>`;
}

// ---- Assigning a resource to a slot ----

async function mysdSetAccept(ingId, accepted) {
  const item = mysdState.item;
  const r = (item?.resources || []).find((x) => String(x.id) === String(ingId));
  if (!r) return;
  // record the best LIVE candidate's quality at accept time — the nag only
  // re-raises when something beats THAT (accepting used to be undone
  // instantly by the very upgrade being dismissed)
  const entry = mysdState.analysis && mysdState.analysis.perIng
    ? mysdState.analysis.perIng.get(String(r.id)) : null;
  const liveBest = entry
    ? Math.max(0, ...(entry.options || []).filter((o) => o.active).map((o) => o.q)) : 0;
  let res;
  try {
    // apiFetch, not the shell bridge — the bridge predates accepted_q
    res = await apiFetch('PUT', 'api/my_schematics.php', {
      data: { resource_row_id: safeInt(r.id), accepted: accepted ? 1 : 0, accepted_q: liveBest },
    });
  } catch (e) { res = { ok: false, error: String(e) }; }
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

// a mirror pool row -> a rated Using-editor option (rated against the slot caps)
function mysdPoolOpt(p, code) {
  return {
    name: p.name,
    q: mysWeightedQuality(p, mysdState.weightsList || [], classCaps(String(code))) || 0,
    active: safeInt(p.status) === 1,
    stocked: !!(typeof stkState !== 'undefined' && stkState.resourceIds && stkState.resourceIds.has(String(p.id))),
    type: p.type_name || '',
    score: p.value_rating != null ? safeInt(p.value_rating) : null,
    ts: p.timestamp,
  };
}

function mysdOptHtml(o) {
  return `<div class="mysd-opt" data-optname="${escapeHtml(o.name)}">
    <span class="mysd-opt-name" data-richtip="${escapeHtml(mysResTipHtml(o))}">${escapeHtml(o.name)}</span>
    <span class="mysd-opt-meta">${o.stocked ? '<span class="mysd-stocked" title="In your stockpile">✓ stock</span>' : ''}
      ${o.active ? '<span class="mys-inspawn">in spawn</span>' : ''}
      <span class="stat ${qualityClass(o.q / 10)}">${o.q.toFixed(1)}</span></span>
  </div>`;
}

// ---- Lab-style resource picker (modal): stockpile dropdown + search-any +
// a full quality table. Opens from a Using cell; picking saves the slot. ----

const MYSD_PICK_STATS = ['oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe'];

function mysdPickRelevant() {
  const set = new Set();
  for (const w of (mysdState.weightsList || [])) Object.keys(w).forEach((s) => set.add(s));
  return set;
}

async function mysdOpenPicker(ingId) {
  const item = mysdState.item;
  const r = (item?.resources || []).find((x) => String(x.id) === String(ingId));
  if (!r) return;
  const code = r.resource_type;
  const modal = $('#mysd-picker-modal');
  mysdState.picker = { ingId, code, query: '', current: r.resource_name || '',
                       typeName: r.type_name || '',
                       activeOnly: localStorage.getItem('mysd_picker_active') === '1' };
  $('#mysd-picker-active').checked = mysdState.picker.activeOnly;

  $('#mysd-picker-title').innerHTML =
    `${escapeHtml(r.resource_label || 'Slot')} <span class="mys-type">${escapeHtml(r.type_name || '')}</span>`;
  $('#mysd-picker-search').value = '';
  $('#mysd-picker-search').placeholder = `Search any ${r.type_name || 'resource'}…`;
  $('#mysd-picker-head').innerHTML = `<th class="pin-cell"></th><th class="col-name">Resource</th>
    <th>Rate</th>${MYSD_PICK_STATS.map((s) => `<th class="${mysdPickRelevant().has(s) ? '' : 'lab-dim'}">${s.toUpperCase()}</th>`).join('')}
    <th>eCPU</th>`;
  modal.hidden = false;
  $('#mysd-picker-search').focus();

  // load the class pool if not already cached, then render
  if (!(mysdState.poolByType || {})[code]) {
    $('#mysd-picker-body').innerHTML = '<tr><td colspan="14" class="stat_off lab-pool-empty">Loading class…</td></tr>';
    try {
      const stockIds = (typeof stkState !== 'undefined' && stkState.resourceIds) ? [...stkState.resourceIds] : [];
      const res = await classPool(String(code), stockIds);
      (mysdState.poolByType = mysdState.poolByType || {})[code] = (res.ok && res.data) || [];
    } catch (_) { (mysdState.poolByType = mysdState.poolByType || {})[code] = []; }
    if (modal.hidden || mysdState.picker.ingId !== ingId) return; // closed meanwhile
  }
  mysdRenderPicker();
}

function mysdRenderPicker() {
  const p = mysdState.picker;
  if (!p) return;
  const pool = (mysdState.poolByType || {})[p.code] || [];
  const caps = typeof classCaps === 'function' ? classCaps(String(p.code)) : null;
  const rel = mysdPickRelevant();
  const q = (p.query || '').trim().toLowerCase();

  let rows = pool.map((res) => ({ res, q: mysWeightedQuality(res, mysdState.weightsList || [], caps) || 0 }));
  if (q) rows = rows.filter((x) => String(x.res.name).toLowerCase().includes(q));
  else if (p.stockOnly) rows = rows.filter((x) => stkState && stkState.resourceIds && stkState.resourceIds.has(String(x.res.id)));
  // ignored Mustafarian classes stay out of the browse list — an explicit name
  // search or your own stockpiled copies still show
  if (!q) {
    rows = rows.filter((x) => !hideMustafarian(x.res.type_name, p.typeName)
      || (stkState && stkState.resourceIds && stkState.resourceIds.has(String(x.res.id))));
  }
  if (p.activeOnly) rows = rows.filter((x) => x.res.status === 1); // in-spawn toggle — requested by Pufhead
  rows.sort((a, b) => b.q - a.q);
  rows = rows.slice(0, q ? 40 : 60);

  // stockpile dropdown (stocked resources of this class)
  const stocked = pool
    .filter((res) => stkState && stkState.resourceIds && stkState.resourceIds.has(String(res.id)))
    .map((res) => ({ res, q: mysWeightedQuality(res, mysdState.weightsList || [], caps) || 0 }))
    .sort((a, b) => b.q - a.q);
  $('#mysd-picker-stock').innerHTML = `<option value="">My stockpile (${stocked.length})…</option>`
    + stocked.map((x) => `<option value="${escapeHtml(x.res.name)}">${escapeHtml(x.res.name)} — ${x.q.toFixed(1)}</option>`).join('');

  const body = $('#mysd-picker-body');
  if (!rows.length) {
    body.innerHTML = `<tr><td colspan="14" class="stat_off lab-pool-empty">${
      q ? 'No matches in this class.'
        : p.activeOnly ? 'Nothing in this class is in spawn right now — untick In spawn to see past resources.'
        : 'Class pool is empty.'}</td></tr>`;
    return;
  }
  body.innerHTML = rows.map(({ res, q: rate }) => {
    const inStock = !!(stkState && stkState.resourceIds && stkState.resourceIds.has(String(res.id)));
    const stockN = inStock && typeof stkState !== 'undefined' ? (stkState.items.find((i) => String(i.id) === String(res.id))?.stock) : null;
    return `<tr class="lab-row ${p.current === res.name ? 'lab-picked' : ''} ${inStock ? 'lab-stocked' : ''}" data-pickres="${escapeHtml(res.name)}">
      <td class="pin-cell">${res.status === 1 ? '<span class="lab-live" title="In spawn"></span>' : ''}</td>
      <td class="col-name res-name" data-richtip="${escapeHtml(mysResTipHtml({ name: res.name, type: res.type_name, score: res.value_rating != null ? safeInt(res.value_rating) : null, ts: res.timestamp }))}">${escapeHtml(res.name)}
        ${inStock ? `<span class="lab-stock" title="In your stockpile${stockN != null ? `: ${fmtNum(stockN)} units` : ''}">✓ ${stockN != null && stockN > 0 ? fmtShort(stockN) : 'stock'}</span>` : ''}</td>
      <td class="stat ${qualityClass(rate / 10)}">${rate.toFixed(1)}</td>
      ${MYSD_PICK_STATS.map((st) => {
        const v = safeInt(res[st]);
        if (v <= 0) return `<td class="stat stat_off ${rel.has(st) ? '' : 'lab-dim'}">—</td>`;
        const cap = safeInt(res[`${st}_max`]) || 1000;
        return `<td class="stat ${qualityClass((v / cap) * 100)} ${rel.has(st) ? '' : 'lab-dim'}">${v}</td>`;
      }).join('')}
      <td class="stat">${ecpuClamp(res.cpu, res.status === 1, safeInt(res.planet_mustafar) === 1) || '~1'}</td>
    </tr>`;
  }).join('');
}

function mysdClosePicker() {
  $('#mysd-picker-modal').hidden = true;
  mysdState.picker = null;
}

function mysdOpenEditor(cell, ingId) {
  if (cell.querySelector('input')) return;
  const item = mysdState.item;
  const r = (item?.resources || []).find((x) => String(x.id) === String(ingId));
  if (!r) return;
  const code = r.resource_type;
  const a = mysdState.analysis?.perIng.get(String(ingId));

  // DEFAULT list (no query): stockpile picks first, then recorded top spawns.
  const stocked = (mysdState.stockedByType || {})[code] || [];
  const stockedNames = new Set(stocked.map((o) => o.name.toLowerCase()));
  const defaultOpts = stocked.concat((a?.options || []).filter((o) => !stockedNames.has(o.name.toLowerCase())));

  // SEARCH source: the whole class pool (best-first from the mirror), rated
  // lazily as matches surface. Falls back to recorded spawns until it loads.
  const searchPool = (q) => {
    const pool = (mysdState.poolByType || {})[code];
    if (pool) {
      return pool
        .filter((p) => String(p.name).toLowerCase().includes(q))
        .slice(0, 60) // pool is best-first, so cap the rate work
        .map((p) => mysdPoolOpt(p, code))
        .sort((x, y) => y.q - x.q)
        .slice(0, 20);
    }
    return defaultOpts.filter((o) => o.name.toLowerCase().includes(q)).slice(0, 20);
  };

  // load the class pool on demand if the background load hasn't landed yet, so
  // search works the instant the editor opens (not only after the page settles)
  if (!(mysdState.poolByType || {})[code]) {
    (async () => {
      try {
        const stockIds = (typeof stkState !== 'undefined' && stkState.resourceIds) ? [...stkState.resourceIds] : [];
        const res = await classPool(String(code), stockIds);
        (mysdState.poolByType = mysdState.poolByType || {})[code] = (res.ok && res.data) || [];
        if (!done && input.isConnected) refresh(); // re-run the current query against the now-loaded pool
      } catch (_) { /* stays on the fallback list */ }
    })();
  }

  // freeze the cell's width so swapping text → input doesn't shift the column
  cell.style.width = `${cell.offsetWidth}px`;
  cell.innerHTML = `<span class="mysd-editwrap">
    <input type="text" class="stock-input mysd-input"
      value="${escapeHtml(r.resource_name || '')}" placeholder="Search any ${escapeHtml(r.type_name || 'resource')}…">
    <div class="mysd-sug"></div>
  </span>`;
  const input = cell.querySelector('input');
  const sug = cell.querySelector('.mysd-sug');
  input.focus();
  input.select();

  const render = (opts, note = '') => {
    sug.innerHTML = opts.length ? opts.map(mysdOptHtml).join('')
      : `<div class="mysd-opt-none">${note || 'No matches — type any resource name to use it.'}</div>`;
  };
  // open on the default list; typing searches the full class
  let touched = false;
  const refresh = () => {
    const q = input.value.trim().toLowerCase();
    if (!touched || !q) { render(defaultOpts, 'No recorded spawns — type any resource name.'); return; }
    render(searchPool(q));
  };
  input.addEventListener('input', () => { touched = true; refresh(); });
  refresh();

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
  await loadPrefs(); // Mustafarian-ignore pref gates the slot suggestions
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

  // your STOCKPILE first, like the lab bench: mirror class pool ∩ stockpile,
  // rated by the schematic's formulas against the slot's class caps
  const weightsList = formulas.map((f) => mysParseWeights(f.formulaDescription)).filter(Boolean);
  spState.weightsList = weightsList;
  spState.poolBySlot = {}; // full class pool per slot — the searchbox searches it
  const stockedBySlot = {};
  if (typeof stkState !== 'undefined' && !stkState.items.length) {
    try { await syncStockpile(); } catch (_) { /* chips just don't show */ }
  }
  const stockIds = (typeof stkState !== 'undefined' && stkState.resourceIds) ? [...stkState.resourceIds] : [];
  for (const n of needed) { // sequential — parallel multi-MB bridge calls drop in WKWebView
    try {
      const r = await classPool(String(n.id), stockIds);
      const rows = (r.ok && r.data) || [];
      spState.poolBySlot[n.id] = rows;
      const caps = typeof classCaps === 'function' ? classCaps(String(n.id)) : null;
      stockedBySlot[n.id] = rows
        .filter((p) => stkState && stkState.resourceIds && stkState.resourceIds.has(String(p.id)))
        .map((p) => ({ name: p.name, q: mysWeightedQuality(p, weightsList, caps) || 0, active: safeInt(p.status) === 1, stocked: true,
          type: p.type_name || '', score: p.value_rating != null ? safeInt(p.value_rating) : null, ts: p.timestamp }))
        .sort((a, b) => b.q - a.q)
        .slice(0, 8);
    } catch (_) { /* slot just shows spawn tops */ }
  }

  $('#sp-rows').innerHTML = needed.map((n) => {
    const dto = det?.dtoByCode.get(n.id);
    // BOTH lists: serverBest is all-time (mostly despawned) — the in-spawn
    // candidates live in currentBest and were missing from the options entirely.
    // Mustafarian suggestions drop for users who ignore them (own stock still shows).
    const merged = [...(dto?.serverBestResourceList || []), ...(dto?.currentBestResourceList || [])]
      .filter((sp) => !hideMustafarian(sp.resourceTypeName, n.resourceName));
    const topSeen = new Map();
    for (const sp of merged) {
      const k = String(sp.resourceId || sp.resourceName);
      const prev = topSeen.get(k);
      if (!prev || (mysSpawnActive(sp) && !prev.active)) {  // active copy wins a duplicate
        topSeen.set(k, { name: sp.resourceName || '', q: Number(sp.resourceQuality) || 0,
          active: mysSpawnActive(sp), type: sp.resourceTypeName || '', ts: sp.timestamp });
      }
    }
    const top = [...topSeen.values()].sort((a, b) => b.q - a.q).slice(0, 15);
    // stocked picks lead; a resource both stocked and a top spawn shows once (stocked)
    const stocked = stockedBySlot[n.id] || [];
    const names = new Set(stocked.map((o) => o.name.toLowerCase()));
    const options = stocked.concat(top.filter((o) => !names.has(o.name.toLowerCase())));
    spState.optionsBySlot = spState.optionsBySlot || {};
    spState.optionsBySlot[String(n.id)] = options; // the quick-pick chips read these
    return `<div class="sp-row">
      <span class="sp-label">${escapeHtml(n.desc || '')}
        <div class="mys-type">${escapeHtml(n.resourceName || '')}</div></span>
      ${cselectHtml(n.id, options)}
    </div>`;
  }).join('');

  $('#slot-picker').hidden = false;
  return { ok: true };
}

// ---- Custom dropdown (same look as the Using editor's suggestion panel;
// native <select> popups are OS-styled and can't show quality colors) ----

function cselectOptHtml(o) {
  return `<div class="mysd-opt cselect-opt" data-value="${escapeHtml(o.name)}">
    <span class="mysd-opt-name" data-richtip="${escapeHtml(mysResTipHtml(o))}">${escapeHtml(o.name)}</span>
    <span class="mysd-opt-meta">${o.stocked ? '<span class="mysd-stocked" title="In your stockpile">✓ stock</span>' : ''}
      ${o.active ? '<span class="mys-inspawn">in spawn</span>' : ''}
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
      ${options.length ? `<div class="cselect-quick">
        <span class="fac-tag" data-csquick="best" title="Highest quality overall">Best</span>
        <span class="fac-tag" data-csquick="stock" title="Highest quality already in your stockpile">Best stocked</span>
        <span class="fac-tag" data-csquick="spawn" title="Highest quality currently in spawn">Best in spawn</span>
      </div>` : ''}
      <div class="mysd-opt cselect-opt" data-value=""><span class="stat_off">— choose later —</span></div>
      <div class="cselect-opts">${options.map(cselectOptHtml).join('') ||
        '<div class="mysd-opt-none">No recorded spawns for this slot</div>'}</div>
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

  // Lab-style resource picker modal wiring
  $('#mysd-picker-close').addEventListener('click', mysdClosePicker);
  bindBackdropClose($('#mysd-picker-modal'), () => mysdClosePicker());
  $('#mysd-picker-search').addEventListener('input', () => {
    if (!mysdState.picker) return;
    mysdState.picker.query = $('#mysd-picker-search').value;
    mysdRenderPicker();
  });
  $('#mysd-picker-search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') mysdClosePicker();
    else if (e.key === 'Enter' && mysdState.picker) { // use the typed name verbatim
      const v = $('#mysd-picker-search').value.trim();
      if (v) { const p = mysdState.picker; mysdClosePicker(); mysdSaveUsing(p.ingId, v); }
    }
  });
  $('#mysd-picker-active').addEventListener('change', (e) => {
    if (!mysdState.picker) return;
    mysdState.picker.activeOnly = e.target.checked;
    localStorage.setItem('mysd_picker_active', e.target.checked ? '1' : '0'); // sticky preference
    mysdRenderPicker();
  });
  $('#mysd-picker-stock').addEventListener('change', () => {
    const v = $('#mysd-picker-stock').value;
    if (v && mysdState.picker) { const p = mysdState.picker; mysdClosePicker(); mysdSaveUsing(p.ingId, v); }
  });
  $('#mysd-picker-body').addEventListener('click', (e) => {
    const row = e.target.closest('[data-pickres]');
    if (row && mysdState.picker) { const p = mysdState.picker; mysdClosePicker(); mysdSaveUsing(p.ingId, row.dataset.pickres); }
  });

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
        menu.style.minWidth = `${r.width}px`;
        menu.style.maxHeight = '';
        menu.hidden = false;
        // fit the viewport: shrink into the space below, or flip above the
        // button when that side has more room (bottom rows were clipping off)
        const below = window.innerHeight - r.bottom - 10;
        const wanted = Math.min(menu.scrollHeight, 230);
        if (below >= Math.min(wanted, 140)) {
          menu.style.top = `${r.bottom + 3}px`;
          menu.style.maxHeight = `${Math.min(wanted, below)}px`;
        } else {
          const h = Math.min(wanted, r.top - 10);
          menu.style.top = `${r.top - 3 - h}px`;
          menu.style.maxHeight = `${h}px`;
        }
        const inp = menu.querySelector('.cselect-input');
        inp.value = '';
        menu.querySelectorAll('.cselect-opt').forEach((o) => { o.hidden = false; });
        inp.focus();
      } else {
        menu.hidden = true;
      }
      return;
    }
    // quick-pick chips: one click sets the slot to the best overall / best
    // stocked / best in-spawn candidate — no scrolling or typing
    const quick = e.target.closest('[data-csquick]');
    if (quick) {
      const cs = quick.closest('.cselect');
      // NB: the render fn's `spState` is a local alias of mysdState._setup —
      // this handler lives in another scope and must read the real home
      const options = ((mysdState._setup && mysdState._setup.optionsBySlot) || {})[String(cs.dataset.sp)] || [];
      const mode = quick.dataset.csquick;
      const pick = mode === 'stock' ? options.find((o) => o.stocked)
        : mode === 'spawn' ? [...options].sort((a, b) => b.q - a.q).find((o) => o.active)
        : [...options].sort((a, b) => b.q - a.q)[0];
      if (!pick) { toast(mode === 'stock' ? 'Nothing stocked for this slot' : 'Nothing in spawn for this slot', false); return; }
      cselectPick(cs, pick.name, cselectOptHtml(pick));
      return;
    }
    const opt = e.target.closest('.cselect-opt');
    // outerHTML keeps the .mysd-opt flex wrapper — without it the meta span
    // (display:flex → block) stacks under the name and the button grows tall
    if (opt) cselectPick(opt.closest('.cselect'), opt.dataset.value, opt.outerHTML);
  });

  // Free-text path: an empty query keeps the default (stockpile + top spawns);
  // typing searches the WHOLE class pool (best-first from the mirror), like the
  // Lab. Enter still uses the typed name verbatim.
  $('#sp-rows').addEventListener('input', (e) => {
    const inp = e.target.closest('.cselect-input');
    if (!inp) return;
    const sp = mysdState._setup || {};
    const cs = inp.closest('.cselect');
    const optsBox = cs.querySelector('.cselect-opts');
    if (optsBox._defaultHtml === undefined) optsBox._defaultHtml = optsBox.innerHTML; // stockpile + top spawns
    const q = inp.value.trim().toLowerCase();
    const code = cs.dataset.sp;
    const pool = q && sp.poolBySlot ? sp.poolBySlot[code] : null;
    if (!q) { optsBox.innerHTML = optsBox._defaultHtml; return; } // cleared → restore default
    if (q && pool) {
      const caps = typeof classCaps === 'function' ? classCaps(String(code)) : null;
      const hits = pool
        .filter((p) => String(p.name).toLowerCase().includes(q))
        .slice(0, 60)
        .map((p) => ({ name: p.name, q: mysWeightedQuality(p, sp.weightsList || [], caps) || 0,
          active: safeInt(p.status) === 1, stocked: !!(stkState && stkState.resourceIds && stkState.resourceIds.has(String(p.id))),
          type: p.type_name || '', score: p.value_rating != null ? safeInt(p.value_rating) : null, ts: p.timestamp }))
        .sort((x, y) => y.q - x.q)
        .slice(0, 20);
      optsBox.innerHTML = hits.length ? hits.map(cselectOptHtml).join('')
        : '<div class="mysd-opt-none">No match — press Enter to use the typed name.</div>';
    } else {
      // no query (or pool not loaded): plain substring filter over what's shown
      optsBox.querySelectorAll('.cselect-opt').forEach((o) => {
        o.hidden = !!q && !o.dataset.value.toLowerCase().includes(q);
      });
    }
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

  // folders: create, collapse, rename, delete, drag rows in
  $('#mys-newgroup').addEventListener('click', async () => {
    const res = await grpApi({ action: 'create', kind: 'myschem' });
    if (!res.ok || !res.data) { toast(res.error || 'Could not create group — site update pending?', false); return; }
    mysState.groups.push({ id: res.data.id, name: res.data.name, sort_order: res.data.sort_order });
    renderMysList();
    grpBeginRename('#mys-body', String(res.data.id),
      mysState.groups[mysState.groups.length - 1], renderMysList);
  });

  $('#mys-tagbar').addEventListener('click', (e) => {
    const tag = e.target.closest('[data-mystag]');
    if (!tag) return;
    mysState.tagFilter = mysState.tagFilter === tag.dataset.mystag ? null : tag.dataset.mystag;
    renderMysList();
  });

  // tag indicator popover — identical to stockpile's (same popover element,
  // same show/hide timers); chips filter this list
  $('#mys-body').addEventListener('mouseover', (e) => {
    const tag = e.target.closest('[data-mystaghover]');
    if (!tag) return;
    const s = mysState.items[safeInt(tag.dataset.mystaghover)];
    if (!s) return;
    clearTimeout(stkPopHide);
    const pop = $('#stk-schem-pop');
    pop.innerHTML = `<div class="fac-tagbar" style="margin:0">${mysTags(s).map((t) =>
      `<span class="fac-tag${mysState.tagFilter === t ? ' active' : ''}" data-mystag="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('')}</div>`;
    const r = tag.getBoundingClientRect();
    pop.hidden = false;
    pop.style.left = `${Math.max(8, Math.min(r.left, window.innerWidth - 328))}px`;
    pop.style.top = r.bottom + pop.offsetHeight + 8 < window.innerHeight
      ? `${r.bottom + 4}px` : `${r.top - pop.offsetHeight - 4}px`;
  });
  $('#mys-body').addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-mystaghover]')) stkScheduleSchemPopHide();
  });
  $('#stk-schem-pop').addEventListener('click', (e) => {
    const t = e.target.closest('[data-mystag]');
    if (!t) return;
    $('#stk-schem-pop').hidden = true;
    mysState.tagFilter = mysState.tagFilter === t.dataset.mystag ? null : t.dataset.mystag;
    renderMysList();
  });

  // drag a row onto (or under) a folder row to file it
  $('#mys-body').addEventListener('dragstart', (e) => {
    const el = e.target.closest('tr[data-usid]');
    if (el) el.classList.add('mys-dragging');
  });
  $('#mys-body').addEventListener('dragover', (e) => {
    const dragging = document.querySelector('#mys-body tr.mys-dragging');
    if (!dragging) return;
    e.preventDefault();
    const hd = e.target.closest('tr[data-grpkey]');
    if (hd) { hd.parentNode.insertBefore(dragging, hd.nextSibling); return; }
    const over = e.target.closest('tr[data-usid]');
    if (over && over !== dragging) {
      const rect = over.getBoundingClientRect();
      over.parentNode.insertBefore(dragging, e.clientY < rect.top + rect.height / 2 ? over : over.nextSibling);
    }
  });
  $('#mys-body').addEventListener('dragend', async () => {
    const dragging = document.querySelector('#mys-body tr.mys-dragging');
    if (!dragging) return;
    dragging.classList.remove('mys-dragging');
    const s = mysState.items[safeInt(dragging.dataset.idx)];
    let p = dragging.previousElementSibling;         // section = nearest divider above
    while (p && !p.hasAttribute('data-grpkey')) p = p.previousElementSibling;
    const key = p ? p.dataset.grpkey : 'un';
    if (s) {
      const gid = key === 'un' ? null : safeInt(key);
      if ((s.group_id || null) !== gid) {
        s.group_id = gid;
        const res = await apiFetch('PUT', 'api/my_schematics.php', {
          data: { user_schematic_id: safeInt(s.user_schematic_id), group_id: gid } });
        if (!res.ok) toast(res.error || 'Could not move — site update pending?', false);
      }
    }
    renderMysList();
  });

  // list rows open the detail page
  $('#mys-body').addEventListener('click', (e) => {
    const tog = e.target.closest('[data-grptoggle]');
    if (tog) {
      const k = tog.dataset.grptoggle;
      mysState.grpCollapsed.has(k) ? mysState.grpCollapsed.delete(k) : mysState.grpCollapsed.add(k);
      renderMysList();
      return;
    }
    const ren = e.target.closest('[data-grprename]');
    if (ren) {
      grpBeginRename('#mys-body', ren.dataset.grprename,
        mysState.groups.find((g) => String(g.id) === ren.dataset.grprename), renderMysList);
      return;
    }
    const gdel = e.target.closest('[data-grpdel]');
    if (gdel) {
      if (!confirmArmLabeled(gdel, 'Delete group?')) return;
      const gid = safeInt(gdel.dataset.grpdel);
      grpApi({ action: 'remove', id: gid }).then((res) => {
        if (!res.ok) return;
        mysState.groups = mysState.groups.filter((g) => g.id !== gid);
        mysState.items.forEach((s) => { if (Number(s.group_id) === gid) s.group_id = null; });
        renderMysList();
      });
      return;
    }
    if (e.target.closest('.grp-rename-input') || e.target.closest('tr[data-grpkey]')) return;
    const al = e.target.closest('[data-mysalert]');
    if (al) {
      const item = mysState.items[safeInt(al.dataset.mysalert)];
      if (!item) return;
      item.notify_email = Number(item.notify_email) ? 0 : 1; // optimistic
      renderMysList();
      apiFetch('PUT', 'api/my_schematics.php', {
        data: { user_schematic_id: safeInt(item.user_schematic_id), notify_email: item.notify_email },
      }).then((res) => {
        if (!res.ok) toast(res.error || 'Could not save the alert toggle — site update pending?', false);
        else toast(item.notify_email
          ? `Upgrade-spawn emails ON — ${item.custom_name || item.name}`
          : `Upgrade-spawn emails off — ${item.custom_name || item.name}`);
      }).catch((err) => toast(String(err), false));
      return;
    }
    const note = e.target.closest('[data-mysnote]');
    if (note) { mysOpenNoteDialog(mysState.items[safeInt(note.dataset.mysnote)]); return; }
    const del = e.target.closest('[data-mysdel]');
    if (del) { // two-step: arm, then confirm within the window
      if (!confirmArm(del)) return;
      const item = mysState.items[safeInt(del.dataset.mysdel)];
      if (item) removeFromMySchematics(item.user_schematic_id, item.custom_name || item.name);
      return;
    }
    const row = e.target.closest('tr[data-idx]');
    if (row) openMySchematicPage(mysState.items[safeInt(row.dataset.idx)]);
  });
  $('#mys-note-save').addEventListener('click', () => mysSaveNoteDialog());
  $('#mys-note-cancel').addEventListener('click', () => { $('#mys-note-modal').hidden = true; });
  wireRichToolbar($('#mys-note-modal'));
  bindBackdropClose($('#mys-note-modal'), () => { $('#mys-note-modal').hidden = true; });

  // detail page interactions
  $('#mysd-crumbs').addEventListener('click', (e) => {
    const link = e.target.closest('[data-nav]');
    if (link) showPage(link.dataset.nav);
  });
  $('#mysd-notes').addEventListener('click', (e) => {
    if (e.target.closest('[data-mysdnotes]') && mysdState.item) mysOpenNoteDialog(mysdState.item);
  });
  $('#mysd-cost').addEventListener('click', (e) => {
    const c = e.target.closest('[data-copen]');
    if (c) openSchematicPage(c.dataset.copen, c.dataset.cname || '');
  });

  // Manufacture: load this schematic into an idle factory — product name always,
  // plus time/quantity from your latest matching run (Philosophy/Eponine)
  const mysdPrevRun = () => {
    const product = String(mysdState.item?.name || '').toLowerCase();
    return facState.history.find((h) => String(h.product || '').toLowerCase() === product) || null;
  };
  $('#mysd-manufacture').addEventListener('click', async () => {
    const item = mysdState.item;
    if (!item) return;
    await loadFactories(); // fresh list + run history (page elements always exist — SPA)
    if (mysdState.item !== item) return;
    const idle = facState.items.filter((f) => !f.started_at);
    if (!idle.length) {
      toast(facState.items.length
        ? 'All your factories are mid-run — finish one first'
        : 'No factories yet — set one up on the Factories page', false);
      return;
    }
    const prev = mysdPrevRun();
    $('#mysd-fac-title').textContent = `Manufacture ${item.name}`;
    $('#mysd-fac-hint').textContent = prev
      ? 'Times and quantity restored from your last run of this product — adjust if needed.'
      : 'Set the per-unit crafting time and how many to run.';
    $('#mysd-fac-time').value = prev ? String(prev.time_value) : '';
    $('#mysd-fac-unit').value = prev ? prev.time_unit : 'm';
    $('#mysd-fac-qty').value = prev ? String(prev.quantity) : '1000';
    $('#mysd-fac-list').innerHTML = idle.map((f) => `
      <button type="button" class="mysd-fac-opt" data-mfac="${f.id}">
        <b>${escapeHtml(f.name)}</b>
        <span class="mys-type">${[f.owner, f.planet].filter(Boolean).map((x) => escapeHtml(x)).join(' · ') || 'idle'}</span>
        <span class="mysd-fac-go"><i class="fa-solid fa-play"></i> Start here</span>
      </button>`).join('');
    $('#mysd-fac-modal').hidden = false;
    if (!prev) $('#mysd-fac-time').focus();
  });
  $('#mysd-fac-cancel').addEventListener('click', () => { $('#mysd-fac-modal').hidden = true; });
  bindBackdropClose($('#mysd-fac-modal'), () => { $('#mysd-fac-modal').hidden = true; });
  $('#mysd-fac-list').addEventListener('click', async (e) => {
    const b = e.target.closest('[data-mfac]');
    if (!b || !mysdState.item) return;
    const f = facState.items.find((x) => String(x.id) === b.dataset.mfac);
    if (!f) return;
    const time_value = parseFloat($('#mysd-fac-time').value);
    const quantity = safeInt($('#mysd-fac-qty').value);
    if (!(time_value > 0) || !(quantity > 0)) {
      toast('Set the per-unit time and quantity first', false);
      return;
    }
    $('#mysd-fac-modal').hidden = true;
    Object.assign(f, { product: mysdState.item.name || '',
                       time_value, time_unit: $('#mysd-fac-unit').value, quantity });
    const saved = await facPost({ action: 'save', factory: f });
    if (!saved.ok) return;
    const started = await facPost({ action: 'start', id: f.id });
    if (!started.ok) return;
    facState.flashId = String(f.id);
    toast(`${f.name} is running — ${fmtNum(quantity)} × ${mysdState.item.name}`);
    showPage('factories');
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
    // clicking a resource name (link) opens its page; clicking elsewhere on the
    // Using cell opens the Lab-style picker
    const resLink = e.target.closest('[data-res]');
    if (resLink) { openResourcePage(resLink.dataset.res); return; }
    const editCell = e.target.closest('[data-editing-ing]');
    if (editCell) { mysdOpenPicker(editCell.dataset.editingIng); return; }
    const addBadge = e.target.closest('[data-add]');
    if (addBadge) { handleAddCellClick(addBadge, e); return; }
  });
}
