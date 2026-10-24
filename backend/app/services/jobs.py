"""In-memory event jobs: a background task appends events; any number of SSE clients can (re)attach."""
from __future__ import annotations

import asyncio
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

_JOBS: dict[str, "Job"] = {}


class Job:
    def __init__(self, kind: str) -> None:
        self.id = uuid.uuid4().hex[:10]
        self.kind = kind
        self.events: list[dict] = []
        self.done = False
        self.result: Any = None
        self.created = time.time()
        self._cond = asyncio.Condition()

    async def emit(self, ev: dict) -> None:
        async with self._cond:
            self.events.append({**ev, "seq": len(self.events)})
            self._cond.notify_all()

    async def finish(self, result: Any = None) -> None:
        async with self._cond:
            self.done, self.result = True, result
            self._cond.notify_all()

    async def stream(self, start: int = 0) -> AsyncIterator[dict]:
        i = start
        while True:
            async with self._cond:
                while i >= len(self.events) and not self.done:
                    try:
                        await asyncio.wait_for(self._cond.wait(), timeout=15)
                    except asyncio.TimeoutError:
                        break
                batch = self.events[i:]
                finished = self.done and i + len(batch) >= len(self.events)
            for ev in batch:
                yield ev
            i += len(batch)
            if not batch and not finished:
                yield {"phase": "heartbeat"}
            if finished:
                return


def start(kind: str, fn: Callable[[Job], Awaitable[Any]]) -> Job:
    job = Job(kind)
    _JOBS[job.id] = job

    async def runner() -> None:
        try:
            res = await fn(job)
            await job.finish(res)
        except Exception as exc:  # noqa: BLE001 - surface any failure to the UI
            await job.emit({"phase": "error", "message": f"{type(exc).__name__}: {exc}"})
            await job.finish(None)

    asyncio.get_running_loop().create_task(runner())
    # keep memory bounded
    if len(_JOBS) > 200:
        for k in sorted(_JOBS, key=lambda k: _JOBS[k].created)[:50]:
            _JOBS.pop(k, None)
    return job


def get(job_id: str) -> Job | None:
    return _JOBS.get(job_id)
