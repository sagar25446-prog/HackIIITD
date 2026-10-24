"""Save a raw TinyFish response (captured during development via the TinyFish MCP tools) into data/captures.

    python scripts/save_capture.py fetch  <raw.json|txt>  <name>
    python scripts/save_capture.py search <raw.json|txt>  <name> --query "..." [--include-domains a,b] [--recency 1440]
    python scripts/save_capture.py agent  <events.json>   <name> --url URL --source-id lic_unclaimed

Captures are real responses only; recorder.import_captures() turns them into replayable recordings that the
UI always labels as "replay".
"""
from __future__ import annotations

import argparse
import json
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
CAP = ROOT / "app" / "data" / "captures"


def _load(path: str):
    data = json.loads(Path(path).read_text(encoding="utf-8"))
    if isinstance(data, list) and data and isinstance(data[0], dict) and "text" in data[0]:
        data = json.loads(data[0]["text"])  # MCP tool-result wrapper
    return data


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("api", choices=["fetch", "search", "agent"])
    ap.add_argument("raw")
    ap.add_argument("name")
    ap.add_argument("--query")
    ap.add_argument("--include-domains")
    ap.add_argument("--recency", type=int)
    ap.add_argument("--domain-type")
    ap.add_argument("--url")
    ap.add_argument("--source-id")
    a = ap.parse_args()
    resp = _load(a.raw)
    out = {"api": a.api, "captured_via": "TinyFish MCP (real call)", "captured_at": time.strftime("%Y-%m-%d %H:%M"),
           "response": resp}
    if a.api == "fetch":
        resp["results"] = [r for r in resp.get("results", []) if r.get("text")]  # keep only pages with text
        out["urls"] = [r["url"] for r in resp["results"]]
    elif a.api == "search":
        if not a.query:
            sys.exit("--query is required for search captures")
        out.update(query=a.query, include_domains=a.include_domains, recency_minutes=a.recency,
                   domain_type=a.domain_type)
    else:
        out.update(url=a.url, source_id=a.source_id)
    CAP.mkdir(parents=True, exist_ok=True)
    p = CAP / f"{a.api}_{a.name}.json"
    p.write_text(json.dumps(out, ensure_ascii=False, indent=1), encoding="utf-8")
    print("saved", p)


if __name__ == "__main__":
    main()
