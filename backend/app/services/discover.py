"""Keeping the knowledge base honest and fresh with TinyFish (Search + Fetch are free).

* discover(): TinyFish Search over official domains for schemes / notices published recently.
  Anything not already in JAAGRUK's verified rules is shown as "new — pending verification".
* refresh_rule(): TinyFish Fetch reads a scheme's official source page, the extractor turns it into
  conditions, and Z3 proves whether they still match our rule (drift check). A match earns a
  "verified live today" badge; a difference is flagged for review instead of silently changing eligibility.
"""

from __future__ import annotations

import time

from rapidfuzz import fuzz

from .. import db
from ..ml import eligibility as el
from ..ml import extract
from ..tinyfish.client import TinyFishUnavailable, tinyfish
from ..tinyfish.harness import is_official

QUERIES = [
    (
        "new central government scheme launched for citizens",
        "pib.gov.in,myscheme.gov.in",
        "central",
    ),
    ("Delhi government new scheme yojana launched", "delhi.gov.in,pib.gov.in", "delhi"),
    (
        "scholarship application last date extended",
        "scholarships.gov.in,education.gov.in,pib.gov.in",
        "students",
    ),
    ("recruitment examination notification 2026", "ssc.gov.in,upsc.gov.in", "jobs"),
]


def _known(title: str) -> str | None:
    best, score = None, 0
    for r in el.load_schemes():
        s = max(
            fuzz.partial_ratio(r["name"].lower(), title.lower()),
            fuzz.token_set_ratio(r["name"].lower(), title.lower()),
        )
        if s > score:
            best, score = r["id"], s
    return best if score >= 85 else None


async def discover(recency_days: int = 30) -> dict:
    cached = db.cache_get("discover", max_age_s=6 * 3600)
    if cached:
        return {**cached, "cached": True}
    feed, errors = [], []
    seen = set()
    for q, domains, topic in QUERIES:
        try:
            res = await tinyfish.search(
                q,
                purpose="JAAGRUK discover: recent official schemes and notices",
                include_domains=domains,
                recency_minutes=recency_days * 1440,
            )
        except TinyFishUnavailable as exc:
            errors.append(str(exc))
            continue
        except Exception as exc:  # noqa: BLE001
            errors.append(f"{type(exc).__name__}: {exc}")
            continue
        for r in (res or {}).get("results", [])[:6]:
            if r["url"] in seen or not is_official(r["url"]):
                continue
            seen.add(r["url"])
            known = _known(r["title"])
            feed.append(
                {
                    "topic": topic,
                    "title": r["title"],
                    "url": r["url"],
                    "snippet": r.get("snippet", ""),
                    "date": r.get("date"),
                    "known_scheme": known,
                    "status": "in JAAGRUK" if known else "new — pending verification",
                    "replay": bool(res.get("_replay")),
                }
            )
    out = {"items": feed, "errors": errors, "fetched_at": time.time()}
    if feed:
        db.cache_set("discover", out)
    return {**out, "cached": False}


async def refresh_rule(scheme_id: str) -> dict:
    rule = next((r for r in el.load_schemes() if r["id"] == scheme_id), None)
    if not rule:
        return {"ok": False, "error": "unknown scheme"}
    try:
        res = await tinyfish.fetch(
            [rule["source_url"]], purpose=f"Re-verify eligibility rules for {rule['name']}", ttl=0
        )
    except TinyFishUnavailable as exc:
        return {"ok": False, "error": str(exc)}
    page = (res.get("results") or [{}])[0]
    text = page.get("text") or ""
    if len(text) < 200:
        err = (
            (res.get("errors") or [{}])[0].get("error")
            if res.get("errors")
            else "page returned too little text"
        )
        return {"ok": False, "error": err, "source_url": rule["source_url"]}
    if rule.get(
        "source_section"
    ):  # the official page covers several schemes: read only this one's section
        i = text.lower().find(rule["source_section"].lower())
        text = text[i : i + 1800] if i >= 0 else ""
    ext = await extract.extract(text, scheme_hint=rule["name"])
    d = extract.drift(rule, ext["conditions"])
    status = (
        "needs_review"
        if d["needs_review"]
        else ("verified" if d["equivalent_fields"] else "not_enough_signal")
    )
    out = {
        "ok": True,
        "scheme_id": scheme_id,
        "source_url": rule["source_url"],
        "status": status,
        "method": ext["method"],
        "extracted": ext["conditions"],
        "problems": ext["problems"],
        "drift": d,
        "checked_at": time.time(),
        "replay": bool(res.get("_replay")),
        "chars_read": len(text),
    }
    db.cache_set(f"rule_check:{scheme_id}", out)
    return out


def rule_checks() -> dict[str, dict]:
    out = {}
    for r in el.load_schemes():
        c = db.cache_get(f"rule_check:{r['id']}")
        if c:
            out[r["id"]] = {
                k: c.get(k)
                for k in (
                    "ok",
                    "status",
                    "checked_at",
                    "replay",
                    "method",
                    "drift",
                    "chars_read",
                    "source_url",
                )
            }
    return out
