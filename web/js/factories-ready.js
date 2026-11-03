/* Factories — readiness (Advanced tools, powerTools()): do you hold the parts a run needs?
   With the switch off nothing here shows and Start works exactly as before.

   A factory run makes N of a schematic, so it needs N × each required slot. The run's
   schematic comes from, in order:
     1. factory.schematic_id — set by Manufacture (My Schematics), a pick in the dialog,
        or "Load into" from a plan (api/factories.php save takes it)
     2. one of your My Schematics with the product's exact name
     3. the one schematic in the catalogue with the product's exact name
   anything else (no match, or several with that name) asks you to pick it.

   Each idle card gets a "Parts ready / Short on N parts" line; Start opens the readiness
   dialog — need vs have per slot (allocated, each stack once), which batches it would use in
   the draw order — and "Draw parts & start" logs the parts as a craft linked to the factory
   (api/components.php craft with factory_id), with Undo. A running card shows the draw with
   Put back. "Ready to run?" in the page header checks a saved craft plan's targets one by one
   and loads one into an idle factory. The slot matching, allocation, schematic cache and
   craft/uncraft are the My Components ones (components.js, components-plan.js). */

const facReady = { matches: new Map(), cmpAt: 0, f: null, sid: '', name: '', res: null, searchTimer: null };

// components data no older than a minute (a draw elsewhere moves the numbers)
async function facReadyCmp() {
  if (cmpState.loaded && Date.now() - facReady.cmpAt < 60000) return true;
  try { await cmpFetch(); } catch (_) { return cmpState.loaded; }
  facReady.cmpAt = Date.now();
  return cmpState.loaded;
}

// the schematic a factory's run makes → { id, how } | { many: [{ id, name }] } | null
async function facReadyMatch(f) {
  if (safeInt(f.schematic_id)) return { id: String(f.schematic_id), how: 'picked' };
  const product = String(f.product || '').trim(), k = product.toLowerCase();
  if (!product) return null;
  if (facReady.matches.has(k)) return facReady.matches.get(k);
  let m = null;
  const mine = (typeof mysState !== 'undefined' ? mysState.items : []).filter((i) => String(i.name || '').toLowerCase() === k && safeInt(i.schematic_id));
  if (mine.length) m = { id: String(mine[0].schematic_id), how: 'mine' };
  else {
    let res = null;
    try { res = await api().search_schematics({ search: product, page: 1 }); } catch (_) { /* offline */ }
    if (!res || !res.ok) return null;   // not cached — try again next time
    const exact = ((res.data && res.data.results) || []).filter((s) => String(s.name || '').toLowerCase() === k);
    m = exact.length === 1 ? { id: String(exact[0].id), how: 'name' }
      : exact.length ? { many: exact.slice(0, 10).map((s) => ({ id: String(s.id), name: s.name, parent: s.parent || '' })) } : null;
  }
  facReady.matches.set(k, m);
  return m;
}

// need vs have for qty runs of a schematic: each required slot filled in the draw order out of
// one shared pool, so a stack two slots could use counts once
async function facReadyCheck(sid, qty, order = cmpDrawOrder()) {
  const e = await cmpPlanSchematic(sid);
  if (e.error) return { error: e.error };
  const left = cmpLeft();
  const slots = e.comps.filter((c) => c.optional !== 'yes')
    .map((c) => cmpGive({ c, rows: cmpSlotRows(c), need: safeInt(c.number) * qty }, safeInt(c.number) * qty, left, order));
  const short = slots.filter((a) => a.have < a.need);
  return { name: e.name, slots, short: short.length, ready: !short.length };
}
const facReadyPart = (a) => {
  const part = a.c.type === 'schematic' ? cmpSlotNames.get(String(a.c.id)) : '';
  return cmpLink(a.c.id) || part || cmpSlotLabel(a.c);
};

// ---- the line on each card -----------------------------------------------------

function facReadyCardHtml(f) {
  if (!powerTools()) return '';
  if (!f.started_at) return String(f.product || '').trim() && safeInt(f.quantity) > 0
    ? `<div class="fac-ready" data-facready="${f.id}"><span class="spinner"></span> Checking parts…</div>` : '';
  const d = facReadyDraw(f);
  return d ? `<div class="fac-ready is-drawn"><i class="fa-solid fa-boxes-stacked"></i>
      <span>Parts drawn for this run — ${fmtNum(safeInt(d.quantity))} × ${escapeHtml(d.title)}</span>
      <button class="btn btn-sm btn-outline-secondary" data-facputback="${safeInt(d.log_id)}" title="Undo the draw — the parts go back where they came from">Put back</button></div>` : '';
}
// the draw logged for a factory's current run (made just before it started)
function facReadyDraw(f) {
  return (cmpState.factoryDraws || []).find((d) => safeInt(d.factory_id) === safeInt(f.id)
    && safeInt(d.created_at) >= safeInt(f.started_at) - 900) || null;
}

async function facReadyPaint() {
  if (!powerTools()) return;
  const els = [...document.querySelectorAll('#fac-list [data-facready]')];
  const drawnBefore = (cmpState.factoryDraws || []).length;
  if (!(await facReadyCmp())) { els.forEach((el) => { el.innerHTML = ''; }); return; }
  // the draws arrived with the components fetch — running cards render their line from them
  if (!drawnBefore && (cmpState.factoryDraws || []).length && facState.items.some((f) => f.started_at)) { renderFactories(); return; }
  for (const el of document.querySelectorAll('#fac-list [data-facready]')) {
    const f = facState.items.find((x) => String(x.id) === el.dataset.facready);
    if (!f) continue;
    const m = await facReadyMatch(f);
    if (!el.isConnected) continue;
    if (!m || m.many) {
      el.innerHTML = `<a role="button" data-facreadyopen="${f.id}"><i class="fa-solid fa-scroll"></i> ${m ? 'Several schematics are called this — pick one to check parts' : 'Pick its schematic to check parts'}</a>`;
      continue;
    }
    const r = await facReadyCheck(m.id, safeInt(f.quantity));
    if (!el.isConnected) continue;
    if (r.error) { el.innerHTML = ''; continue; }
    if (!r.slots.length) { el.innerHTML = ''; continue; }   // takes no components
    el.classList.toggle('is-ok', r.ready);
    el.classList.toggle('is-short', !r.ready);
    el.innerHTML = `<a role="button" data-facreadyopen="${f.id}" title="Need vs have for ${fmtNum(safeInt(f.quantity))} × ${escapeHtml(r.name)}">${r.ready
      ? `<i class="fa-solid fa-check"></i> Parts ready for ${fmtNum(safeInt(f.quantity))}`
      : `<i class="fa-solid fa-triangle-exclamation"></i> Short on ${r.short} part${r.short === 1 ? '' : 's'}`}</a>`;
  }
}

// ---- the readiness dialog --------------------------------------------------------

// Start, for a power user: true = the dialog took over (it starts the run itself)
async function facReadyGate(f) {
  if (!powerTools() || !(await facReadyCmp())) return false;
  const m = await facReadyMatch(f);
  if (!m || m.many) return false;   // nothing to check against — start as always
  const r = await facReadyCheck(m.id, safeInt(f.quantity));
  if (r.error || !r.slots.length) return false;
  openFacReady(f, m);
  return true;
}

async function openFacReady(f, m = undefined) {
  if (!(await facReadyCmp())) { toast('Couldn’t load your components', false); return; }
  if (m === undefined) m = await facReadyMatch(f);
  Object.assign(facReady, { f, sid: m && m.id ? m.id : '', name: '', res: null });
  $('#fac-ready-title').textContent = `${f.name} — ready to run?`;
  $('#fac-ready-order').value = cmpDrawOrder();
  $('#fac-ready-search').value = '';
  $('#fac-ready-sug').hidden = true;
  $('#fac-ready-modal').hidden = false;
  if (facReady.sid) await facReadyUse(facReady.sid);
  else facReadyPick(m && m.many ? m.many : null);
}

// no (single) match: search for it, or choose from the ones with that name
function facReadyPick(many = null) {
  facReady.sid = '';
  $('#fac-ready-schem').hidden = true;
  $('#fac-ready-pickwrap').hidden = false;
  $('#fac-ready-slots').innerHTML = many
    ? `<div class="settings-hint">Several schematics are called “${escapeHtml(facReady.f.product)}”:</div>${many.map((s) => `<div class="inv-vendor-opt" data-frpick="${escapeHtml(s.id)}">${escapeHtml(s.name)}${s.parent ? ` <span class="cmp-planet">${escapeHtml(s.parent)}</span>` : ''}</div>`).join('')}`
    : `<div class="settings-hint">Which schematic does ${escapeHtml(facReady.f.name)} run? It's remembered for this factory.</div>`;
  $('#fac-ready-search').value = String(facReady.f.product || '');
  facReadyButtons();
  $('#fac-ready-search').focus();
}

async function facReadyUse(sid) {
  facReady.sid = String(sid);
  $('#fac-ready-pickwrap').hidden = true;
  $('#fac-ready-slots').innerHTML = '<div class="settings-hint"><span class="spinner"></span> Loading the schematic…</div>';
  facReadyButtons();
  const r = await facReadyCheck(facReady.sid, safeInt(facReady.f.quantity), $('#fac-ready-order').value);
  if (facReady.sid !== String(sid)) return;
  facReady.res = r;
  facReady.name = r.name || '';
  const head = $('#fac-ready-schem');
  head.innerHTML = `<i class="fa-solid fa-scroll"></i> ${fmtNum(safeInt(facReady.f.quantity))} × ${escapeHtml(r.name || facReady.f.product || 'Schematic')}
    <a role="button" class="cmp-craft-change" data-frchange>change</a>`;
  head.hidden = false;
  facReadyRender();
}

function facReadyRender() {
  const r = facReady.res;
  if (!r) return;
  if (r.error) { $('#fac-ready-slots').innerHTML = `<div class="settings-hint">Couldn't load it: ${escapeHtml(r.error)}</div>`; facReadyButtons(); return; }
  $('#fac-ready-slots').innerHTML = r.slots.length ? r.slots.map((a, k) => {
    const short = a.need - a.have;
    const where = a.have ? cmpWhere(cmpTakenRows(a)) : '';
    return `<div class="cmp-plan-part ${short > 0 ? 'is-short' : 'is-ok'}">
      <div class="cmp-plan-pmain">
        <div class="cmp-plan-pname">${escapeHtml(facReadyPart(a))}${facReadyPart(a) !== cmpSlotLabel(a.c) ? ` <span class="cmp-planet">${escapeHtml(cmpSlotLabel(a.c))}</span>` : ''}</div>
        <div class="cmp-plan-for cmp-where" title="The batches this run would use, in the draw order">${where ? `<i class="fa-solid fa-location-dot"></i> ${escapeHtml(where)}` : 'None held'}</div>
      </div>
      <div class="cmp-plan-nums">
        <span title="${fmtNum(safeInt(a.c.number))} per unit × ${fmtNum(safeInt(facReady.f.quantity))}">need <b>${fmtNum(a.need)}</b></span>
        <span title="Held in My Components, each stack counted once">have <b>${fmtNum(a.have)}</b></span>
        <span class="cmp-plan-short">${short > 0 ? `short <b>${fmtNum(short)}</b>` : '<i class="fa-solid fa-check"></i> ready'}</span>
      </div>
      <div class="cmp-plan-acts">
        <button class="btn btn-icon" data-frlink="${k}" title="Pick which of your items fill this slot"><i class="fa-solid fa-link"></i></button>
      </div>
    </div>`;
  }).join('') : '<div class="settings-hint">This schematic takes no required components — nothing to draw.</div>';
  facReadyButtons();
}

function facReadyButtons() {
  const r = facReady.sid ? facReady.res : null;
  const parts = r && !r.error ? r.slots.reduce((t, a) => t + a.have, 0) : 0;
  $('#fac-ready-hint').textContent = !r || r.error ? ''
    : !r.slots.length ? ''
      : r.ready ? `All ${r.slots.length} part${r.slots.length === 1 ? '' : 's'} ready — drawing uses ${fmtNum(parts)}.`
        : `Short on ${r.short} of ${r.slots.length} — you can still start, or draw what you have.`;
  // Draw from only matters when the schematic takes components
  document.querySelector('.fac-ready-order').hidden = !(r && !r.error && r.slots.length);
  const idle = facReady.f && !facReady.f.started_at;
  // nothing to draw → one red Start run instead of a dead Draw button
  facReady.canDraw = parts > 0;
  $('#fac-ready-start').hidden = !idle || !parts;
  $('#fac-ready-draw').hidden = !idle;
  $('#fac-ready-draw').innerHTML = parts ? '<i class="fa-solid fa-play"></i> Draw parts &amp; start' : '<i class="fa-solid fa-play"></i> Start run';
  $('#fac-ready-draw').title = parts ? 'Take these parts out of My Components for the run, then start it' : 'Start the run';
  $('#fac-ready-cancel').textContent = idle ? 'Cancel' : 'Close';
}

// remember the pick on the factory (api/factories.php save → schematic_id)
async function facReadySaveSid() {
  const f = facReady.f;
  if (!f || String(f.schematic_id || '') === facReady.sid) return;
  f.schematic_id = facReady.sid;
  await facPost({ action: 'save', factory: f });
}

async function facReadyGo(draw) {
  const f = facReady.f, r = facReady.res;
  if (!f) return;
  const btns = [$('#fac-ready-start'), $('#fac-ready-draw')];
  btns.forEach((b) => { b.disabled = true; });
  try {
    await facReadySaveSid();
    let logId = 0;
    if (draw && r && !r.error) {
      const draws = [];
      r.slots.forEach((a) => (a.takes || new Map()).forEach((u, id) => { if (u > 0) draws.push({ id, units: u }); }));
      const res = await apiFetch('POST', 'api/components.php', { data: {
        action: 'craft', schematic_id: facReady.sid, schematic_name: `${facReady.name || f.product} (${f.name})`,
        quantity: safeInt(f.quantity), draws, factory_id: safeInt(f.id) } });
      if (!res.ok) { toast(`Couldn't draw the parts: ${res.error || 'server error'}`, false); checkAuthError(res.error); return; }
      logId = safeInt(res.data.log_id);
    }
    $('#fac-ready-modal').hidden = true;
    const started = await facStartRun(f);
    if (!started.ok) {
      if (logId) await cmpUncraft(logId);   // didn't start — the parts go back
      return;
    }
    if (logId) {
      toastAction(`${f.name} is running — parts drawn`, 'Undo draw', () => cmpUncraft(logId));
      cmpAfterChange();
    }
  } finally {
    btns.forEach((b) => { b.disabled = false; });
  }
}

async function facReadySearch() {
  const q = $('#fac-ready-search').value.trim();
  const box = $('#fac-ready-sug');
  if (q.length < 2) { box.hidden = true; return; }
  let res;
  try { res = await api().search_schematics({ search: q, page: 1 }); } catch (_) { res = null; }
  if ($('#fac-ready-search').value.trim() !== q) return;
  const rows = ((res && res.ok && res.data && res.data.results) || []).slice(0, 10);
  box.innerHTML = rows.length ? rows.map((s) => `<div class="inv-vendor-opt" data-frpick="${escapeHtml(String(s.id))}">${escapeHtml(s.name)}${s.parent ? ` <span class="cmp-planet">${escapeHtml(s.parent)}</span>` : ''}</div>`).join('')
    : '<div class="inv-vendor-opt stat_off">No schematics match</div>';
  box.hidden = false;
}

// ---- Ready to run? — a saved plan's targets, one at a time --------------------------

const facPlanView = { plans: [], id: 0 };

async function openFacPlan() {
  $('#fac-plan-modal').hidden = false;
  $('#fac-plan-list').innerHTML = '<div class="settings-hint"><span class="spinner"></span> Loading your plans…</div>';
  await facReadyCmp();
  const res = await apiFetch('GET', 'api/components.php', { params: { plans: 1 } });
  facPlanView.plans = (res.ok && res.data && res.data.plans) || [];
  if (!facPlanView.plans.some((p) => safeInt(p.id) === facPlanView.id)) facPlanView.id = safeInt((facPlanView.plans[0] || {}).id);
  $('#fac-plan-sel').hidden = !facPlanView.plans.length;
  $('#fac-plan-sel').innerHTML = facPlanView.plans.map((p) => `<option value="${safeInt(p.id)}"${safeInt(p.id) === facPlanView.id ? ' selected' : ''}>${escapeHtml(p.name)}</option>`).join('');
  facPlanRender();
}

async function facPlanRender() {
  const p = facPlanView.plans.find((x) => safeInt(x.id) === facPlanView.id);
  const box = $('#fac-plan-list');
  if (!p) {
    box.innerHTML = '<div class="settings-hint">No craft plans yet — make one in My Components → Plan crafts, then check here what you can run.</div>';
    return;
  }
  const targets = (p.targets || []).filter((t) => safeInt(t.sid) && safeInt(t.qty) > 0);
  if (!targets.length) { box.innerHTML = '<div class="settings-hint">This plan has nothing in it yet.</div>'; return; }
  box.innerHTML = '<div class="settings-hint"><span class="spinner"></span> Checking parts…</div>';
  const idle = facState.items.filter((f) => !f.started_at);
  const rows = [];
  for (const t of targets) {
    const r = await facReadyCheck(String(t.sid), safeInt(t.qty));   // each target on its own against your stock
    rows.push({ t, r });
  }
  if (facPlanView.id !== safeInt(p.id) || $('#fac-plan-modal').hidden) return;
  box.innerHTML = rows.map(({ t, r }, k) => {
    const name = r.name || t.name;
    const shortBy = r.error ? [] : r.slots.filter((a) => a.have < a.need);
    const status = r.error ? '<span class="cmp-planet cmp-plan-err">couldn’t load</span>'
      : !r.slots.length ? '<span class="fac-plan-st is-ok">no parts needed</span>'
        : r.ready ? '<span class="fac-plan-st is-ok"><i class="fa-solid fa-check"></i> ready</span>'
          : `<span class="fac-plan-st is-short">short on ${r.short} part${r.short === 1 ? '' : 's'}</span>`;
    return `<div class="fac-plan-row ${r.ready ? 'is-ok' : 'is-short'}">
      <div class="cmp-plan-pmain">
        <div class="cmp-plan-pname">${fmtNum(safeInt(t.qty))} × ${escapeHtml(name)} ${status}</div>
        ${shortBy.length ? `<div class="cmp-plan-for">${escapeHtml(shortBy.map((a) => `${fmtNum(a.need - a.have)} ${facReadyPart(a)}`).join(' · '))}</div>` : ''}
      </div>
      <div class="cmp-plan-acts">
        ${idle.length ? `<select class="form-select filter-select fac-plan-load" data-fpload="${k}" title="Set an idle factory up to make this">
          <option value="">Load into…</option>${idle.map((f) => `<option value="${f.id}">${escapeHtml(f.name)}</option>`).join('')}</select>`
          : '<span class="cmp-planet" title="Every factory is mid-run">no idle factory</span>'}
      </div>
    </div>`;
  }).join('');
  facPlanView.rows = rows;
}

async function facPlanLoad(k, fid) {
  const row = (facPlanView.rows || [])[k];
  const f = facState.items.find((x) => String(x.id) === String(fid));
  if (!row || !f || f.started_at) return;
  Object.assign(f, { product: row.r.name || row.t.name, quantity: safeInt(row.t.qty), schematic_id: String(row.t.sid) });
  const res = await facPost({ action: 'save', factory: f });
  if (!res.ok) return;
  toast(`${f.name} is set up for ${fmtNum(safeInt(row.t.qty))} × ${f.product} — set the time per unit, then Start`);
  $('#fac-plan-modal').hidden = true;
  facState.flashId = String(f.id);
  renderFactories();
}

function initFacReady() {
  $('#fac-ready-open').addEventListener('click', openFacPlan);
  $('#fac-plan-done').addEventListener('click', () => { $('#fac-plan-modal').hidden = true; });
  bindBackdropClose($('#fac-plan-modal'), () => { $('#fac-plan-modal').hidden = true; });
  $('#fac-plan-sel').addEventListener('change', (e) => { facPlanView.id = safeInt(e.target.value); facPlanRender(); });
  $('#fac-plan-list').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-fpload]');
    if (sel && sel.value) facPlanLoad(safeInt(sel.dataset.fpload), sel.value);
  });

  const close = () => { $('#fac-ready-modal').hidden = true; };
  $('#fac-ready-cancel').addEventListener('click', close);
  bindBackdropClose($('#fac-ready-modal'), close);
  $('#fac-ready-start').addEventListener('click', () => facReadyGo(false));
  $('#fac-ready-draw').addEventListener('click', () => facReadyGo(!!facReady.canDraw));
  $('#fac-ready-order').addEventListener('change', async (e) => {
    await cmpSetDrawOrder(e.target.value);
    if (facReady.sid) facReadyUse(facReady.sid);
  });
  $('#fac-ready-search').addEventListener('input', () => {
    clearTimeout(facReady.searchTimer);
    facReady.searchTimer = setTimeout(facReadySearch, 250);
  });
  $('#fac-ready-search').addEventListener('blur', () => setTimeout(() => { $('#fac-ready-sug').hidden = true; }, 150));
  $('#fac-ready-modal').addEventListener('mousedown', (e) => {
    const opt = e.target.closest('[data-frpick]');
    if (!opt) return;
    e.preventDefault();
    $('#fac-ready-sug').hidden = true;
    facReadyUse(opt.dataset.frpick).then(() => facReadySaveSid()).then(() => facReadyPaint());
  });
  $('#fac-ready-modal').addEventListener('click', (e) => {
    if (e.target.closest('[data-frchange]')) { facReadyPick(); return; }
    const l = e.target.closest('[data-frlink]');
    const a = l && facReady.res && facReady.res.slots[safeInt(l.dataset.frlink)];
    if (a) openCmpLink(a.c, () => facReadyUse(facReady.sid));
  });

  // the card lines
  $('#fac-list').addEventListener('click', async (e) => {
    const o = e.target.closest('[data-facreadyopen]');
    if (o) {
      const f = facState.items.find((x) => String(x.id) === o.dataset.facreadyopen);
      if (f) openFacReady(f);
      return;
    }
    const pb = e.target.closest('[data-facputback]');
    if (pb) {
      if (!confirmArmLabeled(pb, 'Put back?')) return;
      pb.disabled = true;
      if (await cmpUncraft(safeInt(pb.dataset.facputback))) {
        cmpState.factoryDraws = (cmpState.factoryDraws || []).filter((d) => safeInt(d.log_id) !== safeInt(pb.dataset.facputback));
        renderFactories();
      } else pb.disabled = false;
    }
  });
}
