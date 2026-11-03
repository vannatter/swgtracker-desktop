/* Ideas board — development ideas players post and upvote, plus the dev's own
   roadmap items (api/ideas.php; the website's /ideas.php mirrors this page).
   Authors edit/delete their own idea while it's Open; admins (role 99) set
   status, pin, post as Dev, and delete anything. Each idea has a comment
   thread (shared entity_comments store, kind 'idea'); admin replies read as Dev. */

const IDEA_STATUS_LABELS = { open: 'Open', planned: 'Planned', progress: 'In progress', shipped: 'Shipped', declined: 'Declined' };
const IDEA_CATEGORIES = ['Crafting', 'Resources', 'Sales & Inventory', 'Beasts', 'Galaxy', 'App', 'Website', 'Other'];

const ideaState = { ideas: [], main: [], shipped: [], shippedOpen: false, me: { signed_in: false, admin: false }, editId: null, expanded: new Set(), loading: false,
                    threadOpen: new Set(),   // idea ids with their comment thread showing
                    threads: new Map() };    // idea id -> { loading, comments, draft } — drafts survive repaints

// ---- comment threads ----------------------------------------------------------
function ideaThreadHtml(id) {
  const th = ideaState.threads.get(id) || { loading: true, comments: [], draft: '' };
  const list = th.loading ? '<div class="idea-cmt-empty"><span class="spinner"></span> Loading comments…</div>'
    : th.comments.length ? th.comments.map((c) => `<div class="idea-cmt">
        <div class="idea-cmt-head">
          ${c.dev ? '<span class="idea-dev" title="The developer">Dev</span>' : `<span class="idea-cmt-by">${escapeHtml(c.by)}</span>`}
          <span class="idea-cmt-at">${fmtAgoTip(c.at)}</span>
          ${c.can_delete ? `<button class="btn btn-icon idea-cmt-del" data-icmtdel="${safeInt(c.id)}" data-icmtidea="${id}" title="Delete comment"><i class="fa-solid fa-trash-can"></i></button>` : ''}
        </div>
        <div class="idea-cmt-body">${escapeHtml(c.body)}</div>
      </div>`).join('')
    : '<div class="idea-cmt-empty">No comments yet.</div>';
  const form = ideaState.me.signed_in
    ? `<div class="idea-cmt-form">
        <textarea class="form-control idea-cmt-input" data-icmtinput="${id}" maxlength="2000" rows="2"
          placeholder="Add a comment… (⌘/Ctrl+Enter posts)">${escapeHtml(th.draft || '')}</textarea>
        <button class="btn btn-sm btn-accent" data-icmtpost="${id}"><i class="fa-solid fa-paper-plane"></i> Post</button>
      </div>`
    : '<div class="idea-cmt-empty">Add your user key in Settings to comment.</div>';
  return `<div class="idea-thread" data-ithread="${id}">${list}${form}</div>`;
}

async function ideaLoadThread(id) {
  const th = ideaState.threads.get(id) || { draft: '' };
  ideaState.threads.set(id, { ...th, loading: true, comments: th.comments || [] });
  renderIdeas();
  let res;
  try { res = await apiFetch('GET', 'api/ideas.php', { params: { comments: safeInt(id) } }); } catch (e) { res = { ok: false, error: String(e) }; }
  const cur = ideaState.threads.get(id);
  cur.loading = false;
  if (!res.ok) { toast(res.error || 'Couldn’t load comments', false); cur.comments = []; }
  else cur.comments = (res.data && res.data.comments) || [];
  // the card's count follows what's really there
  const it = ideaState.ideas.find((i) => String(i.id) === id);
  if (it && res.ok) it.comment_count = cur.comments.length;
  renderIdeas();
}

async function ideaPostComment(id) {
  const th = ideaState.threads.get(id);
  const body = (th && th.draft || '').trim();
  if (body.length < 2) { toast('Write something first', false); return; }
  const btn = document.querySelector(`[data-icmtpost="${id}"]`);
  if (btn) btn.disabled = true;
  let res;
  try { res = await apiFetch('POST', 'api/ideas.php', { data: { action: 'comment', id: safeInt(id), body } }); } catch (e) { res = { ok: false, error: String(e) }; }
  if (btn) btn.disabled = false;
  if (!res.ok) { toast(res.error || 'Couldn’t post the comment', false); checkAuthError(res.error); return; }
  th.comments.push(res.data.comment);
  th.draft = '';
  const it = ideaState.ideas.find((i) => String(i.id) === id);
  if (it) it.comment_count = th.comments.length;
  renderIdeas();
}

async function ideaDeleteComment(ideaId, cid) {
  const ok = await confirmDialog({ title: 'Delete this comment?', message: 'It will be removed from the thread. This can\'t be undone.', confirmLabel: 'Delete' });
  if (!ok) return;
  let res;
  try { res = await apiFetch('POST', 'api/ideas.php', { data: { action: 'uncomment', id: safeInt(cid) } }); } catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) { toast(res.error || 'Couldn’t delete the comment', false); return; }
  const th = ideaState.threads.get(ideaId);
  if (th) th.comments = th.comments.filter((c) => String(c.id) !== String(cid));
  const it = ideaState.ideas.find((i) => String(i.id) === ideaId);
  if (it && th) it.comment_count = th.comments.length;
  renderIdeas();
}

function ideaStatusPill(st) {
  return `<span class="idea-status idea-st-${escapeHtml(st)}">${escapeHtml(IDEA_STATUS_LABELS[st] || st)}</span>`;
}

function ideaCardHtml(it) {
  const id = String(it.id);
  const desc = String(it.description || '');
  const long = desc.length > 240 || desc.split('\n').length > 3;
  const open = ideaState.expanded.has(id);
  const admin = ideaState.me.admin;
  return `<div class="idea-card${it.pinned ? ' idea-pinned' : ''}" data-iid="${id}">
    <button class="idea-vote${it.voted ? ' voted' : ''}" data-ivote="${id}"
      title="${ideaState.me.signed_in ? (it.voted ? 'Remove your vote' : 'Upvote this idea') : 'Add your key in Settings to vote'}">
      <i class="fa-solid fa-caret-up"></i><span>${fmtNum(it.votes)}</span></button>
    <div class="idea-body">
      <div class="idea-title-row">
        ${it.pinned ? '<i class="fa-solid fa-thumbtack idea-pin-ico" title="Pinned"></i>' : ''}
        <span class="idea-title">${escapeHtml(it.title)}</span>
        ${it.is_dev ? '<span class="idea-dev" title="Posted by the developer">Dev</span>' : ''}
      </div>
      <div class="idea-meta">
        ${ideaStatusPill(it.status)}
        <span class="idea-cat">${escapeHtml(it.category)}</span>
        <span class="idea-by">by ${escapeHtml(it.by)} · ${fmtAgoTip(it.created)}</span>
        <button class="idea-cmt-btn${ideaState.threadOpen.has(id) ? ' active' : ''}" data-icmt="${id}"
          title="${ideaState.threadOpen.has(id) ? 'Hide comments' : 'Show comments'}"><i class="fa-${safeInt(it.comment_count) ? 'solid' : 'regular'} fa-comment"></i>
          ${safeInt(it.comment_count) ? fmtNum(it.comment_count) : 'Comment'}</button>
      </div>
      ${desc ? `<div class="idea-desc${long && !open ? ' idea-clamp' : ''}">${escapeHtml(desc)}</div>
        ${long ? `<button class="idea-more" data-imore="${id}">${open ? 'Show less' : 'Show more'}</button>` : ''}` : ''}
      ${ideaState.threadOpen.has(id) ? ideaThreadHtml(id) : ''}
    </div>
    <div class="idea-actions">
      ${admin ? `<select class="form-select filter-select idea-st-sel" data-istatus="${id}" title="Set status">
          ${Object.entries(IDEA_STATUS_LABELS).map(([k, l]) => `<option value="${k}"${k === it.status ? ' selected' : ''}>${l}</option>`).join('')}
        </select>
        <button class="btn btn-icon" data-ipin="${id}" title="${it.pinned ? 'Unpin' : 'Pin to the top'}"><i class="fa-solid fa-thumbtack${it.pinned ? ' mys-alert-on' : ''}"></i></button>` : ''}
      ${it.can_edit ? `<button class="btn btn-icon" data-iedit="${id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
        <button class="btn btn-icon" data-idel="${id}" title="Delete"><i class="fa-solid fa-trash-can"></i></button>` : ''}
    </div>
  </div>`;
}

function renderIdeas() {
  const list = $('#ideas-list');
  const empty = $('#ideas-empty');
  // default view: what's still to come; ideas shipped this past week sit folded underneath
  const st = ideaState;
  const shipped = st.shipped.length ? `<div class="ideas-shipped${st.shippedOpen ? ' open' : ''}">
      <button type="button" class="ideas-shipped-head" data-ishipped aria-expanded="${st.shippedOpen}">
        <i class="fa-solid fa-chevron-${st.shippedOpen ? 'down' : 'right'}"></i> Shipped this week <span class="ideas-shipped-n">${fmtNum(st.shipped.length)}</span></button>
      ${st.shippedOpen ? st.shipped.map(ideaCardHtml).join('') : ''}
    </div>` : '';
  if (!st.main.length) {
    const filtered = $('#ideas-status').value !== 'active' || $('#ideas-category').value || $('#ideas-search').value.trim();
    empty.textContent = filtered ? 'No ideas match these filters.' : (st.shipped.length ? 'Nothing open right now — everything here has shipped. Post the next one!' : 'No ideas yet — be the first to post one.');
    empty.hidden = false;
  } else {
    empty.hidden = true;
  }
  list.innerHTML = st.main.map(ideaCardHtml).join('') + shipped;
  $('#ideas-status-line').textContent = st.main.length
    ? `${fmtNum(st.main.length)} idea${st.main.length === 1 ? '' : 's'}` : '';
}

async function loadIdeas() {
  const seq = (ideaState.seq = (ideaState.seq || 0) + 1);
  showGridLoading('#ideas-loading');
  const params = { sort: $('#ideas-sort').value };
  if ($('#ideas-status').value) params.status = $('#ideas-status').value;
  if ($('#ideas-category').value) params.category = $('#ideas-category').value;
  const q = $('#ideas-search').value.trim();
  if (q) params.q = q;
  if ($('#ideas-mine').checked) params.mine = 1;
  let res;
  try { res = await apiFetch('GET', 'api/ideas.php', { params }); } catch (e) { res = { ok: false, error: String(e) }; }
  if (seq !== ideaState.seq) return;   // a newer load won
  $('#ideas-loading').hidden = true;
  if (!res.ok || !res.data) {
    $('#ideas-list').innerHTML = '';
    $('#ideas-empty').textContent = `Error: ${res.error || 'failed to load'}`;
    $('#ideas-empty').hidden = false;
    return;
  }
  ideaState.main = res.data.ideas || [];
  ideaState.shipped = res.data.recent_shipped || [];
  ideaState.ideas = ideaState.main.concat(ideaState.shipped);   // lookups (votes, comments, admin) span both
  ideaState.me = res.data.me || { signed_in: false, admin: false };
  $('#ideas-mine-wrap').hidden = !ideaState.me.signed_in;
  renderIdeas();
  // open threads refetch with the list, so comments posted elsewhere show up
  ideaState.threadOpen.forEach((id) => { if (ideaState.ideas.some((i) => String(i.id) === id)) ideaLoadThread(id); });
}

function ideaOpenDialog(it = null) {
  if (!ideaState.me.signed_in) { toast('Add your user key in Settings to post ideas', false); return; }
  ideaState.editId = it ? String(it.id) : null;
  $('#idea-modal-title').textContent = it ? 'Edit idea' : 'Post an idea';
  $('#idea-save').innerHTML = it ? '<i class="fa-solid fa-check"></i> Save' : '<i class="fa-solid fa-lightbulb"></i> Post idea';
  $('#idea-title').value = it ? it.title : '';
  $('#idea-desc').value = it ? it.description : '';
  $('#idea-cat').innerHTML = IDEA_CATEGORIES.map((c) => `<option${it && it.category === c ? ' selected' : ''}>${escapeHtml(c)}</option>`).join('');
  if (!it) $('#idea-cat').value = $('#ideas-category').value || 'Other';
  $('#idea-admin-row').hidden = !ideaState.me.admin;
  $('#idea-dev').checked = it ? !!it.is_dev : ideaState.me.admin;
  $('#idea-pinned').checked = false;
  $('#idea-pinned-wrap').hidden = !!it;   // pin from the card once it exists
  ideaDescCount();
  $('#idea-modal').hidden = false;
  $('#idea-title').focus();
}
function ideaDescCount() {
  $('#idea-desc-count').textContent = `${$('#idea-desc').value.length} / 2000`;
}

async function ideaSave() {
  const title = $('#idea-title').value.trim();
  if (title.length < 4) { toast('Give the idea a short title', false); return; }
  const data = {
    action: ideaState.editId ? 'edit' : 'submit',
    title,
    description: $('#idea-desc').value.trim(),
    category: $('#idea-cat').value,
  };
  if (ideaState.editId) data.id = safeInt(ideaState.editId);
  if (ideaState.me.admin) {
    data.dev = $('#idea-dev').checked ? 1 : 0;
    if (!ideaState.editId) data.pinned = $('#idea-pinned').checked ? 1 : 0;
  }
  const btn = $('#idea-save');
  btn.disabled = true;
  let res;
  try { res = await apiFetch('POST', 'api/ideas.php', { data }); } catch (e) { res = { ok: false, error: String(e) }; }
  btn.disabled = false;
  if (!res.ok) { toast(res.error || 'Couldn’t save the idea', false); checkAuthError(res.error); return; }
  $('#idea-modal').hidden = true;
  toast(ideaState.editId ? 'Idea saved' : 'Idea posted — thanks!');
  loadIdeas();
}

async function ideaVote(id) {
  if (!ideaState.me.signed_in) { toast('Add your user key in Settings to vote', false); return; }
  const it = ideaState.ideas.find((i) => String(i.id) === id);
  if (!it) return;
  // optimistic, then settle on the server's count
  const was = { voted: it.voted, votes: it.votes };
  it.voted = !it.voted; it.votes += it.voted ? 1 : -1;
  renderIdeas();
  let res;
  try { res = await apiFetch('POST', 'api/ideas.php', { data: { action: 'vote', id: safeInt(id) } }); } catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) { Object.assign(it, was); renderIdeas(); toast(res.error || 'Vote failed', false); return; }
  it.voted = !!res.data.voted; it.votes = safeInt(res.data.votes);
  renderIdeas();
}

async function ideaAdmin(data, okMsg) {
  let res;
  try { res = await apiFetch('POST', 'api/ideas.php', { data }); } catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok) { toast(res.error || 'Update failed', false); return; }
  if (okMsg) toast(okMsg);
  loadIdeas();
}

function initIdeas() {
  let t = null;
  $('#ideas-search').addEventListener('input', () => { clearTimeout(t); t = setTimeout(loadIdeas, 300); });
  ['#ideas-sort', '#ideas-status', '#ideas-category', '#ideas-mine'].forEach((s) => $(s).addEventListener('change', loadIdeas));
  $('#ideas-category').innerHTML = '<option value="">All categories</option>'
    + IDEA_CATEGORIES.map((c) => `<option value="${escapeHtml(c)}">${escapeHtml(c)}</option>`).join('');
  $('[data-refresh="ideas"]').addEventListener('click', loadIdeas);
  $('#ideas-new').addEventListener('click', () => ideaOpenDialog());

  $('#ideas-list').addEventListener('click', async (e) => {
    if (e.target.closest('[data-ishipped]')) { ideaState.shippedOpen = !ideaState.shippedOpen; renderIdeas(); return; }
    const b = e.target.closest('[data-ivote],[data-imore],[data-iedit],[data-idel],[data-ipin],[data-icmt],[data-icmtpost],[data-icmtdel]');
    if (!b) return;
    const it = (id) => ideaState.ideas.find((i) => String(i.id) === id);
    if (b.dataset.icmt) {
      const id = b.dataset.icmt;
      if (ideaState.threadOpen.has(id)) { ideaState.threadOpen.delete(id); renderIdeas(); return; }
      ideaState.threadOpen.add(id);
      ideaLoadThread(id).then(() => document.querySelector(`[data-icmtinput="${id}"]`)?.focus());
      return;
    }
    if (b.dataset.icmtpost) { ideaPostComment(b.dataset.icmtpost); return; }
    if (b.dataset.icmtdel) { ideaDeleteComment(b.dataset.icmtidea, b.dataset.icmtdel); return; }
    if (b.dataset.ivote) ideaVote(b.dataset.ivote);
    else if (b.dataset.imore) {
      const id = b.dataset.imore;
      if (ideaState.expanded.has(id)) ideaState.expanded.delete(id); else ideaState.expanded.add(id);
      renderIdeas();
    } else if (b.dataset.iedit) ideaOpenDialog(it(b.dataset.iedit));
    else if (b.dataset.ipin) {
      const x = it(b.dataset.ipin);
      if (x) ideaAdmin({ action: 'pin', id: x.id, pinned: x.pinned ? 0 : 1 }, x.pinned ? 'Unpinned' : 'Pinned to the top');
    } else if (b.dataset.idel) {
      const x = it(b.dataset.idel);
      if (!x) return;
      const ok = await confirmDialog({ title: 'Delete this idea?', message: `“${x.title}” and its votes will be removed. This can't be undone.`, confirmLabel: 'Delete' });
      if (ok) ideaAdmin({ action: 'delete', id: x.id }, 'Idea deleted');
    }
  });
  // drafts live in state so a repaint (a vote, a status change) never eats them
  $('#ideas-list').addEventListener('input', (e) => {
    const ta = e.target.closest('[data-icmtinput]');
    if (!ta) return;
    const th = ideaState.threads.get(ta.dataset.icmtinput);
    if (th) th.draft = ta.value;
  });
  $('#ideas-list').addEventListener('keydown', (e) => {
    const ta = e.target.closest('[data-icmtinput]');
    if (ta && e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); ideaPostComment(ta.dataset.icmtinput); }
  });
  $('#ideas-list').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-istatus]');
    if (sel) ideaAdmin({ action: 'status', id: safeInt(sel.dataset.istatus), status: sel.value }, `Marked ${IDEA_STATUS_LABELS[sel.value] || sel.value}`);
  });

  $('#idea-desc').addEventListener('input', ideaDescCount);
  $('#idea-cancel').addEventListener('click', () => { $('#idea-modal').hidden = true; });
  $('#idea-save').addEventListener('click', ideaSave);
  $('#idea-title').addEventListener('keydown', (e) => { if (e.key === 'Enter') ideaSave(); });
  bindBackdropClose($('#idea-modal'), () => { $('#idea-modal').hidden = true; });
}
