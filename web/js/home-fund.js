// ---- Home → server fund drive block (Nov 1 – Dec 31 only) ----
// Same block as the website's homepage (index.php): why the drive matters, the
// total, Donate (opens PayPal), the approved supporter notes, and "Leave a note"
// (api/fund_notes.php — notes show once Dustin approves them in admin/fund.php).
// Totals + notes come from GET api/fund_notes.php; before that endpoint is on the
// site, the pulse's fund (the sidebar card) fills the block without notes.
const homeFund = { data: null, noteApi: false, loaded: false };

async function homeFundLoad() {
  let r = null;
  try { r = await apiFetch('GET', 'api/fund_notes.php'); } catch (_) { r = null; }
  if (r && r.ok && r.data && r.data.fund) {
    homeFund.data = { fund: r.data.fund, notes: r.data.notes || [], limits: r.data.limits || {} };
    homeFund.noteApi = true;
  } else {
    homeFund.data = window.appFund ? { fund: window.appFund, notes: [], limits: {} } : null;
    homeFund.noteApi = false;
  }
  homeFund.loaded = true;
  homeFundRender();
}

// past the base, every `month` dollars covers one month of the drive's year
// (the site sends month/months; an older site deploy gets them worked out here)
function homeFundMonths(f) {
  const month = f.month != null ? Number(f.month) : 50;
  const raised = Number(f.raised) || 0, goal = Number(f.goal) || 0;
  const months = f.months != null ? Number(f.months) : (month > 0 ? Math.min(12, Math.max(0, (raised - goal) / month)) : 0);
  return { month, months };
}

function homeFundRender() {
  const box = $('#home-fund');
  if (!box) return;
  const d = homeFund.data;
  const f = d && d.fund;
  if (!f || !f.active) { box.hidden = true; box.innerHTML = ''; return; }
  const money = (v) => '$' + (Number.isInteger(Number(v)) ? Number(v).toLocaleString() : Number(v).toFixed(2));
  const raised = Number(f.raised) || 0, goal = Number(f.goal) || 0;
  const { month, months } = homeFundMonths(f);
  const year = safeInt(f.year), n = safeInt(f.donations);
  const base = goal > 0 ? Math.min(100, Math.floor(raised / goal * 100)) : 100;
  const MN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const full = Math.floor(months);
  const fullYear = goal + 12 * month;   // the whole year: base + every month
  const all = fullYear > 0 ? Math.min(100, Math.round(raised / fullYear * 1000) / 10) : 0;
  let sub;
  if (raised < goal) sub = `${money(goal - raised)} to go for the base — then every ${money(month)} covers a month of the ${year} server bill`;
  else if (months >= 12) sub = `The whole ${year} server bill is covered — thank you!`;
  else {
    const left = Math.round((goal + (full + 1) * month - raised) * 100) / 100;   // from dollars, not the rounded month count
    sub = `<b>${MN[full]}:</b> ${money(Math.round((month - left) * 100) / 100)} of ${money(month)} — ${money(left)} to go`;
  }
  const segs = MN.map((m, i) => {
    const fill = Math.round(Math.max(0, Math.min(1, months - i)) * 100);
    const tip = `${m} ${year} — ${fill >= 100 ? 'covered' : fill > 0 ? `${money(Math.round(fill / 100 * month * 100) / 100)} of ${money(month)}` : 'not covered yet'}`;
    return `<span class="hm-fund-s${fill >= 100 ? ' full' : fill > 0 ? ' part' : ''}" title="${tip}"><i style="width:${fill}%"></i></span>`;
  }).join('');
  const segLbl = MN.map((m) => `<span>${m[0]}</span>`).join('');
  const folded = (() => { try { return localStorage.getItem(`homeFundFolded:${year}`) === '1'; } catch (_) { return false; } })();
  const notes = (d.notes || []).map((x) => `<figure class="hm-fund-note">
      <blockquote>${escapeHtml(x.message)}</blockquote>
      <figcaption>— ${escapeHtml(x.name || 'Anonymous')} <span>${new Date(safeInt(x.created) * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })}</span></figcaption>
    </figure>`).join('');
  box.className = `hm-fund${folded ? ' collapsed' : ''}`;
  box.innerHTML = `
    <div class="hm-fund-head" data-fundtoggle role="button" tabindex="0" aria-expanded="${folded ? 'false' : 'true'}">
      <span class="hm-fund-badge"><i class="fa-solid fa-heart"></i></span>
      <span class="hm-fund-titles">
        <span class="hm-fund-kicker">${year} server fund · until Dec 31</span>
        <span class="hm-fund-h">Help keep SWG Tracker running in ${year}</span>
      </span>
      <span class="hm-fund-headtotal">
        <span class="hm-fund-headline"><b>${money(raised)}</b> of ${money(fullYear)} · ${full} of 12 months</span>
        <span class="hm-fund-headbar"><span style="width:${all}%"></span><i style="left:${(goal / Math.max(1, fullYear) * 100).toFixed(1)}%"></i></span>
      </span>
      <i class="fa-solid fa-chevron-down hm-fund-caret"></i>
    </div>
    <div class="hm-fund-body">
      <div class="hm-fund-main">
        <div class="hm-fund-why">
          <p><b>SWG Tracker is free, and it stays up because players chip in.</b> The site, this app’s data, mail parsing, Survey Droid reports, phone notifications and the Price Guide all run on one server that costs about ${money(month)} a month — and DoS pays that bill out of pocket.</p>
          <p>Every November and December we raise the next year’s costs. The first ${money(goal)} is the base; after that, every ${money(month)} covers one month of the ${year} server bill. Any amount helps.</p>
          <p class="hm-fund-quote">“Thanks for everyone’s help keeping this going — and for keeping my wife off my back about what I spend on video games. 😉” <span>— DoS</span></p>
          <p class="hm-fund-alt"><i class="fa-solid fa-hand-holding-heart"></i><span><b>Can’t donate? That’s okay.</b> Telling a guildmate about SWG Tracker, or sharing an idea on the <a href="#" data-fundideas>Ideas board</a>, helps keep it going just as much.</span></p>
        </div>
        <div class="hm-fund-side">
          <div class="hm-fund-total">${money(raised)} <span>raised${n ? ` from ${n} donation${n === 1 ? '' : 's'}` : ''}</span></div>
          <div class="hm-fund-all" role="progressbar" aria-label="All of ${year}" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${Math.floor(all)}"
               title="${money(raised)} of ${money(fullYear)} — the ${money(goal)} base plus 12 months at ${money(month)}"><span style="width:${all}%"></span><i class="hm-fund-all-tick" style="left:${(goal / Math.max(1, fullYear) * 100).toFixed(1)}%"></i></div>
          <div class="hm-fund-alllbl">${raised >= goal ? `<span class="hm-fund-ok"><i class="fa-solid fa-check"></i> ${money(goal)} base reached</span>` : `<span>${money(Math.round((goal - raised) * 100) / 100)} to the ${money(goal)} base</span>`}<span>${Math.floor(all)}% of ${money(fullYear)}</span></div>
          <div class="hm-fund-segk"><span>${year} by month</span><span><b>${full}</b> of 12 covered</span></div>
          <div class="hm-fund-seg" role="img" aria-label="${full} of 12 months of the ${year} server bill covered">${segs}</div>
          <div class="hm-fund-seglbl">${segLbl}</div>
          <div class="hm-fund-sub">${sub}</div>
          <div class="hm-fund-btns">
            <button type="button" class="btn btn-outline-secondary hm-fund-notebtn" data-fundnote title="Leave a few words for the community"><i class="fa-regular fa-comment"></i> Leave a note</button>
            <button type="button" class="btn btn-accent hm-fund-donate" data-funddonate title="Opens PayPal in your browser"><i class="fa-solid fa-heart"></i> Donate</button>
          </div>
        </div>
      </div>
      ${notes ? `<div class="hm-fund-notes-label">Notes from supporters</div><div class="hm-fund-notes">${notes}</div>` : ''}
    </div>`;
  box.hidden = false;
}

function homeFundOpenNote() {
  const lim = (homeFund.data && homeFund.data.limits) || {};
  const msg = $('#home-fund-msg');
  msg.maxLength = safeInt(lim.message) || 280;
  $('#home-fund-name').maxLength = safeInt(lim.name) || 40;
  if (!$('#home-fund-name').value && typeof appPrefs !== 'undefined' && appPrefs.name) $('#home-fund-name').value = appPrefs.name;
  const yr = safeInt(homeFund.data && homeFund.data.fund && homeFund.data.fund.year);
  $('#home-fund-dlgsub').textContent = `Donated, or just want to say thanks? Leave a few words for the ${yr ? `${yr} ` : ''}server fund. Notes appear on Home, here and on swgtracker.com, once they’ve been read.`;
  $('#home-fund-left').textContent = String(msg.maxLength - msg.value.length);
  $('#home-fund-modal').hidden = false;
  msg.focus();
}

async function homeFundSend() {
  const btn = $('#home-fund-send');
  const message = $('#home-fund-msg').value.trim();
  if (message.length < 2) { toast('Write a short note first', false); $('#home-fund-msg').focus(); return; }
  btn.disabled = true;
  let r;
  try { r = await apiFetch('POST', 'api/fund_notes.php', { data: { name: $('#home-fund-name').value.trim(), message } }); }
  catch (e) { r = { ok: false, error: String(e) }; }
  btn.disabled = false;
  if (!r.ok) {
    // the note endpoint ships with the site update; before that the app says so plainly
    const missing = /404|not found/i.test(String(r.error || '')) || !homeFund.noteApi;
    toast(missing ? 'Notes need the latest swgtracker.com update — try again soon' : (r.error || 'Couldn’t send your note — try again'), false);
    return;
  }
  $('#home-fund-msg').value = '';
  $('#home-fund-modal').hidden = true;
  toast('Thank you! Your note will show on Home once it’s been read.');
}

document.addEventListener('DOMContentLoaded', () => {
  const box = $('#home-fund');
  if (!box) return;
  const fold = () => {
    const year = safeInt(homeFund.data && homeFund.data.fund && homeFund.data.fund.year);
    const on = !box.classList.contains('collapsed');
    box.classList.toggle('collapsed', on);
    const h = box.querySelector('[data-fundtoggle]');
    if (h) h.setAttribute('aria-expanded', on ? 'false' : 'true');
    try { if (on) localStorage.setItem(`homeFundFolded:${year}`, '1'); else localStorage.removeItem(`homeFundFolded:${year}`); } catch (_) { /* private */ }
  };
  box.addEventListener('click', (e) => {
    if (e.target.closest('[data-fundnote]')) { homeFundOpenNote(); return; }
    if (e.target.closest('[data-funddonate]')) {
      const url = String((homeFund.data && homeFund.data.fund && homeFund.data.fund.url) || '');
      if (/^https:\/\//.test(url)) { try { api().open_external(url); } catch (_) { /* ignore */ } }
      return;
    }
    if (e.target.closest('[data-fundideas]')) { e.preventDefault(); if (typeof showPage === 'function') showPage('ideas'); return; }
    if (e.target.closest('[data-fundtoggle]')) fold();
  });
  box.addEventListener('keydown', (e) => { if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('[data-fundtoggle]')) { e.preventDefault(); fold(); } });
  $('#home-fund-cancel').addEventListener('click', () => { $('#home-fund-modal').hidden = true; });
  $('#home-fund-send').addEventListener('click', homeFundSend);
  $('#home-fund-msg').addEventListener('input', (e) => { $('#home-fund-left').textContent = String(e.target.maxLength - e.target.value.length); });
});
