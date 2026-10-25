"""Second opinion from the government's own eligibility checker.

For schemes that have an official myScheme checker, a TinyFish agent answers the checker's questions
using only the citizen's stated facts and copies the official verdict. JAAGRUK then shows whether the
official checker agrees with its Z3 proof. Runs only when the citizen asks (agent steps cost money),
with a time cap; the live browser view streams into the app.
"""

from __future__ import annotations

from ..ml import eligibility as el
from ..tinyfish import harness
from . import jobs, persona

POSITIVE = ("eligible", "you are eligible", "may be eligible", "पात्र हैं")
NEGATIVE = ("not eligible", "ineligible", "पात्र नहीं")


def facts_for(rule: dict, profile: dict) -> str:
    fields = {c["field"] for c in rule["conditions"]} | {
        c["field"] for g in rule.get("any_of", []) for c in g
    }
    fields |= {"age", "gender", "state"}
    parts = []
    for f in sorted(fields):
        v = profile.get(f)
        if v is None or v == "":
            continue
        if f == "education":
            v = el.EDUCATION_LABELS[int(v)]
        elif isinstance(v, bool):
            v = "yes" if v else "no"
        parts.append(f"{f.replace('_', ' ')}: {v}")
    return "; ".join(parts)


def _verdict(result: dict | None) -> str | None:
    if not isinstance(result, dict):
        return None
    t = f"{result.get('verdict', '')} {result.get('verdict_text', '')}".lower()
    if any(n in t for n in NEGATIVE):
        return "not_eligible"
    if any(p in t for p in POSITIVE):
        return "eligible"
    return None


async def run(job: jobs.Job, scheme_id: str, raw_profile: dict, who: str | None = None) -> dict:
    rule = next(r for r in el.load_schemes() if r["id"] == scheme_id)
    prof = persona.subject(raw_profile, who)
    ours = el.decide(rule, prof).status
    src = next(s for s in harness.load_sources() if s["id"] == "myscheme_checker")
    task = harness.Task(
        source=src,
        url=src["url"].format(checker_id=rule["myscheme_checker"]),
        goal=src["goal"].format(facts=facts_for(rule, prof)),
        output_schema=src["output_schema"],
    )
    await job.emit(
        {
            "phase": "plan",
            "tasks": [{"task_id": task.id, "source_id": src["id"], "name": src["name"]}],
            "scheme": rule["name"],
            "ours": ours,
        }
    )
    rec = await harness.run_task(task, job.emit)
    official = _verdict(rec.get("result"))
    agree = None if official is None or ours == "needs_info" else official == ours
    from . import rules_registry

    summary = {
        "rules_version": rules_registry.version(),
        "ours": ours,
        "official": official,
        "agree": agree,
        "verdict": rec.get("verdict"),
        "official_text": (rec.get("result") or {}).get("verdict_text")
        if isinstance(rec.get("result"), dict)
        else None,
    }
    await job.emit({"phase": "all_done", "summary": summary})
    return summary


def validate(scheme_id: str, raw_profile: dict, who: str | None = None) -> None:
    rule = next((r for r in el.load_schemes() if r["id"] == scheme_id), None)
    if not rule or not rule.get("myscheme_checker"):
        raise ValueError("This scheme has no official online checker")
    persona.subject(raw_profile, who)


def start(scheme_id: str, raw_profile: dict, who: str | None = None) -> jobs.Job:
    validate(scheme_id, raw_profile, who)
    return jobs.start("checker", lambda job: run(job, scheme_id, raw_profile, who), paid=True)
