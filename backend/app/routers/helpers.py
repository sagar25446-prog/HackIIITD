"""Private selected-case sharing: create, read, edit and revoke one case through a capability link."""

from fastapi import APIRouter, Header, HTTPException, Request
from pydantic import Field

from ..services import helper_shares as shares
from ..workspace_models import Case, Model

router = APIRouter(prefix="/api/helper-shares", tags=["Private selected-case sharing"])


class CreateIn(Model):
    snapshot: shares.Snapshot


class UpdateIn(Model):
    revision: int = Field(ge=1)
    case: Case


def bearer(authorization):
    if (
        not authorization
        or not authorization.startswith("Bearer ")
        or not 30 <= len(authorization[7:]) <= 128
    ):
        raise HTTPException(404, "Share not found or access denied")
    return authorization[7:]


@router.post("")
def create(body: CreateIn, request: Request):
    return shares.create(body.snapshot, request.client.host if request.client else "local")


@router.get("/{sid}")
def read(sid: str, authorization: str | None = Header(default=None)):
    return shares.read(sid, bearer(authorization))


@router.delete("/{sid}")
def revoke(sid: str, authorization: str | None = Header(default=None)):
    return shares.revoke(sid, bearer(authorization))


@router.patch("/{sid}")
def update(sid: str, body: UpdateIn, authorization: str | None = Header(default=None)):
    return shares.update(sid, bearer(authorization), body.revision, body.case)
