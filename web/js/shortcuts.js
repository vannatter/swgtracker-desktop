/* Keyboard shortcuts — every page and the two search boxes can be bound to a key
   or combo, edited under Settings › Keyboard shortcuts. Defaults mirror the
   website: S = search, / = menu filter, plus H/R/C for Home, Resources and
   Schematics. Stored in localStorage (instant) and config (durable), as one map
   of action id → combo ('' = unbound). Combos are "meta+shift+k"-style strings. */

const SHORTCUT_DEFAULTS = { search: 's', navfilter: '/', 'page:home': 'h', 'page:resources': 'r', 'page:schematics': 'c' };
let shortcutMap = Object.assign({}, SHORTCUT_DEFAULTS);
const scState = { capturing: null }; // action id while a chip waits for a key

const scIsMac = /Mac|iPhone|iPad/.test(navigator.platform);
const SC_KEY_NAMES = { ' ': 'Space', arrowleft: '←', arrowright: '→', arrowup: '↑', arrowdown: '↓', escape: 'Esc', enter: 'Enter', tab: 'Tab', backspace: '⌫', delete: 'Del' };

// the bindable actions: the fixed two, then every sidebar page in menu order
function scActions() {
  const out = [
    { id: 'search', label: 'Global search', hint: 'open the top-bar search', run: () => { if (typeof gsOpenBox === 'function') gsOpenBox(); } },
    { id: 'navfilter', label: 'Menu filter', hint: 'focus the sidebar search', run: () => { const i = $('#nav-search'); if (i && !document.querySelector('.app-sidebar').classList.contains('collapsed')) { i.focus(); i.select(); } } },
  ];
  document.querySelectorAll('.app-sidebar .nav-item[data-page]').forEach((item) => {
    const label = [...item.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
    const page = item.dataset.page;
    out.push({ id: `page:${page}`, label, hint: 'open the page', group: item.dataset.group || '', run: () => showPage(page) });
  });
  return out;
}

function scComboFromEvent(e) {
  const k = String(e.key || '').toLowerCase();
  if (['meta', 'control', 'alt', 'shift', 'capslock', 'fn'].includes(k)) return null; // a modifier alone isn't a combo
  const mods = [];
  if (e.metaKey) mods.push('meta');
  if (e.ctrlKey) mods.push('ctrl');
  if (e.altKey) mods.push('alt');
  if (e.shiftKey && k.length !== 1 || (e.shiftKey && /[a-z0-9]/.test(k))) mods.push('shift'); // "shift+/" is just "?" — only letters/digits/special keys keep shift
  return mods.concat([k]).join('+');
}
function scLabel(combo) {
  if (!combo) return '';
  return combo.split('+').map((p) => {
    if (p === 'meta') return scIsMac ? '⌘' : 'Win';
    if (p === 'ctrl') return scIsMac ? '⌃' : 'Ctrl';
    if (p === 'alt') return scIsMac ? '⌥' : 'Alt';
    if (p === 'shift') return scIsMac ? '⇧' : 'Shift';
    return SC_KEY_NAMES[p] || (p.length === 1 ? p.toUpperCase() : p);
  }).join(scIsMac ? '' : '+');
}

function scLoad() {
  try { const m = JSON.parse(localStorage.getItem('shortcuts') || 'null'); if (m && typeof m === 'object') shortcutMap = Object.assign({}, SHORTCUT_DEFAULTS, m); } catch (_) { /* defaults stand */ }
  scApply();
  (async () => {
    try {
      const cfg = await api().get_config();
      const m = cfg && cfg.ok && cfg.data && cfg.data.shortcuts;
      if (m && typeof m === 'object') { shortcutMap = Object.assign({}, SHORTCUT_DEFAULTS, m); scApply(); renderShortcutSettings(); }
    } catch (_) { /* localStorage stands */ }
  })();
}
function scSave() {
  try { localStorage.setItem('shortcuts', JSON.stringify(shortcutMap)); } catch (_) { /* ignore */ }
  try { api().set_config('shortcuts', shortcutMap); } catch (_) { /* ignore */ }
  scApply();
}
// surfaces that mention their key: the top-bar search placeholder
function scApply() {
  const btn = $('#gs-btn');
  if (btn) btn.title = `Search${shortcutMap.search ? ` (${scLabel(shortcutMap.search)})` : ''}`;
  // a bound page wears its key as a tiny pill at the right of its menu row
  document.querySelectorAll('.app-sidebar .nav-item[data-page]').forEach((item) => {
    const combo = shortcutMap[`page:${item.dataset.page}`] || '';
    let pill = item.querySelector('.nav-key');
    if (!combo) { if (pill) pill.remove(); return; }
    if (!pill) { pill = document.createElement('span'); pill.className = 'nav-key'; item.appendChild(pill); }
    pill.textContent = scLabel(combo);
    pill.title = `Press ${scLabel(combo)} to open`;
  });
}

function scHandleKey(e) {
  if (scState.capturing) return; // the settings chip owns this press
  const combo = scComboFromEvent(e);
  if (!combo) return;
  const hit = Object.keys(shortcutMap).find((id) => shortcutMap[id] === combo);
  if (!hit) return;
  const el = document.activeElement;
  const typing = el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  if (typing && !/meta|ctrl|alt/.test(combo)) return; // plain keys type into fields
  if (document.querySelector('.key-gate:not([hidden])')) return; // a dialog owns the keyboard
  const action = scActions().find((a) => a.id === hit);
  if (!action) return;
  e.preventDefault();
  action.run();
}

// ---- Settings › Keyboard shortcuts ----
function renderShortcutSettings() {
  const host = $('#set-shortcuts');
  if (!host) return;
  const groups = {};
  document.querySelectorAll('.nav-group-head[data-navgroup]').forEach((h) => {
    groups[h.dataset.navgroup] = [...h.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' ').trim();
  });
  let lastGroup = null;
  host.innerHTML = scActions().map((a) => {
    const combo = shortcutMap[a.id] || '';
    const def = SHORTCUT_DEFAULTS[a.id] || '';
    const g = a.group || (a.id.startsWith('page:') ? '' : 'actions');
    let head = '';
    if (g !== lastGroup) { head = `<div class="sc-group">${escapeHtml(g === 'actions' ? 'Actions' : (groups[g] || 'Pages'))}</div>`; lastGroup = g; }
    return `${head}<div class="sc-row${scState.capturing === a.id ? ' capturing' : ''}" data-scrow="${escapeHtml(a.id)}">
      <span class="sc-label">${escapeHtml(a.label)} <span class="settings-sub">${escapeHtml(a.hint)}</span></span>
      <button type="button" class="sc-chip${combo ? '' : ' sc-chip-empty'}" data-sccap="${escapeHtml(a.id)}" title="Click, then press the key or combo you want">${scState.capturing === a.id ? 'Press keys…' : (combo ? escapeHtml(scLabel(combo)) : 'none')}</button>
      <button type="button" class="btn btn-icon sc-clear" data-scclear="${escapeHtml(a.id)}" title="Remove this shortcut"${combo ? '' : ' hidden'}><i class="fa-solid fa-xmark"></i></button>
      <button type="button" class="btn btn-icon sc-reset" data-screset="${escapeHtml(a.id)}" title="Back to the default (${escapeHtml(scLabel(def) || 'none')})"${combo === def ? ' hidden' : ''}><i class="fa-solid fa-rotate-left"></i></button>
    </div>`;
  }).join('');
}

function scAssign(id, combo) {
  // one key, one job — taking a combo from another action frees it there
  Object.keys(shortcutMap).forEach((other) => { if (other !== id && combo && shortcutMap[other] === combo) { shortcutMap[other] = ''; toast(`${scLabel(combo)} moved from ${(scActions().find((a) => a.id === other) || {}).label || other}`); } });
  shortcutMap[id] = combo;
  scSave();
  renderShortcutSettings();
}

function initShortcuts() {
  scLoad();
  document.addEventListener('keydown', scHandleKey);
  // capture-phase listener: while a chip is armed, the next press becomes its combo
  document.addEventListener('keydown', (e) => {
    if (!scState.capturing) return;
    e.preventDefault(); e.stopPropagation();
    const k = String(e.key || '').toLowerCase();
    if (k === 'escape') { scState.capturing = null; renderShortcutSettings(); return; }
    if (k === 'backspace' || k === 'delete') { const id = scState.capturing; scState.capturing = null; scAssign(id, ''); return; }
    const combo = scComboFromEvent(e);
    if (!combo) return; // modifier alone — keep waiting
    const id = scState.capturing; scState.capturing = null;
    scAssign(id, combo);
  }, true);
  const host = $('#set-shortcuts');
  if (host) {
    host.addEventListener('click', (e) => {
      const cap = e.target.closest('[data-sccap]');
      if (cap) { scState.capturing = scState.capturing === cap.dataset.sccap ? null : cap.dataset.sccap; renderShortcutSettings(); return; }
      const clr = e.target.closest('[data-scclear]');
      if (clr) { scAssign(clr.dataset.scclear, ''); return; }
      const rst = e.target.closest('[data-screset]');
      if (rst) scAssign(rst.dataset.screset, SHORTCUT_DEFAULTS[rst.dataset.screset] || '');
    });
    document.addEventListener('click', (e) => { if (scState.capturing && !e.target.closest('[data-sccap]')) { scState.capturing = null; renderShortcutSettings(); } });
    $('#set-shortcuts-reset')?.addEventListener('click', () => { shortcutMap = Object.assign({}, SHORTCUT_DEFAULTS); scSave(); renderShortcutSettings(); toast('Shortcuts back to defaults'); });
    renderShortcutSettings();
  }
}
