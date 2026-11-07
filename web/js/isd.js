/* Interplanetary Survey Droid reports — the site reads an ISD mail when the
   monitor uploads it (includes/isd_reports.php): planets added to resources in
   spawn, new names queued until they have stats. Surfaces:
   - Survey Droid page (Tools): every report, waiting-for-stats ones first.
     It used to sit above the mail list and squeezed it (Danvar)
   - Mail page: one line with the counts, linking that page — only for players who have any
   - bell: after an upload, any new report becomes a local alert
   A "waiting for stats" name gets Enter stats: a dialog with just the stats
   its class has, capped per class; the site adds it in spawn (Canda).
   Normal players never hit api/isd.php except a call a minute while Mail is open. */

// open/items survive a redraw of the panel (Danvar)
const isdState = { lastUploaded: null, checking: false, open: new Set(), items: new Map(), limit: 25, stripAt: 0 };
const ISD_RESULT_LABEL = {
  planet_added: 'planet added', confirmed: 'already listed', inactive: 'not in spawn on the site',
  added: 'new — added', pending: 'new — waiting for stats',
  entered: 'added — you entered the stats', arrived: 'new — now on the site',
};

function isdSummary(r) {
  const bits = [];
  if (r.planet_added) bits.push(`${r.planet_added} planet${r.planet_added === 1 ? '' : 's'} added`);
  if (r.added) bits.push(`${r.added} new added`);
  if (r.pending) bits.push(`${r.pending} new waiting for stats`);
  if (r.confirmed) bits.push(`${r.confirmed} already listed`);
  if (r.inactive) bits.push(`${r.inactive} not in spawn here`);
  return `${r.found} resource${r.found === 1 ? '' : 's'} on ${r.planet_name}${bits.length ? ' — ' + bits.join(', ') : ''}`;
}

function isdLastId() { try { return safeInt(localStorage.getItem('isdLastId')); } catch (_) { return 0; } }
function isdSetLastId(id) { try { localStorage.setItem('isdLastId', String(id)); } catch (_) { /* no storage */ } }

// After the monitor uploads something, ask the site for reports newer than the last one seen.
async function isdCheckNew() {
  if (isdState.checking) return;
  isdState.checking = true;
  try {
    const last = isdLastId();
    const res = await apiFetch('GET', 'api/isd.php', { params: last ? { since: last, limit: 20 } : { limit: 1 } });
    const reports = (res.ok && res.data && res.data.reports) || [];
    if (!reports.length) return;
    isdSetLastId(Math.max(...reports.map((r) => r.id)));
    if (!last) return; // first run sets the baseline — no backlog of alerts
    reports.slice().reverse().forEach((r) => appLocalAlert('Survey droid report', `${r.res_class}: ${isdSummary(r)}`));
    if ($('#page-isd')?.classList.contains('active')) isdLoadPanel();
    isdState.stripAt = 0; // fresh counts on the Mail line
  } finally {
    isdState.checking = false;
  }
}

async function isdWatch() {
  let st = null;
  try { const res = await api().monitor_state(); st = res.ok ? res.data : null; } catch (_) { return; }
  if (!st) return;
  const up = safeInt(st.uploaded);
  if (isdState.lastUploaded !== null && up > isdState.lastUploaded) isdCheckNew();
  isdState.lastUploaded = up;
}

async function isdLoadPanel() {
  const panel = $('#isd-panel');
  if (!panel) return;
  let res;
  // every report still waiting for stats comes back on its own, however old,
  // so a big batch can't push one off the panel (Izre)
  try { res = await apiFetch('GET', 'api/isd.php', { params: { limit: isdState.limit, waiting: 1 } }); } catch (_) { return; }
  const d = res.ok && res.data;
  $('#isd-empty').hidden = !!(d && d.total);
  if (!d || !d.total) { panel.hidden = true; return; }
  const waiting = d.waiting || [];
  const all = waiting.concat(d.reports);
  if (all.length) isdSetLastId(Math.max(isdLastId(), ...all.map((r) => r.id)));
  const more = d.total - all.length;
  const row = (r) => `
      <div class="isd-row" data-isd="${r.id}" role="button" tabindex="0">
        <span class="isd-what"><b>${escapeHtml(r.planet_name)}</b> · ${escapeHtml(r.res_class)}</span>
        <span class="isd-sum">${escapeHtml(isdSummary(r).replace(/^.*? — /, '') || `${r.found} found`)}</span>
        <span class="isd-when">${fmtAgo(r.created)}</span>
      </div>
      <div class="isd-items" id="isd-items-${r.id}"${isdState.items.has(String(r.id)) && isdState.open.has(String(r.id)) ? '' : ' hidden'}>${isdState.items.get(String(r.id)) || ''}</div>`;
  panel.hidden = false;
  panel.innerHTML = `
    <div class="isd-head"><i class="fa-solid fa-satellite"></i> Survey droid reports
      <span class="isd-count">${fmtNum(d.total)}</span>
      <i class="fa-solid fa-circle-info info-tip" title="Interplanetary Survey Droid mails the monitor uploaded. Resources in spawn get this planet added; new names wait until they have stats."></i></div>
    ${waiting.length ? `<div class="isd-sub isd-sub-waiting"><i class="fa-solid fa-hourglass-half"></i> Waiting for stats <span class="isd-count">${fmtNum(waiting.length)}</span></div>
    <div class="isd-list">${waiting.map(row).join('')}</div>
    ${d.reports.length ? '<div class="isd-sub">Latest</div>' : ''}` : ''}
    <div class="isd-list">${d.reports.map(row).join('')}</div>
    ${more > 0 ? `<button type="button" class="isd-more" data-isdmore>Show ${fmtNum(Math.min(20, more))} more <span class="isd-count">· ${fmtNum(more)} older</span></button>` : ''}`;
}

// Mail page: one line — how many reports, how many wait for stats — linking the
// Survey Droid page. Mail redraws every 10s; the counts re-read at most once a minute.
async function isdLoadStrip() {
  const strip = $('#isd-strip');
  if (!strip || Date.now() - isdState.stripAt < 60000) return;
  isdState.stripAt = Date.now();
  let res;
  try { res = await apiFetch('GET', 'api/isd.php', { params: { limit: 1, waiting: 1 } }); } catch (_) { return; }
  const d = res.ok && res.data;
  if (!d || !d.total) { strip.hidden = true; return; }
  const w = (d.waiting || []).length;
  strip.innerHTML = `<a role="button" data-nav="isd"><i class="fa-solid fa-satellite"></i> Survey droid reports
    <span class="isd-count">${fmtNum(d.total)}</span>${w ? ` <span class="isd-strip-wait"><i class="fa-solid fa-hourglass-half"></i> ${fmtNum(w)} waiting for stats</span>` : ''}
    <span class="isd-strip-go">Open <i class="fa-solid fa-chevron-right"></i></span></a>`;
  strip.hidden = false;
}

async function isdToggle(id) {
  const box = $(`#isd-items-${id}`);
  if (!box) return;
  const key = String(id);
  if (!box.hidden) { box.hidden = true; isdState.open.delete(key); return; }
  isdState.open.add(key);
  if (!isdState.items.has(key)) {
    const res = await apiFetch('GET', 'api/isd.php', { params: { id } });
    const items = (res.ok && res.data && res.data.report && res.data.report.items) || [];
    isdState.items.set(key, items.length ? items.map((i) => `
      <div class="isd-item"><span class="isd-name">${escapeHtml(i.name)}</span>
        <span class="isd-cls">${escapeHtml(i.cls)}</span>
        <span class="isd-res isd-res-${escapeHtml(i.result)}">${escapeHtml(ISD_RESULT_LABEL[i.result] || i.result)}</span>${i.result === 'pending'
          ? `<button type="button" class="btn btn-sm btn-outline-secondary isd-enter" data-isdstats="${escapeHtml(i.name)}" data-isdrep="${safeInt(id)}" title="Type in the stats from the game — the site adds it in spawn on this planet"><i class="fa-solid fa-pen"></i> Enter stats</button>` : ''}</div>`).join('')
      : '<div class="isd-item muted">Nothing listed.</div>');
  }
  if (!isdState.open.has(key)) return;   // closed again while loading
  const cur = $(`#isd-items-${id}`);       // the panel may have redrawn meanwhile
  if (!cur) return;
  cur.innerHTML = isdState.items.get(key);
  cur.hidden = false;
}

// ---- Enter stats (key-gate modal, built once) ----
const isdStats = { name: '', rep: 0, fields: [], busy: false };
function isdStatsModal() {
  let m = $('#isd-stats-modal');
  if (m) return m;
  document.body.insertAdjacentHTML('beforeend', `
  <div id="isd-stats-modal" class="key-gate" hidden>
    <div class="key-gate-card sp-card inv-add-card isd-stats-card" role="dialog" aria-modal="true" aria-labelledby="isd-stats-title">
      <h2 id="isd-stats-title">Enter stats</h2>
      <div class="settings-hint" id="isd-stats-what"></div>
      <div class="isd-stats-grid" id="isd-stats-fields"></div>
      <div class="inv-add-actions">
        <span id="isd-stats-status" class="key-gate-status"></span>
        <button id="isd-stats-cancel" class="btn btn-sm btn-outline-secondary">Cancel</button>
        <button id="isd-stats-save" class="btn btn-sm btn-accent"><i class="fa-solid fa-plus"></i> Add resource</button>
      </div>
    </div>
  </div>`);
  m = $('#isd-stats-modal');
  const close = () => { m.hidden = true; };
  $('#isd-stats-cancel').addEventListener('click', close);
  $('#isd-stats-save').addEventListener('click', isdSaveStats);
  m.addEventListener('click', (e) => { if (e.target === m) close(); });
  m.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter') { e.preventDefault(); isdSaveStats(); }
  });
  return m;
}

async function isdOpenStats(name, rep) {
  const m = isdStatsModal();
  let res;
  try { res = await apiFetch('GET', 'api/isd.php', { params: { pending: name } }); } catch (e) { res = { ok: false, error: String(e) }; }
  const p = res.ok && res.data && res.data.pending;
  if (!p) { toast((res.data && res.data.error) || res.error || `${name} is no longer waiting for stats`, false); isdRefreshItems(rep); return; }
  if (!p.fields.length) { toast(`The site doesn't know the class ${p.type_name} yet, so it can't take stats for ${name}`, false); return; }
  Object.assign(isdStats, { name: p.name, rep, fields: p.fields });
  $('#isd-stats-title').textContent = `Enter stats — ${p.name}`;
  $('#isd-stats-what').innerHTML = `<b>${escapeHtml(p.type_name)}</b> · ${escapeHtml(p.planets.map((x) => x.name).join(', ') || 'no planet yet')}
    <br>Type them from the resource's examine window. It goes in spawn on the site; the SWGAide feed's stats replace these when it lists it.`;
  $('#isd-stats-fields').innerHTML = p.fields.map((f) => `
    <div class="inv-add-field">
      <label class="sp-field-label" for="isd-st-${f.code}" title="${escapeHtml(f.label)}">${f.code.toUpperCase()} <span class="settings-sub">1–${f.max}</span></label>
      <input id="isd-st-${f.code}" data-code="${f.code}" type="number" class="form-control filter-input" min="1" max="${f.max}" step="1" autocomplete="off">
    </div>`).join('');
  $('#isd-stats-status').textContent = '';
  m.hidden = false;
  m.querySelector('input')?.focus();
}

async function isdSaveStats() {
  if (isdStats.busy) return;
  const status = $('#isd-stats-status');
  const stats = {};
  for (const f of isdStats.fields) {
    const el = $(`#isd-st-${f.code}`);
    const v = el.value.trim();
    const n = Number(v);
    if (v === '' || !Number.isInteger(n)) { status.textContent = `${f.code.toUpperCase()} is needed — a whole number.`; el.focus(); return; }
    if (n < 1 || n > f.max) { status.textContent = `${f.code.toUpperCase()} must be between 1 and ${f.max} for this class.`; el.focus(); return; }
    stats[f.code] = n;
  }
  isdStats.busy = true; $('#isd-stats-save').disabled = true; status.textContent = 'Saving…';
  let r;
  try { r = await apiFetch('POST', 'api/isd.php?stats=1', { data: { name: isdStats.name, stats } }); } catch (e) { r = { ok: false, error: String(e) }; }
  isdStats.busy = false; $('#isd-stats-save').disabled = false;
  if (!r.ok || (r.data && r.data.error)) { status.textContent = (r.data && r.data.error) || r.error || 'Could not add it.'; return; }
  $('#isd-stats-modal').hidden = true;
  toast(r.data.status === 'exists' ? `${isdStats.name} is already on the site — no need, it arrived meanwhile` : `${isdStats.name} added in spawn — thanks!`);
  isdRefreshItems(isdStats.rep);
}

// drop a report's cached names and redraw it open with the new results
async function isdRefreshItems(rep) {
  const key = String(rep);
  isdState.items.delete(key);
  isdState.open.delete(key);
  await isdLoadPanel();
  isdToggle(rep);
}

function initIsd() {
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-isdstats]');
    if (btn) { isdOpenStats(btn.dataset.isdstats, safeInt(btn.dataset.isdrep)); return; }
    if (e.target.closest('#isd-strip [data-nav]')) { showPage('isd'); return; }
    if (e.target.closest('[data-isdmore]')) { isdState.limit = Math.min(200, isdState.limit + 20); isdLoadPanel(); return; }
    const row = e.target.closest('[data-isd]');
    if (row) isdToggle(row.dataset.isd);
  });
  document.addEventListener('keydown', (e) => {
    const row = e.key === 'Enter' && e.target.closest?.('[data-isd]');
    if (row) isdToggle(row.dataset.isd);
  });
  $('[data-refresh="isd"]')?.addEventListener('click', () => isdLoadPanel());
  setInterval(isdWatch, 60000);
  setTimeout(isdWatch, 15000);
}
initIsd();
