/* Sidebar layout — ONE source of truth for the menu's order: `nav_layout` in config
   (mirrored to localStorage for an instant boot). The HTML's menu is only the
   default; at boot the list is rebuilt from the saved layout, and Edit mode (the
   pencil in the menu's foot, or Settings › Menu layout) lets you drag pages
   between folders or to the top level and drag folders to reorder. Reset puts the
   HTML default back. Pages added in a later version slot into their default spot.

   layout = { entries: [ { page: 'home' } | { group: 'galaxy', label, icon, items: ['pulse', …] } … ] }
   Folders carry their label + icon (the HTML's for built-ins, yours for ones you create:
   group ids 'custom-<n>'). Rename / re-icon any folder; custom ones can be deleted. */

const navLayoutState = { def: null, editing: false, drag: null, dlgGroup: null, dlgIcon: '' };
const NAV_FOLDER_ICONS = ['fa-folder', 'fa-star', 'fa-bolt', 'fa-gem', 'fa-scroll', 'fa-hammer', 'fa-flask', 'fa-map-location-dot', 'fa-city', 'fa-shield-halved',
  'fa-coins', 'fa-paw', 'fa-dog', 'fa-dragon', 'fa-box-open', 'fa-store', 'fa-tags', 'fa-building', 'fa-toolbox', 'fa-users', 'fa-envelope', 'fa-note-sticky',
  'fa-wand-magic-sparkles', 'fa-terminal', 'fa-bell', 'fa-gear', 'fa-heart', 'fa-cubes', 'fa-tractor', 'fa-industry', 'fa-chart-line', 'fa-cart-shopping',
  'fa-warehouse', 'fa-user-group', 'fa-fire', 'fa-rocket', 'fa-crown', 'fa-bookmark', 'fa-compass', 'fa-earth-americas', 'fa-layer-group', 'fa-list', 'fa-circle-dot', 'fa-jedi'];
const navHeadLabel = (h) => [...h.childNodes].filter((n) => n.nodeType === Node.TEXT_NODE).map((n) => n.textContent).join(' ').trim();
const navHeadIcon = (h) => { const i = h.querySelector('i:first-child'); return i ? [...i.classList].find((c) => c.startsWith('fa-') && c !== 'fa-solid') || 'fa-folder' : 'fa-folder'; };
// a folder head's markup (built once, re-skinned on rename): icon, label, caret, dot, edit-mode tools
function navHeadFill(h, label, icon) {
  h.innerHTML = `<i class="fa-solid ${escapeHtml(icon || 'fa-folder')}"></i> ${escapeHtml(label)} <span class="nav-head-tools"><a role="button" data-navedit title="Rename or change the icon"><i class="fa-solid fa-pen"></i></a>${h.dataset.navgroup.startsWith('custom-') ? '<a role="button" data-navdel title="Delete this folder (its pages move to the top level)"><i class="fa-solid fa-xmark"></i></a>' : ''}</span><i class="fa-solid fa-caret-down nav-group-caret"></i><span class="nav-group-dot" hidden></span>`;
  h.title = label;
}

// read the menu as it stands in the DOM
function navLayoutFromDom() {
  const entries = [];
  let cur = null;
  document.querySelectorAll('.app-sidebar .nav-list > li').forEach((li) => {
    if (li.classList.contains('nav-group-head')) { cur = { group: li.dataset.navgroup, label: navHeadLabel(li), icon: navHeadIcon(li), items: [] }; entries.push(cur); return; }
    if (!li.dataset.page) return;
    if (li.dataset.group && cur && cur.group === li.dataset.group) cur.items.push(li.dataset.page);
    else { cur = null; entries.push({ page: li.dataset.page }); }
  });
  return { entries };
}

// saved layout + anything the default knows that the saved one doesn't (new pages/folders)
function navLayoutMerge(saved) {
  const def = navLayoutState.def;
  const pages = new Set(); const groups = new Set();
  def.entries.forEach((e) => { if (e.page) pages.add(e.page); else { groups.add(e.group); e.items.forEach((p) => pages.add(p)); } });
  const out = { entries: [] }; const placed = new Set(); const placedGroups = new Set();
  const defGroup = (g) => def.entries.find((x) => x.group === g) || {};
  (saved && Array.isArray(saved.entries) ? saved.entries : []).forEach((e) => {
    if (e && e.page && pages.has(e.page) && !placed.has(e.page)) { out.entries.push({ page: e.page }); placed.add(e.page); }
    else if (e && e.group && (groups.has(e.group) || String(e.group).startsWith('custom-')) && !placedGroups.has(e.group)) {
      const items = (Array.isArray(e.items) ? e.items : []).filter((p) => pages.has(p) && !placed.has(p));
      items.forEach((p) => placed.add(p));
      out.entries.push({ group: e.group, label: String(e.label || defGroup(e.group).label || 'Folder').slice(0, 24), icon: NAV_FOLDER_ICONS.includes(e.icon) ? e.icon : (defGroup(e.group).icon || 'fa-folder'), items });
      placedGroups.add(e.group);
    }
  });
  // leftovers go where the default puts them: into their default folder if it exists, else at the end
  def.entries.forEach((e) => {
    if (e.page) { if (!placed.has(e.page)) { out.entries.push({ page: e.page }); placed.add(e.page); } return; }
    let g = out.entries.find((x) => x.group === e.group);
    if (!g) { g = { group: e.group, label: e.label, icon: e.icon, items: [] }; out.entries.push(g); placedGroups.add(e.group); }
    e.items.forEach((p) => { if (!placed.has(p)) { g.items.push(p); placed.add(p); } });
  });
  return out;
}

// rebuild the DOM list in the layout's order (the <li>s are moved, never recreated —
// their pills, listeners and fold state ride along)
function navLayoutApply(layout) {
  const ul = document.querySelector('.app-sidebar .nav-list');
  const heads = {}; const items = {};
  ul.querySelectorAll('.nav-group-head').forEach((h) => { heads[h.dataset.navgroup] = h; });
  ul.querySelectorAll('.nav-item[data-page]').forEach((i) => { items[i.dataset.page] = i; });
  const frag = document.createDocumentFragment();
  const keepHeads = new Set();
  layout.entries.forEach((e) => {
    if (e.page) {
      const li = items[e.page]; if (!li) return;
      delete li.dataset.group; li.classList.remove('nav-group-item'); li.style.display = '';
      frag.appendChild(li);
    } else {
      let h = heads[e.group];
      if (!h) {
        if (!String(e.group).startsWith('custom-')) return;
        h = document.createElement('li'); h.className = 'nav-group-head'; h.dataset.navgroup = e.group; heads[e.group] = h;
      }
      keepHeads.add(e.group);
      navHeadFill(h, e.label || navHeadLabel(h) || 'Folder', e.icon || navHeadIcon(h));
      if (typeof navGroupWire === 'function') navGroupWire(h);
      frag.appendChild(h);
      e.items.forEach((p) => {
        const li = items[p]; if (!li) return;
        li.dataset.group = e.group; li.classList.add('nav-group-item');
        li.style.display = h.classList.contains('collapsed') && !navLayoutState.editing ? 'none' : '';
        frag.appendChild(li);
      });
    }
  });
  ul.appendChild(frag);
  Object.keys(heads).forEach((g) => { if (g.startsWith('custom-') && !keepHeads.has(g)) heads[g].remove(); }); // deleted / reset-away folders
  if (typeof syncNavGroupDots === 'function') syncNavGroupDots();
  if (typeof navSearchApply === 'function' && $('#nav-search') && $('#nav-search').value) navSearchApply();
}

function navLayoutSave() {
  const layout = navLayoutFromDom();
  try { localStorage.setItem('nav_layout', JSON.stringify(layout)); } catch (_) {}
  try { api().set_config('nav_layout', layout); } catch (_) {}
}
function navLayoutReset() {
  try { localStorage.removeItem('nav_layout'); } catch (_) {}
  try { api().set_config('nav_layout', null); } catch (_) {}
  navLayoutApply(navLayoutState.def);
  toast('Menu back to the default layout');
}

// ---- edit mode: drag pages and folders around ----
function navEditSet(on) {
  navLayoutState.editing = on;
  const sb = document.querySelector('.app-sidebar');
  sb.classList.toggle('nav-editing', on);
  document.querySelectorAll('.app-sidebar .nav-item[data-page], .app-sidebar .nav-group-head').forEach((li) => {
    li.draggable = on;
    if (on) li.style.display = ''; // every item visible while editing, even in folded folders
  });
  if (!on) {
    // folded folders hide their items again
    document.querySelectorAll('.nav-group-head.collapsed').forEach((h) => {
      document.querySelectorAll(`.nav-item[data-group="${h.dataset.navgroup}"]`).forEach((el) => { el.style.display = 'none'; });
    });
  }
  const bar = $('#nav-edit-bar');
  if (bar) bar.hidden = !on;
  const sbtn = $('#set-menu-edit');
  if (sbtn) sbtn.innerHTML = on ? '<i class="fa-solid fa-check"></i> Done editing' : '<i class="fa-solid fa-pen"></i> Edit the menu';
}

// the block a group head drags with: the head + its items
function navGroupBlock(head) {
  const out = [head]; let n = head.nextElementSibling;
  while (n && n.dataset.group === head.dataset.navgroup) { out.push(n); n = n.nextElementSibling; }
  return out;
}

// ---- folder dialog: new folder, or rename / re-icon an existing one ----
function navFolderDialog(groupId) {
  const modal = $('#navfolder-modal'); if (!modal) return;
  const head = groupId ? document.querySelector(`.nav-group-head[data-navgroup="${groupId}"]`) : null;
  navLayoutState.dlgGroup = groupId || null;
  navLayoutState.dlgIcon = head ? navHeadIcon(head) : 'fa-folder';
  $('#navfolder-title').textContent = head ? 'Edit folder' : 'New folder';
  $('#navfolder-name').value = head ? navHeadLabel(head) : '';
  $('#navfolder-icons').innerHTML = NAV_FOLDER_ICONS.map((ic) => `<button type="button" class="navfolder-ico${ic === navLayoutState.dlgIcon ? ' active' : ''}" data-ico="${ic}" title="${ic.replace('fa-', '')}"><i class="fa-solid ${ic}"></i></button>`).join('');
  $('#navfolder-delete').hidden = !(groupId && groupId.startsWith('custom-'));
  modal.hidden = false;
  $('#navfolder-name').focus(); $('#navfolder-name').select();
}
function navFolderSave() {
  const name = $('#navfolder-name').value.trim().slice(0, 24);
  if (!name) { $('#navfolder-name').focus(); return; }
  const ul = document.querySelector('.app-sidebar .nav-list');
  let head = navLayoutState.dlgGroup ? ul.querySelector(`.nav-group-head[data-navgroup="${navLayoutState.dlgGroup}"]`) : null;
  if (!head) {
    head = document.createElement('li'); head.className = 'nav-group-head'; head.dataset.navgroup = `custom-${Date.now().toString(36)}`;
    ul.appendChild(head); // a new folder lands at the bottom — drag it where you want it
    if (typeof navGroupWire === 'function') navGroupWire(head);
    head.draggable = navLayoutState.editing;
  }
  navHeadFill(head, name, navLayoutState.dlgIcon);
  $('#navfolder-modal').hidden = true;
  navLayoutSave();
  if (typeof syncNavGroupDots === 'function') syncNavGroupDots();
}
function navFolderDelete() {
  const g = navLayoutState.dlgGroup; if (!g || !g.startsWith('custom-')) return;
  const ul = document.querySelector('.app-sidebar .nav-list');
  const head = ul.querySelector(`.nav-group-head[data-navgroup="${g}"]`); if (!head) return;
  navGroupBlock(head).slice(1).forEach((li) => { delete li.dataset.group; li.classList.remove('nav-group-item'); li.style.display = ''; }); // pages stay put, now top-level
  head.remove();
  $('#navfolder-modal').hidden = true;
  navLayoutSave();
}

function initNavLayout() {
  // built-in heads get the shared markup (edit tools included); their HTML label/icon is the default
  document.querySelectorAll('.app-sidebar .nav-group-head').forEach((h) => navHeadFill(h, navHeadLabel(h), navHeadIcon(h)));
  navLayoutState.def = navLayoutFromDom();
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('nav_layout') || 'null'); } catch (_) {}
  if (saved) navLayoutApply(navLayoutMerge(saved));
  // the durable copy wins once it answers
  (async () => {
    try {
      const cfg = await api().get_config();
      const v = cfg && cfg.ok && cfg.data ? cfg.data.nav_layout : undefined;
      if (v === undefined) return;
      if (v === null) { if (saved) { try { localStorage.removeItem('nav_layout'); } catch (_) {} navLayoutApply(navLayoutState.def); } return; }
      const merged = navLayoutMerge(v);
      if (JSON.stringify(merged) === JSON.stringify(navLayoutFromDom())) return;
      navLayoutApply(merged);
      try { localStorage.setItem('nav_layout', JSON.stringify(merged)); } catch (_) {}
      // folds were applied against the old order — redo them for the moved items
      document.querySelectorAll('.nav-group-head[data-navgroup]').forEach((h) => { if (typeof navGroupApply === 'function') navGroupApply(h, h.classList.contains('collapsed')); });
    } catch (_) { /* localStorage stands */ }
  })();

  const ul = document.querySelector('.app-sidebar .nav-list');
  // edit mode starts from Settings (no standing button in the menu — wasted space, Dustin);
  // the foot grows a Done / Reset line only while editing
  $('#nav-edit-done')?.addEventListener('click', () => navEditSet(false));
  $('#nav-edit-reset')?.addEventListener('click', navLayoutReset);
  $('#set-menu-edit')?.addEventListener('click', () => {
    const sb = document.querySelector('.app-sidebar');
    if (sb.classList.contains('collapsed')) $('#side-collapse').click(); // editing needs the labels
    navEditSet(!navLayoutState.editing);
  });
  $('#set-menu-reset')?.addEventListener('click', navLayoutReset);

  // clicks don't navigate while editing (a drag that ends in place is a click) — but the
  // head's pencil / × do their jobs
  ul.addEventListener('click', (e) => {
    if (!navLayoutState.editing) return;
    e.stopPropagation(); e.preventDefault();
    const ed = e.target.closest('[data-navedit]'); const del = e.target.closest('[data-navdel]');
    const head = e.target.closest('.nav-group-head');
    if (ed && head) navFolderDialog(head.dataset.navgroup);
    else if (del && head) { navLayoutState.dlgGroup = head.dataset.navgroup; navFolderDelete(); }
  }, true);
  $('#nav-edit-newfolder')?.addEventListener('click', () => navFolderDialog(null));
  $('#navfolder-save')?.addEventListener('click', navFolderSave);
  $('#navfolder-cancel')?.addEventListener('click', () => { $('#navfolder-modal').hidden = true; });
  $('#navfolder-delete')?.addEventListener('click', navFolderDelete);
  $('#navfolder-icons')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-ico]'); if (!b) return;
    navLayoutState.dlgIcon = b.dataset.ico;
    document.querySelectorAll('#navfolder-icons .navfolder-ico').forEach((x) => x.classList.toggle('active', x === b));
  });
  $('#navfolder-modal')?.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.id === 'navfolder-name') navFolderSave(); if (e.key === 'Escape') $('#navfolder-modal').hidden = true; });
  $('#navfolder-modal')?.addEventListener('click', (e) => { if (e.target === $('#navfolder-modal')) $('#navfolder-modal').hidden = true; });

  ul.addEventListener('dragstart', (e) => {
    if (!navLayoutState.editing) { e.preventDefault(); return; }
    const li = e.target.closest('li'); if (!li) return;
    navLayoutState.drag = li;
    li.classList.add('nav-dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', li.dataset.page || li.dataset.navgroup || ''); } catch (_) {}
  });
  ul.addEventListener('dragend', () => {
    const d = navLayoutState.drag; navLayoutState.drag = null;
    if (d) d.classList.remove('nav-dragging');
    ul.querySelectorAll('.nav-drop-before, .nav-drop-after, .nav-drop-into').forEach((x) => x.classList.remove('nav-drop-before', 'nav-drop-after', 'nav-drop-into'));
  });
  ul.addEventListener('dragover', (e) => {
    const d = navLayoutState.drag; if (!d) return;
    const over = e.target.closest('li'); if (!over || over === d) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'move';
    ul.querySelectorAll('.nav-drop-before, .nav-drop-after, .nav-drop-into').forEach((x) => x.classList.remove('nav-drop-before', 'nav-drop-after', 'nav-drop-into'));
    const r = over.getBoundingClientRect();
    const dragIsGroup = d.classList.contains('nav-group-head');
    if (!dragIsGroup && over.classList.contains('nav-group-head')) {
      // a page over a folder head: top third = above the folder, else = first in the folder
      over.classList.add(e.clientY < r.top + r.height / 3 ? 'nav-drop-before' : 'nav-drop-into');
      return;
    }
    over.classList.add(e.clientY < r.top + r.height / 2 ? 'nav-drop-before' : 'nav-drop-after');
  });
  ul.addEventListener('drop', (e) => {
    const d = navLayoutState.drag; if (!d) return;
    const over = e.target.closest('li'); if (!over || over === d) return;
    e.preventDefault();
    const r = over.getBoundingClientRect();
    const dragIsGroup = d.classList.contains('nav-group-head');
    const overIsHead = over.classList.contains('nav-group-head');
    const block = dragIsGroup ? navGroupBlock(d) : [d];
    if (!dragIsGroup && overIsHead && e.clientY >= r.top + r.height / 3) {
      // into the folder, first
      d.dataset.group = over.dataset.navgroup; d.classList.add('nav-group-item');
      over.after(d);
    } else {
      const before = e.clientY < r.top + r.height / 2;
      // where a GROUP lands it must not split another folder: target the whole block
      let anchor = over;
      if (dragIsGroup && !overIsHead && over.dataset.group) {
        const head = ul.querySelector(`.nav-group-head[data-navgroup="${over.dataset.group}"]`);
        const b = navGroupBlock(head); anchor = before ? head : b[b.length - 1];
      } else if (dragIsGroup && overIsHead && !before) {
        const b = navGroupBlock(over); anchor = b[b.length - 1];
      }
      if (!dragIsGroup) {
        // a page adopts the folder of what it lands next to (or none at the top level)
        const g = overIsHead ? (before ? '' : over.dataset.navgroup) : (over.dataset.group || '');
        if (g) { d.dataset.group = g; d.classList.add('nav-group-item'); } else { delete d.dataset.group; d.classList.remove('nav-group-item'); }
      }
      if (before) anchor.before(...block); else anchor.after(...block);
    }
    navLayoutSave();
    if (typeof syncNavGroupDots === 'function') syncNavGroupDots();
  });
}
