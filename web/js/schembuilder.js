/* Schematic Builder — community-submitted schematics (api/user_schematics.php).
   Drafts save server-side (auto-saved as you type, resumable from any machine);
   Submit publishes immediately as an UNVERIFIED schematic that other app users
   confirm in-app (3 confirmations = verified). Requested by the community after
   the missing-schematics thread. */

const sbState = {
  drafts: [],
  cur: null,          // {id, status, body} — body is the working object
  dirty: false,
  saveTimer: null,
  classNodes: [],     // [{code, desc, depth}] from fetchCategoryNodes
  classByDesc: new Map(),
  cats: [],           // [{category_id, description, parent}]
  verifyVotes: 3,
  compSearchTimer: null,
};

const sbEmptyBody = () => ({
  name: '', description: '', category_id: 0, quality: 'std', size: 1,
  type: 'Learned', crate_size: 100, manufactured: true, // manufacturable → factory crates of 100 by default
  resources: [], formulas: [], components: [],
});

const SB_STATS = ['OQ', 'CR', 'CD', 'DR', 'HR', 'MA', 'SR', 'UT', 'FL', 'PE'];

// ---- data ----

async function sbLoadMeta() {
  if (sbState.cats.length) return;
  try {
    const res = await apiFetch('GET', 'api/user_schematics.php', { params: { action: 'meta' } });
    if (res.ok && res.data) {
      sbState.cats = res.data.categories || [];
      sbState.verifyVotes = safeInt(res.data.verify_votes) || 3;
      sbState.compCats = res.data.component_categories || []; // game category slots ("Armor Core")
    }
  } catch (_) { /* the editor shows a deploy hint instead */ }
  if (!sbState.classNodes.length && typeof fetchCategoryNodes === 'function') {
    const nodes = await fetchCategoryNodes(true);
    if (nodes) {
      sbState.classNodes = nodes;
      nodes.forEach((n) => sbState.classByDesc.set(n.desc.toLowerCase(), n));
    }
  }
}

async function sbLoadDrafts() {
  try {
    const res = await apiFetch('GET', 'api/user_schematics.php');
    sbState.drafts = (res.ok && res.data && res.data.drafts) || [];
    if (!res.ok) {
      $('#sb-list-empty').textContent = 'Community schematics need the site update — deploy api/user_schematics.php and refresh.';
      $('#sb-list-empty').hidden = false;
    }
  } catch (_) { sbState.drafts = []; }
  sbRenderList();
}

function sbMarkDirty() {
  sbState.dirty = true;
  $('#sb-savestate').textContent = 'saving…';
  clearTimeout(sbState.saveTimer);
  sbState.saveTimer = setTimeout(sbSave, 900);
  sbRenderProgress();
}

// readiness: mirrors the server's submit validation so the bar hits 100%
// exactly when Submit will succeed (name uniqueness is the server's call)
function sbChecks(body) {
  const b = body || sbState.cur?.body || {};
  const res = b.resources || [];
  const forms = b.formulas || [];
  const comps = b.components || [];
  // labels are TO-DOs: the bar shows the first unmet one as "next: …"
  const checks = [
    { label: 'enter the schematic name', ok: !!(b.name || '').trim() },
    ...(sbState.nameTaken && (b.name || '').trim().toLowerCase() === sbState.nameTaken
      ? [{ label: `pick a different name — "${b.name.trim()}" already exists`, ok: false }] : []),
    { label: 'pick a category', ok: safeInt(b.category_id) > 0 },
    { label: 'add at least one resource slot or component', ok: res.length + comps.length > 0 },
    { label: 'attach at least one proof screenshot of the in-game schematic',
      ok: Array.isArray(b.screenshots) && b.screenshots.length > 0 },
  ];
  if (res.length) {
    checks.push({ label: 'give every resource slot a label, class and units',
      ok: res.every((r) => (r.desc || '').trim() && (r.code || '').trim() && safeInt(r.units) > 0) });
  }
  if (forms.length) {
    // 99 counts as complete: the game's thirds formulas (33/33/33, 66/33) never reach 100
    checks.push({ label: 'name every experimentation line and bring each to 100% (99 for thirds like 33/33/33)',
      ok: forms.every((f) => {
        const t = SB_STATS.reduce((a, s) => a + safeInt((f.weights || {})[s]), 0);
        return (f.name || '').trim() && (t === 100 || t === 99);
      }) });
  }
  if (comps.length) {
    // a draft-linked component is fine once THAT draft has been published —
    // the server swaps the link to the real schematic at submit time
    const published = (id) => sbState.drafts.some((d) => safeInt(d.id) === safeInt(id) && d.status === 'published');
    checks.push({ label: 'give every component a name and quantity (and submit linked drafts)',
      ok: comps.every((c) => (c.desc || '').trim() && safeInt(c.number) > 0 && (!c.draft_id || published(c.draft_id))) });
  }
  return checks;
}

function sbRenderProgress() {
  const bar = $('#sb-progress');
  if (!sbState.cur || sbState.cur.status === 'published') { bar.hidden = true; return; }
  bar.hidden = false;
  const checks = sbChecks();
  const done = checks.filter((c) => c.ok).length;
  const pct = Math.round(done / checks.length * 100);
  $('#sb-progfill').style.width = `${pct}%`;
  $('#sb-progfill').classList.toggle('ready', pct === 100);
  $('#sb-proglabel').textContent = pct === 100
    ? 'Ready to submit'
    : `${done} of ${checks.length} done — next: ${checks.find((c) => !c.ok).label}`;
  bar.title = checks.map((c) => `${c.ok ? '✓ done —' : '✗ to do —'} ${c.label}`).join('\n');
}

async function sbSave() {
  const c = sbState.cur;
  if (!c || c.status === 'published') return;
  sbState.dirty = false;
  let res;
  try {
    res = await apiFetch('POST', 'api/user_schematics.php',
      { data: { action: 'save', draft: { id: c.id || 0, body: c.body, parent_draft_id: c.parent_draft_id || 0 } } });
  } catch (e) { res = { ok: false, error: String(e) }; }
  if (res.ok && res.data) {
    c.id = safeInt(res.data.id) || c.id;
    $('#sb-savestate').textContent = 'draft saved';
  } else {
    $('#sb-savestate').textContent = 'save failed';
    toast(res.error || 'Saving the draft failed', false);
  }
}

// ---- list view ----

function sbShowView(view) {
  $('#sb-list-view').hidden = view !== 'list';
  $('#sb-edit-view').hidden = view !== 'edit';
}

function sbStatusChip(d) {
  if (d.status === 'published') return '<span class="sb-chip sb-chip-pub">published</span>';
  return '<span class="sb-chip">draft</span>';
}

function sbRenderList() {
  $('#sb-drafts').innerHTML = sbState.drafts.map((d) => {
    let prog = '';
    if (d.status !== 'published' && d.body) {
      const checks = sbChecks(d.body);
      const done = checks.filter((c) => c.ok).length;
      const pct = Math.round(done / checks.length * 100);
      prog = `<span class="sb-draftprog" title="${escapeHtml(checks.map((c) => `${c.ok ? '✓ done —' : '✗ to do —'} ${c.label}`).join('\n'))}">
        <span class="sb-progtrack sb-progtrack-mini"><span class="sb-progfill${pct === 100 ? ' ready' : ''}" style="width:${pct}%"></span></span>
        ${pct === 100 ? 'ready' : `${done}/${checks.length}`}</span>`;
    }
    return `
    <div class="sb-draftrow" data-sbopen="${d.id}">
      <div class="sb-draftmain">
        <b>${escapeHtml(d.name || 'Untitled schematic')}</b>
        ${sbStatusChip(d)}
        ${d.parent_draft_id ? '<span class="sb-chip">subcomponent</span>' : ''}
      </div>
      ${prog}
      <span class="sb-draftage">${fmtAgoTip(safeInt(d.updated))}</span>
      ${d.status === 'published'
        ? `<button class="btn btn-icon" data-sbview="${escapeHtml(String(d.schematic_id))}" title="Open the published schematic"><i class="fa-solid fa-scroll"></i></button>`
        : ''}
      <button class="btn btn-icon" data-sbdup="${d.id}" title="Duplicate — start a new draft from a copy (great for armor sets and other near-identical pieces; proof screenshots aren't copied)"><i class="fa-solid fa-clone"></i></button>
      <button class="btn btn-icon" data-sbdel="${d.id}" title="Delete this draft"><i class="fa-solid fa-trash-can"></i></button>
    </div>`;
  }).join('');
  const empty = $('#sb-list-empty');
  if (sbState.drafts.length) { empty.hidden = true; }
  else if (!empty.textContent.includes('deploy')) {
    empty.textContent = 'No drafts yet — click New Schematic and start filling in a missing one. Drafts save as you type; come back any time.';
    empty.hidden = false;
  }
}

// ---- editor ----

async function sbOpenDraft(id) {
  let cur = null;
  if (id) {
    const res = await apiFetch('GET', 'api/user_schematics.php', { params: { id } })
      .catch((e) => ({ ok: false, error: String(e) }));
    if (!res.ok || !res.data?.draft) { toast(res.error || 'Draft not found', false); return; }
    const d = res.data.draft;
    cur = { id: safeInt(d.id), status: d.status, parent_draft_id: safeInt(d.parent_draft_id) || null,
      schematic_id: safeInt(d.schematic_id) || null, body: { ...sbEmptyBody(), ...(d.body || {}) } };
  } else {
    cur = { id: 0, status: 'draft', parent_draft_id: null, schematic_id: null, body: sbEmptyBody() };
  }
  sbState.cur = cur;
  sbShowView('edit');
  sbRenderEditor();
}

function sbCatOptions(sel) {
  const byParent = {};
  sbState.cats.forEach((c) => { (byParent[c.parent] = byParent[c.parent] || []).push(c); });
  return '<option value="">Pick a category…</option>' + Object.keys(byParent).sort().map((p) =>
    `<optgroup label="${escapeHtml(p)}">${byParent[p].map((c) =>
      `<option value="${c.category_id}"${safeInt(sel) === safeInt(c.category_id) ? ' selected' : ''}>${escapeHtml(c.description)}</option>`).join('')}</optgroup>`).join('');
}

function sbRenderEditor() {
  const c = sbState.cur;
  const b = c.body;
  const locked = c.status === 'published';
  $('#sb-edit-title').textContent = b.name || 'New schematic';
  $('#sb-savestate').textContent = locked ? 'published — read-only' : (c.id ? 'draft saved' : 'not saved yet');
  $('#sb-submit').hidden = locked;
  $('#sb-verify-note').hidden = !locked;
  if (locked) {
    $('#sb-verify-note').innerHTML = `Published as an unverified schematic — it becomes fully verified once ${sbState.verifyVotes} other app users confirm it.`;
  }
  $('#sb-f-name').value = b.name || '';
  $('#sb-f-category').innerHTML = sbCatOptions(b.category_id);
  $('#sb-f-desc').value = b.description || '';
  $('#sb-f-quality').value = b.quality || 'std';
  $('#sb-f-size').value = b.size || 1;
  $('#sb-f-type').value = b.type || 'Learned';
  $('#sb-f-crate').value = b.crate_size || 0;
  $('#sb-f-manuf').checked = b.manufactured !== false && b.manufactured !== 'no';
  sbRenderResources();
  sbRenderFormulas();
  sbRenderComponents();
  sbRenderModelPick();
  sbRenderShots();
  sbRenderProgress();
  // buttons included: the class-picker combobox and row-delete ✕s are
  // <button>s and must lock down with everything else on published drafts
  document.querySelectorAll('#sb-edit-view input, #sb-edit-view select, #sb-edit-view textarea, #sb-edit-view button')
    .forEach((el) => { el.disabled = locked && el.id !== 'sb-back'; });
}

function sbRenderResources() {
  const b = sbState.cur.body;
  $('#sb-resources').innerHTML = (b.resources || []).map((r, i) => `
    <div class="sb-row" data-sbres="${i}">
      <input class="form-control filter-input sb-desc" data-rf="desc" value="${escapeHtml(r.desc || '')}" placeholder="Slot label (e.g. 1st Mash)" spellcheck="false">
      <input class="form-control filter-input sb-units" data-rf="units" type="number" min="1" value="${safeInt(r.units) || ''}" placeholder="units" title="How many units this slot takes">
      <span class="sb-of">of</span>
      <div class="cselect sb-classsel" data-rclass="${i}">
        <button type="button" class="cselect-btn" title="${r.code ? `class code: ${escapeHtml(r.code)}` : 'Pick the resource class'}">
          <span class="${r.code ? '' : 'stat_off'}">${escapeHtml(r.resourceName || 'Pick resource class…')}</span><i class="fa-solid fa-caret-down"></i>
        </button>
        <!-- own class ONLY: borrowing .al-class-menu made the alerts page's
             click-away closer grab this menu and shut it on every click -->
        <div class="cselect-menu sb-class-menu" hidden>
          <div class="cselect-search"><input type="text" class="form-control filter-input sb-classfilter"
               placeholder="Type to filter — e.g. gravitonic" autocomplete="off" spellcheck="false"></div>
          <div class="sb-classopts"></div>
        </div>
      </div>
      <button class="btn btn-icon" data-rdel="${i}" title="Remove slot"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('');
}

function sbRenderClassOpts(box, query = '') {
  const q = query.trim().toLowerCase();
  const rows = q
    ? sbState.classNodes.filter((n) => n.desc.toLowerCase().includes(q)).slice(0, 200)
    : sbState.classNodes;
  box.innerHTML = rows.map((n) =>
    `<div class="mysd-opt sb-classopt" data-code="${escapeHtml(n.code)}" data-desc="${escapeHtml(n.desc)}">${q ? '' : '&nbsp; '.repeat(n.depth)}${escapeHtml(n.desc)}</div>`
  ).join('') || '<div class="mysd-opt-none">No classes match.</div>';
}

function sbCloseClassMenus() {
  document.querySelectorAll('.sb-classsel .cselect-menu').forEach((m) => { m.hidden = true; });
}

function sbRenderFormulas() {
  const b = sbState.cur.body;
  $('#sb-formulas').innerHTML = (b.formulas || []).map((f, i) => {
    const w = f.weights || {};
    const total = SB_STATS.reduce((a, s) => a + safeInt(w[s]), 0);
    return `<div class="sb-frow" data-sbform="${i}">
      <div class="sb-row">
        <input class="form-control filter-input sb-fname" data-ff="name" value="${escapeHtml(f.name || '')}"
               placeholder="Line name (e.g. Experimental Flavor)" spellcheck="false">
        <span class="sb-ftotal ${total === 100 || total === 99 ? 'ok' : 'bad'}" title="Weights must total 100% — or 99% for the game's thirds formulas (33/33/33, 66/33)">${total}%</span>
        <button class="btn btn-icon" data-fdel="${i}" title="Remove line"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="sb-stats">${SB_STATS.map((s) => `
        <label class="sb-stat"><span>${s}</span>
          <input type="number" min="0" max="100" data-fw="${s}" value="${safeInt(w[s]) || ''}"></label>`).join('')}
      </div>
    </div>`;
  }).join('');
}

function sbRenderComponents() {
  const b = sbState.cur.body;
  $('#sb-components').innerHTML = (b.components || []).map((cp, i) => `
    <div class="sb-comprow" data-sbcomp="${i}">
      <div class="sb-row">
        <span class="sb-complink">${cp.schematic_id
          ? `<i class="fa-solid fa-scroll" title="Linked to schematic #${cp.schematic_id}"></i>`
          : cp.category_id
            ? '<i class="fa-solid fa-layer-group" title="Category slot — any matching schematic fits"></i>'
            : cp.draft_id
              ? '<i class="fa-solid fa-pen-ruler" title="Linked to one of your drafts — submit it before this one"></i>'
              : '<i class="fa-solid fa-box-open stat_off" title="Looted / unlinked component"></i>'}</span>
        <input class="form-control filter-input sb-units" data-cf="number" type="number" min="1" value="${safeInt(cp.number) || ''}" placeholder="qty" title="How many of this component the schematic takes">
        <span class="sb-of">×</span>
        <input class="form-control filter-input sb-desc" data-cf="desc" value="${escapeHtml(cp.desc || '')}"
               placeholder="Component name — type to search schematics" spellcheck="false" autocomplete="off">
        <label class="sb-flag" title="Similar components accepted"><input type="checkbox" data-cf="similar" ${cp.similar ? 'checked' : ''}>sim</label>
        <label class="sb-flag" title="Optional slot"><input type="checkbox" data-cf="optional" ${cp.optional ? 'checked' : ''}>opt</label>
        <label class="sb-flag" title="Looted item, not crafted"><input type="checkbox" data-cf="looted" ${cp.looted ? 'checked' : ''}>loot</label>
        <button class="btn btn-icon" data-cdel="${i}" title="Remove component"><i class="fa-solid fa-xmark"></i></button>
      </div>
      <div class="sb-compsearch mysd-opts" data-cres="${i}" hidden></div>
    </div>`).join('');
}

// ---- appearance: associate an existing item's 3D model ----------------------
// Searches only items that HAVE models (schState.modelIds via schematics.js);
// publishing symlinks the donor's .glb at this schematic's id server-side.

function sbRenderModelPick() {
  const b = sbState.cur?.body || {};
  const prev = $('#sb-model-preview');
  $('#sb-model-clear').hidden = !b.model_from;
  if (!b.model_from) {
    prev.hidden = true;
    prev.innerHTML = '';
    $('#sb-model-search').value = '';
    return;
  }
  $('#sb-model-search').value = b.model_from_name || `#${b.model_from}`;
  if (typeof schEnsureModelLib === 'function') schEnsureModelLib();
  prev.hidden = false;
  prev.innerHTML = `<swg-creature src="https://swgtracker.com/items/${safeInt(b.model_from)}.glb"
    no-picker auto-rotate fit="0.92"></swg-creature>`;
}

async function sbModelSearch(q) {
  const box = $('#sb-model-results');
  if (!q || q.length < 2) { box.hidden = true; return; }
  if (typeof schLoadModelIds === 'function' && !schState.modelIds) await schLoadModelIds();
  let res;
  try { res = await api().search_schematics({ search: q, page: 1 }); }
  catch (_) { res = null; }
  const rows = ((res && res.ok && res.data && res.data.results) || [])
    .filter((s) => schState.modelIds?.has(String(s.id))).slice(0, 6);
  if (typeof schEnsureModelLib === 'function' && rows.length) schEnsureModelLib();
  // every suggestion carries its own mini spinning model — no blind picks
  box.innerHTML = rows.length ? rows.map((s) =>
    `<div class="mysd-opt sb-modelopt" data-modelpick="${s.id}" data-name="${escapeHtml(s.name)}">
       <swg-creature class="sb-model-thumb" src="https://swgtracker.com/items/${s.id}.glb"
         no-picker auto-rotate fit="0.92"></swg-creature>
       <span class="sb-modelopt-name">${escapeHtml(s.name)}</span>
       <span class="mysd-opt-meta">${escapeHtml(s.parent || '')}</span></div>`).join('')
    : '<div class="mysd-opt-none">No modeled items match — leave it blank, a model can be exported later.</div>';
  box.hidden = false;
}

// ---- proof screenshots (required for submit; reviewers verify from these) ----

function sbRenderShots() {
  const shots = sbState.cur?.body?.screenshots || [];
  $('#sb-shots').innerHTML = shots.map((u) => `
    <span class="sb-shot">
      <img src="https://swgtracker.com${escapeHtml(u)}" loading="lazy" data-shotview="${escapeHtml(u)}" title="Click to view full size">
      <button class="btn btn-icon sb-shot-x" data-shotdel="${escapeHtml(u)}" title="Remove"><i class="fa-solid fa-xmark"></i></button>
    </span>`).join('');
}

// downscale to ≤1600px JPEG client-side — game screenshots are huge and the
// server caps uploads at 8MB
function sbShrinkImage(file) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, 1600 / Math.max(img.width, img.height));
      const cv = document.createElement('canvas');
      cv.width = Math.round(img.width * scale);
      cv.height = Math.round(img.height * scale);
      cv.getContext('2d').drawImage(img, 0, 0, cv.width, cv.height);
      resolve(cv.toDataURL('image/jpeg', 0.85));
      URL.revokeObjectURL(img.src);
    };
    img.onerror = () => reject(new Error('unreadable image'));
    img.src = URL.createObjectURL(file);
  });
}

async function sbUploadShots(files) {
  const c = sbState.cur;
  if (!c) return;
  if (!c.id) await sbSave(); // the upload needs a draft id
  for (const f of files) {
    let dataUrl;
    try { dataUrl = await sbShrinkImage(f); }
    catch (_) { toast(`${f.name} isn't a readable image`, false); continue; }
    let res;
    try {
      res = await apiFetch('POST', 'api/user_schematics.php',
        { data: { action: 'shot_add', id: c.id, image: dataUrl } });
    } catch (e) { res = { ok: false, error: String(e) }; }
    if (!res.ok) { toast(res.error || `Uploading ${f.name} failed`, false); continue; }
    c.body.screenshots = res.data.screenshots || [];
  }
  sbRenderShots();
  sbRenderProgress();
}

// proof-screenshot viewer used by both the builder and the verify bar.
// Floating windows, not a modal lightbox (snickerfritz): drag by the title
// bar, resize by the corner, open as many as you need — so a reviewer can
// park the recipe shots NEXT TO the schematic details and compare directly.
let sbShotWinCount = 0;
let sbShotZ = 900;
function sbShotRaise(win) { win.style.zIndex = String(++sbShotZ); }
function sbShowShot(url) {
  // clicking the same shot again just brings its window forward
  const existing = [...document.querySelectorAll('.sb-shotwin')].find((w) => w.dataset.shot === url);
  if (existing) { sbShotRaise(existing); return; }
  const win = document.createElement('div');
  win.className = 'sb-shotwin';
  win.dataset.shot = url;
  const n = sbShotWinCount++;
  win.style.right = `${24 + (n % 3) * 36}px`;
  win.style.top = `${72 + (n % 3) * 36}px`;
  win.innerHTML = `
    <div class="sb-shotwin-bar"><i class="fa-solid fa-image"></i> Proof screenshot
      <span class="sb-shotwin-hint">drag to move · corner to resize</span>
      <button class="btn btn-icon" data-shotext title="Open in your browser — a real window you can drag to another monitor"><i class="fa-solid fa-arrow-up-right-from-square"></i></button>
      <button class="btn btn-icon" data-shotclose title="Close (Esc closes the front one)"><i class="fa-solid fa-xmark"></i></button></div>
    <div class="sb-shotwin-body"><img src="https://swgtracker.com${escapeHtml(url)}"></div>`;
  win.addEventListener('pointerdown', () => sbShotRaise(win));
  win.querySelector('[data-shotclose]').addEventListener('click', () => win.remove());
  win.querySelector('[data-shotext]').addEventListener('click', () => {
    try { api().open_external(`https://swgtracker.com${url}`); } catch (_) { /* bridge missing — button just no-ops */ }
  });
  const bar = win.querySelector('.sb-shotwin-bar');
  bar.addEventListener('pointerdown', (e) => {
    if (e.target.closest('[data-shotclose]')) return;
    const r = win.getBoundingClientRect();
    win.style.left = `${r.left}px`; win.style.top = `${r.top}px`; win.style.right = 'auto';
    const dx = e.clientX - r.left, dy = e.clientY - r.top;
    const move = (ev) => {
      win.style.left = `${Math.max(0, Math.min(window.innerWidth - 80, ev.clientX - dx))}px`;
      win.style.top = `${Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - dy))}px`;
    };
    const up = () => { document.removeEventListener('pointermove', move); document.removeEventListener('pointerup', up); };
    document.addEventListener('pointermove', move);
    document.addEventListener('pointerup', up);
    e.preventDefault();
  });
  document.body.appendChild(win);
  sbShotRaise(win);
}

// component name search — link an existing schematic, or spawn a child draft
async function sbCompSearch(idx, q) {
  const box = document.querySelector(`[data-cres="${idx}"]`);
  if (!box) return;
  if (!q || q.length < 2) { box.hidden = true; return; }
  // anchor the panel under the name input (qty sits left of it now)
  const inp = box.closest('.sb-comprow')?.querySelector('[data-cf="desc"]');
  if (inp) {
    box.style.left = `${inp.offsetLeft}px`;
    box.style.width = `${inp.offsetWidth}px`;
  }
  let res;
  try { res = await api().search_schematics({ search: q, page: 1 }); }
  catch (_) { res = null; }
  // your own drafts lead the list: an in-progress subcomponent is linkable
  // right away (submit stays blocked until IT is submitted); a published one
  // links straight to its schematic
  const ql = q.toLowerCase();
  const mine = sbState.drafts.filter((d) =>
    d.id !== sbState.cur?.id && (d.name || '').toLowerCase().includes(ql)).slice(0, 5);
  const mineHtml = mine.map((d) => d.status === 'published'
    ? `<div class="mysd-opt" data-clink="${d.schematic_id}" data-cname="${escapeHtml(d.name)}">${escapeHtml(d.name)}
         <span class="mysd-opt-meta sb-mine-meta">yours — published</span></div>`
    : `<div class="mysd-opt" data-cdraft="${d.id}" data-cname="${escapeHtml(d.name)}"
         title="Link your in-progress draft — this schematic can't be submitted until that one is">${escapeHtml(d.name)}
         <span class="mysd-opt-meta sb-mine-meta"><i class="fa-solid fa-pen-ruler"></i> your draft — in progress</span></div>`).join('');
  const mineNames = new Set(mine.map((d) => (d.name || '').toLowerCase()));
  const rows = ((res && res.ok && res.data && (res.data.results || res.data.schematics)) || [])
    .filter((s) => !mineNames.has((s.name || '').toLowerCase())).slice(0, 8);
  // real game category slots ("Armor Core — any matching schematic fits"),
  // aggregated server-side from existing schematics. The game reuses one
  // display name across DIFFERENT ids with different contents (battle vs
  // assault vs recon cores) — so entries stay separate, each showing its
  // matching schematics, and only true duplicates (same name AND contents)
  // collapse. Match on the category name OR anything inside it.
  const ccatSeen = new Set();
  const ccats = (sbState.compCats || []).filter((cc) => {
    if (!safeInt(cc.n)) return false;
    const pv = (cc.preview || []).join(', ');
    const key = `${cc.name}|${pv}`;
    if (ccatSeen.has(key)) return false;
    if (!(cc.name || '').toLowerCase().includes(ql) && !pv.toLowerCase().includes(ql)) return false;
    ccatSeen.add(key);
    return true;
  }).slice(0, 5);
  const ccatHtml = ccats.map((cc) => {
    const pv = (cc.preview || []).join(', ') + (cc.n > (cc.preview || []).length ? ', …' : '');
    return `<div class="mysd-opt sb-ccat-opt" data-ccat="${cc.id}" data-cname="${escapeHtml(cc.name)}"
       title="A category slot — the crafter can use ANY of its ${cc.n} matching schematics: ${escapeHtml(pv)}">
       <span class="sb-ccat-name"><i class="fa-solid fa-layer-group"></i> ${escapeHtml(cc.name)}</span>
       <span class="mysd-opt-meta sb-ccat-preview">${escapeHtml(pv)}</span></div>`;
  }).join('');
  box.innerHTML = ccatHtml + mineHtml + rows.map((s) =>
    `<div class="mysd-opt" data-clink="${s.id}" data-cname="${escapeHtml(s.name)}">${escapeHtml(s.name)}
       <span class="mysd-opt-meta">${escapeHtml(s.parent || '')}</span></div>`).join('')
    + `<div class="mysd-opt sb-newcomp" data-cnew="${idx}"><i class="fa-solid fa-plus"></i> Not in the system — create “${escapeHtml(q)}” as a new draft</div>`;
  box.hidden = false;
}

// create a linked subcomponent draft and jump into it (parent saves first)
async function sbSpawnChild(idx, name) {
  const parent = sbState.cur;
  parent.body.components[idx].desc = name;
  await sbSave();
  let res;
  try {
    res = await apiFetch('POST', 'api/user_schematics.php',
      { data: { action: 'save', draft: { id: 0, parent_draft_id: parent.id, body: { ...sbEmptyBody(), name } } } });
  } catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) { toast(res.error || 'Creating the subcomponent draft failed', false); return; }
  parent.body.components[idx].draft_id = safeInt(res.data.id);
  delete parent.body.components[idx].schematic_id;
  await sbSave();
  toast(`Subcomponent draft created — build it, submit it, then come back to ${parent.body.name || 'the parent'}`);
  await sbLoadDrafts();
  sbOpenDraft(safeInt(res.data.id));
}

async function sbSubmit() {
  const c = sbState.cur;
  if (!c || !c.id) { toast('Nothing to submit yet', false); return; }
  if (sbState.dirty) await sbSave();
  $('#sb-errors').hidden = true;
  let res;
  try { res = await apiFetch('POST', 'api/user_schematics.php', { data: { action: 'submit', id: c.id } }); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (res.ok && res.data?.status === 'published') {
    c.status = 'published';
    c.schematic_id = safeInt(res.data.schematic_id);
    toast(`Published! It's live as an unverified schematic — ${sbState.verifyVotes} confirmations make it official`);
    sbRenderEditor();
    sbLoadDrafts();
    return;
  }
  const errs = res.data?.errors || (res.error ? [res.error] : ['Submit failed']);
  $('#sb-errors').innerHTML = '<b>Not quite ready:</b><ul>' + errs.map((e) => `<li>${escapeHtml(e)}</li>`).join('') + '</ul>';
  $('#sb-errors').hidden = false;
  $('#sb-errors').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

// ---- verification bar on the schematic detail page ----
// schematics.js calls this after rendering a detail payload; community
// schematics get the unverified/verified badge and the Confirm button.

async function sbRenderVerifyBar(schematicId, isCommunity) {
  const bar = $('#scd-community');
  if (!bar) return;
  bar.hidden = true;
  if (!isCommunity) return;
  let res;
  try {
    res = await apiFetch('GET', 'api/user_schematics.php',
      { params: { action: 'status', schematic_id: schematicId } });
  } catch (_) { return; }
  const st = res.ok && res.data;
  if (!st || !st.community) return;
  bar.dataset.sid = String(schematicId);
  if (st.verified) {
    bar.innerHTML = `<div class="sb-vb-info">
        <div class="sb-vb-title"><i class="fa-solid fa-circle-check"></i> Community schematic
          <span class="sb-vb-chip ok">verified</span></div>
        <div class="sb-vb-sub">confirmed accurate by fellow crafters${st.submitter ? ` · submitted by ${escapeHtml(st.submitter)}` : ''}</div>
      </div>`;
    bar.className = 'sb-verifybar sb-verified scd-community-full';
  } else {
    // no tracking an unvetted recipe — Add to My Schematics unlocks at verified
    const mys = $('#scd-mys');
    if (mys) {
      mys.hidden = true;
    }
    bar.className = 'sb-verifybar scd-community-full'; // keep the full-width/margin class
    // hoverable zoom affordance on each proof thumb — clearly clickable
    const shots = (st.screenshots || []).map((u) =>
      `<span class="sb-shotthumb" data-shotview="${escapeHtml(u)}"
            title="In-game proof — click to open in a movable window and compare side-by-side">
         <img src="https://swgtracker.com${escapeHtml(u)}" loading="lazy">
         <i class="fa-solid fa-magnifying-glass-plus"></i></span>`).join('');
    // three fixed columns — shots | two-line info | actions (never wrap) —
    // with the flag form/notes as full-width rows underneath
    const state = st.mine ? '' // "yours" lives in the sub-line, not a chip
      : st.voted ? '<span class="sb-vb-state ok"><i class="fa-solid fa-check"></i> confirmed by you</span>' : '';
    const actions = state + (st.mine
      ? `<button id="scd-retract" class="btn btn-sm btn-outline-secondary" data-sid="${schematicId}"
            title="Pull it back — it leaves the site and search everywhere, and your draft (if kept) reopens for editing"><i class="fa-solid fa-rotate-left"></i> Retract</button>`
      : st.voted ? `<button id="scd-unconfirm" class="btn btn-sm btn-outline-secondary"
              title="Take back your confirmation — only possible while it's still unverified"><i class="fa-solid fa-rotate-left"></i> Undo</button>`
      : `<button id="scd-confirm" class="btn btn-sm btn-outline-secondary"
             title="Check the proof screenshots against the details below, then confirm."><i class="fa-solid fa-check"></i> Confirm accurate</button>`)
      + (!st.mine && !st.flagged ? `<button id="scd-flag" class="btn btn-sm btn-outline-secondary"
             title="Something's wrong with this schematic? Flag it and say what needs fixing — the submitter sees your note."><i class="fa-solid fa-flag"></i> Flag as incorrect</button>`
        : '');
    bar.innerHTML = `${shots ? `<div class="sb-vb-shots">${shots}</div>` : ''}
      <div class="sb-vb-info">
        <div class="sb-vb-title"><i class="fa-solid fa-users"></i> Community schematic
          <span class="sb-vb-chip" title="Unconfirmed schematics return to draft after 30 days, ready to fix and resubmit">unverified</span></div>
        <div class="sb-vb-sub">${st.votes} of ${st.needed} confirmations · 30 days to verify${st.mine
          ? ' · yours — others must confirm it'
          : st.submitter ? ` · submitted by ${escapeHtml(st.submitter)}` : ''}</div>
      </div>
      <div class="sb-vb-actions">${actions}</div>
      <div id="scd-flagform" class="sb-flagform" hidden>
        <input id="scd-flag-note" class="filter-input" maxlength="500"
          placeholder="What needs fixing? e.g. Reactive Gas should be 45 units, not 40">
        <button id="scd-flag-send" class="btn btn-sm btn-outline-secondary"><i class="fa-solid fa-flag"></i> Flag it</button>
        <button id="scd-flag-cancel" class="btn btn-sm btn-outline-secondary">Cancel</button>
      </div>
      ${(st.flags || []).length ? `<div class="sb-flaglist">
          ${st.flags.map((f) => `<div class="sb-flagrow"><i class="fa-solid fa-flag"></i>
            <span>${escapeHtml(f.note)}</span> <span class="stat_off">— ${escapeHtml(f.by)}</span></div>`).join('')}
          ${st.mine ? '<div class="sb-flaghint stat_off">Reviewers flagged issues — retract, fix them in your draft, and resubmit.</div>' : ''}
        </div>` : ''}`;
  }
  bar.hidden = false;
}

// ---- wiring ----

async function loadSchemBuilder() {
  await sbLoadMeta();
  await sbLoadDrafts();
  if (!sbState.cur) sbShowView('list');
}

function initSchemBuilder() {
  $('#schem-builder-btn').addEventListener('click', () => showPage('schembuilder'));

  // Confirm-accurate vote on the schematic detail page (+ proof viewer + retract)
  $('#scd-community').addEventListener('click', async (e) => {
    const shot = e.target.closest('[data-shotview]');
    if (shot) { sbShowShot(shot.dataset.shotview); return; }
    const retract = e.target.closest('#scd-retract');
    if (retract) {
      if (!confirmArm(retract, 'Click again to retract this schematic')) return;
      let res;
      try { res = await apiFetch('POST', 'api/user_schematics.php', { data: { action: 'retract', schematic_id: safeInt(retract.dataset.sid) } }); }
      catch (err) { res = { ok: false, error: String(err) }; }
      if (!res.ok) { toast(res.error || 'Retracting failed', false); return; }
      toast('Retracted — it\'s gone from the site and search; your draft (if kept) is editable again');
      showPage('schematics');
      loadSchematics();
      return;
    }
    if (e.target.closest('#scd-unconfirm')) {
      const sid = safeInt($('#scd-community').dataset.sid);
      let res;
      try { res = await apiFetch('POST', 'api/user_schematics.php', { data: { action: 'unvote', schematic_id: sid } }); }
      catch (err) { res = { ok: false, error: String(err) }; }
      if (!res.ok) { toast(res.error || 'Undo failed', false); return; }
      toast(`Confirmation withdrawn — ${res.data.votes} of ${res.data.needed}`);
      sbRenderVerifyBar(sid, true);
      return;
    }
    if (e.target.closest('#scd-flag')) {
      const form = $('#scd-flagform');
      form.hidden = false;
      $('#scd-flag-note').focus();
      return;
    }
    if (e.target.closest('#scd-flag-cancel')) { $('#scd-flagform').hidden = true; return; }
    if (e.target.closest('#scd-flag-send')) {
      const sid = safeInt($('#scd-community').dataset.sid);
      const note = $('#scd-flag-note').value.trim();
      if (note.length < 5) { toast('Say what needs fixing (a few words at least)', false); return; }
      let res;
      try { res = await apiFetch('POST', 'api/user_schematics.php', { data: { action: 'flag', schematic_id: sid, note } }); }
      catch (err) { res = { ok: false, error: String(err) }; }
      if (!res.ok) { toast(res.error || 'Flagging failed', false); return; }
      toast('Flagged — the submitter will see your note');
      sbRenderVerifyBar(sid, true);
      return;
    }
    if (!e.target.closest('#scd-confirm')) return;
    const sid = safeInt($('#scd-community').dataset.sid);
    let res;
    try { res = await apiFetch('POST', 'api/user_schematics.php', { data: { action: 'vote', schematic_id: sid } }); }
    catch (err) { res = { ok: false, error: String(err) }; }
    if (!res.ok) { toast(res.error || 'Confirming failed', false); return; }
    toast(res.data.verified
      ? 'That was the last confirmation — schematic verified!'
      : `Confirmed — ${res.data.votes} of ${res.data.needed}`);
    sbRenderVerifyBar(sid, true);
  });
  $('#scd-community').addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && e.target.id === 'scd-flag-note') $('#scd-flag-send').click();
  });
  $('#sb-new').addEventListener('click', () => sbOpenDraft(0));
  $('#sb-back').addEventListener('click', async () => {
    if (sbState.dirty) await sbSave();
    sbState.cur = null;
    sbShowView('list');
    sbLoadDrafts();
  });
  $('#sb-submit').addEventListener('click', sbSubmit);

  // collapsible sections — click a header to fold it away
  document.querySelectorAll('#sb-edit-view [data-sbsec]').forEach((h) => {
    h.addEventListener('click', () => h.closest('.sb-section').classList.toggle('collapsed'));
  });

  $('#sb-drafts').addEventListener('click', (e) => {
    const del = e.target.closest('[data-sbdel]');
    if (del) {
      if (!confirmArm(del, 'Click again to delete this draft')) return;
      apiFetch('DELETE', `api/user_schematics.php?id=${safeInt(del.dataset.sbdel)}`).then(() => sbLoadDrafts());
      return;
    }
    const view = e.target.closest('[data-sbview]');
    if (view) { openSchematicPage(view.dataset.sbview); return; }
    // duplicate: copy the body into a brand-new draft (snickerfritz — armor
    // sets are ~10 near-identical pieces). Proof shots stay behind: they
    // prove the ORIGINAL item, the copy needs its own.
    const dup = e.target.closest('[data-sbdup]');
    if (dup) {
      apiFetch('GET', 'api/user_schematics.php', { params: { id: safeInt(dup.dataset.sbdup) } }).then(async (res) => {
        if (!res.ok || !res.data?.draft) { toast(res.error || 'Could not load that draft', false); return; }
        const body = { ...sbEmptyBody(), ...(res.data.draft.body || {}) };
        body.name = `${body.name || 'Untitled schematic'} (copy)`;
        body.screenshots = [];
        const r2 = await apiFetch('POST', 'api/user_schematics.php',
          { data: { action: 'save', draft: { id: 0, body, parent_draft_id: 0 } } })
          .catch((err) => ({ ok: false, error: String(err) }));
        if (!r2.ok) { toast(r2.error || 'Duplicating failed', false); return; }
        toast(`Copied — “${body.name}” is a fresh draft, rename it and adjust the details`);
        await sbLoadDrafts();
        sbOpenDraft(safeInt(r2.data.id));
      }).catch((err) => toast(String(err), false));
      return;
    }
    const open = e.target.closest('[data-sbopen]');
    if (open) sbOpenDraft(safeInt(open.dataset.sbopen));
  });

  // basics — every change autosaves
  const bind = (sel, key, transform) => $(sel).addEventListener('input', (e) => {
    if (!sbState.cur) return;
    sbState.cur.body[key] = transform ? transform(e.target) : e.target.value;
    if (key === 'name') $('#sb-edit-title').textContent = e.target.value || 'New schematic';
    sbMarkDirty();
  });
  bind('#sb-f-name', 'name');
  // live name-collision check — the one submit rule the bar couldn't mirror
  let sbNameTimer = null;
  $('#sb-f-name').addEventListener('input', (e) => {
    clearTimeout(sbNameTimer);
    const name = e.target.value.trim().toLowerCase();
    sbState.nameTaken = null;
    if (!name) { sbRenderProgress(); return; }
    sbNameTimer = setTimeout(async () => {
      let res;
      try { res = await api().search_schematics({ search: name, page: 1 }); }
      catch (_) { return; }
      const hit = ((res.ok && res.data && res.data.results) || [])
        .some((s) => String(s.name || '').trim().toLowerCase() === name);
      sbState.nameTaken = hit ? name : null;
      sbRenderProgress();
    }, 400);
  });
  bind('#sb-f-desc', 'description');
  bind('#sb-f-category', 'category_id', (el) => safeInt(el.value));
  bind('#sb-f-quality', 'quality');
  bind('#sb-f-size', 'size', (el) => safeInt(el.value));
  bind('#sb-f-type', 'type');
  bind('#sb-f-crate', 'crate_size', (el) => safeInt(el.value));
  $('#sb-f-manuf').addEventListener('change', (e) => {
    const b = sbState.cur.body;
    b.manufactured = e.target.checked;
    // crate size follows manufacturability: 100 is the standard factory crate
    if (e.target.checked && !safeInt(b.crate_size)) b.crate_size = 100;
    if (!e.target.checked) b.crate_size = 0;
    $('#sb-f-crate').value = b.crate_size;
    sbMarkDirty();
  });

  $('#sb-res-add').addEventListener('click', () => {
    sbState.cur.body.resources.push({ desc: '', code: '', resourceName: '', units: null });
    sbRenderResources(); sbMarkDirty();
  });
  $('#sb-form-add').addEventListener('click', () => {
    sbState.cur.body.formulas.push({ name: '', weights: {} });
    sbRenderFormulas(); sbMarkDirty();
  });
  $('#sb-comp-add').addEventListener('click', () => {
    sbState.cur.body.components.push({ desc: '', number: null, similar: false, optional: false, looted: false });
    sbRenderComponents(); sbMarkDirty();
  });

  // appearance / model association
  let sbModelTimer = null;
  $('#sb-model-search').addEventListener('input', (e) => {
    clearTimeout(sbModelTimer);
    sbModelTimer = setTimeout(() => sbModelSearch(e.target.value.trim()), 250);
  });
  $('#sb-model-results').addEventListener('click', (e) => {
    const pick = e.target.closest('[data-modelpick]');
    if (!pick) return;
    sbState.cur.body.model_from = safeInt(pick.dataset.modelpick);
    sbState.cur.body.model_from_name = pick.dataset.name;
    $('#sb-model-results').hidden = true;
    sbRenderModelPick();
    sbMarkDirty();
  });
  $('#sb-model-clear').addEventListener('click', () => {
    delete sbState.cur.body.model_from;
    delete sbState.cur.body.model_from_name;
    sbRenderModelPick();
    sbMarkDirty();
  });

  // proof screenshots
  $('#sb-shot-add').addEventListener('click', () => $('#sb-shot-file').click());
  $('#sb-shot-file').addEventListener('change', (e) => {
    if (e.target.files?.length) sbUploadShots([...e.target.files]);
    e.target.value = '';
  });
  $('#sb-shots').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-shotdel]');
    if (del) {
      let res;
      try {
        res = await apiFetch('POST', 'api/user_schematics.php',
          { data: { action: 'shot_del', id: sbState.cur.id, url: del.dataset.shotdel } });
      } catch (err) { res = { ok: false, error: String(err) }; }
      if (!res.ok) { toast(res.error || 'Removing failed', false); return; }
      sbState.cur.body.screenshots = res.data.screenshots || [];
      sbRenderShots();
      sbRenderProgress();
      return;
    }
    const view = e.target.closest('[data-shotview]');
    if (view) sbShowShot(view.dataset.shotview);
  });

  $('#sb-resources').addEventListener('input', (e) => {
    const row = e.target.closest('[data-sbres]');
    if (!row) return;
    if (e.target.classList.contains('sb-classfilter')) {
      sbRenderClassOpts(row.querySelector('.sb-classopts'), e.target.value);
      return;
    }
    const r = sbState.cur.body.resources[safeInt(row.dataset.sbres)];
    const f = e.target.dataset.rf;
    if (f === 'desc') r.desc = e.target.value;
    if (f === 'units') r.units = safeInt(e.target.value);
    sbMarkDirty();
  });
  $('#sb-resources').addEventListener('keydown', (e) => {
    if (!e.target.classList.contains('sb-classfilter')) return;
    if (e.key === 'Escape') { sbCloseClassMenus(); return; }
    if (e.key === 'Enter') {
      e.preventDefault();
      e.target.closest('.cselect-menu').querySelector('.sb-classopt')?.click();
    }
  });
  $('#sb-resources').addEventListener('click', (e) => {
    const del = e.target.closest('[data-rdel]');
    if (del) { sbState.cur.body.resources.splice(safeInt(del.dataset.rdel), 1); sbRenderResources(); sbMarkDirty(); return; }
    const opt = e.target.closest('.sb-classopt');
    if (opt) {
      const row = e.target.closest('[data-sbres]');
      const r = sbState.cur.body.resources[safeInt(row.dataset.sbres)];
      r.code = opt.dataset.code;
      r.resourceName = opt.dataset.desc;
      sbCloseClassMenus();
      sbRenderResources();
      sbMarkDirty();
      return;
    }
    const btn = e.target.closest('.sb-classsel .cselect-btn');
    if (btn) {
      const sel = btn.closest('.sb-classsel');
      const menu = sel.querySelector('.cselect-menu');
      const wasOpen = !menu.hidden;
      sbCloseClassMenus();
      if (!wasOpen) {
        // .cselect-menu is position:fixed — it must be placed at the button
        // every open, exactly like the My Schematics picker does
        const r = btn.getBoundingClientRect();
        menu.style.left = `${r.left}px`;
        menu.style.minWidth = `${Math.min(r.width, 520)}px`;
        menu.hidden = false;
        const filter = menu.querySelector('.sb-classfilter');
        filter.value = '';
        sbRenderClassOpts(menu.querySelector('.sb-classopts'));
        const below = window.innerHeight - r.bottom - 10;
        if (below >= 160) {
          menu.style.top = `${r.bottom + 3}px`;
          menu.style.maxHeight = `${Math.min(300, below)}px`;
        } else {
          const h = Math.min(300, r.top - 10);
          menu.style.top = `${r.top - h - 3}px`;
          menu.style.maxHeight = `${h}px`;
        }
        filter.focus();
      }
    }
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.sb-classsel')) sbCloseClassMenus();
  });

  $('#sb-formulas').addEventListener('input', (e) => {
    const row = e.target.closest('[data-sbform]');
    if (!row) return;
    const f = sbState.cur.body.formulas[safeInt(row.dataset.sbform)];
    if (e.target.dataset.ff === 'name') f.name = e.target.value;
    if (e.target.dataset.fw) {
      f.weights = f.weights || {};
      const v = safeInt(e.target.value);
      if (v > 0) f.weights[e.target.dataset.fw] = v; else delete f.weights[e.target.dataset.fw];
      const total = SB_STATS.reduce((a, s) => a + safeInt(f.weights[s]), 0);
      const badge = row.querySelector('.sb-ftotal');
      badge.textContent = `${total}%`;
      badge.className = `sb-ftotal ${total === 100 || total === 99 ? 'ok' : 'bad'}`;
    }
    sbMarkDirty();
  });
  $('#sb-formulas').addEventListener('click', (e) => {
    const del = e.target.closest('[data-fdel]');
    if (del) { sbState.cur.body.formulas.splice(safeInt(del.dataset.fdel), 1); sbRenderFormulas(); sbMarkDirty(); }
  });

  $('#sb-components').addEventListener('input', (e) => {
    const row = e.target.closest('[data-sbcomp]');
    if (!row) return;
    const i = safeInt(row.dataset.sbcomp);
    const cp = sbState.cur.body.components[i];
    const f = e.target.dataset.cf;
    if (f === 'desc') {
      cp.desc = e.target.value;
      delete cp.schematic_id; delete cp.draft_id; // retyping unlinks
      clearTimeout(sbState.compSearchTimer);
      sbState.compSearchTimer = setTimeout(() => sbCompSearch(i, cp.desc.trim()), 250);
    }
    if (f === 'number') cp.number = safeInt(e.target.value);
    sbMarkDirty();
  });
  $('#sb-components').addEventListener('change', (e) => {
    const row = e.target.closest('[data-sbcomp]');
    if (!row) return;
    const cp = sbState.cur.body.components[safeInt(row.dataset.sbcomp)];
    const f = e.target.dataset.cf;
    if (f === 'similar' || f === 'optional' || f === 'looted') { cp[f] = e.target.checked; sbMarkDirty(); }
  });
  $('#sb-components').addEventListener('click', async (e) => {
    const del = e.target.closest('[data-cdel]');
    if (del) { sbState.cur.body.components.splice(safeInt(del.dataset.cdel), 1); sbRenderComponents(); sbMarkDirty(); return; }
    const link = e.target.closest('[data-clink]');
    if (link) {
      const row = e.target.closest('[data-sbcomp]');
      const cp = sbState.cur.body.components[safeInt(row.dataset.sbcomp)];
      cp.schematic_id = safeInt(link.dataset.clink);
      cp.desc = link.dataset.cname;
      delete cp.draft_id;
      delete cp.category_id;
      sbRenderComponents(); sbMarkDirty();
      return;
    }
    const ccat = e.target.closest('[data-ccat]');
    if (ccat) {
      const row = e.target.closest('[data-sbcomp]');
      const cp = sbState.cur.body.components[safeInt(row.dataset.sbcomp)];
      cp.category_id = safeInt(ccat.dataset.ccat);
      cp.desc = ccat.dataset.cname;
      delete cp.schematic_id;
      delete cp.draft_id;
      sbRenderComponents(); sbMarkDirty();
      return;
    }
    const dlink = e.target.closest('[data-cdraft]');
    if (dlink) {
      const row = e.target.closest('[data-sbcomp]');
      const cp = sbState.cur.body.components[safeInt(row.dataset.sbcomp)];
      cp.draft_id = safeInt(dlink.dataset.cdraft);
      cp.desc = dlink.dataset.cname;
      delete cp.schematic_id;
      sbRenderComponents(); sbMarkDirty();
      toast('Linked to your draft — submit that subcomponent before this schematic');
      return;
    }
    const cnew = e.target.closest('[data-cnew]');
    if (cnew) {
      const i = safeInt(cnew.dataset.cnew);
      sbSpawnChild(i, sbState.cur.body.components[i].desc.trim());
    }
  });
}
