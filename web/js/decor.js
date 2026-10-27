/* web/js/decor.js — holiday decorations in Home's header band. Date-driven like the
   seasonal logo and the holiday accent bar (app.js), so they turn on and off by
   themselves. A layer behind the greeting and buttons (pointer-events: none);
   reduced-motion keeps it still. The website runs the same file as js/decor.js.

   October: bats drifting across a pale moon (Dustin, 2026-10-27).
   Preview another season: localStorage.setItem('decor-preview', 'halloween').

     decorMount(hostEl)   // idempotent; call once the header exists
*/
(function () {
  'use strict';

  // one bat: a body and two wings, each wing a group hinged at its shoulder so the
  // wingbeat lifts, then sweeps down folding toward the body (not a whole-shape squash)
  const WING = '<path d="M30 13C25 7 15 5 3 9c4 1.4 5.2 4 4.4 7.4 3-1.8 6.4-1.2 8.4 1.4 1.6-2.4 4.4-3 7-1.6 1.8-2.4 4.6-3 7.2-2z"/>';
  const BAT = '<svg viewBox="0 0 64 32" aria-hidden="true">'
    + `<g class="hd-wing">${WING}</g>`
    + `<g transform="translate(64 0) scale(-1 1)"><g class="hd-wing">${WING}</g></g>`
    + '<ellipse cx="32" cy="16" rx="3.4" ry="6"/><circle cx="32" cy="9.6" r="2.8"/>'
    + '<path d="M29.8 8.6 30.4 4.6 31.6 7.8zM34.2 8.6 33.6 4.6 32.4 7.8z"/></svg>';

  const SEASONS = {
    halloween: {
      when: (m) => m === 10,
      html() {
        // the moon half-hidden by slow clouds (Dustin), then the bats
        const wisps = [[4, 70, 0], [16, 92, -38], [26, 60, -70], [10, 110, -20]]   // [top px, seconds, delay]
          .map(([t, d, dl], k) => `<div class="hd-wisp" style="--wt:${t}px;--wd:${d}s;--wdl:${dl}s;--ww:${180 + k * 30}px"></div>`).join('');
        const n = 7, out = [`<div class="hd-sky"><div class="hd-moon"></div>${wisps}</div>`];
        for (let i = 0; i < n; i++) {
          const size = 18 + Math.round(Math.random() * 20);        // 18–38px wide
          const top = 4 + Math.round(Math.random() * 40);          // % down the band (upper part — the band fades to page below)
          const dur = 26 + Math.round(Math.random() * 30);         // seconds per crossing
          const delay = -Math.round(Math.random() * dur);          // spread out from the start
          const flap = (0.22 + Math.random() * 0.18).toFixed(2);   // wingbeat
          const bob = (4 + Math.random() * 8).toFixed(1);          // px of rise and fall
          out.push(`<span class="hd-bat" style="--x:${Math.round(Math.random() * 90)}%;--sz:${size}px;--top:${top}%;--dur:${dur}s;--delay:${delay}s;--flap:${flap}s;--bob:${bob}px;--o:${(0.75 + Math.random() * 0.25).toFixed(2)}">`
            + `<span class="hd-bat-bob">${BAT}</span></span>`);
        }
        return out.join('');
      },
    },
  };

  function pickSeason(now = new Date()) {
    let preview = '';
    try { preview = localStorage.getItem('decor-preview') || ''; } catch (_) { /* private mode */ }
    if (preview && SEASONS[preview]) return preview;
    const m = now.getMonth() + 1, d = now.getDate();
    return Object.keys(SEASONS).find((k) => SEASONS[k].when(m, d)) || '';
  }

  function decorMount(host) {
    if (!host || host.querySelector(':scope > .hd-layer')) return;
    const key = pickSeason();
    if (!key) return;
    const layer = document.createElement('div');
    layer.className = `hd-layer hd-${key}`;
    layer.setAttribute('aria-hidden', 'true');
    layer.innerHTML = SEASONS[key].html();
    host.prepend(layer);
  }

  window.decorMount = decorMount;
})();
