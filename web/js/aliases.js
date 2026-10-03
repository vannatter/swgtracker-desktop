/* Aliases page — manage each character's in-game aliases.txt (same per-character
   folder as macros.txt / notes.txt). Backsync-first via the shell's aliases_*
   bridge (v0.13.2+): every read snapshots, every write refuses to clobber a file
   that moved (the game rewrites aliases.txt at logout).

   File format (BEST-UNDERSTOOD, pending confirmation against a live Restoration
   file): one alias per line, `<name> <command…>`. The command is everything after
   the first run of whitespace and may itself contain spaces. A leading "alias "
   keyword and a trailing ':' on the name are tolerated on read. Any line we can't
   parse is carried through verbatim (raw) so nothing is ever destroyed. */

const aliState = {
  files: [],       // discovered aliases.txt candidates
  path: '',        // selected file path
  hash: null,      // disk hash at last read (guarded writes)
  aliases: [],     // [{name, command, raw}]
  editing: null,   // name being edited, 'new', or null
  selected: null,  // name shown in the detail pane
};

function aliParse(text) {
  const lines = String(text || '').replace(/\r\n/g, '\n').split('\n');
  const aliases = [];
  for (const line of lines) {
    if (!line.trim()) continue;
    // tolerate an optional leading "alias " keyword
    const bare = line.replace(/^\s*alias\s+/i, '');
    // name (optionally ':'-terminated) + first-whitespace-separated command
    const m = bare.match(/^(\S+?):?\s+(.+)$/);
    if (m) aliases.push({ name: m[1], command: m[2].trim(), raw: null });
    else aliases.push({ name: '', command: '', raw: line }); // preserve verbatim
  }
  return { aliases };
}

function aliSerialize() {
  const out = [];
  for (const a of aliState.aliases) {
    if (a.raw !== null && a.raw !== undefined) { out.push(a.raw); continue; }
    out.push(`${a.name} ${a.command}`);
  }
  return `${out.join('\n')}\n`;
}

function aliSupported() {
  return typeof api().aliases_files === 'function';
}

async function loadAliases() {
  const empty = $('#ali-empty');
  if (!aliSupported()) {
    empty.textContent = 'Managing aliases needs app version 0.13.2 or newer — update the desktop client.';
    empty.hidden = false;
    $('#ali-layout').hidden = true;
    $('#ali-gamewarn').hidden = true;
    return;
  }
  let res;
  try { res = await api().aliases_files(); } catch (e) { res = { ok: false, error: String(e) }; }
  const files = ((res.ok && res.data && res.data.files) || []).filter((f) => f.exists);
  aliState.files = files;
  const pick = $('#ali-file-pick');
  pick.innerHTML = files.length
    ? files.map((f) => `<option value="${escapeHtml(f.path)}">${escapeHtml(f.char || f.path)}</option>`).join('')
    : '<option value="">no aliases.txt found</option>';
  if (!files.length) {
    empty.innerHTML = 'No <b>aliases.txt</b> found next to your mail folders — set up your SWG mail directories in Settings first, and make sure the character has saved an alias in game at least once (<code>/alias</code> then <code>/save</code>).';
    empty.hidden = false;
    $('#ali-layout').hidden = true;
    $('#ali-gamewarn').hidden = true;
    return;
  }
  empty.hidden = true;
  $('#ali-layout').hidden = false;
  if (!aliState.path || !files.some((f) => f.path === aliState.path)) aliState.path = files[0].path;
  pick.value = aliState.path;
  await aliReadFile();
}

async function aliReadFile() {
  let res;
  try { res = await api().aliases_file_read(aliState.path); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok || !res.data || !res.data.exists) {
    $('#ali-layout').hidden = true;
    $('#ali-gamewarn').hidden = true;
    $('#ali-empty').textContent = res.error || 'Could not read the file.';
    $('#ali-empty').hidden = false;
    return;
  }
  $('#ali-layout').hidden = false;
  aliState.hash = res.data.hash;
  const parsed = aliParse(res.data.content);
  aliState.aliases = parsed.aliases;
  $('#ali-empty').hidden = true;
  $('#ali-gamewarn').hidden = false;
  renderAliases();
}

function renderAliases() {
  const list = $('#ali-list');
  let rows = aliState.aliases.filter((a) => a.raw === null || a.raw === undefined);
  const all = rows.slice();
  if (!rows.length && aliState.editing !== 'new') {
    list.innerHTML = '<div class="mac-side-empty">No aliases yet — click <b>New Alias</b>.</div>';
    const ed = $('#ali-detail .mac-ed');
    const none = $('#ali-ed-none');
    if (ed) ed.hidden = true;
    if (none) { none.hidden = false; none.innerHTML = 'This file has no aliases yet — click <b>New Alias</b>.'; }
    return;
  }
  const q = ($('#ali-search')?.value || '').trim().toLowerCase();
  if (q) rows = rows.filter((a) => a.name.toLowerCase().includes(q) || String(a.command).toLowerCase().includes(q));
  if (aliState.selected == null || !all.some((a) => a.name === aliState.selected)) {
    aliState.selected = rows.length ? rows[0].name : (all.length ? all[0].name : null);
  }
  list.innerHTML = rows.length ? rows.map((a) =>
    `<div class="mac-side-item ${a.name === aliState.selected ? 'mac-side-sel' : ''}" data-aliname="${escapeHtml(a.name)}">
      <span class="mac-side-name">/${escapeHtml(a.name)}</span>
      <span class="mac-side-slot ali-side-cmd">${escapeHtml(a.command)}</span>
    </div>`).join('') : `<div class="mac-side-empty">No aliases match “${escapeHtml(q)}”.</div>`;
  renderAliDetail();
}

// The right column IS the editor. Selecting an alias loads it; New Alias blanks it.
// aliState.editing: name | 'new' | null.
function renderAliDetail() {
  const ed = $('#ali-detail .mac-ed');
  const none = $('#ali-ed-none');
  if (aliState.editing === 'new') {
    ed.hidden = false; none.hidden = true;
    $('#ali-ed-name').value = '';
    $('#ali-ed-body').value = '';
    $('#ali-ed-del').hidden = true;
    aliPalRender();
    return;
  }
  const a = aliState.aliases.find((x) => x.name === aliState.selected && (x.raw === null || x.raw === undefined));
  if (!a) { ed.hidden = true; none.hidden = false; return; }
  ed.hidden = false; none.hidden = true;
  aliState.editing = a.name;
  $('#ali-ed-name').value = a.name;
  $('#ali-ed-body').value = a.command;
  $('#ali-ed-del').hidden = false;
  aliPalRender();
}

// command palette (shared list) — click to insert at the command field's caret
function aliPalRender() {
  const q = ($('#ali-pal-search')?.value || '').trim().toLowerCase();
  const list = q ? MACRO_COMMANDS.filter((c) => c.toLowerCase().includes(q)) : MACRO_COMMANDS;
  const host = $('#ali-pal-list');
  if (!host) return;
  host.innerHTML = list.length ? list.map((c) => {
    const u = MACRO_USAGE[c];
    const tip = u ? `${c} ${u.args}`.trim() + (u.desc ? ` — ${u.desc}` : '') : c;
    return `<div class="mac-pal-item" data-palcmd="${escapeHtml(c)}" title="${escapeHtml(tip)}">
       <span class="mac-pal-cmd">${escapeHtml(c)}${u && u.args ? ` <span class="mac-pal-args">${escapeHtml(u.args)}</span>` : ''}</span></div>`;
  }).join('') : '<div class="mac-pal-more">No commands match.</div>';
}

function aliInsertAtCaret(el, text) {
  const start = el.selectionStart ?? el.value.length;
  const before = el.value.slice(0, start);
  const after = el.value.slice(el.selectionEnd ?? start);
  // an alias command is usually a single command; insert with a separating space
  const needSpace = before && !/\s$/.test(before);
  const ins = `${needSpace ? ' ' : ''}${text}`;
  el.value = before + ins + after;
  const pos = (before + ins).length;
  el.setSelectionRange(pos, pos);
  el.focus();
}

async function aliSaveFile(successMsg) {
  let res;
  try { res = await api().aliases_file_write(aliState.path, aliSerialize(), aliState.hash); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) { toast(res.error || 'Save failed', false); return false; }
  if (res.data.conflict) {
    toast('The game rewrote this file since it was read — reloaded fresh; redo your change', false);
    await aliReadFile();
    return false;
  }
  aliState.hash = res.data.hash;
  toast(successMsg || 'Saved — the game picks it up at that character\'s next login');
  renderAliases();
  return true;
}

async function aliSaveFromEditor() {
  const name = $('#ali-ed-name').value.trim().replace(/^\//, '').replace(/\s+/g, '');
  if (!name) { toast('Give the alias a name', false); return; }
  const command = $('#ali-ed-body').value.trim();
  if (!command) { toast('Add a command for the alias to run', false); return; }
  if (aliState.editing === 'new') {
    if (aliState.aliases.some((a) => a.name === name && (a.raw === null || a.raw === undefined))) {
      toast(`An alias "/${name}" already exists`, false); return;
    }
    aliState.aliases.push({ name, command, raw: null });
    aliState.selected = name;
    aliState.editing = name;
  } else {
    const existing = aliState.aliases.find((a) => a.name === aliState.editing);
    if (!existing) { toast('That alias is gone — reload', false); return; }
    // a rename collides?
    if (name !== existing.name && aliState.aliases.some((a) => a.name === name && (a.raw === null || a.raw === undefined))) {
      toast(`An alias "/${name}" already exists`, false); return;
    }
    existing.name = name;
    existing.command = command;
    aliState.selected = name;
    aliState.editing = name;
  }
  await aliSaveFile();
}

function initAliases() {
  $('#ali-file-pick').addEventListener('change', async (e) => {
    aliState.path = e.target.value;
    await aliReadFile();
  });
  $('#ali-reload').addEventListener('click', aliReadFile);
  $('#ali-add').addEventListener('click', () => { aliState.editing = 'new'; renderAliDetail(); $('#ali-ed-name').focus(); });
  $('#ali-search').addEventListener('input', renderAliases);

  $('#ali-list').addEventListener('click', (e) => {
    const item = e.target.closest('[data-aliname]');
    if (item) { aliState.selected = item.dataset.aliname; aliState.editing = null; renderAliases(); }
  });

  $('#ali-ed-save').addEventListener('click', aliSaveFromEditor);
  $('#ali-ed-copy').addEventListener('click', () => { if (aliState.editing !== 'new') aliCopyTo(aliState.editing); });
  $('#ali-ed-del').addEventListener('click', async (e) => {
    if (aliState.editing === 'new') return;
    if (!confirmArm(e.currentTarget, 'Click again to delete this alias')) return;
    const name = aliState.editing;
    aliState.aliases = aliState.aliases.filter((a) => !(a.name === name && (a.raw === null || a.raw === undefined)));
    aliState.selected = null;
    aliState.editing = null;
    await aliSaveFile('Alias deleted');
  });

  $('#ali-pal-search').addEventListener('input', aliPalRender);
  $('#ali-pal-list').addEventListener('click', (e) => {
    const opt = e.target.closest('[data-palcmd]');
    if (opt) aliInsertAtCaret($('#ali-ed-body'), opt.dataset.palcmd);
  });

  // inline autocomplete on the command field
  const body = $('#ali-ed-body');
  const sug = $('#ali-ed-suggest');
  const aliSuggest = () => {
    const upToCaret = body.value.slice(0, body.selectionStart);
    const word = upToCaret.slice(upToCaret.lastIndexOf(' ') + 1);
    const mt = word.match(/^(\/[A-Za-z]*)$/);
    if (!mt || mt[1].length < 2) { sug.hidden = true; return; }
    const hits = MACRO_COMMANDS.filter((c) => c.toLowerCase().startsWith(mt[1].toLowerCase())).slice(0, 10);
    if (!hits.length) { sug.hidden = true; return; }
    sug.innerHTML = hits.map((c) => `<div class="mysd-opt" data-alicmd="${escapeHtml(c)}"><span>${escapeHtml(c)}</span></div>`).join('');
    sug.hidden = false;
  };
  body.addEventListener('input', aliSuggest);
  body.addEventListener('blur', () => setTimeout(() => { sug.hidden = true; }, 150));
  sug.addEventListener('mousedown', (e) => {
    const opt = e.target.closest('[data-alicmd]');
    if (!opt) return;
    e.preventDefault();
    const upToCaret = body.value.slice(0, body.selectionStart);
    const wordStart = upToCaret.lastIndexOf(' ') + 1;
    body.value = `${body.value.slice(0, wordStart)}${opt.dataset.alicmd} ${body.value.slice(body.selectionStart)}`;
    const pos = wordStart + opt.dataset.alicmd.length + 1;
    body.setSelectionRange(pos, pos);
    body.focus();
    sug.hidden = true;
  });
}

// copy an alias into another character's aliases.txt (guarded write there too)
async function aliCopyTo(name) {
  const a = aliState.aliases.find((x) => x.name === name);
  if (!a) return;
  const others = aliState.files.filter((f) => f.path !== aliState.path);
  if (!others.length) { toast('No other character has an aliases.txt yet', false); return; }
  const target = others.length === 1 ? others[0]
    : others[safeInt(window.prompt(`Copy "/${a.name}" to which character?\n${others.map((f, i) => `${i + 1}. ${f.char || f.path}`).join('\n')}\n\nEnter a number:`, '1')) - 1];
  if (!target) return;
  let res;
  try { res = await api().aliases_file_read(target.path); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok || !res.data || !res.data.exists) { toast('Could not read the target file', false); return; }
  const parsed = aliParse(res.data.content);
  const existing = parsed.aliases.find((x) => x.name === a.name && (x.raw === null || x.raw === undefined));
  if (existing) existing.command = a.command;
  else parsed.aliases.push({ name: a.name, command: a.command, raw: null });
  const out = [];
  for (const x of parsed.aliases) {
    if (x.raw !== null && x.raw !== undefined) { out.push(x.raw); continue; }
    out.push(`${x.name} ${x.command}`);
  }
  let w;
  try { w = await api().aliases_file_write(target.path, `${out.join('\n')}\n`, res.data.hash); }
  catch (e) { w = { ok: false, error: String(e) }; }
  if (!w.ok) { toast(w.error || 'Copy failed', false); return; }
  if (w.data.conflict) { toast('That file changed mid-copy — try again', false); return; }
  toast(`Copied "/${a.name}" to ${target.char || 'the other character'} — live at their next login`);
}
