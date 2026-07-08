#!/usr/bin/env python3
"""
Publish a web bundle: zip web/, stamp a version, compute the sha, and deploy it
to swgtracker.com in one command via app/deploy.php.

    python3 build/publish_bundle.py --deploy --notes "..."   # build + push live
    python3 build/publish_bundle.py --list                   # active + stored versions
    python3 build/publish_bundle.py --activate 2026.07.08.1  # rollback / re-activate
    python3 build/publish_bundle.py                          # build only (manual upload)
    python3 build/publish_bundle.py --tag                    # also git-tag bundle-<version>

Deploy auth: "deploy_token" in config.json (matches bundle_deploy_token in the
site's config.php). Optional "deploy_url" overrides the endpoint for testing.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import zipfile
from datetime import date
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / "web"
OUT = ROOT / "build" / "dist_bundle"
BASE_URL = "https://swgtracker.com/app/bundles"
DEPLOY_URL = "https://swgtracker.com/app/deploy.php"
# Oldest shell able to run current bundles. Raise ONLY when the UI starts
# depending on new bridge APIs — NOT on every shell bump, or every bundle
# demands a shell newer than anyone runs.
MIN_SHELL = "0.11.15"
SKIP = {".DS_Store", "Thumbs.db"}


def deploy_conf() -> tuple[str, str]:
    """(url, token) from config.json — the same gitignored file as the API key."""
    try:
        cfg = json.loads((ROOT / "config.json").read_text())
    except (OSError, ValueError):
        cfg = {}
    return cfg.get("deploy_url") or DEPLOY_URL, cfg.get("deploy_token") or ""


def deploy_call(action: str, *, data=None, files=None):
    import requests
    url, token = deploy_conf()
    if not token:
        print("no deploy_token in config.json — add one (and bundle_deploy_token "
              "in the site's config.php)", file=sys.stderr)
        return None
    try:
        if action == "list":
            resp = requests.get(url, params={"action": "list"},
                                headers={"X-Deploy-Token": token}, timeout=30)
        else:
            resp = requests.post(url, params={"action": action}, data=data or {},
                                 files=files, headers={"X-Deploy-Token": token}, timeout=60)
        body = resp.json()
        if resp.status_code != 200:
            print(f"deploy error {resp.status_code}: {body.get('error')}", file=sys.stderr)
            return None
        return body
    except Exception as e:  # noqa: BLE001
        print(f"deploy failed: {e}", file=sys.stderr)
        return None


def auto_notes() -> str:
    """Bullet list of commit subjects since the last bundle-* tag — the
    default release notes when --notes isn't given."""
    def run(*cmd):
        return subprocess.run(cmd, capture_output=True, text=True, cwd=ROOT).stdout.strip()
    last = run("git", "describe", "--tags", "--match", "bundle-*", "--abbrev=0")
    log = run("git", "log", "--format=%s", f"{last}..HEAD") if last \
        else run("git", "log", "-8", "--format=%s")
    lines = []
    for subj in log.splitlines():
        subj = re.sub(r"^v[0-9.]+ — ", "", subj).strip()  # drop version prefixes
        if subj and not subj.lower().startswith(("merge", "bundle")):
            lines.append(subj)
    if not lines:
        return "Minor fixes and improvements"
    text = "• " + "\n• ".join(lines[:8])
    return text[:490]


def shell_version() -> str:
    m = re.search(r'APP_VERSION = "([^"]+)"', (ROOT / "run_web.py").read_text())
    return m.group(1) if m else "0"


def next_version() -> str:
    """today's date + serial: 2026.07.08.1, .2, ... (survives multiple pushes/day)"""
    stamp = date.today().strftime("%Y.%m.%d")
    existing = [p.name for p in OUT.glob(f"{stamp}.*.zip")] if OUT.exists() else []
    serials = [int(re.search(r"\.(\d+)\.zip$", n).group(1)) for n in existing
               if re.search(r"\.(\d+)\.zip$", n)]
    return f"{stamp}.{max(serials) + 1 if serials else 1}"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--version", help="override the generated version")
    ap.add_argument("--notes", default="", help="release note for the update chip")
    ap.add_argument("--min-shell", default="", help="minimum shell version (default: current)")
    ap.add_argument("--tag", action="store_true", help="git tag bundle-<version>")
    ap.add_argument("--deploy", action="store_true", help="upload + activate on swgtracker.com")
    ap.add_argument("--list", action="store_true", help="show active + stored versions")
    ap.add_argument("--activate", metavar="VERSION", help="re-activate a stored version (rollback)")
    args = ap.parse_args()

    if args.list:
        body = deploy_call("list")
        if body is None:
            return 1
        act = body.get("active") or {}
        print(f"active: {act.get('bundle_version', '—')}  (published {act.get('published', '?')})")
        for v in body.get("versions", []):
            mark = "*" if v["version"] == act.get("bundle_version") else " "
            print(f"  {mark} {v['version']}  {v['size'] // 1024} KB  {v['uploaded']}")
        return 0

    if args.activate:
        body = deploy_call("activate", data={"version": args.activate})
        if body is None:
            return 1
        print(f"activated {body.get('version')} — clients pick it up on their next check")
        return 0

    version = args.version or next_version()
    min_shell = args.min_shell or MIN_SHELL
    if args.deploy and not args.notes:
        args.notes = auto_notes()
        print("notes (from git):")
        for line in args.notes.splitlines():
            print(f"  {line}")
    OUT.mkdir(parents=True, exist_ok=True)

    zpath = OUT / f"{version}.zip"
    with zipfile.ZipFile(zpath, "w", zipfile.ZIP_DEFLATED) as z:
        for f in sorted(WEB.rglob("*")):
            if f.is_file() and f.name not in SKIP:
                z.write(f, f"web/{f.relative_to(WEB)}")

    sha = hashlib.sha256(zpath.read_bytes()).hexdigest()
    manifest = {
        "bundle_version": version,
        "sha256": sha,
        "url": f"{BASE_URL}/{version}.zip",
        "min_shell": min_shell,
        "notes": args.notes,
    }
    mpath = OUT / "bundle-manifest.json"
    mpath.write_text(json.dumps(manifest, indent=2) + "\n", encoding="utf-8")

    if args.tag:
        subprocess.run(["git", "tag", "-f", f"bundle-{version}"], cwd=ROOT, check=False)

    kb = zpath.stat().st_size // 1024
    print(f"bundle  {zpath}  ({kb} KB)")
    print(f"sha256  {sha}")
    print(f"manifest {mpath}")
    if args.deploy:
        body = deploy_call("upload", data={
            "version": version, "sha256": sha,
            "min_shell": min_shell, "notes": args.notes,
        }, files={"bundle": (zpath.name, zpath.read_bytes(), "application/zip")})
        if body is None:
            return 1
        subprocess.run(["git", "tag", "-f", f"bundle-{version}"], cwd=ROOT, check=False)
        print(f"\nDEPLOYED — {body['manifest']['url']}")
        print("clients pick it up within 4h (or on next launch); "
              f"rollback: --activate <previous>")
        return 0

    print("\nmanual upload:")
    print(f"  {zpath.name}  ->  swgtracker.com/app/bundles/{zpath.name}")
    print(f"  bundle-manifest.json  ->  swgtracker.com/app/bundle-manifest.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
