#!/bin/bash
# Regenerate web/js/class_caps.js from the site DB's resource_types table.
# Class stat caps are static game data — rerun only if the resource tree changes.
# Usage: build/gen_class_caps.sh   (needs the local ServBay MySQL socket)
set -e
cd "$(dirname "$0")/.."
MYSQL="/Applications/ServBay/package/mysql/current/bin/mysql"
"$MYSQL" -uroot -p'ServBay.dev' -S /Applications/ServBay/tmp/mysql.sock swgtracker_com -N -e \
  "SELECT resource_code, oq_max, cr_max, cd_max, dr_max, hr_max, ma_max, sr_max, ut_max, fl_max, pe_max FROM resource_types ORDER BY resource_code;" 2>/dev/null \
| python3 -c "
import sys
rows = [l.rstrip('\n').split('\t') for l in sys.stdin if l.strip()]
print('/* Resource-class stat caps (oq,cr,cd,dr,hr,ma,sr,ut,fl,pe per class code) —')
print('   generated from the site DB resource_types table (static game data).')
print('   Regenerate: build/gen_class_caps.sh. Used by weightedQuality: the game')
print('   normalizes each stat by the SCHEMATIC SLOT class cap, e.g. Beyrllius')
print('   Copper caps SR at 483, so SR 475 is ~983/1000 for that slot. */')
print('const CLASS_CAPS_STATS = [\'oq\',\'cr\',\'cd\',\'dr\',\'hr\',\'ma\',\'sr\',\'ut\',\'fl\',\'pe\'];')
print('const CLASS_CAPS = {')
for r in rows:
    code = r[0].replace('\\\\','').replace(\"'\",'')
    print('  ' + repr(code) + ': [' + ','.join(r[1:]) + '],')
print('};')
print('''
// caps object {oq: 1000, ...} for a slot/ingredient class code; null when unknown
function classCaps(code) {
  const a = CLASS_CAPS[String(code || '')];
  if (!a) return null;
  const out = {};
  CLASS_CAPS_STATS.forEach((s, i) => { out[s] = a[i]; });
  return out;
}''')
" > web/js/class_caps.js
node --check web/js/class_caps.js
echo "regenerated web/js/class_caps.js ($(wc -c < web/js/class_caps.js | tr -d ' ') bytes)"
