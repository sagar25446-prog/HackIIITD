"""Stores real TinyFish responses so the app (and its evaluation) works even without a key or network.

Recordings are only ever produced by real TinyFish calls (live runs of this app, or runs captured
during development). Replayed responses are always labelled as replays in the UI and the call log.
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from ..config import DATA_DIR

REC_DIR = DATA_DIR / "recordings"
REC_DIR.mkdir(parents=True, exist_ok=True)


def key(api: str, parts: list[Any]) -> str:
    raw = json.dumps([api, parts], sort_keys=True, default=str)
    return f"{api}-{hashlib.sha1(raw.encode()).hexdigest()[:16]}"


def save(k: str, api: str, target: str | None, response: Any) -> None:
    try:
        (REC_DIR / f"{k}.json").write_text(json.dumps(
            {"api": api, "target": target, "recorded_at": time.strftime("%Y-%m-%d %H:%M"), "response": response},
            ensure_ascii=False, indent=1), encoding="utf-8")
    except OSError:
        pass


def load(k: str) -> dict | None:
    p = REC_DIR / f"{k}.json"
    if p.exists():
        return json.loads(p.read_text(encoding="utf-8"))
    return None


def age_hours(rec: dict) -> float:
    try:
        return (time.time() - time.mktime(time.strptime(rec.get("recorded_at", ""), "%Y-%m-%d %H:%M"))) / 3600
    except ValueError:
        return 1e9


def load_similar(api: str, target: str | None) -> dict | None:
    """Fallback: newest recording of the same API whose target matches."""
    if not target:
        return None
    best = None
    for p in REC_DIR.glob(f"{api}-*.json"):
        try:
            rec = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        if rec.get("target") == target and (best is None or rec.get("recorded_at", "") > best.get("recorded_at", "")):
            best = rec
    return best


def load_closest(api: str, target: str | None, min_score: int = 55) -> dict | None:
    """Offline fallback for free-text calls (research questions): the recording whose question is most alike."""
    if not target:
        return None
    from rapidfuzz import fuzz

    best, score = None, min_score
    for p in REC_DIR.glob(f"{api}-*.json"):
        try:
            rec = json.loads(p.read_text(encoding="utf-8"))
        except (OSError, json.JSONDecodeError):
            continue
        s = fuzz.token_set_ratio(str(rec.get("target", "")).lower(), target.lower())
        if s > score:
            best, score = rec, s
    return best


def _write(k: str, api: str, target: str | None, response: Any, when: str) -> None:
    p = REC_DIR / f"{k}.json"
    if not p.exists():
        p.write_text(json.dumps({"api": api, "target": target, "recorded_at": when, "response": response},
                                ensure_ascii=False, indent=1), encoding="utf-8")


def import_captures() -> int:
    """Turn real responses captured during development (data/captures) into replayable recordings."""
    n = 0
    for p in sorted((DATA_DIR / "captures").glob("*.json")):
        cap = json.loads(p.read_text(encoding="utf-8"))
        when, resp = cap.get("captured_at", ""), cap["response"]
        if cap["api"] == "fetch":
            urls = cap.get("urls") or [r["url"] for r in resp.get("results", [])]
            _write(key("fetch", [sorted(urls), "markdown"]), "fetch", ", ".join(urls), resp, when)
            for r in resp.get("results", []):  # single-page reads (rule re-checks, monitor webhooks)
                _write(key("fetch", [[r["url"]], "markdown"]), "fetch", r["url"],
                       {"results": [r], "errors": []}, when)
                n += 1
        elif cap["api"] == "search":
            parts = [cap["query"], cap.get("include_domains"), cap.get("recency_minutes"), cap.get("domain_type")]
            _write(key("search", parts), "search", cap["query"], resp, when)
            n += 1
        elif cap["api"] == "agent":
            _write(f"agent_stream-capture-{p.stem}", "agent_stream", cap["url"], resp, when)
            n += 1
        elif cap["api"] == "playbook":
            _write(f"playbook-{cap['name']}", "playbook", cap["url"], resp, when)
            n += 1
    return n
