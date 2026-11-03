/* My Components — Advanced tools (Settings → Advanced tools, powerTools()).
   Power-user depth on top of the normal page, which stays exactly as it is
   with the switch off:
     - production runs: log a run (what, how many, quality, by hand or which
       factory, where it went) → its own batch stack with a run number; batches
       from different runs never merge, so you can tell them apart
     - history: every change to a stack (made, moved, used, adjusted …), kept by
       api/components.php for everyone so it's there the day you turn this on
     - box check: what should be in a location → count → correct what's off
     - where it is: "1,000 — 800 in Box X (run #12, q92) · 200 in Hopper" on the
       schematic page tags, the planner and Log a craft
     - slot links that take several items or a words-in-order pattern, the draw order
       Log a craft fills from (components.js), and Factories readiness (factories-ready.js) */

const cmpRun = (id) => (cmpState.runs || []).find((r) => safeInt(r.id) === safeInt(id)) || null;

// "run #12, q92" for a stack from a logged run ('' otherwise)
function cmpRunLabel(r) {
  const run = r && r.run_id ? cmpRun(r.run_id) : null;
  if (!run) return '';
  const q = run.quality != null && run.quality !== '' ? `, q${run.quality}` : '';
  return `run #${safeInt(run.run_no)}${q}`;
}

// where a set of stacks sits: "800 in Box X (run #12, q92) · 200 in Hopper: Pelgo 1" — with the
// item named when several fill it: "2,000 — 1,000 XX1 in Box X · 1,000 XX2 in Hopper"
function cmpWhere(rows) {
  const parts = new Map();
  rows = rows.filter((r) => safeInt(r.units) > 0);
  const several = new Set(rows.map((r) => String(r.item_name).toLowerCase())).size > 1;
  rows.forEach((r) => {
    const label = cmpRunLabel(r);
    const k = `${several ? String(r.item_name).toLowerCase() : ''}|${safeInt(r.location_id)}|${label}`;
    const e = parts.get(k) || { units: 0, loc: cmpLocName(r.location_id), label, item: several ? r.item_name : '' };
    e.units += safeInt(r.units);
    parts.set(k, e);
  });
  const out = [...parts.values()].sort((a, b) => b.units - a.units)
    .map((e) => `${fmtNum(e.units)}${e.item ? ` ${e.item}` : ''} in ${e.loc}${e.label ? ` (${e.label})` : ''}`).join(' · ');
  return several ? `${fmtNum(rows.reduce((t, r) => t + safeInt(r.units), 0))} — ${out}` : out;
}

// -- the stack's run badge + history button (cmpRowHtml asks for these) --------

function cmpRowRunHtml(r) {
  const label = cmpRunLabel(r);
  return label ? ` <span class="cmp-run-badge power-only" title="From production run ${escapeHtml(label)}">${escapeHtml(label)}</span>` : '';
}
function cmpRowHistBtn(r) {
  return `<button class="btn btn-icon power-only" data-cledger="${safeInt(r.id)}" title="History of this stack — made, moved, used, adjusted"><i class="fa-solid fa-book"></i></button>`;
}

// -- log a run ------------------------------------------------------------------

function openCmpRun() {
  $('#cmp-run-names').innerHTML = cmpItemNames().map((t) => `<option value="${escapeHtml(t.name)}">`).join('');
  $('#cmp-run-by').innerHTML = '<option value="">By hand</option>'
    + cmpState.factories.map((f) => `<option value="${safeInt(f.id)}">${escapeHtml(f.name || 'Factory')}${f.product ? ` — ${escapeHtml(f.product)}` : ''}</option>`).join('');
  ['#cmp-run-name', '#cmp-run-units', '#cmp-run-crate', '#cmp-run-quality', '#cmp-run-loc', '#cmp-run-stats'].forEach((s) => { $(s).value = ''; });
  $('#cmp-runs-modal').hidden = true;
  $('#cmp-run-modal').hidden = false;
  $('#cmp-run-name').focus();
}

async function doCmpRun() {
  const item_name = $('#cmp-run-name').value.trim();
  const units = safeInt($('#cmp-run-units').value);
  if (!item_name) { toast('Name what the run made', false); return; }
  if (units <= 0) { toast('How many came off the run?', false); return; }
  const btn = $('#cmp-run-go');
  btn.disabled = true;
  let res;
  try {
    const loc = await cmpResolveLoc($('#cmp-run-loc').value);
    const q = $('#cmp-run-quality').value.trim();
    res = await apiFetch('POST', 'api/components.php', { data: {
      action: 'run_log', item_name, units, ...loc,
      crate_size: safeInt($('#cmp-run-crate').value) || null,
      quality: q === '' ? null : safeInt(q),
      factory_id: safeInt($('#cmp-run-by').value) || null,
      stats: $('#cmp-run-stats').value.trim() } });
  } catch (e) { res = { ok: false, error: e.message || String(e) }; }
  btn.disabled = false;
  if (!res.ok) { toast(`Couldn't log the run: ${res.error || 'server error'}`, false); checkAuthError(res.error); return; }
  $('#cmp-run-modal').hidden = true;
  toast(`Run #${safeInt(res.data.run_no)} logged — ${fmtNum(units)} × ${item_name}`);
  cmpAfterChange();
}

// -- the runs list ----------------------------------------------------------------

async function openCmpRuns() {
  $('#cmp-runs-list').innerHTML = '<div class="settings-hint"><span class="spinner"></span> Loading…</div>';
  $('#cmp-runs-modal').hidden = false;
  const res = await apiFetch('GET', 'api/components.php', { params: { runs: 1 } });
  if (!res.ok) { $('#cmp-runs-list').innerHTML = `<div class="settings-hint">${escapeHtml(res.error || 'Load failed')}</div>`; return; }
  const runs = res.data.runs || [];
  $('#cmp-runs-list').innerHTML = runs.length ? runs.map((r) => {
    const held = safeInt(r.held), made = safeInt(r.units);
    const by = r.made_by === 'factory' ? (r.factory_name || 'a factory') : 'by hand';
    const q = r.quality != null && r.quality !== '' ? ` · q${r.quality}` : '';
    return `<a role="button" class="cmp-log-row cmp-run-row" data-crun="${safeInt(r.id)}" data-name="${escapeHtml(`Run #${safeInt(r.run_no)} — ${r.item_name}`)}"
        title="Show this run's history — where the batch went and what used it">
      <span class="cmp-run-no">#${safeInt(r.run_no)}</span>
      <div class="cmp-log-main">
        <div><b>${fmtNum(made)} × ${escapeHtml(r.item_name)}</b><span class="cmp-planet">${escapeHtml(by)}${q}${r.location_name ? ` · into ${escapeHtml(r.location_name)}` : ''}</span></div>
        <div class="cmp-log-parts">${held ? `${fmtNum(held)} still held` : 'all used or moved on'}${r.stats ? ` · ${escapeHtml(r.stats)}` : ''}</div>
      </div>
      <span class="cmp-log-when">${fmtAgoTip(r.created_at)}</span>
    </a>`;
  }).join('') : '<div class="settings-hint">No runs yet — <b>Log a run</b> when a batch comes off the line, or send a finished factory run to its hopper.</div>';
}

// -- history (ledger) ----------------------------------------------------------

const CMP_LEDGER_KINDS = {
  made: ['fa-industry', 'Made'], added: ['fa-plus', 'Added'], moved_in: ['fa-right-to-bracket', 'Moved in'],
  moved_out: ['fa-right-from-bracket', 'Moved out'], used: ['fa-hammer', 'Used'], restored: ['fa-rotate-left', 'Put back'],
  to_inv: ['fa-store', 'To Inventory'], adjusted: ['fa-scale-balanced', 'Adjusted'], edited: ['fa-pen', 'Edited'],
  removed: ['fa-trash-can', 'Removed'], checked: ['fa-clipboard-check', 'Box checked'],
};

async function openCmpLedger(params, title) {
  $('#cmp-ledger-title').textContent = title;
  $('#cmp-ledger-list').innerHTML = '<div class="settings-hint"><span class="spinner"></span> Loading…</div>';
  $('#cmp-runs-modal').hidden = true;
  $('#cmp-ledger-modal').hidden = false;
  const res = await apiFetch('GET', 'api/components.php', { params: { ledger: 1, ...params } });
  if (!res.ok) { $('#cmp-ledger-list').innerHTML = `<div class="settings-hint">${escapeHtml(res.error || 'Load failed')}</div>`; return; }
  const rows = res.data.ledger || [];
  $('#cmp-ledger-list').innerHTML = rows.length ? rows.map((l) => {
    const [ico, label] = CMP_LEDGER_KINDS[l.kind] || ['fa-circle', l.kind];
    const d = safeInt(l.delta);
    return `<div class="cmp-log-row">
      <i class="fa-solid ${ico} cmp-log-ico"></i>
      <div class="cmp-log-main">
        <div><b>${label}</b>${d ? ` <span class="cmp-ledger-delta ${d > 0 ? 'up' : 'down'}">${d > 0 ? '+' : '−'}${fmtNum(Math.abs(d))}</span>` : ''}
          ${l.item_name && params.item === undefined ? ` ${escapeHtml(l.item_name)}` : ''}
          <span class="cmp-planet">${escapeHtml(l.location_name || (l.kind === 'checked' ? '' : 'Unsorted'))}${l.units_after != null && l.kind !== 'checked' ? ` · ${fmtNum(safeInt(l.units_after))} left there` : ''}</span></div>
        ${l.reason ? `<div class="cmp-log-parts">${escapeHtml(l.reason)}</div>` : ''}
      </div>
      <span class="cmp-log-when">${fmtAgoTip(l.created_at)}</span>
    </div>`;
  }).join('') : '<div class="settings-hint">Nothing recorded yet — changes are recorded from now on.</div>';
}

// -- box check ------------------------------------------------------------------

function openCmpCheck(locId = null) {
  const sel = $('#cmp-check-loc');
  sel.innerHTML = cmpState.locations.map((l) => `<option value="${safeInt(l.id)}">${escapeHtml(l.name)}</option>`).join('');
  if (!cmpState.locations.length) { toast('Add a location first — a box check counts what one holds', false); return; }
  const filt = $('#cmp-locfilter').value;
  sel.value = String(locId ?? (filt && filt !== '0' ? filt : sel.options[0].value));
  $('#cmp-check-reason').value = '';
  $('#cmp-check-modal').hidden = false;
  cmpCheckRender();
}

function cmpCheckRender() {
  const lid = safeInt($('#cmp-check-loc').value);
  const loc = cmpLoc(lid);
  $('#cmp-check-when').textContent = loc && safeInt(loc.checked_at) ? `Last checked ${fmtAgo(safeInt(loc.checked_at))}` : 'Never checked';
  const rows = cmpState.rows.filter((r) => safeInt(r.location_id) === lid)
    .sort((a, b) => String(a.item_name).localeCompare(String(b.item_name)));
  $('#cmp-check-list').innerHTML = rows.length ? `<div class="cmp-check-head"><span>What should be there</span><span>Expected</span><span>Counted</span></div>`
    + rows.map((r) => `<div class="cmp-check-row">
      <span class="cmp-check-name">${escapeHtml(r.item_name)}${cmpRowRunHtml(r)}${r.quality != null && r.quality !== '' && !r.run_id ? ` <span class="cmp-planet">q${escapeHtml(String(r.quality))}</span>` : ''}</span>
      <span class="cmp-check-exp">${fmtNum(safeInt(r.units))}</span>
      <input type="number" class="form-control filter-input cmp-check-amt" min="0" data-ccheck="${safeInt(r.id)}" data-exp="${safeInt(r.units)}" value="${safeInt(r.units)}">
    </div>`).join('')
    : '<div class="settings-hint">Nothing is recorded there — saving still stamps it as checked.</div>';
  cmpCheckHint();
}

function cmpCheckHint() {
  const off = [...document.querySelectorAll('#cmp-check-list [data-ccheck]')].filter((i) => safeInt(i.value) !== safeInt(i.dataset.exp));
  document.querySelectorAll('#cmp-check-list [data-ccheck]').forEach((i) => i.classList.toggle('cmp-check-off', safeInt(i.value) !== safeInt(i.dataset.exp)));
  $('#cmp-check-hint').textContent = off.length ? `${off.length} to correct` : 'All as expected';
}

async function doCmpCheck() {
  const location_id = safeInt($('#cmp-check-loc').value);
  const counts = [...document.querySelectorAll('#cmp-check-list [data-ccheck]')]
    .map((i) => ({ id: safeInt(i.dataset.ccheck), units: Math.max(0, safeInt(i.value)) }));
  const btn = $('#cmp-check-go');
  btn.disabled = true;
  const res = await apiFetch('POST', 'api/components.php', { data: {
    action: 'check', location_id, counts, reason: $('#cmp-check-reason').value.trim() } });
  btn.disabled = false;
  if (!res.ok) { toast(`Couldn't save the check: ${res.error || 'server error'}`, false); checkAuthError(res.error); return; }
  $('#cmp-check-modal').hidden = true;
  const n = safeInt(res.data.corrected);
  toast(n ? `${cmpLocName(location_id)} checked — ${n} stack${n === 1 ? '' : 's'} corrected` : `${cmpLocName(location_id)} checked — all as expected`);
  cmpAfterChange();
}

function initCmpPower() {
  $('#cmp-runs-open').addEventListener('click', openCmpRuns);
  $('#cmp-check-open').addEventListener('click', () => openCmpCheck());

  // log a run
  cmpBindLocSug('#cmp-run-loc', '#cmp-run-loc-sug');
  $('#cmp-runs-new').addEventListener('click', openCmpRun);
  $('#cmp-run-go').addEventListener('click', doCmpRun);
  $('#cmp-run-cancel').addEventListener('click', () => { $('#cmp-run-modal').hidden = true; });
  bindBackdropClose($('#cmp-run-modal'), () => { $('#cmp-run-modal').hidden = true; });
  $('#cmp-run-modal').addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') doCmpRun(); });
  // picking a factory fills in what it makes
  $('#cmp-run-by').addEventListener('change', () => {
    const f = cmpState.factories.find((x) => String(x.id) === $('#cmp-run-by').value);
    if (f && f.product && !$('#cmp-run-name').value.trim()) $('#cmp-run-name').value = f.product;
    if (f && !$('#cmp-run-loc').value.trim()) {
      const hop = cmpState.locations.find((l) => String(l.factory_id) === String(f.id));
      $('#cmp-run-loc').value = hop ? hop.name : `Hopper: ${f.name || 'Factory'}`;
    }
  });

  // runs list → a run's history
  $('#cmp-runs-done').addEventListener('click', () => { $('#cmp-runs-modal').hidden = true; });
  bindBackdropClose($('#cmp-runs-modal'), () => { $('#cmp-runs-modal').hidden = true; });
  $('#cmp-runs-list').addEventListener('click', (e) => {
    const a = e.target.closest('[data-crun]');
    if (a) openCmpLedger({ run: safeInt(a.dataset.crun) }, a.dataset.name);
  });

  // history
  $('#cmp-ledger-done').addEventListener('click', () => { $('#cmp-ledger-modal').hidden = true; });
  bindBackdropClose($('#cmp-ledger-modal'), () => { $('#cmp-ledger-modal').hidden = true; });
  $('#cmp-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-cledger]');
    if (!b) return;
    e.stopPropagation();
    const r = cmpState.rows.find((x) => safeInt(x.id) === safeInt(b.dataset.cledger));
    openCmpLedger({ id: safeInt(b.dataset.cledger) }, r ? `${r.item_name} — ${cmpLocName(r.location_id)}` : 'History');
  });

  // box check
  $('#cmp-check-loc').addEventListener('change', cmpCheckRender);
  $('#cmp-check-list').addEventListener('input', cmpCheckHint);
  $('#cmp-check-go').addEventListener('click', doCmpCheck);
  $('#cmp-check-cancel').addEventListener('click', () => { $('#cmp-check-modal').hidden = true; });
  bindBackdropClose($('#cmp-check-modal'), () => { $('#cmp-check-modal').hidden = true; });
}
