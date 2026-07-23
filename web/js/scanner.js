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
                    edits: {}, editing: null, worklist: [], timer: null };

// Newer shells OCR every capture TWICE with different preprocessing — the
// passes misread different glyphs. Merge: gaps fill from the alt pass, and a
// digit the passes disagree on becomes an explicit ALTERNATE (altStats) that
// matching may accept — the resource fingerprint settles which reading is
// real, instead of us guessing.
function scanMergeParses(a, b) {
  if (!b) return a;
  const out = { ...a, altStats: {}, altName: '' };
  if (!out.name && b.name) out.name = b.name;
  else if (b.name && b.name !== a.name) out.altName = b.name;
  if (!out.klass && b.klass) out.klass = b.klass;
  if (out.qty == null && b.qty != null) out.qty = b.qty;
  for (const [k, v] of Object.entries(b.stats)) {
    if (a.stats[k] == null) { out.stats[k] = v; out.statsOrder.push([k, v]); }
    else if (a.stats[k] !== v) out.altStats[k] = v;
  }
  // one pass reading a line cleanly is enough — warn on the better of the two
  if (b.unparsed.length < a.unparsed.length) out.unparsed = b.unparsed;
  return out;
}

// User corrections layered over the OCR parse — when the engine misreads a
// name or digit, fix it on the card instead of rescanning.
function scanParsed(item) {
  const parsed = scanMergeParses(parseScan(item.lines),
    Array.isArray(item.alt_lines) && item.alt_lines.length ? parseScan(item.alt_lines) : null);
  const e = scanState.edits[item.id];
  if (!e) return parsed;
  if (e.name !== undefined) parsed.name = e.name;
  if (e.qty !== undefined) parsed.qty = e.qty;
  for (const [k, v] of Object.entries(e.stats || {})) {
    if (v === null) { delete parsed.stats[k]; }
    else {
      parsed.stats[k] = v;
      const at = parsed.statsOrder.findIndex(([sk]) => sk === k);
      if (at >= 0) parsed.statsOrder[at] = [k, v];
      else parsed.statsOrder.push([k, v]);
    }
  }
  return parsed;
}

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

// The game font's 8 sometimes OCRs as the letter S, which the confusable map
// reads as 5 — so 814 can arrive as a plausible-looking 514. A parsed number
// and a candidate's number are "compatible" when they differ only by 5↔8 at
// single positions; the rest of the stat fingerprint (plus name and class)
// carries the proof, and the chip explains the substitution instead of
// flagging a false mismatch.
function scanStatCompatible(parsed, cand) {
  if (parsed === cand) return true;
  const a = String(parsed), b = String(cand);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] === b[i]) continue;
    if (!((a[i] === '5' && b[i] === '8') || (a[i] === '8' && b[i] === '5'))) return false;
  }
  return true;
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

// Narrow examine windows (smaller UI scale) wrap values under their labels,
// so OCR emits "Resource Quantity:" and "406960/1000000" as SEPARATE lines —
// the bare label can't parse and the bare value poisons the name fallback.
// Rejoin: a line ending in ':' adopts the next line when that line isn't
// itself a labeled one.
function scanJoinSplitLines(texts) {
  const out = [];
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    const next = texts[i + 1];
    if (/[:;=]\s*$/.test(t) && next && !/[:;=]/.test(next)) {
      out.push(`${t} ${next}`);
      i++;
      continue;
    }
    out.push(t);
  }
  return out;
}

// OCR sometimes eats the colon entirely ("Resource Type Ismesrith") — try to
// recover a LABEL + VALUE split by testing the first 1–3 words against the
// known labels. Free prose never matches (all labels are ≥4-char names with
// fuzzy distance ≤3), so real sentences fall through untouched.
function scanLostSeparator(t) {
  const words = t.split(/\s+/);
  for (const n of [3, 2, 1]) {
    if (words.length <= n) continue;
    const label = words.slice(0, n).join(' ');
    if (scanNearestLabel(label, SCAN_META) !== null || scanStatKey(label) !== null) {
      return [label, words.slice(n).join(' ')];
    }
  }
  return null;
}

// Raw OCR lines -> {name, klass, stats:{oq:...}, unparsed:[...]}
function parseScan(lines) {
  const texts = scanJoinSplitLines(
    lines.map((l) => String(l.text || '').trim()).filter(Boolean));
  // statsOrder keeps the stats in the order the game DISPLAYED them (top to
  // bottom) — that's the order SWGAide's submit file expects them in.
  const out = { name: '', klass: '', qty: null, stats: {}, statsOrder: [], unparsed: [] };
  let klassAt = -1; // a long class wraps: the NEXT line may be its tail
  for (let i = 0; i < texts.length; i++) {
    const t = texts[i];
    // ':' examine window, '=' vet-reward crate dialog, ';' OCR's take on either
    const kv = t.match(/^(.+?)\s*[:;=]\s*(.*)$/);
    let label, value;
    if (kv) { [, label, value] = kv; }
    else {
      const rec = scanLostSeparator(t);
      if (rec) [label, value] = rec;
    }
    if (label === undefined) {
      if (i === klassAt + 1 && out.klass && /^[A-Za-z][A-Za-z ]{2,30}$/.test(t)) {
        out.klass += ` ${t}`; // "Green Diamond Cryst" + "Gemstone"
      } else if (!out.name && !/unrefined|natural resource|examine|standard|this container/i.test(t)
                 && !/^[\d\s.,/|]+$/.test(t) && !/^[A-Z\s]+$/.test(t)) {
        // free-line fallback — but never a numbers-only strayed value, and
        // never the ALL-CAPS window title (that's the class, not the name)
        out.name = t;
      }
      continue;
    }
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
  // CLASS searches first — the mirror search matches type_name, so the parsed
  // class defines the right candidate pool even when the name is mangled, and
  // the stat fingerprint identifies the exact resource within it. Name tries
  // come after; the desperate 3-char slice runs LAST so it can't flood the
  // pool and starve the class query (it once buried the real match under
  // thirty name-lookalikes from the wrong class).
  const tries = [parsed.klass, (parsed.klass || '').slice(0, 12),
                 parsed.name, parsed.name.slice(0, 5), parsed.name.slice(0, 3)]
    .map((s) => (s || '').trim()).filter((s) => s.length >= 3);
  for (const search of [...new Set(tries)]) {
    try {
      const res = await api().ds_resources_query({ search, status: '', limit: 40, fields });
      for (const r of (res.ok && res.data) || []) seen.set(r.id, r);
    } catch (_) { /* mirror missing — handled below */ }
    if (seen.size >= 60) break;
  }
  const parsedStats = Object.entries(parsed.stats)
    .filter(([k]) => SCAN_MATCH_STATS.includes(k));
  const scored = [...seen.values()].map((r) => {
    let statHits = 0;
    for (const [k, v] of parsedStats) {
      const cv = Number(r[k]);
      const alt = parsed.altStats ? parsed.altStats[k] : null;
      if (cv === v || (alt != null && cv === alt) || scanStatCompatible(v, cv)) statHits++;
    }
    const sim = Math.max(scanNameSim(parsed.name, r.name || ''),
                         parsed.altName ? scanNameSim(parsed.altName, r.name || '') : 0);
    const kSim = parsed.klass ? scanNameSim(parsed.klass, r.type_name || '') : 0;
    return { ...r, statHits, statTotal: parsedStats.length, sim, kSim,
             score: statHits * 2 + sim * 3 + kSim * 2 };
  }).filter((r) => {
    // stat tuples are fingerprints — don't SUGGEST things that don't fit:
    // zero hits on a 4+-stat scan is disqualifying, and one coincidental hit
    // can't carry a candidate whose name AND class both look nothing like it
    if (r.statTotal >= 4 && r.statHits === 0) return false;
    if (r.statTotal >= 3 && r.statHits <= 1 && r.kSim < 0.5 && r.sim < 0.6) return false;
    return true;
  }).sort((a, b) => b.score - a.score);
  return scored.slice(0, 5);
}

// ---- rendering ------------------------------------------------------------

function scanStatChips(parsed, cand) {
  return SCAN_MATCH_STATS.map((k) => {
    const v = parsed.stats[k];
    if (v == null) return '';
    const cv = cand ? Number(cand[k]) : null;
    const exact = cand ? cv === v : null;
    const alt = parsed.altStats ? parsed.altStats[k] : null;
    if (cand && !exact && alt != null && cv === alt) {
      // the two OCR passes disagreed and the MATCH confirms the alt reading
      return `<span class="scan-stat scan-stat-fuzzy"
        title="${k.toUpperCase()} — the two OCR passes read ${v} and ${alt}; the match confirms ${cv}">
        ${k.toUpperCase()} ${cv}*</span>`;
    }
    const fuzzy = cand && !exact && scanStatCompatible(v, cv);
    if (fuzzy) {
      // 5↔8 font ambiguity, resolved by the rest of the fingerprint — show
      // the MATCH's number, since that's what the resource really has
      return `<span class="scan-stat scan-stat-fuzzy"
        title="${k.toUpperCase()} — OCR read ${v}, but 5 and 8 look alike in the game font; the match has ${cv}">
        ${k.toUpperCase()} ${cv}*</span>`;
    }
    return `<span class="scan-stat ${exact === null ? '' : exact ? 'scan-stat-ok' : 'scan-stat-bad'}"
              title="${k.toUpperCase()}${exact === false ? ` — match has ${cand[k] ?? '—'}` : ''}">
              ${k.toUpperCase()} ${v}</span>`;
  }).join('');
}

function scanItemHtml(item, parsed, matches) {
  if (scanState.editing === item.id) {
    // edit mode: every OCR'd value is overridable before approving
    return `<div class="scan-item" data-scanid="${item.id}">
      <img class="scan-shot" src="${item.image}" alt="capture" title="What the scanner saw">
      <div class="scan-body">
        <div class="scan-editrow">
          <input class="form-control filter-input" data-scanedit="name" value="${escapeHtml(parsed.name || '')}"
                 placeholder="Resource name" spellcheck="false">
          <input class="form-control filter-input scan-editqty" data-scanedit="qty"
                 value="${parsed.qty || ''}" placeholder="Qty" spellcheck="false">
        </div>
        <div class="scan-editstats">
          ${SCAN_MATCH_STATS.map((k) => `<label class="scan-editstat">${k.toUpperCase()}
            <input class="form-control filter-input" data-scaneditstat="${k}"
                   value="${parsed.stats[k] ?? ''}" spellcheck="false"></label>`).join('')}
        </div>
        <div class="scan-actions">
          <button class="btn btn-sm btn-accent" data-editapply="${item.id}"><i class="fa-solid fa-check"></i> Apply</button>
          <button class="btn btn-sm btn-outline-secondary" data-editcancel="${item.id}">Cancel</button>
        </div>
      </div>
    </div>`;
  }
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
        <button class="btn btn-sm btn-outline-secondary" data-editcap="${item.id}"
          title="OCR misread something? Correct the name, stats or quantity by hand">
          <i class="fa-solid fa-pen"></i> Edit</button>
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
    const parsed = scanParsed(item);
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

// planetary classes name their world in the first word ("Rori Berry Fruit",
// "Corellian Wild Wheat") — that decides the spawn's planet with no clicking
const SCAN_CLASS_PLANET = {
  corellian: 'Corellia', dantooine: 'Dantooine', dathomirian: 'Dathomir',
  endorian: 'Endor', kashyyykian: 'Kashyyyk', lokian: 'Lok',
  mustafarian: 'Mustafar', nabooian: 'Naboo', rori: 'Rori',
  talusian: 'Talus', tatooinian: 'Tatooine', yavinian: 'Yavin IV',
};
function scanClassPlanet(klass) {
  const first = String(klass || '').trim().split(/\s+/)[0].toLowerCase();
  return SCAN_CLASS_PLANET[first] || null;
}

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
  const host = $('#scan-worklist');
  const list = scanState.worklist;
  // header button: the way IN to the dialog — visible only when there's work
  $('#scan-wl-open').hidden = !list.length;
  $('#scan-wl-count').textContent = list.length ? `(${list.length})` : '';
  $('#scan-wl-count2').textContent = list.length ? `(${list.length})` : '';
  if (!list.length) {
    host.innerHTML = '';
    $('#scan-wl-modal').hidden = true; // last row removed/cleared — nothing to show
    return;
  }
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

// Snap OCR class text to the official tree entry — exact (case-insensitive)
// first, then best fuzzy, so a clean scan preselects the class and an OCR
// wrap/typo still lands on the right node instead of forcing a manual pick.
function scanCanonicalClass(text) {
  if (!text || !scanState.classNodes) return null;
  const t = String(text).trim().toLowerCase();
  const exact = scanState.classNodes.find((n) => n.desc.toLowerCase() === t);
  if (exact) return exact.desc;
  let best = null, bestSim = 0;
  for (const n of scanState.classNodes) {
    const s = scanNameSim(t, n.desc.toLowerCase());
    if (s > bestSim) { bestSim = s; best = n.desc; }
  }
  return bestSim >= 0.72 ? best : null;
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

// The shared .cselect-menu is position:fixed so it escapes the dialog's scroll
// clip — anchor it to its button and flip above when the bottom lacks room.
function wlAnchorMenu(btn, menu) {
  const r = btn.getBoundingClientRect();
  menu.style.left = `${r.left}px`;
  menu.style.minWidth = `${r.width}px`;
  menu.style.maxHeight = '';
  menu.hidden = false;
  const below = window.innerHeight - r.bottom - 10;
  const wanted = Math.min(menu.scrollHeight, 320);
  if (below >= Math.min(wanted, 160)) {
    menu.style.top = `${r.bottom + 3}px`;
    menu.style.maxHeight = `${Math.min(wanted, below)}px`;
  } else {
    const h = Math.min(wanted, r.top - 10);
    menu.style.top = `${r.top - h - 3}px`;
    menu.style.maxHeight = `${h}px`;
  }
}

function wlExportLines() {
  const ready = [], missing = [];
  for (const w of scanState.worklist) {
    const name = (w.name || '').trim(), klass = (w.klass || '').trim();
    const stats = (w.stats || '').trim();
    const planets = (w.planets || []).map(scanPlanetToken).join(' ');
    if (!name || !klass) { missing.push(w); continue; }
    const body = `${name}, ${klass}, ${stats}`;
    ready.push(planets ? `${planets}, ${body}` : body);
  }
  return { ready, missing };
}

// ---- config row -----------------------------------------------------------

/* Config lives in its Settings section (#set-scan-section); the Scanner page
   keeps only the queue + action buttons. */
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
  $('#scan-frame').addEventListener('click', async () => {
    // Positioning the outline IS the intent to scan — quietly flip the enable
    // toggle so the hotkey arms too. Users kept positioning, then wondering
    // why the hotkey was dead (the toggle lives two pages away in Settings).
    if (scanState.cfg && scanState.cfg.available !== false && !scanState.cfg.enabled) {
      await scanPushConfig({ enabled: true });
      const hk = (scanState.cfg && scanState.cfg.hotkey) || 'the scan hotkey';
      toast(`Scanning enabled — ${hk} is now armed`);
    }
    try { api().scan_show_frame(); } catch (_) { /* shell too old */ }
  });
  $('#scan-now').addEventListener('click', async () => {
    try { await api().scan_capture_now(); } catch (_) {}
    refreshScanQueue();
  });

  const finishScan = async (id) => {
    try { await api().scan_queue_remove(id); } catch (_) {}
    scanState.queue = scanState.queue.filter((q) => q.id !== id);
    delete scanState.matches[id];
    delete scanState.pendingQty[id];
    delete scanState.edits[id];
    if (scanState.editing === id) scanState.editing = null;
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
      const parsed = item ? scanParsed(item) : { qty: null };
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
      const parsed = scanParsed(item);
      // The capture IMAGE moves onto the worklist row (zoomable there), so
      // the scan isn't lost when the queue card resolves.
      // scanned class snaps to the official tree entry when it resolves, and a
      // planetary class (Corellian/Rori/...) preselects its planet
      const klass = scanCanonicalClass(parsed.klass) || parsed.klass;
      const impliedPlanet = scanClassPlanet(klass);
      scanState.worklist.push({
        id: Date.now(),
        name: parsed.name, klass, planets: impliedPlanet ? [impliedPlanet] : [],
        stats: parsed.statsOrder.map(([, v]) => v).join(' '),
        order: parsed.statsOrder.map(([k]) => k.toUpperCase()).join(' '),
        image: item.image,
      });
      wlSave();
      renderWorklist();
      toast(`${parsed.name || 'Capture'} queued — open the New spawn worklist (top right) to finish it`);
      finishScan(id);
      return;
    }
    const editBtn = e.target.closest('[data-editcap]');
    if (editBtn) {
      scanState.editing = safeInt(editBtn.dataset.editcap);
      renderScanQueue();
      return;
    }
    const applyBtn = e.target.closest('[data-editapply]');
    if (applyBtn) {
      const id = safeInt(applyBtn.dataset.editapply);
      const card = applyBtn.closest('.scan-item');
      const edit = { stats: {} };
      edit.name = card.querySelector('[data-scanedit="name"]').value.trim();
      const qraw = card.querySelector('[data-scanedit="qty"]').value.trim();
      edit.qty = qraw === '' ? null : Math.round(parseAmount(qraw)) || null;
      card.querySelectorAll('[data-scaneditstat]').forEach((inp) => {
        const v = inp.value.trim();
        edit.stats[inp.dataset.scaneditstat] = v === '' ? null
          : Math.max(1, Math.min(1000, safeInt(v)));
      });
      scanState.edits[id] = edit;
      delete scanState.matches[id]; // re-match with the corrected values
      scanState.editing = null;
      renderScanQueue();
      return;
    }
    const cancelBtn = e.target.closest('[data-editcancel]');
    if (cancelBtn) {
      scanState.editing = null;
      renderScanQueue();
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
      if (!wasHidden) return;
      if (btn.parentElement.hasAttribute('data-wlcls')) {
        const filter = menu.querySelector('[data-wlclsfilter]');
        const w = wlRowOf(btn);
        filter.value = (w && w.klass) || ''; // open narrowed to the scanned class
        wlRenderClassOpts(menu.querySelector('[data-wlclsopts]'), filter.value);
        wlAnchorMenu(btn, menu);
        filter.focus();
        filter.select(); // typing immediately replaces the prefill
      } else {
        wlAnchorMenu(btn, menu);
      }
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.scan-wl-combo')) wlCloseMenus();
  });

  // ---- worklist dialog open/close
  $('#scan-wl-open').addEventListener('click', () => { $('#scan-wl-modal').hidden = false; });
  $('#scan-wl-close').addEventListener('click', () => { wlCloseMenus(); $('#scan-wl-modal').hidden = true; });
  bindBackdropClose($('#scan-wl-modal'), () => { wlCloseMenus(); $('#scan-wl-modal').hidden = true; });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    if (!$('#scan-zoom').hidden) $('#scan-zoom').hidden = true;
    else if (!$('#scan-wl-modal').hidden) { wlCloseMenus(); $('#scan-wl-modal').hidden = true; }
  });

  // ---- capture zoom — the crops are small; blow them up to readable size,
  // scaled uniformly (never stretched) and capped to the viewport
  document.addEventListener('click', (e) => {
    const zoomable = e.target.closest('#page-scanner .scan-shot, #page-scanner [data-zoom]');
    if (zoomable && zoomable.src) {
      const img = $('#scan-zoom-img');
      img.style.width = '';
      img.onload = () => {
        const s = Math.min(3, (window.innerWidth * 0.92) / img.naturalWidth,
                           (window.innerHeight * 0.92) / img.naturalHeight);
        img.style.width = `${Math.round(img.naturalWidth * s)}px`;
      };
      img.src = zoomable.src;
      if (img.complete) img.onload(); // cached data-URL: onload may not refire
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
