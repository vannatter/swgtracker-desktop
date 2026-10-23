/* Inventory activity — the power-user view of includes/inventory_log.php on the
   site: every change to Stocked and every sale the depletion matcher looked
   at, including the ones it couldn't pin to an item. The matched-sales list
   only ever showed what DID count, so a tracker drifting from the real vendor
   was a guessing game (Philosophy/Eponine).

   Off by default — Settings › Preferences turns it on. Then My Inventory gets
   an Activity button (the whole log, filterable, "Sales nothing counted" being
   the one that finds drift) and each item's Sales dialog gets a History tab. */

const invLogState = { on: false, page: 1, hasNext: false, rows: [], itemRows: [], item: null };

// what each source reads as, and the dropdown's groups of them
const INVLOG_SOURCES = {
  sale: ['Sold', 'counted against this item'],
  unmatched: ['Not counted', 'a sale no tracked item matched'],
  edit: ['Edited', ''],
  bulk: ['Bulk edit', ''],
  restock: ['Restocked', ''],
  create: ['Added', ''],
  delete: ['Removed', ''],
  mail_delete: ['Mail deleted', 'its sale was given back'],
  mail_restore: ['Mail restored', 'its sale counts again'],
};
const INVLOG_FILTERS = {
  '': '',
  unmatched: 'unmatched',
  sale: 'sale',
  edits: 'edit,bulk,restock,create,delete',
  mail: 'mail_delete,mail_restore',
};

function invLogApply(on) {
  invLogState.on = !!on;
  $('#inv-activity').hidden = !invLogState.on;
  // every row's Sales cell opens with it on (History) — re-render to match
  if (typeof invState !== 'undefined' && invState.items.length && !invState.editMode) renderInvRows();
}

async function invLogFetch(params) {
  const res = await apiFetch('GET', 'api/inventory.php', { params: { action: 'log', ...params } });
  if (!res.ok || !res.data || !Array.isArray(res.data.results)) {
    throw new Error(res.error || 'The activity log needs the latest website update');
  }
  return res.data;
}

function invLogStock(r) {
  const b = r.stock_before, a = r.stock_after;
  if (b === null && a === null) return '<span class="stat_off">—</span>';
  const fmt = (v) => (v === null ? '—' : fmtNum(v));
  const delta = b !== null && a !== null ? safeInt(a) - safeInt(b) : null;
  const cls = delta === null ? '' : delta < 0 ? 'invlog-down' : delta > 0 ? 'invlog-up' : '';
  return `<span class="${cls}">${fmt(b)} → ${fmt(a)}</span>`;
}

function invLogDetail(r, idx, where) {
  const parts = [];
  if (r.note) parts.push(escapeHtml(r.note));
  if (r.buyer) {
    // the item column already names the vendor — repeat it only when they differ
    const at = r.sale_type == 2 ? 'Bazaar' : (r.sale_vendor || '');
    const sold = r.sale_timestamp && Math.abs(safeInt(r.sale_timestamp) - safeInt(r.created_at)) > 3600
      ? ` · sold ${fmtAgoTip(r.sale_timestamp)}` : '';
    parts.push(`${escapeHtml(r.buyer)} · <span class="sale-amount">${fmtNum(r.sale_amount)} cr</span>${at && at !== r.vendor ? ` · ${escapeHtml(at)}` : ''}${sold}`);
  } else if (r.sale_id && (r.source === 'sale' || r.source === 'unmatched')) {
    parts.push('<span class="stat_off">mail since deleted</span>');
  }
  if (r.mail_id) {
    parts.push(`<button type="button" class="btn btn-link invlog-link" data-invlog-raw="${escapeHtml(r.mail_id)}" title="Open the original mail">mail</button>`);
  }
  if (r.source === 'unmatched') {
    parts.push(`<button type="button" class="btn btn-link invlog-link" data-invlog-track="${where}:${idx}" title="Add this item to My Inventory — later sales will count against it">Track it</button>`);
  }
  return parts.join(' · ');
}

function invLogTable(rows, where, withItem) {
  if (!rows.length) return '';
  return `<table class="inv-sales-table invlog-table"><thead><tr>
      <th>When</th>${withItem ? '<th>Item</th>' : ''}<th>What</th><th class="col-num">Stocked</th><th>Details</th>
    </tr></thead><tbody>${rows.map((r, i) => {
      const [label, hint] = INVLOG_SOURCES[r.source] || [r.source, ''];
      return `<tr class="invlog-${escapeHtml(r.source)}">
        <td class="invlog-when">${fmtAgoTip(r.created_at)}</td>
        ${withItem ? `<td class="invlog-item">${escapeHtml(r.item_name || '')}${r.vendor ? `<span class="invlog-vendor">${escapeHtml(r.vendor)}</span>` : ''}</td>` : ''}
        <td><span class="invlog-src"${hint ? ` title="${escapeHtml(hint)}"` : ''}>${escapeHtml(label)}</span></td>
        <td class="col-num">${invLogStock(r)}</td>
        <td class="invlog-detail">${invLogDetail(r, i, where)}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

// ── the whole log (My Inventory › Activity) ──
async function invLogLoad() {
  const body = $('#invlog-body');
  body.innerHTML = '<span class="stat_off">Loading…</span>';
  const source = INVLOG_FILTERS[$('#invlog-source').value] || '';
  const q = $('#invlog-q').value.trim();
  try {
    const d = await invLogFetch({ page: invLogState.page, perpage: 50, source, q });
    invLogState.rows = d.results;
    invLogState.hasNext = !!d.has_next;
    $('#invlog-keep').textContent = `Kept ${safeInt(d.keep_days) || 90} days`;
  } catch (e) {
    invLogState.rows = []; invLogState.hasNext = false;
    body.innerHTML = `<span class="stat_off">${escapeHtml(e.message)}</span>`;
    $('#invlog-prev').disabled = $('#invlog-next').disabled = true;
    return;
  }
  const filtered = !!(source || q);
  body.innerHTML = invLogTable(invLogState.rows, 'all', true) || `<div class="empty-state is-compact">${
    $('#invlog-source').value === 'unmatched' && !q
      ? 'Every sale since the log started counted against one of your items.'
      : filtered ? 'Nothing matches these filters.' : 'No activity yet — it starts with the next sale or edit.'}</div>`;
  $('#invlog-page').textContent = invLogState.page > 1 || invLogState.hasNext ? `Page ${invLogState.page}` : '';
  $('#invlog-prev').disabled = invLogState.page <= 1;
  $('#invlog-next').disabled = !invLogState.hasNext;
}

function invLogOpen(preset) {
  invLogState.page = 1;
  $('#invlog-source').value = preset || '';
  $('#invlog-q').value = '';
  $('#invlog-modal').hidden = false;
  invLogLoad();
}

// ── one item's history (the Sales dialog's second tab) ──
async function invLogItemHistory(item) {
  const body = $('#inv-sales-body');
  body.innerHTML = '<span class="stat_off">Loading…</span>';
  try {
    const d = await invLogFetch({ id: safeInt(item.id), perpage: 100 });
    invLogState.itemRows = d.results;
    body.innerHTML = invLogTable(d.results, 'item', false)
      || '<div class="empty-state is-compact">No activity logged for this item yet — the log started recording with the latest website update.</div>';
  } catch (e) {
    body.innerHTML = `<span class="stat_off">${escapeHtml(e.message)}</span>`;
  }
}

// Sales dialog tabs — inventory.js opens it; this adds History when enabled
function invLogSalesTabs(item, renderSales) {
  const tabs = $('#inv-sales-tabs');
  tabs.hidden = !invLogState.on;
  invLogState.item = item;
  tabs.querySelectorAll('.scd-tab').forEach((t) => t.classList.toggle('active', t.dataset.invsalestab === 'sales'));
  tabs.onclick = (e) => {
    const t = e.target.closest('[data-invsalestab]');
    if (!t || t.classList.contains('active')) return;
    tabs.querySelectorAll('.scd-tab').forEach((x) => x.classList.toggle('active', x === t));
    if (t.dataset.invsalestab === 'history') invLogItemHistory(item);
    else renderSales();
  };
}

function initInvLog() {
  try {
    api().get_config().then((cfg) => invLogApply(cfg.ok && cfg.data && cfg.data.inventory_activity)).catch(() => {});
  } catch (_) { /* no bridge — stays off */ }
  const modal = $('#invlog-modal');
  const close = () => { modal.hidden = true; };
  $('#inv-activity').addEventListener('click', () => invLogOpen());
  $('#invlog-close').addEventListener('click', close);
  bindBackdropClose(modal, close);
  modal.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  $('#invlog-source').addEventListener('change', () => { invLogState.page = 1; invLogLoad(); });
  let t = null;
  $('#invlog-q').addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => { invLogState.page = 1; invLogLoad(); }, 300); });
  $('#invlog-prev').addEventListener('click', () => { if (invLogState.page > 1) { invLogState.page--; invLogLoad(); } });
  $('#invlog-next').addEventListener('click', () => { if (invLogState.hasNext) { invLogState.page++; invLogLoad(); } });

  // shared by both views: open the raw mail, or start tracking an unmatched item
  document.addEventListener('click', (e) => {
    const raw = e.target.closest('[data-invlog-raw]');
    if (raw && typeof mmShowRaw === 'function') { mmShowRaw(raw.dataset.invlogRaw); return; }
    const track = e.target.closest('[data-invlog-track]');
    if (!track) return;
    const [where, idx] = track.dataset.invlogTrack.split(':');
    const r = (where === 'item' ? invLogState.itemRows : invLogState.rows)[Number(idx)];
    if (!r) return;
    close();
    $('#inv-sales-modal').hidden = true;
    // a Bazaar sale tracks best as a Bazaar row; a vendor sale under that vendor
    openInvDialog(null, false, { item_name: r.item_name, vendor: r.vendor || '' });
  });
}
