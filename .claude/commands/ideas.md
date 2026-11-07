---
description: Triage the swgtracker.com Ideas board — review open ideas, recommend what to build next, and keep statuses in step with the work
allowed-tools: Bash(venv/bin/python build/post_idea.py *)
---

Work the community Ideas board (https://swgtracker.com/ideas.php) with Dustin.
Everything goes through `build/post_idea.py` (admin key from config.json, never
printed) — always invoke it in exactly that form, one command per call; it is
allow-listed that way and ad-hoc curl/python writes to prod are blocked.

Optional argument: `$ARGUMENTS` — an idea number to focus on (e.g. `/ideas 21`),
or a word like `new` / `shipped`. With no argument, do a full triage.

## Triage (default)

1. **Pull the board:** `venv/bin/python build/post_idea.py --list --full --status-filter open`
   (and `--status-filter planned` / `progress` if any exist).
2. **Split community from dev ideas.** Anything not posted by `Dev` came from a
   player — call those out first, by number, with the submitter's name.
3. **Check each one against the code before judging it.** Many requests are
   already partly built or are a small tweak to an existing page — say so
   (with the file/page) instead of treating them as new features. Note what
   would be power-user only (Advanced tools) versus for everyone.
4. **Recommend a short next batch** (2–4 ideas), ranked, each with: what it is in
   one line, rough size (small / medium / large), app vs website vs both, and
   why now (votes, a player asked, builds on something just shipped). Keep the
   rest as a one-line "later" list. Don't survey everything at length.
5. **Ask before changing anything on the board.** Status changes and labels are public.
   The board list shows each idea's label in braces (`{Blocked}`) and, with `--full`,
   its note; `--label-filter blocked` (or `none`) narrows the list.

## Keeping statuses in step

- Dustin approves a batch → mark each `planned`:
  `venv/bin/python build/post_idea.py --status planned --id N`
- Work actually starts → `progress`. After a ship that includes it → `shipped`.
- Declining (duplicate, out of scope) → `declined`, only with Dustin's OK, and
  suggest a short reason he can reply with.
- New roadmap items we come up with get posted as dev ideas
  (`--title … --category … --description … --dev`) once Dustin approves them.
  Categories: Crafting, Resources, Sales & Inventory, Beasts, Galaxy, App, Website, Other.

## Labels

Labels are the dev's public read on an idea, separate from its status, and they
notify nobody: `will_do`, `researching`, `blocked`, `needs_info`, `cant_do` (or
`none` to clear), with an optional short note (200 chars max) shown under the
description. **Propose the label + note wording and ask Dustin before setting any.**

- Can't be built yet (missing data, game limits) → `blocked` + why:
  `venv/bin/python build/post_idea.py --label blocked --note "needs a collections data export from the game files" --id N`
- Unclear what the player means → `needs_info` + the question to answer.
- Agreed but not scheduled → `will_do`; looking into feasibility → `researching`.
- Won't happen → `cant_do` + a short reason (often alongside `--status declined`).
- `--label` and `--note` combine with `--status` in one command; `--note ""`
  clears the note, `--label none` clears both. Check with `--dry-run` first.

## When shipping

Release notes that deliver a community idea credit the submitter
("… (requested by Canda)"), and the idea is marked `shipped` right after
`ship.py` succeeds. Never mark something shipped that is only on a branch or
still waiting on a website deploy.
