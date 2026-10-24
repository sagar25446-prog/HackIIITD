"""Portal playbooks: deterministic Playwright scripts that run on a TinyFish Browser session (Indian exit IP).

For portals we know well, a compiled script is faster (~10 s), cheaper (~₹0.2) and more predictable than a
natural-language agent. If the script hits something unexpected (a selector is gone because the portal
changed), it raises PlaybookBroken and the harness self-heals by handing the same task to a TinyFish Agent.

Observed on 2026-10-19: the LIC form accepts any two of policy number / name / DOB / PAN, has no CAPTCHA,
and answers "Records with respect to entered data not found !!!" when nothing is listed.
"""
from __future__ import annotations

import base64
import re
import time
from collections.abc import Awaitable, Callable
from typing import Any

from .. import db
from .client import tinyfish


class PlaybookBroken(RuntimeError):
    """The portal no longer looks like the playbook expects — fall back to an agent."""


async def _frame(page) -> str:
    shot = await page.screenshot(type="jpeg", quality=55)
    return "data:image/jpeg;base64," + base64.b64encode(shot).decode()


AMOUNT = re.compile(r"(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)", re.I)


async def _tables(page) -> list[dict[str, str]]:
    """Read result tables as row dicts keyed by header text."""
    return await page.evaluate("""() => {
      const out = [];
      for (const t of document.querySelectorAll('table')) {
        const rows = [...t.querySelectorAll('tr')];
        if (rows.length < 2) continue;
        const head = [...rows[0].querySelectorAll('th,td')].map(c => c.innerText.trim());
        if (!head.some(h => /amount|name|policy/i.test(h))) continue;
        for (const r of rows.slice(1)) {
          const cells = [...r.querySelectorAll('td')].map(c => c.innerText.trim());
          if (cells.length === head.length) out.push(Object.fromEntries(head.map((h, i) => [h, cells[i]])));
        }
      }
      return out;
    }""")


async def lic_unclaimed(page, ctx: dict[str, Any]) -> dict:
    fields = {"{actionForm.policyNo}": ctx.get("policy_no"), "{actionForm.custName}": ctx.get("name"),
              "{actionForm.dateOfBirth}": ctx.get("dob"), "{actionForm.panNo}": ctx.get("pan")}
    given = {k: v for k, v in fields.items() if v}
    if len(given) < 2:
        return {"found": False, "message": "LIC needs any two of: policy number, name, date of birth, PAN"}
    for name, value in given.items():
        loc = page.locator(f'input[name="{name}"]')
        if not await loc.count():
            raise PlaybookBroken(f"LIC form field {name} not found")
        await loc.fill(str(value))
    submit = page.locator('input[type="submit"]')
    if not await submit.count():
        raise PlaybookBroken("LIC submit button not found")
    await submit.first.click()
    await page.wait_for_load_state("domcontentloaded")
    await page.wait_for_timeout(2000)
    body = await page.inner_text("body")
    if re.search(r"not\s+found", body, re.I):
        return {"found": False, "message": "LIC: no unclaimed amount is listed for these details."}
    rows = await _tables(page)
    if not rows:
        raise PlaybookBroken("LIC returned a page the playbook does not recognise")
    total = 0
    holder = ""
    for r in rows:
        for h, v in r.items():
            if re.search(r"amount", h, re.I) and (m := AMOUNT.search(v)):
                total += int(float(m.group(1).replace(",", "")))
            if not holder and re.search(r"name", h, re.I):
                holder = v
    return {"found": True, "amount_inr": total, "holder_name": holder, "rows": rows[:5],
            "message": f"LIC lists {len(rows)} unclaimed record(s)."}


PLAYBOOKS: dict[str, Callable[[Any, dict], Awaitable[dict]]] = {"lic_unclaimed": lic_unclaimed}


async def run(name: str, url: str, ctx: dict[str, Any], emit, purpose: str) -> dict:
    """Open a TinyFish browser (Indian IP), run the playbook, stream screenshots, always close the session."""
    from playwright.async_api import async_playwright

    t0 = time.perf_counter()
    tf = await tinyfish.browser_create(url, timeout_seconds=180, purpose=f"playbook: {purpose}")
    await emit({"phase": "started", "engine": "playbook", "run_id": tf["session_id"]})
    pw = await async_playwright().start()
    try:
        browser = await pw.chromium.connect_over_cdp(tf["cdp_url"])
        page = browser.contexts[0].pages[0]
        await page.wait_for_load_state("domcontentloaded")
        await emit({"phase": "streaming", "engine": "playbook", "frame": await _frame(page),
                    "message": "Official form loaded"})
        result = await PLAYBOOKS[name](page, ctx)
        await emit({"phase": "progress", "engine": "playbook", "frame": await _frame(page),
                    "message": "Search submitted, reading the official result"})
        await browser.close()
        return result
    finally:
        await pw.stop()
        await tinyfish.browser_close(tf["session_id"])
        db.log_call("playbook", purpose=purpose, target=url, mode="live", status="ok",
                    latency_ms=int((time.perf_counter() - t0) * 1000), run_id=tf["session_id"])


async def tata_aia_unclaimed(page, ctx: dict[str, Any]) -> dict:
    if not (ctx.get("name") and ctx.get("dob")):
        return {"found": False, "message": "Tata AIA needs the policy holder's name and date of birth"}
    name, dob = page.locator('input[name="policyHolderName"]'), page.locator('input[name="dob"]')
    if not (await name.count() and await dob.count()):
        raise PlaybookBroken("Tata AIA form fields not found")
    await name.fill(str(ctx["name"]))
    await dob.click()
    await page.keyboard.type(str(ctx["dob"]), delay=40)
    await page.keyboard.press("Escape")
    await page.get_by_role("button", name="Proceed").click()
    await page.wait_for_timeout(5000)
    body = await page.inner_text("body")
    if re.search(r"no unclaimed funds", body, re.I):
        return {"found": False, "message": "Tata AIA: no unclaimed funds for these details."}
    if re.search(r"otp|captcha", body, re.I):
        raise PlaybookBroken("Tata AIA asked for an OTP/CAPTCHA")
    rows = await _tables(page)
    if not rows:
        raise PlaybookBroken("Tata AIA returned a page the playbook does not recognise")
    total = sum(int(float(m.group(1).replace(",", ""))) for r in rows for h, v in r.items()
                if re.search(r"amount", h, re.I) and (m := AMOUNT.search(v)))
    holder = next((v for r in rows for h, v in r.items() if re.search(r"name", h, re.I)), "")
    return {"found": True, "amount_inr": total, "holder_name": holder, "rows": rows[:5],
            "message": f"Tata AIA lists {len(rows)} unclaimed record(s)."}


PLAYBOOKS["tata_aia_unclaimed"] = tata_aia_unclaimed
