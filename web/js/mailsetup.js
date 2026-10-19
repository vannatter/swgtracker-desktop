/* Set up sales tracking — one sectioned dialog for the whole chain a new
   crafter used to piece together across three pages: pick or create the
   character, export its mail with /mailsave in game, point the app at the
   folder that wrote, and start the monitor. Each section unlocks the next;
   finished ones fold to a one-line summary you can step back into.

   Opened from Home (Quick Actions), the header monitor button when no folder
   exists yet, and the empty Sales / Purchases / Insights pages. Settings stays
   the place to edit or remove folders afterwards. */

const msState = { step: 1, chars: [], taken: new Set(), name: '', path: '', open: false };

async function openMailSetup() {
  const modal = $('#ms-modal');
  Object.assign(msState, { step: 1, chars: [], taken: new Set(), name: '', path: '', open: true });
  $('#ms-new-name').value = '';
  $('#ms-path').value = '';
  $('#ms-auto').checked = true;
  ['#ms-err-1', '#ms-err-3'].forEach((s) => { $(s).textContent = ''; });
  modal.hidden = false;
  await msLoad();
  msRender();
}

async function msLoad() {
  try {
    const r = await apiFetch('GET', 'api/characters.php');
    if (r.ok && r.data && Array.isArray(r.data.characters)) msState.chars = r.data.characters.map((c) => String(c.name));
  } catch (_) { /* offline — creating one still works once the site answers */ }
  try {
    const cfg = await api().get_config();
    const paths = (cfg.ok && cfg.data && cfg.data.mail_paths) || [];
    msState.taken = new Set(paths.filter((m) => m && typeof m === 'object' && m.label).map((m) => String(m.label).toLowerCase()));
    msState.full = paths.length >= MAX_MAIL_PATHS;
  } catch (_) { /* config unreadable — the save step re-reads it anyway */ }
  // a character that already has a folder is done — offer only the rest
  const free = msState.chars.filter((n) => !msState.taken.has(n.toLowerCase()));
  const sel = $('#ms-existing');
  sel.innerHTML = free.length
    ? free.map((n) => `<option value="${escapeHtml(n)}">${escapeHtml(n)}</option>`).join('')
    : `<option value="">${msState.chars.length ? 'Every character already has a mail folder' : 'No characters yet'}</option>`;
  const useExisting = free.length > 0;
  $('#ms-mode-existing').disabled = !useExisting;
  $('#ms-mode-existing').checked = useExisting;
  $('#ms-mode-new').checked = !useExisting;
  msSyncMode();
}

function msSyncMode() {
  const isNew = $('#ms-mode-new').checked;
  $('#ms-existing').disabled = isNew || $('#ms-mode-existing').disabled;
  $('#ms-new-name').disabled = !isNew;
  if (isNew && msState.open && msState.step === 1) $('#ms-new-name').focus();
}

// sections before the current one fold to their summary; later ones wait
function msRender() {
  document.querySelectorAll('#ms-modal .ms-step').forEach((sec) => {
    const n = Number(sec.dataset.msstep);
    sec.classList.toggle('active', n === msState.step);
    sec.classList.toggle('done', n < msState.step);
    sec.classList.toggle('locked', n > msState.step);
  });
  $('#ms-sum-1').textContent = msState.name;
  $('#ms-sum-2').textContent = msState.step > 2 ? 'Mail exported' : '';
  $('#ms-sum-3').textContent = msState.step > 3 ? msState.path : '';
  $('#ms-done-name').textContent = msState.name;
  $('#ms-done-path').textContent = msState.path;
  $('#ms-mailsave-name').textContent = msState.name || 'that character';
  $('#ms-cancel').hidden = msState.step === 4;
  // finished: the folder can't be changed from here any more — Settings owns it now
  document.querySelectorAll('#ms-modal .ms-change').forEach((b) => { b.hidden = msState.step === 4; });
  if (msState.step === 3) $('#ms-path').focus();
  if (msState.full && msState.step === 1) $('#ms-err-1').textContent = 'Four mail folders is the most the monitor watches — remove one in Settings to add another.';
  $('#ms-next-1').disabled = !!msState.full;
}

function closeMailSetup() {
  $('#ms-modal').hidden = true;
  msState.open = false;
  if (typeof homeQuickSync === 'function') homeQuickSync();
}

// step 1: the character — chosen from the list, or created right here
async function msNext1() {
  const err = $('#ms-err-1');
  err.textContent = '';
  if ($('#ms-mode-existing').checked) {
    const name = $('#ms-existing').value;
    if (!name) { err.textContent = 'Pick a character, or create a new one.'; return; }
    msState.name = name;
  } else {
    const name = $('#ms-new-name').value.trim();
    if (!name) { err.textContent = 'Type the character’s name as it appears in game.'; $('#ms-new-name').focus(); return; }
    if (msState.taken.has(name.toLowerCase())) { err.textContent = `${name} already has a mail folder — edit it in Settings.`; return; }
    const known = msState.chars.find((n) => n.toLowerCase() === name.toLowerCase());
    if (known) {
      msState.name = known;   // typed an existing name — just use it
    } else {
      const btn = $('#ms-next-1');
      btn.disabled = true;
      const res = await apiFetch('POST', 'api/characters.php', { data: { name } });
      btn.disabled = false;
      if (!res.ok) { err.textContent = res.error || 'Could not create the character'; return; }
      msState.chars.push(name);
      msState.name = name;
      loadedPages.delete('characters'); loadedPages.delete('settings'); // both list characters
    }
  }
  msState.step = 2;
  msRender();
}

// step 3: save the folder and start watching it — the monitor's own start is
// the existence check, so a bad folder puts everything back as it was
async function msSave() {
  const err = $('#ms-err-3');
  const btn = $('#ms-save');
  const path = $('#ms-path').value.trim();
  err.textContent = '';
  if (!path) { err.textContent = 'Choose the folder /mailsave wrote to.'; return; }
  btn.disabled = true;
  try {
    const cfg = await api().get_config();   // what's on disk now, never a cached copy
    if (!cfg.ok || !cfg.data) throw new Error(cfg.error || 'Could not read settings');
    const before = (cfg.data.mail_paths || []).filter((m) => m && typeof m === 'object' && m.path);
    if (before.length >= MAX_MAIL_PATHS) { err.textContent = 'Four mail folders is the most the monitor watches.'; return; }
    if (before.some((m) => m.path === path)) { err.textContent = 'That folder is already being watched.'; return; }
    if (before.some((m) => String(m.label || '').toLowerCase() === msState.name.toLowerCase())) {
      err.textContent = `${msState.name} already has a mail folder — edit it in Settings.`; return;
    }
    await api().set_config('mail_paths', before.concat([{ path, label: msState.name }]));
    // the monitor reads its folders when it starts — restart it to pick this one up
    try { const st = await api().monitor_state(); if (st.ok && st.data && st.data.running) await api().stop_monitoring(); } catch (_) {}
    const res = await api().start_monitoring();
    if (!res.ok) {
      await api().set_config('mail_paths', before);
      if (before.length) { const back = await api().start_monitoring(); setMonitoring(!!back.ok, back.data); }
      else setMonitoring(false);
      err.textContent = String(res.error || '').includes('not found')
        ? "That folder doesn't exist yet. Run /mailsave in game, wait for it to say it saved successfully, then pick the folder it names."
        : (res.error || 'Could not watch that folder');
      return;
    }
    if ($('#ms-auto').checked) await api().set_config('auto_start_monitoring', true);
    setMonitoring(true, res.data);
    loadedPages.delete('settings'); // Settings re-reads the folders on its next visit
    msState.path = path;
    msState.step = 4;
    msRender();
  } catch (e) {
    err.textContent = String(e && e.message || e);
  } finally {
    btn.disabled = false;
  }
}

function initMailSetup() {
  const modal = $('#ms-modal');
  $('#ms-mode-existing').addEventListener('change', msSyncMode);
  $('#ms-mode-new').addEventListener('change', msSyncMode);
  // clicking into the name box picks "create" without hunting for the radio
  $('#ms-new-name').closest('label').addEventListener('click', () => { if (!$('#ms-mode-new').checked) { $('#ms-mode-new').checked = true; msSyncMode(); } });
  $('#ms-next-1').addEventListener('click', msNext1);
  $('#ms-next-2').addEventListener('click', () => { msState.step = 3; msRender(); });
  $('#ms-browse').addEventListener('click', async () => {
    try { const r = await api().pick_folder(); if (r.ok && r.data) $('#ms-path').value = r.data; } catch (_) {}
  });
  $('#ms-save').addEventListener('click', msSave);
  $('#ms-cancel').addEventListener('click', closeMailSetup);
  $('#ms-close').addEventListener('click', closeMailSetup);
  $('#ms-done-sales').addEventListener('click', () => { closeMailSetup(); showPage('sales'); });
  $('#ms-done-another').addEventListener('click', openMailSetup);
  modal.addEventListener('click', (e) => {
    const back = e.target.closest('.ms-change');
    if (back) { msState.step = Number(back.dataset.msback); msRender(); }
  });
  modal.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') closeMailSetup();
    if (e.key !== 'Enter' || e.target.tagName === 'BUTTON') return;
    if (msState.step === 1) msNext1();
    else if (msState.step === 3) msSave();
  });
  bindBackdropClose(modal, closeMailSetup);
  // any [data-mailsetup] button anywhere opens it (Home, empty Sales pages)
  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-mailsetup]')) { e.preventDefault(); openMailSetup(); }
  });
}

// empty Sales / Purchases / Insights: when nothing is watched yet, say so and
// offer the setup instead of a bare "No sales found."
async function mailSetupOffer(el) {
  let paths = [];
  try { const cfg = await api().get_config(); paths = (cfg.ok && cfg.data && cfg.data.mail_paths) || []; } catch (_) { return; }
  if (paths.some((m) => m && (m.path || typeof m === 'string'))) return;
  if (el.hidden || el.querySelector('.ms-offer')) return;
  el.classList.add('ms-offer-host');
  el.insertAdjacentHTML('beforeend', `<div class="ms-offer">
    <div>Sales come from your in-game mail, and no mail folder is set up yet.</div>
    <button type="button" class="btn btn-sm btn-accent" data-mailsetup><i class="fa-solid fa-wand-magic-sparkles"></i> Set up sales tracking</button>
  </div>`);
}
