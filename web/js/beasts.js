/* Beasts — the website's Beast Master section in the app: Pets, Creatures and
   Specials lists (api/pets.php, api/creatures.php, api/specials.php — fetched once,
   filtered/searched/sorted client-side like Cities), plus full detail pages for one
   pet / creature / special (api/pet_detail.php, api/creature_detail.php,
   api/special_detail.php) with the site's own <swg-creature> 3D viewer when the
   beast has a model. The calculators live in beastcalc.js. */

const SITE_BASE = 'https://swgtracker.com';

// ---------- small shared helpers ----------
const beastYes = (v) => (safeInt(v) ? '<i class="fa-solid fa-check beast-yes" title="Yes"></i>' : '');

// "Tatooine, Yavin4" -> planet badges (the Resources grid's .planet.<name> colours)
function beastPlanetsHtml(csv) {
  const map = { yavin4: 'yavin' };
  return String(csv || '').split(/\s*,\s*/).map((p) => p.trim()).filter((p) => p && p.toLowerCase() !== 'none')
    .map((p) => {
      const key = p.toLowerCase();
      const full = key === 'yavin4' ? 'Yavin IV' : p;
      return `<span class="planet ${escapeHtml(map[key] || key)}" title="${escapeHtml(full)}">${escapeHtml(full)}</span>`;
    }).join(' ');
}

const beastTypeClass = (t) => ({ Offensive: 'stype-off', Defensive: 'stype-def', Special: 'stype-spc' }[t] || '');

function beastFillSelect(sel, values, allLabel, keep, labelFn) {
  if (!sel) return;
  sel.innerHTML = `<option value="">${escapeHtml(allLabel)}</option>`
    + (values || []).map((v) => `<option value="${escapeHtml(String(v))}">${escapeHtml(labelFn ? labelFn(v) : String(v))}</option>`).join('');
  sel.value = keep || '';
  if (sel.value !== (keep || '')) sel.value = '';
}

// ---- pins: pinned pets/creatures float to the top (config beast_pins, survives relaunch) ----
const beastPins = { pets: new Set(), creatures: new Set(), specials: new Set() };
const beastSpecialKey = (x) => `${x.name}|${safeInt(x.rank)}`;
const beastPinKey = (kind, r) => (kind === 'specials' ? beastSpecialKey(r) : r.slug);
async function beastLoadPins() {
  try { const p = JSON.parse(localStorage.getItem('beast_pins') || 'null'); if (p) { beastPins.pets = new Set(p.pets || []); beastPins.creatures = new Set(p.creatures || []); beastPins.specials = new Set(p.specials || []); } } catch (_) { /* ignore */ }
  try {
    const cfg = await api().get_config();
    const p = cfg && cfg.ok && cfg.data && cfg.data.beast_pins;
    if (p) {
      beastPins.pets = new Set(p.pets || []); beastPins.creatures = new Set(p.creatures || []); beastPins.specials = new Set(p.specials || []);
      if (petsState.loaded) renderPets();
      if (creaturesState.loaded) renderCreatures();
      if (specialsState.loaded) renderSpecials();
    }
  } catch (_) { /* localStorage stands */ }
}
function beastSavePins() {
  const p = { pets: [...beastPins.pets], creatures: [...beastPins.creatures], specials: [...beastPins.specials] };
  try { localStorage.setItem('beast_pins', JSON.stringify(p)); } catch (_) { /* ignore */ }
  try { api().set_config('beast_pins', p); } catch (_) { /* ignore */ }
}
const beastPinCell = (kind, slug) => `<td class="pin-cell ${beastPins[kind].has(slug) ? 'pinned-star' : ''}" data-beastpin="${escapeHtml(slug)}" data-beastkind="${kind}" title="${beastPins[kind].has(slug) ? 'Unpin' : 'Pin to top'}"><i class="fa-solid fa-thumbtack"></i></td>`;

// client-side pages like Resources: pinned rows first, a filter change snaps back
// to page 1, the footer reads "Showing 1–50 of 175 pets" with Prev/Next
const BEAST_PER_PAGE = 50;
function beastPage(prefix, s, rows, kind, sig, noun) {
  rows = gxPinFirst(rows, beastPins[kind], (r) => beastPinKey(kind, r));
  if (s.pinnedOnly) rows = rows.filter((r) => beastPins[kind].has(beastPinKey(kind, r)));
  if (sig !== s.sig) { s.sig = sig; s.page = 1; }
  const total = rows.length;
  const pages = Math.max(1, Math.ceil(total / BEAST_PER_PAGE));
  if (s.page > pages) s.page = pages;
  if (s.page < 1) s.page = 1;
  const from = (s.page - 1) * BEAST_PER_PAGE;
  const slice = rows.slice(from, from + BEAST_PER_PAGE);
  const all = s.items.length;
  $(`#${prefix}-status`).textContent = !s.loaded ? ''
    : !total ? `No ${noun} match${all ? ` (${all} total)` : ''}`
      : `Showing ${from + 1}–${from + slice.length} of ${total} ${noun}${total !== all ? ` matching · ${all} total` : ''}${s.pinnedOnly ? ' · pinned only' : ''}`;
  $(`#${prefix}-prev`).disabled = s.page <= 1;
  $(`#${prefix}-next`).disabled = s.page >= pages;
  const wrap = $(`#${prefix}-body`).closest('.table-wrap');
  if (wrap) wrap.scrollTop = 0;
  return slice;
}

// ---- list | cards view, with each beast's model url for the card grid ----
// api/beast_list.php maps every slug to its GLB (public, one call per kind, cached)
const beastModels = { pets: null, creatures: null, loading: {} };
async function beastLoadModels(kind) {
  if (beastModels[kind] || beastModels.loading[kind]) return;
  beastModels.loading[kind] = true;
  try {
    const res = await apiFetch('GET', 'api/beast_list.php', { params: { type: kind === 'pets' ? 'pet' : 'creature' } });
    const map = new Map();
    ((res.ok && res.data && res.data.beasts) || []).forEach((b) => { if (b.model) map.set(b.slug, { model: b.model, color: b.model_color || '' }); });
    beastModels[kind] = map;
  } catch (_) { beastModels[kind] = new Map(); }
  beastModels.loading[kind] = false;
  if (kind === 'pets' && petsState.loaded) renderPets();
  if (kind === 'creatures' && creaturesState.loaded) renderCreatures();
}
const beastView = (kind) => (localStorage.getItem(`beast-view-${kind}`) === 'cards' ? 'cards' : 'list');
function beastApplyView(kind, prefix) {
  const cards = beastView(kind) === 'cards';
  $(`#${prefix}-tablewrap`).hidden = cards;
  $(`#${prefix}-cards`).hidden = !cards;
  document.querySelectorAll(`#${prefix}-view-switch [data-beastview]`).forEach((b) => b.classList.toggle('active', b.dataset.beastview === (cards ? 'cards' : 'list')));
  if (cards) { schEnsureModelLib(); beastLoadModels(kind); }
  return cards;
}
// one card: lazy 3D model (mounted while on screen, like Schematics' cards), name, a line of detail, pin
function beastCardHtml(kind, r, sub, attr) {
  const m = beastModels[kind] && beastModels[kind].get(r.slug);
  const src = m ? (/^https?:/i.test(m.model) ? m.model : SITE_BASE + (m.model.startsWith('/') ? '' : '/') + m.model) : '';
  const key = beastPinKey(kind, r);
  const pinned = beastPins[kind].has(key);
  return `<div class="sch-card beast-tile ${pinned ? 'pinned' : ''}" ${attr}="${escapeHtml(r.slug)}">
    <div class="sch-card-model"${src ? ` data-mvlazy="${escapeHtml(r.slug)}" data-mvsrc="${escapeHtml(src)}"${m.color ? ` data-mvcolor="${escapeHtml(m.color)}"` : ''}` : ''}>
      <i class="fa-solid ${src ? 'fa-cube' : 'fa-paw'} sch-card-nomodel"${src ? '' : ' title="No 3D model yet"'}></i></div>
    <div class="sch-card-name">${escapeHtml(r.name)}</div>
    <div class="sch-card-cat">${sub}</div>
    <span class="sch-card-actions"><span class="pin-cell ${pinned ? 'pinned-star' : ''}" data-beastpin="${escapeHtml(key)}" data-beastkind="${kind}" title="${pinned ? 'Unpin' : 'Pin to top'}"><i class="fa-solid fa-thumbtack"></i></span></span>
  </div>`;
}

function beastSetEmpty(prefix, msg) {
  const el = $(`#${prefix}-empty`);
  if (!el) return;
  if (msg) { el.textContent = msg; el.hidden = false; } else el.hidden = true;
  const cards = $(`#${prefix}-cards`);
  if (cards && !cards.hidden) cards.innerHTML = msg ? `<div class="al-empty sch-cards-empty">${escapeHtml(msg)}</div>` : cards.innerHTML;
}

// ===================== Pets =====================
const petsState = { items: [], options: {}, loaded: false, loading: false, sortField: 'name', sortOrder: 'ASC',
  family: '', bonus: '', source: '', supplement: '', color: '', mount: false, fly: false, pinnedOnly: false, page: 1, sig: '' };
const PETS_COLUMNS = [
  ['Name', 'name', 'col-name'], ['Family', 'family', 'col-text'], ['Bonus Group', 'bonus_group', 'col-text'],
  ['Source', 'source', 'col-text'], ['Supplement', 'supplement', 'col-text'], ['Mutation Colors', 'colors_text', 'col-text'],
  ['Mount', 'mountable', 'col-num'], ['Fly', 'flying', 'col-num'],
];
const PETS_NUM = new Set(['mountable', 'flying']);

async function loadPets(force = false) {
  if (petsState.loaded && !force) { renderPets(); return; }
  if (petsState.loading) return;
  petsState.loading = true;
  $('#pets-loading').hidden = false; beastSetEmpty('pets', '');
  let res;
  try { res = await apiFetch('GET', 'api/pets.php'); } catch (e) { res = { ok: false, error: String(e) }; }
  petsState.loading = false;
  $('#pets-loading').hidden = true;
  if (!res.ok || !res.data || res.data.error) { beastSetEmpty('pets', (res.data && res.data.error) || res.error || 'Could not load pets.'); return; }
  petsState.items = (res.data.results || []).map((p) => Object.assign(p, { colors_text: (p.colors || []).join(', ') }));
  petsState.options = res.data.options || {};
  petsState.loaded = true;
  const o = petsState.options;
  beastFillSelect($('#pets-family'), o.families, 'All families', petsState.family);
  beastFillSelect($('#pets-bonus'), o.bonus_groups, 'All bonus groups', petsState.bonus);
  beastFillSelect($('#pets-source'), o.sources, 'All sources', petsState.source);
  beastFillSelect($('#pets-supplement'), o.supplements, 'All supplements', petsState.supplement, (v) => `Supplement ${v}`);
  beastFillSelect($('#pets-color'), o.colors, 'All colors', petsState.color);
  renderPets();
}

function renderPets() {
  $('#pets-head').innerHTML = sortableHeaderHtml(PETS_COLUMNS, petsState.sortField, petsState.sortOrder, '<th class="pin-cell"></th>');
  const s = petsState;
  const q = ($('#pets-search')?.value || '').trim().toLowerCase();
  let rows = s.items;
  if (s.family) rows = rows.filter((p) => p.family === s.family);
  if (s.bonus) rows = rows.filter((p) => p.bonus_group === s.bonus);
  if (s.source) rows = rows.filter((p) => p.source === s.source);
  if (s.supplement) rows = rows.filter((p) => p.supplement === s.supplement);
  if (s.color) rows = rows.filter((p) => (p.colors || []).includes(s.color));
  if (s.mount) rows = rows.filter((p) => safeInt(p.mountable));
  if (s.fly) rows = rows.filter((p) => safeInt(p.flying));
  if (q) rows = rows.filter((p) => [p.name, p.family].some((v) => String(v || '').toLowerCase().includes(q)));
  rows = gxSortRows(rows, s.sortField, s.sortOrder, PETS_NUM);
  $('#pets-mount').classList.toggle('active', s.mount);
  $('#pets-fly').classList.toggle('active', s.fly);
  rows = beastPage('pets', s, rows, 'pets', JSON.stringify([q, s.family, s.bonus, s.source, s.supplement, s.color, s.mount, s.fly, s.pinnedOnly, s.sortField, s.sortOrder]), 'pets');
  const body = $('#pets-body');
  const cards = beastApplyView('pets', 'pets');
  if (!rows.length) { body.innerHTML = ''; $('#pets-cards').innerHTML = ''; beastSetEmpty('pets', s.loaded ? (s.pinnedOnly && !beastPins.pets.size ? 'Nothing pinned yet — click a pin to keep a pet at the top.' : 'No pets match.') : ''); return; }
  beastSetEmpty('pets', '');
  if (cards) {
    body.innerHTML = '';
    $('#pets-cards').innerHTML = rows.map((p) => beastCardHtml('pets', p, [p.family, p.bonus_group].filter(Boolean).map(escapeHtml).join(' · '), 'data-pet')).join('');
    mvObserveCards('#pets-cards');
    return;
  }
  body.innerHTML = rows.map((p) => `<tr class="gx-rowlink beast-row" data-pet="${escapeHtml(p.slug)}">
      ${beastPinCell('pets', p.slug)}
      <td class="col-name"><b class="gx-detail-link">${escapeHtml(p.name)}</b></td>
      <td class="col-text">${escapeHtml(p.family || '')}</td>
      <td class="col-text">${escapeHtml(p.bonus_group || '')}</td>
      <td class="col-text">${escapeHtml(p.source || '')}</td>
      <td class="col-text">${escapeHtml(p.supplement || '')}</td>
      <td class="col-text beast-small">${escapeHtml(p.colors_text || '')}</td>
      <td class="col-num">${beastYes(p.mountable)}</td>
      <td class="col-num">${beastYes(p.flying)}</td>
    </tr>`).join('');
}

// open the Pets list with one filter preselected (detail-page stat cards)
function openPetsFiltered(field, value) {
  petsState.family = petsState.bonus = petsState.source = petsState.supplement = petsState.color = '';
  petsState.mount = petsState.fly = petsState.pinnedOnly = false;
  const ppo = $('#pets-pinned-only'); if (ppo) ppo.checked = false;
  if (field === 'mountable') petsState.mount = !!safeInt(value);
  else if (field === 'flying') petsState.fly = !!safeInt(value);
  else if (field in petsState) petsState[field] = value || '';
  const sel = { family: '#pets-family', bonus: '#pets-bonus', source: '#pets-source', supplement: '#pets-supplement', color: '#pets-color' };
  Object.entries(sel).forEach(([k, id]) => { const el = $(id); if (el) el.value = petsState[k] || ''; });
  showPage('pets');
  if (petsState.loaded) renderPets();
}

// ===================== Creatures =====================
const creaturesState = { items: [], options: {}, loaded: false, loading: false, sortField: 'name', sortOrder: 'ASC',
  planet: '', difficulty: '', petType: '', damage: '', dna: '', pinnedOnly: false, page: 1, sig: '' };
const CREATURES_COLUMNS = [
  ['Creature', 'name', 'col-name'], ['Pet Type', 'pet_type', 'col-text'], ['Planets', 'planets', 'col-text'],
  ['Difficulty', 'difficulty', 'col-text'], ['Damage', 'damage_type', 'col-text'], ['DNA', 'extractable_dna', 'col-num'],
];
const CREATURES_NUM = new Set(['extractable_dna']);

async function loadCreatures(force = false) {
  if (creaturesState.loaded && !force) { renderCreatures(); return; }
  if (creaturesState.loading) return;
  creaturesState.loading = true;
  $('#creatures-loading').hidden = false; beastSetEmpty('creatures', '');
  let res;
  try { res = await apiFetch('GET', 'api/creatures.php'); } catch (e) { res = { ok: false, error: String(e) }; }
  creaturesState.loading = false;
  $('#creatures-loading').hidden = true;
  if (!res.ok || !res.data || res.data.error) { beastSetEmpty('creatures', (res.data && res.data.error) || res.error || 'Could not load creatures.'); return; }
  creaturesState.items = res.data.results || [];
  creaturesState.options = res.data.options || {};
  creaturesState.loaded = true;
  const o = creaturesState.options;
  beastFillSelect($('#creatures-planet'), o.planets, 'All planets', creaturesState.planet, (v) => (String(v).toLowerCase() === 'yavin4' ? 'Yavin IV' : String(v)));
  beastFillSelect($('#creatures-difficulty'), o.difficulties, 'Any difficulty', creaturesState.difficulty);
  beastFillSelect($('#creatures-pettype'), o.pet_types, 'All pet types', creaturesState.petType);
  beastFillSelect($('#creatures-damage'), o.damage_types, 'Any damage', creaturesState.damage);
  renderCreatures();
}

function renderCreatures() {
  $('#creatures-head').innerHTML = sortableHeaderHtml(CREATURES_COLUMNS, creaturesState.sortField, creaturesState.sortOrder, '<th class="pin-cell"></th>');
  const s = creaturesState;
  const q = ($('#creatures-search')?.value || '').trim().toLowerCase();
  let rows = s.items;
  if (s.planet) rows = rows.filter((c) => String(c.planets || '').toLowerCase().includes(s.planet.toLowerCase()));
  if (s.difficulty) rows = rows.filter((c) => c.difficulty === s.difficulty);
  if (s.petType) rows = rows.filter((c) => c.pet_type === s.petType);
  if (s.damage) rows = rows.filter((c) => c.damage_type === s.damage);
  if (s.dna === 'yes') rows = rows.filter((c) => safeInt(c.extractable_dna) === 1);
  if (s.dna === 'no') rows = rows.filter((c) => safeInt(c.extractable_dna) === 0);
  if (q) rows = rows.filter((c) => [c.name, c.pet_type, c.location].some((v) => String(v || '').toLowerCase().includes(q)));
  rows = gxSortRows(rows, s.sortField, s.sortOrder, CREATURES_NUM);
  rows = beastPage('creatures', s, rows, 'creatures', JSON.stringify([q, s.planet, s.difficulty, s.petType, s.damage, s.dna, s.pinnedOnly, s.sortField, s.sortOrder]), 'creatures');
  const body = $('#creatures-body');
  const cards = beastApplyView('creatures', 'creatures');
  if (!rows.length) { body.innerHTML = ''; $('#creatures-cards').innerHTML = ''; beastSetEmpty('creatures', s.loaded ? (s.pinnedOnly && !beastPins.creatures.size ? 'Nothing pinned yet — click a pin to keep a creature at the top.' : 'No creatures match.') : ''); return; }
  beastSetEmpty('creatures', '');
  if (cards) {
    body.innerHTML = '';
    $('#creatures-cards').innerHTML = rows.map((c) => beastCardHtml('creatures', c, `${escapeHtml(c.pet_type || '')}${c.pet_type && c.planets ? ' · ' : ''}${beastPlanetsHtml(c.planets)}`, 'data-creature')).join('');
    mvObserveCards('#creatures-cards');
    return;
  }
  body.innerHTML = rows.map((c) => `<tr class="gx-rowlink beast-row" data-creature="${escapeHtml(c.slug)}">
      ${beastPinCell('creatures', c.slug)}
      <td class="col-name"><b class="gx-detail-link">${escapeHtml(c.name)}</b></td>
      <td class="col-text">${escapeHtml(c.pet_type || '')}</td>
      <td class="col-text beast-planets">${beastPlanetsHtml(c.planets)}</td>
      <td class="col-text">${escapeHtml(c.difficulty || '')}</td>
      <td class="col-text">${escapeHtml(c.damage_type || '')}</td>
      <td class="col-num">${beastYes(c.extractable_dna)}</td>
    </tr>`).join('');
}

function openCreaturesFiltered(field, value) {
  creaturesState.planet = creaturesState.difficulty = creaturesState.petType = creaturesState.damage = creaturesState.dna = '';
  creaturesState.pinnedOnly = false;
  const cpo = $('#creatures-pinned-only'); if (cpo) cpo.checked = false;
  if (field in creaturesState) creaturesState[field] = value || '';
  const sel = { planet: '#creatures-planet', difficulty: '#creatures-difficulty', petType: '#creatures-pettype', damage: '#creatures-damage', dna: '#creatures-dna' };
  Object.entries(sel).forEach(([k, id]) => { const el = $(id); if (el) el.value = creaturesState[k] || ''; });
  showPage('creatures');
  if (creaturesState.loaded) renderCreatures();
}

// ===================== Specials =====================
const specialsState = { items: [], options: {}, loaded: false, loading: false, sortField: 'name', sortOrder: 'ASC', type: '', rank: '', pinnedOnly: false, page: 1, sig: '' };
const SPECIALS_COLUMNS = [
  ['Special', 'name', 'col-name'], ['Rank', 'rank', 'col-num'], ['Type', 'type', 'col-text'],
  ['Train Req', 'requirement', 'col-text'], ['Action', 'action_cost', 'col-text'], ['Refresh', 'cooldown', 'col-text'],
  ['Effect', 'effect', 'col-text'],
];
const SPECIALS_NUM = new Set(['rank']);

async function loadSpecials(force = false) {
  if (specialsState.loaded && !force) { renderSpecials(); return; }
  if (specialsState.loading) return;
  specialsState.loading = true;
  $('#specials-loading').hidden = false; beastSetEmpty('specials', '');
  let res;
  try { res = await apiFetch('GET', 'api/specials.php'); } catch (e) { res = { ok: false, error: String(e) }; }
  specialsState.loading = false;
  $('#specials-loading').hidden = true;
  if (!res.ok || !res.data || res.data.error) { beastSetEmpty('specials', (res.data && res.data.error) || res.error || 'Could not load specials.'); return; }
  specialsState.items = res.data.results || [];
  specialsState.options = res.data.options || {};
  specialsState.loaded = true;
  beastFillSelect($('#specials-type'), specialsState.options.types, 'All types', specialsState.type);
  beastFillSelect($('#specials-rank'), specialsState.options.ranks, 'Any rank', specialsState.rank, (v) => `Rank ${v}`);
  renderSpecials();
}

function renderSpecials() {
  $('#specials-head').innerHTML = sortableHeaderHtml(SPECIALS_COLUMNS, specialsState.sortField, specialsState.sortOrder, '<th class="pin-cell"></th>');
  const s = specialsState;
  const q = ($('#specials-search')?.value || '').trim().toLowerCase();
  let rows = s.items;
  if (s.type) rows = rows.filter((x) => x.type === s.type);
  if (s.rank) rows = rows.filter((x) => String(x.rank) === String(s.rank));
  if (q) rows = rows.filter((x) => [x.name, x.effect].some((v) => String(v || '').toLowerCase().includes(q)));
  rows = gxSortRows(rows, s.sortField, s.sortOrder, SPECIALS_NUM); // stable: ties keep the API's name, rank order
  rows = beastPage('specials', s, rows, 'specials', JSON.stringify([q, s.type, s.rank, s.pinnedOnly, s.sortField, s.sortOrder]), 'specials');
  const body = $('#specials-body');
  if (!rows.length) { body.innerHTML = ''; beastSetEmpty('specials', s.loaded ? (s.pinnedOnly && !beastPins.specials.size ? 'Nothing pinned yet — click a pin to keep a special at the top.' : 'No specials match.') : ''); return; }
  beastSetEmpty('specials', '');
  body.innerHTML = rows.map((x) => `<tr class="gx-rowlink beast-row" data-special="${escapeHtml(x.name)}" data-rank="${safeInt(x.rank)}">
      ${beastPinCell('specials', beastSpecialKey(x))}
      <td class="col-name"><b class="gx-detail-link">${escapeHtml(x.name)}</b></td>
      <td class="col-num">${safeInt(x.rank)}</td>
      <td class="col-text ${beastTypeClass(x.type)}">${escapeHtml(x.type || '')}</td>
      <td class="col-text">${escapeHtml(x.requirement || '')}</td>
      <td class="col-text">${escapeHtml(x.action_cost || '')}</td>
      <td class="col-text">${escapeHtml(x.cooldown || '')}</td>
      <td class="col-text beast-effect">${escapeHtml(x.effect || '')}</td>
    </tr>`).join('');
}

// ===================== detail pages =====================
const beastDetail = { pet: null, creature: null, special: null, seq: 0, modelHost: null };

// one <swg-creature> at a time — every viewer owns a WebGL context and the
// browser caps them, so the previous page's model is dropped before a new mount
// and when the detail page is left (see the class observer in initBeasts)
function beastUnmountModel() {
  const host = beastDetail.modelHost;
  if (host && host.querySelector('swg-creature')) host.innerHTML = '';
  const pop = document.getElementById('scd-recolor-pop');
  if (pop && pop.closest('.beast-model-col')) pop.remove(); // an open flyout dies with its model
  beastDetail.modelHost = null;
  beastDetail.model = null;
}
// saved recolor picks per beast (site convention: one tint for the whole model)
const beastColorKey = (kind, slug) => `swgBeastColors:${kind}:${slug}`;
function beastSavedColor(kind, slug) {
  try { const s = JSON.parse(localStorage.getItem(beastColorKey(kind, slug))) || {}; return Array.isArray(s[0]) ? s[0] : null; } catch (_) { return null; }
}
// opts: { kind, slug, palette: [[[r,g,b], …] per family] from the API }
function beastMountModel(host, model, color, opts = {}) {
  beastUnmountModel();
  if (!host) return;
  if (!model) {
    host.innerHTML = '<div class="beast-model-none"><i class="fa-solid fa-cube"></i><div>No 3D model yet</div></div>';
    return;
  }
  schEnsureModelLib(); // the site's viewer module, shared with Schematics
  const src = /^https?:/i.test(model) ? model : SITE_BASE + (model.startsWith('/') ? '' : '/') + model;
  host.innerHTML = '<div class="scd-model-loading"><span class="spinner"></span></div>';
  const mv = document.createElement('swg-creature');
  mv.setAttribute('src', src);
  mv.setAttribute('no-picker', '');
  mv.setAttribute('auto-rotate', 'false');
  mv.setAttribute('fit', '0.9');
  if (color) mv.setAttribute('default-color', color);
  const { kind = 'pets', slug = '', palette = [] } = opts;
  beastDetail.model = { mv, host, kind, slug, src, color, palette: Array.isArray(palette) ? palette : [], slots: [] };
  mv.addEventListener('swg-ready', (e) => {
    host.querySelector('.scd-model-loading')?.remove();
    if (beastDetail.model?.mv !== mv) return;
    // the viewer's own recolorable slots (GLB palettes) back up the site's palette file
    beastDetail.model.slots = ((e.detail && e.detail.slots) || []).map((sl, i) => ({ idx: i, slot: sl }))
      .filter((u) => u.slot && u.slot.palette && u.slot.palette.length);
    host.querySelectorAll('.scd-mv-expand, .scd-mv-recolor').forEach((b) => b.remove());
    host.insertAdjacentHTML('beforeend', `<button class="btn btn-icon scd-mv-expand" data-beastzoom title="View full size"><i class="fa-solid fa-expand"></i></button>`);
    if (beastDetail.model.palette.length || beastDetail.model.slots.length) {
      host.insertAdjacentHTML('beforeend', `<button class="btn btn-icon scd-mv-recolor" data-beastrecolor title="Recolor — pick from the in-game palette; True dark lives in here too"><i class="fa-solid fa-palette"></i></button>`);
    }
  });
  // a remembered pick re-applies after the widget's own default tint lands
  mv.addEventListener('swg-load', () => { const rgb = beastSavedColor(kind, slug); if (rgb && mv.recolor) mv.recolor(rgb); });
  host.appendChild(mv);
  beastDetail.modelHost = host;
}
function beastOpenRecolor() {
  const m = beastDetail.model;
  if (!m || !m.mv) return;
  // the site's palette file tints the whole model (one slot); GLB slots otherwise
  const whole = m.palette.length ? [{ idx: 0, slot: { name: 'Color', palette: m.palette.flat() } }] : null;
  mvOpenRecolorPanel({
    card: m.host.closest('.beast-model-col') || m.host.parentElement, mv: m.mv, key: beastColorKey(m.kind, m.slug),
    slots: whole || m.slots,
    apply: whole ? (slot, rgb) => m.mv.recolor && m.mv.recolor(rgb) : null,
    reset: whole ? () => (m.mv.resetColor ? m.mv.resetColor() : null) : null,
  });
}
function beastZoomModel() {
  const m = beastDetail.model;
  if (!m) return;
  scdModelZoom(m.src, { defaultColor: m.color, onLoad: (mv) => { const rgb = beastSavedColor(m.kind, m.slug); if (rgb && mv.recolor) mv.recolor(rgb); } });
}

const beastModelHtml = (id) => `<div class="beast-model-col"><div class="beast-model" id="${id}"></div></div>`;
const beastChip = (attrs, label, icon) => `<span class="bchip" ${attrs}>${icon ? `<i class="${icon}"></i> ` : ''}${escapeHtml(label)}</span>`;
const beastStat = (label, val, attrs) => `<div class="gx-dstat beast-stat${attrs ? ' beast-stat-link' : ''}" ${attrs || ''}><div class="gx-dstat-l">${escapeHtml(label)}</div><div class="gx-dstat-v gx-dstat-sm">${val}</div></div>`;
const beastH6 = (t) => `<h6>${escapeHtml(t)}</h6>`;

function beastDetailStart(prefix, crumbsHtml) {
  showPage(prefix);
  beastUnmountModel();
  $(`#${prefix}-crumbs`).innerHTML = crumbsHtml;
  $(`#${prefix}-body`).innerHTML = '';
  beastSetEmpty(prefix, '');
  $(`#${prefix}-loading`).hidden = false;
  return ++beastDetail.seq;
}

// ---- pet ----
async function openPetPage(slug) {
  const seq = beastDetailStart('pet', '<a role="button" data-nav="pets">Pets</a> › …');
  let res;
  try { res = await apiFetch('GET', 'api/pet_detail.php', { params: { slug } }); } catch (e) { res = { ok: false, error: String(e) }; }
  if (seq !== beastDetail.seq) return;
  $('#pet-loading').hidden = true;
  if (!res.ok || !res.data || !res.data.pet) { beastSetEmpty('pet', (res.data && res.data.error) || res.error || 'Pet not found.'); return; }
  beastDetail.pet = res.data;
  renderPetPage(res.data);
}

function renderPetPage(d) {
  const p = d.pet;
  $('#pet-crumbs').innerHTML = `<a role="button" data-nav="pets">Pets</a> › ${escapeHtml(p.name)}`;
  const yesNo = (v) => (safeInt(v) ? 'Yes' : 'No');
  const f = (field, val) => (val ? `data-petfilter="${field}" data-val="${escapeHtml(String(val))}" title="Show ${escapeHtml(String(val))} pets"` : '');
  const stats = [
    beastStat('Family', escapeHtml(p.family || '-'), f('family', p.family)),
    beastStat('Bonus Group', escapeHtml(p.bonus_group || '-'), f('bonus', p.bonus_group)),
    beastStat('Source', escapeHtml(p.source || '-'), f('source', p.source)),
    beastStat('Supplement', escapeHtml(p.supplement || '-'), f('supplement', p.supplement)),
    beastStat('Mountable', yesNo(p.mountable), safeInt(p.mountable) ? f('mountable', '1') : ''),
    beastStat('Flying', yesNo(p.flying), safeInt(p.flying) ? f('flying', '1') : ''),
  ].join('');

  const bonuses = p.stat_bonuses && typeof p.stat_bonuses === 'object' && !Array.isArray(p.stat_bonuses) ? Object.entries(p.stat_bonuses) : [];
  const trimNum = (v) => String(v).replace(/\.?0+$/, '');
  const sizeParts = [];
  if (p.size_h) sizeParts.push(`${trimNum(p.size_h)}H`);
  if (p.size_w) sizeParts.push(`${trimNum(p.size_w)}W`);
  if (p.size_l) sizeParts.push(`${trimNum(p.size_l)}L`);
  const bonusCard = `<div class="scd-card beast-card">${beastH6(`Bonuses${p.bonus_group ? ` - ${p.bonus_group}` : ''}`)}
    ${bonuses.length
      ? `<table class="beast-kv">${bonuses.map(([k, v]) => `<tr><td class="beast-kv-l">${escapeHtml(k)}</td><td class="beast-kv-v">${escapeHtml(String(v))}</td></tr>`).join('')}</table>`
      : '<p class="settings-sub">No stat bonuses listed.</p>'}
    ${sizeParts.length ? `<div class="settings-sub beast-meta">Size: ${escapeHtml(sizeParts.join(' '))}</div>` : ''}</div>`;

  const specials = d.specials || [];
  const specialsCard = `<div class="scd-card beast-card">${beastH6('Special Abilities')}
    ${specials.length ? specials.map((s) => beastChip(`data-special="${escapeHtml(s.name)}" title="${escapeHtml(s.type || '')}"`, s.name)).join('') : '<p class="settings-sub">N/A</p>'}</div>`;

  // mutation chain: result names (linked when they're real pets) + colour swatches per step
  const links = (d.mutation_links && !Array.isArray(d.mutation_links)) ? d.mutation_links : {};
  const mres = (name) => {
    if (!name) return '';
    const slug = links[String(name).toLowerCase()];
    return slug ? `<a role="button" data-pet="${escapeHtml(slug)}">${escapeHtml(name)}</a>` : escapeHtml(name);
  };
  const colorCell = (c) => (c && c.name
    ? `<span class="beast-mutcolor" data-petfilter="color" data-val="${escapeHtml(c.name)}" title="Show ${escapeHtml(c.name)} pets"><span class="beast-cube" style="background:${escapeHtml(c.hex || '#777')}"></span>${escapeHtml(c.name)}</span>` : '');
  const colors = d.colors || {};
  const colorRow = (label, cells) => (cells && cells.some((c) => c && c.name)
    ? `<tr><td class="beast-kv-l">${label}</td>${cells.map((c) => `<td>${colorCell(c)}</td>`).join('')}</tr>` : '');
  const hasMut = p.mutation_1st || p.mutation_2nd || p.mutation_3rd;
  const mutCard = hasMut ? `<div class="scd-card beast-card beast-card-wide">${beastH6('Mutation Chain')}
    <table class="beast-mut"><thead><tr><th></th><th>1st</th><th>2nd</th><th>3rd</th></tr></thead><tbody>
      <tr><td class="beast-kv-l">Result</td><td>${mres(p.mutation_1st)}</td><td>${mres(p.mutation_2nd)}</td><td>${mres(p.mutation_3rd)}</td></tr>
      ${colorRow('Lyase', colors.lyase)}${colorRow('Isomerase (Top)', colors.isomerase_top)}${colorRow('Isomerase (Bottom)', colors.isomerase_bottom)}
    </tbody></table></div>` : '';

  const extracted = d.extracted_from || [];
  const spawnCard = `<div class="scd-card beast-card beast-card-wide">
    ${p.mission_terminals ? `${beastH6('Spawn Locations')}<p class="beast-p">${escapeHtml(p.mission_terminals)}</p>` : ''}
    ${beastH6('Extract DNA From')}
    ${extracted.length ? extracted.map((c) => beastChip(`data-creature="${escapeHtml(c.slug)}" title="${escapeHtml(c.planets || '')}"`, c.name)).join('')
      : p.extract_note ? `<p class="beast-p">${escapeHtml(p.extract_note).replace(/\n/g, '<br>')}</p>` : '<p class="settings-sub">N/A</p>'}</div>`;

  const extCard = `<div class="scd-card beast-card beast-card-wide">${beastH6('External Resources')}
    ${beastChip(`data-ext="https://creaturecodex.net/pet?name=${encodeURIComponent(p.name)}"`, 'Creature Codex', 'fa-solid fa-arrow-up-right-from-square')}
    ${beastChip(`data-ext="https://www.swgpets.com/pet/${encodeURIComponent(p.slug)}"`, 'SWGPets', 'fa-solid fa-arrow-up-right-from-square')}
    ${beastChip(`data-ext="${SITE_BASE}/pet.php?slug=${encodeURIComponent(p.slug)}"`, 'swgtracker.com', 'fa-solid fa-arrow-up-right-from-square')}</div>`;

  $('#pet-body').innerHTML = `<div class="beast-top">
    <div class="beast-main">
      <h2 class="beast-name">${escapeHtml(p.name)}</h2>
      <div class="gx-detail-stats beast-stats">${stats}</div>
      <div class="beast-cards">${bonusCard}${specialsCard}${mutCard}${spawnCard}${extCard}</div>
    </div>
    ${beastModelHtml('pet-model')}
  </div>`;
  beastMountModel($('#pet-model'), d.model, d.model_color, { kind: 'pets', slug: p.slug, palette: d.palette });
}

// ---- creature ----
async function openCreaturePage(slug) {
  const seq = beastDetailStart('creature', '<a role="button" data-nav="creatures">Creatures</a> › …');
  let res;
  try { res = await apiFetch('GET', 'api/creature_detail.php', { params: { slug } }); } catch (e) { res = { ok: false, error: String(e) }; }
  if (seq !== beastDetail.seq) return;
  $('#creature-loading').hidden = true;
  if (!res.ok || !res.data || !res.data.creature) { beastSetEmpty('creature', (res.data && res.data.error) || res.error || 'Creature not found.'); return; }
  beastDetail.creature = res.data;
  renderCreaturePage(res.data);
}

function renderCreaturePage(d) {
  const c = d.creature;
  $('#creature-crumbs').innerHTML = `<a role="button" data-nav="creatures">Creatures</a> › ${escapeHtml(c.name)}`;
  const yesNo = (v) => (safeInt(v) ? 'Yes' : 'No');
  const f = (field, val, label) => (val !== '' && val != null ? `data-creaturefilter="${field}" data-val="${escapeHtml(String(val))}" title="Show ${escapeHtml(label || String(val))} creatures"` : '');
  const petVal = d.pet ? `<a role="button" data-pet="${escapeHtml(d.pet.slug)}" title="Open the ${escapeHtml(d.pet.name)} pet">${escapeHtml(d.pet.name)}</a>` : escapeHtml(c.pet_type || '-');
  const stats = [
    beastStat('Pet Type', petVal, d.pet ? '' : f('petType', c.pet_type)),
    beastStat('Difficulty', escapeHtml(c.difficulty || '-'), f('difficulty', c.difficulty)),
    beastStat('Damage', escapeHtml(c.damage_type || '-'), f('damage', c.damage_type)),
    beastStat('DNA', yesNo(c.extractable_dna), f('dna', safeInt(c.extractable_dna) ? 'yes' : 'no', safeInt(c.extractable_dna) ? 'DNA-extractable' : 'non-extractable')),
    beastStat('Deathblow', yesNo(c.deathblow)),
    beastStat('Slayer', yesNo(c.slayer)),
  ].join('');

  const meta = [`Aggression: ${c.aggression_range || '-'}`, `Assist: ${c.assist_range || '-'}`];
  if (c.missions) meta.push(`Missions: ${c.missions}`);
  const locCard = `<div class="scd-card beast-card">${beastH6('Location')}
    <p class="beast-p">${escapeHtml(c.location || '-')}</p>
    ${c.waypoint ? `<span class="rd-wp-chip" data-wpcopy="${escapeHtml(c.waypoint)}" title="Click to copy"><i class="fa-solid fa-location-dot"></i> ${escapeHtml(c.waypoint)}</span>` : ''}
    <div class="settings-sub beast-meta">${escapeHtml(meta.join('  ·  '))}</div></div>`;

  const res = [];
  [['bone', 'Bone'], ['hide', 'Hide'], ['meat', 'Meat'], ['milk', 'Milk']].forEach(([k, lab]) => {
    if (c[`${k}_type`]) res.push(`<b>${lab}:</b> ${escapeHtml(c[`${k}_type`])}`);
  });
  const specials = d.specials || [];
  const resCard = `<div class="scd-card beast-card">${beastH6('Harvestable Resources')}
    ${res.length ? `<p class="beast-p">${res.join('  ·  ')}</p>` : '<p class="settings-sub">N/A</p>'}
    ${beastH6('Special Abilities')}
    ${specials.length ? specials.map((s) => beastChip(`data-special="${escapeHtml(s.name)}" data-rank="${safeInt(s.rank)}" title="${escapeHtml(s.type || '')}"`, `${s.name} (${safeInt(s.rank)})`)).join('') : '<p class="settings-sub">N/A</p>'}</div>`;

  const varCard = c.similar_variants ? `<div class="scd-card beast-card beast-card-wide">${beastH6('Similar Variants')}<p class="beast-p">${escapeHtml(c.similar_variants)}</p></div>` : '';
  const extCard = `<div class="scd-card beast-card beast-card-wide">${beastH6('External Resources')}
    ${beastChip(`data-ext="${SITE_BASE}/creature.php?slug=${encodeURIComponent(c.slug)}"`, 'swgtracker.com', 'fa-solid fa-arrow-up-right-from-square')}</div>`;

  $('#creature-body').innerHTML = `<div class="beast-top">
    <div class="beast-main">
      <div class="beast-namerow"><h2 class="beast-name">${escapeHtml(c.name)}</h2><span class="beast-planets">${beastPlanetsHtml(c.planets)}</span></div>
      <div class="gx-detail-stats beast-stats">${stats}</div>
      <div class="beast-cards">${locCard}${resCard}${varCard}${extCard}</div>
    </div>
    ${beastModelHtml('creature-model')}
  </div>`;
  beastMountModel($('#creature-model'), d.model, d.model_color, { kind: 'creatures', slug: c.slug, palette: d.palette });
}

// ---- special ----
const specialDetailState = { pets: { sortField: 'name', sortOrder: 'ASC', q: '' }, creatures: { sortField: 'rank', sortOrder: 'DESC', q: '' }, focusRank: null };

async function openSpecialPage(name, rank) {
  const seq = beastDetailStart('special', '<a role="button" data-nav="specials">Specials</a> › …');
  specialDetailState.focusRank = rank != null && rank !== '' ? safeInt(rank) : null;
  specialDetailState.pets = { sortField: 'name', sortOrder: 'ASC', q: '' };
  specialDetailState.creatures = { sortField: 'rank', sortOrder: 'DESC', q: '' };
  let res;
  try { res = await apiFetch('GET', 'api/special_detail.php', { params: { name } }); } catch (e) { res = { ok: false, error: String(e) }; }
  if (seq !== beastDetail.seq) return;
  $('#special-loading').hidden = true;
  if (!res.ok || !res.data || !res.data.ranks) { beastSetEmpty('special', (res.data && res.data.error) || res.error || 'Special not found.'); return; }
  beastDetail.special = res.data;
  renderSpecialPage(res.data);
}

function renderSpecialPage(d) {
  const name = d.name || (d.ranks[0] && d.ranks[0].name) || '';
  const type = d.type || (d.ranks[0] && d.ranks[0].type) || '';
  $('#special-crumbs').innerHTML = `<a role="button" data-nav="specials">Specials</a> › ${escapeHtml(name)}`;
  const fr = specialDetailState.focusRank;
  const ranksRows = (d.ranks || []).map((r) => {
    const hl = fr !== null && safeInt(r.rank) === fr;
    return `<tr class="${hl ? 'beast-rank-hl' : ''}"><td class="col-num">${safeInt(r.rank)}${hl ? ' <i class="fa-solid fa-arrow-left beast-rank-arrow"></i>' : ''}</td>
      <td class="col-text">${escapeHtml(r.requirement || '')}</td><td class="col-text">${escapeHtml(r.action_cost || '')}</td>
      <td class="col-text">${escapeHtml(r.cooldown || '')}</td><td class="col-text beast-effect">${escapeHtml(r.effect || '')}</td></tr>`;
  }).join('');
  $('#special-body').innerHTML = `
    <div class="beast-namerow"><h2 class="beast-name">${escapeHtml(name)}</h2><span class="beast-stype ${beastTypeClass(type)}">${escapeHtml(type)}</span>
      ${beastChip(`data-ext="${SITE_BASE}/special.php?name=${encodeURIComponent(name)}"`, 'swgtracker.com', 'fa-solid fa-arrow-up-right-from-square')}</div>
    <section class="hm-section beast-fold" data-beastfold="ranks">
      <div class="hm-head"><i class="fa-solid fa-ranking-star hm-icon"></i><span class="hm-title">Ranks</span><span class="hm-count">${(d.ranks || []).length}</span><span class="hm-headright"></span><i class="fa-solid fa-chevron-down hm-caret"></i></div>
      <div class="hm-body"><table class="data-grid beast-subgrid"><thead><tr><th class="col-num">Rank</th><th class="col-text">Train Req</th><th class="col-text">Action</th><th class="col-text">Refresh</th><th class="col-text">Effect</th></tr></thead><tbody>${ranksRows}</tbody></table></div>
    </section>
    <section class="hm-section beast-fold" data-beastfold="pets">
      <div class="hm-head"><i class="fa-solid fa-paw hm-icon"></i><span class="hm-title">Pets with this special</span><span class="hm-count" id="special-pets-count"></span>
        <span class="hm-headright"><input id="special-pets-q" type="text" class="form-control filter-input beast-subq" placeholder="Filter pets..." autocomplete="off"></span><i class="fa-solid fa-chevron-down hm-caret"></i></div>
      <div class="hm-body"><table class="data-grid beast-subgrid"><thead><tr id="special-pets-head"></tr></thead><tbody id="special-pets-body"></tbody></table></div>
    </section>
    <section class="hm-section beast-fold" data-beastfold="creatures">
      <div class="hm-head"><i class="fa-solid fa-dragon hm-icon"></i><span class="hm-title">Creatures with this special</span><span class="hm-count" id="special-creatures-count"></span>
        <span class="hm-headright"><input id="special-creatures-q" type="text" class="form-control filter-input beast-subq" placeholder="Filter creatures..." autocomplete="off"></span><i class="fa-solid fa-chevron-down hm-caret"></i></div>
      <div class="hm-body"><table class="data-grid beast-subgrid"><thead><tr id="special-creatures-head"></tr></thead><tbody id="special-creatures-body"></tbody></table></div>
    </section>`;
  renderSpecialPets();
  renderSpecialCreatures();
}

const SPECIAL_PET_COLS = [['Name', 'name', 'col-name'], ['Family', 'family', 'col-text'], ['Bonus Group', 'bonus_group', 'col-text'], ['Source', 'source', 'col-text']];
const SPECIAL_CRE_COLS = [['Name', 'name', 'col-name'], ['Rank', 'rank', 'col-num'], ['Planets', 'planets', 'col-text'], ['Difficulty', 'difficulty', 'col-text']];

function renderSpecialPets() {
  const d = beastDetail.special; if (!d) return;
  const st = specialDetailState.pets;
  $('#special-pets-head').innerHTML = sortableHeaderHtml(SPECIAL_PET_COLS, st.sortField, st.sortOrder);
  const q = st.q.trim().toLowerCase();
  let rows = d.pets || [];
  if (q) rows = rows.filter((p) => [p.name, p.family, p.bonus_group, p.source].some((v) => String(v || '').toLowerCase().includes(q)));
  rows = gxSortRows(rows, st.sortField, st.sortOrder, new Set());
  $('#special-pets-count').textContent = `${rows.length}${q ? ` of ${(d.pets || []).length}` : ''}`;
  $('#special-pets-body').innerHTML = rows.length ? rows.map((p) => `<tr class="gx-rowlink beast-row" data-pet="${escapeHtml(p.slug)}">
      <td class="col-name"><b class="gx-detail-link">${escapeHtml(p.name)}</b></td><td class="col-text">${escapeHtml(p.family || '')}</td>
      <td class="col-text">${escapeHtml(p.bonus_group || '')}</td><td class="col-text">${escapeHtml(p.source || '')}</td></tr>`).join('')
    : '<tr><td colspan="4" class="settings-sub beast-none">N/A</td></tr>';
}

function renderSpecialCreatures() {
  const d = beastDetail.special; if (!d) return;
  const st = specialDetailState.creatures;
  $('#special-creatures-head').innerHTML = sortableHeaderHtml(SPECIAL_CRE_COLS, st.sortField, st.sortOrder);
  const q = st.q.trim().toLowerCase();
  let rows = d.creatures || [];
  if (q) rows = rows.filter((c) => [c.name, c.planets, c.difficulty, String(c.rank)].some((v) => String(v || '').toLowerCase().includes(q)));
  rows = gxSortRows(rows, st.sortField, st.sortOrder, new Set(['rank']));
  $('#special-creatures-count').textContent = `${rows.length}${q ? ` of ${(d.creatures || []).length}` : ''}`;
  const fr = specialDetailState.focusRank;
  $('#special-creatures-body').innerHTML = rows.length ? rows.map((c) => `<tr class="gx-rowlink beast-row ${fr !== null && safeInt(c.rank) === fr ? 'beast-rank-hl' : ''}" data-creature="${escapeHtml(c.slug)}">
      <td class="col-name"><b class="gx-detail-link">${escapeHtml(c.name)}</b></td><td class="col-num">${safeInt(c.rank)}</td>
      <td class="col-text beast-planets">${beastPlanetsHtml(c.planets)}</td><td class="col-text">${escapeHtml(c.difficulty || '')}</td></tr>`).join('')
    : '<tr><td colspan="4" class="settings-sub beast-none">N/A</td></tr>';
}

// ===================== wiring =====================
// clicks shared by every Beasts surface: row/chip -> detail page, stat card -> filtered
// list, waypoint chip -> clipboard, external chip -> the system browser
function beastHandleClick(e) {
  const t = e.target;
  if (t.closest('swg-creature') || t.closest('input') || t.closest('[data-sort]') || t.closest('.scd-recolor-panel')) return;
  if (t.closest('[data-beastzoom]')) { beastZoomModel(); return; }
  if (t.closest('[data-beastrecolor]')) { beastOpenRecolor(); return; }
  const pin = t.closest('[data-beastpin]');
  if (pin) {
    const kind = pin.dataset.beastkind; const set = beastPins[kind]; const slug = pin.dataset.beastpin;
    if (set.has(slug)) set.delete(slug); else set.add(slug);
    beastSavePins();
    if (kind === 'pets') renderPets(); else if (kind === 'creatures') renderCreatures(); else renderSpecials();
    return;
  }
  const ext = t.closest('[data-ext]');
  if (ext) { try { api().open_external(ext.dataset.ext); } catch (_) { /* no bridge */ } return; }
  const wp = t.closest('[data-wpcopy]');
  if (wp) { copyTextToClipboard(wp.dataset.wpcopy, 'Waypoint copied'); return; }
  const pf = t.closest('[data-petfilter]');
  if (pf) { openPetsFiltered(pf.dataset.petfilter, pf.dataset.val); return; }
  const cf = t.closest('[data-creaturefilter]');
  if (cf) { openCreaturesFiltered(cf.dataset.creaturefilter, cf.dataset.val); return; }
  const pet = t.closest('[data-pet]');
  if (pet) { openPetPage(pet.dataset.pet); return; }
  const cre = t.closest('[data-creature]');
  if (cre) { openCreaturePage(cre.dataset.creature); return; }
  const sp = t.closest('[data-special]');
  if (sp) { openSpecialPage(sp.dataset.special, sp.dataset.rank); return; }
  const fold = t.closest('.beast-fold > .hm-head');
  if (fold) fold.parentElement.classList.toggle('collapsed');
}

function initBeasts() {
  // collapsible nav group (same pattern as Galaxy: localStorage is instant, config is durable)
  // (the sidebar group folds via initNavGroups in app.js)

  ['pets', 'creatures', 'specials', 'pet', 'creature', 'special'].forEach((k) => {
    const page = document.getElementById(`page-${k}`);
    if (page) page.addEventListener('click', beastHandleClick);
  });
  // list | cards (remembered per page)
  [['pets', renderPets], ['creatures', renderCreatures]].forEach(([k, rerender]) => {
    $(`#${k}-view-switch`).addEventListener('click', (e) => {
      const b = e.target.closest('[data-beastview]'); if (!b) return;
      localStorage.setItem(`beast-view-${k}`, b.dataset.beastview);
      rerender();
    });
    beastApplyView(k, k);
  });
  // crumbs back to the list
  ['pet', 'creature', 'special'].forEach((k) => {
    $(`#${k}-crumbs`).addEventListener('click', (e) => {
      const link = e.target.closest('[data-nav]');
      if (link) showPage(link.dataset.nav);
    });
  });
  // drop the 3D viewer (its WebGL context) the moment a detail page stops being shown
  const pageObs = new MutationObserver(() => {
    const host = beastDetail.modelHost;
    if (host && !host.closest('.page.active')) beastUnmountModel();
  });
  ['pet', 'creature', 'special'].forEach((k) => {
    const page = document.getElementById(`page-${k}`);
    if (page) pageObs.observe(page, { attributes: true, attributeFilter: ['class'] });
  });

  // Pets
  $('#pets-search').addEventListener('input', renderPets);
  $('#pets-reload').addEventListener('click', () => loadPets(true));
  gxSortClick(petsState, '#pets-head', renderPets);
  [['#pets-family', 'family'], ['#pets-bonus', 'bonus'], ['#pets-source', 'source'], ['#pets-supplement', 'supplement'], ['#pets-color', 'color']]
    .forEach(([id, key]) => $(id).addEventListener('change', () => { petsState[key] = $(id).value; renderPets(); }));
  $('#pets-mount').addEventListener('click', () => { petsState.mount = !petsState.mount; renderPets(); });
  $('#pets-fly').addEventListener('click', () => { petsState.fly = !petsState.fly; renderPets(); });
  $('#pets-pinned-only').addEventListener('change', () => { petsState.pinnedOnly = $('#pets-pinned-only').checked; renderPets(); });
  $('#pets-prev').addEventListener('click', () => { if (petsState.page > 1) { petsState.page--; renderPets(); } });
  $('#pets-next').addEventListener('click', () => { petsState.page++; renderPets(); });
  // Creatures
  $('#creatures-search').addEventListener('input', renderCreatures);
  $('#creatures-reload').addEventListener('click', () => loadCreatures(true));
  gxSortClick(creaturesState, '#creatures-head', renderCreatures);
  [['#creatures-planet', 'planet'], ['#creatures-difficulty', 'difficulty'], ['#creatures-pettype', 'petType'], ['#creatures-damage', 'damage'], ['#creatures-dna', 'dna']]
    .forEach(([id, key]) => $(id).addEventListener('change', () => { creaturesState[key] = $(id).value; renderCreatures(); }));
  $('#creatures-pinned-only').addEventListener('change', () => { creaturesState.pinnedOnly = $('#creatures-pinned-only').checked; renderCreatures(); });
  $('#creatures-prev').addEventListener('click', () => { if (creaturesState.page > 1) { creaturesState.page--; renderCreatures(); } });
  $('#creatures-next').addEventListener('click', () => { creaturesState.page++; renderCreatures(); });
  beastLoadPins();
  // Specials
  $('#specials-search').addEventListener('input', renderSpecials);
  $('#specials-reload').addEventListener('click', () => loadSpecials(true));
  gxSortClick(specialsState, '#specials-head', renderSpecials);
  [['#specials-type', 'type'], ['#specials-rank', 'rank']]
    .forEach(([id, key]) => $(id).addEventListener('change', () => { specialsState[key] = $(id).value; renderSpecials(); }));
  $('#specials-pinned-only').addEventListener('change', () => { specialsState.pinnedOnly = $('#specials-pinned-only').checked; renderSpecials(); });
  $('#specials-prev').addEventListener('click', () => { if (specialsState.page > 1) { specialsState.page--; renderSpecials(); } });
  $('#specials-next').addEventListener('click', () => { specialsState.page++; renderSpecials(); });
  // Special detail sub-tables (rendered on demand — delegate from the body)
  const spBody = $('#special-body');
  spBody.addEventListener('input', (e) => {
    if (e.target.id === 'special-pets-q') { specialDetailState.pets.q = e.target.value; renderSpecialPets(); }
    if (e.target.id === 'special-creatures-q') { specialDetailState.creatures.q = e.target.value; renderSpecialCreatures(); }
  });
  spBody.addEventListener('click', (e) => {
    if (e.target.closest('.hm-headright')) e.stopPropagation(); // typing in the filter shouldn't fold the section
    const th = e.target.closest('[data-sort]'); if (!th) return;
    const which = th.closest('#special-pets-head') ? 'pets' : th.closest('#special-creatures-head') ? 'creatures' : null;
    if (!which) return;
    const st = specialDetailState[which];
    const f = th.dataset.sort;
    if (st.sortField === f) st.sortOrder = st.sortOrder === 'ASC' ? 'DESC' : 'ASC';
    else { st.sortField = f; st.sortOrder = f === 'rank' ? 'DESC' : 'ASC'; }
    if (which === 'pets') renderSpecialPets(); else renderSpecialCreatures();
  }, true);
}
