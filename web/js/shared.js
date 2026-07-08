/* SWG Tracker Desktop — shared helpers.
   All web/js files are classic scripts loaded in order (see index.html), so
   top-level consts here are visible to every page controller. */

const api = () => window.pywebview.api;

// Forward JS errors to the Python log — the webview has no visible console.
window.addEventListener('error', (e) => {
  try { window.pywebview?.api?.log_js('error', `${e.message} @ ${e.filename}:${e.lineno}`); } catch (_) { /* ignore */ }
});
window.addEventListener('unhandledrejection', (e) => {
  const r = e.reason;
  try { window.pywebview?.api?.log_js('error', `unhandled rejection: ${(r && (r.stack || r.message)) || r}`); } catch (_) { /* ignore */ }
});
const $ = (sel) => document.querySelector(sel);
const safeInt = (v) => { const n = parseInt(v, 10); return Number.isFinite(n) ? n : 0; };

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

// planet_* config key -> site CSS class (front.css uses "yavin", not "yavin4")
const planetClass = (key) => key.replace('planet_', '').replace('yavin4', 'yavin');

const PLANET_FULL = {
  planet_corellia: 'Corellia', planet_dantooine: 'Dantooine', planet_dathomir: 'Dathomir',
  planet_endor: 'Endor', planet_lok: 'Lok', planet_naboo: 'Naboo',
  planet_rori: 'Rori', planet_talus: 'Talus', planet_tatooine: 'Tatooine',
  planet_yavin4: 'Yavin IV', planet_kashyyyk: 'Kashyyyk', planet_mustafar: 'Mustafar',
};

// Resource stat fields (shared by the resources + stockpile grids)
const STAT_FIELDS = new Set(['oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe', 'rating']);

// "Condition OQ=50% SR=50%" -> {oq:50, sr:50}. Shared by the schematic page's
// live formula toggles and My Schematics' upgrade analysis.
function parseFormulaWeights(label) {
  const w = {};
  for (const m of String(label || '').matchAll(/([A-Z]{2})=(\d+)%/g)) {
    w[m[1].toLowerCase()] = safeInt(m[2]);
  }
  return Object.keys(w).length ? w : null;
}

// Weighted quality = Σ weight% × (stat / stat_max × 1000), averaged over formulas.
// A stat the resource class can't have (stat_max == 0, e.g. steel has no PE) is
// dropped and the remaining weights renormalize — matching SWG experimentation,
// where a missing attribute is excluded rather than counted as a zero. rec needs
// stat + stat_max fields.
function weightedQuality(rec, weightsList) {
  if (!rec || !weightsList || !weightsList.length) return null;
  const per = weightsList.map((w) => {
    let q = 0, wsum = 0;
    for (const [stat, pct] of Object.entries(w)) {
      const cap = safeInt(rec[`${stat}_max`]);
      if (!cap) continue; // resource class lacks this attribute — renormalize it away
      q += (safeInt(rec[stat]) / cap) * 1000 * pct;
      wsum += pct;
    }
    return wsum ? q / wsum : 0;
  });
  return per.reduce((a, b) => a + b, 0) / per.length;
}

// Percent (0–100) of a stat's cap -> quality class.
// Thresholds reverse-engineered from the live site: great ≥96, good ≥90,
// fair ≥80, ok ≥50, poor <50. Blue (.q-better) is NOT part of this scale.
function qualityClass(pct) {
  if (pct >= 96) return 'q-great';
  if (pct >= 90) return 'q-good';
  if (pct >= 80) return 'q-fair';
  if (pct >= 50) return 'q-ok';
  return 'q-poor';
}

// Stat cell colored by % of the stat's cap (site formula); em-dash when zero.
function statCell(v, max) {
  const n = safeInt(v);
  if (n <= 0) return '<td class="stat stat_off">—</td>';
  const pct = (n / (safeInt(max) || 1000)) * 100;
  return `<td class="stat ${qualityClass(pct)}" title="${pct.toFixed(1)}%">${n}</td>`;
}

const fmtNum = (v) => (Number(v) || 0).toLocaleString();

// Site rule (functions.php ecpu_clamp): 0 = unvoted, estimates floor at 1,
// in-spawn estimates cap at 2 (8 on Mustafar). Returns 0 for unvoted.
function ecpuClamp(cpu, active, mustafar) {
  let c = Number(cpu) || 0;
  if (c <= 0) return 0;
  if (c < 1) c = 1;
  if (active) c = Math.min(c, mustafar ? 8 : 2);
  return Math.floor(c);
}

// Amount shorthand: "300k" → 300000, "4m" → 4000000, "4.5m" → 4500000,
// "1.2b" → 1.2e9; commas tolerated ("300,000"). Returns NaN when unparseable.
function parseAmount(text) {
  const s = String(text).trim().toLowerCase().replace(/,/g, '');
  const m = s.match(/^(-?\d+(?:\.\d+)?)\s*([kmb])?$/);
  if (!m) return NaN;
  const mult = { k: 1e3, m: 1e6, b: 1e9 }[m[2]] || 1;
  return parseFloat(m[1]) * mult;
}

// Unix seconds -> "06/14/26, 3:05 PM" (matches the Tk app's date column)
function fmtDate(ts) {
  const n = parseInt(ts, 10);
  if (!Number.isFinite(n) || n <= 0) return String(ts ?? '');
  return new Date(n * 1000).toLocaleString('en-US', {
    month: '2-digit', day: '2-digit', year: '2-digit',
    hour: 'numeric', minute: '2-digit',
  });
}

// Show a grid's loading overlay. The overlay is absolutely positioned inside
// .table-wrap (which is also the scroller), so it only covers the first
// viewport of content — scroll to the top so it covers what's on screen,
// which is where fresh results land anyway.
function showGridLoading(sel) {
  const el = $(sel);
  el.hidden = false;
  el.closest('.table-wrap')?.scrollTo(0, 0);
}

// Relative time ("2h ago") with the exact timestamp in the hover tip.
// Use anywhere a human-readable age is shown.
function fmtAgoTip(dt) {
  if (!dt) return '\u2014';
  const exact = /^\d+$/.test(String(dt)) ? fmtDate(dt) : String(dt);
  return `<span title="${escapeHtml(exact)}">${fmtAgo(dt)}</span>`;
}

// Transient toast, bottom-center (id #toast; class avoids Bootstrap's .toast)
let _toastTimer = null;
function toast(msg, ok = true) {
  let el = document.getElementById('toast');
  if (!el) {
    el = document.createElement('div');
    el.id = 'toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.className = `toast-msg ${ok ? 'ok' : 'err'} show`;
  clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => el.classList.remove('show'), 2500);
}

// Matches the API's 401 bodies: "Invalid API key" / "Missing API key"
const isAuthError = (err) => /api key/i.test(String(err || ''));

// Surface auth failures as the full-screen key gate (defined in app.js).
function checkAuthError(err) {
  if (isAuthError(err)) showKeyGate(String(err));
}

const IN_STOCK_TITLE = 'In stockpile — click to remove';

// Stockpile toggle cell for grid rows; shows ✓ when the resource is already stocked.
function addCellHtml(id, name) {
  const inStock = typeof stkState !== 'undefined' && stkState.resourceIds.has(String(id));
  return `<td class="pin-cell add-cell ${inStock ? 'in-stock' : ''}" data-add="${id}"
    data-name="${escapeHtml(name || '')}" title="${inStock ? IN_STOCK_TITLE : 'Add to stockpile'}">
    <i class="fa-solid ${inStock ? 'fa-check add-ok' : 'fa-plus'}"></i></td>`;
}

// Sync every visible [data-add] cell with the current stockpile membership set.
function refreshAddIcons() {
  if (typeof stkState === 'undefined') return;
  document.querySelectorAll('[data-add]').forEach((cell) => {
    const inStock = stkState.resourceIds.has(String(cell.dataset.add));
    cell.classList.toggle('in-stock', inStock);
    cell.title = inStock ? IN_STOCK_TITLE : 'Add to stockpile';
    const i = cell.querySelector('i');
    if (i) i.className = `fa-solid ${inStock ? 'fa-check add-ok' : 'fa-plus'}`;
  });
}

// Remove by resource id — looks up the stockpile entry from the synced set.
async function removeFromStockpileByResource(resourceId, name) {
  if (typeof stkState === 'undefined') return { ok: false, error: 'not ready' };
  const idx = stkState.items.findIndex((i) => String(i.id) === String(resourceId));
  if (idx < 0) {
    toast(`${name || 'Resource'} isn't in the synced stockpile yet — try the refresh button`, false);
    return { ok: false, error: 'not found' };
  }
  const item = stkState.items[idx];
  let res;
  try { res = await api().remove_from_stockpile(item.stockpile_id); }
  catch (e) { res = { ok: false, error: String(e) }; }
  try { api().log_js('info', `remove rid=${resourceId} sid=${item.stockpile_id} -> ok=${res.ok} err=${res.error}`); } catch (_) { /* ignore */ }
  if (res.ok) {
    stkState.items.splice(idx, 1);
    stkState.resourceIds.delete(String(resourceId));
    renderStockpile();
    refreshAddIcons();
    toast(`${item.name} removed from stockpile`);
  } else {
    toast(`Couldn't remove ${item.name}: ${res.error || 'server error'}`, false);
    checkAuthError(res.error);
  }
  return res;
}

// Shared click handler for [data-add] cells: + adds, ✓ removes.
async function handleAddCellClick(addCell) {
  const icon = addCell.querySelector('i');
  const inStock = addCell.classList.contains('in-stock');
  icon.className = 'fa-solid fa-hourglass-half';
  if (inStock) await removeFromStockpileByResource(addCell.dataset.add, addCell.dataset.name);
  else await addToStockpile(addCell.dataset.add, addCell.dataset.name);
  refreshAddIcons(); // settles the icon whatever happened
}

// ---- Wishlist toggles (mirror of the stockpile cell pattern) ----

function wishCellHtml(id, name) {
  const wished = typeof wishState !== 'undefined' && wishState.resourceIds.has(String(id));
  return `<td class="pin-cell wish-cell ${wished ? 'in-wish' : ''}" data-wish="${id}"
    data-name="${escapeHtml(name || '')}" title="${wished ? 'On wishlist — click to remove' : 'Add to wishlist'}">
    <i class="fa-${wished ? 'solid' : 'regular'} fa-heart"></i></td>`;
}

function refreshWishIcons() {
  if (typeof wishState === 'undefined') return;
  document.querySelectorAll('[data-wish]').forEach((cell) => {
    const wished = wishState.resourceIds.has(String(cell.dataset.wish));
    cell.classList.toggle('in-wish', wished);
    cell.title = wished ? 'On wishlist — click to remove' : 'Add to wishlist';
    const i = cell.querySelector('i');
    if (i) i.className = `fa-${wished ? 'solid' : 'regular'} fa-heart`;
  });
}

async function addToWishlist(resourceId, name) {
  let res;
  try { res = await api().add_to_wishlist(resourceId); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (res.ok) {
    toast(`${name || 'Resource'} added to wishlist`);
    wishState.resourceIds.add(String(resourceId)); // optimistic; sync confirms
    refreshWishIcons();
    syncWishlist();
  } else {
    // 409 explains which list it's already on — show it verbatim
    toast(`Couldn't add ${name || 'resource'}: ${res.error || 'server error'}`, false);
    checkAuthError(res.error);
  }
  return res;
}

async function removeFromWishlistByResource(resourceId, name) {
  if (typeof wishState === 'undefined') return { ok: false, error: 'not ready' };
  const idx = wishState.items.findIndex((i) => String(i.id) === String(resourceId));
  if (idx < 0) {
    toast(`${name || 'Resource'} isn't in the synced wishlist yet — try the refresh button`, false);
    return { ok: false, error: 'not found' };
  }
  const item = wishState.items[idx];
  let res;
  try { res = await api().remove_from_wishlist(item.wishlist_id); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (res.ok) {
    wishState.items.splice(idx, 1);
    wishState.resourceIds.delete(String(resourceId));
    renderWishlist();
    refreshWishIcons();
    toast(`${item.name} removed from wishlist`);
  } else {
    toast(`Couldn't remove ${item.name}: ${res.error || 'server error'}`, false);
    checkAuthError(res.error);
  }
  return res;
}

async function handleWishCellClick(cell) {
  const icon = cell.querySelector('i');
  const wished = cell.classList.contains('in-wish');
  icon.className = 'fa-solid fa-hourglass-half';
  if (wished) await removeFromWishlistByResource(cell.dataset.wish, cell.dataset.name);
  else await addToWishlist(cell.dataset.wish, cell.dataset.name);
  refreshWishIcons();
}

// Add a resource to the stockpile (used by resources grid, schematic page, resource page).
async function addToStockpile(resourceId, name) {
  // One-list rule: a wished resource gets PROMOTED instead of re-added.
  if (typeof wishState !== 'undefined' && wishState.resourceIds.has(String(resourceId))) {
    const idx = wishState.items.findIndex((i) => String(i.id) === String(resourceId));
    if (idx >= 0) return promoteWishItem(idx);
  }
  let res;
  try { res = await api().add_to_stockpile(resourceId); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (res.ok) {
    toast(`${name || 'Resource'} added to stockpile`);
    if (typeof stkState !== 'undefined') {
      stkState.resourceIds.add(String(resourceId)); // optimistic; sync below confirms
      refreshAddIcons();
      syncStockpile();
    }
  } else {
    toast(`Couldn't add ${name || 'resource'}: ${res.error || 'server error'}`, false);
    checkAuthError(res.error);
  }
  return res;
}

// WKWebView never renders native title="" tooltips — this replaces them all.
// Titles migrate lazily to data-tip on first hover, so dynamically re-rendered
// rows and JS-updated titles keep working with zero call-site changes.
function initTooltips() {
  const tip = document.createElement('div');
  tip.className = 'app-tip';
  tip.hidden = true;
  document.body.appendChild(tip);

  document.addEventListener('mouseover', (e) => {
    const el = e.target.closest?.('[title], [data-tip]');
    if (!el) { tip.hidden = true; return; }
    if (el.hasAttribute('title')) {
      el.dataset.tip = el.getAttribute('title');
      el.removeAttribute('title');
    }
    const text = el.dataset.tip;
    if (!text) { tip.hidden = true; return; }
    tip.textContent = text;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    const x = Math.max(6, Math.min(window.innerWidth - tw - 6, r.left + r.width / 2 - tw / 2));
    const y = r.top - th - 6 < 4 ? r.bottom + 6 : r.top - th - 6;
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
  });
  document.addEventListener('mouseout', () => { tip.hidden = true; });
  document.addEventListener('click', () => { tip.hidden = true; }, true);
}

// Two-step destructive click: first arms the cell (red pulse), second within
// 2.5s confirms. Returns true only on the confirming click.
function confirmArm(cell, title = 'Click again to confirm delete') {
  if (cell.classList.contains('confirm-del')) return true;
  cell.classList.add('confirm-del');
  const prev = cell.title;
  cell.title = title;
  setTimeout(() => {
    cell.classList.remove('confirm-del');
    cell.title = prev;
  }, 2500);
  return false;
}

// Pre-reserve the width the armed "Confirm …?" label needs: a hidden zero-height
// ghost of the confirm markup keeps the button's natural width ≥ armed width, so
// arming never resizes the button. Call after (re)writing a confirm button's label.
function reserveConfirmWidth(btn, label = 'Confirm remove?') {
  btn.insertAdjacentHTML('beforeend',
    `<span class="confirm-ghost"><i class="fa-solid fa-triangle-exclamation"></i> ${label}</span>`);
}

// Labeled-button confirm: label flips to "Confirm …?" with a draining
// background bar showing the window; reverts quietly on timeout.
// Returns true only on the confirming click.
function confirmArmLabeled(btn, label = 'Confirm remove?') {
  if (btn.classList.contains('confirming')) {
    clearTimeout(btn._confirmTimer);
    btn.classList.remove('confirming');
    btn.style.width = '';
    // restore synchronously — a leftover absolute .confirm-bar without the
    // .confirming positioning context paints a huge red flash
    btn.innerHTML = btn._confirmOrig || btn.innerHTML;
    return true;
  }
  const orig = btn.innerHTML;
  btn._confirmOrig = orig;
  const idleWidth = btn.offsetWidth;
  btn.classList.add('confirming');
  btn.innerHTML = `<span class="confirm-bar"></span>
    <span class="confirm-label"><i class="fa-solid fa-triangle-exclamation"></i> ${label}</span>`;
  // lock the width so the countdown doesn't jitter under the cursor, but never
  // below what the confirm label needs — .confirming's overflow:hidden would clip it
  btn.style.width = '';
  btn.style.width = `${Math.max(idleWidth, btn.offsetWidth)}px`;
  btn._confirmTimer = setTimeout(() => {
    btn.classList.remove('confirming');
    btn.style.width = '';
    btn.innerHTML = orig;
  }, 2500);
  return false;
}

// Relative "time ago" from a unix timestamp or "YYYY-MM-DD HH:MM:SS" string.
function fmtAgo(dt) {
  if (!dt) return '';
  const d = /^\d+$/.test(String(dt))
    ? new Date(parseInt(dt, 10) * 1000)
    : new Date(String(dt).replace(' ', 'T')); // WebKit can't parse the space form
  if (Number.isNaN(d.getTime())) return String(dt);
  const s = Math.floor((Date.now() - d.getTime()) / 1000);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days}d ago`;
  const mo = Math.floor(days / 30);
  if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}

// Sortable-header helper: renders <th> labels with an arrow on the active column.
function sortableHeaderHtml(columns, sortField, sortOrder, leadingHtml = '') {
  return leadingHtml + columns.map(([label, field, cls, tip]) => {
    const arrow = field === sortField ? (sortOrder === 'ASC' ? ' ▲' : ' ▼') : '';
    const icon = tip ? ` <i class="fa-solid fa-circle-info info-tip"></i>` : '';
    return `<th class="${cls || ''}" data-sort="${field}"${tip ? ` title="${escapeHtml(tip)}"` : ''}>${label}${icon}${arrow}</th>`;
  }).join('');
}
