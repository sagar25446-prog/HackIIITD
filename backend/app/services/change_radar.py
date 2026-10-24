"""Change Radar: watch official notice pages and tell each citizen only what affects them.

* Scan now: TinyFish Fetch (free, ttl=0 for a fresh read) reads every watched page in ONE call
  (up to 10 URLs) → diff against the stored snapshot → classify → personalised alerts.
* Always-on: one TinyFish Monitor per page (cron, $0.005 per check) posts to our webhook; the webhook
  re-reads the page with Fetch and runs the same diff. A search monitor watches for new
  "fake scheme" fact-checks and feeds Scam Shield.
* Baselines: the first snapshot of each page ships with the app (a real TinyFish Fetch capture with its
  date), so the first live scan shows what genuinely changed since then.
"""
from __future__ import annotations

import hashlib
import json
import time
from typing import Any

from .. import db
from ..config import DATA_DIR, settings
from ..ml import change
from ..tinyfish import harness
from ..tinyfish.client import TinyFishUnavailable, tinyfish

START_AFTER = {"upsc_whats_new": "What's New\nWhat's New"}
SCHEDULE = "CRON_TZ=Asia/Kolkata 0 7,13,19 * * *"  # 3 checks a day per page
ACTIONABLE = {"deadline", "new_notification", "eligibility", "admit_card"}  # things a family must act on
FAKE_SCHEME_QUERY = "PIB Fact Check fake government scheme yojana website"


def sources() -> list[dict]:
    return [s for s in harness.load_sources() if s.get("kind") == "notices"]


def _sha(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()


def seed_baselines() -> int:
    """Load the shipped, dated TinyFish captures as first snapshots (only for pages never seen)."""
    n = 0
    for p in sorted((DATA_DIR / "captures").glob("fetch_notices_*.json")):
        cap = json.loads(p.read_text(encoding="utf-8"))
        ts = time.mktime(time.strptime(cap["captured_at"], "%Y-%m-%d %H:%M"))
        for r in cap["response"]["results"]:
            if not db.query("SELECT 1 FROM snapshots WHERE url = ?", (r["url"],)):
                db.execute("INSERT INTO snapshots (url, text, sha, fetched_at) VALUES (?,?,?,?)",
                           (r["url"], r["text"], _sha(r["text"]), ts))
                n += 1
    return n


def ingest(src: dict, text: str, via: str, *, replay: bool = False) -> dict:
    """Diff fresh page text against the last snapshot, store alerts, update the snapshot."""
    prev = db.query("SELECT text, fetched_at FROM snapshots WHERE url = ?", (src["url"],))
    old = prev[0]["text"] if prev else None
    since = prev[0]["fetched_at"] if prev else None
    changes = change.diff(old, text, START_AFTER.get(src["id"])) if old is not None else []
    new_alerts = []
    for c in changes:
        affects = sorted(set(src.get("tags", [])) | set(c["exam_ids"]) | set(c["scheme_ids"]))
        title = c["text"][:160]
        if db.query("SELECT 1 FROM alerts WHERE source_id = ? AND title = ?", (src["id"], title)):
            continue
        aid = db.execute(
            "INSERT INTO alerts (ts, source_id, url, kind, title, summary, affects, evidence) VALUES (?,?,?,?,?,?,?,?)",
            (time.time(), src["id"], src["url"], c["kind"], title, c["text"], json.dumps(affects),
             json.dumps({"via": via, "replay": replay, "posted": c["posted"], "dates": c["dates_in_text"],
                         "importance": c["importance"], "exam_ids": c["exam_ids"], "scheme_ids": c["scheme_ids"],
                         "since": since})))
        new_alerts.append({"id": aid, **c, "source_id": src["id"]})
    if not replay:  # a replayed recording is not a new observation of the page
        db.execute("INSERT OR REPLACE INTO snapshots (url, text, sha, fetched_at) VALUES (?,?,?,?)",
                   (src["url"], text, _sha(text), time.time()))
    return {"source_id": src["id"], "name": src["name"], "url": src["url"], "baseline": old is None,
            "changed": bool(old is not None and _sha(old) != _sha(text)), "new_alerts": new_alerts,
            "previous_snapshot_at": since, "via": via, "replay": replay}


async def scan(ids: list[str] | None = None) -> dict:
    srcs = [s for s in sources() if not ids or s["id"] in ids]
    seed_baselines()
    try:
        res = await tinyfish.fetch([s["url"] for s in srcs], purpose="Change Radar: detect new notices, "
                                   "deadline extensions and eligibility changes on official pages", ttl=0)
    except TinyFishUnavailable as exc:
        return {"ok": False, "error": str(exc), "pages": []}
    replay = bool(res.get("_replay"))
    by_url = {r["url"].rstrip("/"): r for r in res.get("results", [])}
    pages = []
    for s in srcs:
        r = by_url.get(s["url"].rstrip("/"))
        if not r or not r.get("text"):
            err = next((e.get("error") for e in res.get("errors", []) if e.get("url", "").rstrip("/") == s["url"].rstrip("/")), "no text")
            pages.append({"source_id": s["id"], "name": s["name"], "url": s["url"], "error": err})
            continue
        pages.append(ingest(s, r["text"], "fetch", replay=replay))
    return {"ok": True, "replay": replay, "recorded_at": res.get("_recorded_at"), "pages": pages,
            "new_alerts": sum(len(p.get("new_alerts", [])) for p in pages)}


def board(ids: list[str] | None = None, interests: tuple[set[str], set[str], set[str]] | None = None) -> list[dict]:
    """What is on each watched board right now (latest snapshot), important items only.

    With the family's interests (tags, eligible exams, matched schemes), items about *their* exams or schemes are
    flagged for_you — e.g. "CSSS renewal closes 31-10-2026" for a daughter who qualifies for CSSS.
    """
    seed_baselines()
    tags, exams, schemes = interests or (set(), set(), set())
    out = []
    for s in sources():
        if ids and s["id"] not in ids:
            continue
        snap = db.query("SELECT text, fetched_at FROM snapshots WHERE url = ?", (s["url"],))
        if not snap:
            continue
        items = change.important_items(snap[0]["text"], START_AFTER.get(s["id"]))[:12]
        for it in items:
            it["specific"] = sorted((set(it["exam_ids"]) & exams) | (set(it["scheme_ids"]) & schemes))
            it["for_you"] = bool(it["specific"]) and it["kind"] in ACTIONABLE
        items.sort(key=lambda i: (not i["for_you"], -i["importance"]))
        out.append({"source_id": s["id"], "name": s["name"], "url": s["url"], "snapshot_at": snap[0]["fetched_at"],
                    "items": items})
    return out


def deadlines_for(interests: tuple[set[str], set[str], set[str]]) -> list[dict]:
    """Board items about the family's own schemes/exams, with dates — shown on the home screen."""
    out = []
    for b in board(None, interests):
        for it in b["items"]:
            if it["for_you"] and it["kind"] in ACTIONABLE:
                out.append({**it, "source": b["name"], "url": b["url"], "snapshot_at": b["snapshot_at"]})
    return out


def alerts_for(tags: set[str], exam_ids: set[str], scheme_ids: set[str], limit: int = 30) -> list[dict]:
    rows = db.query("SELECT * FROM alerts ORDER BY ts DESC LIMIT 300")
    out = []
    for r in rows:
        ev = json.loads(r["evidence"] or "{}")
        affects = set(json.loads(r["affects"] or "[]"))
        specific = (set(ev.get("exam_ids", [])) & exam_ids) | (set(ev.get("scheme_ids", [])) & scheme_ids)
        for_you = bool(specific) or bool(affects & tags)
        out.append({**{k: r[k] for k in ("id", "ts", "source_id", "url", "kind", "title", "summary")},
                    "evidence": ev, "for_you": for_you, "specific": sorted(specific),
                    "score": ev.get("importance", 1) * (3 if specific else 2 if for_you else 1)})
    out.sort(key=lambda a: (-a["score"], -a["ts"]))
    return out[:limit]


# ------------------------------------------------------------------ always-on monitors
async def register_monitors() -> dict:
    """Create one TinyFish fetch-monitor per watched page plus a fake-scheme search monitor."""
    # with a public URL TinyFish pushes every scheduled check to our webhook; without one, "Run now" pulls results
    hook = settings.public_base_url.rstrip("/") + "/api/radar/webhook" if settings.public_base_url else None
    made = []
    existing = {r["source_id"] for r in db.query("SELECT source_id FROM monitors")}
    for s in sources():
        if s["id"] in existing:
            continue
        m = await tinyfish.monitor_create(mtype="fetch", config={"url": s["url"], "format": "markdown"},
                                          schedule_cron=SCHEDULE, name=f"JAAGRUK · {s['name']}",
                                          purpose=s.get("purpose", "important notice changes"), webhook_url=hook)
        mid = _monitor_id(m)
        db.execute("INSERT OR REPLACE INTO monitors (id, source_id, type, target, created_at) VALUES (?,?,?,?,?)",
                   (mid, s["id"], "fetch", s["url"], time.time()))
        text = _find_text(m)  # creation returns the baseline check: diff it right away
        made.append({"source_id": s["id"], "monitor_id": mid,
                     "baseline": ingest(s, text, "monitor")["changed"] if text else None})
    if "scam_feed" not in existing:
        m = await tinyfish.monitor_create(mtype="search", config={"query": FAKE_SCHEME_QUERY, "recency_minutes": 1440},
                                          schedule_cron="CRON_TZ=Asia/Kolkata 0 8 * * *",
                                          name="JAAGRUK · fake scheme fact-checks",
                                          purpose="PIB Fact Check flags a new fake government scheme or website",
                                          webhook_url=hook)
        mid = _monitor_id(m)
        db.execute("INSERT OR REPLACE INTO monitors (id, source_id, type, target, created_at) VALUES (?,?,?,?,?)",
                   (mid, "scam_feed", "search", FAKE_SCHEME_QUERY, time.time()))
        made.append({"source_id": "scam_feed", "monitor_id": mid})
    checks_per_day = 3 * len(sources()) + 1
    return {"ok": True, "created": made, "cost_per_day_usd": round(checks_per_day * 0.005, 3), "webhook": hook}


def _monitor_id(m: dict) -> str | None:
    return m.get("id") or m.get("monitor_id") or (m.get("monitor") or {}).get("id")


def _find_text(payload: Any) -> str | None:
    """Pull page text out of a monitor result without assuming its exact shape."""
    if isinstance(payload, dict):
        for k in ("text", "content", "markdown"):
            if isinstance(payload.get(k), str) and len(payload[k]) > 50:
                return payload[k]
        for v in payload.values():
            t = _find_text(v)
            if t:
                return t
    elif isinstance(payload, list):
        for v in payload:
            t = _find_text(v)
            if t:
                return t
    return None


async def on_webhook(payload: dict) -> dict:
    mid = payload.get("monitor_id") or (payload.get("monitor") or {}).get("id") or payload.get("id")
    row = db.query("SELECT source_id FROM monitors WHERE id = ?", (mid,)) if mid else []
    db.log_call("monitor", purpose="webhook received", target=str(mid), mode="live", status="ok",
                detail=json.dumps(payload)[:1500])
    if not row:
        return {"ok": False, "error": "unknown monitor"}
    sid = row[0]["source_id"]
    if sid == "scam_feed":
        return {"ok": True, "scam_feed": True}
    src = next(s for s in sources() if s["id"] == sid)
    text = _find_text(payload)
    if not text:  # payload had no page text: read the page ourselves (free)
        res = await tinyfish.fetch([src["url"]], purpose="Change Radar: monitor fired, re-read page", ttl=0)
        text = (res.get("results") or [{}])[0].get("text") or ""
    return {"ok": True, **ingest(src, text, "monitor")}


async def run_monitor_now(source_id: str) -> dict:
    row = db.query("SELECT id FROM monitors WHERE source_id = ?", (source_id,))
    if not row:
        return {"ok": False, "error": "no monitor registered for this page"}
    res = await tinyfish.monitor_run_now(row[0]["id"])
    src = next(s for s in sources() if s["id"] == source_id)
    text = _find_text(res)
    return {"ok": True, **ingest(src, text, "monitor")} if text else {"ok": True, "raw": res}
