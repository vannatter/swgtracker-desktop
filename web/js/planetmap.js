/* Planet Maps — the website's map.php + js/planet-map.js in the app.
   A Leaflet (CRS.Simple) image map per planet with the community's resource
   concentration waypoints as pins + a concentration glow "heatmap", player cities,
   a copyable waypoint list, and an Add-waypoint dialog (click the map to place one).
   Two homes: the Planet Maps page (Galaxy group) and the Locations tab on a
   resource's page (scoped to that resource). Leaflet loads from the CDN on first use. */

const PM_SIZE = 1024;     // virtual square the image + coords are normalised into
const PM_MAX = 8192;      // half-width of a 16km planet in game units (every planet so far)
// keyed by the site's short planet code (what api/waypoints.php stores)
const PM_PLANETS = {
  cor: { name: 'corellia', display: 'Corellia' },
  dan: { name: 'dantooine', display: 'Dantooine' },
  dat: { name: 'dathomir', display: 'Dathomir' },
  end: { name: 'endor', display: 'Endor' },
  lok: { name: 'lok', display: 'Lok' },
  nab: { name: 'naboo', display: 'Naboo' },
  ror: { name: 'rori', display: 'Rori' },
  tal: { name: 'talus', display: 'Talus' },
  tat: { name: 'tatooine', display: 'Tatooine' },
  yav: { name: 'yavin4', display: 'Yavin 4' },
  kas: { name: 'kashyyyk', display: 'Kashyyyk' },
  mus: { name: 'mustafar', display: 'Mustafar' },
};
// a resource row's planet_* flag → short code (the Locations tab's planet picker)
const PM_FLAG_CODE = {
  planet_corellia: 'cor', planet_dantooine: 'dan', planet_dathomir: 'dat', planet_endor: 'end',
  planet_lok: 'lok', planet_naboo: 'nab', planet_rori: 'ror', planet_talus: 'tal',
  planet_tatooine: 'tat', planet_yavin4: 'yav', planet_kashyyyk: 'kas', planet_mustafar: 'mus',
};
const pmImg = (code) => `https://swgtracker.com/images/maps/${code}.jpg`;
const pmIsPlanet = (code) => Object.prototype.hasOwnProperty.call(PM_PLANETS, code);

// ---- Leaflet, loaded once on first need (keeps boot light, and offline users never pay) ----
let pmLeaflet = null;
function pmEnsureLeaflet() {
  if (window.L) return Promise.resolve(window.L);
  if (pmLeaflet) return pmLeaflet;
  pmLeaflet = new Promise((resolve, reject) => {
    if (!document.getElementById('leaflet-css')) {
      const l = document.createElement('link');
      l.id = 'leaflet-css'; l.rel = 'stylesheet';
      l.href = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.css';
      const appCss = document.querySelector('link[href*="app.css"]');
      if (appCss) document.head.insertBefore(l, appCss); else document.head.appendChild(l); // the app's dark theme must override Leaflet's defaults
    }
    const s = document.createElement('script');
    s.src = 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.9.4/leaflet.min.js';
    s.addEventListener('load', () => (window.L ? resolve(window.L) : reject(new Error('Leaflet did not define L'))));
    s.addEventListener('error', () => { pmLeaflet = null; reject(new Error('Leaflet failed to load — are you online?')); });
    document.head.appendChild(s);
  });
  return pmLeaflet;
}

// ---- coordinate + colour helpers (identical to the site's) ----
// SWG coord → Leaflet latLng. CRS.Simple latitude grows upward, so +x (east) is
// a higher lng (right) and +y (north) a higher lat (top): top-right = (+x, +y).
function pmToLatLng(x, y) {
  return [(y + PM_MAX) / (2 * PM_MAX) * PM_SIZE, (x + PM_MAX) / (2 * PM_MAX) * PM_SIZE];
}
function pmFromLatLng(ll) {
  return { x: Math.round(ll.lng / PM_SIZE * (2 * PM_MAX) - PM_MAX), y: Math.round(ll.lat / PM_SIZE * (2 * PM_MAX) - PM_MAX) };
}
// pin + glow colour by concentration: low = blue … high = red (hot)
function pmConcColor(pct) {
  if (pct >= 90) return '#e24350';
  if (pct >= 75) return '#f0892f';
  if (pct >= 50) return '#f2c14e';
  if (pct >= 25) return '#5bc0de';
  return '#4a90d9';
}
function pmRgba(hex, a) {
  const h = hex.replace('#', '');
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}

// "/way tatooine -2549 0 -6627 85 Some note" (or without /way, or "x y 90%") →
// {planet, x, y, pct, note} — the site's parseSwgWaypoint, verbatim rules.
function pmParseWaypoint(str) {
  if (!str) return null;
  str = String(str).trim().replace(/^\/?w(ay|aypoint|p)\b[:\s]*/i, '');
  if (!str) return null;
  const toks = str.split(/[\s,]+/).filter(Boolean);
  let planet = '';
  if (toks.length && !/^[-+]?\.?\d/.test(toks[0])) planet = toks.shift();
  let pct = null;
  for (let k = 0; k < toks.length; k++) {
    if (/^[-+]?\d+(?:\.\d+)?%$/.test(toks[k])) { pct = parseFloat(toks[k]); toks.splice(k, 1); break; }
  }
  let nums = []; let i = 0;
  for (; i < toks.length && /^[-+]?\d+(?:\.\d+)?$/.test(toks[i]); i++) nums.push(Number(toks[i]));
  if (nums.length < 2) return null;
  const rest = toks.slice(i);
  if (pct === null && nums.length >= 4) { pct = nums[3]; nums = nums.slice(0, 3); }
  const x = nums[0]; const y = nums.length >= 3 ? nums[2] : nums[1];
  const note = rest.join(' ').replace(/^[\s,-]+|[\s,-]+$/g, '').trim();
  return { planet, x: Math.round(x), y: Math.round(y), pct, note };
}
// "tatooine" / "tat" / "Yavin IV" / "yavin4" → short code, or '' when unknown
function pmPlanetCode(token) {
  const t = String(token || '').toLowerCase().replace(/[^a-z0-9]/g, '');
  if (!t) return '';
  if (pmIsPlanet(t)) return t;
  for (const [code, p] of Object.entries(PM_PLANETS)) {
    const nm = p.name.replace(/[^a-z0-9]/g, ''); const disp = p.display.toLowerCase().replace(/[^a-z0-9]/g, '');
    if (t === nm || t === disp || nm.startsWith(t) || disp.startsWith(t)) return code;
  }
  if (t.startsWith('yavin')) return 'yav';
  return '';
}

// ---- player cities, fetched once and shared by every map ----
let pmCitiesCache = null;
async function pmCities() {
  if (pmCitiesCache) return pmCitiesCache;
  // the Cities page may already hold them
  if (typeof citiesState !== 'undefined' && citiesState.items && citiesState.items.length) {
    pmCitiesCache = citiesState.items; return pmCitiesCache;
  }
  try {
    const res = await apiFetch('GET', 'api/cities.php');
    pmCitiesCache = (res.ok && res.data && res.data.results) || [];
  } catch (_) { pmCitiesCache = []; }
  return pmCitiesCache;
}
// cities on a planet (the cities feed carries the full name: "Tatooine", "Yavin IV")
function pmCitiesOn(code, cities) {
  return (cities || []).filter((c) => String(c.planet || '').toLowerCase().replace(/\s/g, '').indexOf(code) === 0);
}

// ---- row/popup HTML ----
function pmWpCmd(w) { return w.waypoint || `/wp ${(PM_PLANETS[w.planet] || {}).name || w.planet || ''} ${w.x} ${w.y}`; }
// the waypoint list (sidebar on the map page, right column on the Locations tab)
function pmListHtml(data, { hideName = false } = {}) {
  if (!data || !data.length) return '<div class="pm-empty">No waypoints here yet.</div>';
  return data.map((w) => {
    const cmd = pmWpCmd(w);
    const copy = waypointCopyText({ waypoint: cmd, resource_name: w.resource_name, concentration: w.concentration });
    return `<div class="pm-row" data-pmfocus="${safeInt(w.x)},${safeInt(w.y)}" data-pmid="${safeInt(w.id)}"${w.note ? ` title="${escapeHtml(w.note)}"` : ''}>
      <span class="pm-pct" style="color:${pmConcColor(safeInt(w.concentration))}">${safeInt(w.concentration)}%</span>
      ${hideName ? '' : `<span class="pm-name" data-wpres="${escapeHtml(w.resource_name || '')}" title="Open ${escapeHtml(w.resource_name || '')}">${escapeHtml(w.resource_name || '')}</span>`}
      ${w.note ? `<span class="pm-note">${escapeHtml(w.note)}</span>` : ''}
      <code class="pm-cmd">${escapeHtml(cmd)}</code>
      <a role="button" class="pm-copy" data-pmcopy="${escapeHtml(copy)}" title="Copy waypoint"><i class="fa-regular fa-clone"></i></a>
      ${safeInt(w.mine) ? `<a role="button" class="pm-drop" data-wpdrop="${safeInt(w.id)}" title="Remove — you shared this one"><i class="fa-solid fa-xmark"></i></a>` : ''}
    </div>`;
  }).join('');
}
function pmCityListHtml(cities) {
  if (!cities.length) return '<div class="pm-empty">No cities on this planet.</div>';
  const sorted = cities.slice().sort((a, b) => String(a.name).localeCompare(String(b.name)));
  return sorted.map((c) => {
    const wp = c.waypoint || `/wp ${c.x} ${c.z}`;
    const sub = [c.faction, c.mayor ? `Mayor ${c.mayor}` : '', c.active_citizens ? `${c.active_citizens} cit.` : ''].filter(Boolean).join(' · ');
    // the name leads and never truncates; the waypoint only matters for copying, so it rides on the copy icon
    return `<div class="pm-row pm-city-row" data-pmfocus="${safeInt(c.x)},${safeInt(c.z)}" data-pmcity="${escapeHtml(c.name)}" title="${escapeHtml(wp)}">
      <span class="pm-name pm-city-name"><i class="fa-solid fa-landmark pm-city-ico"></i> ${escapeHtml(c.name)}</span>
      ${sub ? `<span class="pm-note">${escapeHtml(sub)}</span>` : ''}
      <a role="button" class="pm-copy" data-pmcopy="${escapeHtml(wp)}" title="Copy ${escapeHtml(wp)}"><i class="fa-regular fa-clone"></i></a>
    </div>`;
  }).join('');
}

// ---- one map instance ----
// opts: { el, planet, resourceId?, listEl?, countEl?, showCities, onUpdate(info), onPick(x, y, planet) }
function pmCreateMap(L, opts) {
  const bounds = [[0, 0], [PM_SIZE, PM_SIZE]];
  let planet = pmIsPlanet(opts.planet) ? opts.planet : 'tat';
  let resourceId = opts.resourceId || null;
  let filterRid = null;
  let showHeat = true;
  let lastData = [];
  let allCities = null;
  let loadSeq = 0;
  let popupClosedAt = 0;

  // trackpad manners: two-finger scroll PANS (never zooms); pinch (a wheel event with ctrlKey
  // on macOS/Windows) or the +/- buttons zoom. Leaflet's default of zooming on every wheel
  // tick made moving around a lottery (Dustin).
  const map = L.map(opts.el, { crs: L.CRS.Simple, minZoom: -2, maxZoom: 2, zoomSnap: 0, zoomDelta: 0.5, attributionControl: false, scrollWheelZoom: false });
  const cont = map.getContainer();
  let pinchAcc = 0;
  cont.addEventListener('wheel', (e) => {
    e.preventDefault(); e.stopPropagation();
    if (e.ctrlKey || e.metaKey) { // pinch (WebKit reports it as a ctrl-wheel) — one snap step per ~24px of gesture
      pinchAcc += e.deltaY;
      if (Math.abs(pinchAcc) < 24) return;
      const step = pinchAcc > 0 ? -0.25 : 0.25; pinchAcc = 0;
      const z = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), map.getZoom() + step));
      map.setZoomAround(map.mouseEventToContainerPoint(e), z, { animate: false });
      return;
    }
    // two-finger scroll: pan 1:1 with the gesture, no inertia, no zoom
    const dx = e.deltaMode === 1 ? e.deltaX * 16 : e.deltaX;
    const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    map.panBy([dx, dy], { animate: false, noMoveStart: true });
  }, { passive: false });
  // WebKit reports a trackpad pinch as its own gesture events (scale), not as a ctrl-wheel —
  // zoom from those, continuously, around the fingers
  let pinchZoom = null; let pinchPt = null;
  cont.addEventListener('gesturestart', (e) => {
    e.preventDefault();
    pinchZoom = map.getZoom();
    pinchPt = map.mouseEventToContainerPoint(e);
  }, { passive: false });
  cont.addEventListener('gesturechange', (e) => {
    e.preventDefault();
    if (pinchZoom === null) return;
    const z = Math.max(map.getMinZoom(), Math.min(map.getMaxZoom(), pinchZoom + Math.log2(e.scale || 1)));
    map.setZoomAround(pinchPt, z, { animate: false });
  }, { passive: false });
  cont.addEventListener('gestureend', (e) => { e.preventDefault(); pinchZoom = null; }, { passive: false });
  let imageLayer = L.imageOverlay(pmImg(planet), bounds).addTo(map);
  map.createPane('pmGlow');
  map.getPane('pmGlow').style.zIndex = 450;
  map.getPane('pmGlow').style.pointerEvents = 'none';
  const glowLayer = L.layerGroup();
  const markerLayer = L.layerGroup().addTo(map);
  const cityLayer = L.layerGroup();
  map.fitBounds(bounds);
  map.touchZoom.disable(); map.boxZoom.disable(); // only the wheel path and the +/- buttons zoom

  // toggle controls (top-right): heatmap, cities
  const mkToggle = (label, title, initial, onToggle) => {
    const Ctl = L.Control.extend({
      options: { position: 'topright' },
      onAdd() {
        const div = L.DomUtil.create('div', 'leaflet-bar pm-toggle');
        let on = initial;
        div.innerHTML = `<a role="button" title="${title}">${label}: <b>${on ? 'on' : 'off'}</b></a>`;
        L.DomEvent.disableClickPropagation(div);
        L.DomEvent.on(div, 'click', (e) => { L.DomEvent.preventDefault(e); on = !on; div.querySelector('b').textContent = on ? 'on' : 'off'; onToggle(on); });
        return div;
      },
    });
    map.addControl(new Ctl());
  };
  mkToggle('Heatmap', 'Toggle the concentration glow', true, (on) => { showHeat = on; applyLayers(display()); });
  if (opts.showCities) {
    mkToggle('Cities', 'Toggle player cities', true, (on) => { if (on) cityLayer.addTo(map); else map.removeLayer(cityLayer); });
  }
  const Legend = L.Control.extend({
    options: { position: 'bottomright' },
    onAdd() {
      const div = L.DomUtil.create('div', 'pm-legend');
      div.innerHTML = '<div>Resource concentration</div><div class="pm-legend-bar"></div><div class="pm-legend-ends"><span>low %</span><span>high %</span></div>';
      div.style.display = 'none';
      return div;
    },
  });
  const legend = new Legend();
  map.addControl(legend);

  function display() {
    if (!filterRid) return lastData;
    return lastData.filter((w) => String(w.resource_id) === String(filterRid));
  }
  function applyLayers(data) {
    // each waypoint becomes a radial-gradient glow divIcon coloured by its
    // concentration, in its own pane under the pins; mix-blend-mode makes them "hot"
    glowLayer.clearLayers();
    if (showHeat && data.length) {
      data.forEach((w) => {
        const col = pmConcColor(w.concentration);
        const a = 0.45 + (w.concentration / 100) * 0.45;
        const size = 110 + (w.concentration / 100) * 120;
        const html = `<div class="pm-glow" style="width:${size}px;height:${size}px;background:radial-gradient(circle closest-side, ${pmRgba(col, a)}, ${pmRgba(col, a * 0.45)} 45%, ${pmRgba(col, 0)} 78%);"></div>`;
        const icon = L.divIcon({ className: 'pm-glow-icon', html, iconSize: [size, size], iconAnchor: [size / 2, size / 2] });
        L.marker(pmToLatLng(w.x, w.y), { icon, pane: 'pmGlow', interactive: false, keyboard: false }).addTo(glowLayer);
      });
      if (!map.hasLayer(glowLayer)) glowLayer.addTo(map);
    } else if (map.hasLayer(glowLayer)) {
      map.removeLayer(glowLayer);
    }
    if (legend._container) legend._container.style.display = showHeat && data.length ? '' : 'none';
  }
  const markersById = {};
  function renderMarkers(data) {
    markerLayer.clearLayers();
    Object.keys(markersById).forEach((k) => delete markersById[k]);
    data.forEach((w) => {
      const icon = L.divIcon({
        className: 'pm-pin',
        html: `<i class="fa-solid fa-location-dot" style="color:${pmConcColor(w.concentration)}"></i>`,
        iconSize: [22, 22], iconAnchor: [11, 21], popupAnchor: [0, -18],
      });
      const marker = L.marker(pmToLatLng(w.x, w.y), { icon, title: `${w.resource_name || ''} ${w.concentration}%` });
      const cmd = pmWpCmd(w);
      const copy = waypointCopyText({ waypoint: cmd, resource_name: w.resource_name, concentration: w.concentration });
      marker.bindPopup(`<div class="pm-popup">
        <b><span class="pm-poplink" data-wpres="${escapeHtml(w.resource_name || '')}" title="Open this resource">${escapeHtml(w.resource_name || 'Resource')}</span></b><br>
        <span class="pm-pop-pct">${safeInt(w.concentration)}%</span> &middot; ${safeInt(w.x)}, ${safeInt(w.y)}<br>
        ${w.note ? `<span class="pm-note">${escapeHtml(w.note)}</span><br>` : ''}
        <code>${escapeHtml(cmd)}</code> <a role="button" class="pm-copy" data-pmcopy="${escapeHtml(copy)}" title="Copy waypoint"><i class="fa-regular fa-clone"></i></a>
        ${safeInt(w.mine) ? `<br><a role="button" class="pm-drop pm-drop-link" data-wpdrop="${safeInt(w.id)}">remove — you shared this</a>` : ''}
      </div>`, { autoPan: false }); // the panel centres the pin itself — auto-pan would drag it off centre
      markerLayer.addLayer(marker);
      if (w.id) markersById[String(w.id)] = marker;
    });
  }
  function renderList(data) {
    if (opts.listEl) {
      const el = document.getElementById(opts.listEl);
      if (el) el.innerHTML = pmListHtml(data, { hideName: !!resourceId || !!filterRid });
    }
    if (opts.countEl) {
      const el = document.getElementById(opts.countEl);
      if (el) el.textContent = data.length ? `${data.length} waypoint${data.length === 1 ? '' : 's'}` : '';
    }
  }
  function render() { const d = display(); renderMarkers(d); renderList(d); applyLayers(d); }
  // distinct resources in the full (unfiltered) set — the map page's filter dropdown
  function distinctResources() {
    const seen = {}; const out = [];
    lastData.forEach((w) => {
      if (w.resource_id && !seen[w.resource_id]) {
        seen[w.resource_id] = 1;
        out.push({ id: w.resource_id, name: w.resource_name || `#${w.resource_id}`, status: w.resource_status });
      }
    });
    return out.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  }
  function emit() {
    if (typeof opts.onUpdate === 'function') opts.onUpdate({ count: lastData.length, resources: distinctResources(), cities: planetCities(), citiesLoaded: !!allCities, planet });
  }
  async function refresh() {
    const seq = ++loadSeq;
    if (opts.listEl) { const el = document.getElementById(opts.listEl); if (el && !el.querySelector('.pm-row')) el.innerHTML = '<div class="pm-empty"><span class="spinner"></span> Loading waypoints…</div>'; }
    const params = { planet };
    if (resourceId) params.resource_id = resourceId;
    let rows = [];
    try {
      const res = await apiFetch('GET', 'api/waypoints.php', { params });
      rows = (res.ok && res.data && res.data.results) || [];
    } catch (_) { rows = []; }
    if (seq !== loadSeq) return; // a newer planet/resource load won
    lastData = rows;
    render();
    emit();
  }
  function planetCities() { return pmCitiesOn(planet, allCities); }
  const cityMarkers = {};
  function renderCities() {
    if (!opts.showCities) return;
    cityLayer.clearLayers();
    Object.keys(cityMarkers).forEach((k) => delete cityMarkers[k]);
    planetCities().forEach((c) => {
      const icon = L.divIcon({ className: 'pm-city-pin', html: '<i class="fa-solid fa-landmark"></i>', iconSize: [20, 20], iconAnchor: [10, 18], popupAnchor: [0, -16] });
      const wp = c.waypoint || `/wp ${PM_PLANETS[planet].name} ${c.x} ${c.z}`;
      const info = `<div class="pm-popup"><b>${escapeHtml(c.name)}</b>${c.level ? ` <span class="pm-note">(Lvl ${escapeHtml(String(c.level))})</span>` : ''}<br>
        ${c.faction ? `${escapeHtml(c.faction)} &middot; ` : ''}${c.mayor ? `Mayor ${escapeHtml(c.mayor)}` : ''}<br>
        ${c.active_citizens ? `${escapeHtml(String(c.active_citizens))} active citizens<br>` : ''}
        ${c.specializations ? `<span class="pm-note">${escapeHtml(c.specializations)}</span><br>` : ''}
        <code>${escapeHtml(wp)}</code> <a role="button" class="pm-copy" data-pmcopy="${escapeHtml(wp)}" title="Copy waypoint"><i class="fa-regular fa-clone"></i></a></div>`;
      const mk = L.marker(pmToLatLng(safeInt(c.x), safeInt(c.z)), { icon, title: c.name }).bindPopup(info, { autoPan: false }).addTo(cityLayer);
      cityMarkers[String(c.name)] = mk;
    });
  }
  async function loadCities() {
    if (!opts.showCities) return;
    if (!map.hasLayer(cityLayer)) cityLayer.addTo(map);
    allCities = await pmCities();
    renderCities();
    emit();
  }
  function setPlanet(code) {
    if (!pmIsPlanet(code) || code === planet) { if (code === planet) refresh(); return; }
    planet = code;
    map.closePopup();
    map.removeLayer(imageLayer);
    imageLayer = L.imageOverlay(pmImg(planet), bounds).addTo(map);
    map.fitBounds(bounds);
    refresh();
    renderCities();
    emit();
  }

  // click-to-place: the add dialog opens prefilled with the spot. A click that
  // merely closed a popup is not a placement.
  map.on('popupclose', () => { popupClosedAt = Date.now(); });
  map.on('click', (e) => {
    if (typeof opts.onPick !== 'function') return;
    if (Date.now() - popupClosedAt < 350) return;
    const c = pmFromLatLng(e.latlng);
    if (c.x < -PM_MAX || c.x > PM_MAX || c.y < -PM_MAX || c.y > PM_MAX) return;
    opts.onPick(c.x, c.y, planet);
  });

  refresh();
  loadCities();

  // put a marker dead centre (its card opens above it, so nudge the centre up a little)
  function centreOn(m) {
    const z = Math.max(map.getZoom(), 1);
    const pt = map.project(m.getLatLng(), z).subtract([0, 60]);
    map.setView(map.unproject(pt, z), z, { animate: true });
  }
  return {
    map,
    refresh,
    setPlanet,
    getPlanet: () => planet,
    setResource(id) { resourceId = id || null; refresh(); },
    setFilter(id) { filterRid = id || null; render(); },
    getFilter: () => filterRid,
    focusCoord(x, z) { map.setView(pmToLatLng(safeInt(x), safeInt(z)), Math.max(map.getZoom(), 1)); },
    openWaypoint(id) {
      const m = markersById[String(id)];
      if (m) { centreOn(m); m.openPopup(); }
    },
    openCity(name) {
      const m = cityMarkers[String(name)];
      if (!m) return;
      if (!map.hasLayer(cityLayer)) cityLayer.addTo(map); // the panel asked for a city — show the layer
      centreOn(m); m.openPopup();
    },
    invalidate() { map.invalidateSize(); },
    data: () => lastData,
    destroy() { try { map.remove(); } catch (_) { /* already gone */ } },
  };
}

// ---- delegated clicks shared by every map + list: copy, open resource, remove, focus ----
function pmWireDelegates() {
  document.addEventListener('click', async (e) => {
    const copy = e.target.closest('[data-pmcopy]');
    if (copy) { e.preventDefault(); e.stopPropagation(); copyTextToClipboard(copy.dataset.pmcopy, 'Waypoint copied'); return; }
    const copyAll = e.target.closest('[data-pmcopyall]');
    if (copyAll) {
      e.preventDefault(); e.stopPropagation();
      const scope = document.getElementById(copyAll.dataset.pmcopyall);
      const lines = scope ? [...scope.querySelectorAll('[data-pmcopy]')].map((a) => a.dataset.pmcopy).filter(Boolean) : [];
      if (!lines.length) { toast('Nothing to copy', false); return; }
      copyTextToClipboard(lines.join('\n'), `Copied ${lines.length} waypoint${lines.length === 1 ? '' : 's'}`);
      return;
    }
    const res = e.target.closest('[data-wpres]');
    if (res && res.dataset.wpres) { e.preventDefault(); e.stopPropagation(); openResourcePage(res.dataset.wpres); return; }
    const drop = e.target.closest('[data-wpdrop]');
    if (drop) {
      e.preventDefault(); e.stopPropagation();
      if (!confirmArm(drop, 'Click again to remove')) return;
      const id = safeInt(drop.dataset.wpdrop);
      let r;
      try { r = await apiFetch('DELETE', 'api/waypoints.php', { data: { id } }); } catch (err) { r = { ok: false, error: String(err) }; }
      if (!r.ok) { toast(r.error || 'Could not remove that waypoint', false); return; }
      toast('Waypoint removed');
      if (pmState.map) { pmState.map.map.closePopup(); pmState.map.refresh(); }
      if (rdLoc.map) { rdLoc.map.map.closePopup(); rdLoc.map.refresh(); }
      return;
    }
    const row = e.target.closest('[data-pmfocus]');
    if (row) {
      const [x, z] = row.dataset.pmfocus.split(',');
      const host = row.closest('#page-planetmap') ? pmState.map : rdLoc.map;
      if (!host) return;
      if (row.dataset.pmid && safeInt(row.dataset.pmid)) host.openWaypoint(row.dataset.pmid);
      else if (row.dataset.pmcity) host.openCity(row.dataset.pmcity);
      else host.focusCoord(x, z);
    }
  });
}

// ======================================================================
// Planet Maps page
// ======================================================================
const pmState = { planet: 'tat', map: null, pending: null, loaded: false, collapsed: null };

function pmCollapsed() {
  if (!pmState.collapsed) {
    let c = [];
    try { c = JSON.parse(localStorage.getItem('pm_collapsed') || '[]'); } catch (_) { /* fresh */ }
    pmState.collapsed = new Set(Array.isArray(c) ? c : []);
  }
  return pmState.collapsed;
}
function pmApplyCollapsed() {
  const c = pmCollapsed();
  document.querySelectorAll('#page-planetmap [data-pmtoggle]').forEach((h) => {
    h.closest('.pm-section').classList.toggle('collapsed', c.has(h.dataset.pmtoggle));
  });
}

function pmRebuildFilter(resources) {
  const sel = $('#pm-resource');
  const cur = pmState.pending ? String(pmState.pending.id) : (sel.value || '');
  const active = resources.filter((r) => String(r.status) === '1');
  sel.innerHTML = `<option value="">All resources (${active.length})</option>`
    + active.map((r) => `<option value="${escapeHtml(String(r.id))}">${escapeHtml(r.name)}</option>`).join('');
  if (cur) {
    sel.value = cur;
    if (sel.value !== cur && pmState.pending) { // deep-linked resource with no waypoints here — keep it selectable
      sel.add(new Option(pmState.pending.name, cur)); sel.value = cur;
    }
    if (sel.value !== cur) sel.value = '';
  }
}

async function loadPlanetMap() {
  const hint = $('#pm-hint');
  let L;
  try { L = await pmEnsureLeaflet(); } catch (e) { hint.hidden = false; hint.textContent = String(e.message || e); return; }
  hint.hidden = true;
  if (pmState.map) { pmState.map.invalidate(); return; }
  const stored = localStorage.getItem('pm_planet');
  if (pmIsPlanet(stored) && !pmState.pending) pmState.planet = stored;
  $('#pm-planet').value = pmState.planet;
  pmState.map = pmCreateMap(L, {
    el: 'pm-map',
    planet: pmState.planet,
    listEl: 'pm-wp-list',
    showCities: true,
    onUpdate(info) {
      pmRebuildFilter(info.resources || []);
      $('#pm-wp-count').textContent = info.count ? `${info.count}` : '0';
      $('#pm-city-list').innerHTML = info.citiesLoaded ? pmCityListHtml(info.cities || []) : '<div class="pm-empty"><span class="spinner"></span> Loading cities…</div>';
      $('#pm-city-count').textContent = info.citiesLoaded ? String((info.cities || []).length) : '';
      $('#pm-wp-copyall').hidden = !info.count;
      if (pmState.pending) {
        const id = String(pmState.pending.id);
        $('#pm-resource').value = id;
        pmState.map.setFilter(id);
        pmState.pending = null;
        pmSyncFilterNote();
      }
    },
    onPick(x, y, planet) {
      const rid = $('#pm-resource').value;
      const name = rid ? $('#pm-resource').selectedOptions[0]?.textContent : '';
      openWaypointAddDialog({ planet, x, y, resourceId: rid || null, resourceName: name || '', onDone: () => pmState.map.refresh() });
    },
  });
  pmState.loaded = true;
}

// "Showing only X · 0 here" under the dropdown when a filter hides everything
function pmSyncFilterNote() {
  const sel = $('#pm-resource');
  const note = $('#pm-filternote');
  if (!pmState.map || !sel.value) { note.hidden = true; return; }
  const n = pmState.map.data().filter((w) => String(w.resource_id) === sel.value).length;
  note.hidden = n > 0;
  note.textContent = n ? '' : `No waypoints for ${sel.selectedOptions[0]?.textContent || 'this resource'} on ${PM_PLANETS[pmState.map.getPlanet()].display} yet — click the map to add one.`;
}

// deep link: the resource page's "Open full map", Home, etc.
function openPlanetMap(planet, resourceId, resourceName) {
  if (pmIsPlanet(planet)) { pmState.planet = planet; localStorage.setItem('pm_planet', planet); }
  pmState.pending = resourceId ? { id: resourceId, name: resourceName || `#${resourceId}` } : null;
  showPage('planetmap');
  if (pmState.map) {
    $('#pm-planet').value = pmState.planet;
    pmState.map.setFilter(null);
    pmState.map.setPlanet(pmState.planet); // refreshes → onUpdate applies the pending filter
  }
}

function initPlanetMaps() {
  pmWireDelegates();
  const sel = $('#pm-planet');
  sel.innerHTML = Object.entries(PM_PLANETS).map(([c, p]) => `<option value="${c}">${p.display}</option>`).join('');
  sel.value = pmState.planet;
  sel.addEventListener('change', () => {
    pmState.planet = sel.value;
    localStorage.setItem('pm_planet', sel.value);
    if (!pmState.map) return;
    pmState.map.setFilter(null);
    $('#pm-resource').value = '';
    $('#pm-filternote').hidden = true;
    pmState.map.setPlanet(sel.value);
  });
  $('#pm-resource').addEventListener('change', () => {
    if (!pmState.map) return;
    pmState.map.setFilter($('#pm-resource').value || null);
    pmSyncFilterNote();
  });
  $('#pm-reload').addEventListener('click', () => { pmCitiesCache = null; if (pmState.map) pmState.map.refresh(); else loadPlanetMap(); });
  $('#pm-add').addEventListener('click', () => {
    const rid = $('#pm-resource').value;
    openWaypointAddDialog({
      planet: pmState.map ? pmState.map.getPlanet() : pmState.planet,
      resourceId: rid || null,
      resourceName: rid ? $('#pm-resource').selectedOptions[0]?.textContent : '',
      onDone: () => pmState.map && pmState.map.refresh(),
    });
  });
  // fold the sidebar sections under their own headers (remembered)
  document.querySelectorAll('#page-planetmap [data-pmtoggle]').forEach((h) => {
    h.addEventListener('click', (e) => {
      if (e.target.closest('[data-pmcopyall]')) return;
      const c = pmCollapsed(); const k = h.dataset.pmtoggle;
      if (c.has(k)) c.delete(k); else c.add(k);
      try { localStorage.setItem('pm_collapsed', JSON.stringify([...c])); } catch (_) { /* ignore */ }
      pmApplyCollapsed();
      if (pmState.map) setTimeout(() => pmState.map.invalidate(), 50);
    });
  });
  pmApplyCollapsed();
  // side panel: drag the splitter to resize it, the header button hides it; both remembered
  const layout = document.querySelector('#page-planetmap .pm-layout');
  const side = layout.querySelector('.pm-side');
  const splitter = $('#pm-splitter');
  const sideBtn = $('#pm-sidebtn');
  const applySide = () => {
    const w = safeInt(localStorage.getItem('pm_side_w')) || 330;
    side.style.flexBasis = `${Math.min(720, Math.max(200, w))}px`;
    const hidden = localStorage.getItem('pm_side_hidden') === '1';
    layout.classList.toggle('side-hidden', hidden);
    sideBtn.classList.toggle('active', hidden);
    sideBtn.title = hidden ? 'Show the side panel' : 'Hide the side panel';
    if (pmState.map) setTimeout(() => pmState.map.invalidate(), 30);
  };
  sideBtn.addEventListener('click', () => { localStorage.setItem('pm_side_hidden', layout.classList.contains('side-hidden') ? '' : '1'); applySide(); });
  splitter.addEventListener('mousedown', (e) => {
    e.preventDefault();
    const startX = e.clientX; const startW = side.getBoundingClientRect().width;
    splitter.classList.add('dragging'); document.body.style.cursor = 'col-resize'; document.body.style.userSelect = 'none';
    const move = (ev) => { const w = Math.min(720, Math.max(200, startW - (ev.clientX - startX))); side.style.flexBasis = `${w}px`; if (pmState.map) pmState.map.map.invalidateSize(); };
    const up = () => {
      document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up);
      splitter.classList.remove('dragging'); document.body.style.cursor = ''; document.body.style.userSelect = '';
      localStorage.setItem('pm_side_w', String(Math.round(side.getBoundingClientRect().width)));
    };
    document.addEventListener('mousemove', move); document.addEventListener('mouseup', up);
  });
  splitter.addEventListener('dblclick', () => { localStorage.removeItem('pm_side_w'); applySide(); });
  applySide();
  // Leaflet sizes itself from the container — re-measure whenever the page comes back
  document.addEventListener('page:show', (e) => {
    if (e.detail?.key === 'planetmap' && pmState.map) setTimeout(() => pmState.map.invalidate(), 30);
    if (e.detail?.key === 'resource' && rdLoc.map && !$('#rd-locations').hidden) setTimeout(() => rdLoc.map.invalidate(), 30);
  });
  window.addEventListener('resize', () => { if (pmState.map) pmState.map.invalidate(); if (rdLoc.map) rdLoc.map.invalidate(); });
}

// ======================================================================
// Resource page — Locations tab (the site's resource Locations pane)
// ======================================================================
const rdLoc = { map: null, resource: null, codes: [] };

// planets this resource spawns on (falls back to every planet, like the site)
function rdLocPlanetCodes(r) {
  const codes = Object.keys(PM_FLAG_CODE).filter((k) => String(r[k] ?? '0') === '1').map((k) => PM_FLAG_CODE[k]);
  return codes.length ? codes : Object.keys(PM_PLANETS);
}

// a fresh resource opened: rebuild the planet picker; the map (if built) follows
function rdLocationsReset(r) {
  rdLoc.resource = r || null;
  rdLoc.codes = r ? rdLocPlanetCodes(r) : [];
  const sel = $('#rd-loc-planet');
  sel.innerHTML = rdLoc.codes.map((c) => `<option value="${c}">${PM_PLANETS[c].display}</option>`).join('');
  $('#rd-loc-count').textContent = '';
  $('#rd-wp-list').innerHTML = '';
  if (rdLoc.map) {
    rdLoc.map.setResource(r ? r.id : null); // refreshes on the current planet…
    if (r && !rdLoc.codes.includes(rdLoc.map.getPlanet())) rdLoc.map.setPlanet(rdLoc.codes[0]); // …unless it doesn't spawn there
    sel.value = rdLoc.map.getPlanet();
  }
}

// the pane just became visible — build the map on first use, re-measure after
async function rdInitLocations() {
  const r = rdLoc.resource;
  if (!r) return;
  const hint = $('#rd-loc-hint');
  let L;
  try { L = await pmEnsureLeaflet(); } catch (e) { hint.hidden = false; hint.textContent = String(e.message || e); return; }
  hint.hidden = true;
  if ($('#rd-locations').hidden) return; // tab changed while Leaflet loaded
  if (rdLoc.map) { rdLoc.map.invalidate(); return; }
  const sel = $('#rd-loc-planet');
  if (!sel.value) sel.value = rdLoc.codes[0];
  rdLoc.map = pmCreateMap(L, {
    el: 'rd-map',
    planet: sel.value,
    resourceId: r.id,
    listEl: 'rd-wp-list',
    countEl: 'rd-loc-count',
    showCities: true,
    onPick(x, y, planet) {
      const cur = rdLoc.resource;
      openWaypointAddDialog({ planet, x, y, resourceId: cur.id, resourceName: cur.name, onDone: () => rdLoc.map.refresh() });
    },
  });
}

function initRdLocations() {
  $('#rd-loc-planet').addEventListener('change', () => { if (rdLoc.map) rdLoc.map.setPlanet($('#rd-loc-planet').value); });
  $('#rd-loc-add').addEventListener('click', () => {
    const r = rdLoc.resource; if (!r) return;
    openWaypointAddDialog({ planet: $('#rd-loc-planet').value, resourceId: r.id, resourceName: r.name, onDone: () => rdLoc.map && rdLoc.map.refresh() });
  });
  $('#rd-loc-fullmap').addEventListener('click', () => {
    const r = rdLoc.resource; if (!r) return;
    openPlanetMap($('#rd-loc-planet').value, r.id, r.name);
  });
}

// ======================================================================
// Add-waypoint dialog (shared): quick-entry paste, or planet + X/Y + % + note
// ======================================================================
let wpAddBusy = false;
function openWaypointAddDialog({ planet, x, y, resourceId, resourceName, onDone } = {}) {
  const modal = $('#wp-add-modal');
  const fixed = !!resourceId && !!resourceName;
  $('#wp-add-resfixed').hidden = !fixed;
  $('#wp-add-resfield').hidden = fixed;
  $('#wp-add-resname').textContent = resourceName || '';
  $('#wp-add-res').value = fixed ? resourceName : (resourceName || '');
  $('#wp-add-res').dataset.rid = fixed ? String(resourceId) : '';
  const psel = $('#wp-add-planet');
  if (!psel.options.length) psel.innerHTML = Object.entries(PM_PLANETS).map(([c, p]) => `<option value="${c}">${p.display}</option>`).join('');
  psel.value = pmIsPlanet(planet) ? planet : 'tat';
  $('#wp-add-x').value = x != null ? String(x) : '';
  $('#wp-add-y').value = y != null ? String(y) : '';
  $('#wp-add-conc').value = '';
  $('#wp-add-note').value = '';
  $('#wp-add-quick').value = '';
  $('#wp-add-status').textContent = '';
  modal.hidden = false;
  (fixed ? (x != null ? $('#wp-add-conc') : $('#wp-add-quick')) : $('#wp-add-res')).focus();

  const close = () => { cleanup(); modal.hidden = true; };
  const save = async () => {
    if (wpAddBusy) return;
    const status = $('#wp-add-status');
    const rname = $('#wp-add-res').value.trim();
    const rid = safeInt($('#wp-add-res').dataset.rid);
    const px = $('#wp-add-x').value.trim(); const py = $('#wp-add-y').value.trim();
    const conc = safeInt($('#wp-add-conc').value);
    if (!fixed && !rname) { status.textContent = 'Which resource is this for?'; $('#wp-add-res').focus(); return; }
    if (px === '' || py === '' || Number.isNaN(Number(px)) || Number.isNaN(Number(py))) { status.textContent = 'X and Y are both needed.'; $('#wp-add-x').focus(); return; }
    if (Math.abs(Number(px)) > PM_MAX || Math.abs(Number(py)) > PM_MAX) { status.textContent = `X and Y must be between -${PM_MAX} and ${PM_MAX}.`; return; }
    if (conc < 1 || conc > 100) { status.textContent = 'Concentration must be 1–100%.'; $('#wp-add-conc').focus(); return; }
    const data = { planet: psel.value, x: Math.round(Number(px)), y: Math.round(Number(py)), concentration: conc, note: $('#wp-add-note').value.trim() };
    if (rid) data.resource_id = rid; else data.rname = rname;
    wpAddBusy = true; $('#wp-add-save').disabled = true; status.textContent = 'Saving…';
    let r;
    try { r = await apiFetch('POST', 'api/waypoints.php', { data }); } catch (err) { r = { ok: false, error: String(err) }; }
    wpAddBusy = false; $('#wp-add-save').disabled = false;
    if (!r.ok) { status.textContent = r.error || 'Could not save the waypoint.'; return; }
    toast(r.data && r.data.status === 'exists' ? 'You already shared that spot' : `Waypoint shared: ${rname || resourceName} @ ${conc}% on ${PM_PLANETS[psel.value].display}`);
    close();
    if (onDone) onDone();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') { close(); return; }
    if (e.key === 'Enter' && e.target.id !== 'wp-add-quick') { e.preventDefault(); save(); }
  };
  const onBackdrop = (e) => { if (e.target === modal) close(); };
  function cleanup() {
    modal.removeEventListener('keydown', onKey);
    modal.removeEventListener('click', onBackdrop);
    $('#wp-add-save').removeEventListener('click', save);
    $('#wp-add-cancel').removeEventListener('click', close);
  }
  modal.addEventListener('keydown', onKey);
  modal.addEventListener('click', onBackdrop);
  $('#wp-add-save').addEventListener('click', save);
  $('#wp-add-cancel').addEventListener('click', close);
}

function initWaypointAddDialog() {
  // quick entry: paste a /way line → planet + X/Y (+ % + note) fill themselves
  const quick = $('#wp-add-quick');
  const applyQuick = () => {
    const p = pmParseWaypoint(quick.value);
    if (!p) return;
    const code = p.planet ? pmPlanetCode(p.planet) : '';
    if (code) $('#wp-add-planet').value = code;
    $('#wp-add-x').value = p.x; $('#wp-add-y').value = p.y;
    if (p.pct !== null) $('#wp-add-conc').value = Math.round(p.pct);
    if (p.note) $('#wp-add-note').value = p.note;
    $('#wp-add-conc').focus();
  };
  quick.addEventListener('paste', () => setTimeout(applyQuick, 0));
  quick.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); applyQuick(); } });
  quick.addEventListener('change', applyQuick);
  // resource name typeahead against the live active list (any typed name is
  // accepted too — the server resolves exact names)
  const res = $('#wp-add-res');
  const list = $('#wp-add-reslist');
  let t = null; let seq = 0;
  res.addEventListener('input', () => {
    res.dataset.rid = '';
    clearTimeout(t);
    const q = res.value.trim();
    if (q.length < 2) return;
    t = setTimeout(async () => {
      const my = ++seq;
      let r;
      try { r = await api().search_resources({ search: q, status: 'active', page: 1 }); } catch (_) { return; }
      if (my !== seq) return;
      const rows = (r.ok && r.data && (r.data.results || r.data.resources)) || [];
      list.innerHTML = rows.slice(0, 12).map((x) => `<option value="${escapeHtml(x.name || '')}">${escapeHtml(x.type_name || '')}</option>`).join('');
    }, 220);
  });
}
