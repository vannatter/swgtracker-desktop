/* Notes page — a local note library (stored in config.json via set_config, so
   it ships bundle-only and the game can never clobber it). Phase 1 of the
   in-game notes integration Izre Idress asked for: CRUD here, copy in/out via
   clipboard; a later shell batch adds guarded push/pull/merge against the
   per-character notes files in the game's profiles folder. */

const notesState = {
  items: [],        // [{id, title, character, content, created, updated, file?, fhash?}]
  sel: null,        // selected note id
  dirty: false,     // unsaved editor changes
  chars: [],        // character names for the tag datalist
  files: [],        // discovered game notes files (shell >= 0.12.9)
  syncDisk: null,   // {content, hash} of the open note's file when it diverged
  warned: new Set(),// path:hash pairs already toasted by the background check
};

// the file bridge ships with the next shell — the bundle must stay quiet on
// shells that don't have it yet
const notesFileBridge = () => typeof api().notes_files === 'function';

async function loadNotes() {
  try {
    const res = await api().get_config();
    notesState.items = (res.ok && Array.isArray(res.data.notes_library))
      ? res.data.notes_library : [];
  } catch (_) { notesState.items = []; }
  try {
    const r = await apiFetch('GET', 'api/characters.php');
    notesState.chars = ((r.ok && r.data && r.data.characters) || []).map((c) => c.name).filter(Boolean);
  } catch (_) { /* datalist just stays empty */ }
  $('#notes-chars').innerHTML = notesState.chars.map((n) => `<option value="${escapeHtml(n)}">`).join('');
  await notesLoadFiles();
  renderNotes();
}

async function notesLoadFiles() {
  if (!notesFileBridge()) { notesState.files = []; renderNotesGamebar(); return; }
  try {
    const r = await api().notes_files();
    notesState.files = (r.ok && r.data && r.data.files) || [];
  } catch (_) { notesState.files = []; }
  renderNotesGamebar();
}

const notesFileLabel = (f) => `${f.char || f.path.split(/[\\/]/).slice(-2)[0]}${f.exists ? '' : ' (no file yet)'}`;

function renderNotesGamebar() {
  const bar = $('#notes-gamebar');
  if (!bar) return;
  bar.hidden = !notesState.files.length;
  if (!notesState.files.length) return;
  $('#notes-file-pick').innerHTML = notesState.files.map((f) =>
    `<option value="${escapeHtml(f.path)}">${escapeHtml(notesFileLabel(f))}</option>`).join('');
}

async function notesSave() {
  try { await api().set_config('notes_library', notesState.items); } catch (_) {
    toast('Saving notes failed', false);
  }
}

function notesSelected() {
  return notesState.items.find((n) => n.id === notesState.sel) || null;
}

function renderNotes() {
  const hasAny = notesState.items.length > 0;
  $('#notes-empty').hidden = hasAny;
  $('#notes-layout').hidden = !hasAny;
  if (!hasAny) return;
  const filter = ($('#notes-search').value || '').toLowerCase();
  const items = [...notesState.items]
    .filter((n) => !filter || `${n.title} ${n.character} ${n.content}`.toLowerCase().includes(filter))
    .sort((a, b) => (b.updated || 0) - (a.updated || 0));
  // nothing picked yet (fresh visit) — open the most recent note rather than
  // an empty pane
  if (!notesSelected() && items.length) notesState.sel = items[0].id;
  $('#notes-list').innerHTML = items.map((n) => `
    <div class="notes-item ${n.id === notesState.sel ? 'notes-item-sel' : ''}" data-noteid="${escapeHtml(n.id)}">
      <div class="notes-item-title">${escapeHtml(n.title || 'Untitled')}</div>
      <div class="notes-item-sub">${n.character ? `<span class="notes-item-char">${escapeHtml(n.character)}</span>` : ''}
        ${fmtAgoTip(Math.round((n.updated || 0) / 1000))}</div>
    </div>`).join('') || '<div class="notes-empty">No notes match the search.</div>';
  renderNoteEditor();
}

function renderNoteEditor() {
  const n = notesSelected();
  $('#notes-editor').hidden = !n;
  $('#notes-none').hidden = !!n;
  if (!n) return;
  $('#note-f-title').value = n.title || '';
  $('#note-f-char').value = n.character || '';
  $('#note-f-content').value = n.content || '';
  notesState.dirty = false;
  notesUpdateDirty();
  // link controls: only when the shell has the file bridge and files exist
  const linkable = notesFileBridge() && notesState.files.length > 0;
  $('#note-f-file').hidden = !linkable;
  $('#note-push').hidden = !linkable;
  if (linkable) {
    $('#note-f-file').innerHTML = '<option value="">Not linked to game</option>'
      + notesState.files.map((f) =>
        `<option value="${escapeHtml(f.path)}"${n.file === f.path ? ' selected' : ''}>${escapeHtml(notesFileLabel(f))}</option>`).join('');
    $('#note-push').disabled = !n.file;
  }
  if (!notesState.syncDisk || notesState.syncDisk.noteId !== n.id) {
    notesState.syncDisk = null;
    $('#notes-sync-banner').hidden = true;
  }
}

function notesShowSyncBanner(noteId, disk) {
  notesState.syncDisk = { noteId, content: String(disk.content || '').replace(/\r/g, ''), hash: disk.hash };
  $('#notes-sync-msg').textContent = disk.hash === null
    ? 'The game notes file is gone — pushing will recreate it.'
    : 'This note’s game file changed in game since the last sync.';
  $('#notes-sync-banner').hidden = false;
}

function notesUpdateDirty() {
  $('#note-save').classList.toggle('btn-accent', notesState.dirty);
  $('#note-save').disabled = !notesState.dirty;
}

function notesMarkDirty() {
  notesState.dirty = true;
  notesUpdateDirty();
}

async function notesCommitEditor() {
  const n = notesSelected();
  if (!n) return;
  n.title = $('#note-f-title').value.trim();
  n.character = $('#note-f-char').value.trim();
  n.content = $('#note-f-content').value;
  n.updated = Date.now();
  notesState.dirty = false;
  notesUpdateDirty();
  await notesSave();
  renderNotes();
}

async function notesCreate(content = '', title = '') {
  const n = {
    id: `n${Date.now()}${Math.floor(Math.random() * 1000)}`,
    title, character: '', content,
    created: Date.now(), updated: Date.now(),
  };
  notesState.items.push(n);
  notesState.sel = n.id;
  await notesSave();
  renderNotes();
  $('#note-f-title').focus();
}

async function notesCopyOut() {
  const n = notesSelected();
  if (!n) return;
  try {
    await navigator.clipboard.writeText(n.content || '');
    toast('Note copied to clipboard');
  } catch (_) {
    const ta = document.createElement('textarea');
    ta.value = n.content || ''; document.body.appendChild(ta);
    ta.select(); document.execCommand('copy'); ta.remove();
    toast('Note copied to clipboard');
  }
}

// Entry point for other pages ("save waypoints as a note"): re-reads the saved
// library first, because notesState is empty until the Notes page first loads —
// pushing into that and saving would wipe every stored note.
// MERGES into an existing note with the same title (only lines it doesn't
// already have) instead of minting a duplicate note per export; returns
// {added, merged} so the caller can word its toast.
async function notesAddFromText(title, content) {
  try {
    const res = await api().get_config();
    if (res.ok && Array.isArray(res.data.notes_library)) notesState.items = res.data.notes_library;
  } catch (_) { /* keep whatever is in memory */ }
  const existing = notesState.items.find((n) => n.title === title);
  if (existing) {
    const have = new Set(String(existing.content || '').split('\n'));
    const fresh = content.split('\n').filter((l) => l.trim() && !have.has(l));
    if (fresh.length) {
      existing.content = String(existing.content || '').replace(/\n*$/, '\n') + fresh.join('\n') + '\n';
      existing.updated = Date.now();
    }
    notesState.sel = existing.id;
    await notesSave();
    renderNotes();
    return { added: fresh.length, merged: true };
  }
  await notesCreate(content, title);
  return { added: content.split('\n').filter((l) => l.trim()).length, merged: false };
}

// ---- Game notes-file sync (backsync-first: the file is read, and in-game
// changes offered into the note, before any push can overwrite it) ----

// merge helper: lines of src that the note doesn't already have, appended
function notesMergeLines(note, srcText) {
  const have = new Set(String(note.content || '').split('\n'));
  const fresh = String(srcText || '').split('\n').filter((l) => l.trim() && !have.has(l));
  if (fresh.length) {
    note.content = String(note.content || '').replace(/\n*$/, '\n') + fresh.join('\n') + '\n';
    note.updated = Date.now();
  }
  return fresh.length;
}

// "Read into note": the game file becomes (or refreshes) a linked note
async function notesPullFile(path) {
  const r = await api().notes_file_read(path);
  if (!r.ok) { toast(`Reading the file failed: ${r.error || ''}`, false); return; }
  const content = String(r.data.content || '').replace(/\r/g, '');
  let n = notesState.items.find((x) => x.file === r.data.path);
  const f = notesState.files.find((x) => x.path === r.data.path);
  if (!n) {
    n = { id: `n${Date.now()}${Math.floor(Math.random() * 1000)}`,
      title: `Game notes — ${f?.char || 'notes'}`, character: f?.char || '',
      content, file: r.data.path, fhash: r.data.hash,
      created: Date.now(), updated: Date.now() };
    notesState.items.push(n);
    toast(r.data.exists ? 'Game notes loaded into a new linked note' : 'No file yet — push this note to create it');
  } else {
    n.content = content; n.fhash = r.data.hash; n.updated = Date.now();
    toast('Note refreshed from the game file');
  }
  notesState.sel = n.id;
  notesState.syncDisk = null;
  await notesSave();
  renderNotes();
}

// Push = backsync first. The file is re-read; if it moved since our last sync
// the append/replace banner takes over instead of anything being overwritten.
async function notesPushFile() {
  const n = notesSelected();
  if (!n || !n.file) return;
  if (notesState.dirty) await notesCommitEditor();
  const chk = await api().notes_file_read(n.file);
  if (!chk.ok) { toast(`Reading the file failed: ${chk.error || ''}`, false); return; }
  const diskEmpty = !chk.data.exists || !String(chk.data.content || '').trim();
  if (chk.data.hash !== (n.fhash || null) && !diskEmpty) {
    notesShowSyncBanner(n.id, chk.data);
    toast('The game file changed since the last sync — bring those changes in first', false);
    return;
  }
  const w = await api().notes_file_write(n.file, n.content, chk.data.hash);
  if (!w.ok) { toast(`Writing the file failed: ${w.error || ''}`, false); return; }
  if (w.data.conflict) { notesShowSyncBanner(n.id, w.data); return; } // raced the game
  n.fhash = w.data.hash;
  notesState.syncDisk = null;
  $('#notes-sync-banner').hidden = true;
  await notesSave();
  toast('Pushed — /note in game opens it (close the in-game notepad first if it’s open)');
}

// background watch: while the app runs, linked files are re-hashed every 20s;
// a change in game surfaces as the banner (open note) or a one-time toast
async function notesBgCheck() {
  if (!notesFileBridge()) return;
  const linked = notesState.items.filter((x) => x.file);
  if (!linked.length) return;
  try {
    const r = await api().notes_files();
    if (!r.ok) return;
    notesState.files = r.data.files || [];
    renderNotesGamebar();
    for (const n of linked) {
      const f = notesState.files.find((x) => x.path === n.file);
      if (!f || !f.exists || !n.fhash || f.hash === n.fhash) continue;
      const key = `${n.file}:${f.hash}`;
      if (notesState.sel === n.id) {
        const rr = await api().notes_file_read(n.file);
        if (rr.ok) notesShowSyncBanner(n.id, rr.data);
      }
      if (!notesState.warned.has(key)) {
        notesState.warned.add(key);
        toast(`Game notes changed in game — “${n.title}” has sync options`, false);
      }
    }
  } catch (_) { /* next tick */ }
}

function initNotesPage() {
  $('#notes-new').addEventListener('click', () => notesCreate());
  $('#notes-search').addEventListener('input', renderNotes);

  $('#notes-list').addEventListener('click', (e) => {
    const row = e.target.closest('[data-noteid]');
    if (!row) return;
    // unsaved edits follow you silently otherwise — commit them first
    if (notesState.dirty) notesCommitEditor();
    notesState.sel = row.dataset.noteid;
    renderNotes();
  });

  ['#note-f-title', '#note-f-char', '#note-f-content'].forEach((sel) => {
    $(sel).addEventListener('input', notesMarkDirty);
  });
  $('#note-save').addEventListener('click', notesCommitEditor);
  $('#note-f-content').addEventListener('keydown', (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 's') { e.preventDefault(); notesCommitEditor(); }
  });

  $('#note-copy').addEventListener('click', notesCopyOut);

  // game-file sync wiring (inert on shells without the bridge)
  $('#notes-pull').addEventListener('click', () => {
    const path = $('#notes-file-pick').value;
    if (path) notesPullFile(path);
  });
  $('#note-f-file').addEventListener('change', async () => {
    const n = notesSelected();
    if (!n) return;
    n.file = $('#note-f-file').value || undefined;
    n.fhash = undefined; // fresh link: the first push backsyncs from zero
    await notesSave();
    renderNoteEditor();
  });
  $('#note-push').addEventListener('click', notesPushFile);
  $('#notes-sync-append').addEventListener('click', async () => {
    const n = notesSelected();
    const d = notesState.syncDisk;
    if (!n || !d || d.noteId !== n.id) return;
    const added = notesMergeLines(n, d.content);
    n.fhash = d.hash;
    notesState.syncDisk = null;
    await notesSave();
    renderNotes();
    toast(added ? `Appended ${added} line${added === 1 ? '' : 's'} from the game — Push when ready` : 'Nothing new to append — Push when ready');
  });
  $('#notes-sync-replace').addEventListener('click', async () => {
    const n = notesSelected();
    const d = notesState.syncDisk;
    if (!n || !d || d.noteId !== n.id) return;
    n.content = d.content;
    n.fhash = d.hash;
    n.updated = Date.now();
    notesState.syncDisk = null;
    await notesSave();
    renderNotes();
    toast('Note replaced with the game copy');
  });
  setInterval(notesBgCheck, 20000);
  $('#note-del').addEventListener('click', async (e) => {
    const n = notesSelected();
    if (!n) return;
    if (!confirmArm(e.target.closest('button'), 'Click again to delete this note')) return;
    notesState.items = notesState.items.filter((x) => x.id !== n.id);
    notesState.sel = null;
    await notesSave();
    renderNotes();
  });
}
