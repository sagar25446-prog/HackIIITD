"""Wapsi: find a family's unclaimed money across official portals, in parallel, with live agent views.

planner (which portals fit this person) → TinyFish agents in parallel (run-sse; each streams a live
browser view) → verifier (COMPLETED ≠ success) → self-heal → name matcher on whatever the portals return
→ claim kit. Portals that need the citizen's own OTP are never automated past the login: they are marked
`needs_human` and offered as an assisted session where the citizen types the OTP themselves.
"""
from __future__ import annotations

import asyncio
import re
from typing import Any

from ..ml import name_match
from ..tinyfish import harness
from . import jobs, persona

DOCS_FOR_CLAIM = {
    "deceased": ["doc_death_certificate", "doc_legal_heir_certificate", "doc_bank_account"],
    "self": ["doc_bank_account"],
}


def _context(person: dict) -> dict[str, Any]:
    pan = (person.get("pan") or "").strip().upper()
    if pan and not re.fullmatch(r"[A-Z]{5}\d{4}[A-Z]", pan):
        pan = ""  # never send a malformed identifier to a portal
    return {"name": person.get("name", "").strip(), "dob": person.get("dob", "").strip(), "pan": pan or None,
            "policy_no": (person.get("policy_no") or "").strip() or None,
            "pan_clause": f" and PAN '{pan}'" if pan else ""}


def plan(profile: dict, person: dict) -> list[harness.Task]:
    tags = set(persona.tags(persona.build(profile))) | {"all", "family"}
    return harness.plan("wapsi", tags, _context(person))


def _amount(result: Any) -> int:
    if not isinstance(result, dict):
        return 0
    try:
        return int(float(result.get("amount_inr") or 0))
    except (TypeError, ValueError):
        return 0


def _annotate(rec: dict, person: dict, src: dict) -> dict:
    """Add name-match evidence and a claim kit to a finished portal result."""
    res = rec.get("result") if isinstance(rec.get("result"), dict) else {}
    holder = (res or {}).get("holder_name") or ""
    match = None
    if holder:
        match = name_match.match_probability(person.get("name", ""), holder, dob_a=person.get("dob"),
                                             dob_b=(res or {}).get("holder_dob"))
    found = bool((res or {}).get("found"))
    if found and match and match["probability"] < 0.5:
        found = False  # someone else's money: a different person with a similar name
    who = "deceased" if person.get("deceased") else "self"
    return {**rec, "found": found, "amount_inr": _amount(res) if found else 0, "holder_name": holder or None,
            "name_match": match,
            "claim_kit": {"how": src.get("claim_how"), "documents": DOCS_FOR_CLAIM[who],
                          "fee": "Free — never pay an agent", "source_url": src.get("url")} if found else None}


async def run(job: jobs.Job, profile: dict, person: dict) -> dict:
    tasks = plan(profile, person)
    by_id = {t.source["id"]: t.source for t in tasks}
    await job.emit({"phase": "plan", "tasks": [{"task_id": t.id, "source_id": t.source["id"], "name": t.source["name"],
                                                "asset": t.source.get("asset"),
                                                "needs_human": bool(t.source.get("requires_human"))} for t in tasks],
                    "searching_for": person.get("name")})
    sem = asyncio.Semaphore(6)

    async def emit(ev: dict) -> None:
        if ev.get("phase") == "done":
            ev = _annotate(ev, person, by_id.get(ev.get("source_id"), {}))
        await job.emit(ev)

    async def one(t: harness.Task) -> dict:
        async with sem:
            rec = await harness.run_task(t, emit)
            return _annotate(rec, person, t.source) if rec.get("verdict") in ("verified", "suspicious") else rec

    results = await asyncio.gather(*(one(t) for t in tasks))
    found_inr = sum(r.get("amount_inr", 0) for r in results if r.get("found"))
    summary = {"total": len(results), "verified": sum(r["verdict"] == "verified" for r in results),
               "suspicious": sum(r["verdict"] == "suspicious" for r in results),
               "needs_human": sum(r["verdict"] == "needs_human" for r in results),
               "failed": sum(r["verdict"] in ("failed", "unavailable") for r in results),
               "found": sum(bool(r.get("found")) for r in results), "found_inr": found_inr}
    await job.emit({"phase": "all_done", "summary": summary})
    return {"summary": summary, "results": results}


def start(profile: dict, person: dict) -> jobs.Job:
    return jobs.start("wapsi", lambda job: run(job, profile, person))
