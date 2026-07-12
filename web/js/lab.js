/* The Laboratory — min/max workbench.
   Pick a schematic + experiment lines; per ingredient slot, browse the class
   pool (stats, weighted rate, eCPU, stockpile) and assign picks. The bench
   computes the unit-weighted composite per experiment line (+ flat crafting
   boosts) against an editable cap threshold — the point is finding the
   CHEAPEST picks that still cap. Experiments (picks + notes) save to config. */

const labState = {
  schematic: null,     // {id, name}
  detail: null,        // schematic payload (formula, resourcesNeeded)
  slots: [],           // [{code, label, className, units, pool, pick}]
  formulas: [],        // [{formulaId, formulaDescription, weights}]
  checked: new Set(),  // selected formulaIds
  boosts: [
    { key: 'ent', label: 'Entertainer inspiration', value: 40, on: false },
    { key: 'bracelet', label: 'Resource bracelet', value: 10, on: false },
  ],
  threshold: 960,
  experiments: [],
  currentExpId: null,  // experiment being edited on the bench (null = unsaved draft)
  draftNotes: '',      // notes for a not-yet-saved experiment
  homeQuery: '',       // free-text filter on the experiments home page
  homeView: 'cards',   // 'cards' | 'grid' — sticky via lab_settings.homeView
  banned: new Set(),   // resource ids hidden from pools/auto-picks ("no vendor supply")
};

const labIsBanned = (r) => labState.banned.has(String(r.id));

const labClamp01k = (v) => Math.max(0, Math.min(1000, v));

// per-buff meter-segment colors (pink = inspiration, cyan = bracelet)
const LAB_BOOST_COLORS = { ent: '#d36aa7', bracelet: '#3fb6c4' };

// Tiny markdown → HTML for notes (escaped first, so it's safe): #/##/### headings,
// **bold**, *italic*, `code`, - and 1. lists, blank-line paragraphs.
function labMdToHtml(md) {
  const esc = escapeHtml(String(md || ''));
  const lines = esc.split('\n');
  const out = [];
  let list = null; // 'ul' | 'ol'
  const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
  for (const raw of lines) {
    const line = raw.trimEnd();
    const inline = (t) => t
      .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
      .replace(/\*(.+?)\*/g, '<i>$1</i>')
      .replace(/`(.+?)`/g, '<code>$1</code>');
    let m;
    if ((m = line.match(/^(#{1,3})\s+(.*)$/))) {
      closeList();
      out.push(`<h${m[1].length + 3}>${inline(m[2])}</h${m[1].length + 3}>`); // h4-h6, page-appropriate
    } else if ((m = line.match(/^[-*]\s+(.*)$/))) {
      if (list !== 'ul') { closeList(); out.push('<ul>'); list = 'ul'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if ((m = line.match(/^\d+[.)]\s+(.*)$/))) {
      if (list !== 'ol') { closeList(); out.push('<ol>'); list = 'ol'; }
      out.push(`<li>${inline(m[1])}</li>`);
    } else if (line === '') {
      closeList();
    } else {
      closeList();
      out.push(`<p>${inline(line)}</p>`);
    }
  }
  closeList();
  return out.join('');
}

// Notes are stored as sanitized HTML (WYSIWYG); old notes were markdown/plain.
const LAB_HTML_ALLOWED = { B: 1, STRONG: 1, I: 1, EM: 1, U: 1, UL: 1, OL: 1, LI: 1, P: 1, DIV: 1, BR: 1, H4: 1, H5: 1, H6: 1, CODE: 1 };
function labSanitizeHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = String(html || '');
  const walk = (node) => {
    [...node.children].forEach((el) => {
      walk(el);
      [...el.attributes].forEach((a) => el.removeAttribute(a.name));
      if (!LAB_HTML_ALLOWED[el.tagName]) el.replaceWith(...el.childNodes);
    });
  };
  walk(tpl.content);
  return tpl.innerHTML;
}
function labNotesHtml(notes) {
  const v = String(notes || '');
  if (!v.trim()) return '';
  // WYSIWYG output can be a bare text node with no tags — but it's still serialized
  // HTML, so a single-line note like "foo&nbsp;" or "a &lt; b" carries entities.
  // Treat anything with a tag OR an HTML entity as HTML; only truly plain legacy
  // notes go through the markdown converter (which escapes, so it must not see entities).
  return /<[a-z][^>]*>|&(?:[a-z]+|#\d+);/i.test(v) ? labSanitizeHtml(v) : labMdToHtml(v);
}

// per-unit cost for the bench: YOUR stockpile cost wins when set (0 = self-mined,
// i.e. free); otherwise the site's clamped eCPU; unvoted resources assume 1.
function labEcpu(r) {
  const mine = labMyCpu(r);
  if (mine !== null) return mine;
  return ecpuClamp(r.cpu, r.status === 1, safeInt(r.planet_mustafar) === 1) || 1;
}

function labMyCpu(r) {
  if (typeof stkState === 'undefined') return null;
  const row = stkState.items.find((i) => String(i.id) === String(r.id));
  const v = row ? row.my_cpu : null;
  return v === null || v === undefined || v === '' ? null : Math.max(0, Number(v));
}

// how many units of this resource you hold (stockpile `stock`); null if not stocked
function labMyStock(r) {
  if (typeof stkState === 'undefined') return null;
  const row = stkState.items.find((i) => String(i.id) === String(r.id));
  if (!row) return null;
  const v = Number(row.stock);
  return Number.isFinite(v) ? v : null;
}

// ---- math ----

// stats normalize against the SLOT's required class caps (the game's math) —
// pass the slot so e.g. SR 475 in a Beyrllius Copper slot (cap 483) rates ~983
function labSlotCaps(slot) {
  return typeof classCaps === 'function' ? classCaps(slot && slot.code) : null;
}

function labQ(res, weights, slot = null) {
  const q = weightedQuality(res, [weights], labSlotCaps(slot));
  return q == null ? 0 : q;
}

function labAvgQ(res, slot = null) {
  const ws = labCheckedWeights();
  if (!ws.length) return 0;
  return ws.reduce((sum, w) => sum + labQ(res, w, slot), 0) / ws.length;
}

// The bench's game math: each stat pools ACROSS slots — unit-weighted average
// over the slots whose pick has the stat; slots that can't have it drop out of
// that stat's average (they do NOT zero it, and their weight is carried by the
// slots that do have it). Confirmed both ways in game: Tibanna Gas Cartridge
// (gas slot has no CD) still caps with server-best picks, while a "count it as
// zero over the full weight" model made capping impossible there.
function labLineValue(weights, picked) {
  let total = 0;
  let wsum = 0;
  let dropped = false;
  for (const [st, w] of Object.entries(weights)) {
    let num = 0;
    let den = 0;
    for (const s of picked) {
      const caps = labSlotCaps(s);
      const cap = caps ? safeInt(caps[st]) : 1000;
      const v = safeInt(s.pick[st]);
      if (v > 0 && cap > 0) { num += s.units * (v / cap) * 1000; den += s.units; }
    }
    if (den > 0) { total += w * (num / den); wsum += w; } else dropped = true;
  }
  if (!wsum) return 0;
  // literal percents over 100 when every stat found a slot, like the site
  return Math.min(1000, total / (dropped ? wsum : 100));
}

function labCheckedWeights() {
  return labState.formulas
    .filter((f) => labState.checked.has(String(f.formulaId)))
    .map((f) => f.weights)
    .filter(Boolean);
}

function labBoostTotal() {
  return labState.boosts.reduce((sum, b) => sum + (b.on ? safeInt(b.value) : 0), 0);
}

// composite per formula: unit-weighted mean over slots with picks + boosts.
// Returns {byFormula: [{formula, composite, capped}], complete, cost}
function labBench() {
  const picked = labState.slots.filter((s) => s.pick);
  const units = picked.reduce((sum, s) => sum + s.units, 0);
  const complete = picked.length === labState.slots.length && labState.slots.length > 0;
  const boost = labBoostTotal();
  const byFormula = labState.formulas
    .filter((f) => labState.checked.has(String(f.formulaId)))
    .map((f) => {
      // no verdict until EVERY slot is filled — a partial average overpromises
      if (!complete || !units || !f.weights) return { formula: f, composite: null, capped: false };
      const raw = labLineValue(f.weights, picked);
      const composite = labClamp01k(raw + boost);
      // base = resources alone; the meter shows the boost's contribution on top of it
      return { formula: f, composite, base: labClamp01k(raw), boost, capped: composite >= labState.threshold };
    });
  const cost = picked.reduce((sum, s) => sum + s.units * labEcpu(s.pick), 0);
  return { byFormula, complete, picked: picked.length, cost };
}

// ---- rendering ----

function labRelevantStats() {
  const set = new Set();
  for (const w of labCheckedWeights()) Object.keys(w).forEach((s) => set.add(s));
  return set;
}

function labRenderBench() {
  const bench = $('#lab-bench');
  bench.hidden = !labState.schematic; // no empty shell before a schematic is picked
  if (!labState.schematic) { bench.innerHTML = ''; $('#lab-save').disabled = true; return; }
  const { byFormula, complete, picked, cost } = labBench();
  $('#lab-save').disabled = false;

  // the voila moment: last slot just filled → pour the experiment before revealing.
  // First completion gets the full pour; later swaps a quick top-up.
  if (complete && !labState.wasComplete) {
    if (!labState.calculating) {
      labState.calculating = true;
      const fast = labState.celebratedOnce;
      bench.innerHTML = `
        <div class="lab-bench-head"><span class="lab-bench-title">${escapeHtml(labState.schematic.name)}</span></div>
        <div class="lab-calc ${fast ? 'fast' : ''}">
          <div class="lab-calc-label"><i class="fa-solid fa-flask lab-flask"></i> Running experiment…</div>
          <div class="lab-calc-bar"><span class="lab-calc-fill"></span><span class="lab-calc-bubbles"></span></div>
        </div>`;
      setTimeout(() => {
        labState.calculating = false;
        labState.wasComplete = true;
        labState.celebratedOnce = true;
        labRenderBench();
      }, fast ? 620 : 1250);
    }
    return;
  }
  if (!complete) { labState.wasComplete = false; labState.calculating = false; }

  const lines = byFormula.map(({ formula, composite, base, boost, capped }) => {
    const basePct = base == null ? 0 : (base / 1000) * 100;
    const verdict = composite == null
      ? `<span class="stat_off">${picked}/${labState.slots.length} slots filled</span>`
      : capped
        ? `<span class="lab-caps">CAPS</span>`
        : `<span class="lab-nocap">misses by ${(labState.threshold - composite).toFixed(1)}</span>`;
    // stacked meter: resources alone, then one colored segment PER active buff
    // (pink = inspiration, blue = bracelet) so each buff's push is visible
    let cursor = base ?? 0;
    const boostSegs = composite == null ? '' : labState.boosts.filter((b) => b.on).map((b) => {
      const start = cursor;
      const end = Math.min(1000, start + safeInt(b.value));
      cursor = end;
      if (end <= start) return '';
      return `<span class="lab-meter-boost" style="left:${(start / 10).toFixed(1)}%;width:${((end - start) / 10).toFixed(1)}%;background:${LAB_BOOST_COLORS[b.key] || 'var(--accent)'}"
        title="${escapeHtml(b.label)} +${b.value} — resources ${base.toFixed(1)}, total ${composite.toFixed(1)}"></span>`;
    }).join('');
    return `<div class="lab-line">
      <span class="lab-line-name" title="${escapeHtml(formula.formulaDescription || '')}">${escapeHtml(labFormulaShort(formula))}</span>
      <div class="lab-meter"><span class="lab-meter-fill ${capped ? 'ok' : ''}" style="width:${basePct.toFixed(1)}%"></span>${boostSegs}
        <span class="lab-meter-cap" style="left:${(labState.threshold / 10).toFixed(1)}%"></span></div>
      <span class="lab-line-q ${composite != null ? qualityClass(composite / 10) : ''}"
        ${composite != null && boost > 0 ? `title="resources ${base.toFixed(1)} + buffs ${boost}"` : ''}>${composite == null ? '—' : composite.toFixed(1)}</span>
      ${verdict}
    </div>`;
  }).join('');

  bench.innerHTML = `${labBenchHeadHtml(cost, complete)}
    <div class="${labState.wasComplete ? 'lab-reveal' : ''}">
    ${lines || '<div class="al-empty">Select at least one experiment line.</div>'}
    </div>`;
  labBindBenchActions();
  labRenderDebug();
}

// dev-mode only: the full composite arithmetic, one section per checked line —
// one row per weighted STAT showing which slots pool into its average (slots
// whose pick lacks the stat drop out), then the weighted rollup + buffs
function labRenderDebug() {
  const box = $('#lab-debug');
  if (!box) return;
  const picked = labState.slots.filter((s) => s.pick);
  const on = document.body.classList.contains('dev-mode') && labState.schematic && picked.length;
  box.hidden = !on;
  if (!on) { box.innerHTML = ''; return; }
  const boost = labBoostTotal();
  const secs = labState.formulas
    .filter((f) => labState.checked.has(String(f.formulaId)) && f.weights)
    .map((f) => {
      const rows = Object.entries(f.weights).map(([st, w]) => {
        let num = 0;
        let den = 0;
        const parts = picked.map((s) => {
          const caps = labSlotCaps(s);
          const cap = caps ? safeInt(caps[st]) : 1000;
          const v = safeInt(s.pick[st]);
          if (v > 0 && cap > 0) {
            num += s.units * (v / cap) * 1000;
            den += s.units;
            return `${escapeHtml(s.pick.name)} ${v}/${cap} ×${s.units}u`;
          }
          return `<span class="lab-dbg-miss">${escapeHtml(s.pick.name)} — (out of this stat's pool)</span>`;
        }).join('&ensp;');
        const avg = den > 0 ? num / den : 0;
        return `<tr><td>${st.toUpperCase()} ×${w}%</td><td>${parts}</td>
          <td>${den > 0 ? `${avg.toFixed(1)} over ${den}u` : '<span class="lab-dbg-miss">no slot has it</span>'}</td></tr>`;
      }).join('');
      const raw = labLineValue(f.weights, picked);
      const final = labClamp01k(raw + boost);
      return `<div class="lab-dbg-sec">
        <div class="lab-dbg-title">${escapeHtml(f.formulaDescription || '')}</div>
        <table class="lab-dbg-table"><thead><tr><th>stat</th>
          <th>pooled from (value/slot cap × units)</th><th>stat average</th></tr></thead>
        <tbody>${rows}</tbody></table>
        <div class="lab-dbg-sum">Σ weight×average = <b>${raw.toFixed(2)}</b> + buffs ${boost}
          = <b>${final.toFixed(2)}</b> vs caps-at ${labState.threshold}
          → ${final >= labState.threshold ? '<span class="lab-caps">CAPS</span>' : `<span class="lab-nocap">misses by ${(labState.threshold - final).toFixed(1)}</span>`}</div>
      </div>`;
    }).join('');
  box.innerHTML = `<div class="lab-dbg-head"><i class="fa-solid fa-bug"></i> Calc debug
      <span class="settings-sub">each stat averages over the slots that HAVE it — a pick without the stat drops out of that stat's pool</span></div>${secs}`;
}

function labBenchHeadHtml(cost, complete) {
  return `<div class="lab-bench-head">
      <span class="lab-bench-title">${escapeHtml(labState.schematic.name)}</span>
      <span class="lab-cost" title="Σ units × eCPU of your picks">est. cost <b>${fmtNum(Math.round(cost))}</b> cr${complete ? '' : ' (incomplete)'}</span>
      <span class="lab-bench-actions">
        <button id="lab-auto-best" class="btn btn-sm btn-outline-secondary" title="Best in-spawn resource per slot">Best in spawn</button>
        <button id="lab-auto-stock" class="btn btn-sm btn-outline-secondary" title="Best resource you already own, per slot">Best in stockpile</button>
        <button id="lab-auto-cheap" class="btn btn-sm btn-outline-secondary" title="Cheapest picks that still cap every selected line">Cheapest that caps</button>
        <button id="lab-auto-cheapstock" class="btn btn-sm btn-outline-secondary" title="Cheapest picks that cap, using only resources you own">Cheapest in stockpile</button>
        <button id="lab-clear" class="btn btn-sm btn-outline-secondary">Clear</button>
      </span>
    </div>`;
}

function labBindBenchActions() {
  $('#lab-auto-best').addEventListener('click', () => labAutoPick('best'));
  $('#lab-auto-stock').addEventListener('click', () => labAutoPick('stock'));
  $('#lab-auto-cheap').addEventListener('click', () => labAutoPick('cheap'));
  $('#lab-auto-cheapstock').addEventListener('click', () => labAutoPick('cheapstock'));
  $('#lab-clear').addEventListener('click', () => {
    labState.slots.forEach((s, i) => { s.pick = null; s.collapsed = i !== 0; });
    labState.wasComplete = false;
    labRenderAll();
  });
}

function labFormulaShortText(desc) {
  return String(desc || '').replace(/\s*[A-Z]{2}=\d+%?\s*/g, ' ').trim() || 'Formula';
}
function labFormulaShort(f) {
  return labFormulaShortText(f.formulaDescription);
}

function labStatCellHtml(res, stat, relevant) {
  const v = safeInt(res[stat]);
  if (v <= 0) return `<td class="stat stat_off ${relevant ? 'lab-rel' : 'lab-dim'}">—</td>`;
  const cap = safeInt(res[`${stat}_max`]) || 1000;
  return `<td class="stat ${qualityClass((v / cap) * 100)} ${relevant ? 'lab-rel' : 'lab-dim'}">${v}</td>`;
}

function labSlotVisibleRows(slot) {
  const rated = slot.pool.map((r) => ({ r, q: labAvgQ(r, slot) }));
  const query = (slot.query || '').trim().toLowerCase();
  if (query) {
    // search the FULL class pool (banned included, so they can be un-banned) —
    // this is also how you bench a deliberately shitty resource
    return rated.filter((x) => (x.r.name || '').toLowerCase().includes(query))
      .sort((a, b) => b.q - a.q).slice(0, 30);
  }
  const usable = rated.filter((x) => !labIsBanned(x.r)); // hidden never suggested
  const byRate = [...usable].sort((a, b) => b.q - a.q);
  const show = new Map();
  byRate.slice(0, 10).forEach((x) => show.set(x.r.id, x));
  [...usable].sort((a, b) => labEcpu(a.r) - labEcpu(b.r))
    .slice(0, 5).forEach((x) => show.set(x.r.id, x));
  usable.filter((x) => stkState.resourceIds.has(String(x.r.id))).forEach((x) => show.set(x.r.id, x));
  if (slot.showBanned) rated.filter((x) => labIsBanned(x.r)).forEach((x) => show.set(x.r.id, x));
  if (slot.pick) {
    const px = rated.find((x) => x.r.id === slot.pick.id);
    if (px) show.set(px.r.id, px);
  }
  // best first — stockpiled rows are highlighted in place, not floated
  // (floating them read as "these are the best", which they usually aren't)
  return [...show.values()].sort((a, b) => b.q - a.q);
}

// hover chip for a pool row: name — category — score — age, one line, docked
// to the right of the cell (initTooltips places rich tips beside, not over).
// Score is the site's value_rating (0–100), not the slot Rate.
function labResTipHtml(r) {
  const t = safeInt(r.timestamp);
  const days = t ? Math.max(0, Math.floor((Date.now() / 1000 - t) / 86400)) : null;
  const score = r.value_rating == null ? null : safeInt(r.value_rating);
  return [
    `<b>${escapeHtml(r.name)}</b>`,
    escapeHtml(r.type_name || ''),
    score === null ? '' : `<span class="${qualityClass(score)}">score ${score}</span>`,
    days === null ? '' : (days === 0 ? 'spawned today' : `${days} day${days === 1 ? '' : 's'} old`),
  ].filter(Boolean).join(' — ');
}

function labSlotTbodyHtml(slot) {
  const rel = labRelevantStats();
  const stats = ['oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe'];
  const rows = labSlotVisibleRows(slot);
  if (!rows.length) {
    return (slot.query || '').trim()
      ? '<tr><td colspan="15" class="stat_off lab-pool-empty">No matches in this class.</td></tr>'
      : `<tr><td colspan="15" class="stat_off lab-pool-empty">
          Couldn\u2019t load this class pool \u2014 <a role="button" data-poolretry="${labState.slots.indexOf(slot)}">retry</a></td></tr>`;
  }
  return rows.map(({ r, q }) => `
    <tr class="lab-row ${slot.pick && slot.pick.id === r.id ? 'lab-picked' : ''} ${stkState.resourceIds.has(String(r.id)) ? 'lab-stocked' : ''} ${labIsBanned(r) ? 'lab-banned' : ''}" data-rid="${r.id}">
      <td class="pin-cell">${r.status === 1 ? '<span class="lab-live" title="In spawn"></span>' : ''}</td>
      <td class="col-name res-name" data-richtip="${escapeHtml(labResTipHtml(r))}">${escapeHtml(r.name)}
        ${stkState.resourceIds.has(String(r.id)) ? (() => {
          const s = labMyStock(r);
          return s !== null && s > 0
            ? `<span class="lab-stock" title="In your stockpile: ${fmtNum(s)} units">\u2713 ${fmtShort(s)}</span>`
            : '<span class="lab-stock" title="In your stockpile">\u2713 stock</span>';
        })() : ''}</td>
      <td class="stat ${qualityClass(q / 10)}">${q.toFixed(1)}</td>
      ${stats.map((st) => labStatCellHtml(r, st, rel.has(st))).join('')}
      <td class="stat ${labMyCpu(r) !== null ? 'lab-mycpu' : ''}" title="${labMyCpu(r) !== null
        ? 'your stockpile cost per unit'
        : ecpuClamp(r.cpu, r.status === 1, safeInt(r.planet_mustafar) === 1) ? 'estimated credits per unit' : 'no eCPU votes yet \u2014 cost math assumes 1'}">${
        labMyCpu(r) !== null ? labMyCpu(r) : (ecpuClamp(r.cpu, r.status === 1, safeInt(r.planet_mustafar) === 1) || '~1')}</td>
      <td class="pin-cell lab-ban-cell" data-ban="${r.id}"
        title="${labIsBanned(r) ? 'Hidden from suggestions \u2014 click to unhide' : 'Hide from consideration \u2014 e.g. no vendor supply despite the eCPU'}">
        <i class="fa-solid ${labIsBanned(r) ? 'fa-eye' : 'fa-eye-slash'}"></i></td>
    </tr>`).join('');
}

function labRenderSlots() {
  const wrap = $('#lab-slots');
  if (!labState.schematic) { wrap.innerHTML = ''; return; }
  const rel = labRelevantStats();
  const stats = ['oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe'];

  wrap.innerHTML = labState.slots.map((slot, si) => `<div class="lab-slot" data-si="${si}">
      <div class="lab-slot-head lab-slot-toggle" title="${slot.collapsed ? 'Expand' : 'Collapse'}">
        <i class="fa-solid ${slot.collapsed ? 'fa-caret-right' : 'fa-caret-down'} lab-caret"></i>
        ${slot.pick ? '<i class="fa-solid fa-circle-check lab-done" title="Slot filled"></i>' : ''}
        <span class="lab-slot-name">${escapeHtml(slot.className)}</span>
        <span class="mys-type">${escapeHtml(slot.label)} \u00b7 ${slot.units} units</span>
        <span class="lab-slot-pick">${(() => {
          if (!slot.pick) return '<span class="stat_off">no pick</span>';
          const q = labAvgQ(slot.pick, slot);
          const short = labState.threshold - q;
          const drag = short > 0
            ? `<span class="lab-drag" title="This pick scores below the cap \u2014 it drags the average down by ${short.toFixed(0)} across ${slot.units} units">\u25bc ${short.toFixed(0)}</span>`
            : '';
          return `<span class="lab-picked-chip">${escapeHtml(slot.pick.name)} \u00b7 ${q.toFixed(1)}</span> ${drag}`;
        })()}</span>
      </div>
      <div class="lab-slot-body" ${slot.collapsed ? 'hidden' : ''}>
      <div class="lab-slot-controls">
        <select class="form-select filter-select lab-slot-stockpick" data-slotstock="${si}" title="Pick straight from your stockpile">
          ${(() => {
            const stocked = slot.pool
              .filter((r) => stkState.resourceIds.has(String(r.id)))
              .map((r) => ({ r, q: labAvgQ(r, slot) }))
              .sort((a, b) => b.q - a.q);
            return `<option value="">My stockpile (${stocked.length})\u2026</option>` + stocked.map((x) =>
              `<option value="${x.r.id}" ${slot.pick && String(slot.pick.id) === String(x.r.id) ? 'selected' : ''}>${escapeHtml(x.r.name)} \u2014 ${x.q.toFixed(1)}</option>`).join('');
          })()}
        </select>
        <input type="text" class="form-control filter-input lab-slot-search" data-slotsearch="${si}"
          placeholder="Search any ${escapeHtml(slot.className)}\u2026" value="${escapeHtml(slot.query || '')}" autocomplete="off">
        ${(() => {
          const n = slot.pool.filter((r) => labIsBanned(r)).length;
          if (!n) return '';
          return `<button type="button" class="lab-hidden-chip ${slot.showBanned ? 'on' : ''}" data-showbanned="${si}"
            title="${slot.showBanned ? 'Stop showing hidden resources' : 'Show them (dimmed) so you can unhide'}">
            <i class="fa-solid fa-eye-slash"></i> ${n} hidden</button>`;
        })()}
      </div>
      <table class="data-grid lab-grid"><thead><tr>
        <th class="pin-cell"></th><th class="col-name">Resource</th>
        <th>Rate</th>
        ${stats.map((st) => `<th class="${rel.has(st) ? 'lab-rel-h' : 'lab-dim'}">${st.toUpperCase()}</th>`).join('')}
        <th>eCPU</th><th class="pin-cell"></th>
      </tr></thead><tbody>${labSlotTbodyHtml(slot)}</tbody></table>
      </div>
    </div>`).join('');
}

function labRenderAll() {
  $('#lab-empty').hidden = !!labState.schematic;
  labRenderBench();
  labRenderSlots();
  labRenderNotes();
}

// ---- bench notes (markdown; click to edit, blur to render+save) ----

function labCurrentNotes() {
  if (labState.currentExpId) {
    const e = labState.experiments.find((x) => x.id === labState.currentExpId);
    return e ? (e.notes || '') : '';
  }
  return labState.draftNotes;
}

function labRenderNotes() {
  $('#lab-notes-wrap').hidden = !labState.schematic;
  if (!labState.schematic) return;
  const editor = $('#lab-notes-editor');
  if (document.activeElement === editor) return; // don't stomp mid-typing
  editor.innerHTML = labNotesHtml(labCurrentNotes());
}

async function labSaveNotes(value) {
  if (labState.currentExpId) {
    const e = labState.experiments.find((x) => x.id === labState.currentExpId);
    if (e && e.notes !== value) {
      e.notes = value;
      await labPersistExperiments();
      toast('Notes saved');
    }
  } else {
    labState.draftNotes = value; // rides along until Save Experiment
  }
  labRenderNotes();
}

// ---- auto picks ----

function labAutoPick(mode) {
  const ws = labCheckedWeights();
  if (!ws.length) { toast('Select at least one experiment line', false); return; }
  labState.wasComplete = false; // auto-fills re-run the ceremony too

  if (mode === 'best') {
    let empty = 0;
    for (const slot of labState.slots) {
      const live = slot.pool.filter((r) => r.status === 1 && !labIsBanned(r));
      // nothing of this class in spawn = nothing to buy at the vendor — leave it open
      if (!live.length) { empty++; slot.pick = null; slot.collapsed = false; continue; }
      slot.pick = live.reduce((best, r) => (!best || labAvgQ(r, slot) > labAvgQ(best, slot) ? r : best), null);
      slot.collapsed = true;
    }
    if (empty) toast(`${empty} slot${empty > 1 ? 's have' : ' has'} nothing in spawn right now`, false);
    labRenderAll();
    return;
  }

  if (mode === 'stock') {
    let empty = 0;
    for (const slot of labState.slots) {
      const stocked = slot.pool.filter((r) => stkState.resourceIds.has(String(r.id)) && !labIsBanned(r));
      if (!stocked.length) { empty++; slot.pick = null; slot.collapsed = false; continue; }
      slot.pick = stocked.reduce((best, r) => (!best || labAvgQ(r, slot) > labAvgQ(best, slot) ? r : best), null);
      slot.collapsed = true;
    }
    const next = labState.slots.find((s) => !s.pick);
    if (next) next.collapsed = false;
    if (empty) toast(`${empty} slot${empty > 1 ? 's have' : ' has'} nothing usable in your stockpile`, false);
    labRenderAll();
    return;
  }

  // cheapest-that-caps (optionally stockpile-only): start with the cheapest per
  // slot, then greedily take the swap with the best deficit-closed-per-credit
  // until every line caps (or stuck)
  const stockOnly = mode === 'cheapstock';
  const cost = (r) => labEcpu(r);
  const cands = labState.slots.map((slot) => {
    const source = (stockOnly
      ? slot.pool.filter((r) => stkState.resourceIds.has(String(r.id)))
      : slot.pool).filter((r) => !labIsBanned(r));
    const rated = source.map((r) => ({ r, q: labAvgQ(r, slot) })).sort((a, b) => b.q - a.q);
    return rated.slice(0, 60).concat(
      [...rated].sort((a, b) => cost(a.r) - cost(b.r)).slice(0, 20));
  });
  labState.slots.forEach((slot, i) => {
    slot.pick = cands[i].reduce((best, x) =>
      (!best || cost(x.r) < cost(best) || (cost(x.r) === cost(best) && labAvgQ(x.r, slot) > labAvgQ(best, slot)) ? x.r : best), null);
  });
  if (stockOnly && labState.slots.some((s) => !s.pick)) {
    const n = labState.slots.filter((s) => !s.pick).length;
    toast(`${n} slot${n > 1 ? 's have' : ' has'} nothing in your stockpile — filled the rest`, false);
  }

  const deficit = () => labBench().byFormula.reduce((sum, l) =>
    sum + (l.composite == null ? 1e9 : Math.max(0, labState.threshold - l.composite)), 0);

  let guard = 200;
  while (deficit() > 0 && guard-- > 0) {
    let best = null;
    for (let i = 0; i < labState.slots.length; i++) {
      const slot = labState.slots[i];
      const before = deficit();
      const current = slot.pick;
      if (!current && stockOnly) continue; // nothing owned for this slot
      for (const { r } of cands[i]) {
        if (current && r.id === current.id) continue;
        slot.pick = r;
        const reduced = before - deficit();
        const dCost = (cost(r) - (current ? cost(current) : 0)) * slot.units;
        if (reduced > 0.01) {
          const score = reduced / Math.max(1, dCost); // deficit closed per credit
          if (!best || score > best.score) best = { i, r, score };
        }
      }
      slot.pick = current;
    }
    if (!best) break; // capping unreachable with known resources
    labState.slots[best.i].pick = best.r;
  }
  if (deficit() > 0) toast('Capping unreachable with known spawns — showing the closest cheap setup', false);
  labState.slots.forEach((s) => { s.collapsed = !!s.pick; });
  labRenderAll();
}

// ---- schematic loading ----

async function labLoadSchematic(id, name) {
  labState.schematic = { id: safeInt(id), name };
  labState.detail = null;
  labState.slots = [];
  $('#lab-formulas').innerHTML = '';
  $('#lab-bench').hidden = false;
  $('#lab-bench').innerHTML = `
    <div class="lab-bench-head"><span class="lab-bench-title">${escapeHtml(name)}</span></div>
    <div class="lab-calc">
      <div class="lab-calc-label"><i class="fa-solid fa-flask lab-flask"></i> Gathering reagents…</div>
      <div class="lab-calc-bar"><span class="lab-calc-fill lab-calc-slosh"></span><span class="lab-calc-bubbles"></span></div>
    </div>`;
  $('#lab-empty').hidden = true;

  let res;
  try { res = await api().get_schematic(String(id)); }
  catch (e) { res = { ok: false }; }
  const det = res.ok && res.data ? (res.data.schematic || res.data) : null;
  if (!det) { $('#lab-bench').innerHTML = '<div class="al-empty">Couldn’t load that schematic.</div>'; return; }
  labState.detail = det;

  labState.formulas = (det.formula || []).filter((f) => f.active !== false)
    .map((f) => ({ ...f, weights: mysParseWeights(f.formulaDescription) }));
  labState.checked = new Set(labState.formulas.map((f) => String(f.formulaId)));
  $('#lab-formulas').innerHTML = labState.formulas.map((f) => `
    <label class="sp-formula">
      <input type="checkbox" data-labfid="${escapeHtml(String(f.formulaId))}" checked>
      <span class="sp-formula-box"><i class="fa-solid fa-check"></i></span>
      <span>${escapeHtml(f.formulaDescription || '')}</span>
    </label>`).join('');

  // stockpile FIRST — the pools always include your stocked resources, even
  // ones a size-capped best-first query would drop
  if (typeof stkState !== 'undefined' && !stkState.items.length) {
    try { await syncStockpile(); } catch (_) { /* stockpile column just stays empty */ }
  }
  const stockIds = typeof stkState !== 'undefined' && stkState.resourceIds ? [...stkState.resourceIds] : [];

  // pools per slot, from the mirror — SEQUENTIAL: concurrent js_api calls with
  // multi-MB payloads drop responses in WKWebView, which read as empty slots
  const needed = det.resourcesNeeded || [];
  const pools = [];
  for (const n of needed) {
    let pool = [];
    for (let attempt = 0; attempt < 2 && !pool.length; attempt++) {
      try {
        const r = await classPool(String(n.id), stockIds);
        pool = (r.ok && r.data) || [];
      } catch (e) {
        api().log_js('error', `lab pool ${n.id} attempt ${attempt}: ${e}`);
      }
    }
    pools.push(pool);
  }
  labState.slots = needed.map((n, i) => ({
    code: String(n.id), label: n.desc || n.resourceName || 'Slot',
    className: n.resourceName || '', units: Math.max(1, safeInt(n.units)),
    pool: pools[i], pick: null,
    collapsed: i !== 0, // wizard flow: work slot by slot, first one open
  }));
  labState.wasComplete = false;
  labState.celebratedOnce = false; // fresh schematic earns the full pour again
  labState.currentExpId = null;
  labState.draftNotes = '';
  labRenderAll();
}

// ---- diary ----

async function labPersistExperiments() {
  try { await api().set_config('lab_experiments', labState.experiments); }
  catch (_) { toast('Couldn’t save experiments', false); }
}

// ---- views: home (experiment cards) <-> workbench ----

function labShowView(view) {
  const home = view === 'home';
  $('#lab-home').hidden = !home;
  $('#lab-work').hidden = home;
  $('#lab-new').hidden = !home;
  $('#lab-home-tools').hidden = !home;
  $('#lab-back').hidden = home;
  $('#lab-save').hidden = home;
  if (home) labRenderHome();
}

function labExpBadge(e) {
  if (e.capped) return '<span class="lab-badge ok" title="Caps"><i class="fa-solid fa-circle-check"></i></span>';
  const worst = (e.results || []).reduce((m, r) =>
    (r.q != null && (m === null || r.q < m) ? r.q : m), null);
  if (worst === null) return '<span class="lab-badge off" title="Incomplete — not all slots were filled"><i class="fa-solid fa-circle-question"></i></span>';
  return `<span class="lab-badge miss" title="${((e.threshold || 960) - worst).toFixed(0)} short of cap"><i class="fa-solid fa-ban"></i></span>`;
}

function labExpMeters(e) {
  const threshold = e.threshold || 960;
  return (e.results || []).map((r) => {
    const q = r.q;
    const ok = q != null && q >= threshold;
    return `<div class="lab-mini-line">
      <span class="lab-mini-name" title="${escapeHtml(r.desc || '')}">${escapeHtml(labFormulaShortText(r.desc))}</span>
      <div class="lab-meter lab-mini-meter">
        <span class="lab-meter-fill ${ok ? 'ok' : ''}" style="width:${q == null ? 0 : Math.min(100, q / 10).toFixed(1)}%"></span>
        <span class="lab-meter-cap" style="left:${(threshold / 10).toFixed(1)}%"></span>
      </div>
      <span class="lab-mini-q ${q != null ? qualityClass(q / 10) : 'stat_off'}">${q == null ? '—' : q.toFixed(0)}</span>
    </div>`;
  }).join('');
}

// notes are stored as HTML; flatten to plain text so the filter can search them
function labNotesText(notes) {
  const d = document.createElement('div');
  d.innerHTML = labNotesHtml(notes);
  return (d.textContent || '').replace(/\s+/g, ' ').trim();
}

// everything an experiment is searchable by: name, schematic, resources, notes
function labExpHaystack(e) {
  return [e.name, e.schematic_name, ...(e.picks || []).map((p) => p.name), labNotesText(e.notes)]
    .filter(Boolean).join(' • ').toLowerCase();
}

function labFilterExperiments() {
  const list = [...labState.experiments].reverse();
  const q = (labState.homeQuery || '').trim().toLowerCase();
  if (!q) return list;
  const terms = q.split(/\s+/);
  return list.filter((e) => { const h = labExpHaystack(e); return terms.every((t) => h.includes(t)); });
}

// grid view: one row per experiment; the same data-* actions the cards use
function labHomeGridHtml(list) {
  const rows = list.map((e) => `<tr>
    <td class="col-name"><span class="lab-exp-name" data-rename="${e.id}" title="Click to rename">${escapeHtml(e.name)}</span></td>
    <td class="col-text">${escapeHtml(e.schematic_name)}</td>
    <td class="col-text lab-picks-cell">${(e.picks || []).slice(0, 4).map((p) =>
      `<span class="mys-loadout lab-pick-pill" data-pillres="${escapeHtml(p.name)}" title="${escapeHtml(p.slot)}">${escapeHtml(p.name)}</span>`).join(' ')
      || '<span class="stat_off">—</span>'}</td>
    <td class="col-text">${labExpBadge(e)}</td>
    <td class="col-num">${fmtNum(e.cost)} cr</td>
    <td class="col-text">${fmtAgoTip(e.created)}</td>
    <td class="col-actions">
      <button class="btn btn-icon" data-load="${e.id}" title="Open on bench"><i class="fa-solid fa-flask"></i></button>
      <button class="btn btn-icon" data-delexp="${e.id}" title="Delete"><i class="fa-solid fa-trash-can"></i></button>
    </td>
  </tr>`).join('');
  return `<div class="table-wrap"><table class="data-grid"><thead><tr>
      <th class="col-name">Name</th><th class="col-text">Schematic</th><th class="col-text">Picks</th>
      <th class="col-text">Result</th><th class="col-num">Cost</th><th class="col-text">Saved</th><th class="col-actions"></th>
    </tr></thead><tbody>${rows}</tbody></table></div>`;
}

function labPaintViewToggle() {
  const btn = $('#lab-viewtoggle');
  if (!btn) return;
  const grid = labState.homeView === 'grid';
  btn.innerHTML = `<i class="fa-solid ${grid ? 'fa-grip-vertical' : 'fa-table-cells-large'}"></i>`;
  btn.title = grid ? 'Switch to card view' : 'Switch to grid view';
}

function labRenderHome() {
  const wrap = $('#lab-exps');
  const total = labState.experiments.length;
  const q = (labState.homeQuery || '').trim();
  const list = labFilterExperiments();

  $('#lab-home-clear').hidden = !q;
  $('#lab-home-count').textContent = q ? `${list.length} of ${total}` : '';
  $('#lab-home-empty').hidden = total > 0;
  $('#lab-home-nomatch').hidden = !(total > 0 && list.length === 0);
  if (total > 0 && list.length === 0) {
    $('#lab-home-nomatch').innerHTML = `No experiments match <b>${escapeHtml(q)}</b>. `
      + '<a role="button" data-homeclear>Clear the filter</a>.';
  }

  wrap.classList.toggle('lab-exps-grid', labState.homeView === 'grid');
  if (labState.homeView === 'grid') {
    wrap.innerHTML = labHomeGridHtml(list);
    return;
  }
  wrap.innerHTML = list.map((e) => `
    <div class="lab-exp-card" data-eid="${e.id}">
      <div class="lab-exp-hd">
        <div class="lab-exp-top">
          <span class="lab-exp-name" data-rename="${e.id}" title="Click to rename">${escapeHtml(e.name)}
            <i class="fa-solid fa-pen lab-rename-pen"></i></span>
          ${labExpBadge(e)}
        </div>
        <div class="lab-exp-meters">${labExpMeters(e)}</div>
      </div>
      <div class="lab-exp-body">
        <div class="lab-exp-picks">${(e.picks || []).slice(0, 6).map((p) =>
          `<span class="mys-loadout lab-pick-pill" data-pillres="${escapeHtml(p.name)}" title="${escapeHtml(p.slot)} — click to filter by this resource">${escapeHtml(p.name)}</span>`).join(' ')}</div>
        <div class="lab-notes-view lab-card-notes">${labNotesHtml(e.notes)
          || '<span class="stat_off">No notes yet — open on bench to add some.</span>'}</div>
      </div>
      <div class="lab-exp-foot">
        <span>
          <button class="btn btn-sm btn-outline-secondary" data-load="${e.id}"><i class="fa-solid fa-flask"></i> Open on bench</button>
          <button class="btn btn-icon al-rule-btn" data-delexp="${e.id}" title="Delete"><i class="fa-solid fa-trash-can"></i></button>
        </span>
        <span class="lab-exp-when">${fmtNum(e.cost)} cr · ${fmtAgoTip(e.created)} · ${escapeHtml(e.schematic_name)}</span>
      </div>
    </div>`).join('');
}

// pull the saved experiments back from config and re-render (header refresh button)
async function labReloadExperiments() {
  const btn = $('#lab-home-refresh');
  const ico = btn && btn.querySelector('i');
  if (ico) ico.classList.add('fa-spin');
  try {
    const res = await api().get_config();
    if (res.ok && res.data) labState.experiments = res.data.lab_experiments || [];
    labRenderHome();
  } catch (_) { toast('Couldn’t reload experiments', false); }
  if (ico) ico.classList.remove('fa-spin');
}

// set the home filter and re-render (used by the search box and resource-pill clicks)
function labSetHomeQuery(q) {
  labState.homeQuery = q || '';
  const box = $('#lab-home-search');
  if (box && box.value !== labState.homeQuery) box.value = labState.homeQuery;
  labRenderHome();
}

async function labSaveExperiment() {
  if (!labState.schematic) return;
  const { byFormula, cost } = labBench();
  const capped = byFormula.length > 0 && byFormula.every((l) => l.capped);
  const existing = labState.currentExpId
    && labState.experiments.find((x) => x.id === labState.currentExpId);
  const entry = {
    id: existing ? existing.id : String(Date.now()),
    name: existing ? existing.name : labState.schematic.name, // rename on the card

    schematic_id: labState.schematic.id,
    schematic_name: labState.schematic.name,
    formula_ids: [...labState.checked],
    picks: labState.slots.filter((s) => s.pick).map((s) => ({
      slot: s.label, code: s.code, id: s.pick.id, name: s.pick.name })),
    boosts: labState.boosts.filter((b) => b.on).map((b) => b.key),
    threshold: labState.threshold,
    results: byFormula.map((l) => ({ desc: l.formula.formulaDescription, q: l.composite })),
    capped, cost: Math.round(cost),
    notes: existing ? existing.notes : labState.draftNotes,
    created: existing ? existing.created : Math.floor(Date.now() / 1000),
  };
  if (existing) labState.experiments[labState.experiments.indexOf(existing)] = entry;
  else labState.experiments.push(entry);
  await labPersistExperiments();
  labShowView('home'); // save lands you back on the experiments page
  toast(`Experiment saved${capped ? ' — CAPS' : ''} — add your notes on the card`);
}

async function labLoadExperiment(e) {
  labShowView('work');
  labState.threshold = e.threshold || labState.threshold;
  const expId = e.id;
  $('#lab-threshold').value = labState.threshold;
  labState.boosts.forEach((b) => { b.on = (e.boosts || []).includes(b.key); });
  labRenderBoosts();
  await labLoadSchematic(e.schematic_id, e.schematic_name);
  if (e.formula_ids?.length) {
    labState.checked = new Set(e.formula_ids.map(String));
    document.querySelectorAll('#lab-formulas [data-labfid]').forEach((box) => {
      box.checked = labState.checked.has(box.dataset.labfid);
    });
  }
  for (const p of e.picks || []) {
    const slot = labState.slots.find((s) => s.code === String(p.code));
    if (slot) {
      slot.pick = slot.pool.find((r) => String(r.id) === String(p.id)) || null;
      slot.collapsed = !!slot.pick;
    }
  }
  labState.currentExpId = expId; // bench edits (incl. notes) belong to this experiment
  labState.wasComplete = true;   // loading a finished experiment shouldn't re-run the ceremony
  labState.celebratedOnce = true;
  labRefreshSchemList(); // re-render the chooser so the highlight comes from state, not class fiddling
  labRenderAll();
}

// ---- boosts / settings ----

function labRenderBoosts() {
  // color strip on each row = that buff's meter-segment color (explicit legend)
  $('#lab-boosts').innerHTML = labState.boosts.map((b, i) => `
    <label class="lab-boost">
      <span class="lab-boost-swatch" style="background:${LAB_BOOST_COLORS[b.key] || 'var(--accent)'}"></span>
      <input type="checkbox" class="form-check-input" data-boost="${i}" ${b.on ? 'checked' : ''}
        style="accent-color:${LAB_BOOST_COLORS[b.key] || 'var(--accent)'}">
      <span>${escapeHtml(b.label)}</span>
      <span class="lab-boost-val">+<input type="number" class="form-control filter-input" data-boostval="${i}"
        value="${b.value}" min="0" max="200"></span>
    </label>`).join('');
}

async function labPersistSettings() {
  try {
    await api().set_config('lab_settings', {
      threshold: labState.threshold,
      boosts: labState.boosts.map((b) => ({ key: b.key, on: b.on, value: b.value })),
      banned: [...labState.banned],
      homeView: labState.homeView,
    });
  } catch (_) { /* non-fatal */ }
}

// ---- init ----

async function loadLab() {
  try {
    const res = await api().get_config();
    if (res.ok && res.data) {
      labState.experiments = res.data.lab_experiments || [];
      const ls = res.data.lab_settings || {};
      if (ls.threshold) { labState.threshold = safeInt(ls.threshold); $('#lab-threshold').value = labState.threshold; }
      for (const saved of ls.boosts || []) {
        const b = labState.boosts.find((x) => x.key === saved.key);
        if (b) { b.on = !!saved.on; b.value = safeInt(saved.value) || b.value; }
      }
      labState.banned = new Set((ls.banned || []).map(String));
      if (ls.homeView === 'grid' || ls.homeView === 'cards') labState.homeView = ls.homeView;
    }
  } catch (_) { /* defaults */ }
  labPaintViewToggle();
  labRenderBoosts();
  labShowView('home');
  labRefreshSchemList();
}

let labListSeq = 0;
async function labRefreshSchemList() {
  const seq = ++labListSeq;
  const search = $('#lab-schem-search').value.trim();
  const category = $('#lab-schem-cat').value;
  const list = $('#lab-schem-list');

  let pinnedRows = [];
  if (!search && !category) {
    try {
      const pinRes = await api().get_pinned_schematics();
      const ids = (pinRes.ok && pinRes.data) || [];
      if (ids.length) {
        const names = await api().get_schematic_names(ids);
        if (names.ok && names.data) {
          pinnedRows = ids.filter((id) => names.data[String(id)])
            .map((id) => ({ id, ...names.data[String(id)], pinned: true }));
        }
      }
    } catch (_) { /* fine */ }
  }
  let rows = [];
  try {
    const res = await api().search_schematics({ search, category, page: 1 });
    rows = (res.ok && res.data && (res.data.results || [])) || [];
  } catch (_) { /* offline fallback answers */ }
  if (seq !== labListSeq) return;

  const pinnedIds = new Set(pinnedRows.map((p) => String(p.id)));
  const items = [...pinnedRows, ...rows.filter((s) => !pinnedIds.has(String(s.id))).slice(0, 60)];
  const sel = labState.schematic ? String(labState.schematic.id) : '';
  list.innerHTML = items.map((s) => `
    <div class="al-schem-row ${String(s.id) === sel ? 'sel' : ''}" data-sid="${escapeHtml(String(s.id))}"
         data-sname="${escapeHtml(s.name || '')}">
      ${s.pinned ? '<i class="fa-solid fa-thumbtack al-schem-star" title="Pinned"></i>' : '<span class="al-schem-star"></span>'}
      <span class="al-schem-name">${escapeHtml(s.name || '')}</span>
      <span class="al-schem-prof">${escapeHtml(s.parent || '')}</span>
    </div>`).join('') || '<div class="mysd-opt-none">No schematics match.</div>';
}

function initLab() {
  api().get_categories().then((res) => {
    const cats = (res.ok && res.data && (res.data.schematic_categories || [])) || [];
    const parents = [...new Set(cats.map((c) => c.parent).filter(Boolean))].sort();
    $('#lab-schem-cat').innerHTML = '<option value="">All professions</option>'
      + parents.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  }).catch(() => {});

  let t = null;
  $('#lab-schem-search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(labRefreshSchemList, 250); });
  $('#lab-schem-cat').addEventListener('change', () => labRefreshSchemList());
  $('#lab-schem-list').addEventListener('click', (e) => {
    const row = e.target.closest('.al-schem-row');
    if (!row || !row.dataset.sid) return;
    document.querySelectorAll('#lab-schem-list .al-schem-row').forEach((r) => r.classList.toggle('sel', r === row));
    labLoadSchematic(row.dataset.sid, row.dataset.sname);
  });

  $('#lab-formulas').addEventListener('change', (e) => {
    const box = e.target.closest('[data-labfid]');
    if (!box) return;
    if (box.checked) labState.checked.add(box.dataset.labfid);
    else labState.checked.delete(box.dataset.labfid);
    labRenderAll();
  });

  // stockpile dropdown per slot: instant pick from what you own
  $('#lab-slots').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-slotstock]');
    if (!sel || !sel.value) return;
    const slot = labState.slots[safeInt(sel.dataset.slotstock)];
    if (!slot) return;
    const r = slot.pool.find((x) => String(x.id) === sel.value);
    if (!r) return;
    slot.pick = r;
    slot.collapsed = true;
    labState.wasComplete = false;
    const next = labState.slots.find((s) => !s.pick);
    if (next) next.collapsed = false;
    labRenderAll();
  });

  // per-slot search: swap only that slot's tbody so the input keeps focus
  $('#lab-slots').addEventListener('input', (e) => {
    const inp = e.target.closest('[data-slotsearch]');
    if (!inp) return;
    const slot = labState.slots[safeInt(inp.dataset.slotsearch)];
    if (!slot) return;
    slot.query = inp.value;
    inp.closest('.lab-slot').querySelector('tbody').innerHTML = labSlotTbodyHtml(slot);
  });

  $('#lab-slots').addEventListener('click', (e) => {
    const retry = e.target.closest('[data-poolretry]');
    if (retry) { labRetryPool(safeInt(retry.dataset.poolretry)); return; }
    const head = e.target.closest('.lab-slot-toggle');
    if (head) {
      const slot = labState.slots[safeInt(head.closest('.lab-slot').dataset.si)];
      if (slot) { slot.collapsed = !slot.collapsed; labRenderSlots(); }
      return;
    }
    const reveal = e.target.closest('[data-showbanned]');
    if (reveal) {
      const slot = labState.slots[safeInt(reveal.dataset.showbanned)];
      if (slot) { slot.showBanned = !slot.showBanned; labRenderSlots(); }
      return;
    }
    const banCell = e.target.closest('[data-ban]');
    if (banCell) {
      const id = String(banCell.dataset.ban);
      if (labState.banned.has(id)) labState.banned.delete(id); else labState.banned.add(id);
      labPersistSettings();
      labRenderAll(); // suggestions + any pick costs re-evaluate
      return;
    }
    const tr = e.target.closest('tr.lab-row');
    if (!tr) return;
    const slot = labState.slots[safeInt(tr.closest('.lab-slot').dataset.si)];
    if (!slot) return;
    const r = slot.pool.find((x) => String(x.id) === tr.dataset.rid);
    const unpick = slot.pick && String(slot.pick.id) === tr.dataset.rid;
    slot.pick = unpick ? null : r;
    labState.wasComplete = false; // swaps re-run the experiment ceremony
    slot.collapsed = !unpick; // picking folds the section; unpicking reopens it
    if (!unpick) {
      const next = labState.slots.find((s) => !s.pick); // wizard: open the next empty slot
      if (next) next.collapsed = false;
    }
    labRenderAll();
  });

  $('#lab-boosts').addEventListener('change', (e) => {
    const box = e.target.closest('[data-boost]');
    if (box) labState.boosts[safeInt(box.dataset.boost)].on = box.checked;
    const val = e.target.closest('[data-boostval]');
    if (val) labState.boosts[safeInt(val.dataset.boostval)].value = safeInt(val.value);
    labPersistSettings();
    labRenderBench();
  });
  $('#lab-threshold').addEventListener('change', () => {
    labState.threshold = safeInt($('#lab-threshold').value) || 960;
    labPersistSettings();
    labRenderBench();
  });

  $('#lab-save').addEventListener('click', labSaveExperiment);
  $('#lab-new').addEventListener('click', () => {
    // blank slate — a new experiment must pick its own schematic
    labState.schematic = null;
    labState.detail = null;
    labState.slots = [];
    labState.formulas = [];
    labState.checked = new Set();
    labState.currentExpId = null;
    labState.draftNotes = '';
    labState.wasComplete = false;
    labState.celebratedOnce = false;
    $('#lab-formulas').innerHTML = '';
    $('#lab-schem-search').value = '';
    document.querySelectorAll('#lab-schem-list .al-schem-row').forEach((r) => r.classList.remove('sel'));
    labShowView('work');
    labRenderAll();
  });
  $('#lab-back').addEventListener('click', () => labShowView('home'));

  // home filter: free-text across name/resource/schematic/notes
  $('#lab-home-search').addEventListener('input', (e) => labSetHomeQuery(e.target.value));
  $('#lab-home-search').addEventListener('keydown', (e) => {
    if (e.key === 'Escape') labSetHomeQuery('');
  });
  $('#lab-home-clear').addEventListener('click', () => { labSetHomeQuery(''); $('#lab-home-search').focus(); });
  $('#lab-home-nomatch').addEventListener('click', (e) => {
    if (e.target.closest('[data-homeclear]')) labSetHomeQuery('');
  });
  $('#lab-home-refresh').addEventListener('click', () => labReloadExperiments());
  $('#lab-viewtoggle').addEventListener('click', () => {
    labState.homeView = labState.homeView === 'grid' ? 'cards' : 'grid';
    labPaintViewToggle();
    labRenderHome();
    labPersistSettings(); // sticky across sessions
  });

  // bench notes: WYSIWYG contenteditable + mini toolbar; saves on blur
  document.querySelectorAll('.lab-notes-toolbar [data-cmd]').forEach((btn) => {
    btn.addEventListener('mousedown', (e) => {
      e.preventDefault(); // keep the editor's selection/focus
      document.execCommand(btn.dataset.cmd, false, null);
    });
  });
  $('#lab-notes-editor').addEventListener('blur', () => {
    labSaveNotes(labSanitizeHtml($('#lab-notes-editor').innerHTML));
  });

  $('#lab-exps').addEventListener('click', async (e) => {
    const pill = e.target.closest('[data-pillres]');
    if (pill) { labSetHomeQuery(pill.dataset.pillres); return; }
    const ren = e.target.closest('[data-rename]');
    if (ren) {
      const exp = labState.experiments.find((x) => x.id === ren.dataset.rename);
      if (!exp) return;
      ren.outerHTML = `<input type="text" class="form-control filter-input lab-rename-input"
        data-renamein="${exp.id}" value="${escapeHtml(exp.name)}" maxlength="80">`;
      const inp = document.querySelector(`[data-renamein="${exp.id}"]`);
      inp.focus();
      inp.select();
      return;
    }
    const load = e.target.closest('[data-load]');
    if (load) {
      const exp = labState.experiments.find((x) => x.id === load.dataset.load);
      if (exp) labLoadExperiment(exp);
      return;
    }
    const del = e.target.closest('[data-delexp]');
    if (del) {
      if (!confirmArm(del, 'Click again to delete this experiment')) return;
      labState.experiments = labState.experiments.filter((x) => x.id !== del.dataset.delexp);
      labRenderHome();
      labPersistExperiments();
    }
  });
  $('#lab-exps').addEventListener('focusout', (e) => {
    const inp = e.target.closest('[data-renamein]');
    if (inp) {
      const exp = labState.experiments.find((x) => x.id === inp.dataset.renamein);
      const name = inp.value.trim();
      if (exp && name && name !== exp.name) {
        exp.name = name;
        labPersistExperiments();
      }
      labRenderHome();
    }
  });
  $('#lab-exps').addEventListener('keydown', (e) => {
    if (e.target.closest('[data-renamein]') && (e.key === 'Enter' || e.key === 'Escape')) {
      if (e.key === 'Escape') e.target.value = ''; // discard — focusout ignores empty
      e.target.blur();
    }
  });
}
