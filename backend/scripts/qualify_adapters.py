"""Live qualification of the automated recovery adapters (LIC playbook, Tata AIA agent).

Runs each adapter once against the real portal with the team's fictional test identity and records the outcome,
engine and latency in backend/app/data/adapter_qualification.json. An adapter is offered in the app only if its
latest qualification recognised the portal's own result (a no-record message or a result table). Anything else —
an unreachable site, a CAPTCHA, an unrecognised page — leaves it disabled, and the app shows the official-site
route instead. Re-run before a demo:

    python backend/scripts/qualify_adapters.py
"""

from __future__ import annotations

import asyncio
import json
import sys
import time
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app.services import jobs, recovery_cases, recovery_lookup  # noqa: E402
from app.tinyfish.client import tinyfish  # noqa: E402

TEST_NAME, TEST_DOB = "Jaagrukdemo Testcase", "12/03/1971"  # fictional person used for every live test
OUT = Path(__file__).resolve().parents[1] / "app" / "data" / "adapter_qualification.json"


async def qualify(route: dict) -> dict:
    ctx = {
        "case_id": "qualification",
        "holder_id": "qualification",
        "source_id": route["id"],
        "category": route["asset"],
        "consent_at": "",
        "_name": TEST_NAME,
        "_dob": TEST_DOB,
    }
    job = jobs.Job("qualification", "local", paid=True)
    t0 = time.perf_counter()
    res = await recovery_lookup.run(job, ctx)
    obs = res["observation"]
    return {
        "qualified": obs["outcome"] in ("no_match", "possible_record"),
        "outcome": obs["outcome"],
        "engine": obs["engine"],
        "message": obs["message"][:200],
        "latency_ms": int((time.perf_counter() - t0) * 1000),
        "checked_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
    }


async def main() -> None:
    if not tinyfish.live:
        print("TinyFish is not live (no TINYFISH_API_KEY): nothing qualified.")
        return
    old = json.loads(OUT.read_text(encoding="utf-8")) if OUT.exists() else {}
    for r in recovery_cases.registry()["routes"]:
        if not r.get("automated"):
            continue
        print("qualifying", r["id"], "…", flush=True)
        q = await qualify(r)
        old[r["id"]] = q
        print(" ", json.dumps(q))
    OUT.write_text(json.dumps(old, indent=1), encoding="utf-8")
    print("written", OUT)


if __name__ == "__main__":
    asyncio.run(main())
