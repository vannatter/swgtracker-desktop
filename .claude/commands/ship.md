---
description: Ship the current changes (commit, push, deploy bundle and/or bump+build shell) and announce the release notes to Discord
allowed-tools: Bash(git status:*), Bash(venv/bin/python build/ship.py:*), Bash(node --check:*), Bash(venv/bin/python -m py_compile:*)
---

Ship everything currently staged in the working tree. `build/ship.py` decides
what a ship means from what actually changed:

- **web/ changed** → deploy a new UI bundle (all clients pick it up on next launch)
- **src/ or run_web.py changed** → bump the shell patch version, rebuild the .app,
  push a `v*` tag so `release.yml` builds the mac/Windows installers
- **always** → commit + push
- **after a successful ship** → post `Desktop release <version>:` plus the release
  notes as bullet points to the Discord webhook (from the gitignored
  `build/ship_secrets.json`)

Steps (run from the repo root, `/Users/dustinvannatter/workspace/swgtrackerdesktop`):

1. **Sanity-check the diff first.** `git status --short`. If nothing is modified,
   tell the user the tree is clean and stop.
2. **Syntax-check what changed** before committing — `node --check` each modified
   `web/js/*.js`, `venv/bin/python -m py_compile` each modified `src/**/*.py`. Do
   not ship if any check fails; report the error instead.
3. **Write the release notes.** Compose a single tight message summarizing every
   user-facing change in this batch, `; `-separated (this is exactly what becomes
   the What's-new notes AND the Discord bullets — `ship.py` splits on `; `). Keep
   each clause a complete, human-readable change, not shorthand. Do NOT include a
   `vX.Y.Z —` prefix; ship.py adds the version for shell ships.
4. **Run the ship:** `venv/bin/python build/ship.py "<the notes>"`. It prints the
   plan and every step's result, ending with the Discord announce line.
   - Pass `--no-announce` only if the user explicitly says not to post to Discord.
   - Pass `--dry-run` first if the user wants to preview the plan without shipping.
5. **Report back** concisely: what shipped (bundle version and/or shell version),
   whether the Discord post succeeded, and — if any website `.php`/migration files
   are also modified in the sibling `swgtracker` repo — remind the user those
   deploy separately (ship.py only handles the desktop repo).

The webhook URL lives only in `build/ship_secrets.json`, which is gitignored —
never print it, never commit it, never inline it into a command.