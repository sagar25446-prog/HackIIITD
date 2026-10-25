"""One automated recovery lookup, bound to the case and person it was started for.

The frozen context (case, holder, source, consent) is echoed in every event and in the final observation, so a
result can never be attached to a person selected later. The holder's name and date of birth are used for the
lookup only: they are not written to the job ledger, the call log or the observation.

Engines, in order:
* LIC: deterministic playbook on a TinyFish Browser; if it breaks *before submitting*, one TinyFish Agent try.
* Tata AIA: TinyFish Agent (the adapter that passed live qualification); if the agent fails *before
  submitting*, one playbook try. An ambiguous submission is never repeated.
"""

from __future__ import annotations

import re
import time
import uuid
from datetime import date, datetime, timezone

from ..ml import name_match
from ..tinyfish import playbooks, portal_results
from ..tinyfish.client import TinyFishUnavailable, tinyfish
from ..tinyfish.harness import load_sources
from . import jobs, recovery_cases

OUTCOME_TEXT = {
    "possible_record": ("Possible record", "संभावित रिकॉर्ड"),
    "no_match": ("No match for these submitted details", "दिए गए विवरण से कोई मिलान नहीं"),
    "citizen_step": ("Citizen step required", "आपका कदम ज़रूरी"),
    "missing_input": ("Missing input", "जानकारी अधूरी"),
    "unavailable": ("Unavailable", "उपलब्ध नहीं"),
    "failed": ("Failed", "विफल"),
    "uncertain": ("Uncertain", "अनिश्चित"),
    "cancelled": ("Cancelled", "रद्द"),
    "page_opened": ("Official page opened", "आधिकारिक पेज खोला"),
}

AGENT_GOALS = {
    "tata_aia_unclaimed": (
        "This is Tata AIA Life Insurance's official unclaimed-funds search. Keep 'Individual Policy' selected. "
        "Type the policy holder name '{name}' and the date of birth '{dob}' (DD/MM/YYYY) into the two fields, then "
        "click Proceed once. Never click Proceed a second time. Do not invent any value. If a CAPTCHA, OTP or login "
        "appears, stop immediately and set page_state to captcha_or_otp or login_required — never try to solve it. "
        "Copy the exact text of the result area into result_area_text. If the result area says that no unclaimed "
        "funds apply, set page_state to no_record_message and records to []. If a table of records is shown, set "
        "page_state to result_shown and add one item per row with the holder name exactly as shown, the amount as a "
        "number (null if not shown) and the policy reference. If the page shows an error, use site_error. If the "
        "form is missing, use form_not_found. Return JSON only."
    ),
    "lic_unclaimed": (
        "This is LIC's official 'Unclaimed Policy Dues' search form. Fill policyholder name '{name}' and date of "
        "birth '{dob}' (dd/mm/yyyy). Click Submit once — never submit twice. Do not invent any value. If a CAPTCHA, "
        "OTP or login appears, stop and set page_state to captcha_or_otp or login_required. Copy the exact text of "
        "the result message into result_area_text. If it says records were not found, set page_state to "
        "no_record_message and records to []. If a table of records is shown, set page_state to result_shown and "
        "add one item per row (holder name exactly as shown, amount as a number or null, policy number). Use "
        "site_error for an error page and form_not_found if the form is missing. Return JSON only."
    ),
}


class LookupRejected(ValueError):
    pass


def _dob(value: str) -> str:
    v = (value or "").strip()
    m = re.fullmatch(r"(\d{2})/(\d{2})/(\d{4})", v)
    if not m:
        raise LookupRejected("Enter the date of birth as DD/MM/YYYY")
    d = date(int(m.group(3)), int(m.group(2)), int(m.group(1)))
    if d > date.today() or d.year < 1900:
        raise LookupRejected("Enter a real date of birth")
    return v


def validate(body: dict) -> dict:
    """Check the request against the route registry and the consent scope; return the frozen context."""
    source_id = body.get("source_id")
    r = recovery_cases.route(source_id)
    if not r:
        raise LookupRejected("Unknown official route")
    if body.get("category") != r["asset"]:
        raise LookupRejected(f"{r['name']} does not handle this asset type")
    if not r.get("automated"):
        raise LookupRejected(f"{r['name']} is an official-site route: open it and record what it showed")
    if not recovery_cases.automated_ready(source_id):
        raise LookupRejected(f"The automated check for {r['name']} has not passed its live qualification; use the official site")
    consent = body.get("consent") or {}
    if not (
        consent.get("granted") is True
        and consent.get("case_id") == body.get("case_id")
        and consent.get("holder_id") == body.get("holder_id")
        and source_id in (consent.get("source_ids") or [])
    ):
        raise LookupRejected("Consent must cover this case, this person and this official route")
    name = " ".join(str(body.get("name") or "").split())
    if len(name) < 2 or len(name) > 80 or re.search(r"\d", name):
        raise LookupRejected("Enter the holder's name as on the records (letters only)")
    return {
        "case_id": str(body.get("case_id"))[:80],
        "holder_id": str(body.get("holder_id"))[:80],
        "source_id": source_id,
        "category": r["asset"],
        "consent_at": str(consent.get("at") or "")[:40],
        "_name": name,
        "_dob": _dob(str(body.get("dob") or "")),
    }


def public(ctx: dict) -> dict:
    return {k: v for k, v in ctx.items() if not k.startswith("_")}


def name_note(searched: str, shown: str) -> str:
    """Plain-language difference between the searched name and a name on a record. Never a verification."""
    if not shown:
        return ""
    a, b = name_match.normalize(searched), name_match.normalize(shown)
    if a == b:
        return f"The record shows “{shown}”, the same name you searched. Only the institution can confirm it is this person."
    ta, tb = a.split(), b.split()
    parts = []
    if ta and tb and ta[-1] != tb[-1]:
        parts.append("the surname is spelled differently")
    if len(ta) != len(tb):
        parts.append("one version has more name parts")
    if any(len(t) == 1 for t in tb) or any(len(t) == 1 for t in ta):
        parts.append("initials are used")
    detail = "; ".join(parts) or "the spelling differs"
    return (
        f"The record shows “{shown}” and you searched “{searched}” — {detail}. A similar name can belong to someone "
        "else. Only the institution can confirm ownership."
    )


def observation(ctx: dict, res: dict, engine: str, provenance: str, job_id: str | None) -> dict:
    cands = res.get("candidates") or []
    notes = [name_note(ctx["_name"], c.get("display_name", "")) for c in cands if c.get("display_name")]
    return {
        "id": uuid.uuid4().hex,
        "source_id": ctx["source_id"],
        "holder_id": ctx["holder_id"],
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "provenance": provenance,
        "outcome": res["outcome"],
        "engine": engine,
        "submitted": "name + date of birth" if res["outcome"] != "missing_input" else "",
        "candidates": cands[:10],
        "name_note": " ".join(dict.fromkeys(notes))[:600],
        "message": (res.get("message") or "")[:600],
        "responsible_institution": "",
        "job_id": job_id,
    }


async def _agent(job: jobs.Job, ctx: dict, src: dict, emit) -> dict:
    goal = AGENT_GOALS[ctx["source_id"]].format(name=ctx["_name"], dob=ctx["_dob"])
    status = result = error = None
    events = 0
    try:
        async for ev in tinyfish.agent_stream(
            src["url"], goal, output_schema=portal_results.AGENT_SCHEMA, purpose=f"recovery lookup: {src['name']}"
        ):
            events += 1
            t = ev.get("type")
            if ev.get("run_id"):
                job.add_provider(ev["run_id"])
            if t == "STREAMING_URL":
                await emit({"phase": "streaming", "engine": "agent", "streaming_url": ev.get("streaming_url"), "replay": bool(ev.get("replay"))})
            elif t == "PROGRESS":
                await emit({"phase": "progress", "engine": "agent", "message": ev.get("purpose")})
            elif t == "STARTED":
                await emit({"phase": "started", "engine": "agent"})
            elif t == "COMPLETE":
                status, result, error = ev.get("status"), ev.get("result"), ev.get("error")
    except TinyFishUnavailable:
        return {"outcome": "unavailable", "message": "TinyFish is not reachable right now and no exact earlier run exists.", "pre_submission": True}
    except Exception as exc:  # noqa: BLE001
        # no event at all: the request never reached the portal; otherwise the state of the form is unknown
        if not events:
            return {"outcome": "failed", "message": f"The automated check could not start ({type(exc).__name__}).", "pre_submission": True}
        return {"outcome": "uncertain", "message": "The connection ended during the check; it is not repeated automatically."}
    return portal_results.read_agent(ctx["source_id"], status, result, error)


async def run(job: jobs.Job, ctx: dict) -> dict:
    src = next(s for s in load_sources() if s["id"] == ctx["source_id"])
    route = recovery_cases.route(ctx["source_id"])
    started = time.perf_counter()

    async def emit(ev: dict) -> None:
        await job.emit(
            {"task_id": ctx["source_id"], "source_id": ctx["source_id"], "name": route["name"], **ev, "context": public(ctx)}
        )

    await emit({"phase": "queued"})
    order = ["playbook", "agent"] if route["automated"] == "playbook" else ["agent", "playbook"]
    if not tinyfish.live:
        res = {"outcome": "unavailable", "message": "No TinyFish key or network: personal lookups are never replayed from recordings."}
        engine = order[0]
    else:
        res, engine = None, order[0]
        for i, engine in enumerate(order):
            if engine == "playbook":
                if len(playbooks.lic_inputs({"name": ctx["_name"], "dob": ctx["_dob"]})) < 2:
                    res = {"outcome": "missing_input", "message": "LIC needs any two of: policy number, name, date of birth, PAN."}
                    break
                try:
                    res = await playbooks.run(
                        ctx["source_id"], src["url"], {"name": ctx["_name"], "dob": ctx["_dob"]}, emit, route["name"], on_session=job.add_provider
                    )
                except playbooks.PlaybookBroken as exc:
                    res = {"outcome": "failed", "message": f"The scripted check stopped before submitting: {exc}.", "pre_submission": True}
                except TinyFishUnavailable as exc:
                    res = {"outcome": "unavailable", "message": str(exc), "pre_submission": True}
                except Exception as exc:  # noqa: BLE001 - browser could not open: nothing was submitted
                    res = {"outcome": "failed", "message": f"The browser session could not open ({type(exc).__name__}).", "pre_submission": True}
            else:
                res = await _agent(job, ctx, src, emit)
            # a bounded fallback: only after a definite technical failure, and only before any submission
            if res.get("pre_submission") and res["outcome"] in ("failed", "unavailable") and i == 0:
                await emit({"phase": "healing", "message": "The first method stopped before submitting — trying the other method once"})
                continue
            break
    obs = observation(ctx, res, engine, "automated_live" if tinyfish.live else "automated_replay", job.id)
    label = OUTCOME_TEXT[obs["outcome"]]
    await emit(
        {
            "phase": "done",
            "verdict": label[0],
            "found": obs["outcome"] == "possible_record",
            "reason": OUTCOME_TEXT[obs["outcome"]][0],
            "outcome": obs["outcome"],
            "outcome_label": label[0],
            "outcome_label_hi": label[1],
            "message": obs["message"],
            "latency_ms": int((time.perf_counter() - started) * 1000),
        }
    )
    return {"context": public(ctx), "observation": obs}
