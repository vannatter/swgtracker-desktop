/* Despawn alerts (requested by Geooo) — "tell me when this resource leaves spawn".
   The watch list lives on the server (api/resource_watch.php) so it follows the
   player everywhere; admin/cron_alerts.php fires a watch as a Spawn Alerts match
   (notice: the desktop notification + nag bar here, the website's alerts list
   and a phone push) and/or an email. This file: the resource page's Despawn
   alert button + dialog, and the Despawn alerts list on Spawn Alerts. */
const rwState = { byId: new Map(), loaded: false, api: true, editId: 0, editName: '' };

async function rwLoad() {
  let r;
  try { r = await apiFetch('GET', 'api/resource_watch.php'); } catch (e) { r = { ok: false, error: String(e) }; }
  if (!r.ok || !r.data || !Array.isArray(r.data.watches)) {
    rwState.api = !/404|not found/i.test(String(r.error || ''));
    rwState.loaded = true;
    rwRender(); rwSyncRdButton();
    return;
  }
  rwState.api = true;
  rwState.loaded = true;
  rwState.byId = new Map(r.data.watches.map((w) => [String(w.resource_id), w]));
  rwRender(); rwSyncRdButton();
}

const rwHow = (w) => [w.notice ? 'notice' : '', w.email ? 'email' : ''].filter(Boolean).join(' + ');
const rwSoonTail = (w) => (w.soon ? ', with a heads-up once it has been out 7 days' : '');

// ---- resource page button ----
function rwSyncRdButton() {
  const btn = $('#rd-watch');
  if (!btn) return;
  const data = (typeof rdState !== 'undefined' && rdState.data) || null;
  const r = (data && data.resource) || {};
  const w = rwState.byId.get(String(rdState.id));
  const active = typeof rdIsActive === 'function' ? rdIsActive(r) : true;
  // only for spawns still out (or one we're already watching), and once the site has the endpoint
  btn.hidden = !rwState.api || !rdState.id || (!active && !w);
  btn.classList.toggle('rd-watching', !!(w && !w.despawned_at));
  btn.innerHTML = w
    ? (w.despawned_at ? '<i class="fa-solid fa-bell-slash"></i> Despawned' : '<i class="fa-solid fa-bell"></i> Despawn alert on')
    : '<i class="fa-regular fa-bell"></i> Despawn alert';
  btn.title = w
    ? (w.despawned_at ? `Left spawn ${fmtAgo(w.despawned_at)} — you were told by ${rwHow(w)}` : `You'll get a ${rwHow(w)} when ${rdState.name} leaves spawn${rwSoonTail(w)} — click to change`)
    : `Get a notice and/or an email when ${rdState.name || 'this resource'} leaves spawn`;
}

// ---- dialog ----
function rwOpen(id, name) {
  const w = rwState.byId.get(String(id));
  rwState.editId = safeInt(id);
  rwState.editName = name || (w && w.resource_name) || '';
  $('#rw-title-name').textContent = rwState.editName;
  $('#rw-notice').checked = w ? !!w.notice : true;
  $('#rw-email').checked = w ? !!w.email : false;
  $('#rw-soon').checked = w ? !!w.soon : true;
  $('#rw-remove').hidden = !w;
  $('#rw-save').innerHTML = w ? '<i class="fa-solid fa-check"></i> Save' : '<i class="fa-solid fa-bell"></i> Watch';
  $('#rw-modal').hidden = false;
}

async function rwSave() {
  const notice = $('#rw-notice').checked;
  const email = $('#rw-email').checked;
  const soon = $('#rw-soon').checked;
  if (!notice && !email) { toast('Pick a notice, an email or both', false); return; }
  const btn = $('#rw-save');
  btn.disabled = true;
  let r;
  try { r = await apiFetch('POST', 'api/resource_watch.php', { data: { resource_id: rwState.editId, notice, email, soon } }); }
  catch (e) { r = { ok: false, error: String(e) }; }
  btn.disabled = false;
  if (!r.ok || !r.data || !r.data.watch) {
    toast(/404|not found/i.test(String(r.error || '')) && !rwState.byId.size
      ? 'Despawn alerts need the latest swgtracker.com update — try again soon'
      : (r.error || 'Couldn’t save the despawn alert'), false);
    return;
  }
  rwState.byId.set(String(rwState.editId), r.data.watch);
  $('#rw-modal').hidden = true;
  toast(`Watching ${rwState.editName} — you'll get a ${rwHow(r.data.watch)} when it leaves spawn${rwSoonTail(r.data.watch)}`);
  rwRender(); rwSyncRdButton();
}

async function rwRemove(id) {
  const key = String(id);
  const w = rwState.byId.get(key);
  let r;
  try { r = await apiFetch('DELETE', `api/resource_watch.php?resource_id=${safeInt(id)}`); }
  catch (e) { r = { ok: false, error: String(e) }; }
  if (!r.ok) { toast(r.error || 'Couldn’t remove the despawn alert', false); return; }
  rwState.byId.delete(key);
  $('#rw-modal').hidden = true;
  if (w) toast(`Stopped watching ${w.resource_name}`);
  rwRender(); rwSyncRdButton();
}

// ---- Spawn Alerts list ----
function rwRender() {
  const box = $('#al-watches');
  if (!box) return;
  box.hidden = !rwState.api;
  const list = [...rwState.byId.values()].sort((a, b) => (!!a.despawned_at - !!b.despawned_at) || b.created - a.created);
  $('#al-watch-count').textContent = list.filter((w) => !w.despawned_at).length || '';
  $('#al-watch-list').innerHTML = list.length ? list.map((w) => `
    <div class="al-watch ${w.despawned_at ? 'al-watch-gone' : ''}" data-rwid="${w.resource_id}">
      <i class="fa-${w.despawned_at ? 'solid fa-bell-slash' : 'solid fa-bell'} al-watch-ic"></i>
      <span class="al-watch-main">
        <a href="#" class="al-watch-name" data-rwopen="${escapeHtml(w.resource_name)}">${escapeHtml(w.resource_name)}</a>
        <span class="al-watch-type">${escapeHtml(w.type_name || '')}</span>
      </span>
      <span class="al-watch-state">${w.despawned_at ? `Despawned ${escapeHtml(fmtAgo(w.despawned_at))}` : `In spawn · watching since ${new Date(w.created * 1000).toLocaleDateString([], { month: 'short', day: 'numeric' })}${w.soon_at ? ' · heads-up sent' : ''}`}</span>
      <span class="al-watch-how">${escapeHtml(rwHow(w))}${w.soon ? ' <i class="fa-solid fa-hourglass-half" title="Heads-up at 7 days in spawn"></i>' : ''}</span>
      ${w.despawned_at ? '' : `<button type="button" class="btn btn-icon btn-sm" data-rwedit="${w.resource_id}" title="Change how you're told"><i class="fa-solid fa-pen"></i></button>`}
      <button type="button" class="btn btn-icon btn-sm" data-rwdel="${w.resource_id}" title="${w.despawned_at ? 'Clear it from the list' : 'Stop watching'}"><i class="fa-solid fa-xmark"></i></button>
    </div>`).join('')
    : '<div class="al-watch-empty">Open any resource and press <b><i class="fa-regular fa-bell"></i> Despawn alert</b> to hear when it leaves spawn.</div>';
}

document.addEventListener('DOMContentLoaded', () => {
  $('#rd-watch')?.addEventListener('click', () => rwOpen(rdState.id, rdState.name));
  $('#rw-cancel')?.addEventListener('click', () => { $('#rw-modal').hidden = true; });
  $('#rw-save')?.addEventListener('click', rwSave);
  $('#rw-remove')?.addEventListener('click', () => rwRemove(rwState.editId));
  $('#rw-modal')?.addEventListener('click', (e) => { if (e.target.id === 'rw-modal') $('#rw-modal').hidden = true; });
  $('#al-watch-list')?.addEventListener('click', (e) => {
    const open = e.target.closest('[data-rwopen]');
    if (open) { e.preventDefault(); openResourcePage(open.dataset.rwopen); return; }
    const ed = e.target.closest('[data-rwedit]');
    if (ed) { const w = rwState.byId.get(ed.dataset.rwedit); rwOpen(ed.dataset.rwedit, w && w.resource_name); return; }
    const del = e.target.closest('[data-rwdel]');
    if (del) rwRemove(del.dataset.rwdel);
  });
  setTimeout(rwLoad, 6000); // after boot; the resource page + Spawn Alerts read it
});
