/* Mail page — the monitor's landing: status cards + the uploaded/parsed ledger.
   Upload + server-side parsing happen in src/core/mail_monitor.py; this page
   just shows the receipts. */

const mmState = { pollTimer: null };

const MM_KIND = {
  sale: '<span class="mm-kind mm-sale"><i class="fa-solid fa-tags"></i> sale</span>',
  mail: '<span class="mm-kind"><i class="fa-solid fa-envelope"></i> mail</span>',
  error: '<span class="mm-kind mm-err"><i class="fa-solid fa-triangle-exclamation"></i> error</span>',
};

async function loadMail() {
  let state = null;
  try {
    const res = await api().monitor_state();
    if (res.ok) state = res.data;
  } catch (_) { /* cards degrade */ }

  const running = !!state?.running;
  $('#mm-state').textContent = state
    ? (running ? `watching ${state.folders.length} folder${state.folders.length > 1 ? 's' : ''}` : 'not monitoring')
    : '';

  let rows = [];
  try {
    const res = await api().mail_history(300);
    rows = (res.ok && res.data) || [];
  } catch (_) { /* table empty-state below */ }

  // known inventory types — sale items already tracked show a check, not a button
  // (null = lookup failed: keep the buttons, the server dedupes adds anyway)
  let invNames = null;
  try {
    const res = await api().get_inventory({ perpage: 500 });
    const items = res.ok && res.data && res.data.results;
    if (Array.isArray(items)) {
      invNames = new Set(items.map((i) => String(i.item_name || '').trim().toLowerCase()));
    }
  } catch (_) { /* keep the buttons */ }

  const sales = rows.filter((r) => r.kind === 'sale').length;
  const card = (cls, icon, val, label) => `
    <div class="mm-card ${cls}">
      <div class="mm-card-ico"><i class="fa-solid ${icon}"></i></div>
      <div><div class="mm-card-val">${val}</div><div class="mm-card-label">${label}</div></div>
    </div>`;
  $('#mm-cards').innerHTML =
    card('', 'fa-envelope', fmtNum(rows.length), 'Mails uploaded')
    + card('sale', 'fa-tags', fmtNum(sales), 'Vendor sales')
    + card('session', 'fa-bolt', state ? fmtNum(state.uploaded) : '—', 'This session')
    + card(`fail ${state?.failed ? 'bad' : ''}`, 'fa-triangle-exclamation',
           state ? fmtNum(state.failed) : '—', 'Failed');

  $('#mm-body').innerHTML = rows.map((r) => {
    // sale detail is "ITEM → BUYER — N credits"; the item is what you may
    // want tracked in My Inventory when it's a type you haven't added yet
    const item = r.kind === 'sale' && r.detail ? r.detail.split(' → ')[0] : '';
    const tracked = item && invNames && invNames.has(item.trim().toLowerCase());
    const action = !item ? '' : tracked
      ? '<span class="mm-tracked" title="Already in My Inventory"><i class="fa-solid fa-check"></i></span>'
      : `<button class="mm-addinv" data-item="${escapeHtml(item)}"
           title="Add to My Inventory as a new type"><i class="fa-solid fa-square-plus"></i></button>`;
    return `<tr class="${r.has_raw ? 'mm-row-openable' : ''}" data-mailid="${escapeHtml(r.mail_id)}"
        data-hasraw="${r.has_raw ? 1 : 0}" title="${r.has_raw ? 'Click to read the original mail' : ''}">
      <td class="col-text">${fmtAgoTip(r.uploaded_at)}</td>
      <td class="col-text">${MM_KIND[r.kind] || MM_KIND.mail}</td>
      <td class="col-text">${escapeHtml(r.subject || '')}</td>
      <td class="col-name">${escapeHtml(r.detail || '')}</td>
      <td class="col-actions"><span class="mm-slot">${action}</span><button class="mm-del" data-del="${escapeHtml(r.mail_id)}"
        title="Delete this mail — app ledger, mail file, and the site's parsed rows (sales/purchases)"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`;
  }).join('');
  const empty = $('#mm-empty');
  empty.hidden = !!rows.length;
  empty.textContent = 'Nothing uploaded yet — configure a mail folder in Settings, then hit Start Mail Monitor up top.';

  // keep polling while the page is on screen — uploads land whether or not
  // this page (or the monitor) was running when it first rendered
  clearTimeout(mmState.pollTimer);
  mmState.pollTimer = setTimeout(() => {
    if ($('#page-monitor').classList.contains('active')) loadMail();
  }, 10000);
}

async function mmShowRaw(mailId, subject) {
  let raw = '';
  try {
    const res = await api().mail_raw(mailId);
    raw = (res.ok && res.data) || '';
  } catch (_) { /* falls through to the placeholder text */ }
  $('#mm-raw-title').textContent = subject || `Mail ${mailId}`;
  $('#mm-raw-body').textContent = raw
    || 'Raw copy not stored — this mail was uploaded before raw copies were kept '
     + 'and its file is no longer in the mail folder.';
  $('#mm-raw-modal').hidden = false;
}

function initMail() {
  $('[data-refresh="monitor"]').addEventListener('click', () => loadMail());
  // start/stop lives in the header (Start Mail Monitor) — no duplicate here
  $('#mm-raw-close').addEventListener('click', () => { $('#mm-raw-modal').hidden = true; });
  $('#mm-raw-modal').addEventListener('click', (e) => {
    if (e.target === $('#mm-raw-modal')) $('#mm-raw-modal').hidden = true;
  });
  $('#mm-mktest')?.addEventListener('click', async () => {
    try {
      const res = await api().dev_make_test_mail();
      if (res.ok) {
        toast(`Test sale dropped: ${res.data.item} — the monitor picks it up within ~5s`);
        setTimeout(loadMail, 7000); // give the sweep + upload a beat, then show it
      } else {
        toast(res.error || 'Failed to create test mail', false);
      }
    } catch (err) { toast(String(err), false); }
  });
  $('#mm-body').addEventListener('click', async (e) => {
    const delBtn = e.target.closest('.mm-del');
    if (delBtn) {
      if (!confirmArm(delBtn, 'Click again to delete everywhere')) return;
      delBtn.disabled = true;
      try {
        const res = await api().delete_mail(delBtn.dataset.del);
        if (res.ok) {
          const d = res.data || {};
          toast(`Mail deleted — site rows: ${d.sales || 0} sale, ${d.purchases || 0} purchase`
            + (d.restocked ? `, ${d.restocked} restocked` : ''));
          loadMail();
        } else {
          toast(res.error || 'Delete failed', false);
          delBtn.disabled = false;
        }
      } catch (err) { toast(String(err), false); delBtn.disabled = false; }
      return;
    }
    const btn = e.target.closest('.mm-addinv');
    if (!btn) {
      const tr = e.target.closest('tr[data-mailid]');
      if (tr && tr.dataset.hasraw === '1') {
        mmShowRaw(tr.dataset.mailid, tr.children[2]?.textContent);
      }
      return;
    }
    btn.disabled = true;
    try {
      const res = await api().add_inventory_item({ item_name: btn.dataset.item, stocked: 1 });
      if (res.ok) {
        toast(`Added "${btn.dataset.item}" to My Inventory`);
        btn.outerHTML = '<span class="mm-tracked" title="Already in My Inventory"><i class="fa-solid fa-check"></i></span>';
      } else {
        toast(res.error || res.data || 'Add failed', false);
        btn.disabled = false;
      }
    } catch (err) {
      toast(String(err), false);
      btn.disabled = false;
    }
  });
}
