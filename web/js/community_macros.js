/* Community Macros — a shared library served from api/community_macros.php.
   Browse/filter/upvote macros other players shared, clone any into your own
   macros.txt (via the same hash-guarded bridge the Macros page uses), and
   share your own (credited to you). Dev-gated for now. */

// Profession groups so a macro can be tagged for e.g. "all combat classes" in
// one click. Crafting is seeded here but refreshed from the live server's
// schematic_categories (authoritative) at load. Combat/other are the standard
// Restoration professions — easy to adjust if the server's set differs.
const MACRO_CLASS_GROUPS = [
  { group: 'Combat', members: ['Brawler', 'Swordsman', 'Pikeman', 'Fencer', 'Teras Kasi Artist', 'Marksman', 'Rifleman', 'Pistoleer', 'Carbineer', 'Commando', 'Combat Medic', 'Bounty Hunter', 'Smuggler', 'Squad Leader'] },
  { group: 'Crafting', members: ['Artisan', 'Architect', 'Armorsmith', 'Weaponsmith', 'Chef', 'Tailor', 'Droid Engineer', 'Merchant'] },
  { group: 'Outdoors', members: ['Scout', 'Ranger', 'Creature Handler', 'Bio-Engineer'] },
  { group: 'Medical', members: ['Medic', 'Doctor'] },
  { group: 'Entertainer', members: ['Entertainer', 'Dancer', 'Musician', 'Image Designer'] },
  { group: 'Force', members: ['Jedi'] },
  { group: 'Pilot', members: ['Pilot'] },
];

const cmacState = {
  macros: [],
  classGroups: [],    // [{group, members:[]}] — built from the constant + live crafting list
  classesAvail: [],   // flat list of every class (for the filter dropdown)
  q: '', class: '', sort: 'new',
  editing: null,      // id | 'new' | null
  formClasses: new Set(),
  cgOpen: new Set(),   // expanded class groups in the share form (default collapsed)
  formTags: [],
  files: [],          // discovered macros.txt targets for cloning
  canModerate: false,
};

// merge the live crafting professions (schematic_categories) into the groups,
// adding any the server knows that we don't list under Crafting
function cmacBuildClassGroups(liveCrafting) {
  const groups = MACRO_CLASS_GROUPS.map((g) => ({ group: g.group, members: [...g.members] }));
  const crafting = groups.find((g) => g.group === 'Crafting');
  const known = new Set(groups.flatMap((g) => g.members));
  for (const c of (liveCrafting || [])) {
    if (!known.has(c)) { crafting.members.push(c); known.add(c); }
  }
  crafting.members.sort();
  cmacState.classGroups = groups;
  cmacState.classesAvail = [...known].sort();
}

function cmacDebounce(fn, ms) {
  let t;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}

function cmacSupported() {
  // needs the generic API gateway (any modern shell) and the macros bridge to clone
  return !!api() && typeof api().api_request === 'function';
}

async function loadCommunityMacros() {
  const empty = $('#cmac-empty');
  if (!cmacSupported()) {
    empty.textContent = 'Community macros need a newer app version — update the desktop client.';
    empty.hidden = false;
    $('#cmac-list').innerHTML = '';
    return;
  }
  if (!cmacState.classGroups.length) {
    let live = [];
    try {
      const r = await api().get_categories();
      live = [...new Set(((r.data && r.data.schematic_categories) || []).map((c) => c.parent).filter(Boolean))];
    } catch (e) { live = []; }
    cmacBuildClassGroups(live);
    cmacFillClassFilter();
  }
  await cmacFetch();
}

function cmacFillClassFilter() {
  const sel = $('#cmac-class');
  const cur = sel.value;
  sel.innerHTML = '<option value="">All classes</option>'
    + cmacState.classGroups.map((g) =>
      `<optgroup label="${escapeHtml(g.group)}">${g.members.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('')}</optgroup>`).join('');
  if (cur) sel.value = cur;
}

async function cmacFetch() {
  const empty = $('#cmac-empty');
  let res;
  try {
    res = await apiFetch('GET', 'api/community_macros.php', {
      params: { q: cmacState.q, class: cmacState.class, sort: cmacState.sort },
    });
  } catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) {
    $('#cmac-list').innerHTML = '';
    empty.textContent = res.error || 'Could not load the community library.';
    empty.hidden = false;
    return;
  }
  cmacState.macros = (res.data && res.data.macros) || [];
  cmacState.canModerate = !!(res.data && res.data.can_moderate);
  renderCmac();
}

function renderCmac() {
  const host = $('#cmac-list');
  const empty = $('#cmac-empty');
  if (!cmacState.macros.length) {
    host.innerHTML = '';
    empty.innerHTML = (cmacState.q || cmacState.class)
      ? 'No macros match that filter.'
      : 'No community macros yet — be the first to <b>Share a Macro</b>.';
    empty.hidden = false;
    return;
  }
  empty.hidden = true;
  host.innerHTML = cmacState.macros.map((m) => {
    const cmds = m.commands ? m.commands.split(';') : [];
    const chips = [
      ...m.classes.map((c) => `<span class="cmac-chip cmac-chip-class">${escapeHtml(c)}</span>`),
      ...m.tags.map((t) => `<span class="cmac-chip cmac-chip-tag">#${escapeHtml(t)}</span>`),
    ].join('');
    const mineActions = m.mine || cmacState.canModerate
      ? `${m.mine ? `<button class="btn btn-xs btn-outline-secondary" data-cmedit="${m.id}"><i class="fa-solid fa-pen"></i> Edit</button>` : ''}
         <button class="btn btn-xs btn-outline-secondary" data-cmretract="${m.id}"><i class="fa-solid fa-eye-slash"></i> ${m.mine ? 'Remove' : 'Hide'}</button>`
      : '';
    return `<div class="cmac-card" data-id="${m.id}">
      <div class="cmac-card-head">
        <span class="cmac-card-name">${escapeHtml(m.name)}</span>
        <button class="cmac-vote ${m.voted ? 'cmac-voted' : ''}" data-cmvote="${m.id}" title="Upvote">
          <i class="fa-solid fa-caret-up"></i> <span>${m.votes}</span>
        </button>
      </div>
      ${m.description ? `<div class="cmac-card-desc">${escapeHtml(m.description)}</div>` : ''}
      <pre class="cmac-card-cmds">${escapeHtml(cmds.join('\n'))}</pre>
      ${chips ? `<div class="cmac-card-chips">${chips}</div>` : ''}
      <div class="cmac-card-foot">
        <span class="cmac-by">by <b>${escapeHtml(m.by)}</b> · ${m.cmd_count} cmd${m.cmd_count === 1 ? '' : 's'} · ${m.clones} clone${m.clones === 1 ? '' : 's'}</span>
        <div class="cmac-card-actions">
          ${mineActions}
          <button class="btn btn-xs btn-accent" data-cmclone="${m.id}"><i class="fa-solid fa-copy"></i> Clone to mine</button>
        </div>
      </div>
    </div>`;
  }).join('');
}

// ---- share / edit form ----
function cmacOpenForm(id) {
  cmacState.editing = id;
  const m = id !== 'new' ? cmacState.macros.find((x) => x.id === id) : null;
  $('#cmac-form-title').textContent = m ? `Edit ${m.name}` : 'Share a macro';
  $('#cmac-f-savelabel').textContent = m ? 'Save changes' : 'Share';
  $('#cmac-f-name').value = m ? m.name : '';
  $('#cmac-f-desc').value = m ? m.description : '';
  $('#cmac-f-cmds').value = m ? (m.commands || '').split(';').filter(Boolean).join('\n') : '';
  cmacState.formClasses = new Set(m ? m.classes : []);
  cmacState.formTags = m ? [...m.tags] : [];
  // open only the groups that already have a selection; the rest stay collapsed
  cmacState.cgOpen = new Set(cmacState.classGroups.filter((g) => g.members.some((c) => cmacState.formClasses.has(c))).map((g) => g.group));
  cmacRenderFormChips();
  cmacFormVerdict();
  $('#cmac-modal').hidden = false;
  $('#cmac-f-name').focus();
}

function cmacCloseForm() {
  $('#cmac-modal').hidden = true;
  cmacState.editing = null;
}

function cmacRenderFormChips() {
  const host = $('#cmac-f-classes');
  if (!cmacState.classGroups.length) {
    host.innerHTML = '<span class="settings-sub">classes unavailable offline</span>';
  } else {
    host.innerHTML = cmacState.classGroups.map((g) => {
      const sel = g.members.filter((c) => cmacState.formClasses.has(c)).length;
      const allOn = sel === g.members.length;
      const someOn = sel > 0 && !allOn;
      const open = cmacState.cgOpen.has(g.group);
      const chips = g.members.map((c) =>
        `<span class="cmac-chip cmac-chip-toggle ${cmacState.formClasses.has(c) ? 'cmac-chip-on' : ''}" data-cmclass="${escapeHtml(c)}">${escapeHtml(c)}</span>`).join('');
      return `<div class="cmac-classgroup ${open ? 'cmac-cg-open' : ''}">
        <div class="cmac-cg-head" data-cgtoggle="${escapeHtml(g.group)}">
          <i class="fa-solid ${open ? 'fa-caret-down' : 'fa-caret-right'} cmac-cg-caret"></i>
          <span class="cmac-cg-name">${escapeHtml(g.group)}</span>
          <button type="button" class="cmac-cg-all ${allOn ? 'cmac-group-all' : someOn ? 'cmac-group-some' : ''}" data-cmgroup="${escapeHtml(g.group)}" title="Toggle all ${escapeHtml(g.group)} classes">all${allOn ? ' ✓' : ''}</button>
          ${sel ? `<span class="cmac-cg-count">${sel} selected</span>` : ''}
        </div>
        ${open ? `<div class="cmac-classgroup-chips">${chips}</div>` : ''}
      </div>`;
    }).join('');
  }
  $('#cmac-f-tags').innerHTML = cmacState.formTags.map((t) =>
    `<span class="cmac-chip cmac-chip-tag">#${escapeHtml(t)} <i class="fa-solid fa-xmark" data-cmtagdel="${escapeHtml(t)}"></i></span>`).join('');
}

function cmacFormVerdict() {
  // reuse the macro anti-AFK judge if the Macros page is loaded (same rules)
  const v = $('#cmac-f-verdict');
  if (!v || typeof macJudge !== 'function') { if (v) v.textContent = ''; return; }
  const body = $('#cmac-f-cmds').value.split('\n').map((c) => c.trim()).filter(Boolean).join(';');
  const j = macJudge({ body });
  if (j.loops && j.offending.length) {
    v.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Looping macro — Restoration's anti-AFK will dump it (not permitted: <b>${escapeHtml(j.offending.join(', '))}</b>)`;
    v.className = 'mac-verdict mac-bad';
  } else if (j.loops) {
    v.innerHTML = '<i class="fa-solid fa-rotate"></i> Dump-safe loop.';
    v.className = 'mac-verdict mac-ok';
  } else { v.textContent = ''; v.className = 'mac-verdict'; }
}

async function cmacSaveForm() {
  const name = $('#cmac-f-name').value.trim().replace(/\s+/g, '');
  if (!name) { toast('Give the macro a name (no spaces)', false); return; }
  const commands = $('#cmac-f-cmds').value.split('\n').map((c) => c.trim()).filter(Boolean).join(';');
  if (!commands) { toast('Add at least one command', false); return; }
  const data = {
    action: cmacState.editing === 'new' ? 'submit' : 'edit',
    id: cmacState.editing === 'new' ? undefined : cmacState.editing,
    name,
    commands,
    description: $('#cmac-f-desc').value.trim(),
    classes: [...cmacState.formClasses],
    tags: cmacState.formTags,
  };
  let res;
  try { res = await apiFetch('POST', 'api/community_macros.php', { data }); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) { toast(res.error || 'Could not share the macro', false); return; }
  toast(cmacState.editing === 'new' ? 'Shared — thanks for building the library!' : 'Saved');
  cmacCloseForm();
  await cmacFetch();
}

// ---- vote / clone / retract ----
async function cmacVote(id) {
  let res;
  try { res = await apiFetch('POST', 'api/community_macros.php', { data: { action: 'vote', id } }); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) { toast(res.error || 'Vote failed', false); return; }
  const m = cmacState.macros.find((x) => x.id === id);
  if (m) { m.voted = res.data.voted; m.votes = res.data.votes; renderCmac(); }
}

async function cmacRetract(id, mine) {
  let res;
  try { res = await apiFetch('POST', 'api/community_macros.php', { data: { action: 'retract', id } }); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) { toast(res.error || 'Could not remove it', false); return; }
  toast(mine ? 'Removed from the library' : 'Hidden');
  await cmacFetch();
}

async function cmacClone(id) {
  const m = cmacState.macros.find((x) => x.id === id);
  if (!m) return;
  // find this machine's macros.txt targets (reuse the Macros page's state if loaded)
  let files = (typeof macState !== 'undefined' && macState.files && macState.files.length) ? macState.files : cmacState.files;
  if (!files.length) {
    if (typeof api().macros_files !== 'function') {
      toast('Cloning needs app version 0.13.2 or newer', false); return;
    }
    let fr;
    try { fr = await api().macros_files(); } catch (e) { fr = { ok: false }; }
    files = ((fr.ok && fr.data && fr.data.files) || []).filter((f) => f.exists);
    cmacState.files = files;
  }
  if (!files.length) {
    toast('No macros.txt found — open the Macros page and set your SWG mail folders first', false);
    return;
  }
  const target = files.length === 1 ? files[0]
    : files[safeInt(window.prompt(`Clone "${m.name}" into which character?\n${files.map((f, i) => `${i + 1}. ${f.char || f.path}`).join('\n')}\n\nEnter a number:`, '1')) - 1];
  if (!target) return;

  let read;
  try { read = await api().macros_file_read(target.path); }
  catch (e) { read = { ok: false, error: String(e) }; }
  if (!read.ok || !read.data || !read.data.exists) { toast('Could not read that macros.txt', false); return; }
  const parsed = macParse(read.data.content);
  const used = new Set(parsed.macros.map((x) => x.slot).filter((s) => s !== null));
  let slot = 1; while (used.has(slot)) slot += 1;
  const body = m.commands.endsWith(';') ? m.commands : `${m.commands};`;
  parsed.macros.push({ slot, name: m.name, icon: 'bm_provoke', color: '#ffffff', body, raw: null });
  const out = [parsed.header];
  for (const x of parsed.macros) {
    if (x.raw !== null && x.raw !== undefined) { out.push(x.raw); continue; }
    out.push(`${x.slot} ${x.name} ${x.icon || 'bm_provoke'} ${x.color || '#ffffff'} ${x.body}`);
  }
  let w;
  try { w = await api().macros_file_write(target.path, `${out.join('\n')}\n`, read.data.hash); }
  catch (e) { w = { ok: false, error: String(e) }; }
  if (!w.ok) { toast(w.error || 'Clone failed', false); return; }
  if (w.data.conflict) { toast('That file changed just now — try the clone again', false); return; }
  // bump the public counter (best-effort)
  try { await apiFetch('POST', 'api/community_macros.php', { data: { action: 'clone', id } }); } catch (e) { /* ignore */ }
  const m2 = cmacState.macros.find((x) => x.id === id);
  if (m2) { m2.clones += 1; renderCmac(); }
  toast(`Cloned "${m.name}" into ${target.char || 'your macros'} — live at that character's next login`);
}

function initCommunityMacros() {
  $('#cmac-search').addEventListener('input', cmacDebounce(() => { cmacState.q = $('#cmac-search').value.trim(); cmacFetch(); }, 300));
  $('#cmac-class').addEventListener('change', () => { cmacState.class = $('#cmac-class').value; cmacFetch(); });
  $('#cmac-sort').addEventListener('change', () => { cmacState.sort = $('#cmac-sort').value; cmacFetch(); });
  $('#cmac-reload').addEventListener('click', cmacFetch);
  $('#cmac-share').addEventListener('click', () => cmacOpenForm('new'));
  $('#cmac-f-cancel').addEventListener('click', cmacCloseForm);
  $('#cmac-modal').addEventListener('click', (e) => { if (e.target === $('#cmac-modal')) cmacCloseForm(); });
  $('#cmac-f-save').addEventListener('click', cmacSaveForm);
  $('#cmac-f-cmds').addEventListener('input', cmacFormVerdict);

  // class group expand/collapse + per-group "select all" + individual chips
  $('#cmac-f-classes').addEventListener('click', (e) => {
    const all = e.target.closest('[data-cmgroup]');
    if (all) {
      e.stopPropagation(); // don't also toggle the group's expand state
      const g = cmacState.classGroups.find((x) => x.group === all.dataset.cmgroup);
      if (!g) return;
      const allOn = g.members.every((c) => cmacState.formClasses.has(c));
      g.members.forEach((c) => { if (allOn) cmacState.formClasses.delete(c); else cmacState.formClasses.add(c); });
      if (!allOn) cmacState.cgOpen.add(g.group); // opening via select-all reveals what got picked
      cmacRenderFormChips();
      return;
    }
    const head = e.target.closest('[data-cgtoggle]');
    if (head) {
      const name = head.dataset.cgtoggle;
      if (cmacState.cgOpen.has(name)) cmacState.cgOpen.delete(name); else cmacState.cgOpen.add(name);
      cmacRenderFormChips();
      return;
    }
    const chip = e.target.closest('[data-cmclass]');
    if (!chip) return;
    const c = chip.dataset.cmclass;
    if (cmacState.formClasses.has(c)) cmacState.formClasses.delete(c); else cmacState.formClasses.add(c);
    cmacRenderFormChips();
  });
  // tag add / remove
  $('#cmac-f-tagadd').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const t = $('#cmac-f-tagadd').value.trim().replace(/^#/, '').replace(/\s+/g, '-');
    if (t && !cmacState.formTags.includes(t) && cmacState.formTags.length < 12) cmacState.formTags.push(t);
    $('#cmac-f-tagadd').value = '';
    cmacRenderFormChips();
  });
  $('#cmac-f-tags').addEventListener('click', (e) => {
    const del = e.target.closest('[data-cmtagdel]');
    if (!del) return;
    cmacState.formTags = cmacState.formTags.filter((t) => t !== del.dataset.cmtagdel);
    cmacRenderFormChips();
  });

  // card actions (delegated)
  $('#cmac-list').addEventListener('click', (e) => {
    const vote = e.target.closest('[data-cmvote]');
    if (vote) { cmacVote(safeInt(vote.dataset.cmvote)); return; }
    const clone = e.target.closest('[data-cmclone]');
    if (clone) { cmacClone(safeInt(clone.dataset.cmclone)); return; }
    const edit = e.target.closest('[data-cmedit]');
    if (edit) { cmacOpenForm(safeInt(edit.dataset.cmedit)); return; }
    const retract = e.target.closest('[data-cmretract]');
    if (retract) {
      const id = safeInt(retract.dataset.cmretract);
      const mine = (cmacState.macros.find((x) => x.id === id) || {}).mine;
      if (!confirmArm(retract, mine ? 'Click again to remove' : 'Click again to hide')) return;
      cmacRetract(id, mine);
    }
  });
}
