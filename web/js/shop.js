/* Shortlist — compare / shop mode for resources. A basket cell beside the
   stockpile and wishlist cells (list, cards, tree, the resource page) adds a
   resource to the list; the Shortlist page groups the list by resource class
   and, where a class has two or more, lays them side by side with the best value
   in every stat flagged and the best overall by Score crowned — so three Talusian
   Avian Meats become one glance. The list (ids + names) lives in config, mirrored
   to localStorage; live stats are fetched on every visit. */

const shopState = { items: new Map(), loaded: false, rows: [], loading: false, dirty: false, sort: {}, // sort: group key -> { field, order }
  level: localStorage.getItem('shop_level') || 'class', collapsed: null };

// ---- the resource class tree (restree_data.js ships with the app): code -> { name, parent, depth } ----
let shopTreeIdx = null;
function shopTree() {
  if (shopTreeIdx) return shopTreeIdx;
  shopTreeIdx = {};
  if (typeof RESTREE_ROWS !== 'undefined') RESTREE_ROWS.forEach(([code, name, parent, depth]) => { shopTreeIdx[code] = { code, name, parent, depth }; });
  return shopTreeIdx;
}
// the chain from a leaf type up to its kingdom: [leaf, parent, …, kingdom]
function shopChain(code) {
  const t = shopTree(); const out = []; let n = t[code]; let guard = 0;
  while (n && guard++ < 12) { out.push(n); n = n.parent ? t[n.parent] : null; }
  return out;
}
// which group a resource lands in at the chosen level
function shopGroupFor(r) {
  const lvl = shopState.level;
  if (lvl === 'all') return { key: 'all', name: 'Everything shortlisted', code: '' };
  const chain = shopChain(r.type_code);
  if (lvl === 'class' || !chain.length) return { key: r.type_code || r.type_name || 'other', name: r.type_name || 'Unknown', code: r.type_code || '' };
  const depth = safeInt(lvl.replace('d:', ''));
  const node = chain.find((n) => n.depth === depth) || chain[0]; // a shallower leaf stays itself
  return { key: node.code, name: node.name, code: node.code };
}
// the level picker lists the ancestor depths actually present in the list, named by what's there
function shopFillLevels() {
  const sel = $('#shop-level'); if (!sel) return;
  const byDepth = new Map();
  shopState.rows.forEach((r) => shopChain(r.type_code).slice(1).forEach((n) => { if (!byDepth.has(n.depth)) byDepth.set(n.depth, new Set()); byDepth.get(n.depth).add(n.name); }));
  const depths = [...byDepth.keys()].sort((a, b) => b - a);
  const opts = ['<option value="class">By class</option>']
    .concat(depths.map((d) => { const names = [...byDepth.get(d)]; const label = names.slice(0, 3).join(' · ') + (names.length > 3 ? ` · +${names.length - 3}` : ''); return `<option value="d:${d}">${escapeHtml(label)}</option>`; }))
    .concat(['<option value="all">Everything together</option>']);
  sel.innerHTML = opts.join('');
  sel.value = shopState.level;
  if (sel.value !== shopState.level) { shopState.level = 'class'; sel.value = 'class'; }
}
function shopCollapsedSet() {
  if (!shopState.collapsed) { let c = []; try { c = JSON.parse(localStorage.getItem('shop_collapsed') || '[]'); } catch (_) {} shopState.collapsed = new Set(Array.isArray(c) ? c : []); }
  return shopState.collapsed;
}
const SHOP_STATS = ['oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe'];

// ---- persistence ----
function shopLoadItems() {
  try { const a = JSON.parse(localStorage.getItem('shop_list') || 'null'); if (Array.isArray(a)) shopState.items = new Map(a.map((x) => [String(x.id), String(x.name || '')])); } catch (_) {}
  (async () => {
    try {
      const cfg = await api().get_config();
      const a = cfg && cfg.ok && cfg.data ? cfg.data.shop_list : undefined;
      if (Array.isArray(a)) { shopState.items = new Map(a.map((x) => [String(x.id), String(x.name || '')])); shopSyncUi(); }
    } catch (_) { /* localStorage stands */ }
  })();
}
function shopSaveItems() {
  const arr = [...shopState.items].map(([id, name]) => ({ id: safeInt(id), name }));
  try { localStorage.setItem('shop_list', JSON.stringify(arr)); } catch (_) {}
  try { api().set_config('shop_list', arr); } catch (_) {}
}
const shopHas = (id) => shopState.items.has(String(id));

// add / remove, from any basket (cell, card icon, page button)
function shopToggle(id, name) {
  const key = String(id);
  if (!key || key === 'undefined') return;
  if (shopState.items.has(key)) { shopState.items.delete(key); toast(`${name || 'Resource'} taken off the shortlist`); }
  else { shopState.items.set(key, String(name || '')); toast(`${name || 'Resource'} shortlisted`); }
  shopSaveItems();
  shopState.dirty = true;
  shopSyncUi();
  if (document.getElementById('page-shop')?.classList.contains('active')) loadShop(true);
}
function shopSyncUi() { refreshShopIcons(); shopUpdatePill(); shopSyncRdButton(); }

// ---- the basket cell / icon, like addCellHtml + wishCellHtml ----
const SHOP_ON_TITLE = 'On your shortlist — click to remove';
const SHOP_OFF_TITLE = 'Shortlist it to compare with others of its class';
function shopCellHtml(id, name) {
  const on = shopHas(id);
  return `<td class="pin-cell shop-cell ${on ? 'in-shop' : ''}" data-shop="${escapeHtml(String(id ?? ''))}" data-name="${escapeHtml(name || '')}" title="${on ? SHOP_ON_TITLE : SHOP_OFF_TITLE}"><i class="fa-solid fa-scale-balanced"></i></td>`;
}
function shopIconHtml(id, name, cls = '') {
  const on = shopHas(id);
  return `<i class="fa-solid fa-scale-balanced shop-ico ${cls} ${on ? 'in-shop' : ''}" data-shop="${escapeHtml(String(id ?? ''))}" data-name="${escapeHtml(name || '')}" title="${on ? SHOP_ON_TITLE : SHOP_OFF_TITLE}"></i>`;
}
function refreshShopIcons() {
  document.querySelectorAll('[data-shop]').forEach((el) => {
    const on = shopHas(el.dataset.shop);
    el.classList.toggle('in-shop', on);
    el.title = on ? SHOP_ON_TITLE : SHOP_OFF_TITLE;
  });
}
function shopUpdatePill() {
  const p = $('#nav-shop-pill');
  if (!p) return;
  const n = shopState.items.size;
  p.textContent = n;
  p.hidden = n <= 0;
  p.title = `${n} resource${n === 1 ? '' : 's'} on your shortlist`;
  if (typeof syncNavTips === 'function') syncNavTips();
}
// the resource page's Compare button follows the list
function shopSyncRdButton() {
  const btn = $('#rd-shop');
  if (!btn || typeof rdState === 'undefined' || !rdState.id) return;
  const on = shopHas(rdState.id);
  btn.hidden = false;
  btn.classList.toggle('in-shop', on);
  btn.innerHTML = on ? '<i class="fa-solid fa-scale-balanced"></i> Shortlisted — Remove' : '<i class="fa-solid fa-scale-balanced"></i> Shortlist';
  btn.title = on ? SHOP_ON_TITLE : SHOP_OFF_TITLE;
}

// ---- the page ----
async function loadShop(force = false) {
  const ids = [...shopState.items.keys()].filter((k) => safeInt(k) > 0);
  $('#shop-count').textContent = ids.length ? `${ids.length} resource${ids.length === 1 ? '' : 's'}` : '';
  $('#shop-clear').hidden = !ids.length;
  if (!ids.length) { shopState.rows = []; renderShop(); return; }
  if (shopState.loading) return;
  shopState.loading = true;
  $('#shop-loading').hidden = false; $('#shop-empty').hidden = true;
  let res;
  try { res = await apiFetch('GET', 'api/resources.php', { params: { ids: ids.join(','), status: 'all', perpage: 500 } }); }
  catch (e) { res = { ok: false, error: String(e) }; }
  shopState.loading = false;
  $('#shop-loading').hidden = true;
  if (!res.ok || !res.data) {
    $('#shop-empty').textContent = `Error: ${res.error || 'failed to load'}`; $('#shop-empty').hidden = false; return;
  }
  const d = res.data;
  shopState.rows = d.results || d.resources || (Array.isArray(d) ? d : []);
  shopState.loaded = true; shopState.dirty = false;
  renderShop();
}

function shopPlanetNames(r) {
  if (typeof PLANET_KEYS === 'undefined') return '';
  return PLANET_KEYS.filter((k) => String(r[k] ?? '0') === '1').map((k) => PLANET_FULL[k]).join(', ');
}
function shopCost(r) {
  const active = String(r.status ?? '0') === '1';
  const c = typeof ecpuClamp === 'function' ? ecpuClamp(r.cpu, active, String(r.planet_mustafar ?? '0') === '1') : Number(r.cpu);
  return c > 0 ? c : null;
}

function renderShop() {
  const host = $('#shop-groups');
  const rows = shopState.rows;
  const ids = [...shopState.items.keys()];
  if (!ids.length) {
    host.innerHTML = '';
    $('#shop-empty').innerHTML = 'Nothing shortlisted yet. Hit the <i class="fa-solid fa-scale-balanced"></i> beside a resource on Resources, a card, the tree or a resource page — resources of the same class line up here side by side so you can see which is best.';
    $('#shop-empty').hidden = false;
    return;
  }
  $('#shop-empty').hidden = true;
  // group by class; anything the API didn't return (deleted / hidden) shows as a stub
  shopFillLevels();
  const byId = new Map(rows.map((r) => [String(r.id), r]));
  const groups = new Map();
  ids.forEach((id) => {
    const r = byId.get(id) || { id, name: shopState.items.get(id) || `#${id}`, type_name: 'Unknown', type_code: '', _missing: true };
    const g = shopGroupFor(r);
    if (!groups.has(g.key)) groups.set(g.key, { key: g.key, name: g.name, code: g.code, rows: [], classes: new Set() });
    groups.get(g.key).rows.push(r);
    if (r.type_name) groups.get(g.key).classes.add(r.type_name);
  });
  const sorted = [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
  host.innerHTML = sorted.map((g) => shopGroupHtml(g)).join('');
  refreshShopIcons();
}

function shopGroupHtml(g) {
  const rows = g.rows.filter((r) => !r._missing);
  const missing = g.rows.filter((r) => r._missing);
  const compare = rows.length >= 2;
  // only stats this class actually has (a cap above 0 on any row)
  const stats = SHOP_STATS.filter((f) => rows.some((r) => safeInt(r[`${f}_max`]) > 0 || safeInt(r[f]) > 0));
  // best per stat and best overall (by Score) — ties share the flag
  const best = {};
  if (compare) {
    stats.forEach((f) => { best[f] = Math.max(...rows.map((r) => safeInt(r[f]))); });
    best.score = Math.max(...rows.map((r) => Number(r.score) || 0));
    const costs = rows.map((r) => shopCost(r)).filter((c) => c != null);
    best.cost = costs.length ? Math.min(...costs) : null;
  }
  // per-section sort (Score high→low until you click a header; numbers sort high first, names A→Z)
  const st = shopState.sort[g.key] || { field: 'score', order: 'DESC' };
  const val = (r, f) => {
    if (f === 'name' || f === 'type_name') return String(r[f] || '').toLowerCase();
    if (f === 'score') return Number(r.score) || 0;
    if (f === 'cost') { const c = shopCost(r); return c == null ? Infinity : c; }
    if (f === 'age') return safeInt(r.timestamp);
    if (f === 'status') return String(r.status ?? '0') === '1' ? 1 : 0;
    return safeInt(r[f]);
  };
  const sortedRows = rows.slice().sort((a, b) => {
    const x = val(a, st.field), y = val(b, st.field);
    const c = typeof x === 'string' ? x.localeCompare(y) : x - y;
    return st.order === 'ASC' ? c : -c;
  });
  const th = (f, label, cls, tip) => `<th class="${cls} shop-th${st.field === f ? ' active' : ''}" data-shopsort="${f}" data-group="${escapeHtml(g.key)}" title="Sort by ${escapeHtml(tip || label)}">${label}${st.field === f ? (st.order === 'ASC' ? ' ▲' : ' ▼') : ''}</th>`;
  const mixed = shopState.level !== 'class';
  // the same stockpile + wishlist cells as the Resources grid: see what you already hold or
  // want, and elevate a pick straight from the shortlist
  const head = `<tr><th class="pin-cell"></th><th class="pin-cell"></th>${th('name', 'Resource', 'col-name')}${mixed ? th('type_name', 'Class', 'col-text') : ''}${th('status', '<i class="fa-solid fa-circle-half-stroke"></i>', 'col-status', 'spawn status')}${th('score', 'Score', 'stat')}${stats.map((f) => th(f, f.toUpperCase(), 'stat')).join('')}${th('cost', 'Cost/u', 'stat', 'cost per unit')}${th('age', 'Age', 'col-text')}<th class="pin-cell"></th></tr>`;
  const body = sortedRows.map((r) => {
    const active = String(r.status ?? '0') === '1';
    const score = Number(r.score) || 0;
    const topRow = compare && score > 0 && score === best.score;
    const cost = shopCost(r);
    const cells = stats.map((f) => {
      const v = safeInt(r[f]);
      const td = statCell(v, r[`${f}_max`]);
      return compare && v > 0 && v === best[f] ? td.replace('<td class="stat ', '<td class="stat shop-best ') : td;
    }).join('');
    return `<tr class="${topRow ? 'shop-top' : ''}" data-id="${escapeHtml(String(r.id))}">
      ${addCellHtml(r.id, r.name)}
      ${wishCellHtml(r.id, r.name)}
      <td class="col-name res-name" data-resname="${escapeHtml(r.name || '')}" data-resid="${escapeHtml(String(r.id))}">${topRow ? '<i class="fa-solid fa-crown shop-crown" title="Best overall in this group by Score"></i>' : ''}${escapeHtml(r.name || '')}</td>
      ${mixed ? `<td class="col-text"><span class="res-typelink shop-class" data-navcat="${escapeHtml(r.type_code || '')}">${escapeHtml(r.type_name || '')}</span></td>` : ''}
      <td class="col-status"><i class="fa-solid fa-circle res-status ${active ? 'on' : 'off'}" title="${active ? escapeHtml(`${agoText(r.timestamp)}${shopPlanetNames(r) ? ` · on ${shopPlanetNames(r)}` : ''}`) : 'Inactive — despawned'}"></i></td>
      <td class="stat ${qualityClass(score)}${compare && score === best.score && score > 0 ? ' shop-best' : ''}" title="Score — demand-weighted quality, 0–100">${score ? score.toFixed(0) : '—'}</td>
      ${cells}
      <td class="stat ${compare && cost != null && cost === best.cost ? 'shop-best shop-best-cost' : ''}" title="Estimated cost per unit">${cost != null ? fmtShort(cost) : '<span class="stat_off">—</span>'}</td>
      <td class="col-text shop-age">${r.timestamp ? fmtAgo(r.timestamp) : '—'}</td>
      <td class="pin-cell shop-remove" data-shop="${escapeHtml(String(r.id))}" data-name="${escapeHtml(r.name || '')}" title="Take it off the list"><i class="fa-solid fa-xmark"></i></td>
    </tr>`;
  }).join('') + missing.map((r) => `<tr class="shop-missing"><td class="pin-cell"></td><td class="pin-cell"></td><td class="col-name">${escapeHtml(r.name)}</td><td colspan="${stats.length + 4 + (mixed ? 1 : 0)}" class="settings-sub">not on the site any more</td><td class="pin-cell shop-remove" data-shop="${escapeHtml(String(r.id))}" data-name="${escapeHtml(r.name)}" title="Take it off the list"><i class="fa-solid fa-xmark"></i></td></tr>`).join('');
  const folded = shopCollapsedSet().has(`${shopState.level}:${g.key}`);
  const classNote = mixed && g.classes && g.classes.size ? ` · ${g.classes.size} class${g.classes.size === 1 ? '' : 'es'}` : '';
  return `<section class="shop-group${folded ? ' collapsed' : ''}" data-shopgroup="${escapeHtml(g.key)}">
    <div class="shop-group-head" data-shopfold>
      <i class="fa-solid fa-chevron-down shop-caret"></i>
      <span class="shop-group-title">${g.code ? `<span class="res-typelink" data-navcat="${escapeHtml(g.code)}" title="See every ${escapeHtml(g.name)} spawn on Resources">${escapeHtml(g.name)}</span>` : escapeHtml(g.name)}</span>
      <span class="shop-group-count">${g.rows.length} shortlisted${classNote}${compare ? ' · best in each stat flagged' : ''}</span>
      <span class="shop-group-right">
        ${g.code ? `<button class="btn btn-sm btn-outline-secondary" data-navcat="${escapeHtml(g.code)}" title="Browse this class to add more"><i class="fa-solid fa-plus"></i> More ${escapeHtml(g.name)}</button>` : ''}
        <button class="btn btn-icon" data-shopcleargroup="${escapeHtml(g.key)}" title="Clear this class from the list"><i class="fa-solid fa-trash-can"></i></button>
      </span>
    </div>
    <div class="table-wrap shop-tablewrap"><table class="data-grid res-grid shop-grid"><thead>${head}</thead><tbody>${body}</tbody></table></div>
  </section>`;
}

function initShop() {
  shopLoadItems();
  shopSyncUi();
  // one delegated handler for every basket anywhere in the app
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-shop]');
    if (!b) return;
    e.preventDefault(); e.stopPropagation();
    shopToggle(b.dataset.shop, b.dataset.name);
  }, true);
  $('#rd-shop')?.addEventListener('click', () => { if (typeof rdState !== 'undefined' && rdState.id) shopToggle(rdState.id, rdState.name); });
  $('#shop-reload')?.addEventListener('click', () => loadShop(true));
  $('#shop-clear')?.addEventListener('click', async () => {
    const ok = await confirmDialog({ title: 'Clear the shortlist?', message: `All ${shopState.items.size} resources come off. Your stockpile and wishlist are untouched.`, confirmLabel: 'Clear list' });
    if (!ok) return;
    shopState.items.clear(); shopSaveItems(); shopSyncUi(); loadShop(true);
  });
  $('#shop-level')?.addEventListener('change', () => { shopState.level = $('#shop-level').value; localStorage.setItem('shop_level', shopState.level); renderShop(); });
  $('#shop-groups')?.addEventListener('click', (e) => {
    const addCell = e.target.closest('[data-add]');
    if (addCell) { handleAddCellClick(addCell, e); return; }
    const wishCell = e.target.closest('[data-wish]');
    if (wishCell) { handleWishCellClick(wishCell); return; }
    const fold = e.target.closest('[data-shopfold]');
    if (fold && !e.target.closest('button, [data-navcat]')) {
      const sec = fold.closest('.shop-group'); const k = `${shopState.level}:${sec.dataset.shopgroup}`;
      const c = shopCollapsedSet(); if (c.has(k)) c.delete(k); else c.add(k);
      try { localStorage.setItem('shop_collapsed', JSON.stringify([...c])); } catch (_) {}
      sec.classList.toggle('collapsed'); return;
    }
    const sh = e.target.closest('[data-shopsort]');
    if (sh) {
      const key = sh.dataset.group; const f = sh.dataset.shopsort;
      const cur = shopState.sort[key] || { field: 'score', order: 'DESC' };
      // same column flips; a new column starts high-first for numbers, A→Z for names
      shopState.sort[key] = cur.field === f ? { field: f, order: cur.order === 'ASC' ? 'DESC' : 'ASC' } : { field: f, order: f === 'name' ? 'ASC' : 'DESC' };
      renderShop(); return;
    }
    const cg = e.target.closest('[data-shopcleargroup]');
    if (cg) {
      const key = cg.dataset.shopcleargroup;
      shopState.rows.filter((r) => shopGroupFor(r).key === key).forEach((r) => shopState.items.delete(String(r.id)));
      [...shopState.items.keys()].forEach((id) => { if (!shopState.rows.some((r) => String(r.id) === id) && (key === 'other' || key === 'all')) shopState.items.delete(id); });
      shopSaveItems(); shopSyncUi(); loadShop(true); return;
    }
    const cat = e.target.closest('[data-navcat]');
    if (cat) { showPage('resources'); if (typeof applyCategoryFilter === 'function') applyCategoryFilter(cat.dataset.navcat, cat.textContent.trim().replace(/^\+\s*More\s+/, '')); return; }
    const name = e.target.closest('[data-resname]');
    if (name) openResourcePage(name.dataset.resname);
  });
  document.addEventListener('page:show', (e) => { if (e.detail?.key === 'resource') setTimeout(shopSyncRdButton, 0); });
}
