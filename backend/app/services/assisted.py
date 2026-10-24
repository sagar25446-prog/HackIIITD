"""Assisted session: a TinyFish remote browser the citizen drives together with JAAGRUK.

For portals that need the citizen's own OTP or login (RBI UDGAM, MF Central, EPFO, CPGRAMS), JAAGRUK
never automates past the login. It opens a TinyFish Browser API session, connects with Playwright over
CDP, pre-fills only what the citizen approved (name, date of birth), and streams screenshots to the app.
The citizen clicks and types the OTP / CAPTCHA themselves; those keystrokes go straight to the page —
they are never logged, stored, or shown to any AI model. Sessions close on request or after 10 minutes
idle, so the meter ($0.002/min) never runs on.
"""
from __future__ import annotations

import asyncio
import base64
import time
import uuid
from dataclasses import dataclass, field
from typing import Any

from ..tinyfish.client import tinyfish

IDLE_LIMIT_S = 600
_SESSIONS: dict[str, "Session"] = {}
_pw = None


@dataclass
class Session:
    id: str
    tf_session_id: str
    url: str
    purpose: str
    browser: Any
    page: Any
    created: float = field(default_factory=time.time)
    last: float = field(default_factory=time.time)
    actions: int = 0


async def _playwright():
    global _pw
    if _pw is None:
        from playwright.async_api import async_playwright

        _pw = await async_playwright().start()
    return _pw


async def start(url: str, purpose: str) -> dict:
    tf = await tinyfish.browser_create(url, timeout_seconds=IDLE_LIMIT_S, purpose=f"assisted: {purpose}")
    pw = await _playwright()
    try:
        browser = await pw.chromium.connect_over_cdp(tf["cdp_url"])
        ctx = browser.contexts[0] if browser.contexts else await browser.new_context()
        page = ctx.pages[0] if ctx.pages else await ctx.new_page()
        if not page.url or page.url == "about:blank":
            await page.goto(url, wait_until="domcontentloaded", timeout=45000)
    except Exception:
        await tinyfish.browser_close(tf["session_id"])
        raise
    s = Session(id=uuid.uuid4().hex[:10], tf_session_id=tf["session_id"], url=url, purpose=purpose,
                browser=browser, page=page)
    _SESSIONS[s.id] = s
    return {"session": s.id, "tinyfish_session_id": tf["session_id"], **(await frame(s.id))}


def _get(sid: str) -> Session:
    s = _SESSIONS.get(sid)
    if not s:
        raise KeyError("session closed or expired")
    s.last = time.time()
    return s


async def frame(sid: str) -> dict:
    s = _get(sid)
    shot = await s.page.screenshot(type="jpeg", quality=60)
    vp = s.page.viewport_size or {"width": 1280, "height": 800}
    return {"image": "data:image/jpeg;base64," + base64.b64encode(shot).decode(), "url": s.page.url,
            "title": await s.page.title(), "width": vp["width"], "height": vp["height"],
            "idle_seconds_left": int(IDLE_LIMIT_S - (time.time() - s.last))}


async def click(sid: str, x: float, y: float) -> dict:
    s = _get(sid)
    await s.page.mouse.click(x, y)
    s.actions += 1
    await asyncio.sleep(0.6)
    return await frame(sid)


async def type_text(sid: str, text: str) -> dict:
    """Type into the focused field. Used for the citizen's own OTP/CAPTCHA: never logged or stored."""
    s = _get(sid)
    await s.page.keyboard.type(text, delay=40)
    s.actions += 1
    return await frame(sid)


async def press(sid: str, key: str) -> dict:
    if key not in {"Enter", "Tab", "Backspace", "Escape", "ArrowDown", "ArrowUp", "PageDown", "PageUp"}:
        raise ValueError("key not allowed")
    s = _get(sid)
    await s.page.keyboard.press(key)
    await asyncio.sleep(0.6)
    return await frame(sid)


async def prefill(sid: str, fields: dict[str, str]) -> dict:
    """Fill approved, non-secret fields by their visible label or placeholder."""
    s = _get(sid)
    filled, missed = [], []
    for label, value in fields.items():
        for loc in (s.page.get_by_label(label, exact=False), s.page.get_by_placeholder(label, exact=False)):
            try:
                if await loc.count():
                    await loc.first.fill(value, timeout=4000)
                    filled.append(label)
                    break
            except Exception:  # noqa: BLE001 - try the next locator
                continue
        else:
            missed.append(label)
    return {"filled": filled, "missed": missed, **(await frame(sid))}


async def close(sid: str) -> dict:
    s = _SESSIONS.pop(sid, None)
    if not s:
        return {"closed": False}
    try:
        await s.browser.close()  # disconnects Playwright only…
    finally:
        await tinyfish.browser_close(s.tf_session_id)  # …this stops the TinyFish meter
    minutes = (time.time() - s.created) / 60
    return {"closed": True, "minutes": round(minutes, 1), "cost_usd": round(minutes * 0.002, 4)}


async def reaper() -> None:
    while True:
        await asyncio.sleep(30)
        for sid, s in list(_SESSIONS.items()):
            if time.time() - s.last > IDLE_LIMIT_S:
                try:
                    await close(sid)
                except Exception:  # noqa: BLE001
                    _SESSIONS.pop(sid, None)


async def close_all() -> None:
    for sid in list(_SESSIONS):
        try:
            await close(sid)
        except Exception:  # noqa: BLE001
            pass
