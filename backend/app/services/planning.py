"""Person-specific preparation, not government approval. No private workspace is stored."""

from __future__ import annotations

from datetime import datetime, timedelta
from datetime import timezone as _tz

from ..workspace_models import Case, Workspace

QUESTIONS = {
    "state": ("Applicant state", "आवेदक का राज्य", "text"),
    "age": ("Applicant age", "आवेदक की उम्र", "number"),
    "years_in_state": ("Years resident in this state", "इस राज्य में निवास के वर्ष", "number"),
    "gender": ("Gender (female/male/other)", "लिंग (female/male/other)", "text"),
    "marital_status": (
        "Marital status (widowed/married/single)",
        "वैवाहिक स्थिति (widowed/married/single)",
        "text",
    ),
    "annual_personal_income": (
        "Applicant annual income, all sources (₹)",
        "आवेदक की वार्षिक आय, सभी स्रोत (₹)",
        "number",
    ),
    "annual_family_income": ("Annual family income (₹)", "परिवार की वार्षिक आय (₹)", "number"),
    "receives_other_pension": (
        "Receiving another pension for this purpose?",
        "क्या इसी उद्देश्य से दूसरी पेंशन मिलती है?",
        "bool",
    ),
    "has_bank_account": (
        "Applicant has their own bank account?",
        "क्या आवेदक का अपना बैंक खाता है?",
        "bool",
    ),
    "previous_award": ("Previously selected for CSSS?", "क्या पहले CSSS के लिए चयन हुआ था?", "bool"),
    "class12_percentile": (
        "Class 12 percentile (not marks percentage)",
        "कक्षा 12 का प्रतिशतक (अंकों का प्रतिशत नहीं)",
        "number",
    ),
    "marks_percent": ("Previous-year marks (%)", "पिछले वर्ष के अंक (%)", "number"),
    "attendance_percent": ("Attendance (%)", "उपस्थिति (%)", "number"),
    "degree_course": (
        "Enrolled in a degree course, not diploma?",
        "डिग्री पाठ्यक्रम में हैं, डिप्लोमा में नहीं?",
        "bool",
    ),
    "in_full_time_education": ("Regular full-time study?", "नियमित पूर्णकालिक पढ़ाई?", "bool"),
    "took_gap_year": (
        "Gap after Class 12 before this admission?",
        "कक्षा 12 के बाद प्रवेश से पहले अंतराल लिया?",
        "bool",
    ),
    "other_scholarship": (
        "Receiving another scholarship or fee reimbursement?",
        "क्या दूसरी छात्रवृत्ति या शुल्क प्रतिपूर्ति मिलती है?",
        "bool",
    ),
    "course_year": ("Current year of study (1–5)", "पढ़ाई का वर्तमान वर्ष (1–5)", "number"),
    "nfsa_beneficiary": (
        "Already an NFSA AAY/PHH beneficiary?",
        "क्या पहले से NFSA AAY/PHH लाभार्थी हैं?",
        "bool",
    ),
    "from_state": ("Moving from state", "किस राज्य से आए", "text"),
    "to_state": ("Moving to state", "किस राज्य में आए", "text"),
}
BASE = {
    "bereavement": {
        "source_url": "https://wcd.delhi.gov.in/sites/default/files/WCD/circulars-orders/flow_chart_1_3-6_1.pdf",
        "source_title": "WCD Delhi: Women in distress pension process",
        "official_url": "https://edistrict.delhi.gov.in/",
        "source_checked": "2026-10-24",
        "version": "2026-10-24.1",
        "income_limit": 100000,
    },
    "retirement": {
        "source_url": "https://socialwelfare.delhi.gov.in/social/financial-assistance-welfare-scheme-details-and-notifications-etc",
        "source_title": "Delhi Social Welfare: Financial assistance schemes",
        "official_url": "https://edistrict.delhi.gov.in/",
        "source_checked": "2026-10-24",
        "version": "2026-10-24.1",
        "income_limit": 100000,
        "minimum_age": 60,
    },
    "education": {
        "source_url": "https://scholarships.gov.in/public/schemeGuidelines/FAQ_DOHE_CSSS.pdf",
        "source_title": "Ministry of Education CSSS FAQ 2025–26; NSP 2026–27 schedule",
        "official_url": "https://scholarships.gov.in/",
        "source_checked": "2026-10-24",
        "version": "2026-10-24.1",
        "fresh_percentile": 80,
        "renewal_marks": 50,
        "renewal_attendance": 75,
        "income_limit": 450000,
        "deadlines": {"applicant": "2026-10-31", "institute": "2026-11-15", "nodal": "2026-11-30"},
        "schedule_url": "https://scholarships.gov.in/iver/All-Scholarships",
        "academic_year": "2026-27",
    },
    "moving": {
        "source_url": "https://dfpd.gov.in/faqs/en",
        "source_title": "Department of Food: ONORC FAQ",
        "official_url": "https://dfpd.gov.in/faqs/en",
        "source_checked": "2026-10-24",
        "version": "2026-10-24.1",
    },
}


def today():
    return datetime.now(_tz(timedelta(hours=5, minutes=30))).date()


def config(kind):
    from . import rules_registry

    return rules_registry.workflow(kind)


def effective_facts(ws: Workspace, c: Case):
    person = next(p for p in ws.people if p.id == c.applicant_id)
    result = {}
    for shared in ws.household:
        if shared.confirmed and person.id in shared.person_ids:
            result[shared.field] = shared.value
    result.update(person.facts)
    result.update(c.answers)
    return result


def evaluate_case(ws: Workspace, c: Case, override: dict | None = None):
    if c.kind == "paperwork":
        from .service_paperwork import paperwork_plan

        return paperwork_plan(ws, c)
    if c.kind == "wapsi":
        from .recovery_cases import recovery_plan

        return recovery_plan(ws, c)
    cfg = override or config(c.kind)
    f = effective_facts(ws, c)
    missing = []
    failed = []
    review = []

    def require(key, test=lambda v: bool(v)):
        value = f.get(key)
        if value is None or value == "":
            missing.append(key)
        elif not test(value):
            failed.append(key)

    if c.kind in ("bereavement", "retirement"):
        require("state", lambda v: str(v).lower() == "delhi")
        require("years_in_state", lambda v: isinstance(v, (int, float)) and v >= 5)
        require(
            "age",
            lambda v: isinstance(v, (int, float))
            and v >= (18 if c.kind == "bereavement" else cfg.get("minimum_age", 60)),
        )
        require("receives_other_pension", lambda v: v is False)
        require("has_bank_account", lambda v: v is True)
        if c.kind == "bereavement":
            require("gender", lambda v: v == "female")
            require("marital_status", lambda v: v == "widowed")
            require(
                "annual_personal_income",
                lambda v: isinstance(v, (int, float)) and v < cfg["income_limit"],
            )
            if not c.subject_id or c.subject_id == c.applicant_id:
                review.append("Select the deceased person separately")
            elif not next(p for p in ws.people if p.id == c.subject_id).deceased:
                review.append("Confirm the selected person has passed away")
        else:
            require(
                "annual_family_income",
                lambda v: isinstance(v, (int, float)) and v < cfg["income_limit"],
            )
    elif c.kind == "education":
        require("degree_course", lambda v: v is True)
        require("in_full_time_education", lambda v: v is True)
        require("other_scholarship", lambda v: isinstance(v, bool))
        if f.get("other_scholarship") is True:
            review.append(
                "Aid-combination conditions need current scheme review; no automatic rejection or award combination"
            )
        if c.mode == "renewal":
            require("previous_award", lambda v: v is True)
            require(
                "marks_percent", lambda v: isinstance(v, (int, float)) and v >= cfg["renewal_marks"]
            )
            require(
                "attendance_percent",
                lambda v: isinstance(v, (int, float)) and v >= cfg["renewal_attendance"],
            )
            require("course_year", lambda v: isinstance(v, (int, float)) and 2 <= v <= 5)
        else:
            require(
                "class12_percentile",
                lambda v: isinstance(v, (int, float)) and v > cfg["fresh_percentile"],
            )
            require(
                "annual_family_income",
                lambda v: isinstance(v, (int, float)) and v <= cfg["income_limit"],
            )
            require("took_gap_year", lambda v: v is False)
            require("course_year", lambda v: v == 1)
    else:
        require("nfsa_beneficiary", lambda v: v is True)
        require("from_state")
        require("to_state")
    person = next(p for p in ws.people if p.id == c.applicant_id)
    if person.deceased:
        review.append("The applicant must be a living person; select the asset holder separately")
    status = (
        "not_supported"
        if failed
        else "review_needed"
        if review
        else "needs_answers"
        if missing
        else "preparing"
    )
    labels = {
        "not_supported": "A modeled condition does not match",
        "review_needed": "Review needed",
        "needs_answers": "Answers needed",
        "preparing": "Prepare the next step",
    }
    labels_hi = {
        "not_supported": "एक मॉडल की गई शर्त मेल नहीं खाती",
        "review_needed": "समीक्षा चाहिए",
        "needs_answers": "जवाब चाहिए",
        "preparing": "अगला चरण तैयार करें",
    }
    tasks = []
    for key in missing:
        en, hi, typ = QUESTIONS[key]
        tasks.append(
            {
                "id": "answer:" + key,
                "label": en,
                "label_hi": hi,
                "done": False,
                "person_id": c.applicant_id,
                "kind": "answer",
            }
        )
    deadlines = []
    if c.kind == "education" and c.mode == "renewal" and f.get("previous_award") is True:
        for actor, d in cfg["deadlines"].items():
            titles = {
                "applicant": ("CSSS renewal: student submission", "CSSS नवीनीकरण: छात्र आवेदन"),
                "institute": ("CSSS: institute verification", "CSSS: संस्थान सत्यापन"),
                "nodal": ("CSSS: nodal verification", "CSSS: नोडल सत्यापन"),
            }
            deadlines.append(
                {
                    "id": c.id + ":" + actor,
                    "case_id": c.id,
                    "person_id": c.applicant_id,
                    "title": titles[actor][0],
                    "title_hi": titles[actor][1],
                    "date": d,
                    "actor": actor,
                    "kind": "renewal" if actor == "applicant" else "verification",
                    "source_url": cfg["schedule_url"],
                    "provenance": "reviewed schedule " + cfg["academic_year"],
                }
            )
    if c.follow_up:
        deadlines.append(
            {
                "id": c.id + ":followup",
                "case_id": c.id,
                "person_id": c.applicant_id,
                "title": "Your follow-up: " + c.title,
                "title_hi": "आपकी अगली जाँच: " + c.title,
                "date": c.follow_up.isoformat(),
                "actor": "applicant",
                "kind": "follow_up",
                "provenance": "user_reported",
            }
        )
    return {
        "case_id": c.id,
        "person_id": c.applicant_id,
        "status": status,
        "status_hi": labels_hi[status],
        "status_label": labels[status],
        "missing": missing,
        "failed": failed,
        "review": review,
        "questions": [
            {
                "field": k,
                "label": QUESTIONS[k][0],
                "label_hi": QUESTIONS[k][1],
                "type": QUESTIONS[k][2],
            }
            for k in missing
        ],
        "requirements": [],
        "tasks": tasks,
        "deadlines": deadlines,
        **{k: cfg[k] for k in ["source_url", "source_title", "official_url", "source_checked"]},
        "rule_version": cfg["version"],
        "coverage": "Preparation guidance for the modeled conditions only. The authority verifies eligibility, current availability and payment.",
        "coverage_hi": "केवल मॉडल की गई शर्तों की तैयारी सहायता। पात्रता, वर्तमान उपलब्धता और भुगतान का सत्यापन संबंधित विभाग करता है।",
        "removed_tasks": [],
        "removed_tasks_hi": [],
    }


def plan(ws: Workspace):
    from . import rules_registry

    cases = [evaluate_case(ws, c) for c in ws.cases]
    try:
        from .paperwork import attach

        for c, p in zip(ws.cases, cases):
            attach(ws, c, p)
    except ImportError:
        pass
    actions = [
        {**task, "case_id": p["case_id"]}
        for p in cases
        if p["status"] != "not_supported"
        for task in p["tasks"]
        if not task["done"]
    ]
    dates = {
        p["case_id"]: min(
            [d["date"] for d in p["deadlines"] if d["actor"] == "applicant"] or ["9999-12-31"]
        )
        for p in cases
    }
    actions.sort(
        key=lambda t: (dates[t["case_id"]], 0 if t["kind"] == "answer" else 1, t["case_id"])
    )
    return {
        "cases": cases,
        "next_actions": actions[:3],
        "deadlines": [d for p in cases for d in p["deadlines"]],
        "rules_version": rules_registry.version(),
    }
