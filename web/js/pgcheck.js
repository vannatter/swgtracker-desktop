// Price Guide check (Sales page) — the seller says what a listing's trailing number is.
// The game's sale mail reads the same for a crate of 10 and for one item with 10 uses
// ("Arakyd Probe Droid     10"), so the guide asks (Dustin: "we can't make assumptions"):
//   default  "my numbers are usually …" — one answer for the whole shop (a food
//            seller can have 100+ listings, each stat line its own name)
//   needs    listings nothing tells us about yet
//   odd      sales that sold like the other kind on a listing they answered (variance check)
//   assumed  what we took from their earlier answers — their other listings of the item,
//            or a sale at the price of one they already answered
//   answers  everything they've said — change it, or clear it back to the guess
// Server: api/price_guide.php ?review=1 / POST {action:'mark'} (includes/price_guide.php).

const pgcState = { data: null, open: false };
const PGC_SNOOZE_KEY = 'pgcheck-snooze-until';

function pgcCount(d) {
  return d ? (d.needs || []).length + (d.odd || []).length : 0;
}

async function pgcLoad() {
  let res;
  try { res = await apiFetch('GET', 'api/price_guide.php', { params: { review: 1 } }); } catch (_) { return; }
  // older sites have no review — the button and card just stay hidden
  // (and a seller who left the Price Guide has nothing to answer)
  pgcState.data = res.ok && res.data && Array.isArray(res.data.needs) && !res.data.optout ? res.data : null;
  pgcRenderEntry();
  if (pgcState.open) pgcRender();
}

function pgcSnoozed() {
  try { return Number(localStorage.getItem(PGC_SNOOZE_KEY) || 0) > Date.now(); } catch (_) { return false; }
}

// the header button (with what's waiting) and the prompt card above the totals
function pgcRenderEntry() {
  const d = pgcState.data;
  const n = pgcCount(d);
  const any = d && (n || d.default || d.assumed.listings.length || d.assumed.sales.length
    || d.answers.listings.length || d.answers.sales.length);
  $('#pgc-open').hidden = !any;
  const badge = $('#pgc-count');
  badge.hidden = !n;
  badge.textContent = n;
  const card = $('#pgc-prompt');
  card.hidden = !n || pgcSnoozed();
  if (n) {
    const nl = d.needs.length, ns = d.odd.length;
    $('#pgc-prompt-text').textContent = [nl ? `${nl} listing${nl > 1 ? 's' : ''}` : '', ns ? `${ns} sale${ns > 1 ? 's' : ''}` : '']
      .filter(Boolean).join(' and ') + ` need${n > 1 ? '' : 's'} a quick answer for the Price Guide`;
  }
}

function pgcBtns(n, mode, data, clear) {
  const b = (m, label) => `<button type="button" class="btn btn-sm ${mode === m ? 'btn-accent' : 'btn-outline-secondary'}"
      data-pgcmark='${escapeHtml(JSON.stringify({ ...data, mode: m }))}'>${label}</button>`;
  return `<span class="pgc-btns">${b('count', `${fmtNum(n)} items`)}${b('uses', `1 item, ${fmtNum(n)} uses`)}${clear
    ? `<button type="button" class="btn btn-icon btn-sm" title="Clear — the Price Guide goes back to guessing from price"
        data-pgcmark='${escapeHtml(JSON.stringify({ ...data, mode: 'auto' }))}'><i class="fa-solid fa-xmark"></i></button>` : ''}</span>`;
}

function pgcRow(title, sub, btns) {
  return `<div class="pgc-row"><div class="pgc-what"><div class="pgc-item">${escapeHtml(title)}</div>
    <div class="settings-sub">${sub}</div></div>${btns}</div>`;
}

function pgcSection(title, hint, rows) {
  return rows.length ? `<h3 class="pgc-h">${title}</h3>${hint ? `<p class="settings-sub pgc-hint">${hint}</p>` : ''}${rows.join('')}` : '';
}

function pgcRender() {
  const d = pgcState.data;
  const box = $('#pgc-body');
  if (!d) { box.innerHTML = '<p class="settings-sub">Couldn\'t load the check — try again in a moment.</p>'; return; }
  const as = (m, n) => (m === 'uses' ? `1 item with ${fmtNum(n)} uses` : `${fmtNum(n)} items`);
  const usual = (m, label) => `<button type="button" class="btn btn-sm ${d.default === m ? 'btn-accent' : 'btn-outline-secondary'}"
      data-pgcmark='${escapeHtml(JSON.stringify({ default: 1, mode: m }))}'>${label}</button>`;
  const html = [
    `<h3 class="pgc-h">Your usual</h3><div class="pgc-row"><div class="pgc-what"><div class="pgc-item">Most of my numbers are…</div>
      <div class="settings-sub">${d.default ? 'Covers every listing you haven\'t answered on its own — sales that don\'t fit still show up below.'
        : `Answer once for your whole shop${d.needs.length > 1 ? ` instead of ${fmtNum(d.needs.length)} listings` : ''} — sales that don't fit still show up below.`}</div></div>
      <span class="pgc-btns">${usual('count', 'A crate or stack')}${usual('uses', 'One item\'s uses')}${d.default
        ? `<button type="button" class="btn btn-icon btn-sm" title="Clear — ask about each listing again"
            data-pgcmark='${escapeHtml(JSON.stringify({ default: 1, mode: 'auto' }))}'><i class="fa-solid fa-xmark"></i></button>` : ''}</span></div>`,
    pgcSection('What is the number on these?', 'Sold as a crate or stack of that many — or one item with that many uses or charges? One answer covers every sale of the listing.',
      d.needs.map((x) => pgcRow(x.item, `${fmtNum(x.sales)} sale${x.sales > 1 ? 's' : ''} · last ${fmtAgo(x.last)}`,
        pgcBtns(x.number, '', { item: x.item }, false)))),
    pgcSection('These sold differently', 'The price fits the other kind — e.g. one 10-use droid on a listing you said sells crates of 10. Until you answer, the Price Guide reads it the way the price suggests.',
      d.odd.map((x) => pgcRow(x.item, `${fmtNum(x.price)} cr · ${fmtDate(x.at)} — your usual is ${fmtNum(x.usual)} ${x.mode === 'count' ? 'each' : 'per item'}; looks like ${as(x.looks, x.number)}`,
        pgcBtns(x.number, '', { sale_id: x.sale_id }, false)))),
    pgcSection('We assumed', 'Taken from your other answers — fix any that are wrong.', [
      ...d.assumed.listings.map((x) => pgcRow(x.item, `${as(x.mode, x.number)}, like your other listings of this item`,
        pgcBtns(x.number, x.mode, { item: x.item }, false))),
      ...d.assumed.sales.map((x) => pgcRow(x.item, `${fmtNum(x.price)} cr · ${fmtDate(x.at)} — ${as(x.mode, x.number)}, like the sale you answered at this price`,
        pgcBtns(x.number, x.mode, { sale_id: x.sale_id }, false))),
    ]),
    pgcSection('Your answers', 'Change one, or clear it with × to let the Price Guide guess from price again.', [
      ...d.answers.listings.map((x) => pgcRow(x.item, 'every sale of this listing',
        pgcBtns(pgcNumber(x.item), x.mode, { item: x.item }, true))),
      ...d.answers.sales.map((x) => pgcRow(x.item, `this sale only · ${fmtNum(x.price)} cr · ${fmtDate(x.at)}`,
        pgcBtns(x.number, x.mode, { sale_id: x.sale_id }, true))),
    ]),
  ].join('');
  box.innerHTML = html || '<p class="settings-sub">Nothing to check — none of your recent sales end in a number.</p>';
}

// the trailing number of a listing name (answers can come from outside the window)
function pgcNumber(item) {
  const m = String(item).match(/(?:\s{2,}|\)\s+)(\d{1,7})\s*$/);
  return m ? Number(m[1]) : 0;
}

async function pgcMark(data) {
  const res = await apiFetch('POST', 'api/price_guide.php', { data: { action: 'mark', ...data } });
  if (!res.ok) { toast(res.error || 'Couldn\'t save that', false); return; }
  toast(data.mode === 'auto' && data.default ? 'Cleared — each listing gets asked about again'
    : data.mode === 'auto' ? 'Cleared — the Price Guide guesses from price again' : 'Saved — the Price Guide uses it from its next update');
  await pgcLoad();
}

function initPgCheck() {
  const open = () => { pgcState.open = true; pgcRender(); $('#pgc-modal').hidden = false; };
  const close = () => { pgcState.open = false; $('#pgc-modal').hidden = true; };
  $('#pgc-open').addEventListener('click', open);
  $('#pgc-prompt-go').addEventListener('click', open);
  $('#pgc-prompt-later').addEventListener('click', () => {
    try { localStorage.setItem(PGC_SNOOZE_KEY, String(Date.now() + 7 * 86400000)); } catch (_) { /* shows again next load */ }
    $('#pgc-prompt').hidden = true;
  });
  $('#pgc-close').addEventListener('click', close);
  bindBackdropClose($('#pgc-modal'), close);
  $('#pgc-body').addEventListener('click', (e) => {
    const b = e.target.closest('[data-pgcmark]');
    if (!b) return;
    let data;
    try { data = JSON.parse(b.dataset.pgcmark); } catch (_) { return; }
    pgcMark(data);
  });
  document.addEventListener('page:show', (e) => { if (e.detail?.key === 'sales') pgcLoad(); });
}
