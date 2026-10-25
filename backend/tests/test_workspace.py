import pytest
from app.services import persona
from app.services.planning import plan
from app.workspace_models import Case, HouseholdFact, Person, Workspace
from pydantic import ValidationError


def test_personal_facts_are_not_inherited():
    p = persona.member_profile(
        {
            "state": "Delhi",
            "has_bank_account": True,
            "doc_caste_certificate": True,
            "annual_family_income": 90000,
        },
        {"name": "Child", "relation": "daughter"},
    )
    assert (
        not {"has_bank_account", "doc_caste_certificate", "state", "annual_family_income"}
        & p.keys()
    )
    p = persona.member_profile(
        {"state": "Delhi", "has_bank_account": True},
        {"name": "Child", "_shared_fields": ["state", "has_bank_account"]},
    )
    assert p["state"] == "Delhi" and "has_bank_account" not in p


def test_ambiguous_relationship_needs_id():
    p = {
        "family": [
            {"id": "a", "relation": "daughter", "name": "A"},
            {"id": "b", "relation": "daughter", "name": "B"},
        ]
    }
    assert persona.subject(p, "b")["name"] == "B"
    with pytest.raises(ValueError):
        persona.subject(p, "daughter")


def test_workspace_rejects_sensitive_unknown_facts_and_wrong_owners():
    with pytest.raises(ValidationError):
        Person(id="a", name="A", facts={"account_number": "123"})
    with pytest.raises(ValidationError):
        HouseholdFact(field="has_bank_account", value=True, person_ids=["a"])
    with pytest.raises(ValidationError):
        Workspace(
            people=[Person(id="a", name="A")],
            documents=[{"id": "d", "person_id": "other", "kind": "doc_bank_account"}],
        )
    assert (
        len(
            Workspace(
                people=[
                    Person(id="a", name="A", relation="daughter"),
                    Person(id="b", name="B", relation="daughter"),
                ]
            ).people
        )
        == 2
    )


def workspace(kind="education", mode="fresh", facts=None):
    return Workspace(
        people=[Person(id="p", name="Applicant", facts=facts or {})],
        cases=[Case(id="c", kind=kind, title="Preparation", applicant_id="p", mode=mode)],
    )


def test_fresh_percentile_boundary_and_renewal_history():
    fields = {
        "class12_percentile": 80,
        "annual_family_income": 100000,
        "degree_course": True,
        "in_full_time_education": True,
        "took_gap_year": False,
        "course_year": 1,
        "other_scholarship": False,
    }
    assert plan(workspace(facts=fields))["cases"][0]["status"] == "not_supported"
    fields["class12_percentile"] = 81
    assert plan(workspace(facts=fields))["cases"][0]["status"] == "preparing"
    p = plan(workspace(mode="renewal", facts={"previous_award": False}))["cases"][0]
    assert p["status"] == "not_supported" and not p["deadlines"]
    assert "class12_percentile" not in p["missing"]


def test_four_journeys_and_person_scoping():
    for kind in ("bereavement", "retirement", "education", "moving"):
        p = plan(workspace(kind=kind))["cases"][0]
        assert p["missing"] and p["official_url"].startswith("https://")
    ws = workspace(
        kind="moving", facts={"nfsa_beneficiary": True, "from_state": "Bihar", "to_state": "Delhi"}
    )
    assert plan(ws)["cases"][0]["status"] == "preparing"


def test_paperwork_is_per_person_and_renewal_avoids_fresh_certificate():
    ws = workspace(
        mode="renewal",
        facts={
            "previous_award": True,
            "marks_percent": 60,
            "attendance_percent": 80,
            "degree_course": True,
            "in_full_time_education": True,
            "course_year": 2,
            "other_scholarship": False,
        },
    )
    p = plan(ws)["cases"][0]
    assert [r["selected"] for r in p["requirements"]] == ["doc_previous_marksheet"]
    assert len(p["deadlines"]) == 3 and not p["ready_for_official_step"]
    from app.workspace_models import DocumentAssertion

    ws.documents = [
        DocumentAssertion(id="d", person_id="p", kind="doc_previous_marksheet", state="available")
    ]
    assert plan(ws)["cases"][0]["ready_for_official_step"]


def test_expired_and_inadequate_residence_are_not_ready():
    from app.services.paperwork import state_of
    from app.workspace_models import DocumentAssertion

    assert (
        state_of(
            DocumentAssertion(
                id="d",
                person_id="p",
                kind="doc_age_proof",
                state="available",
                expires_on="2001-01-01",
            ),
            "age",
        )
        == "expired"
    )
    assert (
        state_of(
            DocumentAssertion(id="d", person_id="p", kind="doc_voter_id", state="available"),
            "residence",
        )
        == "needs_confirmation"
    )


def test_recovery_routes_are_scoped_and_not_ownership():
    ws = workspace(
        kind="wapsi",
        facts={
            "asset_category": "bank_deposits",
            "institution": "udgam",
            "claimant_relation": "self",
        },
    )
    p = plan(ws)["cases"][0]
    rec = p["recovery"]
    # UDGAM only discovers: the bank is the responsible institution
    assert rec["route"]["role"] == "discovery" and "bank" in rec["route"]["responsible"]["en"].lower()
    assert p["official_url"].startswith("https://udgam.rbi.org.in")
    assert not any(k in p for k in ["recovered_money", "ownership_verified"])
    # claim capacity is separate from the relationship and stays unresolved until answered
    assert "claimant_capacity" in p["missing"] and p["status"] == "needs_answers"


def test_public_source_requires_review_and_keeps_previous_evidence(monkeypatch):
    import uuid

    from app import db
    from app.services import source_changes as sc

    kind = "education"
    url = "https://scholarships.gov.in/iver/All-Scholarships"
    unique = uuid.uuid4().hex
    sc.ingest(kind, url, "old " + unique, "live", "2026-10-24T00:00:00Z")
    sc.ingest(kind, url, "new " + unique + " marks 70 percent", "live", "2026-10-24T01:00:00Z")
    change = next(x for x in sc.list_changes() if "new " + unique in x["new_text"])
    assert change["old_text"] and change["status"] == "pending"
    before = sc.active_config(kind)
    assert before["renewal_marks"] == 50
    ws = workspace(
        mode="renewal",
        facts={
            "previous_award": True,
            "marks_percent": 60,
            "attendance_percent": 80,
            "course_year": 2,
            "degree_course": True,
            "in_full_time_education": True,
            "other_scholarship": False,
        },
    )
    assert any(x["case_id"] == "c" and x["status"] == "pending" for x in sc.impacts(ws))
    with pytest.raises(ValueError):
        sc.review(change["id"], {"renewal_marks": 70}, "Reviewed condition", "not in source", True)
    sc.review(
        change["id"],
        {"renewal_marks": 70},
        "Reviewer confirmed exact threshold",
        "marks 70 percent",
        True,
    )
    assert sc.active_config(kind)["renewal_marks"] == 70
    assert plan(ws)["cases"][0]["status"] == "not_supported"
    assert any(x["status"] == "approved" for x in sc.impacts(ws))
    db.execute("UPDATE workflow_versions SET active=0 WHERE workflow=?", (kind,))


@pytest.mark.parametrize(
    "kind,facts,status",
    [
        ("retirement", {"state": "Bihar", "age": 70}, "not_supported"),
        (
            "moving",
            {"nfsa_beneficiary": False, "from_state": "Bihar", "to_state": "Delhi"},
            "not_supported",
        ),
        ("education", {"class12_percentile": 80}, "not_supported"),
        ("education", {"class12_percentile": None}, "needs_answers"),
    ],
)
def test_unsupported_and_unknown_cases(kind, facts, status):
    assert plan(workspace(kind=kind, facts=facts))["cases"][0]["status"] == status


def test_only_selected_confirmed_household_facts_apply():
    from app.services.planning import effective_facts
    from app.workspace_models import HouseholdFact

    ws = workspace(facts={})
    ws.people.append(Person(id="q", name="Other"))
    ws.household = [HouseholdFact(field="state", value="Delhi", person_ids=["q"], confirmed=True)]
    assert "state" not in effective_facts(ws, ws.cases[0])
    ws.household[0].person_ids = ["p"]
    ws.household[0].confirmed = False
    assert "state" not in effective_facts(ws, ws.cases[0])
    ws.household[0].confirmed = True
    assert effective_facts(ws, ws.cases[0])["state"] == "Delhi"
    ws.cases[0].answers = {"state": "Bihar"}
    assert effective_facts(ws, ws.cases[0])["state"] == "Bihar"
    assert ws.people[0].facts == {}


def test_document_for_another_person_never_makes_case_ready():
    from app.workspace_models import DocumentAssertion

    ws = workspace(
        mode="renewal",
        facts={
            "previous_award": True,
            "marks_percent": 60,
            "attendance_percent": 80,
            "course_year": 2,
            "degree_course": True,
            "in_full_time_education": True,
            "other_scholarship": False,
        },
    )
    ws.people.append(Person(id="q", name="Parent"))
    ws.documents = [
        DocumentAssertion(id="d", person_id="q", kind="doc_previous_marksheet", state="available")
    ]
    assert not plan(ws)["cases"][0]["ready_for_official_step"]
    assert len(plan(ws)["cases"][0]["deadlines"]) == 3


def test_unknown_prior_award_has_no_renewal_schedule():
    p = plan(workspace(mode="renewal", facts={"previous_award": None}))["cases"][0]
    assert not p["deadlines"] and "previous_award" in p["missing"]


def test_source_outage_preserves_active_guidance(monkeypatch):
    import asyncio

    from app.services import source_changes as sc

    async def fail(*a, **kw):
        raise RuntimeError("offline")

    before = sc.active_config("education")
    monkeypatch.setattr(sc.tinyfish, "fetch", fail)
    result = asyncio.run(sc.scan())
    assert not result["ok"] and sc.active_config("education") == before


def test_replay_for_new_evidence_requires_exact_request(monkeypatch):
    import asyncio

    from app.tinyfish import recorder
    from app.tinyfish.client import TinyFishClient, TinyFishUnavailable

    monkeypatch.setattr(recorder, "load", lambda key: None)
    monkeypatch.setattr(recorder, "load_similar", lambda *a: {"response": {"wrong": "response"}})
    client = TinyFishClient()
    with pytest.raises(TinyFishUnavailable):
        asyncio.run(client._call("fetch", ["x"], None, "x", lambda: None, exact_replay=True))


def test_workspace_api_validation_and_private_headers():
    from app.main import app
    from fastapi.testclient import TestClient

    c = TestClient(app)
    r = c.post("/api/workspace/plan", json=workspace().model_dump(mode="json"))
    assert r.status_code == 200 and r.headers["cache-control"] == "no-store"
    bad = workspace().model_dump(mode="json")
    bad["people"][0]["facts"] = {"pan": "PRIVATE"}
    assert c.post("/api/workspace/plan", json=bad).status_code == 422
    assert (
        c.post(
            "/api/workspace/changes/anything/review",
            json={"approve": True, "note": "checked", "changes": {}},
        ).status_code
        == 403
    )


@pytest.mark.parametrize(
    "service,stage,extra,required",
    [
        (
            "pan",
            "instant_epan",
            {
                "age": 30,
                "already_has_pan": False,
                "aadhaar_ready": True,
                "linked_mobile": True,
                "representative_assessee": False,
            },
            "doc_linked_mobile",
        ),
        ("aadhaar", "address_update", {"age": 30}, "doc_address_proof"),
        ("income_certificate", "new", {"age": 30}, "doc_income_evidence"),
        (
            "driving_licence",
            "learner",
            {"age": 45, "vehicle_type": "non_transport"},
            "doc_medical_form1a",
        ),
    ],
)
def test_service_first_paperwork(service, stage, extra, required):
    ws = workspace(
        kind="paperwork",
        facts={"state": "Delhi", "service": service, "application_stage": stage, **extra},
    )
    result = plan(ws)["cases"][0]
    assert required in [r["selected"] for r in result["requirements"]]
    assert result["official_url"].startswith("https://")


def test_child_aadhaar_and_minor_instant_pan_do_not_use_adult_shortcuts():
    aadhaar = plan(
        workspace(
            kind="paperwork",
            facts={"service": "aadhaar", "application_stage": "new", "age": 4, "state": "Delhi"},
        )
    )["cases"][0]
    assert aadhaar["status"] == "review_needed" and not aadhaar["requirements"]
    pan = plan(
        workspace(
            kind="paperwork",
            facts={
                "service": "pan",
                "application_stage": "instant_epan",
                "age": 17,
                "state": "Delhi",
                "already_has_pan": False,
                "aadhaar_ready": True,
                "linked_mobile": True,
                "representative_assessee": False,
            },
        )
    )["cases"][0]
    assert pan["status"] == "not_supported"


def test_free_text_bonus_is_a_note_until_income_is_confirmed():
    from app.services.personal_events import apply, interpret

    ws = workspace(
        kind="retirement", facts={"state": "Delhi", "age": 65, "annual_family_income": 50000}
    )
    proposal = interpret("I got a bonus at work today")
    assert proposal["kind"] == "income_review"
    result = apply(
        ws, "I got a bonus at work today", ["p"], proposal["kind"], None, None, False, None, False
    )
    assert result["workspace"]["people"][0]["facts"] == ws.people[0].facts and not result["changes"]
    assert result["workspace"]["journal"][0]["text"] == "I got a bonus at work today"
    assert ws.journal == []


def test_confirmed_move_reassesses_only_selected_people_and_keeps_documents():
    from app.services.personal_events import apply, interpret
    from app.services.planning import today
    from app.workspace_models import DocumentAssertion

    ws = workspace(
        kind="retirement",
        facts={
            "state": "Delhi",
            "age": 65,
            "years_in_state": 10,
            "annual_family_income": 50000,
            "receives_other_pension": False,
            "has_bank_account": True,
        },
    )
    ws.people.append(Person(id="other", name="Other", facts={"state": "Delhi"}))
    ws.documents = [
        DocumentAssertion(
            id="doc",
            person_id="p",
            kind="doc_domicile_certificate",
            state="available",
            covers_from="2000-01-01",
            covers_to="2099-01-01",
        )
    ]
    assert (
        interpret("I am moving from Delhi to Maharashtra")["suggested_destination"] == "Maharashtra"
    )
    result = apply(
        ws, "Moving to Maharashtra", ["p"], "moving", today(), "Maharashtra", True, None, False
    )
    assert result["workspace"]["people"][0]["facts"]["state"] == "Maharashtra"
    assert result["workspace"]["people"][1]["facts"]["state"] == "Delhi"
    assert (
        result["workspace"]["documents"][0]["state"] == "available"
        and result["workspace"]["documents"][0]["issued_state"] == "Delhi"
    )
    assert result["affected_cases"][0]["after"] == "not_supported"
    assert ws.people[0].facts["state"] == "Delhi"


def test_planned_move_does_not_change_current_residence():
    from datetime import timedelta

    from app.services.personal_events import apply
    from app.services.planning import today

    ws = workspace(facts={"state": "Delhi"})
    result = apply(
        ws,
        "Moving next month",
        ["p"],
        "moving",
        today() + timedelta(days=30),
        "Maharashtra",
        True,
        None,
        False,
    )
    assert result["workspace"]["people"][0]["facts"]["state"] == "Delhi" and result["scheduled"]
    assert not result["changes"]


def test_free_text_events_api_rejects_unconfirmed_missing_move_details():
    from app.main import app
    from fastapi.testclient import TestClient

    c = TestClient(app)
    ws = workspace(facts={"state": "Delhi"})
    interpretation = c.post(
        "/api/workspace/events/interpret", json={"text": "आज मुझे ऑफिस में बोनस मिला"}
    ).json()
    assert interpretation["kind"] == "income_review"
    result = c.post(
        "/api/workspace/events/apply",
        json={
            "workspace": ws.model_dump(mode="json"),
            "text": "Moving",
            "person_ids": ["p"],
            "kind": "moving",
            "confirm_move": True,
        },
    )
    assert result.status_code == 400


def test_facts_validate_boolean_text_and_integer_types():
    for field, value in [
        ("previous_award", "false"),
        ("has_bank_account", 1),
        ("state", 123),
        ("course_year", 2.5),
        ("education", 8),
    ]:
        with pytest.raises(ValidationError):
            Person(id="p", name="Person", facts={field: value})
    assert (
        Person(id="p", name="Person", facts={"previous_award": None, "state": None}).facts["state"]
        is None
    )


def test_null_state_in_paperwork_requests_needs_an_answer_not_server_error():
    from app.main import app
    from fastapi.testclient import TestClient

    client = TestClient(app)
    for service in ("income_certificate", "driving_licence"):
        ws = workspace(
            kind="paperwork",
            facts={"state": None, "service": service, "application_stage": "new", "age": 30},
        )
        response = client.post("/api/workspace/plan", json=ws.model_dump(mode="json"))
        assert response.status_code == 200
        assert "state" in response.json()["cases"][0]["missing"]
        assert not response.json()["cases"][0]["requirements"]


def test_duplicate_event_people_and_workspace_case_overflow_are_rejected():
    from app.services.personal_events import apply

    ws = workspace(facts={})
    with pytest.raises(ValueError):
        apply(ws, "A personal note", ["p", "p"], "note", None, None, False, None, False)
    ws.cases = [
        Case(id=str(i), kind="education", title="Case", applicant_id="p") for i in range(100)
    ]
    with pytest.raises(ValueError):
        apply(ws, "A college update", ["p"], "education", None, None, False, None, False)
    assert len(ws.cases) == 100


def test_rule_review_rejects_nonfinite_thresholds_invalid_dates_and_obsolete_sources():
    import uuid

    from app.services import source_changes as sc

    unique = uuid.uuid4().hex
    url = "https://scholarships.gov.in/iver/All-Scholarships"
    sc.ingest("education", url, "review baseline " + unique, "live", "2026-10-24T01:00:00Z")
    sc.ingest("education", url, "review changed " + unique, "live", "2026-10-24T02:00:00Z")
    change = next(c for c in sc.list_changes() if c["new_text"] == "review changed " + unique)
    for fields in (
        {"renewal_marks": float("nan")},
        {"renewal_marks": 101},
        {"deadlines": {"applicant": 1, "institute": "2026-11-15", "nodal": "2026-11-30"}},
        {"academic_year": "2026-00"},
    ):
        with pytest.raises(ValueError):
            sc.review(change["id"], fields, "Checked metadata", "review changed", True)
    sc.ingest("education", url, "a newer public source " + unique, "live", "2026-10-24T03:00:00Z")
    with pytest.raises(ValueError, match="newer source"):
        sc.review(change["id"], {"renewal_marks": 65}, "Checked metadata", "review changed", True)
    assert next(c for c in sc.list_changes() if c["id"] == change["id"])["status"] == "pending"


def test_owner_is_stable_and_must_reference_a_person():
    ws = workspace()
    ws.owner_id = "p"
    assert Workspace.model_validate(ws.model_dump()).owner_id == "p"
    with pytest.raises(ValidationError):
        Workspace(owner_id="unknown", people=ws.people)


def test_same_state_move_preserves_residence_and_future_income_is_only_planned():
    from datetime import timedelta

    from app.services.personal_events import apply
    from app.services.planning import today

    ws = workspace(facts={"state": "Delhi", "years_in_state": 22, "annual_personal_income": 50000})
    result = apply(ws, "Moved within Delhi", ["p"], "moving", today(), "Delhi", True, None, False)
    assert result["workspace"]["people"][0]["facts"]["years_in_state"] == 22
    assert not result["changes"]
    future = apply(
        ws,
        "Salary rise next month",
        ["p"],
        "income_review",
        today() + timedelta(days=30),
        None,
        False,
        60000,
        True,
    )
    assert future["workspace"]["people"][0]["facts"]["annual_personal_income"] == 50000
    assert future["scheduled"] and not future["changes"]


def test_recovery_does_not_require_death_certificate_for_a_living_asset_holder():
    ws = workspace(
        kind="wapsi",
        facts={
            "asset_category": "insurance",
            "institution": "lic_unclaimed",
            "claimant_relation": "child",
        },
    )
    ws.people.append(Person(id="holder", name="Living parent"))
    ws.cases[0].subject_id = "holder"
    assert "death" not in [r["id"] for r in plan(ws)["cases"][0]["requirements"]]
    ws.people[1].deceased = True
    assert "death" in [r["id"] for r in plan(ws)["cases"][0]["requirements"]]


def test_historical_bank_statement_does_not_satisfy_last_year_requirement():
    from app.services.paperwork import state_of
    from app.workspace_models import DocumentAssertion

    document = DocumentAssertion(
        id="d",
        person_id="p",
        kind="doc_bank_statement",
        state="available",
        covers_from="2000-01-01",
        covers_to="2001-01-01",
    )
    assert state_of(document, "bank_statement") == "needs_confirmation"


def test_pension_document_lists_keep_workflow_specific_requirements_separate():
    retirement = plan(workspace(kind="retirement"))["cases"][0]
    bereavement = plan(workspace(kind="bereavement"))["cases"][0]
    assert "aadhaar" in [r["id"] for r in retirement["requirements"]]
    assert "bank_statement" not in [r["id"] for r in retirement["requirements"]]
    assert "bank_statement" in [r["id"] for r in bereavement["requirements"]]
