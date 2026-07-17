/* Scanner page — review queue for in-game OCR captures.
   The shell owns the dumb parts (hotkey, screen grab, native OCR) and hands us
   raw text lines + a PNG. Everything smart lives HERE on purpose — parsing,
   fuzzy matching against the resource mirror, approve-into-stockpile — so OCR
   quirks get fixed by bundle deploys, not installer releases. */

const SCAN_STATS = {
  'overall quality': 'oq', 'conductivity': 'cd', 'cold resistance': 'cr',
  'decay resistance': 'dr', 'heat resistance': 'hr', 'malleability': 'ma',
  'shock resistance': 'sr', 'unit toughness': 'ut', 'flavor': 'fl',
  'potential energy': 'pe', 'entangle resistance': 'er', // parsed, not matched — site tracks 10 stats
};
const SCAN_MATCH_STATS = ['oq', 'cd', 'cr', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe'];

const scanState = { cfg: null, queue: [], matches: {}, pendingQty: {},
                    worklist: [], timer: null };

// ---- parsing --------------------------------------------------------------

// Digits only, mapping the confusables OCR actually produces INSIDE numbers
// (the game font's 8 reads as B/&, 5 as S, …). Anything left over after the
// map is NOT silently stripped — the value fails validation and the line gets
// flagged visibly. Stripping is how "Heat Resistance: 814" once became 14:
// the 8 read as a letter and vanished.
function scanNumber(raw) {
  const fixed = String(raw).trim()
    .replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/[Zz]/g, '2')
    .replace(/[S$]/g, '5').replace(/[Gb]/g, '6').replace(/[B&]/g, '8')
    .replace(/[qg]/g, '9').replace(/D/g, '0')
    .replace(/[.,\s%]/g, ''); // punctuation noise around the digits
  if (!fixed || /[^\d]/.test(fixed)) return null;
  const n = parseInt(fixed, 10);
  return n >= 1 && n <= 1000 ? n : null; // stats are 1..1000 in game
}

function scanLevenshtein(a, b) {
  a = a.toLowerCase(); b = b.toLowerCase();
  const m = a.length, n = b.length;
  if (!m || !n) return Math.max(m, n);
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  for (let i = 1; i <= m; i++) {
    const cur = [i];
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[n];
}
const scanNameSim = (a, b) =>
  1 - scanLevenshtein(a, b) / Math.max(a.length, b.length, 1);

// OCR labels arrive slightly mangled ("Mallleability") — match each line's
// label to the nearest name in a known set instead of demanding exact text.
function scanNearestLabel(label, known) {
  const l = label.trim().toLowerCase();
  if (known[l] !== undefined) return known[l];
  let best = null, bestD = Infinity;
  for (const k of Object.keys(known)) {
    const d = scanLevenshtein(l, k);
    if (d < bestD) { bestD = d; best = k; }
  }
  return bestD <= 3 ? known[best] : null;
}
const scanStatKey = (label) => scanNearestLabel(label, SCAN_STATS);

// Non-stat labeled lines the examine window always has. 'name' carries the
// resource's spawn name ("Resource Type: Quadeniom"); 'qty' is the container's
// contents ("Resource Quantity: 533504/1000000") — it prefills the stockpile
// amount on approve; 'skip' lines are benign and must NOT count toward the
// didn't-parse warning.
// 'resource name' is the Veteran Reward crate dialog ("Resource Name =
// Emaiwiheu" — the community's trick for reading stats off a new spawn);
// 'resource type' is the examine window. Same slot, either source.
const SCAN_META = {
  'resource name': 'name', 'resource type': 'name', 'resource class': 'klass',
  'resource quantity': 'qty', 'condition': 'skip', 'volume': 'skip',
};

// "533504/1000000" → 533504 (the current amount; the max after the slash is
// dropped). Same confusable map as scanNumber, but commas/periods are normal
// inside big quantities so leftover junk is stripped, not rejected — this is
// a convenience prefill, never a matching signal.
function scanQty(raw) {
  const first = String(raw).split('/')[0]
    .replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/[Zz]/g, '2')
    .replace(/[S$]/g, '5').replace(/[Gb]/g, '6').replace(/[B&]/g, '8')
    .replace(/[qg]/g, '9').replace(/D/g, '0').replace(/[^\d]/g, '');
  if (!first) return null;
  const n = parseInt(first, 10);
  return n > 0 && n <= 100000000 ? n : null;
}

// Raw OCR lines -> {name, klass, stats:{oq:...}, unparsed:[...]}
function parseScan(lines) {
  const texts = lines.map((l) => String(l.text || '').trim()).filter(Boolean);
  // statsOrder keeps the stats in the order the game DISPLAYED them (top to
  // bottom) — that's the order SWGAide's submit file expects them in.
  const out = { name: '', klass: '', qty: null, stats: {}, statsOrder: [], unparsed: [] };
  let klassAt = -1; // a long class wraps: the NEXT line may be its tail
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    // ':' examine window, '=' vet-reward crate dialog, ';' OCR's take on either
    const kv = t.match(/^(.+?)\s*[:;=]\s*(.*)$/);
    if (!kv) {
      if (i === klassAt + 1 && out.klass && /^[A-Za-z][A-Za-z ]{2,30}$/.test(t)) {
        out.klass += ` ${t}`; // "Green Diamond Cryst" + "Gemstone"
      } else if (!out.name && !/unrefined|natural resource|examine|standard|this container/i.test(t)) {
        // free-line fallback: the window title — 'Standard' is the tab label
        out.name = t;
      }
      continue;
    }
    const [, label, value] = kv;
    const meta = scanNearestLabel(label, SCAN_META);
    if (meta === 'name') { out.name = value.trim() || out.name; continue; }
    if (meta === 'klass') { out.klass = value.trim(); klassAt = i; continue; }
    if (meta === 'qty') { out.qty = scanQty(value); continue; }
    if (meta === 'skip') continue;
    const key = scanStatKey(label);
    if (!key) { out.unparsed.push(t); continue; }
    const n = scanNumber(value);
    if (n === null) out.unparsed.push(t); // label read, number didn't — flag it
    else { out.stats[key] = n; out.statsOrder.push([key, n]); }
  }
  return out;
}

// ---- matching -------------------------------------------------------------

/* Candidates come from the local mirror (89k resources, offline-safe). Stats
   are the real identifier — a resource's stat tuple is essentially unique —
   so a candidate with every parsed stat equal is THE resource even when OCR
   mangled half the name. Name similarity breaks ties. */
async function scanFindMatches(parsed) {
  const fields = ['id', 'name', 'type_name', 'status', ...SCAN_MATCH_STATS];
  const seen = new Map();
  const tries = [parsed.name, parsed.name.slice(0, 5), parsed.name.slice(0, 3)]
    .map((s) => (s || '').trim()).filter((s) => s.length >= 3);
  for (const search of tries) {
    try {
      const res = await api().ds_resources_query({ search, status: '', limit: 40, fields });
      for (const r of (res.ok && res.data) || []) seen.set(r.id, r);
    } catch (_) { /* mirror missing — handled below */ }
    if (seen.size >= 5) break;
  }
  const parsedStats = Object.entries(parsed.stats)
    .filter(([k]) => SCAN_MATCH_STATS.includes(k));
  const scored = [...seen.values()].map((r) => {
    let statHits = 0;
    for (const [k, v] of parsedStats) if (Number(r[k]) === v) statHits++;
    const sim = scanNameSim(parsed.name, r.name || '');
    return { ...r, statHits, statTotal: parsedStats.length, sim,
             score: statHits * 2 + sim * 3 };
  }).sort((a, b) => b.score - a.score);
  return scored.slice(0, 5);
}

// ---- rendering ------------------------------------------------------------

function scanStatChips(parsed, cand) {
  return SCAN_MATCH_STATS.map((k) => {
    const v = parsed.stats[k];
    if (v == null) return '';
    const ok = cand ? Number(cand[k]) === v : null;
    return `<span class="scan-stat ${ok === null ? '' : ok ? 'scan-stat-ok' : 'scan-stat-bad'}"
              title="${k.toUpperCase()}${ok === false ? ` — match has ${cand[k] ?? '—'}` : ''}">
              ${k.toUpperCase()} ${v}</span>`;
  }).join('');
}

function scanItemHtml(item, parsed, matches) {
  const picked = matches[0];
  const options = matches.map((m, i) =>
    `<option value="${i}">${escapeHtml(m.name)} — ${escapeHtml(m.type_name || '')}
      (${m.statHits}/${m.statTotal} stats${m.status !== 'active' ? ', despawned' : ''})</option>`).join('');
  return `<div class="scan-item" data-scanid="${item.id}">
    <img class="scan-shot" src="${item.image}" alt="capture" title="What the scanner saw">
    <div class="scan-body">
      <div class="scan-title">${escapeHtml(parsed.name || 'Unreadable name')}
        <span class="scan-class">${escapeHtml(parsed.klass || '')}</span></div>
      <div class="scan-stats">
        ${parsed.qty ? `<span class="scan-stat scan-qty"
            title="Scanned Resource Quantity — offered when adding to your stockpile">
            <i class="fa-solid fa-box"></i> ${fmtNum(parsed.qty)}</span>` : ''}
        ${scanStatChips(parsed, picked)}</div>
      ${parsed.unparsed.length ? `<div class="scan-warn" title="${escapeHtml(parsed.unparsed.join(' · '))}">
          ${parsed.unparsed.length} line(s) didn't parse — check the capture</div>` : ''}
      ${matches.length
        ? `<select class="form-select filter-select scan-pick" data-pickfor="${item.id}">${options}</select>`
        : '<div class="scan-warn">No match found in the resource mirror.</div>'}
      <div class="scan-actions">
        <button class="btn btn-sm btn-accent" data-approve="${item.id}" ${matches.length ? '' : 'disabled'}>
          <i class="fa-solid fa-check"></i> Add to stockpile</button>
        <button class="btn btn-sm btn-outline-secondary" data-newspawn="${item.id}"
          title="Not in the system yet (a fresh spawn)? Queue it for an SWGAide submit — the worklist below">
          <i class="fa-solid fa-seedling"></i> New spawn</button>
        <button class="btn btn-sm btn-outline-secondary" data-discard="${item.id}">Discard</button>
      </div>
    </div>
  </div>`;
}

async function renderScanQueue() {
  const host = $('#scan-queue');
  if (!scanState.queue.length) {
    const hk = escapeHtml((scanState.cfg && scanState.cfg.hotkey) || 'the hotkey');
    host.innerHTML = `<div class="scan-empty">
      <i class="fa-solid fa-expand"></i>
      <h2>Nothing scanned yet</h2>
      <p>Scan a resource's stats straight out of the game — no typing:</p>
      <ol>
        <li>Press <b>Position scan area</b> and fit the outline around the game's <b>Examine</b> window.</li>
        <li>In game, examine a resource.</li>
        <li>Press <b>${hk}</b> (or <b>Scan now</b> above). Captures land here, ready to add to your stockpile.</li>
      </ol>
      <p class="scan-empty-more">The <b>?</b> next to the page title has the full guide.</p>
    </div>`;
    return;
  }
  const parts = [];
  for (const item of scanState.queue) {
    const parsed = parseScan(item.lines);
    if (!scanState.matches[item.id]) {
      scanState.matches[item.id] = await scanFindMatches(parsed);
    }
    parts.push(scanItemHtml(item, parsed, scanState.matches[item.id]));
  }
  host.innerHTML = parts.join('');
}

// ---- new-spawn worklist ---------------------------------------------------

/* Fresh spawns aren't in the mirror yet, so they can't be stockpiled — they
   need to enter the ecosystem THROUGH SWGAide (swgtracker pulls from Aide;
   adding them directly would cut Aide users out of the loop). The worklist
   collects scanned new spawns — batch up ten, fill in the class each one
   belongs to, and copy paste-ready lines for the SWGAide submit file:
     [planet(s), ]Name , Resource Class, stat1 stat2 ...
   Stats stay in scanned (= in-game display) order, which is what Aide expects.
   Persisted in shell config so a restart doesn't lose the batch. */

// Restoration's planet set. SWGAide's submit line wants space-separated
// lowercase tokens, so multi-word names collapse ("Yavin IV" → yavin4).
const SCAN_PLANETS = ['Corellia', 'Dantooine', 'Dathomir', 'Endor', 'Kashyyyk',
  'Lok', 'Mustafar', 'Naboo', 'Rori', 'Talus', 'Tatooine', 'Yavin IV'];
const SCAN_PLANET_TOKENS = { 'Yavin IV': 'yavin4' };
const scanPlanetToken = (p) => SCAN_PLANET_TOKENS[p] || p.toLowerCase();

async function wlLoad() {
  try {
    const res = await api().get_config();
    const raw = (res.ok && Array.isArray(res.data.scan_worklist)) ? res.data.scan_worklist : [];
    // planets was a free-text string in the first cut — normalize to an array
    scanState.worklist = raw.map((w) => ({
      ...w,
      planets: Array.isArray(w.planets)
        ? w.planets
        : String(w.planets || '').split(/[\s,]+/).filter(Boolean),
    }));
  } catch (_) { scanState.worklist = []; }
}

async function wlSave() {
  try { await api().set_config('scan_worklist', scanState.worklist); } catch (_) {}
}

function wlPlanetLabel(w) {
  if (!w.planets.length) return 'Pick planet(s)…';
  return w.planets.map((p) => p === 'Yavin IV' ? 'Yavin' : p).join(', ');
}

function renderWorklist() {
  const wrap = $('#scan-wl-wrap');
  const host = $('#scan-worklist');
  const list = scanState.worklist;
  wrap.hidden = !list.length;
  $('#scan-wl-count').textContent = list.length ? `(${list.length})` : '';
  if (!list.length) { host.innerHTML = ''; return; }
  host.innerHTML = list.map((w) => `
    <div class="scan-wl-row" data-wlid="${w.id}">
      ${w.image
        ? `<img class="scan-wl-thumb" src="${w.image}" alt="capture" data-zoom title="Click to zoom">`
        : '<span class="scan-wl-thumb scan-wl-nothumb"><i class="fa-solid fa-image"></i></span>'}
      <input class="form-control filter-input" data-wlfield="name"
             value="${escapeHtml(w.name || '')}" placeholder="Name" spellcheck="false">
      <div class="cselect scan-wl-combo" data-wlcls>
        <button type="button" class="cselect-btn">
          <span class="scan-wl-cls-cur ${w.klass ? '' : 'scan-wl-unset'}">${escapeHtml(w.klass || 'Pick class…')}</span>
          <i class="fa-solid fa-caret-down"></i></button>
        <div class="cselect-menu scan-wl-menu" hidden>
          <div class="cselect-search">
            <input type="text" class="form-control filter-input cselect-input" data-wlclsfilter
                   placeholder="Type to filter — e.g. gemstone" autocomplete="off" spellcheck="false">
          </div>
          <div data-wlclsopts></div>
        </div>
      </div>
      <div class="cselect scan-wl-combo" data-wlpl>
        <button type="button" class="cselect-btn">
          <span class="scan-wl-pl-cur ${w.planets.length ? '' : 'scan-wl-unset'}">${escapeHtml(wlPlanetLabel(w))}</span>
          <i class="fa-solid fa-caret-down"></i></button>
        <div class="cselect-menu scan-wl-menu scan-wl-pl-menu" hidden>
          ${SCAN_PLANETS.map((p) => `<label class="scan-wl-pl-opt">
            <input type="checkbox" value="${escapeHtml(p)}" ${w.planets.includes(p) ? 'checked' : ''}> ${escapeHtml(p)}
          </label>`).join('')}
        </div>
      </div>
      <div class="scan-wl-statwrap">
        <input class="form-control filter-input" data-wlfield="stats"
               value="${escapeHtml(w.stats || '')}" spellcheck="false" placeholder="Stats">
        <span class="scan-wl-order" title="The order the stats were scanned in — how they'll be submitted">${escapeHtml(w.order || '')}</span>
      </div>
      <button class="btn btn-icon" data-wlremove="${w.id}" title="Remove from worklist">
        <i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');
}

// Options for one row's class menu, filtered. Depth-indented like the site's
// dropdown when unfiltered; flat matches when a query narrows it.
function wlRenderClassOpts(optsHost, query = '') {
  if (!scanState.classNodes) {
    optsHost.innerHTML = '<div class="mysd-opt-none">Loading classes… (needs one online sync)</div>';
    return;
  }
  const q = query.trim().toLowerCase();
  const rows = q
    ? scanState.classNodes.filter((n) => n.desc.toLowerCase().includes(q)).slice(0, 200)
    : scanState.classNodes;
  optsHost.innerHTML = rows.map((n) =>
    `<div class="mysd-opt" data-clsdesc="${escapeHtml(n.desc)}">${q ? '' : '&nbsp; '.repeat(n.depth)}${escapeHtml(n.desc)}</div>`
  ).join('') || '<div class="mysd-opt-none">No classes match.</div>';
}

function wlCloseMenus() {
  document.querySelectorAll('.scan-wl-menu').forEach((m) => { m.hidden = true; });
}

function wlExportLines() {
  const ready = [], missing = [];
  for (const w of scanState.worklist) {
    const name = (w.name || '').trim(), klass = (w.klass || '').trim();
    const stats = (w.stats || '').trim();
    const planets = (w.planets || []).map(scanPlanetToken).join(' ');
    if (!name || !klass) { missing.push(w); continue; }
    const body = `${name} , ${klass}, ${stats}`;
    ready.push(planets ? `${planets}, ${body}` : body);
  }
  return { ready, missing };
}

// ---- config row -----------------------------------------------------------

/* Config lives in a dev-only Settings section (#set-scan-section); the
   Scanner page keeps only the queue + action buttons. */
function renderScanConfig() {
  const c = scanState.cfg || {};
  const off = c.available === false;
  $('#scan-unavailable').hidden = !off; // scanner-page hint
  $('#scan-unsupported').hidden = !off; // settings-section hint
  $('#scan-controls').hidden = off;
  if (off) return;
  $('#scan-enable').checked = !!c.enabled;
  $('#scan-hotkey').value = c.hotkey || '';
  $('#scan-frame-hotkey-row').hidden = !('frame_hotkey' in c); // older shells
  $('#scan-frame-hotkey').value = c.frame_hotkey || '';
  const hasSound = 'sound_enabled' in c; // older shells: no sound prefs — hide
  $('#scan-sound-enable').closest('.form-check').hidden = !hasSound;
  $('#scan-sound-row').hidden = !hasSound;
  if (hasSound) {
    $('#scan-sound-enable').checked = !!c.sound_enabled;
    const sel = $('#scan-sound');
    sel.innerHTML = (c.sounds || []).map((s) =>
      `<option value="${s}">${s[0].toUpperCase()}${s.slice(1)}</option>`).join('');
    sel.value = c.sound || '';
    sel.disabled = $('#scan-sound-preview').disabled = !c.sound_enabled;
  }
}

async function scanPushConfig(patch) {
  try {
    const res = await api().scan_set_config(patch);
    if (res.ok) scanState.cfg = res.data;
  } catch (_) { /* shell too old */ }
  renderScanConfig();
}

// ---- lifecycle ------------------------------------------------------------

async function loadScanConfig() {
  try {
    const res = await api().scan_get_config();
    scanState.cfg = (res.ok && res.data) || { available: false };
  } catch (_) { scanState.cfg = { available: false }; } // pre-scanner shell
  renderScanConfig();
}

async function loadScanner() {
  await loadScanConfig();
  await wlLoad();
  renderWorklist();
  if (!scanState.classNodes) {
    // full class tree down to exact types — the worklist's class picker
    fetchCategoryNodes(true).then((nodes) => { if (nodes) scanState.classNodes = nodes; });
  }
  await refreshScanQueue(true);
  // poll while the page is open — captures land from the hotkey at any time
  clearInterval(scanState.timer);
  scanState.timer = setInterval(() => {
    if ($('#page-scanner').classList.contains('active')) refreshScanQueue();
  }, 3000);
}

async function refreshScanQueue(force = false) {
  try {
    const res = await api().scan_queue();
    if (!res.ok) return;
    const had = scanState.queue.map((q) => q.id).join(',');
    scanState.queue = res.data || [];
    // force covers first paint: an empty queue "hasn't changed" but the empty
    // state still needs to render — a blank page reads as broken.
    if (force || scanState.queue.map((q) => q.id).join(',') !== had) await renderScanQueue();
  } catch (_) { /* shell too old */ }
}

function initScanner() {
  $('#scan-enable').addEventListener('change', (e) => scanPushConfig({ enabled: e.target.checked }));
  $('#scan-hotkey').addEventListener('blur', (e) => {
    const v = e.target.value.trim();
    if (v) scanPushConfig({ hotkey: v });
  });
  $('#scan-frame-hotkey').addEventListener('blur', (e) => {
    const v = e.target.value.trim();
    if (v) scanPushConfig({ frame_hotkey: v });
  });
  $('#scan-sound-enable').addEventListener('change', (e) => scanPushConfig({ sound_enabled: e.target.checked }));
  $('#scan-sound').addEventListener('change', (e) => {
    scanPushConfig({ sound: e.target.value });
    try { api().scan_play_sound({ sound: e.target.value }); } catch (_) {} // instant preview
  });
  $('#scan-sound-preview').addEventListener('click', () => {
    try { api().scan_play_sound({ sound: $('#scan-sound').value }); } catch (_) {}
  });
  $('#scan-frame').addEventListener('click', () => { try { api().scan_show_frame(); } catch (_) {} });
  $('#scan-now').addEventListener('click', async () => {
    try { await api().scan_capture_now(); } catch (_) {}
    refreshScanQueue();
  });

  const finishScan = async (id) => {
    try { await api().scan_queue_remove(id); } catch (_) {}
    scanState.queue = scanState.queue.filter((q) => q.id !== id);
    delete scanState.matches[id];
    delete scanState.pendingQty[id];
    renderScanQueue();
  };

  $('#scan-queue').addEventListener('click', async (e) => {
    const appr = e.target.closest('[data-approve]');
    if (appr) {
      const id = safeInt(appr.dataset.approve);
      const sel = document.querySelector(`[data-pickfor="${id}"]`);
      const match = (scanState.matches[id] || [])[safeInt(sel ? sel.value : 0)];
      if (!match) return;
      const item = scanState.queue.find((q) => q.id === id);
      const parsed = item ? parseScan(item.lines) : { qty: null };
      // Already stockpiled? Adding again is a QUANTITY decision, not an add —
      // ask inline whether to add the scanned amount to what's tracked.
      const stk = (typeof stkState !== 'undefined')
        ? stkState.items.find((i) => String(i.id) === String(match.id)) : null;
      if (stk) {
        if (!parsed.qty) {
          toast(`${match.name} is already in your stockpile — nothing to add (no quantity read)`);
          finishScan(id);
          return;
        }
        const have = Number(stk.stock) || 0;
        scanState.pendingQty[id] = { sid: stk.stockpile_id, have, qty: parsed.qty, name: match.name };
        appr.closest('.scan-item').querySelector('.scan-actions').innerHTML = `
          <span class="scan-qty-ask">Already in stockpile${have ? ` with <b>${fmtNum(have)}</b>` : ''}
            — add the scanned <b>${fmtNum(parsed.qty)}</b>${have ? ` for ${fmtNum(have + parsed.qty)} total` : ''}?</span>
          <button class="btn btn-sm btn-accent" data-addqty="${id}">Add ${fmtNum(parsed.qty)}</button>
          <button class="btn btn-sm btn-outline-secondary" data-skipqty="${id}">Don't add</button>`;
        return;
      }
      // Wishlisted resources get PROMOTED by addToStockpile inside the dialog
      // flow; the dialog (amount pre-filled with the scanned quantity, still
      // editable/clearable) IS the "want the found amount?" ask.
      openStockpileAddDialog(match.id, match.name, () => finishScan(id),
                            { stock: parsed.qty });
      return;
    }
    const addq = e.target.closest('[data-addqty]');
    if (addq) {
      const id = safeInt(addq.dataset.addqty);
      const p = scanState.pendingQty[id];
      if (!p) return;
      try {
        const res = await api().update_stockpile(p.sid, p.have + p.qty);
        if (res && res.ok) {
          toast(`${p.name}: amount ${fmtNum(p.have + p.qty)} (added ${fmtNum(p.qty)})`);
          syncStockpile();
        } else {
          toast(`Couldn't update ${p.name}: ${(res && res.error) || 'server error'}`, false);
        }
      } catch (err) { toast(`Couldn't update ${p.name}: ${err}`, false); }
      finishScan(id);
      return;
    }
    const skipq = e.target.closest('[data-skipqty]');
    if (skipq) {
      const id = safeInt(skipq.dataset.skipqty);
      const p = scanState.pendingQty[id];
      if (p) toast(`${p.name}: amount left unchanged`);
      finishScan(id);
      return;
    }
    const ns = e.target.closest('[data-newspawn]');
    if (ns) {
      const id = safeInt(ns.dataset.newspawn);
      const item = scanState.queue.find((q) => q.id === id);
      if (!item) return;
      if (scanState.worklist.length >= 30) {
        toast('Worklist is full (30) — copy the SWGAide lines and clear it first', false);
        return;
      }
      const parsed = parseScan(item.lines);
      // The capture IMAGE moves onto the worklist row (zoomable there), so
      // the scan isn't lost when the queue card resolves.
      scanState.worklist.push({
        id: Date.now(),
        name: parsed.name, klass: parsed.klass, planets: [],
        stats: parsed.statsOrder.map(([, v]) => v).join(' '),
        order: parsed.statsOrder.map(([k]) => k.toUpperCase()).join(' '),
        image: item.image,
      });
      wlSave();
      renderWorklist();
      toast(`${parsed.name || 'Capture'} queued as a new spawn — pick its class below`);
      finishScan(id);
      return;
    }
    const disc = e.target.closest('[data-discard]');
    if (disc) finishScan(safeInt(disc.dataset.discard));
  });

  // ---- worklist events
  const wlRowOf = (el) => {
    const row = el.closest('[data-wlid]');
    return row ? scanState.worklist.find((x) => String(x.id) === row.dataset.wlid) : null;
  };
  $('#scan-worklist').addEventListener('change', (e) => {
    const w = wlRowOf(e.target);
    if (!w) return;
    if (e.target.dataset.wlfield) {
      w[e.target.dataset.wlfield] = e.target.value;
      wlSave();
      return;
    }
    if (e.target.type === 'checkbox') { // planet multi-select — stays open
      const p = e.target.value;
      w.planets = e.target.checked
        ? [...w.planets, p] : w.planets.filter((x) => x !== p);
      w.planets.sort((a, b) => SCAN_PLANETS.indexOf(a) - SCAN_PLANETS.indexOf(b));
      const cur = e.target.closest('[data-wlpl]').querySelector('.scan-wl-pl-cur');
      cur.textContent = wlPlanetLabel(w);
      cur.classList.toggle('scan-wl-unset', !w.planets.length);
      wlSave();
    }
  });
  $('#scan-worklist').addEventListener('input', (e) => {
    if (e.target.dataset.wlclsfilter !== undefined) {
      wlRenderClassOpts(e.target.closest('.scan-wl-menu').querySelector('[data-wlclsopts]'),
                        e.target.value);
    }
  });
  $('#scan-worklist').addEventListener('click', (e) => {
    const rm = e.target.closest('[data-wlremove]');
    if (rm) {
      scanState.worklist = scanState.worklist.filter((x) => String(x.id) !== rm.dataset.wlremove);
      wlSave();
      renderWorklist();
      return;
    }
    const opt = e.target.closest('[data-clsdesc]');
    if (opt) {
      const w = wlRowOf(opt);
      if (w) {
        w.klass = opt.dataset.clsdesc;
        const cur = opt.closest('[data-wlcls]').querySelector('.scan-wl-cls-cur');
        cur.textContent = w.klass;
        cur.classList.remove('scan-wl-unset');
        wlSave();
      }
      wlCloseMenus();
      return;
    }
    const btn = e.target.closest('.cselect-btn');
    if (btn) {
      const menu = btn.parentElement.querySelector('.scan-wl-menu');
      const wasHidden = menu.hidden;
      wlCloseMenus();
      menu.hidden = !wasHidden;
      if (!menu.hidden && btn.parentElement.hasAttribute('data-wlcls')) {
        const filter = menu.querySelector('[data-wlclsfilter]');
        filter.value = '';
        wlRenderClassOpts(menu.querySelector('[data-wlclsopts]'));
        filter.focus();
      }
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.scan-wl-combo')) wlCloseMenus();
  });

  // ---- capture zoom — the crops are small; blow them up to readable size
  document.addEventListener('click', (e) => {
    const zoomable = e.target.closest('#page-scanner .scan-shot, #page-scanner [data-zoom]');
    if (zoomable && zoomable.src) {
      const img = $('#scan-zoom-img');
      img.src = zoomable.src;
      img.style.width = '';
      img.onload = () => {
        img.style.width = `${Math.min(img.naturalWidth * 3, window.innerWidth * 0.92)}px`;
      };
      $('#scan-zoom').hidden = false;
      return;
    }
    if (!$('#scan-zoom').hidden && e.target.closest('#scan-zoom') !== null) {
      $('#scan-zoom').hidden = true;
    }
  });
  $('#scan-wl-copy').addEventListener('click', async () => {
    const { ready, missing } = wlExportLines();
    if (!ready.length) {
      toast(missing.length ? 'Nothing to copy yet — rows need a name and a resource class' : 'Worklist is empty', false);
      return;
    }
    try {
      await navigator.clipboard.writeText(ready.join('\n') + '\n');
      toast(`${ready.length} SWGAide line(s) copied${missing.length ? ` — ${missing.length} skipped (missing name/class)` : ''}`);
    } catch (_) { toast('Clipboard copy failed', false); }
  });
  $('#scan-wl-clear').addEventListener('click', (e) => {
    if (!confirmArmLabeled(e.currentTarget, `Clear all ${scanState.worklist.length}?`)) return;
    scanState.worklist = [];
    wlSave();
    renderWorklist();
  });
}
