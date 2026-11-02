"""Post (or list) ideas on the swgtracker.com Ideas board from the command line.

Uses the API key in the desktop app's config.json (the repo copy in dev, else
~/.swgtracker/config.json) — the key is never printed. Posting as an admin key
can mark an idea as a dev idea (--dev) or pin it (--pinned).

    venv/bin/python build/post_idea.py --title "..." --category Crafting --description "..." [--dev] [--pinned]
    venv/bin/python build/post_idea.py --list
    venv/bin/python build/post_idea.py --status shipped --id 3   # admin: open|planned|progress|shipped|declined
    venv/bin/python build/post_idea.py ... --dry-run     # show what would be sent, send nothing
"""
import argparse
import json
import sys
import urllib.error
import urllib.request
from pathlib import Path

API = "https://swgtracker.com/api/ideas.php"
APP_VERSION = "0.15.3"   # the API refuses requests without a known app version
ROOT = Path(__file__).resolve().parent.parent


def api_key() -> str:
    for p in (ROOT / "config.json", Path.home() / ".swgtracker" / "config.json"):
        if p.exists():
            cfg = json.loads(p.read_text())
            key = next((v for k, v in cfg.items() if "key" in k.lower() and isinstance(v, str) and len(v) > 10), "")
            if key:
                return key
    sys.exit("no API key found in config.json")


def call(method: str, data: dict | None = None, query: str = "") -> dict:
    req = urllib.request.Request(
        API + query, method=method,
        data=json.dumps(data).encode() if data is not None else None,
        headers={"X-API-Key": api_key(), "X-App-Version": APP_VERSION, "Content-Type": "application/json"})
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            return json.loads(r.read())
    except urllib.error.HTTPError as e:
        sys.exit(f"HTTP {e.code}: {e.read()[:300].decode(errors='replace')}")


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--list", action="store_true", help="list current ideas and categories")
    ap.add_argument("--title")
    ap.add_argument("--category", default="Other")
    ap.add_argument("--description", default="")
    ap.add_argument("--dev", action="store_true", help="mark as a dev idea (admin key only)")
    ap.add_argument("--pinned", action="store_true", help="pin to the top (admin key only)")
    ap.add_argument("--status", choices=["open", "planned", "progress", "shipped", "declined"], help="set an idea's status (admin key only; needs --id)")
    ap.add_argument("--id", type=int)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if a.list:
        d = call("GET", query="?sort=new")
        print("categories:", ", ".join(d.get("categories", [])))
        for i in d.get("ideas", []):
            print(f"#{i.get('id')} [{i.get('status')}] {i.get('votes', 0)}▲ {i.get('title')}")
        return
    if a.status:
        if not a.id:
            ap.error("--status needs --id")
        payload = {"action": "status", "id": a.id, "status": a.status}
        print(json.dumps(payload) if a.dry_run else json.dumps(call("POST", payload)))
        return
    if not a.title:
        ap.error("--title is required to post")

    payload = {"action": "submit", "title": a.title, "category": a.category,
               "description": a.description, "dev": int(a.dev), "pinned": int(a.pinned)}
    if a.dry_run:
        print(json.dumps(payload, indent=2, ensure_ascii=False))
        return
    print(json.dumps(call("POST", payload), ensure_ascii=False))


if __name__ == "__main__":
    main()
