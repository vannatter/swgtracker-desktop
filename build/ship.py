#!/usr/bin/env python3
"""
ship.py — one command from "code changed" to "deployed".

    python3 build/ship.py "what changed"          # do everything appropriate
    python3 build/ship.py "msg" --no-app          # skip the local .app rebuild
    python3 build/ship.py "msg" --no-tag          # skip the v* release tag (no installer build)
    python3 build/ship.py "msg" --dry-run         # show the plan, do nothing

Looks at what's actually modified and:
  web/ changed         -> deploy a UI bundle (auto release notes from commits)
  src/ or run_web.py   -> bump the shell patch version (+pyproject), rebuild .app,
                          and push a v* tag so release.yml builds the mac/win
                          installers and announces version.json to installed apps
  anything             -> commit + push

Shell version moves ONLY when shell code moves — UI-only changes ride the
bundle version and leave v0.x.y alone.
"""
from __future__ import annotations

import argparse
import re
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SHELL_PATHS = ("src/", "run_web.py")
UI_PATHS = ("web/",)
CO_AUTHOR = "\n\nCo-Authored-By: Claude Fable 5 <noreply@anthropic.com>"


def run(*cmd, check=True, capture=True):
    return subprocess.run(cmd, cwd=ROOT, check=check,
                          capture_output=capture, text=True)


def changed_files() -> list[str]:
    out = run("git", "status", "--porcelain").stdout
    return [line[3:].split(" -> ")[-1].strip('"') for line in out.splitlines() if line.strip()]


def classify(files: list[str]) -> tuple[bool, bool]:
    ui = any(f.startswith(UI_PATHS) for f in files)
    shell = any(f.startswith(SHELL_PATHS) for f in files)
    return ui, shell


def current_version() -> str:
    m = re.search(r'APP_VERSION = "([^"]+)"', (ROOT / "run_web.py").read_text())
    return m.group(1)


def bump_patch(v: str) -> str:
    parts = v.split(".")
    parts[-1] = str(int(parts[-1]) + 1)
    return ".".join(parts)


def set_version(new: str):
    old = current_version()
    for path, pat in (("run_web.py", f'APP_VERSION = "{old}"'),
                      ("pyproject.toml", f'version = "{old}"')):
        p = ROOT / path
        s = p.read_text()
        rep = pat.replace(old, new)
        assert pat in s, f"{pat!r} not in {path}"
        p.write_text(s.replace(pat, rep, 1))


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("message", help="commit message (first line = summary)")
    ap.add_argument("--no-app", action="store_true", help="skip the local .app rebuild")
    ap.add_argument("--no-tag", action="store_true",
                    help="skip pushing the v* release tag (no shell installer build)")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    files = changed_files()
    if not files:
        print("nothing to ship — working tree is clean")
        return 0
    ui, shell = classify(files)
    version = current_version()
    new_version = bump_patch(version) if shell else version

    print(f"changes: {len(files)} files  (ui={ui} shell={shell})")
    print(f"shell:   v{version}" + (f" -> v{new_version}" if shell else "  (unchanged)"))
    print(f"plan:    commit, push" + (", deploy UI bundle" if ui else "")
          + (", tag + trigger installer build" if shell and not args.no_tag else "")
          + (", rebuild .app" if shell and not args.no_app else ""))
    if args.dry_run:
        return 0

    if shell:
        set_version(new_version)

    run("git", "add", "-A")
    msg = args.message if not shell else f"v{new_version} — {args.message}"
    run("git", "commit", "-m", msg + CO_AUTHOR)
    run("git", "push", "origin", "main")
    print(f"committed + pushed: {msg.splitlines()[0]}")

    if shell and not args.no_tag:
        tag = f"v{new_version}"
        existing = run("git", "tag", "--list", tag).stdout.strip()
        if existing:
            print(f"tag {tag} already exists — skipping (push it manually to rebuild)")
        else:
            run("git", "tag", tag)
            run("git", "push", "origin", tag)
            print(f"tagged + pushed {tag} — release.yml is building the mac .app + "
                  f"Windows installer and will announce version.json to installed apps")

    if ui:
        r = run(sys.executable, "build/publish_bundle.py", "--deploy", check=False)
        tail = [l for l in (r.stdout + r.stderr).splitlines() if "DEPLOYED" in l or "•" in l]
        print("\n".join(tail) if tail else "bundle deploy FAILED:\n" + r.stdout + r.stderr)
        if "DEPLOYED" not in r.stdout:
            return 1

    if shell and not args.no_app:
        print("rebuilding .app …")
        r = run("bash", "build/build_mac.sh", check=False)
        print(r.stdout.splitlines()[-1] if r.returncode == 0
              else "app build FAILED:\n" + r.stdout + r.stderr)
        if r.returncode != 0:
            return 1
        print("note: shell users need the new .app (version.json release "
              "once that channel is live)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
