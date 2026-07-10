/* Spawn Alerts page — rules are stored and evaluated server-side (api/alerts.php);
   this page edits them, shows the hits feed, and polls for fresh hits to raise
   native desktop notifications. */

const AL_STATS = ['oq', 'cr', 'cd', 'dr', 'hr', 'ma', 'sr', 'ut', 'fl', 'pe'];

const alState = {
  rules: [],
  hits: [],
  editingId: null,
  schematic: null,        // {id, name} picked in the editor
  formulas: [],           // formulas of the picked schematic
  classCode: '',          // combo selection ('' = any)
  classNodes: [],         // [{code, desc, depth}] incl. exact types
  lastHitId: safeInt(localStorage.getItem('al-last-hit')),
};

// ---- Class combobox (type-to-filter over the full tree incl. exact types) ----

function alSetClass(code) {
  alState.classCode = code || '';
  $('#al-class-current').textContent = code ? (categoryNameByCode.get(code) || code) : 'Any class';
}

function alRenderClassOpts(query = '') {
  const q = query.trim().toLowerCase();
  const rows = q
    ? alState.classNodes.filter((n) => n.desc.toLowerCase().includes(q)).slice(0, 200)
    : alState.classNodes;
  $('#al-class-opts').innerHTML =
    `<div class="mysd-opt al-class-opt" data-code="">Any class</div>` +
    rows.map((n) =>
      `<div class="mysd-opt al-class-opt" data-code="${escapeHtml(n.code)}">${q ? '' : '&nbsp; '.repeat(n.depth)}${escapeHtml(n.desc)}</div>`
    ).join('') + (q && !rows.length ? '<div class="mysd-opt-none">No classes match.</div>' : '');
}

function alCloseClassMenu() {
  $('.al-class-menu').hidden = true;
}

// ---- Rendering ----

function alRuleSentence(r) {
  const bits = [];
  if (r.class_code) bits.push(categoryNameByCode.get(r.class_code) || r.class_code);
  const stats = r.stats_json ? JSON.parse(r.stats_json) : {};
  const statBits = Object.entries(stats).map(([s, v]) => `${s.toUpperCase()} ≥ ${v}`);
  if (statBits.length) bits.push(statBits.join(', '));
  if (r.schematic_id && (r.rank_max || r.quality_min)) {
    const sBits = [];
    if (r.rank_max) sBits.push(`top ${r.rank_max}`);
    if (r.quality_min) sBits.push(`quality ≥ ${r.quality_min}`);
    bits.push(`${sBits.join(' / ')} for ${r.schematic_name || `schematic #${r.schematic_id}`}`);
  }
  return bits.join(' · ') || 'any spawn';
}

// Tint the stat inputs that the checked formulas actually weight (OQ=50% SR=50%
// highlights OQ + SR), so it's obvious which minimums interact with the formula math.
function alHighlightFormulaStats() {
  const active = new Set();
  document.querySelectorAll('#al-formulas [data-fid]:checked').forEach((box) => {
    const f = alState.formulas.find((x) => String(x.formulaId) === box.dataset.fid);
    for (const m of String(f?.formulaDescription || '').matchAll(/([A-Z]{2})=\d+%?/g)) {
      active.add(m[1].toLowerCase());
    }
  });
  document.querySelectorAll('#al-stats [data-alstat]').forEach((inp) => {
    inp.closest('.al-stat').classList.toggle('hl', active.has(inp.dataset.alstat));
  });
}

function renderAlertRules() {
  const wrap = $('#al-rules');
  wrap.innerHTML = alState.rules.map((r) => `
    <div class="al-rule ${String(r.enabled) === '1' ? '' : 'al-off'}" data-rid="${r.id}">
      <div class="form-check form-switch al-rule-toggle" title="Enable / disable">
        <input class="form-check-input" type="checkbox" data-toggle="${r.id}" ${String(r.enabled) === '1' ? 'checked' : ''}>
      </div>
      <div class="al-rule-main">
        <span class="al-rule-name">${escapeHtml(r.name || `Rule #${r.id}`)}</span>
        <span class="al-rule-desc">${escapeHtml(alRuleSentence(r))}</span>
      </div>
      ${String(r.notify_email) === '1' ? '<i class="fa-solid fa-envelope al-rule-mail" title="Emails on match"></i>' : ''}
      <button class="btn btn-icon al-rule-btn" data-edit="${r.id}" title="Edit"><i class="fa-solid fa-pen"></i></button>
      <button class="btn btn-icon al-rule-btn" data-del="${r.id}" title="Delete"><i class="fa-solid fa-trash-can"></i></button>
    </div>`).join('');
  const empty = $('#al-rules-empty');
  empty.hidden = !!alState.rules.length;
  empty.textContent = 'No alert rules yet — click New Rule to watch for spawns by class, stats, or schematic rank.';
}

function renderAlertFeed() {
  const rows = alState.hits.map((h) => `
    <tr class="${String(h.seen) === '1' ? '' : 'al-unseen'}">
      <td class="col-text">${fmtAgoTip(h.created)}${String(h.is_backfill) === '1' ? ' <span class="scd-age">(backfill)</span>' : ''}</td>
      <td class="col-name res-name" data-res="${escapeHtml(h.resource_name)}">${escapeHtml(h.resource_name)}</td>
      <td class="col-text">${escapeHtml(h.detail || '')}</td>
      <td class="col-text res-type">${escapeHtml(h.rule_name || '')}</td>
    </tr>`).join('');
  $('#al-feed').innerHTML = rows;
  const empty = $('#al-feed-empty');
  empty.hidden = !!alState.hits.length;
  empty.textContent = 'No matches yet — they land here (and as notifications) as spawns come in.';
  const unseen = alState.hits.filter((h) => String(h.seen) !== '1').length;
  const badge = $('#al-unseen');
  badge.hidden = unseen === 0;
  badge.textContent = `${unseen} new`;
}

async function loadAlerts() {
  let res;
  try { res = await api().get_alerts({}); }
  catch (e) { res = { ok: false, error: String(e) }; }
  if (!res.ok || !res.data) {
    $('#al-rules-empty').textContent = String(res.error || '').includes('404')
      ? 'Spawn alerts need the server update — deploy api/alerts.php + includes/alert_engine.php, run admin/alerts_schema.sql, and add the cron_alerts.php crontab entry. Then refresh here.'
      : `Error: ${res.error || 'failed to load alerts'}`;
    $('#al-rules-empty').hidden = false;
    checkAuthError(res.error);
    return;
  }
  alState.rules = res.data.rules || [];
  alState.hits = res.data.hits || [];
  if (alState.hits.length) {
    alState.lastHitId = Math.max(alState.lastHitId, ...alState.hits.map((h) => safeInt(h.id)));
    localStorage.setItem('al-last-hit', alState.lastHitId);
  }
  renderAlertRules();
  renderAlertFeed();
}

// ---- Editor ----

function alOpenEditor(rule = null) {
  alState.editingId = rule ? safeInt(rule.id) : null;
  alState.schematic = rule && rule.schematic_id
    ? { id: safeInt(rule.schematic_id), name: rule.schematic_name || `#${rule.schematic_id}` } : null;
  alState.formulas = [];
  alState.formulaCsv = rule ? (rule.formula_ids || '') : '';

  $('#al-editor-title').textContent = rule ? `Edit ${rule.name || `Rule #${rule.id}`}` : 'New Alert Rule';
  $('#al-name').value = rule ? (rule.name || '') : '';
  alSetClass(rule ? (rule.class_code || '') : '');
  alCloseClassMenu();
  $('#al-email').checked = rule ? String(rule.notify_email) === '1' : false;
  $('#al-rank').value = rule ? (rule.rank_max || '') : 3;
  $('#al-quality').value = rule && rule.quality_min ? rule.quality_min : '';

  const stats = rule && rule.stats_json ? JSON.parse(rule.stats_json) : {};
  $('#al-stats').innerHTML = AL_STATS.map((s) => `
    <label class="al-stat"><span>${s.toUpperCase()}</span>
      <input type="number" class="form-control filter-input" data-alstat="${s}" min="1" max="1000"
             value="${stats[s] || ''}" placeholder="—"></label>`).join('');

  $('#al-schem-search').value = '';
  $('#al-schem-cat').value = '';
  alRefreshSchematicList();
  alRenderFormulas();
  $('#al-editor-status').textContent = '';
  $('#al-modal').hidden = false;
  $('#al-name').focus();
}

// ---- Schematic chooser (browse, don't type): pinned first, then the filtered list ----

let alListSeq = 0;
async function alRefreshSchematicList() {
  const seq = ++alListSeq;
  const search = $('#al-schem-search').value.trim();
  const category = $('#al-schem-cat').value;
  const list = $('#al-schem-list');
  list.innerHTML = '<div class="mysd-opt-none">Loading…</div>';

  // pinned schematics lead when browsing unfiltered — they're what people track
  let pinnedRows = [];
  if (!search && !category) {
    try {
      const [pinRes, nameRes] = [await api().get_pinned_schematics(), null];
      const ids = (pinRes.ok && pinRes.data) || [];
      if (ids.length) {
        const names = await api().get_schematic_names(ids);
        if (names.ok && names.data) {
          pinnedRows = ids.filter((id) => names.data[String(id)])
            .map((id) => ({ id, ...names.data[String(id)], pinned: true }));
        }
      }
    } catch (_) { /* mirror empty — fine */ }
  }

  let rows = [];
  try {
    const res = await api().search_schematics({ search, category, page: 1 });
    rows = (res.ok && res.data && (res.data.results || [])) || [];
  } catch (_) { /* offline mirror answers via bridge fallback */ }
  if (seq !== alListSeq) return; // a newer filter superseded this fetch

  const pinnedIds = new Set(pinnedRows.map((p) => String(p.id)));
  const items = [
    ...pinnedRows,
    ...rows.filter((s) => !pinnedIds.has(String(s.id))).slice(0, 60),
  ];
  const sel = alState.schematic ? String(alState.schematic.id) : '';
  list.innerHTML = `
    <div class="al-schem-row ${sel ? '' : 'sel'}" data-sid="" data-sname="">
      <span class="al-schem-none">No schematic — class/stat rule only</span>
    </div>` + items.map((s) => `
    <div class="al-schem-row ${String(s.id) === sel ? 'sel' : ''}" data-sid="${escapeHtml(String(s.id))}"
         data-sname="${escapeHtml(s.name || '')}">
      ${s.pinned ? '<i class="fa-solid fa-thumbtack al-schem-star" title="Pinned"></i>' : '<span class="al-schem-star"></span>'}
      <span class="al-schem-name">${escapeHtml(s.name || '')}</span>
      <span class="al-schem-prof">${escapeHtml(s.parent || '')}</span>
    </div>`).join('');
  if (!items.length) {
    list.innerHTML += '<div class="mysd-opt-none">No schematics match.</div>';
  }
  // keep the selection visible even when it isn't in the current filter page
  if (sel && !items.some((s) => String(s.id) === sel)) {
    list.insertAdjacentHTML('afterbegin', `
      <div class="al-schem-row sel" data-sid="${escapeHtml(sel)}" data-sname="${escapeHtml(alState.schematic.name)}">
        <span class="al-schem-star"></span>
        <span class="al-schem-name">${escapeHtml(alState.schematic.name)}</span>
        <span class="al-schem-prof">selected</span>
      </div>`);
  }
}

function alRenderFormulas() {
  const s = alState.schematic;
  $('#al-formulas').innerHTML = '';
  $('#al-schem-conds').hidden = !s; // rank/quality only mean something with a schematic
  if (!s) { alHighlightFormulaStats(); return; }
  api().get_schematic(String(s.id)).then((res) => {
    if (!alState.schematic || String(alState.schematic.id) !== String(s.id)) return;
    const det = res.ok && res.data ? (res.data.schematic || res.data) : null;
    alState.formulas = (det?.formula || []).filter((f) => f.active !== false);
    const checked = new Set(alState.formulaCsv.split(',').map((x) => x.trim()).filter(Boolean));
    $('#al-formulas').innerHTML = alState.formulas.map((f) => `
      <label class="sp-formula">
        <input type="checkbox" data-fid="${escapeHtml(String(f.formulaId))}"
               ${!checked.size || checked.has(String(f.formulaId)) ? 'checked' : ''}>
        <span class="sp-formula-box"><i class="fa-solid fa-check"></i></span>
        <span>${escapeHtml(f.formulaDescription || '')}</span>
      </label>`).join('');
    alHighlightFormulaStats();
  }).catch(() => {});
}

async function alSaveRule() {
  const stats = {};
  document.querySelectorAll('#al-stats [data-alstat]').forEach((inp) => {
    const v = safeInt(inp.value);
    if (v > 0) stats[inp.dataset.alstat] = v;
  });
  const fids = [...document.querySelectorAll('#al-formulas [data-fid]')];
  const picked = fids.filter((x) => x.checked).map((x) => x.dataset.fid);
  const rule = {
    id: alState.editingId || undefined,
    name: $('#al-name').value.trim(),
    class_code: alState.classCode,
    stats,
    schematic_id: alState.schematic ? alState.schematic.id : 0,
    // all boxes checked = '' so newly added formulas are included automatically
    formula_ids: alState.schematic && picked.length && picked.length < fids.length ? picked.join(',') : '',
    rank_max: alState.schematic ? safeInt($('#al-rank').value) : 0,
    quality_min: alState.schematic ? safeInt($('#al-quality').value) : 0,
    notify_email: $('#al-email').checked,
    enabled: true,
  };
  if (!rule.class_code && !Object.keys(stats).length && !rule.schematic_id) {
    $('#al-editor-status').textContent = 'Set at least a class, one stat minimum, or a schematic.';
    return;
  }
  if (rule.schematic_id && !rule.rank_max && !rule.quality_min) {
    $('#al-editor-status').textContent = 'With a schematic picked, set a rank (top N) and/or a quality threshold.';
    return;
  }
  $('#al-save').disabled = true;
  let res;
  try { res = await api().save_alert(rule); }
  catch (e) { res = { ok: false, error: String(e) }; }
  $('#al-save').disabled = false;
  if (!res.ok) {
    $('#al-editor-status').textContent = res.error || 'Save failed';
    return;
  }
  const nBack = (res.data.backfill || []).length;
  toast(`Rule saved${nBack ? ` — ${nBack} current spawn${nBack > 1 ? 's' : ''} already match` : ''}`);
  $('#al-modal').hidden = true;
  loadAlerts();
}

// ---- Notification polling (runs app-wide, started from boot) ----

let alPollTimer = null;

async function alertsPoll() {
  let res;
  try { res = await api().get_alerts({ since_id: alState.lastHitId }); }
  catch (_) { return; }
  if (!res.ok || !res.data) return;
  const hits = res.data.hits || [];
  const fresh = hits.filter((h) => safeInt(h.id) > alState.lastHitId
    && String(h.is_backfill) !== '1' && String(h.seen) !== '1');
  if (hits.length) {
    const maxId = Math.max(...hits.map((h) => safeInt(h.id)));
    if (alState.lastHitId === 0) { // first ever poll: set watermark, don't replay history
      alState.lastHitId = maxId;
      localStorage.setItem('al-last-hit', maxId);
      return;
    }
    alState.lastHitId = Math.max(alState.lastHitId, maxId);
    localStorage.setItem('al-last-hit', alState.lastHitId);
  }
  if (!fresh.length) return;
  for (const h of fresh.slice(0, 3)) {
    api().notify(`Spawn alert: ${h.resource_name}`, h.detail || h.rule_name || 'matching spawn');
  }
  if (fresh.length > 3) {
    api().notify('Spawn alerts', `${fresh.length - 3} more matching spawns — open Spawn Alerts`);
  }
  toast(`${fresh.length} spawn alert${fresh.length > 1 ? 's' : ''} — see Spawn Alerts`);
  if (loadedPages.has('alerts')) loadAlerts();
}

async function startAlertPolling() {
  let minutes = 5;
  try {
    const res = await api().get_config();
    if (res.ok && res.data) minutes = Math.max(1, Math.round((res.data.alert_poll_interval || 300) / 60));
  } catch (_) { /* default */ }
  clearInterval(alPollTimer);
  alPollTimer = setInterval(alertsPoll, minutes * 60000);
  setTimeout(alertsPoll, 8000); // watermark/first check shortly after boot
}

// ---- Init ----

function initAlerts() {
  fetchCategoryNodes(true).then((nodes) => { // true: down to exact types
    if (nodes) alState.classNodes = nodes;
    if (loadedPages.has('alerts')) renderAlertRules(); // class names now resolvable
  });

  // class combobox: open, filter as you type, Enter picks the first match
  $('#al-class-btn').addEventListener('click', () => {
    const menu = $('.al-class-menu');
    menu.hidden = !menu.hidden;
    if (!menu.hidden) {
      $('#al-class-filter').value = '';
      alRenderClassOpts();
      $('#al-class-filter').focus();
    }
  });
  $('#al-class-filter').addEventListener('input', () => alRenderClassOpts($('#al-class-filter').value));
  $('#al-class-filter').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      const first = document.querySelector('#al-class-opts [data-code]:not([data-code=""])')
        || document.querySelector('#al-class-opts [data-code]');
      if (first) { alSetClass(first.dataset.code); alCloseClassMenu(); }
    } else if (e.key === 'Escape') {
      alCloseClassMenu();
    }
  });
  $('#al-class-opts').addEventListener('click', (e) => {
    const opt = e.target.closest('[data-code]');
    if (!opt) return;
    alSetClass(opt.dataset.code);
    alCloseClassMenu();
  });
  document.addEventListener('click', (e) => {
    if (!e.target.closest('#al-class-combo')) alCloseClassMenu();
  });

  // profession filter options for the schematic chooser
  api().get_categories().then((res) => {
    const cats = (res.ok && res.data && (res.data.schematic_categories || [])) || [];
    const parents = [...new Set(cats.map((c) => c.parent).filter(Boolean))].sort();
    $('#al-schem-cat').innerHTML = '<option value="">All professions</option>'
      + parents.map((p) => `<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join('');
  }).catch(() => {});

  $('#al-new').addEventListener('click', () => alOpenEditor());
  $('#al-formulas').addEventListener('change', () => alHighlightFormulaStats());
  $('#al-cancel').addEventListener('click', () => { $('#al-modal').hidden = true; });
  $('#al-save').addEventListener('click', alSaveRule);
  $('[data-refresh="alerts"]').addEventListener('click', () => loadAlerts());

  $('#al-seen').addEventListener('click', async () => {
    try { await api().mark_alerts_seen('all'); } catch (_) { /* reload shows truth */ }
    loadAlerts();
  });

  // schematic chooser: filter bar + click-to-select list
  let schemTimer = null;
  $('#al-schem-search').addEventListener('input', () => {
    clearTimeout(schemTimer);
    schemTimer = setTimeout(alRefreshSchematicList, 250);
  });
  $('#al-schem-cat').addEventListener('change', () => alRefreshSchematicList());
  $('#al-schem-list').addEventListener('click', (e) => {
    const row = e.target.closest('.al-schem-row');
    if (!row) return;
    alState.schematic = row.dataset.sid
      ? { id: safeInt(row.dataset.sid), name: row.dataset.sname } : null;
    alState.formulaCsv = '';
    document.querySelectorAll('#al-schem-list .al-schem-row').forEach((r) =>
      r.classList.toggle('sel', r === row));
    alRenderFormulas();
  });

  // rule list actions
  $('#al-rules').addEventListener('click', async (e) => {
    const toggle = e.target.closest('[data-toggle]');
    if (toggle) {
      const rule = alState.rules.find((r) => String(r.id) === toggle.dataset.toggle);
      if (rule) {
        try {
          await api().save_alert({ id: safeInt(rule.id), name: rule.name, class_code: rule.class_code,
            stats: rule.stats_json ? JSON.parse(rule.stats_json) : {},
            schematic_id: safeInt(rule.schematic_id), formula_ids: rule.formula_ids || '',
            rank_max: safeInt(rule.rank_max), quality_min: safeInt(rule.quality_min),
            notify_email: String(rule.notify_email) === '1',
            enabled: toggle.checked });
        } catch (_) { /* reload shows truth */ }
        loadAlerts();
      }
      return;
    }
    const edit = e.target.closest('[data-edit]');
    if (edit) {
      const rule = alState.rules.find((r) => String(r.id) === edit.dataset.edit);
      if (rule) alOpenEditor(rule);
      return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      if (!confirmArmLabeled(del, 'Confirm?')) return;
      try { await api().delete_alert(safeInt(del.dataset.del)); } catch (_) { /* reload shows truth */ }
      loadAlerts();
    }
  });

  // feed rows open the resource page
  $('#al-feed').addEventListener('click', (e) => {
    const cell = e.target.closest('[data-res]');
    if (cell) openResourcePage(cell.dataset.res);
  });

  startAlertPolling();
}
