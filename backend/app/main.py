"""JAAGRUK API. Serves the PWA too, so the whole product runs with one command (see run.py)."""

from __future__ import annotations

import asyncio
import json
import os
import secrets
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from . import db
from .config import DATA_DIR, ROOT, VAR_DIR, settings
from .ml import assistant, llm, name_match
from .ml import eligibility as el
from .routers.helpers import router as helpers_router
from .routers.workspace import router as workspace_router
from .services import (
    change_radar,
    checker,
    claims,
    discover,
    entitlements,
    helper_shares,
    jobs,
    recovery_cases,
    recovery_lookup,
    rules_registry,
    wapsi,
)
from .services import catalog as explore_cat
from .tinyfish import recorder
from .tinyfish.client import TinyFishUnavailable, tinyfish

FRONTEND = ROOT / "frontend" / "dist"


async def _housekeeping() -> None:
    """Expired helper links are pruned hourly; expiry and revocation are also enforced on every request."""
    while True:
        try:
            helper_shares.initialize()
            with db._lock:
                helper_shares.cleanup(db.conn())
                db.conn().commit()
        except Exception:  # noqa: BLE001 - housekeeping must never stop the server
            pass
        await asyncio.sleep(3600)


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.conn()
    jobs.on_startup()
    recorder.import_captures()
    change_radar.seed_baselines()
    keeper = asyncio.get_running_loop().create_task(_housekeeping())
    # warm the models and the scheme index so the first request is fast
    await asyncio.to_thread(
        lambda: (rules_registry.version(), name_match.model(), assistant._index(), explore_cat.INDEX.ensure())
    )
    yield
    keeper.cancel()


app = FastAPI(title="JAAGRUK API", version="1.1", lifespan=lifespan)
# The API serves its own app (same origin); cross-origin access is only for the Vite dev server.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_methods=["*"],
    allow_headers=["*"],
)
app.include_router(workspace_router)
app.include_router(helpers_router)


def _json(name: str) -> Any:
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def _client(request: Request) -> str:
    return jobs.client_id(request.client.host if request.client else "local")


def _start(kind, fn, request: Request, idem: str | None, paid: bool) -> jobs.Job:
    try:
        return jobs.start(kind, fn, client=_client(request), idem=(idem or None) and idem[:80], paid=paid)
    except jobs.AdmissionError as exc:
        raise HTTPException(429, str(exc)) from exc


def _reviewer(key: str | None) -> None:
    expected = os.environ.get("JAAGRUK_REVIEW_KEY", "")
    if not expected or not secrets.compare_digest(key or "", expected):
        raise HTTPException(403, "Operator access is not configured or the key is wrong")


def sse(job: jobs.Job, start: int = 0) -> EventSourceResponse:
    async def gen():
        async for ev in job.stream(start):
            yield {"data": json.dumps(ev, ensure_ascii=False, default=str)}
        yield {
            "event": "end",
            "data": json.dumps({"result": job.result, "status": job.status}, ensure_ascii=False, default=str),
        }

    return EventSourceResponse(gen(), ping=10)


# ------------------------------------------------------------------ meta
@app.get("/api/health")
async def health() -> dict:
    return {
        "ok": True,
        "tinyfish": {
            "mode": settings.tinyfish_mode,
            "live": settings.live_enabled,
            "recordings": len(list(recorder.REC_DIR.glob("*.json"))),
        },
        "llm": {
            "available": llm.available(),
            "model": settings.anthropic_model if llm.available() else None,
        },
        "rules_version": rules_registry.version(),
        "webhook_ready": bool(settings.public_base_url),
        "operator_controls": bool(os.environ.get("JAAGRUK_REVIEW_KEY")),
    }


@app.get("/api/personas")
def personas() -> list[dict]:
    return _json("personas.json")


@app.get("/api/onboarding")
def onboarding() -> dict:
    return _json("onboarding.json")


@app.get("/api/catalog")
def catalog() -> dict:
    return {
        "schemes": el.load_schemes(),
        "exams": el.load_exams(),
        "documents": el.load_documents(),
        "life_events": list(entitlements.life_events().values()),
        "rule_checks": discover.rule_checks(),
        "enums": el.ENUMS,
        "education_labels": el.EDUCATION_LABELS,
        "workflow_schemes": rules_registry.WORKFLOW_SCHEME,
        "rules_version": rules_registry.version(),
    }


@app.get("/api/rules")
def rules() -> dict:
    return rules_registry.describe()


# ------------------------------------------------------------------ entitlements (benefit estimates, matches, unlock path)
class EvalIn(BaseModel):
    profile: dict[str, Any]
    wapsi_found_inr: int = 0
    who: str | None = None  # a person's id (or "self")


@app.post("/api/evaluate")
async def evaluate(body: EvalIn) -> dict:
    return await asyncio.to_thread(entitlements.evaluate, body.profile, body.wapsi_found_inr)


@app.post("/api/application-pack/{scheme_id}")
def application_pack(scheme_id: str, body: EvalIn) -> dict:
    try:
        pack = claims.application_pack(scheme_id, body.profile, body.who)
    except StopIteration:
        raise HTTPException(404, "unknown scheme") from None
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {**pack, "rules_version": rules_registry.version()}


# ------------------------------------------------------------------ Wapsi: recovery lookups bound to a case
class LookupIn(BaseModel):
    case_id: str = Field(min_length=1, max_length=80)
    holder_id: str = Field(min_length=1, max_length=80)
    source_id: str = Field(min_length=1, max_length=60)
    category: str = Field(min_length=1, max_length=40)
    name: str = Field(min_length=1, max_length=80)
    dob: str = Field(min_length=8, max_length=10)
    consent: dict[str, Any]


@app.get("/api/recovery/routes")
def recovery_routes() -> list[dict]:
    return recovery_cases.routes()


@app.post("/api/recovery/lookup")
async def recovery_lookup_start(
    body: LookupIn, request: Request, idempotency_key: str | None = Header(default=None)
) -> dict:
    try:
        ctx = recovery_lookup.validate(body.model_dump())
    except (recovery_lookup.LookupRejected, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc
    job = _start("recovery_lookup", lambda j: recovery_lookup.run(j, ctx), request, idempotency_key, paid=True)
    return {"job_id": job.id, "context": recovery_lookup.public(ctx)}


class WapsiIn(BaseModel):
    profile: dict[str, Any]
    person: dict[str, Any] = Field(description="whose money to search: name, dob (dd/mm/yyyy)")
    consent: bool = False
    source_ids: list[str] | None = Field(default=None, max_length=10)


@app.post("/api/wapsi/start")
async def wapsi_start(body: WapsiIn, request: Request, idempotency_key: str | None = Header(default=None)) -> dict:
    """Older entry point: runs the qualified automated lookups, one after another, through the same engine."""
    if not body.consent:
        raise HTTPException(400, "The citizen must consent before JAAGRUK searches portals on their behalf")
    if not body.person.get("name"):
        raise HTTPException(400, "name is required")
    try:
        contexts = wapsi.contexts(body.person, body.source_ids)
    except (recovery_lookup.LookupRejected, ValueError) as exc:
        raise HTTPException(400, str(exc)) from exc
    job = _start("wapsi", lambda j: wapsi.run(j, contexts), request, idempotency_key, paid=True)
    return {"job_id": job.id, "tasks": len(contexts)}


@app.get("/api/jobs/{job_id}/events")
def job_events(job_id: str, start: int = 0) -> EventSourceResponse:
    """Read-only: following a job never starts or repeats work."""
    job = jobs.get(job_id)
    if job:
        return sse(job, max(0, start))
    row = jobs.ledger(job_id)
    if not row:
        raise HTTPException(404, "job not found")

    async def gen():
        if row["status"] in ("interrupted", "running"):
            yield {
                "data": json.dumps(
                    {
                        "phase": "interrupted",
                        "outcome": "uncertain",
                        "message": "The server restarted while this was running. Whether the remote step finished is unknown.",
                    }
                )
            }
        yield {"event": "end", "data": json.dumps({"result": None, "status": row["status"]})}

    return EventSourceResponse(gen(), ping=10)


@app.post("/api/jobs/{job_id}/cancel")
async def job_cancel(job_id: str) -> dict:
    try:
        return await jobs.cancel(job_id)
    except KeyError:
        raise HTTPException(404, "job not found") from None


@app.post("/api/name-match")
def match(a: str, b: str, dob_a: str | None = None, dob_b: str | None = None) -> dict:
    return name_match.match_probability(a, b, dob_a=dob_a, dob_b=dob_b)


# ------------------------------------------------------------------ official checker cross-check (agent)
@app.post("/api/checker/{scheme_id}")
async def checker_start(
    scheme_id: str, body: EvalIn, request: Request, idempotency_key: str | None = Header(default=None)
) -> dict:
    try:
        checker.validate(scheme_id, body.profile, body.who)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    job = _start("checker", lambda j: checker.run(j, scheme_id, body.profile, body.who), request, idempotency_key, paid=True)
    return {"job_id": job.id}


# ------------------------------------------------------------------ Change Radar
class RadarIn(BaseModel):
    profile: dict[str, Any] | None = None
    ids: list[str] | None = None
    tracked: list[str] = Field(default_factory=list, max_length=200, description="schemes the family tracks in Explore")


def _interests(profile: dict | None, tracked: list[str] | None = None) -> tuple[set[str], set[str], set[str]]:
    if not profile:
        return set(), set(), set(tracked or [])
    ev = entitlements.evaluate(profile)
    tags = set(ev["tags"])
    exams = {e["id"] for e in ev["exams"]}
    schemes = {m["scheme_id"] for m in ev["matches"]} | set(tracked or [])
    return tags, exams, schemes


@app.post("/api/radar/scan")
async def radar_scan(body: RadarIn) -> dict:
    res = await change_radar.scan(body.ids)
    # the NSP scheme list carries the official last dates for scholarships (shown as observations)
    res["deadlines_refresh"] = await explore_cat.refresh_deadlines()
    tags, exams, schemes = await asyncio.to_thread(_interests, body.profile, body.tracked)
    res["alerts"] = change_radar.alerts_for(tags, exams, schemes)
    res["board"] = change_radar.board(body.ids, (tags, exams, schemes))
    return res


@app.post("/api/radar/alerts")
async def radar_alerts(body: RadarIn) -> dict:
    tags, exams, schemes = await asyncio.to_thread(_interests, body.profile, body.tracked)
    return {
        "alerts": change_radar.alerts_for(tags, exams, schemes),
        "board": change_radar.board(None, (tags, exams, schemes)),
        "deadlines": change_radar.deadlines_for((tags, exams, schemes)),
        "monitors": db.query("SELECT id, source_id, type, created_at FROM monitors"),
    }


@app.post("/api/radar/monitors")
async def radar_monitors(x_reviewer_key: str | None = Header(default=None)) -> dict:
    _reviewer(x_reviewer_key)
    try:
        return await change_radar.register_monitors()
    except TinyFishUnavailable as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/api/radar/monitors/{source_id}/run")
async def radar_monitor_run(source_id: str, x_reviewer_key: str | None = Header(default=None)) -> dict:
    _reviewer(x_reviewer_key)
    return await change_radar.run_monitor_now(source_id)


@app.post("/api/radar/webhook")
async def radar_webhook(request: Request, token: str = "") -> dict:
    if not change_radar.webhook_token_ok(token):
        raise HTTPException(403, "invalid callback token")
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "expected JSON") from None
    if not isinstance(payload, dict):
        raise HTTPException(400, "expected a JSON object")
    return await change_radar.on_webhook(payload)


# ------------------------------------------------------------------ Ask JAAGRUK
class AskIn(BaseModel):
    q: str = Field(max_length=2000)
    lang: str | None = None


@app.post("/api/ask")
async def ask(body: AskIn) -> dict:
    if not body.q.strip():
        raise HTTPException(400, "empty question")
    res = await assistant.answer(body.q[:500], lang=body.lang)
    return {**res, "rules_version": rules_registry.version()}


@app.post("/api/ask/research")
async def ask_research(body: AskIn, request: Request, idempotency_key: str | None = Header(default=None)) -> dict:
    """Starts TinyFish Research once (the question travels in the body, never in a URL); follow it via the job."""
    if not body.q.strip():
        raise HTTPException(400, "empty question")
    q, lang = body.q[:500], body.lang or "en"

    async def work(job: jobs.Job):
        final = None
        async for ev in assistant.research_stream(q, lang):
            if ev.get("type") == "final":
                final = ev
            await job.emit(ev)
        return final

    job = _start("research", work, request, idempotency_key, paid=False)
    return {"job_id": job.id}


# ------------------------------------------------------------------ Explore: the full catalogue
class ExploreIn(BaseModel):
    q: str = ""
    filters: dict[str, list[str]] = Field(default_factory=dict)
    sort: str = "best"
    page: int = 0
    per_page: int = 20
    profile: dict[str, Any] | None = Field(default=None, description="the family; the server decides what matches")
    lang: str = "en"


class CommandIn(BaseModel):
    text: str
    profile: dict[str, Any] | None = None
    lang: str = "en"
    keep_where: list[str] = Field(default_factory=list, description="the family's default 'where' filter")


class IdsIn(BaseModel):
    ids: list[str] = Field(max_length=200)


def _eligible(profile: dict | None) -> list[str]:
    """Qualification badges come only from the server's own evaluation, never from client-supplied IDs."""
    if not profile:
        return []
    ev = entitlements.evaluate(profile)
    return sorted({m["scheme_id"] for m in ev["matches"] if m["decision"]["status"] == "eligible"})


@app.get("/api/explore/stats")
async def explore_stats() -> dict:
    return await asyncio.to_thread(explore_cat.stats)


@app.post("/api/explore/search")
async def explore_search(body: ExploreIn) -> dict:
    def go():
        res = explore_cat.search(
            body.q[:200], body.filters, body.sort, max(0, body.page), min(50, max(1, body.per_page)), _eligible(body.profile), body.lang
        )
        return {**res, "rules_version": rules_registry.version()}

    return await asyncio.to_thread(go)


@app.post("/api/explore/command")
async def explore_command(body: CommandIn) -> dict:
    parsed = explore_cat.parse_command(body.text[:300])
    filters = dict(parsed["filters"])
    if "where" not in filters and body.keep_where:
        filters["where"] = body.keep_where
    if parsed["intent"] == "eligible":
        filters.setdefault("tier", ["proven"])

    def go():
        eligible = _eligible(body.profile)
        res = explore_cat.search(parsed["q"], filters, parsed["sort"], 0, 20, eligible, body.lang)
        if res["total"] == 0 and parsed["q"]:
            # the leftover words matched nothing: keep the filters, drop the words
            res = explore_cat.search("", filters, parsed["sort"], 0, 20, eligible, body.lang)
            parsed["q_dropped"] = parsed["q"]
            parsed["q"] = ""
        return res

    res = await asyncio.to_thread(go)
    return {"parsed": {**parsed, "filters": filters}, **res, "rules_version": rules_registry.version()}


@app.get("/api/explore/scheme/{scheme_id:path}")
async def explore_scheme(scheme_id: str, lang: str = "en") -> dict:
    d = await asyncio.to_thread(explore_cat.detail, scheme_id, lang)
    if not d:
        raise HTTPException(404, "unknown scheme")
    return {**d, "rules_version": rules_registry.version()}


@app.post("/api/explore/live")
async def explore_live(body: CommandIn, request: Request, idempotency_key: str | None = Header(default=None)) -> dict:
    if not body.text.strip():
        raise HTTPException(400, "empty search")
    text = body.text[:300]
    job = _start("explore_live", lambda j: explore_cat.live_search(text, j), request, idempotency_key, paid=True)
    return {"job_id": job.id}


@app.post("/api/explore/recheck")
async def explore_recheck(body: IdsIn, request: Request, idempotency_key: str | None = Header(default=None)) -> dict:
    ids = [i for i in body.ids if i][:8]
    if not ids:
        raise HTTPException(400, "nothing to re-check")
    job = _start("explore_recheck", lambda j: explore_cat.recheck(ids, j), request, idempotency_key, paid=True)
    return {"job_id": job.id}


@app.get("/api/explore/deadlines")
async def explore_deadlines() -> dict:
    return explore_cat.deadlines_info()


@app.post("/api/explore/deadlines/refresh")
async def explore_deadlines_refresh() -> dict:
    return await explore_cat.refresh_deadlines()


@app.post("/api/explore/due")
async def explore_due(body: IdsIn) -> dict:
    return {"due": await asyncio.to_thread(explore_cat.due_for_check, body.ids[:50])}


# ------------------------------------------------------------------ knowledge freshness (Search + Fetch)
@app.get("/api/discover")
async def discover_feed() -> dict:
    return await discover.discover()


@app.post("/api/rules/{scheme_id}/refresh")
async def rule_refresh(scheme_id: str) -> dict:
    res = await discover.refresh_rule(scheme_id)
    return {**res, "rules_version": rules_registry.version()}


# ------------------------------------------------------------------ claims & grievances
class GrievanceIn(BaseModel):
    profile: dict[str, Any]
    department: str
    subject: str
    details: str
    lang: str = "en"


@app.post("/api/grievance/draft")
async def grievance(body: GrievanceIn) -> dict:
    return await claims.grievance_draft(
        body.profile, department=body.department, subject=body.subject, details=body.details, lang=body.lang
    )


# ------------------------------------------------------------------ ops / transparency
@app.get("/api/ops")
async def ops(limit: int = 200) -> dict:
    calls = db.query("SELECT * FROM tf_calls ORDER BY id DESC LIMIT ?", (min(max(limit, 1), 200),))
    # Technical evidence must not expose private session URLs, personal queries or provider errors.
    for call in calls:
        call["streaming_url"] = None
        call["detail"] = None
        call["run_id"] = None
        if not str(call.get("target", "")).startswith("https://"):
            call["target"] = "public lookup query (redacted)"
    by_api = db.query(
        "SELECT api, mode, status, COUNT(*) n, AVG(latency_ms) avg_ms FROM tf_calls GROUP BY api, mode, status ORDER BY api"
    )
    metrics = {}
    p = VAR_DIR / "name_match_metrics.json"
    if p.exists():
        metrics["name_match"] = json.loads(p.read_text())
    metrics["name_match"] = {
        **metrics.get("name_match", {}),
        "exact_match_baseline_recall": name_match.baseline_exact_recall(),
    }
    wallet = await tinyfish.wallet()
    return {
        "calls": calls,
        "summary": by_api,
        "metrics": metrics,
        "wallet": wallet,
        "rules": rules_registry.describe(),
        "adapters": [
            {"id": r["id"], "name": r["name"], "automated": r["automated"], "ready": r["automated_ready"], "qualification": r["qualification"]}
            for r in recovery_cases.routes()
        ],
        "examples": {"name_match": name_match.pairwise_examples()},
    }


@app.middleware("http")
async def private_responses(request: Request, call_next):
    response = await call_next(request)
    if request.url.path.startswith(("/api/", "/helper")):
        response.headers["Cache-Control"] = "no-store"
        response.headers["Referrer-Policy"] = "no-referrer"
        response.headers["X-Robots-Tag"] = "noindex, nofollow"
    return response


# ------------------------------------------------------------------ PWA
if FRONTEND.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        if path.startswith("api/"):
            raise HTTPException(404, "not found")
        f = FRONTEND / path
        if path and f.is_file() and FRONTEND in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(FRONTEND / "index.html")
else:

    @app.get("/", include_in_schema=False)
    def root() -> JSONResponse:
        return JSONResponse(
            {"jaagruk": "API running. Build the frontend (cd frontend && npm run build) or run the dev server on :5173."}
        )
