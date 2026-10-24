"""Optional Claude helper. JAAGRUK works without it (deterministic fallbacks everywhere); with an
ANTHROPIC_API_KEY it writes grounded answers and extracts rules from notices.

Every call asks for JSON that matches a schema (structured outputs) and never sees citizen secrets.
"""
from __future__ import annotations

import json
import time
from typing import Any

from .. import db
from ..config import settings

_client = None


def available() -> bool:
    return bool(settings.anthropic_api_key)


def _get():
    global _client
    if _client is None:
        import anthropic

        _client = anthropic.AsyncAnthropic(api_key=settings.anthropic_api_key, timeout=90.0, max_retries=2)
    return _client


async def json_call(*, system: str, user: str, schema: dict, purpose: str, effort: str = "low",
                    max_tokens: int = 4000) -> dict | None:
    """One Claude call that must return JSON matching `schema`. Returns None when unavailable or refused."""
    if not available():
        return None
    import anthropic

    t0 = time.perf_counter()
    try:
        resp = await _get().beta.messages.create(
            model=settings.anthropic_model,
            max_tokens=max_tokens,
            system=system,
            messages=[{"role": "user", "content": user}],
            output_config={"effort": effort, "format": {"type": "json_schema", "schema": schema}},
            # if the main model declines on a safety classifier, the API re-runs on a fallback model
            betas=["server-side-fallback-2026-07-01"],
            fallbacks="default",
        )
    except anthropic.APIStatusError as exc:
        _log(purpose, "failed", t0, f"{exc.status_code}: {exc.message}")
        return None
    except anthropic.APIConnectionError as exc:
        _log(purpose, "failed", t0, f"connection: {exc}")
        return None
    if resp.stop_reason == "refusal":
        _log(purpose, "refused", t0, str(getattr(resp, "stop_details", "") or ""))
        return None
    text = next((b.text for b in resp.content if b.type == "text"), "")
    try:
        data = json.loads(text)
    except json.JSONDecodeError:
        _log(purpose, "failed", t0, "invalid JSON")
        return None
    _log(purpose, "ok", t0, f"{resp.usage.input_tokens} in / {resp.usage.output_tokens} out")
    return data


def _log(purpose: str, status: str, t0: float, detail: str) -> None:
    db.log_call("llm", purpose=purpose, target=settings.anthropic_model, mode="live", status=status,
                latency_ms=int((time.perf_counter() - t0) * 1000), detail=detail)


def schema_obj(props: dict[str, Any], required: list[str] | None = None) -> dict:
    return {"type": "object", "properties": props, "required": required or list(props),
            "additionalProperties": False}
