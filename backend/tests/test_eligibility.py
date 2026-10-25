from app.ml import eligibility as el
from app.services import entitlements, persona


def rule(sid):
    return next(r for r in el.load_schemes() if r["id"] == sid)


def test_three_valued_proof():
    widow = rule("delhi_widow_pension")
    base = {
        "state": "Delhi",
        "years_in_state": 22,
        "gender": "female",
        "age": 52,
        "marital_status": "widowed",
    }
    assert el.decide(widow, {**base, "annual_family_income": 90000}).status == "eligible"
    assert (
        el.decide(widow, {**base, "annual_family_income": 100000}).status == "not_eligible"
    )  # "less than ₹1 lakh"
    d = el.decide(widow, base)  # income unknown
    assert d.status == "needs_info" and d.missing_facts == ["annual_family_income"]


def test_unsat_core_names_the_failing_clause():
    d = el.decide(
        rule("delhi_widow_pension"),
        {
            "state": "Delhi",
            "years_in_state": 22,
            "gender": "female",
            "age": 52,
            "marital_status": "married",
            "annual_family_income": 90000,
        },
    )
    assert d.status == "not_eligible"
    assert any("Widowed" in f for f in d.failing)


def test_sunita_story(personas):
    ev = entitlements.evaluate(personas["sunita"])
    ids = {m["scheme_id"]: m["decision"]["status"] for m in ev["matches"] if m["who"] == "self"}
    assert ids["delhi_widow_pension"] == "eligible" and ids["nfbs"] == "eligible"
    h = ev["haq_meter"]
    # widow pension and Delhi Lakshmi are mutually exclusive: counted once
    assert ["delhi_lakshmi_yojana", "delhi_widow_pension"] in h["choose_one"]
    assert h["yearly_inr"] == 30000 and h["one_time_inr"] == 20000 and h["total_inr"] == 50000
    assert ev["unlock_paths"][0]["documents"] == ["doc_income_certificate"]


def test_family_members_are_evaluated(personas):
    ev = entitlements.evaluate(personas["sunita"])
    riya = {
        m["scheme_id"]
        for m in ev["matches"]
        if m["who"] == "daughter" and m["decision"]["status"] == "eligible"
    }
    assert "csss" not in riya  # household income is not silently inherited
    child = persona.member_profile(personas["sunita"], personas["sunita"]["family"][0])
    assert "annual_family_income" not in child and "has_bank_account" not in child


def test_exam_age_relaxation():
    upsc = next(e for e in el.load_exams() if e["id"] == "upsc_cse")
    gen = el.decide_exam(
        upsc, {"age": 33, "category": "general", "education": 6, "disability": False}
    )
    obc = el.decide_exam(upsc, {"age": 33, "category": "obc", "education": 6, "disability": False})
    assert (
        gen["status"] == "not_eligible" and obc["status"] == "eligible" and obc["upper_age"] == 35
    )


def test_persona_defaults_do_not_guess_unknowns():
    p = persona.build({"occupation": "homemaker", "age": 40})
    assert "in_full_time_education" not in p and "annual_family_income" not in p
