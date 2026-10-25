"""Workspace API: plans, reviewed source changes, paperwork routes and life updates.

Private workspaces are evaluated per request and never stored on the server.
"""

from __future__ import annotations

import os
import secrets
from datetime import date
from typing import Any, Literal

from fastapi import APIRouter, Header, HTTPException
from pydantic import Field

from ..services.planning import plan
from ..workspace_models import Model, Workspace

router = APIRouter(prefix="/api/workspace", tags=["Family workspace"])


@router.post("/plan")
def workspace_plan(body: Workspace):
    return plan(body)


@router.get("/recovery-routes")
def recovery_routes():
    """Same registry as /api/recovery/routes (kept for older screens)."""
    from ..services.recovery_cases import routes

    return routes()


class ReviewIn(Model):
    approve: bool
    changes: dict[str, Any] = Field(default_factory=dict)
    note: str = Field(min_length=5, max_length=1000)
    excerpt: str = Field(default="", max_length=2000)


@router.get("/changes")
def changes():
    from ..services import source_changes

    return {
        "changes": source_changes.list_changes(),
        "review_enabled": bool(os.environ.get("JAAGRUK_REVIEW_KEY")),
    }


@router.post("/changes/scan")
async def scan_changes():
    from ..services import source_changes

    return await source_changes.scan()


@router.post("/changes/{change_id}/review")
def review_change(
    change_id: str, body: ReviewIn, x_reviewer_key: str | None = Header(default=None)
):
    expected = os.environ.get("JAAGRUK_REVIEW_KEY", "")
    if not expected or not secrets.compare_digest(x_reviewer_key or "", expected):
        raise HTTPException(403, "Reviewer access is not configured or not authorized")
    from ..services import source_changes

    try:
        return source_changes.review(change_id, body.changes, body.note, body.excerpt, body.approve)
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@router.post("/changes/impacts")
def personal_impacts(body: Workspace):
    from ..services.source_changes import impacts

    return {"impacts": impacts(body)}


@router.get("/services")
def services():
    from ..services.paperwork import DOCUMENTS
    from ..services.service_paperwork import CATALOG

    return {
        "services": CATALOG,
        "documents": {key: {"name": v[0], "name_hi": v[1]} for key, v in DOCUMENTS.items()},
    }


class GuidanceIn(Model):
    service: str = Field(min_length=2, max_length=100)
    state: str = Field(min_length=2, max_length=80)


@router.post("/paperwork-guidance")
async def paperwork_guidance(body: GuidanceIn):
    from ..services.service_paperwork import find_guidance

    return await find_guidance(body.service, body.state)


class EventPerson(Model):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(default="", max_length=80)
    relation: str = Field(default="", max_length=40)
    deceased: bool = False


class InterpretEventIn(Model):
    text: str = Field(min_length=2, max_length=1000)
    people: list[EventPerson] = Field(default_factory=list, max_length=20)


@router.post("/events/interpret")
def interpret_event(body: InterpretEventIn):
    from ..services.personal_events import interpret

    return interpret(body.text, [p.model_dump() for p in body.people])


class ApplyEventIn(Model):
    workspace: Workspace
    text: str = Field(min_length=2, max_length=1000)
    person_ids: list[str] = Field(min_length=1, max_length=20)
    kind: Literal["note", "moving", "bereavement", "retirement", "education", "income_review"] = (
        "note"
    )
    occurred_on: date | None = None
    destination: str | None = Field(default=None, max_length=80)
    confirm_move: bool = False
    income: float | None = Field(default=None, ge=0)
    confirm_income: bool = False
    mode: Literal["fresh", "renewal"] | None = None
    answers: dict[str, int] = Field(default_factory=dict, max_length=5)
    subject_id: str | None = Field(default=None, max_length=80)
    confirm_deceased: bool = False
    # set by the client after a preview: the update is applied only to the same workspace and rules
    expect_base_hash: str | None = Field(default=None, max_length=40)
    expect_rules_version: str | None = Field(default=None, max_length=40)


def _event_args(body: ApplyEventIn):
    return dict(
        ws=body.workspace,
        text=body.text,
        person_ids=body.person_ids,
        kind=body.kind,
        occurred_on=body.occurred_on,
        destination=body.destination,
        confirm_move=body.confirm_move,
        income=body.income,
        confirm_income=body.confirm_income,
        mode=body.mode,
        answers=body.answers,
        subject_id=body.subject_id,
        confirm_deceased=body.confirm_deceased,
    )


@router.post("/events/preview")
def preview_event(body: ApplyEventIn):
    """What would change — nothing is applied or stored."""
    from ..services.personal_events import preview

    try:
        return preview(**_event_args(body))
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None


@router.post("/events/apply")
def apply_event(body: ApplyEventIn):
    from ..services import rules_registry
    from ..services.personal_events import apply, workspace_hash

    if body.expect_base_hash and body.expect_base_hash != workspace_hash(body.workspace):
        raise HTTPException(409, "Your plan changed after the preview. Preview the update again before saving.")
    if body.expect_rules_version and body.expect_rules_version != rules_registry.version():
        raise HTTPException(409, "The reviewed rules changed after the preview. Preview the update again before saving.")
    try:
        res = apply(
            body.workspace,
            body.text,
            body.person_ids,
            body.kind,
            body.occurred_on,
            body.destination,
            body.confirm_move,
            body.income,
            body.confirm_income,
            mode=body.mode,
            answers=body.answers,
            subject_id=body.subject_id,
            confirm_deceased=body.confirm_deceased,
        )
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from None
    return {**res, "rules_version": rules_registry.version()}
