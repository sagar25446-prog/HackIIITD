"""Wapsi's older "search everything" entry point, rebuilt on the case-bound lookup engine.

The app itself starts one lookup per recovery case (`/api/recovery/lookup`). This wrapper keeps the earlier API
working: it runs only the automated adapters that passed live qualification, one after another, each with the
same strict outcomes. Portals that need the citizen's own OTP, login or CAPTCHA are never automated — they are
official-site routes in the app.
"""

from __future__ import annotations

from . import jobs, recovery_cases, recovery_lookup


def contexts(person: dict, source_ids: list[str] | None = None) -> list[dict]:
    ready = [r for r in recovery_cases.routes() if r["automated_ready"]]
    if source_ids is not None:
        unknown = set(source_ids) - {r["id"] for r in ready}
        if unknown or not source_ids:
            raise recovery_lookup.LookupRejected("Choose a route that has a qualified automated check")
        ready = [r for r in ready if r["id"] in source_ids]
    out = []
    for r in ready:
        out.append(
            recovery_lookup.validate(
                {
                    "case_id": "legacy",
                    "holder_id": "legacy",
                    "source_id": r["id"],
                    "category": r["asset"],
                    "name": person.get("name", ""),
                    "dob": person.get("dob", ""),
                    "consent": {"granted": True, "case_id": "legacy", "holder_id": "legacy", "source_ids": [r["id"]]},
                }
            )
        )
    return out


async def run(job: jobs.Job, ctxs: list[dict]) -> dict:
    await job.emit(
        {
            "phase": "plan",
            "tasks": [
                {"task_id": c["source_id"], "source_id": c["source_id"], "name": recovery_cases.route(c["source_id"])["name"], "needs_human": False}
                for c in ctxs
            ],
        }
    )
    results = []
    for ctx in ctxs:
        results.append(await recovery_lookup.run(job, ctx))
    summary = {"total": len(results)}
    for r in results:
        o = r["observation"]["outcome"]
        summary[o] = summary.get(o, 0) + 1
    await job.emit({"phase": "all_done", "summary": summary})
    return {"summary": summary, "results": results}
