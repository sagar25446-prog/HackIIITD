"""TinyFish client used by every JAAGRUK feature.

* Search, Fetch, Agent (run / queue / stream), Runs and Wallet go through the official async SDK.
* Batch runs, batch run lookup, Browser sessions, Monitors and Research use the documented REST
  endpoints (the SDK does not cover them yet).
* Every call is written to the `tf_calls` log that powers the ops dashboard.
* Successful live calls are recorded; in replay mode (or when the network fails in auto mode) the
  recorded *real* response is served instead and clearly labelled "replay".
"""

from __future__ import annotations

import asyncio
import json
import time
from collections.abc import AsyncIterator
from typing import Any

import httpx

from .. import db
from ..config import settings
from . import recorder

AGENT_BASE = "https://agent.tinyfish.ai"
BROWSER_BASE = "https://api.browser.tinyfish.ai"


class TinyFishUnavailable(RuntimeError):
    """Raised when a live call is impossible and no recording exists."""


def _dump(obj: Any) -> Any:
    if hasattr(obj, "model_dump"):
        return obj.model_dump(mode="json")
    return obj


class TinyFishClient:
    def __init__(self) -> None:
        self._sdk = None
        self._http: httpx.AsyncClient | None = None
        self._step_cap_ok = True
        self._research_lock = asyncio.Lock()

    # ------------------------------------------------------------------ plumbing
    @property
    def live(self) -> bool:
        return settings.live_enabled

    def _fresh_loop(self) -> bool:
        """HTTP clients are bound to the event loop that created them; rebuild them if the loop changed."""
        loop = asyncio.get_running_loop()
        if loop is not getattr(self, "_loop", None):
            self._loop, self._sdk, self._http = loop, None, None
            return True
        return False

    def _client(self):
        self._fresh_loop()
        if self._sdk is None:
            from tinyfish import AsyncTinyFish

            self._sdk = AsyncTinyFish(
                api_key=settings.tinyfish_api_key, timeout=180.0, max_retries=1
            )
        return self._sdk

    def _rest(self) -> httpx.AsyncClient:
        self._fresh_loop()
        if self._http is None:
            self._http = httpx.AsyncClient(
                headers={
                    "X-API-Key": settings.tinyfish_api_key or "",
                    "Content-Type": "application/json",
                },
                timeout=httpx.Timeout(180.0, connect=20.0),
            )
        return self._http

    async def _call(
        self,
        api: str,
        key_parts: list[Any],
        purpose: str | None,
        target: str | None,
        fn,
        *,
        exact_replay: bool = False,
    ):
        """Run a live call (with logging + recording) or fall back to a recorded real response."""
        key = recorder.key(api, key_parts)
        if self.live:
            t0 = time.perf_counter()
            try:
                result = await fn()
                ms = int((time.perf_counter() - t0) * 1000)
                db.log_call(
                    api, purpose=purpose, target=target, mode="live", status="ok", latency_ms=ms
                )
                recorder.save(key, api, target, result)
                return result
            except Exception as exc:  # noqa: BLE001 - we log and maybe fall back
                ms = int((time.perf_counter() - t0) * 1000)
                db.log_call(
                    api,
                    purpose=purpose,
                    target=target,
                    mode="live",
                    status="failed",
                    latency_ms=ms,
                    detail=f"{type(exc).__name__}: {exc}",
                )
                if settings.tinyfish_mode != "auto":
                    raise
        rec = recorder.load(key)  # exact request only; another request's response is never substituted
        if rec is None:
            raise TinyFishUnavailable(
                f"TinyFish {api} unavailable (no API key / network) and no recorded run for {target!r}"
            )
        db.log_call(
            api,
            purpose=purpose,
            target=target,
            mode="replay",
            status="ok",
            latency_ms=0,
            detail=f"recorded {rec.get('recorded_at', '')}",
        )
        resp = rec["response"]
        if isinstance(resp, dict):  # label replays so the UI can say so
            resp = {**resp, "_replay": True, "_recorded_at": rec.get("recorded_at")}
        return resp

    # ------------------------------------------------------------------ Search API
    async def search(
        self,
        query: str,
        *,
        purpose: str | None = None,
        include_domains: str | None = None,
        exclude_domains: str | None = None,
        recency_minutes: int | None = None,
        domain_type: str | None = None,
        location: str | None = "India",
        language: str | None = None,
        page: int | None = None,
        exact_replay: bool = False,
    ) -> dict:
        async def go():
            r = await self._client().search.query(
                query,
                purpose=purpose,
                include_domains=include_domains,
                exclude_domains=exclude_domains,
                recency_minutes=recency_minutes,
                domain_type=domain_type,
                location=location,
                language=language,
                page=page,
            )
            return _dump(r)

        return await self._call(
            "search",
            [query, include_domains, recency_minutes, domain_type] + ([page] if page else []),
            purpose,
            query,
            go,
            exact_replay=exact_replay,
        )

    # ------------------------------------------------------------------ Fetch API
    async def fetch(
        self,
        urls: list[str],
        *,
        purpose: str | None = None,
        ttl: int | None = None,
        links: bool = False,
        fmt: str = "markdown",
        exact_replay: bool = False,
    ) -> dict:
        urls = urls[:10]  # API limit

        async def go():
            r = await self._client().fetch.get_contents(
                urls, purpose=purpose, ttl=ttl, links=links, format=fmt
            )
            return _dump(r)

        return await self._call(
            "fetch", [sorted(urls), fmt], purpose, ", ".join(urls), go, exact_replay=exact_replay
        )

    # ------------------------------------------------------------------ Agent API
    def _agent_body(
        self,
        url: str,
        goal: str,
        output_schema: dict | None,
        stealth: bool,
        country: str | None,
        step_cap: bool = True,
    ) -> dict:
        # hard caps: a confused agent must never burn the wallet (max_steps is a beta feature on some accounts)
        cfg: dict[str, Any] = {"max_duration_seconds": settings.agent_max_seconds}
        if step_cap:
            cfg["max_steps"] = settings.agent_max_steps
        body: dict[str, Any] = {
            "url": url,
            "goal": goal,
            "browser_profile": "stealth" if stealth else "lite",
            "agent_config": cfg,
        }
        if country:  # Indian government sites often refuse foreign IPs
            body["proxy_config"] = {"enabled": True, "country_code": country}
        if output_schema:
            body["output_schema"] = output_schema
        return body

    @staticmethod
    def _norm_event(raw: dict) -> dict:
        e = {
            "type": str(raw.get("type", "")).split(".")[-1].upper(),
            "run_id": raw.get("runId") or raw.get("run_id"),
            "streaming_url": raw.get("streamingUrl") or raw.get("streaming_url"),
            "purpose": raw.get("purpose"),
            "status": raw.get("status"),
            "error": raw.get("error"),
        }
        res = raw.get("result", raw.get("result_json"))
        if isinstance(res, str):
            try:
                res = json.loads(res)
            except json.JSONDecodeError:
                pass
        e["result"] = res
        return {k: v for k, v in e.items() if v is not None}

    async def _sse_agent(self, body: dict) -> AsyncIterator[dict]:
        async with self._rest().stream(
            "POST",
            f"{AGENT_BASE}/v1/automation/run-sse",
            json=body,
            timeout=httpx.Timeout(settings.agent_max_seconds + 60, connect=20.0),
        ) as resp:
            if resp.status_code >= 400:
                text = (await resp.aread()).decode(errors="replace")[:500]
                raise httpx.HTTPStatusError(
                    f"{resp.status_code}: {text}", request=resp.request, response=resp
                )
            async for line in resp.aiter_lines():
                if line.startswith("data:"):
                    try:
                        yield self._norm_event(json.loads(line[5:].strip()))
                    except json.JSONDecodeError:
                        continue

    async def agent_stream(
        self,
        url: str,
        goal: str,
        *,
        output_schema: dict | None = None,
        stealth: bool = False,
        purpose: str | None = None,
    ) -> AsyncIterator[dict]:
        """POST /v1/automation/run-sse. Yields STARTED, STREAMING_URL, PROGRESS, HEARTBEAT, COMPLETE (dicts)."""
        key = recorder.key("agent_stream", [url, goal, output_schema])
        if self.live:
            events: list[dict] = []
            t0 = time.perf_counter()
            run_id = streaming_url = None
            country, step_cap = settings.proxy_country, self._step_cap_ok
            try:
                for _ in range(3):
                    try:
                        body = self._agent_body(
                            url, goal, output_schema, stealth, country, step_cap
                        )
                        async for e in self._sse_agent(body):
                            run_id = e.get("run_id") or run_id
                            streaming_url = e.get("streaming_url") or streaming_url
                            e["t"] = round(time.perf_counter() - t0, 2)
                            events.append(e)
                            yield e
                        break
                    except httpx.HTTPStatusError as exc:
                        if events:
                            raise
                        if step_cap and "max steps" in str(exc).lower():
                            step_cap = self._step_cap_ok = (
                                False  # account not in the beta: keep the time cap only
                            )
                        elif country:
                            country = None  # proxy country rejected: retry on the default network
                        else:
                            raise
                ms = int((time.perf_counter() - t0) * 1000)
                final = next((x for x in reversed(events) if x["type"] == "COMPLETE"), {})
                db.log_call(
                    "agent",
                    purpose=purpose,
                    target=url,
                    mode="live",
                    status="ok" if final.get("status") == "COMPLETED" else "failed",
                    latency_ms=ms,
                    run_id=run_id,
                    streaming_url=streaming_url,
                    steps=sum(1 for x in events if x["type"] == "PROGRESS"),
                    detail=json.dumps(final.get("error"))[:500] if final.get("error") else None,
                )
                if final.get("status") == "COMPLETED":
                    pass  # Personal portal results are not written to public replay recordings.
                return
            except Exception as exc:  # noqa: BLE001
                db.log_call(
                    "agent",
                    purpose=purpose,
                    target=url,
                    mode="live",
                    status="failed",
                    run_id=run_id,
                    detail=f"{type(exc).__name__}: {exc}",
                )
                if settings.tinyfish_mode != "auto" or events:
                    raise
        rec = recorder.load(key)  # Exact consented request only; never another person’s result.
        if rec is None:
            raise TinyFishUnavailable(f"No API key / network and no recorded agent run for {url}")
        db.log_call(
            "agent",
            purpose=purpose,
            target=url,
            mode="replay",
            status="ok",
            detail=f"recorded {rec.get('recorded_at', '')}",
        )
        prev = 0.0
        for e in rec["response"]:
            gap = max(0.0, min(2.5, float(e.get("t", prev)) - prev))
            prev = float(e.get("t", prev))
            await asyncio.sleep(gap / 2)  # replay at 2x speed
            yield {**e, "replay": True}

    async def run_batch(
        self, runs: list[dict], *, output_schema: dict | None = None, purpose: str | None = None
    ) -> list[str]:
        """POST /v1/automation/run-batch — up to 100 runs, returns run_ids immediately."""
        body: dict[str, Any] = {
            "runs": [
                {
                    "url": r["url"],
                    "goal": r["goal"],
                    "browser_profile": r.get("browser_profile", "lite"),
                    "agent_config": {
                        "max_steps": settings.agent_max_steps,
                        "max_duration_seconds": settings.agent_max_seconds,
                    },
                }
                for r in runs[:100]
            ]
        }
        if output_schema:
            body["output_schema"] = output_schema

        async def go():
            resp = await self._rest().post(f"{AGENT_BASE}/v1/automation/run-batch", json=body)
            resp.raise_for_status()
            data = resp.json()
            if data.get("error"):
                raise RuntimeError(data["error"])
            return data

        data = await self._call(
            "batch",
            [[(r["url"], r["goal"]) for r in runs], output_schema],
            purpose,
            f"{len(runs)} runs",
            go,
        )
        return data.get("run_ids") or []

    async def get_runs(self, run_ids: list[str]) -> list[dict]:
        """POST /v1/runs/batch — status, result and streaming_url for up to 100 runs."""
        if not self.live or not run_ids or run_ids[0].startswith("replay-"):
            return []
        resp = await self._rest().post(
            f"{AGENT_BASE}/v1/runs/batch", json={"run_ids": run_ids[:100]}
        )
        resp.raise_for_status()
        return resp.json().get("data") or []

    async def cancel_runs(self, run_ids: list[str]) -> None:
        if self.live and run_ids:
            await self._rest().post(
                f"{AGENT_BASE}/v1/runs/batch/cancel", json={"run_ids": run_ids[:100]}
            )

    # ------------------------------------------------------------------ Browser API
    async def browser_create(
        self, url: str, *, timeout_seconds: int = 900, purpose: str | None = None
    ) -> dict:
        if not self.live:
            raise TinyFishUnavailable("Browser sessions need a live TinyFish API key")
        t0 = time.perf_counter()
        body: dict[str, Any] = {"url": url, "timeout_seconds": timeout_seconds}
        if settings.proxy_country:
            body["proxy_config"] = {
                "enabled": True,
                "type": "tinyfish",
                "country_code": settings.proxy_country,
            }
        resp = await self._rest().post(BROWSER_BASE, json=body)
        ok = resp.status_code < 400
        db.log_call(
            "browser",
            purpose=purpose,
            target=url,
            mode="live",
            status="ok" if ok else "failed",
            latency_ms=int((time.perf_counter() - t0) * 1000),
            detail=None if ok else resp.text[:500],
        )
        resp.raise_for_status()
        return resp.json()

    async def browser_close(self, session_id: str) -> None:
        if self.live:
            await self._rest().delete(f"{BROWSER_BASE}/{session_id}")

    # ------------------------------------------------------------------ Monitor API
    async def monitor_create(
        self,
        *,
        mtype: str,
        config: dict,
        schedule_cron: str,
        name: str,
        purpose: str,
        webhook_url: str | None = None,
    ) -> dict:
        body = {
            "type": mtype,
            "config": config,
            "schedule_cron": schedule_cron,
            "name": name[:100],
            "purpose": purpose[:2000],
        }
        if webhook_url:
            body["webhook_url"] = webhook_url

        async def go():
            resp = await self._rest().post(f"{AGENT_BASE}/v1/monitors", json=body)
            resp.raise_for_status()
            return resp.json()

        return await self._call(
            "monitor", [mtype, config], purpose, config.get("url") or config.get("query"), go
        )

    async def monitor_run_now(self, monitor_id: str) -> dict:
        async def go():
            resp = await self._rest().post(f"{AGENT_BASE}/v1/monitors/{monitor_id}/runs")
            resp.raise_for_status()
            return resp.json()

        return await self._call("monitor", ["run", monitor_id], "run monitor now", monitor_id, go)

    async def monitor_list(self) -> list[dict]:
        if not self.live:
            return []
        resp = await self._rest().get(f"{AGENT_BASE}/v1/monitors")
        resp.raise_for_status()
        return resp.json().get("monitors", [])

    async def monitor_delete(self, monitor_id: str) -> None:
        if self.live:
            await self._rest().delete(f"{AGENT_BASE}/v1/monitors/{monitor_id}")

    # ------------------------------------------------------------------ Research API
    async def research(
        self,
        query: str,
        *,
        output_language: str = "en",
        include_domains: list[str] | None = None,
        mode: str = "deep",
    ) -> AsyncIterator[dict]:
        """POST /v1/automation/run-research (SSE). Events: created, plan_updated, synthesis_delta,
        final_result {result, citations}, done. Free per TinyFish wallet rates."""
        key = recorder.key("research", [query, output_language, include_domains])
        fresh = recorder.load(key)
        if fresh and recorder.age_hours(fresh) < 6:
            # the same question was researched in the last few hours: reuse that real run instead of re-running
            db.log_call(
                "research",
                purpose="Ask JAAGRUK (reused recent run)",
                target=query,
                mode="replay",
                status="ok",
                detail=f"recorded {fresh.get('recorded_at', '')}",
            )
            for e in fresh["response"]:
                await asyncio.sleep(
                    0.004
                    if e.get("event") == "synthesis_delta"
                    else 0.0
                    if e.get("event") == "heartbeat"
                    else 0.3
                )
                yield {**e, "replay": True}
            return
        limit_note = ""
        if self.live and self._research_lock.locked():
            yield {
                "event": "notice",
                "message": "Another research is running; waiting for it to finish",
            }
        if self.live:
            async with self._research_lock:  # one research at a time: avoids TinyFish 429s
                body: dict[str, Any] = {
                    "query": query,
                    "mode": mode,
                    "stream": True,
                    "output_language": output_language,
                }
                if include_domains:
                    # "include" prioritises official domains without hiding everything else
                    body["domain_filter"] = {"mode": "include", "domains": include_domains[:150]}
                events: list[dict] = []
                t0 = time.perf_counter()
                try:
                    async with self._rest().stream(
                        "POST",
                        f"{AGENT_BASE}/v1/automation/run-research",
                        json=body,
                        timeout=httpx.Timeout(300.0, connect=20.0),
                    ) as resp:
                        if resp.status_code == 429:
                            # Research has a small daily quota per account (5/day on 19 Oct 2026)
                            info = json.loads((await resp.aread()).decode() or "{}").get(
                                "error", {}
                            )
                            reset = (info.get("details") or {}).get("resets_at", "")
                            limit_note = (
                                f"TinyFish Research daily limit reached ({(info.get('details') or {}).get('limit', '?')}"
                                f"/day); it resets at {reset[11:16]} UTC."
                            )
                            raise RuntimeError(limit_note)
                        resp.raise_for_status()
                        async for line in resp.aiter_lines():
                            if not line.startswith("data:"):
                                continue
                            try:
                                ev = json.loads(line[5:].strip())
                            except json.JSONDecodeError:
                                continue
                            ev["t"] = round(time.perf_counter() - t0, 2)
                            events.append(ev)
                            yield ev
                    db.log_call(
                        "research",
                        purpose="Ask JAAGRUK",
                        target=query,
                        mode="live",
                        status="ok",
                        latency_ms=int((time.perf_counter() - t0) * 1000),
                    )
                    recorder.save(key, "research", query, events)
                    return
                except Exception as exc:  # noqa: BLE001
                    if "daily limit" in str(exc):
                        limit_note = str(exc)
                    db.log_call(
                        "research",
                        purpose="Ask JAAGRUK",
                        target=query,
                        mode="live",
                        status="failed",
                        detail=f"{type(exc).__name__}: {exc}",
                    )
                    if events:  # failed mid-run: say so, never silently restart
                        yield {
                            "event": "run_status",
                            "status": "FAILED",
                            "message": f"{type(exc).__name__}",
                        }
                        return
                    if settings.tinyfish_mode != "auto":
                        raise
        rec = recorder.load(key)  # exact question only: a different question's report is never the answer
        if rec is None:
            why = limit_note or "TinyFish Research is not reachable right now."
            related = recorder.load_closest("research", query)
            if related:
                yield {
                    "event": "related",
                    "title": related.get("target"),
                    "recorded_at": related.get("recorded_at"),
                }
            raise TinyFishUnavailable(
                f"{why} The answer above from JAAGRUK's reviewed rules still applies."
            )
        db.log_call(
            "research",
            purpose="Ask JAAGRUK",
            target=query,
            mode="replay",
            status="ok",
            detail=f"exact recording: {rec.get('recorded_at')}",
        )
        for e in rec["response"]:
            # replay the research trail at a watchable pace; the answer text streams quickly
            await asyncio.sleep(
                0.004
                if e.get("event") == "synthesis_delta"
                else 0.0
                if e.get("event") == "heartbeat"
                else 0.3
            )
            yield {**e, "replay": True}

    # ------------------------------------------------------------------ Wallet
    async def wallet(self) -> dict | None:
        if not self.live:
            return None
        try:
            return _dump(await self._client().wallet.get())
        except Exception:  # noqa: BLE001
            return None


tinyfish = TinyFishClient()
