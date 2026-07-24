/* SWG Tracker Desktop — app shell: navigation, server pulse, monitor controls, boot.
   Page controllers live in resources.js / schematics.js / stockpile.js /
   sales.js / settings.js (all classic scripts sharing this scope). */

// Pages lazy-load on first visit, matching the Tk tabs' <Map> behavior.
const PAGE_LOADERS = {
  resources: () => loadResources(),
  schematics: () => loadSchematics(),
  myschematics: () => loadMySchematics(),
  stockpile: () => syncStockpile(),
  wishlist: () => syncWishlist(),
  sales: () => loadSales(),
  insights: () => loadInsights(),
  purchases: () => loadPurchases(),
  characters: () => loadCharactersPage(),
  harvesters: () => loadHarvesters(),
  factories: () => loadFactories(),
  inventory: () => loadInventory(),
  alerts: () => loadAlerts(),
  lab: () => loadLab(),
  monitor: () => loadMail(),
  scanner: () => loadScanner(),
  settings: () => { loadSettings(); loadScanConfig(); }, // scan config renders into #set-scan-section
  about: () => loadAbout(),
};
const loadedPages = new Set();

// ---- Navigation ----
// WebKit autocorrect/autofill hints don't belong in filter boxes; inputs are
// created all over (inline editors, dropdown filters), so patch on first focus.
document.addEventListener('focusin', (e) => {
  const i = e.target;
  if (i.tagName === 'INPUT' && ['text', 'search', 'number', ''].includes(i.type || '')) {
    i.autocomplete = 'off';
    i.setAttribute('autocorrect', 'off');
    i.setAttribute('autocapitalize', 'off');
    i.spellcheck = false;
  }
});

function initNav() {
  // Scope to the sidebar — Bootstrap tab markup also uses .nav-item (see scd-tabs).
  document.querySelectorAll('.app-sidebar .nav-item').forEach((item) => {
    item.addEventListener('click', () => showPage(item.dataset.page));
  });

  const sidebar = document.querySelector('.app-sidebar');
  const applyCollapsed = (on) => {
    sidebar.classList.toggle('collapsed', on);
    // tooltips only when icons stand alone — labels don't need repeating on hover.
    // Clear data-tip too: the tooltip layer migrates title -> data-tip on hover.
    document.querySelectorAll('.app-sidebar .nav-item').forEach((item) => {
      if (on) {
        item.title = item.textContent.trim();
      } else {
        item.removeAttribute('title');
        delete item.dataset.tip;
      }
    });
    $('#side-collapse i').className = `fa-solid ${on ? 'fa-angles-right' : 'fa-angles-left'}`;
    $('#side-collapse').title = on ? 'Expand menu' : 'Collapse menu';
    localStorage.setItem('sidebar-collapsed', on ? '1' : '');
  };
  $('#side-collapse').addEventListener('click', (e) => {
    applyCollapsed(!sidebar.classList.contains('collapsed'));
    e.currentTarget.blur(); // WebView2 keeps click focus (WKWebView doesn't) — sticky pressed look
  });
  if (localStorage.getItem('sidebar-collapsed') === '1') applyCollapsed(true);

  // Back/forward is keyboard-only: ⌘←/⌘→ (Ctrl on Windows) navigate — but stay
  // out of the way of cursor/line motion while the user is typing in a field.
  document.addEventListener('keydown', (e) => {
    if (!(e.metaKey || e.ctrlKey) || e.altKey || e.shiftKey) return;
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const el = document.activeElement;
    if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA'
      || el.tagName === 'SELECT' || el.isContentEditable)) return;
    e.preventDefault();
    if (e.key === 'ArrowLeft') goBack(); else goForward();
  });
}

// Browser-style back/forward across page visits (sidebar clicks, drill-ins to
// detail pages, category jumps, …). Two stacks; the floating arrows + ⌘←/⌘→
// drive them. A fresh navigation clears the forward trail, like a browser.
const navBack = [];
const navForward = [];

function currentPageKey() {
  return document.querySelector('.page.active')?.id?.replace(/^page-/, '') || '';
}

function updateNavArrows() {
  const wrap = document.getElementById('nav-arrows');
  if (!wrap) return;
  const b = document.getElementById('nav-back');
  const f = document.getElementById('nav-fwd');
  if (b) b.disabled = navBack.length === 0;
  if (f) f.disabled = navForward.length === 0;
  wrap.hidden = navBack.length === 0 && navForward.length === 0;
}

function goBack() {
  if (!navBack.length) return;
  const from = currentPageKey();
  const prev = navBack.pop();
  if (from) navForward.push(from);
  showPage(prev, { internal: true });
  updateNavArrows();
}

function goForward() {
  if (!navForward.length) return;
  const from = currentPageKey();
  const next = navForward.pop();
  if (from) navBack.push(from);
  showPage(next, { internal: true });
  updateNavArrows();
}

function showPage(key, opts = {}) {
  if (!document.getElementById(`page-${key}`)) return; // never blank the app on a bad key
  // Record where we were so back can return there — but a back/forward hop
  // manages the stacks itself, and a fresh navigation drops the forward trail.
  const from = currentPageKey();
  if (!opts.internal && from && from !== key) { navBack.push(from); navForward.length = 0; }
  updateNavArrows();
  // Sub-pages (detail views) keep their parent sidebar item lit.
  const navKey = { schematic: 'schematics', resource: 'resources', myschematic: 'myschematics' }[key] || key;
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === navKey));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${key}`));
  // live-state pages reload on every visit, not just the first — mail uploads
  // and cron inventory depletion both move underneath a cached render
  const ALWAYS_RELOAD = new Set(['monitor', 'inventory', 'characters']);
  if (PAGE_LOADERS[key] && (!loadedPages.has(key) || ALWAYS_RELOAD.has(key))) {
    loadedPages.add(key);
    PAGE_LOADERS[key]();
  }
  // Clicking the Laboratory nav always returns to the experiments list, even if you
  // left it mid-workbench. (Back/forward — opts.internal — keeps its place.)
  if (key === 'lab' && !opts.internal && loadedPages.has('lab') && typeof labShowView === 'function') {
    labShowView('home');
  }
}

// ---- Minimum supported shell ----
// The bundle only stays compatible with old shell bridges so far. Shells below
// this floor get a BLOCKING update gate — the UI is closed until they update,
// while the shell's mail monitor keeps uploading underneath, so nobody loses
// data by procrastinating. Raise the floor with a normal bundle ship.
const MIN_SUPPORTED_SHELL = '0.11.28';

function verCmp(a, b) {
  const pa = String(a).split('.').map((n) => parseInt(n, 10) || 0);
  const pb = String(b).split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  }
  return 0;
}

async function enforceMinShell() {
  let ver = null;
  let realVer = null;
  try {
    const r = await api().app_info();
    ver = r.ok ? r.data?.version : null;
    realVer = r.ok ? r.data?.real_version : null;
  } catch (_) { return; } // bridge too old to even ask — the gate can't reach it
  if (!ver || verCmp(ver, MIN_SUPPORTED_SHELL) >= 0) return;
  // dev-mode version mimicry must not lock the tester out of their own gate —
  // a REAL old shell reports no differing real_version, so this can't be spoofed
  const mimicking = realVer && realVer !== ver;
  let url = 'https://swgtracker.com/download.php';
  try {
    const u = await api().check_update();
    if (u.ok && u.data?.url) url = u.data.url;
  } catch (_) { /* keep the default link */ }
  const gate = document.createElement('div');
  gate.className = 'key-gate'; // full-screen, no dismiss path on purpose
  gate.innerHTML = `<div class="key-gate-card">
    <div class="key-gate-icon"><i class="fa-solid fa-circle-up"></i></div>
    <h2>Update required</h2>
    <p>This app version (v${escapeHtml(ver)}) is no longer supported — the new
       features need the latest app to work right.</p>
    <p>Mail monitoring keeps running in the background; only the interface is
       waiting on the update.</p>
    <button class="btn btn-accent" id="update-gate-btn" style="margin-top:8px">
      <i class="fa-solid fa-download"></i> Download the update</button>
    ${mimicking ? `<p style="margin-top:14px"><a role="button" id="update-gate-unmimic" class="settings-sub"
      style="cursor:pointer; text-decoration:underline">Dev: mimicking v${escapeHtml(ver)}
      (really v${escapeHtml(realVer)}) — stop mimicking</a></p>` : ''}
  </div>`;
  document.body.appendChild(gate);
  gate.querySelector('#update-gate-btn').addEventListener('click', () => {
    try { api().open_external(url); } catch (_) { /* nothing else to do */ }
  });
  if (mimicking) {
    gate.querySelector('#update-gate-unmimic').addEventListener('click', async () => {
      try { await api().set_config('dev_fake_version', ''); } catch (_) { return; }
      location.reload(); // gate re-evaluates against the real version
    });
  }
}

// ---- App updates ----
// Checks swgtracker.com/app/version.json once per launch; a chip appears in
// the header when a newer version is published.
async function showBuildId() {
  try {
    const res = await api().app_info();
    if (res.ok && res.data?.version) $('#build-id').textContent = `v${res.data.version}`;
  } catch (_) { /* ignore */ }
}

async function checkForUpdate() {
  let res;
  try { res = await api().check_update(); } catch (_) { return null; }
  const info = res.ok ? res.data : null;
  if (!info?.update_available) return null;
  const chip = $('#update-chip');
  chip.hidden = false;
  chip.innerHTML = `<i class="fa-solid fa-circle-up"></i> Update v${escapeHtml(info.latest)}`;
  chip.title = info.notes || `Version ${info.latest} is available — click to download`;
  chip.onclick = () => api().open_external(info.url);
  // dim the build id once we know it's stale
  $('#build-id').classList.add('stale');
  return info;
}

// Manual update check — clicking the version/badge asks the shell to fetch
// the manifest right now instead of waiting for the hourly background tick.
async function checkUpdatesNow() {
  toast('Checking for updates…');
  let st = null;
  let shell = null;
  try { const r = await api().bundle_check_now(); st = r?.ok && r.data; } catch (_) { /* offline */ }
  try { shell = await checkForUpdate(); } catch (_) { /* best-effort */ }
  if (st?.pending) {
    renderBundleChip(st.pending);
    toast(`UI update ${st.pending.version} is ready — click the chip to apply`);
  } else if (shell) {
    toast(`App version ${shell.latest} is available — click the Update chip to download`);
  } else if (st?.gated) {
    toast(`Update ${st.gated.version} needs app version ${st.gated.min_shell} — update the app itself first`, false);
  } else {
    toast('You\u2019re up to date');
  }
}

function renderBundleChip(pending) {
  const chip = $('#update-chip');
  chip.hidden = false;
  chip.innerHTML = `<i class="fa-solid fa-wand-magic-sparkles"></i> UI update ${escapeHtml(pending.version)}`;
  chip.title = pending.notes || 'A web UI update is ready — click to apply (no restart)';
  chip.onclick = async () => {
    chip.disabled = true;
    try { await api().bundle_apply(); } catch (_) { chip.disabled = false; }
    // on success the shell reloads this page out from under us
  };
}

// ---- About page ----
async function loadAbout() {
  // Back/forward keyboard nav — ⌘ on Mac, Ctrl on Windows.
  const isMac = /Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent || '');
  const nk = $('#about-nav-keys');
  if (nk) nk.textContent = isMac ? 'Back  ⌘ ←   ·   Forward  ⌘ →' : 'Back  Ctrl + ←   ·   Forward  Ctrl + →';
  try {
    const r = await api().app_info();
    if (r.ok && r.data?.version) $('#about-shell').textContent = `v${r.data.version}`;
  } catch (_) { /* leave the dash */ }
  try {
    const r = await api().bundle_state();
    const st = r?.ok && r.data;
    if (st?.source === 'bundle' && st.active_version) {
      $('#about-ui').textContent = `${st.active_version} — delivered as a live update`;
    } else {
      $('#about-ui').textContent = 'built-in (shipped with the app)';
    }
    let hist = [];
    try {
      const h = await api().bundle_history();
      hist = (h?.ok && Array.isArray(h.data)) ? h.data : [];
    } catch (_) { /* offline — fall through */ }
    if (hist.length) {
      $('#about-notes').innerHTML = `<table class="inv-sales-table"><thead><tr>
          <th>Version</th><th>Published</th><th>Changes</th>
        </tr></thead><tbody>${hist.map((r) => `<tr>
          <td>${escapeHtml(r.version)}${st?.active_version === r.version ? ' <span class="mm-tracked" title="You are here"><i class="fa-solid fa-check"></i></span>' : ''}</td>
          <td>${fmtAgoTip(r.published)}</td>
          <td class="about-note-cell">${escapeHtml(r.notes || '\u2014')}</td>
        </tr>`).join('')}</tbody></table>`;
    } else {
      $('#about-notes').textContent = st?.active_notes
        || 'Release history isn\u2019t available right now.';
    }
  } catch (_) { /* leave the dashes */ }
}

function initAbout() {
  $('#about-check').addEventListener('click', checkUpdatesNow);
  $('#page-about').addEventListener('click', async (e) => {
    const ext = e.target.closest('[data-ext]');
    if (ext) { try { await api().open_external(ext.dataset.ext); } catch (_) { /* ignore */ } }
  });
}

// ---- Web bundle updates (thin client) ----
// The shell downloads+installs new UI bundles in the background; when one is
// pending we surface the same header chip and apply without a restart.
async function pollBundleState() {
  let res;
  try { res = await api().bundle_state(); } catch (_) { return; }
  const st = res?.ok && res.data;
  // downloaded-UI badge next to the shell version
  if (st?.source === 'bundle' && st.active_version) {
    const b = $('#bundle-id');
    b.hidden = false;
    b.innerHTML = `<i class="fa-solid fa-cloud-arrow-down"></i>ui ${escapeHtml(st.active_version)}`;
    b.title = `Interface delivered as update ${st.active_version} — click to check for updates`;
  }
  if (st?.pending) {
    renderBundleChip(st.pending);
    return; // stop polling — the chip is up
  }
  if (st?.enabled) setTimeout(pollBundleState, 15 * 60 * 1000);
}

// ---- Server pulse ----

// Sparkline of player count (last few hours), site-red. history comes from
// pulse.php as 10-minute samples since midnight.
const pulseChart = { pts: [] }; // [{x, y, online, timestamp}] in CSS px, for hover lookup

function drawPulseChart(history) {
  const canvas = $('#pulse-chart');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  const dpr = window.devicePixelRatio || 1;
  const w = canvas.clientWidth || 180;
  const h = canvas.clientHeight || 36;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, w, h);

  const HOURS = 6;
  const cutoff = Date.now() / 1000 - HOURS * 3600;
  let pts = (history || []).filter((p) => safeInt(p.timestamp) >= cutoff);
  if (pts.length < 2) pts = (history || []).slice(-36); // early morning: take what exists
  if (pts.length < 2) { canvas.title = ''; $('#pulse-dot').hidden = true; return; }

  const vals = pts.map((p) => safeInt(p.online));
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = Math.max(1, max - min);
  const pad = 3;
  const x = (i) => pad + (i / (pts.length - 1)) * (w - 2 * pad);
  const y = (v) => (h - pad) - ((v - min) / span) * (h - 2 * pad);

  // gradient fill under the line
  ctx.beginPath();
  vals.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(0), y(v))));
  ctx.lineTo(x(vals.length - 1), h);
  ctx.lineTo(x(0), h);
  ctx.closePath();
  const grad = ctx.createLinearGradient(0, 0, 0, h);
  grad.addColorStop(0, 'rgba(226, 67, 80, .35)');
  grad.addColorStop(1, 'rgba(226, 67, 80, 0)');
  ctx.fillStyle = grad;
  ctx.fill();

  // the line itself + a dot on "now"
  ctx.beginPath();
  vals.forEach((v, i) => (i ? ctx.lineTo(x(i), y(v)) : ctx.moveTo(x(0), y(v))));
  ctx.strokeStyle = '#e24350';
  ctx.lineWidth = 1.5;
  ctx.lineJoin = 'round';
  ctx.stroke();
  // hover lookup data + the live dot (an animated overlay, not canvas-drawn)
  pulseChart.pts = pts.map((p, i) => ({
    x: x(i), y: y(vals[i]), online: vals[i], timestamp: safeInt(p.timestamp),
  }));
  const last = pulseChart.pts[pulseChart.pts.length - 1];
  const dot = $('#pulse-dot');
  dot.hidden = false;
  dot.style.left = `${last.x}px`;
  dot.style.top = `${last.y}px`;
  // restart the one-shot ping so every refresh visibly beats
  dot.classList.remove('ping');
  void dot.offsetWidth; // reflow to reset the animation
  dot.classList.add('ping');

  canvas.title = '';
}

function pulseTimeLabel(ts) {
  return new Date(ts * 1000).toLocaleTimeString(appDateFmt === 'intl' ? 'en-GB' : 'en-US',
    { hour: 'numeric', minute: '2-digit' });
}

function initPulseChart() {
  const canvas = $('#pulse-chart');
  const tip = $('#pulse-tip');
  canvas.addEventListener('mousemove', (e) => {
    if (!pulseChart.pts.length) return;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    let nearest = pulseChart.pts[0];
    for (const p of pulseChart.pts) if (Math.abs(p.x - mx) < Math.abs(nearest.x - mx)) nearest = p;
    tip.textContent = `${nearest.online.toLocaleString()} players · ${pulseTimeLabel(nearest.timestamp)}`;
    tip.hidden = false;
    // keep the tip inside the narrow sidebar
    const half = tip.offsetWidth / 2;
    tip.style.left = `${Math.max(half, Math.min(rect.width - half, nearest.x))}px`;
    tip.style.top = `${nearest.y - 8}px`;
  });
  canvas.addEventListener('mouseleave', () => { tip.hidden = true; });
}

// Single switch for the bottom offline banner — flipped by the pulse poll and by
// any grid load that got served from the local mirror (data.offline).
function setOffline(off) {
  document.body.classList.toggle('offline', !!off);
  $('#offline-bar').hidden = !off;
}

async function fetchPulse() {
  let res;
  try { res = await api().get_pulse(); } catch (e) { res = { ok: false }; }
  setOffline(!(res.ok && res.data));
  const statusEl = $('#pulse-status');
  const mini = $('#pulse-mini');
  if (res.ok && res.data) {
    const online = res.data.online || {};
    mini.classList.remove('offline');
    mini.title = `Online — ${(online.current || 0).toLocaleString()} players · peak today ${(online.peak_today || 0).toLocaleString()}`;
    statusEl.textContent = 'Online';
    statusEl.className = 'pulse-status online';
    $('#pulse-online').innerHTML = `Players: ${(online.current || 0).toLocaleString()}`
      + ` <span class="pulse-peak-inline">· peak ${(online.peak_today || 0).toLocaleString()}</span>`;
    // dev-only: how many desktop apps are phoning home right now
    $('#pulse-desktop').textContent = res.data.desktop_online != null
      ? `Desktop apps: ${res.data.desktop_online.toLocaleString()}` : '';
    showBroadcasts(res.data.broadcasts);
    drawPulseChart(online.history);
  } else {
    statusEl.textContent = 'Offline';
    statusEl.className = 'pulse-status offline';
    mini.classList.add('offline');
    mini.title = 'Server offline';
    $('#pulse-online').innerHTML = '';
  }
}

// ---- Broadcasts ----
// Server-pushed announcements ride the pulse payload (admin/broadcasts.php on
// the site). A new one fires a native notification (reaches the user in game),
// then sticks to a bottom banner until dismissed; every one stays in the bell
// inbox (header) until deleted. Inbox lives in localStorage, capped at 50.
function loadBroadcastInbox() {
  try { return JSON.parse(localStorage.getItem('broadcastInbox')) || []; } catch (_) { return []; }
}
function saveBroadcastInbox(inbox) {
  localStorage.setItem('broadcastInbox', JSON.stringify(inbox.slice(-50)));
}

function showBroadcasts(list) {
  if (!Array.isArray(list) || !list.length) return;
  const inbox = loadBroadcastInbox();
  let added = false;
  for (const b of list) {
    if (!b || !b.id || !b.message || inbox.some((i) => i.id === b.id)) continue;
    inbox.push({ id: b.id, message: String(b.message), ts: b.created_at || 0, dismissed: false });
    try { api().notify('SWG Tracker', String(b.message)); } catch (_) {}
    added = true;
  }
  if (added) { saveBroadcastInbox(inbox); renderBroadcastUI(); }
}

// App-generated events (factory done, harvester full/out/despawned) share the
// broadcast plumbing: native notification + bottom banner + a bell inbox entry
// that sticks until deleted.
function appLocalAlert(title, message) {
  const inbox = loadBroadcastInbox();
  inbox.push({
    id: Date.now() * 10 + Math.floor(Math.random() * 10), // numeric, delete-compatible
    message: `${title} — ${message}`,
    ts: Math.floor(Date.now() / 1000),
    dismissed: false,
  });
  saveBroadcastInbox(inbox);
  try { api().notify(title, message); } catch (_) { /* shell too old */ }
  renderBroadcastUI();
}

function renderBroadcastUI() {
  const inbox = loadBroadcastInbox();
  const open = inbox.filter((i) => !i.dismissed);
  const bar = $('#broadcast-bar');
  if (open.length) {
    const latest = open[open.length - 1];
    $('#broadcast-bar-msg').textContent = latest.message
      + (open.length > 1 ? `  (+${open.length - 1} more in the bell)` : '');
    bar.hidden = false;
  } else {
    bar.hidden = true;
  }
  const badge = $('#bell-badge');
  badge.hidden = !open.length;
  badge.textContent = open.length;
  renderBellPanel(inbox);
}

function renderBellPanel(inbox) {
  const items = (inbox || loadBroadcastInbox()).slice().reverse();
  $('#bell-list').innerHTML = items.length ? items.map((i) => `
    <div class="bell-item ${i.dismissed ? '' : 'unread'}">
      <div class="bell-item-msg">${escapeHtml(i.message)}</div>
      <span class="bell-item-meta">${i.ts ? fmtAgo(i.ts) : ''}</span>
      <button class="bell-item-del" data-delbc="${i.id}" title="Delete"><i class="fa-solid fa-trash"></i></button>
    </div>`).join('')
    : '<div class="bell-empty">No notifications.</div>';
}

function initBroadcasts() {
  $('#broadcast-bar-close').addEventListener('click', () => {
    // dismiss just the banner's current message; the rest surface in turn
    const inbox = loadBroadcastInbox();
    const open = inbox.filter((i) => !i.dismissed);
    if (open.length) { open[open.length - 1].dismissed = true; saveBroadcastInbox(inbox); }
    renderBroadcastUI();
  });
  $('#bell-btn').addEventListener('click', () => {
    const panel = $('#bell-panel');
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      // opening the inbox acknowledges everything: banner + badge clear
      const inbox = loadBroadcastInbox();
      inbox.forEach((i) => { i.dismissed = true; });
      saveBroadcastInbox(inbox);
      renderBroadcastUI();
    }
  });
  $('#bell-panel').addEventListener('click', (e) => {
    const del = e.target.closest('[data-delbc]');
    if (del) {
      saveBroadcastInbox(loadBroadcastInbox().filter((i) => i.id !== safeInt(del.dataset.delbc)));
      renderBroadcastUI();
    } else if (e.target.closest('#bell-clear')) {
      saveBroadcastInbox([]);
      renderBroadcastUI();
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#bell-panel') && !e.target.closest('#bell-btn')) $('#bell-panel').hidden = true;
  });
  renderBroadcastUI(); // undismissed banner survives a restart
}

// ---- Dev mode ----
// 10 quick clicks on the logo toggles the dev wall (Test Connection,
// Simulate offline); 10 more hides it again. Persists in the app CONFIG so it
// survives restarts and rebuilds — WKWebView localStorage does not.
function initDevMode() {
  if (localStorage.getItem('devMode') === '1') document.body.classList.add('dev-mode');
  // config is the durable copy; localStorage is just the first-paint cache
  (async () => {
    try {
      const res = await api().get_config();
      if (res.ok && res.data && res.data.dev_mode != null) {
        const on = !!res.data.dev_mode;
        document.body.classList.toggle('dev-mode', on);
        localStorage.setItem('devMode', on ? '1' : '0');
      }
    } catch (_) { /* localStorage verdict stands */ }
  })();
  let clicks = 0;
  let timer = null;
  $('.app-header-brand').addEventListener('click', () => {
    clearTimeout(timer);
    timer = setTimeout(() => { clicks = 0; }, 1200); // stall too long and the count resets
    clicks += 1;
    const on = document.body.classList.contains('dev-mode');
    if (clicks >= 10) {
      clicks = 0;
      document.body.classList.toggle('dev-mode', !on);
      localStorage.setItem('devMode', on ? '0' : '1');
      try { api().set_config('dev_mode', !on); } catch (_) { /* localStorage still has it */ }
      toast(on ? 'Dev mode hidden' : 'Dev mode unlocked');
      if (on) $('#set-ds-simulate')?.checked && $('#set-ds-simulate').click(); // leaving dev mode ends the simulation too
    } else if (clicks >= 7) {
      toast(`${10 - clicks} more to ${on ? 'hide' : 'unlock'} dev mode`);
    }
  });
}

// ---- Header controls ----
function initControls() {
  // the status line IS the test button (the old dev-only Test Connection went away)
  $('#pulse-status').addEventListener('click', async () => {
    const el = $('#pulse-status');
    const prev = el.textContent;
    el.textContent = 'Testing…';
    try {
      const res = await api().test_connection();
      el.textContent = res.ok ? 'Connected' : 'Disconnected';
      el.className = 'pulse-status ' + (res.ok ? 'online' : 'offline');
    } catch (_) { el.textContent = prev; }
    setTimeout(fetchPulse, 1500);
  });

  $('#btn-monitor').addEventListener('click', async () => {
    const running = $('#btn-monitor').classList.contains('running');
    if (!running) {
      // every watched folder must be tied to one of the account's CHARACTERS
      // (an old free-text label doesn't count) before tracking starts
      try {
        const cfg = await api().get_config();
        const paths = ((cfg.ok && cfg.data && cfg.data.mail_paths) || [])
          .map((m) => (typeof m === 'object' && m ? m : { path: String(m || ''), label: '' }))
          .filter((m) => m.path);
        if (!paths.length) {
          toast('Add a mail folder in Settings first', false);
          showPage('settings');
          return;
        }
        const untied = paths.find((m) => !String(m.label || '').trim());
        if (untied) {
          toast('Assign a character to each mail folder in Settings before starting', false);
          showPage('settings');
          return;
        }
        const labels = paths.map((m) => String(m.label).trim().toLowerCase());
        if (new Set(labels).size !== labels.length) {
          toast('Two folders share a character — give each folder its own in Settings', false);
          showPage('settings');
          return;
        }
        // labels must be real characters — offline we settle for labels existing
        try {
          const cres = await apiFetch('GET', 'api/characters.php');
          if (cres.ok && cres.data && Array.isArray(cres.data.characters)) {
            const known = new Set(cres.data.characters.map((c) => String(c.name).toLowerCase()));
            const stray = paths.find((m) => !known.has(String(m.label).trim().toLowerCase()));
            if (stray) {
              toast(`"${stray.label}" isn't one of your characters — re-save Settings (or add it on the Characters page) first`, false);
              showPage('settings');
              return;
            }
          }
        } catch (_) { /* characters unreachable — labels-present check above stands */ }
      } catch (_) { /* config unreadable — let the shell decide */ }
    }
    const res = running ? await api().stop_monitoring() : await api().start_monitoring();
    if (res.ok) setMonitoring(!running, res.data);
    else toast(res.error || res.data || 'Monitor action failed', false);
  });
}

let monPollTimer = null;
function setMonitoring(on, msg) {
  const btn = $('#btn-monitor');
  btn.classList.toggle('running', on);
  btn.innerHTML = on
    ? '<span class="mon-btn-label"><i class="fa-solid fa-circle-notch fa-spin"></i> Monitoring Mail</span>'
    : '<span class="mon-btn-label"><i class="fa-solid fa-circle-pause"></i> Start Mail Monitor</span>';
  setMonitorTip(on ? (msg || 'Monitoring') : 'Watch your SWG mail folders and upload new mail');
  clearInterval(monPollTimer);
  if (on) monPollTimer = setInterval(refreshMonitorState, 10000);
  // the Mail page mirrors this state — snap it in step when it's on screen
  if ($('#page-monitor').classList.contains('active')) loadMail();
}

// details (folders · uploaded · failed) live in the hover tip, not the bar
function setMonitorTip(text) {
  const btn = $('#btn-monitor');
  btn.setAttribute('title', text);
  delete btn.dataset.tip; // stale migrated tip would shadow the fresh title
}

async function refreshMonitorState() {
  let res;
  try { res = await api().monitor_state(); } catch (_) { return; }
  if (!res.ok || !res.data) return;
  const st = res.data;
  if (!st.running) { setMonitoring(false); return; }
  // auto-start (or anything else) flipped it on outside the button — catch up
  if (!$('#btn-monitor').classList.contains('running')) { setMonitoring(true); }
  const bits = [`${st.folders.length} folder${st.folders.length > 1 ? 's' : ''}`];
  if (st.uploaded) bits.push(`${st.uploaded} uploaded`);
  if (st.failed) bits.push(`${st.failed} failed`);
  setMonitorTip(`Monitoring ${bits.join(' · ')}`);
}

// ---- API-key gate ----
let appStarted = false;

function showKeyGate(msg) {
  const gate = $('#key-gate');
  if (!gate.hidden) return;
  gate.hidden = false;
  $('#gate-status').textContent = msg && !/^\s*$/.test(msg) ? `Server said: ${msg}` : '';
  $('#gate-key').focus();
}

function hideKeyGate() {
  $('#key-gate').hidden = true;
}

// True when the saved key works. Uses the cheapest authenticated call.
async function apiKeyWorks() {
  let res;
  try { res = await api().get_stockpile({ page: 1, perpage: 1 }); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (res.ok) return true;
  if (isAuthError(res.error)) return false;
  return true; // offline/other errors shouldn't lock the app
}

function initKeyGate() {
  $('#gate-site').addEventListener('click', () => {
    api().open_external('https://swgtracker.com/portal').catch?.(() => {});
  });
  $('#gate-key').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#gate-save').click(); });
  $('#gate-save').addEventListener('click', async () => {
    const key = $('#gate-key').value.trim();
    if (!key) return;
    const btn = $('#gate-save');
    btn.disabled = true;
    $('#gate-status').textContent = 'Checking key…';
    try {
      await api().set_config('api_key', key); // applies to the live session too
      if (await apiKeyWorks()) {
        hideKeyGate();
        $('#gate-key').value = '';
        toast('API key verified');
        startData();
        if (loadedPages.has('settings')) loadSettings(); // don't leave a stale key in the form
      } else {
        $('#gate-status').textContent = 'That key was rejected by swgtracker.com — check it and try again.';
      }
    } finally {
      btn.disabled = false;
    }
  });
}

// ---- Boot ----
function startData() {
  if (appStarted) { // key restored mid-session: refresh what's stale
    syncStockpile();
    fetchPulse();
    return;
  }
  appStarted = true;

  // Prefetch stockpile + wishlist so ✓/♥ marks are known before those tabs are visited.
  loadedPages.add('stockpile');
  syncStockpile(); // refreshes add-icons in other grids when it lands
  loadedPages.add('wishlist');
  syncWishlist();
  loadedPages.add('myschematics');
  loadMySchematics(); // wrench marks on the Schematics page need the crafting list

  showPage('resources'); // triggers the first load via PAGE_LOADERS
  fetchPulse();
  setInterval(fetchPulse, 3 * 60 * 1000); // every 3 min, matching the Tk app
  showBuildId();
  checkForUpdate();
  enforceMinShell();
}

async function boot() {
  initNav();
  initControls();
  initBroadcasts();
  initResources();
  initSchematics();
  initStockpile();
  initWishlist();
  initMySchematics();
  initSales();
  initInsights();
  initPurchases();
  initCharactersPage();
  initHarvesters();
  initInventory();
  initSettings();
  initAlerts();
  initLab();
  initMail();
  initScanner();
  initFactories();
  initDevMode();
  initAbout();
  refreshMonitorState(); // header button reflects auto-started monitoring
  initKeyGate();
  initPulseChart();
  initTooltips(); // WKWebView shows no native title tooltips
  initHelp();     // delegated — every [data-help] icon, now and later
  // thin client: confirm this UI booted (crash-rollback guard), then watch
  // for freshly installed bundles and offer a hot apply
  try { api().bundle_mark_ok(); } catch (_) { /* builtin UI — no-op */ }
  pollBundleState();
  $('#build-id').addEventListener('click', checkUpdatesNow);
  $('#bundle-id').addEventListener('click', checkUpdatesNow);

  // Seed pinned sets before the first grid renders (local config, no auth).
  try {
    const [resPins, schPins] = await Promise.all([
      api().get_pinned_resources(),
      api().get_pinned_schematics(),
    ]);
    if (resPins.ok) resState.pinned = new Set((resPins.data || []).map(String));
    if (schPins.ok) schState.pinned = new Set((schPins.data || []).map(String));
  } catch (_) { /* ignore */ }

  if (await apiKeyWorks()) {
    startData();
  } else {
    showKeyGate('');
  }
}

// pywebview injects the bridge asynchronously; wait for it.
if (window.pywebview && window.pywebview.api) {
  boot();
} else {
  window.addEventListener('pywebviewready', boot);
}
