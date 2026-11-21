/* My Stockpile → Alerts (Ideas #67, requested by Murt_88): keep a minimum for
   any class in the resource tree — 5M Mineral, 2M Steel, 500k Ygic Fiberplast —
   and hear about it when the stockpile total drops below one.

   Minimums live server-side (api/stockpile_minimums.php), which also judges them:
   below_since is stamped once per drop and cleared when you're back above, and
   the site's cron sends the email / phone push for it. This file is the dialog,
   the "Running low" strip on My Stockpile and the desktop notice — shown once per
   drop, remembered per device by below_since. */

const stkMin = { list: [], nodes: null, classCode: '', editing: null, timer: null, soon: null };

// "5m", "500k", "2,000,000", "1.5M" → units (0 when it doesn't read)
function stkMinParse(s) {
  const m = String(s || '').trim().toLowerCase().replace(/[, _]/g, '').match(/^(\d+(?:\.\d+)?)([km])?$/);
  if (!m) return 0;
  const n = parseFloat(m[1]) * (m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1);
  return Math.round(n);
}
function stkMinUnits(n) {
  n = Number(n) || 0;
  if (n >= 1e6) return `${+(n / 1e6).toFixed(2)}M`;
  if (n >= 1e4) return `${+(n / 1e3).toFixed(1)}k`;
  return n.toLocaleString();
}
const stkMinName = (m) => m.class_name || categoryNameByCode.get(m.class_code) || m.class_code;
const stkMinLow = () => stkMin.list.filter((m) => m.below_since > 0);

async function stkMinFetch() {
  let res;
  try { res = await apiFetch('GET', 'api/stockpile_minimums.php'); } catch (_) { return null; }
  if (!res.ok || !res.data) return null;
  stkMin.list = res.data.minimums || [];
  return stkMin.list;
}

// desktop notice for drops this device hasn't shown yet (once per drop; drops
// older than 3 days — the app was closed — only show on the strip)
function stkMinNotify() {
  let shown = {};
  try { shown = JSON.parse(localStorage.getItem('stk_min_shown') || '{}'); } catch (_) { /* private */ }
  const now = Math.floor(Date.now() / 1000);
  const next = {};
  for (const m of stkMin.list) {
    if (!m.below_since) continue;
    const key = String(m.id);
    next[key] = m.below_since;
    if (shown[key] === m.below_since || !m.fresh || !m.notice || m.below_since < now - 3 * 86400) continue;
    appLocalAlert(`Stockpile low: ${stkMinName(m)}`, `${stkMinUnits(m.total)} left — your minimum is ${stkMinUnits(m.min_units)}`,
      { page: 'stockpile' });
  }
  try { localStorage.setItem('stk_min_shown', JSON.stringify(next)); } catch (_) { /* private */ }
}

async function stkMinSweep() {
  if (!(await stkMinFetch())) return;
  stkMinNotify();
  stkMinRenderStrip();
  if (!$('#stk-min-modal').hidden) stkMinRenderList();
}
// after a stock edit: let a burst of edits settle, then re-judge
function stkMinSoon() {
  clearTimeout(stkMin.soon);
  stkMin.soon = setTimeout(stkMinSweep, 4000);
}

// ---- "Running low" strip + the header button's count ----
function stkMinRenderStrip() {
  const low = stkMinLow();
  const pill = $('#stk-min-pill');
  pill.hidden = !low.length;
  pill.textContent = low.length;
  const strip = $('#stk-min-strip');
  strip.hidden = !low.length;
  if (!low.length) return;
  strip.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i> <b>Running low:</b> '
    + low.map((m) => `<span class="stk-min-chip">${escapeHtml(stkMinName(m))} <span class="settings-sub">${stkMinUnits(m.total)} of ${stkMinUnits(m.min_units)}</span></span>`).join('');
}

// ---- dialog ----
function stkMinRenderList() {
  const host = $('#stk-min-list');
  if (!stkMin.list.length) {
    host.innerHTML = '<div class="stk-min-empty">No alerts yet — pick a class below and the least you want to keep.</div>';
    return;
  }
  host.innerHTML = stkMin.list.map((m) => {
    const pct = Math.min(100, Math.round((m.total / Math.max(1, m.min_units)) * 100));
    const low = m.below_since > 0;
    const how = [m.notice ? '<i class="fa-regular fa-bell" title="Notice — desktop and phone push"></i>' : '',
      m.email ? '<i class="fa-regular fa-envelope" title="Email"></i>' : ''].join('');
    return `<div class="stk-min-row${low ? ' is-low' : ''}${stkMin.editing === m.id ? ' is-editing' : ''}" data-minid="${m.id}" title="Click to change">
      <span class="stk-min-name">${escapeHtml(stkMinName(m))}</span>
      <span class="stk-min-bar"><span style="width:${pct}%"></span></span>
      <span class="stk-min-nums">${stkMinUnits(m.total)} <span class="settings-sub">/ ${stkMinUnits(m.min_units)}</span></span>
      <span class="stk-min-how">${how}</span>
      <button type="button" class="btn btn-icon stk-min-del" data-mindel="${m.id}" title="Remove this alert"><i class="fa-solid fa-xmark"></i></button>
    </div>`;
  }).join('');
}

function stkMinSetClass(code) {
  stkMin.classCode = code || '';
  $('#stk-min-class-current').textContent = code ? (categoryNameByCode.get(code)
    || ((stkMin.nodes || []).find((n) => n.code === code) || {}).desc || code) : 'Pick a class…';
}
function stkMinRenderClassOpts(query = '') {
  const nodes = stkMin.nodes || [];
  const q = query.trim().toLowerCase();
  const rows = q ? nodes.filter((n) => n.desc.toLowerCase().includes(q)).slice(0, 200) : nodes;
  $('#stk-min-class-opts').innerHTML = rows.map((n) =>
    `<div class="mysd-opt" data-code="${escapeHtml(n.code)}">${q ? '' : '&nbsp; '.repeat(n.depth)}${escapeHtml(n.desc)}</div>`).join('')
    + (!nodes.length ? '<div class="mysd-opt-none">Loading classes…</div>' : (q && !rows.length ? '<div class="mysd-opt-none">No classes match.</div>' : ''));
}
const stkMinCloseMenu = () => { $('#stk-min-class-menu').hidden = true; };

function stkMinResetForm() {
  stkMin.editing = null;
  stkMinSetClass('');
  $('#stk-min-units').value = '';
  $('#stk-min-notice').checked = true;
  $('#stk-min-email').checked = false;
  $('#stk-min-save').innerHTML = '<i class="fa-solid fa-plus"></i> Add alert';
  $('#stk-min-status').textContent = '';
}

function stkMinEdit(id) {
  const m = stkMin.list.find((x) => x.id === id);
  if (!m) return;
  stkMin.editing = id;
  stkMinSetClass(m.class_code);
  $('#stk-min-units').value = stkMinUnits(m.min_units).replace(/,/g, '');
  $('#stk-min-notice').checked = !!m.notice;
  $('#stk-min-email').checked = !!m.email;
  $('#stk-min-save').innerHTML = '<i class="fa-solid fa-check"></i> Save alert';
  $('#stk-min-status').textContent = '';
  stkMinRenderList();
  $('#stk-min-units').focus();
}

async function stkMinSave() {
  const status = $('#stk-min-status');
  const min = stkMinParse($('#stk-min-units').value);
  const notice = $('#stk-min-notice').checked, email = $('#stk-min-email').checked;
  if (!stkMin.classCode) { status.textContent = 'Pick a class first.'; return; }
  if (min < 1) { status.textContent = 'How many units do you want to keep? e.g. 2m or 500k'; $('#stk-min-units').focus(); return; }
  if (!notice && !email) { status.textContent = 'Pick a notice, an email or both.'; return; }
  // changing an alert's class replaces it (minimums are one per class)
  const old = stkMin.editing && stkMin.list.find((x) => x.id === stkMin.editing);
  $('#stk-min-save').disabled = true;
  status.textContent = 'Saving…';
  let res;
  try {
    res = await apiFetch('POST', 'api/stockpile_minimums.php', { data: {
      class_code: stkMin.classCode, class_name: categoryNameByCode.get(stkMin.classCode)
        || ((stkMin.nodes || []).find((n) => n.code === stkMin.classCode) || {}).desc || '',
      min_units: min, notice, email } });
    if (res.ok && old && old.class_code !== stkMin.classCode) {
      await apiFetch('DELETE', `api/stockpile_minimums.php?id=${safeInt(old.id)}`);
      res = await apiFetch('GET', 'api/stockpile_minimums.php');
    }
  } catch (e) { res = { ok: false, error: String(e) }; }
  $('#stk-min-save').disabled = false;
  if (!res.ok) { status.textContent = res.error || 'Could not save the alert.'; return; }
  stkMin.list = (res.data && res.data.minimums) || [];
  // a floor you're already under shows on the strip, but the save itself is the heads-up
  stkMinNotify();
  stkMinResetForm();
  stkMinRenderList();
  stkMinRenderStrip();
  toast('Stockpile alert saved');
}

async function stkMinDelete(id) {
  let res;
  try { res = await apiFetch('DELETE', `api/stockpile_minimums.php?id=${safeInt(id)}`); } catch (e) { res = { ok: false }; }
  if (!res.ok) { toast('Could not remove the alert', false); return; }
  stkMin.list = stkMin.list.filter((m) => m.id !== id);
  if (stkMin.editing === id) stkMinResetForm();
  stkMinRenderList();
  stkMinRenderStrip();
}

async function openStkMinDialog() {
  stkMinResetForm();
  stkMinRenderList();
  $('#stk-min-modal').hidden = false;
  if (!stkMin.nodes) fetchCategoryNodes(true).then((n) => { stkMin.nodes = n || []; });
  await stkMinFetch();
  stkMinRenderList();
  stkMinRenderStrip();
}

function initStkMinimums() {
  $('#stk-min-btn').addEventListener('click', openStkMinDialog);
  $('#stk-min-strip').addEventListener('click', openStkMinDialog);
  const modal = $('#stk-min-modal');
  const close = () => { modal.hidden = true; stkMinCloseMenu(); };
  $('#stk-min-close').addEventListener('click', close);
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { if (!$('#stk-min-class-menu').hidden) stkMinCloseMenu(); else close(); }
    else if (e.key === 'Enter' && e.target.id === 'stk-min-units') { e.preventDefault(); stkMinSave(); }
  });
  $('#stk-min-save').addEventListener('click', stkMinSave);
  $('#stk-min-list').addEventListener('click', (e) => {
    const del = e.target.closest('[data-mindel]');
    if (del) { stkMinDelete(safeInt(del.dataset.mindel)); return; }
    const row = e.target.closest('[data-minid]');
    if (row) stkMinEdit(safeInt(row.dataset.minid));
  });

  // class combobox — same type-to-filter tree as the Spawn Alerts editor
  $('#stk-min-class-btn').addEventListener('click', () => {
    const menu = $('#stk-min-class-menu');
    menu.hidden = !menu.hidden;
    if (!menu.hidden) {
      $('#stk-min-class-filter').value = '';
      stkMinRenderClassOpts();
      $('#stk-min-class-filter').focus();
      if (!stkMin.nodes || !stkMin.nodes.length) {
        fetchCategoryNodes(true).then((n) => { stkMin.nodes = n || []; if (!menu.hidden) stkMinRenderClassOpts($('#stk-min-class-filter').value); });
      }
    }
  });
  $('#stk-min-class-filter').addEventListener('input', () => stkMinRenderClassOpts($('#stk-min-class-filter').value));
  $('#stk-min-class-filter').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      const first = document.querySelector('#stk-min-class-opts [data-code]');
      if (first) { stkMinSetClass(first.dataset.code); stkMinCloseMenu(); $('#stk-min-units').focus(); }
    }
  });
  $('#stk-min-class-opts').addEventListener('click', (e) => {
    const opt = e.target.closest('[data-code]');
    if (!opt) return;
    stkMinSetClass(opt.dataset.code);
    stkMinCloseMenu();
    $('#stk-min-units').focus();
  });
  document.addEventListener('click', (e) => { if (!e.target.closest('#stk-min-class-combo')) stkMinCloseMenu(); });

  // judge shortly after boot, then every 10 minutes (stock can change on the website
  // or from a factory run) — signed-out apiFetch just fails quietly
  setTimeout(stkMinSweep, 15000);
  stkMin.timer = setInterval(stkMinSweep, 10 * 60000);
}
