/* Settings page — mirrors src/gui/settings_tab.py.
   The bridge never returns the raw API key (only has_api_key), so the key
   field is write-only: leave it blank to keep the saved key. */

const MAX_MAIL_PATHS = 4;
const setState = { mailPaths: [], moveDir: '', characters: [] }; // [{path, label}], move destination, character names

function mailDisposition() {
  const checked = document.querySelector('input[name="set-maildisp"]:checked');
  const v = checked ? checked.value : 'keep';
  return v === 'move' && !setState.moveDir ? 'keep' : v; // move needs a destination
}

// "Move it to <folder>" is only selectable once a destination exists
function renderMoveDir() {
  const label = $('#set-movedir');
  // front-truncate long paths in JS (CSS rtl-ellipsis scrambles the segments) —
  // the tail is the part you recognize; the full path lives in the hover tip
  const dir = setState.moveDir;
  label.textContent = !dir ? 'no folder chosen' : (dir.length > 44 ? `…${dir.slice(-43)}` : dir);
  label.title = dir;
  const move = $('#set-disp-move');
  move.disabled = !setState.moveDir;
  if (!setState.moveDir && move.checked) {
    document.querySelector('input[name="set-maildisp"][value="keep"]').checked = true;
  }
}

function mailPathEntryHtml(entry, idx) {
  // dropdown of the account's characters — a folder is TIED to one, not labeled
  // freehand. A legacy label that isn't a character yet still shows (and gets
  // created server-side on save). No characters at all → pointer to the page.
  const names = setState.characters || [];
  const known = names.some((n) => n.toLowerCase() === (entry.label || '').toLowerCase());
  // a character can only watch ONE folder — names picked on other rows are off the menu
  const taken = new Set(setState.mailPaths
    .filter((m, i) => i !== idx && m.label)
    .map((m) => m.label.toLowerCase()));
  const opts = [`<option value="">${names.length ? 'Select…' : 'No characters yet'}</option>`]
    .concat(entry.label && !known ? [`<option value="${escapeHtml(entry.label)}" selected>${escapeHtml(entry.label)}</option>`] : [])
    .concat(names.map((n) => `<option value="${escapeHtml(n)}"${n.toLowerCase() === (entry.label || '').toLowerCase() ? ' selected' : ''}${taken.has(n.toLowerCase()) ? ' disabled' : ''}>${escapeHtml(n)}${taken.has(n.toLowerCase()) ? ' — already watching a folder' : ''}</option>`))
    .join('');
  return `<div class="mail-entry" data-idx="${idx}">
    <div class="mail-entry-row">
      <select class="form-select filter-select mail-label ${entry.path && !entry.label ? 'mail-label-missing' : ''}"
              title="The character whose mail lives in this folder">${opts}</select>
      <input type="text" class="form-control filter-input mail-path flex-grow-1"
             placeholder="C:\\SWG Restoration III\\profiles\\…\\mail_CharacterName"
             value="${escapeHtml(entry.path || '')}">
      <button class="btn btn-sm btn-outline-secondary mail-browse" data-browse="${idx}" title="Choose folder"><i class="fa-solid fa-folder-open"></i></button>
      <button class="btn btn-sm btn-outline-secondary mail-remove" data-remove="${idx}" title="Remove">&times;</button>
    </div>
    ${!names.length ? '<div class="settings-sub">Add your toons on the <a role="button" data-goto="characters">Characters page</a> first — each folder needs one.</div>' : ''}
  </div>`;
}

function renderMailPaths() {
  if (!setState.mailPaths.length) setState.mailPaths.push({ path: '', label: '' });
  $('#set-mailpaths').innerHTML = setState.mailPaths.map(mailPathEntryHtml).join('');
  $('#set-addpath').disabled = setState.mailPaths.length >= MAX_MAIL_PATHS;
}

// Read the current inputs back into state before any re-render or save
function readMailPathInputs() {
  document.querySelectorAll('#set-mailpaths .mail-entry').forEach((el) => {
    const idx = safeInt(el.dataset.idx);
    if (!setState.mailPaths[idx]) return;
    setState.mailPaths[idx].label = el.querySelector('.mail-label').value.trim();
    setState.mailPaths[idx].path = el.querySelector('.mail-path').value.trim();
  });
}

async function loadSettings() {
  loadCharacters(); // fire-and-forget — server-synced list
  let res;
  try { res = await api().get_config(); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok || !res.data) {
    showSettingsStatus(`Failed to load settings: ${res.error || 'unknown error'}`, false);
    return;
  }

  const cfg = res.data;
  $('#set-apikey').value = cfg.api_key || '';
  $('#set-apikey-hint').textContent = cfg.has_api_key
    ? '✓ Key saved — edit above to replace it.'
    : 'No API key saved yet.';

  setState.mailPaths = (cfg.mail_paths || [])
    .slice(0, MAX_MAIL_PATHS)
    .map((m) => (typeof m === 'object' && m ? { path: m.path || '', label: m.label || '' } : { path: String(m || ''), label: '' }));
  // remember what each folder was tied to — a changed character on save means
  // the folder's uploaded history must be re-attributed to the new one
  setState.origByPath = Object.fromEntries(setState.mailPaths.filter((m) => m.path).map((m) => [m.path, m.label]));
  renderMailPaths();

  $('#set-poll').value = String(Math.max(1, Math.round((cfg.alert_poll_interval || 300) / 60)));
  // deploy row: dev-wall AND a configured deploy token (maintainers only);
  // the rest of the Developer box needs only dev mode
  $('#set-deploy-row').hidden = !cfg.has_deploy_token;
  $('#set-tray').checked = cfg.minimize_to_tray !== false;
  $('#set-notify').checked = cfg.show_notifications !== false;
  $('#set-autostart').checked = !!cfg.auto_start_monitoring;
  // three-way disposition; legacy shells only stored the delete boolean
  setState.moveDir = String(cfg.mail_move_dir || '');
  const disp = ['keep', 'delete', 'move'].includes(cfg.mail_disposition)
    ? cfg.mail_disposition
    : (cfg.delete_mail_after_upload ? 'delete' : 'keep');
  const radio = document.querySelector(`input[name="set-maildisp"][value="${disp}"]`);
  if (radio) radio.checked = true;
  renderMoveDir();
  const df = cfg.date_format === 'intl' ? 'intl' : (cfg.date_format === 'us' ? 'us' : (localStorage.getItem('dateFormat') || 'us'));
  $('#set-datefmt').value = df;
  setDateFormat(df);

  refreshDatasetStatus();
}

// ---- Offline datasets (exports/* mirror) ----

let dsPollTimer = null;

async function refreshDatasetStatus() {
  let res;
  try { res = await api().dataset_sync_status(); }
  catch (e) { res = { ok: false }; }
  const el = $('#set-ds-status');
  if (!res.ok || !res.data) { el.textContent = 'Offline data unavailable.'; return; }

  const d = res.data;
  const rows = [['resources', 'Resources'], ['schematics', 'Schematics'],
    ['schematic_details', 'Schematic details']].map(([k, label]) => {
    const ds = d.datasets[k] || {};
    return `<div class="set-ds-line"><span class="set-ds-label">${label}</span>
      <span>${ds.count ? ds.count.toLocaleString() : 'none'}</span>
      <span class="set-ds-when">${ds.synced_at ? `synced ${fmtAgoTip(ds.synced_at)}` : 'never synced'}</span></div>`;
  });
  el.innerHTML = (d.in_progress ? '<div class="set-ds-line">Syncing…</div>' : '') + rows.join('') +
    (d.last_error ? `<div class="set-ds-line set-ds-err">Last error: ${escapeHtml(d.last_error)}</div>` : '');
  $('#set-ds-sync').disabled = !!d.in_progress;

  // keep polling while a sync runs so the numbers land without a page bounce
  clearTimeout(dsPollTimer);
  if (d.in_progress) dsPollTimer = setTimeout(refreshDatasetStatus, 2000);
}

async function saveSettings() {
  readMailPathInputs();
  const btn = $('#set-save');
  btn.disabled = true;

  try {
    const mailPaths = setState.mailPaths.filter((m) => m.path);
    // every watched folder needs its character — sales/harvesters/filtering key off it
    if (mailPaths.some((m) => !m.label)) {
      renderMailPaths(); // repaints the missing-label highlight
      throw new Error('Each mail folder needs a character — pick one above its path.');
    }
    // ...and one character can't watch two folders (the game keeps one mail folder per toon)
    const labels = mailPaths.map((m) => m.label.toLowerCase());
    if (new Set(labels).size !== labels.length) {
      throw new Error('Each folder needs a different character — one character has one mail folder.');
    }
    // typed a name we don't know yet? create it server-side (409 duplicate = fine)
    try {
      const known = new Set([...document.querySelectorAll('#set-char-list option')]
        .map((o) => o.value.toLowerCase()));
      for (const m of mailPaths) {
        if (!known.has(m.label.toLowerCase())) {
          await apiFetch('POST', 'api/characters.php', { data: { name: m.label } });
        }
      }
      loadCharacters(); // refresh the datalist with anything just created
    } catch (_) { /* offline — labels still save; sync next time */ }
    const newKey = $('#set-apikey').value.trim();
    const entries = [
      ['mail_paths', mailPaths],
      ['alert_poll_interval', safeInt($('#set-poll').value) * 60],
      ['minimize_to_tray', $('#set-tray').checked],
      ['show_notifications', $('#set-notify').checked],
      ['auto_start_monitoring', $('#set-autostart').checked],
      ['date_format', $('#set-datefmt').value],
      ['mail_disposition', mailDisposition()],
      ['mail_move_dir', setState.moveDir || ''],
      // legacy key kept in sync so an older shell still honors "delete"
      ['delete_mail_after_upload', mailDisposition() === 'delete'],
      ['api_key', newKey], // always saved — a blank field clears the key
    ];

    for (const [key, value] of entries) {
      const res = await api().set_config(key, value);
      if (!res.ok) throw new Error(res.error || `failed to save ${key}`);
    }
    // a changed date format must invalidate every already-rendered page —
    // cached pages would keep showing dates in the old style until relaunch
    const fmtChanged = ($('#set-datefmt').value === 'intl') !== (appDateFmt === 'intl');
    setDateFormat($('#set-datefmt').value);
    if (fmtChanged && typeof loadedPages !== 'undefined') loadedPages.clear();

    // folder re-tied to a different character → migrate its uploaded history
    if (setState.origByPath && typeof api().mail_rename_character === 'function') {
      for (const m of mailPaths) {
        const old = setState.origByPath[m.path];
        if (old && m.label && old !== m.label) {
          try {
            const r = await api().mail_rename_character(old, m.label);
            const n = r.ok && r.data ? safeInt(r.data.moved) : 0;
            if (n) toast(`Re-attributed ${fmtNum(n)} mails: ${old} → ${m.label}`);
          } catch (_) { /* sweep self-heal still catches files in the folder */ }
        }
      }
      setState.origByPath = Object.fromEntries(mailPaths.map((m) => [m.path, m.label]));
    }

    $('#set-apikey-hint').textContent = newKey
      ? '✓ Key saved — edit above to replace it.'
      : 'No API key saved yet.';
    fetchPulse(); // key changes affect connectivity
    showSettingsStatus('Settings saved successfully', true);

    // A cleared or bad key locks the app behind the gate immediately.
    if (!await apiKeyWorks()) showKeyGate('');
  } catch (e) {
    showSettingsStatus(`Error: ${e.message || e}`, false);
  } finally {
    btn.disabled = false;
  }
}

let setStatusTimer = null;
function showSettingsStatus(msg, ok) {
  const el = $('#set-status');
  el.textContent = msg;
  el.className = 'settings-status ' + (ok ? 'ok' : 'err');
  clearTimeout(setStatusTimer);
  setStatusTimer = setTimeout(() => { el.textContent = ''; }, 4000);
}

// ---- Characters (server-synced; used by Harvesters, mail filtering, ...) ----

// characters themselves live on the Characters page now — Settings needs the
// names to populate the per-folder character dropdowns
async function loadCharacters() {
  let res;
  try { res = await apiFetch('GET', 'api/characters.php'); }
  catch (e) { res = { ok: false, error: String(e) }; }
  const chars = (res.ok && res.data && res.data.characters) || [];
  setState.characters = chars.map((c) => c.name);
  $('#set-char-list').innerHTML = chars.map((c) => `<option value="${escapeHtml(c.name)}">`).join('');
  // repaint the folder rows with the fresh list (keep any in-flight edits)
  readMailPathInputs();
  renderMailPaths();
}

function initSettings() {
  $('#set-movedir-browse').addEventListener('click', async () => {
    let res;
    try { res = await api().pick_folder(); } catch (_) { return; }
    if (res.ok && res.data) {
      setState.moveDir = String(res.data);
      renderMoveDir();
      $('#set-disp-move').checked = true; // picking a folder implies you want the move
    }
  });

  $('#set-addpath').addEventListener('click', () => {
    if (setState.mailPaths.length >= MAX_MAIL_PATHS) return;
    readMailPathInputs();
    setState.mailPaths.push({ path: '', label: '' });
    renderMailPaths();
  });

  // picking a character on one row greys it out on the others right away
  $('#set-mailpaths').addEventListener('change', (e) => {
    if (e.target.closest('.mail-label')) {
      readMailPathInputs();
      renderMailPaths();
    }
  });

  $('#set-mailpaths').addEventListener('click', async (e) => {
    const goto = e.target.closest('[data-goto]');
    if (goto) { showPage(goto.dataset.goto); return; }
    const browse = e.target.closest('[data-browse]');
    if (browse) {
      // native Finder/Explorer picker via the bridge
      let res;
      try { res = await api().pick_folder(); } catch (_) { return; }
      if (res.ok && res.data) {
        readMailPathInputs();
        setState.mailPaths[safeInt(browse.dataset.browse)].path = res.data;
        renderMailPaths();
      }
      return;
    }
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    readMailPathInputs();
    setState.mailPaths.splice(safeInt(btn.dataset.remove), 1);
    renderMailPaths();
  });

  $('#set-save').addEventListener('click', saveSettings);
  $('#set-reset').addEventListener('click', async () => {
    await loadSettings(); // repaint every field from the saved config
    try { loadScanConfig(); } catch (_) {} // dev-only scanner section
    showSettingsStatus('Unsaved changes discarded.', true);
  });

  // Show/hide the API key
  $('#set-apikey-eye').addEventListener('click', () => {
    const input = $('#set-apikey');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    $('#set-apikey-eye i').className = `fa-solid ${show ? 'fa-eye-slash' : 'fa-eye'}`;
  });

  $('#set-ds-sync').addEventListener('click', async () => {
    $('#set-ds-sync').disabled = true;
    try { await api().dataset_sync_now(); } catch (_) { /* status poll reports it */ }
    setTimeout(refreshDatasetStatus, 500);
  });

  $('#set-deploy-btn').addEventListener('click', async () => {
    const btn = $('#set-deploy-btn');
    const status = $('#set-deploy-status');
    if (!confirmArmLabeled(btn, 'Deploy to everyone?')) return;
    btn.disabled = true;
    status.textContent = 'Building and deploying…';
    let res;
    try { res = await api().dev_deploy_bundle($('#set-deploy-notes').value.trim()); }
    catch (e) { res = { ok: false, error: String(e) }; }
    btn.disabled = false;
    btn.innerHTML = '<i class="fa-solid fa-rocket"></i> Deploy UI';
    if (res.ok) {
      status.textContent = `Deployed ${res.data.version} — clients pick it up within 4h or on next launch.`;
      toast(`UI bundle ${res.data.version} is live`);
      $('#set-deploy-notes').value = '';
    } else {
      status.textContent = `Deploy failed: ${res.error || 'unknown error'}`;
      toast('Deploy failed', false);
    }
  });

  // Session-only testing switch — flips the whole app into "network down"
  $('#set-ds-simulate').addEventListener('change', async (e) => {
    try { await api().set_simulate_offline(e.target.checked); } catch (_) { /* leave as-is */ }
    fetchPulse(); // banner + pulse react immediately instead of on the next poll
  });
}
