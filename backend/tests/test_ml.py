import asyncio

from app.ml import change, extract, name_match
from app.ml import eligibility as el

NOTICE = (
    "Pension Scheme to Women in Distress. The applicant should be a widow, divorced, separated or destitute "
    "woman above the age of 18 years. Residence of a minimum of 5 years in Delhi before the date of application. "
    "The annual income of the applicant should be less than Rs. 1,00,000 per annum from all sources. "
    "In the case of an SC/ST applicant, a certificate has to be submitted."
)


def test_extraction_matches_curated_rule_proven_by_z3():
    ext = asyncio.run(extract.extract(NOTICE))
    widow = next(r for r in el.load_schemes() if r["id"] == "delhi_widow_pension")
    d = extract.drift(widow, ext["conditions"])
    assert not d["differences"] and not d["needs_review"]
    assert {"age", "annual_family_income", "marital_status", "years_in_state"} <= set(
        d["equivalent_fields"]
    )
    assert not any(
        c["field"] == "category" for c in ext["conditions"]
    )  # a document note is not an eligibility rule


def test_drift_gives_a_concrete_counterexample():
    widow = next(r for r in el.load_schemes() if r["id"] == "delhi_widow_pension")
    d = extract.drift(
        widow,
        [{"field": "annual_family_income", "op": "le", "value": 100000, "label": "up to 1 lakh"}],
    )
    assert d["needs_review"] and "100000" in d["differences"][0]["example"]


def test_contradictory_extraction_is_rejected():
    good, problems = extract.validate(
        [{"field": "age", "op": "ge", "value": 60}, {"field": "age", "op": "le", "value": 40}]
    )
    assert good == [] and problems


def test_name_matcher_handles_indian_variants():
    p = lambda a, b: name_match.match_probability(a, b)["probability"]  # noqa: E731
    assert p("Ramesh Kumar Sharma", "R. K. Sarma") > 0.85
    assert p("Ramesh Kumar Sharma", "रमेश कुमार शर्मा") > 0.85
    assert p("Mohammad Imran Khan", "Md. Imran Khan") > 0.85
    assert p("Ramesh Kumar Sharma", "Suresh Kumar Sharma") < 0.5
    assert (
        name_match.match_probability(
            "Ramesh Kumar Sharma", "R K Sharma", dob_a="12/03/1971", dob_b="01/01/1980"
        )["probability"]
        < 0.5
    )


def test_change_radar_reports_only_what_matters():
    old = "## Notice Board\n\nOct122026\n\nTentative Vacancies of Junior Engineer Examination, 2026.\n\n(61.28 KB)"
    new = (
        "## Notice Board\n\nOct202026\n\nCombined Graduate Level Examination, 2026: Extension of last date for online "
        "applications to 30 October 2026\n\n(210.00 KB)\n\n"
        + old.split("\n\n", 1)[1]
        + "\n\nTotal Visitor Count: 99"
    )
    d = change.diff(old, new)
    assert (
        len(d) == 1
        and d[0]["kind"] == "deadline"
        and d[0]["exam_ids"] == ["ssc_cgl"]
        and d[0]["posted"] == "2026-10-20"
    )
