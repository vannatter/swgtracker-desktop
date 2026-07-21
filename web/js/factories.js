/* Factories — timed factory runs, site-synced (api/factories.php).
   A factory is a label + what it's producing + per-unit time + quantity;
   Start stamps the clock server-side and the card counts down to collection.
   Not tied to a character on purpose: players run friends' factories too.
   Desktop notification fires from here when a run lands (the email path is
   the site cron's job, for people away from the machine). */

const facState = { items: [], history: [], timer: null, saveTimers: {}, dragId: null,
                   view: 'cards', viewLoaded: false,  // 'cards' | 'grid', sticky via config fac_view
                   tagFilter: null,                    // active tag-cloud filter, session-only
                   groups: [],                         // api/groups.php folders (kind=factory)
                   collapsed: new Set(),               // collapsed section keys, session-only
                   detailsOpen: new Set(),             // cards with the details editor open
                   histOpen: null, histQuery: '', histType: '' }; // history combobox state

// run-type tags for remembered runs — powers the history dropdown's filter chips
const FAC_RUN_TYPES = ['Armor', 'Clothing', 'Weapon', 'Architect', 'Droid', 'Food', 'Medicine', 'Other'];

const FAC_UNITS = { s: 'Seconds', m: 'Minutes', h: 'Hours' };
const FAC_UNIT_SECS = { s: 1, m: 60, h: 3600 };

// tags live as one comma-separated string server-side; chips/cloud split it here
const facTags = (f) => String(f.tags || '').split(',').map((t) => t.trim()).filter(Boolean);
const facLoc = (f) => [f.planet, (f.x != null && f.y != null) ? `(${f.x}, ${f.y})` : '']
  .filter(Boolean).join(' ');

const facDuration = (f) =>
  Math.ceil((Number(f.time_value) || 0) * (FAC_UNIT_SECS[f.time_unit] || 1) * (Number(f.quantity) || 0));
const facNow = () => Math.floor(Date.now() / 1000);
// paused time pushes the finish line out; while paused the due point slides
// forward second-for-second, so "remaining" holds still
const facDue = (f) => (f.started_at || 0) + facDuration(f) + (f.paused_secs || 0)
  + (f.paused_at ? facNow() - f.paused_at : 0);
const facElapsed = (f) =>
  Math.min(Math.max(0, (f.paused_at || facNow()) - f.started_at - (f.paused_secs || 0)), facDuration(f));
// components off the line so far: elapsed ÷ per-unit time, capped at the batch
const facUnitsDone = (f) => {
  const per = (Number(f.time_value) || 0) * (FAC_UNIT_SECS[f.time_unit] || 1);
  if (per <= 0 || !f.started_at) return 0;
  return Math.min(Number(f.quantity) || 0, Math.floor(facElapsed(f) / per));
};

function facFmtDur(secs) {
  secs = Math.max(0, Math.round(secs));
  const h = Math.floor(secs / 3600), m = Math.floor((secs % 3600) / 60), s = secs % 60;
  if (h) return `${h}h ${m}m`;
  if (m) return `${m}m ${s}s`;
  return `${s}s`;
}

function facEta(f) {
  const d = new Date(facDue(f) * 1000);
  const sameDay = new Date().toDateString() === d.toDateString();
  const t = d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  return sameDay ? t : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })} ${t}`;
}

function facStatus(f) {
  if (!f.started_at) return 'idle';
  if (f.paused_at) return 'paused';
  return facNow() >= facDue(f) ? 'done' : 'running';
}

// ---- rendering ------------------------------------------------------------

function facCardHtml(f) {
  const st = facStatus(f);
  const dur = facDuration(f);
  const running = st === 'running', done = st === 'done';
  const open = facState.detailsOpen.has(String(f.id));
  const tags = facTags(f), loc = facLoc(f);
  // support data shows as pills in the header; EDITING it lives behind the
  // sliders toggle so the everyday card stays about the run
  // header pills: owner + tags only — location lives in the details editor
  // (and the name's hover title), it was wrapping the title row
  const pills = [
    f.owner ? `<span class="fac-pill"><i class="fa-solid fa-user"></i>${escapeHtml(f.owner)}</span>` : '',
    ...tags.map((t) => `<span class="fac-pill fac-pill-tag">${escapeHtml(t)}</span>`),
  ].filter(Boolean).join('');
  return `<div class="fac-card fac-${st}" data-facid="${f.id}" data-facstate="${st}" draggable="true">
    <div class="fac-hd">
      <div class="fac-title">
        <input class="fac-name" data-facfield="name" value="${escapeHtml(f.name)}" spellcheck="false" maxlength="64">
        ${(f.x != null && f.y != null) ? `<button class="btn btn-icon fac-wpbtn" data-facwpcopy="${f.id}"
          title="${escapeHtml(loc)} — click to copy a /waypoint command"><i class="fa-solid fa-location-dot"></i></button>` : ''}
        ${pills ? `<span class="fac-sub">${pills}</span>` : ''}
        <span class="fac-badge">${st.toUpperCase()}</span>
        <button class="btn btn-icon fac-details${open ? ' open' : ''}" data-facdetails="${f.id}"
                title="Details — group, owner, tags, location"><i class="fa-solid fa-sliders"></i></button>
        <button class="btn btn-icon" data-facremove="${f.id}" title="Remove factory"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>
    <div class="fac-body">
      ${!f.started_at && facState.history.length ? `
        <div class="fac-histrow">
          <label class="fac-label">Load from history</label>
          <div class="fac-histbox">
            <input class="form-control filter-input" data-fachistq="${f.id}"
                   placeholder="Search previous runs…" autocomplete="off" spellcheck="false">
            <div class="fac-hist-menu" data-fachistmenu="${f.id}" hidden></div>
          </div>
        </div>` : ''}
      <div class="fac-grid">
        <label class="fac-field"><span class="fac-label">Product</span>
          <input class="form-control filter-input" data-facfield="product" value="${escapeHtml(f.product)}"
                 placeholder="What's it making?" spellcheck="false" ${f.started_at ? 'disabled' : ''}></label>
        <label class="fac-field"><span class="fac-label">Time per unit</span>
          <input class="form-control filter-input" data-facfield="time_value" value="${f.time_value || ''}"
                 inputmode="decimal" ${f.started_at ? 'disabled' : ''}></label>
        <label class="fac-field"><span class="fac-label">Unit</span>
          <select class="form-select filter-select" data-facfield="time_unit" ${f.started_at ? 'disabled' : ''}>
            ${Object.entries(FAC_UNITS).map(([u, label]) =>
              `<option value="${u}"${f.time_unit === u ? ' selected' : ''}>${label}</option>`).join('')}
          </select></label>
        <label class="fac-field"><span class="fac-label">Quantity</span>
          <input class="form-control filter-input" data-facfield="quantity" value="${f.quantity || ''}"
                 inputmode="numeric" ${f.started_at ? 'disabled' : ''}></label>
      </div>
      ${open ? `<div class="fac-grid fac-meta">
        <label class="fac-field"><span class="fac-label">Group</span>
          <select class="form-select filter-select" data-facfield="group_id">
            <option value="">—</option>
            ${facState.groups.map((g) =>
              `<option value="${g.id}"${Number(f.group_id) === g.id ? ' selected' : ''}>${escapeHtml(g.name)}</option>`).join('')}
          </select></label>
        <label class="fac-field"><span class="fac-label">Owner</span>
          <input class="form-control filter-input" data-facfield="owner" value="${escapeHtml(f.owner || '')}"
                 placeholder="Whose is it?" maxlength="64" spellcheck="false"></label>
        <label class="fac-field"><span class="fac-label">Planet</span>
          <select class="form-select filter-select" data-facfield="planet">
            <option value="">—</option>
            ${Object.values(PLANET_FULL).filter((p) => p !== 'Mustafar' && p !== 'Kashyyyk')
              .map((p) => `<option value="${escapeHtml(p)}"${f.planet === p ? ' selected' : ''}>${escapeHtml(p)}</option>`).join('')}
          </select></label>
        <label class="fac-field fac-field-tags"><span class="fac-label">Tags</span>
          <input class="form-control filter-input" data-facfield="tags" value="${escapeHtml(f.tags || '')}"
                 placeholder="comma, separated" maxlength="255" spellcheck="false"></label>
        <label class="fac-field"><span class="fac-label">Waypoint</span>
          <input class="form-control filter-input" data-facwp
                 value="${(f.x != null && f.y != null) ? `${f.x} ${f.y}` : ''}" placeholder="x y" spellcheck="false"></label>
      </div>` : ''}
      <div class="fac-grid fac-outputs">
        <div class="fac-out"><span class="fac-label">Run time</span><b>${dur ? facFmtDur(dur) : '—'}</b></div>
        <div class="fac-out"><span class="fac-label">Est. done</span><b class="fac-eta">${f.started_at ? facEta(f) : '—'}</b></div>
        <div class="fac-out"><span class="fac-label">Remaining</span>
          <b class="fac-remaining">${done ? 'Done' : f.started_at ? facFmtDur(facDue(f) - facNow()) : '—'}</b></div>
        <div class="fac-out"><span class="fac-label">Completed</span>
          <b class="fac-units">${f.started_at ? `${fmtNum(facUnitsDone(f))} / ${fmtNum(f.quantity)}` : '—'}</b></div>
      </div>
      ${f.started_at ? `
        <div class="fac-progressrow">
          <span class="fac-elapsed">Elapsed: ${facFmtDur(facElapsed(f))}${f.paused_at ? ' · paused' : ''}</span>
          <div class="fac-track"><div class="fac-fill" style="width:${Math.min(100, facElapsed(f) / Math.max(1, dur) * 100).toFixed(1)}%"></div></div>
          <span class="fac-pct">${Math.min(100, Math.round(facElapsed(f) / Math.max(1, dur) * 100))}%</span>
        </div>` : ''}
      ${done ? `<div class="fac-banner">✓ ${escapeHtml(f.name)} complete — ${fmtNum(f.quantity)} × ${escapeHtml(f.product || 'items')} ready to collect</div>` : ''}
    </div>
    <div class="fac-foot">
      ${f.started_at
        ? `<button class="btn btn-sm ${done ? 'btn-accent' : 'btn-outline-secondary'}" data-facdone="${f.id}"><i class="fa-solid fa-xmark"></i> Done</button>
           ${done ? '' : f.paused_at
             ? `<button class="btn btn-sm btn-outline-secondary" data-facresume="${f.id}"><i class="fa-solid fa-play"></i> Resume</button>`
             : `<button class="btn btn-sm btn-outline-secondary" data-facpause="${f.id}" title="Freeze the countdown without ending the run"><i class="fa-solid fa-pause"></i> Pause</button>`}
           <button class="btn btn-sm btn-outline-secondary" data-facreset="${f.id}"><i class="fa-solid fa-rotate-left"></i> Reset</button>`
        : `<button class="btn btn-sm btn-accent" data-facstart="${f.id}">Start</button>`}
      <label class="pin-toggle fac-notify" title="Desktop notification when this run finishes">
        <input type="checkbox" data-facfield="notify_desktop" ${f.notify_desktop ? 'checked' : ''}> Notify</label>
      <label class="pin-toggle fac-notify" title="Email when this run finishes (needs your swgtracker.com account email)">
        <input type="checkbox" data-facfield="notify_email" ${f.notify_email ? 'checked' : ''}> Email</label>
    </div>
  </div>`;
}

// grid view: a compact monitor table — editing happens in card view
function facGridHtml(items) {
  const rowFor = (f) => {
    const st = facStatus(f), dur = facDuration(f);
    return `<tr class="fac-${st}" data-facid="${f.id}" data-facstate="${st}" draggable="true">
      <td class="col-name" title="${escapeHtml([facLoc(f), f.tags].filter(Boolean).join(' · '))}">${escapeHtml(f.name)}</td>
      <td class="col-text">${escapeHtml(f.owner || '—')}</td>
      <td><span class="fac-badge">${st.toUpperCase()}</span></td>
      <td class="col-name">${escapeHtml(f.product || '—')}</td>
      <td class="col-num">${f.quantity ? fmtNum(f.quantity) : '—'}</td>
      <td class="col-num fac-units">${f.started_at ? fmtNum(facUnitsDone(f)) : '—'}</td>
      <td class="col-num">${f.time_value ? `${f.time_value}${f.time_unit}` : '—'}</td>
      <td>${dur ? facFmtDur(dur) : '—'}</td>
      <td>${f.started_at ? facEta(f) : '—'}</td>
      <td class="fac-remaining">${st === 'done' ? 'Done' : f.started_at ? facFmtDur(facDue(f) - facNow()) : '—'}</td>
      <td>${f.started_at
        ? `<button class="btn btn-sm btn-outline-secondary" data-facdone="${f.id}"><i class="fa-solid fa-xmark"></i> Done</button>
           ${st === 'done' ? '' : f.paused_at
             ? `<button class="btn btn-sm btn-outline-secondary" data-facresume="${f.id}">Resume</button>`
             : `<button class="btn btn-sm btn-outline-secondary" data-facpause="${f.id}">Pause</button>`}`
        : `<button class="btn btn-sm btn-accent" data-facstart="${f.id}">Start</button>`}</td>
    </tr>`;
  };
  const sections = grpSections(facState.groups, items, (f) => f.group_id);
  const rows = sections.map((s) =>
    ((s.key !== 'un' || sections.length > 1)
      ? `<tr class="grp-row" data-grpkey="${s.key}"><td colspan="11">${escapeHtml(s.name)} <span class="grp-count">${s.items.length}</span></td></tr>` : '')
    + s.items.map(rowFor).join('')).join('');
  return `<div class="table-wrap"><table class="data-grid"><thead><tr>
    <th class="col-name">Factory</th><th class="col-text">Owner</th>
    <th>Status</th><th class="col-name">Product</th>
    <th class="col-num">Qty</th><th class="col-num">Made</th><th class="col-num">Per unit</th><th>Run time</th>
    <th>Est. done</th><th>Remaining</th><th></th></tr></thead><tbody>${rows}</tbody></table></div>`;
}

// the history combobox panel: type-filter chips + matching runs, each row
// pickable, taggable (type select) and deletable. Rebuilt in place on every
// keystroke/chip click so the search input never loses focus.
function facHistMenuHtml() {
  const q = facState.histQuery.trim().toLowerCase();
  const usedTypes = FAC_RUN_TYPES.filter((t) => facState.history.some((h) => h.run_type === t));
  let items = facState.history;
  if (facState.histType) items = items.filter((h) => h.run_type === facState.histType);
  if (q) items = items.filter((h) => String(h.product || '').toLowerCase().includes(q));
  const chips = usedTypes.length ? `<div class="fac-hist-chips">
      <span class="fac-tag${!facState.histType ? ' active' : ''}" data-fachistchip="">All</span>
      ${usedTypes.map((t) =>
        `<span class="fac-tag${facState.histType === t ? ' active' : ''}" data-fachistchip="${t}">${t}</span>`).join('')}
    </div>` : '';
  const rows = items.map((h) => `
    <div class="fac-hist-item" data-fachistpick="${h.id}">
      <span class="fac-hist-prod">${escapeHtml(h.product)}</span>
      <span class="fac-hist-sub">${fmtNum(h.quantity)} @ ${h.time_value}${h.time_unit}</span>
      <select class="form-select filter-select fac-hist-type" data-fachisttype="${h.id}" title="Tag this run's type">
        <option value="">type…</option>
        ${FAC_RUN_TYPES.map((t) => `<option value="${t}"${h.run_type === t ? ' selected' : ''}>${t}</option>`).join('')}
      </select>
      <button class="fac-hist-del" data-fachistdel="${h.id}" title="Forget this run"><i class="fa-solid fa-trash-can"></i></button>
    </div>`).join('');
  return chips + (rows || '<div class="fac-hist-empty">No matching runs.</div>');
}

function facRefreshHistMenu() {
  const menu = document.querySelector(`[data-fachistmenu="${facState.histOpen}"]`);
  if (menu) { menu.hidden = false; menu.innerHTML = facHistMenuHtml(); }
}

function facUpdateViewToggle() {
  const btn = $('#fac-viewtoggle');
  const grid = facState.view === 'grid';
  btn.innerHTML = `<i class="fa-solid ${grid ? 'fa-rectangle-list' : 'fa-table-cells-large'}"></i>`;
  btn.title = grid ? 'Switch to card view' : 'Switch to grid view';
}

function renderFactories() {
  $('#fac-empty').hidden = !!facState.items.length;

  // tag cloud builds from EVERY factory (not the filtered set — else you
  // couldn't click a filter back off) and doubles as the filter UI
  const allTags = [...new Set(facState.items.flatMap(facTags))];
  if (facState.tagFilter && !allTags.includes(facState.tagFilter)) facState.tagFilter = null;
  const bar = $('#fac-tagbar');
  bar.hidden = !allTags.length;
  bar.innerHTML = allTags.length
    ? '<span class="fac-tagbar-label"><i class="fa-solid fa-tags"></i></span>'
      + allTags.map((t) => `<span class="fac-tag${facState.tagFilter === t ? ' active' : ''}"
          data-factag="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('')
    : '';
  const items = facState.tagFilter
    ? facState.items.filter((f) => facTags(f).includes(facState.tagFilter))
    : facState.items;
  const sections = grpSections(facState.groups, items, (f) => f.group_id);

  if (facState.view === 'grid') {
    $('#fac-list').innerHTML = facGridHtml(items);
  } else {
    $('#fac-list').innerHTML = sections.map((s) => {
      const collapsed = facState.collapsed.has(s.key);
      const body = `<div class="fac-cards" data-facgroup="${s.key}"${collapsed ? ' hidden' : ''}>${s.items.map(facCardHtml).join('')}</div>`;
      // groups render as contained panels (header caps the box); a lone
      // Unfiled section stays chromeless — same as before groups existed
      return (s.key !== 'un' || sections.length > 1)
        ? `<div class="grp-sec">${grpHeaderHtml(s.key, s.name, s.items.length, collapsed, 'factories')}${body}</div>`
        : body;
    }).join('');
  }
  facUpdateViewToggle();
  facCacheForNotify();
}

// light per-second refresh of the moving parts only (full re-render would
// fight the user's typing)
function facTick() {
  if (!$('#page-factories').classList.contains('active')) return;
  let needsFull = false;
  for (const f of facState.items) {
    const card = document.querySelector(`#fac-list [data-facid="${f.id}"]`);
    if (!card || !f.started_at) continue;
    const st = facStatus(f);
    if (card.dataset.facstate !== st) { needsFull = true; continue; } // crossed the finish line
    const dur = facDuration(f);
    const rem = card.querySelector('.fac-remaining');
    if (rem && st === 'running') rem.textContent = facFmtDur(facDue(f) - facNow());
    // while paused only the ETA moves (the finish line slides out as you wait)
    const eta = card.querySelector('.fac-eta');
    if (eta && st === 'paused') eta.textContent = facEta(f);
    const fill = card.querySelector('.fac-fill');
    if (fill) fill.style.width = `${Math.min(100, facElapsed(f) / Math.max(1, dur) * 100).toFixed(1)}%`;
    const pct = card.querySelector('.fac-pct');
    if (pct) pct.textContent = `${Math.min(100, Math.round(facElapsed(f) / Math.max(1, dur) * 100))}%`;
    const el = card.querySelector('.fac-elapsed');
    if (el) el.textContent = `Elapsed: ${facFmtDur(facElapsed(f))}${f.paused_at ? ' · paused' : ''}`;
    const un = card.querySelector('.fac-units');
    if (un) {
      un.textContent = card.tagName === 'TR'
        ? fmtNum(facUnitsDone(f))
        : `${fmtNum(facUnitsDone(f))} / ${fmtNum(f.quantity)}`;
    }
  }
  if (needsFull) renderFactories();
}

// ---- data -----------------------------------------------------------------

async function loadFactories() {
  if (!facState.viewLoaded) {
    facState.viewLoaded = true;
    try {
      const cfg = await api().get_config();
      if (cfg.ok && (cfg.data.fac_view === 'grid' || cfg.data.fac_view === 'cards')) {
        facState.view = cfg.data.fac_view;
      }
    } catch (_) { /* default view */ }
  }
  $('#fac-loading').hidden = false;
  let res;
  let groups = facState.groups;
  try {
    [res, groups] = await Promise.all([
      apiFetch('GET', 'api/factories.php', { params: { action: 'list' } }),
      grpList('factory'),
    ]);
  } catch (e) { res = { ok: false, error: String(e) }; }
  facState.groups = groups || [];
  $('#fac-loading').hidden = true;
  if (!res.ok || !res.data) {
    $('#fac-empty').hidden = false;
    $('#fac-empty').innerHTML = `Couldn't load factories: ${escapeHtml(res.error || 'server error')}`
      + ' — the site may need its update deployed.';
    checkAuthError(res.error);
    return;
  }
  facState.items = res.data.factories || [];
  facState.history = res.data.history || [];
  renderFactories();
  clearInterval(facState.timer);
  facState.timer = setInterval(facTick, 1000);
}

async function facPost(body) {
  try {
    const res = await apiFetch('POST', 'api/factories.php', { data: body });
    if (!res.ok) toast(res.error || 'Factory update failed', false);
    return res;
  } catch (e) { toast(String(e), false); return { ok: false }; }
}

function facSaveSoon(f) {
  clearTimeout(facState.saveTimers[f.id]);
  facState.saveTimers[f.id] = setTimeout(() => facPost({ action: 'save', factory: f }), 600);
}

// ---- desktop notification (runs app-wide, not just on this page) ----------

function facCacheForNotify() {
  const cache = facState.items
    .filter((f) => f.started_at && f.notify_desktop && !f.paused_at)  // paused = no fixed due time
    .map((f) => ({ id: f.id, name: f.name, product: f.product, quantity: f.quantity, due: facDue(f), started_at: f.started_at }));
  try { localStorage.setItem('fac_notify_cache', JSON.stringify(cache)); } catch (_) {}
}

function facNotifySweep() {
  let cache = [];
  try { cache = JSON.parse(localStorage.getItem('fac_notify_cache') || '[]'); } catch (_) {}
  if (!cache.length) return;
  let fired = {};
  try { fired = JSON.parse(localStorage.getItem('fac_notify_fired') || '{}'); } catch (_) {}
  const now = facNow();
  for (const f of cache) {
    const key = `${f.id}:${f.started_at}`; // a restarted run notifies again
    if (now >= f.due && !fired[key]) {
      fired[key] = 1;
      try {
        api().notify(`Factory ${f.name} is done`,
          `${fmtNum(f.quantity)} × ${f.product || 'items'} ready to collect`);
      } catch (_) { /* shell too old */ }
    }
  }
  try { localStorage.setItem('fac_notify_fired', JSON.stringify(fired)); } catch (_) {}
}

// ---- events ---------------------------------------------------------------

function initFactories() {
  setInterval(facNotifySweep, 30000); // app-wide: fires even off-page
  $('[data-refresh="factories"]').addEventListener('click', loadFactories);

  $('#fac-viewtoggle').addEventListener('click', () => {
    facState.view = facState.view === 'grid' ? 'cards' : 'grid';
    try { api().set_config('fac_view', facState.view); } catch (_) {}
    renderFactories();
  });

  $('#fac-tagbar').addEventListener('click', (e) => {
    const t = e.target.closest('[data-factag]');
    if (!t) return;
    facState.tagFilter = facState.tagFilter === t.dataset.factag ? null : t.dataset.factag;
    renderFactories();
  });

  // history combobox: opens on focus, filters as you type, closes on outside click
  $('#fac-list').addEventListener('focusin', (e) => {
    const q = e.target.closest('[data-fachistq]');
    if (q && facState.histOpen !== q.dataset.fachistq) {
      facState.histOpen = q.dataset.fachistq;
      facState.histQuery = q.value || '';
      facState.histType = '';
      facRefreshHistMenu();
    }
  });
  $('#fac-list').addEventListener('input', (e) => {
    const q = e.target.closest('[data-fachistq]');
    if (q) {
      facState.histQuery = q.value;
      facRefreshHistMenu();
    }
  });
  document.addEventListener('click', (e) => {
    if (facState.histOpen && !e.target.closest('.fac-histbox')) {
      facState.histOpen = null;
      document.querySelectorAll('[data-fachistmenu]').forEach((m) => { m.hidden = true; });
    }
  });

  $('#fac-newgroup').addEventListener('click', async () => {
    const res = await grpApi({ action: 'create', kind: 'factory' });
    if (!res.ok || !res.data) { toast(res.error || 'Could not create group — site update pending?', false); return; }
    facState.groups.push({ id: res.data.id, name: res.data.name, sort_order: res.data.sort_order });
    renderFactories();
    grpBeginRename('#fac-list', String(res.data.id), facState.groups[facState.groups.length - 1], renderFactories);
  });

  $('#fac-add').addEventListener('click', async () => {
    const n = facState.items.length + 1;
    const res = await facPost({ action: 'save', factory: { name: `Factory ${n}`, time_unit: 's', notify_desktop: 1 } });
    if (res.ok) loadFactories();
  });

  $('#fac-list').addEventListener('change', (e) => {
    const card = e.target.closest('[data-facid]');
    if (!card) return;
    const f = facState.items.find((x) => String(x.id) === card.dataset.facid);
    if (!f) return;
    const ht = e.target.closest('[data-fachisttype]');
    if (ht) {
      const h = facState.history.find((x) => String(x.id) === ht.dataset.fachisttype);
      if (h) {
        h.run_type = ht.value;
        facPost({ action: 'history_type', id: h.id, run_type: ht.value });
        facRefreshHistMenu(); // chip set may have changed
      }
      return;
    }
    if (e.target.hasAttribute('data-facwp')) {
      const m = e.target.value.trim().match(/-?\d+/g) || [];
      f.x = m.length > 0 ? parseInt(m[0], 10) : null;
      f.y = m.length > 1 ? parseInt(m[1], 10) : null;
      facSaveSoon(f);
      renderFactories();
      return;
    }
    const field = e.target.dataset.facfield;
    if (!field) return;
    f[field] = e.target.type === 'checkbox' ? (e.target.checked ? 1 : 0)
      : field === 'quantity' ? safeInt(e.target.value)
      : field === 'time_value' ? (parseFloat(e.target.value) || 0)
      : field === 'group_id' ? (e.target.value ? Number(e.target.value) : null)
      : e.target.value;
    facSaveSoon(f);
    // change (not input) = a committed edit, so a re-render never fights typing
    if (['time_value', 'time_unit', 'quantity', 'group_id', 'owner', 'tags', 'planet'].includes(field)) renderFactories();
    if (field === 'notify_desktop') facCacheForNotify();
  });

  $('#fac-list').addEventListener('click', async (e) => {
    const wpc = e.target.closest('[data-facwpcopy]');
    if (wpc) {
      const f = facState.items.find((x) => String(x.id) === wpc.dataset.facwpcopy);
      if (f && f.x != null && f.y != null) {
        const cmd = ['/waypoint', String(f.planet || '').toLowerCase(), f.x, f.y, f.name]
          .filter((p) => p !== '').join(' ');
        try {
          await navigator.clipboard.writeText(cmd);
          toast(`Copied — paste in game: ${cmd}`);
        } catch (_) { toast('Clipboard copy failed', false); }
      }
      return;
    }
    const chip = e.target.closest('[data-fachistchip]');
    if (chip) {
      facState.histType = chip.dataset.fachistchip;
      facRefreshHistMenu();
      return;
    }
    const hdel = e.target.closest('[data-fachistdel]');
    if (hdel) {
      const id = safeInt(hdel.dataset.fachistdel);
      facState.history = facState.history.filter((h) => h.id !== id);
      facPost({ action: 'history_remove', id });
      facRefreshHistMenu();
      return;
    }
    if (e.target.closest('.fac-hist-type')) return; // opening the type select ≠ picking the run
    const pick = e.target.closest('[data-fachistpick]');
    if (pick) {
      const h = facState.history.find((x) => String(x.id) === pick.dataset.fachistpick);
      const card = pick.closest('[data-facid]');
      const f = card && facState.items.find((x) => String(x.id) === card.dataset.facid);
      if (h && f) {
        Object.assign(f, { product: h.product, time_value: h.time_value, time_unit: h.time_unit, quantity: h.quantity });
        facState.histOpen = null;
        facPost({ action: 'save', factory: f }).then(() => renderFactories());
      }
      return;
    }
    const det = e.target.closest('[data-facdetails]');
    if (det) {
      const k = det.dataset.facdetails;
      facState.detailsOpen.has(k) ? facState.detailsOpen.delete(k) : facState.detailsOpen.add(k);
      renderFactories();
      return;
    }
    const tog = e.target.closest('[data-grptoggle]');
    if (tog) {
      const k = tog.dataset.grptoggle;
      facState.collapsed.has(k) ? facState.collapsed.delete(k) : facState.collapsed.add(k);
      renderFactories();
      return;
    }
    const ren = e.target.closest('[data-grprename]');
    if (ren) {
      grpBeginRename('#fac-list', ren.dataset.grprename,
        facState.groups.find((g) => String(g.id) === ren.dataset.grprename), renderFactories);
      return;
    }
    const gdel = e.target.closest('[data-grpdel]');
    if (gdel) {
      if (!confirmArmLabeled(gdel, 'Delete group?')) return;
      const gid = safeInt(gdel.dataset.grpdel);
      const res = await grpApi({ action: 'remove', id: gid });
      if (res.ok) {
        facState.groups = facState.groups.filter((g) => g.id !== gid);
        facState.items.forEach((f) => { if (Number(f.group_id) === gid) f.group_id = null; });
        renderFactories();
      }
      return;
    }
    const start = e.target.closest('[data-facstart]');
    if (start) {
      const f = facState.items.find((x) => String(x.id) === start.dataset.facstart);
      if (!f) return;
      if (!(Number(f.time_value) > 0) || !(Number(f.quantity) > 0)) {
        toast('Set the per-unit time and quantity first', false);
        return;
      }
      clearTimeout(facState.saveTimers[f.id]);
      await facPost({ action: 'save', factory: f });   // capture any unsaved edits
      const res = await facPost({ action: 'start', id: f.id });
      if (res.ok) loadFactories();
      return;
    }
    const pause = e.target.closest('[data-facpause]');
    const resume = e.target.closest('[data-facresume]');
    if (pause || resume) {
      const res = await facPost({
        action: pause ? 'pause' : 'resume',
        id: safeInt((pause || resume).dataset.facpause || (pause || resume).dataset.facresume),
      });
      if (res.ok) loadFactories();
      return;
    }
    const done = e.target.closest('[data-facdone]');
    const reset = e.target.closest('[data-facreset]');
    if (done || reset) {
      // both end the run — arm first so a stray click never kills a countdown
      if (done && !confirmArmLabeled(done, 'End run?')) return;
      if (reset && !confirmArmLabeled(reset, 'Reset run?')) return;
      const id = safeInt((done || reset).dataset.facdone || (done || reset).dataset.facreset);
      const res = await facPost({ action: 'stop', id });
      if (res.ok) {
        if (done) toast('Nice haul — run cleared');
        loadFactories();
      }
      return;
    }
    const rm = e.target.closest('[data-facremove]');
    if (rm && confirmArmLabeled(rm, 'Remove?')) {
      const res = await facPost({ action: 'remove', id: safeInt(rm.dataset.facremove) });
      if (res.ok) loadFactories();
    }
  });

  // drag to reorder
  $('#fac-list').addEventListener('dragstart', (e) => {
    const card = e.target.closest('[data-facid]');
    if (card) { facState.dragId = card.dataset.facid; card.classList.add('fac-dragging'); }
  });
  $('#fac-list').addEventListener('dragover', (e) => {
    e.preventDefault();
    const dragging = document.querySelector('.fac-dragging');
    if (!dragging) return;
    const over = e.target.closest('[data-facid]');
    if (over && over !== dragging) {
      const rect = over.getBoundingClientRect();
      over.parentNode.insertBefore(dragging, e.clientY < rect.top + rect.height / 2 ? over : over.nextSibling);
      return;
    }
    // hovering a group's empty space (or an empty group) → drop at its end;
    // hovering the section HEADER files into that section too
    const hd = e.target.closest('[data-grpkey]');
    if (hd && hd.tagName === 'TR') {  // grid view divider row → land right under it
      hd.parentNode.insertBefore(dragging, hd.nextSibling);
      return;
    }
    const cont = hd
      ? document.querySelector(`#fac-list [data-facgroup="${hd.dataset.grpkey}"]`)
      : e.target.closest('[data-facgroup]');
    if (cont && dragging.parentNode !== cont) cont.appendChild(dragging);
  });
  $('#fac-list').addEventListener('dragend', async () => {
    const dragging = document.querySelector('.fac-dragging');
    dragging?.classList.remove('fac-dragging');
    // dropped inside a different group's section → the card adopts that group
    if (dragging) {
      const f = facState.items.find((x) => String(x.id) === dragging.dataset.facid);
      const cont = dragging.closest('[data-facgroup]');
      let key = cont ? cont.dataset.facgroup : null;
      if (!key && dragging.tagName === 'TR') {  // grid view: section = nearest divider above
        let p = dragging.previousElementSibling;
        while (p && !p.classList.contains('grp-row')) p = p.previousElementSibling;
        key = p ? p.dataset.grpkey : 'un';
      }
      if (f && key) {
        const gid = key === 'un' ? null : safeInt(key);
        if ((f.group_id || null) !== gid) {
          f.group_id = gid;
          await facPost({ action: 'save', factory: f });
        }
      }
    }
    const ids = [...document.querySelectorAll('#fac-list [data-facid]')].map((c) => safeInt(c.dataset.facid));
    facState.items.sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));
    await facPost({ action: 'reorder', ids });
    renderFactories(); // snap into the (possibly new) section cleanly
  });
}
