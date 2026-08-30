/* Notes page — a local note library (stored in config.json via set_config, so
   it ships bundle-only and the game can never clobber it). Phase 1 of the
   in-game notes integration Izre Idress asked for: CRUD here, copy in/out via
   clipboard; a later shell batch adds guarded push/pull/merge against the
   per-character notes files in the game's profiles folder. */

const notesState = {
  items: [],        // [{id, title, character, content, created, updated}]
  sel: null,        // selected note id
  dirty: false,     // unsaved editor changes
  chars: [],        // character names for the tag datalist
};

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
  renderNotes();
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
