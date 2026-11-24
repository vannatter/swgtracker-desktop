/* Stables (Beasts) — a player's own pets, standing around a stable in 3D.

   Data: api/stables.php (website includes/stables.php) — one stable per player,
   up to 60 pets, each a species from the pet list plus what the player knows about
   theirs (nickname, colour, level, DPS/armor, lyase stats, specials, mutation,
   legacy DNA, incubator, roles, favourite, notes). Private unless shared; a shared
   stable has a public page at swgtracker.com/stable.php?s=TOKEN.

   The stage is a group photo in a semicircle: the pet up front is big and low,
   three each side step up and back round the arc, overlapping, all standing
   still at one three-quarter angle. Hovering a pet pops up its details. Only those seven mount live <swg-creature>
   viewers (WebKit caps a page at ~16 WebGL contexts); a viewer that rotates out is
   removed, which frees its context. Slot elements stay put in the DOM and only
   their data-pos changes — moving a viewer in the DOM would restart it. */

// The website runs this same file: portal/stables.php (signed in, editable) and
// stable.php?s=TOKEN (someone's shared stable, read-only) — copied to swgtracker/js/
// stables.js with js/stables-shim.js standing in for the app helpers it calls.
// Keep the two copies identical. window.STAB_BOOT = { share: TOKEN } = read-only.
const STAB_SHARE = (window.STAB_BOOT && window.STAB_BOOT.share) || '';
const STAB_RO = !!STAB_SHARE;
const stab = { loaded: false, loading: false, stable: null, all: [], pets: [], max: 60, shareUrl: '', front: 0, species: null, error: '', filter: 'all' };
// owned · on the way · a pet you're after but don't have yet (stands in the stable as a ghost)
const STAB_STATUS = [['owned', 'Owned', 'fa-check'], ['incubating', 'Incubating', 'fa-egg'], ['wanted', 'Wanted', 'fa-heart']];
const stabStatus = (p) => (STAB_STATUS.some(([k]) => k === p.status) ? p.status : 'owned');
// stab.all = every pet in stable order; stab.pets = the ones the filter shows (what the stage, strip and card use)
function stabView() {
  const keep = stab.front < stab.pets.length ? stab.pets[stab.front].id : null;
  stab.pets = stab.filter === 'all' ? stab.all.slice() : stab.all.filter((p) => stabStatus(p) === stab.filter);
  const at = keep === null ? -1 : stab.pets.findIndex((p) => p.id === keep);
  stab.front = at >= 0 ? at : Math.min(stab.front, Math.max(0, stab.pets.length - 1));
}
const STAB_ROLES = [['mount', 'Mount', 'fa-horse'], ['combat', 'Combat', 'fa-khanda'], ['display', 'Display', 'fa-star'], ['sale', 'For sale', 'fa-tag']];
const STAB_MUT = ['Base', '1st mutation', '2nd mutation', '3rd mutation'];
const STAB_VISIBLE = 3; // pets each side of the front one (7 live viewers, well under the ~16 WebGL cap)

const stabModelSrc = (m) => (!m ? '' : (/^https?:/i.test(m) ? m : SITE_BASE + (m.startsWith('/') ? '' : '/') + m));
const stabName = (p) => p.nickname || p.species;
const stabRgb = (s) => { const a = String(s || '').split(',').map(Number); return a.length === 3 && a.every((n) => n >= 0 && n <= 255) ? a : null; };
const stabHex = (s) => { const a = stabRgb(s); return a ? '#' + a.map((n) => n.toString(16).padStart(2, '0')).join('') : ''; };

async function stabApi(method, data, params) {
  if (STAB_SHARE) { if (method !== 'GET') return { error: 'This stable is read-only' }; params = { share: STAB_SHARE }; }
  let res;
  try { res = await apiFetch(method, 'api/stables.php', { data, params }); } catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok || !res.data || res.data.error) return { error: (res.data && res.data.error) || res.error || 'Could not reach swgtracker.com' };
  return res.data;
}
function stabTake(d) {
  stab.stable = d.stable; stab.owner = d.owner || ''; stab.all = d.pets || []; stab.max = d.max || 60; stab.shareUrl = d.share_url || '';
  stabView();
}

async function loadStables(force = false) {
  if (stab.loaded && !force) { renderStables(); return; }
  if (stab.loading) return;
  stab.loading = true;
  const d = await stabApi('GET');
  stab.loading = false;
  if (d.error) { stab.error = d.error; renderStables(); return; }
  stab.error = '';
  stabTake(d);
  stab.loaded = true;
  renderStables();
}

// ---------- page ----------
function renderStables() {
  const root = $('#stab-root');
  if (!root) return;
  $('#stab-title').textContent = stab.stable ? stab.stable.name : 'Stables';
  const sub = $('#stab-owner'); if (sub) sub.textContent = stab.owner ? `${stab.owner}'s stable · ${stab.all.length} pet${stab.all.length === 1 ? '' : 's'}` : '';
  $('#stab-share-btn')?.classList.toggle('is-on', !!(stab.stable && stab.stable.is_public));
  if (stab.error && !stab.loaded) {
    root.innerHTML = `<div class="stab-empty"><i class="fa-solid fa-horse-head"></i><div>${escapeHtml(stab.error)}</div></div>`;
    return;
  }
  if (!root.querySelector('.stab-stage')) {
    root.innerHTML = `
      <div class="stab-stage" tabindex="0">
        <div class="stab-slots"></div>
        <div class="stab-slots stab-tags"></div>
        <div class="stab-pop" hidden></div>
        <button type="button" class="stab-arrow stab-arrow-l" data-stabstep="-1" title="Previous pet (←)"><i class="fa-solid fa-chevron-left"></i></button>
        <button type="button" class="stab-arrow stab-arrow-r" data-stabstep="1" title="Next pet (→)"><i class="fa-solid fa-chevron-right"></i></button>
        <div class="stab-stage-empty" hidden>
          <i class="fa-solid fa-horse-head"></i>
          <div>${STAB_RO ? 'No pets in this stable yet.' : 'Your stable is empty.'}</div>
          ${STAB_RO ? '' : '<button type="button" class="btn btn-accent" data-stabadd><i class="fa-solid fa-plus"></i> Add your first pet</button>'}
        </div>
      </div>
      <div class="stab-bar"><div id="stab-filter" class="stab-filter"></div><div id="stab-strip" class="stab-strip"></div></div>
      <div id="stab-card" class="stab-card"></div>`;
  }
  renderStabFilter();
  renderStabStage();
  renderStabStrip();
  renderStabCard();
}

// position of pet i relative to the front one
function stabPos(i) {
  const n = stab.pets.length;
  let d = i - stab.front;
  if (n >= 3) { d = ((d % n) + n) % n; if (d > n / 2) d -= n; } // the arc wraps round: neighbours on both sides
  return d;
}

function renderStabStage() {
  const stage = $('#stab-root .stab-stage');
  if (!stage) return;
  const slots = stage.querySelector('.stab-slots:not(.stab-tags)');
  const tags = stage.querySelector('.stab-tags'); // name labels ride above every pet, in step with their slots
  const empty = !stab.pets.length;
  stage.querySelector('.stab-stage-empty').hidden = !empty;
  stage.querySelectorAll('.stab-arrow').forEach((b) => { b.hidden = stab.pets.length < 2; });
  const want = new Map();
  stab.pets.forEach((p, i) => { const pos = stabPos(i); if (Math.abs(pos) <= STAB_VISIBLE) want.set(String(p.id), { p, pos }); });
  // drop slots that left the stage (their viewer's WebGL context goes with them)
  slots.querySelectorAll('.stab-slot').forEach((el) => { if (!want.has(el.dataset.id)) el.remove(); });
  tags.querySelectorAll('.stab-slot').forEach((el) => { if (!want.has(el.dataset.id)) el.remove(); });
  want.forEach(({ p, pos }, id) => {
    let el = slots.querySelector(`.stab-slot[data-id="${id}"]`);
    const sig = [p.pet_slug, p.color].join('|');
    if (el && el.dataset.sig !== sig) { el.remove(); el = null; } // species / colour changed: new viewer
    if (!el) {
      el = document.createElement('div');
      el.className = 'stab-slot';
      el.dataset.id = id; el.dataset.sig = sig;
      el.dataset.pos = pos > 0 ? STAB_VISIBLE + 1 : -(STAB_VISIBLE + 1); // enter from the side
      el.innerHTML = '<div class="stab-model"></div>';
      slots.appendChild(el);
      stabMountViewer(el, p);
    }
    let tag = tags.querySelector(`.stab-slot[data-id="${id}"]`);
    if (!tag) {
      tag = document.createElement('div');
      tag.className = 'stab-slot stab-tag';
      tag.dataset.id = id; tag.dataset.pos = el.dataset.pos;
      tag.innerHTML = '<div class="stab-plate"><span class="stab-plate-dot"></span><span class="stab-plate-name"></span></div>';
      tags.appendChild(tag);
    }
    const dot = tag.querySelector('.stab-plate-dot');
    dot.hidden = !p.color; if (p.color) dot.style.background = stabHex(p.color);
    tag.querySelector('.stab-plate-name').textContent = (p.favorite ? '★ ' : '') + stabName(p);
    void el.offsetWidth; // let an entry position land before moving it in
    tag.dataset.pos = pos;
    el.dataset.status = stabStatus(p); tag.dataset.status = stabStatus(p); // wanted pets stand as ghosts
    if (el.dataset.pos !== String(pos)) { el.dataset.pos = pos; stabAim(el, pos); }
  });
}

function stabMountViewer(slot, p) {
  const host = slot.querySelector('.stab-model');
  const src = stabModelSrc(p.model);
  if (!src) { host.innerHTML = '<i class="fa-solid fa-paw stab-nomodel" title="No 3D model yet"></i>'; return; }
  schEnsureModelLib();
  const mv = document.createElement('swg-creature');
  mv.setAttribute('src', src);
  mv.setAttribute('no-picker', '');
  mv.setAttribute('fit', '0.69'); // the canvas is 1.5× the slot's height (headroom both ways) — the camera backs off to match // the biggest pets fill the slot's height; stabScale shrinks the rest
  // a group photo from their eye level: everyone stands still, the front pet facing
  // you and the rest turned outward the way their side of the arc goes (stabAim)
  const pos = Number(slot.dataset.pos) || 0;
  mv.setAttribute('orbit-el', String(STAB_EL));
  mv.setAttribute('auto-rotate', 'false');
  mv.setAttribute('orbit-az', String(stabAz(pos)));
  // the viewer only reads its angle once; catch its camera as it frames so we can turn it later
  mv._frameScene = function (obj, camera, controls) {
    Object.getPrototypeOf(this)._frameScene.call(this, obj, camera, controls);
    // the viewer zooms every model to fill its box; back the camera off by the model's
    // real size so a Gurk stands smaller than a Rancor (stabScale)
    const fit = parseFloat(this.getAttribute('fit')) || 0.81;
    const vf = camera.fov * Math.PI / 180, ff = Math.min(vf, 2 * Math.atan(Math.tan(vf / 2) * camera.aspect));
    const dist0 = camera.position.distanceTo(controls.target);
    const radius = dist0 * Math.sin(ff / 2) / fit; // the model's bounding radius, game metres
    this._stabCam = { camera, controls, dist0, dist: dist0 / stabScale(radius), az: null, radius };
    stabAim(slot, Number(slot.dataset.pos) || 0, true);
  };
  const tint = p.color || p.model_color;
  if (tint) mv.setAttribute('default-color', tint);
  const rgb = stabRgb(p.color);
  if (rgb) mv.addEventListener('swg-load', () => { if (mv.recolor) mv.recolor(rgb); });
  mv.addEventListener('swg-ready', () => stabGround(mv, slot));
  host.appendChild(mv);
}

// Facing by place in the arc: SWG models face -Z, so orbit-az 180 looks them in
// the face; more turns them to face screen-left, less to screen-right.
const STAB_EL = 4;
const STAB_AZ = { 0: 180, 1: 145, 2: 128, 3: 118 };
// On-screen size from the model's real size. GLBs are in game metres (Gurk ~1.5,
// Bantha ~4.6, Rancor ~8 bounding radius); square-rooted so small pets stay readable.
const STAB_REF_RADIUS = 8;
const STAB_FLOOR_PX = 34; // the floor line: this far above a slot's bottom (room for the label)
function stabScale(r) { return Math.max(0.4, Math.min(1, Math.sqrt((r || STAB_REF_RADIUS) / STAB_REF_RADIUS))); }
function stabAz(pos) { const a = STAB_AZ[Math.min(3, Math.abs(pos))] ?? 118; return pos < 0 ? 360 - a : a; }

// turn a slot's pet to its place's angle, eased over the slide (or at once)
function stabAim(slot, pos, instant = false) {
  const mv = slot.querySelector('swg-creature');
  const cam = mv && mv._stabCam;
  if (!cam) return; // not framed yet — it picks the angle up when it is
  const to = stabAz(pos), from = cam.az === null ? to : cam.az;
  // the pet up front gets a boost so a small one is still big and clear there
  const dTo = cam.dist0 / (pos === 0 ? Math.max(0.76, stabScale(cam.radius)) : stabScale(cam.radius)), dFrom = cam.dist;
  if (cam.az !== null && from === to && dFrom === dTo) return;
  const el = STAB_EL * Math.PI / 180, t0 = performance.now(), dur = instant ? 0 : 550;
  const put = (azDeg, d) => {
    const th = azDeg * Math.PI / 180, ph = Math.PI / 2 - el, t = cam.controls.target;
    cam.camera.position.set(t.x + d * Math.sin(ph) * Math.sin(th), t.y + d * Math.cos(ph), t.z + d * Math.sin(ph) * Math.cos(th));
    cam.controls.update();
  };
  cam.az = to; cam.dist = dTo;
  const step = (now) => {
    if (!mv.isConnected) return;
    const k = dur ? Math.min(1, (now - t0) / dur) : 1;
    const e = 1 - Math.pow(1 - k, 3);
    put(from + (to - from) * e, dFrom + (dTo - dFrom) * e);
    if (k < 1) requestAnimationFrame(step); else stabGround(mv, slot); // footprint changed — stand it back on the floor
  };
  requestAnimationFrame(step);
}

// Stand the pet on the floor line. The viewer frames each model by its bounding
// sphere, so a long, low pet (a Dewback) hangs mid-canvas looking like it floats.
// Once it's drawn, find its lowest painted row and slide the viewer down so the
// feet land on the slot's floor line; keep its painted box for the hover popup.
function stabGround(mv, slot, tries = 0) {
  let frames = 0;
  const tick = () => {
    if (!mv.isConnected) return;
    if (++frames < 3) { requestAnimationFrame(tick); return; }
    let box = null;
    try {
      const c = mv.shadowRoot && mv.shadowRoot.querySelector('canvas');
      if (c && c.width) {
        const w = 120, h = Math.max(1, Math.round(120 * c.height / c.width));
        const o = document.createElement('canvas'); o.width = w; o.height = h;
        const g = o.getContext('2d', { willReadFrequently: true });
        g.drawImage(c, 0, 0, w, h);
        const px = g.getImageData(0, 0, w, h).data;
        let top = h, bot = -1, left = w, right = -1;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
          if (px[(y * w + x) * 4 + 3] > 24) { if (y < top) top = y; if (y > bot) bot = y; if (x < left) left = x; if (x > right) right = x; }
        }
        if (bot >= 0) box = { t: top / h, b: (bot + 1) / h, l: left / w, r: (right + 1) / w };
      }
    } catch (_) { box = null; }
    if (!box) { if (tries < 10) setTimeout(() => stabGround(mv, slot, tries + 1), 1000); return; } // not drawn yet (page hidden)
    // in screen px: the slot is scaled by its place in the arc, the canvas overhangs it
    const sr = slot.getBoundingClientRect(), k = sr.height / (slot.offsetHeight || 1);
    const mr = mv.getBoundingClientRect(), H = mv.offsetHeight || 1, t = mv._stabT || 0;
    const floor = sr.bottom - STAB_FLOOR_PX * k;              // the line the labels sit under
    const feet = mr.top - t * k + box.b * mr.height;          // where the feet are, without our slide
    const nt = (floor - feet) / k;
    mv._stabT = nt;
    mv.style.transform = `translateY(${nt.toFixed(1)}px)`;
    Object.assign(slot.dataset, { bt: (box.t * H + nt) / H, bl: box.l, br: box.r });
  };
  requestAnimationFrame(tick);
}

function renderStabFilter() {
  const el = $('#stab-filter');
  if (!el) return;
  const count = (k) => (k === 'all' ? stab.all.length : stab.all.filter((p) => stabStatus(p) === k).length);
  const opts = [['all', 'All', '']].concat(STAB_STATUS).filter(([k]) => k === 'all' || k === stab.filter || count(k));
  el.hidden = opts.length < 3 && stab.filter === 'all'; // only owned pets so far: nothing to filter
  el.innerHTML = opts.map(([k, l]) => `<button type="button" class="stab-fbtn${stab.filter === k ? ' active' : ''}" data-stabfilter="${k}">${l} <span>${count(k)}</span></button>`).join('');
}

function renderStabStrip() {
  const el = $('#stab-strip');
  if (!el) return;
  el.hidden = stab.pets.length < 2;
  el.innerHTML = stab.pets.map((p, i) => `<button type="button" class="stab-chip${i === stab.front ? ' active' : ''}" data-stabgo="${i}" title="${escapeHtml(p.species)}">
      <span class="stab-chip-dot"${p.color ? ` style="background:${stabHex(p.color)}"` : ''}></span>${p.favorite ? '<i class="fa-solid fa-star stab-fav"></i>' : ''}${escapeHtml(stabName(p))}${stabStatus(p) !== 'owned' ? ` <i class="fa-solid ${STAB_STATUS.find(([k]) => k === stabStatus(p))[2]} stab-chip-st" title="${STAB_STATUS.find(([k]) => k === stabStatus(p))[1]}"></i>` : ''}</button>`).join('');
  el.querySelector('.stab-chip.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}

function renderStabCard() {
  const el = $('#stab-card');
  if (!el) return;
  const p = stab.pets[stab.front];
  if (!p) { el.hidden = true; el.innerHTML = ''; return; }
  el.hidden = false;
  const v = (x) => (x === null || x === undefined || x === '' ? '<span class="stab-none">—</span>' : escapeHtml(String(x)));
  const ly = (p.stats && p.stats.lyase) || {};
  const lyRows = (p.lyase_stats || []).map((s) => `<div class="stab-stat"><span>${escapeHtml(s)}</span><b>${v(ly[s])}</b></div>`).join('');
  const trained = new Set(p.specials || []);
  const specials = (p.species_specials || []).map((s) => `<span class="stab-spec${trained.has(s) ? ' on' : ''}" title="${trained.has(s) ? 'Trained' : 'Not trained yet'}">${trained.has(s) ? '<i class="fa-solid fa-check"></i> ' : ''}${escapeHtml(s)}</span>`).join('');
  const st = STAB_STATUS.find(([k]) => k === stabStatus(p));
  const roles = (st[0] !== 'owned' ? `<span class="stab-role stab-st-${st[0]}"><i class="fa-solid ${st[2]}"></i> ${st[1]}</span>` : '')
    + STAB_ROLES.filter(([k]) => (p.roles || []).includes(k)).map(([, l, ic]) => `<span class="stab-role"><i class="fa-solid ${ic}"></i> ${l}</span>`).join('');
  const n = stab.pets.length;
  el.innerHTML = `
    <div class="stab-card-head">
      <div class="stab-card-swatch"${p.color ? ` style="background:${stabHex(p.color)}"` : ''} title="${p.color ? 'Its colour' : 'Default colour'}"></div>
      <div class="stab-card-title">
        <h2>${p.favorite ? '<i class="fa-solid fa-star stab-fav" title="Favourite"></i> ' : ''}${escapeHtml(stabName(p))}</h2>
        <div class="stab-card-sub">
          <a role="button" data-pet="${escapeHtml(p.pet_slug)}" title="Open ${escapeHtml(p.species)} in Pets">${escapeHtml(p.species)}</a>
          ${p.family ? ` · ${escapeHtml(p.family)}` : ''}${p.bonus_group ? ` · ${escapeHtml(p.bonus_group)}` : ''}
          ${p.mountable ? ' <i class="fa-solid fa-horse" title="Mountable"></i>' : ''}${p.flying ? ' <i class="fa-solid fa-feather-pointed" title="Flies"></i>' : ''}
        </div>
        ${roles ? `<div class="stab-roles">${roles}</div>` : ''}
      </div>
      <div class="stab-card-actions"${STAB_RO ? ' hidden' : ''}>
        <button type="button" class="btn btn-icon" data-stabmove="-1" title="Move left in the line-up"${n < 2 ? ' disabled' : ''}><i class="fa-solid fa-arrow-left"></i></button>
        <button type="button" class="btn btn-icon" data-stabmove="1" title="Move right in the line-up"${n < 2 ? ' disabled' : ''}><i class="fa-solid fa-arrow-right"></i></button>
        <button type="button" class="btn btn-sm btn-outline-secondary" data-stabdel title="Remove from your stable"><i class="fa-solid fa-trash"></i></button>
        <button type="button" class="btn btn-sm btn-accent" data-stabedit><i class="fa-solid fa-pen"></i> Edit</button>
      </div>
    </div>
    <div class="stab-card-body">
      <div class="stab-col">
        <h6>Combat</h6>
        <div class="stab-stat"><span>Level</span><b>${v(p.level || '')}</b></div>
        <div class="stab-stat"><span>DPS / Armor bonus</span><b>${v(p.stats && p.stats.dps_armor)}</b></div>
        ${lyRows}
      </div>
      <div class="stab-col">
        <h6>Breeding</h6>
        <div class="stab-stat"><span>Mutation</span><b>${escapeHtml(STAB_MUT[p.mutation] || 'Base')}</b></div>
        <div class="stab-stat"><span>Legacy DNA</span><b>${p.legacy_dna ? 'Yes' : 'No'}</b></div>
        <div class="stab-stat"><span>Incubated by</span><b>${v(p.incubated_by)}</b></div>
      </div>
      <div class="stab-col stab-col-wide">
        <h6>Specials <span class="settings-sub">${trained.size} of ${(p.species_specials || []).length} trained</span></h6>
        <div class="stab-specs">${specials || '<span class="stab-none">None listed for this species</span>'}</div>
        ${p.notes ? `<h6>Notes</h6><div class="stab-notes">${escapeHtml(p.notes)}</div>` : ''}
      </div>
    </div>`;
}

// hover popup over a pet: who it is and its headline numbers
function stabPopHtml(p) {
  const ly = (p.stats && p.stats.lyase) || {};
  const lyRows = Object.keys(ly).filter((k) => ly[k] !== null && ly[k] !== '').map((k) => `<div><span>${escapeHtml(k)}</span><b>${escapeHtml(String(ly[k]))}</b></div>`).join('');
  const roles = STAB_ROLES.filter(([k]) => (p.roles || []).includes(k)).map(([, l, ic]) => `<span class="stab-role"><i class="fa-solid ${ic}"></i> ${l}</span>`).join('');
  return `<div class="stab-pop-head">${p.color ? `<span class="stab-chip-dot" style="background:${stabHex(p.color)}"></span>` : ''}
      <b>${p.favorite ? '<i class="fa-solid fa-star stab-fav"></i> ' : ''}${escapeHtml(stabName(p))}</b></div>
    <div class="stab-pop-sub">${escapeHtml(p.species)}${p.family ? ` · ${escapeHtml(p.family)}` : ''}</div>
    <div class="stab-pop-grid">
      ${p.level ? `<div><span>Level</span><b>${p.level}</b></div>` : ''}
      ${p.stats && p.stats.dps_armor != null ? `<div><span>DPS / Armor</span><b>${escapeHtml(String(p.stats.dps_armor))}</b></div>` : ''}
      ${lyRows}
      <div><span>Mutation</span><b>${['Base', '1st', '2nd', '3rd'][p.mutation] || 'Base'}</b></div>
      <div><span>Specials</span><b>${(p.specials || []).length} of ${(p.species_specials || []).length}</b></div>
    </div>
    ${roles ? `<div class="stab-roles">${roles}</div>` : ''}
    ${stabStatus(p) !== 'owned' ? `<div class="stab-pop-st stab-st-${stabStatus(p)}">${stabStatus(p) === 'wanted' ? '<i class="fa-solid fa-heart"></i> On your wanted list' : '<i class="fa-solid fa-egg"></i> Incubating'}</div>` : ''}
`;
}
function stabShowPop(slot) {
  const stage = slot.closest('.stab-stage');
  const pop = stage.querySelector('.stab-pop');
  const p = stab.pets.find((x) => String(x.id) === slot.dataset.id);
  if (!p) { pop.hidden = true; return; }
  pop.innerHTML = stabPopHtml(p);
  pop.hidden = false;
  // centred above the front pet's head (its painted outline), kept inside the stage
  const sr = stage.getBoundingClientRect(), r = slot.querySelector('.stab-model').getBoundingClientRect();
  const w = pop.offsetWidth, h = pop.offsetHeight, gap = 10;
  const d = slot.dataset;
  const cx = r.left - sr.left + r.width * ((d.bl ? Number(d.bl) : 0.2) + (d.br ? Number(d.br) : 0.8)) / 2;
  const T = r.top - sr.top + r.height * (d.bt ? Number(d.bt) : 0.15);
  const x = Math.max(8, Math.min(sr.width - w - 8, cx - w / 2));
  const y = Math.max(8, T - gap - h);
  pop.style.left = x + 'px'; pop.style.top = y + 'px';
}

function stabGo(i) {
  const n = stab.pets.length;
  if (!n) return;
  stab.front = ((i % n) + n) % n;
  const pop = document.querySelector('#stab-root .stab-pop'); if (pop) pop.hidden = true;
  renderStabStage(); renderStabStrip(); renderStabCard();
}

async function stabMove(dir) {
  const i = stab.front, n = stab.pets.length;
  if (n < 2) return;
  const jj = (((i + dir) % n) + n) % n;
  // swap the two in the whole stable's order (a filter may be hiding pets between them)
  const a = stab.all.indexOf(stab.pets[i]), b = stab.all.indexOf(stab.pets[jj]);
  const order = stab.all.slice();
  [order[a], order[b]] = [order[b], order[a]];
  stab.all = order;
  stabView(); stab.front = jj;
  renderStabStage(); renderStabStrip(); renderStabCard();
  const d = await stabApi('PUT', { order: order.map((p) => p.id) });
  if (d.error) toast(d.error, false);
}

async function stabDelete() {
  const p = stab.pets[stab.front];
  if (!p) return;
  if (!(await confirmDialog({ title: 'Remove pet', message: `Remove ${stabName(p)} from your stable?`, confirmLabel: 'Remove' }))) return;
  const d = await stabApi('DELETE', null, { id: p.id });
  if (d.error) { toast(d.error, false); return; }
  stabTake(d); renderStables();
  toast(`${stabName(p)} removed`);
}

// ---------- add / edit dialog ----------
const stabEd = { id: 0, slug: '', detail: null, color: '', busy: false, seq: 0 };

async function stabSpecies() {
  if (stab.species) return stab.species;
  let res;
  try { res = await apiFetch('GET', 'api/pets.php'); } catch (e) { res = { ok: false }; }
  const rows = (res.ok && res.data && res.data.results) || [];
  stab.species = rows.map((r) => ({ slug: r.slug, name: r.name, family: r.family || '' })).sort((a, b) => a.name.localeCompare(b.name));
  return stab.species;
}

function stabModal() {
  let m = $('#stab-modal');
  if (m) return m;
  document.body.insertAdjacentHTML('beforeend', `
  <div id="stab-modal" class="key-gate" hidden>
    <div class="key-gate-card sp-card inv-add-card stab-ed-card" role="dialog" aria-modal="true" aria-labelledby="stab-ed-title">
      <h2 id="stab-ed-title">Add a pet</h2>
      <div class="stab-ed-top">
        <div class="stab-ed-preview" id="stab-ed-preview"><i class="fa-solid fa-paw stab-nomodel"></i></div>
        <div class="stab-ed-main">
          <div class="stab-ed-status" id="stab-ed-status-seg">${STAB_STATUS.map(([k, l, ic]) => `<button type="button" class="stab-fbtn" data-edstatus="${k}"><i class="fa-solid ${ic}"></i> ${l}</button>`).join('')}</div>
          <div class="inv-add-field">
            <label class="sp-field-label" for="stab-ed-species">Species</label>
            <input id="stab-ed-species" list="stab-ed-species-list" class="form-control filter-input" placeholder="Start typing — Varactyl, Rancor…" autocomplete="off" spellcheck="false">
            <datalist id="stab-ed-species-list"></datalist>
          </div>
          <div class="stab-ed-row">
            <div class="inv-add-field"><label class="sp-field-label" for="stab-ed-nick">Name</label>
              <input id="stab-ed-nick" class="form-control filter-input" maxlength="60" placeholder="What you call it" autocomplete="off"></div>
            <div class="inv-add-field stab-ed-narrow"><label class="sp-field-label" for="stab-ed-level">Level</label>
              <input id="stab-ed-level" type="number" min="0" max="999" class="form-control filter-input" autocomplete="off"></div>
          </div>
          <div class="inv-add-field"><label class="sp-field-label">Colour <span class="settings-sub" id="stab-ed-colorname">default</span></label>
            <div class="stab-ed-swatches" id="stab-ed-swatches"><span class="settings-sub">Pick a species first</span></div></div>
        </div>
      </div>
      <div class="stab-ed-grid">
        <div class="stab-ed-sec">
          <h6>Incubation</h6>
          <div class="inv-add-field"><label class="sp-field-label" for="stab-ed-dps">DPS / Armor bonus</label>
            <input id="stab-ed-dps" type="number" step="0.01" min="0" class="form-control filter-input" autocomplete="off"></div>
          <div id="stab-ed-lyase"></div>
        </div>
        <div class="stab-ed-sec">
          <h6>Breeding</h6>
          <div class="inv-add-field"><label class="sp-field-label" for="stab-ed-mut">Mutation</label>
            <select id="stab-ed-mut" class="form-select filter-select">${STAB_MUT.map((t, i) => `<option value="${i}">${t}</option>`).join('')}</select></div>
          <label class="stab-ed-check"><input type="checkbox" id="stab-ed-legacy"> Legacy DNA</label>
          <div class="inv-add-field"><label class="sp-field-label" for="stab-ed-inc">Incubated by</label>
            <input id="stab-ed-inc" class="form-control filter-input" maxlength="60" placeholder="Bio-engineer's name" autocomplete="off"></div>
        </div>
        <div class="stab-ed-sec">
          <h6>Role</h6>
          <div class="stab-ed-checks">${STAB_ROLES.map(([k, l]) => `<label class="stab-ed-check"><input type="checkbox" data-stabrole="${k}"> ${l}</label>`).join('')}</div>
          <label class="stab-ed-check"><input type="checkbox" id="stab-ed-fav"> <i class="fa-solid fa-star stab-fav"></i> Favourite</label>
        </div>
        <div class="stab-ed-sec">
          <h6>Specials trained</h6>
          <div class="stab-ed-checks" id="stab-ed-specials"><span class="settings-sub">Pick a species first</span></div>
        </div>
      </div>
      <div class="inv-add-field"><label class="sp-field-label" for="stab-ed-notes">Notes</label>
        <textarea id="stab-ed-notes" class="form-control filter-input stab-ed-notes" maxlength="2000" rows="2" placeholder="Anything else — where it came from, what it's for (only you see notes)"></textarea></div>
      <div class="inv-add-actions">
        <span id="stab-ed-status" class="key-gate-status"></span>
        <button id="stab-ed-cancel" class="btn btn-sm btn-outline-secondary">Cancel</button>
        <button id="stab-ed-save" class="btn btn-sm btn-accent"><i class="fa-solid fa-plus"></i> Add to stable</button>
      </div>
    </div>
  </div>`);
  m = $('#stab-modal');
  const close = () => { m.hidden = true; $('#stab-ed-preview').innerHTML = ''; }; // drop the preview viewer's context
  $('#stab-ed-cancel').addEventListener('click', close);
  $('#stab-ed-save').addEventListener('click', stabSave);
  bindBackdropClose(m, close);
  m.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
    else if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA' && e.target.id !== 'stab-ed-species') { e.preventDefault(); stabSave(); }
  });
  $('#stab-ed-status-seg').addEventListener('click', (e) => { const b = e.target.closest('[data-edstatus]'); if (b) stabEdStatus(b.dataset.edstatus); });
  $('#stab-ed-species').addEventListener('change', () => stabPickSpecies($('#stab-ed-species').value));
  $('#stab-ed-species').addEventListener('input', () => {
    const v = $('#stab-ed-species').value.trim().toLowerCase();
    if ((stab.species || []).some((s) => s.name.toLowerCase() === v)) stabPickSpecies($('#stab-ed-species').value);
  });
  $('#stab-ed-swatches').addEventListener('click', (e) => {
    const sw = e.target.closest('[data-rgb]');
    if (!sw) return;
    stabEd.color = sw.dataset.rgb;
    stabPaintSwatches();
    stabPreviewColor();
  });
  return m;
}

async function stabOpenEditor(pet) {
  const m = stabModal();
  const list = await stabSpecies();
  $('#stab-ed-species-list').innerHTML = list.map((s) => `<option value="${escapeHtml(s.name)}">${escapeHtml(s.family)}</option>`).join('');
  Object.assign(stabEd, { id: pet ? pet.id : 0, slug: '', detail: null, color: pet ? pet.color : '', busy: false });
  // adding while the Wanted / Incubating filter is on starts the new pet there
  stabEdStatus(pet ? stabStatus(pet) : (stab.filter !== 'all' ? stab.filter : 'owned'));
  $('#stab-ed-title').textContent = pet ? `Edit ${stabName(pet)}` : 'Add a pet';
  $('#stab-ed-save').innerHTML = pet ? '<i class="fa-solid fa-check"></i> Save' : '<i class="fa-solid fa-plus"></i> Add to stable';
  $('#stab-ed-species').value = pet ? pet.species : '';
  $('#stab-ed-nick').value = pet ? pet.nickname : '';
  $('#stab-ed-level').value = pet && pet.level ? pet.level : '';
  $('#stab-ed-dps').value = pet && pet.stats && pet.stats.dps_armor != null ? pet.stats.dps_armor : '';
  $('#stab-ed-mut').value = String(pet ? pet.mutation : 0);
  $('#stab-ed-legacy').checked = !!(pet && pet.legacy_dna);
  $('#stab-ed-inc').value = pet ? pet.incubated_by : '';
  $('#stab-ed-fav').checked = !!(pet && pet.favorite);
  $('#stab-ed-notes').value = pet ? (pet.notes || '') : '';
  m.querySelectorAll('[data-stabrole]').forEach((c) => { c.checked = !!(pet && (pet.roles || []).includes(c.dataset.stabrole)); });
  $('#stab-ed-lyase').innerHTML = '';
  $('#stab-ed-specials').innerHTML = '<span class="settings-sub">Pick a species first</span>';
  $('#stab-ed-swatches').innerHTML = '<span class="settings-sub">Pick a species first</span>';
  $('#stab-ed-preview').innerHTML = '<i class="fa-solid fa-paw stab-nomodel"></i>';
  $('#stab-ed-colorname').textContent = 'default';
  $('#stab-ed-status').textContent = '';
  m.hidden = false;
  if (pet) await stabPickSpecies(pet.species, pet);
  else $('#stab-ed-species').focus();
}

function stabEdStatus(k) {
  stabEd.status = k;
  document.querySelectorAll('#stab-ed-status-seg [data-edstatus]').forEach((b) => b.classList.toggle('active', b.dataset.edstatus === k));
  $('#stab-modal .stab-ed-card').classList.toggle('is-wanted', k === 'wanted'); // a wanted pet's stats are optional — the ones you're hoping for
}

async function stabPickSpecies(name, pet) {
  const s = (stab.species || []).find((x) => x.name.toLowerCase() === String(name).trim().toLowerCase());
  if (!s || (s.slug === stabEd.slug && !pet)) return;
  // keep what was typed into the lyase / specials boxes when switching species while editing
  const keepLy = {}; $('#stab-ed-lyase').querySelectorAll('input').forEach((i) => { keepLy[i.dataset.stat] = i.value; });
  const keepSp = new Set([...$('#stab-ed-specials').querySelectorAll('input:checked')].map((i) => i.value));
  stabEd.slug = s.slug;
  const seq = ++stabEd.seq;
  let res;
  try { res = await apiFetch('GET', 'api/pet_detail.php', { params: { slug: s.slug } }); } catch (e) { res = { ok: false }; }
  if (seq !== stabEd.seq) return;
  const d = res.ok && res.data && res.data.pet ? res.data : null;
  stabEd.detail = d;
  if (!d) { $('#stab-ed-status').textContent = 'Could not load that species'; return; }
  if (!$('#stab-ed-nick').value && !pet) $('#stab-ed-nick').placeholder = `What you call your ${s.name}`;
  const ly = (pet && pet.stats && pet.stats.lyase) || keepLy;
  $('#stab-ed-lyase').innerHTML = Object.keys(d.pet.stat_bonuses || {}).map((st) => `
    <div class="inv-add-field"><label class="sp-field-label">${escapeHtml(st)} <span class="settings-sub">lyase</span></label>
      <input type="number" step="0.01" min="0" class="form-control filter-input" data-stat="${escapeHtml(st)}" value="${escapeHtml(ly[st] != null ? String(ly[st]) : '')}" autocomplete="off"></div>`).join('')
    || '<span class="settings-sub">This species has no lyase stats listed</span>';
  const trained = pet ? new Set(pet.specials || []) : keepSp;
  const specs = d.pet.special_abilities || [];
  $('#stab-ed-specials').innerHTML = specs.length
    ? specs.map((sp) => `<label class="stab-ed-check"><input type="checkbox" value="${escapeHtml(sp)}"${trained.has(sp) ? ' checked' : ''}> ${escapeHtml(sp)}</label>`).join('')
    : '<span class="settings-sub">None listed for this species</span>';
  stabPaintSwatches();
  // live preview
  const host = $('#stab-ed-preview');
  const src = stabModelSrc(d.model);
  host.innerHTML = '';
  if (!src) { host.innerHTML = '<i class="fa-solid fa-paw stab-nomodel" title="No 3D model yet"></i>'; return; }
  schEnsureModelLib();
  const mv = document.createElement('swg-creature');
  mv.setAttribute('src', src); mv.setAttribute('no-picker', ''); mv.setAttribute('fit', '0.9');
  if (stabEd.color || d.model_color) mv.setAttribute('default-color', stabEd.color || d.model_color);
  mv.addEventListener('swg-load', () => stabPreviewColor());
  host.appendChild(mv);
}

function stabPaintSwatches() {
  const d = stabEd.detail;
  const box = $('#stab-ed-swatches');
  if (!d) return;
  const fams = (Array.isArray(d.palette) ? d.palette : []).filter((f) => Array.isArray(f) && f.length);
  const sw = (rgb) => { const k = rgb.join(','); return `<span class="stab-sw${stabEd.color === k ? ' sel' : ''}" data-rgb="${k}" style="background:rgb(${k})" title="${k}"></span>`; };
  box.innerHTML = `<span class="stab-sw stab-sw-def${stabEd.color ? '' : ' sel'}" data-rgb="" title="The model's own colour"><i class="fa-solid fa-ban"></i></span>`
    + (fams.length ? fams.map((f) => `<div class="stab-sw-row">${f.filter((c) => Array.isArray(c) && c.length >= 3).map(sw).join('')}</div>`).join('')
      : '<span class="settings-sub">This model has no in-game palette yet</span>');
  $('#stab-ed-colorname').textContent = stabEd.color ? `rgb ${stabEd.color}` : 'default';
}
function stabPreviewColor() {
  const mv = $('#stab-ed-preview swg-creature');
  if (!mv) return;
  const rgb = stabRgb(stabEd.color);
  if (rgb && mv.recolor) mv.recolor(rgb);
  else if (!rgb && mv.resetColor) mv.resetColor();
}

async function stabSave() {
  if (stabEd.busy) return;
  const status = $('#stab-ed-status');
  if (!stabEd.slug || !stabEd.detail) { status.textContent = 'Pick a species from the list'; $('#stab-ed-species').focus(); return; }
  const lyase = {};
  $('#stab-ed-lyase').querySelectorAll('input').forEach((i) => { if (i.value !== '') lyase[i.dataset.stat] = Number(i.value); });
  const pet = {
    id: stabEd.id || undefined,
    pet_slug: stabEd.slug,
    status: stabEd.status || 'owned',
    nickname: $('#stab-ed-nick').value.trim(),
    color: stabEd.color,
    level: Number($('#stab-ed-level').value) || 0,
    stats: { dps_armor: $('#stab-ed-dps').value === '' ? null : Number($('#stab-ed-dps').value), lyase },
    specials: [...$('#stab-ed-specials').querySelectorAll('input:checked')].map((i) => i.value),
    mutation: Number($('#stab-ed-mut').value) || 0,
    legacy_dna: $('#stab-ed-legacy').checked,
    incubated_by: $('#stab-ed-inc').value.trim(),
    roles: [...document.querySelectorAll('#stab-modal [data-stabrole]:checked')].map((c) => c.dataset.stabrole),
    favorite: $('#stab-ed-fav').checked,
    notes: $('#stab-ed-notes').value,
  };
  stabEd.busy = true; status.textContent = 'Saving…';
  const d = await stabApi('POST', { pet });
  stabEd.busy = false;
  if (d.error) { status.textContent = d.error; return; }
  stabTake(d);
  let at = stab.pets.findIndex((p) => p.id === d.id);
  if (at < 0) { stab.filter = 'all'; stabView(); at = stab.pets.findIndex((p) => p.id === d.id); } // saved into a status the filter hides
  if (at >= 0) stab.front = at;
  $('#stab-modal').hidden = true; $('#stab-ed-preview').innerHTML = '';
  stab.loaded = true;
  renderStables();
  toast(stabEd.id ? 'Saved' : pet.status === 'wanted' ? `${stabName(stab.pets[stab.front] || pet)} is on your wanted list` : `${stabName(stab.pets[stab.front] || pet)} is in your stable`);
}

// ---------- share / settings dialog ----------
function stabShareModal() {
  let m = $('#stab-share-modal');
  if (m) return m;
  document.body.insertAdjacentHTML('beforeend', `
  <div id="stab-share-modal" class="key-gate" hidden>
    <div class="key-gate-card sp-card inv-add-card stab-share-card" role="dialog" aria-modal="true" aria-labelledby="stab-share-title">
      <h2 id="stab-share-title">Stable settings</h2>
      <div class="inv-add-field"><label class="sp-field-label" for="stab-sh-name">Stable name</label>
        <input id="stab-sh-name" class="form-control filter-input" maxlength="60" autocomplete="off"></div>
      <label class="stab-ed-check stab-sh-pub"><input type="checkbox" id="stab-sh-public"> Share my stable — anyone with the link can see my pets (not my notes)</label>
      <div class="stab-sh-link" id="stab-sh-linkrow" hidden>
        <input id="stab-sh-link" class="form-control filter-input" readonly>
        <button id="stab-sh-copy" class="btn btn-sm btn-outline-secondary"><i class="fa-solid fa-link"></i> Copy</button>
      </div>
      <div class="inv-add-actions">
        <span id="stab-sh-status" class="key-gate-status"></span>
        <button id="stab-sh-cancel" class="btn btn-sm btn-outline-secondary">Cancel</button>
        <button id="stab-sh-save" class="btn btn-sm btn-accent"><i class="fa-solid fa-check"></i> Save</button>
      </div>
    </div>
  </div>`);
  m = $('#stab-share-modal');
  const close = () => { m.hidden = true; };
  $('#stab-sh-cancel').addEventListener('click', close);
  bindBackdropClose(m, close);
  m.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); else if (e.key === 'Enter') { e.preventDefault(); $('#stab-sh-save').click(); } });
  $('#stab-sh-copy').addEventListener('click', () => copyTextToClipboard($('#stab-sh-link').value, 'Link copied — paste it anywhere to show off your stable'));
  $('#stab-sh-save').addEventListener('click', async () => {
    const wasPublic = !!(stab.stable && stab.stable.is_public);
    const pub = $('#stab-sh-public').checked;
    $('#stab-sh-status').textContent = 'Saving…';
    const d = await stabApi('PUT', { name: $('#stab-sh-name').value.trim(), is_public: pub });
    if (d.error) { $('#stab-sh-status').textContent = d.error; return; }
    stabTake(d); stab.loaded = true;
    renderStables();
    if (pub && d.share_url) {
      $('#stab-sh-link').value = d.share_url; $('#stab-sh-linkrow').hidden = false;
      $('#stab-sh-status').textContent = '';
      if (!wasPublic) { copyTextToClipboard(d.share_url, 'Your stable is shared — link copied'); }
      close();
    } else { close(); toast(wasPublic && !pub ? 'Your stable is private again — the old link stops working' : 'Saved'); }
  });
  return m;
}
function stabOpenShare() {
  const m = stabShareModal();
  const s = stab.stable || { name: 'My Stable', is_public: false };
  $('#stab-sh-name').value = s.name;
  $('#stab-sh-public').checked = !!s.is_public;
  $('#stab-sh-link').value = stab.shareUrl;
  $('#stab-sh-linkrow').hidden = !(s.is_public && stab.shareUrl);
  $('#stab-sh-status').textContent = '';
  m.hidden = false;
  $('#stab-sh-name').focus();
}

// ---------- wiring ----------
function initStables() {
  const page = $('#page-stables');
  if (!page) return;
  $('#stab-add-btn')?.addEventListener('click', () => {
    if (stab.all.length >= stab.max) { toast(`A stable holds up to ${stab.max} pets`, false); return; }
    stabOpenEditor(null);
  });
  $('#stab-share-btn')?.addEventListener('click', stabOpenShare);
  $('[data-refresh="stables"]')?.addEventListener('click', () => loadStables(true));
  page.addEventListener('click', (e) => {
    const t = e.target;
    const step = t.closest('[data-stabstep]');
    if (step) { stabGo(stab.front + Number(step.dataset.stabstep)); return; }
    const flt = t.closest('[data-stabfilter]');
    if (flt) { stab.filter = flt.dataset.stabfilter; stabView(); renderStables(); return; }
    const go = t.closest('[data-stabgo]');
    if (go) { stabGo(Number(go.dataset.stabgo)); return; }
    const slot = t.closest('.stab-slot');
    if (slot && slot.dataset.pos !== '0') { const i = stab.pets.findIndex((p) => String(p.id) === slot.dataset.id); if (i >= 0) stabGo(i); return; }
    if (!STAB_RO) {
      if (t.closest('[data-stabadd]')) { stabOpenEditor(null); return; }
      if (t.closest('[data-stabedit]')) { stabOpenEditor(stab.pets[stab.front]); return; }
      if (t.closest('[data-stabdel]')) { stabDelete(); return; }
      const mv = t.closest('[data-stabmove]');
      if (mv) { stabMove(Number(mv.dataset.stabmove)); return; }
    }
    const pet = t.closest('[data-pet]');
    if (pet) openPetPage(pet.dataset.pet); // opens the Pets detail page itself
  });
  page.addEventListener('mouseover', (e) => {
    const slot = e.target.closest('.stab-slot');
    if (slot && slot.dataset.pos === '0' && !slot.contains(e.relatedTarget)) stabShowPop(slot); // only the pet up front
  });
  page.addEventListener('mouseout', (e) => {
    const slot = e.target.closest('.stab-slot');
    if (slot && !slot.contains(e.relatedTarget)) { const pop = page.querySelector('.stab-pop'); if (pop) pop.hidden = true; }
  });
  // ← / → turn the line-up (not while typing or with a dialog open)
  document.addEventListener('keydown', (e) => {
    if (!page.classList.contains('active') || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
    if (e.target.closest('input, textarea, select, [contenteditable]') || document.querySelector('.key-gate:not([hidden])')) return;
    e.preventDefault();
    stabGo(stab.front + (e.key === 'ArrowLeft' ? -1 : 1));
  });
  // trackpad sideways swipe over the stage
  let wheelAcc = 0, wheelLock = 0;
  page.addEventListener('wheel', (e) => {
    if (!e.target.closest('.stab-stage') || Math.abs(e.deltaX) <= Math.abs(e.deltaY)) return;
    e.preventDefault();
    if (Date.now() < wheelLock) return;
    wheelAcc += e.deltaX;
    if (Math.abs(wheelAcc) > 60) { stabGo(stab.front + (wheelAcc > 0 ? 1 : -1)); wheelAcc = 0; wheelLock = Date.now() + 350; }
  }, { passive: false });
}
