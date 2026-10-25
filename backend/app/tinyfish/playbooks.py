"""Portal playbooks: deterministic Playwright scripts that run on a TinyFish Browser session (Indian exit IP).

For portals we know well, a compiled script is faster, cheaper and more predictable than a natural-language
agent. Rules that keep it honest:

* Inputs are checked before any browser is opened (missing input is its own outcome, never "no match").
* `PlaybookBroken` is raised only *before* the form is submitted (a selector is gone because the portal
  changed). Only then may the caller try a bounded fallback. After a submission, an unrecognised page is
  `uncertain` and is never submitted again automatically.
* A CAPTCHA, OTP or login wall ends the lookup as a citizen step.
* Results are read from the portal's own result area (see portal_results.py).

Observed on 2026-10-19 and 2026-10-25: LIC's form accepts any two of policy number / name / DOB / PAN, has no
CAPTCHA, and shows "Records with respect to entered data not found !!!" in red inside the form.
"""

from __future__ import annotations

import base64
import time
from collections.abc import Awaitable, Callable
from typing import Any

from .. import db
from . import portal_results
from .client import tinyfish


class PlaybookBroken(RuntimeError):
    """The portal no longer looks like the playbook expects, before anything was submitted."""


async def _frame(page) -> str:
    shot = await page.screenshot(type="jpeg", quality=55)
    return "data:image/jpeg;base64," + base64.b64encode(shot).decode()


async def _wall(page) -> bool:
    return bool(
        await page.locator(
            "iframe[src*='captcha'], img[src*='captcha' i], input[name*='captcha' i], input[name*='otp' i]"
        ).count()
    )


def lic_inputs(ctx: dict[str, Any]) -> dict[str, str]:
    fields = {
        "{actionForm.policyNo}": ctx.get("policy_no"),
        "{actionForm.custName}": ctx.get("name"),
        "{actionForm.dateOfBirth}": ctx.get("dob"),
        "{actionForm.panNo}": ctx.get("pan"),
    }
    return {k: str(v) for k, v in fields.items() if v}


async def lic_unclaimed(page, ctx: dict[str, Any], emit) -> dict:
    given = lic_inputs(ctx)
    for name in given:
        if not await page.locator(f'input[name="{name}"]').count():
            raise PlaybookBroken(f"LIC form field {name} not found")
    submit = page.locator('input[type="submit"]')
    if not await submit.count():
        raise PlaybookBroken("LIC submit button not found")
    if await _wall(page):
        return {"outcome": "citizen_step", "message": "LIC's form now shows a CAPTCHA — complete it yourself on the official site."}
    for name, value in given.items():
        await page.locator(f'input[name="{name}"]').fill(value)
    await emit({"phase": "progress", "engine": "playbook", "frame": await _frame(page), "message": "Details entered on LIC's official form"})
    await submit.first.click()  # submitted once: from here on, nothing is retried automatically
    try:
        await page.wait_for_load_state("domcontentloaded", timeout=30000)
        await page.wait_for_timeout(2000)
        html = await page.content()
    except Exception:  # noqa: BLE001
        return {"outcome": "uncertain", "submitted": True, "message": "LIC did not finish loading after the search was submitted."}
    res = portal_results.read_lic(html)
    res["submitted"] = True
    return res


async def tata_aia_unclaimed(page, ctx: dict[str, Any], emit) -> dict:
    name, dob = page.locator('input[name="policyHolderName"]'), page.locator('input[name="dob"]')
    if not (await name.count() and await dob.count()):
        raise PlaybookBroken("Tata AIA form fields not found")
    if await _wall(page):
        return {"outcome": "citizen_step", "message": "Tata AIA's form now asks for an OTP or CAPTCHA."}
    await name.fill(str(ctx["name"]))
    await dob.click()
    await page.keyboard.type(str(ctx["dob"]), delay=40)
    await page.keyboard.press("Escape")
    button = page.get_by_role("button", name="Proceed")
    if not await button.count():
        raise PlaybookBroken("Tata AIA Proceed button not found")
    await button.click()
    try:
        await page.wait_for_timeout(5000)
        text = await page.inner_text("body")
        tables = await page.evaluate(
            "() => [...document.querySelectorAll('table')].map(t => [...t.querySelectorAll('tr')].map(r => [...r.querySelectorAll('th,td')].map(c => c.innerText.trim())))"
        )
    except Exception:  # noqa: BLE001
        return {"outcome": "uncertain", "submitted": True, "message": "Tata AIA did not finish loading after Proceed."}
    res = portal_results.read_tata(text, tables)
    res["submitted"] = True
    return res


PLAYBOOKS: dict[str, Callable[..., Awaitable[dict]]] = {
    "lic_unclaimed": lic_unclaimed,
    "tata_aia_unclaimed": tata_aia_unclaimed,
}


async def run(name: str, url: str, ctx: dict[str, Any], emit, purpose: str, on_session=None) -> dict:
    """Open a TinyFish browser (Indian IP), run the playbook, stream screenshots, always close the session."""
    from playwright.async_api import async_playwright

    t0 = time.perf_counter()
    tf = await tinyfish.browser_create(url, timeout_seconds=180, purpose=f"playbook: {purpose}")
    if on_session:
        on_session("session:" + str(tf["session_id"]))
    await emit({"phase": "started", "engine": "playbook", "run_id": tf["session_id"]})
    pw = await async_playwright().start()
    status = "failed"
    try:
        browser = await pw.chromium.connect_over_cdp(tf["cdp_url"])
        page = browser.contexts[0].pages[0]
        try:
            await page.wait_for_load_state("domcontentloaded", timeout=45000)
        except Exception as exc:  # noqa: BLE001 - nothing submitted yet
            raise PlaybookBroken("the official page did not load") from exc
        body = await page.inner_text("body")
        if portal_results.SITE_DOWN.search(body) and "unclaimed" not in body.lower():
            raise PlaybookBroken("the official page could not be reached")
        await emit({"phase": "streaming", "engine": "playbook", "frame": await _frame(page), "message": "Official form loaded"})
        result = await PLAYBOOKS[name](page, ctx, emit)
        try:
            await emit({"phase": "progress", "engine": "playbook", "frame": await _frame(page), "message": "Reading the official result area"})
        except Exception:  # noqa: BLE001 - evidence frame is optional
            pass
        await browser.close()
        status = "ok"
        return result
    finally:
        await pw.stop()
        await tinyfish.browser_close(tf["session_id"])
        db.log_call(
            "playbook",
            purpose=purpose,
            target=url,
            mode="live",
            status=status,
            latency_ms=int((time.perf_counter() - t0) * 1000),
            run_id=tf["session_id"],
        )
