"""Background jobs with a small durable ledger.

* `start()` begins work once per idempotency key: a duplicate click or a retried request returns the same job.
* Following a job (`stream()`) is read-only — it never starts or repeats paid work.
* Paid work (TinyFish agents and browsers) runs under one account-wide limit and a per-client admission limit.
* `cancel()` stops the job and asks TinyFish to cancel the provider runs it started.
* The ledger keeps only opaque IDs, the job kind, status and timestamps — never names, dates of birth,
  questions or page contents. After a restart, jobs that were still running are reported as interrupted
  (outcome uncertain), because the server cannot know whether the remote step finished.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import time
import uuid
from collections.abc import AsyncIterator, Awaitable, Callable
from typing import Any

from .. import db

_JOBS: dict[str, "Job"] = {}
_IDEM: dict[tuple[str, str, str], str] = {}
PAID_LIMIT = 2  # TinyFish account concurrency
PER_CLIENT_PAID = 2
IDEM_WINDOW_S = 15 * 60
_paid_sem: asyncio.Semaphore | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  client TEXT NOT NULL,
  status TEXT NOT NULL,          -- running | done | cancelled | error | interrupted
  paid INTEGER NOT NULL DEFAULT 0,
  provider_ids TEXT NOT NULL DEFAULT '[]',
  created REAL NOT NULL,
  updated REAL NOT NULL
);
"""


class AdmissionError(RuntimeError):
    """Too much paid work is already running for this client."""


def _ledger_init() -> None:
    with db._lock:
        db.conn().executescript(SCHEMA)
        db.conn().commit()


def client_id(raw: str | None) -> str:
    return hashlib.sha256((raw or "local").encode()).hexdigest()[:16]


_ready = False


def _ledger(job: "Job") -> None:
    global _ready
    if not _ready:
        _ledger_init()
        _ready = True
    db.execute(
        "INSERT OR REPLACE INTO jobs (id, kind, client, status, paid, provider_ids, created, updated) VALUES (?,?,?,?,?,?,?,?)",
        (job.id, job.kind, job.client, job.status, int(job.paid), json.dumps(sorted(job.provider_ids)), job.created, time.time()),
    )


class Job:
    def __init__(self, kind: str, client: str, paid: bool) -> None:
        self.id = uuid.uuid4().hex
        self.kind = kind
        self.client = client
        self.paid = paid
        self.events: list[dict] = []
        self.done = False
        self.status = "running"
        self.result: Any = None
        self.created = time.time()
        self.provider_ids: set[str] = set()
        self.task: asyncio.Task | None = None
        self._cond = asyncio.Condition()

    async def emit(self, ev: dict) -> None:
        async with self._cond:
            self.events.append({**ev, "seq": len(self.events)})
            self._cond.notify_all()

    def add_provider(self, provider_id: str | None) -> None:
        """Remember a TinyFish run/session id so the job can be cancelled or reconciled."""
        if provider_id and provider_id not in self.provider_ids:
            self.provider_ids.add(str(provider_id))
            _ledger(self)

    async def finish(self, result: Any = None, status: str = "done") -> None:
        async with self._cond:
            self.done, self.result, self.status = True, result, status
            self._cond.notify_all()
        _ledger(self)

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


_sem_loop = None


def _sem() -> asyncio.Semaphore:
    """One account-wide limit per event loop (a semaphore cannot be shared across loops)."""
    global _paid_sem, _sem_loop
    loop = asyncio.get_running_loop()
    if _paid_sem is None or _sem_loop is not loop:
        _paid_sem, _sem_loop = asyncio.Semaphore(PAID_LIMIT), loop
    return _paid_sem


def start(
    kind: str,
    fn: Callable[[Job], Awaitable[Any]],
    *,
    client: str = "local",
    idem: str | None = None,
    paid: bool = False,
) -> Job:
    if idem:
        existing = _JOBS.get(_IDEM.get((client, kind, idem), ""))
        if existing and time.time() - existing.created < IDEM_WINDOW_S:
            return existing
    if paid and sum(1 for j in _JOBS.values() if j.paid and not j.done and j.client == client) >= PER_CLIENT_PAID:
        raise AdmissionError("Two searches are already running. Wait for one to finish or cancel it.")
    job = Job(kind, client, paid)
    _JOBS[job.id] = job
    if idem:
        _IDEM[(client, kind, idem)] = job.id
    _ledger(job)

    async def runner() -> None:
        try:
            if paid:
                if _sem().locked():
                    await job.emit({"phase": "waiting", "message": "Waiting for a free TinyFish slot"})
                async with _sem():
                    res = await fn(job)
            else:
                res = await fn(job)
            await job.finish(res)
        except asyncio.CancelledError:
            await job.emit({"phase": "cancelled", "outcome": "cancelled", "message": "Cancelled"})
            await job.finish({"cancelled": True}, status="cancelled")
        except Exception as exc:  # noqa: BLE001 - surface any failure to the UI
            await job.emit({"phase": "error", "message": f"{type(exc).__name__}: {exc}"})
            await job.finish(None, status="error")

    job.task = asyncio.get_running_loop().create_task(runner())
    # keep memory bounded: drop the oldest finished jobs
    if len(_JOBS) > 200:
        for k in sorted((k for k, j in _JOBS.items() if j.done), key=lambda k: _JOBS[k].created)[:50]:
            _JOBS.pop(k, None)
    return job


def get(job_id: str) -> Job | None:
    return _JOBS.get(job_id)


def ledger(job_id: str) -> dict | None:
    rows = db.query("SELECT id, kind, status, created, updated FROM jobs WHERE id = ?", (job_id,))
    return rows[0] if rows else None


async def cancel(job_id: str) -> dict:
    job = _JOBS.get(job_id)
    if not job:
        row = ledger(job_id)
        if not row:
            raise KeyError("job not found")
        return {"status": row["status"]}
    if job.done:
        return {"status": job.status}
    if job.provider_ids:
        from ..tinyfish.client import tinyfish

        try:
            await tinyfish.cancel_runs([p for p in job.provider_ids if not p.startswith("session:")])
        except Exception:  # noqa: BLE001 - the local task is cancelled regardless
            pass
    if job.task:
        job.task.cancel()
    return {"status": "cancelling"}


def on_startup() -> int:
    """Jobs that were running when the server stopped cannot be trusted as finished."""
    global _ready
    _ledger_init()
    _ready = True
    return db.execute(
        "UPDATE jobs SET status = 'interrupted', updated = ? WHERE status = 'running'", (time.time(),)
    )
