/* My Stockpile → Summary panel: what you're holding at a glance.
   Headline tiles (units, resources, value at the site's eCPU, what you paid and
   the difference), then two donuts with legends — by class (Mineral, Chemical, Gas,
   Creature Resources…) and by type (Metal, Gemstone, Hide, Meat…) — switchable
   between units and value. Follows the page's search + tag filter, so a filtered
   grid gets a summary of just those rows. Class/type come from the resource tree
   path stockpile.js loads (stkState.treePath). Fold state is kept per device. */
const stkSum = { by: 'units', folded: false };
try {
  stkSum.by = localStorage.getItem('stk_sum_by') === 'value' ? 'value' : 'units';
  stkSum.folded = localStorage.getItem('stk_sum_folded') === '1';
} catch (_) { /* private */ }

// the tree path for a type: ['Inorganic', 'Mineral', 'Metal', 'Ferrous Metal', 'Iron', <type name>]
function stkSumPath(item) {
  const p = (stkState.treePath && stkState.treePath[item.type_code]) || [];
  return [...p, String(item.type_name || 'Unknown')];
}
// class = the second step (Mineral, Chemical, Gas, Creature Resources, Flora Resource…)
const stkSumClass = (path) => path[1] || path[0] || 'Other';
// type = one step down; organics go one further so hides, meats and bones split out
function stkSumType(path) {
  const deep = /creature|flora/i.test(path[1] || '');
  return path[deep ? 3 : 2] || path[path.length - 1] || 'Other';
}

// does a stockpile row fall in the class / type picked on a donut? {level: 'class'|'type', keys: [...]}
function stkSumMatches(item, f) {
  const path = stkSumPath(item);
  return f.keys.includes(f.level === 'class' ? stkSumClass(path) : stkSumType(path));
}

function stkSumRows(items) {
  const cls = new Map();
  const typ = new Map();
  const tot = { units: 0, value: 0, n: items.length, unpriced: 0, paidUnits: 0, paid: 0, paidValue: 0, costed: 0 };
  for (const it of items) {
    const units = Math.max(0, Number(it.stock) || 0);
    const ecpu = ecpuClamp(it.cpu, safeInt(it.status) === 1, safeInt(it.planet_mustafar) === 1);
    const value = units * ecpu;
    tot.units += units;
    tot.value += value;
    if (!ecpu && units) tot.unpriced++;
    const hasCpu = it.my_cpu !== null && it.my_cpu !== undefined && it.my_cpu !== '';
    if (hasCpu) {
      tot.costed++;
      tot.paid += units * (Number(it.my_cpu) || 0);
      tot.paidValue += value;
    }
    const path = stkSumPath(it);
    for (const [map, key] of [[cls, stkSumClass(path)], [typ, stkSumType(path)]]) {
      const row = map.get(key) || { key, units: 0, value: 0, n: 0 };
      row.units += units; row.value += value; row.n++;
      map.set(key, row);
    }
  }
  return { tot, cls: [...cls.values()], typ: [...typ.values()] };
}

// ranked bars, largest first; past `max` the tail folds into "Other"
// slice colors: one muted family led by the theme red — red, dusty blue, ochre, lavender, sage,
// sand, slate blue — alternating light and dark so ring neighbours differ in lightness as well as
// hue. Every neighbour (7 wraps to 1) checked with the dataviz validate_palette.js against the
// dark card: colorblind + normal-vision separation and 3:1 contrast all pass.
const STK_SUM_COLORS = ['#d4545e', '#9db4d8', '#a08440', '#c2b2e0', '#5f8f6e', '#dcc89a', '#5b7f9c'];
const STK_SUM_OTHER = '#555a68';

// largest first; past the palette the tail folds into "Other (n)"
function stkSumSlices(rows, by) {
  const sorted = rows.filter((r) => r[by] > 0).sort((a, b) => b[by] - a[by] || a.key.localeCompare(b.key));
  const max = STK_SUM_COLORS.length;
  let list = sorted.slice(0, max);
  if (sorted.length > max) {
    const rest = sorted.slice(max - 1);
    list = [...sorted.slice(0, max - 1), rest.reduce((o, r) => ({ ...o, units: o.units + r.units, value: o.value + r.value, n: o.n + r.n }),
      { key: `Other (${rest.length})`, units: 0, value: 0, n: 0, other: true, keys: rest.map((r) => r.key) })];
  }
  const total = sorted.reduce((s, r) => s + r[by], 0);
  return { total, list: list.map((r, i) => ({ ...r, color: r.other ? STK_SUM_OTHER : STK_SUM_COLORS[i], share: total ? r[by] / total : 0 })) };
}

const stkSumAmt = (v, by) => (by === 'value' ? `${fmtShort(v)} cr` : fmtShort(v));
const stkSumPct = (share) => (share > 0 && share < 0.01 ? '<1%' : `${Math.round(share * 100)}%`);

function stkSumDonut(title, level, rows, by) {
  const { total, list } = stkSumSlices(rows, by);
  const f = stkState.catFilter && stkState.catFilter.level === level ? stkState.catFilter : null;
  const keysOf = (r) => (r.keys || [r.key]);
  const selIdx = f ? list.findIndex((r) => keysOf(r).join('|') === f.keys.join('|')) : -1;
  if (!list.length) {
    return `<div class="stk-sum-chart"><div class="stk-sum-ch">${title}</div>
      <div class="stk-sum-none">${by === 'value' ? 'No eCPU on these yet — nothing to value.' : 'No units stocked yet.'}</div></div>`;
  }
  const R = 40; const C = 2 * Math.PI * R; const GAP = list.length > 1 ? 1.4 : 0; // the 2px-ish surface gap between slices
  let at = 0;
  const arcs = list.map((r, i) => {
    const len = r.share * C;
    const dash = Math.max(0.6, len - GAP);
    const arc = `<circle class="stk-sum-arc${i === selIdx ? ' sel' : ''}" data-slice="${i}" r="${R}" cx="50" cy="50" fill="none" stroke="${r.color}" stroke-width="14"
      stroke-dasharray="${dash.toFixed(2)} ${(C - dash).toFixed(2)}" stroke-dashoffset="${(-at).toFixed(2)}"><title>${escapeHtml(r.key)}: ${stkSumAmt(r[by], by)} · ${stkSumPct(r.share)}</title></circle>`;
    at += len;
    return arc;
  }).join('');
  const legend = list.map((r, i) => `
      <div class="stk-sum-li${r.other ? ' other' : ''}${i === selIdx ? ' sel' : ''}" data-slice="${i}" role="button" tabindex="0" title="${escapeHtml(`${r.key}: ${fmtNum(Math.round(r.units))} units · ~${fmtNum(Math.round(r.value))} cr at eCPU · ${r.n} resource${r.n === 1 ? '' : 's'}`)}">
        <i style="background:${r.color}"></i>
        <span class="stk-sum-li-k">${escapeHtml(r.key)}</span>
        <span class="stk-sum-li-v">${stkSumAmt(r[by], by)}</span>
        <span class="stk-sum-li-p">${stkSumPct(r.share)}</span>
      </div>`).join('');
  const data = escapeHtml(JSON.stringify(list.map((r) => [r.key, stkSumAmt(r[by], by), stkSumPct(r.share), keysOf(r)])));
  return `<div class="stk-sum-chart${selIdx >= 0 ? ' picked' : ''}" data-level="${level}" data-slices="${data}" data-total="${escapeHtml(stkSumAmt(total, by))}" data-unit="${by === 'value' ? 'at eCPU' : 'units'}">
      <div class="stk-sum-ch">${title}</div>
      <div class="stk-sum-donutrow">
        <div class="stk-sum-donut">
          <svg viewBox="0 0 100 100" role="img" aria-label="${escapeHtml(`${title} by ${by}`)}"><g transform="rotate(-90 50 50)">${arcs}</g></svg>
          <div class="stk-sum-center"><b>${stkSumAmt(total, by)}</b><span>${by === 'value' ? 'at eCPU' : 'units'}</span></div>
        </div>
        <div class="stk-sum-legend">${legend}</div>
      </div>
    </div>`;
}

function renderStkSummary() {
  const box = $('#stk-summary');
  if (!box) return;
  const all = stkState.items || [];
  box.hidden = !all.length;
  if (!all.length) return;
  const items = typeof stkVisibleItems === 'function' ? stkVisibleItems() : all;
  const { tot, cls, typ } = stkSumRows(items);
  // the donut you picked from keeps all its slices (yours lit, the rest dimmed); the other one + the tiles show just the pick
  const f = stkState.catFilter;
  const base = f ? stkSumRows(stkVisibleItems({ ignoreCat: true })) : null;
  const clsRows = f && f.level === 'class' ? base.cls : cls;
  const typRows = f && f.level === 'type' ? base.typ : typ;
  const filtered = items.length !== all.length;
  const gain = tot.paidValue - tot.paid;
  const tile = (icon, k, v, sub, extra = '', cls2 = '') => `<div class="stk-sum-tile ${cls2}">
      <span class="stk-sum-tic"><i class="fa-solid ${icon}"></i></span>
      <div class="stk-sum-tbody"><div class="stk-sum-k">${k}</div><div class="stk-sum-v">${v}</div><div class="stk-sum-s">${sub}</div>${extra}</div></div>`;
  // paid vs worth, side by side on one scale — the margin you can see
  const meter = () => {
    const top = Math.max(tot.paid, tot.paidValue) || 1;
    return `<div class="stk-sum-meter">
      <div><span>Paid</span><b style="width:${Math.max(1, tot.paid / top * 100).toFixed(1)}%" class="paid"></b><em>${fmtShort(tot.paid)}</em></div>
      <div><span>Worth</span><b style="width:${Math.max(1, tot.paidValue / top * 100).toFixed(1)}%" class="worth"></b><em>${fmtShort(tot.paidValue)}</em></div>
    </div>`;
  };
  box.classList.toggle('folded', stkSum.folded);
  box.innerHTML = `
    <div class="stk-sum-head" data-stksum-fold role="button" tabindex="0" aria-expanded="${stkSum.folded ? 'false' : 'true'}">
      <i class="fa-solid fa-chart-pie stk-sum-ic"></i>
      <span class="stk-sum-title">Summary</span>
      <span class="stk-sum-scope">${filtered ? `${items.length} of ${all.length} resources${f ? '' : ' — your search / tag filter'}` : `all ${all.length} resources`}</span>
      <span class="stk-sum-foldline">${fmtShort(tot.units)} units · ~${fmtShort(tot.value)} cr</span>
      <i class="fa-solid fa-chevron-down stk-sum-caret"></i>
    </div>
    <div class="stk-sum-body">
      <div class="stk-sum-tiles">
        ${tile('fa-cubes', 'Units', fmtNum(Math.round(tot.units)), `across ${tot.n} resource${tot.n === 1 ? '' : 's'}`)}
        ${tile('fa-coins', 'Value at eCPU', `~${fmtShort(tot.value)} <small>cr</small>`, tot.unpriced ? `${tot.unpriced} with no eCPU yet aren't counted` : `${fmtNum(Math.round(tot.value))} cr · units × eCPU`)}
        ${tot.costed
          ? tile('fa-receipt', 'You paid', `${fmtShort(tot.paid)} <small>cr</small>`, `${tot.costed} of ${tot.n} have My CPU set`)
            + tile(gain >= 0 ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down', gain >= 0 ? 'Worth more than you paid' : 'Worth less than you paid',
              `${gain >= 0 ? '+' : '−'}${fmtShort(Math.abs(gain))} <small>cr</small>`,
              `${tot.paid ? `${gain >= 0 ? '+' : '−'}${Math.round(Math.abs(gain) / tot.paid * 100).toLocaleString()}% ` : ''}on those ${tot.costed}`, meter(), gain >= 0 ? 'up' : 'down')
          : tile('fa-receipt', 'You paid', '—', 'set My CPU on a row to see what you paid and your margin', '', 'muted')}
      </div>
      <div class="stk-sum-bar-head">
        <div class="stk-sum-seg" role="group" aria-label="Charts show">
          <button type="button" data-stksum-by="units" class="${stkSum.by === 'units' ? 'active' : ''}">Units</button>
          <button type="button" data-stksum-by="value" class="${stkSum.by === 'value' ? 'active' : ''}">Value</button>
        </div>
        ${f ? `<span class="stk-sum-chip" title="The grid shows only this ${f.level} — click a slice again or × to show everything"><i class="fa-solid fa-filter"></i> Showing: <b>${escapeHtml(f.label)}</b><button type="button" data-stksum-clear aria-label="Clear the ${f.level} filter"><i class="fa-solid fa-xmark"></i></button></span>` : ''}
        <span class="stk-sum-note">${stkSum.by === 'value' ? 'Share of what your stockpile is worth at the site\'s community eCPU — a guide, not a sale price.' : 'Share of the units you hold.'} Click a slice to filter the list.</span>
      </div>
      <div class="stk-sum-charts">
        ${stkSumDonut('By class', 'class', clsRows, stkSum.by)}
        ${stkSumDonut('By type', 'type', typRows, stkSum.by)}
      </div>
    </div>`;
}

// click a slice / legend row: filter the grid to it (again = clear)
function stkSumPickSlice(el) {
  const chart = el.closest('.stk-sum-chart');
  let s = [];
  try { s = JSON.parse(chart.dataset.slices || '[]'); } catch (_) { /* none */ }
  const row = s[safeInt(el.dataset.slice)];
  if (!row) return;
  const next = { level: chart.dataset.level, keys: row[3], label: row[0] };
  const cur = stkState.catFilter;
  stkSumPick(cur && cur.level === next.level && cur.keys.join('|') === next.keys.join('|') ? null : next);
}
function stkSumPick(f) {
  stkState.catFilter = f;
  renderStockpile();
}

// hover a slice or a legend row: light the pair, show it in the donut's center
function stkSumHover(chart, i) {
  if (!chart) return;
  chart.querySelectorAll('[data-slice]').forEach((el) => el.classList.toggle('on', i !== null && el.dataset.slice === String(i)));
  chart.classList.toggle('hovering', i !== null);
  const c = chart.querySelector('.stk-sum-center');
  let s = [];
  try { s = JSON.parse(chart.dataset.slices || '[]'); } catch (_) { /* none */ }
  const row = i !== null ? s[i] : null;
  c.innerHTML = row
    ? `<b>${escapeHtml(row[2])}</b><span>${escapeHtml(row[0])}</span><span>${escapeHtml(row[1])}</span>`
    : `<b>${escapeHtml(chart.dataset.total)}</b><span>${escapeHtml(chart.dataset.unit)}</span>`;
}

document.addEventListener('DOMContentLoaded', () => {
  const box = $('#stk-summary');
  if (!box) return;
  const fold = () => {
    stkSum.folded = !stkSum.folded;
    try { localStorage.setItem('stk_sum_folded', stkSum.folded ? '1' : '0'); } catch (_) { /* private */ }
    renderStkSummary();
  };
  box.addEventListener('click', (e) => {
    const by = e.target.closest('[data-stksum-by]');
    if (by) {
      stkSum.by = by.dataset.stksumBy;
      try { localStorage.setItem('stk_sum_by', stkSum.by); } catch (_) { /* private */ }
      renderStkSummary();
      return;
    }
    if (e.target.closest('[data-stksum-clear]')) { stkSumPick(null); return; }
    const sl = e.target.closest('[data-slice]');
    if (sl) { stkSumPickSlice(sl); return; }
    if (e.target.closest('[data-stksum-fold]')) fold();
  });
  box.addEventListener('mouseover', (e) => {
    const sl = e.target.closest('[data-slice]');
    const chart = e.target.closest('.stk-sum-chart');
    if (sl && chart) stkSumHover(chart, sl.dataset.slice);
  });
  box.addEventListener('mouseout', (e) => {
    const sl = e.target.closest('[data-slice]');
    if (sl && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-slice]'))) stkSumHover(e.target.closest('.stk-sum-chart'), null);
  });
  box.addEventListener('keydown', (e) => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-slice]')) { e.preventDefault(); stkSumPickSlice(e.target.closest('[data-slice]')); return; }
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-stksum-fold]')) { e.preventDefault(); fold(); }
  });
});
