"""SQLite storage: TinyFish call log, page snapshots, alerts, monitors and a small JSON cache."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from typing import Any

from .config import settings

_lock = threading.Lock()
_conn: sqlite3.Connection | None = None

SCHEMA = """
CREATE TABLE IF NOT EXISTS tf_calls (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts REAL NOT NULL,
  api TEXT NOT NULL,            -- search | fetch | agent | batch | browser | monitor | research
  purpose TEXT,
  target TEXT,                  -- url or query
  mode TEXT NOT NULL,           -- live | replay
  status TEXT NOT NULL,         -- ok | failed | blocked | healed
  latency_ms INTEGER,
  run_id TEXT,
  streaming_url TEXT,
  steps INTEGER,
  verdict TEXT,                 -- verifier verdict
  detail TEXT
);
CREATE TABLE IF NOT EXISTS snapshots (
  url TEXT PRIMARY KEY,
  text TEXT NOT NULL,
  sha TEXT NOT NULL,
  fetched_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts REAL NOT NULL,
  source_id TEXT,
  url TEXT,
  kind TEXT,                    -- deadline | eligibility | vacancy | new_notice | cosmetic
  title TEXT,
  summary TEXT,
  affects TEXT,                 -- JSON list of tags this alert is relevant to
  evidence TEXT                 -- JSON
);
CREATE TABLE IF NOT EXISTS monitors (
  id TEXT PRIMARY KEY,
  source_id TEXT,
  type TEXT,
  target TEXT,
  created_at REAL
);
CREATE TABLE IF NOT EXISTS cache (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  ts REAL NOT NULL
);
"""


def conn() -> sqlite3.Connection:
    global _conn
    if _conn is None:
        settings.db_path.parent.mkdir(parents=True, exist_ok=True)
        _conn = sqlite3.connect(settings.db_path, check_same_thread=False)
        _conn.row_factory = sqlite3.Row
        # WAL: readers never block the writer; a busy timeout instead of "database is locked" errors
        _conn.execute("PRAGMA journal_mode=WAL")
        _conn.execute("PRAGMA busy_timeout=5000")
        _conn.executescript(SCHEMA)
    return _conn


def execute(sql: str, params: tuple = ()) -> int:
    with _lock:
        cur = conn().execute(sql, params)
        conn().commit()
        return cur.lastrowid


def query(sql: str, params: tuple = ()) -> list[dict[str, Any]]:
    with _lock:
        return [dict(r) for r in conn().execute(sql, params).fetchall()]


def log_call(
    api: str,
    *,
    purpose: str | None,
    target: str | None,
    mode: str,
    status: str,
    latency_ms: int | None = None,
    run_id: str | None = None,
    streaming_url: str | None = None,
    steps: int | None = None,
    verdict: str | None = None,
    detail: str | None = None,
) -> int:
    return execute(
        "INSERT INTO tf_calls (ts, api, purpose, target, mode, status, latency_ms, run_id, streaming_url, steps, verdict, detail)"
        " VALUES (?,?,?,?,?,?,?,?,?,?,?,?)",
        (
            time.time(),
            api,
            purpose,
            target,
            mode,
            status,
            latency_ms,
            run_id,
            streaming_url,
            steps,
            verdict,
            (detail or "")[:2000],
        ),
    )


def cache_get(key: str, max_age_s: float | None = None) -> Any | None:
    rows = query("SELECT value, ts FROM cache WHERE key = ?", (key,))
    if not rows:
        return None
    if max_age_s is not None and time.time() - rows[0]["ts"] > max_age_s:
        return None
    return json.loads(rows[0]["value"])


def cache_set(key: str, value: Any) -> None:
    execute(
        "INSERT OR REPLACE INTO cache (key, value, ts) VALUES (?,?,?)",
        (key, json.dumps(value), time.time()),
    )
