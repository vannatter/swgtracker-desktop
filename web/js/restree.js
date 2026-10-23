/* Resource Tree — the website's restree.php: the SWG resource-class hierarchy with each
   class's stat caps. Static game data bundled in restree_data.js, so no API call;
   the rows render once and expand/collapse/filter just toggle `hidden`. */

const restreeState = { built: false, rows: [], byCode: {}, open: new Set() };

function restreeSaveOpen() {
  try { localStorage.setItem('restree_open', JSON.stringify([...restreeState.open])); } catch (_) {}
}

// one cap cell: fixed value, min–max range, or — when the class doesn't use the stat
function restreeCapCell(c) {
  if (!c || c[1] <= 0 || c[1] < c[0]) return '<td class="rt-na">—</td>';
  return `<td>${c[0] === c[1] ? c[0] : `${c[0]}–${c[1]}`}</td>`;
}

function buildRestree() {
  $('#restree-head').innerHTML = '<th class="col-text rt-name-h">Resource Class</th>'
    + RESTREE_STATS.map((s) => `<th>${s.toUpperCase()}</th>`).join('');
  $('#restree-body').innerHTML = RESTREE_ROWS.map(([code, name, parent, depth, kids, caps]) => `
    <tr class="rt-row" data-code="${escapeHtml(code)}" data-parent="${escapeHtml(parent)}" data-depth="${depth}"${depth > 0 ? ' hidden' : ''}>
      <td class="col-text rt-name"><span class="rt-indent" style="padding-left:${depth * 18}px"></span>${kids
        ? '<button type="button" class="rt-toggle" aria-expanded="false" title="Expand / collapse"><i class="fa-solid fa-caret-right"></i></button>'
        : '<span class="rt-leaf"></span>'}<span class="rt-label">${escapeHtml(name)}</span><span class="rt-code">${escapeHtml(code)}</span><a class="rt-filter" data-rtcat="${escapeHtml(code)}" title="Show ${escapeHtml(name)} resources"><i class="fa-solid fa-filter"></i></a></td>
      ${RESTREE_STATS.map((_, i) => restreeCapCell(caps && caps[i])).join('')}
    </tr>`).join('');
  restreeState.rows = [...document.querySelectorAll('#restree-body .rt-row')];
  restreeState.byCode = {};
  restreeState.rows.forEach((r) => { restreeState.byCode[r.dataset.code] = r; });
  restreeState.built = true;
}

function restreeSetToggle(row, open) {
  const b = row.querySelector('.rt-toggle');
  if (b) b.setAttribute('aria-expanded', open ? 'true' : 'false');
}

// show the tree as the open set says: roots always, children of open (and visible) rows
function restreeApplyOpen() {
  const { rows, byCode, open } = restreeState;
  rows.forEach((r) => {
    const p = r.dataset.parent;
    r.hidden = !!p && !(open.has(p) && byCode[p] && !byCode[p].hidden);
    restreeSetToggle(r, open.has(r.dataset.code));
  });
  $('#restree-empty').hidden = true;
}

// filter: matching classes plus their ancestor chain; empty query -> the remembered tree
function restreeFilter() {
  const q = ($('#restree-search').value || '').trim().toLowerCase();
  if (!q) { restreeApplyOpen(); return; }
  const { rows, byCode } = restreeState;
  rows.forEach((r) => { r.hidden = true; restreeSetToggle(r, false); });
  let hits = 0;
  rows.forEach((r) => {
    const label = r.querySelector('.rt-label').textContent.toLowerCase();
    if (!label.includes(q) && !r.dataset.code.toLowerCase().includes(q)) return;
    hits++;
    r.hidden = false;
    let p = r.dataset.parent;
    while (p && byCode[p]) { byCode[p].hidden = false; restreeSetToggle(byCode[p], true); p = byCode[p].dataset.parent; }
  });
  $('#restree-empty').textContent = 'Nothing matches that search.';
  $('#restree-empty').hidden = hits > 0;
}

function loadRestree() {
  if (!restreeState.built) {
    try { restreeState.open = new Set(JSON.parse(localStorage.getItem('restree_open') || '[]')); } catch (_) { restreeState.open = new Set(); }
    buildRestree();
  }
  restreeFilter();
}

function initRestree() {
  $('#restree-search').addEventListener('input', () => { if (restreeState.built) restreeFilter(); });
  $('#restree-expand').addEventListener('click', () => {
    $('#restree-search').value = '';
    restreeState.open = new Set(RESTREE_ROWS.filter((r) => r[4]).map((r) => r[0]));
    restreeSaveOpen(); restreeApplyOpen();
  });
  $('#restree-collapse').addEventListener('click', () => {
    $('#restree-search').value = '';
    restreeState.open = new Set();
    restreeSaveOpen(); restreeApplyOpen();
  });
  $('#restree-body').addEventListener('click', (e) => {
    const f = e.target.closest('[data-rtcat]');
    if (f) {
      const row = f.closest('.rt-row');
      showPage('resources');
      applyCategoryFilter(f.dataset.rtcat, row.querySelector('.rt-label').textContent);
      return;
    }
    const row = e.target.closest('.rt-row');
    if (!row || !row.querySelector('.rt-toggle')) return;
    // a toggle while filtering drops the filter and works from what's on screen
    if ($('#restree-search').value.trim()) {
      $('#restree-search').value = '';
      restreeState.open = new Set(restreeState.rows.filter((r) => !r.hidden && r.querySelector('.rt-toggle[aria-expanded="true"]')).map((r) => r.dataset.code));
    }
    const code = row.dataset.code;
    if (restreeState.open.has(code)) restreeState.open.delete(code); else restreeState.open.add(code);
    restreeSaveOpen(); restreeApplyOpen();
  });
}
