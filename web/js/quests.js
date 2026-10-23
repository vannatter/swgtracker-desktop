/* Quests — SWG Restoration's ground quests (1,869, from the DSRC quest datapad) in the
   app: a server-paged, filterable list (api/quests.php?list=1) and a full quest page
   (?id=<slug>) with numbered steps + "Copy /way", rewards and loot, givers, the quest
   chain, starter items, a Leaflet map of the step waypoints (planetmap.js's images,
   coordinate transform and trackpad manners), and community notes with screenshots
   (api/comments.php kind=quest, the shared cmtMount component) shown as a gallery.
   Also feeds a "Quests" layer on Planet Maps (?map=<planet>) and global search. */

// ---- DEV-MODE GATE -------------------------------------------------------------
// Quests ship hidden behind dev mode for now (Dustin, 2026-10-22). The ONE switch is
// the `dev-only` class on the sidebar's <li data-page="quests"> in index.html: the nav
// entry hides by CSS (body:not(.dev-mode) .dev-only), and everything else here —
// showPage's fallback to Home, global-search hits, the Planet Maps layer toggle —
// asks questsGated(), which reads that class. To launch: delete `dev-only` from that
// <li> (and from .qd-pm-toggle's className in questLayerAttach below). Done.
function questsGated() {
  const li = document.querySelector('.app-sidebar .nav-item[data-page="quests"]');
  return !!(li && li.classList.contains('dev-only') && !document.body.classList.contains('dev-mode'));
}

// raw DSRC planet names → label, badge class (.planet.<cls>) and the Planet Maps code
const QUEST_PLANETS = {
  tatooine: { label: 'Tatooine', cls: 'tatooine', pm: 'tat' },
  corellia: { label: 'Corellia', cls: 'corellia', pm: 'cor' },
  naboo: { label: 'Naboo', cls: 'naboo', pm: 'nab' },
  dathomir: { label: 'Dathomir', cls: 'dathomir', pm: 'dat' },
  talus: { label: 'Talus', cls: 'talus', pm: 'tal' },
  lok: { label: 'Lok', cls: 'lok', pm: 'lok' },
  rori: { label: 'Rori', cls: 'rori', pm: 'ror' },
  endor: { label: 'Endor', cls: 'endor', pm: 'end' },
  yavin4: { label: 'Yavin IV', cls: 'yavin', pm: 'yav' },
  mustafar: { label: 'Mustafar', cls: 'mustafar', pm: 'mus' },
  dantooine: { label: 'Dantooine', cls: 'dantooine', pm: 'dan' },
  kashyyyk_main: { label: 'Kashyyyk', cls: 'kashyyyk', pm: '' }, // the quest zones don't line up with the site's Kashyyyk map (api: on_map false)
  kashyyyk_dead_forest: { label: 'Kashyyyk (Dead Forest)', cls: 'kashyyyk', pm: '' },
  kashyyyk_hunting: { label: 'Kashyyyk (Hunting Grounds)', cls: 'kashyyyk', pm: '' },
  dungeon1: { label: 'Instance', cls: '', pm: '' },
};
// Planet Maps code → the raw name ?map= wants
const QUEST_PM_RAW = Object.fromEntries(Object.entries(QUEST_PLANETS).filter(([, p]) => p.pm).map(([raw, p]) => [p.pm, raw]));
const questPlanetLabel = (raw) => (QUEST_PLANETS[raw] ? QUEST_PLANETS[raw].label : String(raw || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()));
// The app's coloured planet badge (app.css .planet.<cls>, same markup the Resources grid
// uses). short = the grid's one-letter square; otherwise the planet's name in its colour.
// Kashyyyk zones share kashyyyk's colour, yavin4 → yavin, dungeon1/unknown → the neutral .planet.
function questPlanetBadge(raw, short) {
  const p = QUEST_PLANETS[raw];
  const label = questPlanetLabel(raw);
  const text = short ? label.charAt(0) : label;
  return `<span class="planet ${escapeHtml(p ? p.cls : '')}" title="${escapeHtml(label)}">${escapeHtml(text)}</span>`;
}
// grid cell: one square per colour (the Kashyyyk zones collapse into one K), in list order
function questPlanetSquares(list) {
  const seen = new Map();
  (list || []).forEach((raw) => {
    const k = (QUEST_PLANETS[raw] && QUEST_PLANETS[raw].cls) || `_${raw}`;
    if (!seen.has(k)) seen.set(k, [raw]); else seen.get(k).push(raw);
  });
  return [...seen.values()].map((raws) => (raws.length === 1 ? questPlanetBadge(raws[0], true)
    : questPlanetBadge(raws[0], true).replace(/title="[^"]*"/, `title="${escapeHtml(raws.map(questPlanetLabel).join(', '))}"`))).join('');
}
const questFmtNum = (n) => safeInt(n).toLocaleString();
const questXpType = (t) => String(t || '').replace(/^quest_/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const questTidyId = (id) => String(id || '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
const QUEST_INTERNAL_KINDS = new Set(['nothing', 'complete_quest', 'clear_quest', 'wait_for_tasks']);
function questFmtSecs(s) {
  s = safeInt(s); if (s <= 0) return '';
  const h = Math.floor(s / 3600); const m = Math.floor((s % 3600) / 60); const r = s % 60;
  return [h ? `${h}h` : '', m ? `${m}m` : '', r && !h ? `${r}s` : ''].filter(Boolean).join(' ');
}
// a /way line for a step waypoint (the API sends `way`; null = in-building cell coordinates,
// which aren't a world position, so there's nothing to copy)
function questWayCmd(wp) {
  if (!wp) return '';
  if (wp.way) return String(wp.way);
  if ('way' in wp || wp.cell) return '';
  return `/way ${wp.planet} ${safeInt(wp.x)} 0 ${safeInt(wp.z)} ${wp.name || ''}`.trim();
}
// can this waypoint be drawn on a planet map? (dungeon1 instances and in-building cells can't)
function questWpOnMap(wp) {
  if (!wp) return false;
  if (wp.on_map === false || wp.on_map === 0) return false;
  if (wp.cell) return false;
  const p = QUEST_PLANETS[wp.planet];
  return !!(p && p.pm);
}

// =================================================================================
// List
// =================================================================================
const questsState = { rows: [], total: 0, page: 1, per: 50, loaded: false, seq: 0, catsLoaded: false,
  q: '', category: '', planet: '', minLevel: '', maxLevel: '', type: '', repeatable: '', unused: false,
  sortField: 'title', sortOrder: 'ASC' };
// [label, sort key (null = not server-sortable), class]
const QUESTS_COLUMNS = [
  ['Title', 'title', 'col-name'], ['Category', 'category', 'col-text'], ['Level', 'level', 'col-num'],
  ['XP', 'xp', 'col-num'], ['Credits', null, 'col-num'], ['Planets', null, 'col-text'], ['', null, 'col-num q-col-notes'],
];

function questsHeadHtml() {
  const s = questsState;
  return QUESTS_COLUMNS.map(([label, f, cls]) => {
    if (!f) return `<th class="${cls}"${cls.includes('q-col-notes') ? ' title="Community notes · screenshots"' : ''}>${cls.includes('q-col-notes') ? '<i class="fa-regular fa-comment"></i>' : label}</th>`;
    const arrow = f === s.sortField ? (s.sortOrder === 'ASC' ? ' ▲' : ' ▼') : '';
    return `<th class="${cls}" data-sort="${f}">${label}${arrow}</th>`;
  }).join('');
}

async function questsLoadCategories() {
  if (questsState.catsLoaded) return;
  let res;
  try { res = await apiFetch('GET', 'api/quests.php', { params: { categories: 1 } }); } catch (_) { return; }
  const cats = (res && res.ok && res.data && res.data.categories) || [];
  if (!cats.length) return;
  questsState.catsLoaded = true;
  const sel = $('#quests-category');
  sel.innerHTML = '<option value="">All categories</option>'
    + cats.map((c) => `<option value="${escapeHtml(c.name)}">${escapeHtml(c.name)} (${questFmtNum(c.count)})</option>`).join('');
  sel.value = questsState.category;
  if (sel.value !== questsState.category) { sel.add(new Option(questsState.category, questsState.category)); sel.value = questsState.category; }
}

function loadQuests(force = false) {
  if (questsGated()) return;
  questsLoadCategories();
  if (questsState.loaded && !force) { renderQuests(); return; }
  fetchQuests();
}

async function fetchQuests() {
  const s = questsState;
  const seq = ++s.seq;
  $('#quests-loading').hidden = false;
  $('#quests-empty').hidden = true;
  const params = { list: 1, page: s.page, per: s.per, sort: s.sortField, order: s.sortOrder.toLowerCase() };
  if (s.q) params.q = s.q;
  if (s.category) params.category = s.category;
  if (s.planet) params.planet = s.planet;
  if (s.minLevel !== '') params.min_level = s.minLevel;
  if (s.maxLevel !== '') params.max_level = s.maxLevel;
  if (s.type) params.type = s.type;
  if (s.repeatable !== '') params.repeatable = s.repeatable;
  if (s.unused) params.unused = 1;
  let res;
  try { res = await apiFetch('GET', 'api/quests.php', { params }); } catch (e) { res = { ok: false, error: String(e) }; }
  if (seq !== s.seq) return; // a newer filter won
  $('#quests-loading').hidden = true;
  if (!res.ok || !res.data || res.data.error) {
    s.rows = []; s.total = 0; renderQuests();
    const el = $('#quests-empty'); el.hidden = false;
    el.textContent = (res.data && res.data.error) || res.error || 'Could not load quests.';
    return;
  }
  s.rows = res.data.quests || [];
  s.total = safeInt(res.data.total);
  s.loaded = true;
  renderQuests();
  const wrap = $('#quests-body').closest('.table-wrap'); if (wrap) wrap.scrollTop = 0;
}

function renderQuests() {
  const s = questsState;
  $('#quests-head').innerHTML = questsHeadHtml();
  const rows = s.rows;
  $('#quests-body').innerHTML = rows.map((q) => {
    const planets = questPlanetSquares(q.planets);
    const flags = [q.type === 'group' ? '<span class="q-flag q-flag-group" title="Group quest">Group</span>' : '',
      safeInt(q.repeatable) ? '<i class="fa-solid fa-repeat q-flag-rep" title="Repeatable"></i>' : ''].join('');
    const nC = safeInt(q.comments); const nS = safeInt(q.screenshots);
    const notes = (nC ? `<span class="q-cnt" title="${nC} note${nC === 1 ? '' : 's'}"><i class="fa-regular fa-comment"></i> ${nC}</span>` : '')
      + (nS ? `<span class="q-cnt" title="${nS} screenshot${nS === 1 ? '' : 's'}"><i class="fa-regular fa-image"></i> ${nS}</span>` : '');
    return `<tr class="gx-rowlink q-row" data-questopen="${escapeHtml(q.id)}">
      <td class="col-name"><b class="gx-detail-link">${escapeHtml(q.title || questTidyId(q.id))}</b>${flags}${q.variant ? `<div class="q-variant">${escapeHtml(q.variant)}</div>` : ''}</td>
      <td class="col-text">${escapeHtml(q.category || '')}</td>
      <td class="col-num">${safeInt(q.level) || ''}</td>
      <td class="col-num">${safeInt(q.xp) ? questFmtNum(q.xp) : ''}</td>
      <td class="col-num">${safeInt(q.credits) ? questFmtNum(q.credits) : ''}</td>
      <td class="col-planets q-planets">${planets}</td>
      <td class="col-num q-col-notes">${notes}</td>
    </tr>`;
  }).join('');
  const pages = Math.max(1, Math.ceil(s.total / s.per));
  const from = (s.page - 1) * s.per;
  $('#quests-status').textContent = !s.loaded ? '' : !s.total ? 'No quests match'
    : `Showing ${from + 1}–${from + rows.length} of ${questFmtNum(s.total)} quests`;
  $('#quests-prev').disabled = s.page <= 1;
  $('#quests-next').disabled = s.page >= pages;
  if (s.loaded && !rows.length) { const el = $('#quests-empty'); el.hidden = false; el.textContent = 'No quests match these filters.'; }
}

// open the list with filters preset (detail page's category chip, other pages) — the list's deep link
function openQuestsFiltered(f = {}) {
  const s = questsState;
  Object.assign(s, { q: '', category: '', planet: '', minLevel: '', maxLevel: '', type: '', repeatable: '', unused: false, page: 1 });
  ['q', 'category', 'planet', 'type', 'repeatable'].forEach((k) => { if (f[k] != null) s[k] = String(f[k]); });
  if (f.minLevel != null) s.minLevel = String(f.minLevel);
  if (f.maxLevel != null) s.maxLevel = String(f.maxLevel);
  questsSyncControls();
  showPage('quests');
  if (!questsGated()) fetchQuests();
}
function questsSyncControls() {
  const s = questsState;
  $('#quests-search').value = s.q;
  const cat = $('#quests-category');
  cat.value = s.category;
  if (s.category && cat.value !== s.category) { cat.add(new Option(s.category, s.category)); cat.value = s.category; }
  $('#quests-planet').value = s.planet;
  $('#quests-minlvl').value = s.minLevel;
  $('#quests-maxlvl').value = s.maxLevel;
  $('#quests-type').value = s.type;
  $('#quests-repeat').value = s.repeatable;
  $('#quests-unused').checked = s.unused;
}

// =================================================================================
// Detail
// =================================================================================
const qdState = { seq: 0, quest: null, slug: '', steps: [], map: null, comments: [] };

async function openQuestPage(slug) {
  if (!slug) return;
  showPage('quest');
  if (questsGated()) return; // showPage already fell back to Home
  const seq = ++qdState.seq;
  qdState.slug = String(slug);
  qdDestroyMap();
  $('#quest-crumbs').innerHTML = '<a role="button" data-nav="quests">Quests</a> › …';
  $('#quest-body').innerHTML = '';
  $('#quest-empty').hidden = true;
  $('#quest-loading').hidden = false;
  $('#quest-copyall').hidden = true;
  let res;
  try { res = await apiFetch('GET', 'api/quests.php', { params: { id: slug } }); } catch (e) { res = { ok: false, error: String(e) }; }
  if (seq !== qdState.seq) return;
  $('#quest-loading').hidden = true;
  const q = res.ok && res.data ? (res.data.quest || res.data) : null;
  if (!q || res.data.error || !(q.title || q.steps)) {
    const el = $('#quest-empty'); el.hidden = false;
    el.textContent = (res.data && res.data.error) || res.error || 'Quest not found.';
    return;
  }
  qdState.quest = q;
  renderQuestPage(q);
  const wrap = $('#quest-body').closest('.table-wrap'); if (wrap) wrap.scrollTop = 0;
}

// an NPC's name, linked to its NPC page when the API knows it (npc_id; absent on older deploys)
const questNpcName = (name, npcId) => (npcId ? `<a role="button" class="qd-npclink" data-npcopen="${escapeHtml(String(npcId))}" title="Open ${escapeHtml(name)}'s page">${escapeHtml(name)}</a>` : escapeHtml(name));
// a chain entry may come as a slug or as {id, title}
const qdRef = (x) => (x && typeof x === 'object' ? { id: x.id, title: x.title || questTidyId(x.id) } : { id: String(x || ''), title: questTidyId(x) });
const qdChainLinks = (list) => (list || []).map(qdRef).filter((r) => r.id && r.id !== 'under_construction')
  .map((r) => `<a role="button" class="qd-chainlink" data-questopen="${escapeHtml(r.id)}" title="Open this quest">${escapeHtml(r.title)}</a>`).join('');

function qdStepFacts(st) {
  const f = [];
  const n = safeInt(st.count) || safeInt(st.required);
  if (st.target) f.push(`<span><i class="fa-solid fa-crosshairs"></i> ${n > 1 ? `${n} × ` : ''}${questNpcName(st.target, st.target_npc_id || st.npc_id)}</span>`);
  if (st.social_group) f.push(`<span><i class="fa-solid fa-users"></i> any member of ${escapeHtml(st.social_group)}</span>`);
  if (st.server_template && st.server_template !== st.target) f.push(`<span><i class="fa-solid fa-user"></i> ${questNpcName(st.server_template, st.server_template_npc_id || (st.target ? null : st.npc_id))}</span>`);
  if (st.item) f.push(`<span><i class="fa-solid fa-box"></i> ${!st.target && n > 1 ? `${n} × ` : ''}${escapeHtml(st.item)}${st.drop_pct ? ` <span class="qd-muted">(${escapeHtml(String(st.drop_pct))}% drop)</span>` : ''}</span>`);
  if (safeInt(st.timer)) f.push(`<span><i class="fa-regular fa-clock"></i> ${questFmtSecs(st.timer)}</span>`);
  if (st.region) f.push(`<span><i class="fa-solid fa-draw-polygon"></i> ${escapeHtml(st.region)}</span>`);
  if (safeInt(st.credits)) f.push(`<span><i class="fa-solid fa-coins"></i> ${questFmtNum(st.credits)} cr</span>`);
  return f.length ? `<div class="qd-facts">${f.join('')}</div>` : '';
}

function qdStepHtml(st) {
  const wp = st.wp;
  const onMap = questWpOnMap(wp);
  let wpHtml = '';
  if (wp) {
    const way = questWayCmd(wp);
    const where = wp.planet === 'dungeon1' ? 'inside an instance' : wp.cell ? `inside a building (${escapeHtml(wp.cell)})` : '';
    wpHtml = `<div class="qd-wp">
      <i class="fa-solid fa-location-dot"></i>
      <span class="qd-wp-name">${escapeHtml(wp.name || 'Waypoint')}</span>
      ${questPlanetBadge(wp.planet)}
      <span class="qd-muted">${safeInt(wp.x)}, ${safeInt(wp.z)}</span>
      ${where ? `<span class="qd-offtag" title="This spot isn't on a planet map">${where}</span>` : ''}
      ${way ? `<button type="button" class="btn btn-sm btn-outline-secondary qd-way" data-qway="${escapeHtml(way)}" title="${escapeHtml(way)}${where ? ' — the coordinates are inside an instance, so the in-game arrow may not lead straight there' : ''}"><i class="fa-regular fa-clone"></i> Copy /way</button>` : ''}
    </div>`;
  }
  return `<li class="qd-step${onMap ? ' qd-step-mapped' : ''}" data-qstep="${st.n}"${onMap ? ` title="Click to show it on the map"` : ''}>
    <span class="qd-stepnum">${st.n}</span>
    <div class="qd-stepmain">
      <div class="qd-steptop"><span class="qd-kind">${escapeHtml(st.kind_label || questTidyId(st.kind))}</span><span class="qd-steptitle">${escapeHtml(st.title || '')}</span></div>
      ${st.desc && st.desc !== st.title ? `<div class="qd-stepdesc">${escapeHtml(st.desc)}</div>` : ''}
      ${qdStepFacts(st)}
      ${st.comm ? `<div class="qd-comm"><i class="fa-solid fa-tower-broadcast"></i> ${escapeHtml(st.comm)}</div>` : ''}
      ${wpHtml}
    </div>
  </li>`;
}

function renderQuestPage(q) {
  const title = q.title || questTidyId(q.id || qdState.slug);
  $('#quest-crumbs').innerHTML = `<a role="button" data-nav="quests">Quests</a>${q.category ? ` › <a role="button" data-qfilter="category" data-val="${escapeHtml(q.category)}">${escapeHtml(q.category)}</a>` : ''} › ${escapeHtml(title)}`;
  // steps: player-facing only, renumbered 1..n in journal order
  const steps = (q.steps || []).filter((s) => !QUEST_INTERNAL_KINDS.has(s.kind) && s.visible !== false)
    .map((s, i) => Object.assign({}, s, { n: safeInt(s.n) || i + 1 }));
  qdState.steps = steps;
  const r = q.rewards || {};
  const stat = (label, val, attrs) => `<div class="gx-dstat beast-stat${attrs ? ' beast-stat-link' : ''}" ${attrs || ''}><div class="gx-dstat-l">${escapeHtml(label)}</div><div class="gx-dstat-v gx-dstat-sm">${val}</div></div>`;
  const stats = [
    stat('Category', escapeHtml(q.category || '—'), q.category ? `data-qfilter="category" data-val="${escapeHtml(q.category)}" title="All ${escapeHtml(q.category)} quests"` : ''),
    stat('Level', safeInt(q.level) ? String(safeInt(q.level)) : '—', safeInt(q.level) ? `data-qfilter="level" data-val="${safeInt(q.level)}" title="Quests around level ${safeInt(q.level)}"` : ''),
    stat('XP', safeInt(r.xp) ? `${questFmtNum(r.xp)}${r.xp_type ? ` <span class="qd-muted">${escapeHtml(questXpType(r.xp_type))}</span>` : ''}` : '—'),
    stat('Credits', safeInt(r.credits) ? questFmtNum(r.credits) : '—'),
    stat('Type', q.type === 'group' ? 'Group' : 'Solo', `data-qfilter="type" data-val="${q.type === 'group' ? 'group' : 'solo'}" title="All ${q.type === 'group' ? 'group' : 'solo'} quests"`),
    stat('Repeatable', safeInt(q.repeatable) ? 'Yes' : 'No'),
  ].join('');

  // rewards
  const loot = r.loot || [];
  const anyChoice = loot.some((l) => l.choice);
  const rewardRows = [
    safeInt(r.xp) ? `<tr><td class="beast-kv-l">Experience</td><td class="beast-kv-v">${questFmtNum(r.xp)} ${escapeHtml(questXpType(r.xp_type))}</td></tr>` : '',
    safeInt(r.credits) ? `<tr><td class="beast-kv-l">Credits</td><td class="beast-kv-v">${questFmtNum(r.credits)}</td></tr>` : '',
    r.faction && safeInt(r.faction_amt) ? `<tr><td class="beast-kv-l">Faction</td><td class="beast-kv-v">${safeInt(r.faction_amt) > 0 ? '+' : ''}${questFmtNum(r.faction_amt)} ${escapeHtml(r.faction)}</td></tr>` : '',
  ].join('');
  const lootHtml = loot.length ? `<ul class="qd-loot">${loot.map((l) => `<li class="${l.choice ? 'qd-choice' : ''}">
      <span>${escapeHtml(l.name || l.item || 'Item')}</span>${safeInt(l.count) > 1 ? ` <span class="qd-muted">× ${safeInt(l.count)}</span>` : ''}
      ${l.choice ? '<span class="qd-choicetag" title="One of the pick-one items">pick one</span>' : ''}</li>`).join('')}</ul>
      ${anyChoice ? '<div class="settings-sub">Items marked <b>pick one</b> are a choice — you get one of them.</div>' : ''}` : '';
  const rewardsPane = rewardRows || lootHtml ? `<div class="qd-panecols">
    ${rewardRows ? `<div><h6>Rewards</h6><table class="beast-kv">${rewardRows}</table></div>` : ''}
    ${lootHtml ? `<div><h6>Loot${loot.length > 1 ? ` <span class="qd-muted">${loot.length}</span>` : ''}</h6>${lootHtml}</div>` : ''}</div>` : '';

  // givers
  const givers = q.givers || [];
  const giversPane = givers.length ? givers.map((g) => {
    const areas = (Array.isArray(g.areas) ? g.areas : [g.areas]).filter(Boolean);
    return `<div class="qd-giver"><i class="fa-solid fa-user"></i> <b>${questNpcName(g.name || 'Unknown', g.npc_id)}</b>${areas.length ? ` <span class="qd-muted">${areas.map((a) => escapeHtml(QUEST_PLANETS[a] ? questPlanetLabel(a) : a)).join(', ')}</span>` : ''}</div>`;
  }).join('') : '';

  // chain
  const ch = q.chain || {};
  const chainRows = [
    ['Started by', qdChainLinks(ch.granted_by)], ['Leads to', qdChainLinks(ch.leads_to)],
    ['Requires', qdChainLinks(ch.prereqs)], ['Blocked by', qdChainLinks(ch.exclusions)],
  ].filter(([, v]) => v);
  const chainCount = ['granted_by', 'leads_to', 'prereqs', 'exclusions'].reduce((n, k) => n + (ch[k] || []).length, 0);
  const chainPane = chainRows.length ? chainRows.map(([l, v]) => `<div class="qd-chainrow"><span class="qd-chainl">${l}</span><span class="qd-chainv">${v}</span></div>`).join('') : '';

  // starter items
  const items = q.starter_items || [];
  const itemsPane = items.length ? `${items.map((it) => `<div class="qd-item">
      <div><b>${escapeHtml(it.name || 'Item')}</b> ${(it.sources || []).filter((s) => s !== 'unknown').map((s) => `<span class="qd-srctag">${escapeHtml(s)}</span>`).join('')}</div>
      ${it.detail ? `<div class="qd-muted qd-itemdetail">${escapeHtml(it.detail)}</div>` : ''}
      ${(it.drops || []).length ? `<div class="qd-drops"><span class="qd-muted">Dropped by</span> ${(it.drops || []).slice(0, 30).map((d) => `<span class="qd-drop">${escapeHtml(d.name || '')}${safeInt(d.level) ? ` <span class="qd-muted">lv ${safeInt(d.level)}</span>` : ''}${(d.areas || []).length ? ` <span class="qd-muted">· ${(d.areas || []).map((a) => escapeHtml(questPlanetLabel(a))).join(', ')}</span>` : ''}</span>`).join('')}${(it.drops || []).length > 30 ? ` <span class="qd-muted">+${(it.drops || []).length - 30} more</span>` : ''}</div>` : ''}
    </div>`).join('')}` : '';

  // the lower panel: one tab strip (the resource/schematic pages' .scd-tabs); empty tabs
  // drop out, Notes always stays so anyone can post; the last pick is remembered
  const tabs = [
    ['rewards', 'Rewards', rewardsPane],
    ['givers', `Givers <span class="qd-tabn">${givers.length}</span>`, giversPane],
    ['chain', `Chain <span class="qd-tabn">${chainCount || ''}</span>`, chainPane],
    ['items', `Starter items <span class="qd-tabn">${items.length}</span>`, itemsPane],
  ].filter(([, , html]) => html);
  const tabBtn = (k, label, hidden) => `<li${hidden ? ' hidden' : ''}><button type="button" class="scd-tab" data-qtab="${k}">${label}</button></li>`;

  // same quest, other giver / faction / profession path (api: variants, may be absent on older deploys)
  const variants = (Array.isArray(q.variants) ? q.variants : []).filter((v) => v && v.id && v.id !== q.id);
  const variantsHtml = variants.length ? `<div class="qd-variants"><span class="qd-muted">Other versions:</span> ${variants.map((v) => `<a role="button" class="qd-chainlink" data-questopen="${escapeHtml(v.id)}" title="${escapeHtml(v.title || '')}">${escapeHtml(v.variant || v.title || questTidyId(v.id))}</a>`).join(' · ')}</div>` : '';

  const mapped = steps.filter((s) => questWpOnMap(s.wp));
  const offMap = steps.filter((s) => s.wp && !questWpOnMap(s.wp));
  const anyWp = steps.some((s) => s.wp);
  $('#quest-copyall').hidden = !steps.some((s) => questWayCmd(s.wp));
  const mapCol = anyWp ? `<div class="qd-mapcol">
      ${mapped.length ? `<div class="qd-maptabs" id="qd-maptabs"></div><div class="qd-mapbox"><div id="qd-map" class="pm-map qd-map"></div></div>`
        : '<div class="qd-nomap empty-state is-compact">None of this quest’s waypoints are on a planet map.</div>'}
      ${offMap.length ? `<div class="qd-offmap"><i class="fa-solid fa-circle-info"></i> Not on a planet map: ${offMap.map((s) => `<a role="button" data-qstepgo="${s.n}">step ${s.n}</a>`).join(', ')} — ${offMap.some((s) => s.wp.planet === 'dungeon1') ? 'instance' : ''}${offMap.some((s) => s.wp.planet === 'dungeon1') && offMap.some((s) => s.wp.cell) ? ' and ' : ''}${offMap.some((s) => s.wp.cell) ? 'in-building' : ''}${offMap.some((s) => s.wp.planet !== 'dungeon1' && !s.wp.cell) ? `${offMap.some((s) => s.wp.planet === 'dungeon1' || s.wp.cell) ? ' and ' : ''}off-map zone` : ''} coordinates.</div>` : ''}
    </div>` : '';

  $('#quest-body').innerHTML = `
    <div class="beast-namerow qd-namerow"><h2 class="beast-name">${escapeHtml(title)}</h2>${q.variant ? `<span class="q-variant qd-variant">${escapeHtml(q.variant)}</span>` : ''}
      ${[...new Set(steps.filter((s) => s.wp).map((s) => s.wp.planet))].map((p) => questPlanetBadge(p)).join(' ')}
      ${q.type === 'group' ? '<span class="q-flag q-flag-group">Group</span>' : ''}${safeInt(q.repeatable) ? '<span class="q-flag"><i class="fa-solid fa-repeat"></i> Repeatable</span>' : ''}</div>
    <div class="gx-detail-stats beast-stats">${stats}</div>
    ${variantsHtml}
    ${q.desc ? `<p class="qd-desc">${escapeHtml(q.desc)}</p>` : ''}
    ${q.summary && q.summary !== q.desc ? `<p class="qd-summary"><span class="qd-muted">On completion:</span> ${escapeHtml(q.summary)}</p>` : ''}
    <div class="qd-main${anyWp ? '' : ' qd-main-nomap'}">
      <div class="qd-stepscol">
        <section class="hm-section qd-fold" data-qfold="steps">
          <div class="hm-head"><i class="fa-solid fa-list-ol hm-icon"></i><span class="hm-title">Steps</span><span class="hm-count">${steps.length}</span><span class="hm-headright"></span><i class="fa-solid fa-chevron-down hm-caret"></i></div>
          <div class="hm-body">${steps.length ? `<ol class="qd-steps">${steps.map(qdStepHtml).join('')}</ol>` : '<div class="empty-state is-compact">No journal steps listed.</div>'}</div>
        </section>
      </div>
      ${mapCol}
    </div>
    <ul class="scd-tabs qd-tabs" id="qd-tabs">
      ${tabs.map(([k, label]) => tabBtn(k, label)).join('')}
      ${tabBtn('notes', 'Notes <span class="qd-tabn" data-qcount="notes"></span>')}
      ${tabBtn('shots', 'Screenshots <span class="qd-tabn" data-qcount="shots"></span>', true)}
    </ul>
    ${tabs.map(([k, , html]) => `<div class="qd-pane" data-qpane="${k}" hidden>${html}</div>`).join('')}
    <div class="qd-pane qd-pane-flush" data-qpane="notes" hidden><div id="qd-comments" class="cmt-section qd-comments"></div></div>
    <div class="qd-pane" data-qpane="shots" hidden><div class="qd-gallery" id="qd-gallery"></div></div>`;
  qdShowTab(qdSavedTab(), true); // transient: a tab this quest lacks mustn't overwrite the remembered pick

  if (mapped.length) qdBuildMap(mapped);
  if (qdState.gallery) qdState.gallery.dead = true;
  qdState.gallery = { root: '#quest-body', kind: 'quest', id: safeInt(q.numeric_id), storeKey: 'quest_tab', list: [] };
  if (safeInt(q.numeric_id)) {
    cmtMount('#qd-comments', 'quest', safeInt(q.numeric_id), {
      head: 'Quest notes', sub: 'tips, routes, screenshots — visible to every app user',
      placeholder: 'Share a tip, a route or a screenshot for this quest…',
      maxW: 1920, onRows: qdRenderGallery, onImage: (u) => qOpenShot(qdState.gallery, u),
    });
  } else {
    $('#qd-comments').innerHTML = '<div class="empty-state is-compact">Notes aren’t available for this quest.</div>';
  }
}

// =================================================================================
// Shared by the quest + NPC pages: the lower tab panel, the screenshot gallery and
// the pin map. Each page passes its root (#quest-body / #npc-body) and a state object.
// =================================================================================
function qTabsSaved(storeKey, dflt) { try { return localStorage.getItem(storeKey) || dflt; } catch (_) { return dflt; } }
// show tab k under root (falls back to the first visible tab); transient = don't remember it
function qTabsShow(root, k, storeKey, transient) {
  const btns = [...document.querySelectorAll(`${root} .qd-tabs [data-qtab]`)];
  const avail = btns.filter((b) => !b.parentElement.hidden).map((b) => b.dataset.qtab);
  if (!avail.includes(k)) k = avail[0] || 'notes';
  btns.forEach((b) => b.classList.toggle('active', b.dataset.qtab === k));
  document.querySelectorAll(`${root} [data-qpane]`).forEach((p) => { p.hidden = p.dataset.qpane !== k; });
  if (!transient) { try { localStorage.setItem(storeKey, k); } catch (_) { /* fine */ } }
}

// screenshot gallery (images ride on the entity's notes). comments.php?images=1 lists every
// photo oldest-first; an older site deploy without it falls back to the photos among the
// notes just loaded. g = { root, kind, id, storeKey } — g.list holds what the strip shows.
// a note's thumbnail opens the page's lightbox at that screenshot
function qOpenShot(g, url) {
  const list = g && g.list && g.list.length ? g.list : [{ image: url, body: '', by: '' }];
  questLightbox(list, Math.max(0, list.findIndex((c) => c.image === url)));
}
async function qGalleryRender(g, rows) {
  const id = g.id;
  const seq = (g.seq = (g.seq || 0) + 1); // a slower, older load must not overwrite a newer one
  const notesN = document.querySelector(`${g.root} [data-qcount="notes"]`); if (notesN) notesN.textContent = (rows || []).length || '';
  // one entry per screenshot (a note can carry several); the gallery endpoint below is the authority
  let list = (rows || []).flatMap((c) => cmtImagesOf(c).map((u, k) => ({ id: safeInt(c.id), n: k, image: u, body: c.body, by: c.by, at: c.at })));
  if (id) {
    let res = null;
    try { res = await apiFetch('GET', 'api/comments.php', { params: { kind: g.kind, id, images: 1 } }); } catch (_) { /* fallback */ }
    if (seq !== g.seq || g.dead) return; // superseded / navigated away
    const imgs = res && res.ok && res.data && Array.isArray(res.data.images) ? res.data.images : null;
    if (imgs) list = imgs.map((x) => ({ id: safeInt(x.id), n: safeInt(x.n), image: x.url, body: x.body, by: x.by, at: x.at }));
  }
  g.list = list;
  if (g.kind === 'npc') npcRenderPicker();
  const gal = document.querySelector(`${g.root} .qd-gallery`); if (!gal) return;
  const n = list.length;
  const cnt = document.querySelector(`${g.root} [data-qcount="shots"]`); if (cnt) cnt.textContent = n || '';
  const tab = document.querySelector(`${g.root} .qd-tabs [data-qtab="shots"]`);
  if (tab) {
    tab.parentElement.hidden = !n;
    // the remembered tab was Screenshots and this entity just turned out to have some
    if (n && qTabsSaved(g.storeKey, '') === 'shots') qTabsShow(g.root, 'shots', g.storeKey, true);
    else if (!n && tab.classList.contains('active')) qTabsShow(g.root, 'notes', g.storeKey, true);
  }
  // NPC pages star their main photo (g.mainUrl)
  gal.innerHTML = list.map((c, i) => { const main = g.mainUrl && c.image === g.mainUrl; return `<button type="button" class="qd-thumb${main ? ' qd-thumb-main' : ''}" data-qshot="${i}" title="${escapeHtml(c.by || '')}${c.body ? ` — ${escapeHtml(String(c.body).slice(0, 80))}` : ''}">
      <img src="${escapeHtml(questImgUrl(c.image))}" loading="lazy" alt="">${main ? '<span class="qd-thumb-badge"><i class="fa-solid fa-star"></i> Main</span>' : ''}</button>`; }).join('');
}

// ---- pin map: one Leaflet map, a planet tab per planet, pins grouped by spot ----
// pins: [{ pm, x, z, key, ... }]; o: { tabsEl, labelFor(group), popupFor(group),
// pinClass(group), onOver(keys, on), onClick(keys) }. Returns the map state.
async function qMapBuild(elId, pins, o) {
  let L;
  try { L = await pmEnsureLeaflet(); } catch (e) {
    const el = document.getElementById(elId); if (el) el.innerHTML = `<div class="qd-nomap empty-state is-compact">${escapeHtml(String(e.message || e))}</div>`;
    return null;
  }
  if (!document.getElementById(elId)) return null;
  const planets = [];
  pins.forEach((p) => { if (!planets.includes(p.pm)) planets.push(p.pm); });
  const map = L.map(elId, { crs: L.CRS.Simple, minZoom: -2, maxZoom: 2, zoomSnap: 0, zoomDelta: 0.5, attributionControl: false, scrollWheelZoom: false });
  pmTrackpadManners(map);
  map.touchZoom.disable(); map.boxZoom.disable();
  const st = { map, L, planets, planet: null, image: null, layer: L.layerGroup().addTo(map), keyPin: {}, pins, o };
  const tabs = document.getElementById(o.tabsEl);
  if (tabs) {
    tabs.innerHTML = planets.map((pm) => {
      const raw = QUEST_PM_RAW[pm];
      const n = pins.filter((p) => p.pm === pm).length;
      return `<button type="button" class="qd-maptab" data-qmaptab="${pm}"><span class="planet ${QUEST_PLANETS[raw].cls}"></span>${escapeHtml(questPlanetLabel(raw))} <span class="qd-muted">${n}</span></button>`;
    }).join('');
  }
  qMapSetPlanet(st, planets[0]);
  return st;
}
function qMapSetPlanet(st, pm, keepView) {
  if (!st) return;
  const { L, map, o } = st;
  const bounds = [[0, 0], [PM_SIZE, PM_SIZE]];
  const tabs = document.getElementById(o.tabsEl);
  if (tabs) tabs.querySelectorAll('[data-qmaptab]').forEach((b) => b.classList.toggle('active', b.dataset.qmaptab === pm));
  if (st.planet === pm) return;
  st.planet = pm;
  map.closePopup();
  if (st.image) map.removeLayer(st.image);
  st.image = L.imageOverlay(pmImg(pm), bounds).addTo(map);
  st.image.bringToBack();
  st.layer.clearLayers();
  st.keyPin = {};
  const groups = new Map();
  st.pins.filter((p) => p.pm === pm).forEach((p) => {
    const k = `${safeInt(p.x)},${safeInt(p.z)}`;
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(p);
  });
  const lls = [];
  groups.forEach((group) => {
    const keys = group.map((p) => p.key);
    const label = String(o.labelFor(group));
    const w = Math.max(22, 10 + label.length * 7);
    const icon = L.divIcon({ className: `qd-pin ${o.pinClass ? o.pinClass(group) : ''}`, html: `<span class="qd-pin-n" style="min-width:${w}px">${escapeHtml(label)}</span>`, iconSize: [w, 22], iconAnchor: [w / 2, 22], popupAnchor: [0, -20] });
    const ll = pmToLatLng(safeInt(group[0].x), safeInt(group[0].z));
    lls.push(ll);
    const m = L.marker(ll, { icon, riseOnHover: true }).bindPopup(o.popupFor(group), { autoPan: false });
    if (o.onOver) { m.on('mouseover', () => o.onOver(keys, true)); m.on('mouseout', () => o.onOver(keys, false)); }
    if (o.onClick) m.on('click', () => o.onClick(keys));
    st.layer.addLayer(m);
    keys.forEach((k) => { st.keyPin[k] = m; });
  });
  if (!keepView) {
    if (lls.length === 1) map.setView(lls[0], 0);
    else if (lls.length) map.fitBounds(L.latLngBounds(lls).pad(0.35), { maxZoom: 1 });
    else map.fitBounds(bounds);
    if (lls.length > 1 && map.getZoom() < -1.5) map.fitBounds(bounds);
  }
}
function qMapPinEl(st, key) { const m = st && st.keyPin[key]; return m && m.getElement ? m.getElement() : null; }
// switch to the pin's planet, centre on it and open its card
function qMapFocus(st, key, pm) {
  if (!st) return;
  if (pm && st.planet !== pm) qMapSetPlanet(st, pm, true);
  const m = st.keyPin[key]; if (!m) return;
  st.map.setView(m.getLatLng(), Math.max(st.map.getZoom(), 0.5), { animate: true });
  m.openPopup();
}
function qMapDestroy(st) { if (st) { try { st.map.remove(); } catch (_) { /* gone */ } } }

// =================================================================================
// Quest page wrappers
// =================================================================================
function qdSavedTab() { return qTabsSaved('quest_tab', 'rewards'); }
function qdShowTab(k, transient) { qTabsShow('#quest-body', k, 'quest_tab', transient); }
function qdRenderGallery(rows) {
  const g = qdState.gallery; if (!g) return;
  qGalleryRender(g, rows);
}

function questImgUrl(u) { return /^https?:/i.test(String(u)) ? String(u) : `https://swgtracker.com${String(u).startsWith('/') ? '' : '/'}${u}`; }

const qlb = { i: 0, list: [] };
function questLightbox(list, i) {
  qlb.list = list; qlb.i = i;
  let el = $('#q-lightbox');
  if (!el) {
    el = document.createElement('div');
    el.id = 'q-lightbox'; el.className = 'q-lightbox'; el.tabIndex = -1;
    el.innerHTML = `<button type="button" class="q-lb-btn q-lb-x" data-qlb="close" title="Close (Esc)"><i class="fa-solid fa-xmark"></i></button>
      <button type="button" class="q-lb-btn q-lb-win" data-qlb="window" title="Open in a movable window"><i class="fa-regular fa-window-restore"></i></button>
      <button type="button" class="q-lb-btn q-lb-prev" data-qlb="prev" title="Previous (←)"><i class="fa-solid fa-chevron-left"></i></button>
      <figure class="q-lb-fig"><img class="q-lb-img" alt=""><figcaption class="q-lb-cap"></figcaption></figure>
      <button type="button" class="q-lb-btn q-lb-next" data-qlb="next" title="Next (→)"><i class="fa-solid fa-chevron-right"></i></button>`;
    el.addEventListener('click', (e) => {
      const b = e.target.closest('[data-qlb]');
      if (!b) { if (e.target === el || e.target.classList.contains('q-lb-fig')) el.hidden = true; return; }
      const a = b.dataset.qlb;
      if (a === 'close') el.hidden = true;
      else if (a === 'prev') questLightboxShow(qlb.i - 1);
      else if (a === 'next') questLightboxShow(qlb.i + 1);
      else if (a === 'window' && typeof sbShowShot === 'function') { const c = qlb.list[qlb.i]; if (c && !/^https?:/i.test(c.image)) { el.hidden = true; sbShowShot(c.image); } }
    });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { el.hidden = true; e.stopPropagation(); }
      if (e.key === 'ArrowLeft') questLightboxShow(qlb.i - 1);
      if (e.key === 'ArrowRight') questLightboxShow(qlb.i + 1);
    });
    document.body.appendChild(el);
  }
  el.hidden = false;
  questLightboxShow(i);
  el.focus();
}
function questLightboxShow(i) {
  const n = qlb.list.length; if (!n) return;
  qlb.i = (i + n) % n;
  const c = qlb.list[qlb.i];
  const el = $('#q-lightbox');
  el.querySelector('.q-lb-img').src = questImgUrl(c.image);
  el.querySelector('.q-lb-cap').innerHTML = `<b>${escapeHtml(c.by || '')}</b> <span class="qd-muted">${c.at ? fmtAgoTip(c.at) : ''}${n > 1 ? ` · ${qlb.i + 1} / ${n}` : ''}</span>${c.body ? `<div>${escapeHtml(c.body)}</div>` : ''}`;
  el.querySelectorAll('.q-lb-prev, .q-lb-next').forEach((b) => { b.hidden = n < 2; });
}

// ---- the step map: numbered pins per step, one planet tab per planet ----
function qdDestroyMap() { qMapDestroy(qdState.map); qdState.map = null; }

async function qdBuildMap(mapped) {
  const seq = qdState.seq;
  qdDestroyMap();
  const pins = mapped.map((s) => ({ pm: QUEST_PLANETS[s.wp.planet].pm, x: s.wp.x, z: s.wp.z, key: s.n, s }));
  const st = await qMapBuild('qd-map', pins, {
    tabsEl: 'qd-maptabs',
    labelFor: (g) => { const nums = g.map((p) => p.key); return nums.length > 2 ? `${nums[0]}+` : nums.join(','); },
    popupFor: (g) => {
      const s0 = g[0].s; const way = questWayCmd(s0.wp);
      return `<div class="pm-popup qd-popup">
        ${g.map((p) => `<div><b>${p.s.n}.</b> <span class="qd-muted">${escapeHtml(p.s.kind_label || '')}</span> ${escapeHtml(p.s.title || '')}</div>`).join('')}
        <div class="qd-pop-wp">${escapeHtml(s0.wp.name || '')} &middot; ${safeInt(s0.wp.x)}, ${safeInt(s0.wp.z)}</div>
        ${way ? `<a role="button" class="pm-copy qd-popcopy" data-pmcopy="${escapeHtml(way)}" title="${escapeHtml(way)}"><i class="fa-regular fa-clone"></i> Copy /way</a>` : ''}</div>`;
    },
    onOver: (keys, on) => qdHighlight(keys, on),
    onClick: (keys) => qdFlashStep(keys[0]),
  });
  if (seq !== qdState.seq) { qMapDestroy(st); return; }
  qdState.map = st;
}

// step row ↔ pin: hovering either lights both
function qdHighlight(nums, on) {
  (nums || []).forEach((n) => {
    const row = document.querySelector(`#quest-body .qd-step[data-qstep="${n}"]`);
    if (row) row.classList.toggle('qd-step-hl', on);
    const el = qMapPinEl(qdState.map, n);
    if (el) el.classList.toggle('qd-pin-hl', on);
  });
}
function qdFlashStep(n) {
  const row = document.querySelector(`#quest-body .qd-step[data-qstep="${n}"]`);
  if (!row) return;
  row.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  row.classList.remove('qd-step-flash'); void row.offsetWidth; row.classList.add('qd-step-flash');
}
function qdShowStepOnMap(n) {
  const s = qdState.steps.find((x) => x.n === n);
  if (!s || !questWpOnMap(s.wp) || !qdState.map) return;
  qMapFocus(qdState.map, n, QUEST_PLANETS[s.wp.planet].pm);
  const box = document.querySelector('#quest-body .qd-mapbox'); if (box) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
}

function questCopyAllWays() {
  const lines = qdState.steps.filter((s) => s.wp).map((s) => questWayCmd(s.wp)).filter(Boolean);
  const uniq = [...new Set(lines)];
  if (!uniq.length) { toast('No waypoints in this quest', false); return; }
  copyTextToClipboard(uniq.join('\n'), `Copied ${uniq.length} waypoint${uniq.length === 1 ? '' : 's'}`);
}

// =================================================================================
// Planet Maps: an optional "Quests" layer (pmCreateMap calls this when the hook exists)
// =================================================================================
const questLayerCache = {};
function questLayerAttach(L, map, getPlanet) {
  const layer = L.layerGroup();
  let on = false; let seq = 0;
  async function draw() {
    layer.clearLayers();
    if (!on || questsGated()) return;
    const raw = QUEST_PM_RAW[getPlanet()];
    if (!raw) return;
    const my = ++seq;
    let pts = questLayerCache[raw];
    if (!pts) {
      let res;
      try { res = await apiFetch('GET', 'api/quests.php', { params: { map: raw } }); } catch (_) { res = null; }
      pts = (res && res.ok && res.data && res.data.points) || [];
      if (res && res.ok) questLayerCache[raw] = pts;
    }
    if (my !== seq || !on) return;
    // one marker per spot; a spot shared by many quests lists them all
    const spots = new Map();
    pts.forEach((p) => { const k = `${safeInt(p.x)},${safeInt(p.z)}`; if (!spots.has(k)) spots.set(k, []); spots.get(k).push(p); });
    spots.forEach((list) => {
      const p0 = list[0];
      const way = `/way ${raw} ${safeInt(p0.x)} 0 ${safeInt(p0.z)} ${p0.name || ''}`.trim();
      const shown = list.slice(0, 8);
      const icon = L.divIcon({ className: 'qd-qpin', html: `<i class="fa-solid fa-book-journal-whills"></i>${list.length > 1 ? `<span>${list.length}</span>` : ''}`, iconSize: [18, 18], iconAnchor: [9, 9], popupAnchor: [0, -8] });
      L.marker(pmToLatLng(safeInt(p0.x), safeInt(p0.z)), { icon, title: p0.name || p0.title || '' })
        .bindPopup(`<div class="pm-popup qd-popup">
          <div class="qd-pop-wp"><b>${escapeHtml(p0.name || 'Quest waypoint')}</b> &middot; ${safeInt(p0.x)}, ${safeInt(p0.z)}</div>
          ${shown.map((p) => `<div><a role="button" class="qd-poplink" data-questopen="${escapeHtml(p.quest)}">${escapeHtml(p.title || questTidyId(p.quest))}</a>
            <span class="qd-muted">${safeInt(p.level) ? `lv ${safeInt(p.level)} · ` : ''}step ${safeInt(p.step)}${p.kind_label ? ` · ${escapeHtml(p.kind_label)}` : ''}</span></div>`).join('')}
          ${list.length > shown.length ? `<div class="qd-muted">+${list.length - shown.length} more</div>` : ''}
          <a role="button" class="pm-copy qd-popcopy" data-pmcopy="${escapeHtml(way)}" title="${escapeHtml(way)}"><i class="fa-regular fa-clone"></i> Copy /way</a></div>`, { autoPan: false, maxWidth: 320 })
        .addTo(layer);
    });
  }
  const Ctl = L.Control.extend({
    options: { position: 'topright' },
    onAdd() {
      // dev-only: part of the Quests gate (see questsGated at the top of this file)
      const div = L.DomUtil.create('div', 'leaflet-bar pm-toggle qd-pm-toggle dev-only');
      div.innerHTML = '<a role="button" title="Show where quest steps send you on this planet">Quests: <b>off</b></a>';
      L.DomEvent.disableClickPropagation(div);
      L.DomEvent.on(div, 'click', (e) => {
        L.DomEvent.preventDefault(e);
        on = !on; div.querySelector('b').textContent = on ? 'on' : 'off';
        if (on) layer.addTo(map); else map.removeLayer(layer);
        draw();
      });
      return div;
    },
  });
  map.addControl(new Ctl());
  return { planetChanged: draw };
}

// =================================================================================
// NPC pages — a quest giver / target / talk-to NPC: where it stands (quest waypoints +
// community-shared ones) on a map, the quests it's tied to, and notes + screenshots
// (api/quests.php?npc=<id>; comments kind=npc). Same dev-mode gate as Quests.
// =================================================================================
const npcState = { seq: 0, id: '', npc: null, map: null, gallery: null, wps: [], editing: false };
const NPC_ROLE = { giver: ['Gives the quest', 'fa-solid fa-hand-holding'], target: ['Target', 'fa-solid fa-crosshairs'], talk: ['Talk to', 'fa-solid fa-comments'], drop: ['Drops the starter item', 'fa-solid fa-box-open'] };
function npcShowTab(k, transient) { qTabsShow('#npc-body', k, 'npc_tab', transient); }
const npcWay = (w) => (w.way ? String(w.way) : (w.planet && w.x != null ? `/way ${w.planet} ${safeInt(w.x)} 0 ${safeInt(w.z)} ${w.name || (npcState.npc && npcState.npc.name) || ''}`.trim() : ''));

async function openNpcPage(id, keepView) {
  if (!id) return;
  showPage('npc');
  if (questsGated()) return; // showPage already fell back to Home
  const seq = ++npcState.seq;
  if (!keepView || String(id) !== npcState.id) npcState.editing = false; // a fresh NPC opens in view mode
  npcState.id = String(id);
  qMapDestroy(npcState.map); npcState.map = null;
  if (npcState.gallery) npcState.gallery.dead = true;
  if (!keepView) { $('#npc-crumbs').innerHTML = '<a role="button" data-nav="quests">Quests</a> › …'; $('#npc-body').innerHTML = ''; }
  $('#npc-empty').hidden = true;
  $('#npc-loading').hidden = false;
  let res;
  try { res = await apiFetch('GET', 'api/quests.php', { params: { npc: id } }); } catch (e) { res = { ok: false, error: String(e) }; }
  if (seq !== npcState.seq) return;
  $('#npc-loading').hidden = true;
  const n = res.ok && res.data ? (res.data.npc || res.data) : null;
  if (!n || res.data.error || !n.name) {
    $('#npc-body').innerHTML = '';
    const el = $('#npc-empty'); el.hidden = false;
    el.textContent = (res.data && res.data.error) || res.error || 'NPC not found.';
    return;
  }
  npcState.npc = n;
  renderNpcPage(n);
  if (!keepView) { const wrap = $('#npc-body').closest('.table-wrap'); if (wrap) wrap.scrollTop = 0; }
}

// Quest waypoints come back once per quest; spots within 5m (same planet/cell) become one
// row listing every quest that sends you there (as npc.php does). Community pins stay
// one row each — they carry their own delete.
function npcGroupWps(list) {
  const out = [];
  (Array.isArray(list) ? list : []).forEach((w) => {
    if (!w || typeof w !== 'object') return;
    const q = w.quest ? { quest: w.quest, title: w.quest_title, variant: w.quest_variant, step: w.step } : null;
    if (w.source !== 'community') {
      const hit = out.find((o) => o.source !== 'community' && o.planet === w.planet && (o.cell || '') === (w.cell || '')
        && Math.abs(Number(o.x) - Number(w.x)) <= 5 && Math.abs(Number(o.z) - Number(w.z)) <= 5);
      if (hit) {
        if (q && !hit.quests.some((h) => h.quest === q.quest && h.step === q.step)) hit.quests.push(q);
        if (!hit.way && w.way) hit.way = w.way;
        return;
      }
    }
    out.push(Object.assign({}, w, { quests: q ? [q] : [] }));
  });
  return out.map((w, i) => Object.assign(w, { k: i + 1 }));
}
function npcWpQuestsHtml(w, cls) {
  return (w.quests || []).map((q) => `<a role="button" class="${cls}" data-questopen="${escapeHtml(q.quest)}">${escapeHtml(q.title || questTidyId(q.quest))}</a>${q.variant ? ` <span class="qd-muted">(${escapeHtml(q.variant)})</span>` : ''}${q.step ? ` <span class="qd-muted">step ${safeInt(q.step)}</span>` : ''}`).join('<span class="qd-muted"> · </span>');
}

function renderNpcPage(n) {
  $('#npc-crumbs').innerHTML = `<a role="button" data-nav="quests">Quests</a> › ${escapeHtml(n.name)}`;
  const areas = (Array.isArray(n.areas) ? n.areas : [n.areas]).filter(Boolean);
  const quests = Array.isArray(n.quests) ? n.quests : [];
  const wps = npcGroupWps(n.waypoints);
  npcState.wps = wps;
  const mapped = wps.filter((w) => questWpOnMap(w));
  const offMap = wps.filter((w) => !questWpOnMap(w));

  const questRows = quests.map((q) => {
    const role = NPC_ROLE[q.role] || [questTidyId(q.role || ''), 'fa-solid fa-circle-dot'];
    return `<div class="npc-qrow">
      <span class="npc-role" title="${escapeHtml(role[0])}"><i class="${role[1]}"></i> ${escapeHtml(role[0])}${q.step_n ? ` <span class="qd-muted">· step ${safeInt(q.step_n)}</span>` : ''}</span>
      <a role="button" class="qd-chainlink npc-qtitle" data-questopen="${escapeHtml(q.id)}">${escapeHtml(q.title || questTidyId(q.id))}</a>${q.variant ? ` <span class="q-variant npc-qvariant">${escapeHtml(q.variant)}</span>` : ''}
      <span class="npc-qmeta qd-muted">${[q.category, safeInt(q.level) ? `Lv ${safeInt(q.level)}` : ''].filter(Boolean).map(escapeHtml).join(' · ')}</span>
    </div>`;
  }).join('');

  const wpRows = wps.map((w) => {
    const way = npcWay(w);
    const onMap = questWpOnMap(w);
    const src = w.source === 'community'
      ? `<span class="qd-muted">shared by ${escapeHtml(w.by || 'a player')}</span>`
      : `<span class="qd-muted">from </span>${npcWpQuestsHtml(w, 'qd-chainlink') || 'a quest'}`;
    return `<div class="npc-wprow${onMap ? ' npc-wp-mapped' : ''}" data-npcwp="${w.k}"${onMap ? ' title="Click to show it on the map"' : ''}>
      <span class="qd-stepnum ${w.source === 'community' ? 'npc-num-comm' : ''}">${w.k}</span>
      <span class="npc-wpmain">
        <span class="qd-wp-name">${escapeHtml(w.name || n.name)}</span> ${questPlanetBadge(w.planet)} <span class="qd-muted">${safeInt(w.x)}, ${safeInt(w.z)}</span>
        ${w.note ? `<div class="npc-wpnote">${escapeHtml(w.note)}</div>` : ''}
        <div class="npc-wpsrc">${src}</div>
      </span>
      ${way ? `<button type="button" class="btn btn-sm btn-outline-secondary qd-way" data-qway="${escapeHtml(way)}" title="${escapeHtml(way)}"><i class="fa-regular fa-clone"></i> Copy /way</button>` : ''}
      ${w.mine && w.id ? `<a role="button" class="pm-drop npc-wpdel" data-npcwpdel="${safeInt(w.id)}" title="Remove — you shared this one"><i class="fa-solid fa-xmark"></i></a>` : ''}
    </div>`;
  }).join('');
  const addBtn = '<button type="button" class="btn btn-sm btn-accent" data-npcwpadd><i class="fa-solid fa-plus"></i> Add waypoint</button>';
  const tabBtn = (k, label, hidden) => `<li${hidden ? ' hidden' : ''}><button type="button" class="scd-tab" data-qtab="${k}">${label}</button></li>`;

  // About (a description anyone can write) heads the main column and Photo (the screenshot
  // someone picked, else the newest) heads the side column above the map — the quest
  // page's flat section headers. The Edit toggle in the page head is a mode: About turns
  // into an editor and Photo shows a picker (api/quests.php?npc_desc=1 / ?npc_photo=1).
  const desc = n.description && typeof n.description === 'object' && n.description.text ? n.description : null;
  const photo = n.photo && typeof n.photo === 'object' && n.photo.url ? n.photo : null;
  const sec = (icon, title, right, body, cls = '') => `<section class="hm-section npc-sec ${cls}">
      <div class="hm-head npc-sechead"><i class="${icon} hm-icon"></i><span class="hm-title">${title}</span><span class="hm-headright qd-muted">${right}</span></div>
      <div class="hm-body">${body}</div></section>`;
  const aboutBody = `<div class="npc-about-view"><p class="${desc ? 'npc-desc-text' : 'empty-state is-compact'}">${desc ? escapeHtml(desc.text).replace(/\n/g, '<br>') : 'No description yet — <b>Edit</b> to add who they are, what they say and anything worth knowing.'}</p></div>
      <div class="npc-about-edit" hidden>
        <textarea class="form-control filter-input npc-desc-input" id="npcdesc-text" rows="6" maxlength="2000" aria-label="Description" placeholder="Who they are, what they say, where they hang out…"></textarea>
        <div class="npc-editbar"><span class="qd-muted"><span id="npcdesc-n">0</span> / 2,000 · everyone sees it, anyone can improve it</span>
          <span class="key-gate-status" id="npcdesc-status"></span>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-npcdesccancel>Cancel</button>
          <button type="button" class="btn btn-sm btn-accent" data-npcdescsave><i class="fa-solid fa-check"></i> Save</button></div>
      </div>`;
  const photoBody = `${photo ? `<button type="button" class="npc-photo" data-npcphoto title="View full size"><img src="${escapeHtml(questImgUrl(photo.url))}" alt=""></button>`
      : '<div class="npc-photo-none"><i class="fa-solid fa-camera"></i><div>No photo yet — post a screenshot in Notes</div></div>'}
      <div class="npc-pick" hidden><div class="qd-muted npc-pick-h">Loading screenshots…</div><div class="npc-pick-grid"></div></div>`;
  const mapBody = `${mapped.length ? `<div class="qd-maptabs" id="npc-maptabs"></div><div class="qd-mapbox npc-mapbox"><div id="npc-map" class="pm-map qd-map"></div></div>`
        : `<div class="qd-nomap empty-state is-compact">${wps.length ? 'None of this NPC’s waypoints are on a planet map.' : 'No waypoints yet — <b>Add waypoint</b> to mark where this NPC stands.'} ${addBtn}</div>`}
      ${offMap.length ? `<div class="qd-offmap"><i class="fa-solid fa-circle-info"></i> Not on a planet map: ${offMap.map((w) => `<a role="button" data-npcwpgo="${w.k}">#${w.k}</a>`).join(', ')} — instance, in-building or off-map zone coordinates.</div>` : ''}`;
  $('#npc-body').innerHTML = `
    <div class="beast-namerow qd-namerow"><h2 class="beast-name">${escapeHtml(n.name)}</h2>
      ${areas.map((a) => questPlanetBadge(a)).join(' ')}
      ${n.creature_slug && typeof openCreaturePage === 'function' ? `<span class="bchip" data-npccreature="${escapeHtml(n.creature_slug)}" title="Open this creature's page"><i class="fa-solid fa-dragon"></i> Creature page</span>` : ''}</div>
    <div class="npc-sub qd-muted">${quests.length} quest${quests.length === 1 ? '' : 's'} · ${wps.length} waypoint${wps.length === 1 ? '' : 's'}</div>
    <div class="npc-grid">
    <div class="npc-maincol">
    ${sec('fa-solid fa-circle-info', 'About', desc ? `Written by <b>${escapeHtml(desc.by || 'a player')}</b>${desc.at ? ` · ${fmtAgoTip(desc.at)}` : ''}` : '', aboutBody, 'npc-about')}
    <div class="npc-tabsblock">
    <ul class="scd-tabs qd-tabs" id="npc-tabs">
      ${tabBtn('quests', `Quests <span class="qd-tabn">${quests.length}</span>`, !quests.length)}
      ${tabBtn('waypoints', `Waypoints <span class="qd-tabn">${wps.length || ''}</span>`)}
      ${tabBtn('notes', 'Notes <span class="qd-tabn" data-qcount="notes"></span>')}
      ${tabBtn('shots', 'Screenshots <span class="qd-tabn" data-qcount="shots"></span>', true)}
    </ul>
    <div class="qd-pane" data-qpane="quests" hidden>${questRows}</div>
    <div class="qd-pane" data-qpane="waypoints" hidden>
      <div class="npc-wphead"><span class="settings-sub">${wps.length ? 'Quest waypoints and spots players have shared.' : 'No waypoints yet — <b>Add waypoint</b> if you know where this NPC stands.'}</span>${addBtn}</div>
      ${wpRows}</div>
    <div class="qd-pane qd-pane-flush" data-qpane="notes" hidden><div id="npc-comments" class="cmt-section qd-comments"></div></div>
    <div class="qd-pane" data-qpane="shots" hidden><div class="qd-gallery"></div></div>
    </div>
    </div>
    <div class="npc-sidecol">
    ${sec('fa-solid fa-camera', 'Photo', photo ? `by <b>${escapeHtml(photo.by || 'a player')}</b>` : '', photoBody, 'npc-photocard')}
    ${sec('fa-solid fa-map-location-dot', 'Map', '', mapBody, 'npc-mapsec')}
    </div>
    </div>`;
  npcShowTab(qTabsSaved('npc_tab', 'quests'), true);
  npcSetEditing(npcState.editing);

  if (mapped.length) npcBuildMap(mapped);
  npcState.gallery = { root: '#npc-body', kind: 'npc', id: safeInt(n.numeric_id), storeKey: 'npc_tab', list: [], mainUrl: photo ? photo.url : '' };
  npcRenderPicker();
  if (safeInt(n.numeric_id)) {
    cmtMount('#npc-comments', 'npc', safeInt(n.numeric_id), {
      head: 'NPC notes', sub: 'where to find them, what they say, screenshots — visible to every app user',
      placeholder: `Share a tip or a screenshot of ${n.name}…`,
      maxW: 1920, onRows: (rows) => qGalleryRender(npcState.gallery, rows), onImage: (u) => qOpenShot(npcState.gallery, u),
    });
  } else {
    $('#npc-comments').innerHTML = '<div class="empty-state is-compact">Notes aren’t available for this NPC yet.</div>';
  }
}

async function npcBuildMap(mapped) {
  const seq = npcState.seq;
  const pins = mapped.map((w) => ({ pm: QUEST_PLANETS[w.planet].pm, x: w.x, z: w.z, key: w.k, w }));
  const st = await qMapBuild('npc-map', pins, {
    tabsEl: 'npc-maptabs',
    labelFor: (g) => { const ks = g.map((p) => p.key); return ks.length > 2 ? `${ks[0]}+` : ks.join(','); },
    pinClass: (g) => (g.every((p) => p.w.source === 'community') ? 'qd-pin-comm' : ''),
    popupFor: (g) => {
      const w0 = g[0].w; const way = npcWay(w0);
      return `<div class="pm-popup qd-popup">
        ${g.map((p) => `<div><b>#${p.key}</b> ${p.w.source === 'community' ? `<span class="qd-muted">shared by ${escapeHtml(p.w.by || 'a player')}</span>${p.w.note ? ` — ${escapeHtml(p.w.note)}` : ''}` : `<span class="qd-muted">quest step</span> ${npcWpQuestsHtml(p.w, 'qd-poplink')}`}</div>`).join('')}
        <div class="qd-pop-wp">${escapeHtml(w0.name || (npcState.npc && npcState.npc.name) || '')} &middot; ${safeInt(w0.x)}, ${safeInt(w0.z)}</div>
        ${way ? `<a role="button" class="pm-copy qd-popcopy" data-pmcopy="${escapeHtml(way)}" title="${escapeHtml(way)}"><i class="fa-regular fa-clone"></i> Copy /way</a>` : ''}</div>`;
    },
    onOver: (keys, on) => keys.forEach((k) => {
      const row = document.querySelector(`#npc-body [data-npcwp="${k}"]`); if (row) row.classList.toggle('qd-step-hl', on);
      const el = qMapPinEl(npcState.map, k); if (el) el.classList.toggle('qd-pin-hl', on);
    }),
    onClick: (keys) => { npcShowTab('waypoints', true); const row = document.querySelector(`#npc-body [data-npcwp="${keys[0]}"]`); if (row) { row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); row.classList.remove('qd-step-flash'); void row.offsetWidth; row.classList.add('qd-step-flash'); } },
  });
  if (seq !== npcState.seq) { qMapDestroy(st); return; }
  npcState.map = st;
}

// ---- add-waypoint dialog (key-gate modal, never inline) ----
let npcWpBusy = false;
function npcOpenWpDialog() {
  const n = npcState.npc; if (!n) return;
  const modal = $('#npcwp-modal');
  $('#npcwp-name').textContent = n.name;
  const psel = $('#npcwp-planet');
  if (!psel.options.length) psel.innerHTML = Object.entries(QUEST_PLANETS).filter(([, p]) => p.pm).map(([raw]) => `<option value="${raw}">${escapeHtml(questPlanetLabel(raw))}</option>`).join('');
  const area = (n.areas || []).find((a) => QUEST_PLANETS[a] && QUEST_PLANETS[a].pm);
  psel.value = area || (npcState.map ? QUEST_PM_RAW[npcState.map.planet] : 'tatooine');
  ['#npcwp-quick', '#npcwp-x', '#npcwp-z', '#npcwp-note'].forEach((s) => { $(s).value = ''; });
  $('#npcwp-status').textContent = '';
  modal.hidden = false;
  $('#npcwp-quick').focus();
}
async function npcSaveWp() {
  if (npcWpBusy) return;
  const n = npcState.npc; if (!n) return;
  const status = $('#npcwp-status');
  const x = $('#npcwp-x').value.trim(); const z = $('#npcwp-z').value.trim();
  if (x === '' || z === '' || Number.isNaN(Number(x)) || Number.isNaN(Number(z))) { status.textContent = 'X and Z are both needed.'; $('#npcwp-x').focus(); return; }
  if (Math.abs(Number(x)) > PM_MAX || Math.abs(Number(z)) > PM_MAX) { status.textContent = `X and Z must be between -${PM_MAX} and ${PM_MAX}.`; return; }
  const data = { npc: n.id, planet: $('#npcwp-planet').value, x: Math.round(Number(x)), z: Math.round(Number(z)), note: $('#npcwp-note').value.trim() };
  npcWpBusy = true; $('#npcwp-save').disabled = true; status.textContent = 'Saving…';
  let r;
  try { r = await apiFetch('POST', 'api/quests.php?npc_wp=1', { data }); } catch (e) { r = { ok: false, error: String(e) }; }
  npcWpBusy = false; $('#npcwp-save').disabled = false;
  if (!r.ok || (r.data && r.data.error)) {
    const msg = (r.data && r.data.error) || r.error || '';
    status.textContent = /429|too many|slow down/i.test(msg) ? 'You just shared one — wait a few seconds and try again.'
      : /401|sign/i.test(msg) ? 'Sign in to swgtracker.com in Settings to share waypoints.' : (msg || 'Could not save the waypoint.');
    return;
  }
  $('#npcwp-modal').hidden = true;
  toast(r.data && r.data.status === 'exists' ? `That spot is already marked for ${n.name}` : `Waypoint shared for ${n.name}`);
  openNpcPage(n.id, true);
}
function initNpcWpDialog() {
  const modal = $('#npcwp-modal'); if (!modal) return;
  const quick = $('#npcwp-quick');
  const applyQuick = () => {
    const p = pmParseWaypoint(quick.value); if (!p) return;
    const raw = String(p.planet || '').toLowerCase();
    const code = QUEST_PLANETS[raw] && QUEST_PLANETS[raw].pm ? raw : QUEST_PM_RAW[pmPlanetCode(p.planet)];
    if (code) $('#npcwp-planet').value = code;
    $('#npcwp-x').value = p.x; $('#npcwp-z').value = p.y;
    if (p.note && !$('#npcwp-note').value) $('#npcwp-note').value = p.note;
    $('#npcwp-note').focus();
  };
  quick.addEventListener('paste', () => setTimeout(applyQuick, 0));
  quick.addEventListener('change', applyQuick);
  $('#npcwp-save').addEventListener('click', npcSaveWp);
  $('#npcwp-cancel').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e) => { if (e.target === modal) modal.hidden = true; });
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') modal.hidden = true;
    else if (e.key === 'Enter') { e.preventDefault(); if (e.target === quick) applyQuick(); else npcSaveWp(); }
  });
}

// ---- Edit mode (the page head's Edit toggle): About → editor, Photo → picker ----
// npcState.editing survives a re-render (picking a photo reloads the page in place)
function npcSetEditing(on) {
  npcState.editing = !!on;
  const body = $('#npc-body'); if (!body) return;
  body.classList.toggle('is-editing', npcState.editing);
  const btn = $('#npc-edit');
  if (btn) {
    btn.classList.toggle('active', npcState.editing);
    btn.setAttribute('aria-pressed', npcState.editing ? 'true' : 'false');
    btn.innerHTML = npcState.editing ? '<i class="fa-solid fa-check"></i> Done' : '<i class="fa-solid fa-pen"></i> Edit';
  }
  const view = body.querySelector('.npc-about-view'); const edit = body.querySelector('.npc-about-edit');
  if (view) view.hidden = npcState.editing;
  if (edit) edit.hidden = !npcState.editing;
  const pick = body.querySelector('.npc-pick'); if (pick) pick.hidden = !npcState.editing;
  const ta = $('#npcdesc-text');
  if (npcState.editing && ta && !ta.dataset.filled) {
    const n = npcState.npc;
    ta.value = (n && n.description && n.description.text) || '';
    ta.dataset.filled = '1';
    $('#npcdesc-n').textContent = ta.value.length.toLocaleString();
  }
}
function npcRenderPicker() {
  const g = npcState.gallery; const box = document.querySelector('#npc-body .npc-pick'); if (!g || !box) return;
  const list = (g.list || []).filter((c) => c.id);
  box.querySelector('.npc-pick-h').textContent = list.length ? 'Pick the main photo' : 'Post a screenshot in Notes, then pick it here';
  box.querySelector('.npc-pick-grid').innerHTML = list.map((c) => `<button type="button" class="npc-pick-shot${c.image === g.mainUrl ? ' is-main' : ''}" data-npcpick="${safeInt(c.id)}" data-n="${safeInt(c.n)}" title="Make this the main photo"><img src="${escapeHtml(questImgUrl(c.image))}" loading="lazy" alt=""></button>`).join('');
}
let npcDescBusy = false;
async function npcSaveDesc() {
  if (npcDescBusy) return;
  const n = npcState.npc; if (!n) return;
  const status = $('#npcdesc-status');
  npcDescBusy = true; status.textContent = 'Saving…';
  let r;
  try { r = await apiFetch('POST', 'api/quests.php?npc_desc=1', { data: { npc: n.id, description: $('#npcdesc-text').value.trim() } }); } catch (e) { r = { ok: false, error: String(e) }; }
  npcDescBusy = false;
  if (!r.ok || (r.data && r.data.error)) { status.textContent = (r.data && r.data.error) || r.error || 'Could not save the description.'; return; }
  npcSetEditing(false);
  if (r.data && r.data.status === 'unchanged') { status.textContent = ''; return; }
  toast(r.data && r.data.status === 'cleared' ? 'Description removed' : 'Description saved — thanks');
  openNpcPage(n.id, true);
}
async function npcPickPhoto(btn) {
  const n = npcState.npc; if (!n || btn.classList.contains('is-main') || btn.disabled) return;
  btn.disabled = true;
  let r;
  try { r = await apiFetch('POST', 'api/quests.php?npc_photo=1', { data: { npc: n.id, comment_id: safeInt(btn.dataset.npcpick), n: safeInt(btn.dataset.n) } }); } catch (e) { r = { ok: false, error: String(e) }; }
  btn.disabled = false;
  if (!r.ok || (r.data && r.data.error)) { toast((r.data && r.data.error) || r.error || 'Could not set the photo', false); return; }
  toast('Main photo set');
  openNpcPage(n.id, true); // edit mode stays on
}

// =================================================================================
// wiring
// =================================================================================
function questsQueryChanged() { questsState.page = 1; fetchQuests(); }

function initQuests() {
  // planets for the filter, in the order players think of them
  $('#quests-planet').innerHTML = '<option value="">All planets</option>'
    + Object.keys(QUEST_PLANETS).map((raw) => `<option value="${raw}">${escapeHtml(questPlanetLabel(raw))}</option>`).join('');
  let t = null;
  $('#quests-search').addEventListener('input', () => {
    clearTimeout(t);
    t = setTimeout(() => { questsState.q = $('#quests-search').value.trim(); questsQueryChanged(); }, 250);
  });
  [['#quests-category', 'category'], ['#quests-planet', 'planet'], ['#quests-type', 'type'], ['#quests-repeat', 'repeatable']]
    .forEach(([id, key]) => $(id).addEventListener('change', () => { questsState[key] = $(id).value; questsQueryChanged(); }));
  [['#quests-minlvl', 'minLevel'], ['#quests-maxlvl', 'maxLevel']].forEach(([id, key]) => {
    let lt = null;
    $(id).addEventListener('input', () => {
      clearTimeout(lt);
      lt = setTimeout(() => { const v = $(id).value.trim(); questsState[key] = v === '' ? '' : String(Math.max(0, safeInt(v))); questsQueryChanged(); }, 350);
    });
  });
  $('#quests-unused').addEventListener('change', () => { questsState.unused = $('#quests-unused').checked; questsQueryChanged(); });
  $('#quests-reload').addEventListener('click', () => { questsState.catsLoaded = false; questsLoadCategories(); fetchQuests(); });
  $('#quests-prev').addEventListener('click', () => { if (questsState.page > 1) { questsState.page--; fetchQuests(); } });
  $('#quests-next').addEventListener('click', () => { questsState.page++; fetchQuests(); });
  $('#quests-head').addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]'); if (!th) return;
    const f = th.dataset.sort;
    if (questsState.sortField === f) questsState.sortOrder = questsState.sortOrder === 'ASC' ? 'DESC' : 'ASC';
    else { questsState.sortField = f; questsState.sortOrder = f === 'title' || f === 'category' ? 'ASC' : 'DESC'; }
    questsQueryChanged();
  });
  $('#quest-refresh').addEventListener('click', () => { if (qdState.slug) openQuestPage(qdState.slug); });
  $('#quest-copyall').addEventListener('click', questCopyAllWays);

  // one delegate for both pages: rows/links → quest, chips → filtered list, steps ↔ map
  const onClick = (e) => {
    const t = e.target;
    const nav = t.closest('[data-nav]');
    if (nav && nav.closest('#quest-crumbs, #npc-crumbs')) { showPage(nav.dataset.nav); return; }
    // NPC page
    if (t.closest('[data-npcwpadd]')) { npcOpenWpDialog(); return; }
    if (t.closest('[data-npcdescsave]')) { npcSaveDesc(); return; }
    if (t.closest('[data-npcdesccancel]')) { const ta = $('#npcdesc-text'); if (ta) delete ta.dataset.filled; npcSetEditing(false); return; }
    const pk = t.closest('[data-npcpick]');
    if (pk) { npcPickPhoto(pk); return; }
    if (t.closest('[data-npcphoto]')) {
      const g = npcState.gallery; const list = g && g.list && g.list.length ? g.list : null;
      const p = npcState.npc && npcState.npc.photo;
      if (list) questLightbox(list, Math.max(0, list.findIndex((c) => c.image === g.mainUrl)));
      else if (p) questLightbox([{ id: safeInt(p.id), image: p.url, body: p.body, by: p.by, at: p.at }], 0);
      return;
    }
    const cre = t.closest('[data-npccreature]');
    if (cre) { if (typeof openCreaturePage === 'function') openCreaturePage(cre.dataset.npccreature); return; }
    const wdel = t.closest('[data-npcwpdel]');
    if (wdel) {
      if (!confirmArm(wdel, 'Click again to remove')) return;
      (async () => {
        let r;
        try { r = await apiFetch('DELETE', `api/quests.php?npc_wp=${safeInt(wdel.dataset.npcwpdel)}`); } catch (err) { r = { ok: false, error: String(err) }; }
        if (!r.ok || (r.data && r.data.error)) { toast((r.data && r.data.error) || r.error || 'Could not remove that waypoint', false); return; }
        toast('Waypoint removed');
        if (npcState.npc) openNpcPage(npcState.npc.id, true);
      })();
      return;
    }
    const wgo = t.closest('[data-npcwpgo]');
    if (wgo) {
      npcShowTab('waypoints', true);
      const row = document.querySelector(`#npc-body [data-npcwp="${safeInt(wgo.dataset.npcwpgo)}"]`);
      if (row) { row.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); row.classList.remove('qd-step-flash'); void row.offsetWidth; row.classList.add('qd-step-flash'); }
      return;
    }
    const way = t.closest('[data-qway]');
    if (way) { copyTextToClipboard(way.dataset.qway, 'Waypoint copied — paste it in game'); return; }
    const flt = t.closest('[data-qfilter]');
    if (flt) {
      const v = flt.dataset.val; const k = flt.dataset.qfilter;
      if (k === 'level') { const l = safeInt(v); openQuestsFiltered({ minLevel: Math.max(1, l - 5), maxLevel: l + 5 }); } else openQuestsFiltered({ [k]: v });
      return;
    }
    const shot = t.closest('[data-qshot]');
    if (shot) { const g = shot.closest('#npc-body') ? npcState.gallery : qdState.gallery; if (g) questLightbox(g.list, safeInt(shot.dataset.qshot)); return; }
    const qt = t.closest('[data-qtab]');
    if (qt) { if (qt.closest('#npc-body')) npcShowTab(qt.dataset.qtab); else qdShowTab(qt.dataset.qtab); return; }
    const tab = t.closest('[data-qmaptab]');
    if (tab) { qMapSetPlanet(tab.closest('#npc-body') ? npcState.map : qdState.map, tab.dataset.qmaptab); return; }
    const go = t.closest('[data-qstepgo]');
    if (go) { qdFlashStep(safeInt(go.dataset.qstepgo)); return; }
    const fold = t.closest('.qd-fold > .hm-head');
    if (fold) { fold.parentElement.classList.toggle('collapsed'); return; }
    if (t.closest('.cmt-section') || t.closest('a, button, input, select, textarea')) return;
    const step = t.closest('.qd-step-mapped');
    if (step) { qdShowStepOnMap(safeInt(step.dataset.qstep)); return; }
    const wrow = t.closest('.npc-wp-mapped');
    if (wrow && npcState.map) {
      const w = npcState.wps.find((x) => x.k === safeInt(wrow.dataset.npcwp));
      if (w) { qMapFocus(npcState.map, w.k, QUEST_PLANETS[w.planet].pm); const box = document.querySelector('#npc-body .npc-mapbox'); if (box) box.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }
    }
  };
  $('#page-quests').addEventListener('click', onClick);
  $('#page-quest').addEventListener('click', onClick);
  $('#page-npc').addEventListener('click', onClick);
  $('#npc-refresh').addEventListener('click', () => { if (npcState.id) openNpcPage(npcState.id, true); });
  initNpcWpDialog();
  $('#npc-edit').addEventListener('click', () => { const ta = $('#npcdesc-text'); if (ta) delete ta.dataset.filled; npcSetEditing(!npcState.editing); if (npcState.editing && ta) ta.focus(); });
  $('#npc-body').addEventListener('input', (e) => { if (e.target.id === 'npcdesc-text') $('#npcdesc-n').textContent = e.target.value.length.toLocaleString(); });
  $('#npc-body').addEventListener('keydown', (e) => {
    if (e.target.id !== 'npcdesc-text') return;
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); npcSaveDesc(); }
    else if (e.key === 'Escape') { e.stopPropagation(); delete e.target.dataset.filled; npcSetEditing(false); }
  });
  // quest links anywhere (list rows, chain, Planet Maps popups, Home…) open the quest page
  document.addEventListener('click', (e) => {
    const q = e.target.closest('[data-questopen]');
    if (q && q.dataset.questopen) { e.preventDefault(); openQuestPage(q.dataset.questopen); return; }
    const np = e.target.closest('[data-npcopen]');
    if (np && np.dataset.npcopen) { e.preventDefault(); openNpcPage(np.dataset.npcopen); }
  });
  // NPC waypoint row ↔ pin hover
  const nbody = $('#npc-body');
  const npcHover = (e, on) => {
    const row = e.target.closest('.npc-wp-mapped');
    if (!row || row.contains(e.relatedTarget)) return;
    row.classList.toggle('qd-step-hl', on);
    const el = qMapPinEl(npcState.map, safeInt(row.dataset.npcwp)); if (el) el.classList.toggle('qd-pin-hl', on);
  };
  nbody.addEventListener('mouseover', (e) => npcHover(e, true));
  nbody.addEventListener('mouseout', (e) => npcHover(e, false));
  const body = $('#quest-body');
  body.addEventListener('mouseover', (e) => {
    const row = e.target.closest('.qd-step-mapped');
    if (row && !row.contains(e.relatedTarget)) qdHighlight([safeInt(row.dataset.qstep)], true);
  });
  body.addEventListener('mouseout', (e) => {
    const row = e.target.closest('.qd-step-mapped');
    if (row && !row.contains(e.relatedTarget)) qdHighlight([safeInt(row.dataset.qstep)], false);
  });
  document.addEventListener('page:show', (e) => {
    if (e.detail?.key === 'quest' && qdState.map) setTimeout(() => qdState.map && qdState.map.map.invalidateSize(), 30);
    if (e.detail?.key === 'npc' && npcState.map) setTimeout(() => npcState.map && npcState.map.map.invalidateSize(), 30);
  });
  window.addEventListener('resize', () => { [qdState.map, npcState.map].forEach((m) => { if (m) m.map.invalidateSize(); }); });
  // dev mode switched off while a Quests page is open → back to Home (the gate)
  new MutationObserver(() => {
    if (!questsGated()) return;
    const cur = document.querySelector('.page.active');
    if (cur && ['page-quests', 'page-quest', 'page-npc'].includes(cur.id)) showPage('home');
  }).observe(document.body, { attributes: true, attributeFilter: ['class'] });
}
