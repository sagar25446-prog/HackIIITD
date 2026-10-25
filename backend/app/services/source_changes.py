"""Immutable public captures and explicit reviewer activation. Never stores family profiles."""

from __future__ import annotations

import copy
import hashlib
import json
import math
import time
import uuid
from datetime import date

from .. import db
from ..tinyfish.client import tinyfish

SCHEMA = """
CREATE TABLE IF NOT EXISTS public_captures(id TEXT PRIMARY KEY, workflow TEXT NOT NULL, url TEXT NOT NULL, text TEXT NOT NULL, sha TEXT NOT NULL, mode TEXT NOT NULL, retrieved_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS workflow_changes(id TEXT PRIMARY KEY, workflow TEXT NOT NULL, old_capture TEXT, new_capture TEXT NOT NULL UNIQUE, status TEXT NOT NULL DEFAULT 'pending', reviewed_config TEXT, review_note TEXT, created_at REAL NOT NULL);
CREATE TABLE IF NOT EXISTS workflow_versions(id TEXT PRIMARY KEY, workflow TEXT NOT NULL, config TEXT NOT NULL, active INTEGER NOT NULL, activated_at REAL NOT NULL);
"""


def initialize():
    with db._lock:
        db.conn().executescript(SCHEMA)
        db.conn().commit()


def active_config(kind):
    from .planning import BASE

    initialize()
    rows = db.query(
        "SELECT config FROM workflow_versions WHERE workflow=? AND active=1 ORDER BY activated_at DESC LIMIT 1",
        (kind,),
    )
    return json.loads(rows[0]["config"]) if rows else copy.deepcopy(BASE[kind])


def list_changes():
    initialize()
    rows = db.query(
        "SELECT c.*, n.url, n.retrieved_at, n.mode, n.text AS new_text, o.text AS old_text FROM workflow_changes c JOIN public_captures n ON n.id=c.new_capture LEFT JOIN public_captures o ON o.id=c.old_capture ORDER BY c.created_at DESC LIMIT 100"
    )
    for r in rows:
        r["reviewed_config"] = json.loads(r["reviewed_config"]) if r["reviewed_config"] else None
        r["new_text"] = r["new_text"][:64000]
        r["old_text"] = (r["old_text"] or "")[:64000]
    return rows


def ingest(kind, url, text, mode, retrieved_at):
    initialize()
    text = "\n".join(line.strip() for line in text.splitlines() if line.strip())[:200000]
    sha = hashlib.sha256(text.encode()).hexdigest()
    with db._lock:
        connection = db.conn()
        prev = connection.execute(
            "SELECT * FROM public_captures WHERE workflow=? AND url=? AND mode=? ORDER BY rowid DESC LIMIT 1",
            (kind, url, mode),
        ).fetchone()
        if prev and prev["sha"] == sha:
            return {"workflow": kind, "changed": False, "mode": mode}
        cid = uuid.uuid4().hex
        connection.execute(
            "INSERT INTO public_captures VALUES(?,?,?,?,?,?,?)",
            (cid, kind, url, text, sha, mode, retrieved_at),
        )
        changed = bool(prev) and mode == "live"
        if changed:
            connection.execute(
                "INSERT INTO workflow_changes(id,workflow,old_capture,new_capture,created_at) VALUES(?,?,?,?,?)",
                (uuid.uuid4().hex, kind, prev["id"], cid, time.time()),
            )
        connection.commit()
    return {"workflow": kind, "changed": changed, "baseline": not bool(prev), "mode": mode}


async def scan():
    from .planning import BASE

    targets = [(kind, cfg.get("schedule_url", cfg["source_url"])) for kind, cfg in BASE.items()]
    try:
        result = await tinyfish.fetch(
            [url for _, url in targets],
            purpose="JAAGRUK: public workflow source comparison",
            ttl=0,
            exact_replay=True,
        )
    except Exception:
        return {
            "ok": False,
            "error": "Public sources unavailable. Last reviewed guidance is retained.",
            "pages": [],
            "changes": list_changes(),
        }
    from datetime import datetime, timezone

    replay = bool(result.get("_replay"))
    mode = "saved_recording" if replay else "live"
    checked = result.get("_recorded_at") if replay else datetime.now(timezone.utc).isoformat()
    pages = []
    for kind, url in targets:
        item = next(
            (
                r
                for r in result.get("results", [])
                if r.get("url", "").rstrip("/") == url.rstrip("/")
            ),
            None,
        )
        if item and item.get("text"):
            pages.append(
                ingest(kind, url, item["text"], mode, checked or "recorded date unavailable")
            )
        else:
            pages.append(
                {
                    "workflow": kind,
                    "mode": "unavailable",
                    "error": "No source content; prior evidence retained",
                }
            )
    return {"ok": True, "pages": pages, "changes": list_changes()}


ALLOWED = {
    "education": {
        "fresh_percentile",
        "renewal_marks",
        "renewal_attendance",
        "income_limit",
        "deadlines",
        "academic_year",
    },
    "bereavement": {"income_limit"},
    "retirement": {"income_limit", "minimum_age"},
    "moving": set(),
}


def review(change_id, changes, note, excerpt, approve):
    from .planning import BASE

    initialize()
    with db._lock:
        connection = db.conn()
        row = connection.execute(
            "SELECT c.*,n.text,n.mode FROM workflow_changes c JOIN public_captures n ON n.id=c.new_capture WHERE c.id=?",
            (change_id,),
        ).fetchone()
        if not row:
            raise KeyError("Change not found")
        if row["status"] != "pending":
            raise ValueError("This change has already been reviewed")
        if row["mode"] != "live":
            raise ValueError("A recording cannot establish a new official change")
        if not approve:
            connection.execute(
                "UPDATE workflow_changes SET status=?,review_note=? WHERE id=?",
                ("rejected", note, change_id),
            )
            connection.commit()
            return {"status": "rejected"}
        if not excerpt.strip() or excerpt not in row["text"]:
            raise ValueError("Include an exact supporting passage from the changed source")
        kind = row["workflow"]
        latest = connection.execute(
            "SELECT id FROM public_captures WHERE workflow=? AND mode=? ORDER BY rowid DESC LIMIT 1",
            (kind, "live"),
        ).fetchone()
        if not latest or latest["id"] != row["new_capture"]:
            raise ValueError("A newer source capture exists; review the latest change instead")
        if set(changes) - ALLOWED[kind]:
            raise ValueError("Unsupported rule field")
        current = connection.execute(
            "SELECT config FROM workflow_versions WHERE workflow=? AND active=1 ORDER BY activated_at DESC LIMIT 1",
            (kind,),
        ).fetchone()
        cfg = json.loads(current["config"]) if current else copy.deepcopy(BASE[kind])
        for key, value in changes.items():
            if key == "deadlines":
                if not isinstance(value, dict) or set(value) != {"applicant", "institute", "nodal"}:
                    raise ValueError("Supply all three actor-specific dates")
                if any(not isinstance(d, str) for d in value.values()):
                    raise ValueError("Dates must be ISO YYYY-MM-DD strings")
                for d in value.values():
                    date.fromisoformat(d)
                if not value["applicant"] <= value["institute"] <= value["nodal"]:
                    raise ValueError("Verification dates cannot precede submission")
            elif key == "academic_year":
                import re

                if (
                    not isinstance(value, str)
                    or not re.fullmatch(r"20\d{2}-\d{2}", value)
                    or int(value[-2:]) != (int(value[:4]) + 1) % 100
                ):
                    raise ValueError("Academic year must be a consecutive YYYY-YY period")
            elif (
                type(value) not in (float, int)
                or not math.isfinite(value)
                or value < 0
                or value > 10000000
            ):
                raise ValueError("Invalid reviewed numeric threshold")
            if key in {"fresh_percentile", "renewal_marks", "renewal_attendance"} and value > 100:
                raise ValueError("Percentage threshold out of range")
            if key == "minimum_age" and value > 120:
                raise ValueError("Age threshold out of range")
        cfg.update(changes)
        cfg["version"] = change_id
        cfg["source_checked"] = (
            __import__("datetime")
            .datetime.now(
                __import__("datetime").timezone(
                    __import__("datetime").timedelta(hours=5, minutes=30)
                )
            )
            .date()
            .isoformat()
        )
        connection.execute("UPDATE workflow_versions SET active=0 WHERE workflow=?", (kind,))
        connection.execute(
            "INSERT INTO workflow_versions VALUES(?,?,?,?,?)",
            (change_id, kind, json.dumps(cfg), 1, time.time()),
        )
        connection.execute(
            "UPDATE workflow_changes SET status=?,reviewed_config=?,review_note=? WHERE id=?",
            (
                "approved",
                json.dumps(
                    {
                        "before": json.loads(current["config"]) if current else BASE[kind],
                        "after": cfg,
                        "excerpt": excerpt,
                    }
                ),
                note,
                change_id,
            ),
        )
        connection.commit()
    from . import rules_registry

    return {"status": "approved", "version": change_id, "rules_version": rules_registry.invalidate()}


def impacts(ws):
    from .paperwork import attach
    from .planning import evaluate_case

    result = []
    for change in list_changes():
        if change["status"] == "rejected":
            continue
        for c in ws.cases:
            if c.kind != change["workflow"]:
                continue
            item = {
                "change_id": change["id"],
                "case_id": c.id,
                "person_id": c.applicant_id,
                "status": change["status"],
                "source_url": change["url"],
                "checked_at": change["retrieved_at"],
                "mode": change["mode"],
            }
            if change["status"] == "pending":
                item.update(
                    summary="Source wording changed. Team review is pending; your active plan is unchanged.",
                    summary_hi="स्रोत के शब्द बदले हैं। टीम की समीक्षा लंबित है; आपकी सक्रिय योजना नहीं बदली है।",
                    before=None,
                    after=None,
                )
            else:
                reviewed = change["reviewed_config"]
                before = evaluate_case(ws, c, reviewed["before"])
                after = evaluate_case(ws, c, reviewed["after"])
                attach(ws, c, before)
                attach(ws, c, after)
                fields = [
                    "status",
                    "missing",
                    "failed",
                    "requirements",
                    "deadlines",
                    "removed_tasks",
                ]
                differing = [k for k in fields if before.get(k) != after.get(k)]
                if not differing:
                    continue
                item.update(
                    summary="Reviewed guidance changes these parts of this case: "
                    + ", ".join(differing),
                    summary_hi="समीक्षित मार्गदर्शन से इस मामले की आवश्यकताएँ या तिथियाँ बदली हैं।",
                    before={k: before[k] for k in fields},
                    after={k: after[k] for k in fields},
                    excerpt=reviewed["excerpt"],
                )
            result.append(item)
    return result
