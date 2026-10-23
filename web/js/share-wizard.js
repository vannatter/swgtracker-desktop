/* SWG Tracker — Share wizard (WTS / WTB ad for Discord "for sale" threads).

   !! TWO COPIES — KEEP THEM BYTE-IDENTICAL !!
     website:  ~/workspace/swgtracker/js/share-wizard.js       (css/share.css)
     app:      ~/workspace/swgtrackerdesktop/web/js/share-wizard.js (web/css/share.css)
   Needs share-card.js (window.SWGTShare) loaded first. Everything host-specific
   comes in through `host`, so the same file runs on the site and in the app:

     SWGTShareWizard.open({
       resource,                 // one resource row (resource page), or…
       items: [{ resource, amount, cpu }], side: 'wts' | 'wtb',   // …a selection (stockpile / wishlist)
       host: {
         signedIn,               // bool — false: no list/character/waypoint calls (no 401 noise)
         api(method, endpoint, { params, data }) -> Promise<{ ok, status, data }>,
         searchEndpoint,         // name search: 'search.php' (site) / 'api/search.php' (app)
         toast(msg, ok),
         logoUrl, siteUrl,
         copyImage(dataUrl)      // optional: native clipboard bridge -> Promise<bool>
         saveImage(dataUrl, filename) // optional: native save -> Promise<message string | true | false | null>
                                 //   (string/true = saved, '' or false = cancelled, null = not handled -> <a download>)
       }
     })

   An ad = { side, items: [{ resource, amount, cpu }], who, contact, waypoint }.
   Steps: Buying/Selling -> Items (amount + CPU each, + Add resource) -> Who ->
   Waypoint -> Preview (Copy image / Download PNG / Copy text).
   The ad is a draft in localStorage: Share on another resource offers "Add to
   your current ad" or "Start a new ad"; "Start over" clears it. The contact line
   and the name used last are remembered too (all storage access guarded). */
(function () {
  'use strict';

  const STEPS = ['Type', 'Items', 'Who', 'Place', 'Share'];
  const LS_WHO = 'swgt-share-who';
  const LS_CONTACT = 'swgt-share-contact';
  const LS_DRAFT = 'swgt-share-ad';
  const DRAFT_DAYS = 14;
  const MAX_ITEMS = 40;
  const KEEP = ['id', 'name', 'type_name', 'type_code', 'status', 'cpu', 'oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe'];
  const lsGet = (k) => { try { return window.localStorage.getItem(k) || ''; } catch (_) { return ''; } };
  const lsSet = (k, v) => {
    try { if (v) window.localStorage.setItem(k, v); else window.localStorage.removeItem(k); } catch (_) { /* private mode etc. */ }
  };
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const slug = (s) => String(s || 'resource').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'resource';
  const numStr = (v) => (num(v) > 0 ? String(num(v)) : '');

  // only what the card needs, so the draft stays small
  function slim(r) {
    const o = {};
    r = r || {};
    KEEP.forEach((k) => { if (r[k] !== undefined && r[k] !== null) o[k] = r[k]; });
    Object.keys(r).forEach((k) => { if (/^planet_/.test(k) || /_max$/.test(k)) o[k] = r[k]; });
    return o;
  }
  function loadDraft() {
    try {
      const d = JSON.parse(lsGet(LS_DRAFT) || 'null');
      if (!d || !Array.isArray(d.items) || !d.items.length) return null;
      if (Date.now() - num(d.at) > DRAFT_DAYS * 86400000) { lsSet(LS_DRAFT, ''); return null; }
      d.items = d.items.filter((i) => i && i.resource && i.resource.name);
      return d.items.length ? d : null;
    } catch (_) { return null; }
  }

  let current = null; // one wizard at a time

  function open(opts) {
    const S = window.SWGTShare;
    if (!S) return;
    if (current) current.close();
    opts = opts || {};
    const host = opts.host || {};
    const toast = (m, ok) => { if (host.toast) host.toast(m, ok !== false); };
    const mkItem = (i) => ({
      resource: slim(i.resource), amount: numStr(i.amount), cpu: numStr(i.cpu),
      touched: num(i.amount) > 0 || num(i.cpu) > 0,
    });
    const incoming = (opts.items || (opts.resource ? [{ resource: opts.resource }] : []))
      .filter((i) => i && i.resource && i.resource.name).slice(0, MAX_ITEMS).map(mkItem);
    const draft = loadDraft();
    const st = {
      step: 0, mode: opts.side === 'wtb' || opts.side === 'wts' ? opts.side : '', items: incoming.slice(),
      who: lsGet(LS_WHO), contact: lsGet(LS_CONTACT),
      wayMode: 'none', wayPick: '', way: { planet: 'tatooine', x: '', y: '', label: '' },
      chars: [], wps: [], stock: new Map(), wish: new Map(), loading: !!host.signedIn, listsLoaded: false,
      search: { open: false, q: '', results: [], seq: 0, timer: null, busy: false },
      blob: null, dataUrl: '', text: '', renderSeq: 0,
      engaged: false, // persisted only once they get past Buying/Selling (a peek + Cancel leaves no draft)
    };
    if (incoming.length === 1) {
      const one = S.PLANETS.filter(([k]) => String(incoming[0].resource[k] == null ? '0' : incoming[0].resource[k]) === '1');
      if (one.length === 1) st.way.planet = one[0][2]; // a one-planet spawn hints where they are
    }
    // a draft in progress: ask before mixing (step -1 = the chooser)
    const draftIds = new Set(draft ? draft.items.map((i) => String(i.resource.id)) : []);
    const fresh = incoming.filter((i) => !draftIds.has(String(i.resource.id)));
    if (draft) st.step = -1;

    // ---- DOM -------------------------------------------------------------------
    const gate = document.createElement('div');
    gate.className = 'key-gate shw-gate';
    gate.dataset.ownEsc = '1'; // the site's global Esc handler leaves this one to us
    gate.innerHTML = `<div class="key-gate-card shw-card" role="dialog" aria-modal="true" aria-labelledby="shw-title">
      <div class="shw-head">
        <h2 id="shw-title"><i class="fa-solid fa-share-nodes"></i> Share <span class="shw-res"></span></h2>
        <button type="button" class="shw-over" data-shw="over" hidden title="Clear this ad and start again"><i class="fa-solid fa-rotate-left"></i> Start over</button>
        <button type="button" class="shw-x" data-shw="close" aria-label="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <ol class="shw-steps">${STEPS.map((s, i) => `<li data-step="${i}"><span class="shw-dot">${i + 1}</span><span class="shw-step-label">${s}</span></li>`).join('')}</ol>
      <div class="shw-body"></div>
      <div class="shw-msg" role="status" hidden></div>
      <div class="shw-actions">
        <button type="button" class="btn btn-sm btn-outline-secondary" data-shw="back">Back</button>
        <span class="shw-spacer"></span>
        <button type="button" class="btn btn-sm btn-accent" data-shw="next">Next <i class="fa-solid fa-arrow-right"></i></button>
      </div>
    </div>`;
    document.body.appendChild(gate);
    const $ = (sel) => gate.querySelector(sel);
    const body = $('.shw-body');

    function close() {
      document.removeEventListener('keydown', onKey, true);
      clearTimeout(st.search.timer);
      gate.remove();
      if (current && current.gate === gate) current = null;
    }
    current = { close, gate };

    function msg(text, ok) {
      const m = $('.shw-msg');
      m.hidden = !text;
      m.textContent = text || '';
      m.classList.toggle('err', ok === false);
    }

    // ---- draft ------------------------------------------------------------------------
    function saveDraft() {
      if (st.step === -1 || !st.engaged) return;
      if (!st.items.length) { lsSet(LS_DRAFT, ''); return; }
      try {
        lsSet(LS_DRAFT, JSON.stringify({
          v: 1, at: Date.now(), side: st.mode,
          items: st.items.map((i) => ({ resource: i.resource, amount: i.amount, cpu: i.cpu, touched: i.touched })),
          wayMode: st.wayMode, wayPick: st.wayPick, way: st.way,
        }));
      } catch (_) { /* quota — the ad still works this session */ }
    }
    function useDraft(addIncoming) {
      st.items = draft.items.map((i) => ({ resource: i.resource, amount: i.amount || '', cpu: i.cpu || '', touched: !!i.touched }));
      if (addIncoming) fresh.forEach((i) => { if (st.items.length < MAX_ITEMS) st.items.push(i); });
      st.mode = draft.side === 'wtb' || draft.side === 'wts' ? draft.side : st.mode;
      if (draft.wayMode) st.wayMode = draft.wayMode;
      if (draft.wayPick) st.wayPick = draft.wayPick;
      if (draft.way) st.way = Object.assign(st.way, draft.way);
      prefillAll();
      st.step = st.mode ? 1 : 0;
      st.engaged = true;
      saveDraft();
      render();
    }
    function startOver() {
      lsSet(LS_DRAFT, '');
      st.items = incoming.map((i) => Object.assign({}, i));
      st.mode = opts.side === 'wtb' || opts.side === 'wts' ? opts.side : '';
      st.wayMode = 'none'; st.wayPick = ''; st.way = { planet: st.way.planet, x: '', y: '', label: '' };
      autoMode();
      prefillAll();
      st.step = 0;
      st.engaged = false;
      render();
    }

    // ---- data for signed-in users (never called signed out) -----------------------
    async function load() {
      if (!host.signedIn || !host.api) { st.loading = false; return; }
      const call = (ep, params) => host.api('GET', ep, { params }).catch(() => null);
      const [stk, wish, chars, wps] = await Promise.all([
        call('api/stockpile.php', { perpage: 500 }),
        call('api/wishlist.php', { perpage: 500 }),
        call('api/characters.php'),
        call('api/waypoints.php'),
      ]);
      const rows = (res) => (res && res.ok && res.data && (res.data.results || res.data.characters)) || [];
      rows(stk).forEach((x) => st.stock.set(String(x.id), x));
      rows(wish).forEach((x) => st.wish.set(String(x.id), x));
      st.chars = rows(chars).map((c) => String(c.name || '').trim()).filter(Boolean);
      st.wps = rows(wps).filter((w) => num(w.mine) === 1);
      if (!st.who && st.chars.length) st.who = st.chars[0];
      st.loading = false;
      st.listsLoaded = true;
      if (!current || current.gate !== gate) return;
      if (st.step >= 0) { autoMode(); prefillAll(); saveDraft(); }
      render();
    }
    // stockpiled -> default to Selling; wishlisted -> Buying (first item decides)
    function autoMode() {
      if (st.mode || !st.items.length) return;
      const id = String(st.items[0].resource.id);
      if (st.stock.has(id)) st.mode = 'wts';
      else if (st.wish.has(id)) st.mode = 'wtb';
    }
    function fromList(item, mode) {
      const id = String(item.resource.id);
      const s = st.stock.get(id); const w = st.wish.get(id);
      if (mode === 'wts' && s) return { amount: num(s.stock), cpu: num(s.my_cpu), src: 'your stockpile' };
      if (mode === 'wtb' && w) return { amount: num(w.wtb_amount), cpu: num(w.wtb_cpu), src: 'your wishlist (WTB)' };
      return null;
    }
    function prefillAll() {
      if (!st.mode) return;
      st.items.forEach((i) => {
        if (i.touched) return;
        const p = fromList(i, st.mode);
        i.amount = p && p.amount > 0 ? String(p.amount) : '';
        i.cpu = p && p.cpu > 0 ? String(p.cpu) : '';
      });
    }
    const amountOf = (i) => S.parseAmount(i.amount);
    const cpuOf = (i) => (String(i.cpu).trim() === '' ? NaN : Number(String(i.cpu).replace(/[, ]/g, '')));
    function cardData() {
      let way = null;
      if (st.wayMode === 'pick') {
        const w = st.wps.find((x) => String(x.id) === String(st.wayPick));
        if (w) way = { planet: S.wayPlanet(w.planet), x: w.x, y: w.y, label: st.way.label || '' };
      } else if (st.wayMode === 'enter') {
        way = { planet: st.way.planet, x: st.way.x, y: st.way.y, label: st.way.label };
      }
      return {
        side: st.mode || 'wts',
        items: st.items.map((i) => ({ resource: i.resource, amount: amountOf(i) > 0 ? amountOf(i) : null, cpu: cpuOf(i) > 0 ? cpuOf(i) : null })),
        who: st.who, contact: st.contact, waypoint: way,
        date: new Date(), logoUrl: host.logoUrl, siteUrl: host.siteUrl,
      };
    }

    // ---- steps ---------------------------------------------------------------------
    function stepChooser() {
      const n = draft.items.length;
      const names = draft.items.slice(0, 6).map((i) => `<li>${esc(i.resource.name)}${i.amount ? ` <span class="shw-muted">${esc(S.fmtNum(S.parseAmount(i.amount) || 0))}</span>` : ''}</li>`).join('')
        + (n > 6 ? `<li class="shw-muted">+${n - 6} more</li>` : '');
      const addLabel = fresh.length === 1 ? `Add ${esc(fresh[0].resource.name)} to it` : `Add ${fresh.length} resources to it`;
      return `<p class="shw-lead">You have an ad in progress <span class="shw-muted">(${draft.side === 'wtb' ? 'WTB' : 'WTS'}, ${n} item${n === 1 ? '' : 's'})</span>:</p>
        <ul class="shw-draft-list">${names}</ul>
        <div class="shw-choices">
          ${fresh.length ? `<button type="button" class="btn btn-sm btn-accent" data-choose="add"><i class="fa-solid fa-plus"></i> ${addLabel} (${Math.min(MAX_ITEMS, n + fresh.length)} items)</button>` : ''}
          <button type="button" class="btn btn-sm ${fresh.length ? 'btn-outline-secondary' : 'btn-accent'}" data-choose="keep"><i class="fa-solid fa-pen"></i> ${fresh.length ? 'Open it without adding' : 'Open your ad'}</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-choose="new"><i class="fa-solid fa-file-circle-plus"></i> Start a new ad${incoming.length === 1 ? ` with ${esc(incoming[0].resource.name)}` : incoming.length ? ` with these ${incoming.length}` : ''}</button>
        </div>`;
    }
    function stepMode() {
      const one = st.items.length === 1 ? st.items[0] : null;
      const hint = (mode) => {
        if (!one) {
          const n = st.items.filter((i) => fromList(i, mode)).length;
          return n ? `<span class="shw-tile-hint">${n} of ${st.items.length} in ${mode === 'wts' ? 'your stockpile' : 'your wishlist'}</span>` : '';
        }
        const p = fromList(one, mode);
        return p ? `<span class="shw-tile-hint">In ${esc(p.src)}${p.amount > 0 ? `: ${S.fmtNum(p.amount)}` : ''}${p.cpu > 0 ? ` @ ${S.fmtCpu(p.cpu)} cpu` : ''}</span>` : '';
      };
      const what = one ? esc(one.resource.name) : st.items.length ? `these ${st.items.length} resources` : 'resources';
      return `<p class="shw-lead">Are you selling or buying ${what}?</p>
        <div class="shw-tiles">
          <button type="button" class="shw-tile shw-wts${st.mode === 'wts' ? ' on' : ''}" data-mode="wts">
            <span class="shw-tile-big">WTS</span><span class="shw-tile-sub">I'm selling</span>${hint('wts')}</button>
          <button type="button" class="shw-tile shw-wtb${st.mode === 'wtb' ? ' on' : ''}" data-mode="wtb">
            <span class="shw-tile-big">WTB</span><span class="shw-tile-sub">I'm buying</span>${hint('wtb')}</button>
        </div>
        ${st.loading ? '<p class="shw-note"><i class="fa-solid fa-spinner fa-spin"></i> Checking your stockpile and wishlist…</p>' : ''}`;
    }
    function itemHtml(it, i) {
      const r = it.resource;
      const ecpu = Math.floor(num(r.cpu));
      const p = st.mode ? fromList(it, st.mode) : null;
      return `<div class="shw-item" data-i="${i}">
        <div class="shw-item-head">
          <span class="shw-item-name">${esc(r.name)}</span><span class="shw-item-type">${esc(r.type_name || '')}</span>
          <button type="button" class="shw-item-rm" data-rm="${i}" aria-label="Remove ${esc(r.name)}" title="Remove from this ad"><i class="fa-solid fa-xmark"></i></button>
        </div>
        <div class="shw-item-row">
          <label class="shw-field"><span class="shw-label">Amount</span>
            <input class="shw-input" data-f="amount" data-i="${i}" type="text" inputmode="decimal" autocomplete="off" placeholder="50000, 50k, 1.2m" value="${esc(it.amount)}"></label>
          <label class="shw-field"><span class="shw-label">CPU <em>optional</em></span>
            <input class="shw-input" data-f="cpu" data-i="${i}" type="text" inputmode="decimal" autocomplete="off" placeholder="${ecpu > 0 ? `eCPU ${ecpu}` : 'e.g. 25'}" value="${esc(it.cpu)}"></label>
          <div class="shw-line" data-line="${i}">${lineHtml(it)}</div>
        </div>
        <div class="shw-item-foot">${ecpu > 0 ? `<button type="button" class="shw-link" data-ecpu="${i}">Use eCPU ${ecpu}</button>` : ''}${p ? `<span class="shw-muted">${p.src === 'your stockpile' ? 'In your stockpile' : 'On your wishlist'}</span>` : ''}</div>
      </div>`;
    }
    function lineHtml(it) {
      const a = amountOf(it); const c = cpuOf(it);
      if (a > 0 && c > 0) return `<b class="shw-sum">${S.fmtNum(a * c)}</b> cr`;
      if (a > 0) return '<span class="shw-muted">offer</span>';
      return '';
    }
    function stepItems() {
      const s = st.search;
      return `<p class="shw-lead">${st.mode === 'wtb' ? 'What do you want, and what will you pay?' : 'What are you selling, and for what?'}</p>
        <div class="shw-items">${st.items.map(itemHtml).join('') || '<div class="empty-state is-compact">No resources yet — add one below.</div>'}</div>
        <div class="shw-add">
          ${s.open ? `<div class="shw-search">
              <input class="shw-input" data-f="search" type="search" autocomplete="off" placeholder="Search resources by name…" value="${esc(s.q)}">
              <button type="button" class="shw-item-rm" data-shw="search-close" aria-label="Close search"><i class="fa-solid fa-xmark"></i></button>
            </div><div class="shw-results"></div>`
            : (st.items.length < MAX_ITEMS ? '<button type="button" class="shw-addbtn" data-shw="search-open"><i class="fa-solid fa-plus"></i> Add resource</button>' : '')}
        </div>
        <div class="shw-total" data-total></div>`;
    }
    function totalHtml() {
      const d = cardData();
      const t = S.totals(d);
      const n = d.items.length;
      if (!n) return '<span class="shw-muted">Add at least one resource.</span>';
      const missing = d.items.filter((i) => !(i.amount > 0)).length;
      if (missing) return `<span class="shw-muted">Enter an amount for ${n === 1 ? 'the resource' : `${missing} resource${missing === 1 ? '' : 's'}`} to continue.</span>`;
      if (!t.priced) return `<b>${n}</b> item${n === 1 ? '' : 's'} <span class="shw-muted">— no CPU shows as "${n === 1 ? 'price negotiable' : 'offer'}"</span>`;
      // several items are a shopping list — each line its own deal, so no grand total
      if (n > 1) return `<b>${n}</b> items${t.offers ? ` <span class="shw-muted">— ${t.offers} open to offers</span>` : ''}`;
      return `Total: <b class="shw-sum">${S.fmtNum(t.grand)} cr</b>`;
    }
    function resultsHtml() {
      const s = st.search;
      if (s.q.trim().length < 2) return '<div class="shw-result-note">Type at least 2 letters.</div>';
      if (s.busy && !s.results.length) return '<div class="shw-result-note"><i class="fa-solid fa-spinner fa-spin"></i> Searching…</div>';
      if (!s.results.length) return '<div class="empty-state is-compact">Nothing matches that search.</div>';
      const have = new Set(st.items.map((i) => String(i.resource.name).toLowerCase()));
      return s.results.map((r, i) => {
        const dup = have.has(String(r.name).toLowerCase());
        return `<button type="button" class="shw-result${i === 0 ? ' first' : ''}" data-pick="${esc(r.name)}"${dup ? ' disabled' : ''}>
          <span class="shw-result-name">${esc(r.name)}${String(r.status) === '1' ? '' : ' <span class="shw-muted">(despawned)</span>'}</span>
          <span class="shw-result-detail">${dup ? 'already in this ad' : esc(r.detail || '')}</span></button>`;
      }).join('');
    }
    function stepWho() {
      return `<p class="shw-lead">Who should people contact? <span class="shw-muted">Both optional.</span></p>
        <label class="shw-field"><span class="shw-label">${st.mode === 'wtb' ? 'Buyer' : 'Seller'} name</span>
          <input class="shw-input" data-f="who" type="text" maxlength="40" autocomplete="off" placeholder="Your in-game name" value="${esc(st.who)}"></label>
        ${st.chars.length ? `<div class="shw-chips"><span class="shw-muted">Your characters:</span> ${st.chars.map((c) => `<button type="button" class="shw-chip${c === st.who ? ' on' : ''}" data-char="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
        <label class="shw-field"><span class="shw-label">Contact line</span>
          <input class="shw-input" data-f="contact" type="text" maxlength="80" autocomplete="off" placeholder="in-game mail, Discord @name, vendor at Mos Eisley…" value="${esc(st.contact)}"></label>`;
    }
    function stepWay() {
      const pick = st.wps.length;
      if (st.wayMode === 'pick' && !pick) st.wayMode = 'none';
      const wpLabel = (w) => `${w.resource_name || 'Waypoint'} — ${S.wayPlanet(w.planet)} ${w.x} ${w.y}`;
      const planetOpts = S.PLANETS.map(([, n, w]) => `<option value="${w}"${w === st.way.planet ? ' selected' : ''}>${n}</option>`).join('');
      return `<p class="shw-lead">Add a ${st.mode === 'wtb' ? 'drop-off' : 'pickup'} waypoint? <span class="shw-muted">Optional.</span></p>
        <div class="shw-radios">
          <label><input type="radio" name="shw-way" value="none"${st.wayMode === 'none' ? ' checked' : ''}> No waypoint</label>
          ${pick ? `<label><input type="radio" name="shw-way" value="pick"${st.wayMode === 'pick' ? ' checked' : ''}> One of my saved waypoints</label>` : ''}
          <label><input type="radio" name="shw-way" value="enter"${st.wayMode === 'enter' ? ' checked' : ''}> Enter a location</label>
        </div>
        <div class="shw-way-pick"${st.wayMode === 'pick' ? '' : ' hidden'}>
          <select class="shw-input" data-f="wayPick">${st.wps.map((w) => `<option value="${esc(w.id)}"${String(w.id) === String(st.wayPick) ? ' selected' : ''}>${esc(wpLabel(w))}</option>`).join('')}</select>
        </div>
        <div class="shw-way-enter"${st.wayMode === 'enter' ? '' : ' hidden'}>
          <label class="shw-field"><span class="shw-label">Paste a /way line <em>optional</em></span>
            <input class="shw-input" data-f="wayPaste" type="text" autocomplete="off" placeholder="/way tatooine 3520 -4810 My vendor"></label>
          <div class="shw-row shw-row-xy">
            <label class="shw-field"><span class="shw-label">Planet</span><select class="shw-input" data-f="planet">${planetOpts}</select></label>
            <label class="shw-field"><span class="shw-label">X</span><input class="shw-input" data-f="x" type="text" inputmode="numeric" autocomplete="off" value="${esc(st.way.x)}"></label>
            <label class="shw-field"><span class="shw-label">Y</span><input class="shw-input" data-f="y" type="text" inputmode="numeric" autocomplete="off" value="${esc(st.way.y)}"></label>
          </div>
        </div>
        <label class="shw-field shw-way-label"${st.wayMode === 'none' ? ' hidden' : ''}><span class="shw-label">Label <em>optional</em></span>
          <input class="shw-input" data-f="label" type="text" maxlength="40" autocomplete="off" placeholder="${esc(st.who ? `${st.who}'s vendor` : 'My vendor')}" value="${esc(st.way.label)}"></label>
        <div class="shw-way-out"></div>`;
    }
    function stepShare() {
      return `<div class="shw-preview"><div class="shw-img-wrap"><div class="shw-rendering"><i class="fa-solid fa-spinner fa-spin"></i> Drawing your card…</div></div></div>
        <div class="shw-btns">
          <button type="button" class="btn btn-sm btn-outline-secondary" data-shw="download" disabled><i class="fa-solid fa-download"></i> Download PNG</button>
          <button type="button" class="btn btn-sm btn-outline-secondary" data-shw="copytext"><i class="fa-regular fa-copy"></i> Copy text</button>
          <button type="button" class="btn btn-sm btn-accent" data-shw="copyimg" disabled><i class="fa-regular fa-image"></i> Copy image</button>
        </div>
        <pre class="shw-text"></pre>
        <p class="shw-note">Paste the image (or the text) into a Discord "for sale" thread. This ad stays saved here — Share on another resource adds to it.</p>`;
    }

    function wayOut() {
      const d = cardData();
      const out = $('.shw-way-out');
      if (!out) return;
      const t = S.wayText(d.waypoint);
      out.innerHTML = t ? `<code>${esc(t)}</code>` : (st.wayMode === 'enter' ? '<span class="shw-muted">Pick a planet and enter X and Y.</span>' : '');
    }
    function refreshTotals() {
      st.items.forEach((it, i) => { const el = gate.querySelector(`[data-line="${i}"]`); if (el) el.innerHTML = lineHtml(it); });
      const t = $('[data-total]'); if (t) t.innerHTML = totalHtml();
    }

    function render() {
      const chooser = st.step === -1;
      $('.shw-card').dataset.step = String(st.step);
      $('.shw-res').textContent = chooser ? '' : st.items.length === 1 ? st.items[0].resource.name : st.items.length ? `${st.items.length} resources` : '';
      $('[data-shw="over"]').hidden = chooser || !st.engaged;
      gate.querySelectorAll('.shw-steps li').forEach((li, i) => {
        li.classList.toggle('on', i === st.step);
        li.classList.toggle('done', i < st.step);
      });
      body.innerHTML = chooser ? stepChooser() : [stepMode, stepItems, stepWho, stepWay, stepShare][st.step]();
      $('[data-shw="back"]').textContent = st.step <= 0 ? 'Cancel' : 'Back';
      const next = $('[data-shw="next"]');
      next.hidden = chooser || (st.step === 0 && !st.mode);
      next.innerHTML = st.step === 4 ? 'Done' : 'Next <i class="fa-solid fa-arrow-right"></i>';
      msg('');
      if (st.step === 1) {
        refreshTotals();
        if (st.search.open) { $('.shw-results').innerHTML = resultsHtml(); focus('[data-f="search"]', true); }
        else {
          const empty = st.items.findIndex((i) => !String(i.amount).trim());
          focus(`[data-f="amount"][data-i="${empty >= 0 ? empty : 0}"]`);
        }
      }
      if (st.step === 2) focus('[data-f="who"]');
      if (st.step === 3) wayOut();
      if (st.step === 4) preview();
    }
    function focus(sel, always) {
      // phones: don't pop the keyboard over the dialog on every step
      if (!always && window.matchMedia && window.matchMedia('(pointer: coarse)').matches) return;
      const el = $(sel);
      if (el) { el.focus(); if (el.select && !always) el.select(); }
    }

    function go(step) {
      if (step > st.step) {
        if (st.step === 0 && !st.mode) { msg('Pick buying or selling first.', false); return; }
        if (st.step === 1) {
          if (!st.items.length) { msg('Add at least one resource.', false); return; }
          const bad = st.items.find((i) => !(amountOf(i) > 0));
          if (bad) {
            msg(String(bad.amount).trim() ? `${bad.resource.name}: couldn't read "${bad.amount}" — try 50000, 50k or 1.2m` : `Enter an amount for ${bad.resource.name}.`, false);
            const el = gate.querySelector(`[data-f="amount"][data-i="${st.items.indexOf(bad)}"]`); if (el) el.focus();
            return;
          }
          const badCpu = st.items.find((i) => String(i.cpu).trim() !== '' && !(cpuOf(i) >= 0));
          if (badCpu) { msg(`${badCpu.resource.name}: "${badCpu.cpu}" isn't a price — use a number like 25 or 4.5`, false); return; }
        }
        if (st.step === 2) { lsSet(LS_WHO, st.who.trim()); lsSet(LS_CONTACT, st.contact.trim()); }
        if (st.step === 3 && st.wayMode === 'enter' && !S.wayText(cardData().waypoint)) {
          msg('Enter X and Y, or choose "No waypoint".', false); return;
        }
      }
      if (step < 0 || step > 4) { close(); return; }
      st.step = step;
      if (step >= 1) st.engaged = true;
      saveDraft();
      render();
    }

    async function preview() {
      const seq = ++st.renderSeq;
      const d = cardData();
      st.text = S.renderText(d);
      $('.shw-text').textContent = st.text;
      st.blob = null; st.dataUrl = '';
      let canvas;
      try { canvas = await S.renderCard(d, { scale: 2 }); } catch (e) {
        if (seq === st.renderSeq) $('.shw-img-wrap').innerHTML = '<div class="shw-rendering">Could not draw the card — Copy text still works.</div>';
        return;
      }
      if (seq !== st.renderSeq || !current || current.gate !== gate || st.step !== 4) return;
      try { st.dataUrl = canvas.toDataURL('image/png'); } catch (_) { st.dataUrl = ''; }
      const img = document.createElement('img');
      img.className = 'shw-img';
      img.alt = `${d.side === 'wtb' ? 'WTB' : 'WTS'} card`;
      img.src = st.dataUrl;
      const wrap = $('.shw-img-wrap');
      wrap.style.aspectRatio = `${canvas.width} / ${canvas.height}`;
      wrap.innerHTML = '';
      wrap.appendChild(img);
      st.blob = await new Promise((res) => { try { canvas.toBlob((b) => res(b), 'image/png'); } catch (_) { res(null); } });
      if (seq !== st.renderSeq || !current || current.gate !== gate) return;
      gate.querySelectorAll('[data-shw="copyimg"], [data-shw="download"]').forEach((b) => { b.disabled = !st.dataUrl; });
    }

    // ---- search (+ Add resource) ---------------------------------------------------------
    function runSearch() {
      const s = st.search;
      clearTimeout(s.timer);
      const q = s.q.trim();
      if (q.length < 2 || !host.api) { s.results = []; s.busy = false; paintResults(); return; }
      s.busy = true; paintResults();
      s.timer = setTimeout(async () => {
        const my = ++s.seq;
        let res = null;
        try { res = await host.api('GET', host.searchEndpoint || 'api/search.php', { params: { q } }); } catch (_) { res = null; }
        if (my !== s.seq || !current || current.gate !== gate) return;
        const data = res && res.data;
        const list = Array.isArray(data) ? data : (data && Array.isArray(data.results) ? data.results : []);
        s.results = list.filter((r) => r && r.type === 'Resource' && r.name).slice(0, 8);
        s.busy = false;
        paintResults();
      }, 220);
    }
    function paintResults() { const el = $('.shw-results'); if (el) el.innerHTML = resultsHtml(); }
    async function pick(name) {
      if (!name || st.items.some((i) => String(i.resource.name).toLowerCase() === name.toLowerCase())) return;
      msg('');
      let res = null;
      try { res = await host.api('GET', 'api/resources.php', { params: { name } }); } catch (_) { res = null; }
      const r = res && res.ok && res.data && res.data.resource;
      if (!r || !r.name) { msg(`Couldn't load ${name} — try again.`, false); return; }
      if (!current || current.gate !== gate) return;
      const it = mkItem({ resource: r });
      const p = st.mode ? fromList(it, st.mode) : null;
      if (p) { it.amount = p.amount > 0 ? String(p.amount) : ''; it.cpu = p.cpu > 0 ? String(p.cpu) : ''; }
      st.items.push(it);
      st.search = { open: false, q: '', results: [], seq: st.search.seq + 1, timer: null, busy: false };
      saveDraft();
      render();
      const el = gate.querySelector(`[data-f="amount"][data-i="${st.items.length - 1}"]`);
      if (el) { el.scrollIntoView({ block: 'nearest' }); if (!(window.matchMedia && window.matchMedia('(pointer: coarse)').matches)) el.focus(); }
    }

    // ---- share actions ----------------------------------------------------------------
    // toast + the dialog's own status line (an app toast can sit under a modal)
    function done(text) { msg(text, true); toast(text); }
    const NO_COPY = "This browser can't copy images to the clipboard — use Download PNG and drop the file into Discord, or Copy text.";
    function copyImage() {
      if (!st.blob && !st.dataUrl) return;
      // start the clipboard write synchronously inside the click (Safari/WKWebView need the gesture)
      let p;
      if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem && st.blob) {
        try { p = navigator.clipboard.write([new window.ClipboardItem({ 'image/png': st.blob })]); } catch (e) { p = Promise.reject(e); }
      } else {
        p = Promise.reject(new Error('unsupported'));
      }
      p.then(() => done('Image copied — paste it into Discord'), async () => {
        if (host.copyImage && st.dataUrl) {
          try { if (await host.copyImage(st.dataUrl)) { done('Image copied — paste it into Discord'); return; } } catch (_) { /* fall through */ }
        }
        msg(NO_COPY, false);
      });
    }
    async function download() {
      if (!st.dataUrl) return;
      const what = st.items.length === 1 ? slug(st.items[0].resource.name) : `${st.items.length}-resources`;
      const fn = `swgtracker-${st.mode || 'wts'}-${what}.png`;
      if (host.saveImage) {
        let handled = null;
        try { handled = await host.saveImage(st.dataUrl, fn); } catch (_) { handled = null; }
        if (typeof handled === 'string') { if (handled) done(handled); return; } // host's own message ('' = cancelled)
        if (handled === true) { done('PNG saved'); return; }
        if (handled === false) return;
      }
      const a = document.createElement('a');
      const url = st.blob ? URL.createObjectURL(st.blob) : st.dataUrl;
      a.href = url; a.download = fn; a.rel = 'noopener';
      document.body.appendChild(a); a.click(); a.remove();
      if (st.blob) setTimeout(() => URL.revokeObjectURL(url), 5000);
      done('PNG downloaded');
    }
    async function copyText() {
      let ok = false;
      try { await navigator.clipboard.writeText(st.text); ok = true; } catch (_) {
        const ta = document.createElement('textarea');
        ta.value = st.text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
        gate.appendChild(ta); ta.select();
        try { ok = document.execCommand('copy'); } catch (__) { ok = false; }
        ta.remove();
      }
      if (ok) done('Text copied — paste it into Discord'); else msg('Copy failed — select the text below and copy it by hand.', false);
    }

    // ---- events ---------------------------------------------------------------------------
    function onKey(e) {
      if (!current || current.gate !== gate) return;
      if (e.key === 'Escape') {
        e.stopPropagation(); e.preventDefault();
        if (st.search.open) { st.search.open = false; render(); return; }
        close(); return;
      }
      if (e.key === 'Enter' && e.target && e.target.classList && e.target.classList.contains('shw-input') && e.target.tagName === 'INPUT') {
        const f = e.target.dataset.f;
        if (f === 'wayPaste') return;
        e.preventDefault();
        if (f === 'search') { const first = gate.querySelector('.shw-result:not([disabled])'); if (first) pick(first.dataset.pick); return; }
        go(st.step + 1);
      }
    }
    document.addEventListener('keydown', onKey, true);
    let armed = false; // true backdrop click only (a text-select drag ending outside doesn't close)
    gate.addEventListener('mousedown', (e) => { armed = e.target === gate; });
    gate.addEventListener('click', (e) => {
      if (e.target === gate) { if (armed) close(); armed = false; return; }
      armed = false;
      const act = e.target.closest('[data-shw]');
      if (act) {
        const a = act.dataset.shw;
        if (a === 'close') close();
        else if (a === 'back') go(st.step - 1);
        else if (a === 'next') go(st.step + 1);
        else if (a === 'over') startOver();
        else if (a === 'copyimg') copyImage();
        else if (a === 'download') download();
        else if (a === 'copytext') copyText();
        else if (a === 'search-open') { st.search.open = true; render(); }
        else if (a === 'search-close') { st.search.open = false; render(); }
        return;
      }
      const ch0 = e.target.closest('[data-choose]');
      if (ch0) {
        const c = ch0.dataset.choose;
        if (c === 'add') useDraft(true);
        else if (c === 'keep') useDraft(false);
        else { lsSet(LS_DRAFT, ''); st.step = 0; autoMode(); prefillAll(); saveDraft(); render(); }
        return;
      }
      const tile = e.target.closest('[data-mode]');
      if (tile) {
        if (st.mode !== tile.dataset.mode) { st.mode = tile.dataset.mode; prefillAll(); }
        go(1);
        return;
      }
      const rm = e.target.closest('[data-rm]');
      if (rm) { st.items.splice(Number(rm.dataset.rm), 1); saveDraft(); render(); return; }
      const pk = e.target.closest('[data-pick]');
      if (pk) { pick(pk.dataset.pick); return; }
      const ec = e.target.closest('[data-ecpu]');
      if (ec) {
        const it = st.items[Number(ec.dataset.ecpu)];
        if (!it) return;
        it.cpu = String(Math.floor(num(it.resource.cpu))); it.touched = true;
        const inp = gate.querySelector(`[data-f="cpu"][data-i="${ec.dataset.ecpu}"]`); if (inp) inp.value = it.cpu;
        refreshTotals(); saveDraft();
        return;
      }
      const ch = e.target.closest('[data-char]');
      if (ch) {
        st.who = ch.dataset.char;
        $('[data-f="who"]').value = st.who;
        gate.querySelectorAll('[data-char]').forEach((b) => b.classList.toggle('on', b === ch));
      }
    });
    gate.addEventListener('input', (e) => {
      const f = e.target.dataset && e.target.dataset.f;
      if (!f) return;
      const v = e.target.value;
      if (f === 'amount' || f === 'cpu') {
        const it = st.items[Number(e.target.dataset.i)];
        if (!it) return;
        it[f] = v; it.touched = true; refreshTotals(); msg(''); saveDraft();
      } else if (f === 'search') { st.search.q = v; runSearch(); }
      else if (f === 'who') {
        st.who = v;
        gate.querySelectorAll('[data-char]').forEach((b) => b.classList.toggle('on', b.dataset.char === v.trim()));
      } else if (f === 'contact') st.contact = v;
      else if (f === 'x' || f === 'y' || f === 'label') { st.way[f] = v.trim() === '' ? '' : (f === 'label' ? v : v.trim()); wayOut(); saveDraft(); }
      else if (f === 'wayPaste') {
        const p = S.parseWay(v);
        if (p) {
          const known = S.PLANETS.some(([, , w]) => w === p.planet);
          if (known) st.way.planet = p.planet;
          st.way.x = String(p.x); st.way.y = String(p.y);
          if (p.label) st.way.label = p.label;
          $('[data-f="planet"]').value = st.way.planet;
          $('[data-f="x"]').value = st.way.x; $('[data-f="y"]').value = st.way.y;
          $('[data-f="label"]').value = st.way.label;
          wayOut(); saveDraft();
        }
      }
    });
    gate.addEventListener('change', (e) => {
      if (e.target.name === 'shw-way') {
        st.wayMode = e.target.value;
        if (st.wayMode === 'pick' && !st.wayPick && st.wps.length) st.wayPick = String(st.wps[0].id);
        $('.shw-way-pick').hidden = st.wayMode !== 'pick';
        $('.shw-way-enter').hidden = st.wayMode !== 'enter';
        $('.shw-way-label').hidden = st.wayMode === 'none';
        msg('');
        wayOut(); saveDraft();
        return;
      }
      const f = e.target.dataset && e.target.dataset.f;
      if (f === 'planet') { st.way.planet = e.target.value; wayOut(); saveDraft(); }
      if (f === 'wayPick') { st.wayPick = e.target.value; wayOut(); saveDraft(); }
    });

    if (st.step === 0 && st.mode) { st.step = 1; st.engaged = true; } // side known (stockpile / wishlist selection): straight to the items
    saveDraft();
    render();
    load();
    return { close };
  }

  window.SWGTShareWizard = { open };
})();
