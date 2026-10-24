"""Scam Shield: is this message / link / 'scheme' real?

Layer 1 (instant, offline): text classifier + fraud-signal rules + domain analysis (ml/scam.py).
Layer 2 (TinyFish Search, free): look for evidence on the live web —
  * has PIB Fact Check (the government's fact-check unit) called this scheme or site fake?
  * does the scheme exist on an official .gov.in / .nic.in site at all?
  * are people reporting this domain as a fraud?
The verdict combines both, and every piece of web evidence is shown with its link.
"""
from __future__ import annotations

import asyncio
import re
from typing import Any

from .. import db
from ..ml import scam
from ..tinyfish.client import TinyFishUnavailable, tinyfish
from ..tinyfish.harness import is_official

SCHEME_NAME = re.compile(
    r"((?:pm|pradhan mantri|mukhyamantri|cm|pradhanmantri|प्रधानमंत्री|मुख्यमंत्री)?[\w\s\-']{0,40}?"
    r"(?:yojana|yojna|scheme|abhiyan|mission|bharti|recruitment|bhatta|vikas|योजना|भर्ती))", re.I)
FAKE_WORDS = re.compile(r"\bfake\b|fraud|false|not (been )?launched|no such scheme|misleading|फर्जी|झूठा|भ्रामक|scam", re.I)
GENERIC = {"yojana", "yojna", "scheme", "pradhan", "mantri", "pradhanmantri", "mukhyamantri", "abhiyan", "mission",
           "bharti", "recruitment", "2025", "2026", "योजना"}


def scheme_name(text: str) -> str | None:
    for m in SCHEME_NAME.finditer(text):
        name = " ".join(m.group(1).split())
        if len(name.split()) >= 2:
            return name[:80]
    return None


async def _search(query: str, purpose: str, **kw) -> list[dict]:
    try:
        r = await tinyfish.search(query, purpose=purpose, **kw)
    except TinyFishUnavailable:
        return []
    except Exception:  # noqa: BLE001 - evidence is best-effort; the offline layer still answers
        return []
    return (r or {}).get("results", [])[:6]


async def evidence(text: str, domains: list[dict]) -> dict[str, Any]:
    name = scheme_name(text)
    unknown = [d["domain"] for d in domains if d["status"] in ("unofficial", "impersonation", "lookalike", "unknown")]
    jobs = {}
    if name:
        jobs["factcheck"] = _search(f"{name} fake PIB fact check", "Scam Shield: PIB fact check",
                                    include_domains="pib.gov.in")
        jobs["official"] = _search(name, "Scam Shield: does the scheme exist on an official site",
                                   include_domains="gov.in,nic.in")
    for d in unknown[:2]:
        jobs[f"domain:{d}"] = _search(f"{d} fraud OR fake OR scam", f"Scam Shield: reports about {d}")
    keys = list(jobs)
    got = await asyncio.gather(*jobs.values()) if jobs else []
    res = dict(zip(keys, got))
    items: list[dict] = []

    def about(r: dict) -> bool:
        """The result must actually be about this scheme (≥2 of its distinctive words), not any PIB page."""
        blob = (r.get("title", "") + " " + r.get("snippet", "") + " " + r.get("url", "")).lower()
        words = [w for w in re.findall(r"[a-zऀ-ॿ]{4,}", (name or "").lower()) if w not in GENERIC]
        return sum(w in blob for w in words) >= min(2, len(words)) if words else False

    fact_fake = [r for r in res.get("factcheck", []) if about(r)
                 and FAKE_WORDS.search(r.get("title", "") + " " + r.get("snippet", ""))]
    for r in fact_fake[:3]:
        items.append({"kind": "pib_fact_check", "title": r["title"], "url": r["url"], "snippet": r.get("snippet", "")})
    official = [r for r in res.get("official", []) if is_official(r.get("url")) and about(r)
                and not FAKE_WORDS.search(r.get("title", "") + " " + r.get("snippet", ""))]
    for r in official[:2]:
        items.append({"kind": "official_page", "title": r["title"], "url": r["url"], "snippet": r.get("snippet", "")})
    for k, rs in res.items():
        if k.startswith("domain:"):
            for r in rs[:4]:
                if FAKE_WORDS.search(r.get("title", "") + " " + r.get("snippet", "")):
                    items.append({"kind": "fraud_report", "domain": k[7:], "title": r["title"], "url": r["url"],
                                  "snippet": r.get("snippet", "")})
                    break
    return {"scheme_name": name, "items": items, "searched": bool(jobs),
            "pib_says_fake": bool(fact_fake), "exists_officially": bool(official)}


async def check(text: str, *, deep: bool = True) -> dict:
    base = scam.score(text)
    out = {**base, "evidence": None}
    if not deep:
        return out
    ev = await evidence(text, base["domains"])
    out["evidence"] = ev
    risk = base["risk"]
    reasons = list(base["reasons"])
    pages = [i["url"] for i in ev["items"] if i["kind"] == "official_page"]
    # prefer the scheme's own site over directory portals (india.gov.in, myscheme.gov.in)
    official_url = next((u for u in pages if not re.search(r"//(www\.)?(india|myscheme)\.gov\.in", u)), pages[0] if pages else None)
    if ev["pib_says_fake"] and ev["exists_officially"]:
        # seen live: the scheme is real, but fake websites misuse its name to collect fees
        risk = max(risk, 90)
        reasons.insert(0, f"'{ev['scheme_name']}' is a real scheme, but PIB Fact Check has flagged fake websites and "
                          f"messages using its name. Apply only on the official site: {official_url}")
    elif ev["pib_says_fake"]:
        risk = max(risk, 92)
        reasons.insert(0, "PIB Fact Check (Government of India) has flagged this as fake")
    elif any(i["kind"] == "fraud_report" for i in ev["items"]):
        risk = max(risk, 75)
        reasons.insert(0, "People have reported this website as a fraud")
    elif ev["scheme_name"] and not ev["exists_officially"] and ev["searched"]:
        risk = min(99, risk + 10)
        reasons.append(f"No official government page mentions '{ev['scheme_name']}'")
    elif ev["exists_officially"] and not base["signals"]:
        risk = round(risk * 0.6)
        reasons.append("The scheme exists on an official government website — apply only there")
    out["risk"] = risk
    out["verdict"] = "likely_fake" if risk >= 70 else "suspicious" if risk >= 40 else "looks_genuine"
    out["reasons"] = reasons
    k = f"scam_stats:{out['verdict']}"
    db.cache_set(k, int(db.cache_get(k) or 0) + 1)
    return out


def safe_steps(verdict: str, lang: str = "en") -> list[str]:
    en = {
        "likely_fake": ["Do not pay anything and do not share OTP, PIN or Aadhaar.",
                        "Report it on cybercrime.gov.in or call 1930 (National Cyber Crime Helpline).",
                        "Forward the message to PIB Fact Check: +91 8799711259 or factcheck@pib.gov.in."],
        "suspicious": ["Do not pay or click links until you check the official website yourself.",
                       "Search the scheme on myscheme.gov.in — real schemes are listed there.",
                       "If money was taken, call 1930 immediately."],
        "looks_genuine": ["Apply only on the official .gov.in website shown here.",
                          "Government schemes never charge a fee to apply or ask for your OTP."],
    }
    hi = {
        "likely_fake": ["कोई पैसा न दें, OTP, PIN या आधार न बताएं।", "cybercrime.gov.in पर शिकायत करें या 1930 पर कॉल करें।",
                        "संदेश PIB Fact Check को भेजें: +91 8799711259"],
        "suspicious": ["आधिकारिक वेबसाइट पर जाँच किए बिना पैसा न दें, लिंक न खोलें।", "myscheme.gov.in पर योजना खोजें।",
                       "पैसा कट गया हो तो तुरंत 1930 पर कॉल करें।"],
        "looks_genuine": ["केवल आधिकारिक .gov.in वेबसाइट पर ही आवेदन करें।", "सरकारी योजनाएँ आवेदन के लिए शुल्क या OTP नहीं माँगतीं।"],
    }
    return (hi if lang == "hi" else en)[verdict]
