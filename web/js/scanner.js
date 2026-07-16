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

const scanState = { cfg: null, queue: [], matches: {}, timer: null };

// ---- parsing --------------------------------------------------------------

// Digits only, fixing the confusables OCR actually produces INSIDE numbers.
// Conservative on purpose: only O/o->0 and l/I/|->1 — anything else stays and
// fails validation visibly rather than being silently "corrected".
function scanNumber(raw) {
  const fixed = String(raw).replace(/[Oo]/g, '0').replace(/[lI|]/g, '1').replace(/[^\d]/g, '');
  if (!fixed) return null;
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
// label to the nearest known stat name instead of demanding exact text.
function scanStatKey(label) {
  const l = label.trim().toLowerCase();
  if (SCAN_STATS[l]) return SCAN_STATS[l];
  let best = null, bestD = Infinity;
  for (const known of Object.keys(SCAN_STATS)) {
    const d = scanLevenshtein(l, known);
    if (d < bestD) { bestD = d; best = known; }
  }
  return bestD <= 3 ? SCAN_STATS[best] : null;
}

// Raw OCR lines -> {name, klass, stats:{oq:...}, unparsed:[...]}
function parseScan(lines) {
  const texts = lines.map((l) => String(l.text || '').trim()).filter(Boolean);
  const out = { name: '', klass: '', stats: {}, unparsed: [] };
  for (const t of texts) {
    const kv = t.match(/^(.+?)\s*[:;]\s*(.*)$/);
    if (!kv) {
      // the first free line is the examine window's title = the resource name
      if (!out.name && !/unrefined|natural resource|examine/i.test(t)) out.name = t;
      continue;
    }
    const [, label, value] = kv;
    if (/resource class/i.test(label)) { out.klass = value.trim(); continue; }
    const key = scanStatKey(label);
    if (!key) { out.unparsed.push(t); continue; }
    const n = scanNumber(value);
    if (n === null) out.unparsed.push(t); // label read, number didn't — flag it
    else out.stats[key] = n;
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
      <div class="scan-stats">${scanStatChips(parsed, picked)}</div>
      ${parsed.unparsed.length ? `<div class="scan-warn" title="${escapeHtml(parsed.unparsed.join(' · '))}">
          ${parsed.unparsed.length} line(s) didn't parse — check the capture</div>` : ''}
      ${matches.length
        ? `<select class="form-select filter-select scan-pick" data-pickfor="${item.id}">${options}</select>`
        : '<div class="scan-warn">No match found in the resource mirror.</div>'}
      <div class="scan-actions">
        <button class="btn btn-sm btn-accent" data-approve="${item.id}" ${matches.length ? '' : 'disabled'}>
          <i class="fa-solid fa-check"></i> Add to stockpile</button>
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

  $('#scan-queue').addEventListener('click', async (e) => {
    const appr = e.target.closest('[data-approve]');
    if (appr) {
      const id = safeInt(appr.dataset.approve);
      const sel = document.querySelector(`[data-pickfor="${id}"]`);
      const match = (scanState.matches[id] || [])[safeInt(sel ? sel.value : 0)];
      if (!match) return;
      // The existing stockpile dialog handles amount + CPU; on done the
      // capture leaves the queue.
      openStockpileAddDialog(match.id, match.name, async () => {
        try { await api().scan_queue_remove(id); } catch (_) {}
        scanState.queue = scanState.queue.filter((q) => q.id !== id);
        delete scanState.matches[id];
        renderScanQueue();
      });
      return;
    }
    const disc = e.target.closest('[data-discard]');
    if (disc) {
      const id = safeInt(disc.dataset.discard);
      try { await api().scan_queue_remove(id); } catch (_) {}
      scanState.queue = scanState.queue.filter((q) => q.id !== id);
      delete scanState.matches[id];
      renderScanQueue();
    }
  });
}
