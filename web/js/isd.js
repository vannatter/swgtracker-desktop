/* Interplanetary Survey Droid reports — the site reads an ISD mail when the
   monitor uploads it (includes/isd_reports.php): planets added to resources in
   spawn, new names queued until they have stats. Two surfaces:
   - Mail page: a "Survey droid reports" panel, only for players who have any
   - bell: after an upload, any new report becomes a local alert
   Normal players never hit api/isd.php except one call when the Mail page opens. */

const isdState = { lastUploaded: null, checking: false, open: new Set() };
const ISD_RESULT_LABEL = {
  planet_added: 'planet added', confirmed: 'already listed', inactive: 'not in spawn on the site',
  added: 'new — added', pending: 'new — waiting for stats',
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
    if ($('#page-monitor')?.classList.contains('active')) isdLoadPanel();
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
  try { res = await apiFetch('GET', 'api/isd.php', { params: { limit: 8 } }); } catch (_) { return; }
  const d = res.ok && res.data;
  if (!d || !d.total) { panel.hidden = true; return; }
  if (d.reports.length) isdSetLastId(Math.max(isdLastId(), ...d.reports.map((r) => r.id)));
  panel.hidden = false;
  panel.innerHTML = `
    <div class="isd-head"><i class="fa-solid fa-satellite"></i> Survey droid reports
      <span class="isd-count">${fmtNum(d.total)}</span>
      <i class="fa-solid fa-circle-info info-tip" title="Interplanetary Survey Droid mails the monitor uploaded. Resources in spawn get this planet added; new names wait until they have stats."></i></div>
    <div class="isd-list">${d.reports.map((r) => `
      <div class="isd-row" data-isd="${r.id}" role="button" tabindex="0">
        <span class="isd-what"><b>${escapeHtml(r.planet_name)}</b> · ${escapeHtml(r.res_class)}</span>
        <span class="isd-sum">${escapeHtml(isdSummary(r).replace(/^.*? — /, '') || `${r.found} found`)}</span>
        <span class="isd-when">${fmtAgo(r.created)}</span>
      </div>
      <div class="isd-items" id="isd-items-${r.id}" hidden></div>`).join('')}
    </div>`;
}

async function isdToggle(id) {
  const box = $(`#isd-items-${id}`);
  if (!box) return;
  if (!box.hidden) { box.hidden = true; return; }
  if (!box.dataset.loaded) {
    const res = await apiFetch('GET', 'api/isd.php', { params: { id } });
    const items = (res.ok && res.data && res.data.report && res.data.report.items) || [];
    box.innerHTML = items.length ? items.map((i) => `
      <div class="isd-item"><span class="isd-name">${escapeHtml(i.name)}</span>
        <span class="isd-cls">${escapeHtml(i.cls)}</span>
        <span class="isd-res isd-res-${escapeHtml(i.result)}">${escapeHtml(ISD_RESULT_LABEL[i.result] || i.result)}</span></div>`).join('')
      : '<div class="isd-item muted">Nothing listed.</div>';
    box.dataset.loaded = '1';
  }
  box.hidden = false;
}

function initIsd() {
  document.addEventListener('click', (e) => {
    const row = e.target.closest('[data-isd]');
    if (row) isdToggle(row.dataset.isd);
  });
  document.addEventListener('keydown', (e) => {
    const row = e.key === 'Enter' && e.target.closest?.('[data-isd]');
    if (row) isdToggle(row.dataset.isd);
  });
  setInterval(isdWatch, 60000);
  setTimeout(isdWatch, 15000);
}
initIsd();
