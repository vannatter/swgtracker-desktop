/* Data freshness (Ideas #52) — when spawn or price data is running behind, say
   so ("Spawn data is 4h old") instead of quietly showing older data.

   api/status.php reports when the site last read the full resource feed
   (admin/parser.php) and last rebuilt the Price Guide (admin/cron_price_guide.php).
   Spawn data older than FRESH_SPAWN_H shows a dismissible bar app-wide; a
   Price Guide older than FRESH_PRICE_H shows a line on the Price Guide page.
   Either marker missing (the job hasn't run since this shipped, or an older
   site) or the request failing (offline has its own banner) shows nothing. */

const FRESH_SPAWN_H = 3;      // the feed normally lands well inside this
const FRESH_PRICE_H = 36;     // the guide rebuilds nightly
const FRESH_POLL_MS = 10 * 60 * 1000;
const freshState = { spawn: null, price: null, now: 0 };

const freshAgeH = (ts) => (ts ? (Date.now() / 1000 - ts) / 3600 : 0);
function freshAgeText(ts) {
  const h = freshAgeH(ts);
  if (h < 48) return `${Math.max(1, Math.floor(h))}h`;
  return `${Math.floor(h / 24)} days`;
}
const freshClock = (ts) => new Date(ts * 1000).toLocaleString([], { weekday: 'short', hour: 'numeric', minute: '2-digit' });

async function freshCheck() {
  let res;
  try { res = await apiFetch('GET', 'api/status.php'); } catch (_) { return; }
  if (!res || !res.ok || !res.data) return;
  freshState.spawn = safeInt(res.data.spawn_feed_at) || null;
  freshState.price = safeInt(res.data.price_guide_at) || null;
  freshRender();
}

function freshRender() {
  const bar = $('#fresh-bar');
  const s = freshState.spawn;
  let hidden = 0;
  try { hidden = safeInt(localStorage.getItem('fresh-hidden')); } catch (_) { /* show it */ }
  const late = !!s && freshAgeH(s) >= FRESH_SPAWN_H;
  if (bar) {
    bar.hidden = !late || hidden === s;
    if (late) {
      $('#fresh-text').textContent = `Spawn data is ${freshAgeText(s)} old — the resource feed hasn't updated since ${freshClock(s)}, so new spawns and despawns since then aren't showing yet.`;
      bar.title = 'swgtracker.com reads the galaxy’s resource feed through the day. This clears by itself once it catches up.';
    }
  }
  const pg = $('#pg-fresh');
  const p = freshState.price;
  if (pg) {
    const old = !!p && freshAgeH(p) >= FRESH_PRICE_H;
    pg.hidden = !old;
    if (old) pg.innerHTML = `<i class="fa-solid fa-clock-rotate-left"></i> These prices were last updated ${escapeHtml(freshClock(p))} (${escapeHtml(freshAgeText(p))} ago) — the nightly update is running behind.`;
  }
}

document.addEventListener('DOMContentLoaded', () => {
  $('#fresh-hide').addEventListener('click', () => {
    try { localStorage.setItem('fresh-hidden', String(freshState.spawn || 0)); } catch (_) { /* hides for this session only */ }
    $('#fresh-bar').hidden = true;
  });
  setTimeout(freshCheck, 8000);           // after boot's own requests
  setInterval(freshCheck, FRESH_POLL_MS);
  setInterval(freshRender, 60 * 1000);    // the age text keeps counting between checks
});
