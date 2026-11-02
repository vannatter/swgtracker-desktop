/* Price Guide — anonymous going rates from everyone's tracked sales
   (api/price_guide.php; the website's /prices.php mirrors this page).
   Server-built nightly from the last 90 days: an item only shows when at least
   3 different sellers back it, no one seller dominates, and prices are rounded —
   so nobody's own prices can be picked out. Prices are per unit; "usually ×25"
   is the stack size it sells in. Also: the quiet "below/above market" chip on
   My Inventory (pgInvChip), and the contribute-my-sales switch (Settings + the
   page footer, same server pref). */

const pgState = { items: [], total: 0, built: 0, open: null, detail: new Map(), seq: 0,
                  hints: null, hintsAt: 0, optout: null };

function pgPrice(v) { return `${fmtShort(v)}`; }

function pgTrendHtml(t) {
  if (t === null || t === undefined) return '<span class="stat_off">—</span>';
  if (Math.abs(t) < 5) return '<span class="pg-trend pg-flat" title="Within 5% of the 60 days before">steady</span>';
  return `<span class="pg-trend ${t > 0 ? 'pg-up' : 'pg-down'}" title="Last 30 days against the 60 before">${t > 0 ? '▲' : '▼'} ${Math.abs(t)}%</span>`;
}

function pgRowHtml(it) {
  const open = pgState.open === it.key;
  return `<tr class="pg-row${open ? ' pg-open' : ''}" data-pgkey="${escapeHtml(it.key)}">
    <td class="col-name res-name">${escapeHtml(it.name)}</td>
    <td class="col-num pg-med">${pgPrice(it.median)}</td>
    <td class="col-num pg-range">${it.p25 === it.p75 ? pgPrice(it.p25) : `${pgPrice(it.p25)} – ${pgPrice(it.p75)}`}</td>
    <td class="col-num pg-qty">${it.qty > 1 ? `×${fmtNum(it.qty)}` : '<span class="stat_off">single</span>'}</td>
    <td class="col-num pg-sales">${fmtNum(it.sales)} <span class="pg-sellers">· ${fmtNum(it.sellers)} sellers</span></td>
    <td class="col-num pg-tr">${pgTrendHtml(it.trend)}</td>
  </tr>${open ? `<tr class="pg-detail-row"><td colspan="6">${pgDetailHtml(it)}</td></tr>` : ''}`;
}

// weekly medians as a tiny bar strip — power users only (.power-only)
function pgSpark(weekly) {
  const pts = weekly || [];
  const vals = pts.filter((v) => v !== null);
  if (!vals.length) return '<div class="pg-spark-empty">Not enough sellers in any single week to chart it yet.</div>';
  const max = Math.max(...vals);
  return `<div class="pg-spark" title="Going rate each week, last 12 weeks — gaps are weeks without enough different sellers">${pts.map((v) => v === null
    ? '<span class="pg-bar pg-bar-gap"></span>'
    : `<span class="pg-bar" style="height:${Math.max(8, Math.round(v / max * 100))}%" title="${pgPrice(v)}"></span>`).join('')}</div>`;
}

function pgDetailHtml(it) {
  const d = pgState.detail.get(it.key);
  const each = it.qty > 1 ? ` each, usually sold ${fmtNum(it.qty)} at a time (≈ ${pgPrice(it.median * it.qty)} a stack)` : ' each';
  return `<div class="pg-detail">
    <div>Most sell for about <b>${pgPrice(it.median)}</b>${each}; the middle half go for ${pgPrice(it.p25)}–${pgPrice(it.p75)}.
      Based on ${fmtNum(it.sales)} sales from ${fmtNum(it.sellers)} different sellers in the last 90 days, last one ${fmtAgoTip(it.last_sale)}.</div>
    <div class="power-only pg-weekly">${d ? pgSpark(d.weekly) : '<span class="spinner"></span>'}</div>
  </div>`;
}

function renderPriceGuide() {
  const body = $('#pg-body');
  body.innerHTML = pgState.items.map(pgRowHtml).join('');
  const empty = $('#pg-empty');
  empty.hidden = pgState.items.length > 0;
  if (!pgState.items.length) {
    empty.textContent = $('#pg-search').value.trim()
      ? 'Nothing in the guide matches — an item only shows once enough different sellers have sold it.'
      : 'The guide is empty right now.';
  }
  $('#pg-status').textContent = pgState.items.length
    ? `${fmtNum(pgState.items.length)} of ${fmtNum(pgState.total)} items${pgState.built ? ` · updated ${fmtAgo(pgState.built)}` : ''}`
    : '';
}

async function loadPriceGuide() {
  const seq = ++pgState.seq;
  $('#pg-loading').hidden = false;
  let res;
  try {
    res = await apiFetch('GET', 'api/price_guide.php', { params: { q: $('#pg-search').value.trim(), sort: $('#pg-sort').value, limit: 200 } });
  } catch (e) { res = { ok: false, error: String(e) }; }
  if (seq !== pgState.seq) return;   // a newer search won
  $('#pg-loading').hidden = true;
  if (!res.ok || !res.data || !Array.isArray(res.data.items)) {
    $('#pg-body').innerHTML = '';
    const empty = $('#pg-empty');
    empty.textContent = /404|not found/i.test(String(res.error || '')) ? 'The price guide needs the latest swgtracker.com update.' : `Error: ${res.error || 'failed to load'}`;
    empty.hidden = false;
    return;
  }
  pgState.items = res.data.items;
  pgState.total = safeInt(res.data.total);
  pgState.built = safeInt(res.data.built);
  renderPriceGuide();
  // opened from an Inventory chip: fetch that item's detail too
  if (pgState.open && !pgState.detail.has(pgState.open)) { const k = pgState.open; pgState.open = null; pgToggleRow(k); }
  pgLoadOptout();
}

async function pgToggleRow(key) {
  pgState.open = pgState.open === key ? null : key;
  renderPriceGuide();
  if (!pgState.open || pgState.detail.has(key)) return;
  let res;
  try { res = await apiFetch('GET', 'api/price_guide.php', { params: { item: key } }); } catch (e) { res = { ok: false }; }
  pgState.detail.set(key, res.ok && res.data && res.data.item ? res.data.item : { weekly: [] });
  if (pgState.open === key) renderPriceGuide();
}

// ---- contribute my sales (server pref; Settings + page footer) ---------------
function pgPaintOptout() {
  const on = pgState.optout === null ? null : !pgState.optout;
  for (const id of ['#pg-contrib', '#set-pg-contrib']) {
    const el = $(id);
    if (!el) continue;
    el.disabled = on === null;
    if (on !== null) el.checked = on;
  }
}

async function pgLoadOptout() {
  let res;
  try { res = await apiFetch('GET', 'api/price_guide.php', { params: { optout: 1 } }); } catch (e) { res = { ok: false }; }
  if (res.ok && res.data && typeof res.data.optout === 'boolean') pgState.optout = res.data.optout;
  pgPaintOptout();
}

async function pgSaveOptout(contribute) {
  let res;
  try { res = await apiFetch('POST', 'api/price_guide.php', { data: { action: 'optout', value: contribute ? 0 : 1 } }); } catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok || !res.data) { toast(res.error || 'Couldn’t save that', false); pgPaintOptout(); return; }
  pgState.optout = !!res.data.optout;
  pgPaintOptout();
  toast(pgState.optout ? 'Your sales will be left out of the price guide from the next nightly update'
                       : 'Your sales count toward the price guide again from the next nightly update');
}

// ---- My Inventory: quiet "below / above market" chip -------------------------
// Only for items priced well off a tight market (the server decides — see ?mine=1).
function pgInvChip(item) {
  const h = pgState.hints && pgState.hints.get(String(item.id));
  if (!h) return '';
  const low = h.verdict === 'low';
  const unit = h.qty > 1 ? ' each' : '';
  const tip = `${low ? 'Below' : 'Above'} the going rate — you usually get ${pgPrice(h.yours)}${unit}; most sell for ${pgPrice(h.median)}${unit} (middle half ${pgPrice(h.p25)}–${pgPrice(h.p75)}). From the Price Guide.`;
  // an icon, not a word chip: it must not wrap the name onto a second line
  return ` <i class="fa-solid ${low ? 'fa-scale-unbalanced' : 'fa-scale-unbalanced-flip'} pg-chip ${low ? 'pg-chip-low' : 'pg-chip-high'}" data-pgchip="${escapeHtml(h.key)}" title="${escapeHtml(tip + ' Click to open it.')}" aria-label="${low ? 'Below' : 'Above'} market"></i>`;
}

async function pgInvHints() {
  if (Date.now() - pgState.hintsAt < 10 * 60 * 1000) return;   // a nightly build — no need to refetch every repaint
  pgState.hintsAt = Date.now();
  let res;
  try { res = await apiFetch('GET', 'api/price_guide.php', { params: { mine: 1 } }); } catch (e) { res = { ok: false }; }
  if (!res.ok || !res.data || !Array.isArray(res.data.hints)) return;   // older site / offline: no chips, nothing else changes
  const before = pgState.hints ? pgState.hints.size : 0;
  pgState.hints = new Map(res.data.hints.map((h) => [String(h.inventory_id), h]));
  if ((pgState.hints.size || before) && typeof renderInvRows === 'function') renderInvRows();
}

function initPriceGuide() {
  let t = null;
  $('#pg-search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(loadPriceGuide, 300); });
  $('#pg-sort').addEventListener('change', loadPriceGuide);
  $('#pg-body').addEventListener('click', (e) => {
    const row = e.target.closest('tr.pg-row');
    if (row) pgToggleRow(row.dataset.pgkey);
  });
  for (const id of ['#pg-contrib', '#set-pg-contrib']) {
    const el = $(id);
    if (el) el.addEventListener('change', () => pgSaveOptout(el.checked));
  }
  // My Inventory: a chip click opens the guide on that item
  document.addEventListener('click', (e) => {
    const chip = e.target.closest('[data-pgchip]');
    if (!chip) return;
    e.stopPropagation();
    const h = [...(pgState.hints || new Map()).values()].find((x) => x.key === chip.dataset.pgchip);
    $('#pg-search').value = h ? h.name : chip.dataset.pgchip;
    pgState.open = chip.dataset.pgchip;
    showPage('prices');
    loadPriceGuide();   // showPage only loads a page on its first visit; the seq guard drops a duplicate
  }, true);
  setTimeout(pgLoadOptout, 4000);   // Settings' switch shows the saved state without its own hook
}
