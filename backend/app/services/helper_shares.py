"""Capability-scoped, 24-hour case sharing; no family accounts or public case listing."""

from __future__ import annotations

import hashlib
import json
import secrets
import time
import uuid

from fastapi import HTTPException
from pydantic import Field, model_validator

from .. import db
from ..workspace_models import Case, DocumentAssertion, Model, Person


class Snapshot(Model):
    case: Case
    people: list[Person] = Field(min_length=1, max_length=2)
    documents: list[DocumentAssertion] = Field(default_factory=list, max_length=80)

    @model_validator(mode="after")
    def selected_only(self):
        allowed = {self.case.applicant_id, self.case.subject_id} - {None}
        if {p.id for p in self.people} != allowed or len(self.people) != len(allowed):
            raise ValueError("Share only the selected applicant and subject")
        if any(d.person_id not in allowed for d in self.documents + self.case.documents):
            raise ValueError("Another person’s document cannot be shared")
        return self


SCHEMA = """
CREATE TABLE IF NOT EXISTS helper_shares(id TEXT PRIMARY KEY,owner_hash TEXT NOT NULL,helper_hash TEXT NOT NULL,payload TEXT NOT NULL,revision INTEGER NOT NULL,expires REAL NOT NULL,revoked INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS helper_edits(id INTEGER PRIMARY KEY AUTOINCREMENT,share_id TEXT NOT NULL,revision INTEGER NOT NULL,actor TEXT NOT NULL,at REAL NOT NULL,fields TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS helper_rate(key TEXT PRIMARY KEY,count INTEGER NOT NULL);
"""


def initialize():
    with db._lock:
        db.conn().executescript(SCHEMA)
        db.conn().commit()


def digest(s):
    return hashlib.sha256(s.encode()).hexdigest()


def limited(connection, identity, limit):
    key = digest(identity) + ":" + str(int(time.time() // 3600))
    count = connection.execute("SELECT count FROM helper_rate WHERE key=?", (key,)).fetchone()
    if count and count["count"] >= limit:
        raise HTTPException(429, "Too many share operations; try later")
    connection.execute(
        "INSERT INTO helper_rate VALUES(?,1) ON CONFLICT(key) DO UPDATE SET count=count+1", (key,)
    )


def cleanup(connection):
    expired = [
        r["id"]
        for r in connection.execute(
            "SELECT id FROM helper_shares WHERE expires<=? OR revoked=1", (time.time(),)
        )
    ]
    for sid in expired:
        connection.execute("UPDATE helper_shares SET payload=? WHERE id=?", ("{}", sid))
        connection.execute("DELETE FROM helper_edits WHERE share_id=?", (sid,))
    # rate-limit counters are keyed by the hour; anything older than two hours is no longer used
    hour = int(time.time() // 3600)
    stale = [
        r["key"]
        for r in connection.execute("SELECT key FROM helper_rate")
        if int(r["key"].rsplit(":", 1)[-1]) < hour - 1
    ]
    for key in stale:
        connection.execute("DELETE FROM helper_rate WHERE key=?", (key,))


def create(snapshot: Snapshot, identity: str):
    initialize()
    owner = secrets.token_urlsafe(32)
    helper = secrets.token_urlsafe(32)
    sid = uuid.uuid4().hex
    expiry = time.time() + 86400
    with db._lock:
        connection = db.conn()
        cleanup(connection)
        limited(connection, "create:" + identity, 20)
        connection.execute(
            "INSERT INTO helper_shares(id,owner_hash,helper_hash,payload,revision,expires) VALUES(?,?,?,?,?,?)",
            (sid, digest(owner), digest(helper), snapshot.model_dump_json(), 1, expiry),
        )
        connection.commit()
    return {
        "id": sid,
        "owner_token": owner,
        "helper_token": helper,
        "revision": 1,
        "expires_at": expiry,
    }


def authorize(connection, sid, token):
    row = connection.execute("SELECT * FROM helper_shares WHERE id=?", (sid,)).fetchone()
    if not row or not (
        secrets.compare_digest(row["owner_hash"], digest(token))
        or secrets.compare_digest(row["helper_hash"], digest(token))
    ):
        raise HTTPException(404, "Share not found or access denied")
    if row["revoked"] or row["expires"] <= time.time():
        cleanup(connection)
        connection.commit()
        raise HTTPException(410, "This link expired or was revoked")
    return row, "owner" if secrets.compare_digest(row["owner_hash"], digest(token)) else "helper"


def read(sid, token):
    initialize()
    with db._lock:
        row, role = authorize(db.conn(), sid, token)
        history = [
            dict(r)
            for r in db.conn().execute(
                "SELECT revision,actor,at,fields FROM helper_edits WHERE share_id=? ORDER BY id DESC LIMIT 100",
                (sid,),
            )
        ]
        return {
            "id": sid,
            "snapshot": json.loads(row["payload"]),
            "revision": row["revision"],
            "expires_at": row["expires"],
            "role": role,
            "history": history,
        }


def revoke(sid, token):
    initialize()
    with db._lock:
        connection = db.conn()
        _, role = authorize(connection, sid, token)
        if role != "owner":
            raise HTTPException(403, "Only the owner can revoke the link")
        connection.execute("UPDATE helper_shares SET revoked=1,payload=? WHERE id=?", ("{}", sid))
        connection.execute("DELETE FROM helper_edits WHERE share_id=?", (sid,))
        connection.commit()
    return {"revoked": True}


def update(sid, token, revision, new_case: Case):
    initialize()
    from datetime import datetime, timezone

    with db._lock:
        connection = db.conn()
        row, role = authorize(connection, sid, token)
        if row["revision"] != revision:
            raise HTTPException(
                409,
                {
                    "message": "This case changed on another device. Compare before replacing your edits.",
                    "revision": row["revision"],
                    "snapshot": json.loads(row["payload"]),
                },
            )
        previous = Snapshot.model_validate_json(row["payload"])
        old = previous.case
        if any(
            getattr(new_case, k) != getattr(old, k)
            for k in ("id", "kind", "applicant_id", "subject_id")
        ):
            raise HTTPException(400, "Shared case identity and selected people cannot be changed")
        limited(connection, "edit:" + sid, 120)
        payload = new_case.model_dump(mode="json")
        payload["events"] = old.model_dump(mode="json")["events"]
        # provider evidence is read-only for everyone using a link
        payload["observations"] = old.model_dump(mode="json")["observations"]
        changed = [
            key
            for key in payload
            if key != "events" and payload[key] != old.model_dump(mode="json")[key]
        ]
        if not changed:
            return {"revision": revision, "snapshot": previous.model_dump(mode="json")}
        payload["events"] = (
            payload["events"]
            + [
                {
                    "id": uuid.uuid4().hex,
                    "at": datetime.now(timezone.utc).isoformat(),
                    "actor": role,
                    "text": "Updated user-reported case fields: " + ", ".join(changed),
                }
            ]
        )[-100:]
        previous.case = Case.model_validate(payload)
        try:
            previous = Snapshot.model_validate(previous.model_dump())
        except ValueError:
            raise HTTPException(
                400, "Document metadata belongs to someone outside this case"
            ) from None
        new_revision = revision + 1
        connection.execute(
            "UPDATE helper_shares SET payload=?,revision=? WHERE id=? AND revision=?",
            (previous.model_dump_json(), new_revision, sid, revision),
        )
        connection.execute(
            "INSERT INTO helper_edits(share_id,revision,actor,at,fields) VALUES(?,?,?,?,?)",
            (sid, new_revision, role, time.time(), json.dumps(changed)),
        )
        connection.commit()
    return {"revision": new_revision, "snapshot": previous.model_dump(mode="json")}
