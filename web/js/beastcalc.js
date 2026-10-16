/* Beast calculators — the website's Hydrolase, Incubator and Mutation calculators
   (includes/hydro_widget.php, incubator_widget.php, mutation_widget.php) ported
   verbatim: same inputs, defaults, clamps, formulas and verdict wording — these are
   community-verified spreadsheets (Sneakinezz's incubator sheet, the SWGR mutation
   sheet, swgpets.com's hydro maths), so the numbers here must match the site's.
   Each calculator builds its own inputs/outputs markup into its page root and
   remembers the last inputs in localStorage. */

// ---------- shared ----------
function bcSaveInputs(key, ids, prefix) {
  const o = {};
  ids.forEach((k) => { const el = document.getElementById(prefix + k); if (el) o[k] = el.value; });
  try { localStorage.setItem(key, JSON.stringify(o)); } catch (_) { /* fine */ }
}
function bcRestoreInputs(key, prefix) {
  let o = null;
  try { o = JSON.parse(localStorage.getItem(key) || 'null'); } catch (_) { o = null; }
  if (!o || typeof o !== 'object') return;
  Object.entries(o).forEach(([k, v]) => { const el = document.getElementById(prefix + k); if (el && v != null) el.value = v; });
}
const bcInput = (id, val, extra = '') => `<input class="bc-in" id="${id}" value="${escapeHtml(String(val))}" autocomplete="off" inputmode="decimal" ${extra}>`;
// the site's quality palette: great/good/fair/ok/poor -> the app's q-* classes
const bcQ = (cls) => ({ great: 'q-great', good: 'q-good', fair: 'q-fair', ok: 'q-ok', poor: 'q-poor', blank: 'q-poor' }[cls] || 'q-ok');

// ===================== Incubator =====================
const INC_FIELDS = [
  ['iq', 'Incubation Quality Skill Mod', 'Max of 26', '26'],
  ['iqr', 'Incubator Quality Rating', 'Max of 4.0', '4.0'],
  ['fem', 'Focused Enzyme Manipulation Skill Mod', 'Max of 10', '10'],
  ['geo', 'Geothermal Energy Overall Quality', 'Max of 1000', '1000'],
  ['top', 'Top Isomerase Enzyme %', 'Max of 90', '90'],
  ['bot', 'Bottom Isomerase Enzyme %', 'Max of 90', '90'],
];
const INC_KEYS = ['iq', 'iqr', 'fem', 'geo', 'top', 'bot'];
const INC_MAX = { iq: 26, iqr: 4, fem: 10, geo: 1000, top: 90, bot: 90 };
const INC_ALL_IDS = INC_KEYS.flatMap((k) => [1, 2, 3].map((s) => `${k}_${s}`)).concat(['legacy']);

function initIncubator() {
  const root = $('#inc-root');
  if (!root) return;
  root.innerHTML = `<div class="bc-row">
    <div class="scd-card bc-card bc-input-card">
      <h6>Inputs</h6>
      <div class="bc-scroll"><div class="bc-grid inc-grid">
        <div></div><div class="bc-colh">Session 1</div><div class="bc-colh">Session 2</div><div class="bc-colh">Session 3</div>
        ${INC_FIELDS.map(([key, label, note, def]) => `<div class="bc-l">${escapeHtml(label)} <small>(${escapeHtml(note)})</small></div>`
          + [1, 2, 3].map((s) => bcInput(`inc_${key}_${s}`, def)).join('')).join('')}
        <div class="bc-l">Legacy DNA <small>(whole egg)</small></div>
        <select class="bc-in" id="inc_legacy" style="grid-column:2 / -1;"><option value="no" selected>No</option><option value="yes">Yes</option></select>
        <button type="button" class="bc-copy" id="inc_copy" title="Copy Session 1's inputs to Sessions 2 and 3"><i class="fa-solid fa-copy"></i> Copy 1 <i class="fa-solid fa-angles-right"></i> 2 &amp; 3</button>
        <button type="button" class="bc-copy" id="inc_copy_12" title="Copy Session 1's inputs to Session 2"><i class="fa-solid fa-copy"></i> 1 <i class="fa-solid fa-angle-right"></i> 2</button>
        <button type="button" class="bc-copy" id="inc_copy_23" title="Copy Session 2's inputs to Session 3"><i class="fa-solid fa-copy"></i> 2 <i class="fa-solid fa-angle-right"></i> 3</button>
        <div></div>
      </div></div>
    </div>
    <div class="scd-card bc-card bc-output-card">
      <h6>Outputs</h6>
      <table class="bc-table"><thead><tr><th></th><th>Session 1</th><th>Session 2</th><th>Session 3</th><th>Total</th></tr></thead><tbody id="inc_result"></tbody></table>
      <div class="bc-verdict" id="inc_verdict"></div>
      <div class="bc-verdict-sub" id="inc_lyase_verdict"></div>
      <p class="bc-note">* Health bonus is the one exception: it adds +3.2 per capped session (3.2/6.4/9.6, up to +9.6 total) instead of the +1.6/+16.0 track.</p>
    </div>
  </div>
  <div class="scd-card bc-card bc-help">
    <p>Edit the <b>Inputs</b> section based on your current inputs. The <b>Outputs</b> will display both the maximum DPS/Armor bonus and the lyase attribute bonus you can expect based on your inputs per session.</p>
    <p>If the <b>Max DPS/Armor Bonus per Session (%)</b> amounts across all three sessions add up to 2.1500, your pet's DPS/Armor bonus will round up to 2.2% (the cap) at egg formation. Legacy DNA adds +5 to each isomerase value (roughly +0.12 to the three-session total) and raises the cap to 2.3%.</p>
    <p class="bc-last">If the <b>Lyase Attribute Bonus</b> is at least 16, each of your sessions will add the maximum, capped amount of lyase stats (+1.6 or +16.0 depending on the attribute), which can total up to +4.8 or +48.0 across all three sessions. Health bonus is the one exception: it follows a 3.2/6.4/9.6 sequence, so three capped sessions add +9.6.</p>
  </div>`;
  bcRestoreInputs('bc_incubator', 'inc_');

  // Inputs are clamped to their labeled "Max of" values (and floored at 0).
  function val(k, s) {
    const el = document.getElementById(`inc_${k}_${s}`);
    const v = el ? (parseFloat(el.value) || 0) : 0;
    return Math.min(Math.max(v, 0), INC_MAX[k]);
  }
  const fmt = (n, d) => n.toFixed(d);
  const isLegacy = () => document.getElementById('inc_legacy').value === 'yes';

  function session(s) {
    const legacy = isLegacy() ? 5 : 0;
    const exotic = val('fem', s) * 2;
    const power = (val('geo', s) / 1000) * 11;
    const mult = 1 + 0.01 * (val('iq', s) + val('iqr', s) + power + exotic);
    return {
      dps: 0.005 * (val('top', s) + legacy) * mult,
      lyase: 0.14 * (val('bot', s) + legacy) * mult,
    };
  }

  function recompute() {
    const out = [session(1), session(2), session(3)];
    const dpsSum = out[0].dps + out[1].dps + out[2].dps;

    // Lyase caps at 16 per session; the capped value /10 is the small-stat variant.
    const lyCapped = out.map((o) => Math.min(o.lyase, 16));
    const lySum = lyCapped[0] + lyCapped[1] + lyCapped[2];

    const rows = [
      ['Max DPS/Armor Bonus per Session (%)'].concat(out.map((o) => fmt(o.dps, 4)), [`<b>${fmt(dpsSum, 4)}</b>`]),
      ['Lyase Attribute Bonus <small>(Max of 16)</small>'].concat(out.map((o) => fmt(o.lyase, 3)), [`<b>${fmt(out[0].lyase + out[1].lyase + out[2].lyase, 3)}</b>`]),
      ['Lyase Stats Added*'].concat(lyCapped.map((l) => `+${fmt(l / 10, 2)} / +${fmt(l, 1)}`), [`<b>+${fmt(lySum / 10, 2)} / +${fmt(lySum, 1)}</b>`]),
    ];
    document.getElementById('inc_result').innerHTML = rows.map((r) =>
      `<tr><td class="bc-muted">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td><td>${r[3]}</td><td>${r[4]}</td></tr>`).join('');

    // Final DPS/Armor bonus at egg formation: rounds to one decimal. The cap is
    // 2.2%, or 2.3% for Legacy DNA pets (legacy adds roughly +0.12 to the total).
    const cap = isLegacy() ? 2.3 : 2.2;
    const need = cap - 0.05; // the sum that rounds up to the cap (2.15 or 2.25)
    const capped = dpsSum >= need;
    const finalBonus = Math.min(Math.round(dpsSum * 10) / 10, cap);
    const cls = capped ? 'great' : (dpsSum >= need - 0.15 ? 'good' : (dpsSum >= need - 0.45 ? 'fair' : (dpsSum >= need - 0.85 ? 'ok' : 'poor')));
    const note = capped
      ? `${fmt(dpsSum, 4)} &ge; ${fmt(need, 4)} needed, rounds up to the cap`
      : `${fmt(dpsSum, 4)} of ${fmt(need, 4)} needed for the ${fmt(cap, 1)}% cap, short by ${fmt(need - dpsSum, 4)}`;
    document.getElementById('inc_verdict').innerHTML =
      `<b class="${bcQ(cls)}">${fmt(finalBonus, 1)}%</b> <span class="bc-muted">DPS/Armor bonus at egg formation (${note})</span>`;

    const lyMaxed = lyCapped.every((l) => l >= 16);
    document.getElementById('inc_lyase_verdict').innerHTML = lyMaxed
      ? `<b class="${bcQ('great')}">+4.8 / +48.0</b> <span class="bc-muted">lyase stats, all three sessions capped</span>`
      : `<b>+${fmt(lySum / 10, 2)} / +${fmt(lySum, 1)}</b> <span class="bc-muted">lyase stats of a possible +4.8 / +48.0</span>`;
    bcSaveInputs('bc_incubator', INC_ALL_IDS, 'inc_');
  }

  // Copy one session column's inputs onto another.
  function copyCol(from, to) {
    INC_KEYS.forEach((k) => { document.getElementById(`inc_${k}_${to}`).value = document.getElementById(`inc_${k}_${from}`).value; });
    recompute();
  }
  document.getElementById('inc_copy_12').addEventListener('click', () => copyCol(1, 2));
  document.getElementById('inc_copy_23').addEventListener('click', () => copyCol(2, 3));
  document.getElementById('inc_copy').addEventListener('click', () => { copyCol(1, 2); copyCol(1, 3); });

  // Snap out-of-range values back into [0, max] when the field loses focus,
  // so the box always shows the number actually being computed.
  function clampField(el, max) {
    const v = parseFloat(el.value);
    if (Number.isNaN(v)) return;
    const c = Math.min(Math.max(v, 0), max);
    if (c !== v) el.value = c;
  }
  for (let s = 1; s <= 3; s++) {
    INC_KEYS.forEach((k) => {
      const el = document.getElementById(`inc_${k}_${s}`);
      el.addEventListener('input', recompute);
      el.addEventListener('change', function () { clampField(this, INC_MAX[k]); recompute(); });
    });
  }
  document.getElementById('inc_legacy').addEventListener('change', recompute);
  recompute();
}

// ===================== Mutation =====================
const MUT_FIELDS = [
  ['dna', 'DNA Quality %', 'Max of 130', '130'],
  ['top', 'Top Isomerase Enzyme %', 'Max of 90', '90'],
  ['bot', 'Bottom Isomerase Enzyme %', 'Max of 90', '90'],
  ['mut', 'Hydrolase Mutagen Value', '', '10'],
  ['iq', 'Incubator Quality', 'Max of 4.0', '4.0'],
  ['fer', 'Fervent Mutation Skill Mod', 'Max of 9', '9'],
];
const MUT_MAX = { dna: 130, top: 90, bot: 90, mut: null, iq: 4, fer: 9 };
const MUT_KEYS = Object.keys(MUT_MAX);

function initMutation() {
  const root = $('#mut-root');
  if (!root) return;
  root.innerHTML = `<div class="bc-row">
    <div class="scd-card bc-card bc-input-card bc-narrow">
      <h6>Inputs</h6>
      <div class="bc-grid mut-grid">
        ${MUT_FIELDS.map(([key, label, note, def]) => `<div class="bc-l">${escapeHtml(label)}${note ? ` <small>(${escapeHtml(note)})</small>` : ''}</div>${bcInput(`mut_${key}`, def)}`).join('')}
      </div>
    </div>
    <div class="scd-card bc-card bc-output-card">
      <h6>Outputs</h6>
      <table class="bc-table"><thead><tr><th>Mutation Bonus</th><th>Value</th><th>Contribution</th></tr></thead><tbody id="mut_result"></tbody></table>
      <div class="bc-verdict" id="mut_verdict"></div>
    </div>
  </div>
  <div class="scd-card bc-card bc-help">
    <p>Enter your inputs based on your current supplies or skill mods in the <b>Inputs</b> section.</p>
    <p>The <b>Value</b> column displays the amount each input adds to your overall mutation chance, which caps at 18%. Below the table is your overall mutation chance, which rounds to the nearest whole percent. For example, a mutation chance of 14.490 rounds down to 14%, but 14.500 rounds up to 15%.</p>
    <p class="bc-last">The <b>Contribution</b> column displays each supply or skill mod's share of your total mutation bonuses out of 100%.</p>
  </div>`;
  bcRestoreInputs('bc_mutation', 'mut_');

  // Inputs are clamped to their labeled "Max of" values (and floored at 0).
  function val(k) {
    let v = parseFloat(document.getElementById(`mut_${k}`).value) || 0;
    v = Math.max(v, 0);
    return MUT_MAX[k] === null ? v : Math.min(v, MUT_MAX[k]);
  }
  const fmt = (n, d) => n.toFixed(d);

  function recompute() {
    const bonuses = [
      ['DNA Bonus <small>(Max of 5.055)</small>', Math.min(val('dna'), 129.99) / 90 * 3.5],
      ['Isomerase Bonus <small>(Max of 3.5)</small>', (val('top') + val('bot')) / 2 / 90 * 3.5],
      ['Base Mutation Bonus', 2.0],
      ['Mutagen Bonus', val('mut') / 20 * 4.5],
      ['Incubator Bonus <small>(Max of 3.5)</small>', val('iq') / 4 * 3.5],
      ['Skill Mod Bonus <small>(Max of 0.675)</small>', val('fer') * 0.075],
    ];
    const total = bonuses.reduce((t, b) => t + b[1], 0);
    const rows = bonuses.map((b) =>
      `<tr><td class="bc-muted">${b[0]}</td><td>${fmt(b[1], 3)}</td><td>${total > 0 ? `${fmt(b[1] / total * 100, 1)}%` : ''}</td></tr>`);
    rows.push(`<tr><td class="bc-muted"><b>Total Mutation Bonuses</b></td><td><b>${fmt(total, 3)}</b></td><td></td></tr>`);
    document.getElementById('mut_result').innerHTML = rows.join('');

    // Final chance: total capped at 18, rounded to a whole percent.
    const chance = Math.round(Math.min(total, 18));
    const cls = chance >= 18 ? 'great' : (chance >= 15 ? 'good' : (chance >= 11 ? 'fair' : (chance >= 6 ? 'ok' : 'poor')));
    const note = total >= 18 ? `${fmt(total, 3)} total, capped at 18` : `${fmt(total, 3)} total of 18 max`;
    document.getElementById('mut_verdict').innerHTML =
      `<b class="${bcQ(cls)}">${chance}%</b> <span class="bc-muted">mutation chance per session (${note})</span>`;
    bcSaveInputs('bc_mutation', MUT_KEYS, 'mut_');
  }

  function clampField(el, max) {
    const v = parseFloat(el.value);
    if (Number.isNaN(v)) return;
    let c = Math.max(v, 0);
    if (max !== null) c = Math.min(c, max);
    if (c !== v) el.value = c;
  }
  MUT_KEYS.forEach((k) => {
    const el = document.getElementById(`mut_${k}`);
    el.addEventListener('input', recompute);
    el.addEventListener('change', function () { clampField(this, MUT_MAX[k]); recompute(); });
  });
  recompute();
}

// ===================== Hydrolase =====================
const HY_IDS = ['input_p', 'input_m', 'ge', 'target', 'stage', 'cent_p', 'cent_m', 'proc_p', 'proc_m', 'reproc_p', 'reproc_m', 'tray_p', 'tray_m', 'canister_p', 'canister_m', 'capsule_p', 'capsule_m'];

function initHydro() {
  const root = $('#hy-root');
  if (!root) return;
  const hw = (label, id, denom, sub) => `<div class="bc-l">${label}${sub ? ` <small>(${sub})</small>` : ''}</div>${bcInput(`hy_${id}_p`, denom)}<div class="bc-u">/${denom}</div>${bcInput(`hy_${id}_m`, '0')}`;
  root.innerHTML = `<div class="bc-row">
    <div class="scd-card bc-card bc-input-card bc-narrow">
      <div class="bc-grid hy-grid">
        <div></div><div class="bc-colh bc-colh-sm">Purity</div><div></div><div class="bc-colh bc-colh-sm">Mutagen</div>
        <div class="bc-sec">Enzyme &amp; Expertise</div>
        <div class="bc-l">Start Enzyme</div>${bcInput('hy_input_p', '7')}<div class="bc-u"></div>${bcInput('hy_input_m', '0')}
        <div class="bc-l">Stage</div><select class="bc-in" id="hy_stage" style="grid-column:2 / -1;"><option value="1" selected>Centrifuge</option><option value="2">Processor</option><option value="3">Re-Processor</option></select>
        <div class="bc-l">GE Expertise</div>${bcInput('hy_ge', '100')}<div></div><div></div>
        <div class="bc-span"><small>Expertise: 1pt=30 &middot; 2pt=60 &middot; 3pt=100 &middot; 4pt=120 (125 on Restoration)</small></div>
        <div class="bc-l">Target Purity</div>${bcInput('hy_target', '20')}<div></div><div></div>
        <div class="bc-sec">Hardware</div>
        ${hw('Centrifuge', 'cent', 3)}${hw('Processor', 'proc', 3)}${hw('Re-Processor', 'reproc', 2)}
        <div class="bc-sec">Consumables</div>
        ${hw('Tray', 'tray', 3, 'Centrifuge')}${hw('Canister', 'canister', 3, 'Processor')}${hw('Capsule', 'capsule', 3, 'Re-Processor')}
      </div>
    </div>
    <div class="scd-card bc-card bc-output-card">
      <h6>Result</h6>
      <table class="bc-table"><thead><tr><th>Stage</th><th>Purity</th><th>Mutagen</th></tr></thead><tbody id="hy_result"></tbody></table>
      <div class="bc-verdict" id="hy_chance"></div>
      <h6 class="bc-h6-gap">Gains per Stage</h6>
      <table class="bc-table"><thead><tr><th>Stage</th><th>Purity</th><th>Mutagen</th></tr></thead><tbody id="hy_gains"></tbody></table>
      <p class="bc-note">Output is a random roll within each min-max range; hydrolase purity hard-caps at 20.0.</p>
    </div>
  </div>
  <div class="scd-card bc-card bc-help">
    <p>This calculator allows you to put in your hardware and consumable stats and then estimate a range of values expected to come from each stage of the refining process. The actual enzyme that you pull from each stage will be a random number between the minimum and maximum values shown.</p>
    <p>The <b>Stage</b> selection is used to indicate what type of enzyme you're using for the input:</p>
    <ul class="bc-last">
      <li><b>Centrifuge</b> - raw extracted hydro that you place into the centrifuge.</li>
      <li><b>Processor</b> - unprocessed enzyme element (lettered) that you place into a processor.</li>
      <li><b>Re-Processor</b> - the five processed enzyme elements (lettered) that you place into a re-processor - enter the average value, OR all five values separated by space, comma or plus (e.g. <code>17.3 + 16, 17 14.3 + 18</code>).</li>
    </ul>
  </div>`;
  bcRestoreInputs('bc_hydro', 'hy_');

  // Re-Processor stage: "17.3 + 16, 17 14.3 + 18" averages the five lettered elements.
  function val(k) {
    const el = document.getElementById(`hy_${k}`);
    if (!el) return 0;
    if (k === 'input_p' || k === 'input_m') {
      const nums = String(el.value).split(/[\s,+]+/).map((s) => parseFloat(s)).filter((n) => !Number.isNaN(n));
      if (nums.length > 1) return nums.reduce((a, b) => a + b, 0) / nums.length;
    }
    return parseFloat(el.value) || 0;
  }
  const fmt = (n) => (Math.round(n * 100) / 100).toString();

  // One refining stage: returns [min, max] given prior [min,max], hardware, consumable, factor.
  function stage(sMin, sMax, H, C, f) {
    return [sMin + f * (H / 8 + 3 * C / 8), sMax + f * (H / 4 + 3 * C / 4)];
  }

  // Stage definitions in chain order, with their hardware + consumable input keys.
  const STAGES = [
    { name: 'Centrifuge', H: 'cent', C: 'tray' },
    { name: 'Processor', H: 'proc', C: 'canister' },
    { name: 'Re-Processor', H: 'reproc', C: 'capsule' },
  ];

  function recompute() {
    const ge = val('ge'); const f = 1 + ge / 100; const target = val('target');
    const startIdx = (parseInt(val('stage'), 10) || 1) - 1; // selected starting stage
    const active = STAGES.slice(startIdx);

    let pMin = val('input_p'); let pMax = pMin; let mMin = val('input_m'); let mMax = mMin;
    const resultRows = [['Input Enzyme', fmt(pMin), fmt(mMin)]];
    const gainRows = [];
    let finalP = [pMin, pMax];

    active.forEach((s) => {
      const Hp = val(`${s.H}_p`); const Cp = val(`${s.C}_p`); const Hm = val(`${s.H}_m`); const Cm = val(`${s.C}_m`);
      const np = stage(pMin, pMax, Hp, Cp, f);
      const nm = stage(mMin, mMax, Hm, Cm, f);
      resultRows.push([s.name, `${fmt(np[0])} to ${fmt(np[1])}`, `${fmt(nm[0])} to ${fmt(nm[1])}`]);
      gainRows.push([s.name,
        `+${fmt(f * (Hp / 8 + 3 * Cp / 8))} to +${fmt(f * (Hp / 4 + 3 * Cp / 4))}`,
        `+${fmt(f * (Hm / 8 + 3 * Cm / 8))} to +${fmt(f * (Hm / 4 + 3 * Cm / 4))}`]);
      pMin = np[0]; pMax = np[1]; mMin = nm[0]; mMax = nm[1]; finalP = np;
    });

    document.getElementById('hy_result').innerHTML = resultRows.map((r) => `<tr><td class="bc-muted">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');
    document.getElementById('hy_gains').innerHTML = gainRows.map((r) => `<tr><td class="bc-muted">${r[0]}</td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('');

    // chance to reach target purity on the final stage (uniform roll)
    const lo = finalP[0]; const hi = finalP[1]; let chance;
    if (target <= lo) chance = 100; else if (target > hi) chance = 0; else chance = (hi - target) / (hi - lo) * 100;
    const pct = Math.round(chance * 100) / 100;
    const cls = pct >= 100 ? 'great' : (pct >= 75 ? 'good' : (pct >= 50 ? 'fair' : (pct >= 25 ? 'ok' : (pct > 0 ? 'poor' : 'blank'))));
    document.getElementById('hy_chance').innerHTML = `<b class="${bcQ(cls)}">${pct}%</b> <span class="bc-muted">chance to refine to ${fmt(target)}p+</span>`;
    bcSaveInputs('bc_hydro', HY_IDS, 'hy_');
  }

  HY_IDS.forEach((k) => { const el = document.getElementById(`hy_${k}`); if (el) el.addEventListener('input', recompute); });
  const stageSel = document.getElementById('hy_stage'); if (stageSel) stageSel.addEventListener('change', recompute);
  recompute();
}

function initBeastCalcs() {
  initIncubator();
  initMutation();
  initHydro();
}
