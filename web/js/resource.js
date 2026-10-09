/* Resource detail page — mirrors swgtracker.com/?r=<name>.
   Data via WebApi.get_resource -> {resource, top_uses, used_ins}. */

const RD_STATS = ['oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe'];
const rdState = { id: null, name: null, data: null };
// PLANET_FULL lives in shared.js

// The header button toggles stockpile membership for the shown resource.
function updateRdAddButton() {
  const btn = $('#rd-add');
  const inStock = typeof stkState !== 'undefined' && stkState.resourceIds.has(String(rdState.id));
  btn.hidden = false;
  btn.disabled = false;
  btn.classList.toggle('btn-accent', !inStock);
  btn.classList.toggle('btn-outline-secondary', inStock);
  btn.innerHTML = inStock
    ? '<i class="fa-solid fa-check"></i> In Stockpile — Remove'
    : '<i class="fa-solid fa-plus"></i> Add to Stockpile';
  if (inStock) reserveConfirmWidth(btn);
}

function updateRdWishButton() {
  const btn = $('#rd-wish');
  const wished = typeof wishState !== 'undefined' && wishState.resourceIds.has(String(rdState.id));
  const stocked = typeof stkState !== 'undefined' && stkState.resourceIds.has(String(rdState.id));
  btn.hidden = stocked; // one-list rule: stocked resources can't be wished
  btn.disabled = false;
  btn.innerHTML = wished
    ? '<i class="fa-solid fa-heart"></i> On Wishlist — Remove'
    : '<i class="fa-regular fa-heart"></i> Wishlist';
  if (wished) reserveConfirmWidth(btn);
}

// Card with the site's thin colored progress bar on top. pct in [0,100].
function rdCardHtml(value, label, pct, cls) {
  return `<div class="rd-card">
    <div class="rd-bar"><span class="rd-bar-fill ${cls}" style="width:${Math.max(0, Math.min(100, pct))}%"></span></div>
    <div class="rd-value ${cls}" title="${pct.toFixed(1)}%">${value}</div>
    <div class="rd-label">${label}</div>
  </div>`;
}

// status: '1' = currently in spawn, '0' = despawned (inactive_at is unreliable/null)
function rdIsActive(r) {
  return String(r.status ?? '0') === '1';
}

// community-shared waypoints for this resource — chips you can click to copy
async function rdRenderWaypoints(r) {
  const host = document.getElementById('rd-waypoints');
  if (!host) return;
  host.innerHTML = '';
  if (!rdIsActive(r)) return; // the community pool only holds waypoints for active spawns
  let res;
  try { res = await apiFetch('GET', 'api/waypoints.php'); } catch (_) { return; }
  const mine = (((res.ok && res.data && res.data.results) || [])).filter((w) => String(w.resource_id) === String(r.id));
  if (!mine.length) return;
  host.innerHTML = '<span class="rd-planets-label"><i class="fa-solid fa-location-dot"></i> Waypoints:</span> '
    + mine.map((w) => `<span class="rd-wp-chip" data-wpcopy="${escapeHtml(w.waypoint || '')}" title="Click to copy">${escapeHtml(w.waypoint || '')}${w.concentration ? ` <span class="rd-wp-conc">${safeInt(w.concentration)}%</span>` : ''}</span>`).join('');
  if (!host.dataset.wired) {
    host.dataset.wired = '1';
    host.addEventListener('click', (e) => {
      const chip = e.target.closest('[data-wpcopy]');
      if (chip) { try { navigator.clipboard.writeText(chip.dataset.wpcopy); toast('Waypoint copied'); } catch (_) { /* ignore */ } }
    });
  }
}

// Returns HTML (safe: dynamic parts escaped) so the spawn age and the Added date
// carry a precise "Spawned/Added N days, H hours, M minutes ago" hover tooltip.
function rdAgeText(r) {
  const ts = safeInt(r.timestamp);
  const added = ts > 0 ? fmtDate(ts) : '';
  let spawn = '';
  if (!rdIsActive(r)) {
    const inactiveAt = safeInt(r.inactive_at);
    spawn = inactiveAt > 0 ? `Despawned ${escapeHtml(fmtDate(inactiveAt))}` : 'Despawned';
  } else if (ts > 0) {
    const days = Math.max(0, Math.floor((Date.now() / 1000 - ts) / 86400));
    const txt = days === 0 ? '<1d in spawn' : `${days}d in spawn`;
    spawn = `<span title="${escapeHtml(agoText(r.timestamp))}">${txt}</span>`;
  }
  const addedPart = added
    ? `Added <span title="${escapeHtml(agoText(r.timestamp, 'Added'))}">${escapeHtml(added)}</span>` : '';
  return [r.id ? `ID: ${escapeHtml(String(r.id))}` : '', addedPart, spawn]
    .filter(Boolean).join('   ·   ');
}

function renderResourcePage(data) {
  const r = data.resource || {};
  rdState.id = safeInt(r.id);
  rdState.name = r.name || '';
  updateRdAddButton();
  updateRdWishButton();
  // Community editing is rep-gated server-side; an older server omits can_edit
  // (then the buttons stay live and the server still enforces on save).
  // Locked buttons stay clickable (a real `disabled` swallows hover, killing
  // the tooltip in WKWebView) — the click just explains the gate.
  rdState.canEdit = data.can_edit === undefined || safeInt(data.can_edit) === 1;
  rdState.lockTip = rdState.canEdit ? '' : `Unlocks at rep ${safeInt(data.rep_needed)} — you're at ${data.editor_rep ?? 0}. `
    + 'Rep grows as you use the tracker: harvesters, factories, inventory, stockpiles, schematics.';
  [['#rd-edit', 'fa-pen', "Fix this resource's stats — community data, changes apply for everyone"],
   ['#rd-disable', 'fa-ban', 'Disable a bad/bogus resource — hides it for everyone (recoverable, nothing is deleted)'],
  ].forEach(([sel, icon, tip]) => {
    const btn = $(sel);
    btn.hidden = false;
    btn.classList.toggle('rd-locked', !rdState.canEdit);
    btn.title = rdState.canEdit ? tip : rdState.lockTip;
    delete btn.dataset.tip; // initTooltips caches title→data-tip on hover; drop stale copies
    btn.querySelector('i').className = `fa-solid ${rdState.canEdit ? icon : 'fa-lock'}`;
  });

  // Breadcrumb — Resources › Type › Name (+ swgaide external link)
  const ext = safeInt(r.swgaide_id) > 0
    ? ` <a role="button" class="rd-ext" data-ext="https://swgaide.com/resources/view.php?rid=${safeInt(r.swgaide_id)}"
         title="View on SWGAide"><i class="fa-solid fa-arrow-up-right-from-square"></i></a>`
    : '';
  $('#rd-crumbs').innerHTML = [
    '<a role="button" data-nav="resources">Resources</a>',
    r.type_code
      ? `<a role="button" data-navcat="${escapeHtml(r.type_code)}" title="See all ${escapeHtml(r.type_name || '')} spawns">${escapeHtml(r.type_name || '')}</a>${jtlChip(r.type_code)}`
      : escapeHtml(r.type_name || ''),
    `<span class="crumb-current">${escapeHtml(r.name || '')}</span>${ext}`,
  ].filter(Boolean).join('<span class="crumb-sep">›</span>');

  $('#rd-meta').innerHTML = rdAgeText(r);

  // Score gets the scorecard's speedometer gauge; eCPU keeps its tiny card
  // but grows the site's up/down vote arrows; stats stay as tiny cards
  const score = safeInt(r.score ?? r.value_rating); // 0–100, already a percent
  insGaugeShow($('#rd-gauge'), score, qualityClass(score));
  $('#rd-gauge').insertAdjacentHTML('beforeend', '<div class="rd-gauge-label">Score</div>');
  const cards = [];
  // site rules (colorCodeCPU/pctTitle): tiers at 15/9/5/3/1, bar scaled to /40
  const cpu = ecpuClamp(r.cpu, rdIsActive(r), String(r.planet_mustafar ?? '0') === '1');
  const cpuCls = cpu >= 15 ? 'q-great' : cpu >= 9 ? 'q-good' : cpu >= 5 ? 'q-fair'
    : cpu >= 3 ? 'q-ok' : cpu >= 1 ? 'q-poor' : 'rd-muted';
  cards.push(`<div class="rd-card rd-card-cpu">
    <div class="rd-bar"><span class="rd-bar-fill ${cpuCls}" style="width:${Math.max(0, Math.min(100, (cpu / 40) * 100))}%"></span></div>
    <div class="rd-value ${cpuCls}">
      <i class="fa-solid fa-arrow-up rd-cpuvote" data-cpuvote="up" title="eCPU feels too low — vote it up"></i>
      <span id="rd-cpu-val">${cpu || '—'}</span>
      <i class="fa-solid fa-arrow-down rd-cpuvote" data-cpuvote="down" title="eCPU feels too high — vote it down"></i>
    </div>
    <div class="rd-label">eCPU</div>
  </div>`);
  RD_STATS.forEach((f) => {
    const v = safeInt(r[f]);
    if (v <= 0) return;
    const max = safeInt(r[`${f}_max`]) || 1000;
    const pct = (v / max) * 100;
    cards.push(rdCardHtml(v, f.toUpperCase(), pct, qualityClass(pct)));
  });
  const rating = safeInt(r.rating);
  if (rating > 0) cards.push(rdCardHtml(rating, 'Rating', rating / 10, qualityClass(rating / 10)));
  $('#rd-cards').innerHTML = cards.join('');

  // Score rank context — compact, lives right under the gauge
  $('#rd-scoreline').textContent = safeInt(r.score_rank) > 0
    ? `#${r.score_rank} of ${r.score_of} · top ${100 - safeInt(r.score_percentile)}%`
    : '';

  // Planet badges
  const planets = Object.entries(PLANET_FULL)
    .filter(([key]) => String(r[key] ?? '0') === '1')
    .map(([key, label]) => `<span class="planet rd-planet ${planetClass(key)}">${label}</span>`);
  $('#rd-planets').innerHTML = planets.length
    ? `<span class="rd-planets-label">${rdIsActive(r) ? 'Spawning on:' : 'Last seen on:'}</span> ${planets.join('')}` : '';

  // your stockpile tags for this resource — click one to open My Stockpile
  // filtered to it (stockpile may still be syncing; fills in when it lands)
  document.querySelector('.rd-hero').hidden = false; // data's in — show the finished header
  rdRenderStockTags(r.id);
  rdRenderWaypoints(r);
  cmtMount('#rd-comments', 'resource', r.id); // community notes live in their own tab
  rdSyncNotesTab();

  // Bottom tabs: Top Uses / Other <type> / Related (>800) / Used In
  rdState.data = data;
  // land on the first tab that actually has rows (tab order: top, other, related, used)
  rdTabState.tab = (data.top_uses || []).length ? 'top'
    : (data.similar || []).length ? 'other'
    : (data.related_schematics || []).length ? 'related'
    : (data.used_ins || []).length ? 'used' : 'top';
  rdTabState.sortField = ''; // fresh resource, natural order
  renderRdTabs();
  renderRdTable();
  rdSyncNotesTab();

  // Extraction calculator: name this resource + capture spawn timing for the despawn
  // estimate, then compute live from current inputs (spawn stats fill in with the profile)
  rdState.calcName = r.name || '';
  rdState.calcActive = rdIsActive(r);
  rdState.calcTs = safeInt(r.timestamp);
  rdState.spawn = null;
  runExtractionCalc();

  // Value & Crafting Profile charts (lazy; own endpoint, so a slow/older server
  // just leaves the section hidden rather than blocking the page)
  rdLoadProfile(r.id);
}

// Extraction Calculator — rpm = 1.5 · BER · (conc%), scaled by harvesters (site formula).
// Live: called on any input change and once when a resource loads.
function runExtractionCalc() {
  let conc = safeInt($('#rd-calc-conc').value) || 1;
  if (conc > 100) conc = 100;
  const harv = Math.max(1, safeInt($('#rd-calc-harv').value) || 1);
  const ber = Math.max(1, safeInt($('#rd-calc-ber').value) || 1);
  const rpm = 1.5 * ber * (conc * 0.01);
  const out = [
    ['Minute', Math.floor(rpm * harv)],
    ['Hourly', Math.floor(rpm * 60 * harv)],
    ['Daily', Math.floor(rpm * 60 * 24 * harv)],
    ['Weekly', Math.floor(rpm * 60 * 24 * 7 * harv)],
  ];
  $('#rd-calc-results').innerHTML =
    `<p class="rd-calc-head">${harv} harvester${harv > 1 ? 's' : ''} (${ber} BER) on ${conc}% of `
    + `${escapeHtml(rdState.calcName || 'this resource')} will produce…</p>`
    + `<div class="rd-calc-cards">${out.map(([label, n]) =>
      `<div class="rd-calc-card"><div class="rd-calc-num">${fmtNum(n)}</div><div class="rd-calc-cap">${label}</div></div>`).join('')}</div>`
    + rdDespawnEstimateHtml(rpm * harv);
  $('#rd-calc-results').hidden = false;
}

// Rough "how much before it despawns" estimate from this type's historical spawn
// lifespans (api/resource_profile.php → spawn{}). Only for active spawns with a sample.
function rdDespawnEstimateHtml(unitsPerMin) {
  const s = rdState.spawn;
  if (!rdState.calcActive || !s || !rdState.calcTs) return '';
  const daysIn = Math.max(0, (Date.now() / 1000 - rdState.calcTs) / 86400);
  // median is steadier than mean for skewed spawn lifespans; fall back to avg
  const typical = s.median_days != null ? s.median_days : s.avg_days;
  const remaining = typical - daysIn;
  const perDay = unitsPerMin * 60 * 24;
  const range = (s.min_days != null && s.max_days != null && s.max_days !== s.min_days)
    ? ` (seen ${Math.round(s.min_days)}–${Math.round(s.max_days)}d)` : '';
  let line;
  if (remaining > 0.5) {
    const rem = Math.round(remaining * 10) / 10;
    line = `In spawn ~${Math.round(daysIn)}d. ${rdResourceTypeName()} typically despawns around <strong>${typical}d</strong>${range}, so roughly `
      + `<strong>${rem}d</strong> left — about <strong>${fmtNum(Math.floor(perDay * remaining))}</strong> more units before it despawns.`;
  } else {
    line = `In spawn ~${Math.round(daysIn)}d — already past this type's typical ~${typical}d lifespan${range}, so it could despawn any time now.`;
  }
  return `<p class="rd-calc-despawn"><i class="fa-solid fa-hourglass-half"></i> ${line}<br>`
    + `<span class="rd-calc-caveat">Estimate only, from ${s.sample} past spawn${s.sample === 1 ? '' : 's'} of this type — actual despawn is random.</span></p>`;
}

function rdResourceTypeName() {
  const tn = ((rdState.data || {}).resource || {}).type_name;
  return tn ? escapeHtml(tn) : 'This type';
}

// ---- Value & Crafting Profile (histogram / donut / bell curve) ----
// Data from api/resource_profile.php (mirrors the website's resource page). The
// section stays hidden until data arrives and there's something to show.

// Collapse preference persists across reloads/resources: localStorage for the
// instant read, config.json as the durable store (survives a WebView cache wipe).
function rdLoadProfilePref() {
  try { rdState.profileCollapsed = localStorage.getItem('rd-profile-collapsed') === '1'; } catch (_) { rdState.profileCollapsed = false; }
  (async () => {
    try {
      const cfg = await api().get_config();
      const v = cfg && cfg.ok && cfg.data ? cfg.data.resource_profile_collapsed : undefined;
      if (v === undefined || !!v === rdState.profileCollapsed) return;
      rdState.profileCollapsed = !!v;
      try { localStorage.setItem('rd-profile-collapsed', v ? '1' : '0'); } catch (_) { /* ignore */ }
      rdApplyProfileCollapsed();
    } catch (_) { /* no config bridge — localStorage stands */ }
  })();
}
function rdSaveProfileCollapsed(v) {
  try { localStorage.setItem('rd-profile-collapsed', v ? '1' : '0'); } catch (_) { /* ignore */ }
  try { api().set_config('resource_profile_collapsed', !!v); } catch (_) { /* ignore */ }
}
// Show/hide the whole section per the saved preference. The tabs-row button only
// appears when there's actually a profile to toggle.
function rdApplyProfileCollapsed() {
  const collapsed = !!rdState.profileCollapsed;
  const has = !!rdState.profileHasData;
  // the header (title + caret) stays visible when collapsed — only the charts
  // (.collapse-body) hide, via the .collapsed class
  const sec = $('#rd-profile');
  sec.hidden = !has;
  sec.classList.toggle('collapsed', collapsed);
}
function rdToggleProfileCollapsed() {
  rdState.profileCollapsed = !rdState.profileCollapsed;
  rdSaveProfileCollapsed(rdState.profileCollapsed);
  rdApplyProfileCollapsed();
}

async function rdLoadProfile(id) {
  rdState.profileHasData = false;
  $('#rd-profile').hidden = true;
  $('#rd-profile-body').innerHTML = '';
  if (!safeInt(id)) return;
  let res;
  try { res = await apiFetch('GET', 'api/resource_profile.php', { params: { id } }); }
  catch (_) { return; }
  if (String(rdState.id) !== String(id)) return; // navigated away while fetching
  const p = res && res.data ? res.data : res;
  if (!p || p.error) return;
  // spawn-lifespan estimate feeds the extraction calculator — recompute now it's in
  rdState.spawn = p.spawn || null;
  runExtractionCalc();
  const hasDist = p.dist && p.dist.total > 0;
  const hasProfile = p.breakdown && (p.breakdown.stats || []).length;
  if (!hasDist && !hasProfile) return;
  $('#rd-profile-body').innerHTML = rdProfileHtml(p);
  rdState.profileHasData = true;
  rdApplyProfileCollapsed(); // honor the remembered collapsed/expanded choice
}

function rdProfileHtml(p) {
  const three = !!p.stats;
  const cards = [];

  // 1) Value to Collect — Score histogram with this resource's bin highlighted
  const vr = p.value_rating;
  const rankLine = p.rank
    ? `<strong>${rdRankLabel(p.rank.rank, p.rank.n)}</strong> for this type`
    : '';
  cards.push(`<div class="rd-pcard">
    <h6 class="rd-ptitle"><i class="fa-solid fa-bullseye"></i> Value to Collect</h6>
    ${vr !== null && vr !== undefined
      ? `<p class="rd-psub">Score <span class="${qualityClass(vr)}" style="font-weight:700;font-size:17px;">${vr}</span> <span class="rd-pmuted">/ 100</span></p>
         ${rankLine ? `<p class="rd-psub rd-pmuted">${rankLine}</p>` : ''}`
      : `<p class="rd-psub rd-pmuted">Not yet scored for this resource.</p>`}
    <div class="rd-pchart">${rdHistogramSvg(p.dist)}</div>
  </div>`);

  // 2) Crafting Stat Profile — donut, slice size = weight, slice color = this resource's quality
  const bd = p.breakdown;
  if (bd && (bd.stats || []).length) {
    cards.push(`<div class="rd-pcard">
      <h6 class="rd-ptitle"><i class="fa-solid fa-flask"></i> Crafting Stat Profile</h6>
      <p class="rd-psub">Used by <strong>${fmtNum(bd.schematic_count)}</strong> schematic${bd.schematic_count === 1 ? '' : 's'}</p>
      <ul class="rd-plegendnote">
        <li><strong>Slice size</strong> = how much crafters weight the stat</li>
        <li><strong>Color</strong> = how good this resource is on it (matches cards)</li>
      </ul>
      <div class="rd-pchart rd-pdonutwrap">${rdDonutSvg(bd.stats)}${rdDonutLegend(bd.stats)}</div>
    </div>`);
  } else {
    cards.push(`<div class="rd-pcard">
      <h6 class="rd-ptitle"><i class="fa-solid fa-flask"></i> Crafting Stat Profile</h6>
      <p class="rd-psub rd-pmuted">No crafting demand data for this class yet.</p>
    </div>`);
  }

  // 3) Score Distribution — bell curve with this resource marked (only with enough peers)
  if (three) {
    cards.push(`<div class="rd-pcard">
      <h6 class="rd-ptitle"><i class="fa-solid fa-bell"></i> Score Distribution</h6>
      <p class="rd-psub rd-pmuted">${(vr !== null && p.rank) ? `Score <strong>${vr}</strong> (${rdRankLabel(p.rank.rank, p.rank.n)})` : `${fmtNum(p.stats.n)} scored`}</p>
      <div class="rd-pchart">${rdBellSvg(p.stats, vr)}</div>
    </div>`);
  }

  return `<div class="rd-pgrid ${three ? 'rd-pgrid-3' : 'rd-pgrid-2'}">${cards.join('')}</div>`
    + `<div class="rd-ptip" hidden></div>`;
}

// perf grade for the donut tooltip — same tiers as the site's statColorHex
function rdPerfGrade(p) {
  return p >= 96 ? 'maxed' : p >= 90 ? 'great' : p >= 80 ? 'good' : p >= 50 ? 'ok' : 'weak';
}

// Floating tooltip + hover highlight for the profile charts (bars + donut slices),
// matching the website's Chart.js hover. Delegated once on #rd-profile-body.
function rdInitProfileHover() {
  const host = $('#rd-profile-body');
  if (!host) return;
  const tip = () => host.querySelector('.rd-ptip');
  host.addEventListener('mousemove', (e) => {
    const el = e.target.closest('[data-tipt]');
    const t = tip();
    if (!el || !t) { if (t) t.hidden = true; return; }
    t.innerHTML = `<div class="rd-ptip-t">${el.getAttribute('data-tipt')}</div>`
      + `<div class="rd-ptip-b">${el.getAttribute('data-tipb')}</div>`;
    t.hidden = false;
    const hb = host.getBoundingClientRect();
    let x = e.clientX - hb.left + 12;
    let y = e.clientY - hb.top + 12;
    // keep the tooltip inside the section
    const tw = t.offsetWidth, th = t.offsetHeight;
    if (x + tw > hb.width) x = e.clientX - hb.left - tw - 12;
    if (y + th > hb.height) y = e.clientY - hb.top - th - 12;
    t.style.left = Math.max(0, x) + 'px';
    t.style.top = Math.max(0, y) + 'px';
  });
  host.addEventListener('mouseleave', () => { const t = tip(); if (t) t.hidden = true; });
}

// "top N% of M seen" — mirrors the site's valueRankLabel
function rdRankLabel(rank, n) {
  if (!n || !rank) return '';
  const pct = Math.max(1, Math.round((rank / n) * 100));
  return `Top ${pct}% of ${fmtNum(n)} seen`;
}

// Score histogram (10 bins of 10). This resource's bin is red, the rest slate.
function rdHistogramSvg(dist) {
  const bins = (dist && dist.bins) || [];
  const selfBin = dist ? dist.self_bin : null;
  const w = 300, h = 150, padL = 26, padB = 20, padT = 8, padR = 6;
  const cw = w - padL - padR, ch = h - padB - padT;
  const max = Math.max(1, ...bins);
  const bw = cw / bins.length;
  // y gridlines (0, mid, max)
  const grid = [0, 0.5, 1].map((f) => {
    const y = padT + ch * (1 - f);
    const val = Math.round(max * f);
    return `<line x1="${padL}" y1="${y}" x2="${w - padR}" y2="${y}" class="rd-pgridline"/>`
      + `<text x="${padL - 4}" y="${y + 3}" text-anchor="end" class="rd-paxis">${val}</text>`;
  }).join('');
  const bars = bins.map((v, i) => {
    const bh = ch * (v / max);
    const x = padL + i * bw;
    const y = padT + (ch - bh);
    const fill = i === selfBin ? 'var(--accent)' : '#43465c';
    const label = `${i * 10}-${(i + 1) * 10}`;
    const sub = `${v} resource${v === 1 ? '' : 's'}${i === selfBin ? ' · this one' : ''}`;
    // x labels every other bin to avoid crowding
    const xlab = (i % 2 === 0)
      ? `<text x="${x + bw / 2}" y="${h - 6}" text-anchor="middle" class="rd-paxis">${i * 10}</text>` : '';
    return `<rect class="rd-pbar" x="${x + 1.5}" y="${y}" width="${Math.max(1, bw - 3)}" height="${Math.max(0, bh)}" rx="2" fill="${fill}"`
      + ` data-tipt="Score ${label}" data-tipb="${escapeHtml(sub)}"></rect>${xlab}`;
  }).join('');
  return `<svg class="rd-psvg" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">${grid}${bars}</svg>`;
}

// Crafting stat donut — slice arc length = weight_pct, fill = this resource's quality color.
function rdDonutSvg(stats) {
  const size = 150, cx = size / 2, cy = size / 2, r = 60, inner = 35;
  // drop zero-weight stats — a 0% slice is a degenerate arc and adds nothing
  const parts = stats.filter((s) => (s.weight_pct || 0) > 0);
  const total = parts.reduce((s, x) => s + (x.weight_pct || 0), 0) || 1;
  const tip = (s) => `data-tipt="${escapeHtml(s.stat)} — ${s.weight_pct}% crafting weight" data-tipb="this resource ${s.stat_pct}% (${rdPerfGrade(s.stat_pct)})"`;

  // One stat carries all the weight → a single full circle. An SVG arc from a point
  // back to itself draws nothing, so render a proper ring (outer + inner, even-odd).
  if (parts.length === 1) {
    const s = parts[0];
    const ring = `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx} ${cy + r} A ${r} ${r} 0 1 1 ${cx} ${cy - r} Z`
      + ` M ${cx} ${cy - inner} A ${inner} ${inner} 0 1 0 ${cx} ${cy + inner} A ${inner} ${inner} 0 1 0 ${cx} ${cy - inner} Z`;
    return `<svg class="rd-pdonut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">`
      + `<path class="rd-pslice" d="${ring}" fill="${s.color || '#777'}" fill-rule="evenodd" ${tip(s)}></path></svg>`;
  }

  let a0 = -Math.PI / 2; // start at 12 o'clock
  const slices = parts.map((s) => {
    const frac = (s.weight_pct || 0) / total;
    const a1 = a0 + frac * Math.PI * 2;
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const x0 = cx + r * Math.cos(a0), y0 = cy + r * Math.sin(a0);
    const x1 = cx + r * Math.cos(a1), y1 = cy + r * Math.sin(a1);
    const xi0 = cx + inner * Math.cos(a1), yi0 = cy + inner * Math.sin(a1);
    const xi1 = cx + inner * Math.cos(a0), yi1 = cy + inner * Math.sin(a0);
    const d = `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1} L ${xi0} ${yi0} A ${inner} ${inner} 0 ${large} 0 ${xi1} ${yi1} Z`;
    a0 = a1;
    return `<path class="rd-pslice" d="${d}" fill="${s.color || '#777'}" stroke="var(--bg)" stroke-width="2" ${tip(s)}></path>`;
  }).join('');
  return `<svg class="rd-pdonut" viewBox="0 0 ${size} ${size}" width="${size}" height="${size}">${slices}</svg>`;
}

function rdDonutLegend(stats) {
  return `<ul class="rd-plegend">${stats.map((s) =>
    `<li><span class="rd-pdot" style="background:${s.color || '#777'}"></span>${escapeHtml(s.stat)} <span class="rd-pmuted">${s.weight_pct}%</span></li>`
  ).join('')}</ul>`;
}

// Score bell curve from mean/sd, with μ, ±1σ guides and a red marker for this resource.
function rdBellSvg(stats, score) {
  const mean = stats.mean, sd = Math.max(0.5, stats.sd);
  let xmin = Math.max(0, mean - 3.5 * sd), xmax = Math.min(100, mean + 3.5 * sd);
  if (xmax - xmin < 12) { xmin = Math.max(0, mean - 8); xmax = Math.min(100, mean + 8); }
  if (score !== null && score !== undefined) { xmin = Math.max(0, Math.min(xmin, score - 2)); xmax = Math.min(100, Math.max(xmax, score + 2)); }
  const w = 300, h = 150, padB = 20, padT = 14, padX = 4;
  const cw = w - padX * 2, ch = h - padB - padT;
  const N = 120;
  const sx = (x) => padX + cw * (x - xmin) / (xmax - xmin);
  const pts = [];
  for (let k = 0; k <= N; k++) {
    const x = xmin + (xmax - xmin) * k / N;
    const y = Math.exp(-0.5 * Math.pow((x - mean) / sd, 2));
    pts.push([sx(x), padT + ch * (1 - y)]);
  }
  const area = `M ${pts[0][0]} ${padT + ch} ` + pts.map((p) => `L ${p[0]} ${p[1]}`).join(' ') + ` L ${pts[pts.length - 1][0]} ${padT + ch} Z`;
  const line = `M ` + pts.map((p) => `${p[0]} ${p[1]}`).join(' L ');
  const vline = (val, cls, label, bold) => {
    if (val === null || val === undefined || val < xmin || val > xmax) return '';
    const x = sx(val);
    const lx = Math.max(padX + 14, Math.min(x, w - padX - 14));
    return `<line x1="${x}" y1="${padT}" x2="${x}" y2="${padT + ch}" class="${cls}"/>`
      + (label ? `<text x="${lx}" y="${padT - 3}" text-anchor="middle" class="rd-pbelllab ${bold ? 'rd-pbellself' : ''}">${escapeHtml(label)}</text>` : '');
  };
  const axis = [xmin, mean, xmax].map((v) =>
    `<text x="${sx(v)}" y="${h - 5}" text-anchor="middle" class="rd-paxis">${Math.round(v)}</text>`).join('');
  return `<svg class="rd-psvg" viewBox="0 0 ${w} ${h}" width="100%" height="${h}" preserveAspectRatio="none">`
    + `<path d="${area}" class="rd-pbellfill"/><path d="${line}" class="rd-pbellline"/>`
    + vline(mean - sd, 'rd-pbellguide', '-1σ', false)
    + vline(mean, 'rd-pbellmu', 'μ', false)
    + vline(mean + sd, 'rd-pbellguide', '+1σ', false)
    + vline(score, 'rd-pbellmark', (score !== null && score !== undefined) ? 'This: ' + score : '', true)
    + axis + `</svg>`;
}

// Stockpile tags on the resource page: only when this resource is in YOUR
// stockpile and tagged. Syncs the stockpile lazily on first need.
function rdRenderStockTags(resourceId) {
  const el = $('#rd-stktags');
  el.innerHTML = '';
  if (typeof stkState === 'undefined') return;
  const paint = () => {
    if (String(rdState.id) !== String(resourceId)) return; // navigated away meanwhile
    const item = (stkState.items || []).find((i) => String(i.id) === String(resourceId));
    const tags = item ? stkTags(item) : [];
    el.innerHTML = tags.length
      ? `<span class="rd-planets-label"><i class="fa-solid fa-tags"></i> Your tags:</span> `
        + tags.map((t) => `<span class="fac-tag" data-rdstktag="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join(' ')
      : '';
  };
  if (!stkState.items.length && typeof syncStockpile === 'function') {
    syncStockpile().then(paint).catch(() => {});
  } else {
    paint();
  }
}

// ---- Bottom tabs (mirror the site's resource page) ----

const rdTabState = { tab: 'top', sortField: '', sortOrder: 'ASC' };

// Sortable header cell + generic client-side sort for the detail tabs (all tab
// data is already local). Empty sortField keeps each tab's natural order.
function rdSortableTh(label, field, cls = '') {
  const arrow = field === rdTabState.sortField ? (rdTabState.sortOrder === 'ASC' ? ' ▲' : ' ▼') : '';
  return `<th class="${cls}" data-sort="${field}">${label}${arrow}</th>`;
}
function rdSorted(list, accessors) {
  const f = rdTabState.sortField;
  if (!f || !accessors[f]) return list;
  const dir = rdTabState.sortOrder === 'ASC' ? 1 : -1;
  return [...list].sort((a, b) => {
    const x = accessors[f](a), y = accessors[f](b);
    return (x < y ? -1 : x > y ? 1 : 0) * dir;
  });
}
const lc = (v) => String(v || '').toLowerCase();
// Site ladder (verified on /?r pages): #1 great, #2 good, #3 fair; deeper ranks fade
const rankClass = (rank) =>
  rank <= 1 ? 'q-great' : rank === 2 ? 'q-good' : rank === 3 ? 'q-fair' : rank <= 10 ? 'q-ok' : 'q-poor';

function renderRdTabs() {
  const d = rdState.data || {};
  const r = d.resource || {};
  const tabs = [
    ['top', `Top Uses (${(d.top_uses || []).length})`],
    ['other', `Other ${escapeHtml(r.type_name || 'Spawns')} (${(d.similar || []).length})`],
    ['related', `Related Schematics (${(d.related_schematics || []).length})`],
    ['used', `Used In (${(d.used_ins || []).length})`],
    ['calc', '<i class="fa-solid fa-calculator"></i> Extraction Calculator'],
    ['notes', '<i class="fa-solid fa-comment"></i> Notes'],
  ];
  $('#rd-tabs').innerHTML = tabs.map(([k, label]) =>
    `<li><button type="button" class="scd-tab ${rdTabState.tab === k ? 'active' : ''}" data-rdtab="${k}">${label}</button></li>`
  ).join('');
}

// Notes and Extraction Calculator are PANE tabs, not table tabs — swap the table
// for the matching section. Only one pane is visible at a time.
function rdSyncNotesTab() {
  const notes = rdTabState.tab === 'notes';
  const calc = rdTabState.tab === 'calc';
  const pane = notes || calc;
  document.querySelector('.rd-table-wrap').hidden = pane;
  if (pane) $('#rd-tabnote').hidden = true; // the rank explainer belongs to the data tabs
  $('#rd-comments').hidden = !notes;
  $('#rd-calc').hidden = !calc;
}

function renderRdTable() {
  const d = rdState.data || {};
  const empty = $('#rd-empty');
  empty.hidden = true;
  let head = '', body = '', emptyMsg = '';
  $('#rd-tabnote').hidden = true; // only the Used In branch fills it

  if (rdTabState.tab === 'top') {
    // Best-ranked spawns per schematic experimentation formula
    head = rdSortableTh('Schematic', 'schematic_name', 'col-name')
      + rdSortableTh('Section', 'section', 'col-text')
      + rdSortableTh('Formula', 'formula_description', 'col-text')
      + rdSortableTh('Rank', 'rank');
    const uses = rdSorted(
      [...(d.top_uses || [])].sort((a, b) => safeInt(a.rank) - safeInt(b.rank)), {
        schematic_name: (u) => lc(u.schematic_name),
        section: (u) => lc(u.section),
        formula_description: (u) => lc(u.formula_description),
        rank: (u) => safeInt(u.rank),
      });
    body = uses.map((u) => `
      <tr data-schem="${escapeHtml(String(u.schematic_id || ''))}" data-sname="${escapeHtml(u.schematic_name || '')}">
        <td class="col-name res-name">${escapeHtml(u.schematic_name || '')}</td>
        <td class="col-text res-type">${escapeHtml(u.section || '')}</td>
        <td class="col-text">${escapeHtml(u.formula_description || '')}</td>
        <td class="stat ${rankClass(safeInt(u.rank))}">#${safeInt(u.rank)}</td>
      </tr>`).join('');
    // fresh spawns rank on a rolling rebuild — an in-spawn resource with no
    // rows yet is almost always "not computed yet", not "ranks nowhere"
    emptyMsg = rdIsActive(d.resource || {})
      ? 'No rankings yet — Top Uses for a new spawn can take a few hours to compute. For immediate notices, Spawn Alerts and My Schematics evaluate new spawns the moment they land.'
      : 'This resource is not a top-ranked spawn for any schematic formula.';

  } else if (rdTabState.tab === 'other') {
    // Other spawns of the same resource type (API `similar`)
    head = '<th class="pin-cell"></th><th class="pin-cell"></th>'
      + rdSortableTh('Name', 'name', 'col-name') + rdSortableTh('Score', 'score')
      + RD_STATS.map((f) => rdSortableTh(f.toUpperCase(), f)).join('')
      + rdSortableTh('Rating', 'rating');
    const accessors = {
      name: (s) => lc(s.name),
      score: (s) => safeInt(s.score ?? s.value_rating),
      rating: (s) => safeInt(s.rating),
    };
    RD_STATS.forEach((f) => { accessors[f] = (s) => safeInt(s[f]); });
    body = rdSorted(d.similar || [], accessors).map((s) => {
      const isActive = String(s.status ?? '0') === '1';
      const rating = safeInt(s.rating);
      const score = safeInt(s.score ?? s.value_rating);
      return `<tr class="${isActive ? 'activeResource' : ''}">
        ${addCellHtml(s.id, s.name)}
        ${wishCellHtml(s.id, s.name)}
        <td class="col-name res-name" data-rname="${escapeHtml(s.name || '')}">${escapeHtml(s.name || '')}</td>
        <td class="stat ${qualityClass(score)}">${score}</td>
        ${RD_STATS.map((f) => statCell(s[f], s[`${f}_max`])).join('')}
        ${rating > 0 ? `<td class="stat ${qualityClass(rating / 10)}">${rating}</td>` : '<td class="stat stat_off">—</td>'}
      </tr>`;
    }).join('');
    emptyMsg = 'No other spawns of this type recorded.';

  } else if (rdTabState.tab === 'related') {
    // Schematics whose weighted quality with this resource beats 800 (server-computed)
    head = rdSortableTh('Schematic', 'schematicName', 'col-name')
      + rdSortableTh('Quality', 'resourceQuality')
      + rdSortableTh('Formula', 'formulaExpDescription', 'col-text')
      + rdSortableTh('Class', 'resourceClass', 'col-text');
    const rel = rdSorted(
      [...(d.related_schematics || [])]
        .sort((a, b) => (Number(b.resourceQuality) || 0) - (Number(a.resourceQuality) || 0)), {
        schematicName: (s) => lc(s.schematicName),
        resourceQuality: (s) => Number(s.resourceQuality) || 0,
        formulaExpDescription: (s) => lc(s.formulaExpDescription),
        resourceClass: (s) => lc(s.resourceClass),
      });
    body = rel.map((s) => {
      const q = Number(s.resourceQuality) || 0;
      return `<tr data-schem="${escapeHtml(String(s.schematicId ?? ''))}" data-sname="${escapeHtml(s.schematicName || '')}">
        <td class="col-name res-name">${escapeHtml(s.schematicName || '')}</td>
        <td class="stat ${qualityClass(q / 10)}">${q.toFixed(1)}</td>
        <td class="col-text">${escapeHtml(s.formulaExpDescription || '')}</td>
        <td class="col-text res-type">${escapeHtml(s.resourceClass || '')}</td>
      </tr>`;
    }).join('');
    emptyMsg = 'No schematic scores above 800 with this resource.';

  } else { // used
    head = rdSortableTh('Schematic', 'schematicName', 'col-name')
      + rdSortableTh('As', 'resourceClassName', 'col-text')
      + rdSortableTh('Rank', 'ranking');
    // rank-ascending default front-loads the #1 rows, which reads as "it says
    // #1 for everything" (Philosophy's report) — the distribution line shows
    // the real spread, and the meaning of Rank gets said out loud
    const dist = {};
    (d.used_ins || []).forEach((u) => { const r = safeInt(u.ranking); dist[r] = (dist[r] || 0) + 1; });
    const distTxt = Object.keys(dist).map(Number).sort((a, b) => a - b)
      .map((r) => `<b class="${rankClass(r)}">#${r}</b> in ${fmtNum(dist[r])}`).join(' · ');
    const note = $('#rd-tabnote');
    note.hidden = !distTxt;
    note.innerHTML = distTxt
      ? `Rank = where this resource places among <b>currently spawned</b> resources of the needed class, per schematic — ${distTxt}`
      : '';
    const uses = rdSorted(
      [...(d.used_ins || [])].sort((a, b) => safeInt(a.ranking) - safeInt(b.ranking)), {
        schematicName: (u) => lc(u.schematicName),
        resourceClassName: (u) => lc(u.resourceClassName),
        ranking: (u) => safeInt(u.ranking),
      });
    body = uses.map((u) => `
      <tr data-schem="${escapeHtml(String(u.schematicId || ''))}" data-sname="${escapeHtml(u.schematicName || '')}">
        <td class="col-name res-name">${escapeHtml(u.schematicName || '')}</td>
        <td class="col-text res-type">${escapeHtml(u.resourceClassName || '')}</td>
        <td class="stat ${rankClass(safeInt(u.ranking))}">#${safeInt(u.ranking)}</td>
      </tr>`).join('');
    emptyMsg = 'No schematics currently rank this resource.';
  }

  $('#rd-head').innerHTML = head;
  $('#rd-body').innerHTML = body;
  if (!body) {
    empty.textContent = emptyMsg;
    empty.hidden = false;
  }
}

async function openResourcePage(name) {
  showPage('resource');
  $('#rd-crumbs').innerHTML = '<a role="button" data-nav="resources">Resources</a>';
  $('#rd-meta').textContent = '';
  $('#rd-add').hidden = true;
  $('#rd-wish').hidden = true;
  $('#rd-edit').hidden = true;
  $('#rd-disable').hidden = true;
  $('#rd-scoreline').textContent = '';
  // the whole hero hides while loading — a stale gauge + a placeholder card
  // half-rendered looked broken; it reappears complete with the data
  document.querySelector('.rd-hero').hidden = true;
  $('#rd-cards').innerHTML = '';
  $('#rd-planets').innerHTML = '';
  $('#rd-stktags').innerHTML = '';
  $('#rd-tabs').innerHTML = '';
  $('#rd-head').innerHTML = '';
  $('#rd-body').innerHTML = '';
  $('#rd-profile').hidden = true;
  $('#rd-profile-body').innerHTML = '';
  $('#rd-calc').hidden = true;
  $('#rd-empty').hidden = true;
  showGridLoading('#rd-loading');

  let res;
  try { res = await api().get_resource(name); }
  catch (e) { res = { ok: false, error: String(e) }; }

  $('#rd-loading').hidden = true;

  if (!res.ok || !res.data || !res.data.resource) {
    $('#rd-cards').innerHTML = '';
    const empty = $('#rd-empty');
    empty.textContent = `Failed to load "${name}": ${res.error || 'unexpected response'}`;
    empty.hidden = false;
    return;
  }
  renderResourcePage(res.data);
}

// ---- Community editing: fix bad stats / disable bogus resources ----
// Stats are community data; edits go through the authenticated PUT on
// api/resources.php, which validates against the class caps, recomputes the
// weighted profession values, and records every change in resource_edits.
// Disable is a soft delete (resources.deleted = 1) — nothing is ever removed.

function openResEditDialog() {
  const r = (rdState.data || {}).resource;
  if (!r) return;
  // one input per stat the class actually has (cap > 0), prefilled + capped
  const fields = RD_STATS
    .map((f) => ({ f, cap: safeInt(r[`${f}_max`]), val: safeInt(r[f]) }))
    .filter((s) => s.cap > 0);
  if (!fields.length) { toast('This resource class has no editable stats', false); return; }
  $('#res-edit-title').textContent = rdState.name;
  $('#res-edit-grid').innerHTML = fields.map((s) => `
    <div class="inv-add-field">
      <label class="sp-field-label">${s.f.toUpperCase()} <span class="settings-sub">max ${s.cap}</span></label>
      <input type="number" class="form-control filter-input" data-resedit="${s.f}"
             value="${s.val}" min="1" max="${s.cap}" autocomplete="off">
    </div>`).join('');
  $('#res-edit-modal').hidden = false;
  const first = document.querySelector('#res-edit-grid input');
  if (first) { first.focus(); first.select(); }
}

async function saveResEdit() {
  const r = (rdState.data || {}).resource;
  if (!r) return;
  const stats = {};
  const bad = [];
  document.querySelectorAll('#res-edit-grid [data-resedit]').forEach((inp) => {
    const f = inp.dataset.resedit;
    const cap = safeInt(r[`${f}_max`]);
    const v = parseInt(inp.value, 10);
    if (!Number.isFinite(v) || v < 1 || v > cap) { bad.push(f.toUpperCase()); return; }
    if (v !== safeInt(r[f])) stats[f] = v;
  });
  if (bad.length) { toast(`${bad.join(', ')}: enter a whole number within the class cap`, false); return; }
  if (!Object.keys(stats).length) { $('#res-edit-modal').hidden = true; return; }

  const btn = $('#res-edit-save');
  btn.disabled = true;
  const res = await apiFetch('PUT', 'api/resources.php', { data: { id: rdState.id, stats } });
  btn.disabled = false;
  // require an explicit success flag — an older server answers PUT with the
  // browse payload, which must not read as "saved"
  if (!res.ok || !res.data || !res.data.success) {
    toast(res.data?.error || res.error || 'Update failed', false);
    return;
  }
  $('#res-edit-modal').hidden = true;
  toast('Stats updated for everyone — score refreshes on the next site update');
  openResourcePage(rdState.name); // repaint cards from the server's view
}

async function disableResource(btn) {
  const res = await apiFetch('PUT', 'api/resources.php', { data: { id: rdState.id, deleted: 1 } });
  if (!res.ok || !res.data || !res.data.success) {
    toast(res.data?.error || res.error || 'Disable failed', false);
    btn.disabled = false;
    return;
  }
  toast(`"${rdState.name}" disabled — it is hidden for everyone but recoverable`);
  showPage('resources');
  if (typeof loadResources === 'function') loadResources();
}

function initResourcePage() {
  $('#rd-refresh').addEventListener('click', () => {
    if (rdState.name) openResourcePage(rdState.name);
  });

  // Value & Crafting Profile — the header chevron collapses just the charts (the
  // header bar stays); the choice is remembered across resources/reloads.
  rdLoadProfilePref();
  $('#rd-profile').addEventListener('click', (e) => {
    if (e.target.closest('[data-rdprofile-toggle]')) rdToggleProfileCollapsed();
  });
  rdInitProfileHover();

  // Extraction Calculator — live: recomputes on any change (no button).
  // rpm = 1.5 · BER · (conc%), scaled by harvesters (site formula).
  ['#rd-calc-conc', '#rd-calc-harv', '#rd-calc-ber'].forEach((sel) =>
    $(sel).addEventListener('input', runExtractionCalc));
  // eCPU voting — the site's up/down arrows, ±0.6 with the in-spawn clamp
  $('#rd-cards').addEventListener('click', async (e) => {
    const v = e.target.closest('[data-cpuvote]');
    if (!v) return;
    const res = await apiFetch('POST', 'api/resources.php', {
      data: { action: 'cpu', id: safeInt(rdState.id), dir: v.dataset.cpuvote },
    }).catch((err) => ({ ok: false, error: String(err) }));
    if (!res.ok) { toast(res.error || 'Vote failed — site update pending?', false); return; }
    const cpu = safeInt(res.data.cpu);
    const el = $('#rd-cpu-val');
    if (el) el.textContent = cpu || '—';
    // tier color + bar follow the new value live (they only updated on reload)
    const cls = cpu >= 15 ? 'q-great' : cpu >= 9 ? 'q-good' : cpu >= 5 ? 'q-fair'
      : cpu >= 3 ? 'q-ok' : cpu >= 1 ? 'q-poor' : 'rd-muted';
    const card = el?.closest('.rd-card-cpu');
    if (card) {
      const val = card.querySelector('.rd-value');
      if (val) val.className = `rd-value ${cls}`;
      const fill = card.querySelector('.rd-bar-fill');
      if (fill) {
        fill.className = `rd-bar-fill ${cls}`;
        fill.style.width = `${Math.max(0, Math.min(100, (cpu / 40) * 100))}%`;
      }
    }
    toast(`eCPU nudged ${v.dataset.cpuvote} — now ${cpu}`);
  });
  $('#rd-edit').addEventListener('click', () => {
    if (!rdState.canEdit) { toast(rdState.lockTip, false); return; }
    openResEditDialog();
  });
  $('#res-edit-cancel').addEventListener('click', () => { $('#res-edit-modal').hidden = true; });
  $('#res-edit-modal').addEventListener('click', (e) => {
    if (e.target.id === 'res-edit-modal') $('#res-edit-modal').hidden = true;
  });
  $('#res-edit-save').addEventListener('click', saveResEdit);
  $('#res-edit-grid').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveResEdit();
  });

  $('#rd-disable').addEventListener('click', async () => {
    if (!rdState.id) return;
    if (!rdState.canEdit) { toast(rdState.lockTip, false); return; }
    const btn = $('#rd-disable');
    if (!confirmArmLabeled(btn, 'Disable for everyone?')) return;
    btn.disabled = true;
    await disableResource(btn);
  });

  // stockpile tag pill → My Stockpile filtered to that tag
  $('#rd-stktags').addEventListener('click', (e) => {
    const tag = e.target.closest('[data-rdstktag]');
    if (!tag || typeof stkState === 'undefined') return;
    stkState.tagFilter = tag.dataset.rdstktag;
    showPage('stockpile');
    if (typeof renderStockpile === 'function' && stkState.items.length) renderStockpile();
  });

  $('#rd-crumbs').addEventListener('click', async (e) => {
    const ext = e.target.closest('[data-ext]');
    if (ext) {
      try { await api().open_external(ext.dataset.ext); } catch (_) { /* ignore */ }
      return;
    }
    const cat = e.target.closest('[data-navcat]');
    if (cat) {
      // jump to the resources grid, filtered to this resource's type/category
      showPage('resources');
      applyCategoryFilter(cat.dataset.navcat, cat.textContent.trim());
      return;
    }
    const link = e.target.closest('[data-nav]');
    if (link) showPage(link.dataset.nav);
  });

  // Tab switching (each tab starts back in its natural order)
  $('#rd-tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('[data-rdtab]');
    if (!tab) return;
    rdTabState.tab = tab.dataset.rdtab;
    rdTabState.sortField = '';
    document.querySelectorAll('#rd-tabs [data-rdtab]').forEach((t) =>
      t.classList.toggle('active', t === tab));
    rdSyncNotesTab();
    if (rdTabState.tab !== 'notes' && rdTabState.tab !== 'calc') renderRdTable();
  });

  // Column sorting within a tab
  $('#rd-head').addEventListener('click', (e) => {
    const th = e.target.closest('th[data-sort]');
    if (!th) return;
    const field = th.dataset.sort;
    if (rdTabState.sortField === field) {
      rdTabState.sortOrder = rdTabState.sortOrder === 'ASC' ? 'DESC' : 'ASC';
    } else {
      rdTabState.sortField = field;
      // stats feel right starting high-to-low; text A-to-Z; ranks best-first
      rdTabState.sortOrder = ['schematic_name', 'section', 'formula_description', 'name',
        'schematicName', 'formulaExpDescription', 'resourceClass', 'resourceClassName',
        'rank', 'ranking'].includes(field) ? 'ASC' : 'DESC';
    }
    renderRdTable();
  });

  // Row actions: stockpile/wishlist toggles, schematic rows, other-spawn names
  $('#rd-body').addEventListener('click', (e) => {
    const addCell = e.target.closest('[data-add]');
    if (addCell) { handleAddCellClick(addCell, e); return; }
    const wishCell = e.target.closest('[data-wish]');
    if (wishCell) { handleWishCellClick(wishCell); return; }
    const schemRow = e.target.closest('tr[data-schem]');
    if (schemRow && schemRow.dataset.schem) { openSchematicPage(schemRow.dataset.schem, schemRow.dataset.sname); return; }
    const nameCell = e.target.closest('[data-rname]');
    if (nameCell) openResourcePage(nameCell.dataset.rname);
  });

  $('#rd-add').addEventListener('click', async () => {
    if (!rdState.id) return;
    const btn = $('#rd-add');
    if (stkState.resourceIds.has(String(rdState.id))) {
      if (!confirmArmLabeled(btn, 'Confirm remove?')) return; // removal confirms
      btn.disabled = true;
      await removeFromStockpileByResource(rdState.id, rdState.name);
      updateRdAddButton();
      updateRdWishButton();
    } else {
      // Dialog collects an optional amount + CPU; adds (and promotes if wished) on close.
      openStockpileAddDialog(rdState.id, rdState.name, () => {
        updateRdAddButton();
        updateRdWishButton();
      });
    }
  });

  $('#rd-wish').addEventListener('click', async () => {
    if (!rdState.id) return;
    const btn = $('#rd-wish');
    if (wishState.resourceIds.has(String(rdState.id))) {
      if (!confirmArmLabeled(btn, 'Confirm remove?')) return;
      btn.disabled = true;
      await removeFromWishlistByResource(rdState.id, rdState.name);
    } else {
      btn.disabled = true;
      await addToWishlist(rdState.id, rdState.name);
    }
    updateRdAddButton();
    updateRdWishButton();
  });
}
