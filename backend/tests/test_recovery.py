"""Delivery-blocking scenarios for Wapsi recovery, jobs, life-update previews and the rule registry."""

import asyncio
import json
from pathlib import Path

import pytest
from app.main import app
from app.services import jobs, recovery_cases, recovery_lookup
from app.services.planning import plan
from app.tinyfish import portal_results
from app.workspace_models import Workspace
from fastapi.testclient import TestClient

FIX = Path(__file__).parent / "fixtures"


# ------------------------------------------------------------------ strict reading of portal results
def test_lic_official_no_record_message_is_no_match():
    assert portal_results.read_lic((FIX / "lic_no_record.html").read_text(encoding="utf-8"))["outcome"] == "no_match"


def test_lic_unreachable_captcha_and_unknown_pages_are_never_no_match():
    down = "<html><body>This site can’t be reached ERR_TUNNEL_CONNECTION_FAILED</body></html>"
    assert portal_results.read_lic(down)["outcome"] == "unavailable"
    wall = "<form>Unclaimed amounts <img src='/captcha.jpg'> Enter the captcha shown</form>"
    assert portal_results.read_lic(wall)["outcome"] == "citizen_step"
    # "not found" somewhere else on the page is not LIC's result area
    other = "<form>Unclaimed amounts <p>Page not found in archive</p></form>"
    assert portal_results.read_lic(other)["outcome"] == "uncertain"


def test_candidates_stay_separate_and_duplicates_collapse():
    html = (
        "<form>Unclaimed</form><table><tr><th>Policy No</th><th>Name</th><th>Amount</th></tr>"
        "<tr><td>111</td><td>R K Sharma</td><td>₹1,200</td></tr>"
        "<tr><td>111</td><td>R K Sharma</td><td>₹1,200</td></tr>"
        "<tr><td>222</td><td>Ramesh Sharma</td><td>-</td></tr></table>"
    )
    res = portal_results.read_lic(html)
    assert res["outcome"] == "possible_record"
    assert [c["reference"] for c in res["candidates"]] == ["111", "222"]
    assert res["candidates"][0]["amount_inr"] == 1200 and res["candidates"][1]["amount_inr"] is None
    assert "total" not in json.dumps(res).lower()


@pytest.mark.parametrize(
    "result,outcome",
    [
        # seen live: found=true while the text said nothing was found
        ({"found": True, "amount_inr": 0, "holder_name": "not found", "message": "Found 0 unclaimed amounts"}, "uncertain"),
        ({"page_state": "result_shown", "result_area_text": "x", "records": [{"holder_name": "not found"}]}, "uncertain"),
        ({"page_state": "no_record_message", "result_area_text": "No unclaimed funds applicable for entered details", "records": []}, "no_match"),
        ({"page_state": "no_record_message", "result_area_text": "Please try again", "records": []}, "uncertain"),
        ({"page_state": "captcha_or_otp", "result_area_text": "", "records": []}, "citizen_step"),
        ({"page_state": "site_error", "result_area_text": "ERR_EMPTY_RESPONSE", "records": []}, "unavailable"),
        ({"page_state": "result_shown", "result_area_text": "1 record", "records": [{"holder_name": "J Testcase", "amount_inr": "500"}]}, "uncertain"),
        ({"page_state": "result_shown", "result_area_text": "1 record", "records": [{"holder_name": "J Testcase", "amount_inr": 500}]}, "possible_record"),
        ("false", "uncertain"),
    ],
)
def test_agent_output_is_read_strictly(result, outcome):
    assert portal_results.read_agent("tata_aia_unclaimed", "COMPLETED", result, None)["outcome"] == outcome


def test_agent_failure_is_never_no_match():
    assert portal_results.read_agent("tata_aia_unclaimed", "FAILED", None, {"message": "timeout"})["outcome"] == "failed"


# ------------------------------------------------------------------ the request is validated against registry and consent
def body(**kw):
    b = {
        "case_id": "case1",
        "holder_id": "p2",
        "source_id": "lic_unclaimed",
        "category": "insurance",
        "name": "Jaagrukdemo Testcase",
        "dob": "12/03/1971",
        "consent": {"granted": True, "case_id": "case1", "holder_id": "p2", "source_ids": ["lic_unclaimed"]},
    }
    b.update(kw)
    return b


@pytest.fixture
def qualified(monkeypatch):
    monkeypatch.setattr(recovery_cases, "_qualification", lambda: {"lic_unclaimed": {"qualified": True}, "tata_aia_unclaimed": {"qualified": True}})


def test_lookup_requires_matching_route_category_and_consent(qualified):
    ctx = recovery_lookup.validate(body())
    assert recovery_lookup.public(ctx) == {
        "case_id": "case1", "holder_id": "p2", "source_id": "lic_unclaimed", "category": "insurance", "consent_at": ""
    }
    bad = [
        body(category="bank_deposits"),  # an insurance route never handles bank deposits
        body(source_id="udgam", category="bank_deposits"),  # official-site route: no automation
        body(consent={"granted": True, "case_id": "case1", "holder_id": "p3", "source_ids": ["lic_unclaimed"]}),  # another holder
        body(consent={"granted": True, "case_id": "case1", "holder_id": "p2", "source_ids": ["tata_aia_unclaimed"]}),  # another route
        body(consent={"granted": False}),
        body(dob="31/02/1971"),
        body(name="12345"),
    ]
    for b in bad:
        with pytest.raises((recovery_lookup.LookupRejected, ValueError)):
            recovery_lookup.validate(b)


def test_unqualified_adapter_is_not_offered(monkeypatch):
    monkeypatch.setattr(recovery_cases, "_qualification", lambda: {})
    with pytest.raises(recovery_lookup.LookupRejected):
        recovery_lookup.validate(body())
    assert not any(r["automated_ready"] for r in recovery_cases.routes())


def test_personal_lookups_are_never_replayed_offline(qualified):
    from app.tinyfish.client import tinyfish

    assert not tinyfish.live  # tests run in replay mode

    async def go():
        job = jobs.Job("t", "c", True)
        return await recovery_lookup.run(job, recovery_lookup.validate(body()))

    res = asyncio.run(go())
    assert res["observation"]["outcome"] == "unavailable"
    assert res["context"]["holder_id"] == "p2" and "_name" not in res["context"]
    assert "Jaagrukdemo" not in json.dumps(res["observation"])  # name and DOB are not stored


# ------------------------------------------------------------------ recovery cases
def ws(people, cases):
    return Workspace.model_validate({"version": 2, "owner_id": people[0]["id"], "people": people, "household": [], "documents": [], "cases": cases})


P = [
    {"id": "p1", "name": "Sunita Devi", "relation": "self", "deceased": False, "facts": {}},
    {"id": "p2", "name": "Rajesh Kumar", "relation": "spouse", "deceased": True, "facts": {}},
]


def case(**answers):
    return {
        "id": "c1",
        "kind": "wapsi",
        "title": "Recovery",
        "applicant_id": "p1",
        "subject_id": "p2",
        "answers": {"asset_category": "insurance", "institution": "tata_aia_unclaimed", "claimant_relation": "spouse", "claimant_capacity": "nominee", **answers},
    }


def test_invalid_combinations_never_produce_a_ready_case():
    for answers in (
        {"institution": "udgam"},  # insurance asset, bank route
        {"claimant_capacity": "holder"},  # the holder is someone else
    ):
        p = plan(ws(P, [case(**answers)]))["cases"][0]
        assert p["status"] == "review_needed" and not p["ready"]
    ok = plan(ws(P, [case()]))["cases"][0]
    assert ok["ready"] and ok["recovery"]["preparation"]["coverage"] == "reviewed"
    common = [x["id"] for x in ok["recovery"]["preparation"]["common"]]
    assert "holder_death_certificate" in common and "legal_heir" not in json.dumps(common)


def test_observation_for_someone_outside_the_case_is_rejected():
    c = case()
    c["observations"] = [{"id": "o", "source_id": "lic_unclaimed", "holder_id": "p9", "checked_at": "x", "provenance": "user_reported", "outcome": "no_match"}]
    with pytest.raises(ValueError):
        ws(P + [{"id": "p9", "name": "Other", "relation": "x", "deceased": False, "facts": {}}], [c])


def test_possible_record_is_not_ownership_and_discovery_needs_the_bank():
    c = case(asset_category="bank_deposits", institution="udgam")
    c["observations"] = [{"id": "o", "source_id": "udgam", "holder_id": "p2", "checked_at": "2026-10-25T00:00:00", "provenance": "user_reported", "outcome": "possible_record"}]
    p = plan(ws(P, [c]))["cases"][0]
    ids = [t["id"] for t in p["tasks"]]
    assert "recovery:responsible" in ids and p["recovery"]["possible_records"] == 1
    assert "recovered" not in json.dumps(p).lower()


def test_helper_cannot_rewrite_provider_evidence():
    from app.services import helper_shares
    from app.workspace_models import Case, Person

    c = case()
    c["observations"] = [{"id": "o", "source_id": "tata_aia_unclaimed", "holder_id": "p2", "checked_at": "x", "provenance": "automated_live", "outcome": "no_match"}]
    snap = helper_shares.Snapshot(case=Case.model_validate(c), people=[Person.model_validate(p) for p in P])
    created = helper_shares.create(snap, "test-helper")
    edited = Case.model_validate({**c, "observations": [{**c["observations"][0], "outcome": "possible_record"}], "notes": "called"})
    res = helper_shares.update(created["id"], created["helper_token"], 1, edited)
    assert res["snapshot"]["case"]["observations"][0]["outcome"] == "no_match"
    assert res["snapshot"]["case"]["notes"] == "called"


# ------------------------------------------------------------------ jobs: idempotent, cancellable, honest after restart
def test_duplicate_starts_return_the_same_job_and_cancel_works():
    async def go():
        async def slow(job):
            await asyncio.sleep(30)

        a = jobs.start("t", slow, client="c1", idem="same", paid=True)
        b = jobs.start("t", slow, client="c1", idem="same", paid=True)
        assert a.id == b.id
        jobs.start("t", slow, client="c1", idem="other", paid=True)
        with pytest.raises(jobs.AdmissionError):
            jobs.start("t", slow, client="c1", idem="third", paid=True)
        await asyncio.sleep(0.05)
        await jobs.cancel(a.id)
        for _ in range(50):
            if a.done:
                break
            await asyncio.sleep(0.02)
        assert a.status == "cancelled" and a.events[-1]["outcome"] == "cancelled"
        for j in list(jobs._JOBS.values()):
            if not j.done:
                j.task.cancel()

    asyncio.run(go())


def test_interrupted_job_reports_uncertain():
    from app import db

    jobs.on_startup()
    db.execute("INSERT INTO jobs (id, kind, client, status, paid, provider_ids, created, updated) VALUES ('zz','t','c','running',1,'[]',0,0)")
    jobs.on_startup()  # what a restart does
    with TestClient(app) as c:
        with c.stream("GET", "/api/jobs/zz/events") as s:
            text = "".join(s.iter_text())
    assert '"outcome": "uncertain"' in text and "event: end" in text


# ------------------------------------------------------------------ life-update preview
WS = {
    "version": 2,
    "owner_id": "p1",
    "people": [
        {"id": "p1", "name": "Sunita Devi", "relation": "self", "deceased": False, "facts": {"state": "Delhi", "annual_personal_income": 90000}},
        {"id": "p2", "name": "Rajesh Kumar", "relation": "spouse", "deceased": False, "facts": {}},
    ],
    "household": [],
    "documents": [],
    "cases": [],
}


def event(**kw):
    b = {"workspace": WS, "text": "a note", "person_ids": ["p1"], "kind": "note"}
    b.update(kw)
    return b


def test_preview_explains_without_changing_and_stale_apply_is_refused():
    with TestClient(app) as c:
        pv = c.post(
            "/api/workspace/events/preview",
            json=event(text="My husband Rajesh passed away", kind="bereavement", subject_id="p2", confirm_deceased=True, occurred_on="2026-10-01"),
        ).json()
        assert pv["new_cases"][0]["kind"] == "bereavement" and pv["new_cases"][0]["why"]
        assert any(f["field"] == "Marked as passed away" for f in pv["facts"])
        # applying against a different workspace than the one previewed is refused
        changed = {**WS, "people": [WS["people"][0] | {"name": "Sunita"}, WS["people"][1]]}
        r = c.post(
            "/api/workspace/events/apply",
            json=event(workspace=changed, kind="bereavement", subject_id="p2", confirm_deceased=True, expect_base_hash=pv["base_hash"]),
        )
        assert r.status_code == 409
        r = c.post("/api/workspace/events/apply", json=event(expect_rules_version="rules-old"))
        assert r.status_code == 409
        ok = c.post("/api/workspace/events/apply", json=event(expect_base_hash=pv["base_hash"], expect_rules_version=pv["rules_version"]))
        assert ok.status_code == 200


def test_bonus_stays_a_note_and_future_bereavement_is_refused():
    with TestClient(app) as c:
        pv = c.post("/api/workspace/events/preview", json=event(text="I got a bonus of 20000", kind="income_review")).json()
        assert not pv["facts"] and any("note" in u for u in pv["unchanged"])
        r = c.post(
            "/api/workspace/events/preview",
            json=event(kind="bereavement", subject_id="p2", confirm_deceased=True, occurred_on="2099-01-01"),
        )
        assert r.status_code == 400


# ------------------------------------------------------------------ one rule version, privacy, protected controls
def test_one_rules_version_everywhere_and_client_cannot_claim_eligibility(personas):
    with TestClient(app) as c:
        v = c.get("/api/health").json()["rules_version"]
        ev = c.post("/api/evaluate", json={"profile": personas["sunita"]}).json()
        pl = c.post("/api/workspace/plan", json={"version": 2, "people": [], "household": [], "documents": [], "cases": []}).json()
        ex = c.post("/api/explore/search", json={"q": "scholarship", "eligible": ["csss"]}).json()
        assert ev["rules_version"] == pl["rules_version"] == ex["rules_version"] == v
        assert not any(i["you_qualify"] for i in ex["items"])  # client-supplied IDs are ignored
        ex2 = c.post("/api/explore/search", json={"q": "widow pension", "profile": personas["sunita"]}).json()
        assert any(i["you_qualify"] for i in ex2["items"])  # the server's own evaluation decides
        assert ev["haq_meter"]["recurring_inr"] == 30000 and ev["haq_meter"]["one_time_inr"] == 20000
        assert c.post("/api/evaluate", json={"profile": personas["sunita"]}).headers["cache-control"] == "no-store"


def test_monitor_and_webhook_controls_are_protected():
    with TestClient(app) as c:
        assert c.post("/api/radar/monitors").status_code == 403
        assert c.post("/api/radar/webhook?token=wrong", json={"monitor_id": "x"}).status_code == 403
        assert c.post("/api/assist/start", json={"source_id": "udgam"}).status_code in (404, 405)
