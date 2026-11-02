// ---- Insight alerts (Settings → Sales alerts) ----
// Opt-in nudges the server works out from the Sales Insights data: an item
// that's been out of stock for days, a regular buyer who's gone quiet, an item
// selling well above its usual pace. The switches live server-side
// (api/sales.php ?action=alert_prefs, shared with the website's Settings); the
// server also remembers what it already sent, so each alert fires once per
// episode. Every 30 minutes the app asks for whatever is newly due and drops
// each into the bell + a desktop notification (appLocalAlert).

const INSA_POLL_MS = 30 * 60 * 1000;
let insaPrefs = null;   // last prefs seen — null until Settings or a poll loads them

async function insaSweep() {
  let res;
  try { res = await apiFetch('GET', 'api/sales.php', { params: { action: 'alerts' } }); } catch (_) { return; }
  if (!res || !res.ok || !res.data || !Array.isArray(res.data.alerts)) return;  // offline / older site
  insaPrefs = res.data.prefs || insaPrefs;
  for (const a of res.data.alerts) {
    if (a && a.title) appLocalAlert(a.title, a.message || '');
  }
}

// Settings: load the switches (read-only call — never consumes due alerts)
async function insaLoadPrefs() {
  const box = $('#set-insa');
  if (!box) return;
  let res;
  try { res = await apiFetch('GET', 'api/sales.php', { params: { action: 'alert_prefs' } }); } catch (_) { res = null; }
  const ok = !!(res && res.ok && res.data && res.data.prefs);
  $('#set-insa-off').hidden = ok;
  box.querySelectorAll('input, select').forEach((el) => { el.disabled = !ok; });
  if (!ok) return;
  insaPrefs = res.data.prefs;
  $('#set-insa-stockout').checked = !!insaPrefs.stockout;
  $('#set-insa-days').value = String(insaPrefs.stockout_days || 2);
  $('#set-insa-quiet').checked = !!insaPrefs.quiet;
  $('#set-insa-heating').checked = !!insaPrefs.heating;
}

// Settings Save: push the switches only if they changed (account-side, like the username)
async function insaSavePrefs() {
  if (!$('#set-insa') || !insaPrefs || $('#set-insa-stockout').disabled) return;
  const next = {
    stockout: $('#set-insa-stockout').checked,
    stockout_days: safeInt($('#set-insa-days').value) || 2,
    quiet: $('#set-insa-quiet').checked,
    heating: $('#set-insa-heating').checked,
  };
  if (Object.keys(next).every((k) => (k === 'stockout_days' ? safeInt(insaPrefs[k]) : !!insaPrefs[k]) === next[k])) return;
  const res = await apiFetch('POST', 'api/sales.php', { data: { action: 'alert_prefs', ...next } });
  if (!res.ok) throw new Error(res.error || 'failed to save sales alerts');
  insaPrefs = res.data.prefs || next;
  // a switch just turned on — don't make them wait half an hour for the first check
  if (next.stockout || next.quiet || next.heating) setTimeout(insaSweep, 5000);
}

// first check two minutes after launch (past the boot rush), then every 30
setTimeout(() => { insaSweep(); setInterval(insaSweep, INSA_POLL_MS); }, 2 * 60 * 1000);
