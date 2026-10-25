"""One reviewed rule registry for every decision.

My plan (Z3 evaluation), case planning, Discover details, Ask and the official checker all read rules from
here, so they always agree on one version. The curated scheme rules (data/schemes.json) are the base; a
reviewer-approved workflow version (services/source_changes.py) can change a reviewed threshold, and that
change is applied to the matching scheme rule too. Public page reads never change anything here: they only
create review candidates.

`version()` names the active combination. Approving a change calls `invalidate()`, which publishes the new
version atomically and clears every cache that depends on rules.
"""

from __future__ import annotations

import copy
import hashlib
import json
import threading

_LOCK = threading.RLock()
_STATE: dict | None = None

# reviewed workflow threshold -> the scheme rule condition it governs
LINKS = {
    "bereavement": [("income_limit", "delhi_widow_pension", "annual_family_income")],
    "retirement": [
        ("income_limit", "delhi_old_age_pension", "annual_family_income"),
        ("minimum_age", "delhi_old_age_pension", "age"),
    ],
    "education": [
        ("fresh_percentile", "csss", "class12_percentile"),
        ("income_limit", "csss", "annual_family_income"),
    ],
}
# planning workflow -> the scheme whose application it prepares
WORKFLOW_SCHEME = {
    "bereavement": "delhi_widow_pension",
    "retirement": "delhi_old_age_pension",
    "education": "csss",
}


def _label(field: str, op: str, value) -> str:
    if field == "annual_family_income":
        return f"Family income {'below' if op == 'lt' else 'up to'} ₹{int(value):,}/year"
    if field == "age":
        return f"Age {int(value)} or above"
    if field == "class12_percentile":
        return f"Above the {int(value)}th percentile in your Class 12 board"
    return f"{field} {op} {value}"


def _build() -> dict:
    from ..ml import eligibility as el
    from . import source_changes

    workflows = {kind: source_changes.active_config(kind) for kind in ("bereavement", "retirement", "education", "moving")}
    schemes = copy.deepcopy(el.base_schemes())
    by_id = {s["id"]: s for s in schemes}
    applied = []
    for kind, links in LINKS.items():
        cfg = workflows[kind]
        for key, scheme_id, field in links:
            if key not in cfg or scheme_id not in by_id:
                continue
            for cond in by_id[scheme_id]["conditions"]:
                if cond["field"] == field and cond.get("value") != cfg[key]:
                    cond["value"] = cfg[key]
                    cond["label"] = _label(field, cond["op"], cfg[key])
                    applied.append({"scheme_id": scheme_id, "field": field, "from_workflow": kind, "version": cfg.get("version")})
    raw = json.dumps([schemes, {k: v.get("version") for k, v in workflows.items()}], sort_keys=True, default=str)
    digest = hashlib.sha1(raw.encode()).hexdigest()[:10]
    return {"schemes": schemes, "workflows": workflows, "applied": applied, "version": "rules-" + digest}


def _state() -> dict:
    global _STATE
    with _LOCK:
        if _STATE is None:
            _STATE = _build()
        return _STATE


def active_schemes() -> list[dict]:
    return _state()["schemes"]


def workflow(kind: str) -> dict:
    return copy.deepcopy(_state()["workflows"][kind])


def version() -> str:
    return _state()["version"]


def describe() -> dict:
    s = _state()
    return {
        "version": s["version"],
        "workflows": {k: v.get("version") for k, v in s["workflows"].items()},
        "applied": s["applied"],
    }


def invalidate() -> str:
    """Publish the newly approved rules: rebuild once, then clear every dependent cache."""
    global _STATE
    from ..ml import assistant, eligibility
    from . import catalog, entitlements

    with _LOCK, eligibility.Z3_LOCK:
        _STATE = _build()
        entitlements._CACHE.clear()
        assistant.passages.cache_clear()
        assistant._index.cache_clear()
        catalog.invalidate()
    return _STATE["version"]
