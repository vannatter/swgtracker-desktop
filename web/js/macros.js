/* Macros page — manage each character's in-game macros.txt (same per-character
   folder as notes.txt). Backsync-first via the shell's macros_* bridge
   (v0.13.2+): every read snapshots, every write refuses to clobber a file
   that moved (the game rewrites macros.txt at logout).

   File format (confirmed against a live Restoration file):
     version: 0000
     <slot> <name> <icon> <#hexcolor> <commands;separated;by;semicolons>
   Slot gaps are deleted macros; names carry no spaces. */

const macState = {
  files: [],        // discovered macros.txt candidates
  path: '',         // selected file path
  hash: null,       // disk hash at last read (guarded writes)
  header: 'version: 0000',
  macros: [],       // [{slot, name, icon, color, body, raw}]
  editing: null,    // slot being edited, null = new
  selected: null,   // slot shown in the detail pane
  catsAll: {},      // app-only organization, keyed by file path
  cats: { list: [], assign: {}, collapsed: [] }, // current file: categories, name→cat, collapsed cats
};

// Restoration's anti-AFK rules (swgr.org/wiki/macro-protection): a LOOPING
// macro survives the 40-60min macro dump only if every command is on the
// permitted list. Case-sensitive per the wiki.
const MAC_PERMITTED = new Set([
  '/macro', '/pause', '/dumpPausedCommands', '/clearQueue',
  '/say', '/gsay', '/groupSay', '/groupChat', '/recite', '/shout', '/setCurrentSkillTitle', '/whisper',
  '/invite', '/join', '/disband',
  '/target', '/targetAtCursor', '/targetAtCursorStop', '/targetGroup0', '/untarget',
  '/startMusic', '/stopMusic', '/startDance', '/stopDance', '/startBand', '/stopBand',
  '/bandFlourish', '/bandPause', '/flourish', '/holoemote',
  '/moveFurniture', '/rotateFurniture',
]);
// doctor heal families are permitted in any variant (…Injection2 etc.)
const MAC_PERMITTED_PREFIX = ['/nutrientInjection', '/adrenalBoost', '/bactaInfusion',
  '/diseaseInnoculation', '/endorphineInjection', '/healWound', '/poisonInnoculation', '/serotoninInjection'];

// The game clips over-long macros on login. The exact byte cap is UNCONFIRMED —
// the community is locking it in. Until then this is the "looks long" soft line;
// once confirmed, set MAC_LEN_LIMIT to the real number and flip warnAt to it.
const MAC_LEN_SOFT = 255;   // widely-cited in-game-editor ceiling; file edits can exceed it
const MAC_LEN_LIMIT = null; // the confirmed clip point, once known

function macCommands(body) {
  return String(body || '').split(';').map((c) => c.trim()).filter(Boolean);
}

// {loops, offending: [cmd]} — loops = calls /macro (itself or chained)
function macJudge(m) {
  const cmds = macCommands(m.body);
  const loops = cmds.some((c) => /^\/m(acro)?\s/.test(c));
  const offending = [];
  for (const c of cmds) {
    const word = c.split(/\s/)[0];
    const ok = MAC_PERMITTED.has(word) || MAC_PERMITTED_PREFIX.some((p) => word.startsWith(p));
    if (!ok && !offending.includes(word)) offending.push(word);
  }
  return { loops, offending };
}

function macParse(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const macros = [];
  let header = 'version: 0000';
  for (const line of lines) {
    if (!line.trim()) continue;
    if (/^version:/i.test(line)) { header = line.trim(); continue; }
    const m = line.match(/^(\d+)\s+(\S+)\s+(\S+)\s+(#\S+)\s+(.*)$/);
    if (m) {
      macros.push({ slot: safeInt(m[1]), name: m[2], icon: m[3], color: m[4], body: m[5], raw: null });
    } else {
      // never destroy a line we can't parse — carry it through verbatim
      macros.push({ slot: null, name: '', icon: '', color: '', body: '', raw: line });
    }
  }
  return { header, macros };
}

function macSerialize() {
  const out = [macState.header];
  for (const m of macState.macros) {
    if (m.raw !== null && m.raw !== undefined) { out.push(m.raw); continue; }
    out.push(`${m.slot} ${m.name} ${m.icon || 'bm_provoke'} ${m.color || '#ffffff'} ${m.body}`);
  }
  return `${out.join('\n')}\n`;
}

function macNextSlot() {
  const used = new Set(macState.macros.map((m) => m.slot).filter((s) => s !== null));
  let s = 1;
  while (used.has(s)) s += 1;
  return s;
}

function macSupported() {
  return typeof api().macros_files === 'function';
}

async function loadMacros() {
  const empty = $('#mac-empty');
  if (!macSupported()) {
    empty.textContent = 'Managing macros needs app version 0.13.2 or newer — update the desktop client.';
    empty.hidden = false;
    $('#mac-layout').hidden = true;
    $('#mac-gamewarn').hidden = true;
    return;
  }
  let res;
  try { res = await api().macros_files(); } catch (e) { res = { ok: false, error: String(e) }; }
  const files = ((res.ok && res.data && res.data.files) || []).filter((f) => f.exists);
  macState.files = files;
  const pick = $('#mac-file-pick');
  pick.innerHTML = files.length
    ? files.map((f) => `<option value="${escapeHtml(f.path)}">${escapeHtml(f.char || f.path)}</option>`).join('')
    : '<option value="">no macros.txt found</option>';
  if (!files.length) {
    empty.innerHTML = 'No <b>macros.txt</b> found next to your mail folders — set up your SWG mail directories in Settings first, and make sure the character has saved a macro in game at least once.';
    empty.hidden = false;
    $('#mac-layout').hidden = true;
    $('#mac-gamewarn').hidden = true;
    return;
  }
  empty.hidden = true;
  $('#mac-layout').hidden = false;
  if (!macState.path || !files.some((f) => f.path === macState.path)) macState.path = files[0].path;
  pick.value = macState.path;
  await macReadFile();
}

async function macReadFile() {
  let res;
  try { res = await api().macros_file_read(macState.path); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok || !res.data || !res.data.exists) {
    $('#mac-layout').hidden = true;
    $('#mac-gamewarn').hidden = true;
    $('#mac-empty').textContent = res.error || 'Could not read the file.';
    $('#mac-empty').hidden = false;
    return;
  }
  $('#mac-layout').hidden = false;
  macState.hash = res.data.hash;
  const parsed = macParse(res.data.content);
  macState.header = parsed.header;
  macState.macros = parsed.macros;
  $('#mac-empty').hidden = true;
  $('#mac-gamewarn').hidden = false;
  await macCatsLoad();
  renderMacros();
}

function renderMacros() {
  const list = $('#mac-list');
  let rows = macState.macros.filter((m) => m.raw === null || m.raw === undefined);
  const all = rows.slice();
  if (!rows.length && macState.editing !== 'new') {
    list.innerHTML = '<div class="mac-side-empty">No macros yet — click <b>New Macro</b>.</div>';
    const ed = $('#mac-detail .mac-ed');
    const none = $('#mac-ed-none');
    if (ed) ed.hidden = true;
    if (none) { none.hidden = false; none.innerHTML = 'This file has no macros yet — click <b>New Macro</b>.'; }
    return;
  }
  const q = ($('#mac-search')?.value || '').trim().toLowerCase();
  if (q) rows = rows.filter((m) => m.name.toLowerCase().includes(q) || String(m.body).toLowerCase().includes(q));
  // keep a valid selection
  if (macState.selected == null || !all.some((m) => m.slot === macState.selected)) {
    macState.selected = rows.length ? rows[0].slot : (all.length ? all[0].slot : null);
  }
  if (!rows.length) {
    list.innerHTML = `<div class="mac-side-empty">No macros match “${escapeHtml(q)}”.</div>`;
    renderMacDetail();
    return;
  }
  const cats = macState.cats.list || [];
  macFillTagFilter();
  if (!cats.length) {
    // no groups yet — flat list (still draggable, but nothing to drop onto)
    list.innerHTML = rows.map(macItemHtml).join('');
  } else {
    // grouped: each group (in order) then Uncategorized; a macro whose
    // assigned group was deleted falls back to Uncategorized
    const assign = macState.cats.assign || {};
    const collapsed = new Set(macState.cats.collapsed || []);
    const tagF = ($('#mac-tagfilter')?.value || '');
    const shown = tagF ? cats.filter((c) => (c.tags || []).includes(tagF)) : cats;
    const groups = shown.map((c) => ({ cat: c, name: c.name, rows: [] }));
    const uncat = { cat: null, name: '', rows: [] };
    const byName = Object.fromEntries(groups.map((g) => [g.name, g]));
    for (const m of rows) {
      const c = assign[m.name];
      (c && byName[c] ? byName[c] : uncat).rows.push(m);
    }
    const render = (g, isUncat) => {
      const isCol = collapsed.has(g.name);
      const tags = (g.cat && g.cat.tags) || [];
      const head = `<div class="mac-cat-head ${isCol ? 'mac-cat-col' : ''}" data-cat="${escapeHtml(g.name)}"
          ${g.cat && g.cat.desc ? `title="${escapeHtml(g.cat.desc)}"` : ''}>
        <i class="fa-solid ${isCol ? 'fa-caret-right' : 'fa-caret-down'} mac-cat-caret"></i>
        <span class="mac-cat-name">${isUncat ? 'Uncategorized' : escapeHtml(g.name)}</span>
        <span class="mac-cat-count">${g.rows.length}</span>
        ${isUncat ? '' : `<i class="fa-solid fa-pen mac-cat-edit" title="Edit this group" data-catedit="${escapeHtml(g.name)}"></i>
          <i class="fa-solid fa-xmark mac-cat-del" title="Remove this group (its macros become Uncategorized)" data-catdel="${escapeHtml(g.name)}"></i>`}
      </div>`;
      const tagRow = (!isCol && tags.length) ? `<div class="mac-cat-tags">${tags.map((t) => `<span class="cmac-chip cmac-chip-tag">#${escapeHtml(t)}</span>`).join('')}</div>` : '';
      const items = isCol ? '' : (g.rows.length
        ? g.rows.map(macItemHtml).join('')
        : '<div class="mac-cat-drop">drag macros here</div>');
      return `<div class="mac-cat" data-catbody="${escapeHtml(g.name)}">${head}${tagRow}${items}</div>`;
    };
    list.innerHTML = groups.map((g) => render(g, false)).join('')
      + (tagF ? '' : render(uncat, true)); // hide Uncategorized while filtering by tag
  }
  renderMacDetail();
}

// populate the group-tag filter from every group's tags (hidden when none)
function macFillTagFilter() {
  const sel = $('#mac-tagfilter');
  if (!sel) return;
  const tags = [...new Set((macState.cats.list || []).flatMap((c) => c.tags || []))].sort();
  if (!tags.length) { sel.hidden = true; sel.innerHTML = ''; return; }
  const cur = sel.value;
  sel.hidden = false;
  sel.innerHTML = '<option value="">All groups</option>' + tags.map((t) => `<option value="${escapeHtml(t)}">#${escapeHtml(t)}</option>`).join('');
  if (tags.includes(cur)) sel.value = cur;
}

function macItemHtml(m) {
  const j = macJudge(m);
  const warn = j.loops && j.offending.length;
  return `<div class="mac-side-item ${m.slot === macState.selected ? 'mac-side-sel' : ''}" data-slot="${m.slot}" draggable="true">
      <span class="mac-dot" style="background:${escapeHtml(m.color || '#ffffff')}"></span>
      <span class="mac-side-name">${escapeHtml(m.name)}</span>
      ${warn ? '<i class="fa-solid fa-triangle-exclamation mac-side-warn" title="Anti-AFK will dump this looping macro"></i>'
        : j.loops ? '<i class="fa-solid fa-rotate mac-side-loop" title="Dump-safe loop"></i>' : ''}
      <span class="mac-side-slot">#${m.slot}</span>
    </div>`;
}

// --- app-only groups (stored in local config, never in macros.txt) ---
// a group is { name, desc, tags:[] }; older saves stored bare name strings.
let macCatFormTags = [];      // transient tag list while the form is open
let macCatFormEditing = null; // name being edited, or 'new'

function macNormCat(c) {
  if (typeof c === 'string') return { name: c, desc: '', tags: [] };
  return { name: String(c.name || ''), desc: String(c.desc || ''), tags: Array.isArray(c.tags) ? c.tags : [] };
}

async function macCatsLoad() {
  let cfg;
  try { cfg = await api().get_config(); } catch (e) { cfg = { ok: false }; }
  macState.catsAll = (cfg.ok && cfg.data && cfg.data.macro_cats) || {};
  const c = macState.catsAll[macState.path] || {};
  macState.cats = {
    list: (c.list || []).map(macNormCat).filter((x) => x.name),
    assign: c.assign || {},
    collapsed: c.collapsed || [],
  };
}

async function macCatsSave() {
  macState.catsAll[macState.path] = macState.cats;
  try { await api().set_config('macro_cats', macState.catsAll); }
  catch (e) { toast('Could not save groups', false); }
}

function macCatFind(name) { return (macState.cats.list || []).find((c) => c.name === name); }

function macOpenCatForm(name) {
  macCatFormEditing = name || 'new';
  const c = name && name !== 'new' ? macCatFind(name) : null;
  $('#mac-cat-form-title').textContent = c ? `Edit "${c.name}"` : 'New group';
  $('#mac-cat-name').value = c ? c.name : '';
  $('#mac-cat-desc').value = c ? c.desc : '';
  macCatFormTags = c ? [...c.tags] : [];
  macRenderCatFormTags();
  $('#mac-cat-modal').hidden = false;
  $('#mac-cat-name').focus();
}

function macCloseCatForm() {
  $('#mac-cat-modal').hidden = true;
  macCatFormEditing = null;
}

function macRenderCatFormTags() {
  $('#mac-cat-tags').innerHTML = macCatFormTags.map((t) =>
    `<span class="cmac-chip cmac-chip-tag">#${escapeHtml(t)} <i class="fa-solid fa-xmark" data-cattagdel="${escapeHtml(t)}"></i></span>`).join('');
}

async function macSaveCatForm() {
  const name = $('#mac-cat-name').value.trim();
  if (!name) { toast('Give the group a name', false); return; }
  const desc = $('#mac-cat-desc').value.trim();
  const dup = macState.cats.list.find((c) => c.name === name);
  if (macCatFormEditing === 'new') {
    if (dup) { toast('That group already exists', false); return; }
    macState.cats.list.push({ name, desc, tags: [...macCatFormTags] });
  } else {
    const c = macCatFind(macCatFormEditing);
    if (!c) { toast('That group is gone', false); return; }
    if (name !== c.name && dup) { toast('That group already exists', false); return; }
    // renaming: carry assignments + collapsed state over to the new name
    if (name !== c.name) {
      for (const k of Object.keys(macState.cats.assign)) {
        if (macState.cats.assign[k] === c.name) macState.cats.assign[k] = name;
      }
      macState.cats.collapsed = (macState.cats.collapsed || []).map((x) => (x === c.name ? name : x));
    }
    c.name = name; c.desc = desc; c.tags = [...macCatFormTags];
  }
  await macCatsSave();
  macCloseCatForm();
  renderMacros();
}

async function macRemoveCategory(name) {
  macState.cats.list = macState.cats.list.filter((c) => c.name !== name);
  for (const k of Object.keys(macState.cats.assign)) {
    if (macState.cats.assign[k] === name) delete macState.cats.assign[k];
  }
  macState.cats.collapsed = (macState.cats.collapsed || []).filter((c) => c !== name);
  await macCatsSave();
  renderMacros();
}

async function macAssignToCat(slot, cat) {
  const m = macState.macros.find((x) => x.slot === slot);
  if (!m) return;
  if (cat) macState.cats.assign[m.name] = cat;
  else delete macState.cats.assign[m.name];
  await macCatsSave();
  renderMacros();
}

// --- version history / rollback (snapshots live in local sqlite; the engine
// snapshots on every read AND write, so this captures in-game saves too) ---
async function macOpenHistory() {
  if (!macState.path) { toast('Pick a character first', false); return; }
  if (typeof api().macros_file_versions !== 'function') { toast('History needs app version 0.13.2 or newer', false); return; }
  $('#mac-hist-list').innerHTML = '<div class="settings-sub">Loading…</div>';
  $('#mac-hist-modal').hidden = false;
  let res;
  try { res = await api().macros_file_versions(macState.path); } catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) { $('#mac-hist-list').innerHTML = `<div class="settings-sub">${escapeHtml(res.error || 'Could not load history')}</div>`; return; }
  macRenderHistory((res.data && res.data.versions) || []);
}

function macHistAgo(ts) {
  const s = Math.floor(Date.now() / 1000 - ts);
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24); if (d < 30) return `${d}d ago`;
  const mo = Math.floor(d / 30); if (mo < 12) return `${mo}mo ago`;
  return `${Math.floor(mo / 12)}y ago`;
}
function macHistDate(ts) {
  const d = new Date(ts * 1000);
  try {
    return d.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
  } catch (e) { return d.toISOString().slice(0, 16).replace('T', ' '); }
}

function macRenderHistory(versions) {
  const host = $('#mac-hist-list');
  if (!versions.length) { host.innerHTML = '<div class="settings-sub">No snapshots yet.</div>'; return; }
  const rows = versions.map((v, i) => {
    const latest = i === 0;
    const src = v.source === 'app' ? 'Your edit' : v.source === 'game' ? 'In-game' : escapeHtml(String(v.source || ''));
    return `<tr class="mac-hist-row">
        <td class="mac-hist-when">
          <span class="mac-hist-ago">${escapeHtml(macHistAgo(v.ts))}</span>${latest ? ' <span class="mac-hist-latest">CURRENT</span>' : ''}
          <span class="mac-hist-abs">${escapeHtml(macHistDate(v.ts))}</span>
        </td>
        <td><span class="mac-hist-src mac-hist-src-${v.source === 'app' ? 'app' : 'game'}">${src}</span></td>
        <td class="mac-hist-size">${(v.size || 0).toLocaleString()} chars</td>
        <td class="mac-hist-actions">
          <button class="btn btn-xs btn-outline-secondary" data-histprev="${v.id}">Preview</button>
          ${latest ? '' : `<button class="btn btn-xs btn-accent" data-histrestore="${v.id}">Restore</button>`}
        </td>
      </tr>
      <tr class="mac-hist-prevrow" data-histprevrow="${v.id}" hidden><td colspan="4"><div class="mac-hist-prev" data-histprevbody="${v.id}"></div></td></tr>`;
  }).join('');
  host.innerHTML = `<table class="mac-hist-table">
    <thead><tr><th>When</th><th>Source</th><th>Size</th><th></th></tr></thead>
    <tbody>${rows}</tbody></table>`;
}

async function macPreviewVersion(id) {
  const row = $(`[data-histprevrow="${id}"]`);
  const body = $(`[data-histprevbody="${id}"]`);
  if (!row || !body) return;
  if (!row.hidden) { row.hidden = true; return; } // toggle closed
  row.hidden = false;
  let res;
  try { res = await api().notes_version_content(id); } catch (e) { res = { ok: false }; }
  const content = (res.ok && res.data && res.data.content) || '';
  const parsed = macParse(content).macros.filter((m) => m.raw === null || m.raw === undefined);
  body.innerHTML = parsed.length
    ? parsed.map((m) => `<div class="mac-hist-m"><b>#${m.slot} ${escapeHtml(m.name)}</b> <code>${escapeHtml(macCommands(m.body).join(' ; '))}</code></div>`).join('')
    : '<div class="settings-sub">Empty or unreadable snapshot.</div>';
}

async function macRestoreVersion(id, btn) {
  if (!confirmArm(btn, 'Click again to restore')) return;
  let res;
  try { res = await api().notes_version_content(id); } catch (e) { res = { ok: false }; }
  const content = (res.ok && res.data) ? res.data.content : null;
  if (content == null) { toast('Could not read that snapshot', false); return; }
  let w;
  try { w = await api().macros_file_write(macState.path, content, macState.hash); }
  catch (e) { w = { ok: false, error: String(e) }; }
  if (!w.ok) { toast(w.error || 'Restore failed', false); return; }
  if (w.data.conflict) {
    toast('The game rewrote this file just now — reloaded fresh; open history again', false);
    await macReadFile();
    $('#mac-hist-modal').hidden = true;
    return;
  }
  macState.hash = w.data.hash;
  toast('Restored — live at that character\'s next login');
  $('#mac-hist-modal').hidden = true;
  await macReadFile();
}

// The right column IS the editor now — selecting a macro loads it, New Macro
// blanks it. macState.editing: slot | 'new' | null.
function renderMacDetail() {
  const ed = $('#mac-detail .mac-ed');
  const none = $('#mac-ed-none');
  if (macState.editing === 'new') {
    ed.hidden = false; none.hidden = true;
    $('#mac-ed-name').value = '';
    $('#mac-ed-color').value = '#ffffff';
    $('#mac-ed-body').value = '/pause 0.25\n';
    $('#mac-ed-copy').hidden = true;
    $('#mac-ed-del').hidden = true;
    macVerdictLive();
    macCountLive();
    macUsageLive();
    macPalRender();
    return;
  }
  const m = macState.macros.find((x) => x.slot === macState.selected && (x.raw === null || x.raw === undefined));
  if (!m) { ed.hidden = true; none.hidden = false; return; }
  ed.hidden = false; none.hidden = true;
  macState.editing = m.slot;
  $('#mac-ed-name').value = m.name;
  $('#mac-ed-color').value = /^#[0-9a-fA-F]{6}$/.test(m.color) ? m.color : '#ffffff';
  $('#mac-ed-body').value = macCommands(m.body).join('\n');
  $('#mac-ed-copy').hidden = false;
  $('#mac-ed-del').hidden = false;
  macVerdictLive();
  macCountLive();
  macUsageLive();
  macPalRender();
}

// command palette (replaces the dialog's autocomplete-only flow): a filterable
// list; clicking a command inserts it at the textarea caret
function macPalRender() {
  const q = ($('#mac-pal-search')?.value || '').trim().toLowerCase();
  const list = q ? MACRO_COMMANDS.filter((c) => c.toLowerCase().includes(q)) : MACRO_COMMANDS;
  const macIsPermitted = (w) => MAC_PERMITTED.has(w) || MAC_PERMITTED_PREFIX.some((p) => w.startsWith(p));
  const host = $('#mac-pal-list');
  if (!host) return;
  host.innerHTML = list.length ? list.map((c) => {
    const u = MACRO_USAGE[c];
    const tip = u ? `${c} ${u.args}`.trim() + (u.desc ? ` — ${u.desc}` : '') : c;
    return `<div class="mac-pal-item" data-palcmd="${escapeHtml(c)}" title="${escapeHtml(tip)}">
       <span class="mac-pal-cmd">${escapeHtml(c)}${u && u.args ? ` <span class="mac-pal-args">${escapeHtml(u.args)}</span>` : ''}</span>
       ${macIsPermitted(c) ? '<i class="fa-solid fa-shield-halved mac-shield" title="Permitted — never triggers the anti-AFK dump"></i>' : ''}
     </div>`;
  }).join('') : '<div class="mac-pal-more">No commands match.</div>';
}

function macInsertAtCaret(ta, text) {
  const start = ta.selectionStart;
  const before = ta.value.slice(0, start);
  const after = ta.value.slice(ta.selectionEnd);
  // start a fresh line unless we're already at the start of an empty one
  const needNL = before && !before.endsWith('\n');
  const ins = `${needNL ? '\n' : ''}${text} `;
  ta.value = before + ins + after;
  const pos = (before + ins).length;
  ta.setSelectionRange(pos, pos);
  ta.focus();
}

// write-through with the notes-style conflict guard
async function macSaveFile(successMsg) {
  let res;
  try { res = await api().macros_file_write(macState.path, macSerialize(), macState.hash); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) { toast(res.error || 'Save failed', false); return false; }
  if (res.data.conflict) {
    toast('The game rewrote this file since it was read — reloaded fresh; redo your change', false);
    await macReadFile();
    return false;
  }
  macState.hash = res.data.hash;
  toast(successMsg || 'Saved — the game picks it up at that character\'s next login');
  renderMacros();
  return true;
}

function macVerdictLive() {
  const body = $('#mac-ed-body').value.split('\n').map((c) => c.trim()).filter(Boolean).join(';');
  const j = macJudge({ body });
  const v = $('#mac-ed-verdict');
  if (!v) return;
  if (j.loops && j.offending.length) {
    v.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> This loop gets dumped by Restoration's anti-AFK after 40\u201360 min \u2014 not on the permitted list: <b>${escapeHtml(j.offending.join(', '))}</b>`;
    v.className = 'mac-verdict mac-bad';
  } else if (j.loops) {
    v.innerHTML = '<i class="fa-solid fa-rotate"></i> Dump-safe loop \u2014 every command is on Restoration\'s permitted list.';
    v.className = 'mac-verdict mac-ok';
  } else {
    v.textContent = '';
    v.className = 'mac-verdict';
  }
}

// live length readout — the game clips over-long macros on login. We count the
// serialized command string (semicolon-joined, as stored in macros.txt).
function macCountLive() {
  const el = $('#mac-ed-count');
  if (!el) return;
  const cmds = $('#mac-ed-body').value.split('\n').map((c) => c.trim()).filter(Boolean);
  const body = cmds.join(';');
  const n = body.length;
  const limit = MAC_LEN_LIMIT || MAC_LEN_SOFT;
  const over = n > limit;
  el.innerHTML = `${cmds.length} cmd${cmds.length === 1 ? '' : 's'} · <span class="${over ? 'mac-count-over' : ''}">${n} chars</span>`
    + (over
      ? (MAC_LEN_LIMIT
        ? ` <span class="mac-count-over">· over the ${MAC_LEN_LIMIT}-char clip point — the game will truncate this on login</span>`
        : ` <span class="mac-count-warn">· longer than the in-game editor's ~${MAC_LEN_SOFT} chars; file edits can be longer but the game may clip on login — help confirm the exact point in Discord</span>`)
      : '');
}

// show the usage of the command on the line the caret is on
function macUsageLive() {
  const el = $('#mac-ed-usage');
  if (!el) return;
  const ta = $('#mac-ed-body');
  const upToCaret = ta.value.slice(0, ta.selectionStart);
  const line = upToCaret.slice(upToCaret.lastIndexOf('\n') + 1);
  const word = (line.trim().match(/^(\/[A-Za-z0-9]+)/) || [])[1];
  const u = word && MACRO_USAGE[word];
  if (!u) { el.hidden = true; return; }
  el.innerHTML = `<code>${escapeHtml(word)}${u.args ? ` ${escapeHtml(u.args)}` : ''}</code> ${escapeHtml(u.desc || '')}`;
  el.hidden = false;
}

// gather the current editor into the selected (or new) macro and write through
async function macSaveFromEditor() {
  const name = $('#mac-ed-name').value.trim().replace(/\s+/g, '');
  if (!name) { toast('Give the macro a name', false); return; }
  const body = $('#mac-ed-body').value.split('\n').map((c) => c.trim()).filter(Boolean).join(';');
  if (!body) { toast('Add at least one command', false); return; }
  const color = $('#mac-ed-color').value || '#ffffff';
  const finalBody = body.endsWith(';') ? body : `${body};`;
  if (macState.editing === 'new') {
    const slot = macNextSlot();
    macState.macros.push({ slot, name, icon: 'bm_provoke', color, body: finalBody, raw: null });
    macState.selected = slot;
    macState.editing = slot;
  } else {
    const existing = macState.macros.find((m) => m.slot === macState.editing);
    if (!existing) { toast('That macro is gone \u2014 reload', false); return; }
    existing.name = name;
    existing.color = color;
    existing.body = finalBody;
  }
  await macSaveFile();
}

// My Macros | Community tabs on the Macros page. Community lazy-loads on first open.
let macCommunityLoaded = false;
function macSwitchTab(tab) {
  const mine = tab !== 'community';
  document.querySelectorAll('.mac-tab').forEach((b) => b.classList.toggle('mac-tab-active', b.dataset.mactab === tab));
  $('#mac-tab-mine').hidden = !mine;
  $('#mac-head-mine').hidden = !mine;
  $('#mac-tab-community').hidden = mine;
  $('#mac-head-community').hidden = mine;
  if (!mine && !macCommunityLoaded) { macCommunityLoaded = true; loadCommunityMacros(); }
  else if (!mine) { cmacFetch(); }
}

function initMacros() {
  document.querySelector('.mac-tabs')?.addEventListener('click', (e) => {
    const b = e.target.closest('[data-mactab]');
    if (b) macSwitchTab(b.dataset.mactab);
  });
  $('#mac-file-pick').addEventListener('change', async (e) => {
    macState.path = e.target.value;
    await macReadFile();
  });
  $('#mac-reload').addEventListener('click', macReadFile);
  $('#mac-add').addEventListener('click', () => { macState.editing = 'new'; renderMacDetail(); $('#mac-ed-name').focus(); });
  $('#mac-search').addEventListener('input', renderMacros);

  $('#mac-cat-add').addEventListener('click', () => macOpenCatForm('new'));
  $('#mac-tagfilter').addEventListener('change', renderMacros);

  // version history / rollback
  $('#mac-history').addEventListener('click', macOpenHistory);
  $('#mac-hist-x').addEventListener('click', () => { $('#mac-hist-modal').hidden = true; });
  $('#mac-hist-modal').addEventListener('click', (e) => { if (e.target === $('#mac-hist-modal')) $('#mac-hist-modal').hidden = true; });
  $('#mac-hist-list').addEventListener('click', (e) => {
    const p = e.target.closest('[data-histprev]');
    if (p) { macPreviewVersion(safeInt(p.dataset.histprev)); return; }
    const r = e.target.closest('[data-histrestore]');
    if (r) { macRestoreVersion(safeInt(r.dataset.histrestore), r); }
  });

  // group dialog
  $('#mac-cat-save').addEventListener('click', macSaveCatForm);
  $('#mac-cat-cancel').addEventListener('click', macCloseCatForm);
  $('#mac-cat-modal').addEventListener('click', (e) => { if (e.target === $('#mac-cat-modal')) macCloseCatForm(); });
  $('#mac-cat-tagadd').addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ',') return;
    e.preventDefault();
    const t = $('#mac-cat-tagadd').value.trim().replace(/^#/, '').replace(/\s+/g, '-');
    if (t && !macCatFormTags.includes(t) && macCatFormTags.length < 12) macCatFormTags.push(t);
    $('#mac-cat-tagadd').value = '';
    macRenderCatFormTags();
  });
  $('#mac-cat-tags').addEventListener('click', (e) => {
    const del = e.target.closest('[data-cattagdel]');
    if (!del) return;
    macCatFormTags = macCatFormTags.filter((t) => t !== del.dataset.cattagdel);
    macRenderCatFormTags();
  });

  // left list = selection, group collapse/edit/delete
  $('#mac-list').addEventListener('click', (e) => {
    const edit = e.target.closest('[data-catedit]');
    if (edit) { e.stopPropagation(); macOpenCatForm(edit.dataset.catedit); return; }
    const del = e.target.closest('[data-catdel]');
    if (del) { e.stopPropagation(); macRemoveCategory(del.dataset.catdel); return; }
    const head = e.target.closest('.mac-cat-head');
    if (head) {
      const name = head.dataset.cat;
      const col = new Set(macState.cats.collapsed || []);
      if (col.has(name)) col.delete(name); else col.add(name);
      macState.cats.collapsed = [...col];
      macCatsSave();
      renderMacros();
      return;
    }
    const item = e.target.closest('[data-slot]');
    if (item) { macState.selected = safeInt(item.dataset.slot); macState.editing = null; renderMacros(); }
  });

  // drag a macro onto a category header (or its body) to file it there
  let macDragSlot = null;
  $('#mac-list').addEventListener('dragstart', (e) => {
    const item = e.target.closest('[data-slot]');
    if (!item) return;
    macDragSlot = safeInt(item.dataset.slot);
    e.dataTransfer.effectAllowed = 'move';
    item.classList.add('mac-dragging');
  });
  $('#mac-list').addEventListener('dragend', (e) => {
    const item = e.target.closest('[data-slot]');
    if (item) item.classList.remove('mac-dragging');
    document.querySelectorAll('#mac-list .mac-cat-over').forEach((el) => el.classList.remove('mac-cat-over'));
  });
  $('#mac-list').addEventListener('dragover', (e) => {
    const cat = e.target.closest('[data-catbody]');
    if (!cat || macDragSlot == null) return;
    e.preventDefault();
    document.querySelectorAll('#mac-list .mac-cat-over').forEach((el) => el.classList.remove('mac-cat-over'));
    cat.classList.add('mac-cat-over');
  });
  $('#mac-list').addEventListener('drop', (e) => {
    const cat = e.target.closest('[data-catbody]');
    if (!cat || macDragSlot == null) return;
    e.preventDefault();
    macAssignToCat(macDragSlot, cat.dataset.catbody || '');
    macDragSlot = null;
  });

  // inline editor actions
  $('#mac-ed-save').addEventListener('click', macSaveFromEditor);
  $('#mac-ed-copy').addEventListener('click', () => { if (macState.editing !== 'new') macCopyTo(macState.editing); });
  $('#mac-ed-del').addEventListener('click', async (e) => {
    if (macState.editing === 'new') return;
    if (!confirmArm(e.currentTarget, 'Click again to delete this macro')) return;
    const slot = macState.editing;
    macState.macros = macState.macros.filter((m) => m.slot !== slot);
    macState.selected = null;
    macState.editing = null;
    await macSaveFile('Macro deleted');
  });

  // command palette: filter + click-to-insert at the caret
  $('#mac-pal-search').addEventListener('input', macPalRender);
  $('#mac-pal-list').addEventListener('click', (e) => {
    const opt = e.target.closest('[data-palcmd]');
    if (!opt) return;
    macInsertAtCaret($('#mac-ed-body'), opt.dataset.palcmd);
    macVerdictLive(); macCountLive(); macUsageLive();
  });

  // live verdict + inline command autocomplete on the line being typed
  const ta = $('#mac-ed-body');
  const sug = $('#mac-ed-suggest');
  const macIsPermitted = (w) => MAC_PERMITTED.has(w) || MAC_PERMITTED_PREFIX.some((pfx) => w.startsWith(pfx));
  const macSuggest = () => {
    const upToCaret = ta.value.slice(0, ta.selectionStart);
    const line = upToCaret.slice(upToCaret.lastIndexOf('\n') + 1);
    const mt = line.match(/^\s*(\/[A-Za-z]*)$/); // only while typing the command word itself
    if (!mt || mt[1].length < 2) { sug.hidden = true; return; }
    const q = mt[1].toLowerCase();
    const hits = MACRO_COMMANDS.filter((c) => c.toLowerCase().startsWith(q)).slice(0, 10);
    if (!hits.length) { sug.hidden = true; return; }
    sug.innerHTML = hits.map((c) =>
      `<div class="mysd-opt" data-maccmd="${escapeHtml(c)}"><span>${escapeHtml(c)}</span>
         ${macIsPermitted(c) ? '<span class="mysd-opt-meta mac-shield" title="Permitted \u2014 never triggers the anti-AFK macro dump"><i class="fa-solid fa-shield-halved"></i> dump-safe</span>' : ''}</div>`).join('');
    sug.hidden = false;
  };
  ta.addEventListener('input', () => { macVerdictLive(); macCountLive(); macUsageLive(); macSuggest(); });
  ta.addEventListener('keyup', macUsageLive);
  ta.addEventListener('click', macUsageLive);
  ta.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 150));
  sug.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('[data-maccmd]');
    if (!opt) return;
    e.preventDefault();
    const upToCaret = ta.value.slice(0, ta.selectionStart);
    const lineStart = upToCaret.lastIndexOf('\n') + 1;
    ta.value = `${ta.value.slice(0, lineStart)}${opt.dataset.maccmd} ${ta.value.slice(ta.selectionStart)}`;
    const pos = lineStart + opt.dataset.maccmd.length + 1;
    ta.setSelectionRange(pos, pos);
    ta.focus();
    sug.hidden = true;
    macVerdictLive();
  });
}

// copy a macro into another character's macros.txt (guarded write there too)
async function macCopyTo(slot) {
  const m = macState.macros.find((x) => x.slot === slot);
  if (!m) return;
  const others = macState.files.filter((f) => f.path !== macState.path);
  if (!others.length) { toast('No other character has a macros.txt yet', false); return; }
  // single other char: just do it; several: cycle via confirm chain is clunky —
  // use a quick prompt-style picker built from the file list
  const target = others.length === 1 ? others[0]
    : others[safeInt(window.prompt(`Copy "${m.name}" to which character?\n${others.map((f, i) => `${i + 1}. ${f.char || f.path}`).join('\n')}\n\nEnter a number:`, '1')) - 1];
  if (!target) return;
  let res;
  try { res = await api().macros_file_read(target.path); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok || !res.data || !res.data.exists) { toast('Could not read the target file', false); return; }
  const parsed = macParse(res.data.content);
  const used = new Set(parsed.macros.map((x) => x.slot).filter((s) => s !== null));
  let s = 1;
  while (used.has(s)) s += 1;
  parsed.macros.push({ ...m, slot: s });
  const out = [parsed.header];
  for (const x of parsed.macros) {
    if (x.raw !== null && x.raw !== undefined) { out.push(x.raw); continue; }
    out.push(`${x.slot} ${x.name} ${x.icon || 'bm_provoke'} ${x.color || '#ffffff'} ${x.body}`);
  }
  let w;
  try { w = await api().macros_file_write(target.path, `${out.join('\n')}\n`, res.data.hash); }
  catch (e) { w = { ok: false, error: String(e) }; }
  if (!w.ok) { toast(w.error || 'Copy failed', false); return; }
  if (w.data.conflict) { toast('That file changed mid-copy — try again', false); return; }
  toast(`Copied "${m.name}" to ${target.char || 'the other character'} — live at their next login`);
}
