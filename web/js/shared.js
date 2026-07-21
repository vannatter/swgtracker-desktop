/* SWG Tracker Desktop — shared helpers.
   All web/js files are classic scripts loaded in order (see index.html), so
   top-level consts here are visible to every page controller. */

const api = () => window.pywebview.api;

// Generic gateway to the swgtracker.com API. Prefer this for NEW endpoints so they
// ride the auto-updating UI bundle and don't need a client/shell download. Falls back
// cleanly if the running shell predates the gateway (older .app + freshly-pulled UI).
//   apiFetch('POST', 'api/foo.php', { data: {...} })
//   apiFetch('GET',  'api/foo.php', { params: {...} })
function apiFetch(method, endpoint, opts = {}) {
  const bridge = api();
  if (!bridge || typeof bridge.api_request !== 'function') {
    return Promise.resolve({ ok: false, error: 'This needs a newer app version — please update the desktop client.' });
  }
  return bridge.api_request(method, endpoint, opts.data ?? null, opts.params ?? null);
}

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
// The GAME's experimentation math, verified against the server's resourceQuality
// (2919/2950 rows exact across 40 schematics; the rest are one server-side
// anomaly where even the game reports >1000):
//  - each stat is relative to the SCHEMATIC SLOT's required class cap (`caps`,
//    from CLASS_CAPS by slot class code — e.g. Beyrllius Copper caps SR at 483,
//    so SR 475 ≈ 983). NOT the resource's own subclass caps (the old bug that
//    inflated low-cap resources), and not raw /1000 unless the slot class caps
//    at 1000 (most parent classes do). caps == null falls back to raw.
//  - a stat the resource doesn't have (value 0, or slot cap 0) is dropped and
//    its weight redistributes across the present stats
//  - when EVERY weighted stat is present, the printed percents apply literally
//    over 100 — so "CD=33 OQ=33 SR=33" really loses 1% (Σ=99), like in game
function weightedQuality(rec, weightsList, caps = null) {
  if (!rec || !weightsList || !weightsList.length) return null;
  const per = weightsList.map((w) => {
    let q = 0, wsum = 0, missing = false;
    for (const [stat, pct] of Object.entries(w)) {
      const v = safeInt(rec[stat]);
      const cap = caps ? safeInt(caps[stat]) : 1000;
      if (v <= 0 || cap <= 0) { missing = true; continue; }
      q += (v / cap) * 1000 * pct;
      wsum += pct;
    }
    if (!wsum) return 0;
    return Math.min(1000, q / (missing ? wsum : 100));
  });
  return per.reduce((a, b) => a + b, 0) / per.length;
}

// Class pool from the offline mirror, best-first, with the user's stockpile
// ids always included. Prefers the generic mirror bridge (bundle-shaped);
// pre-v0.11.26 shells fall back to the fixed-shape pool (no stockpile merge).
async function classPool(code, stockIds = []) {
  if (typeof api().ds_resources_query === 'function') {
    return api().ds_resources_query({
      category: String(code), status: '', sort: 'value_rating', order: 'DESC',
      limit: 4000, ids: stockIds,
    });
  }
  return api().get_class_pool(String(code));
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

// Compact amount for tight cells: 4532100 -> "4.5m", 300000 -> "300k", 950 -> "950".
// Mirrors the 300k/4.5m shorthand used for stockpile amounts.
function fmtShort(v) {
  const n = Number(v) || 0;
  const a = Math.abs(n);
  if (a >= 1e9) return (n / 1e9).toFixed(a >= 1e10 ? 0 : 1).replace(/\.0$/, '') + 'b';
  if (a >= 1e6) return (n / 1e6).toFixed(a >= 1e7 ? 0 : 1).replace(/\.0$/, '') + 'm';
  if (a >= 1e3) return (n / 1e3).toFixed(a >= 1e4 ? 0 : 1).replace(/\.0$/, '') + 'k';
  return String(Math.round(n));
}

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

// Date format preference — 'us' MM/DD/YY or 'intl' DD/MM/YY (Settings).
// localStorage-cached so the very first paint already uses it.
let appDateFmt = localStorage.getItem('dateFormat') === 'intl' ? 'intl' : 'us';
function setDateFormat(fmt) {
  appDateFmt = fmt === 'intl' ? 'intl' : 'us';
  localStorage.setItem('dateFormat', appDateFmt);
}

// Unix seconds OR a server "YYYY-MM-DD HH:MM:SS" string -> Date (null if neither).
// Server datetimes are UTC but arrive zoneless; WebKit can't parse the space form
// and a naive parse reads as LOCAL — normalise to T-form and pin to UTC.
function parseAnyDate(dt) {
  if (dt == null || dt === '') return null;
  if (/^\d+$/.test(String(dt))) {
    const n = parseInt(dt, 10);
    return n > 0 ? new Date(n * 1000) : null;
  }
  let str = String(dt).replace(' ', 'T');
  if (!/[zZ]|[+-]\d\d:?\d\d$/.test(str)) str += 'Z';
  const d = new Date(str);
  return Number.isNaN(d.getTime()) ? null : d;
}

// -> "06/14/26, 3:05 PM" (or "14/06/26, 15:05" international) — EVERY visual
// date goes through here so the Settings date-format pick applies everywhere
function fmtDate(ts) {
  const d = parseAnyDate(ts);
  if (!d) return String(ts ?? '');
  return d.toLocaleString(appDateFmt === 'intl' ? 'en-GB' : 'en-US', {
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
  return `<span title="${escapeHtml(fmtDate(dt))}">${fmtAgo(dt)}</span>`;
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
const ADD_TITLE = 'Add to stockpile — ⌘/Ctrl-click to set amount + CPU';

// Stockpile toggle cell for grid rows; shows ✓ when the resource is already stocked.
function addCellHtml(id, name) {
  const inStock = typeof stkState !== 'undefined' && stkState.resourceIds.has(String(id));
  return `<td class="pin-cell add-cell ${inStock ? 'in-stock' : ''}" data-add="${id}"
    data-name="${escapeHtml(name || '')}" title="${inStock ? IN_STOCK_TITLE : ADD_TITLE}">
    <i class="fa-solid ${inStock ? 'fa-check add-ok' : 'fa-plus'}"></i></td>`;
}

// Sync every visible [data-add] cell with the current stockpile membership set.
function refreshAddIcons() {
  if (typeof stkState === 'undefined') return;
  document.querySelectorAll('[data-add]').forEach((cell) => {
    const inStock = stkState.resourceIds.has(String(cell.dataset.add));
    cell.classList.toggle('in-stock', inStock);
    cell.title = inStock ? IN_STOCK_TITLE : ADD_TITLE;
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

// Shared click handler for [data-add] cells (event optional).
//  ✓ in-stock  → removal, gated behind a confirming second click
//  + add       → instant add, or ⌘/Ctrl-click opens the amount+CPU dialog
async function handleAddCellClick(addCell, event) {
  if (addCell.classList.contains('in-stock')) {
    // Removal is destructive — arm on the first click, act on the second.
    if (!confirmArm(addCell, 'Click again to remove from stockpile')) return;
    addCell.classList.remove('confirm-del'); // stop the pulse now that it's confirmed
    const icon = addCell.querySelector('i');
    if (icon) icon.className = 'fa-solid fa-hourglass-half';
    await removeFromStockpileByResource(addCell.dataset.add, addCell.dataset.name);
    refreshAddIcons();
    return;
  }
  if (event && (event.metaKey || event.ctrlKey)) {
    openStockpileAddDialog(addCell.dataset.add, addCell.dataset.name, refreshAddIcons);
    return;
  }
  const icon = addCell.querySelector('i');
  if (icon) icon.className = 'fa-solid fa-hourglass-half';
  await addToStockpile(addCell.dataset.add, addCell.dataset.name);
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
// opts (optional): { stock, my_cpu } — initial amount / cost-per-unit applied right
// after the add. Either may be omitted; both omitted = a plain add.
async function addToStockpile(resourceId, name, opts) {
  // One-list rule: a wished resource gets PROMOTED instead of re-added.
  let res = null;
  let promoted = false;
  if (typeof wishState !== 'undefined' && wishState.resourceIds.has(String(resourceId))) {
    const idx = wishState.items.findIndex((i) => String(i.id) === String(resourceId));
    if (idx >= 0) { res = await promoteWishItem(idx); promoted = true; }
  }
  if (!promoted) {
    try { res = await api().add_to_stockpile(resourceId); }
    catch (e) { res = { ok: false, error: String(e) }; }
    if (!res.ok && /already in stockpile/i.test(res.error || '')) {
      // One-list quirk: the server keeps wishlist + stockpile in ONE table, so
      // a WISHLISTED resource 409s as "already in stockpile" — misleading when
      // our local wishlist state was stale (fresh boot, hopper-empty flow).
      // Resync and promote: what the branch above would have done.
      try { await syncWishlist(); } catch (_) { /* offline — keep the 409 */ }
      if (typeof wishState !== 'undefined') {
        const idx = wishState.items.findIndex((i) => String(i.id) === String(resourceId));
        if (idx >= 0) { res = await promoteWishItem(idx); promoted = true; }
      }
    }
    if (!promoted) {
      if (res.ok) {
        toast(`${name || 'Resource'} added to stockpile`);
        if (typeof stkState !== 'undefined') {
          stkState.resourceIds.add(String(resourceId)); // optimistic; sync below confirms
          refreshAddIcons();
        }
      } else {
        toast(`Couldn't add ${name || 'resource'}: ${res.error || 'server error'}`, false);
        checkAuthError(res.error);
        return res;
      }
    }
  }
  if (typeof stkState !== 'undefined' && res && res.ok) {
    const hasInitial = opts && (opts.stock != null || opts.my_cpu !== undefined);
    if (hasInitial) await applyStockpileInitial(resourceId, opts); // syncs, then sets values
    else if (!promoted) syncStockpile(); // promote already synced
  }
  return res;
}

// After an add/promote, push the dialog's initial amount / CPU onto the fresh row.
// Needs the server-assigned stockpile_id, so it syncs first, then updates.
async function applyStockpileInitial(resourceId, opts) {
  await syncStockpile();
  const item = stkState.items.find((i) => String(i.id) === String(resourceId));
  if (!item) return;
  const stock = opts.stock != null ? opts.stock : null;
  try {
    // update_stockpile(sid, stock, my_cpu); my_cpu defaults server-side when omitted
    const res = opts.my_cpu !== undefined
      ? await api().update_stockpile(item.stockpile_id, stock, opts.my_cpu)
      : await api().update_stockpile(item.stockpile_id, stock);
    if (res && res.ok) {
      if (stock != null) item.stock = stock;
      if (opts.my_cpu !== undefined) item.my_cpu = opts.my_cpu;
      if (typeof renderStockpile === 'function') renderStockpile();
      const bits = [];
      if (stock != null) bits.push(`amount ${fmtNum(stock)}`);
      if (opts.my_cpu !== undefined) bits.push(`CPU ${opts.my_cpu}`);
      if (bits.length) toast(`${item.name}: ${bits.join(', ')} set`);
    }
  } catch (_) { /* the add already succeeded — leave initial values unset */ }
}

// Shared "Add to Stockpile" dialog. Amount + CPU are optional; cancelling or
// leaving both blank still stockpiles the resource (only the initial values differ).
// onDone (optional) fires after the add resolves — used to refresh button state.
function openStockpileAddDialog(resourceId, name, onDone, prefill) {
  const modal = $('#stk-add-modal');
  if (!modal) { addToStockpile(resourceId, name).then(() => onDone && onDone()); return; }
  $('#stk-add-title').textContent = name || 'this resource';
  const amountInput = $('#stk-add-amount');
  const cpuInput = $('#stk-add-cpu');
  // prefill.stock: e.g. the scanner's Resource Quantity — shown pre-selected
  // so it's one Enter to accept and typing replaces it wholesale.
  amountInput.value = prefill && prefill.stock != null ? String(prefill.stock) : '';
  cpuInput.value = '';
  modal.hidden = false;
  amountInput.focus();
  if (amountInput.value) amountInput.select();

  let done = false;
  // withValues=false (cancel/backdrop/Esc): add with no initial amount/CPU.
  const commit = async (withValues) => {
    if (done) return;
    done = true;
    cleanup();
    modal.hidden = true;
    let opts;
    if (withValues) {
      opts = {};
      const rawAmt = amountInput.value.trim();
      if (rawAmt !== '') {
        const parsed = Math.round(parseAmount(rawAmt));
        if (Number.isNaN(parsed)) toast(`Couldn't read "${rawAmt}" — try 300000, 300k, or 4.5m`, false);
        else opts.stock = parsed;
      }
      const rawCpu = cpuInput.value.trim();
      if (rawCpu !== '') {
        const cpu = Number(rawCpu);
        if (Number.isNaN(cpu) || cpu < 0) toast(`"${rawCpu}" isn't a cost — use a number like 2 or 4.5`, false);
        else opts.my_cpu = cpu;
      }
    }
    await addToStockpile(resourceId, name, opts);
    if (onDone) onDone();
  };

  const onKey = (e) => {
    if (e.key === 'Enter') commit(true);
    else if (e.key === 'Escape') commit(false);
  };
  const onBackdrop = (e) => { if (e.target === modal) commit(false); };
  const onSave = () => commit(true);
  const onCancel = () => commit(false);
  function cleanup() {
    modal.removeEventListener('keydown', onKey);
    modal.removeEventListener('click', onBackdrop);
    $('#stk-add-confirm').removeEventListener('click', onSave);
    $('#stk-add-cancel').removeEventListener('click', onCancel);
  }
  modal.addEventListener('keydown', onKey);
  modal.addEventListener('click', onBackdrop);
  $('#stk-add-confirm').addEventListener('click', onSave);
  $('#stk-add-cancel').addEventListener('click', onCancel);
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
    const el = e.target.closest?.('[title], [data-tip], [data-richtip], [data-help]');
    if (!el) { tip.hidden = true; return; }
    if (el.hasAttribute('title')) {
      el.dataset.tip = el.getAttribute('title');
      el.removeAttribute('title');
    }
    // data-richtip carries pre-built (already-escaped) HTML — the multi-line
    // resource cards; data-tip stays plain text
    const rich = el.dataset.richtip;
    // help icons keep their summary in the topic registry rather than the
    // markup, so it stays right when a topic is edited. Looked up per hover,
    // never stamped onto the element — topics can load in after this point.
    let text = el.dataset.tip;
    if (!text && el.dataset.help && typeof helpSummary === 'function') text = helpSummary(el.dataset.help);
    if (!rich && !text) { tip.hidden = true; return; }
    tip.classList.toggle('app-tip-rich', !!rich);
    if (rich) tip.innerHTML = rich; else tip.textContent = text;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const th = tip.offsetHeight;
    let x, y;
    if (rich) {
      // dock beside the cell's CONTENT (a Range rect ends where the text ends,
      // not where the padded column ends), arrow pointing back at it
      let a = r;
      try {
        const range = document.createRange();
        range.selectNodeContents(el);
        const tr = range.getBoundingClientRect();
        if (tr.width || tr.height) a = tr;
      } catch (_) { /* fall back to the element rect */ }
      x = a.right + 12;
      let side = 'right';
      if (x + tw > window.innerWidth - 6) { x = Math.max(6, a.left - tw - 12); side = 'left'; }
      y = Math.max(4, Math.min(window.innerHeight - th - 4, a.top + a.height / 2 - th / 2));
      tip.classList.toggle('tip-side-right', side === 'right');
      tip.classList.toggle('tip-side-left', side === 'left');
    } else {
      x = Math.max(6, Math.min(window.innerWidth - tw - 6, r.left + r.width / 2 - tw / 2));
      y = r.top - th - 6 < 4 ? r.bottom + 6 : r.top - th - 6;
    }
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

// Pre-reserve the width the armed "Confirm …?" label needs as a min-width, so arming
// never resizes the button. Measured with an off-screen ghost that is removed right
// away — a persistent ghost would become a stray flex item inside the (flex) button
// and add a phantom gap. Call after (re)writing a confirm button's label.
function reserveConfirmWidth(btn, label = 'Confirm remove?') {
  const ghost = document.createElement('span');
  ghost.style.cssText = 'position:absolute;left:-9999px;white-space:nowrap;';
  ghost.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> ${label}`;
  btn.appendChild(ghost);
  const content = ghost.offsetWidth;
  ghost.remove();
  const cs = getComputedStyle(btn);
  const padX = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight)
    + parseFloat(cs.borderLeftWidth) + parseFloat(cs.borderRightWidth);
  btn.style.minWidth = `${Math.ceil(content + padX)}px`;
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

// ---- list groups (stockpile-style folders, api/groups.php) -----------------
// Generic folders shared by Harvesters and Factories: real server rows, so a
// group exists while empty, renames in one place, and members carry group_id.

const grpApi = (body) => apiFetch('POST', 'api/groups.php', { data: body });

async function grpList(kind) {
  try {
    const r = await apiFetch('GET', 'api/groups.php', { params: { kind } });
    return (r.ok && r.data && r.data.groups) || [];
  } catch (_) { return []; }  // older site deploy — pages just render flat
}

// section header bar, styled to match My Stockpile's folder rows: accent
// stripe, caret collapses, name renames inline, trash (far right) deletes —
// members fall back to Unfiled. key 'un' = the fixed Unfiled section.
function grpHeaderHtml(key, name, count, collapsed, noun = 'items') {
  return `<div class="grp-hd" data-grpkey="${key}">
    <i class="fa-solid ${collapsed ? 'fa-caret-right' : 'fa-caret-down'} grp-caret" data-grptoggle="${key}" title="${collapsed ? 'Expand' : 'Collapse'}"></i>
    ${key === 'un'
      ? `<span class="grp-name grp-name-unfiled">${escapeHtml(name)}</span>`
      : `<span class="grp-name" data-grprename="${key}" title="Click to rename">${escapeHtml(name)}</span>`}
    <span class="grp-count">${count} item${count === 1 ? '' : 's'}</span>
    ${key === 'un' ? ''
      : `<button class="grp-del" data-grpdel="${key}" title="Delete group — its ${noun} become Unfiled"><i class="fa-solid fa-trash-can"></i></button>`}
  </div>`;
}

// swap a header's name span for an input; commit on blur/Enter, cancel on Esc
function grpBeginRename(listSel, key, g, rerender) {
  const span = $(`${listSel} [data-grprename="${key}"]`);
  if (!span || !g) return;
  span.outerHTML = `<input type="text" class="form-control filter-input grp-rename-input"
    data-grprenamein="${key}" value="${escapeHtml(g.name)}" maxlength="64" spellcheck="false">`;
  const input = $(`${listSel} [data-grprenamein="${key}"]`);
  input.focus();
  input.select();
  input.addEventListener('blur', async () => {
    const name = input.value.trim();
    if (name && name !== g.name) {
      g.name = name; // optimistic
      await grpApi({ action: 'rename', id: g.id, name });
    }
    rerender();
  });
  input.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter') input.blur();
    if (ev.key === 'Escape') { input.value = g.name; input.blur(); }
  });
}

// split items into ordered sections: one per group (sort_order), Ungrouped
// last. Ungrouped also swallows members whose group vanished. getGid reads the
// member's group id. The 'un' section only appears when it has members or is
// the only section.
function grpSections(groups, items, getGid) {
  const ordered = [...groups].sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name));
  const live = new Set(ordered.map((g) => String(g.id)));
  const sections = ordered.map((g) => ({ key: String(g.id), g, name: g.name,
    items: items.filter((it) => String(getGid(it) || '') === String(g.id)) }));
  const unfiled = items.filter((it) => !getGid(it) || !live.has(String(getGid(it))));
  if (unfiled.length || !sections.length) sections.push({ key: 'un', g: null, name: 'Unfiled', items: unfiled });
  return sections;
}

// Relative "time ago" from a unix timestamp or "YYYY-MM-DD HH:MM:SS" string.
function fmtAgo(dt) {
  if (!dt) return '';
  const d = parseAnyDate(dt);
  if (!d) return String(dt);
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
