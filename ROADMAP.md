# SWG Tracker Desktop — Roadmap

Living doc for the web-UI rework (`run_web.py` + `web/`). Status legend:
✅ done · 🔨 in progress · 📋 planned · 💭 idea

---

## Distribution & Updates

The end goal: **users install once, and never manually download a build again.**

### 📋 Launcher / self-update architecture
Split the app into two layers so updates are silent:
- **Bootstrap** (frozen, installed once, ~10MB): pywebview + Python runtime + launcher.
  Rarely changes.
- **Payload** (`src/` + `web/`, plain files in the user data dir): everything we actually
  iterate on. Downloaded/swapped by the bootstrap on launch.

On launch the bootstrap polls `version.json`, downloads the payload zip when newer,
verifies sha256, swaps, runs it. UI/Python changes ship without a reinstall. The
bootstrap itself only needs a fresh download when its frozen parts change (new Python,
new pywebview, new compiled dep) — roughly once a year; the update chip covers that case.

### ✅ Update notification (tier 1)
- Header **update chip** appears when `swgtracker.com/app/version.json` reports a newer
  version; click opens the download URL. (`check_update` bridge method.)
- **Server TODO:** publish `app/version.json` → `{version, url, notes}`.

### 🔨 Build ID in header
Show the running version/build in the header so users (and we) can see what they're on.
Interim until the launcher exists.

### 📋 Packaging
PyInstaller spec bundling `web/` assets + icon. Windows build made on a Windows box
(no cross-compile). Later: code-signing cert (~$100–400/yr) to kill SmartScreen/AV
warnings, required before wide distribution + any self-modifying updater.

---

## Offline Support

### ✅ Background dataset sync (server ✅ cron · app ✅ v0.2.0)
App side: `dataset_sync.py` polls the manifest 5s after launch then every 6h,
re-downloads only on sha256 change, mirrors into `ds_resources`/`ds_schematics`
(local_db). Resources/Schematics grids fall back to the mirror on network failure
("offline data" tag in the pager); Settings → Offline Data shows counts/last-sync
+ manual Sync now.

Detail pages offline (v0.4.0): resource detail renders fully from the mirror incl.
the other-spawns tab; schematic detail (ingredients/components/formulas + current/
best per slot, recomputed locally from the resource mirror) hydrates from
`exports/schematic_details.json` — **server deploy pending**: cron2.php now persists
slim game payloads to `schematic_details` (table auto-created) and cron_exports.php
publishes them; details fill as cron2 rotates (250/run). Until deployed the app
falls back to catalog-only schematic detail. Still 📋: top_uses/related/used_in
tabs offline (needs a local schematic-formula index — derivable from the same
export later). Component quantity overrides not applied offline yet.
Server publishes pre-gzipped static exports, sha256-gated:
- `exports/manifest.json` — poll target: `{generated_at, datasets: {resources, schematics:
  {url, url_gz, bytes, bytes_gz, sha256, count}}}`
- `exports/resources.json(.gz)` — every visible resource + caps + `score` + planets + topcount
- `exports/schematics.json(.gz)` — every active schematic + `crate_size` + `component_overrides`

**App side (planned):**
- Poll `manifest.json` on a schedule; re-download a dataset only when its `sha256` changes
  (prefer `.gz`). Store in `local_db` / a cache dir.
- Resources & Schematics grids read from cache when offline (or always, for speed), falling
  back to / refreshing from the live API when online.
- Detail pages (resource/schematic) can hydrate from cache; user-scoped data (stockpile,
  wishlist, inventory, my schematics, sales) still needs the network — degrade gracefully.

### 📋 Offline state UX
- Detect offline (pulse/API failures) and show a clear banner/indicator rather than error
  toasts everywhere.
- "Last synced" indicator for cached datasets; manual re-sync control.
- Queue user writes made offline? (stretch — most writes are online-only today.)

---

## Feature Pages (rework)

- ✅ Resources (+ detail w/ tabs, score rank, planets)
- ✅ Schematics (+ detail: current/best resources, components, formulas)
- ✅ My Schematics (multi-loadout: formulas + custom names + per-slot resources + upgrade analysis)
- ✅ My Stockpile · My Wishlist (WTB + public flag) · My Inventory · My Sales
- ✅ Settings (API key lifecycle + gate)
- ✅ Server pulse + player heartbeat chart
- 📋 Spawn Alerts — stat-threshold rules per resource class → desktop notification on match.
  Needs bridge methods + notification plumbing.
- 📋 Mail Monitor — watch SWG mail folders, parse locally, store, upload; live activity +
  honor `delete_mail_after_upload` (setting shipped v0.3.2: remove uploaded .mail files) +
  local mail history. Needs `mail_parser.py`, `mails` table, upload queue, real mail samples.
- 💭 The Laboratory — experiments land here first.
- 💭 Public Wishlists — community WTB view (once the site page exists).

---

## Known Server-Side TODOs
- `app/version.json` for the update chip.
- Publish the `exports/*` cron output (offline sync).
- Confirm `wtb_cpu` int-rounding is intended (app sends decimals).
- (nice-to-have) `related_schematics` on `resources.php?name=`; `score` alias on stockpile rows.
