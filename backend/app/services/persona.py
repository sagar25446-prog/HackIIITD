"""Turns onboarding answers into a solver-ready profile plus multi-label persona tags.

Only safe defaults are inferred (e.g. a homemaker is not in full-time education). Anything that
genuinely matters and is unknown stays unknown — the solver then reports `needs_info` and the UI
asks one question instead of guessing.
"""
from __future__ import annotations

from typing import Any

HOUSEHOLD_FIELDS = ("state", "years_in_state", "annual_family_income", "category", "bpl",
                    "govt_employee_in_family", "has_lpg_connection", "owns_cultivable_land")

QUESTIONS = {
    "class12_percentile": {"q": "What was your Class 12 percentile?", "q_hi": "कक्षा 12 में आपका प्रतिशतक कितना था?", "type": "number"},
    "in_full_time_education": {"q": "Are you studying full-time right now?", "q_hi": "क्या आप अभी पूर्णकालिक पढ़ाई कर रहे हैं?", "type": "bool"},
    "new_enterprise": {"q": "Are you starting a new business (not an existing one)?", "q_hi": "क्या आप नया व्यवसाय शुरू कर रहे हैं?", "type": "bool"},
    "trade": {"q": "Which trade do you work in?", "q_hi": "आप कौन सा काम करते हैं?", "type": "enum"},
    "owns_cultivable_land": {"q": "Does your family own farm land in its name?", "q_hi": "क्या आपके परिवार के नाम पर खेती की ज़मीन है?", "type": "bool"},
    "bpl": {"q": "Do you have a BPL / Antyodaya ration card?", "q_hi": "क्या आपके पास बीपीएल / अंत्योदय राशन कार्ड है?", "type": "bool"},
    "has_lpg_connection": {"q": "Does your home already have an LPG gas connection?", "q_hi": "क्या घर में पहले से एलपीजी कनेक्शन है?", "type": "bool"},
    "pregnant_or_new_mother": {"q": "Are you pregnant or a new mother?", "q_hi": "क्या आप गर्भवती हैं या हाल ही में माँ बनी हैं?", "type": "bool"},
    "girl_child_under_10": {"q": "Do you have a daughter below 10 years?", "q_hi": "क्या आपकी 10 साल से कम उम्र की बेटी है?", "type": "bool"},
    "aicte_technical_course": {"q": "Are you in an AICTE-approved engineering/technical course?", "q_hi": "क्या आप एआईसीटीई मान्यता प्राप्त तकनीकी कोर्स में हैं?", "type": "bool"},
    "qhei_admission": {"q": "Did you get merit admission to a top-ranked (NIRF) institution?", "q_hi": "क्या आपको शीर्ष संस्थान में मेरिट से प्रवेश मिला है?", "type": "bool"},
    "has_bank_account": {"q": "Do you have a bank account?", "q_hi": "क्या आपका बैंक खाता है?", "type": "bool"},
    "income_tax_payer": {"q": "Did anyone in your family pay income tax last year?", "q_hi": "क्या पिछले साल परिवार में किसी ने आयकर भरा?", "type": "bool"},
    "breadwinner_died_18_59": {"q": "Was the person who passed away the main earner, aged 18–59?", "q_hi": "क्या दिवंगत व्यक्ति मुख्य कमाने वाले थे और उनकी उम्र 18–59 थी?", "type": "bool"},
    "epfo_esic_member": {"q": "Are you a member of EPF or ESIC (salary deduction)?", "q_hi": "क्या आपके वेतन से पीएफ या ईएसआईसी कटता है?", "type": "bool"},
    "years_in_state": {"q": "How many years have you lived in this state?", "q_hi": "आप इस राज्य में कितने वर्षों से रह रहे हैं?", "type": "number"},
}


def build(raw: dict[str, Any]) -> dict[str, Any]:
    p = {k: v for k, v in raw.items() if v not in (None, "")}
    occ = p.get("occupation")
    age = p.get("age")
    events = set(p.get("life_events") or [])

    def default(field: str, value: Any) -> None:
        if field not in p:
            p[field] = value

    default("in_full_time_education", occ == "student") if occ else None
    if occ in ("private_employee", "govt_employee"):
        default("employed_full_time", True)
    elif occ in ("student", "job_seeker", "homemaker", "retired"):
        default("employed_full_time", False)
    if occ == "govt_employee":
        default("govt_employee_in_family", True)
    if "starting_business" in events:
        default("new_enterprise", True)
    elif occ and occ not in ("self_employed", "artisan", "job_seeker"):
        default("new_enterprise", False)
    if occ and occ != "artisan":
        default("trade", "none")
    if occ and occ != "farmer":
        default("owns_cultivable_land", False)
    if occ in ("gig_worker", "self_employed", "artisan", "street_vendor", "farmer", "homemaker", "student"):
        default("epfo_esic_member", False)
    if p.get("gender") == "male" or (isinstance(age, (int, float)) and (age > 50 or age < 15)):
        default("pregnant_or_new_mother", False)
    if occ != "student":
        default("aicte_technical_course", False)
        default("qhei_admission", False)
    if "death_in_family" not in events:
        default("breadwinner_died_18_59", False)
    income = p.get("annual_family_income")
    if isinstance(income, (int, float)) and income <= 700000:
        # below ₹7 lakh no income tax is payable under the new regime (rebate), so not a taxpayer
        default("income_tax_payer", False)
    if p.get("has_bank_account"):
        default("doc_bank_account", True)
    fam = p.get("family") or []
    kids = [m for m in fam if not m.get("deceased")]
    if fam and "girl_child_under_10" not in p:
        p["girl_child_under_10"] = any(m.get("gender") == "female" and (m.get("age") or 99) < 10 for m in kids)
    default("receives_other_pension", False)
    return p


def tags(p: dict[str, Any]) -> list[str]:
    t: list[str] = []
    if p.get("occupation"):
        t.append(p["occupation"])
    if p.get("gender") == "female":
        t.append("woman")
    if p.get("category") in ("sc", "st", "obc", "ews"):
        t.append(p["category"])
    if isinstance(p.get("age"), (int, float)) and p["age"] >= 60:
        t.append("senior")
    if p.get("disability"):
        t.append("pwd")
    if p.get("marital_status") == "widowed":
        t.append("widow")
    if "death_in_family" in (p.get("life_events") or []):
        t.append("family")
    if p.get("state"):
        t.append(p["state"].lower())
    return t


def member_profile(head: dict[str, Any], member: dict[str, Any]) -> dict[str, Any]:
    """A family member inherits household facts (income, state, category…) and adds their own."""
    m = {k: head[k] for k in HOUSEHOLD_FIELDS if k in head}
    m.update({k: v for k, v in member.items() if k not in ("relation", "deceased", "dob")})
    m.setdefault("has_bank_account", head.get("has_bank_account"))
    # children and siblings added from the family list: assume the common case unless told otherwise
    if member.get("relation") in ("daughter", "son", "brother", "sister"):
        m.setdefault("marital_status", "single")
    m.setdefault("disability", False)
    for doc in ("doc_income_certificate", "doc_domicile_certificate", "doc_caste_certificate"):
        if head.get(doc):
            m.setdefault(doc, True)
    return build(m)


def subject(raw: dict[str, Any], who: str | None) -> dict[str, Any]:
    """The solver profile of the person a scheme is for: the citizen, or a family member by relation."""
    head = build(raw)
    if not who or who == "self":
        return head
    for m in head.get("family") or []:
        if m.get("relation") == who and not m.get("deceased"):
            return member_profile(head, m)
    return head
