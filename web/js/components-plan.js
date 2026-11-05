// My Components — craft planner.
//
// Pick what you mean to craft (schematic × how many, several at once) and every
// required component slot across them rolls up against what you hold: part,
// needed, have, short. A shortfall whose part is itself a schematic gets
// "Make it", which adds that sub-craft to the plan — its own slots then roll in
// too, and what it makes counts toward the part it was added for. Plans save
// per user (api/components.php plan_save / plan_remove / ?plans=1); the rollup
// runs here, on the same slot matching and per-slot links Log a craft uses
// (cmpSlotRows / cmpLink / cmpSlotNames in components.js).
//
// The Resources view rolls the same plan up by RESOURCE slot instead: every
// schematic's resource amounts × how many, by class, against My Stockpile
// stacks of that class (or any class under it), and for anything short the
// best current spawns Top Spawns ranks for that slot (api/topspawns.php
// ?schematic=), falling back to the schematic's own current-best list.

const cmpPlan = { plans: [], id: 0, name: '', targets: [], cache: new Map(), searchTimer: null, dirty: false,
  view: localStorage.getItem('cmp_plan_view') === 'res' ? 'res' : 'parts', tops: new Map(), topsBusy: false, stkTried: false };
const CMP_PLAN_MAX = 40;

async function cmpPlanSchematic(sid) {
  const key = String(sid);
  if (cmpPlan.cache.has(key)) return cmpPlan.cache.get(key);
  let res;
  try { res = await api().get_schematic(sid); } catch (e) { res = { ok: false, error: String(e) }; }
  const s = res.ok && res.data ? (res.data.schematic || res.data) : null;
  const entry = s ? { name: s.schematicName || '', comps: (s.componentTypes || []).filter((c) => safeInt(c.number) > 0),
    // resource slots + the schematic's own in-spawn best per slot (Resources view)
    res: (s.resourcesNeeded || []).filter((r) => safeInt(r.units) > 0)
      .map((r) => ({ code: String(r.id || ''), name: r.resourceName || '', desc: r.desc || '', units: safeInt(r.units) })),
    best: cmpPlanDtoBest(s), crate: safeInt(s.crateSize) }
    : { name: '', comps: [], res: [], best: {}, crate: 0, error: res.error || 'server error' };
  if (s) { try { await cmpEnsureSlotNames(entry.comps); } catch (_) {} }
  cmpPlan.cache.set(key, entry);
  return entry;
}

// slot class code -> the in-spawn resources the schematic ranks best for it
function cmpPlanDtoBest(s) {
  const out = {};
  (s.resourceDtoList || []).forEach((d) => {
    out[String(d.resourceTypeCode || '')] = (d.currentBestResourceList || []).filter((b) => b.active !== false)
      .slice(0, 5).map((b) => ({ name: b.resourceName || '', type: b.resourceTypeName || '', q: Number(b.resourceQuality) || 0 }));
  });
  return out;
}

// the schematics that would make a slot's part: a "schematic" slot names one,
// a category slot lists its members
function cmpPlanMakers(c) {
  const out = [];
  if (c.type === 'schematic' && safeInt(c.id)) out.push({ id: String(c.id), name: cmpSlotNames.get(String(c.id)) || cmpSlotLabel(c) });
  (Array.isArray(c.categoryItems) ? c.categoryItems : []).forEach((ci) => {
    if (safeInt(ci.schematicId) && !out.some((m) => m.id === String(ci.schematicId))) out.push({ id: String(ci.schematicId), name: ci.schematicName || '' });
  });
  return out.slice(0, 15);
}

// every required slot across the plan, grouped by what fills it, against your
// stock — each stack counted once, however many slots it could fill
function cmpPlanRollup() {
  const needs = new Map();
  cmpPlan.targets.forEach((t) => {
    const e = cmpPlan.cache.get(String(t.sid));
    if (!e || !safeInt(t.qty)) return;
    e.comps.forEach((c) => {
      if (c.optional === 'yes') return;
      const link = cmpLinkOf(c.id), pick = cmpLinkLabel(link);
      const key = link ? cmpLinkKey(link) : `${c.type === 'schematic' ? 'S' : 'C'}:${c.id}`;
      let n = needs.get(key);
      if (!n) {
        const part = c.type === 'schematic' ? cmpSlotNames.get(String(c.id)) : '';
        n = { key, c, label: pick || part || cmpSlotLabel(c), role: pick || part ? cmpSlotLabel(c) : '',
          need: 0, for: new Set(), makers: cmpPlanMakers(c), rows: cmpSlotRows(c) };
        needs.set(key, n);
      }
      n.need += safeInt(c.number) * safeInt(t.qty);
      n.for.add(e.name || t.name);
    });
  });
  const left = cmpLeft();
  const out = [...needs.values()].sort((a, b) => a.label.localeCompare(b.label));
  out.forEach((n) => {
    cmpGive(n, n.need, left);   // in the draw order, each stack once (components.js)
    n.making = cmpPlan.targets.filter((t) => n.makers.some((m) => m.id === String(t.sid))).reduce((s, t) => s + safeInt(t.qty), 0);
    n.short = Math.max(0, n.need - n.have - n.making);
  });
  return out.sort((a, b) => (b.short > 0) - (a.short > 0) || a.label.localeCompare(b.label));
}

// ---- Resources view ----

// a class code and every class above it (restree_data.js), so a Berries stack
// fits a Fruit slot
let cmpResTree = null;
function cmpResChain(code) {
  if (!cmpResTree) {
    cmpResTree = {};
    if (typeof RESTREE_ROWS !== 'undefined') RESTREE_ROWS.forEach(([c, , parent]) => { cmpResTree[c] = parent; });
  }
  const out = [];
  let c = String(code || ''), guard = 0;
  while (c && guard++ < 12) { out.push(c); c = cmpResTree[c] || ''; }
  return out;
}

// every resource slot across the plan, by class, against My Stockpile — the
// narrowest class draws first (a Berries slot before a Fruit one), biggest
// stacks first, each stack counted once
function cmpPlanResRollup() {
  const needs = new Map();
  cmpPlan.targets.forEach((t) => {
    const e = cmpPlan.cache.get(String(t.sid));
    if (!e || !e.res || !safeInt(t.qty)) return;
    e.res.forEach((r) => {
      if (!r.code) return;
      let n = needs.get(r.code);
      if (!n) { n = { key: r.code, label: r.name || r.code, roles: new Set(), need: 0, for: new Set(), sids: new Set(), have: 0, from: [] }; needs.set(r.code, n); }
      n.need += r.units * safeInt(t.qty);
      if (r.desc && r.desc !== r.name) n.roles.add(r.desc);
      n.for.add(e.name || t.name);
      n.sids.add(String(t.sid));
    });
  });
  const stock = (typeof stkState !== 'undefined' ? stkState.items : [])
    .map((i) => ({ i, chain: cmpResChain(i.type_code), left: safeInt(i.stock) }))
    .filter((x) => x.left > 0)
    .sort((a, b) => b.left - a.left);
  const out = [...needs.values()];
  out.slice().sort((a, b) => cmpResChain(b.key).length - cmpResChain(a.key).length).forEach((n) => {
    stock.forEach((x) => {
      if (n.have >= n.need || !x.left || !x.chain.includes(n.key)) return;
      const take = Math.min(x.left, n.need - n.have);
      x.left -= take;
      n.have += take;
      n.from.push({ name: x.i.name || '', n: take });
    });
    n.short = Math.max(0, n.need - n.have);
  });
  return out.sort((a, b) => (b.short > 0) - (a.short > 0) || a.label.localeCompare(b.label));
}

// the best current spawns for a short slot: Top Spawns' ranking for the plan's
// schematics (best rank across them), else the schematics' own current-best
function cmpPlanSpawns(n) {
  const seen = new Map();
  n.sids.forEach((sid) => (cmpPlan.tops.get(sid) || []).forEach((r) => {
    if (r.section !== n.label) return;
    const k = String(r.id), p = seen.get(k);
    if (!p || safeInt(r.rank) < p.rank) seen.set(k, { name: r.name || '', type: r.type_name || '', rank: safeInt(r.rank), score: r.value_rating, res: r });
  }));
  if (seen.size) return [...seen.values()].sort((a, b) => a.rank - b.rank || safeInt(b.score) - safeInt(a.score)).slice(0, 3);
  const best = new Map();
  n.sids.forEach((sid) => (((cmpPlan.cache.get(sid) || {}).best || {})[n.key] || []).forEach((b) => {
    if (typeof hideMustafarian === 'function' && hideMustafarian(b.type, n.label)) return;
    if (!best.has(b.name) || best.get(b.name).q < b.q) best.set(b.name, b);
  }));
  return [...best.values()].sort((a, b) => b.q - a.q).slice(0, 3);
}

// Top Spawns rows for the plan's schematics — fetched once per schematic
async function cmpPlanLoadTops() {
  const want = [...new Set(cmpPlan.targets.map((t) => String(t.sid)))].filter((sid) => !cmpPlan.tops.has(sid));
  if (!want.length || cmpPlan.topsBusy) return;
  cmpPlan.topsBusy = true;
  let res;
  try { res = await apiFetch('GET', 'api/topspawns.php', { params: { schematic: want.join(',') } }); } catch (e) { res = { ok: false }; }
  const got = new Map(want.map((sid) => [sid, []]));
  ((res.ok && res.data && res.data.results) || []).forEach((r) => { const a = got.get(String(r.schematic_id)); if (a) a.push(r); });
  got.forEach((rows, sid) => cmpPlan.tops.set(sid, rows));   // a failed fetch falls back to the schematic's list
  cmpPlan.topsBusy = false;
  cmpPlanRender();
  cmpPlanLoadTops();   // anything added meanwhile
}

// My Stockpile, once, if this session hasn't synced it yet
async function cmpPlanEnsureStock() {
  if (cmpPlan.stkTried || typeof stkState === 'undefined' || stkState.items.length || typeof syncStockpile !== 'function') return;
  cmpPlan.stkTried = true;
  try { await syncStockpile(); } catch (_) { /* have just reads 0 */ }
  cmpPlanRender();
}

function cmpPlanResHtml(T) {
  const rows = cmpPlanResRollup();
  const short = rows.filter((n) => n.short > 0);
  $('#cmp-plan-sum').textContent = rows.length
    ? (short.length ? `${short.length} of ${rows.length} short` : `all ${rows.length} covered`) : '';
  if (!rows.length) {
    return T.length && T.every((t) => cmpPlan.cache.has(String(t.sid))) ? '<div class="settings-hint">These schematics take no resources.</div>' : '';
  }
  return rows.map((n) => {
    const from = n.from.slice(0, 3).map((f) => `${f.name} ${fmtShort(f.n)}`).join(' · ') + (n.from.length > 3 ? ` +${n.from.length - 3}` : '');
    let spawns = '';
    if (n.short) {
      const tops = [...n.sids].every((sid) => cmpPlan.tops.has(sid));
      const list = tops ? cmpPlanSpawns(n) : [];
      spawns = !tops ? '<div class="cmp-plan-for"><span class="spinner"></span> Finding the best spawns…</div>'
        : list.length ? `<div class="cmp-plan-spawns"><span class="cmp-plan-spawnlbl">Best now</span>${list.map((b) => `<span class="cmp-plan-spawn">
            <span class="res-name" data-resname="${escapeHtml(b.name)}" title="${escapeHtml(b.type)} — open the resource">${escapeHtml(b.name)}</span>
            ${b.res ? `<span class="stat ${qualityClass(safeInt(b.score))}" title="Score — rank #${b.rank} in Top Spawns for this slot">${b.score == null || b.score === '' ? '—' : safeInt(b.score)}</span>${planetsHtml(b.res)}`
              : `<span class="stat ${qualityClass(Math.round(b.q / 10))}" title="Weighted quality for this schematic">${Math.round(b.q / 10)}%</span>`}
          </span>`).join('')}</div>`
          : '<div class="cmp-plan-for">No spawn of this class is in right now.</div>';
    }
    return `<div class="cmp-plan-part ${n.short ? 'is-short' : 'is-ok'}">
      <div class="cmp-plan-pmain">
        <div class="cmp-plan-pname">${escapeHtml(n.label)}${n.roles.size ? ` <span class="cmp-planet">${escapeHtml([...n.roles].join(', '))}</span>` : ''}</div>
        <div class="cmp-plan-for">for ${escapeHtml([...n.for].join(', '))}</div>
        ${from ? `<div class="cmp-plan-for" title="The My Stockpile stacks counted toward it"><i class="fa-solid fa-box-archive"></i> ${escapeHtml(from)}</div>` : ''}
        ${spawns}
      </div>
      <div class="cmp-plan-nums">
        <span title="Units needed across the plan">need <b>${fmtNum(n.need)}</b></span>
        <span title="Held in My Stockpile — this class or any under it">have <b>${fmtNum(n.have)}</b></span>
        <span class="cmp-plan-short">${n.short ? `short <b>${fmtNum(n.short)}</b>` : '<i class="fa-solid fa-check"></i> covered'}</span>
      </div>
    </div>`;
  }).join('');
}

async function openCmpPlan(preset = null) {
  try { if (!cmpState.loaded) await cmpFetch(); } catch (_) {}
  $('#cmp-plan-search').value = '';
  $('#cmp-plan-sug').hidden = true;
  $('#cmp-plan-modal').hidden = false;
  $('#cmp-plan-parts').innerHTML = '<div class="settings-hint"><span class="spinner"></span> Loading your plans…</div>';
  const res = await apiFetch('GET', 'api/components.php', { params: { plans: 1 } });
  cmpPlan.plans = (res.ok && res.data && res.data.plans) || [];
  if (!res.ok && !preset) {
    $('#cmp-plan-parts').innerHTML = `<div class="settings-hint">${escapeHtml(res.error || 'Couldn’t load your plans')}</div>`;
  }
  // keep the plan you had open; else the newest
  const cur = cmpPlan.plans.find((p) => safeInt(p.id) === cmpPlan.id) || (cmpPlan.id ? null : cmpPlan.plans[0]);
  if (cur && !cmpPlan.dirty) cmpPlanUse(cur, false);
  else if (!cur && !cmpPlan.dirty) cmpPlanUse(null, false);
  if (preset && preset.sid) await cmpPlanAdd(preset.sid, preset.name, preset.qty);
  else await cmpPlanRefresh();
  cmpPlanFillSel();
}

function cmpPlanUse(p, refresh = true) {
  cmpPlan.id = p ? safeInt(p.id) : 0;
  cmpPlan.name = p ? p.name : '';
  cmpPlan.targets = p ? (p.targets || []).map((t) => ({ ...t })) : [];
  cmpPlan.dirty = false;
  $('#cmp-plan-name').value = cmpPlan.name;
  $('#cmp-plan-del').hidden = !cmpPlan.id;
  cmpPlanFillSel();
  if (refresh) cmpPlanRefresh();
}

function cmpPlanFillSel() {
  $('#cmp-plan-sel').innerHTML = '<option value="0">New plan</option>'
    + cmpPlan.plans.map((p) => `<option value="${safeInt(p.id)}"${safeInt(p.id) === cmpPlan.id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  if (!cmpPlan.id) $('#cmp-plan-sel').value = '0';
}

async function cmpPlanRefresh() {
  cmpPlanRender();
  const missing = cmpPlan.targets.filter((t) => !cmpPlan.cache.has(String(t.sid)));
  if (!missing.length) return;
  await Promise.all(missing.map((t) => cmpPlanSchematic(t.sid)));
  cmpPlanRender();
}

async function cmpPlanAdd(sid, name, qty = 1, forPart = '') {
  sid = String(sid);
  const have = cmpPlan.targets.find((t) => String(t.sid) === sid);
  if (have) have.qty = safeInt(have.qty) + Math.max(1, safeInt(qty));
  else {
    if (cmpPlan.targets.length >= CMP_PLAN_MAX) { toast(`A plan holds up to ${CMP_PLAN_MAX} schematics`, false); return; }
    cmpPlan.targets.push({ sid, name: name || 'Schematic', qty: Math.max(1, safeInt(qty)), ...(forPart ? { for: forPart } : {}) });
  }
  cmpPlan.dirty = true;
  await cmpPlanRefresh();
}

function cmpPlanRender() {
  const T = cmpPlan.targets;
  $('#cmp-plan-targets').innerHTML = T.length ? T.map((t, i) => {
    const e = cmpPlan.cache.get(String(t.sid));
    return `<div class="cmp-plan-target">
      <a role="button" class="cmp-plan-tname" data-pschem="${escapeHtml(String(t.sid))}" data-name="${escapeHtml((e && e.name) || t.name)}" title="Open the schematic">${escapeHtml((e && e.name) || t.name)}</a>
      ${t.for ? `<span class="cmp-planet" title="Added to make this part">for ${escapeHtml(t.for)}</span>` : ''}
      ${e && e.error ? `<span class="cmp-planet cmp-plan-err">couldn’t load</span>` : !e ? '<span class="spinner"></span>' : ''}
      ${e && e.crate > 1 ? `<span class="cmp-plan-crates" title="Factory crates of ${e.crate} — sets how many to make"><input type="number" class="form-control filter-input" min="0" value="${safeInt(t.qty) % e.crate ? '' : safeInt(t.qty) / e.crate}" placeholder="–" data-pcrates="${i}"> crates × ${e.crate}</span>` : ''}
      <input type="number" class="form-control filter-input cmp-plan-qty" min="1" value="${safeInt(t.qty)}" data-pqty="${i}" title="How many to craft">
      <button class="btn btn-icon" data-pcraft="${i}" title="Log this craft — draw down the parts it used"><i class="fa-solid fa-hammer"></i></button>
      <button class="btn btn-icon" data-pdel="${i}" title="Take it out of the plan"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
  }).join('') : '<div class="settings-hint">Add the schematics you want to craft — the parts and resources they need roll up below.</div>';

  document.querySelectorAll('#cmp-plan-view [data-pview]').forEach((b) => b.classList.toggle('active', b.dataset.pview === cmpPlan.view));
  $('#cmp-plan-copy').disabled = !cmpPlanRollup().some((n) => n.short > 0) && !cmpPlanResRollup().some((n) => n.short > 0);
  if (cmpPlan.view === 'res') {
    $('#cmp-plan-parts').innerHTML = cmpPlanResHtml(T);
    cmpPlanHint();
    cmpPlanEnsureStock();
    cmpPlanLoadTops();
    return;
  }
  const parts = cmpPlanRollup();
  const short = parts.filter((n) => n.short > 0);
  $('#cmp-plan-sum').textContent = parts.length
    ? (short.length ? `${short.length} of ${parts.length} short` : `all ${parts.length} covered`) : '';
  $('#cmp-plan-parts').innerHTML = parts.length ? parts.map((n) => {
    const makers = n.makers;
    const make = !n.short || !makers.length ? ''
      : makers.length === 1
        ? `<button class="btn btn-sm btn-outline-secondary" data-pmake="${escapeHtml(n.key)}" title="Add ${escapeHtml(makers[0].name)} to the plan — enough to cover the shortfall">Make it</button>`
        : `<select class="form-select filter-select cmp-plan-makesel" data-pmakesel="${escapeHtml(n.key)}" title="Add one of these to the plan to make the part">
            <option value="">Make it…</option>${makers.map((m) => `<option value="${escapeHtml(m.id)}">${escapeHtml(m.name)}</option>`).join('')}</select>`;
    return `<div class="cmp-plan-part ${n.short ? 'is-short' : 'is-ok'}">
      <div class="cmp-plan-pmain">
        <div class="cmp-plan-pname">${escapeHtml(n.label)}${n.role && n.role !== n.label ? ` <span class="cmp-planet">${escapeHtml(n.role)}</span>` : ''}</div>
        <div class="cmp-plan-for">for ${escapeHtml([...n.for].join(', '))}</div>
        ${powerTools() && n.have ? `<div class="cmp-plan-for cmp-where" title="Where yours are (Advanced tools)"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(cmpWhere(cmpTakenRows(n)))}</div>` : ''}
      </div>
      <div class="cmp-plan-nums">
        <span title="Needed across the plan">need <b>${fmtNum(n.need)}</b></span>
        <span title="Held in My Components">have <b>${fmtNum(n.have)}</b></span>
        ${n.making ? `<span title="Made by sub-crafts in this plan">making <b>${fmtNum(n.making)}</b></span>` : ''}
        <span class="cmp-plan-short">${n.short ? `short <b>${fmtNum(n.short)}</b>` : '<i class="fa-solid fa-check"></i> covered'}</span>
      </div>
      <div class="cmp-plan-acts">
        ${make}
        <button class="btn btn-icon" data-plink="${escapeHtml(n.key)}" title="Pick which of your items fills this slot"><i class="fa-solid fa-link"></i></button>
      </div>
    </div>`;
  }).join('')
    : (T.length ? (T.every((t) => cmpPlan.cache.has(String(t.sid))) ? '<div class="settings-hint">These schematics take no required components.</div>' : '')
      : '');
  cmpPlanHint();
}

function cmpPlanHint() {
  $('#cmp-plan-save').disabled = !$('#cmp-plan-name').value.trim() || !cmpPlan.targets.length;
}

async function cmpPlanSearch() {
  const q = $('#cmp-plan-search').value.trim();
  const box = $('#cmp-plan-sug');
  if (q.length < 2) { box.hidden = true; return; }
  let res;
  try { res = await api().search_schematics({ search: q, page: 1 }); } catch (_) { res = null; }
  if ($('#cmp-plan-search').value.trim() !== q) return;
  const rows = ((res && res.ok && res.data && res.data.results) || []).slice(0, 10);
  box.innerHTML = rows.length ? rows.map((s) => `<div class="inv-vendor-opt" data-ppick="${escapeHtml(String(s.id))}" data-name="${escapeHtml(s.name)}">${escapeHtml(s.name)}${s.parent ? ` <span class="cmp-planet">${escapeHtml(s.parent)}</span>` : ''}</div>`).join('')
    : '<div class="inv-vendor-opt stat_off">No schematics match</div>';
  box.hidden = false;
}

async function saveCmpPlan() {
  const name = $('#cmp-plan-name').value.trim();
  if (!name || !cmpPlan.targets.length) return;
  const btn = $('#cmp-plan-save');
  btn.disabled = true;
  const targets = cmpPlan.targets.map((t) => ({ sid: String(t.sid), name: (cmpPlan.cache.get(String(t.sid)) || {}).name || t.name, qty: safeInt(t.qty), ...(t.for ? { for: t.for } : {}) }));
  const res = await apiFetch('POST', 'api/components.php', { data: { action: 'plan_save', id: cmpPlan.id || undefined, name, targets } });
  btn.disabled = false;
  if (!res.ok) { toast(`Couldn’t save the plan: ${res.error || 'server error'}`, false); checkAuthError(res.error); return; }
  cmpPlan.id = safeInt(res.data.id);
  cmpPlan.name = name;
  cmpPlan.dirty = false;
  const row = { id: cmpPlan.id, name, targets, updated_at: Math.floor(Date.now() / 1000) };
  cmpPlan.plans = [row, ...cmpPlan.plans.filter((p) => safeInt(p.id) !== cmpPlan.id)];
  cmpPlanFillSel();
  $('#cmp-plan-del').hidden = false;
  toast(`Saved “${name}”`);
}

async function removeCmpPlan() {
  if (!cmpPlan.id) return;
  const name = cmpPlan.name;
  const ok = await confirmDialog({ title: 'Delete this plan?', message: `“${name}” goes for good — your components aren’t touched.`, confirmLabel: 'Delete plan' });
  if (!ok) return;
  const res = await apiFetch('POST', 'api/components.php', { data: { action: 'plan_remove', id: cmpPlan.id } });
  if (!res.ok) { toast(res.error || 'Delete failed', false); return; }
  cmpPlan.plans = cmpPlan.plans.filter((p) => safeInt(p.id) !== cmpPlan.id);
  cmpPlanUse(cmpPlan.plans[0] || null);
  toast(`Deleted “${name}”`);
}

function cmpPlanShopping() {
  const short = cmpPlanRollup().filter((n) => n.short > 0);
  const res = cmpPlanResRollup().filter((n) => n.short > 0);
  if (!short.length && !res.length) return;
  const title = $('#cmp-plan-name').value.trim() || 'Craft plan';
  // resources carry the best spawn going, when Top Spawns has been asked
  const resLines = res.map((n) => {
    const best = [...n.sids].every((sid) => cmpPlan.tops.has(sid)) ? cmpPlanSpawns(n)[0] : null;
    return `${fmtNum(n.short)} × ${n.label}${best ? ` (best now: ${best.name})` : ''}`;
  });
  const text = [short.length ? `${title} — still need:\n${short.map((n) => `${fmtNum(n.short)} × ${n.label}`).join('\n')}` : '',
    res.length ? `${short.length ? 'Resources' : `${title} — resources still needed`}:\n${resLines.join('\n')}` : ''].filter(Boolean).join('\n\n');
  const bits = [short.length ? `${short.length} part${short.length === 1 ? '' : 's'}` : '', res.length ? `${res.length} resource${res.length === 1 ? '' : 's'}` : ''].filter(Boolean);
  copyTextToClipboard(text, `Copied ${bits.join(' and ')}`);
}

function initCmpPlan() {
  const close = () => { $('#cmp-plan-modal').hidden = true; };
  $('#cmp-plan-open').addEventListener('click', () => openCmpPlan());
  $('#cmp-plan-cancel').addEventListener('click', close);
  bindBackdropClose($('#cmp-plan-modal'), close);
  $('#cmp-plan-save').addEventListener('click', saveCmpPlan);
  $('#cmp-plan-del').addEventListener('click', removeCmpPlan);
  $('#cmp-plan-copy').addEventListener('click', cmpPlanShopping);
  $('#cmp-plan-view').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pview]');
    if (!b || b.dataset.pview === cmpPlan.view) return;
    cmpPlan.view = b.dataset.pview;
    try { localStorage.setItem('cmp_plan_view', cmpPlan.view); } catch (_) {}
    cmpPlanRender();
  });
  $('#cmp-plan-name').addEventListener('input', () => { cmpPlan.dirty = true; cmpPlanHint(); });
  $('#cmp-plan-sel').addEventListener('change', () => {
    const id = safeInt($('#cmp-plan-sel').value);
    cmpPlanUse(cmpPlan.plans.find((p) => safeInt(p.id) === id) || null);
    if (!id) $('#cmp-plan-name').focus();
  });
  $('#cmp-plan-search').addEventListener('input', () => {
    clearTimeout(cmpPlan.searchTimer);
    cmpPlan.searchTimer = setTimeout(cmpPlanSearch, 250);
  });
  $('#cmp-plan-search').addEventListener('blur', () => setTimeout(() => { $('#cmp-plan-sug').hidden = true; }, 150));
  $('#cmp-plan-sug').addEventListener('mousedown', (e) => {
    const opt = e.target.closest('[data-ppick]');
    if (!opt) return;
    e.preventDefault();
    $('#cmp-plan-sug').hidden = true;
    $('#cmp-plan-search').value = '';
    cmpPlanAdd(opt.dataset.ppick, opt.dataset.name, 1);
  });
  $('#cmp-plan-targets').addEventListener('input', (e) => {
    const inp = e.target.closest('[data-pqty], [data-pcrates]');
    if (!inp) return;
    const crates = inp.dataset.pcrates != null;
    const t = cmpPlan.targets[safeInt(crates ? inp.dataset.pcrates : inp.dataset.pqty)];
    if (!t) return;
    // crates × the schematic's crate size = how many to make
    if (crates) {
      const ent = cmpPlan.cache.get(String(t.sid));
      if (!safeInt(inp.value) || !ent || !ent.crate) return;
      t.qty = safeInt(inp.value) * ent.crate;
      const q = inp.closest('.cmp-plan-target').querySelector('[data-pqty]');
      if (q) q.value = t.qty;
    } else t.qty = Math.max(1, safeInt(inp.value));
    cmpPlan.dirty = true;
    clearTimeout(cmpPlan.qtyTimer);
    cmpPlan.qtyTimer = setTimeout(() => {
      const ds = document.activeElement && document.activeElement.dataset;
      const focus = ds && ds.pqty != null ? `[data-pqty="${ds.pqty}"]` : ds && ds.pcrates != null ? `[data-pcrates="${ds.pcrates}"]` : null;
      cmpPlanRender();
      if (focus) { const el = document.querySelector(focus); if (el) { el.focus(); el.select(); } }
    }, 350);
  });
  $('#cmp-plan-targets').addEventListener('click', (e) => {
    const del = e.target.closest('[data-pdel]');
    if (del) { cmpPlan.targets.splice(safeInt(del.dataset.pdel), 1); cmpPlan.dirty = true; cmpPlanRender(); return; }
    const craft = e.target.closest('[data-pcraft]');
    if (craft) {
      const t = cmpPlan.targets[safeInt(craft.dataset.pcraft)];
      const ent = t && cmpPlan.cache.get(String(t.sid));
      if (t) openCmpCraft({ id: t.sid, name: (ent && ent.name) || t.name, comps: ent && !ent.error ? ent.comps : null, qty: t.qty });
      return;
    }
    const a = e.target.closest('[data-pschem]');
    if (a) { $('#cmp-plan-modal').hidden = true; openSchematicPage(a.dataset.pschem, a.dataset.name); }
  });
  const byKey = (k) => cmpPlanRollup().find((n) => n.key === k);
  $('#cmp-plan-parts').addEventListener('click', (e) => {
    const rn = e.target.closest('[data-resname]');
    if (rn) { $('#cmp-plan-modal').hidden = true; openResourcePage(rn.dataset.resname); return; }
    const mk = e.target.closest('[data-pmake]');
    if (mk) { const n = byKey(mk.dataset.pmake); if (n) cmpPlanAdd(n.makers[0].id, n.makers[0].name, n.short, n.label); return; }
    const ln = e.target.closest('[data-plink]');
    if (ln) { const n = byKey(ln.dataset.plink); if (n) openCmpLink(n.c, () => cmpPlanRender()); }
  });
  $('#cmp-plan-parts').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-pmakesel]');
    if (!sel || !sel.value) return;
    const n = byKey(sel.dataset.pmakesel);
    const m = n && n.makers.find((x) => x.id === sel.value);
    if (m) cmpPlanAdd(m.id, m.name, n.short, n.label);
  });
  // schematic page: plan these crafts
  $('#scd-cmp-plan').addEventListener('click', () => {
    const s = scdState.schematic;
    if (s) openCmpPlan({ sid: scdState.id, name: s.schematicName, qty: scdCmp.n });
  });
}
