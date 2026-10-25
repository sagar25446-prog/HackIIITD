"""Institution-specific recovery preparation. A lookup is an observation, never ownership or recovered money.

The route registry (data/recovery_routes.json) separates the *discovery service* (UDGAM, MITRA, IEPF) from
the *responsible institution* that actually settles a claim (the bank, the AMC/registrar, the company), and
records which requirements were reviewed from official pages. Anything not reviewed is labelled as such.
"""

from __future__ import annotations

import json
from functools import lru_cache

from ..config import DATA_DIR

CAPACITIES = ("holder", "nominee", "legal_heir", "joint_holder", "unknown")


@lru_cache(maxsize=1)
def registry() -> dict:
    return json.loads((DATA_DIR / "recovery_routes.json").read_text(encoding="utf-8"))


def route(route_id: str | None) -> dict | None:
    return next((r for r in registry()["routes"] if r["id"] == route_id), None)


@lru_cache(maxsize=1)
def _qualification() -> dict:
    p = DATA_DIR / "adapter_qualification.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def automated_ready(route_id: str) -> bool:
    """An automated check is offered only for a registered adapter that passed its live qualification."""
    r = route(route_id)
    q = _qualification().get(route_id) or {}
    return bool(r and r.get("automated") and q.get("qualified"))


def routes() -> list[dict]:
    out = []
    for r in registry()["routes"]:
        q = _qualification().get(r["id"]) or {}
        out.append(
            {
                **r,
                "requires_user": r["automated"] is None,
                "automated_ready": automated_ready(r["id"]),
                "qualification": {k: q.get(k) for k in ("qualified", "checked_at", "outcome", "latency_ms", "engine")}
                if q
                else None,
                # kept for older screens
                "url": r["official_url"],
                "guidance": r["after"]["en"],
            }
        )
    return out


def _item(id_, en, hi, kind="prepare", source=None):
    return {"id": id_, "label": en, "label_hi": hi, "kind": kind, "source": source}


def recovery_plan(ws, c):
    from .planning import effective_facts

    f = effective_facts(ws, c)
    reg = registry()
    category = f.get("asset_category")
    r = route(f.get("institution"))
    capacity = f.get("claimant_capacity") or None
    people = {p.id: p for p in ws.people}
    claimant = people[c.applicant_id]
    holder = people.get(c.subject_id or c.applicant_id, claimant)
    same_person = holder.id == claimant.id

    missing = [k for k in ("asset_category", "institution", "claimant_relation", "claimant_capacity") if not f.get(k)]
    review = []
    if claimant.deceased:
        review.append("The claimant must be a living person; choose the asset holder separately")
    if r and category and r["asset"] != category:
        review.append(f"{r['name']} does not handle this asset type — choose a matching official route")
    if capacity == "holder" and not same_person:
        review.append("Only the holder can claim as the holder; choose nominee, legal heir or joint holder")
    if capacity in ("nominee", "legal_heir") and same_person:
        review.append("A nominee or legal heir claims for someone else; choose the holder separately")
    if holder.deceased and capacity == "joint_holder":
        pass  # a surviving joint holder is a valid capacity
    if capacity and capacity not in CAPACITIES:
        review.append("Unsupported claim capacity")

    obs = sorted(c.observations, key=lambda o: o.checked_at)
    looked = [o for o in obs if o.outcome != "page_opened"]
    possible = [o for o in looked if o.outcome == "possible_record"]
    latest = looked[-1] if looked else None
    responsible_name = f.get("responsible_institution") or next(
        (o.responsible_institution for o in reversed(obs) if o.responsible_institution), ""
    )

    tasks = []
    for k in dict.fromkeys(missing):
        en, hi = {
            "asset_category": ("Choose what kind of asset it is", "संपत्ति का प्रकार चुनें"),
            "institution": ("Choose the official route", "आधिकारिक मार्ग चुनें"),
            "claimant_relation": ("Say how the claimant is related to the holder", "बताएँ कि दावेदार धारक से कैसे संबंधित है"),
            "claimant_capacity": ("Say in what capacity the claimant will claim", "बताएँ कि दावेदार किस हैसियत से दावा करेगा"),
        }[k]
        tasks.append({"id": "recovery:" + k, "label": en, "label_hi": hi, "done": False, "person_id": c.applicant_id, "kind": "answer"})
    if r:
        checked = bool(latest)
        tasks.append(
            {
                "id": "recovery:lookup",
                "label": f"Check {r['name']} and record what it showed",
                "label_hi": f"{r['name_hi']} जाँचें और परिणाम दर्ज करें",
                "done": checked,
                "person_id": holder.id,
                "kind": "handoff",
            }
        )
        if r["role"] == "discovery" and possible and not responsible_name:
            lab = r.get("institution_label", {"en": "Institution", "hi": "संस्था"})
            tasks.append(
                {
                    "id": "recovery:responsible",
                    "label": f"Record the {lab['en'].lower()} that holds the money",
                    "label_hi": f"पैसा रखने वाली संस्था दर्ज करें ({lab['hi']})",
                    "done": False,
                    "person_id": c.applicant_id,
                    "kind": "answer",
                }
            )
        if possible:
            tasks.append(
                {
                    "id": "recovery:contact",
                    "label": "Contact " + (responsible_name or r["responsible"]["en"]) + " to start the claim",
                    "label_hi": (responsible_name or r["responsible"]["hi"]) + " से दावा शुरू करने के लिए संपर्क करें",
                    "done": c.stage in ("user_reported_submitted", "user_reported_resolved"),
                    "person_id": c.applicant_id,
                    "kind": "handoff",
                }
            )
    if not c.follow_up:
        tasks.append({"id": "recovery:follow_up", "label": "Set a follow-up date", "label_hi": "अगली जाँच की तारीख तय करें", "done": False, "person_id": c.applicant_id, "kind": "answer"})

    preparation = {
        "common": [
            _item(x["id"], x["en"], x["hi"]) for x in reg["common"]
        ]
        + ([_item(reg["deceased_holder"]["id"], reg["deceased_holder"]["en"], reg["deceased_holder"]["hi"])] if holder.deceased and not same_person else []),
        "capacity": {"key": capacity or "unknown", **reg["capacity"][capacity if capacity in CAPACITIES else "unknown"]},
        "institution": [
            _item(x["id"], x["en"], x["hi"], "conditional" if x.get("applies") not in (None, "all") else "prepare", (r.get("sources") or [{}])[0].get("url"))
            for x in (r or {}).get("requirements", [])
        ],
        "coverage": (r or {}).get("coverage", "not_reviewed"),
        "coverage_note": (r or {}).get("coverage_note", {"en": "Choose an official route to see its requirements.", "hi": "ज़रूरतें देखने के लिए आधिकारिक मार्ग चुनें।"}),
    }

    deadlines = []
    if c.follow_up:
        deadlines = [
            {
                "id": c.id + ":followup",
                "case_id": c.id,
                "person_id": c.applicant_id,
                "title": "Recovery follow-up: " + c.title,
                "title_hi": "वापसी की अगली जाँच: " + c.title,
                "date": c.follow_up.isoformat(),
                "actor": "applicant",
                "kind": "follow_up",
                "provenance": "user_reported",
            }
        ]
    blocked = bool(review)
    status = "review_needed" if blocked else "needs_answers" if missing else "preparing"
    labels = {
        "review_needed": ("Fix the highlighted details", "चिह्नित विवरण ठीक करें"),
        "needs_answers": ("Answers needed", "जवाब चाहिए"),
        "preparing": ("Prepare the claim with the institution", "संस्था के साथ दावे की तैयारी करें"),
    }
    return {
        "case_id": c.id,
        "person_id": c.applicant_id,
        "status": status,
        "status_label": labels[status][0],
        "status_hi": labels[status][1],
        "ready": not blocked and not missing,
        "missing": list(dict.fromkeys(missing)),
        "failed": [],
        "review": review,
        "questions": [],
        "tasks": tasks,
        "requirements": [],
        "deadlines": deadlines,
        "recovery": {
            "route": {k: r[k] for k in ("id", "name", "name_hi", "role", "asset", "responsible", "official_url", "guidance_url", "protected", "before_open", "after", "automated")}
            if r
            else None,
            "automated_ready": automated_ready(r["id"]) if r else False,
            "holder": {"id": holder.id, "name": holder.name, "deceased": holder.deceased},
            "claimant": {"id": claimant.id, "name": claimant.name},
            "relationship": f.get("claimant_relation"),
            "capacity": capacity,
            "responsible_institution": responsible_name,
            "latest_outcome": latest.outcome if latest else None,
            "possible_records": len(possible),
            "preparation": preparation,
        },
        "source_url": (r or {}).get("guidance_url") or "https://www.rbi.org.in/commonman/English/Scripts/FAQs.aspx?Id=3579",
        "source_title": ((r or {}).get("sources") or [{"title": "RBI UDGAM FAQ"}])[0]["title"],
        "source_checked": reg["checked"],
        "official_url": (r or {}).get("official_url") or "https://udgam.rbi.org.in/unclaimed-deposits/#/login",
        "rule_version": "recovery." + reg["checked"],
        "coverage": "Search results are observations. The institution decides ownership, which proof it needs and any payment. A discovery service such as UDGAM, MITRA or IEPF only finds the record.",
        "coverage_hi": "खोज परिणाम केवल अवलोकन हैं। स्वामित्व, ज़रूरी प्रमाण और भुगतान का निर्णय संस्था करती है। UDGAM, MITRA या IEPF जैसी खोज सेवाएँ केवल रिकॉर्ड ढूँढती हैं।",
        "removed_tasks": [],
        "removed_tasks_hi": [],
    }
