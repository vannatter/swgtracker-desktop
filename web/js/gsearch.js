/* Global search — the website's "press S" search, in the app's top bar: one box
   that finds resources, schematics, guilds, cities, pets, creatures and specials
   (api/search.php, like the site) plus the app's own pages, grouped by kind.
   Arrows + Enter pick, Esc closes, S from anywhere focuses it. */

const gsState = { timer: null, seq: 0, items: [], index: -1, open: false };
const GS_ICONS = {
  Page: 'fa-solid fa-window-maximize', Resource: 'fa-solid fa-gem', Schematic: 'fa-solid fa-scroll',
  Guild: 'fa-solid fa-shield-halved', City: 'fa-solid fa-city', Pet: 'fa-solid fa-dog',
  Creature: 'fa-solid fa-dragon', Special: 'fa-solid fa-bolt',
};

// the app's own pages, from the sidebar (folder name rides along for matching)
function gsPageMatches(q) {
  const out = [];
  document.querySelectorAll('.app-sidebar .nav-item[data-page]').forEach((item) => {
    const label = [...item.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
    const head = item.dataset.group ? document.querySelector(`.nav-group-head[data-navgroup="${item.dataset.group}"]`) : null;
    const folder = head ? [...head.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' ').trim() : '';
    if (label.toLowerCase().includes(q)) out.push({ type: 'Page', name: label, detail: folder, page: item.dataset.page });
  });
  return out.slice(0, 5);
}

function gsClose() {
  gsState.open = false; gsState.index = -1; gsState.items = [];
  $('#gs-results').hidden = true;
  $('#gs-results').innerHTML = '';
}
// the field flies out of the magnifier button and folds back when done
function gsOpenBox() {
  const wrap = document.querySelector('.gs-wrap');
  wrap.classList.add('open');
  const input = $('#gs-input');
  input.focus(); input.select();
}
function gsCloseBox() {
  const wrap = document.querySelector('.gs-wrap');
  wrap.classList.remove('open');
  $('#gs-input').value = '';
  gsClose();
  $('#gs-input').blur();
}

function gsRender() {
  const box = $('#gs-results');
  if (!gsState.items.length) {
    box.innerHTML = '<div class="gs-empty">No results</div>';
  } else {
    let last = ''; let html = '';
    gsState.items.forEach((r, i) => {
      if (r.type !== last) { html += `<div class="gs-cat">${escapeHtml(r.type)}s</div>`; last = r.type; }
      const dot = r.type === 'Resource' ? `<i class="fa-solid fa-circle res-status ${String(r.status) === '1' ? 'on' : 'off'} gs-dot" title="${String(r.status) === '1' ? 'In spawn' : 'Despawned'}"></i>` : '';
      html += `<div class="gs-item${i === gsState.index ? ' active' : ''}" data-gsi="${i}">
        <i class="${GS_ICONS[r.type] || 'fa-solid fa-circle'} gs-item-ico"></i>
        <span class="gs-name">${escapeHtml(r.name)}${dot}</span>
        <span class="gs-detail">${escapeHtml(r.detail || '')}</span></div>`;
    });
    box.innerHTML = html;
  }
  box.hidden = false; gsState.open = true;
}

function gsHighlight(i) {
  gsState.index = i;
  document.querySelectorAll('#gs-results .gs-item').forEach((el) => el.classList.toggle('active', safeInt(el.dataset.gsi) === i));
  const el = document.querySelector(`#gs-results .gs-item[data-gsi="${i}"]`);
  if (el) el.scrollIntoView({ block: 'nearest' });
}

// take the user to the picked result — every kind lands on its app page
function gsOpen(r) {
  const setSearch = (sel, value) => { const el = $(sel); if (el) { el.value = value; el.dispatchEvent(new Event('input')); } };
  switch (r.type) {
    case 'Page': showPage(r.page); break;
    case 'Resource': openResourcePage(r.name); break;
    case 'Schematic': {
      const id = r.id || safeInt(String(r.url || '').replace(/^.*[?&]s=/, ''));
      if (id) openSchematicPage(id, r.name);
      break;
    }
    case 'Guild': showPage('guilds'); setSearch('#guilds-search', r.name.replace(/\s*\[[^\]]*\]\s*$/, '')); break;
    case 'City': showPage('cities'); setSearch('#cities-search', r.name); break;
    case 'Pet': if (r.data && r.data.slug) openPetPage(r.data.slug); break;
    case 'Creature': if (r.data && r.data.slug) openCreaturePage(r.data.slug); break;
    case 'Special': if (r.data && r.data.name) openSpecialPage(r.data.name, r.data.rank); break;
    default: break;
  }
  gsCloseBox();
}

async function gsSearch() {
  const q = ($('#gs-input').value || '').trim();
  const my = ++gsState.seq;
  if (q.length < 2) { gsClose(); return; }
  const pages = gsPageMatches(q.toLowerCase());
  gsState.items = pages; gsState.index = -1;
  gsRender();
  $('#gs-results').insertAdjacentHTML('beforeend', '<div class="gs-loading"><span class="spinner"></span></div>');
  let res;
  try { res = await apiFetch('GET', 'api/search.php', { params: { q } }); } catch (e) { res = { ok: false }; }
  if (my !== gsState.seq) return; // a newer keystroke won
  const rows = (res.ok && res.data && res.data.results) || [];
  gsState.items = pages.concat(rows);
  gsState.index = -1;
  gsRender();
  if (!res.ok) $('#gs-results').insertAdjacentHTML('afterbegin', `<div class="gs-empty gs-err">${escapeHtml(res.error || 'Search is offline')}</div>`);
}

function initGlobalSearch() {
  const input = $('#gs-input');
  const box = $('#gs-results');
  if (!input) return;
  input.addEventListener('input', () => {
    clearTimeout(gsState.timer);
    gsState.timer = setTimeout(gsSearch, 220);
  });
  input.addEventListener('focus', () => { if (gsState.items.length) gsRender(); });
  input.addEventListener('keydown', (e) => {
    const n = gsState.items.length;
    if (e.key === 'Escape') { if (gsState.open) gsClose(); else gsCloseBox(); return; }
    if (e.key === 'ArrowDown' && n) { e.preventDefault(); gsHighlight(Math.min(gsState.index + 1, n - 1)); return; }
    if (e.key === 'ArrowUp' && n) { e.preventDefault(); gsHighlight(Math.max(gsState.index - 1, 0)); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      const r = gsState.items[gsState.index >= 0 ? gsState.index : 0];
      if (r) gsOpen(r);
    }
  });
  box.addEventListener('mousedown', (e) => e.preventDefault()); // keep the input's focus while clicking
  box.addEventListener('click', (e) => {
    const it = e.target.closest('[data-gsi]');
    if (it) gsOpen(gsState.items[safeInt(it.dataset.gsi)]);
  });
  $('#gs-btn').addEventListener('click', () => {
    if (document.querySelector('.gs-wrap').classList.contains('open')) gsCloseBox(); else gsOpenBox();
  });
  $('#gs-close').addEventListener('click', gsCloseBox);
  // leaving an empty field folds it away; a filled one stays until Esc or ×
  input.addEventListener('blur', () => { setTimeout(() => { if (document.activeElement !== input && !input.value.trim()) gsCloseBox(); }, 120); });
  document.addEventListener('click', (e) => { if (!e.target.closest('.gs-wrap')) { if (gsState.open) gsClose(); if (!input.value.trim()) gsCloseBox(); } });
  // the S shortcut (configurable) lives in shortcuts.js
}
