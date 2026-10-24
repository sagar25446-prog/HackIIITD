"""JAAGRUK API. Serves the PWA too, so the whole product runs with one command (see run.py)."""
from __future__ import annotations

import asyncio
import json
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field
from sse_starlette.sse import EventSourceResponse

from . import db
from .config import DATA_DIR, ROOT, VAR_DIR, settings
from .ml import assistant, eligibility as el, name_match, scam
from .ml import llm
from .services import (assisted, change_radar, checker, claims, discover, entitlements, jobs, scam_shield,
                       wapsi)
from .tinyfish import recorder
from .tinyfish.client import TinyFishUnavailable, tinyfish

FRONTEND = ROOT / "frontend" / "dist"


@asynccontextmanager
async def lifespan(_: FastAPI):
    db.conn()
    recorder.import_captures()
    change_radar.seed_baselines()
    loop = asyncio.get_running_loop()
    reaper = loop.create_task(assisted.reaper())
    # warm the models so the first request is fast
    await asyncio.to_thread(lambda: (scam.model(), name_match.model(), assistant._index()))
    yield
    reaper.cancel()
    await assisted.close_all()


app = FastAPI(title="JAAGRUK API", version="1.0", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


def _json(name: str) -> Any:
    return json.loads((DATA_DIR / name).read_text(encoding="utf-8"))


def sse(job: jobs.Job, start: int = 0) -> EventSourceResponse:
    async def gen():
        async for ev in job.stream(start):
            yield {"data": json.dumps(ev, ensure_ascii=False, default=str)}
        yield {"event": "end", "data": json.dumps({"result": job.result}, ensure_ascii=False, default=str)}

    return EventSourceResponse(gen(), ping=10)


# ------------------------------------------------------------------ meta
@app.get("/api/health")
async def health() -> dict:
    return {"ok": True, "tinyfish": {"mode": settings.tinyfish_mode, "live": settings.live_enabled,
                                     "recordings": len(list(recorder.REC_DIR.glob("*.json")))},
            "llm": {"available": llm.available(), "model": settings.anthropic_model if llm.available() else None},
            "webhook_ready": bool(settings.public_base_url)}


@app.get("/api/personas")
def personas() -> list[dict]:
    return _json("personas.json")


@app.get("/api/onboarding")
def onboarding() -> dict:
    return _json("onboarding.json")


@app.get("/api/catalog")
def catalog() -> dict:
    return {"schemes": el.load_schemes(), "exams": el.load_exams(), "documents": el.load_documents(),
            "life_events": list(entitlements.life_events().values()), "rule_checks": discover.rule_checks(),
            "enums": el.ENUMS, "education_labels": el.EDUCATION_LABELS}


# ------------------------------------------------------------------ entitlements (Haq Meter, matches, unlock path)
class EvalIn(BaseModel):
    profile: dict[str, Any]
    wapsi_found_inr: int = 0
    who: str | None = None  # "self" or a family member's relation


@app.post("/api/evaluate")
async def evaluate(body: EvalIn) -> dict:
    return await asyncio.to_thread(entitlements.evaluate, body.profile, body.wapsi_found_inr)


@app.post("/api/application-pack/{scheme_id}")
def application_pack(scheme_id: str, body: EvalIn) -> dict:
    return claims.application_pack(scheme_id, body.profile, body.who)


# ------------------------------------------------------------------ Wapsi (parallel TinyFish agents)
class WapsiIn(BaseModel):
    profile: dict[str, Any]
    person: dict[str, Any] = Field(description="whose money to search: name, dob (dd/mm/yyyy), optional pan, policy_no")
    consent: bool = False


@app.post("/api/wapsi/start")
async def wapsi_start(body: WapsiIn) -> dict:
    if not body.consent:
        raise HTTPException(400, "The citizen must consent before JAAGRUK searches portals on their behalf")
    if not body.person.get("name"):
        raise HTTPException(400, "name is required")
    plan = wapsi.plan(body.profile, body.person)
    job = wapsi.start(body.profile, body.person)
    return {"job_id": job.id, "tasks": len(plan)}


@app.get("/api/jobs/{job_id}/events")
def job_events(job_id: str, start: int = 0) -> EventSourceResponse:
    job = jobs.get(job_id)
    if not job:
        raise HTTPException(404, "job not found")
    return sse(job, start)


@app.post("/api/name-match")
def match(a: str, b: str, dob_a: str | None = None, dob_b: str | None = None) -> dict:
    return name_match.match_probability(a, b, dob_a=dob_a, dob_b=dob_b)


# ------------------------------------------------------------------ official checker cross-check (agent)
@app.post("/api/checker/{scheme_id}")
async def checker_start(scheme_id: str, body: EvalIn) -> dict:
    try:
        job = checker.start(scheme_id, body.profile, body.who)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc
    return {"job_id": job.id}


# ------------------------------------------------------------------ Scam Shield
class ScamIn(BaseModel):
    text: str
    deep: bool = True
    lang: str = "en"


@app.post("/api/scam/check")
async def scam_check(body: ScamIn) -> dict:
    if not body.text.strip():
        raise HTTPException(400, "paste a message or link")
    res = await scam_shield.check(body.text[:4000], deep=body.deep)
    res["safe_steps"] = scam_shield.safe_steps(res["verdict"], body.lang)
    return res


# ------------------------------------------------------------------ Change Radar
class RadarIn(BaseModel):
    profile: dict[str, Any] | None = None
    ids: list[str] | None = None


def _interests(profile: dict | None) -> tuple[set[str], set[str], set[str]]:
    if not profile:
        return set(), set(), set()
    ev = entitlements.evaluate(profile)
    tags = set(ev["tags"])
    exams = {e["id"] for e in ev["exams"]}
    schemes = {m["scheme_id"] for m in ev["matches"]}
    return tags, exams, schemes


@app.post("/api/radar/scan")
async def radar_scan(body: RadarIn) -> dict:
    res = await change_radar.scan(body.ids)
    tags, exams, schemes = await asyncio.to_thread(_interests, body.profile)
    res["alerts"] = change_radar.alerts_for(tags, exams, schemes)
    res["board"] = change_radar.board(body.ids, (tags, exams, schemes))
    return res


@app.post("/api/radar/alerts")
async def radar_alerts(body: RadarIn) -> dict:
    tags, exams, schemes = await asyncio.to_thread(_interests, body.profile)
    return {"alerts": change_radar.alerts_for(tags, exams, schemes), "board": change_radar.board(None, (tags, exams, schemes)),
            "deadlines": change_radar.deadlines_for((tags, exams, schemes)),
            "monitors": db.query("SELECT * FROM monitors")}


@app.post("/api/radar/monitors")
async def radar_monitors() -> dict:
    try:
        return await change_radar.register_monitors()
    except TinyFishUnavailable as exc:
        return {"ok": False, "error": str(exc)}


@app.post("/api/radar/monitors/{source_id}/run")
async def radar_monitor_run(source_id: str) -> dict:
    return await change_radar.run_monitor_now(source_id)


@app.post("/api/radar/webhook")
async def radar_webhook(request: Request) -> dict:
    try:
        payload = await request.json()
    except json.JSONDecodeError:
        raise HTTPException(400, "expected JSON") from None
    return await change_radar.on_webhook(payload)


# ------------------------------------------------------------------ Ask JAAGRUK
class AskIn(BaseModel):
    q: str
    lang: str | None = None


@app.post("/api/ask")
async def ask(body: AskIn) -> dict:
    if not body.q.strip():
        raise HTTPException(400, "empty question")
    return await assistant.answer(body.q[:500], lang=body.lang)


@app.get("/api/ask/research")
async def ask_research(q: str, lang: str = "en") -> EventSourceResponse:
    async def gen():
        async for ev in assistant.research_stream(q[:500], lang):
            yield {"data": json.dumps(ev, ensure_ascii=False, default=str)}
        yield {"event": "end", "data": "{}"}  # tells the browser to close — EventSource would otherwise reconnect

    return EventSourceResponse(gen(), ping=10)


# ------------------------------------------------------------------ knowledge freshness (Search + Fetch)
@app.get("/api/discover")
async def discover_feed() -> dict:
    return await discover.discover()


@app.post("/api/rules/{scheme_id}/refresh")
async def rule_refresh(scheme_id: str) -> dict:
    return await discover.refresh_rule(scheme_id)


# ------------------------------------------------------------------ claims & grievances
class GrievanceIn(BaseModel):
    profile: dict[str, Any]
    department: str
    subject: str
    details: str
    lang: str = "en"


@app.post("/api/grievance/draft")
async def grievance(body: GrievanceIn) -> dict:
    return await claims.grievance_draft(body.profile, department=body.department, subject=body.subject,
                                        details=body.details, lang=body.lang)


# ------------------------------------------------------------------ assisted session (TinyFish Browser API)
class AssistIn(BaseModel):
    url: str | None = None
    source_id: str | None = None
    purpose: str = "assisted session"


@app.post("/api/assist/start")
async def assist_start(body: AssistIn) -> dict:
    url = body.url
    if body.source_id:
        from .tinyfish.harness import load_sources

        src = next((s for s in load_sources() if s["id"] == body.source_id), None)
        url = src and src["url"]
    if not url or not url.startswith("https://"):
        raise HTTPException(400, "an https URL or a known source_id is required")
    try:
        return await assisted.start(url, body.purpose)
    except TinyFishUnavailable as exc:
        raise HTTPException(503, str(exc)) from exc


class ClickIn(BaseModel):
    x: float
    y: float


class TypeIn(BaseModel):
    text: str = Field(max_length=200)


@app.get("/api/assist/{sid}/frame")
async def assist_frame(sid: str) -> dict:
    return await _assist(assisted.frame(sid))


@app.post("/api/assist/{sid}/click")
async def assist_click(sid: str, body: ClickIn) -> dict:
    return await _assist(assisted.click(sid, body.x, body.y))


@app.post("/api/assist/{sid}/type")
async def assist_type(sid: str, body: TypeIn) -> dict:
    return await _assist(assisted.type_text(sid, body.text))


@app.post("/api/assist/{sid}/key/{key}")
async def assist_key(sid: str, key: str) -> dict:
    return await _assist(assisted.press(sid, key))


@app.post("/api/assist/{sid}/prefill")
async def assist_prefill(sid: str, fields: dict[str, str]) -> dict:
    return await _assist(assisted.prefill(sid, fields))


@app.delete("/api/assist/{sid}")
async def assist_close(sid: str) -> dict:
    return await assisted.close(sid)


async def _assist(coro) -> dict:
    try:
        return await coro
    except KeyError as exc:
        raise HTTPException(404, str(exc)) from exc
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


# ------------------------------------------------------------------ ops / transparency
@app.get("/api/ops")
async def ops(limit: int = 200) -> dict:
    calls = db.query("SELECT * FROM tf_calls ORDER BY id DESC LIMIT ?", (limit,))
    by_api = db.query("SELECT api, mode, status, COUNT(*) n, AVG(latency_ms) avg_ms FROM tf_calls "
                      "GROUP BY api, mode, status ORDER BY api")
    metrics = {}
    for name in ("name_match_metrics.json", "scam_metrics.json"):
        p = VAR_DIR / name
        if p.exists():
            metrics[name.replace("_metrics.json", "")] = json.loads(p.read_text())
    metrics["name_match"] = {**metrics.get("name_match", {}), "exact_match_baseline_recall": name_match.baseline_exact_recall()}
    wallet = await tinyfish.wallet()
    return {"calls": calls, "summary": by_api, "metrics": metrics, "wallet": wallet,
            "examples": {"name_match": name_match.pairwise_examples()}}


# ------------------------------------------------------------------ PWA
if FRONTEND.exists():
    app.mount("/assets", StaticFiles(directory=FRONTEND / "assets"), name="assets")

    @app.get("/{path:path}", include_in_schema=False)
    def spa(path: str):
        f = FRONTEND / path
        if path and f.is_file() and FRONTEND in f.resolve().parents:
            return FileResponse(f)
        return FileResponse(FRONTEND / "index.html")
else:
    @app.get("/", include_in_schema=False)
    def root() -> JSONResponse:
        return JSONResponse({"jaagruk": "API running. Build the frontend (cd frontend && npm run build) "
                                        "or run the dev server on :5173."})
