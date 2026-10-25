"""The free-text reader suggests who an update is about and its details; apply needs confirmation."""

from datetime import date, timedelta

from app.services.personal_events import apply, interpret
from app.services.planning import today
from app.workspace_models import Workspace

PEOPLE = [
    {"id": "me", "name": "Sunita Devi", "relation": "self", "deceased": False},
    {"id": "riya", "name": "Riya", "relation": "daughter", "deceased": False},
    {"id": "ramesh", "name": "Ramesh Kumar Sharma", "relation": "husband", "deceased": False},
]


def workspace() -> Workspace:
    return Workspace.model_validate(
        {
            "owner_id": "me",
            "people": [
                {
                    "id": "me",
                    "name": "Sunita Devi",
                    "relation": "self",
                    "facts": {"state": "Delhi"},
                },
                {"id": "riya", "name": "Riya", "relation": "daughter", "facts": {"age": 20}},
                {"id": "ramesh", "name": "Ramesh Kumar Sharma", "relation": "husband"},
            ],
        }
    )


def test_education_update_about_a_named_daughter_is_a_renewal_in_year_two():
    r = interpret(
        "My daughter Riya got into second year of college and needs her scholarship renewed", PEOPLE
    )
    assert r["kind"] == "education"
    assert r["person_ids"] == ["riya"] and r["about_others"] is True
    assert r["mode"] == "renewal" and r["answers"] == {"course_year": 2}


def test_hindi_relation_word_finds_the_person_and_first_year_is_fresh():
    r = interpret("मेरी बेटी का कॉलेज में पहले साल में दाखिला हुआ", PEOPLE)
    assert r["kind"] == "education" and r["person_ids"] == ["riya"]
    assert r["mode"] == "fresh" and r["answers"] == {"course_year": 1}


def test_bereavement_keeps_the_survivor_as_applicant_and_suggests_the_subject():
    r = interpret("My husband passed away last month", PEOPLE)
    assert r["kind"] == "bereavement"
    assert r["person_ids"] == ["me"] and r["subject_id"] == "ramesh"
    expected = today().replace(day=1) - timedelta(days=1)
    assert r["occurred_on"][:7] == expected.isoformat()[:7]


def test_we_moved_suggests_every_living_person_and_the_destination():
    r = interpret("We moved to Maharashtra on 3 October 2026", PEOPLE)
    assert r["kind"] == "moving" and r["suggested_destination"] == "Maharashtra"
    assert set(r["person_ids"]) == {"me", "riya", "ramesh"}
    assert r["occurred_on"] == "2026-10-03"


def test_salary_amount_is_suggested_but_a_bonus_is_not_income():
    r = interpret("My salary is now ₹25,000 per month", PEOPLE)
    assert r["kind"] == "income_review" and r["income"] == 300000
    assert r["income_period"] == "monthly"
    assert interpret("I got a bonus of 50,000 rupees at work", PEOPLE)["income"] is None


def test_unknown_relative_is_reported_so_the_user_can_add_them():
    r = interpret("My mother turned 60 and retired", PEOPLE)
    assert r["kind"] == "retirement" and r["unknown_relations"] == ["mother"]
    assert r["person_ids"] == ["me"]


def test_plain_note_stays_a_note_about_self():
    r = interpret("Went to the temple with friends", PEOPLE)
    assert r["kind"] == "note" and r["person_ids"] == ["me"] and r["about_others"] is False


def test_education_case_carries_the_reviewed_mode_and_year_and_is_linked_to_the_journal():
    r = apply(
        workspace(),
        "Riya second year renewal",
        ["riya"],
        "education",
        date(2026, 10, 20),
        None,
        False,
        None,
        False,
        mode="renewal",
        answers={"course_year": 2, "annual_family_income": 1},
    )
    case = next(c for c in r["workspace"]["cases"] if c["id"] in r["new_case_ids"])
    assert case["applicant_id"] == "riya" and case["mode"] == "renewal"
    assert case["answers"] == {"course_year": 2}  # only details the case type uses
    assert r["workspace"]["journal"][-1]["case_ids"] == r["new_case_ids"]


def test_bereavement_marks_the_subject_deceased_only_when_confirmed():
    unconfirmed = apply(
        workspace(),
        "Husband died",
        ["me"],
        "bereavement",
        None,
        None,
        False,
        None,
        False,
        subject_id="ramesh",
    )
    person = next(p for p in unconfirmed["workspace"]["people"] if p["id"] == "ramesh")
    assert person["deceased"] is False
    case = next(c for c in unconfirmed["workspace"]["cases"] if c["kind"] == "bereavement")
    assert case["subject_id"] == "ramesh" and case["applicant_id"] == "me"
    confirmed = apply(
        workspace(),
        "Husband died",
        ["me"],
        "bereavement",
        None,
        None,
        False,
        None,
        False,
        subject_id="ramesh",
        confirm_deceased=True,
    )
    assert next(p for p in confirmed["workspace"]["people"] if p["id"] == "ramesh")["deceased"]
    assert {
        "person_id": "ramesh",
        "field": "deceased",
        "before": False,
        "after": True,
    } in confirmed["changes"]


def test_subject_cannot_be_the_applicant():
    try:
        apply(
            workspace(),
            "x died",
            ["me"],
            "bereavement",
            None,
            None,
            False,
            None,
            False,
            subject_id="me",
        )
    except ValueError:
        return
    raise AssertionError("expected a ValueError")


def test_interpret_api_accepts_people_and_wapsi_accepts_every_portal():
    from app.main import app
    from fastapi.testclient import TestClient

    c = TestClient(app)
    r = c.post(
        "/api/workspace/events/interpret",
        json={"text": "Riya needs her scholarship renewed", "people": PEOPLE},
    )
    assert r.status_code == 200 and r.json()["person_ids"] == ["riya"]
    from app.services import recovery_cases

    every = recovery_cases.routes()
    assert len(every) == 7
    # without consent nothing starts
    r = c.post(
        "/api/wapsi/start",
        json={"profile": {}, "person": {"name": "A"}, "consent": False, "source_ids": [t["id"] for t in every]},
    )
    assert r.status_code == 400 and "consent" in r.json()["detail"]
