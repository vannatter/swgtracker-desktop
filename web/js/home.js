/* Home — the start page. The website's landing page mix (Hot Resources, At a
   Glance) plus the newest spawns and the Spawn Alerts announcements feed, as
   sections you can show, hide and reorder (Customize). Inside each section you
   can hide what you'll never care about (a profession, a tile) and add your own
   widgets — a guild or city trend, a resource, a schematic's best spawns, a
   class's population, your restock count. Layout lives per-device in
   localStorage, like grid column prefs. */

const HOME_SECTIONS = [
  { key: 'hot', name: 'Hot Resources', icon: 'fa-fire', hint: 'the site’s top resources, by profession' },
  { key: 'glance', name: 'At a Glance', icon: 'fa-chart-simple', hint: 'the website dashboard tiles plus your own widgets' },
  { key: 'announce', name: 'Resource Announcements', icon: 'fa-bullhorn', hint: 'notable spawns server-wide — the Spawn Alerts feed' },
  { key: 'spawns', name: 'Recent Spawns', icon: 'fa-gem', hint: 'the newest active resources' },
];
// the built-in At a Glance tiles (hide any you don't care about)
const HOME_GLANCE = [
  { key: 'hottest_resource', name: 'Hottest Resource' },
  { key: 'hottest_schematic', name: 'Hottest Schematic' },
  { key: 'top_rated', name: 'Top Scored Active' },
  { key: 'city_mover', name: 'Biggest City Mover' },
  { key: 'guild_mover', name: 'Biggest Guild Mover' },
  { key: 'gcw', name: 'GCW Tracker' },
  { key: 'active_count', name: 'Active Resources' },
  { key: 'pulse', name: 'Today’s Pulse' },
];
// custom widget types — what you can pin to At a Glance yourself
const HOME_WIDGETS = {
  guild: { name: 'Guild', icon: 'fa-shield-halved', hint: 'active members over time for one guild', search: 'Search guilds by name or tag…' },
  city: { name: 'City', icon: 'fa-city', hint: 'citizens over time for one city', search: 'Search cities…' },
  resource: { name: 'Resource', icon: 'fa-gem', hint: 'is it still in spawn, score and planets', search: 'Search resources…' },
  schematic: { name: 'Schematic', icon: 'fa-scroll', hint: 'the best resource in spawn for each of its slots', search: 'Search schematics…' },
  class: { name: 'Profession', icon: 'fa-user-group', hint: 'population and trend for one class', search: 'Search classes…' },
  inv_restock: { name: 'My Inventory restock', icon: 'fa-boxes-stacked', hint: 'how many of your tracked items need restocking', search: null },
  factories: { name: 'Factories', icon: 'fa-industry', hint: 'runs in progress, finished runs to collect, and what’s due next', search: null },
  harvesters: { name: 'Harvesters', icon: 'fa-oil-well', hint: 'full hoppers, and how the rest are filling', search: null },
  sales: { name: 'Sales', icon: 'fa-tags', hint: 'credits and sales over a window, with the trend', search: null,
    options: [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [0, 'All time']].map(([d, l]) => ({ label: l, params: { days: d, name: l } })) },
  purchases: { name: 'Purchases', icon: 'fa-cart-shopping', hint: 'what you spent over a window', search: null,
    options: [[7, 'Last 7 days'], [30, 'Last 30 days'], [90, 'Last 90 days'], [180, 'Last 180 days']].map(([d, l]) => ({ label: l, params: { days: d, name: l } })) },
  stockpile: { name: 'Stockpile resource', icon: 'fa-cubes', hint: 'how much of one stockpiled resource you hold, and whether it’s still in spawn', search: 'Search your stockpile…' },
  wishlist: { name: 'Wishlist in spawn', icon: 'fa-heart', hint: 'which of your wished-for resources are spawning right now', search: null },
};
const HOME_TTL = 5 * 60 * 1000;   // a visit inside this window re-renders without refetching

const homeState = {
  layout: null, collapsed: null,
  dash: null, dashErr: null,       // api/home.php
  spawns: null, spawnsErr: null,   // api/resources.php newest actives
  ann: null, annErr: null,         // api/alerts.php announcements
  prof: null,                      // selected hot-resources chip
  wdata: {},                       // widget id -> { at, data, err }
  profData: null,                  // api/professions.php (class widgets)
  loadedAt: 0, loading: false,
  picker: { type: 'guild', results: [] },
};

// ---- layout prefs -----------------------------------------------------------
function homeLayout() {
  if (homeState.layout) return homeState.layout;
  let saved = null;
  try { saved = JSON.parse(localStorage.getItem('home_layout') || 'null'); } catch (_) {}
  saved = saved && typeof saved === 'object' ? saved : {};
  const keys = HOME_SECTIONS.map((s) => s.key);
  let order = (Array.isArray(saved.order) ? saved.order : []).filter((k) => keys.includes(k));
  keys.forEach((k) => { if (!order.includes(k)) order.push(k); });   // sections added later append
  // the pre-reorder default had Announcements last — treat that saved order as "never customised"
  if (order.join() === 'hot,glance,spawns,announce') order = [...keys];
  const arr = (v) => (Array.isArray(v) ? v.map(String) : []);
  homeState.layout = {
    order,
    hidden: new Set(arr(saved.hidden).filter((k) => keys.includes(k))),
    hotHidden: new Set(arr(saved.hotHidden)),                        // profession keys
    glanceHidden: new Set(arr(saved.glanceHidden)),                  // built-in tile keys + widget ids
    widgets: (Array.isArray(saved.widgets) ? saved.widgets : []).filter((w) => w && HOME_WIDGETS[w.type] && w.id),
    spawnsN: [6, 12, 24, 48].includes(Number(saved.spawnsN)) ? Number(saved.spawnsN) : 12,
    // list / cards / tree, same three as the Resources page; first use follows that page's view
    spawnsView: ['list', 'cards', 'tree'].includes(saved.spawnsView) ? saved.spawnsView : null,
    // Hot Resources / At a Glance: cards stacked in a grid, or a one-row carousel
    hotView: saved.hotView === 'grid' ? 'grid' : 'carousel',        // carousel by default (Dustin)
    glanceView: saved.glanceView === 'grid' ? 'grid' : 'carousel',
    annN: [5, 10, 25, 50].includes(Number(saved.annN)) ? Number(saved.annN) : 10,
  };
  return homeState.layout;
}
function homeSaveLayout() {
  const l = homeLayout();
  try {
    localStorage.setItem('home_layout', JSON.stringify({
      order: l.order, hidden: [...l.hidden], hotHidden: [...l.hotHidden], glanceHidden: [...l.glanceHidden],
      widgets: l.widgets, spawnsN: l.spawnsN, annN: l.annN, spawnsView: l.spawnsView, hotView: l.hotView, glanceView: l.glanceView,
    }));
  } catch (_) {}
}
function homeCollapsed() {
  if (!homeState.collapsed) {
    let c = [];
    try { c = JSON.parse(localStorage.getItem('home_collapsed') || '[]'); } catch (_) {}
    homeState.collapsed = new Set(Array.isArray(c) ? c : []);
  }
  return homeState.collapsed;
}

// ---- greeting ---------------------------------------------------------------
// "Good evening, Dos!" — the hour and date come from the Settings timezone
// (device clock when unset); the name is the account's site username
// (api/prefs.php), first letter capitalised. Holidays, Star Wars days and SWG
// anniversaries override the plain time-of-day line — the more the merrier.

// today's calendar parts in the app's timezone
function homeToday() {
  const now = new Date();
  const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  try {
    const f = new Intl.DateTimeFormat('en-US', { timeZone: appTimeZone || undefined, year: 'numeric', month: 'numeric', day: 'numeric', weekday: 'short', hour: 'numeric', hour12: false });
    const p = Object.fromEntries(f.formatToParts(now).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
    return { y: +p.year, m: +p.month, d: +p.day, dow: DOW.indexOf(p.weekday), hour: (+p.hour) % 24, date: now };
  } catch (_) {
    return { y: now.getFullYear(), m: now.getMonth() + 1, d: now.getDate(), dow: now.getDay(), hour: now.getHours(), date: now };
  }
}
// today's month/day in another calendar (hebrew, chinese, islamic-umalqura,
// persian) — Intl does the conversion; {m, d, month} with month = its name
function homeCal(t, calendar) {
  const f = new Intl.DateTimeFormat(`en-u-ca-${calendar}`, { timeZone: appTimeZone || undefined, month: 'long', day: 'numeric' });
  const p = Object.fromEntries(f.formatToParts(t.date || new Date()).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  const fn = new Intl.DateTimeFormat(`en-u-ca-${calendar}`, { timeZone: appTimeZone || undefined, month: 'numeric', day: 'numeric' });
  const pn = Object.fromEntries(fn.formatToParts(t.date || new Date()).filter((x) => x.type !== 'literal').map((x) => [x.type, x.value]));
  return { m: parseInt(pn.month, 10), d: parseInt(pn.day, 10), month: String(p.month || ''), leap: /bis|leap/i.test(String(pn.month)) };
}
const homeEasterOffset = (t, days) => { const e = homeEaster(t.y); const base = Date.UTC(t.y, e.m - 1, e.d) + days * 86400000; const x = new Date(base); return t.m === x.getUTCMonth() + 1 && t.d === x.getUTCDate(); };
// calendar helpers (all UTC-safe arithmetic on y/m/d)
const homeDow = (y, m, d) => new Date(Date.UTC(y, m - 1, d)).getUTCDay();
const homeNthDow = (y, m, dow, n) => 1 + ((7 + dow - homeDow(y, m, 1)) % 7) + (n - 1) * 7;   // nth <dow> of month
const homeLastDow = (y, m, dow) => { const last = new Date(Date.UTC(y, m, 0)).getUTCDate(); return last - ((7 + homeDow(y, m, last) - dow) % 7); };
function homeEaster(y) {   // Gregorian Easter Sunday (Meeus/Jones/Butcher)
  const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  return { m: Math.floor((h + l - 7 * m + 114) / 31), d: ((h + l - 7 * m + 114) % 31) + 1 };
}
const on = (m, d) => (t) => t.m === m && t.d === d;
// {n} = ", Name" (or nothing when the account has no name yet)
const HOME_HOLIDAYS = [
  // ---- Star Wars days ----
  [on(5, 4), 'May the Fourth be with you{n}!'],
  [on(5, 5), 'Revenge of the Fifth{n} — and Happy Cinco de Mayo. Stay on the light side of the Bazaar.'],
  [on(5, 25), 'A New Hope premiered this day in 1977{n}. Happy Star Wars Day — and don’t forget your towel.'],
  [on(5, 21), 'The Empire Strikes Back premiered this day in 1980{n}. No, I am your crafter.'],
  [on(5, 19), 'Happy Empire Day{n}! (or Remembrance Day — we don’t judge factions here)'],
  [on(11, 17), 'Happy Life Day{n}! Hug a Wookiee.'],
  // ---- SWG anniversaries ----
  [on(6, 26), 'Happy birthday, Star Wars Galaxies — launched this day in 2003{n}!'],
  [on(10, 27), 'Jump to Lightspeed launched this day in 2004{n}. Go fly something.'],
  [on(11, 15), 'The NGE dropped this day in 2005{n}. We don’t talk about it.'],
  [on(12, 15), 'The live servers closed this day in 2011{n}. The galaxy lives on.'],
  // ---- fixed-date holidays ----
  [on(10, 31), 'Happy Halloween{n}! The Galactic Moon Festival awaits.'],
  [on(11, 1), 'Happy Día de los Muertos{n}. Pour one out for the despawned.'],
  [on(1, 1), 'Happy New Year{n}! Fresh spawns, fresh start.'],
  [on(1, 26), 'Happy Australia Day{n}!'],
  [on(3, 8), 'Happy International Women’s Day{n}!'],
  [on(4, 25), 'Lest we forget{n} — ANZAC Day.'],
  [on(6, 19), 'Happy Juneteenth{n}.'],
  [on(6, 21), 'Happy summer solstice{n} — the longest harvest day of the year.'],
  [on(9, 8), 'Happy Star Trek Day{n}. Wrong franchise, still welcome.'],
  [on(9, 22), 'Happy Hobbit Day{n}. Second breakfast, then resources.'],
  [on(10, 21), 'Happy Back to the Future Day{n}. Great Scott, look at those spawns.'],
  [on(11, 5), 'Remember, remember the fifth of November{n}.'],
  [on(12, 21), 'Happy winter solstice{n} — the galaxy’s longest night.'],
  [(t) => t.m === 12 && t.d >= 27 && t.d <= 30, 'Happy Kwanzaa{n}!'],
  [(t) => t.y && t.m === 9 && t.d === (new Date(Date.UTC(t.y, 1, 29)).getUTCMonth() === 1 ? 12 : 13), 'Happy Programmers’ Day{n} — day 256 of the year.'],
  [on(2, 2), 'Happy Groundhog Day{n}. Same resources as yesterday? Same resources as yesterday.'],
  [on(2, 14), 'Happy Valentine’s Day{n}! Nothing says love like a 1000 OQ hide.'],
  [on(2, 29), 'Happy Leap Day{n} — a day that despawns for four years.'],
  [on(3, 14), 'Happy Pi Day{n}! 3.14159… the stat caps won’t be that precise.'],
  [on(3, 15), 'Beware the Ides of March{n}.'],
  [on(3, 17), 'Happy St. Patrick’s Day{n}! May your spawns be lucky.'],
  [on(4, 1), 'Every resource is 1000 today{n}! …April Fools.'],
  [on(4, 22), 'Happy Earth Day{n}. Go harvest something organic.'],
  [on(5, 1), 'Happy May Day{n}!'],
  [on(7, 1), 'Happy Canada Day{n}, eh!'],
  [on(7, 4), 'Happy Fourth of July{n}! Fireworks courtesy of the Rebellion.'],
  [on(7, 14), 'Happy Bastille Day{n}!'],
  [on(8, 8), 'Happy International Cat Day{n}. Pets to Creature Handlers: this is my day.'],
  [on(9, 19), 'Arr{n}, it be Talk Like a Pirate Day! Smugglers rejoice.'],
  [on(10, 3), 'It’s October 3rd{n}. (Mean Girls would want you to know.)'],
  [on(11, 11), 'Happy Veterans Day{n}. Thank you for your service.'],
  [on(12, 24), 'Happy Christmas Eve{n}! Stockings hung by the harvester with care.'],
  [on(12, 25), 'Merry Christmas{n}! May your crates be full.'],
  [on(12, 26), 'Happy Boxing Day{n}. Time to sort the loot.'],
  [on(12, 31), 'Happy New Year’s Eve{n}! One last restock before midnight.'],
  // ---- moveable feasts ----
  [(t) => { const e = homeEaster(t.y); return t.m === e.m && t.d === e.d; }, 'Happy Easter{n}! Eggs are Dathomirian this year.'],
  [(t) => homeEasterOffset(t, -2), 'Good Friday{n}.'],
  [(t) => { const c = homeCal(t, 'chinese'); return c.m === 1 && c.d === 1 && !c.leap; }, 'Happy Lunar New Year{n}!'],
  [(t) => homeEasterOffset(t, -47), 'Happy Mardi Gras{n}! Laissez les bons spawns rouler.'],
  [(t) => { const c = homeCal(t, 'persian'); return c.m === 1 && c.d === 1; }, 'Happy Nowruz{n}!'],
  [(t) => { const c = homeCal(t, 'hebrew'); return (c.month === 'Kislev' && c.d >= 25) || (c.month === 'Tevet' && c.d <= 2); }, 'Happy Hanukkah{n}!'],
  [(t) => { const c = homeCal(t, 'hebrew'); return c.month === 'Nisan' && c.d >= 15 && c.d <= 22; }, 'Happy Passover{n}!'],
  [(t) => { const c = homeCal(t, 'hebrew'); return c.month === 'Tishri' && c.d >= 1 && c.d <= 2; }, 'Shana Tova{n}! Happy Rosh Hashanah.'],
  [(t) => { const c = homeCal(t, 'islamic-umalqura'); return c.m === 9 && c.d === 1; }, 'Ramadan Mubarak{n}.'],
  [(t) => { const c = homeCal(t, 'islamic-umalqura'); return c.m === 10 && c.d === 1; }, 'Eid Mubarak{n}! Eid al-Fitr.'],
  [(t) => { const c = homeCal(t, 'islamic-umalqura'); return c.m === 12 && c.d === 10; }, 'Eid Mubarak{n}! Eid al-Adha.'],
  [(t) => t.m === 1 && t.dow === 1 && t.d === homeNthDow(t.y, 1, 1, 3), 'Happy Martin Luther King Jr. Day{n}.'],
  [(t) => t.m === 2 && t.dow === 1 && t.d === homeNthDow(t.y, 2, 1, 3), 'Happy Presidents’ Day{n}.'],
  [(t) => t.m === 10 && t.dow === 1 && t.d === homeNthDow(t.y, 10, 1, 2), 'Happy Canadian Thanksgiving{n}! (and Indigenous Peoples’ Day in the US)'],
  [(t) => t.m === 11 && t.dow === 4 && t.d === homeNthDow(t.y, 11, 4, 4), 'Happy Thanksgiving{n}! Pass the Dantooine Domesticated Meat.'],
  [(t) => t.m === 11 && t.dow === 5 && t.d === homeNthDow(t.y, 11, 4, 4) + 1, 'Happy Black Friday{n}. Vendor prices, sadly, are not on sale.'],
  [(t) => t.m === 5 && t.dow === 0 && t.d === homeNthDow(t.y, 5, 0, 2), 'Happy Mother’s Day{n}! Call her — after this spawn.'],
  [(t) => t.m === 6 && t.dow === 0 && t.d === homeNthDow(t.y, 6, 0, 3), 'Happy Father’s Day{n}!'],
  [(t) => t.m === 5 && t.dow === 1 && t.d === homeLastDow(t.y, 5, 1), 'Happy Memorial Day{n}.'],
  [(t) => t.m === 9 && t.dow === 1 && t.d === homeNthDow(t.y, 9, 1, 1), 'Happy Labor Day{n}! Harvesters keep working anyway.'],
  [(t) => t.dow === 5 && t.d === 13, 'Friday the 13th{n}. Maybe don’t experiment today.'],
  // ---- weekday color (lowest priority) ----
  [(t) => t.dow === 1 && t.hour >= 5 && t.hour < 12, 'Ugh, Monday{n}. Coffee first, resources second.'],
  [(t) => t.dow === 5 && t.hour >= 12, 'Happy Friday{n}! Weekend crafting awaits.'],
];

function homeGreeting() {
  const t = homeToday();
  const raw = (appPrefs && appPrefs.name) ? String(appPrefs.name).trim() : '';
  const name = raw ? raw.charAt(0).toUpperCase() + raw.slice(1) : '';
  const n = name ? `, ${name}` : '';
  const hit = HOME_HOLIDAYS.find(([test]) => { try { return test(t); } catch (_) { return false; } });
  if (hit) return hit[1].replace('{n}', n);
  if (t.hour < 5) return `Up late${n}?`;
  const part = t.hour < 12 ? 'Good morning' : t.hour < 17 ? 'Good afternoon' : 'Good evening';
  return `${part}${n}!`;
}

// ---- data ---------------------------------------------------------------------
async function loadHome(force = false) {
  const fresh = homeState.loadedAt && Date.now() - homeState.loadedAt < HOME_TTL;
  if (!force && (fresh || homeState.loading)) { renderHome(); return; }
  homeState.loading = true;
  if (force) { homeState.wdata = {}; homeState.stkRows = null; }  // custom widgets refetch too
  // first paint AND a manual refresh: one spinner, nothing else, for at least
  // half a second so a fast reload still visibly happened (Dustin). Background
  // re-pulls (a section switched on in Customize) keep the page on screen.
  const page = $('#page-home');
  homeState.booting = !homeState.loadedAt || force === true;
  if (homeState.booting) page.classList.add('hm-booting');
  else renderHome();
  const l = homeLayout();
  const want = (k) => !l.hidden.has(k);
  const jobs = [loadPrefs()];            // the greeting needs the account name
  if (homeState.booting) jobs.push(new Promise((r) => setTimeout(r, 500)));
  if (want('hot') || want('glance')) {
    jobs.push(apiFetch('GET', 'api/home.php')
      .then((r) => { homeState.dash = r.ok ? r.data : null; homeState.dashErr = r.ok ? null : (r.error || 'failed to load'); })
      .catch((e) => { homeState.dash = null; homeState.dashErr = String(e); }));
  }
  if (want('spawns')) {
    jobs.push(apiFetch('GET', 'api/resources.php', { params: { status: 'active', sort: 'id', order: 'DESC', perpage: l.spawnsN, page: 1 } })
      .then((r) => { homeState.spawns = r.ok ? ((r.data && r.data.results) || []) : null; homeState.spawnsErr = r.ok ? null : (r.error || 'failed to load'); })
      .catch((e) => { homeState.spawns = null; homeState.spawnsErr = String(e); }));
  }
  if (want('announce')) {
    jobs.push(apiFetch('GET', 'api/alerts.php')
      .then((r) => { homeState.ann = r.ok ? (r.data && r.data.announcements) : null; homeState.annErr = r.ok ? null : (r.error || 'failed to load'); })
      .catch((e) => { homeState.ann = null; homeState.annErr = String(e); }));
  }
  await Promise.all(jobs);
  homeState.loadedAt = Date.now();
  homeState.loading = false;
  homeState.booting = false;
  renderHome();
  page.classList.remove('hm-booting');
}

// ---- render ---------------------------------------------------------------------
function renderHome() {
  if (homeState.booting) return;   // the spinner owns the page until the load lands
  const l = homeLayout();
  const col = homeCollapsed();
  const g = $('#home-greet'); if (g) g.textContent = homeGreeting();
  const parts = l.order.filter((k) => !l.hidden.has(k)).map((k) => {
    const def = HOME_SECTIONS.find((s) => s.key === k);
    const body = { hot: homeHotHtml, glance: homeGlanceHtml, spawns: homeSpawnsHtml, announce: homeAnnounceHtml }[k]();
    const isCol = col.has(k);
    return `<section class="hm-section${isCol ? ' collapsed' : ''}" data-hmsec="${k}">
      <div class="hm-head" data-hmtoggle="${k}">
        <i class="fa-solid ${def.icon} hm-icon"></i><span class="hm-title">${def.name}</span>
        ${body.count != null ? `<span class="hm-count">${body.count}</span>` : ''}
        <span class="hm-headright">${body.right || ''}</span>
        <i class="fa-solid fa-chevron-down hm-caret"></i>
      </div>
      <div class="hm-body"${isCol ? ' hidden' : ''}>${body.html}</div>
    </section>`;
  });
  $('#home-sections').innerHTML = parts.join('')
    || '<div class="grid-empty">Every section is hidden — use Customize to bring some back.</div>';
  const upd = $('#home-updated');
  if (upd) upd.textContent = homeState.loading ? 'Loading…' : homeState.loadedAt ? `Updated ${new Date(homeState.loadedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : '';
  homeKickWidgets();
  homeSyncCarousels();
  const treeBox = $('#home-spawn-tree');
  if (treeBox && homeState.spawns) renderResTree(treeBox, homeState.spawns, { force: true });
}

const homeNeedsSite = (err) => String(err || '').includes('404')
  ? 'This section needs the site update (api/home.php) — it will light up once swgtracker.com deploys.'
  : `Error: ${err}`;
const homeLoadingHtml = '<div class="hm-loading"><i class="fa-solid fa-spinner fa-spin"></i> Loading…</div>';

// the hot-bar professions you haven't hidden ("All" is never hideable — it's
// the sum of whatever else you kept)
function homeVisibleProfs() {
  const hb = homeState.dash && homeState.dash.hotbar;
  const l = homeLayout();
  return ((hb && hb.profs) || []).filter((p) => p.key === '__all' || !l.hotHidden.has(String(p.key)));
}
// "All" = the union of the professions you chose, not the site's everything
// list — hide all but Armor and Weapon and All is just those two (Dustin).
// Each resource once, at its hottest, ordered like the site's All panel.
function homeHotAllRows() {
  const hb = homeState.dash && homeState.dash.hotbar;
  if (!hb) return [];
  const byId = new Map();
  homeVisibleProfs().filter((p) => p.key !== '__all').forEach((p) => {
    (hb.byProf[p.key] || []).forEach((r) => {
      const cur = byId.get(String(r.id));
      if (!cur || Number(r.hotness) > Number(cur.hotness)) byId.set(String(r.id), r);
    });
  });
  return [...byId.values()].sort((a, b) => Number(b.hotness) - Number(a.hotness));
}

// Hot Resources: profession chips + cards, mirroring the website's hot bar
function homeHotHtml() {
  const right = homeCardViewSwitch('hot', homeLayout().hotView);
  if (homeState.dashErr) return { right, html: `<div class="grid-empty">${escapeHtml(homeNeedsSite(homeState.dashErr))}</div>` };
  const d = homeState.dash;
  if (!d) return { right, html: homeLoadingHtml };
  const hb = d.hotbar || { profs: [], byProf: {}, total: 0 };
  const profs = homeVisibleProfs();
  if (!profs.length) return { count: 0, html: `<div class="grid-empty">${hb.profs.length ? 'Every profession is hidden — Customize to bring some back.' : 'No hot resources right now.'}</div>` };
  let prof = homeState.prof;
  if (!prof) { try { prof = localStorage.getItem('home_hotprof'); } catch (_) {} }
  if (!profs.some((p) => p.key === prof)) prof = profs[0].key;
  homeState.prof = prof;
  const allRows = homeHotAllRows();
  if (profs.length === 1 && profs[0].key === '__all') return { count: 0, html: '<div class="grid-empty">Every profession is hidden — Customize to bring some back.</div>' };
  const chips = profs.map((p) => `<button type="button" class="hm-chip${p.key === prof ? ' active' : ''}" data-hmprof="${escapeHtml(p.key)}"
      style="--chip:${escapeHtml(p.color || '#777')}"><span class="hm-chip-dot"></span>${escapeHtml(p.label)} <span class="hm-chip-n">${p.key === '__all' ? allRows.length : safeInt(p.count)}</span></button>`).join('');
  const rows = prof === '__all' ? allRows.slice(0, 12) : (hb.byProf[prof] || []);
  const cards = rows.map((r) => `<div class="hm-hot-card${r.is_new ? ' is-new' : ''}">
      <div class="hm-hot-top">${r.is_new ? '<span class="hm-new">NEW</span>' : ''}<span class="res-name hm-hot-name" data-resname="${escapeHtml(r.name || '')}">${escapeHtml(r.name || '')}</span></div>
      <div class="hm-hot-type">${escapeHtml(r.type_name || '')}</div>
      <div class="hm-hot-meta"><span title="Best spawn rank for this profession">Rank ${safeInt(r.best_rank)}</span><span title="Schematics it tops">${safeInt(r.sch_count)} use${safeInt(r.sch_count) === 1 ? '' : 's'}</span></div>
      <div class="hm-hot-planets">${planetsHtml(r)}</div>
    </div>`).join('');
  return { count: allRows.length, right, html: `<div class="hm-chips">${chips}</div>${cards
    ? homeCardsWrap(homeLayout().hotView, 'hm-hot-grid', cards) : '<div class="grid-empty">Nothing hot for this profession.</div>'}` };
}

// grid / carousel switch for a card section's header, and the wrapper that
// lays the cards out either way (carousel = one scroll-snapped row + arrows)
function homeCardViewSwitch(key, view) {
  return `<span class="res-view-switch hm-view" title="View">${[['grid', 'fa-table-cells-large', 'Cards stacked'], ['carousel', 'fa-arrows-left-right', 'Carousel']]
    .map(([v, ic, t]) => `<button type="button" class="res-view-btn${view === v ? ' active' : ''}" data-hmsview="${key}:${v}" title="${t}"><i class="fa-solid ${ic}"></i></button>`).join('')}</span>`;
}
function homeCardsWrap(view, gridCls, cardsHtml) {
  if (view !== 'carousel') return `<div class="${gridCls}">${cardsHtml}</div>`;
  return `<div class="hm-carousel-wrap">
    <button type="button" class="hm-car-btn hm-car-left" data-hmcar="-1" title="Scroll left"><i class="fa-solid fa-chevron-left"></i></button>
    <div class="hm-carousel ${gridCls}-car">${cardsHtml}</div>
    <button type="button" class="hm-car-btn hm-car-right" data-hmcar="1" title="Scroll right"><i class="fa-solid fa-chevron-right"></i></button>
  </div>`;
}

// one At a Glance tile
function homeTile(label, value, sub, badge, extra = '', attrs = '') {
  return `<div class="hm-tile" ${attrs}>
      <div class="hm-tile-label">${label}</div>
      <div class="hm-tile-value">${value}</div>
      ${sub ? `<div class="hm-tile-sub">${sub}</div>` : ''}
      ${badge ? `<span class="hm-badge">${badge}</span>` : ''}${extra}
    </div>`;
}
const homeResLink = (name) => name ? `<span class="res-name" data-resname="${escapeHtml(name)}">${escapeHtml(name)}</span>` : '<span class="stat_off">—</span>';

// At a Glance: the website dashboard tiles you haven't hidden, then your widgets
function homeGlanceHtml() {
  const l = homeLayout();
  const d = homeState.dash;
  const right = homeCardViewSwitch('glance', l.glanceView);
  const builtins = HOME_GLANCE.filter((t) => !l.glanceHidden.has(t.key));
  const widgets = l.widgets.filter((w) => !l.glanceHidden.has(w.id));
  if (!builtins.length && !widgets.length) return { right, html: '<div class="grid-empty">Every tile is hidden — Customize to bring some back or add a widget.</div>' };
  let tiles = '';
  if (builtins.length) {
    if (homeState.dashErr) tiles = `<div class="grid-empty">${escapeHtml(homeNeedsSite(homeState.dashErr))}</div>`;
    else if (!d) tiles = homeLoadingHtml;
    else {
      const hr = d.hottest_resource, hs = d.hottest_schematic, tr = d.top_rated, cm = d.city_mover, gm = d.guild_mover;
      const gcw = d.gcw || [];
      const last = gcw.length ? gcw[gcw.length - 1] : null;
      const pulse = d.pulse || { history: [], now: 0, peak: 0 };
      const built = {
        hottest_resource: () => homeTile('Hottest Resource', homeResLink(hr && hr.name), hr ? escapeHtml(hr.type_name || '') : '', hr ? `${safeInt(hr.cnt)} schematic${safeInt(hr.cnt) === 1 ? '' : 's'}` : ''),
        hottest_schematic: () => homeTile('Hottest Schematic', hs ? `<span class="hm-schem" data-hmschem="${safeInt(hs.id)}" data-hmschemname="${escapeHtml(hs.name || '')}">${escapeHtml(hs.name || '')}</span>` : '<span class="stat_off">—</span>', '', hs ? `${safeInt(hs.cnt)} top resource${safeInt(hs.cnt) === 1 ? '' : 's'}` : ''),
        top_rated: () => homeTile('Top Scored Active', homeResLink(tr && tr.name), tr ? escapeHtml(tr.type_name || '') : '', tr ? `Score: ${escapeHtml(String(tr.value_rating ?? '-'))}` : ''),
        city_mover: () => cm && safeInt(cm.citizen_change) > 0
          ? homeTile('Biggest City Mover', escapeHtml(cm.name || ''), `${escapeHtml(cm.planet || '')} - ${escapeHtml(cm.mayor || '')}`, `+${safeInt(cm.citizen_change)} citizens`)
          : homeTile('Biggest City Mover', '<span class="stat_off">No movement</span>', 'no city grew since the last scans', ''),
        guild_mover: () => gm && safeInt(gm.active_change) > 0
          ? homeTile('Biggest Guild Mover', escapeHtml(gm.name || ''), `[${escapeHtml(gm.abbrev || '')}] - ${escapeHtml(gm.leader || '')}`, `+${safeInt(gm.active_change)} active`)
          : homeTile('Biggest Guild Mover', '<span class="stat_off">No movement</span>', 'no guild grew since the last scans', ''),
        gcw: () => homeTile('GCW Tracker', `<div class="hm-mini">${gcw.length > 1
            ? gxLineChart([{ name: 'Imperial', color: '#e24350', values: gcw.map((g) => g.imperial) }, { name: 'Rebel', color: '#5b8def', values: gcw.map((g) => g.rebel) }], { w: 320, h: 96, labels: gcw.map((g) => g.label) })
            : '<div class="settings-sub">no GCW history yet</div>'}</div>`, '', '',
          last ? `<div class="hm-gcw-now"><span class="hm-imp">${fmtNum(last.imperial)} Imp</span><span class="hm-reb">${fmtNum(last.rebel)} Reb</span></div>` : ''),
        active_count: () => homeTile('Active Resources', fmtNum(safeInt(d.active_count)), 'currently in spawn', ''),
        pulse: () => homeTile('Today’s Pulse', `<div class="hm-mini">${(pulse.history || []).length > 1
            ? gxSpark(pulse.history, { w: 240, h: 48, color: 'var(--accent)', fill: true })
            : '<div class="settings-sub">no pulse samples yet today</div>'}</div>`, '', '',
          `<div class="hm-pulse-now"><b>Now: ${fmtNum(safeInt(pulse.now))}</b><span>Peak: ${fmtNum(safeInt(pulse.peak))}</span></div>`),
      };
      tiles = builtins.map((t) => built[t.key]()).join('');
    }
  }
  const custom = widgets.map((w) => homeWidgetTileHtml(w)).join('');
  return { right, html: homeCardsWrap(l.glanceView, 'hm-tiles', tiles + custom) };
}

// a carousel fades at whichever edge still has cards beyond it, with the arrow on top
function homeSyncCarousel(strip) {
  const wrap = strip.closest('.hm-carousel-wrap');
  if (!wrap) return;
  wrap.classList.toggle('can-left', strip.scrollLeft > 4);
  wrap.classList.toggle('can-right', strip.scrollLeft + strip.clientWidth < strip.scrollWidth - 4);
}
function homeSyncCarousels() {
  document.querySelectorAll('#home-sections .hm-carousel').forEach(homeSyncCarousel);
}

// ---- custom widgets -------------------------------------------------------------
const homeWidgetLabel = (w) => {
  const def = HOME_WIDGETS[w.type] || { name: w.type };
  return w.params && w.params.name ? `${def.name} · ${w.params.name}` : def.name;
};

function homeWidgetTileHtml(w) {
  const def = HOME_WIDGETS[w.type];
  const cell = homeState.wdata[w.id];
  const attrs = `data-hmwid="${escapeHtml(w.id)}"`;
  const label = `<i class="fa-solid ${def.icon}"></i> ${escapeHtml(def.name)}`;
  if (!cell) return homeTile(label, escapeHtml((w.params && w.params.name) || ''), '', '', homeLoadingHtml, attrs);
  if (cell.err) return homeTile(label, escapeHtml((w.params && w.params.name) || ''), `<span class="stat_off">${escapeHtml(cell.err)}</span>`, '', '', attrs);
  const d = cell.data;
  const spark = (vals, color) => (vals || []).filter((v) => v != null).length > 1
    ? `<div class="hm-mini">${gxSpark(vals.filter((v) => v != null).slice(-60), { w: 240, h: 44, color, fill: true })}</div>` : '';
  switch (w.type) {
    case 'guild': {
      const g = d.guild || {}; const h = d.history || [];
      const act = h.map((x) => safeInt(x.active));
      const chg = act.length >= 2 ? act[act.length - 1] - act[act.length - 2] : null;
      return homeTile(label, `<span class="hm-link" data-hmguild="${escapeHtml(g.abbrev || w.params.abbrev)}" data-hmgname="${escapeHtml(g.name || w.params.name)}">${escapeHtml(g.name || w.params.name)}</span>`,
        `[${escapeHtml(g.abbrev || w.params.abbrev)}]${g.leader ? ` - ${escapeHtml(g.leader)}` : ''}`,
        `${fmtNum(safeInt(g.active))} active · ${fmtNum(safeInt(g.members))} members${chg ? ` · ${chg > 0 ? '+' : ''}${chg}` : ''}`, spark(act, '#e24350'), attrs);
    }
    case 'city': {
      const c = d.city || {}; const h = d.history || [];
      const cit = h.map((x) => safeInt(x.citizens));
      const chg = cit.length >= 2 ? cit[cit.length - 1] - cit[cit.length - 2] : null;
      return homeTile(label, `<span class="hm-link" data-hmcity="${escapeHtml(c.name || w.params.name)}" data-hmplanet="${escapeHtml(c.planet || w.params.planet || '')}">${escapeHtml(c.name || w.params.name)}</span>`,
        `${escapeHtml(c.planet || w.params.planet || '')}${c.mayor ? ` - ${escapeHtml(c.mayor)}` : ''}`,
        `${fmtNum(safeInt(c.citizens))} citizens · ${fmtNum(safeInt(c.active_citizens))} active${chg ? ` · ${chg > 0 ? '+' : ''}${chg}` : ''}`, spark(cit, '#5b9bd5'), attrs);
    }
    case 'resource': {
      const r = d.resource || {};
      const live = String(r.status ?? '0') === '1';
      return homeTile(label, homeResLink(r.name || w.params.name), escapeHtml(r.type_name || ''),
        `${live ? '<span class="hm-live">In spawn</span>' : '<span class="stat_off">Despawned</span>'} · Score ${escapeHtml(String(r.value_rating ?? r.score ?? '-'))}`,
        `<div class="hm-hot-planets">${planetsHtml(r)}</div>${live && r.timestamp ? `<div class="hm-tile-sub">${escapeHtml(agoText(r.timestamp))}</div>` : ''}`, attrs);
    }
    case 'schematic': {
      const s = d.schematic || {};
      const slots = (s.resourceDtoList || []).slice(0, 4).map((dto) => {
        const best = (dto.currentBestResourceList || [])[0];
        return `<div class="hm-slot"><span class="hm-slot-type">${escapeHtml(dto.resourceTypeName || '')}</span> ${best
          ? `<span class="res-name" data-resname="${escapeHtml(best.resourceName || '')}">${escapeHtml(best.resourceName || '')}</span> <span class="hm-slot-q">${Math.round((Number(best.resourceQuality) || 0) / 10)}%</span>`
          : '<span class="stat_off">none in spawn</span>'}</div>`;
      }).join('');
      return homeTile(label, `<span class="hm-schem" data-hmschem="${safeInt(w.params.id)}" data-hmschemname="${escapeHtml(s.schematicName || w.params.name)}">${escapeHtml(s.schematicName || w.params.name)}</span>`,
        '', '', `<div class="hm-slots">${slots || '<span class="stat_off">no resource slots</span>'}</div>`, attrs);
    }
    case 'class': {
      const p = d.item || {}; const hist = d.history || [];
      const chg = safeInt(p.change_recent);
      return homeTile(label, `<span class="hm-link" data-hmgo="professions">${escapeHtml(p.name || w.params.name)}</span>`, '',
        `${fmtNum(safeInt(p.count))} players${chg ? ` · ${chg > 0 ? '+' : ''}${chg} recent` : ''}`, spark(hist, p.color || 'var(--accent)'), attrs);
    }
    case 'inv_restock': {
      const n = safeInt(d.count), neg = safeInt(d.negative);
      return homeTile(label, `<span class="hm-link" data-hmgo="inventory">${n ? `${fmtNum(n)} item${n === 1 ? '' : 's'} to restock` : 'Nothing to restock'}</span>`,
        neg ? `${fmtNum(neg)} oversold` : 'every tracked item is above its threshold', '', '', attrs);
    }
    case 'factories': {
      const parts = [];
      if (d.done) parts.push(`<span class="hm-live">${d.done} ready to collect</span>`);
      if (d.running) parts.push(`${d.running} running`);
      if (d.paused) parts.push(`${d.paused} paused`);
      return homeTile(label, `<span class="hm-link" data-hmgo="factories">${d.total ? (d.done ? `${d.done} run${d.done === 1 ? '' : 's'} done` : d.running ? `${d.running} running` : 'All idle') : 'No factories yet'}</span>`,
        parts.join(' · ') || (d.total ? `${d.total} idle` : 'add one on the Factories page'),
        d.nextName ? `${escapeHtml(d.nextName)} done ${escapeHtml(fmtAgo(d.nextDue))}` : '', '', attrs);
    }
    case 'harvesters': {
      return homeTile(label, `<span class="hm-link" data-hmgo="harvesters">${d.total ? (d.full ? `<span class="hm-live">${d.full} full hopper${d.full === 1 ? '' : 's'}</span>` : 'Hoppers filling') : 'No harvesters yet'}</span>`,
        d.total ? `${d.total} harvester${d.total === 1 ? '' : 's'} · average hopper ${d.avg}%` : 'add one on the Harvesters page',
        d.soonName ? `${escapeHtml(d.soonName)} full ${escapeHtml(fmtAgo(d.soonAt))}` : '', '', attrs);
    }
    case 'sales': {
      const k = d.kpis || {};
      const trend = (d.trend || []).map((b) => safeInt(b.total));
      return homeTile(`${label} · ${escapeHtml(w.params.name || '')}`, `<span class="hm-link" data-hmgo="sales">${fmtNum(safeInt(k.total_revenue))} cr</span>`,
        `${fmtNum(safeInt(k.total_sales))} sale${safeInt(k.total_sales) === 1 ? '' : 's'} · ${fmtNum(safeInt(k.unique_buyers))} buyer${safeInt(k.unique_buyers) === 1 ? '' : 's'}`,
        k.avg_sale ? `avg ${fmtNum(safeInt(k.avg_sale))} cr` : '', spark(trend, 'var(--accent-green, #45e97e)'), attrs);
    }
    case 'purchases': {
      return homeTile(`${label} · ${escapeHtml(w.params.name || '')}`, `<span class="hm-link" data-hmgo="purchases">${fmtNum(safeInt(d.total))} cr</span>`,
        d.average ? `about ${fmtNum(safeInt(d.average))} cr a day` : 'nothing bought in this window', '', '', attrs);
    }
    case 'stockpile': {
      const r = d.row || {};
      const live = String(r.status ?? '0') === '1';
      return homeTile(label, homeResLink(r.name || w.params.name), escapeHtml(r.type_name || ''),
        `${fmtNum(safeInt(r.stock))} units · ${live ? '<span class="hm-live">in spawn</span>' : '<span class="stat_off">despawned</span>'}`,
        `<div class="hm-hot-planets">${planetsHtml(r)}</div>`, attrs);
    }
    case 'wishlist': {
      const n = (d.live || []).length;
      const names = (d.live || []).slice(0, 3).map((r) => `<span class="res-name" data-resname="${escapeHtml(r.name)}">${escapeHtml(r.name)}</span>`).join(', ');
      return homeTile(label, `<span class="hm-link" data-hmgo="wishlist">${n ? `${n} in spawn now` : 'None in spawn'}</span>`,
        n ? names + (n > 3 ? ` and ${n - 3} more` : '') : `${d.total ? `${d.total} wished for, none spawning` : 'your wishlist is empty'}`, '', '', attrs);
    }
    default: return '';
  }
}

// fetch what a widget shows; cached per widget for HOME_TTL
async function homeWidgetFetch(w) {
  const p = w.params || {};
  switch (w.type) {
    case 'guild': return apiFetch('GET', 'api/guild_history.php', { params: { abbrev: p.abbrev } });
    case 'city': return apiFetch('GET', 'api/city_history.php', { params: { name: p.name, planet: p.planet || '' } });
    case 'resource': return apiFetch('GET', 'api/resources.php', { params: { name: p.name } });
    case 'schematic': return apiFetch('GET', 'api/schematics.php', { params: { id: p.id } });
    case 'class': {
      if (!homeState.profData) {
        const r = await apiFetch('GET', 'api/professions.php');
        if (!r.ok) return r;
        homeState.profData = r.data || {};
      }
      const item = (homeState.profData.professions || []).find((x) => x.key === p.key);
      return item ? { ok: true, data: { item, history: (homeState.profData.history || {})[p.key] || [] } } : { ok: false, error: 'class not in the feed' };
    }
    case 'inv_restock': {
      const r = await apiFetch('GET', 'api/inventory.php', { params: { inventory_type: 'restock', perpage: 500 } });
      if (!r.ok) return r;
      const rows = (r.data && r.data.results) || [];
      return { ok: true, data: { count: rows.length, negative: rows.filter((i) => safeInt(i.stocked) < 0).length } };
    }
    case 'factories': {
      const r = await apiFetch('GET', 'api/factories.php');
      if (!r.ok) return r;
      const rows = (r.data && (r.data.factories || r.data.results)) || [];
      const by = { idle: 0, paused: 0, running: 0, done: 0 };
      let nextDue = null, nextName = '';
      rows.forEach((f) => {
        const st = facStatus(f); by[st] = (by[st] || 0) + 1;
        if (st === 'running') { const due = facDue(f); if (nextDue === null || due < nextDue) { nextDue = due; nextName = f.name || f.product || ''; } }
      });
      return { ok: true, data: { total: rows.length, ...by, nextDue, nextName } };
    }
    case 'harvesters': {
      const r = await apiFetch('GET', 'api/harvesters.php');
      if (!r.ok) return r;
      const rows = (r.data && (r.data.harvesters || r.data.results)) || [];
      let full = 0, pctSum = 0, pctN = 0, soonAt = null, soonName = '';
      rows.forEach((h) => {
        const hp = harvHopper(h); if (!hp) return;
        pctSum += hp.pct; pctN++;
        if (hp.pct >= 99.9) full++;
        else if (hp.fullAt && (soonAt === null || hp.fullAt < soonAt)) { soonAt = hp.fullAt; soonName = h.name || h.resource_name || h.harvester_type || ''; }
      });
      return { ok: true, data: { total: rows.length, full, avg: pctN ? Math.round(pctSum / pctN) : 0, soonAt, soonName } };
    }
    case 'sales': return apiFetch('GET', 'api/sales.php', { params: { action: 'stats', days: safeInt(p.days) } });
    case 'purchases': {
      const r = await apiFetch('GET', 'api/purchases.php', { params: { perpage: 1, page: 1 } });
      if (!r.ok) return r;
      const s = (r.data && r.data.summaries) || {};
      const win = s[String(safeInt(p.days))] || s[safeInt(p.days)] || {};
      return { ok: true, data: { total: safeInt(win.total), average: safeInt(win.average) } };
    }
    case 'stockpile': {
      const rows = await homeStockpileRows();
      const row = rows.find((x) => String(x.stockpile_id) === String(p.stockpile_id));
      return row ? { ok: true, data: { row } } : { ok: false, error: 'no longer in your stockpile' };
    }
    case 'wishlist': {
      const r = await apiFetch('GET', 'api/wishlist.php', { params: { perpage: 500, page: 1 } });
      if (!r.ok) return r;
      const rows = (r.data && r.data.results) || [];
      return { ok: true, data: { total: rows.length, live: rows.filter((x) => String(x.status ?? '0') === '1') } };
    }
    default: return { ok: false, error: 'unknown widget' };
  }
}

// the stockpile rows, fetched once per load for the picker and the widget
async function homeStockpileRows() {
  if (homeState.stkRows) return homeState.stkRows;
  const r = await apiFetch('GET', 'api/stockpile.php', { params: { perpage: 500, page: 1 } });
  homeState.stkRows = (r.ok && r.data && r.data.results) || [];
  return homeState.stkRows;
}

// start fetches for any visible widget without fresh data; each tile swaps in
// place when its answer lands (no whole-page re-render)
function homeKickWidgets() {
  const l = homeLayout();
  if (l.hidden.has('glance')) return;
  l.widgets.filter((w) => !l.glanceHidden.has(w.id)).forEach((w) => {
    const cell = homeState.wdata[w.id];
    if (cell && (cell.pending || Date.now() - cell.at < HOME_TTL)) return;
    homeState.wdata[w.id] = { pending: true, at: Date.now() };
    homeWidgetFetch(w).then((r) => {
      homeState.wdata[w.id] = r.ok && r.data && !r.data.error
        ? { at: Date.now(), data: r.data }
        : { at: Date.now(), err: (r.data && r.data.error) || r.error || 'could not load' };
    }).catch((e) => { homeState.wdata[w.id] = { at: Date.now(), err: String(e) }; })
      .then(() => {
        const el = document.querySelector(`#home-sections [data-hmwid="${CSS.escape(w.id)}"]`);
        if (el) el.outerHTML = homeWidgetTileHtml(w);
      });
  });
}

// Recent Spawns: the newest active resources, in the Resources page's list,
// cards or category tree — never a locked view (Dustin)
const homeSpawnsView = () => homeLayout().spawnsView || (typeof resState !== 'undefined' && resState.view) || 'list';
function homeSpawnsHtml() {
  const view = homeSpawnsView();
  const right = `<span class="res-view-switch hm-view" title="View">${[['list', 'fa-list', 'List'], ['cards', 'fa-table-cells-large', 'Cards'], ['tree', 'fa-sitemap', 'Category tree']]
      .map(([v, ic, t]) => `<button type="button" class="res-view-btn${view === v ? ' active' : ''}" data-hmview="${v}" title="${t}"><i class="fa-solid ${ic}"></i></button>`).join('')}</span>
    <span class="res-view-switch hm-view"><button type="button" class="res-view-btn hm-jump" data-hmgo="resources" title="Open Resources"><i class="fa-solid fa-arrow-up-right-from-square"></i></button></span>`;
  if (homeState.spawnsErr) return { right, html: `<div class="grid-empty">Error: ${escapeHtml(homeState.spawnsErr)}</div>` };
  const rows = homeState.spawns;
  if (!rows) return { right, html: homeLoadingHtml };
  if (!rows.length) return { count: 0, right, html: '<div class="grid-empty">No active spawns reported.</div>' };
  if (view === 'cards') return { count: rows.length, right, html: `<div class="res-card-grid hm-spawn-grid">${rows.map(resCardHtml).join('')}</div>` };
  if (view === 'tree') return { count: rows.length, right, html: '<div id="home-spawn-tree" class="hm-spawn-tree"></div>' }; // filled after paint (async)
  return { count: rows.length, right, html: `<div class="table-wrap hm-tablewrap"><table class="data-grid res-grid"><thead><tr>${resHeaderHtml()}</tr></thead>
      <tbody>${rows.map(resRowHtml).join('')}</tbody></table></div>` };
}

// Announcements: the Spawn Alerts community feed
function homeAnnounceHtml() {
  if (homeState.annErr) return { html: `<div class="grid-empty">Error: ${escapeHtml(homeState.annErr)}</div>` };
  // (section title: Resource Announcements — the Spawn Alerts feed)
  const list = homeState.ann;
  if (list === null && !homeState.loadedAt) return { html: homeLoadingHtml };
  const right = '<span class="res-view-switch hm-view"><button type="button" class="res-view-btn hm-jump" data-hmgo="alerts" title="Open Spawn Alerts"><i class="fa-solid fa-arrow-up-right-from-square"></i></button></span>';
  if (!Array.isArray(list)) return { right, html: '<div class="grid-empty">Announcements need the server update — the feed appears once swgtracker.com deploys it.</div>' };
  if (!list.length) return { count: 0, right, html: '<div class="grid-empty">Nothing notable has spawned lately.</div>' };
  const shown = list.slice(0, homeLayout().annN);
  return { count: shown.length, right, html: `<div class="table-wrap hm-tablewrap"><table class="data-grid">
      <thead><tr><th class="col-text">When</th><th class="col-name">Resource</th><th class="col-text">Type</th><th class="col-text">What</th></tr></thead>
      <tbody>${alAnnounceRowsHtml(shown)}</tbody></table></div>` };
}

// ---- customize dialog ---------------------------------------------------------
function homeRenderCfg() {
  const l = homeLayout();
  const sub = {
    hot: () => {
      const profs = (homeState.dash && homeState.dash.hotbar && homeState.dash.hotbar.profs) || [];
      if (!profs.length) return '<div class="settings-sub">Professions appear here once Hot Resources has loaded.</div>';
      return `<div class="hm-cfg-opts">${profs.filter((p) => p.key !== '__all').map((p) => `<label class="hm-cfg-opt"><input type="checkbox" data-hmhot="${escapeHtml(p.key)}"${l.hotHidden.has(String(p.key)) ? '' : ' checked'}>
          <span class="hm-chip-dot" style="--chip:${escapeHtml(p.color || '#777')}; background: var(--chip)"></span><span class="hm-cfg-optname">${escapeHtml(p.label)}</span></label>`).join('')}</div>`;
    },
    glance: () => `<div class="hm-cfg-opts">${HOME_GLANCE.map((t) => `<label class="hm-cfg-opt"><input type="checkbox" data-hmglance="${t.key}"${l.glanceHidden.has(t.key) ? '' : ' checked'}><span class="hm-cfg-optname">${t.name}</span></label>`).join('')}</div>
      <div class="hm-cfg-widgets">${l.widgets.map((w) => `<label class="hm-cfg-opt hm-cfg-widget"><input type="checkbox" data-hmglance="${escapeHtml(w.id)}"${l.glanceHidden.has(w.id) ? '' : ' checked'}>
          <i class="fa-solid ${HOME_WIDGETS[w.type].icon} hm-icon"></i> ${escapeHtml(homeWidgetLabel(w))}
          <button type="button" class="btn btn-icon hm-cfg-del" data-hmwdel="${escapeHtml(w.id)}" title="Remove this widget"><i class="fa-solid fa-xmark"></i></button></label>`).join('')}
        <button type="button" class="btn btn-sm btn-outline-secondary" id="home-widget-add"><i class="fa-solid fa-plus"></i> Add widget</button></div>`,
    spawns: () => `<label class="hm-cfg-inline">Show <select class="form-select filter-select hm-cfg-sel" data-hmn="spawnsN">${[6, 12, 24, 48].map((n) => `<option value="${n}"${l.spawnsN === n ? ' selected' : ''}>${n}</option>`).join('')}</select> newest spawns</label>`,
    announce: () => `<label class="hm-cfg-inline">Show the latest <select class="form-select filter-select hm-cfg-sel" data-hmn="annN">${[5, 10, 25, 50].map((n) => `<option value="${n}"${l.annN === n ? ' selected' : ''}>${n}</option>`).join('')}</select></label>`,
  };
  $('#home-cfg-list').innerHTML = l.order.map((k) => {
    const def = HOME_SECTIONS.find((s) => s.key === k);
    const off = l.hidden.has(k);
    return `<div class="hm-cfg-row${off ? ' off' : ''}" data-hmcfg="${k}">
      <div class="hm-cfg-main">
        <i class="fa-solid fa-grip-vertical hm-cfg-grip" title="Drag to reorder"></i>
        <label class="hm-cfg-check"><input type="checkbox" data-hmshow="${k}"${off ? '' : ' checked'}></label>
        <i class="fa-solid ${def.icon} hm-icon"></i>
        <div class="hm-cfg-text"><div class="hm-cfg-name">${def.name}</div><div class="settings-sub">${def.hint}</div></div>
      </div>
      ${off ? '' : `<div class="hm-cfg-sub">${sub[k]()}</div>`}
    </div>`;
  }).join('');
}

// ---- widget picker ----------------------------------------------------------------
// the picker: one tile per widget type (icon + what it shows), then a search
// for the specific guild / city / resource / schematic / class underneath
function homeOpenPicker() {
  homePickerSync();
  $('#home-widget-modal').hidden = false;
  if (HOME_WIDGETS[homeState.picker.type].search) $('#home-widget-search').focus();
}
function homePickerSync() {
  const type = homeState.picker.type;
  $('#home-widget-type').innerHTML = Object.entries(HOME_WIDGETS).map(([k, d]) => `<button type="button" class="hm-pick-type${k === type ? ' active' : ''}" data-hmwtype="${k}">
      <i class="fa-solid ${d.icon}"></i><span class="hm-pick-type-name">${escapeHtml(d.name)}</span><span class="hm-pick-type-hint">${escapeHtml(d.hint)}</span></button>`).join('');
  const def = HOME_WIDGETS[type];
  const needsSearch = !!def.search;
  const hasOptions = Array.isArray(def.options);
  $('#home-widget-step').hidden = !needsSearch && !hasOptions;
  $('#home-widget-search').hidden = !needsSearch;
  $('#home-widget-search').placeholder = def.search || '';
  $('#home-widget-search').value = '';
  $('#home-widget-addnow').hidden = needsSearch || hasOptions;
  homeState.picker.results = hasOptions ? def.options : [];
  $('#home-widget-results').innerHTML = hasOptions
    ? def.options.map((it, i) => `<div class="hm-pick" data-hmpick="${i}"><i class="fa-solid ${def.icon}"></i><span>${escapeHtml(it.label)}</span><i class="fa-solid fa-plus hm-pick-add"></i></div>`).join('')
    : needsSearch ? '<div class="settings-sub hm-pick-empty">Type at least two letters to search.</div>' : '';
}
let homePickerTimer = null;
async function homePickerSearch() {
  const type = homeState.picker.type;
  const q = $('#home-widget-search').value.trim();
  const box = $('#home-widget-results');
  if (q.length < 2) { box.innerHTML = ''; return; }
  box.innerHTML = '<div class="settings-sub">Searching…</div>';
  let items = [];
  try {
    if (type === 'guild') {
      const r = await apiFetch('GET', 'api/guilds.php', { params: { search: q } });
      items = ((r.ok && r.data && r.data.results) || []).slice(0, 12).map((g) => ({ label: `${g.name} [${g.abbrev}]`, params: { abbrev: g.abbrev, name: g.name } }));
    } else if (type === 'city') {
      const r = await apiFetch('GET', 'api/cities.php', { params: { search: q } });
      items = ((r.ok && r.data && r.data.results) || []).slice(0, 12).map((c) => ({ label: `${c.name} · ${c.planet}`, params: { name: c.name, planet: c.planet } }));
    } else if (type === 'resource') {
      const r = await apiFetch('GET', 'api/resources.php', { params: { search: q, status: 'all', perpage: 12, page: 1 } });
      items = ((r.ok && r.data && r.data.results) || []).map((x) => ({ label: `${x.name} · ${x.type_name || ''}`, params: { name: x.name } }));
    } else if (type === 'schematic') {
      const r = await apiFetch('GET', 'api/schematics.php', { params: { search: q, perpage: 12, page: 1 } });
      items = ((r.ok && r.data && r.data.results) || []).map((s) => ({ label: s.name, params: { id: safeInt(s.id), name: s.name } }));
    } else if (type === 'stockpile') {
      const rows = await homeStockpileRows();
      items = rows.filter((x) => String(x.name || '').toLowerCase().includes(q.toLowerCase()) || String(x.type_name || '').toLowerCase().includes(q.toLowerCase()))
        .slice(0, 12).map((x) => ({ label: `${x.name} · ${x.type_name || ''} · ${fmtNum(safeInt(x.stock))} units`, params: { stockpile_id: x.stockpile_id, name: x.name } }));
    } else if (type === 'class') {
      if (!homeState.profData) { const r = await apiFetch('GET', 'api/professions.php'); if (r.ok) homeState.profData = r.data || {}; }
      items = ((homeState.profData && homeState.profData.professions) || []).filter((p) => p.name.toLowerCase().includes(q.toLowerCase()))
        .map((p) => ({ label: p.name, params: { key: p.key, name: p.name } }));
    }
  } catch (_) { items = []; }
  if ($('#home-widget-search').value.trim() !== q) return; // typed on — a newer search owns the box
  homeState.picker.results = items;
  const ic = HOME_WIDGETS[type].icon;
  box.innerHTML = items.length
    ? items.map((it, i) => `<div class="hm-pick" data-hmpick="${i}"><i class="fa-solid ${ic}"></i><span>${escapeHtml(it.label)}</span><i class="fa-solid fa-plus hm-pick-add"></i></div>`).join('')
    : '<div class="settings-sub hm-pick-empty">No matches.</div>';
}
function homeAddWidget(type, params) {
  const l = homeLayout();
  const id = `w_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  l.widgets.push({ id, type, params: params || {} });
  l.hidden.delete('glance');         // a new widget on a hidden section would be invisible
  homeSaveLayout();
  $('#home-widget-modal').hidden = true;
  homeRenderCfg();
  renderHome();
  toast(`Added ${homeWidgetLabel({ type, params })} to At a Glance`);
}

function initHome() {
  $('#home-customize').addEventListener('click', () => { homeRenderCfg(); $('#home-cfg-modal').hidden = false; });
  $('#home-cfg-done').addEventListener('click', () => { $('#home-cfg-modal').hidden = true; });
  bindBackdropClose($('#home-cfg-modal'), () => { $('#home-cfg-modal').hidden = true; });
  // Reset wipes every choice, custom widgets included — confirm first (Dustin)
  $('#home-cfg-reset').addEventListener('click', async () => {
    const l = homeLayout();
    const n = l.widgets.length;
    const ok = await confirmDialog({
      title: 'Reset Home to the defaults?',
      message: `Every section comes back in the default order with everything inside it shown${n
        ? `, and your ${n} custom widget${n === 1 ? '' : 's'} ${n === 1 ? 'is' : 'are'} removed` : ''}. This can't be undone.`,
      confirmLabel: 'Reset',
    });
    if (!ok) return;
    homeState.layout = null;
    try { localStorage.removeItem('home_layout'); } catch (_) {}
    homeLayout(); homeRenderCfg(); loadHome(true);
  });
  $('#home-refresh').addEventListener('click', () => loadHome(true));

  const list = $('#home-cfg-list');
  // checkboxes + counts: apply immediately
  list.addEventListener('change', (e) => {
    const l = homeLayout();
    const show = e.target.closest('[data-hmshow]');
    if (show) {
      if (show.checked) l.hidden.delete(show.dataset.hmshow); else l.hidden.add(show.dataset.hmshow);
      homeSaveLayout(); homeRenderCfg();
      const k = show.dataset.hmshow;
      const needs = show.checked && ((k === 'spawns' && !homeState.spawns) || (k === 'announce' && homeState.ann == null)
        || ((k === 'hot' || k === 'glance') && !homeState.dash));
      if (needs) loadHome('quiet'); else renderHome();
      return;
    }
    const hot = e.target.closest('[data-hmhot]');
    if (hot) { if (hot.checked) l.hotHidden.delete(hot.dataset.hmhot); else l.hotHidden.add(hot.dataset.hmhot); homeSaveLayout(); renderHome(); return; }
    const gl = e.target.closest('[data-hmglance]');
    if (gl) { if (gl.checked) l.glanceHidden.delete(gl.dataset.hmglance); else l.glanceHidden.add(gl.dataset.hmglance); homeSaveLayout(); renderHome(); return; }
    const n = e.target.closest('[data-hmn]');
    if (n) {
      l[n.dataset.hmn] = Number(n.value);
      homeSaveLayout();
      if (n.dataset.hmn === 'spawnsN') loadHome('quiet'); else renderHome();
    }
  });
  list.addEventListener('click', (e) => {
    const del = e.target.closest('[data-hmwdel]');
    if (del) {
      e.preventDefault();
      const l = homeLayout();
      l.widgets = l.widgets.filter((w) => w.id !== del.dataset.hmwdel);
      l.glanceHidden.delete(del.dataset.hmwdel);
      homeSaveLayout(); homeRenderCfg(); renderHome();
      return;
    }
    if (e.target.closest('#home-widget-add')) homeOpenPicker();
  });

  // drag a row to reorder — the grip arms the drag so the inner controls stay usable
  let dragKey = null;
  const clearDrop = () => list.querySelectorAll('.drop-before, .drop-after').forEach((r) => r.classList.remove('drop-before', 'drop-after'));
  list.addEventListener('mousedown', (e) => { const row = e.target.closest('[data-hmcfg]'); if (row) row.draggable = !!e.target.closest('.hm-cfg-grip, .hm-cfg-main'); });
  list.addEventListener('dragstart', (e) => {
    const row = e.target.closest('[data-hmcfg]');
    if (!row) return;
    dragKey = row.dataset.hmcfg;
    row.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    try { e.dataTransfer.setData('text/plain', dragKey); } catch (_) {}
  });
  list.addEventListener('dragover', (e) => {
    const row = e.target.closest('[data-hmcfg]');
    if (!row || !dragKey || row.dataset.hmcfg === dragKey) return;
    e.preventDefault();
    const r = row.getBoundingClientRect();
    clearDrop();
    row.classList.add(e.clientY > r.top + r.height / 2 ? 'drop-after' : 'drop-before');
  });
  list.addEventListener('dragleave', (e) => { if (!list.contains(e.relatedTarget)) clearDrop(); });
  list.addEventListener('drop', (e) => {
    const row = e.target.closest('[data-hmcfg]');
    if (!row || !dragKey || row.dataset.hmcfg === dragKey) { clearDrop(); return; }
    e.preventDefault();
    const after = row.classList.contains('drop-after');
    const l = homeLayout();
    l.order = l.order.filter((k) => k !== dragKey);
    l.order.splice(l.order.indexOf(row.dataset.hmcfg) + (after ? 1 : 0), 0, dragKey);
    dragKey = null;
    homeSaveLayout(); homeRenderCfg(); renderHome();
  });
  list.addEventListener('dragend', () => { dragKey = null; clearDrop(); list.querySelectorAll('.dragging').forEach((r) => { r.classList.remove('dragging'); r.draggable = false; }); });

  // widget picker
  $('#home-widget-type').addEventListener('click', (e) => {
    const t = e.target.closest('[data-hmwtype]');
    if (!t) return;
    homeState.picker.type = t.dataset.hmwtype;
    homePickerSync();
    if (HOME_WIDGETS[homeState.picker.type].search) $('#home-widget-search').focus();
  });
  $('#home-widget-search').addEventListener('input', () => { clearTimeout(homePickerTimer); homePickerTimer = setTimeout(homePickerSearch, 250); });
  $('#home-widget-results').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-hmpick]');
    if (!pick) return;
    const it = homeState.picker.results[safeInt(pick.dataset.hmpick)];
    if (it) homeAddWidget(homeState.picker.type, it.params);
  });
  $('#home-widget-addnow').addEventListener('click', () => homeAddWidget(homeState.picker.type, {}));
  $('#home-widget-cancel').addEventListener('click', () => { $('#home-widget-modal').hidden = true; });
  bindBackdropClose($('#home-widget-modal'), () => { $('#home-widget-modal').hidden = true; });

  $('#home-sections').addEventListener('scroll', (e) => { if (e.target.classList && e.target.classList.contains('hm-carousel')) homeSyncCarousel(e.target); }, true);
  window.addEventListener('resize', homeSyncCarousels);

  wirePlanetEdit('#home-sections', () => homeState.spawns);
  // one delegated handler: section collapse, hot chips, name links, jump buttons, card pins
  $('#home-sections').addEventListener('click', async (e) => {
    if (e.target.closest('[data-planetedit]')) return; // handled above
    const chip = e.target.closest('[data-hmprof]');
    if (chip) {
      homeState.prof = chip.dataset.hmprof;
      try { localStorage.setItem('home_hotprof', homeState.prof); } catch (_) {}
      renderHome(); return;
    }
    const go = e.target.closest('[data-hmgo]');
    if (go) { showPage(go.dataset.hmgo); return; }
    const view = e.target.closest('[data-hmview]');
    if (view) { homeLayout().spawnsView = view.dataset.hmview; homeSaveLayout(); renderHome(); return; }
    const sview = e.target.closest('[data-hmsview]');
    if (sview) {
      const [k, v] = sview.dataset.hmsview.split(':');
      homeLayout()[k === 'hot' ? 'hotView' : 'glanceView'] = v;
      homeSaveLayout(); renderHome(); return;
    }
    const car = e.target.closest('[data-hmcar]');
    if (car) {
      const strip = car.parentElement.querySelector('.hm-carousel');
      if (strip) strip.scrollBy({ left: Number(car.dataset.hmcar) * Math.max(200, strip.clientWidth * 0.8), behavior: 'smooth' });
      return;
    }
    // the Resources rows' own cells: stockpile +, wishlist ♥, category links
    const addCell = e.target.closest('[data-add]');
    if (addCell) { handleAddCellClick(addCell, e); return; }
    const wishCell = e.target.closest('[data-wish]');
    if (wishCell) { handleWishCellClick(wishCell); return; }
    const typeLink = e.target.closest('[data-navcat]');
    if (typeLink) { showPage('resources'); applyCategoryFilter(typeLink.dataset.navcat, typeLink.textContent.trim()); return; }
    const node = e.target.closest('.res-tree-node[data-treecode]');   // tree view: fold / unfold a category
    if (node) {
      if (!resState.treeCollapsed) resState.treeCollapsed = new Set();
      const code = node.dataset.treecode;
      if (resState.treeCollapsed.has(code)) resState.treeCollapsed.delete(code); else resState.treeCollapsed.add(code);
      renderResTree($('#home-spawn-tree'), homeState.spawns || [], { force: true });
      return;
    }
    const schem = e.target.closest('[data-hmschem]');
    if (schem) { openSchematicPage(safeInt(schem.dataset.hmschem), schem.dataset.hmschemname); return; }
    const guild = e.target.closest('[data-hmguild]');
    if (guild) { openGxDetail('guild', { abbrev: guild.dataset.hmguild, name: guild.dataset.hmgname }); return; }
    const city = e.target.closest('[data-hmcity]');
    if (city) { openGxDetail('city', { name: city.dataset.hmcity, planet: city.dataset.hmplanet }); return; }
    const pin = e.target.closest('[data-pin]');
    if (pin) {
      try {
        const res = await api().toggle_pin_resource(pin.dataset.pin);
        if (res.ok) { resState.pinned = new Set((res.data || []).map(String)); renderHome(); }
      } catch (_) { /* ignore */ }
      return;
    }
    const name = e.target.closest('[data-resname], [data-res]');
    if (name) { openResourcePage(name.dataset.resname || name.dataset.res); return; }
    const head = e.target.closest('[data-hmtoggle]');
    if (head) {
      const col = homeCollapsed();
      const k = head.dataset.hmtoggle;
      if (col.has(k)) col.delete(k); else col.add(k);
      try { localStorage.setItem('home_collapsed', JSON.stringify([...col])); } catch (_) {}
      renderHome();
    }
  });
}
