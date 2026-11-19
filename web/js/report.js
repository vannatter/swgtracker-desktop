/* Report a problem (Ideas #50) — send a bug report straight from the app: your
   note, a screenshot if you add one, and the app's recent logs, in one go.

   Loaded right after shared.js so it starts keeping the web layer's own recent
   errors and warnings from boot (a small ring, this session only). On send it
   adds the calls that failed (shared.js netLog — endpoint and error only, never
   bodies) and, on shells that have it, the tail of the app's log file
   (web_api.log_tail). Long key-like tokens and email addresses are masked here,
   in the shell and again on the server. api/bug_report.php stores it for
   admin/bug_reports.php; nothing is sent until you press Send. */

const rptRing = [];
const RPT_RING_MAX = 120;
function rptPush(level, msg) {
  rptRing.push(`${new Date().toISOString().slice(11, 19)} ${level} ${String(msg).slice(0, 800)}`);
  if (rptRing.length > RPT_RING_MAX) rptRing.shift();
}
window.addEventListener('error', (e) => rptPush('error', `${e.message} @ ${(e.filename || '').split('/').pop()}:${e.lineno}`));
window.addEventListener('unhandledrejection', (e) => rptPush('error', `unhandled rejection: ${(e.reason && e.reason.message) || e.reason}`));
['error', 'warn'].forEach((lvl) => {
  const orig = console[lvl];
  console[lvl] = (...args) => {
    try { rptPush(lvl, args.map((a) => (a instanceof Error ? a.message : typeof a === 'string' ? a : (() => { try { return JSON.stringify(a); } catch (_) { return String(a); } })())).join(' ')); } catch (_) { /* never break logging */ }
    return orig.apply(console, args);
  };
});

const rptMask = (s) => String(s || '')
  .replace(/[A-Za-z0-9_-]{24,}/g, '[masked]')
  .replace(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]');

const rpt = { shot: '', logs: '', busy: false };

async function rptGatherLogs() {
  const parts = [];
  parts.push(`--- app errors this session (${rptRing.length}) ---`, ...(rptRing.length ? rptRing : ['(none)']));
  const failed = (typeof netLog !== 'undefined' ? netLog.entries : []).filter((e) => !e.ok).slice(0, 40)
    .map((e) => `${e.at.toISOString().slice(11, 19)} ${e.method} ${e.endpoint} — ${e.error || 'failed'} (${e.ms}ms)`);
  parts.push('', `--- failed requests (${failed.length}) ---`, ...(failed.length ? failed : ['(none)']));
  const bridge = api();
  if (bridge && typeof bridge.log_tail === 'function') {
    try {
      const r = await bridge.log_tail(300);
      if (r && r.ok && r.data) parts.push('', '--- app log (last 300 lines) ---', String(r.data));
    } catch (_) { /* web part only */ }
  }
  return rptMask(parts.join('\n'));
}

async function rptOpen() {
  rpt.shot = '';
  $('#rpt-note').value = '';
  $('#rpt-logs-on').checked = true;
  $('#rpt-logs-view').hidden = true;
  $('#rpt-logs-view').value = '';
  rptShotRender();
  $('#rpt-send').disabled = false;
  $('#rpt-modal').hidden = false;
  setTimeout(() => $('#rpt-note').focus(), 30);
  rpt.logs = await rptGatherLogs();
  $('#rpt-logs-count').textContent = `${fmtNum(rpt.logs.split('\n').length)} lines`;
}

function rptShotRender() {
  const box = $('#rpt-shot');
  box.innerHTML = rpt.shot
    ? `<img src="${rpt.shot}" alt="Screenshot"><button class="btn btn-icon btn-sm rpt-shot-x" id="rpt-shot-x" title="Remove the screenshot"><i class="fa-solid fa-xmark"></i></button>`
    : `<span class="settings-sub"><i class="fa-regular fa-image"></i> Paste a screenshot (${/Mac/i.test(navigator.platform) ? '⌘' : 'Ctrl'}+V) or <a role="button" id="rpt-shot-pick">pick an image</a> — optional</span>`;
}

// any image → a JPEG no wider than 1600px, so reports stay small
function rptTakeImage(file) {
  if (!file || !/^image\//.test(file.type)) return;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const scale = Math.min(1, 1600 / img.naturalWidth);
    const c = document.createElement('canvas');
    c.width = Math.round(img.naturalWidth * scale);
    c.height = Math.round(img.naturalHeight * scale);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    rpt.shot = c.toDataURL('image/jpeg', 0.85);
    URL.revokeObjectURL(url);
    rptShotRender();
  };
  img.onerror = () => { URL.revokeObjectURL(url); toast('Couldn’t read that image', false); };
  img.src = url;
}

async function rptSend() {
  const note = $('#rpt-note').value.trim();
  if (!note) { toast('Say what went wrong first', false); $('#rpt-note').focus(); return; }
  if (rpt.busy) return;
  rpt.busy = true;
  $('#rpt-send').disabled = true;
  let ver = '', bundle = '';
  try { const r = await api().app_info(); ver = (r && r.ok && r.data && r.data.version) || ''; } catch (_) { /* blank */ }
  try { const r = await api().bundle_state(); bundle = (r && r.ok && r.data && r.data.source === 'bundle' && r.data.active_version) || 'built-in'; } catch (_) { /* blank */ }
  const data = {
    note,
    page: currentPageKey(),
    app_version: ver,
    bundle,
    platform: `${navigator.platform || ''} · ${window.innerWidth}×${window.innerHeight}`.slice(0, 80),
    logs: $('#rpt-logs-on').checked ? (rpt.logs || await rptGatherLogs()) : '',
    shot: rpt.shot || '',
  };
  let res;
  try { res = await apiFetch('POST', 'api/bug_report.php', { data }); } catch (e) { res = { ok: false, error: String(e) }; }
  rpt.busy = false;
  $('#rpt-send').disabled = false;
  if (!res.ok) {
    toast(/404|not found/i.test(String(res.error || '')) ? 'Reports need the latest swgtracker.com update — try again soon, or post in Discord'
      : (res.error || 'Couldn’t send the report'), false);
    return;
  }
  $('#rpt-modal').hidden = true;
  toast(`Thanks — report #${safeInt(res.data && res.data.id)} sent`);
}

document.addEventListener('DOMContentLoaded', () => {
  const close = () => { $('#rpt-modal').hidden = true; };
  $('#rpt-cancel').addEventListener('click', close);
  bindBackdropClose($('#rpt-modal'), close);
  $('#rpt-send').addEventListener('click', rptSend);
  document.querySelectorAll('[data-report-problem]').forEach((b) => b.addEventListener('click', rptOpen));
  $('#rpt-logs-show').addEventListener('click', () => {
    const v = $('#rpt-logs-view');
    v.hidden = !v.hidden;
    if (!v.hidden) v.value = rpt.logs || '(gathering…)';
  });
  $('#rpt-shot').addEventListener('click', (e) => {
    if (e.target.closest('#rpt-shot-x')) { rpt.shot = ''; rptShotRender(); return; }
    if (e.target.closest('#rpt-shot-pick')) $('#rpt-shot-file').click();
  });
  $('#rpt-shot-file').addEventListener('change', (e) => { rptTakeImage(e.target.files && e.target.files[0]); e.target.value = ''; });
  $('#rpt-modal').addEventListener('paste', (e) => {
    const item = [...((e.clipboardData && e.clipboardData.items) || [])].find((i) => i.type.startsWith('image/'));
    if (item) { e.preventDefault(); rptTakeImage(item.getAsFile()); }
  });
});
