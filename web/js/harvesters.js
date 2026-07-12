/* Harvesters page — track placed harvesters per character with live countdowns
   (hopper fill, power, maintenance), modeled on a community prototype. All data
   rides the API gateway (api/harvesters.php + api/characters.php) — bundle-only.

   The math is client-side: remaining = amount - rate × hours since set. The hopper
   fills at extraction_rate until it's full OR power runs out. Mail-driven events
   (maintenance empty / structure damaged) attach server-side in a later phase. */

// Per-type defaults — maintenance/power confirmed IN GAME on Restoration
// (2026-07): personal 12cr/26p · medium 24cr/50p · heavy 36cr/75p ·
// elite 126cr/206p per hour; generators (no power draw) solar 15cr,
// fusion 24cr, geothermal 24cr, wind 30cr. Hopper size is a CRAFTED attribute (varies per
// deed), so it stays user-entered — elite base ~240k, ~400k experimented.
// ber = the type's MAX (fully-experimented craft; swgr.org wiki confirms
// heavy 14 / elite 44 / geo 15 / fusion 19, rest from the NGE templates) —
// prefilled AND enforced as a ceiling, since no deed can exceed it
// hopper: typical crafted size, prefilled but editable (deeds vary) —
// medium 50k / heavy 100k / elite 400k in-game confirmed; personal estimated
const HARV_TIERS = {
  personal: { ber: 5, maint: 12, power: 26, hopper: 25000 },
  medium:   { ber: 11, maint: 24, power: 50, hopper: 50000 },
  heavy:    { ber: 14, maint: 36, power: 75, hopper: 100000 },
  elite:    { ber: 44, maint: 126, power: 206, hopper: 400000 },
};
const HARV_TYPE_DEFAULTS = {
  'Personal Mineral Extractor': HARV_TIERS.personal,
  'Mineral Mining Installation': HARV_TIERS.medium,
  'Heavy Mineral Mining Installation': HARV_TIERS.heavy,
  'Elite Mineral Mining Installation': HARV_TIERS.elite,
  'Personal Chemical Extractor': HARV_TIERS.personal,
  'Chemical Extractor': HARV_TIERS.medium,
  'Deep Crust Chemical Extractor': HARV_TIERS.heavy,
  'Elite Chemical Extractor': HARV_TIERS.elite,
  'Personal Gas Extractor': HARV_TIERS.personal,
  'Natural Gas Processor': HARV_TIERS.medium,
  'Heavy Natural Gas Processor': HARV_TIERS.heavy,
  'Elite Natural Gas Processor': HARV_TIERS.elite,
  'Micro Flora Farm': HARV_TIERS.personal,
  'Automated Flora Farm': HARV_TIERS.medium,
  'High Capacity Flora Farm': HARV_TIERS.heavy,
  'Elite Flora Farm': HARV_TIERS.elite,
  'Personal Moisture Vaporator': HARV_TIERS.personal,
  'Moisture Vaporator': HARV_TIERS.medium,
  'High Efficiency Moisture Vaporator': HARV_TIERS.heavy,
  'Elite Moisture Vaporator': HARV_TIERS.elite,
  // generators bank ENERGY in a hopper too (dsrc: wind 25–50k, solar/geo
  // 50–75k, fusion 100–150k) and pull surveyed energy resources by conc
  'Wind Power Generator': { ber: 10, maint: 30, power: 0, hopper: 30000 },
  'Solar Power Generator': { ber: 15, maint: 15, power: 0, hopper: 55000 },
  'Fusion Power Generator': { ber: 19, maint: 24, power: 0, hopper: 110000 },
  'Geothermal Power Generator': { ber: 15, maint: 24, power: 0, hopper: 55000 },
};
const HARV_TYPES = Object.keys(HARV_TYPE_DEFAULTS);

// dropdown grouping for the add/edit form — families, personal → elite
const HARV_TYPE_GROUPS = {
  Mineral: ['Personal Mineral Extractor', 'Mineral Mining Installation', 'Heavy Mineral Mining Installation', 'Elite Mineral Mining Installation'],
  Chemical: ['Personal Chemical Extractor', 'Chemical Extractor', 'Deep Crust Chemical Extractor', 'Elite Chemical Extractor'],
  Gas: ['Personal Gas Extractor', 'Natural Gas Processor', 'Heavy Natural Gas Processor', 'Elite Natural Gas Processor'],
  Flora: ['Micro Flora Farm', 'Automated Flora Farm', 'High Capacity Flora Farm', 'Elite Flora Farm'],
  Water: ['Personal Moisture Vaporator', 'Moisture Vaporator', 'High Efficiency Moisture Vaporator', 'Elite Moisture Vaporator'],
  'Power Generators': ['Wind Power Generator', 'Solar Power Generator', 'Fusion Power Generator', 'Geothermal Power Generator'],
};

const harvIsGenerator = (type) => String(type || '').includes('Generator');

// resource class (level-2 ancestor) → the only harvester family that pulls it
// (renewable energy → generators; creature/space stay unharvestable)
const HARV_FAMILY_BY_CLASS = { min: 'Mineral', chm: 'Chemical', gas: 'Gas', wtr: 'Water', frs: 'Flora', regy: 'Power Generators' };

// class ancestry from the site's resource tree, cached once per session
async function harvLoadTree() {
  if (harvState.treeByCode) return;
  try {
    const res = await apiFetch('GET', 'api/categories.php');
    const flat = (res.ok && res.data && res.data.resource_tree_flat) || [];
    const map = {};
    for (const t of flat) map[t.code] = t;
    if (flat.length) harvState.treeByCode = map;
  } catch (_) { /* narrowing just doesn't happen offline */ }
}

// which harvester family mines this resource class — null = unknown/tree not
// loaded, '' = nothing ground-based pulls it (creature drops, space, energy)
function harvFamilyFor(typeCode) {
  const node = harvState.treeByCode && harvState.treeByCode[String(typeCode || '')];
  if (!node) return null;
  return HARV_FAMILY_BY_CLASS[node.level2] || '';
}

// "Heavy Natural Gas Processor" → "Heavy Gas"; generators keep their name short
function harvShortType(type) {
  if (!type) return '';
  if (harvIsGenerator(type)) return type.replace(' Power Generator', ' Generator');
  const fam = Object.entries(HARV_TYPE_GROUPS).find(([, list]) => list.includes(type));
  const tier = /Elite/.test(type) ? 'Elite'
    : /Heavy|Deep Crust|High Capacity|High Efficiency/.test(type) ? 'Heavy'
      : /Personal|Micro/.test(type) ? 'Personal' : 'Medium';
  return fam ? `${tier} ${fam[0]}` : type;
}

// the smart nickname: what you're pulling, how rich, with what —
// "Durichewigmiic 74% · Elite Gas". Used when the field is left blank.
function harvNickText() {
  const type = $('#harv-f-type').value;
  return [
    $('#harv-f-resource').value.trim(),
    $('#harv-f-conc').value.trim() ? `${$('#harv-f-conc').value.trim()}%` : '',
    harvShortType(type),
  ].filter(Boolean).join(' · ');
}

// rebuild the Type dropdown — narrowed to one family when a resource decided it
function harvSetTypeOptions(family) {
  const groups = family && HARV_TYPE_GROUPS[family]
    ? { [family]: HARV_TYPE_GROUPS[family] }
    : HARV_TYPE_GROUPS;
  const cur = $('#harv-f-type').value;
  $('#harv-f-type').innerHTML = '<option value="">Select type…</option>'
    + Object.entries(groups).map(([g, list]) =>
      `<optgroup label="${g}">${list.map((t) => `<option value="${t}">${t}</option>`).join('')}</optgroup>`).join('');
  if (cur && [...$('#harv-f-type').options].some((o) => o.value === cur)) {
    $('#harv-f-type').value = cur; // still compatible — keep it
  }
}

// a picked resource decides the family: tubers never load into a gas processor
function harvApplyResourceFamily() {
  const code = $('#harv-f-resource').dataset.code || '';
  const family = code ? harvFamilyFor(code) : null;
  harvState.resFamilyWarn = family === '' ? $('#harv-f-resource').value.trim() : '';
  harvSetTypeOptions(family || null);
  harvSyncFormMode();
}

// the site's Extraction Calculator formula: units/min = 1.5 × BER × concentration%
const harvRate = (ber, conc) => (Number(ber) && Number(conc))
  ? 1.5 * Number(ber) * (Math.min(100, Number(conc)) / 100) * 60
  : null;

const harvState = {
  items: [], chars: [], charFilter: '',
  query: '',             // header search — nickname/type/resource/planet/character
  view: 'cards',         // 'cards' | 'grid' — sticky via config (harv_view)
  suggestions: [],       // detected placements from Construction Complete mails
  dismissed: new Set(),  // mail_ids the user waved off (persisted in config)
  expanded: new Set(),   // harvester ids with the event log open
  events: {},            // id -> events array (fetched on expand)
  timer: null,           // re-render tick so countdowns move
};

// the header toggle: icon shows the view you'd SWITCH TO
function harvPaintViewToggle() {
  const btn = $('#harv-viewtoggle');
  const grid = harvState.view === 'grid';
  btn.innerHTML = `<i class="fa-solid ${grid ? 'fa-grip-vertical' : 'fa-table-cells-large'}"></i>`;
  btn.title = grid ? 'Switch to card view' : 'Switch to grid view';
}

// ---- countdown math ----

const harvNow = () => Math.floor(Date.now() / 1000);

// {remaining, depletesAt} for a drain pool (power units or maintenance credits)
function harvDrain(amount, rate, setAt) {
  amount = Number(amount); rate = Number(rate); setAt = Number(setAt);
  if (!amount || !setAt) return null;
  if (!rate) return { remaining: amount, depletesAt: null }; // no rate = no countdown
  const rem = amount - (rate * (harvNow() - setAt)) / 3600;
  return { remaining: Math.max(0, rem), depletesAt: setAt + (amount / rate) * 3600 };
}

// hopper fill: extraction runs from hopper_emptied_at until now, power death, or full
function harvHopper(h) {
  const rate = Number(h.extraction_rate), size = Number(h.hopper_size), since = Number(h.hopper_emptied_at);
  if (!rate || !size || !since) return null;
  const power = harvDrain(h.power_amount, h.power_rate, h.power_set_at);
  const now = harvNow();
  let until = now;
  if (power && power.depletesAt) until = Math.min(until, power.depletesAt);
  const units = Math.min(size, Math.max(0, (rate * (until - since)) / 3600));
  const fullAt = since + (size / rate) * 3600;
  return {
    units, size, pct: (units / size) * 100,
    // fullAt only when it will actually get there before power dies
    fullAt: (power && power.depletesAt && power.depletesAt < fullAt) ? null : fullAt,
    stalled: !!(power && power.depletesAt && power.depletesAt <= now), // fill has STOPPED
  };
}

function harvAgo(secs) {
  if (secs <= 0) return 'now';
  const d = Math.floor(secs / 86400), h = Math.floor((secs % 86400) / 3600), m = Math.floor((secs % 3600) / 60);
  if (d) return `${d}d ${h}h`;
  if (h) return `${h}h ${m}m`;
  return `${m}m`;
}

// ---- rendering ----

function harvMeter(label, pct, text, cls) {
  return `<div class="harv-meter-row">
    <span class="harv-meter-label">${label}</span>
    <div class="harv-meter"><span class="harv-meter-fill ${cls}" style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></span></div>
    <span class="harv-meter-text ${cls}">${text}</span>
  </div>`;
}

function harvCardHtml(h) {
  const power = harvDrain(h.power_amount, h.power_rate, h.power_set_at);
  const maint = harvDrain(h.maint_amount, h.maint_rate, h.maint_set_at);
  const hopper = harvHopper(h);
  const now = harvNow();

  const meters = [];
  if (hopper) {
    const full = hopper.pct >= 99.9;
    // green + shimmer while it fills; red "stalled" once dead power stops it.
    // Current units render as a live full number a 1s ticker counts upward.
    meters.push(harvMeter('Hopper', hopper.pct,
      full ? 'FULL'
        : `<span class="harv-units" data-uhid="${h.id}">${fmtNum(Math.floor(hopper.units))}</span> / ${fmtShort(hopper.size)}${hopper.stalled ? ' · stalled — no power'
          : hopper.fullAt ? ` · full in ${harvAgo(hopper.fullAt - now)}` : ''}`,
      full ? 'warn' : hopper.stalled ? 'bad' : 'filling'));
  }
  if (power) {
    const out = power.remaining <= 0;
    const low = !out && power.depletesAt && power.depletesAt - now < 86400;
    meters.push(harvMeter('Power', h.power_amount ? (power.remaining / Number(h.power_amount)) * 100 : 0,
      out ? 'OUT OF POWER' : `${fmtShort(power.remaining)}${power.depletesAt ? ` · ${harvAgo(power.depletesAt - now)} left` : ''}`,
      out ? 'bad' : low ? 'warn' : 'ok'));
  }
  if (maint) {
    const out = maint.remaining <= 0;
    const low = !out && maint.depletesAt && maint.depletesAt - now < 86400;
    meters.push(harvMeter('Maint', h.maint_amount ? (maint.remaining / Number(h.maint_amount)) * 100 : 0,
      out ? 'EMPTY' : `${fmtShort(maint.remaining)} cr · ${maint.depletesAt ? harvAgo(maint.depletesAt - now) + ' left' : ''}`,
      out ? 'bad' : low ? 'warn' : 'ok'));
  }

  const alert = (power && power.remaining <= 0) || (maint && maint.remaining <= 0)
    ? '<span class="harv-flag bad">needs attention</span>'
    : (hopper && hopper.pct >= 99.9 ? '<span class="harv-flag warn">hopper full</span>' : '');

  const loc = [h.planet, (h.x != null && h.y != null) ? `(${h.x}, ${h.y})` : ''].filter(Boolean).join(' ');
  const open = harvState.expanded.has(String(h.id));

  return `<div class="harv-card" data-hid="${h.id}">
    <div class="harv-hd">
      <div class="harv-title">
        <span class="harv-name">${escapeHtml(h.name || h.harvester_type)}</span>
        ${h.character_name ? `<span class="harv-char"><i class="fa-solid fa-user"></i> ${escapeHtml(h.character_name)}</span>` : ''}
        ${alert}
      </div>
      <div class="harv-sub" title="${escapeHtml([h.harvester_type, h.ber ? `BER ${h.ber}` : '', h.resource_name ? `${h.resource_name}${h.concentration ? ` @ ${h.concentration}%` : ''}` : '', loc].filter(Boolean).join(' · '))}">
        ${escapeHtml(h.harvester_type)}${h.ber ? ` · BER ${h.ber}` : ''}${h.resource_name ? ` · <b class="harv-reslink" data-res="${escapeHtml(h.resource_name)}">${escapeHtml(h.resource_name)}</b>` : ''}${h.concentration ? ` @ ${h.concentration}%` : ''}${loc ? ` · ${escapeHtml(loc)}` : ''}
      </div>
    </div>
    <div class="harv-meters">${meters.join('') || '<span class="stat_off">No rates set — edit to enable countdowns.</span>'}</div>
    <div class="harv-actions">
      <button class="btn btn-sm btn-outline-secondary" data-hact="hopper" data-hid="${h.id}" title="Empty the hopper — fill restarts from zero"><i class="fa-solid fa-box-open"></i> Empty</button>
      <button class="btn btn-sm btn-outline-secondary" data-hact="sethopper" data-hid="${h.id}" title="Set what's in the hopper right now"><i class="fa-solid fa-sliders"></i> Hopper</button>
      <button class="btn btn-sm btn-outline-secondary" data-hact="power" data-hid="${h.id}" title="Set the power currently loaded"><i class="fa-solid fa-bolt"></i> Power</button>
      <button class="btn btn-sm btn-outline-secondary" data-hact="maint" data-hid="${h.id}" title="Set the maintenance currently paid"><i class="fa-solid fa-coins"></i> Maint</button>
      <span class="harv-actions-right">
        <button class="btn btn-icon al-rule-btn" data-hact="log" data-hid="${h.id}" title="Event log"><i class="fa-solid fa-list"></i></button>
        <button class="btn btn-icon al-rule-btn" data-hact="clone" data-hid="${h.id}" title="Duplicate — same type/resource/spot, for multi-harvester farms"><i class="fa-solid fa-clone"></i></button>
        <button class="btn btn-icon al-rule-btn" data-hact="edit" data-hid="${h.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-icon al-rule-btn" data-hact="del" data-hid="${h.id}" title="Remove (reclaimed/destroyed)"><i class="fa-solid fa-trash-can"></i></button>
      </span>
    </div>
    <div class="harv-log" ${open ? '' : 'hidden'}>${open ? harvLogHtml(h.id) : ''}</div>
  </div>`;
}

function harvLogHtml(hid) {
  const evs = harvState.events[String(hid)];
  if (!evs) return '<span class="stat_off">Loading…</span>';
  if (!evs.length) return '<span class="stat_off">No events yet.</span>';
  const icon = { placed: 'fa-plus', power: 'fa-bolt', maintenance: 'fa-coins', hopper: 'fa-box-open', note: 'fa-pen' };
  return evs.map((e) => `<div class="harv-ev">
    <i class="fa-solid ${icon[e.kind] || 'fa-circle-info'}"></i>
    <span>${escapeHtml(e.detail || e.kind)}</span>
    <span class="harv-ev-when">${fmtAgoTip(e.created_at)}</span>
  </div>`).join('');
}

// one grid row = the card's numbers flattened; the same data-hact icons work
// because the dispatcher listens on #harv-list either way
function harvGridHtml(items) {
  const now = harvNow();
  const rows = items.map((h) => {
    const power = harvDrain(h.power_amount, h.power_rate, h.power_set_at);
    const maint = harvDrain(h.maint_amount, h.maint_rate, h.maint_set_at);
    const hopper = harvHopper(h);
    const hopFull = hopper && hopper.pct >= 99.9;
    const hopCls = hopper ? (hopFull ? 'warn' : hopper.stalled ? 'bad' : '') : '';
    const powOut = power && power.remaining <= 0;
    const mntOut = maint && maint.remaining <= 0;
    return `<tr>
      <td class="col-name" title="${escapeHtml(h.harvester_type)}${h.ber ? ` · BER ${h.ber}` : ''}">${escapeHtml(h.name || h.harvester_type)}</td>
      <td class="col-text">${h.character_name ? escapeHtml(h.character_name) : '<span class="stat_off">—</span>'}</td>
      <td class="col-text">${h.resource_name ? `<b class="harv-reslink" data-res="${escapeHtml(h.resource_name)}">${escapeHtml(h.resource_name)}</b>${h.concentration ? ` @ ${h.concentration}%` : ''}` : '<span class="stat_off">—</span>'}</td>
      <td class="col-text harv-cell ${hopCls}">${hopper
        ? `<span class="harv-minibar"><span class="harv-meter-fill ${hopFull ? 'warn' : hopper.stalled ? 'bad' : 'filling'}" style="width:${Math.max(0, Math.min(100, hopper.pct)).toFixed(1)}%"></span></span>`
          + `<span class="harv-minibar-text">${hopFull ? 'FULL' : `<span class="harv-units" data-uhid="${h.id}">${fmtNum(Math.floor(hopper.units))}</span> / ${fmtShort(hopper.size)}${hopper.stalled ? ' · stalled' : ''}`}</span>`
        : '—'}</td>
      <td class="col-text harv-cell ${powOut ? 'bad' : ''}">${power ? (powOut ? 'OUT' : `${fmtShort(power.remaining)}${power.depletesAt ? ` · ${harvAgo(power.depletesAt - now)}` : ''}`) : '—'}</td>
      <td class="col-text harv-cell ${mntOut ? 'bad' : ''}">${maint ? (mntOut ? 'EMPTY' : `${fmtShort(maint.remaining)} cr${maint.depletesAt ? ` · ${harvAgo(maint.depletesAt - now)}` : ''}`) : '—'}</td>
      <td class="col-actions">
        <button class="btn btn-icon" data-hact="hopper" data-hid="${h.id}" title="Empty the hopper"><i class="fa-solid fa-box-open"></i></button>
        <button class="btn btn-icon" data-hact="sethopper" data-hid="${h.id}" title="Set hopper amount"><i class="fa-solid fa-sliders"></i></button>
        <button class="btn btn-icon" data-hact="power" data-hid="${h.id}" title="Set power"><i class="fa-solid fa-bolt"></i></button>
        <button class="btn btn-icon" data-hact="maint" data-hid="${h.id}" title="Set maintenance"><i class="fa-solid fa-coins"></i></button>
        <button class="btn btn-icon" data-hact="clone" data-hid="${h.id}" title="Duplicate"><i class="fa-solid fa-clone"></i></button>
        <button class="btn btn-icon" data-hact="edit" data-hid="${h.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-icon" data-hact="del" data-hid="${h.id}" title="Remove"><i class="fa-solid fa-trash-can"></i></button>
      </td>
    </tr>`;
  }).join('');
  return `<div class="table-wrap"><table class="data-grid"><thead><tr>
      <th class="col-name">Name</th><th class="col-text">Character</th><th class="col-text">Resource</th>
      <th class="col-text">Hopper</th><th class="col-text">Power</th><th class="col-text">Maint</th><th class="col-actions"></th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

// what's currently IN VIEW (character filter + search applied) — the bulk
// actions operate on exactly this set
function harvFilteredItems() {
  let items = harvState.items;
  if (harvState.charFilter) items = items.filter((h) => String(h.character_id) === harvState.charFilter);
  const q = (harvState.query || '').toLowerCase();
  if (q) {
    items = items.filter((h) => [h.name, h.harvester_type, h.resource_name, h.planet, h.character_name]
      .some((v) => String(v || '').toLowerCase().includes(q)));
  }
  return items;
}

function renderHarvesters() {
  const wrap = $('#harv-list');
  const items = harvFilteredItems();

  $('#harv-empty').hidden = items.length > 0;
  wrap.classList.toggle('harv-list-grid', harvState.view === 'grid');
  wrap.innerHTML = harvState.view === 'grid' ? harvGridHtml(items) : items.map(harvCardHtml).join('');

  // a card left expanded across a reload must fetch its events, not sit on
  // "Loading…" forever (loadHarvesters wipes the cache after every action)
  if (!harvState.evFetching) harvState.evFetching = new Set();
  for (const hid of harvState.expanded) {
    if (harvState.events[String(hid)] || harvState.evFetching.has(String(hid))) continue;
    harvState.evFetching.add(String(hid));
    apiFetch('GET', 'api/harvesters.php', { params: { action: 'events', id: hid } })
      .then((res) => {
        harvState.events[String(hid)] = (res.ok && res.data && res.data.events) || [];
        harvState.evFetching.delete(String(hid));
        renderHarvesters();
      })
      .catch(() => harvState.evFetching.delete(String(hid)));
  }

  // character filter dropdown (keep selection)
  const opts = ['<option value="">All characters</option>']
    .concat(harvState.chars.map((c) => `<option value="${c.id}"${harvState.charFilter === String(c.id) ? ' selected' : ''}>${escapeHtml(c.name)}</option>`));
  $('#harv-charfilter').innerHTML = opts.join('');
}

// "Construction of your NAME is now complete" -> NAME when it's a harvester type
function harvParsePlacement(raw) {
  const m = /Construction of your (.+?) is now complete/.exec(raw || '');
  if (!m) return null;
  const name = m[1].trim();
  const known = Object.keys(HARV_TYPE_DEFAULTS)
    .find((t) => t.toLowerCase() === name.toLowerCase() || name.toLowerCase().includes(t.toLowerCase()));
  return known || null;
}

// scan the last week of Construction Complete mails for harvester placements the
// user hasn't added or dismissed — each becomes an "Add?" suggestion banner
async function harvLoadSuggestions() {
  harvState.suggestions = [];
  try {
    const res = await api().mail_history(30, 0, '', 'Construction Complete');
    const rows = (res.ok && res.data && res.data.rows) || [];
    const cutoff = harvNow() - 7 * 86400;
    const fresh = rows.filter((r) => r.subject === 'Construction Complete' && r.has_raw
      && (r.sent_at || r.uploaded_at) > cutoff && !harvState.dismissed.has(r.mail_id));
    for (const r of fresh.slice(0, 10)) {
      const raw = await api().mail_raw(r.mail_id);
      const type = harvParsePlacement(raw.ok && raw.data);
      if (type) harvState.suggestions.push({ mail_id: r.mail_id, type, at: r.sent_at || r.uploaded_at, character: r.character || '' });
    }
  } catch (_) { /* banner just stays empty */ }
  renderHarvSuggestions();
}

function renderHarvSuggestions() {
  $('#harv-suggest').innerHTML = harvState.suggestions.map((s) => `
    <div class="harv-suggest-row" data-mailid="${escapeHtml(s.mail_id)}">
      <i class="fa-solid fa-wand-magic-sparkles"></i>
      <span>Detected: <b>${escapeHtml(s.type)}</b> placed ${fmtAgoTip(s.at)}${s.character ? ` on <b>${escapeHtml(s.character)}</b>` : ''} — add it?</span>
      <span class="harv-suggest-actions">
        <button class="btn btn-sm btn-accent" data-sugadd="${escapeHtml(s.mail_id)}"><i class="fa-solid fa-plus"></i> Add</button>
        <button class="btn btn-sm btn-outline-secondary" data-sugdismiss="${escapeHtml(s.mail_id)}">Dismiss</button>
      </span>
    </div>`).join('');
}

async function loadHarvesters() {
  showGridLoading('#harv-loading');
  $('#harv-empty').hidden = true;
  let hv, ch;
  try {
    [hv, ch] = await Promise.all([
      apiFetch('GET', 'api/harvesters.php'),
      apiFetch('GET', 'api/characters.php'),
    ]);
  } catch (e) { hv = { ok: false, error: String(e) }; }
  $('#harv-loading').hidden = true;
  if (!hv.ok || !hv.data) {
    $('#harv-list').innerHTML = '';
    const el = $('#harv-empty');
    el.textContent = `Error: ${(hv && hv.error) || 'failed to load'}`;
    el.hidden = false;
    checkAuthError(hv && hv.error);
    return;
  }
  harvState.items = hv.data.harvesters || [];
  harvState.chars = (ch && ch.ok && ch.data && ch.data.characters) || [];
  renderHarvesters();
  try {
    const cfg = await api().get_config();
    harvState.dismissed = new Set((cfg.ok && cfg.data && cfg.data.harv_dismissed_mails) || []);
    if (cfg.ok && cfg.data && (cfg.data.harv_view === 'grid' || cfg.data.harv_view === 'cards')) {
      harvState.view = cfg.data.harv_view;
      harvPaintViewToggle();
      renderHarvesters();
    }
  } catch (_) { /* keep empty */ }
  harvLoadSuggestions(); // fire-and-forget
  harvLoadTree(); // class tree for the resource finder's harvestability filter

  clearInterval(harvState.timer); // countdowns tick — client-side math, no network
  harvState.timer = setInterval(() => {
    if (document.getElementById('page-harvesters').classList.contains('active')) renderHarvesters();
  }, 15000);

  // the fun part: hopper unit counters tick UP every second, in place — no
  // re-render, just the numbers (an elite pulls ~0.8 units/sec, so they move)
  clearInterval(harvState.unitsTimer);
  harvState.unitsTimer = setInterval(() => {
    if (!document.getElementById('page-harvesters').classList.contains('active')) return;
    document.querySelectorAll('.harv-units').forEach((el) => {
      const h = harvState.items.find((x) => String(x.id) === el.dataset.uhid);
      if (!h) return;
      const hop = harvHopper(h);
      if (hop) {
        const v = fmtNum(Math.floor(hop.units));
        if (el.textContent !== v) el.textContent = v;
      }
    });
  }, 1000);
}

// ---- actions ----

async function harvExpandLog(hid) {
  hid = String(hid);
  if (harvState.expanded.has(hid)) { harvState.expanded.delete(hid); renderHarvesters(); return; }
  harvState.expanded.add(hid);
  renderHarvesters();
  const res = await apiFetch('GET', 'api/harvesters.php', { params: { action: 'events', id: hid } });
  harvState.events[hid] = (res.ok && res.data && res.data.events) || [];
  renderHarvesters();
}

// compact refill dialog: shows the math's current estimate, then take your pick —
// drag the slider, smash a +pill onto the estimate, or type the exact total
function harvSetPool(h, which) {
  const power = which === 'power';
  const isHopper = which === 'hopper';
  const hop = isHopper ? harvHopper(h) : null;
  const drain = isHopper ? null : harvDrain(power ? h.power_amount : h.maint_amount,
    power ? h.power_rate : h.maint_rate,
    power ? h.power_set_at : h.maint_set_at);
  const current = isHopper
    ? (hop ? Math.max(0, Math.round(hop.units)) : 0)
    : (drain ? Math.max(0, Math.round(drain.remaining)) : 0);
  const loaded = isHopper ? (Number(h.hopper_size) || 0) : (Number(power ? h.power_amount : h.maint_amount) || 0);
  const rate = isHopper ? (Number(h.extraction_rate) || 0) : (Number(power ? h.power_rate : h.maint_rate) || 0);
  const unit = power || isHopper ? '' : ' cr';

  if (isHopper && (!rate || !loaded)) {
    toast('Set the resource/BER and hopper size first — the hopper math needs them', false);
    return;
  }

  $('#harv-pool-title').textContent = `${isHopper ? 'Hopper' : power ? 'Power' : 'Maintenance'} — ${h.name || h.harvester_type}`;
  $('#harv-pool-now').innerHTML = isHopper
    ? `right now ≈ <b>${fmtShort(current)}</b> of ${fmtShort(loaded)} · filling at ${fmtNum(Math.floor(rate))}/hr`
    : loaded
      ? `right now ≈ <b>${fmtShort(current)}${unit}</b> left of ${fmtShort(loaded)} loaded${rate ? ` · burning ${rate}/hr` : ''}`
      : `nothing tracked yet${rate ? ` · burns ${rate}/hr` : ''}`;

  const slider = $('#harv-pool-slider');
  const roof = isHopper
    ? loaded // the hopper physically caps at its size
    : Math.max(10000, Math.ceil(Math.max(current, loaded) * 2 / 5000) * 5000);
  slider.max = roof;
  slider.step = 500; // chunky on purpose — nobody refills in dribbles
  slider.value = current;
  const input = $('#harv-pool-input');
  input.value = '';
  input.placeholder = `exact — e.g. ${power ? '12k' : '13k'}`;

  const value = () => {
    const typed = input.value.trim();
    if (typed) { const v = Math.round(parseAmount(typed)); return Number.isNaN(v) ? null : v; }
    return Math.round(Number(slider.value));
  };
  // the track's filled portion, painted as a gradient (no native fill once
  // -webkit-appearance is off)
  const paintSlider = () => {
    const pct = Math.max(0, Math.min(100, (Number(slider.value) / Number(slider.max)) * 100));
    slider.style.background = `linear-gradient(90deg, var(--accent-dark) ${pct}%, var(--bg-primary) ${pct}%)`;
  };
  const paint = () => {
    paintSlider();
    let v = value();
    const el = $('#harv-pool-new');
    if (v == null || v < 0) { el.hidden = false; el.innerHTML = '<span class="harv-derived-warn">can\'t read that amount — try 12000 or 12k</span>'; return; }
    if (isHopper) v = Math.min(v, roof);
    el.hidden = false;
    if (isHopper) {
      const toFull = rate ? (roof - v) / rate : 0;
      el.innerHTML = `hopper at <b>${fmtNum(v)}</b> units${v >= roof ? ' · <b>FULL</b>' : toFull ? ` · full in ≈ <b>${harvAgo(toFull * 3600)}</b>` : ''}`;
    } else {
      const hrs = rate ? v / rate : 0;
      el.innerHTML = `new total <b>${fmtNum(v)}${unit}</b>${hrs ? ` · lasts ≈ <b>${harvAgo(hrs * 3600)}</b>` : ''}`;
    }
  };
  slider.oninput = () => { input.value = ''; paint(); };
  input.oninput = () => {
    const v = value();
    if (v != null && v >= 0) slider.value = Math.min(roof, v);
    paint();
  };
  document.querySelectorAll('[data-pooladd]').forEach((b) => {
    b.onclick = () => {
      let v = Math.max(0, (value() ?? current)) + safeInt(b.dataset.pooladd);
      if (isHopper) v = Math.min(v, roof); // can't overfill a hopper
      input.value = '';
      slider.value = Math.min(roof, v);
      if (v > roof) input.value = String(v); // power/maint pills can push past the slider roof
      paint();
    };
  });
  paint();

  const modal = $('#harv-pool-modal');
  modal.hidden = false;
  const close = () => { modal.hidden = true; cleanup(); };
  async function save() {
    let amount = value();
    if (amount == null || amount < 0) { toast('Couldn\'t read that amount — try 12000 or 12k', false); return; }
    const now = harvNow();
    let fields;
    if (isHopper) {
      // no "hopper units" column — a target amount back-computes into the
      // emptied-at timestamp the fill math already runs on
      amount = Math.min(amount, roof);
      fields = { id: h.id, hopper_emptied_at: now - Math.round((amount / rate) * 3600) };
    } else if (power) {
      fields = { id: h.id, power_amount: amount, power_set_at: now };
    } else {
      fields = { id: h.id, maint_amount: amount, maint_set_at: now };
    }
    const res = await apiFetch('PUT', 'api/harvesters.php', { data: fields });
    if (!res.ok) { toast(res.error || 'Update failed', false); return; }
    await apiFetch('POST', 'api/harvesters.php?action=event', { data: {
      harvester_id: h.id, kind: isHopper ? 'hopper' : power ? 'power' : 'maintenance',
      detail: isHopper ? `Set hopper to ~${fmtNum(amount)} units` : `Set ${power ? 'power' : 'maintenance'} to ${fmtNum(amount)}`,
      amount,
    } });
    close();
    harvState.events = {};
    loadHarvesters();
  }
  function onKey(e) { if (e.key === 'Escape') close(); if (e.key === 'Enter') save(); }
  function onBackdrop(e) { if (e.target === modal) close(); }
  function cleanup() {
    modal.removeEventListener('keydown', onKey);
    modal.removeEventListener('click', onBackdrop);
    $('#harv-pool-save').removeEventListener('click', save);
    $('#harv-pool-cancel').removeEventListener('click', close);
  }
  modal.addEventListener('keydown', onKey);
  modal.addEventListener('click', onBackdrop);
  $('#harv-pool-save').addEventListener('click', save);
  $('#harv-pool-cancel').addEventListener('click', close);
  input.focus();
}

async function harvEmptyHopper(h) {
  const hopper = harvHopper(h);
  const res = await apiFetch('PUT', 'api/harvesters.php', { data: { id: h.id, hopper_emptied_at: harvNow() } });
  if (!res.ok) { toast(res.error || 'Update failed', false); return; }
  await apiFetch('POST', 'api/harvesters.php?action=event', { data: {
    harvester_id: h.id, kind: 'hopper',
    detail: `Emptied hopper${hopper ? ` (~${fmtShort(hopper.units)} units)` : ''}`,
    amount: hopper ? Math.round(hopper.units) : null,
  } });
  harvState.events = {};
  loadHarvesters();
  if (hopper && hopper.units > 0 && h.resource_name) {
    await harvOfferStockpile(h.resource_name, hopper.units);
  }
}

// resource name → site id (exact match) for the stockpile hand-off
async function harvResourceId(name) {
  try {
    const res = await api().search_resources({ search: name, page: 1 });
    const rows = (res.ok && res.data && res.data.results) || [];
    const hit = rows.find((r) => String(r.name).toLowerCase() === String(name).toLowerCase());
    return hit ? hit.id : null;
  } catch (_) { return null; }
}

// "you just pulled ~N units of X — stockpile them?" — create-or-increment
async function harvOfferStockpile(name, units) {
  if (!name || !(units > 0)) return;
  const raw = await charDialog({
    title: 'Add to My Stockpile?',
    label: `${name} units`,
    hint: `Emptied ≈ <b>${fmtNum(Math.floor(units))}</b> units of <b>${escapeHtml(name)}</b> — save them to your stockpile, or cancel to skip.`,
    value: String(Math.floor(units)),
    confirm: 'Add to Stockpile',
    icon: 'fa-cubes',
  });
  if (raw === null) return;
  const add = Math.round(parseAmount(raw));
  if (Number.isNaN(add) || add <= 0) return;
  try {
    if (typeof stkState !== 'undefined' && !stkState.items.length) {
      try { await syncStockpile(); } catch (_) { /* lookup below still tries */ }
    }
    let item = stkState.items.find((i) => String(i.name).toLowerCase() === name.toLowerCase());
    if (!item) {
      const rid = await harvResourceId(name);
      if (!rid) { toast(`Couldn't find ${name} on the site — add it to your stockpile manually`, false); return; }
      const res = await api().add_to_stockpile(rid);
      if (!res.ok) { toast(res.error || 'Stockpile add failed', false); return; }
      await syncStockpile();
      item = stkState.items.find((i) => String(i.id) === String(rid));
    }
    if (!item) { toast('Stockpile row not found after adding — check My Stockpile', false); return; }
    const newStock = (Number(item.stock) || 0) + add;
    const res = await api().update_stockpile(item.stockpile_id, newStock);
    if (res.ok) { toast(`${name}: stockpile → ${fmtNum(newStock)}`); syncStockpile(); }
    else toast(res.error || 'Stockpile update failed', false);
  } catch (e) { toast(String(e), false); }
}

// bulk rounds: Empty All marks every in-view hopper emptied; Pack All also
// redeeds (removes) them — either way the pulled units get offered per resource
async function harvBulk(packUp) {
  const items = harvFilteredItems();
  if (!items.length) { toast('No harvesters in view', false); return; }
  const totals = {};
  const now = harvNow();
  for (const h of items) {
    const hop = harvHopper(h);
    if (hop && hop.units > 0 && h.resource_name) {
      totals[h.resource_name] = (totals[h.resource_name] || 0) + hop.units;
    }
    if (packUp) {
      await apiFetch('DELETE', 'api/harvesters.php', { data: { id: h.id } });
    } else {
      await apiFetch('PUT', 'api/harvesters.php', { data: { id: h.id, hopper_emptied_at: now } });
      await apiFetch('POST', 'api/harvesters.php?action=event', { data: {
        harvester_id: h.id, kind: 'hopper',
        detail: `Emptied hopper${hop ? ` (~${fmtShort(hop.units)} units)` : ''}`,
        amount: hop ? Math.round(hop.units) : null,
      } });
    }
  }
  harvState.events = {};
  toast(packUp ? `Packed up ${items.length} harvester${items.length === 1 ? '' : 's'}`
    : `Emptied ${items.length} hopper${items.length === 1 ? '' : 's'}`);
  loadHarvesters();
  for (const [name, units] of Object.entries(totals)) {
    await harvOfferStockpile(name, units); // one ask per distinct resource
  }
}

// "Nickname #2", "#3", … — first free number among the current names
function harvCloneName(base) {
  const stem = String(base || '').replace(/\s*#\d+$/, '').trim() || 'Harvester';
  const names = new Set(harvState.items.map((x) => String(x.name || '').toLowerCase()));
  let n = 2;
  while (names.has(`${stem.toLowerCase()} #${n}`)) n += 1;
  return `${stem} #${n}`;
}

// four elites on one node = add one, clone three times. Copies everything about
// the SETUP (type/character/resource/deed/planet) and the current power/maint
// loads (farms get filled identically) — only the exact coordinates stay blank.
async function harvClone(h) {
  const now = harvNow();
  const power = harvDrain(h.power_amount, h.power_rate, h.power_set_at);
  const maint = harvDrain(h.maint_amount, h.maint_rate, h.maint_set_at);
  const fields = {
    harvester_type: h.harvester_type,
    name: harvCloneName(h.name || h.harvester_type),
    character_id: h.character_id || null,
    planet: h.planet || '',
    x: '',
    y: '',
    resource_name: h.resource_name || '',
    concentration: h.concentration ?? '',
    ber: h.ber ?? '',
    hopper_size: h.hopper_size ?? '',
    extraction_rate: h.extraction_rate ?? '',
    maint_rate: h.maint_rate ?? '',
    power_rate: h.power_rate ?? '',
    // clone what's LEFT right now, timestamped fresh — the copy's meters match
    power_amount: power ? Math.max(0, Math.round(power.remaining)) : (h.power_amount ?? ''),
    power_set_at: now,
    maint_amount: maint ? Math.max(0, Math.round(maint.remaining)) : (h.maint_amount ?? ''),
    maint_set_at: now,
  };
  const res = await apiFetch('POST', 'api/harvesters.php', { data: fields });
  if (res.ok) { toast(`Cloned → ${fields.name}`); loadHarvesters(); }
  else toast(res.error || 'Clone failed', false);
}

async function harvDelete(h) {
  const hopper = harvHopper(h); // capture before it's gone
  const res = await apiFetch('DELETE', 'api/harvesters.php', { data: { id: h.id } });
  if (!res.ok) { toast(res.error || 'Delete failed', false); return; }
  toast(`Removed ${h.name || h.harvester_type}`);
  loadHarvesters();
  // reclaiming dumps the hopper into your inventory — offer it to the stockpile
  if (hopper && hopper.units > 0 && h.resource_name) {
    await harvOfferStockpile(h.resource_name, hopper.units);
  }
}

// ---- add/edit form (one modal, create or update) ----

function harvOpenForm(h = null) {
  const m = $('#harv-modal');
  m.dataset.editing = h ? String(h.id) : '';
  // custom rates on a legacy/unknown type survive an edit round-trip
  harvState.editRates = h ? { maint: h.maint_rate, power: h.power_rate } : null;
  $('#harv-form-title').textContent = h ? `Edit ${h.name || h.harvester_type}` : 'Add Harvester';
  $('#harv-f-type').value = h ? (h.harvester_type || '') : '';
  $('#harv-f-name').value = h ? (h.name || '') : '';
  $('#harv-f-planet').value = h ? (h.planet || '') : '';
  $('#harv-f-x').value = h && h.x != null ? h.x : '';
  $('#harv-f-y').value = h && h.y != null ? h.y : '';
  $('#harv-f-resource').value = h ? (h.resource_name || '') : '';
  $('#harv-f-conc').value = h && h.concentration != null ? h.concentration : '';
  $('#harv-f-ber').value = h && h.ber != null ? h.ber : '';
  $('#harv-f-hopper').value = h && h.hopper_size != null ? h.hopper_size : '';
  $('#harv-f-power').value = '';
  $('#harv-f-maint').value = '';
  $('#harv-f-reslist').hidden = true;
  $('#harv-f-resinfo').hidden = true;
  delete $('#harv-f-resource').dataset.code;
  harvState.resFamilyWarn = '';
  harvSetTypeOptions(null); // full list until a resource narrows it
  harvLoadTree(); // warm the class tree for the narrowing (no-op once cached)
  // amounts only make sense on creation ("what did you load it with")
  $('#harv-f-amounts').hidden = !!h;
  // a harvester belongs to a character: one toon → preselected, several → you
  // must pick (empty placeholder blocks the save)
  const only = harvState.chars.length === 1 ? harvState.chars[0] : null;
  const selectedId = h ? String(h.character_id || '') : (only ? String(only.id) : '');
  const charOpts = (harvState.chars.length === 1 ? [] : ['<option value="">Select character…</option>'])
    .concat(harvState.chars.map((c) => `<option value="${c.id}"${selectedId === String(c.id) ? ' selected' : ''}>${escapeHtml(c.name)}</option>`));
  $('#harv-f-char').innerHTML = charOpts.join('');
  harvSyncFormMode();
  m.hidden = false;
  $(h ? '#harv-f-type' : '#harv-f-resource').focus(); // adding starts at the resource
}

// generators don't pull resources — hide what doesn't apply; the hint shows
// what got derived (extraction from BER × conc, burn rates from the type)
function harvSyncFormMode() {
  const type = $('#harv-f-type').value;
  const d = HARV_TYPE_DEFAULTS[type];
  // BER can't exceed the type's cap — snap it back and say so in the placeholder
  const berEl = $('#harv-f-ber');
  berEl.placeholder = d ? `max ${d.ber}` : 'e.g. 44';
  if (d && safeInt(berEl.value) > d.ber) berEl.value = d.ber;
  const rate = harvRate($('#harv-f-ber').value.trim(), $('#harv-f-conc').value.trim());
  // the derived strip at the bottom — only exists when it has real numbers
  const bits = [];
  if (harvState.resFamilyWarn) bits.push(`<span class="harv-derived-warn">⚠ ${escapeHtml(harvState.resFamilyWarn)} can't be pulled by a harvester (creature/space/energy resource)</span>`);
  if (rate) bits.push(`pulls <b class="harv-derived-good">≈ ${fmtNum(Math.floor(rate))} units/hr</b> · <b>${fmtNum(Math.floor(rate * 24))}/day</b>`);
  if (d) bits.push(`burns <b>${d.maint} cr/hr</b> maintenance${d.power ? ` · <b>${d.power} power/hr</b>` : ' · <b>no power needed</b>'}`);
  const hintEl = $('#harv-f-ratehint');
  hintEl.innerHTML = bits.join(' — ');
  hintEl.hidden = !bits.length;
  const nick = harvNickText();
  $('#harv-f-name').placeholder = nick || 'e.g. Copper #1';
}

async function harvSubmitForm() {
  const m = $('#harv-modal');
  const charId = $('#harv-f-char').value;
  const type = $('#harv-f-type').value.trim();
  const d = HARV_TYPE_DEFAULTS[type] || null;
  const fields = {
    harvester_type: type,
    name: $('#harv-f-name').value.trim() || harvNickText(),
    character_id: charId || null,
    planet: $('#harv-f-planet').value.trim(),
    x: $('#harv-f-x').value.trim(),
    y: $('#harv-f-y').value.trim(),
    // generators track like harvesters: energy resource + conc + a hopper of it
    resource_name: $('#harv-f-resource').value.trim(),
    concentration: $('#harv-f-conc').value.trim(),
    ber: $('#harv-f-ber').value.trim(),
    hopper_size: $('#harv-f-hopper').value.trim() ? Math.round(parseAmount($('#harv-f-hopper').value)) : '',
    // burn rates come from the type — never typed in (custom legacy rates survive edits)
    maint_rate: d ? d.maint : (harvState.editRates && harvState.editRates.maint != null ? Number(harvState.editRates.maint) : ''),
    power_rate: d ? d.power : (harvState.editRates && harvState.editRates.power != null ? Number(harvState.editRates.power) : ''),
  };
  if (!fields.harvester_type) { toast('Pick a harvester type first', false); return; }
  if (!fields.character_id) { toast('Pick which character this belongs to', false); return; }
  // units/hr from the site's calculator math — nothing extra to type in
  const rate = harvRate(fields.ber, fields.concentration);
  fields.extraction_rate = rate ? rate.toFixed(2) : '';

  const editing = m.dataset.editing;
  let res;
  if (editing) {
    res = await apiFetch('PUT', 'api/harvesters.php', { data: { id: editing, ...fields } });
  } else {
    if ($('#harv-f-power').value.trim()) fields.power_amount = Math.round(parseAmount($('#harv-f-power').value));
    if ($('#harv-f-maint').value.trim()) fields.maint_amount = Math.round(parseAmount($('#harv-f-maint').value));
    res = await apiFetch('POST', 'api/harvesters.php', { data: fields });
  }
  if (!res.ok) { toast(res.error || 'Save failed', false); return; }
  m.hidden = true;
  harvState.events = {};
  toast(editing ? 'Harvester updated' : 'Harvester added');
  loadHarvesters();
}

function initHarvesters() {
  harvSetTypeOptions(null);
  $('#harv-f-planet').innerHTML = '<option value="">—</option>'
    + Object.values(PLANET_FULL).map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');

  $('[data-refresh="harvesters"]').addEventListener('click', () => loadHarvesters());
  $('#harv-add').addEventListener('click', () => harvOpenForm());
  $('#harv-charfilter').addEventListener('change', () => {
    harvState.charFilter = $('#harv-charfilter').value;
    renderHarvesters();
  });
  $('#harv-search').addEventListener('input', () => {
    harvState.query = $('#harv-search').value.trim();
    renderHarvesters();
  });
  $('#harv-emptyall').addEventListener('click', (e) => {
    if (!confirmArm(e.currentTarget, 'Click again to empty ALL in view')) return;
    harvBulk(false);
  });
  $('#harv-packall').addEventListener('click', (e) => {
    if (!confirmArm(e.currentTarget, 'Click again to PACK UP all in view')) return;
    harvBulk(true);
  });
  $('#harv-viewtoggle').addEventListener('click', () => {
    harvState.view = harvState.view === 'grid' ? 'cards' : 'grid';
    harvPaintViewToggle();
    renderHarvesters();
    try { api().set_config('harv_view', harvState.view); } catch (_) { /* view still flips for the session */ }
  });

  // picking a type swaps the deed BER to that type's max (most deeds in the
  // wild are capped crafts — edit down for an off-max one) and reshapes the
  // form (generators pull nothing)
  $('#harv-f-type').addEventListener('change', () => {
    const d = HARV_TYPE_DEFAULTS[$('#harv-f-type').value];
    if (d && d.ber) $('#harv-f-ber').value = d.ber;
    if (d && d.hopper) $('#harv-f-hopper').value = fmtShort(d.hopper); // typical craft — edit if yours differs
    harvSyncFormMode();
  });
  ['#harv-f-ber', '#harv-f-conc'].forEach((sel) => $(sel).addEventListener('input', harvSyncFormMode));

  // resource finder — typeahead over active spawns (live API, mirror fallback);
  // an empty field shows the hottest current spawns instead of nothing
  let harvResTimer = null;
  // no player structures on Mustafar/Kashyyyk — a resource spawning ONLY there
  // can't be harvested, so the finder hides it (unknown planet data stays in);
  // creature drops (meat/hide/bone…), space, and energy classes never qualify
  const HARV_PLANET_KEYS = ['planet_corellia', 'planet_dantooine', 'planet_dathomir', 'planet_endor',
    'planet_lok', 'planet_naboo', 'planet_rori', 'planet_talus', 'planet_tatooine', 'planet_yavin4'];
  const harvHarvestable = (r) => {
    if (harvFamilyFor(r.type_code) === '') return false; // known non-harvestable class
    return HARV_PLANET_KEYS.some((p) => safeInt(r[p]) === 1)
      || !(safeInt(r.planet_mustafar) === 1 || safeInt(r.planet_kashyyyk) === 1);
  };
  const harvResRow = (r) => {
    const score = r.score != null ? safeInt(r.score) : (r.value_rating != null ? safeInt(r.value_rating) : null);
    // planet-specific resource (Corellian Wheat…) → the pick pre-fills Planet
    const spawns = Object.keys(PLANET_FULL).filter((k) => safeInt(r[k]) === 1);
    const only = spawns.length === 1 ? PLANET_FULL[spawns[0]] : '';
    return `<div class="harv-res-opt" data-pick="${escapeHtml(r.name)}" data-code="${escapeHtml(r.type_code || '')}" data-planet="${escapeHtml(only)}" data-type="${escapeHtml(r.type_name || '')}">
      <b>${escapeHtml(r.name)}</b> <span class="harv-res-type">${escapeHtml(r.type_name || '')}</span>
      ${score != null ? `<span class="harv-res-score ${qualityClass(score)}">${score}</span>` : ''}</div>`;
  };
  async function harvShowHotList() {
    const list = $('#harv-f-reslist');
    if (!harvState.hotList) {
      try {
        const res = await api().search_resources({ search: '', status: 'active', sort: 'value_rating', order: 'DESC', page: 1 });
        harvState.hotList = (res.ok && res.data && res.data.results) || [];
      } catch (_) { harvState.hotList = []; }
    }
    if ($('#harv-f-resource').value.trim().length >= 2) return; // they typed meanwhile
    // filter at render time — the class tree may have loaded after the cache
    const hot = harvState.hotList.filter(harvHarvestable).slice(0, 8);
    if (!hot.length) { list.hidden = true; return; }
    list.innerHTML = '<div class="harv-res-head">Hottest current spawns</div>'
      + hot.map(harvResRow).join('');
    list.hidden = false;
  }
  $('#harv-f-resource').addEventListener('focus', harvShowHotList);
  $('#harv-f-resource').addEventListener('input', () => {
    clearTimeout(harvResTimer);
    // typing invalidates a previous pick — the full type list comes back
    if ($('#harv-f-resource').dataset.code) {
      delete $('#harv-f-resource').dataset.code;
      harvApplyResourceFamily();
    }
    $('#harv-f-resinfo').hidden = true;
    const q = $('#harv-f-resource').value.trim();
    const list = $('#harv-f-reslist');
    if (q.length < 2) { harvShowHotList(); return; }
    harvResTimer = setTimeout(async () => {
      let rows = [];
      try {
        const res = await api().search_resources({ search: q, status: 'active', page: 1 });
        rows = ((res.ok && res.data && res.data.results) || []).filter(harvHarvestable).slice(0, 8);
      } catch (_) { /* finder just stays quiet */ }
      if ($('#harv-f-resource').value.trim() !== q) return; // stale response
      list.innerHTML = rows.length
        ? rows.map(harvResRow).join('')
        : '<div class="harv-res-opt harv-res-none">No active resource matches</div>';
      list.hidden = false;
    }, 250);
  });
  // mousedown beats the input's blur; blur closes the list a beat later
  $('#harv-f-reslist').addEventListener('mousedown', (e) => {
    const opt = e.target.closest('[data-pick]');
    if (!opt) return;
    $('#harv-f-resource').value = opt.dataset.pick;
    $('#harv-f-resource').dataset.code = opt.dataset.code || '';
    $('#harv-f-reslist').hidden = true;
    if (opt.dataset.planet) $('#harv-f-planet').value = opt.dataset.planet; // one-planet resource decides it
    harvApplyResourceFamily(); // tubers → Flora Farms only, etc.
    // the picked resource's class stays visible under the field
    const info = $('#harv-f-resinfo');
    const family = harvFamilyFor(opt.dataset.code);
    info.textContent = [opt.dataset.type, family ? `${family} harvesters` : ''].filter(Boolean).join(' — ');
    info.hidden = !info.textContent;
  });
  $('#harv-f-resource').addEventListener('blur', () => {
    setTimeout(() => { $('#harv-f-reslist').hidden = true; }, 150);
  });

  $('#harv-cancel').addEventListener('click', () => { $('#harv-modal').hidden = true; });
  $('#harv-save').addEventListener('click', () => harvSubmitForm());
  $('#harv-modal').addEventListener('click', (e) => {
    if (e.target === $('#harv-modal')) $('#harv-modal').hidden = true;
  });

  $('#harv-suggest').addEventListener('click', (e) => {
    const add = e.target.closest('[data-sugadd]');
    const dis = e.target.closest('[data-sugdismiss]');
    const mid = (add || dis)?.dataset[add ? 'sugadd' : 'sugdismiss'];
    if (!mid) return;
    const s = harvState.suggestions.find((x) => x.mail_id === mid);
    harvState.dismissed.add(mid);
    api().set_config('harv_dismissed_mails', [...harvState.dismissed]);
    harvState.suggestions = harvState.suggestions.filter((x) => x.mail_id !== mid);
    renderHarvSuggestions();
    if (add && s) {
      harvOpenForm();
      $('#harv-f-type').value = s.type;
      $('#harv-f-type').dispatchEvent(new Event('change')); // pull in the type defaults
      const c = harvState.chars.find((x) => x.name.toLowerCase() === (s.character || '').toLowerCase());
      if (c) $('#harv-f-char').value = String(c.id);
    }
  });

  $('#harv-list').addEventListener('click', (e) => {
    const resLink = e.target.closest('.harv-reslink');
    if (resLink) { openResourcePage(resLink.dataset.res); return; }
    const btn = e.target.closest('[data-hact]');
    if (!btn) return;
    const h = harvState.items.find((x) => String(x.id) === String(btn.dataset.hid));
    if (!h) return;
    const act = btn.dataset.hact;
    if (act === 'log') { harvExpandLog(h.id); return; }
    if (act === 'clone') { harvClone(h); return; }
    if (act === 'edit') { harvOpenForm(h); return; }
    if (act === 'power') { harvSetPool(h, 'power'); return; }
    if (act === 'maint') { harvSetPool(h, 'maint'); return; }
    if (act === 'sethopper') { harvSetPool(h, 'hopper'); return; }
    if (act === 'hopper') { harvEmptyHopper(h); return; }
    if (act === 'del') {
      if (confirmArm(btn, 'Click again to remove this harvester')) harvDelete(h);
    }
  });
}
