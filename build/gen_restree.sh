#!/bin/bash
# Regenerate web/js/restree_data.js from the website's restree_data.php (the static
# resource cap tree behind swgtracker.com/restree.php). Static game data — rerun only
# if the site regenerates its tree (bin/gen_restree.php).
# Usage: build/gen_restree.sh [path/to/swgtracker]   (defaults to ~/workspace/swgtracker)
set -e
cd "$(dirname "$0")/.."
SITE="${1:-$HOME/workspace/swgtracker}"
php -r '
$tree = require($argv[1] . "/restree_data.php");
$S = ["oq","cr","cd","dr","hr","ma","sr","ut","fl","pe","er"];
echo "/* Resource cap tree — the SWG resource-class hierarchy with each class\x27s stat caps,\n";
echo "   generated from the website\x27s restree_data.php (static game data).\n";
echo "   Regenerate: build/gen_restree.sh. Pre-ordered rows of\n";
echo "   [code, name, parentCode, depth, hasKids, caps] — caps is [min,max] per RESTREE_STATS\n";
echo "   (max <= 0 = stat not used by that class), or null when the class has none. */\n";
echo "const RESTREE_STATS = " . json_encode($S) . ";\n";
echo "const RESTREE_ROWS = [\n";
foreach ($tree as $n) {
  $caps = null;
  if ($n["caps"]) { $caps = []; foreach ($S as $s) $caps[] = isset($n["caps"][$s]) ? [(int)$n["caps"][$s][0], (int)$n["caps"][$s][1]] : [0, 0]; }
  echo "  " . json_encode([$n["code"], $n["name"], $n["parent"], (int)$n["depth"], !empty($n["kids"]), $caps], JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE) . ",\n";
}
echo "];\n";
' "$SITE" > web/js/restree_data.js
node --check web/js/restree_data.js
echo "regenerated web/js/restree_data.js ($(wc -c < web/js/restree_data.js | tr -d ' ') bytes)"
