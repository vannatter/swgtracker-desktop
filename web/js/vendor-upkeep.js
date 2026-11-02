// ---- Vendor Upkeep (Advanced tools) ----
// One row per vendor you run: found from your vendor sales and the game's own
// vendor-status mail ("is now empty", "has not been used in quite some time",
// "in danger of being removed" — read server-side from the mail you upload),
// or added by hand. Optional maintenance pool + hourly rate gives days left;
// "Visited" stamps the last time you stopped by. All state is server-side
// (api/vendors.php, shared with the website). Reminders are opt-in: every 30
// minutes the app asks for what's newly due and drops it in the bell.

const VU_POLL_MS = 30 * 60 * 1000;
const vuState = { vendors: [], prefs: { remind: false, warn_days: 3 }, deleted: null, filter: '', q: '', editId: 0, topupId: 0, loaded: false };

const vuAgo = (ts) => (ts ? fmtAgo(new Date(ts * 1000).toISOString()) : '');
const vuNum = (v) => { const s = String(v ?? '').replace(/[,\s]/g, '').toLowerCase(); if (s === '') return null;
  const m = s.match(/^(\d+(?:\.\d+)?)([km]?)$/); if (!m) return NaN;
  return Math.round(parseFloat(m[1]) * (m[2] === 'm' ? 1e6 : m[2] === 'k' ? 1e3 : 1)); };

async function loadVendorUpkeep(force = false) {
  if (!powerTools()) {
    $('#vu-body').innerHTML = '';
    $('#vu-empty').innerHTML = 'Vendor Upkeep is one of the Advanced tools — turn them on in <b>Settings</b>.';
    $('#vu-empty').hidden = false;
    return;
  }
  if (vuState.loaded && !force) { renderVendorUpkeep(); return; }
  $('#vu-loading').hidden = false;
  $('#vu-empty').hidden = true;
  let res;
  try { res = await apiFetch('GET', 'api/vendors.php'); } catch (e) { res = { ok: false, error: String(e) }; }
  $('#vu-loading').hidden = true;
  if (!res.ok || !res.data || !Array.isArray(res.data.vendors)) {
    $('#vu-body').innerHTML = '';
    $('#vu-empty').textContent = /404|not found/i.test(String(res.error || '')) ? 'Vendor Upkeep needs the latest swgtracker.com update.' : `Error: ${res.error || 'failed to load vendors'}`;
    $('#vu-empty').hidden = false;
    return;
  }
  vuState.vendors = res.data.vendors;
  vuState.prefs = res.data.prefs || vuState.prefs;
  vuState.deleted = res.data.deleted_notice || null;
  vuState.loaded = true;
  renderVendorUpkeep();
}

function vuMaintCell(v) {
  if (v.days_left == null) {
    return v.maint_rate ? `<span class="text-muted">${fmtNum(v.maint_rate)}/hr · pool not set</span>`
      : '<span class="text-muted">—</span>';
  }
  const pct = Math.max(0, Math.min(100, (v.days_left / 30) * 100));
  const cls = v.pool_now <= 0 ? 'bad' : v.days_left <= vuState.prefs.warn_days ? 'warn' : 'ok';
  return `<div class="vu-maint ${cls}" title="${escapeHtml(`${fmtNum(Math.max(0, v.pool_now))} credits left at ${fmtNum(v.maint_rate)}/hr — topped up ${vuAgo(v.maint_at)}`)}">
      <span class="vu-days">${v.pool_now <= 0 ? 'Out' : `${v.days_left} d`}</span>
      <span class="vu-bar"><span style="width:${pct}%"></span></span>
      <span class="vu-pool">${fmtShort(Math.max(0, v.pool_now))}</span>
    </div>`;
}

function renderVendorUpkeep() {
  const q = vuState.q.trim().toLowerCase();
  const rows = vuState.vendors.filter((v) => {
    if (vuState.filter === 'hidden' ? !v.hidden : v.hidden) return false;
    if (vuState.filter === 'attention' && v.status === 'ok') return false;
    return !q || `${v.name} ${v.planet} ${v.notes}`.toLowerCase().includes(q);
  }).sort((a, b) => ({ bad: 0, warn: 1, ok: 2 }[a.status] - { bad: 0, warn: 1, ok: 2 }[b.status]) || a.name.localeCompare(b.name));

  const need = vuState.vendors.filter((v) => !v.hidden && v.status !== 'ok').length;
  $('#vu-status').textContent = `${fmtNum(vuState.vendors.filter((v) => !v.hidden).length)} vendors`
    + (need ? ` · ${fmtNum(need)} need attention` : '')
    + (vuState.deleted ? ` · the game deleted a vendor ${vuAgo(vuState.deleted.at)}` : '');
  $('#vu-remind-open').classList.toggle('active', !!vuState.prefs.remind);

  $('#vu-body').innerHTML = rows.map((v) => {
    const warn = v.warnings.map((w) => `<span class="vu-chip ${w.level}">${escapeHtml(w.text)}</span>`).join('')
      || '<span class="vu-chip ok"><i class="fa-solid fa-check"></i> OK</span>';
    const src = v.source === 'manual' ? '' : `<span class="vu-src" title="${v.source === 'sales' ? 'Found from your vendor sales' : "Found from the game's vendor mail"}">${v.source === 'sales' ? 'from sales' : 'from mail'}</span>`;
    const visit = v.visited_at ? vuAgo(v.visited_at) : '<span class="text-muted">never</span>';
    const every = v.visit_every ? `<div class="settings-sub">every ${v.visit_every} d</div>` : '';
    const sale = v.last_sale_at ? `${vuAgo(v.last_sale_at)}${v.sales_30d ? `<div class="settings-sub">${fmtNum(v.sales_30d)} in 30 d</div>` : ''}` : '<span class="text-muted">—</span>';
    const hideBtn = v.source === 'manual'
      ? `<button class="btn btn-icon btn-sm" data-vudel="${v.id}" title="Remove this vendor"><i class="fa-solid fa-trash-can"></i></button>`
      : `<button class="btn btn-icon btn-sm" data-vuhide="${v.id}" title="${v.hidden ? 'Show it again' : "Hide it — e.g. a vendor you've packed up"}"><i class="fa-solid ${v.hidden ? 'fa-eye' : 'fa-eye-slash'}"></i></button>`;
    return `<tr class="vu-row ${v.status}">
      <td class="vu-name"><b>${escapeHtml(v.name)}</b> ${src}${v.planet ? `<div class="settings-sub">${escapeHtml(v.planet)}</div>` : ''}${v.notes ? `<div class="settings-sub vu-notes">${escapeHtml(v.notes)}</div>` : ''}</td>
      <td class="vu-warn">${warn}</td>
      <td>${vuMaintCell(v)}</td>
      <td>${visit}${every}</td>
      <td>${sale}</td>
      <td class="col-actions">
        <button class="btn btn-icon btn-sm" data-vuvisit="${v.id}" title="I visited it just now"><i class="fa-solid fa-location-dot"></i></button>
        <button class="btn btn-icon btn-sm" data-vutopup="${v.id}" title="Topped up — enter what the maintenance pool shows now"><i class="fa-solid fa-coins"></i></button>
        <button class="btn btn-icon btn-sm" data-vuedit="${v.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        ${hideBtn}
      </td></tr>`;
  }).join('');
  const empty = $('#vu-empty');
  empty.hidden = rows.length > 0;
  if (!rows.length) {
    empty.textContent = vuState.filter === 'hidden' ? 'No hidden vendors.'
      : vuState.filter === 'attention' ? 'Nothing needs attention — every vendor looks fine.'
      : 'No vendors yet — they show up here from your vendor sales, or use Add Vendor.';
  }
}

async function vuPost(data) {
  const res = await apiFetch('POST', 'api/vendors.php', { data });
  if (!res.ok) { toast(res.error || 'Something went wrong', false); return null; }
  return res.data || {};
}

function vuOpenEdit(id) {
  const v = vuState.vendors.find((x) => x.id === id);
  vuState.editId = v ? v.id : 0;
  $('#vu-modal-title').textContent = v ? 'Edit Vendor' : 'Add Vendor';
  $('#vu-save').innerHTML = v ? '<i class="fa-solid fa-check"></i> Save' : '<i class="fa-solid fa-plus"></i> Add Vendor';
  $('#vu-f-name').value = v ? v.name : '';
  $('#vu-f-name').disabled = !!(v && v.source !== 'manual');
  $('#vu-f-name').title = v && v.source !== 'manual' ? 'Found from your sales or mail — the name has to match the game\'s' : '';
  $('#vu-f-planet').value = v ? v.planet : '';
  $('#vu-f-rate').value = v && v.maint_rate != null ? v.maint_rate : '';
  $('#vu-f-pool-wrap').hidden = !!v;   // a pool for an existing vendor goes through Topped up
  $('#vu-f-pool').value = '';
  $('#vu-f-every').value = v && v.visit_every ? v.visit_every : '';
  $('#vu-f-notes').value = v ? v.notes : '';
  $('#vu-modal').hidden = false;
  (v ? $('#vu-f-rate') : $('#vu-f-name')).focus();
}

async function vuSaveEdit() {
  const rate = vuNum($('#vu-f-rate').value), pool = vuNum($('#vu-f-pool').value), every = vuNum($('#vu-f-every').value);
  if ([rate, pool, every].some((n) => Number.isNaN(n))) { toast('Numbers only — e.g. 120, 15k or 1.5m', false); return; }
  const data = { planet: $('#vu-f-planet').value.trim(), notes: $('#vu-f-notes').value.trim(), maint_rate: rate, visit_every: every };
  if (!$('#vu-f-name').disabled) data.name = $('#vu-f-name').value.trim();
  if (!vuState.editId && !data.name) { toast('Give the vendor a name', false); return; }
  const out = vuState.editId ? await vuPost({ action: 'update', id: vuState.editId, ...data })
    : await vuPost({ action: 'add', ...data, maint_pool: pool });
  if (!out) return;
  $('#vu-modal').hidden = true;
  toast(vuState.editId ? 'Vendor saved' : out.status === 'unhidden' ? 'That vendor was hidden — it\'s back on the list' : 'Vendor added');
  loadVendorUpkeep(true);
}

function vuOpenTopup(id) {
  const v = vuState.vendors.find((x) => x.id === id);
  if (!v) return;
  vuState.topupId = id;
  $('#vu-topup-name').textContent = v.name;
  $('#vu-t-pool').value = '';
  $('#vu-t-rate').value = v.maint_rate != null ? v.maint_rate : '';
  $('#vu-topup-modal').hidden = false;
  $('#vu-t-pool').focus();
}

async function vuSaveTopup() {
  const pool = vuNum($('#vu-t-pool').value), rate = vuNum($('#vu-t-rate').value);
  if (pool == null || Number.isNaN(pool)) { toast('Enter what the maintenance pool shows now', false); return; }
  if (Number.isNaN(rate)) { toast('Numbers only — e.g. 120', false); return; }
  if (!(await vuPost({ action: 'topup', id: vuState.topupId, maint_pool: pool, maint_rate: rate }))) return;
  $('#vu-topup-modal').hidden = true;
  toast('Maintenance updated');
  loadVendorUpkeep(true);
}

function vuOpenRemind() {
  $('#vu-r-on').checked = !!vuState.prefs.remind;
  $('#vu-r-days').value = String(vuState.prefs.warn_days || 3);
  $('#vu-remind-modal').hidden = false;
}

async function vuSaveRemind() {
  const out = await vuPost({ action: 'prefs', remind: $('#vu-r-on').checked ? 1 : 0, warn_days: Number($('#vu-r-days').value) || 3 });
  if (!out) return;
  vuState.prefs = out.prefs || vuState.prefs;
  $('#vu-remind-modal').hidden = true;
  toast(vuState.prefs.remind ? 'Reminders on — they land in the bell' : 'Reminders off');
  if (vuState.prefs.remind) setTimeout(vuSweep, 5000);
  loadVendorUpkeep(true);
}

// bell reminders — only for Advanced-tools users; the server returns [] unless they opted in
async function vuSweep() {
  if (!powerTools()) return;
  let res;
  try { res = await apiFetch('GET', 'api/vendors.php', { params: { due: 1 } }); } catch (_) { return; }
  if (!res || !res.ok || !res.data || !Array.isArray(res.data.reminders)) return;  // offline / older site
  for (const r of res.data.reminders) if (r && r.title) appLocalAlert(r.title, r.message || '');
}

function initVendorUpkeep() {
  if (!$('#page-upkeep')) return;
  $('#vu-filter').addEventListener('change', (e) => { vuState.filter = e.target.value; renderVendorUpkeep(); });
  $('#vu-search').addEventListener('input', (e) => { vuState.q = e.target.value; renderVendorUpkeep(); });
  $('#vu-add-open').addEventListener('click', () => vuOpenEdit(0));
  $('[data-refresh="upkeep"]').addEventListener('click', () => loadVendorUpkeep(true));
  $('#vu-remind-open').addEventListener('click', vuOpenRemind);
  $('#vu-body').addEventListener('click', async (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.vuedit) vuOpenEdit(Number(b.dataset.vuedit));
    else if (b.dataset.vutopup) vuOpenTopup(Number(b.dataset.vutopup));
    else if (b.dataset.vuvisit) {
      if (await vuPost({ action: 'visit', id: Number(b.dataset.vuvisit) })) { toast('Marked as visited'); loadVendorUpkeep(true); }
    } else if (b.dataset.vuhide) {
      const v = vuState.vendors.find((x) => x.id === Number(b.dataset.vuhide));
      if (v && await vuPost({ action: 'hide', id: v.id, hidden: v.hidden ? 0 : 1 })) { toast(v.hidden ? `${v.name} is back` : `${v.name} hidden`); loadVendorUpkeep(true); }
    } else if (b.dataset.vudel) {
      const v = vuState.vendors.find((x) => x.id === Number(b.dataset.vudel));
      if (v && await confirmDialog({ title: 'Remove vendor?', message: `Stop tracking ${v.name}?`, confirmLabel: 'Remove' })
        && await vuPost({ action: 'remove', id: v.id })) { toast(`${v.name} removed`); loadVendorUpkeep(true); }
    }
  });
  for (const [modal, save, cancel] of [['#vu-modal', vuSaveEdit, '#vu-cancel'], ['#vu-topup-modal', vuSaveTopup, '#vu-t-cancel'], ['#vu-remind-modal', vuSaveRemind, '#vu-r-cancel']]) {
    const m = $(modal);
    $(cancel).addEventListener('click', () => { m.hidden = true; });
    bindBackdropClose(m, () => { m.hidden = true; });
    m.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName !== 'TEXTAREA') save(); });
  }
  $('#vu-save').addEventListener('click', vuSaveEdit);
  $('#vu-t-save').addEventListener('click', vuSaveTopup);
  $('#vu-r-save').addEventListener('click', vuSaveRemind);
}

initVendorUpkeep();
// first check three minutes after launch (past the boot rush), then every 30
setTimeout(() => { vuSweep(); setInterval(vuSweep, VU_POLL_MS); }, 3 * 60 * 1000);
