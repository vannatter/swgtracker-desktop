---
description: Relaunch the local SWG Tracker Desktop test client (kills any running instance first)
allowed-tools: Bash(pkill:*), Bash(venv/bin/python run_web.py:*), Bash(sleep:*), Bash(grep:*)
---

Relaunch the local test client so the user can verify UI changes in the real app.

Steps (run from the repo root, `/Users/dustinvannatter/workspace/swgtrackerdesktop`):

1. Stop any client already running so we don't stack windows or lock the DB:
   `pkill -f run_web.py` — ignore a non-zero exit (means nothing was running).
2. Launch a fresh instance **in the background**: `venv/bin/python run_web.py`
   (use `run_in_background: true` so the window stays open and this turn continues).
3. Wait a few seconds, then confirm it booted cleanly — tail the background task's
   output and check for the "starting" log line and the absence of JS errors
   (`log_js`, `not defined`, `Traceback`), ignoring the benign
   `urllib3 ... Connection pool is full` warnings.

Then tell the user the client is open (or surface any boot error). Keep it brief —
this is a utility command, not a task to over-report.