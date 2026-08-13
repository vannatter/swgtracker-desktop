/* My Customers — customer-first view over parsed sales (api/customers.php).
   The list ranks customers by Score (percentile blend of recency, frequency
   and credits within YOUR customer base); rows drill into a scorecard.
   Grouping / tagging / selection ride the standard shared machinery. */

const mycState = { items: [], sortField: 'score', sortOrder: 'DESC',
                    groups: [], grpCollapsed: new Set(), tagFilter: null,
                    checked: new Set(), lastSel: null,
                    card: null };  // customer name open in the scorecard

const MYC_COLUMNS = [
  ['Customer', 'name', 'col-name'],
  ['Score', 'score', 'stat', 'Recency + frequency + credits, percentile-ranked within your own customers'],
  ['Purchases', 'purchases', 'stat'],
  ['Total credits', 'total', 'col-num'],
  ['Avg sale', 'avg', 'col-num'],
  ['Items', 'distinct_items', 'stat'],
  ['Last purchase', 'last_ts', 'col-text'],
];
const MYC_NUMERIC = new Set(['score', 'purchases', 'total', 'avg', 'distinct_items', 'last_ts']);
const mycColCount = () => MYC_COLUMNS.length + 2; // select + trailing pin-cell

const mycTags = (c) => String(c.tags || '').split(',').map((t) => t.trim()).filter(Boolean);

// THE score — insScoreBuyers, the same formula Sales Insights uses, over the
// full all-time customer set. One formula, one number everywhere.
function mycComputeScores() {
  const mapped = mycState.items.map((c) => ({
    name: c.name, full_name: c.full_name,
    total: safeInt(c.total), count: safeInt(c.purchases),
    avg: Math.round(safeInt(c.total) / Math.max(1, safeInt(c.purchases))),
    first: safeInt(c.first_ts), last: safeInt(c.last_ts),
  }));
  const since = mapped.reduce((m, b) => (b.first && b.first < m ? b.first : m), Math.floor(Date.now() / 1000));
  mycState.scored = insScoreBuyers(mapped, since);
  const byName = new Map(mycState.scored.map((b) => [b.name, b]));
  mycState.items.forEach((c) => {
    const b = byName.get(c.name);
    c.avg = b ? b.avg : 0;
    c.score = b ? b.score : 0;
    c.tier = b ? b.tier : 'One-time';
  });
}

function buildMycHeader() {
  $('#cust-head').innerHTML =
    '<th class="pin-cell"><input type="checkbox" id="cust-selall" title="Select every visible customer"></th>'
    + sortableHeaderHtml(MYC_COLUMNS, mycState.sortField, mycState.sortOrder)
    + '<th class="pin-cell"></th>';
}

function mycVisibleItems() {
  const q = $('#cust-search').value.trim().toLowerCase();
  let items = mycState.items;
  if (mycState.tagFilter) items = items.filter((c) => mycTags(c).includes(mycState.tagFilter));
  if (q) items = items.filter((c) => String(c.name || '').toLowerCase().includes(q)
    || String(c.full_name || '').toLowerCase().includes(q)
    || String(c.tags || '').toLowerCase().includes(q));
  const { sortField, sortOrder } = mycState;
  const dir = sortOrder === 'DESC' ? -1 : 1;
  return [...items].sort((a, b) => {
    if (MYC_NUMERIC.has(sortField)) return dir * (safeInt(a[sortField]) - safeInt(b[sortField]));
    return dir * String(a[sortField] ?? '').toLowerCase().localeCompare(String(b[sortField] ?? '').toLowerCase());
  });
}

function mycRowHtml(c) {
  const tags = mycTags(c);
  return `<tr data-cname="${escapeHtml(c.name)}"${mycState.groups.length ? ' draggable="true"' : ''}>
    <td class="pin-cell cust-sel-cell"><input type="checkbox" class="cust-sel" data-selid="${escapeHtml(c.name)}"${mycState.checked.has(c.name) ? ' checked' : ''}></td>
    <td class="col-name res-name"><span class="stk-tagslot">${tags.length
      ? `<i class="fa-solid fa-tag stk-tagind" title="${escapeHtml(tags.join(', '))}"></i>` : ''}</span>${escapeHtml(c.full_name || c.name)}</td>
    <td class="stat"><span class="ins-tier ${INS_TIER_CLASS[c.tier] || ''}">${safeInt(c.score)}</span> ${escapeHtml(c.tier || '')}</td>
    <td class="stat">${fmtNum(c.purchases)}</td>
    <td class="col-num sale-amount">${fmtNum(c.total)} cr</td>
    <td class="col-num">${fmtNum(c.avg)} cr</td>
    <td class="stat">${fmtNum(c.distinct_items)}</td>
    <td class="col-text">${fmtAgoTip(c.last_ts)}</td>
    <td class="pin-cell"></td>
  </tr>`;
}

function mycSyncSel() {
  const vis = mycVisibleItems().map((c) => c.name);
  const on = vis.filter((n) => mycState.checked.has(n)).length;
  const all = $('#cust-selall');
  if (all) {
    all.checked = vis.length > 0 && on === vis.length;
    all.indeterminate = on > 0 && on < vis.length;
  }
  const n = mycState.checked.size;
  $('#cust-selbar').hidden = !n;
  if (n) $('#cust-selbar-n').textContent = `${n} selected`;
  document.querySelectorAll('#cust-body [data-grpselect]').forEach((cb) => {
    const key = cb.dataset.grpselect;
    const members = mycState.items.filter((c) =>
      (c.group_id != null && String(c.group_id) !== '0' ? String(c.group_id) : 'un') === key);
    const sel = members.filter((c) => mycState.checked.has(c.name)).length;
    cb.checked = members.length > 0 && sel === members.length;
    cb.indeterminate = sel > 0 && sel < members.length;
  });
}

function renderMyCustomers(statusMsg) {
  buildMycHeader();
  const items = mycVisibleItems();
  const sections = grpSections(mycState.groups, items, (c) => c.group_id);
  const spacer = `<tr class="stk-group-gap"><td colspan="${mycColCount()}"></td></tr>`;
  const parts = [];
  sections.forEach((sec) => {
    const collapsed = mycState.grpCollapsed.has(sec.key);
    if (sec.key !== 'un' || sections.length > 1) {
      if (parts.length) parts.push(spacer);
      parts.push(grpTableHeaderHtml(sec.key, sec.name, sec.items.length, collapsed, sec.key !== 'un', mycColCount(), 'pin-cell', sec.key !== 'un', true));
    }
    if (!collapsed) parts.push(...sec.items.map(mycRowHtml));
  });
  $('#cust-body').innerHTML = parts.join('');

  const empty = $('#cust-empty');
  empty.hidden = !!items.length;
  if (!items.length) {
    empty.textContent = mycState.items.length
      ? 'No matching customers.'
      : 'No customers yet — they appear as your vendor sales get parsed from mail.';
  }
  $('#cust-status').textContent = statusMsg
    || `${items.length}${items.length === mycState.items.length ? '' : ` of ${mycState.items.length}`} customers`;

  const allTags = [...new Set(mycState.items.flatMap(mycTags))];
  if (mycState.tagFilter && !allTags.includes(mycState.tagFilter)) mycState.tagFilter = null;
  const tagbar = $('#cust-tagbar');
  tagbar.hidden = !allTags.length;
  tagbar.innerHTML = allTags.length
    ? '<span class="fac-tagbar-label"><i class="fa-solid fa-tags"></i></span>'
      + allTags.map((t) => `<span class="fac-tag${mycState.tagFilter === t ? ' active' : ''}"
          data-custtag="${escapeHtml(t)}">${escapeHtml(t)}</span>`).join('')
    : '';
  mycSyncSel();
}

async function loadMyCustomers() {
  showGridLoading('#cust-loading');
  const [res, groups] = await Promise.all([
    apiFetch('GET', 'api/customers.php').catch((e) => ({ ok: false, error: String(e) })),
    grpList('customer'),
  ]);
  mycState.groups = groups || [];
  $('#cust-loading').hidden = true;
  if (!res.ok || !res.data) {
    $('#cust-empty').hidden = false;
    $('#cust-empty').textContent = `Couldn't load customers: ${res.error || 'server error'} — the site may need its update deployed.`;
    checkAuthError(res.error);
    return;
  }
  mycState.items = res.data.customers || [];
  mycComputeScores();
  renderMyCustomers(`Synced ${mycState.items.length} customers`);
}

// ---- scorecard -------------------------------------------------------------

async function openMycCard(name) {
  mycState.card = name;
  const c = mycState.items.find((x) => x.name === name);
  // never land on a blank page — no scored entry means nothing to show
  if (!c || !(mycState.scored || []).some((b) => b.name === name)) {
    toast(`No sales recorded for ${name} yet`, false);
    return;
  }
  showPage('customer');
  $('#custd-crumbs').innerHTML =
    '<a role="button" data-nav="customers">My Customers</a>'
    + `<span class="crumb-sep">›</span><span class="crumb-current">${escapeHtml(c?.full_name || name)}</span>`;

  // the SAME scorecard card Insights shows, mounted in this page instead of
  // the modal — seeded with this list's scored set so the numbers match here
  insState.custScored = mycState.scored || [];
  openInsCustCard(name, 'page');

  // notes ride the customers meta (page-only extra under the card)
  $('#custd-notes').hidden = true;
  try {
    const res = await apiFetch('GET', 'api/customers.php', { params: { customer: name } });
    if (mycState.card !== name) return;
    mycState.cardMeta = (res.ok && res.data && res.data.meta) || {};
    mycdRenderNotes();
  } catch (_) { /* notes just stay hidden */ }
}

function mycdRenderNotes() {
  const el = $('#custd-notes');
  const notes = mycState.cardMeta?.notes || '';
  el.hidden = false;
  el.innerHTML = labNotesText(notes)
    ? `<div class="mysd-notes-body" data-custdnotes title="Click to edit notes">${labNotesHtml(notes)}</div>`
    : '<a role="button" class="mysd-notes-add" data-custdnotes><i class="fa-regular fa-note-sticky"></i> Add notes</a>';
}

function initMyCustomers() {
  buildMycHeader();
  $('#cust-search').addEventListener('input', () => renderMyCustomers());
  $('[data-refresh="customers"]').addEventListener('click', () => loadMyCustomers());

  $('#cust-head').addEventListener('click', (e) => {
    const th = e.target.closest('[data-sort]');
    if (!th) return;
    const field = th.dataset.sort;
    if (mycState.sortField === field) {
      mycState.sortOrder = mycState.sortOrder === 'DESC' ? 'ASC' : 'DESC';
    } else {
      mycState.sortField = field;
      mycState.sortOrder = field === 'name' ? 'ASC' : 'DESC';
    }
    renderMyCustomers();
  });
  $('#cust-head').addEventListener('change', (e) => {
    if (!e.target.closest('#cust-selall')) return;
    const vis = mycVisibleItems().map((c) => c.name);
    if (e.target.checked) vis.forEach((n) => mycState.checked.add(n));
    else vis.forEach((n) => mycState.checked.delete(n));
    renderMyCustomers();
  });

  // folders: create + the shared gold-standard wiring
  $('#cust-newgroup').addEventListener('click', async () => {
    const res = await grpApi({ action: 'create', kind: 'customer' });
    if (!res.ok || !res.data) { toast(res.error || 'Could not create group — site update pending?', false); return; }
    mycState.groups.push({ id: res.data.id, name: res.data.name, sort_order: res.data.sort_order });
    renderMyCustomers();
    grpBeginRename('#cust-body', String(res.data.id),
      mycState.groups[mycState.groups.length - 1], renderMyCustomers);
  });
  grpWireGroups('#cust-body', {
    groups: () => mycState.groups,
    collapsed: () => mycState.grpCollapsed,
    render: renderMyCustomers,
    onDelete: (key) => {
      const gid = safeInt(key);
      grpApi({ action: 'remove', id: gid }).then((res) => {
        if (!res.ok) return;
        mycState.groups = mycState.groups.filter((g) => g.id !== gid);
        mycState.items.forEach((c) => { if (Number(c.group_id) === gid) c.group_id = null; });
        renderMyCustomers();
      });
    },
  });

  // checkbox selection: shift ranges, group-select, bulk Add tags
  $('#cust-body').addEventListener('click', (e) => {
    const cb = e.target.closest('.cust-sel');
    if (!cb) return;
    const name = cb.dataset.selid;
    if (e.shiftKey && mycState.lastSel && mycState.lastSel !== name) {
      const vis = mycVisibleItems().map((c) => c.name);
      const a = vis.indexOf(mycState.lastSel), b = vis.indexOf(name);
      if (a >= 0 && b >= 0) {
        const on = cb.checked;
        vis.slice(Math.min(a, b), Math.max(a, b) + 1)
          .forEach((n) => { if (on) mycState.checked.add(n); else mycState.checked.delete(n); });
        renderMyCustomers();
        mycState.lastSel = name;
        return;
      }
    }
    if (cb.checked) mycState.checked.add(name);
    else mycState.checked.delete(name);
    mycState.lastSel = name;
    mycSyncSel();
  });
  $('#cust-body').addEventListener('change', (e) => {
    const gs = e.target.closest('[data-grpselect]');
    if (!gs) return;
    mycState.items.filter((c) =>
      (c.group_id != null && String(c.group_id) !== '0' ? String(c.group_id) : 'un') === gs.dataset.grpselect)
      .forEach((c) => {
        if (gs.checked) mycState.checked.add(c.name);
        else mycState.checked.delete(c.name);
      });
    renderMyCustomers();
  });
  $('#cust-bulk-apply').addEventListener('click', async () => {
    const addTags = $('#cust-bulk-tags').value.trim();
    if (!addTags || !mycState.checked.size) return;
    const rows = mycState.items.filter((c) => mycState.checked.has(c.name));
    const results = await Promise.all(rows.map((c) => {
      c.tags = mergeTags(c.tags, addTags);
      return apiFetch('PUT', 'api/customers.php',
        { data: { customer_name: c.name, tags: c.tags } }).catch((err) => ({ ok: false, error: String(err) }));
    }));
    const failed = results.filter((r) => !r.ok).length;
    if (failed) { toast(`${failed} tag update${failed > 1 ? 's' : ''} failed — site update pending?`, false); return; }
    toast(`Tagged ${rows.length} customer${rows.length === 1 ? '' : 's'}`);
    mycState.checked.clear();
    $('#cust-bulk-tags').value = '';
    renderMyCustomers();
  });
  $('#cust-bulk-tags').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#cust-bulk-apply').click(); });
  $('#cust-sel-clear').addEventListener('click', () => {
    mycState.checked.clear();
    renderMyCustomers();
  });

  // tag chips filter
  $('#cust-tagbar').addEventListener('click', (e) => {
    const t = e.target.closest('[data-custtag]');
    if (!t) return;
    mycState.tagFilter = mycState.tagFilter === t.dataset.custtag ? null : t.dataset.custtag;
    renderMyCustomers();
  });

  // drag rows into folders — checked selection files together
  $('#cust-body').addEventListener('dragstart', (e) => {
    const el = e.target.closest('tr[data-cname]');
    if (!el) return;
    if (e.target.closest('.cust-sel-cell')) { e.preventDefault(); return; }
    el.classList.add('cust-dragging');
    if (mycState.checked.has(el.dataset.cname) && mycState.checked.size > 1) {
      const ghost = document.createElement('div');
      ghost.className = 'stk-drag-ghost';
      ghost.textContent = `${mycState.checked.size} customers`;
      document.body.appendChild(ghost);
      e.dataTransfer.setDragImage(ghost, -12, -8);
      setTimeout(() => ghost.remove(), 0);
    }
  });
  $('#cust-body').addEventListener('dragover', (e) => {
    const dragging = document.querySelector('#cust-body tr.cust-dragging');
    if (!dragging) return;
    e.preventDefault();
    const hd = e.target.closest('tr[data-grpkey]');
    if (hd) { hd.parentNode.insertBefore(dragging, hd.nextSibling); return; }
    const over = e.target.closest('tr[data-cname]');
    if (over && over !== dragging) {
      const rect = over.getBoundingClientRect();
      over.parentNode.insertBefore(dragging, e.clientY < rect.top + rect.height / 2 ? over : over.nextSibling);
    }
  });
  $('#cust-body').addEventListener('dragend', async () => {
    const dragging = document.querySelector('#cust-body tr.cust-dragging');
    if (!dragging) return;
    dragging.classList.remove('cust-dragging');
    const item = mycState.items.find((c) => c.name === dragging.dataset.cname);
    let p = dragging.previousElementSibling;
    while (p && !p.hasAttribute('data-grpkey')) p = p.previousElementSibling;
    const key = p ? p.dataset.grpkey : 'un';
    if (item) {
      const gid = key === 'un' ? null : safeInt(key);
      const ids = mycState.checked.has(item.name) && mycState.checked.size > 1
        ? [...mycState.checked] : [item.name];
      const movers = mycState.items.filter((c) => ids.includes(c.name) && (c.group_id || null) !== gid);
      movers.forEach((c) => { c.group_id = gid; }); // optimistic
      const results = await Promise.all(movers.map((c) =>
        apiFetch('PUT', 'api/customers.php', { data: { customer_name: c.name, group_id: gid } })
          .catch((err) => ({ ok: false, error: String(err) }))));
      const failed = results.filter((r) => !r.ok).length;
      if (failed) toast(`${failed} customer${failed > 1 ? 's' : ''} could not move — site update pending?`, false);
      else if (movers.length > 1) toast(`Filed ${movers.length} customers`);
    }
    renderMyCustomers();
  });

  // rows open the scorecard (checkbox / header rows keep their own behavior)
  $('#cust-body').addEventListener('click', (e) => {
    if (e.target.closest('.cust-sel-cell, tr[data-grpkey], .grp-rename-input, input, button, a')) return;
    const row = e.target.closest('tr[data-cname]');
    if (row) openMycCard(row.dataset.cname);
  });

  // scorecard interactions
  $('#custd-crumbs').addEventListener('click', (e) => {
    const link = e.target.closest('[data-nav]');
    if (link) showPage(link.dataset.nav);
  });
  $('#custd-notes').addEventListener('click', (e) => {
    if (!e.target.closest('[data-custdnotes]') || !mycState.card) return;
    $('#cust-note-title').textContent = mycState.card;
    $('#cust-note-text').innerHTML = labNotesHtml(mycState.cardMeta?.notes || '');
    $('#cust-note-modal').hidden = false;
    $('#cust-note-text').focus();
  });
  $('#cust-note-save').addEventListener('click', async () => {
    $('#cust-note-modal').hidden = true;
    if (!mycState.card) return;
    const notes = richNotesValue($('#cust-note-text'));
    mycState.cardMeta = { ...(mycState.cardMeta || {}), notes };
    mycdRenderNotes();
    const res = await apiFetch('PUT', 'api/customers.php',
      { data: { customer_name: mycState.card, notes } });
    if (!res.ok) toast(res.error || 'Failed to save notes — site update pending?', false);
  });
  $('#cust-note-cancel').addEventListener('click', () => { $('#cust-note-modal').hidden = true; });
  wireRichToolbar($('#cust-note-modal'));
  bindBackdropClose($('#cust-note-modal'), () => { $('#cust-note-modal').hidden = true; });
}
