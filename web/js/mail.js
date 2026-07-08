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
  const btn = $('#mm-toggle');
  btn.innerHTML = running
    ? '<i class="fa-solid fa-stop"></i> Stop'
    : '<i class="fa-solid fa-play"></i> Start';
  btn.classList.toggle('btn-accent', !running);
  btn.classList.toggle('btn-outline-secondary', running);

  let rows = [];
  try {
    const res = await api().mail_history(300);
    rows = (res.ok && res.data) || [];
  } catch (_) { /* table empty-state below */ }

  const sales = rows.filter((r) => r.kind === 'sale').length;
  $('#mm-cards').innerHTML = `
    <div class="summary-card"><div class="summary-value">${fmtNum(rows.length)}</div><div class="summary-label">mails uploaded</div></div>
    <div class="summary-card"><div class="summary-value">${fmtNum(sales)}</div><div class="summary-label">vendor sales</div></div>
    <div class="summary-card"><div class="summary-value">${state ? fmtNum(state.uploaded) : '—'}</div><div class="summary-label">this session</div></div>
    <div class="summary-card"><div class="summary-value ${state?.failed ? 'mm-err' : ''}">${state ? fmtNum(state.failed) : '—'}</div><div class="summary-label">failed</div></div>`;

  $('#mm-body').innerHTML = rows.map((r) => {
    // sale detail is "ITEM → BUYER — N credits"; the item is what you may
    // want tracked in My Inventory when it's a type you haven't added yet
    const item = r.kind === 'sale' && r.detail ? r.detail.split(' → ')[0] : '';
    const action = item
      ? `<button class="btn btn-sm btn-outline-secondary mm-addinv" data-item="${escapeHtml(item)}"
           title="Add this item to My Inventory as a new type"><i class="fa-solid fa-plus"></i> Inventory</button>`
      : '';
    return `<tr>
      <td class="col-text">${fmtAgo(r.uploaded_at)}</td>
      <td class="col-text">${MM_KIND[r.kind] || MM_KIND.mail}</td>
      <td class="col-text">${escapeHtml(r.subject || '')}</td>
      <td class="col-name">${escapeHtml(r.detail || '')}</td>
      <td class="col-actions">${action}</td>
    </tr>`;
  }).join('');
  const empty = $('#mm-empty');
  empty.hidden = !!rows.length;
  empty.textContent = 'Nothing uploaded yet — configure a mail folder in Settings and hit Start.';

  clearTimeout(mmState.pollTimer);
  if (running) mmState.pollTimer = setTimeout(loadMail, 10000); // live while monitoring
}

function initMail() {
  $('[data-refresh="monitor"]').addEventListener('click', () => loadMail());
  $('#mm-body').addEventListener('click', async (e) => {
    const btn = e.target.closest('.mm-addinv');
    if (!btn) return;
    btn.disabled = true;
    try {
      const res = await api().add_inventory_item({ item_name: btn.dataset.item, stocked: 1 });
      if (res.ok) {
        toast(`Added "${btn.dataset.item}" to My Inventory`);
        btn.innerHTML = '<i class="fa-solid fa-check"></i> Added';
      } else {
        toast(res.error || res.data || 'Add failed', false);
        btn.disabled = false;
      }
    } catch (err) {
      toast(String(err), false);
      btn.disabled = false;
    }
  });
  $('#mm-toggle').addEventListener('click', async () => {
    const starting = $('#mm-toggle').textContent.trim().startsWith('Start');
    try {
      const res = starting ? await api().start_monitoring() : await api().stop_monitoring();
      if (!res.ok) toast(res.error || res.data || 'Monitor action failed', false);
      setMonitoring(starting && res.ok, res.data);
    } catch (e) {
      toast(String(e), false);
    }
    loadMail();
  });
}
