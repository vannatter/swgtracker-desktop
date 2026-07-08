/* Settings page — mirrors src/gui/settings_tab.py.
   The bridge never returns the raw API key (only has_api_key), so the key
   field is write-only: leave it blank to keep the saved key. */

const MAX_MAIL_PATHS = 4;
const setState = { mailPaths: [] }; // [{path, label}]

function mailPathEntryHtml(entry, idx) {
  return `<div class="mail-entry" data-idx="${idx}">
    <div class="mail-entry-row">
      <span class="mail-entry-label">Character ${idx + 1} name (optional)</span>
      <input type="text" class="form-control filter-input mail-label" placeholder="e.g., Main Tank, Trader"
             value="${escapeHtml(entry.label || '')}">
    </div>
    <div class="mail-entry-row">
      <input type="text" class="form-control filter-input mail-path flex-grow-1"
             placeholder="C:\\SWG Restoration III\\profiles\\character\\mail_CharacterName"
             value="${escapeHtml(entry.path || '')}">
      ${idx > 0 ? `<button class="btn btn-sm btn-outline-secondary mail-remove" data-remove="${idx}" title="Remove">&times;</button>` : ''}
    </div>
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
  renderMailPaths();

  $('#set-poll').value = String(Math.max(1, Math.round((cfg.alert_poll_interval || 300) / 60)));
  $('#set-tray').checked = cfg.minimize_to_tray !== false;
  $('#set-notify').checked = cfg.show_notifications !== false;
  $('#set-autostart').checked = !!cfg.auto_start_monitoring;
  $('#set-delmail').checked = !!cfg.delete_mail_after_upload;

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
      <span class="set-ds-when">${ds.synced_at ? `synced ${fmtAgo(ds.synced_at)}` : 'never synced'}</span></div>`;
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
    const newKey = $('#set-apikey').value.trim();
    const entries = [
      ['mail_paths', mailPaths],
      ['alert_poll_interval', safeInt($('#set-poll').value) * 60],
      ['minimize_to_tray', $('#set-tray').checked],
      ['show_notifications', $('#set-notify').checked],
      ['auto_start_monitoring', $('#set-autostart').checked],
      ['delete_mail_after_upload', $('#set-delmail').checked],
      ['api_key', newKey], // always saved — a blank field clears the key
    ];

    for (const [key, value] of entries) {
      const res = await api().set_config(key, value);
      if (!res.ok) throw new Error(res.error || `failed to save ${key}`);
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

function initSettings() {
  $('#set-addpath').addEventListener('click', () => {
    if (setState.mailPaths.length >= MAX_MAIL_PATHS) return;
    readMailPathInputs();
    setState.mailPaths.push({ path: '', label: '' });
    renderMailPaths();
  });

  $('#set-mailpaths').addEventListener('click', (e) => {
    const btn = e.target.closest('[data-remove]');
    if (!btn) return;
    readMailPathInputs();
    setState.mailPaths.splice(safeInt(btn.dataset.remove), 1);
    renderMailPaths();
  });

  $('#set-save').addEventListener('click', saveSettings);

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

  // Session-only testing switch — flips the whole app into "network down"
  $('#set-ds-simulate').addEventListener('change', async (e) => {
    try { await api().set_simulate_offline(e.target.checked); } catch (_) { /* leave as-is */ }
    fetchPulse(); // banner + pulse react immediately instead of on the next poll
  });
}
