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
  inventory: () => loadInventory(),
  alerts: () => loadAlerts(),
  lab: () => loadLab(),
  monitor: () => loadMail(),
  settings: () => loadSettings(),
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
  $('#side-collapse').addEventListener('click', () =>
    applyCollapsed(!sidebar.classList.contains('collapsed')));
  if (localStorage.getItem('sidebar-collapsed') === '1') applyCollapsed(true);
}

function showPage(key) {
  if (!document.getElementById(`page-${key}`)) return; // never blank the app on a bad key
  // Sub-pages (detail views) keep their parent sidebar item lit.
  const navKey = { schematic: 'schematics', resource: 'resources', myschematic: 'myschematics' }[key] || key;
  document.querySelectorAll('.nav-item').forEach((n) => n.classList.toggle('active', n.dataset.page === navKey));
  document.querySelectorAll('.page').forEach((p) => p.classList.toggle('active', p.id === `page-${key}`));
  // live-state pages reload on every visit, not just the first — mail uploads
  // and cron inventory depletion both move underneath a cached render
  const ALWAYS_RELOAD = new Set(['monitor', 'inventory']);
  if (PAGE_LOADERS[key] && (!loadedPages.has(key) || ALWAYS_RELOAD.has(key))) {
    loadedPages.add(key);
    PAGE_LOADERS[key]();
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
  try { res = await api().check_update(); } catch (_) { return; }
  const info = res.ok ? res.data : null;
  if (!info?.update_available) return;
  const chip = $('#update-chip');
  chip.hidden = false;
  chip.innerHTML = `<i class="fa-solid fa-circle-up"></i> Update v${escapeHtml(info.latest)}`;
  chip.title = info.notes || `Version ${info.latest} is available — click to download`;
  chip.onclick = () => api().open_external(info.url);
  // dim the build id once we know it's stale
  $('#build-id').classList.add('stale');
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
  return new Date(ts * 1000).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
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
    $('#pulse-online').textContent = `Players: ${(online.current || 0).toLocaleString()}`;
    $('#pulse-peak').textContent = `Peak today: ${(online.peak_today || 0).toLocaleString()}`;
    $('#pulse-resources').textContent = `Active resources: ${(res.data.active_resources || 0).toLocaleString()}`;
    drawPulseChart(online.history);
  } else {
    statusEl.textContent = 'Offline';
    statusEl.className = 'pulse-status offline';
    mini.classList.add('offline');
    mini.title = 'Server offline';
    $('#pulse-online').textContent = '';
    $('#pulse-peak').textContent = '';
    $('#pulse-resources').textContent = '';
  }
}

// ---- Dev mode ----
// 10 quick clicks on the logo toggles the dev wall (Test Connection,
// Simulate offline); 10 more hides it again. Persists across restarts.
function initDevMode() {
  if (localStorage.getItem('devMode') === '1') document.body.classList.add('dev-mode');
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
      toast(on ? 'Dev mode hidden' : 'Dev mode unlocked');
      if (on) $('#set-ds-simulate')?.checked && $('#set-ds-simulate').click(); // leaving dev mode ends the simulation too
    } else if (clicks >= 7) {
      toast(`${10 - clicks} more to ${on ? 'hide' : 'unlock'} dev mode`);
    }
  });
}

// ---- Header controls ----
function initControls() {
  $('#btn-test').addEventListener('click', async () => {
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
}

async function boot() {
  initNav();
  initControls();
  initResources();
  initSchematics();
  initStockpile();
  initWishlist();
  initMySchematics();
  initSales();
  initInventory();
  initSettings();
  initAlerts();
  initLab();
  initMail();
  initDevMode();
  refreshMonitorState(); // header button reflects auto-started monitoring
  initKeyGate();
  initPulseChart();
  initTooltips(); // WKWebView shows no native title tooltips

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
