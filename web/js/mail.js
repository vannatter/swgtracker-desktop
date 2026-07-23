/* Mail page — the monitor's landing: status cards + the uploaded/parsed ledger.
   Upload + server-side parsing happen in src/core/mail_monitor.py; this page
   just shows the receipts. */

const mmState = { pollTimer: null, page: 1, perPage: 50, category: '', character: '' };

const MM_KIND = {
  sale: { cls: 'mm-sale', icon: 'fa-tags', label: 'sale' },
  purchase: { cls: 'mm-purchase', icon: 'fa-cart-shopping', label: 'purchase' },
  banktip: { cls: 'mm-banktip', icon: 'fa-money-bill-transfer', label: 'bank tip' },
  mail: { cls: '', icon: 'fa-envelope', label: 'mail' },
  error: { cls: 'mm-err', icon: 'fa-triangle-exclamation', label: 'error' },
};

// type pill; a parse-status icon (spinner/check) replaces the type icon inside it
function mmKindPill(kind, statusIcon = '') {
  const d = MM_KIND[kind] || MM_KIND.mail;
  return `<span class="mm-kind ${d.cls}">${statusIcon || `<i class="fa-solid ${d.icon}"></i>`} ${d.label}</span>`;
}

// Category labels + display order (keys come from local_db.mail_category).
const MM_CATS = {
  sale: 'Sales',
  purchase: 'Purchases',
  banktip: 'Bank transfers',
  factory: 'Factory',
  'factory-ingredients': 'Factory: no ingredients',
  structure: 'Structure',
  guild: 'Guild',
  other: 'Other',
};
const MM_CAT_ORDER = ['sale', 'purchase', 'banktip', 'factory', 'factory-ingredients', 'structure', 'guild', 'other'];

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
  let total = 0;
  let salesTotal = 0;
  let cats = {};
  let chars = {};
  let tips = null;
  try {
    const res = await api().mail_history(mmState.perPage, (mmState.page - 1) * mmState.perPage, mmState.category, mmState.search, mmState.character);
    const d = res.ok && res.data;
    if (d) { rows = d.rows || []; total = safeInt(d.total); salesTotal = safeInt(d.sales); cats = d.categories || {}; chars = d.characters || {}; tips = d.tips || null; }
  } catch (_) { /* table empty-state below */ }

  // server-side "uploaded but the cron hasn't parsed it yet" set — those rows get
  // a processing badge until the next cron pass (best-effort; ignore on old shells)
  let pendingIds = new Set();
  try {
    const pres = await apiFetch('GET', 'api/mail.php', { params: { action: 'pending' } });
    if (pres.ok && pres.data && Array.isArray(pres.data.pending)) pendingIds = new Set(pres.data.pending);
  } catch (_) { /* badge just doesn't show */ }

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

  const card = (cls, icon, val, label, tip = '') => `
    <div class="mm-card ${cls}"${tip ? ` title="${escapeHtml(tip)}"` : ''}>
      <div class="mm-card-ico"><i class="fa-solid ${icon}"></i></div>
      <div><div class="mm-card-val">${val}</div><div class="mm-card-label">${label}</div></div>
    </div>`;
  // the fun stat: total surcharge burned on bank tips you SENT (5% each)
  const feeCard = tips && tips.fees > 0
    ? card('fee', 'fa-hand-holding-dollar', fmtShort(tips.fees), 'Wasted on tip fees',
           `${fmtNum(tips.sent)} cr sent over ${fmtNum(tips.sent_count)} bank tips · ${fmtNum(tips.received)} cr received`)
    : '';
  $('#mm-cards').innerHTML =
    card('', 'fa-envelope', fmtNum(total), 'Mails uploaded')
    + card('sale', 'fa-tags', fmtNum(salesTotal), 'Vendor sales')
    + feeCard
    + card('session', 'fa-bolt', state ? fmtNum(state.uploaded) : '—', 'This session')
    + card(`fail ${state?.failed ? 'bad' : ''}`, 'fa-triangle-exclamation',
           state ? fmtNum(state.failed) : '—', 'Failed');

  // Category dropdown (with counts) + a mass-delete for the current filter.
  // The search input is static markup, so polling never clobbers what you type.
  const totalAll = Object.values(cats).reduce((a, b) => a + b, 0);
  const opt = (key, label, n) =>
    `<option value="${escapeHtml(key)}"${mmState.category === key ? ' selected' : ''}>`
    + `${escapeHtml(label)}${n != null ? ` (${fmtNum(n)})` : ''}</option>`;
  let opts = opt('', 'All categories', totalAll);
  for (const key of MM_CAT_ORDER) {
    if (cats[key]) opts += opt(key, MM_CATS[key] || key, cats[key]);
  }
  $('#mm-category').innerHTML = opts;
  // character filter — appears once mails carry a character (folder label / mail_<Name>)
  const charNames = Object.keys(chars).sort((a, b) => a.localeCompare(b));
  const charSel = $('#mm-charfilter');
  charSel.hidden = charNames.length === 0;
  charSel.innerHTML = [opt.call(null, '', 'All characters', null)]
    .concat(charNames.map((n) => `<option value="${escapeHtml(n)}"${mmState.character === n ? ' selected' : ''}>${escapeHtml(n)} (${fmtNum(chars[n])})</option>`))
    .join('');
  // mass-delete appears whenever a filter (category or search) narrows the list
  const filtered = mmState.category || mmState.search || mmState.character;
  $('#mm-massdel-slot').innerHTML = (filtered && total)
    ? `<button class="mm-massdel" data-massdel="1"><i class="fa-solid fa-trash"></i> Delete all ${fmtNum(total)} matching</button>`
    : '';

  $('#mm-body').innerHTML = rows.map((r) => {
    // sale detail is "ITEM → BUYER — N credits"; the item is what you may
    // want tracked in My Inventory when it's a type you haven't added yet
    const item = r.kind === 'sale' && r.detail ? r.detail.split(' → ')[0] : '';
    const tracked = item && invNames && invNames.has(item.trim().toLowerCase());
    const action = !item ? '' : tracked
      ? '<span class="mm-tracked" title="Already in My Inventory"><i class="fa-solid fa-check"></i></span>'
      : `<button class="mm-addinv" data-item="${escapeHtml(item)}"
           title="Add to My Inventory as a new type"><i class="fa-solid fa-square-plus"></i></button>`;
    // status folds into the Type cell — only sale/purchase mails have a server
    // parse state: spinning yellow while pending, green check once processed
    const status = (r.kind === 'sale' || r.kind === 'purchase')
      ? (pendingIds.has(r.mail_id)
        ? '<i class="fa-solid fa-circle-notch fa-spin mm-st-pend" title="Uploaded — the server parses it into My Sales / My Purchases within a few minutes"></i>'
        : '<i class="fa-solid fa-circle-check mm-st-done" title="Parsed into My Sales / My Purchases"></i>')
      : '';
    return `<tr class="${r.has_raw ? 'mm-row-openable' : ''}" data-mailid="${escapeHtml(r.mail_id)}"
        data-hasraw="${r.has_raw ? 1 : 0}" title="${r.has_raw ? 'Click to read the original mail' : ''}">
      <td class="col-text">${r.character ? escapeHtml(r.character) : '<span class="stat_off">—</span>'}</td>
      <td class="col-text mm-typecell">${mmKindPill(r.kind, status)}</td>
      <td class="col-text">${fmtAgoTip(r.sent_at || r.uploaded_at)}</td>
      <td class="col-text">${escapeHtml(r.subject || '')}</td>
      <td class="col-name">${escapeHtml(r.detail || '')}</td>
      <td class="col-actions"><span class="mm-slot">${action}</span><button class="mm-del" data-del="${escapeHtml(r.mail_id)}"
        title="Delete this mail — app ledger, mail file, and the site's parsed rows (sales/purchases)"><i class="fa-solid fa-trash"></i></button></td>
    </tr>`;
  }).join('');
  const empty = $('#mm-empty');
  empty.hidden = !!rows.length;
  empty.textContent = 'Nothing uploaded yet — configure a mail folder in Settings, then hit Start Mail Monitor up top.';

  const pages = Math.max(1, Math.ceil(total / mmState.perPage));
  if (mmState.page > pages) mmState.page = pages; // deletions can shrink the tail
  $('#mm-status').textContent = total ? `Page ${mmState.page} of ${pages} — ${fmtNum(total)} mails` : '';
  $('#mm-prev').disabled = mmState.page <= 1;
  $('#mm-next').disabled = mmState.page >= pages;

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
  $('#mm-prev').addEventListener('click', () => { if (mmState.page > 1) { mmState.page--; loadMail(); } });
  $('#mm-next').addEventListener('click', () => { mmState.page++; loadMail(); });
  // start/stop lives in the header (Start Mail Monitor) — no duplicate here
  $('#mm-raw-close').addEventListener('click', () => { $('#mm-raw-modal').hidden = true; });
  bindBackdropClose($('#mm-raw-modal'), () => { $('#mm-raw-modal').hidden = true; });
  $('#mm-mktest')?.addEventListener('click', async () => {
    try {
      const res = await api().dev_make_test_mail();
      if (res.ok) {
        toast(`Dropped ${res.data.files ? res.data.files.length : 4} test mails: sale (${res.data.item}), purchase (${res.data.purchase}), misc, `
          + `${res.data.harvester ? `harvester (${res.data.harvester})` : 'and more'} — monitor picks them up within ~5s`);
        setTimeout(loadMail, 7000); // give the sweep + upload a beat, then show it
      } else {
        toast(res.error || 'Failed to create test mail', false);
      }
    } catch (err) { toast(String(err), false); }
  });
  // Category dropdown + subject search + mass-delete for the current filter
  $('#mm-category').addEventListener('change', () => {
    mmState.category = $('#mm-category').value; mmState.page = 1; loadMail();
  });
  $('#mm-charfilter').addEventListener('change', () => {
    mmState.character = $('#mm-charfilter').value; mmState.page = 1; loadMail();
  });
  let mmSearchTimer = null;
  $('#mm-search').addEventListener('input', () => {
    clearTimeout(mmSearchTimer);
    mmSearchTimer = setTimeout(() => {
      mmState.search = $('#mm-search').value.trim(); mmState.page = 1; loadMail();
    }, 300);
  });
  $('#mm-massdel-slot').addEventListener('click', async (e) => {
    const massdel = e.target.closest('[data-massdel]');
    if (!massdel) return;
    if (!confirmArm(massdel, 'Click again to delete ALL matching')) return;
    massdel.disabled = true;
    const orig = massdel.innerHTML;
    massdel.innerHTML = '<span class="spinner"></span> Deleting…'; // it can take a few seconds — show it's working
    try {
      const res = await api().delete_mail_matching(mmState.category, mmState.search, mmState.character);
      if (res.ok) {
        const d = res.data || {};
        toast(`Deleted ${fmtNum(d.deleted)} mail${d.deleted === 1 ? '' : 's'}`
          + (d.failed ? `, ${d.failed} failed` : ''));
        mmState.category = ''; mmState.search = ''; mmState.character = ''; mmState.page = 1;
        $('#mm-search').value = '';
        loadMail(); // rebuilds the button
      } else { toast(res.error || 'Bulk delete failed', false); massdel.disabled = false; massdel.innerHTML = orig; }
    } catch (err) { toast(String(err), false); massdel.disabled = false; massdel.innerHTML = orig; }
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
        mmShowRaw(tr.dataset.mailid, tr.children[3]?.textContent);
      }
      return;
    }
    btn.disabled = true;
    try {
      // pull the vendor out of the original mail ("Vendor: X has sold …") so the
      // inventory row records where it sold — go through the gateway to carry it
      let vendor = '';
      const tr = btn.closest('tr[data-mailid]');
      if (tr && tr.dataset.hasraw === '1') {
        try {
          const raw = await api().mail_raw(tr.dataset.mailid);
          const m = /Vendor:\s*(.+?)\s+has sold /.exec((raw.ok && raw.data) || '');
          if (m) vendor = m[1].trim();
        } catch (_) { /* just add without a vendor */ }
      }
      const res = await apiFetch('POST', 'api/inventory.php', { data: {
        item_name: btn.dataset.item, vendor, stocked: 1,
      } });
      if (res.ok) {
        toast(`Added "${btn.dataset.item}"${vendor ? ` (${vendor})` : ''} to My Inventory`);
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
