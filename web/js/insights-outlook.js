/* Sales Insights — Sales Outlook (api/sales.php?action=outlook): the top of the
   Overview tab. Next week's forecast against your last 8 weeks (a bar chart
   with the forecast as a ninth, outlined bar and its likely range), plus what
   needs doing: items about to run out, what's heating up / cooling off, and
   prices well off the market.
   Weekly AI note (action=outlook_note): on by default, off per account; Claude
   reads item names and totals only — never buyers, vendors or other sellers —
   and writes a headline plus up to four pointers. One note a week. */

const insOut = { seq: 0, data: null, writing: false };

function insOutMount() {
  if ($('#ins-out-panel')) return;
  const pane = document.querySelector('#page-insights [data-inspane="overview"]');
  if (!pane) return;
  pane.insertAdjacentHTML('afterbegin', `
    <div class="ins-panel" data-panel="outlook" id="ins-out-panel" hidden>
      <div class="ins-panel-head"><i class="ins-caret fa-solid fa-chevron-down"></i><h2>Next week</h2><span id="ins-out-sub" class="ins-sub"></span></div>
      <div class="ins-panel-body">
        <div class="ins-out-top">
          <div class="ins-out-fc" id="ins-out-fc"></div>
          <div class="ins-out-note" id="ins-out-note"></div>
        </div>
        <div class="ins-out-lists" id="ins-out-lists"></div>
      </div>
    </div>`);
  insApplyCollapsed();
  $('#ins-out-panel').addEventListener('click', insOutClick);
}

async function insOutLoad() {
  insOutMount();
  const seq = ++insOut.seq;
  let res;
  try { res = await apiFetch('GET', 'api/sales.php', { params: { action: 'outlook' } }); }
  catch (_) { res = { ok: false }; }
  if (seq !== insOut.seq) return;
  const d = res.ok && res.data && res.data.outlook ? res.data : null;
  $('#ins-out-panel').hidden = !d;   // older site: no panel, nothing else changes
  if (!d) return;
  insOut.data = d;
  insOutRender();
  // opted in and this week's note isn't written yet → write it now (once a week)
  if (d.ai.optin && d.ai.available && !insOutFresh(d.note)) insOutWrite(false);
}

function insOutFresh(note) {
  return note && note.created && Date.now() / 1000 - note.created < 6 * 86400;
}

function insOutRender() {
  const { outlook: o } = insOut.data;
  const f = o.forecast;
  $('#ins-out-sub').textContent = f ? 'from your last 8 weeks' : '';

  // stat tiles over a chart: 8 weeks of bars, next week as a striped bar with its likely
  // range shaded behind it, and a dashed line at the 4-week average
  const weeks = o.weeks || [];
  const max = Math.max(1, ...weeks.map((w) => w.revenue), f ? f.high : 0) * 1.08;
  const h = (v) => `${Math.max(0, Math.min(100, (v / max) * 100)).toFixed(1)}%`;
  const now = Date.now();
  const day = (msAgo) => new Date(now - msAgo).toLocaleDateString(appDateFmt === 'intl' ? 'en-GB' : 'en-US', { month: 'short', day: 'numeric' });
  const bars = weeks.map((w, i) => {
    const ago = weeks.length - 1 - i;
    const from = day((ago + 1) * 7 * 86400000 - 86400000), to = day(ago * 7 * 86400000);
    return `<div class="ins-out-col${ago === 0 ? ' is-now' : ''}" title="${from} – ${to}: ${fmtNum(w.revenue)} cr from ${fmtNum(w.sales)} sale${w.sales === 1 ? '' : 's'}">
      <div class="ins-out-track"><div class="ins-out-bar" style="height:${h(w.revenue)}"></div></div>
      <span class="ins-out-lbl">${ago === 0 ? 'This wk' : from}</span></div>`;
  }).join('');
  const avg4 = f ? (weeks.slice(-4).reduce((t, w) => t + w.revenue, 0) / 4) : 0;
  const next = f ? `<div class="ins-out-col is-next" title="Next 7 days: about ${fmtNum(f.revenue)} cr — your last four weeks ran ${fmtNum(f.low)} to ${fmtNum(f.high)} cr">
      <div class="ins-out-track">
        <div class="ins-out-range" style="bottom:${h(f.low)};height:calc(${h(f.high)} - ${h(f.low)})"></div>
        <div class="ins-out-bar is-next" style="height:${h(f.revenue)}"></div>
      </div>
      <span class="ins-out-lbl">Next wk</span></div>` : '';
  const delta = f && f.last_week ? Math.round((f.revenue / f.last_week - 1) * 100) : null;
  const chip = delta === null ? '' : `<span class="ins-out-chip ${delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}" title="Against the last 7 days (${fmtNum(f.last_week)} cr)">
      <i class="fa-solid ${delta > 0 ? 'fa-arrow-up' : delta < 0 ? 'fa-arrow-down' : 'fa-equals'}"></i> ${Math.abs(delta)}% vs last 7 days</span>`;
  const tile = (cap, val, sub, cls = '') => `<div class="ins-out-tile ${cls}"><span class="ins-out-cap">${cap}</span><span class="ins-out-val">${val}</span>${sub ? `<span class="ins-out-tsub">${sub}</span>` : ''}</div>`;
  $('#ins-out-fc').innerHTML = f
    ? `<div class="ins-out-tiles">
        ${tile('Next 7 days', `${fmtNum(f.revenue)} <small>cr</small>`, chip, 'is-hero')}
        ${tile('Expected sales', `~${fmtNum(f.sales)}`, `${fmtNum(weeks.length ? weeks[weeks.length - 1].sales : 0)} in the last 7 days`)}
        ${tile('Likely range', `${fmtNum(f.low)} –<br>${fmtNum(f.high)}`, 'your slowest and best of the last 4 weeks', 'is-wrap')}
        ${o.best_days && o.best_days.length ? tile('Busiest days', o.best_days.join(' · '), 'list before these') : ''}
      </div>
      <div class="ins-out-chart">
        <div class="ins-out-avg" style="bottom:calc(18px + (100% - 18px) * ${Math.min(1, avg4 / max).toFixed(3)})" title="4-week average: ${fmtNum(Math.round(avg4))} cr"><span>4-wk avg</span></div>
        ${bars}${next}
      </div>`
    : '<div class="empty-state is-compact">A forecast needs sales in at least 3 of the last 8 weeks — check back soon.</div>';

  insOutRenderNote();

  // the to-do lists — each only when it has something
  const lists = [];
  const row = (attrs, name, right, tip) =>
    `<div class="ins-lead ins-out-row" ${attrs} title="${escapeHtml(tip)}"><span class="ins-out-name">${escapeHtml(name)}</span><span class="ins-out-right">${right}</span></div>`;
  if ((o.running_out || []).length) {
    lists.push(`<div class="ins-out-list"><h3><i class="fa-solid fa-box-open"></i> Running out</h3>${o.running_out.map((r) =>
      row(`data-outinv="${escapeHtml(r.name)}"`, r.name,
        `<b class="${r.days_left < 3 ? 'ins-down' : ''}">${r.days_left < 1 ? 'today' : `${Math.round(r.days_left)}d`}</b> <span class="ins-sub">${fmtNum(r.stocked)} left</span>`,
        `${fmtNum(r.stocked)} in stock, selling about ${r.per_week} a week — open it in My Inventory`)).join('')}</div>`);
  }
  if ((o.heating || []).length || (o.cooling || []).length) {
    lists.push(`<div class="ins-out-list"><h3><i class="fa-solid fa-chart-line"></i> Selling faster / slower</h3>${
      (o.heating || []).map((r) => row(`data-insjump="${escapeHtml(r.name)}"`, r.name,
        `<span class="ins-up"><i class="fa-solid fa-arrow-trend-up"></i> ${r.recent_wk}/wk</span>`,
        `Selling ${r.recent_wk} a week lately, usually ${r.base_wk} — show it in My Sales`)).join('')}${
      (o.cooling || []).map((r) => row(`data-insjump="${escapeHtml(r.name)}"`, r.name,
        `<span class="ins-down"><i class="fa-solid fa-arrow-trend-down"></i> ${r.recent_wk}/wk</span>`,
        `Selling ${r.recent_wk} a week lately, usually ${r.base_wk} — show it in My Sales`)).join('')}</div>`);
  }
  if ((o.price || []).length) {
    lists.push(`<div class="ins-out-list"><h3><i class="fa-solid fa-scale-balanced"></i> Priced off the market</h3>${o.price.map((r) =>
      row(`data-pgchip="${escapeHtml(r.key)}"`, r.name,
        `<span class="${r.verdict === 'low' ? 'ins-up' : 'ins-down'}">${r.verdict === 'low' ? 'below' : 'above'}</span> <span class="ins-sub">${fmtNum(r.yours)} vs ${fmtNum(r.median)} cr</span>`,
        `You usually get ${fmtNum(r.yours)} cr; most sell for ${fmtNum(r.median)} cr — open it in the Price Guide`)).join('')}</div>`);
  }
  $('#ins-out-lists').innerHTML = lists.join('');
  $('#ins-out-lists').hidden = !lists.length;
}

// "up 109% on the last 7 days (4,724,000 cr)" — the forecast against the week just gone
function insOutVsLast(f) {
  const pct = Math.round((f.revenue / f.last_week - 1) * 100);
  const dir = pct > 0 ? `<span class="ins-up">up ${pct}%</span>` : pct < 0 ? `<span class="ins-down">down ${-pct}%</span>` : 'level';
  return `${dir} on the last 7 days (${fmtNum(f.last_week)} cr)`;
}

function insOutRenderNote() {
  const box = $('#ins-out-note');
  const { note, ai } = insOut.data;
  if (!ai.available) { box.hidden = true; return; }
  box.hidden = false;
  if (!ai.optin) {   // on by default — this is someone who turned it off
    box.innerHTML = `<div class="ins-out-note-hd"><i class="fa-solid fa-wand-magic-sparkles"></i> Weekly AI note <span class="ins-sub">off</span></div>
      <p class="ins-out-note-off">A short weekly note on what to restock, reprice and push, written by AI from these numbers.
      It only sees item names and totals, never your buyers, vendors or other sellers.</p>
      <button class="btn btn-sm btn-outline-secondary" data-outoptin><i class="fa-solid fa-wand-magic-sparkles"></i> Turn it back on</button>`;
    return;
  }
  if (insOut.writing && !note) {
    box.innerHTML = '<div class="ins-out-note-hd"><i class="fa-solid fa-wand-magic-sparkles"></i> Weekly AI note</div><p class="ins-sub"><span class="spinner"></span> Writing this week’s note…</p>';
    return;
  }
  if (!note) {
    box.innerHTML = `<div class="ins-out-note-hd"><i class="fa-solid fa-wand-magic-sparkles"></i> Weekly AI note</div>
      <p class="ins-sub">${escapeHtml(insOut.why || 'No note yet — it needs a few weeks of sales.')}</p>
      <div class="ins-out-note-foot"><a role="button" data-outoptout>Turn off</a></div>`;
    return;
  }
  box.innerHTML = `<div class="ins-out-note-hd"><i class="fa-solid fa-wand-magic-sparkles"></i> Weekly AI note
      <span class="ins-sub">${note.created ? fmtAgo(note.created) : ''}</span></div>
    <p class="ins-out-headline">${escapeHtml(note.headline)}</p>
    ${(note.tips || []).length ? `<div class="ins-out-tips">${note.tips.map((t) => {
      const [icon, label] = INS_OUT_KIND[t.kind] || INS_OUT_KIND.other;
      return `<div class="ins-out-tip is-${escapeHtml(t.kind || 'other')}"${t.item ? ` data-insjump="${escapeHtml(t.item)}" title="Show “${escapeHtml(t.item)}” in My Sales"` : ''}>
        <i class="fa-solid ${icon}" title="${label}"></i><span>${escapeHtml(t.text)}</span></div>`;
    }).join('')}</div>` : ''}
    <div class="ins-out-note-foot">
      <span class="ins-sub" title="Sees item names and totals only — never your buyers, vendors or other sellers">AI-written from your numbers — check before you act</span>
      <span>${insOut.writing ? '<span class="spinner"></span>' : `<a role="button" data-outrefresh title="Rewrite it from today's numbers (once a day)">Refresh</a>`} · <a role="button" data-outoptout>Turn off</a></span>
    </div>`;
}

// tip kind → icon, label (sales_outlook.php asks the model to tag each tip)
const INS_OUT_KIND = {
  restock: ['fa-box-open', 'Restock'],
  price: ['fa-scale-balanced', 'Price'],
  demand: ['fa-arrow-trend-up', 'Selling faster'],
  slowdown: ['fa-arrow-trend-down', 'Selling slower'],
  timing: ['fa-calendar-day', 'Timing'],
  other: ['fa-lightbulb', 'Tip'],
};

const INS_OUT_WHY = {
  too_little: 'Not enough sales yet for a useful note — it needs a few weeks of sales.',
  busy: 'Lots of notes being written today — yours will come on your next visit.',
  failed: 'Couldn’t write the note just now — it will try again on your next visit.',
  unavailable: 'AI notes aren’t available right now.',
};

async function insOutWrite(force) {
  if (insOut.writing) return;
  insOut.writing = true;
  insOutRenderNote();
  let res;
  // the action rides in the URL: the shell drops params on POST
  try { res = await apiFetch('POST', 'api/sales.php?action=outlook_note', { data: { force: force ? 1 : 0 } }); }
  catch (_) { res = { ok: false }; }
  insOut.writing = false;
  if (res.ok && res.data) {
    if (res.data.note) insOut.data.note = res.data.note;
    insOut.why = INS_OUT_WHY[res.data.status] || '';
    if (force && res.data.status === 'stored') toast('The note can be refreshed once a day — this is today’s');
  } else {
    insOut.why = INS_OUT_WHY.failed;
  }
  insOutRenderNote();
}

async function insOutSetOptin(on) {
  const res = await apiFetch('PUT', 'api/prefs.php', { data: { ui: { sales_ai_note: on } } });
  if (!res.ok) { toast(res.error || 'Couldn’t save that — try again', false); return; }
  insOut.data.ai.optin = on;
  if (!on) { insOut.data.note = null; insOutRenderNote(); toast('Weekly AI note turned off'); return; }
  insOutWrite(false);
}

function insOutClick(e) {
  if (e.target.closest('[data-outoptin]')) { insOutSetOptin(true); return; }
  if (e.target.closest('[data-outoptout]')) { insOutSetOptin(false); return; }
  if (e.target.closest('[data-outrefresh]')) { insOutWrite(true); return; }
  const jump = e.target.closest('[data-insjump]');
  if (jump) { insFilterSales(jump.dataset.insjump); return; }
  const inv = e.target.closest('[data-outinv]');
  if (inv) {
    showPage('inventory');
    const s = $('#inv-search');
    if (s) { s.value = inv.dataset.outinv; s.dispatchEvent(new Event('input')); }
  }
  // [data-pgchip] rows open the Price Guide through priceguide.js's document handler
}
