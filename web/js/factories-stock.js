/* Factories — take a run's resources out of My Stockpile (Izre's idea, Danvar's "I hate
   updating quantities"). Entirely opt-in: nothing touches the stockpile until the player
   opens "Use resources from stockpile" on a factory card and presses Take.

   The dialog reads the run's schematic (facReadyMatch, factories-ready.js) for its resource
   slots and units per item, so a run of N needs N × units per slot. Each slot offers the
   stockpiled resources that fit its class (category tree: a type fits a slot when the slot's
   class code is the type or one of its ancestors), defaulting to that slot's pick on the
   matching My Schematics entry when you hold it, else the one you hold most of. Every amount
   is editable, and "Don't take any" skips a slot.

   Take lowers each stockpile row's stock (api update_stockpile, like editing Amount) and
   remembers the draw for that factory's run on this computer, so the card shows what was
   taken with Put back (adds the units back onto the current stock). */

const FSTK_KEY = 'fac-stock-draws';
const facStk = { f: null, rows: [], tree: null, sid: '' };

function facStkDraws() {
  try { return JSON.parse(localStorage.getItem(FSTK_KEY) || '{}') || {}; } catch (_) { return {}; }
}
function facStkSave(map) {
  // keep a month — a draw for a run long finished is no use
  const cut = Date.now() / 1000 - 30 * 86400;
  Object.keys(map).forEach((k) => { if (!map[k] || map[k].at < cut) delete map[k]; });
  try { localStorage.setItem(FSTK_KEY, JSON.stringify(map)); } catch (_) { /* card just won't remember */ }
}
// the draw made for this factory's current (or about-to-start) run
function facStkDraw(f) {
  const d = facStkDraws()[String(f.id)];
  if (!d) return null;
  return d.at >= safeInt(f.started_at) - 900 ? d : null;
}

function facStkCardHtml(f) {
  const d = facStkDraw(f);
  if (d) {
    const first = d.takes[0];
    const more = d.takes.length > 1 ? ` + ${d.takes.length - 1} more` : '';
    const tip = d.takes.map((t) => `${fmtNum(t.units)} ${t.name}`).join(', ');
    return `<div class="fac-stk is-drawn"><i class="fa-solid fa-cubes"></i>
      <span title="${escapeHtml(tip)}">Took ${fmtShort(first.units)} ${escapeHtml(first.name)}${more} from your stockpile</span>
      <button class="btn btn-sm btn-outline-secondary" data-facstkback="${f.id}" title="Add these units back onto your stockpile">Put back</button></div>`;
  }
  if (!String(f.product || '').trim() || !(safeInt(f.quantity) > 0)) return '';
  return `<div class="fac-stk"><a role="button" data-facstkopen="${f.id}" title="Lower your My Stockpile amounts by what this run uses — you choose what and how much"><i class="fa-solid fa-cubes"></i> Use resources from stockpile</a></div>`;
}

// type code -> its ancestors' class codes
async function facStkTree() {
  if (facStk.tree) return facStk.tree;
  let flat = [];
  try {
    const res = await apiFetch('GET', 'api/categories.php');
    flat = (res.ok && res.data && res.data.resource_tree_flat) || [];
  } catch (_) { /* offline */ }
  if (!flat.length) return null;
  const m = {};
  flat.forEach((t) => { m[t.code] = [1, 2, 3, 4, 5, 6].map((n) => t[`level${n}`]).filter(Boolean); });
  facStk.tree = m;
  return m;
}
const facStkFits = (tree, typeCode, slotCode) => typeCode === slotCode || (tree[typeCode] || []).includes(slotCode);

async function facStkOpen(f) {
  const modal = $('#fstk-modal');
  facStk.f = f;
  facStk.rows = [];
  $('#fstk-title-run').textContent = `${fmtNum(safeInt(f.quantity))} × ${f.product}`;
  $('#fstk-body').innerHTML = '<div class="settings-hint"><span class="spinner"></span> Reading the schematic and your stockpile…</div>';
  $('#fstk-take').disabled = true;
  modal.hidden = false;

  const m = typeof facReadyMatch === 'function' ? await facReadyMatch(f) : null;
  if (!m || m.many) {
    $('#fstk-body').innerHTML = `<div class="settings-hint">${m
      ? `Several schematics are called “${escapeHtml(f.product)}”.`
      : `Couldn’t find a schematic called “${escapeHtml(f.product)}”.`}
      Use the exact schematic name as the product, or start the run from My Schematics → Manufacture.</div>`;
    return;
  }
  const [plan, tree] = await Promise.all([cmpPlanSchematic(m.id), facStkTree()]);
  if (typeof stkState !== 'undefined' && !stkState.items.length) {
    try { await syncStockpile(); } catch (_) { /* handled below */ }
  }
  if (facStk.f !== f || modal.hidden) return;
  if (plan.error || !tree) {
    $('#fstk-body').innerHTML = '<div class="settings-hint">Couldn’t load the schematic right now — try again in a moment.</div>';
    return;
  }
  if (!plan.res.length) {
    $('#fstk-body').innerHTML = `<div class="settings-hint">${escapeHtml(plan.name || f.product)} doesn’t take any raw resources.</div>`;
    return;
  }
  // the slot picks on your matching My Schematics entry
  if (typeof mysState !== 'undefined' && !mysState.items.length && typeof loadMySchematics === 'function') {
    try { await loadMySchematics(); } catch (_) { /* no picks then */ }
  }
  const mine = typeof mysState !== 'undefined'
    ? mysState.items.find((i) => String(i.schematic_id) === String(m.id)) : null;
  const pickFor = (code) => {
    const r = mine && (mine.resources || []).find((x) => String(x.resource_type) === String(code));
    return r && r.resource_name ? String(r.resource_name).toLowerCase() : '';
  };
  const stock = (typeof stkState !== 'undefined' ? stkState.items : []).filter((i) => safeInt(i.stock) > 0);
  const qty = safeInt(f.quantity);
  facStk.rows = plan.res.map((s) => {
    const cands = stock.filter((i) => facStkFits(tree, String(i.type_code || ''), s.code))
      .sort((a, b) => safeInt(b.stock) - safeInt(a.stock));
    const pick = pickFor(s.code);
    const def = cands.find((i) => String(i.name || '').toLowerCase() === pick) || cands[0] || null;
    const need = s.units * qty;
    return { slot: s, need, cands, sel: def ? String(def.stockpile_id) : '', amt: def ? Math.min(need, safeInt(def.stock)) : 0 };
  });
  facStkRender();
}

function facStkRender() {
  $('#fstk-body').innerHTML = facStk.rows.map((r, i) => {
    const item = r.cands.find((c) => String(c.stockpile_id) === r.sel);
    const short = item && safeInt(item.stock) < r.need;
    return `<div class="fstk-row">
      <div class="fstk-slot"><b>${escapeHtml(r.slot.name || r.slot.code)}</b>
        <span class="settings-sub">${fmtNum(r.slot.units)} each · needs ${fmtNum(r.need)}</span></div>
      <select class="form-select filter-select" data-fstksel="${i}">
        <option value="">${r.cands.length ? 'Don’t take any' : 'Nothing in your stockpile fits'}</option>
        ${r.cands.map((c) => `<option value="${c.stockpile_id}"${String(c.stockpile_id) === r.sel ? ' selected' : ''}>${escapeHtml(c.name)} — ${fmtShort(safeInt(c.stock))} held</option>`).join('')}
      </select>
      <input type="number" min="0" class="form-control filter-input fstk-amt" data-fstkamt="${i}" value="${item ? r.amt : ''}" ${item ? '' : 'disabled'} title="Units to take off your stockpile">
      ${short ? `<span class="fstk-short" title="You hold ${fmtNum(safeInt(item.stock))} — it won’t go below 0">short ${fmtShort(r.need - safeInt(item.stock))}</span>` : '<span></span>'}
    </div>`;
  }).join('');
  $('#fstk-take').disabled = !facStk.rows.some((r) => r.sel && r.amt > 0);
}

async function facStkTake() {
  const f = facStk.f;
  if (!f) return;
  const btn = $('#fstk-take');
  btn.disabled = true;
  const takes = [];
  let failed = 0;
  for (const r of facStk.rows) {
    const item = r.cands.find((c) => String(c.stockpile_id) === r.sel);
    const units = Math.min(r.amt, safeInt(item && item.stock));
    if (!item || units <= 0) continue;
    const next = safeInt(item.stock) - units;
    let res;
    try { res = await api().update_stockpile(item.stockpile_id, next); } catch (e) { res = { ok: false }; }
    if (!res.ok) { failed++; continue; }
    item.stock = next;
    takes.push({ sid: String(item.stockpile_id), name: item.name, units });
  }
  btn.disabled = false;
  if (takes.length) {
    const map = facStkDraws();
    map[String(f.id)] = { at: Math.floor(Date.now() / 1000), product: f.product, takes };
    facStkSave(map);
  }
  $('#fstk-modal').hidden = true;
  if (typeof renderStockpile === 'function') renderStockpile();
  renderFactories();
  toast(failed ? `Took ${takes.length} from your stockpile — ${failed} couldn’t be saved` : `Took ${takes.map((t) => `${fmtShort(t.units)} ${t.name}`).join(', ')} from your stockpile`, !failed);
}

async function facStkPutBack(fid) {
  const map = facStkDraws();
  const d = map[String(fid)];
  if (!d) return;
  if (typeof stkState !== 'undefined' && !stkState.items.length) {
    try { await syncStockpile(); } catch (_) { /* below */ }
  }
  let failed = 0;
  for (const t of d.takes) {
    const item = (typeof stkState !== 'undefined' ? stkState.items : []).find((i) => String(i.stockpile_id) === t.sid);
    if (!item) { failed++; continue; }   // removed from the stockpile since
    const next = safeInt(item.stock) + t.units;
    let res;
    try { res = await api().update_stockpile(item.stockpile_id, next); } catch (e) { res = { ok: false }; }
    if (res.ok) item.stock = next; else failed++;
  }
  delete map[String(fid)];
  facStkSave(map);
  if (typeof renderStockpile === 'function') renderStockpile();
  renderFactories();
  toast(failed ? `Put back what we could — ${failed} resource${failed === 1 ? ' is' : 's are'} no longer in your stockpile` : 'Put the resources back in your stockpile', !failed);
}

document.addEventListener('DOMContentLoaded', () => {
  document.addEventListener('click', (e) => {
    const open = e.target.closest('[data-facstkopen]');
    if (open) {
      const f = facState.items.find((x) => String(x.id) === open.dataset.facstkopen);
      if (f) facStkOpen(f);
      return;
    }
    const back = e.target.closest('[data-facstkback]');
    if (back) facStkPutBack(back.dataset.facstkback);
  });
  $('#fstk-cancel').addEventListener('click', () => { $('#fstk-modal').hidden = true; facStk.f = null; });
  $('#fstk-take').addEventListener('click', facStkTake);
  $('#fstk-body').addEventListener('change', (e) => {
    const sel = e.target.closest('[data-fstksel]');
    if (sel) {
      const r = facStk.rows[safeInt(sel.dataset.fstksel)];
      r.sel = sel.value;
      const item = r.cands.find((c) => String(c.stockpile_id) === r.sel);
      r.amt = item ? Math.min(r.need, safeInt(item.stock)) : 0;
      facStkRender();
    }
  });
  $('#fstk-body').addEventListener('input', (e) => {
    const amt = e.target.closest('[data-fstkamt]');
    if (amt) {
      facStk.rows[safeInt(amt.dataset.fstkamt)].amt = Math.max(0, safeInt(amt.value));
      $('#fstk-take').disabled = !facStk.rows.some((r) => r.sel && r.amt > 0);
    }
  });
});
