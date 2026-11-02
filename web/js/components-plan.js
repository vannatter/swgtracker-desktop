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

const cmpPlan = { plans: [], id: 0, name: '', targets: [], cache: new Map(), searchTimer: null, dirty: false };
const CMP_PLAN_MAX = 40;

async function cmpPlanSchematic(sid) {
  const key = String(sid);
  if (cmpPlan.cache.has(key)) return cmpPlan.cache.get(key);
  let res;
  try { res = await api().get_schematic(sid); } catch (e) { res = { ok: false, error: String(e) }; }
  const s = res.ok && res.data ? (res.data.schematic || res.data) : null;
  const entry = s ? { name: s.schematicName || '', comps: (s.componentTypes || []).filter((c) => safeInt(c.number) > 0) }
    : { name: '', comps: [], error: res.error || 'server error' };
  if (s) { try { await cmpEnsureSlotNames(entry.comps); } catch (_) {} }
  cmpPlan.cache.set(key, entry);
  return entry;
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
      const pick = cmpLink(c.id);
      const key = pick ? `L:${pick.toLowerCase()}` : `${c.type === 'schematic' ? 'S' : 'C'}:${c.id}`;
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
  const left = new Map(cmpState.rows.map((r) => [safeInt(r.id), safeInt(r.units)]));
  const out = [...needs.values()].sort((a, b) => a.label.localeCompare(b.label));
  out.forEach((n) => {
    let want = n.need;
    n.have = 0;
    n.rows.forEach((r) => {
      const id = safeInt(r.id), take = Math.min(want, left.get(id) || 0);
      left.set(id, (left.get(id) || 0) - take);
      n.have += take; want -= take;
    });
    n.making = cmpPlan.targets.filter((t) => n.makers.some((m) => m.id === String(t.sid))).reduce((s, t) => s + safeInt(t.qty), 0);
    n.short = Math.max(0, n.need - n.have - n.making);
  });
  return out.sort((a, b) => (b.short > 0) - (a.short > 0) || a.label.localeCompare(b.label));
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
      <input type="number" class="form-control filter-input cmp-plan-qty" min="1" value="${safeInt(t.qty)}" data-pqty="${i}" title="How many to craft">
      <button class="btn btn-icon" data-pcraft="${i}" title="Log this craft — draw down the parts it used"><i class="fa-solid fa-hammer"></i></button>
      <button class="btn btn-icon" data-pdel="${i}" title="Take it out of the plan"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
  }).join('') : '<div class="settings-hint">Add the schematics you want to craft — the parts they need roll up below.</div>';

  const parts = cmpPlanRollup();
  const short = parts.filter((n) => n.short > 0);
  $('#cmp-plan-sum').textContent = parts.length
    ? (short.length ? `${short.length} of ${parts.length} short` : `all ${parts.length} covered`) : '';
  $('#cmp-plan-copy').disabled = !short.length;
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
  if (!short.length) return;
  const title = $('#cmp-plan-name').value.trim() || 'Craft plan';
  copyTextToClipboard(`${title} — still need:\n${short.map((n) => `${fmtNum(n.short)} × ${n.label}`).join('\n')}`,
    `Copied ${short.length} part${short.length === 1 ? '' : 's'}`);
}

function initCmpPlan() {
  const close = () => { $('#cmp-plan-modal').hidden = true; };
  $('#cmp-plan-open').addEventListener('click', () => openCmpPlan());
  $('#cmp-plan-cancel').addEventListener('click', close);
  bindBackdropClose($('#cmp-plan-modal'), close);
  $('#cmp-plan-save').addEventListener('click', saveCmpPlan);
  $('#cmp-plan-del').addEventListener('click', removeCmpPlan);
  $('#cmp-plan-copy').addEventListener('click', cmpPlanShopping);
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
    const inp = e.target.closest('[data-pqty]');
    if (!inp) return;
    const t = cmpPlan.targets[safeInt(inp.dataset.pqty)];
    if (!t) return;
    t.qty = Math.max(1, safeInt(inp.value));
    cmpPlan.dirty = true;
    clearTimeout(cmpPlan.qtyTimer);
    cmpPlan.qtyTimer = setTimeout(() => {
      const focus = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.pqty : null;
      cmpPlanRender();
      if (focus != null) { const el = document.querySelector(`[data-pqty="${focus}"]`); if (el) { el.focus(); el.select(); } }
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
