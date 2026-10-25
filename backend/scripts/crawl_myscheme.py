"""Build JAAGRUK's scheme catalogue from myScheme (the Government of India's scheme platform) with TinyFish.

Two steps, both resumable:

1. Discover: TinyFish Search (free) with `site:myscheme.gov.in/schemes <topic>` over many topics and states
   collects scheme URLs, titles and one-line descriptions.
2. Read: myScheme renders scheme details in the browser (TinyFish Fetch only sees the page footer), so each
   page is opened on a TinyFish Browser session (Indian exit IP, ≈ $0.002/min, ~8 s a page) and the
   official sections are read: details, benefits, eligibility, exclusions, application process,
   documents required and sources.

Output: backend/app/data/catalog/myscheme.json (parsed text only, with the page URL and the time it was read).
myScheme's copyright policy allows reproduction with prominent acknowledgement of the source, which the app
shows on every card.

Usage:
  python backend/scripts/crawl_myscheme.py discover           # Search only (free)
  python backend/scripts/crawl_myscheme.py read --limit 400   # TinyFish Browser, resumable
  python backend/scripts/crawl_myscheme.py deadlines           # NSP official dates (Fetch, free)
"""

from __future__ import annotations

import argparse
import asyncio
import hashlib
import json
import re
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app import db  # noqa: E402
from app.config import DATA_DIR, settings  # noqa: E402
from app.tinyfish.client import tinyfish  # noqa: E402

OUT_DIR = DATA_DIR / "catalog"
DISCOVERED = OUT_DIR / "discovered.json"
CATALOG = OUT_DIR / "myscheme.json"
SLUG = re.compile(r"^https://www\.myscheme\.gov\.in/schemes/([a-z0-9-]+)/?$")

TOPICS = [
    "scholarship",
    "post matric scholarship",
    "pre matric scholarship",
    "merit scholarship",
    "fellowship research",
    "education loan",
    "free coaching",
    "hostel",
    "old age pension",
    "widow pension",
    "disability pension",
    "divyang assistive devices",
    "farmers income support",
    "crop insurance",
    "agriculture equipment subsidy",
    "irrigation",
    "animal husbandry dairy",
    "fishermen",
    "health insurance",
    "maternity benefit",
    "girl child",
    "women entrepreneurs",
    "self help group",
    "marriage assistance",
    "funeral death assistance",
    "accident insurance",
    "life insurance",
    "housing",
    "skill training",
    "apprenticeship",
    "unemployment allowance",
    "self employment loan",
    "startup",
    "MSME credit",
    "street vendors",
    "artisans craftsmen",
    "construction workers",
    "unorganised workers",
    "scheduled caste",
    "scheduled tribe",
    "OBC",
    "minority",
    "transgender",
    "senior citizens",
    "sports",
    "electricity",
    "LPG",
    "drinking water sanitation",
    "legal aid",
    "orphan children",
]
STATES = [
    "Delhi",
    "Uttar Pradesh",
    "Bihar",
    "Maharashtra",
    "Rajasthan",
    "Madhya Pradesh",
    "Tamil Nadu",
    "Karnataka",
    "West Bengal",
    "Gujarat",
    "Haryana",
    "Punjab",
    "Kerala",
    "Odisha",
    "Telangana",
]
STATE_TOPICS = ["scholarship", "pension", "women", "farmers", "loan"]

EXTRACT_JS = r"""() => {
  const h1 = [...document.querySelectorAll('h1')].find(h => h.innerText.trim().length > 3);
  if (!h1) return null;
  const sub = (h1.parentElement.querySelector('h3') || {}).innerText || '';
  let box = h1.parentElement, tags = [];
  for (let i = 0; i < 6 && box; i++, box = box.parentElement) {
    const t = [...box.querySelectorAll('div[role="button"][aria-label]')].map(e => e.getAttribute('aria-label').trim());
    if (t.length) { tags = [...new Set(t)].filter(x => x && x.length < 60); break; }
  }
  const sec = id => {
    const el = document.getElementById(id);
    if (!el) return '';
    const lines = el.innerText.split('\n').map(s => s.trim()).filter(Boolean);
    const head = (el.querySelector('h3') || {}).innerText;
    if (head && lines[0] === head.trim()) lines.shift();
    return lines.join('\n');
  };
  const links = id => {
    const el = document.getElementById(id);
    return el ? [...el.querySelectorAll('a[href]')]
      .map(a => ({text: a.innerText.trim().slice(0, 80), url: a.href}))
      .filter(l => /^https?:/.test(l.url) && !l.url.includes('myscheme.gov.in')) : [];
  };
  return {name: h1.innerText.trim(), subtitle: sub.trim(), tags,
          details: sec('details'), benefits: sec('benefits'), eligibility: sec('eligibility'),
          exclusions: sec('exclusions'), application: sec('application-process'),
          documents: sec('documents-required'), sources: links('sources'), apply_links: links('application-process')};
}"""


def _load(p: Path, default):
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else default


def _save(p: Path, data) -> None:
    OUT_DIR.mkdir(parents=True, exist_ok=True)
    tmp = p.with_suffix(".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    tmp.replace(p)


async def discover(concurrency: int = 2) -> None:
    found: dict[str, dict] = _load(DISCOVERED, {})
    done_file = OUT_DIR / "discover_queries.json"
    done: set[str] = set(_load(done_file, []))
    queries = [(f"site:myscheme.gov.in/schemes {t}", p) for t in TOPICS for p in (0, 1)]
    queries += [(f"site:myscheme.gov.in/schemes {s} {t}", 0) for s in STATES for t in STATE_TOPICS]
    queries = [(q, p) for q, p in queries if f"{q}|{p}" not in done]
    sdk = tinyfish._client()
    sem = asyncio.Semaphore(concurrency)

    async def one(q: str, page: int) -> None:
        async with sem:
            await asyncio.sleep(4.5)  # Search is limited to 30 requests a minute per account
            t0 = time.perf_counter()
            try:
                r = await sdk.search.query(
                    q,
                    location="India",
                    page=page or None,
                    purpose="Build the JAAGRUK scheme catalogue from myScheme",
                )
                res = r.model_dump(mode="json").get("results", [])
                db.log_call(
                    "search",
                    purpose="catalog crawl: discover schemes on myScheme",
                    target=q,
                    mode="live",
                    status="ok",
                    latency_ms=int((time.perf_counter() - t0) * 1000),
                )
            except Exception as exc:  # noqa: BLE001
                print("search failed", q, exc)
                return
            done.add(f"{q}|{page}")
            for it in res:
                m = SLUG.match(it.get("url", "").split("?")[0])
                if m and m.group(1) not in found:
                    found[m.group(1)] = {
                        "url": f"https://www.myscheme.gov.in/schemes/{m.group(1)}",
                        "title": it.get("title", ""),
                        "snippet": it.get("snippet", ""),
                        "query": q,
                    }

    await asyncio.gather(*(one(q, p) for q, p in queries))
    _save(DISCOVERED, found)
    _save(done_file, sorted(done))
    print(f"discovered {len(found)} scheme pages from {len(queries)} searches")


async def read(limit: int, workers: int = 3, per_session: int = 35) -> None:
    from playwright.async_api import async_playwright

    found: dict[str, dict] = _load(DISCOVERED, {})
    catalog: dict[str, dict] = _load(CATALOG, {})
    todo = [s for s in found if s not in catalog][:limit]
    print(
        f"{len(catalog)} already read, {len(todo)} to read with {workers} TinyFish Browser sessions"
    )
    queue: asyncio.Queue[str] = asyncio.Queue()
    for s in todo:
        queue.put_nowait(s)
    lock = asyncio.Lock()
    pw = await async_playwright().start()

    async def worker(w: int) -> None:
        while not queue.empty():
            first = await queue.get()
            tf = await tinyfish.browser_create(
                found[first]["url"],
                timeout_seconds=900,
                purpose="catalog crawl: read myScheme scheme pages",
            )
            try:
                browser = await pw.chromium.connect_over_cdp(tf["cdp_url"])
                page = browser.contexts[0].pages[0]
                slug, n = first, 0
                while slug:
                    url = found[slug]["url"]
                    try:
                        if n:
                            await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                        await page.wait_for_selector("#eligibility, #details", timeout=20000)
                        await page.wait_for_timeout(600)
                        data = await page.evaluate(EXTRACT_JS)
                    except Exception as exc:  # noqa: BLE001
                        data = None
                        print(f"[w{w}] {slug}: {type(exc).__name__}")
                    if (
                        data
                        and data.get("name")
                        and (data.get("eligibility") or data.get("benefits"))
                    ):
                        body = "\n".join(
                            data.get(k, "")
                            for k in (
                                "details",
                                "benefits",
                                "eligibility",
                                "exclusions",
                                "application",
                                "documents",
                            )
                        )
                        data.update(
                            slug=slug,
                            url=url,
                            read_at=time.strftime("%Y-%m-%d %H:%M"),
                            sha=hashlib.sha1(body.encode()).hexdigest(),
                            snippet=found[slug].get("snippet", ""),
                        )
                        async with lock:
                            catalog[slug] = data
                            if len(catalog) % 10 == 0:
                                _save(CATALOG, catalog)
                        print(f"[w{w}] {len(catalog):4d} {data['name'][:70]}")
                    n += 1
                    slug = None if (n >= per_session or queue.empty()) else queue.get_nowait()
                await browser.close()
            except Exception as exc:  # noqa: BLE001
                print(f"[w{w}] session error: {type(exc).__name__}: {exc}")
            finally:
                await tinyfish.browser_close(tf["session_id"])

    try:
        await asyncio.gather(*(worker(i) for i in range(workers)))
    finally:
        await pw.stop()
        _save(CATALOG, catalog)
        print(f"catalogue now has {len(catalog)} schemes → {CATALOG}")


async def deadlines() -> None:
    """Save the official NSP scheme list (open-from / apply-till dates) as the shipped deadline baseline."""
    from app.services import catalog

    res = await tinyfish.fetch(
        [catalog.NSP_URL],
        purpose="Official scholarship deadlines on the National Scholarship Portal",
        ttl=0,
    )
    schemes = catalog.parse_nsp(((res.get("results") or [{}])[0]).get("text") or "")
    if not schemes:
        sys.exit("NSP list not readable")
    _save(
        catalog.NSP_FILE,
        {
            "fetched_at": time.time(),
            "url": catalog.NSP_URL,
            "via": "TinyFish Fetch",
            "replay": False,
            "schemes": schemes,
        },
    )
    print(f"{len(schemes)} NSP schemes with official dates → {catalog.NSP_FILE}")


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("step", choices=["discover", "read", "deadlines"])
    ap.add_argument("--limit", type=int, default=400)
    ap.add_argument("--workers", type=int, default=3)
    a = ap.parse_args()
    if not settings.live_enabled:
        sys.exit(
            "A live TINYFISH_API_KEY is needed to crawl (the app itself works offline from the saved catalogue)."
        )
    if a.step == "discover":
        asyncio.run(discover())
    elif a.step == "deadlines":
        asyncio.run(deadlines())
    else:
        asyncio.run(read(a.limit, a.workers))


if __name__ == "__main__":
    main()
