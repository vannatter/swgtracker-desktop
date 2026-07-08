#!/usr/bin/env python3
"""
Publish a web bundle: zip web/, stamp a version, compute the sha, and emit the
manifest. Output lands in build/dist_bundle/ — upload both files to
swgtracker.com/app/ (the zip into app/bundles/).

    python3 build/publish_bundle.py                 # version = today's date + serial
    python3 build/publish_bundle.py --notes "..."   # note shown in the update chip
    python3 build/publish_bundle.py --tag           # also git-tag bundle-<version>

Rollback = re-upload the previous manifest (keep the old zips around; they're
~110KB each).
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
SKIP = {".DS_Store", "Thumbs.db"}


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
    args = ap.parse_args()

    version = args.version or next_version()
    min_shell = args.min_shell or shell_version()
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
    print("\nupload:")
    print(f"  {zpath.name}  ->  swgtracker.com/app/bundles/{zpath.name}")
    print(f"  bundle-manifest.json  ->  swgtracker.com/app/bundle-manifest.json")
    return 0


if __name__ == "__main__":
    sys.exit(main())
