/* Characters page — the account's toons, synced with swgtracker.com
   (api/characters.php via the gateway). Mail folders and Harvesters link to
   these; more character-specific features hang off this list over time. */

// designer payloads are ~2KB base64 blobs — kept out of the DOM, keyed by id;
// rows keeps each character's full record for the edit form
const charPageState = { designer: {}, rows: {} };

// accept a full designer link, "designer.php#c=…", or the bare code
function charParseDesigner(raw) {
  const v = String(raw || '').trim();
  if (!v) return '';
  const i = v.indexOf('#c=');
  return i >= 0 ? v.slice(i + 3) : v;
}

// profile form (add/edit): resolves {name, full_name, bio}, or null on cancel
function charFormDialog({ title, confirm, icon = 'fa-check', values = {} }) {
  return new Promise((resolve) => {
    const modal = $('#char-form-modal');
    $('#char-form-title').textContent = title;
    $('#char-form-confirm').innerHTML = `<i class="fa-solid ${icon}"></i> ${escapeHtml(confirm)}`;
    $('#char-f-name').value = values.name || '';
    $('#char-f-full').value = values.full_name || '';
    $('#char-f-bio').value = values.bio || '';
    modal.hidden = false;
    $('#char-f-name').focus();
    $('#char-f-name').select();
    function close(ok) {
      modal.hidden = true;
      modal.removeEventListener('keydown', onKey);
      modal.removeEventListener('click', onBackdrop);
      $('#char-form-confirm').removeEventListener('click', onOk);
      $('#char-form-cancel').removeEventListener('click', onCancel);
      resolve(ok ? {
        name: $('#char-f-name').value.trim(),
        full_name: $('#char-f-full').value.trim(),
        bio: $('#char-f-bio').value.trim(),
      } : null);
    }
    function onKey(e) {
      if (e.key === 'Escape') close(false);
      if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') close(true);
    }
    function onBackdrop(e) { if (e.target === modal) close(false); }
    function onOk() { close(true); }
    function onCancel() { close(false); }
    modal.addEventListener('keydown', onKey);
    modal.addEventListener('click', onBackdrop);
    $('#char-form-confirm').addEventListener('click', onOk);
    $('#char-form-cancel').addEventListener('click', onCancel);
  });
}

// in-app dialog (no native prompts): resolves the input value, or null on cancel
function charDialog({ title, label, hint = '', value = '', placeholder = '', confirm = 'Save', icon = 'fa-check' }) {
  return new Promise((resolve) => {
    const modal = $('#char-modal');
    $('#char-modal-title').textContent = title;
    const hintEl = $('#char-modal-hint');
    hintEl.innerHTML = hint;
    hintEl.hidden = !hint;
    $('#char-modal-label').textContent = label;
    const inp = $('#char-modal-input');
    inp.value = value;
    inp.placeholder = placeholder;
    $('#char-modal-confirm').innerHTML = `<i class="fa-solid ${icon}"></i> ${escapeHtml(confirm)}`;
    modal.hidden = false;
    inp.focus();
    inp.select();
    function close(v) {
      modal.hidden = true;
      modal.removeEventListener('keydown', onKey);
      modal.removeEventListener('click', onBackdrop);
      $('#char-modal-confirm').removeEventListener('click', onOk);
      $('#char-modal-cancel').removeEventListener('click', onCancel);
      resolve(v);
    }
    function onKey(e) {
      if (e.key === 'Escape') close(null);
      if (e.key === 'Enter') close(inp.value);
    }
    function onBackdrop(e) { if (e.target === modal) close(null); }
    function onOk() { close(inp.value); }
    function onCancel() { close(null); }
    modal.addEventListener('keydown', onKey);
    modal.addEventListener('click', onBackdrop);
    $('#char-modal-confirm').addEventListener('click', onOk);
    $('#char-modal-cancel').addEventListener('click', onCancel);
  });
}

async function loadCharactersPage() {
  let res;
  try { res = await apiFetch('GET', 'api/characters.php'); }
  catch (e) { res = { ok: false, error: String(e) }; }
  const chars = (res.ok && res.data && res.data.characters) || [];

  // enrichments are best-effort — the list still renders if any of them fail
  let mailCounts = {};
  try {
    const r = await api().mail_history(1, 0, '', '', '');
    if (r.ok && r.data && r.data.characters) mailCounts = r.data.characters;
  } catch (_) { /* column shows — */ }

  const harvCounts = {};
  try {
    const r = await apiFetch('GET', 'api/harvesters.php');
    for (const h of ((r.ok && r.data && r.data.harvesters) || [])) {
      const n = h.character_name || '';
      if (n) harvCounts[n] = (harvCounts[n] || 0) + 1;
    }
  } catch (_) { /* column shows — */ }

  const body = $('#char-body');
  charPageState.designer = {};
  charPageState.rows = {};
  body.innerHTML = chars.map((c) => {
    const mails = mailCounts[c.name];
    const harv = harvCounts[c.name];
    const dz = c.designer_id || '';
    charPageState.designer[c.id] = dz;
    charPageState.rows[c.id] = c;
    const full = c.full_name ? ` <span class="char-fullname">· ${escapeHtml(c.full_name)}</span>` : '';
    return `<tr data-cid="${c.id}" data-cname="${escapeHtml(c.name)}">
      <td class="col-name" ${c.bio ? `title="${escapeHtml(c.bio)}"` : ''}><i class="fa-solid fa-user char-ico"></i> ${escapeHtml(c.name)}${full}</td>
      <td class="col-num">${mails ? fmtNum(mails) : '<span class="stat_off">—</span>'}</td>
      <td class="col-num">${harv ? fmtNum(harv) : '<span class="stat_off">—</span>'}</td>
      <td class="col-text">
        ${dz ? `<button class="btn btn-icon char-dz" data-dzopen="${c.id}" title="Open this character's saved look in the Image Designer"><i class="fa-solid fa-palette"></i></button>` : ''}
        <button class="btn btn-icon" data-dzedit="${c.id}" title="${dz ? 'Replace or clear the saved Image Designer look' : 'Paste an Image Designer link for this character'}"><i class="fa-solid fa-${dz ? 'pen' : 'plus'}"></i></button>
      </td>
      <td class="col-actions">
        <button class="btn btn-icon" data-rename="${c.id}" title="Rename"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-icon" data-delchar="${c.id}" title="Delete character — harvesters get unlinked, not deleted"><i class="fa-solid fa-trash-can"></i></button>
      </td>
    </tr>`;
  }).join('');

  const empty = $('#char-empty');
  empty.hidden = !!chars.length;
  empty.textContent = res.ok
    ? 'No characters yet — Add Character to start. Mail folders and harvesters link to them.'
    : `Couldn’t load characters: ${res.error || 'server error'}`;

  // keep the Settings mail-label autocomplete in sync
  const dl = $('#set-char-list');
  if (dl) dl.innerHTML = chars.map((c) => `<option value="${escapeHtml(c.name)}">`).join('');
}

async function charAdd() {
  const form = await charFormDialog({ title: 'Add Character', confirm: 'Add Character', icon: 'fa-plus' });
  if (!form || !form.name) return;
  const res = await apiFetch('POST', 'api/characters.php', { data: form });
  if (res.ok) { toast(`Added ${form.name}`); loadCharactersPage(); }
  else toast(res.error || 'Add failed', false);
}

function initCharactersPage() {
  $('[data-refresh="characters"]').addEventListener('click', () => loadCharactersPage());
  $('#char-add').addEventListener('click', charAdd);
  $('#char-body').addEventListener('click', async (e) => {
    const dzOpen = e.target.closest('[data-dzopen]');
    if (dzOpen) {
      const code = charPageState.designer[dzOpen.dataset.dzopen];
      if (code) api().open_external(`https://swgtracker.com/designer.php#c=${code}`);
      return;
    }
    const dzEdit = e.target.closest('[data-dzedit]');
    if (dzEdit) {
      const id = dzEdit.dataset.dzedit;
      const had = !!charPageState.designer[id];
      const raw = await charDialog({
        title: 'Image Designer Look',
        label: 'Designer link or code',
        hint: `Paste the full <b>designer.php</b> link or just the <b>#c=</b> code.${had ? ' Leave empty to clear the saved look.' : ''}`,
        placeholder: 'https://swgtracker.com/designer.php#c=…',
        confirm: 'Save',
      });
      if (raw === null) return;
      const res = await apiFetch('PUT', 'api/characters.php', { data: { id, designer_id: charParseDesigner(raw) } });
      if (res.ok) { toast(raw.trim() ? 'Designer look saved' : 'Designer look cleared'); loadCharactersPage(); }
      else toast(res.error || 'Save failed', false);
      return;
    }
    const ren = e.target.closest('[data-rename]');
    if (ren) {
      const id = ren.dataset.rename;
      const current = charPageState.rows[id] || {};
      const form = await charFormDialog({
        title: 'Edit Character',
        confirm: 'Save',
        icon: 'fa-pen',
        values: current,
      });
      if (!form || !form.name) return;
      const res = await apiFetch('PUT', 'api/characters.php', { data: { id, ...form } });
      if (res.ok) { toast('Character saved'); loadCharactersPage(); }
      else toast(res.error || 'Save failed', false);
      return;
    }
    const del = e.target.closest('[data-delchar]');
    if (del) {
      if (!confirmArm(del, 'Click again to delete')) return;
      const res = await apiFetch('DELETE', 'api/characters.php', { data: { id: del.dataset.delchar } });
      if (res.ok) { toast('Character deleted'); loadCharactersPage(); }
      else toast(res.error || 'Delete failed', false);
    }
  });
}
