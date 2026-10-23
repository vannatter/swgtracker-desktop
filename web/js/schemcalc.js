/* schemcalc.js — manufacturing Cost Calculator for My Schematics.
 *
 * Ported from the website's js/schematic-calc.js and extended for the app:
 *   - DUAL pricing per resource: your stockpile CPU (my_cpu) and the market eCPU,
 *     shown side by side with two subtotals + two grand totals (snickerfritz's perk).
 *   - Top-level slots default to the resource YOU assigned in My Schematics.
 *   - Components are costed recursively; each component's recipe defaults to one of
 *     YOUR saved schematics when available, with a picker to switch (prefer-your-own).
 *   - A "# of runs" multiplier scales the grand totals.
 *
 * Data comes from api().get_schematic(id) — same payload the website calc uses, with
 * `cpu` already eCPU-clamped on each best-list resource. Overrides/runs persist in
 * localStorage per schematic ('swgAppCalc:<id>'). Public: schemCalcRender(host, item).
 */

const scCache = new Map();          // "id|formulas" -> schematic object
const SC_MAXDEPTH = 6;

async function scFetch(id, formulas = '') {
  const key = `${id}|${formulas}`;
  if (scCache.has(key)) return scCache.get(key);
  let s = null;
  try {
    const res = await api().get_schematic(String(id), String(formulas || ''));
    s = (res.ok && res.data) ? (res.data.schematic || res.data) : null;
  } catch (_) { /* ignore */ }
  scCache.set(key, s);
  return s;
}
const scCached = (id, formulas = '') => scCache.get(`${id}|${formulas}`) || null;

// stockpile resourceId -> my_cpu (the price you paid), for "your cost"
function scStockMap() {
  const m = new Map();
  if (typeof stkState !== 'undefined') {
    (stkState.items || []).forEach((i) => { if (i.my_cpu != null && i.my_cpu !== '') m.set(String(i.id), safeInt(i.my_cpu)); });
  }
  return m;
}
const scMkt = (choice) => { const v = choice ? safeInt(choice.cpu) : 0; return v > 0 ? v : 1; }; // market eCPU, floored at 1

// ---- resource blocks (best lists keyed by the slot's type) ----
function scIndexBlocks(s) {
  const idx = {};
  (s.resourceDtoList || []).forEach((b) => {
    if (b.resourceTypeCode) idx[`c:${String(b.resourceTypeCode).toLowerCase()}`] = b;
    if (b.resourceTypeName) idx[`n:${String(b.resourceTypeName).toLowerCase()}`] = b;
  });
  return idx;
}
function scBlockFor(idx, rn) {
  return (rn.id != null && idx[`c:${String(rn.id).toLowerCase()}`])
    || (rn.resourceName != null && idx[`n:${String(rn.resourceName).toLowerCase()}`])
    || (rn.desc != null && idx[`n:${String(rn.desc).toLowerCase()}`]) || null;
}
function scAllResources(block) {
  const seen = new Set(); const out = [];
  ['serverBestResourceList', 'currentBestResourceList'].forEach((k) => {
    ((block && block[k]) || []).forEach((r) => {
      const id = String(r.resourceId);
      if (!seen.has(id)) { seen.add(id); out.push(r); }
    });
  });
  return out;
}
function scChildId(c, preferSet) {
  // prefer one of YOUR saved schematics for this component slot
  if (preferSet && c.categoryItems && c.categoryItems.length) {
    const mine = c.categoryItems.find((ci) => preferSet.has(String(ci.schematicId)));
    if (mine) return mine.schematicId;
  }
  if (c.categoryItems && c.categoryItems.length) return c.categoryItems[0].schematicId;
  if (c.type === 'schematic' && c.id) return c.id;
  return null;
}

// normalize a best-list entry to a choice {rid, name, mkt, my, stats-ish}
function scChoiceFromDto(r, stk) {
  return { rid: String(r.resourceId), name: r.resourceName || r.resourceId,
    mkt: scMkt(r), my: stk.has(String(r.resourceId)) ? stk.get(String(r.resourceId)) : null, raw: r };
}

// ---- the calculator instance ----
async function schemCalcRender(host, item) {
  if (!host) return;
  host.innerHTML = '<div class="sc-loading"><span class="spinner"></span> Loading calculator…</div>';

  // make sure stockpile my-CPU is available before pricing
  if (typeof stkState !== 'undefined' && !stkState.items.length && typeof syncStockpile === 'function') {
    try { await syncStockpile(); } catch (_) { /* market still works */ }
  }
  const top = await scFetch(item.schematic_id, item.formulas || '');
  if (!top) { host.innerHTML = '<div class="empty-state is-compact">Could not load the recipe for the calculator.</div>'; return; }

  const sid = String(item.schematic_id);
  // recipe amounts are PER UNIT (one item/layer); a factory run makes a crate of this many
  const crate = Math.max(1, safeInt(top.crateSize) || 1);
  const SKEY = `swgAppCalc:${sid}`;
  const store = (() => { try { return JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (_) { return {}; } })();
  ['sel', 'pick', 'myprice', 'comp', 'cprice', 'opt'].forEach((k) => { store[k] = store[k] || {}; });
  const save = () => { try { localStorage.setItem(SKEY, JSON.stringify(store)); } catch (_) { /* ignore */ } };

  const stk = scStockMap();
  const preferSet = (typeof mysState !== 'undefined' && mysState.schematicIds) ? mysState.schematicIds : new Set();
  // assigned resources from My Schematics, keyed by the slot type (resource_type)
  const assignedByType = new Map();
  for (const r of (item.resources || [])) if (r.resource_name) assignedByType.set(String(r.resource_type), r.resource_name);

  let model = null;

  // a full resource record (from get_resource/class pool) → a priced choice
  function recToChoice(rec) {
    const rid = String(rec.id);
    const mkt = ecpuClamp(rec.cpu, safeInt(rec.status) === 1, safeInt(rec.planet_mustafar) === 1) || 1;
    let my = (typeof labMyCpu === 'function') ? labMyCpu(rec) : null;
    if (my == null && stk.has(rid)) my = stk.get(rid);
    return { rid, name: rec.name, mkt, my, raw: rec };
  }

  // Resolve a slot's effective resource: a what-if pick (store.pick) wins, else the
  // resource YOU assigned (top slots), else the server-best. Carries the slot's class
  // code + type name so the pick button can open the full picker for it.
  async function resolveSlot(schemId, rn, idx, assignedRec) {
    const block = scBlockFor(idx, rn);
    const best = scAllResources(block).map((r) => scChoiceFromDto(r, stk));
    const typeKey = String(rn.id != null ? rn.id : (rn.resourceName || rn.desc || ''));
    const gk = `${schemId}|${typeKey}`;
    let sel = null;
    const pickName = store.pick[gk];
    if (pickName && typeof mysGetResource === 'function') { const rec = await mysGetResource(pickName); if (rec) sel = recToChoice(rec); }
    if (!sel && assignedRec) sel = recToChoice(assignedRec);
    if (!sel) sel = best[0] || null;
    const myOverride = store.myprice[gk];
    return {
      gk, typeKey, units: safeInt(rn.units),
      code: String(rn.id || ''),
      // slot label (what the recipe calls this requirement) + the resource class it takes
      slotLabel: rn.desc || rn.resourceName || typeKey,
      typeName: (block && block.resourceTypeName) || rn.resourceName || '',
      label: rn.desc || rn.resourceName || typeKey,
      selName: sel ? sel.name : (rn.resourceName || rn.desc || typeKey),
      selId: sel ? sel.rid : '',
      myCpu: (myOverride != null && myOverride !== '') ? safeInt(myOverride)
        : (sel && sel.my != null ? sel.my : (sel ? sel.mkt : 1)),
      mktCpu: sel ? sel.mkt : 1,
    };
  }

  // Recursive craft cost {my, mkt} for one unit of schematic `id` (from cache; fetches first).
  async function ensureTree(id, depth, seen) {
    if (depth > SC_MAXDEPTH || seen.includes(String(id))) return;
    const s = await scFetch(id, '');
    if (!s) return;
    const seen2 = seen.concat([String(id)]);
    const subs = (s.componentTypes || []).filter((c) => c.optional !== 'yes' && c.type !== 'item');
    for (const c of subs) {
      const cid = scChildId(c, preferSet);
      if (cid) await ensureTree(cid, depth + 1, seen2);
    }
  }
  function craftCostCached(id, depth, seen) {
    if (depth > SC_MAXDEPTH || seen.includes(String(id))) return { my: 0, mkt: 0 };
    const s = scCached(id, '');
    if (!s) return { my: 0, mkt: 0, partial: true };
    const seen2 = seen.concat([String(id)]);
    const idx = scIndexBlocks(s);
    let my = 0, mkt = 0;
    (s.resourcesNeeded || []).forEach((rn) => {
      const choices = scAllResources(scBlockFor(idx, rn)).map((r) => scChoiceFromDto(r, stk));
      const c0 = choices[0];
      const um = c0 ? scMkt(c0) : 1;
      const uy = (c0 && c0.my != null) ? c0.my : um;
      mkt += safeInt(rn.units) * um;
      my += safeInt(rn.units) * uy;
    });
    (s.componentTypes || []).filter((x) => x.optional !== 'yes').forEach((x) => {
      if (x.type === 'item') return;
      const cid = scChildId(x, preferSet); if (!cid) return;
      const sub = craftCostCached(cid, depth + 1, seen2);
      mkt += safeInt(x.number) * sub.mkt;
      my += safeInt(x.number) * sub.my;
    });
    return { my, mkt };
  }

  // ---- build the model ----
  async function buildModel() {
    const idx = scIndexBlocks(top);
    const resources = [];
    for (const rn of (top.resourcesNeeded || [])) {
      const assignedName = assignedByType.get(String(rn.id));
      const assignedRec = assignedName && typeof mysGetResource === 'function' ? await mysGetResource(assignedName) : null;
      resources.push(await resolveSlot(sid, rn, idx, assignedRec));
    }
    const components = (top.componentTypes || []).map((c) => {
      const id = String(c.id);
      const craftable = c.type !== 'item';
      const craftId = craftable ? (store.comp[id] || scChildId(c, preferSet)) : null;
      const mineRecipe = craftId != null && preferSet.has(String(craftId));
      return {
        id, number: safeInt(c.number), name: c.desc || id, type: c.type,
        optional: c.optional === 'yes', craftable, craftId, mineRecipe,
        categoryItems: c.categoryItems || [],
        override: (store.cprice[id] != null && store.cprice[id] !== '') ? safeInt(store.cprice[id]) : null,
        included: c.optional === 'yes' ? !!store.opt[id] : true,
        expanded: false, cost: { my: 0, mkt: 0 },
      };
    });
    const runs = Math.min(100000, Math.max(1, safeInt(store.runs) || 1));
    return { resources, components, runs };
  }

  const resMy = (r) => r.units * r.myCpu;
  const resMkt = (r) => r.units * r.mktCpu;
  function compUnit(c) {
    if (c.override != null) return { my: c.override, mkt: c.override };
    return c.craftable ? c.cost : { my: 0, mkt: 0 };
  }
  const compSub = (c) => { if (!c.included) return { my: 0, mkt: 0 }; const u = compUnit(c); return { my: c.number * u.my, mkt: c.number * u.mkt }; };
  function totals() {
    let my = 0, mkt = 0;
    model.resources.forEach((r) => { my += resMy(r); mkt += resMkt(r); });
    model.components.forEach((c) => { const s = compSub(c); my += s.my; mkt += s.mkt; });
    return { my, mkt };
  }

  // ---- render ----
  function resRow(r, i) {
    const assignedMark = (assignedByType.get(r.code) && assignedByType.get(r.code) === r.selName) ? ' <span class="sc-tag">yours</span>' : '';
    const slot = `<div class="sc-slot"><span class="sc-slot-label">${escapeHtml(r.slotLabel)}</span>${r.typeName && r.typeName !== r.slotLabel ? `<span class="sc-slot-type">${escapeHtml(r.typeName)}</span>` : ''}</div>`;
    return `<tr data-ri="${i}">
      <td class="sc-qty">${fmtNum(r.units)} ×</td>
      <td class="sc-name">${slot}<button type="button" class="sc-pickbtn" data-pick="${i}" title="Pick a different resource (search · best in stock / spawn / all-time)">
        <span class="sc-dd-cur">${escapeHtml(r.selName)}${assignedMark}</span><span class="sc-dd-curcpu">${fmtNum(r.mktCpu)} cpu</span><i class="fa-solid fa-caret-down"></i></button></td>
      <td class="sc-mycpu"><input type="number" min="0" step="1" class="sc-myprice" value="${r.myCpu}"><span class="sc-unit">cpu</span></td>
      <td class="sc-mysub" data-mysub>${fmtNum(resMy(r))}</td>
      <td class="sc-mktcpu">${fmtNum(r.mktCpu)}</td>
      <td class="sc-mktsub" data-mktsub>${fmtNum(resMkt(r))}</td>
    </tr>`;
  }
  function compRow(c, i) {
    let nameInner;
    if (c.craftable && c.categoryItems.length > 1) {
      const opts = c.categoryItems.map((ci) => `<option value="${escapeHtml(String(ci.schematicId))}"${String(ci.schematicId) === String(c.craftId) ? ' selected' : ''}>${escapeHtml(ci.schematicName)}${preferSet.has(String(ci.schematicId)) ? ' ✓ yours' : ''}</option>`).join('');
      nameInner = `<select class="sc-comp form-select filter-select">${opts}</select>`;
    } else {
      nameInner = escapeHtml(c.name);
    }
    const tag = c.craftable ? `<span class="sc-tag${c.mineRecipe ? ' sc-tag-mine' : ''}">${c.mineRecipe ? 'your recipe' : 'craft'}</span>` : '<span class="sc-tag sc-loot">looted</span>';
    const expand = c.craftable ? `<span class="sc-expand" title="Show breakdown">${c.expanded ? '▾' : '▸'}</span> ` : '';
    const optBox = c.optional ? `<input type="checkbox" class="sc-opt"${c.included ? ' checked' : ''} title="Include this optional component"> ` : '';
    const sub = compSub(c);
    const myPrice = c.override != null ? c.override : (c.craftable ? Math.round(c.cost.my) : 0);
    return `<tr data-ci="${i}"${c.included ? '' : ' class="sc-off"'}>
      <td class="sc-qty">${optBox}${fmtNum(c.number)} ×</td>
      <td class="sc-name">${expand}${nameInner} ${tag}</td>
      <td class="sc-mycpu"><input type="number" min="0" step="1" class="sc-cprice" value="${myPrice}"><span class="sc-unit">ea</span></td>
      <td class="sc-mysub" data-mysub>${fmtNum(sub.my)}</td>
      <td class="sc-mktcpu">${c.craftable ? fmtNum(Math.round(c.cost.mkt)) : '—'}</td>
      <td class="sc-mktsub" data-mktsub>${fmtNum(sub.mkt)}</td>
    </tr>`
      + (c.craftable ? `<tr class="sc-bd-row" data-bd="${i}"${c.expanded ? '' : ' hidden'}><td colspan="6">${c.expanded ? breakdownHtml(c) : ''}</td></tr>` : '');
  }
  function breakdownHtml(c) {
    const s = scCached(c.craftId, '');
    if (!s) return '<div class="sc-muted">Breakdown loading…</div>';
    const idx = scIndexBlocks(s);
    const rows = (s.resourcesNeeded || []).map((rn) => {
      const choices = scAllResources(scBlockFor(idx, rn)).map((r) => scChoiceFromDto(r, stk));
      const c0 = choices[0];
      const um = c0 ? scMkt(c0) : 1, uy = (c0 && c0.my != null) ? c0.my : um;
      return `<tr><td class="sc-qty">${fmtNum(safeInt(rn.units))} ×</td><td class="sc-name">${escapeHtml(rn.resourceName || rn.desc || '')}${c0 ? ` <span class="sc-muted">${escapeHtml(c0.name)}</span>` : ''}</td>`
        + `<td class="sc-mysub">${fmtNum(safeInt(rn.units) * uy)}</td><td class="sc-mktsub">${fmtNum(safeInt(rn.units) * um)}</td></tr>`;
    }).join('');
    const subs = (s.componentTypes || []).filter((x) => x.optional !== 'yes').map((x) => {
      if (x.type === 'item') return `<tr><td class="sc-qty">${fmtNum(safeInt(x.number))} ×</td><td class="sc-name">${escapeHtml(x.desc || x.id)} <span class="sc-tag sc-loot">looted</span></td><td class="sc-mysub">—</td><td class="sc-mktsub">—</td></tr>`;
      const cid = scChildId(x, preferSet);
      const sub = cid != null ? craftCostCached(cid, 2, [String(c.craftId)]) : { my: 0, mkt: 0 };
      const n = safeInt(x.number);
      return `<tr><td class="sc-qty">${fmtNum(n)} ×</td><td class="sc-name">${escapeHtml(x.desc || x.id)} <span class="sc-tag">craft</span></td><td class="sc-mysub">${fmtNum(n * sub.my)}</td><td class="sc-mktsub">${fmtNum(n * sub.mkt)}</td></tr>`;
    }).join('');
    return `<div class="sc-bd-title">Breakdown: ${escapeHtml(s.schematicName || ('schematic ' + c.craftId))} (per unit)</div>`
      + `<table class="sc-table sc-bd"><thead><tr><th></th><th>Resource / component</th><th>Your</th><th>Market</th></tr></thead><tbody>${rows}${subs}</tbody></table>`;
  }

  function render() {
    const t = totals();
    host.innerHTML =
      `<table class="sc-table"><thead><tr><th></th><th>Resource</th><th>Your CPU</th><th>Your cost</th><th>Market CPU</th><th>Market cost</th></tr></thead>`
      + `<tbody><tr class="sc-grouphead"><td colspan="6">Resources</td></tr>`
      + (model.resources.length ? model.resources.map(resRow).join('') : '<tr><td colspan="6"><div class="empty-state is-compact">No resources in this recipe.</div></td></tr>')
      + (model.components.length ? `<tr class="sc-grouphead"><td colspan="6">Components</td></tr>` + model.components.map(compRow).join('') : '')
      + '</tbody></table>'
      + `<div class="sc-summary">
          <div class="sc-sum-row"><span>Cost per item</span><span><b class="sc-total-my">${fmtNum(t.my)}</b> cr <span class="sc-muted">your stockpile</span> · <b class="sc-total-mkt">${fmtNum(t.mkt)}</b> cr <span class="sc-muted">market</span></span></div>
          <div class="sc-sum-row sc-sum-total"><span># of items <input type="number" min="1" max="100000" class="sc-runs" value="${model.runs}">${crate > 1 ? ` <span class="sc-muted">crate size ${fmtNum(crate)}</span>` : ''}</span><span>Total <b class="sc-run-my">${fmtNum(t.my * model.runs)}</b> cr <span class="sc-muted">yours</span> · <b class="sc-run-mkt">${fmtNum(t.mkt * model.runs)}</b> cr <span class="sc-muted">market</span></span></div>
        </div>`;
  }
  function refresh() {
    host.querySelectorAll('tr[data-ri]').forEach((tr) => {
      const r = model.resources[+tr.dataset.ri];
      const a = tr.querySelector('[data-mysub]'); if (a) a.textContent = fmtNum(resMy(r));
      const b = tr.querySelector('[data-mktsub]'); if (b) b.textContent = fmtNum(resMkt(r));
    });
    host.querySelectorAll('tr[data-ci]').forEach((tr) => {
      const c = model.components[+tr.dataset.ci]; const s = compSub(c);
      const a = tr.querySelector('[data-mysub]'); if (a) a.textContent = fmtNum(s.my);
      const b = tr.querySelector('[data-mktsub]'); if (b) b.textContent = fmtNum(s.mkt);
      tr.classList.toggle('sc-off', !c.included);
    });
    const t = totals();
    const set = (sel, v) => { const n = host.querySelector(sel); if (n) n.textContent = fmtNum(v); };
    set('.sc-total-my', t.my); set('.sc-total-mkt', t.mkt);
    set('.sc-run-my', t.my * model.runs); set('.sc-run-mkt', t.mkt * model.runs);
  }

  // Open the full class-pool picker (search · best in stock / spawn / all-time) for a
  // slot; the pick re-prices the calc only (what-if), never the saved assignment.
  function openPick(r) {
    if (typeof mysdOpenPicker !== 'function') return;
    mysdOpenPicker(null, {
      code: r.code, typeName: r.typeName, label: r.label, current: r.selName,
      weightsList: (typeof mysdState !== 'undefined' ? mysdState.weightsList : null),
      onPick: async (name) => {
        store.pick[r.gk] = name; delete store.myprice[r.gk]; save();
        const rec = (typeof mysGetResource === 'function') ? await mysGetResource(name) : null;
        if (rec) { const ch = recToChoice(rec); r.selName = ch.name; r.selId = ch.rid; r.mktCpu = ch.mkt; r.myCpu = ch.my != null ? ch.my : ch.mkt; }
        render();
      },
    });
  }

  function bind() {
    if (host._scWired) return; host._scWired = true;
    host.addEventListener('click', async (e) => {
      const pb = e.target.closest('.sc-pickbtn');
      if (pb) { openPick(model.resources[+pb.dataset.pick]); return; }
      const exp = e.target.closest('.sc-expand');
      if (exp) {
        const ci = +exp.closest('tr').dataset.ci; const c = model.components[ci];
        c.expanded = !c.expanded; exp.textContent = c.expanded ? '▾' : '▸';
        const bd = host.querySelector(`tr.sc-bd-row[data-bd="${ci}"]`);
        if (bd) { bd.hidden = !c.expanded; const td = bd.querySelector('td'); if (td) td.innerHTML = c.expanded ? breakdownHtml(c) : ''; }
        return;
      }
    });
    host.addEventListener('change', async (e) => {
      if (e.target.classList.contains('sc-opt')) {
        const c = model.components[+e.target.closest('tr').dataset.ci];
        c.included = e.target.checked; store.opt[c.id] = c.included; save(); refresh();
      } else if (e.target.classList.contains('sc-comp')) {
        const c = model.components[+e.target.closest('tr').dataset.ci];
        c.craftId = e.target.value; c.mineRecipe = preferSet.has(String(c.craftId));
        store.comp[c.id] = c.craftId; save();
        await ensureTree(c.craftId, 1, [sid]); c.cost = craftCostCached(c.craftId, 1, [sid]); c.expanded = false; render();
      }
    });
    host.addEventListener('input', (e) => {
      if (e.target.classList.contains('sc-myprice')) {
        const r = model.resources[+e.target.closest('tr').dataset.ri];
        r.myCpu = safeInt(e.target.value); store.myprice[r.gk] = r.myCpu; save(); refresh();
      } else if (e.target.classList.contains('sc-cprice')) {
        const c = model.components[+e.target.closest('tr').dataset.ci];
        if (e.target.value === '') { c.override = null; delete store.cprice[c.id]; }
        else { c.override = safeInt(e.target.value); store.cprice[c.id] = c.override; }
        save(); refresh();
      } else if (e.target.classList.contains('sc-runs')) {
        model.runs = Math.min(100000, Math.max(1, safeInt(e.target.value) || 1));
        store.runs = model.runs; save();
        const t = totals();
        const mn = host.querySelector('.sc-run-my'); if (mn) mn.textContent = fmtNum(t.my * model.runs);
        const mk = host.querySelector('.sc-run-mkt'); if (mk) mk.textContent = fmtNum(t.mkt * model.runs);
      }
    });
  }

  model = await buildModel();
  // resolve every component's recursive cost before first paint
  for (const c of model.components) {
    if (c.craftable && c.craftId) { await ensureTree(c.craftId, 1, [sid]); c.cost = craftCostCached(c.craftId, 1, [sid]); }
  }
  render();
  bind();
}
