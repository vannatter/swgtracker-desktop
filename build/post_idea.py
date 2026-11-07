"""Post (or list) ideas on the swgtracker.com Ideas board from the command line.

Uses the API key in the desktop app's config.json (the repo copy in dev, else
~/.swgtracker/config.json) — the key is never printed. Posting as an admin key
can mark an idea as a dev idea (--dev) or pin it (--pinned).

    venv/bin/python build/post_idea.py --title "..." --category Crafting --description "..." [--dev] [--pinned]
    venv/bin/python build/post_idea.py --list [--full] [--status-filter open] [--label-filter blocked]
        # --full adds who posted, the description and the label's note; --label-filter none = unlabelled
    venv/bin/python build/post_idea.py --status shipped --id 3   # admin: open|planned|progress|shipped|declined
    venv/bin/python build/post_idea.py --status shipped --id 3 --version 2026.11.05.1   # + the release it went out in
        (marking Shipped notifies everyone who voted for it, once — the version rides along to their bell / push)
    venv/bin/python build/post_idea.py --label blocked --note "needs a collections data export" --id 3   # admin
        labels: will_do|researching|blocked|needs_info|cant_do|none — public, separate from status, notifies nobody;
        --label alone keeps the note, --note alone keeps the label, --note "" clears it, --label none clears both;
        combine with --status to set both in one go
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
LABELS = ["will_do", "researching", "blocked", "needs_info", "cant_do"]


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
    ap.add_argument("--full", action="store_true", help="with --list: also print who posted it and the description")
    ap.add_argument("--status-filter", choices=["open", "planned", "progress", "shipped", "declined"], help="with --list: only this status")
    ap.add_argument("--label-filter", choices=LABELS + ["none"], help="with --list: only this label (none = unlabelled)")
    ap.add_argument("--title")
    ap.add_argument("--category", default="Other")
    ap.add_argument("--description", default="")
    ap.add_argument("--dev", action="store_true", help="mark as a dev idea (admin key only)")
    ap.add_argument("--pinned", action="store_true", help="pin to the top (admin key only)")
    ap.add_argument("--status", choices=["open", "planned", "progress", "shipped", "declined"], help="set an idea's status (admin key only; needs --id)")
    ap.add_argument("--label", choices=LABELS + ["none"], help="set an idea's public label (admin key only; needs --id; none clears it and its note)")
    ap.add_argument("--note", help="with --id: the label's short public reason (max 200 chars; \"\" clears it)")
    ap.add_argument("--id", type=int)
    ap.add_argument("--version", help="with --status shipped: the release it went out in (e.g. 0.15.4 or 2026.11.05.1)")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()

    if a.list:
        d = call("GET", query="?sort=new" + (f"&label={a.label_filter}" if a.label_filter else ""))
        print("categories:", ", ".join(d.get("categories", [])))
        names = d.get("labels") or {}
        for i in d.get("ideas", []):
            if a.status_filter and i.get("status") != a.status_filter:
                continue
            lb = i.get("label") or ""
            if a.label_filter and lb != ("" if a.label_filter == "none" else a.label_filter):
                continue
            print(f"#{i.get('id')} [{i.get('status')}]" + (f" {{{names.get(lb, lb)}}}" if lb else "")
                  + f" {i.get('votes', 0)}▲ {i.get('title')}"
                  + (f"  — {i.get('by')} · {i.get('category', '')}" if a.full else ""))
            if a.full and i.get("description"):
                print("    " + str(i["description"]).replace("\n", "\n    "))
            if a.full and lb and i.get("label_note"):
                print(f"    [{names.get(lb, lb)} — {i['label_note']}]")
        return
    if a.status or a.label or a.note is not None:
        if not a.id:
            ap.error("--status / --label / --note need --id")
        if a.version and a.status != "shipped":
            ap.error("--version goes with --status shipped")
        if a.note is not None and len(a.note) > 200:
            ap.error("--note is 200 characters max")
        if a.label == "none" and a.note:
            ap.error("--label none clears the note too — drop --note")
        payloads = []
        if a.status:
            payloads.append({"action": "status", "id": a.id, "status": a.status, **({"version": a.version} if a.version else {})})
        if a.label or a.note is not None:
            # only the fields given change server-side (a label never notifies anyone)
            payloads.append({"action": "label", "id": a.id, **({"label": a.label} if a.label else {}),
                             **({"note": a.note} if a.note is not None else {})})
        for p in payloads:
            print(json.dumps(p, ensure_ascii=False) if a.dry_run else json.dumps(call("POST", p), ensure_ascii=False))
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
