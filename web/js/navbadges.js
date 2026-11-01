// "New" / "Updated" flags on sidebar pages.
//
// PAGE_BADGES is the one registry: sidebar data-page key → { tag: 'new' | 'updated',
// since: 'YYYY-MM-DD' }. Entries are added at ship time, alongside the release notes
// (mirror the website's list in js/nav-badges.js). A flag shows until the player opens
// that page — then it fades and stays gone — or until 30 days after `since`, whichever
// comes first. Bumping `since` on an existing entry shows it again ("updated again").
// The flag is a .nav-pill, so folded groups dot it and the collapsed rail shrinks it
// like any other pill. Seen state is per device (localStorage) — losing it only means
// seeing a flag twice.
const PAGE_BADGES = {
  components: { tag: 'new', since: '2026-11-01' },
  ideas: { tag: 'new', since: '2026-11-01' },
  quests: { tag: 'new', since: '2026-11-01' },
  insights: { tag: 'updated', since: '2026-11-01' },
  inventory: { tag: 'updated', since: '2026-11-01' },
  sales: { tag: 'updated', since: '2026-11-01' },
};
const NAV_BADGE_DAYS = 30;
const NAV_BADGE_KEY = 'nav-badges-seen';

function navBadgeSeenMap() {
  try { return JSON.parse(localStorage.getItem(NAV_BADGE_KEY) || '{}') || {}; } catch (_) { return {}; }
}

function navBadgeLive(key, seen) {
  const b = PAGE_BADGES[key];
  if (!b) return false;
  const start = new Date(`${b.since}T00:00:00`).getTime();
  if (!start || Date.now() > start + NAV_BADGE_DAYS * 86400000) return false;
  return seen[key] !== b.since;
}

function initNavBadges() {
  const seen = navBadgeSeenMap();
  Object.keys(PAGE_BADGES).forEach((key) => {
    const item = document.querySelector(`.app-sidebar .nav-item[data-page="${key}"]`);
    if (!item || item.querySelector('.nav-flag') || !navBadgeLive(key, seen)) return;
    const upd = PAGE_BADGES[key].tag === 'updated';
    const pill = document.createElement('span');
    pill.className = `nav-pill nav-flag${upd ? ' nav-flag-upd' : ''}`;
    pill.textContent = upd ? 'Updated' : 'New';
    pill.title = upd ? 'Recently updated — open it to see what changed' : 'New page';
    item.appendChild(pill);
  });
  if (typeof syncNavGroupDots === 'function') syncNavGroupDots();
}

// showPage calls this with the sidebar key it lit up: mark seen, fade the flag out
function navBadgeVisit(key) {
  const b = PAGE_BADGES[key];
  if (!b) return;
  const seen = navBadgeSeenMap();
  if (seen[key] !== b.since) {
    seen[key] = b.since;
    try { localStorage.setItem(NAV_BADGE_KEY, JSON.stringify(seen)); } catch (_) { /* private mode — it just shows again */ }
  }
  const pill = document.querySelector(`.app-sidebar .nav-item[data-page="${key}"] .nav-flag`);
  if (!pill || pill.classList.contains('nav-flag-out')) return;
  pill.classList.add('nav-flag-out');
  setTimeout(() => { pill.hidden = true; pill.remove(); if (typeof syncNavGroupDots === 'function') syncNavGroupDots(); }, 700);
}
