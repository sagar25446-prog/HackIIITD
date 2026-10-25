from app import db
from app.main import app
from fastapi.testclient import TestClient

SNAP = {
    "case": {"id": "case", "kind": "education", "title": "Selected case", "applicant_id": "p"},
    "people": [{"id": "p", "name": "Selected person"}],
    "documents": [],
}


def test_share_scope_access_expiry_and_revocation():
    c = TestClient(app)
    bad = {
        **SNAP,
        "people": [{"id": "p", "name": "Selected"}, {"id": "unrelated", "name": "Other"}],
    }
    assert c.post("/api/helper-shares", json={"snapshot": bad}).status_code == 422
    r = c.post("/api/helper-shares", json={"snapshot": SNAP})
    assert r.status_code == 200
    share = r.json()
    path = "/api/helper-shares/" + share["id"]
    helper = {"Authorization": "Bearer " + share["helper_token"]}
    owner = {"Authorization": "Bearer " + share["owner_token"]}
    assert c.get(path).status_code == 404
    assert c.get(path, headers=helper).json()["snapshot"]["people"][0]["id"] == "p"
    assert c.get(path, headers=helper).headers["cache-control"] == "no-store"
    assert c.delete(path, headers=helper).status_code == 403
    assert c.delete(path, headers=owner).json()["revoked"]
    assert c.get(path, headers=helper).status_code == 410
    row = db.query("SELECT * FROM helper_shares WHERE id=?", (share["id"],))[0]
    assert row["payload"] == "{}" and share["owner_token"] not in str(row)
    s = c.post("/api/helper-shares", json={"snapshot": SNAP}).json()
    db.execute("UPDATE helper_shares SET expires=0 WHERE id=?", (s["id"],))
    assert (
        c.get(
            "/api/helper-shares/" + s["id"],
            headers={"Authorization": "Bearer " + s["helper_token"]},
        ).status_code
        == 410
    )


def test_helper_edits_case_facts_with_conflict_and_protected_identity():
    c = TestClient(app)
    share = c.post("/api/helper-shares", json={"snapshot": SNAP}).json()
    path = "/api/helper-shares/" + share["id"]
    auth = {"Authorization": "Bearer " + share["helper_token"]}
    current = c.get(path, headers=auth).json()
    case = current["snapshot"]["case"]
    case["answers"] = {"marks_percent": 70}
    case["notes"] = "Prepared checklist"
    changed = c.patch(path, headers=auth, json={"revision": 1, "case": case})
    assert changed.status_code == 200 and changed.json()["revision"] == 2
    assert changed.json()["snapshot"]["people"] == current["snapshot"]["people"]
    assert changed.json()["snapshot"]["case"]["events"][-1]["actor"] == "helper"
    conflict = c.patch(path, headers=auth, json={"revision": 1, "case": case})
    assert conflict.status_code == 409 and conflict.json()["detail"]["revision"] == 2
    case["applicant_id"] = "another"
    assert c.patch(path, headers=auth, json={"revision": 2, "case": case}).status_code == 400
    case["applicant_id"] = "p"
    case["answers"] = {"account_number": "123"}
    assert c.patch(path, headers=auth, json={"revision": 2, "case": case}).status_code == 422


def test_helper_cannot_inject_evidence_or_other_person_documents():
    c = TestClient(app)
    s = c.post("/api/helper-shares", json={"snapshot": SNAP}).json()
    path = "/api/helper-shares/" + s["id"]
    headers = {"Authorization": "Bearer " + s["helper_token"]}
    case = c.get(path, headers=headers).json()["snapshot"]["case"]
    case["officially_verified"] = True
    assert c.patch(path, headers=headers, json={"revision": 1, "case": case}).status_code == 422
    case.pop("officially_verified")
    case["documents"] = [
        {"id": "d", "kind": "doc_bank_account", "person_id": "unrelated", "state": "available"}
    ]
    # Snapshot ownership validation must be translated to a client validation error, never committed.
    response = c.patch(path, headers=headers, json={"revision": 1, "case": case})
    assert response.status_code == 400
    assert c.get(path, headers=headers).json()["revision"] == 1


def test_helper_audit_is_server_controlled_and_history_is_retained():
    c = TestClient(app)
    s = c.post("/api/helper-shares", json={"snapshot": SNAP}).json()
    path = "/api/helper-shares/" + s["id"]
    h = {"Authorization": "Bearer " + s["helper_token"]}
    case = c.get(path, headers=h).json()["snapshot"]["case"]
    case["events"] = [{"id": "fake", "at": "now", "actor": "owner", "text": "Forged approval"}]
    case["notes"] = "A real helper note"
    result = c.patch(path, headers=h, json={"revision": 1, "case": case}).json()
    assert (
        len(result["snapshot"]["case"]["events"]) == 1
        and result["snapshot"]["case"]["events"][0]["actor"] == "helper"
    )
    assert c.get(path, headers=h).json()["history"][0]["actor"] == "helper"
