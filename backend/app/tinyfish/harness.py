"""Agent harness: planner -> TinyFish agents -> verifier -> self-heal (used by the official-checker second opinion).

Recovery lookups use services/recovery_lookup.py, which reads results strictly per portal.

Every task emits events onto a queue that the API streams to the browser (the "live agent grid").
"""

from __future__ import annotations

import asyncio
import json
import re
import uuid
from dataclasses import dataclass, field
from typing import Any
from urllib.parse import urlparse

from ..config import DATA_DIR, settings
from . import recorder  # noqa: F401 - recordings are used through the client
from .client import TinyFishUnavailable, tinyfish

OFFICIAL_SUFFIXES = (".gov.in", ".nic.in")
OFFICIAL_DOMAINS = (
    "rbi.org.in",
    "licindia.in",
    "mfcentral.com",
    "npscra.nsdl.co.in",
    "pfrda.org.in",
    "nsiindia.gov.in",
    "indiapost.gov.in",
    "standupmitra.in",
    "mudra.org.in",
    # insurers' own unclaimed-amount portals (IRDAI requires each insurer to host one)
    "tataaia.com",
    "sbilife.co.in",
    "irdai.gov.in",
)
BLOCK_SIGNALS = re.compile(
    r"captcha|access denied|verify (that )?you are (a )?human|are you a robot|blocked|forbidden|403|"
    r"too many requests|login required|sign in to continue|cloudflare|request rejected",
    re.I,
)
# the portal itself failed (seen live on the myScheme checker: "We're Sorry! Something went wrong")
SITE_ERROR = re.compile(
    r"something went wrong|please try again|service unavailable|internal server error|"
    r"page not found|under maintenance",
    re.I,
)


def load_sources() -> list[dict]:
    return json.loads((DATA_DIR / "sources.json").read_text(encoding="utf-8"))


def is_official(url: str | None) -> bool:
    if not url:
        return False
    host = (urlparse(url).hostname or "").lower()
    if host.endswith(OFFICIAL_SUFFIXES):
        return True
    return any(host == d or host.endswith("." + d) for d in OFFICIAL_DOMAINS)


class _Blank(dict):
    """format_map helper: unknown placeholders render as 'not provided' instead of raising."""

    def __missing__(self, key: str) -> str:
        return "" if key.endswith("_clause") else "not provided"


@dataclass
class Task:
    source: dict
    goal: str
    url: str
    output_schema: dict | None = None
    context: dict[str, Any] = field(default_factory=dict)
    id: str = field(default_factory=lambda: uuid.uuid4().hex[:8])
    attempts: int = 0


# ---------------------------------------------------------------------------- planner
def plan(
    kind: str, tags: set[str], context: dict[str, Any] | None = None, limit: int = 12
) -> list[Task]:
    """Pick the sources relevant to this task kind and persona, and render their goals."""
    context = context or {}
    tasks: list[Task] = []
    for src in load_sources():
        if src.get("kind") != kind:
            continue
        src_tags = set(src.get("tags", []))
        if src_tags and tags and not (src_tags & tags) and "all" not in src_tags:
            continue
        values = _Blank({k: v for k, v in context.items() if v not in (None, "")})
        goal = src.get("goal", "").format_map(values)
        url = src["url"].format_map(values)
        tasks.append(
            Task(
                source=src,
                goal=goal,
                url=url,
                output_schema=src.get("output_schema"),
                context=dict(values),
            )
        )
    return tasks[:limit]


# ---------------------------------------------------------------------------- verifier
def verify(task: Task, status: str | None, result: Any, error: Any) -> tuple[str, str]:
    """Return (verdict, reason). COMPLETED means the agent ran — not that it succeeded."""
    if status != "COMPLETED":
        msg = (error or {}).get("message") if isinstance(error, dict) else str(error or "")
        return ("blocked" if msg and BLOCK_SIGNALS.search(msg) else "failed"), (
            msg or f"run ended {status}"
        )
    if result in (None, {}, [], ""):
        return "failed", "agent completed but returned no data"
    if (
        isinstance(result, dict)
        and SITE_ERROR.search(json.dumps(result))
        and not result.get("found")
    ):
        return "failed", "the official portal itself returned an error — try again later"
    if (
        isinstance(result, dict)
        and not result.get("found")
        and BLOCK_SIGNALS.search(json.dumps(result))
    ):
        # seen live: an agent hit a CAPTCHA, tried to get past it, then reported found=false
        return (
            "blocked",
            "the portal asked for a CAPTCHA / OTP / login — a person has to complete it",
        )
    text = json.dumps(result, ensure_ascii=False) if not isinstance(result, str) else result
    if BLOCK_SIGNALS.search(text) and len(text) < 600:
        return "blocked", "page showed a CAPTCHA / bot wall / login wall"
    schema = task.output_schema or {}
    if isinstance(result, dict):
        # A field that exists but is blank is as bad as a missing one (seen in real runs: COMPLETED with "" values)
        empty = [k for k in schema.get("required", []) if result.get(k) in (None, "", [], {})]
        if empty and len(empty) == len(schema.get("required", [])):
            return (
                "failed",
                f"agent completed but every required field is empty ({', '.join(empty)})",
            )
        if empty:
            return "suspicious", f"result has empty required fields: {', '.join(empty)}"
    bad_links = [u for u in re.findall(r"https?://[^\s\"']+", text) if not is_official(u)]
    if bad_links and task.source.get("kind") != "factcheck":
        return (
            "suspicious",
            f"result links to non-official domain {urlparse(bad_links[0]).hostname}",
        )
    return "verified", "status COMPLETED, schema satisfied, only official links"


def _sanitize(result: Any) -> Any:
    """Agents sometimes echo the searched name back as holder_name even when nothing was found."""
    if isinstance(result, dict) and not result.get("found") and result.get("holder_name"):
        result = {k: v for k, v in result.items() if k != "holder_name"}
    return result


def heal_goal(task: Task, reason: str) -> str:
    hints = task.source.get("heal_hints") or [
        "If the page layout looks different from expected, use the site's search box or menu to find the section.",
        "Close any pop-up or language-selection dialog first.",
    ]
    return f"{task.goal}\n\nPrevious attempt failed ({reason[:160]}). Recovery hints: " + " ".join(
        hints
    )


# ---------------------------------------------------------------------------- executor
async def run_task(task: Task, emit) -> dict:
    """Run one task with up to 2 self-heal retries. Emits grid events; returns the final task record."""
    src = task.source
    base = {
        "task_id": task.id,
        "source_id": src["id"],
        "name": src["name"],
        "domain": urlparse(task.url).hostname,
        "kind": src.get("kind"),
    }
    await emit({**base, "phase": "queued"})
    if src.get("requires_human"):
        await emit(
            {
                **base,
                "phase": "needs_human",
                "message": src.get(
                    "human_note", "Login with your own OTP needed — open assisted session"
                ),
            }
        )
        return {**base, "verdict": "needs_human", "result": None}

    goal, stealth = task.goal, False
    for attempt in range(1, 4):
        task.attempts = attempt
        status = result = error = None
        streaming_url = None
        replay = False
        try:
            async for ev in tinyfish.agent_stream(
                task.url,
                goal,
                output_schema=task.output_schema,
                stealth=stealth,
                purpose=f"{src.get('kind')}: {src['name']}",
            ):
                replay = replay or bool(ev.get("replay"))
                t = ev.get("type")
                if t == "STREAMING_URL":
                    streaming_url = ev.get("streaming_url")
                    await emit(
                        {
                            **base,
                            "phase": "streaming",
                            "streaming_url": streaming_url,
                            "replay": replay,
                        }
                    )
                elif t == "PROGRESS":
                    await emit(
                        {
                            **base,
                            "phase": "progress",
                            "message": ev.get("purpose"),
                            "replay": replay,
                        }
                    )
                elif t == "STARTED":
                    await emit(
                        {
                            **base,
                            "phase": "started",
                            "run_id": ev.get("run_id"),
                            "replay": replay,
                            "attempt": attempt,
                        }
                    )
                elif t == "COMPLETE":
                    status, result, error = ev.get("status"), ev.get("result"), ev.get("error")
        except TinyFishUnavailable as exc:
            await emit({**base, "phase": "failed", "message": str(exc)})
            return {**base, "verdict": "unavailable", "result": None}
        except Exception as exc:  # noqa: BLE001
            status, error = "FAILED", {"message": f"{type(exc).__name__}: {exc}"}

        if isinstance(result, str):
            try:
                result = json.loads(result)
            except json.JSONDecodeError:
                pass
        result = _sanitize(result)
        await emit({**base, "phase": "verifying"})
        verdict, reason = verify(task, status, result, error)
        if verdict in ("verified", "suspicious"):
            await emit(
                {
                    **base,
                    "phase": "done",
                    "verdict": verdict,
                    "reason": reason,
                    "result": result,
                    "streaming_url": streaming_url,
                    "replay": replay,
                    "attempts": attempt,
                }
            )
            return {
                **base,
                "verdict": verdict,
                "reason": reason,
                "result": result,
                "attempts": attempt,
            }
        if attempt == 3:
            break
        # self-heal
        human_check = re.search(r"captcha|otp|login|sign in", reason, re.I)
        if verdict == "blocked" and human_check:
            await emit(
                {
                    **base,
                    "phase": "needs_human",
                    "message": "The portal asks for a CAPTCHA/OTP/login. JAAGRUK never solves these — open the "
                    "assisted session and complete it yourself.",
                }
            )
            return {**base, "verdict": "needs_human", "reason": reason, "result": None}
        if verdict == "blocked" and settings.allow_stealth_retry and not stealth:
            stealth = True
            await emit(
                {
                    **base,
                    "phase": "healing",
                    "message": "Bot wall detected — retrying with stealth browser",
                }
            )
        elif verdict == "blocked":
            await emit(
                {
                    **base,
                    "phase": "needs_human",
                    "message": "Site needs a human check (CAPTCHA/OTP). Open an assisted session.",
                }
            )
            return {**base, "verdict": "needs_human", "reason": reason, "result": None}
        else:
            fallback = (
                (src.get("fallback_urls") or [None])[attempt - 1]
                if src.get("fallback_urls")
                else None
            )
            if fallback:
                task.url = fallback
            goal = heal_goal(task, reason)
            await emit(
                {
                    **base,
                    "phase": "healing",
                    "message": f"Re-planning from the goal ({reason[:80]})",
                }
            )
    await emit({**base, "phase": "failed", "message": reason})
    return {**base, "verdict": "failed", "reason": reason, "result": None}


async def run_plan(tasks: list[Task], queue: asyncio.Queue, concurrency: int = 6) -> list[dict]:
    sem = asyncio.Semaphore(concurrency)

    async def emit(ev: dict) -> None:
        await queue.put(ev)

    async def one(t: Task) -> dict:
        async with sem:
            return await run_task(t, emit)

    results = await asyncio.gather(*(one(t) for t in tasks))
    await queue.put(
        {
            "phase": "all_done",
            "summary": {
                "total": len(results),
                "verified": sum(r["verdict"] == "verified" for r in results),
                "needs_human": sum(r["verdict"] == "needs_human" for r in results),
                "failed": sum(r["verdict"] in ("failed", "unavailable") for r in results),
            },
        }
    )
    return results
