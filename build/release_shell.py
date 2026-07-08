#!/usr/bin/env python3
"""
release_shell.py — publish a new public app build.

    python3 build/release_shell.py                # release the current version
    python3 build/release_shell.py --notes "..."  # override auto notes
    python3 build/release_shell.py --dry-run

Does, in order:
  1. zip dist/SWG Tracker Desktop.app  ->  SWG-Tracker-Desktop-<v>-macos.zip
  2. gh release create v<v> (tag + notes; auto notes = 'vX — ' commit
     subjects since the previous release tag) and upload the zip
  3. POST action=shellrelease to app/deploy.php -> publishes version.json,
     so every installed app's header chip announces the new download

Extra assets (e.g. a Windows build made on the Windows box) can be attached
later with:  gh release upload v<v> <file>

Needs: gh CLI authenticated (gh auth login), deploy_token in config.json.
"""
from __future__ import annotations

import argparse
import json
import re
import subprocess
import sys
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
APP = ROOT / "dist" / "SWG Tracker Desktop.app"
DEPLOY_URL = "https://swgtracker.com/app/deploy.php"


def run(*cmd, check=True):
    return subprocess.run(cmd, cwd=ROOT, check=check, capture_output=True, text=True)


def current_version() -> str:
    m = re.search(r'APP_VERSION = "([^"]+)"', (ROOT / "run_web.py").read_text())
    return m.group(1)


def auto_notes(tag: str) -> str:
    last = run("git", "describe", "--tags", "--match", "v*", "--abbrev=0",
               check=False).stdout.strip()
    log = run("git", "log", "--format=%s", f"{last}..HEAD").stdout if last \
        else run("git", "log", "-15", "--format=%s").stdout
    lines = []
    for subj in log.splitlines():
        # shell releases summarize the versioned commits; skip pure-UI noise
        m = re.match(r"^v[0-9.]+ — (.+)$", subj)
        if m:
            lines.append(f"- {m.group(1)}")
    return "\n".join(lines[:15]) or f"SWG Tracker Desktop {tag}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--notes", default="")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    version = current_version()
    tag = f"v{version}"
    if not APP.is_dir():
        print("dist/SWG Tracker Desktop.app missing — run build/build_mac.sh first",
              file=sys.stderr)
        return 1

    notes = args.notes or auto_notes(tag)
    zname = f"SWG-Tracker-Desktop-{version}-macos.zip"
    zpath = ROOT / "dist" / zname
    print(f"release {tag}\nnotes:\n{notes}\nasset: {zname}")
    if args.dry_run:
        return 0

    # 1. zip the .app (preserving structure; ditto keeps mac metadata intact)
    zpath.unlink(missing_ok=True)
    r = run("ditto", "-c", "-k", "--keepParent", str(APP), str(zpath), check=False)
    if r.returncode != 0:
        print("zip failed:", r.stderr, file=sys.stderr)
        return 1

    # 2. GitHub release (idempotent-ish: recreate the tag's assets on rerun)
    exists = run("gh", "release", "view", tag, check=False).returncode == 0
    if exists:
        run("gh", "release", "upload", tag, str(zpath), "--clobber")
    else:
        run("gh", "release", "create", tag, str(zpath),
            "--title", f"SWG Tracker Desktop {version}", "--notes", notes)
    url = f"https://github.com/vannatter/swgtracker-desktop/releases/tag/{tag}"
    print(f"github release: {url}")

    # 3. announce to installed apps via version.json
    import requests
    cfg = json.loads((ROOT / "config.json").read_text())
    token = cfg.get("deploy_token", "")
    if not token:
        print("no deploy_token — version.json NOT published", file=sys.stderr)
        return 1
    resp = requests.post(cfg.get("deploy_url") or DEPLOY_URL,
                         params={"action": "shellrelease"},
                         data={"version": version, "url": url, "notes": notes[:490]},
                         headers={"X-Deploy-Token": token}, timeout=30)
    body = resp.json()
    if resp.status_code != 200:
        print(f"version.json publish failed: {body.get('error')}", file=sys.stderr)
        return 1
    print(f"version.json live — installed apps will show the 'Update {tag}' chip")
    return 0


if __name__ == "__main__":
    sys.exit(main())
