"""Explore: every scheme JAAGRUK knows — searchable, filterable, live-discoverable and re-checkable.

Three tiers, shown honestly on every card:
* proven   — our hand-verified rules (data/schemes.json); Z3 proves eligibility for the family.
* verified — read from the scheme's myScheme page on a TinyFish Browser session (data/catalog/myscheme.json,
             built by scripts/crawl_myscheme.py, plus pages read live from the app).
* listed   — found by a live TinyFish Search, details not read yet (one click reads them).

Search runs locally (SQLite FTS5 + facet filters), so results are instant and work offline. TinyFish is used where
it adds something the local index cannot: live discovery (Search → Fetch → Browser) and re-checks that detect a
changed deadline or eligibility text and raise an alert.
"""

from __future__ import annotations

import hashlib
import json
import re
import sqlite3
import threading
import time
from datetime import date
from typing import Any

from .. import db
from ..config import DATA_DIR
from ..ml import eligibility as el
from ..tinyfish.client import TinyFishUnavailable, tinyfish

CATALOG_FILE = DATA_DIR / "catalog" / "myscheme.json"
NSP_FILE = (
    DATA_DIR / "catalog" / "nsp_deadlines.json"
)  # shipped baseline: a real TinyFish Fetch of the NSP list
NSP_URL = "https://scholarships.gov.in/All-Scholarships"
MYSCHEME = re.compile(r"^https://www\.myscheme\.gov\.in/schemes/([a-z0-9-]+)/?$")
OFFICIAL = re.compile(r"\.(gov|nic)\.in$|\.gov$")

# ------------------------------------------------------------------ vocabularies (English, Hindi, Hinglish)
STATES: list[tuple[str, str]] = [
    ("Andaman and Nicobar Islands", "अंडमान और निकोबार"),
    ("Andhra Pradesh", "आंध्र प्रदेश"),
    ("Arunachal Pradesh", "अरुणाचल प्रदेश"),
    ("Assam", "असम"),
    ("Bihar", "बिहार"),
    ("Chandigarh", "चंडीगढ़"),
    ("Chhattisgarh", "छत्तीसगढ़"),
    ("Dadra and Nagar Haveli and Daman and Diu", "दादरा नगर हवेली और दमन दीव"),
    ("Delhi", "दिल्ली"),
    ("Goa", "गोवा"),
    ("Gujarat", "गुजरात"),
    ("Haryana", "हरियाणा"),
    ("Himachal Pradesh", "हिमाचल प्रदेश"),
    ("Jammu and Kashmir", "जम्मू और कश्मीर"),
    ("Jharkhand", "झारखंड"),
    ("Karnataka", "कर्नाटक"),
    ("Kerala", "केरल"),
    ("Ladakh", "लद्दाख"),
    ("Lakshadweep", "लक्षद्वीप"),
    ("Madhya Pradesh", "मध्य प्रदेश"),
    ("Maharashtra", "महाराष्ट्र"),
    ("Manipur", "मणिपुर"),
    ("Meghalaya", "मेघालय"),
    ("Mizoram", "मिज़ोरम"),
    ("Nagaland", "नागालैंड"),
    ("Odisha", "ओडिशा"),
    ("Puducherry", "पुडुचेरी"),
    ("Punjab", "पंजाब"),
    ("Rajasthan", "राजस्थान"),
    ("Sikkim", "सिक्किम"),
    ("Tamil Nadu", "तमिलनाडु"),
    ("Telangana", "तेलंगाना"),
    ("Tripura", "त्रिपुरा"),
    ("Uttar Pradesh", "उत्तर प्रदेश"),
    ("Uttarakhand", "उत्तराखंड"),
    ("West Bengal", "पश्चिम बंगाल"),
]
STATE_HI = dict(STATES)
_STATE_ALIASES = {
    "nct of delhi": "Delhi",
    "new delhi": "Delhi",
    "up": "Uttar Pradesh",
    "mp": "Madhya Pradesh",
    "j&k": "Jammu and Kashmir",
    "orissa": "Odisha",
    "pondicherry": "Puducherry",
    "tn": "Tamil Nadu",
}

# id, English label, Hindi label, pattern over tags + name + summary (first match = primary category)
CATEGORIES: list[tuple[str, str, str, str]] = [
    (
        "education",
        "Education & scholarships",
        "शिक्षा और छात्रवृत्ति",
        r"scholar|education|student|fellowship|school|college|hostel|coaching|research|tuition|degree",
    ),
    (
        "pension",
        "Pension & social security",
        "पेंशन और सामाजिक सुरक्षा",
        r"pension|old age|widow|senior citizen|destitute|social security|funeral|death",
    ),
    (
        "health",
        "Health",
        "स्वास्थ्य",
        r"health|medical|hospital|treatment|disease|ayushman|cancer|surgery",
    ),
    (
        "farming",
        "Farming & fisheries",
        "खेती और मत्स्य पालन",
        r"farm|agricultur|kisan|crop|irrigation|horticultur|animal husbandry|dairy|livestock|fisher|fisheries|seed",
    ),
    (
        "jobs",
        "Jobs & skills",
        "नौकरी और कौशल",
        r"skill|training|employment|job|apprentice|unemploy|placement|internship|labour|worker",
    ),
    (
        "business",
        "Business & loans",
        "व्यवसाय और ऋण",
        r"loan|credit|entrepreneur|startup|msme|enterprise|business|self.employ|vendor|artisan|subsidy on interest",
    ),
    (
        "housing",
        "Housing & utilities",
        "आवास और सुविधाएँ",
        r"housing|house|shelter|awas|electricity|lpg|gas connection|water|sanitation|toilet|solar",
    ),
    (
        "women_children",
        "Women & children",
        "महिलाएँ और बच्चे",
        r"women|woman|girl|maternity|pregnan|mother|child|marriage|daughter",
    ),
    ("insurance", "Insurance", "बीमा", r"insurance|bima|accident cover|life cover"),
]
OTHER_CAT = ("other", "Other welfare", "अन्य कल्याण")
CAT_LABEL = {c[0]: (c[1], c[2]) for c in CATEGORIES} | {OTHER_CAT[0]: (OTHER_CAT[1], OTHER_CAT[2])}

GROUPS: list[tuple[str, str, str, str]] = [
    ("students", "Students", "छात्र", r"student|scholar|school|college|pupil"),
    ("farmers", "Farmers", "किसान", r"farmer|kisan|cultivat|agricultur"),
    ("women", "Women", "महिलाएँ", r"\bwomen\b|\bwoman\b|female|mahila|widow"),
    ("girls", "Girls", "बालिकाएँ", r"\bgirl"),
    ("widows", "Widows", "विधवाएँ", r"widow"),
    ("senior", "Senior citizens", "वरिष्ठ नागरिक", r"senior citizen|old age|elderly|aged (?:60|65)"),
    ("disability", "Persons with disability", "दिव्यांगजन", r"disab|divyang|pwd|handicap|blind|deaf"),
    ("sc", "Scheduled Castes", "अनुसूचित जाति", r"scheduled caste|\bsc\b|dalit"),
    ("st", "Scheduled Tribes", "अनुसूचित जनजाति", r"scheduled tribe|\bst\b|tribal|adivasi"),
    ("obc", "OBC", "अन्य पिछड़ा वर्ग", r"\bobc\b|backward class|\bebc\b|\bdnt\b"),
    ("minority", "Minorities", "अल्पसंख्यक", r"minorit"),
    (
        "workers",
        "Workers",
        "श्रमिक",
        r"worker|labour|labor|construction|unorganised|unorganized|shramik",
    ),
    (
        "entrepreneurs",
        "Entrepreneurs",
        "उद्यमी",
        r"entrepreneur|startup|msme|self.employ|business|vendor|artisan",
    ),
    (
        "low_income",
        "Low income / BPL",
        "कम आय / बीपीएल",
        r"\bbpl\b|below poverty|economically weaker|\bews\b|low income|poor",
    ),
    ("youth", "Youth", "युवा", r"youth|unemployed"),
]
GROUP_LABEL = {g[0]: (g[1], g[2]) for g in GROUPS}

BENEFIT_TYPES: list[tuple[str, str, str, str]] = [
    (
        "scholarship",
        "Scholarship / fees",
        "छात्रवृत्ति / फ़ीस",
        r"scholar|tuition|fee reimburse|stipend|fellowship",
    ),
    ("pension", "Monthly pension", "मासिक पेंशन", r"pension"),
    ("loan", "Loan / credit", "ऋण", r"loan|credit"),
    ("insurance", "Insurance cover", "बीमा कवर", r"insurance|cover of|life cover|accident cover"),
    ("subsidy", "Subsidy", "सब्सिडी", r"subsid"),
    ("training", "Training", "प्रशिक्षण", r"training|skill"),
    (
        "cash",
        "Cash support",
        "नकद सहायता",
        r"financial assistance|cash|₹|rs\.?\s?\d|grant|incentive|allowance",
    ),
]
BTYPE_LABEL = {b[0]: (b[1], b[2]) for b in BENEFIT_TYPES} | {
    "service": ("Service / in kind", "सेवा / वस्तु")
}

STATUS_LABEL = {
    "open": ("Open", "खुला"),
    "closing_soon": ("Closing soon", "जल्द बंद"),
    "upcoming": ("Opens soon", "जल्द खुलेगा"),
    "unknown": ("Availability unknown — no date listed", "उपलब्धता अज्ञात — कोई तिथि नहीं दी गई"),
    "date_passed": ("Listed date has passed", "दी गई तिथि निकल गई"),
}
TIER_LABEL = {
    "proven": ("Reviewed rule in JAAGRUK", "JAAGRUK में समीक्षित नियम"),
    "verified": ("Read from the official page", "आधिकारिक पेज से पढ़ा गया"),
    "listed": ("Found live — details not read yet", "लाइव मिला — विवरण अभी नहीं पढ़ा"),
}

# ------------------------------------------------------------------ text helpers
_MONTHS = {
    m: i
    for i, m in enumerate(
        ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"], 1
    )
}
_D_NUM = re.compile(r"\b(\d{1,2})[./-](\d{1,2})[./-](20\d{2})\b")
_D_DMY = re.compile(
    r"\b(\d{1,2})(?:st|nd|rd|th)?\s+(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?,?\s+(20\d{2})\b",
    re.I,
)
_D_MDY = re.compile(
    r"\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(20\d{2})\b",
    re.I,
)
_DEADLINE_CTX = re.compile(
    r"last date|deadline|closing date|clos(?:e|es|ed|ing) on|apply (?:by|before|till|until|on or before)"
    r"|on or before|till|until|due date|ends? on|portal (?:is )?open|applications? (?:are )?invited",
    re.I,
)
_AMOUNT = re.compile(
    r"(?:₹|rs\.?|inr)\s*([\d,]+(?:\.\d+)?)\s*(lakh|lac|crore)?|([\d.]+)\s*(lakh|lac|crore)", re.I
)


def _dates(text: str) -> list[tuple[date, str]]:
    """Dates that appear next to deadline words, with the line they came from."""
    out = []
    for line in text.split("\n"):
        if not _DEADLINE_CTX.search(line):
            continue
        for m in _D_NUM.finditer(line):
            d, mo, y = int(m.group(1)), int(m.group(2)), int(m.group(3))
            if mo > 12 and d <= 12:
                d, mo = mo, d
            _add(out, y, mo, d, line)
        for m in _D_DMY.finditer(line):
            _add(out, int(m.group(3)), _MONTHS[m.group(2)[:3].lower()], int(m.group(1)), line)
        for m in _D_MDY.finditer(line):
            _add(out, int(m.group(3)), _MONTHS[m.group(1)[:3].lower()], int(m.group(2)), line)
    return out


def _add(out: list, y: int, mo: int, d: int, line: str) -> None:
    try:
        out.append((date(y, mo, d), line.strip()[:220]))
    except ValueError:
        pass


def deadline_status(text: str, today: date | None = None) -> tuple[str, str | None, str | None]:
    """(status, deadline ISO, the sentence it came from)."""
    today = today or date.today()
    found = _dates(text)
    if not found:
        return "unknown", None, None
    future = sorted((d, s) for d, s in found if d >= today)
    if future:
        d, s = future[0]
        return ("closing_soon" if (d - today).days <= 14 else "open"), d.isoformat(), s
    d, s = max(found)
    return "date_passed", d.isoformat(), s


def _amount(text: str) -> int:
    best = 0
    for m in _AMOUNT.finditer(text):
        num, unit = (m.group(1), m.group(2)) if m.group(1) else (m.group(3), m.group(4))
        try:
            v = float(num.replace(",", ""))
        except (TypeError, ValueError):
            continue
        if unit:
            v *= 1e7 if unit.lower() == "crore" else 1e5
        if 50 <= v <= 5e7:
            best = max(best, int(v))
    return best


def _first_sentences(text: str, limit: int = 230) -> str:
    text = re.sub(r"\s+", " ", text or "").strip()
    if len(text) <= limit:
        return text
    cut = text[:limit]
    dot = cut.rfind(". ")
    return cut[: dot + 1] if dot > 80 else cut.rsplit(" ", 1)[0] + "…"


def _benefit_line(benefits: str, details: str) -> str:
    lines = [l.strip(" •-") for l in (benefits or "").split("\n") if len(l.strip()) > 3]
    for i, l in enumerate(lines):
        if l.endswith(
            ":"
        ):  # a table heading ("Rates of scholarships (₹ per annum):") — the value follows
            continue
        if re.search(r"₹|rs\.?\s?\d|\d\s?lakh|per (?:month|annum|year)", l, re.I):
            # a short heading like "Maintenance Allowance (per month)" reads better with its first value
            if len(l) < 45 and i + 1 < len(lines):
                l = f"{l}: {lines[i + 1]}"
            return _first_sentences(l, 140)
    sentence = next((l for l in lines if len(l) > 40 and not l.endswith(":")), None)
    if sentence:
        return _first_sentences(sentence, 140)
    for s in re.split(r"(?<=\.)\s", details or ""):
        if re.search(r"₹|rs\.?\s?\d|lakh", s, re.I):
            return _first_sentences(s, 140)
    return ""


def _match_all(pattern_list, text: str) -> list[str]:
    return [g[0] for g in pattern_list if re.search(g[3], text, re.I)]


def _state_of(subtitle: str) -> str | None:
    s = (subtitle or "").strip()
    low = s.lower()
    if low in _STATE_ALIASES:
        return _STATE_ALIASES[low]
    for name, _ in STATES:
        if low == name.lower():
            return name
    return None


def _sha(*parts: str) -> str:
    return hashlib.sha1("\n".join(p or "" for p in parts).encode()).hexdigest()


# ------------------------------------------------------------------ normalisation
def normalize_myscheme(raw: dict) -> dict:
    slug = raw["slug"]
    state = _state_of(raw.get("subtitle", ""))
    tags = raw.get("tags", [])
    name = raw.get("name") or raw.get("title", slug)
    benefits, details, elig = (
        raw.get("benefits", ""),
        raw.get("details", ""),
        raw.get("eligibility", ""),
    )
    hay = " ".join([name, " ".join(tags), details[:600]])
    cats = (
        _match_all(CATEGORIES, " ".join([name, " ".join(tags)]))
        or _match_all(CATEGORIES, hay)
        or ["other"]
    )
    groups = _match_all(GROUPS, " ".join([name, " ".join(tags), elig[:800]]))
    strong = _match_all(GROUPS, " ".join([name, " ".join(tags)]))
    btypes = _match_all(BENEFIT_TYPES, " ".join([name, " ".join(tags), benefits[:600]])) or [
        "service"
    ]
    full = "\n".join(
        [details, benefits, elig, raw.get("application", ""), raw.get("exclusions", "")]
    )
    status, deadline, deadline_text = (
        deadline_status(full) if not raw.get("listed") else ("unknown", None, None)
    )
    apply_url = next(
        (l["url"] for l in raw.get("apply_links", []) if OFFICIAL.search(_host(l["url"]))), None
    )
    return {
        "id": f"ms:{slug}",
        "slug": slug,
        "name": name,
        "name_hi": None,
        "summary": _first_sentences(details or raw.get("snippet", "")),
        "benefit": _benefit_line(benefits, details),
        "amount": _amount(benefits or details),
        "cats": cats[:2],
        "groups": groups,
        "strong": strong,
        "btype": btypes[0],
        "tags": tags,
        "level": "state" if state else "central",
        "state": state,
        "ministry": None if state else (raw.get("subtitle") or None),
        "status": status,
        "deadline": deadline,
        "deadline_text": deadline_text,
        "tier": "listed" if raw.get("listed") else "verified",
        "read_at": raw.get("read_at"),
        "source_url": raw["url"],
        "source_name": "myScheme (NeGD, Govt. of India)",
        "official_links": raw.get("sources", [])[:4],
        "apply_url": apply_url,
        "found_live": bool(raw.get("found_live")),
        "sha": raw.get("sha"),
        "sections": None
        if raw.get("listed")
        else {
            "details": details,
            "benefits": benefits,
            "eligibility": elig,
            "exclusions": raw.get("exclusions", ""),
            "application": raw.get("application", ""),
            "documents": raw.get("documents", ""),
        },
    }


_PROVEN_CAT = {
    "pension": "pension",
    "loan": "business",
    "scholarship": "education",
    "insurance": "insurance",
    "health": "health",
}
_PROVEN_CATS = {
    "pmmvy": ["women_children", "health"],
    "ssy": ["women_children"],
    "scss": ["pension"],
    "pmuy": ["housing", "women_children"],
    "eshram": ["jobs", "pension"],
    "pm_sym": ["pension", "jobs"],
    "apy": ["pension"],
    "pm_internship": ["jobs"],
    "pm_vidyalaxmi": ["education", "business"],
    "ab_vay_vandana": ["health"],
    "nfbs": ["pension"],
    "pm_kisan": ["farming"],
    "pm_vishwakarma": ["business", "jobs"],
    "delhi_lakshmi_yojana": ["women_children"],
}


def normalize_proven(rule: dict) -> dict:
    text = " ".join(
        [
            rule["name"],
            rule.get("summary", ""),
            rule.get("category", ""),
            " ".join(rule.get("tags", [])),
        ]
    )
    first = _PROVEN_CAT.get(rule.get("category", ""))
    by_text = _match_all(CATEGORIES, rule["name"]) or _match_all(CATEGORIES, text) or ["other"]
    cats = _PROVEN_CATS.get(rule["id"]) or (
        ([first] + [c for c in by_text if c != first]) if first else by_text
    )
    conds = rule.get("conditions", []) + [c for g in rule.get("any_of", []) for c in g]
    groups = set(_match_all(GROUPS, text))
    strong = set(_match_all(GROUPS, rule["name"]))
    for c in conds:
        f, v = c.get("field"), str(c.get("value", "")).lower()
        hit = set()
        if f == "gender" and v == "female":
            hit.add("women")
        if f == "marital_status" and "widow" in v:
            hit.add("widows")
        if f == "category":
            hit.update(g for g in ("sc", "st", "obc", "minority") if g in v)
        if f == "disability":
            hit.add("disability")
        if f == "owns_cultivable_land":
            hit.add("farmers")
        if (
            f == "occupation" and "farmer" in v
        ):  # a scheme FOR farmers, not one that merely includes them
            vals = c.get("value") if isinstance(c.get("value"), list) else [c.get("value")]
            (hit if len(vals) <= 2 else groups).add("farmers")
        if f == "in_full_time_education":
            hit.add("students")
        groups |= hit
        strong |= hit
    btypes = _match_all(
        BENEFIT_TYPES,
        " ".join([rule["name"], rule.get("category", ""), rule["benefit"]["display"]]),
    )
    state = "Delhi" if rule.get("level") == "delhi" else None
    return {
        "id": rule["id"],
        "slug": None,
        "name": rule["name"],
        "name_hi": rule.get("name_hi"),
        "summary": rule.get("summary", ""),
        "benefit": rule["benefit"]["display"],
        "amount": el.scheme_value(rule)
        or int(rule["benefit"].get("cover_value") or rule["benefit"].get("loan_value") or 0),
        "cats": cats[:2],
        "groups": sorted(groups),
        "strong": sorted(strong),
        "btype": (btypes or ["service"])[0],
        "tags": [],
        "level": "state" if state else "central",
        "state": state,
        "ministry": None,
        "status": "unknown",
        "deadline": None,
        "deadline_text": None,
        "tier": "proven",
        "read_at": rule.get("verified_on"),
        "source_url": rule.get("source_url"),
        "source_name": rule.get("source_title") or "Official page",
        "official_links": [],
        "apply_url": rule.get("apply_url"),
        "found_live": False,
        "sha": None,
        "sections": {
            "details": rule.get("summary", ""),
            "benefits": rule["benefit"]["display"],
            "eligibility": "\n".join(c["label"] for c in conds if c.get("label")),
            "exclusions": "",
            "application": f"Apply at {rule.get('apply_url')}" if rule.get("apply_url") else "",
            "documents": "",
        },
    }


def _host(url: str) -> str:
    m = re.match(r"https?://([^/]+)", url or "")
    return m.group(1).lower() if m else ""


# ------------------------------------------------------------------ official deadlines: the NSP scheme list
_NSP_BLOCK = re.compile(
    r"#{3,6}\s*([^\n#]{8,}?)\s*\((?:Merit|Welfare) Based Scheme\)(.*?)(?=#{3,6}|\Z)", re.S
)
_NSP_FROM = re.compile(r"Scheme Open from[^:]*:\s*(\d{2}-\d{2}-\d{4})")
_NSP_TILL = re.compile(r"Student Application Open till[^:]*:\s*(\d{2}-\d{2}-\d{4})")
_OPPOSITES = [
    ("pre", "post"),
    ("degree", "diploma"),
    ("ug", "pg"),
    ("school", "college"),
    ("sc", "st"),
    ("sc", "obc"),
    ("st", "obc"),
    ("schools", "college"),
]


def parse_nsp(text: str) -> list[dict]:
    """The NSP 'Schemes on NSP' page → [{name, open_from, apply_till, renewal}] (dates as ISO)."""
    out = []
    for m in _NSP_BLOCK.finditer(text):
        name, body = re.sub(r"\s+", " ", m.group(1)).strip(), m.group(2)
        f, t = _NSP_FROM.search(body), _NSP_TILL.search(body)
        if not t:
            continue
        iso = lambda s: f"{s[6:10]}-{s[3:5]}-{s[0:2]}"  # noqa: E731
        out.append(
            {
                "name": name,
                "open_from": iso(f.group(1)) if f else None,
                "apply_till": iso(t.group(1)),
                "renewal": "for Renewal" in body,
            }
        )
    return out


def _nsp_snapshot() -> dict | None:
    snap = db.cache_get("catalog:nsp")
    if snap:
        return snap
    return json.loads(NSP_FILE.read_text(encoding="utf-8")) if NSP_FILE.exists() else None


_NAME_STOP = set(
    "scheme schemes scholarship scholarships for of the and to in on based merit welfare student students "
    "yojana programme".split()
)


def _tokens(name: str) -> set[str]:
    words = re.findall(r"[a-z]+", name.lower().replace("&", " and "))
    return {
        w[:-1] if len(w) > 4 and w.endswith("s") else w for w in words if len(w) > 1
    } - _NAME_STOP


def _nsp_match(name: str, entries: list[dict]) -> dict | None:
    """Same scheme? Most of the distinctive words must agree, and no opposite pair (pre/post, degree/diploma…)."""
    a = _tokens(name)
    best, score = None, 0.0
    for e in entries:
        b = _tokens(e["name"])
        if not a or not b or any((x in a and y in b) or (y in a and x in b) for x, y in _OPPOSITES):
            continue  # "Pre-Matric" must never borrow the "Post-Matric" deadline
        j = len(a & b) / len(a | b)
        if j > score:
            best, score = e, j
    return best if score >= 0.6 else None


def _nsp_status(e: dict, today: date | None = None) -> str:
    today = today or date.today()
    till = date.fromisoformat(e["apply_till"])
    if e.get("open_from") and date.fromisoformat(e["open_from"]) > today:
        return "upcoming"
    if till < today:
        return "date_passed"
    return "closing_soon" if (till - today).days <= 14 else "open"


def _apply_nsp(rows: list[dict]) -> None:
    snap = _nsp_snapshot()
    if not snap:
        return
    entries, matched = snap["schemes"], set()
    for r in rows:
        if "education" not in r["cats"]:
            continue
        e = _nsp_match(r["name"], entries)
        if e:
            matched.add(e["name"])
            _set_nsp(r, e, snap)
    for e in (
        entries
    ):  # NSP schemes we have no page for yet: still worth listing, with their official dates
        if e["name"] not in matched:
            row = normalize_myscheme(
                {
                    "slug": None,
                    "url": NSP_URL,
                    "name": e["name"],
                    "listed": True,
                    "snippet": "Listed on the National Scholarship Portal.",
                }
            )
            row.update(
                id="nsp:" + re.sub(r"[^a-z0-9]+", "-", e["name"].lower()).strip("-")[:80],
                slug=None,
                source_name="National Scholarship Portal",
                groups=_match_all(GROUPS, e["name"]) or ["students"],
                strong=_match_all(GROUPS, e["name"]) or ["students"],
                cats=["education"],
                btype="scholarship",
                benefit="Scholarship on the National Scholarship Portal",
            )
            _set_nsp(row, e, snap)
            rows.append(row)


def _set_nsp(r: dict, e: dict, snap: dict) -> None:
    r["status"], r["deadline"] = _nsp_status(e), e["apply_till"]
    when = "renewal applications" if e.get("renewal") else "applications"
    r["deadline_text"] = (
        f"National Scholarship Portal: {when} open from {e.get('open_from') or '—'} till {e['apply_till']}"
    )
    r["deadline_source"] = {
        "name": "National Scholarship Portal",
        "url": NSP_URL,
        "read_at": snap.get("fetched_at"),
        "via": snap.get("via", "TinyFish Fetch"),
    }
    r["apply_url"] = r.get("apply_url") or "https://scholarships.gov.in/"


async def refresh_deadlines() -> dict:
    """Re-read the official NSP list (TinyFish Fetch, free), raise an alert for every deadline that changed."""
    old = _nsp_snapshot()
    try:
        res = await tinyfish.fetch(
            [NSP_URL],
            purpose="Official scholarship deadlines on the National Scholarship Portal",
            ttl=0,
        )
    except TinyFishUnavailable as exc:
        return {"ok": False, "error": str(exc), "fetched_at": (old or {}).get("fetched_at")}
    text = ((res.get("results") or [{}])[0]).get("text") or ""
    schemes = parse_nsp(text)
    if not schemes:
        return {
            "ok": False,
            "error": "the NSP list could not be read",
            "fetched_at": (old or {}).get("fetched_at"),
        }
    replay = bool(res.get("_replay"))
    snap = {
        "fetched_at": time.time(),
        "url": NSP_URL,
        "via": "TinyFish Fetch",
        "replay": replay,
        "schemes": schemes,
    }
    changes = []
    before = {e["name"]: e for e in (old or {}).get("schemes", [])}
    for e in schemes:
        p = before.get(e["name"])
        if p and p["apply_till"] != e["apply_till"]:
            changes.append(
                {
                    "name": e["name"],
                    "what": "deadline",
                    "before": p["apply_till"],
                    "after": e["apply_till"],
                }
            )
        elif not p and old:
            changes.append(
                {"name": e["name"], "what": "opened", "before": None, "after": e["apply_till"]}
            )
    if not replay:
        db.cache_set("catalog:nsp", snap)
    invalidate()
    INDEX.ensure()
    for c in changes:
        row = next(
            (
                r
                for r in INDEX.rows
                if r.get("deadline_source") and _nsp_match(r["name"], [{"name": c["name"]}])
            ),
            None,
        )
        verb = "deadline moved" if c["what"] == "deadline" else "now open on NSP"
        title = f"{c['name']}: {verb} — apply till {c['after']}"[:160]
        if not db.query(
            "SELECT 1 FROM alerts WHERE source_id = 'nsp_deadlines' AND title = ?", (title,)
        ):
            db.execute(
                "INSERT INTO alerts (ts, source_id, url, kind, title, summary, affects, evidence) VALUES (?,?,?,?,?,?,?,?)",
                (
                    time.time(),
                    "nsp_deadlines",
                    NSP_URL,
                    "deadline",
                    title,
                    json.dumps(c),
                    json.dumps(["student"]),
                    json.dumps(
                        {
                            "via": "fetch",
                            "replay": replay,
                            "scheme_ids": [row["id"]] if row else [],
                            "importance": 3,
                            "dates": [c["after"]],
                            "change": c,
                        }
                    ),
                ),
            )
    return {
        "ok": True,
        "fetched_at": snap["fetched_at"],
        "schemes": len(schemes),
        "changes": changes,
        "replay": replay,
    }


def deadlines_info() -> dict:
    snap = _nsp_snapshot() or {}
    rows = snap.get("schemes", [])
    return {
        "fetched_at": snap.get("fetched_at"),
        "schemes": len(rows),
        "url": NSP_URL,
        "replay": snap.get("replay", False),
        # the official open / last dates, soonest last date first
        "items": sorted(
            (
                {k: s.get(k) for k in ("name", "open_from", "apply_till", "renewal")}
                for s in rows
                if s.get("apply_till")
            ),
            key=lambda s: s["apply_till"],
        )[:60],
    }


# ------------------------------------------------------------------ the index
class _Index:
    def __init__(self) -> None:
        self.lock = threading.RLock()
        self.rows: list[dict] = []
        self.by_id: dict[str, dict] = {}
        self.fts: sqlite3.Connection | None = None
        self.built_at = 0.0
        self.dirty = True
        self.file_mtime = 0.0

    def ensure(self) -> None:
        with self.lock:
            mtime = CATALOG_FILE.stat().st_mtime if CATALOG_FILE.exists() else 0.0
            if self.dirty or mtime != self.file_mtime:  # the crawler added pages: pick them up
                self.file_mtime = mtime
                self._build()

    def _build(self) -> None:
        raw: dict[str, dict] = (
            json.loads(CATALOG_FILE.read_text(encoding="utf-8")) if CATALOG_FILE.exists() else {}
        )
        for r in db.query("SELECT key, value FROM cache WHERE key LIKE 'catalog:item:%'"):
            item = json.loads(r["value"])
            if (
                item.get("listed") and item["slug"] in raw
            ):  # never downgrade a read page to a bare listing
                continue
            raw[item["slug"]] = item
        rows = [normalize_proven(r) for r in el.load_schemes()]
        proven_names = {_key(r["name"]): r for r in rows}
        for item in raw.values():
            row = normalize_myscheme(item)
            twin = _twin(row, proven_names)
            if twin:  # the same scheme as one of our proven rules: keep the proof, add the official myScheme text
                twin["myscheme_url"] = row["source_url"]
                if row["sections"]:
                    twin["sections"] = {
                        **row["sections"],
                        "eligibility": twin["sections"]["eligibility"],
                    }
                continue
            rows.append(row)
        _apply_nsp(rows)
        for r in rows:
            chk = db.cache_get(f"catalog:check:{r['id']}")
            r["checked_at"] = chk.get("checked_at") if chk else None
        fts = sqlite3.connect(":memory:", check_same_thread=False)
        fts.execute(
            "CREATE VIRTUAL TABLE s USING fts5(id UNINDEXED, name, body, tokenize='porter unicode61')"
        )
        fts.executemany(
            "INSERT INTO s (id, name, body) VALUES (?,?,?)",
            [
                (
                    r["id"],
                    f"{r['name']} {r.get('name_hi') or ''}",
                    " ".join(
                        [
                            r["summary"],
                            r["benefit"],
                            " ".join(r["tags"]),
                            r.get("state") or "",
                            r.get("ministry") or "",
                            (r["sections"] or {}).get("eligibility", "")[:1500],
                        ]
                    ),
                )
                for r in rows
            ],
        )
        self.rows, self.by_id, self.fts = rows, {r["id"]: r for r in rows}, fts
        self.built_at, self.dirty = time.time(), False

    def text_search(self, q: str) -> dict[str, float]:
        toks = [t for t in re.findall(r"[\w]+", q.lower()) if len(t) > 1]
        if not toks:
            return {}
        with self.lock:
            for joiner in (" AND ", " OR "):
                expr = joiner.join(f'"{t}"*' for t in toks)
                try:
                    hits = self.fts.execute(
                        "SELECT id, bm25(s, 8.0, 1.0) FROM s WHERE s MATCH ? ORDER BY 2 LIMIT 400",
                        (expr,),
                    ).fetchall()
                except sqlite3.OperationalError:
                    hits = []
                if hits:
                    return {i: -score for i, score in hits}
        return {}


def _key(name: str) -> str:
    return re.sub(r"\(.*?\)|[^a-z0-9 ]", " ", name.lower()).strip()


def _twin(ms_row: dict, proven: dict[str, dict]) -> dict | None:
    """The myScheme page of one of our proven schemes — same name AND same level/state (a state's version of a
    central scheme, e.g. "IGNWPS (Maharashtra)", is a different page with different amounts)."""
    from rapidfuzz import fuzz

    k = _key(ms_row["name"])
    best, score = None, 0
    for pk, row in proven.items():
        if row["state"] != ms_row["state"]:
            continue
        s = fuzz.token_sort_ratio(k, pk)
        if s > score:
            best, score = row, s
    return best if score >= 90 else None


INDEX = _Index()


def invalidate() -> None:
    INDEX.dirty = True


def stats() -> dict:
    INDEX.ensure()
    tiers: dict[str, int] = {}
    for r in INDEX.rows:
        tiers[r["tier"]] = tiers.get(r["tier"], 0) + 1
    states = {r["state"] for r in INDEX.rows if r["state"]}
    return {
        "total": len(INDEX.rows),
        "tiers": tiers,
        "states": len(states),
        "central": sum(1 for r in INDEX.rows if r["level"] == "central"),
        "built_at": INDEX.built_at,
    }


# ------------------------------------------------------------------ search with facets
FACETS = ("cat", "where", "group", "status", "btype", "tier")


def _facet_values(r: dict, f: str) -> list[str]:
    if f == "cat":
        return r["cats"]
    if f == "where":
        return [r["state"]] if r["state"] else ["central"]
    if f == "group":
        return r["groups"]
    if f == "status":
        return [r["status"]]
    if f == "btype":
        return [r["btype"]]
    return [r["tier"]]


def _passes(r: dict, filters: dict[str, list[str]], skip: str | None = None) -> bool:
    for f, wanted in filters.items():
        if f == skip or not wanted:
            continue
        vals = _facet_values(r, f)
        if f == "status" and "live" in wanted:
            wanted = [w for w in wanted if w != "live"] + ["open", "closing_soon"]
        if not set(vals) & set(wanted):
            return False
    return True


def search(
    q: str = "",
    filters: dict[str, list[str]] | None = None,
    sort: str = "best",
    page: int = 0,
    per_page: int = 20,
    eligible: list[str] | None = None,
    lang: str = "en",
) -> dict:
    INDEX.ensure()
    filters = {k: [v for v in vs if v] for k, vs in (filters or {}).items() if k in FACETS}
    elig = set(eligible or [])
    scores = INDEX.text_search(q) if q.strip() else None
    base = [r for r in INDEX.rows if scores is None or r["id"] in scores]
    hits = [r for r in base if _passes(r, filters)]

    status_rank = {"closing_soon": 0, "open": 1, "upcoming": 2, "unknown": 3, "date_passed": 4}
    tier_rank = {"proven": 0, "verified": 1, "listed": 2}
    if sort == "deadline":
        hits.sort(
            key=lambda r: (
                r["id"] not in elig,
                r["deadline"] is None or r["status"] == "date_passed",
                r["deadline"] or "",
                tier_rank[r["tier"]],
                r["name"],
            )
        )
    elif sort == "benefit":
        hits.sort(key=lambda r: (-r["amount"], r["name"]))
    elif sort == "newest":
        hits.sort(key=lambda r: (r["read_at"] or ""), reverse=True)
    elif sort == "name":
        hits.sort(key=lambda r: r["name"].lower())
    else:  # best: what you qualify for, then fit with the chosen groups/state, text relevance, urgency and proof
        want_groups, want_states = (
            set(filters.get("group", [])),
            {w for w in filters.get("where", []) if w != "central"},
        )
        hits.sort(
            key=lambda r: (
                r["id"] not in elig,
                -len(want_groups & set(r.get("strong", []))),
                -len(want_groups & set(r["groups"])),
                r["state"] not in want_states if want_states else 0,
                -(scores or {}).get(r["id"], 0),
                status_rank[r["status"]],
                tier_rank[r["tier"]],
                r["name"].lower(),
            )
        )

    facets: dict[str, list[dict]] = {}
    for f in FACETS:
        counts: dict[str, int] = {}
        for r in base:
            if _passes(r, filters, skip=f):
                for v in _facet_values(r, f):
                    counts[v] = counts.get(v, 0) + 1
        facets[f] = sorted(
            ({"value": v, "count": n, "label": _label(f, v, lang)} for v, n in counts.items()),
            key=lambda x: (x["value"] != "central" if f == "where" else 0, -x["count"], x["label"]),
        )
    start = page * per_page
    return {
        "total": len(hits),
        "page": page,
        "per_page": per_page,
        "q": q,
        "filters": filters,
        "sort": sort,
        "items": [_card(r, elig, lang) for r in hits[start : start + per_page]],
        "facets": facets,
        "stats": stats(),
    }


def _label(f: str, v: str, lang: str) -> str:
    i = 1 if lang == "hi" else 0
    table = {
        "cat": CAT_LABEL,
        "group": GROUP_LABEL,
        "status": STATUS_LABEL,
        "btype": BTYPE_LABEL,
        "tier": TIER_LABEL,
    }.get(f)
    if f == "where":
        return (
            ("Central (all India)", "केंद्र (पूरा भारत)")[i]
            if v == "central"
            else (STATE_HI.get(v, v) if i else v)
        )
    return table[v][i] if table and v in table else v


def _card(r: dict, elig: set[str], lang: str) -> dict:
    keys = (
        "id",
        "name",
        "name_hi",
        "summary",
        "benefit",
        "amount",
        "cats",
        "groups",
        "btype",
        "level",
        "state",
        "ministry",
        "status",
        "deadline",
        "deadline_text",
        "tier",
        "read_at",
        "checked_at",
        "source_url",
        "source_name",
        "apply_url",
        "found_live",
        "deadline_source",
    )
    return {
        **{k: r.get(k) for k in keys},
        "you_qualify": r["id"] in elig,
        "cat_labels": [_label("cat", c, lang) for c in r["cats"]],
    }


def detail(scheme_id: str, lang: str = "en") -> dict | None:
    INDEX.ensure()
    r = INDEX.by_id.get(scheme_id)
    if not r:
        return None
    return {
        **_card(r, set(), lang),
        "sections": r["sections"],
        "official_links": r["official_links"],
        "tags": r["tags"],
        "myscheme_url": r.get("myscheme_url"),
        "group_labels": [_label("group", g, lang) for g in r["groups"]],
        "check": db.cache_get(f"catalog:check:{scheme_id}"),
    }


# ------------------------------------------------------------------ command bar: words → filters
_STOP = set(
    """a an the all any show me get find list give please of for in on to with and or is are was which what that
those these this that it its who whom my our i we am can could do does schemes scheme yojana yojanas yojna programme programs program
benefits benefit available currently right now today wali wale vali vale ki ke ka ko se me mein kya hai hain mujhe hamein
batao dikhao sabhi saari sari please plz closing close month near soon deadline only also state states government govt
sarkari next near बंद होने होनी help helps support supports assistance assist need needs want looking financial aid
madad sahayata yojanaen people person persons family families someone anyone new-scheme जल्द मदद सहायता चाहिए मुझे सभी सारी योजना योजनाएँ योजनाएं की के का को से में पर और है हैं दिखाओ बताओ कौन सी वाली वाले लिए सरकारी
free preparing prepare preparation how where when about regarding information info details apply applying eligible kaise kahan""".split()
)

_CAT_WORDS = {
    "education": "scholarship scholarships scholar chhatravritti छात्रवृत्ति education shiksha शिक्षा padhai पढ़ाई fellowship college school coaching",
    "pension": "pension pensions पेंशन vridha वृद्धा oldage",
    "health": "health swasthya स्वास्थ्य ilaj इलाज medical hospital treatment",
    "farming": "farming agriculture krishi कृषि crop crops fasal फसल fisheries dairy",
    "jobs": "job jobs naukri नौकरी rozgar rojgar रोज़गार रोजगार employment skill skills training kaushal कौशल internship",
    "business": "loan loans karz karza ऋण लोन business vyapar व्यापार startup msme entrepreneur dukaan",
    "housing": "house housing ghar घर awas आवास makaan electricity bijli बिजली lpg",
    "women_children": "maternity pregnant child children bachche बच्चे marriage shaadi शादी",
    "insurance": "insurance bima बीमा",
}
_GROUP_WORDS = {
    "sc": "sc dalit अनुसूचित-जाति",
    "st": "st tribal adivasi आदिवासी",
    "obc": "obc पिछड़ा backward",
    "minority": "minority minorities alpsankhyak अल्पसंख्यक",
    "disability": "disabled disability divyang दिव्यांग दिव्यांगजन handicapped viklang विकलांग",
    "widows": "widow widows vidhwa विधवा",
    "senior": "senior seniors elderly buzurg बुज़ुर्ग बुजुर्ग old",
    "students": "student students vidyarthi छात्र छात्रा विद्यार्थी",
    "women": "women woman mahila महिला महिलाओं ladies",
    "girls": "girl girls beti betiyon बेटी बेटियों ladki लड़की daughter daughters",
    "farmers": "farmer farmers kisan किसान",
    "workers": "worker workers labour labourer majdoor मज़दूर मजदूर shramik श्रमिक",
    "low_income": "bpl poor garib गरीब",
    "youth": "youth yuva युवा unemployed berozgar बेरोज़गार",
    "entrepreneurs": "entrepreneur entrepreneurs udyami उद्यमी उद्यमियों",
}
_PHRASES: list[tuple[str, str, str]] = [  # multi-word phrases, checked before single words
    ("group", "sc", "scheduled caste"),
    ("group", "sc", "अनुसूचित जाति"),
    ("group", "st", "scheduled tribe"),
    ("group", "st", "अनुसूचित जनजाति"),
    ("group", "senior", "senior citizen"),
    ("group", "senior", "वरिष्ठ नागरिक"),
    ("group", "senior", "old age"),
    ("cat", "pension", "old age"),
    ("group", "low_income", "below poverty"),
    ("group", "disability", "persons with disabilit"),
    ("cat", "health", "health insurance"),
    ("group", "girls", "girl child"),
    ("cat", "women_children", "girl child"),
]
_LIVE = set("live open active current chalu चालू abhi अभी ongoing running".split())
_SOON = (
    "closing soon",
    "this month",
    "is mahine",
    "इस महीने",
    "deadline near",
    "last date near",
    "closing this month",
)
_NEW = set("new latest naya नया नई recent today".split())
_ELIG = ("eligible", "qualify", "patra", "पात्र", "for me", "mere liye", "मेरे लिए", "can i get")
_CENTRAL = set("central kendra केंद्र national".split())


def _norm(word: str) -> str:
    return word.lower().strip(".,!?;:'\"")


_HI_SUFFIXES = sorted(
    ["ियाँ", "ियां", "ियों", "ाओं", "ओं", "ों", "ें", "ीं", "ी", "ि", "ा", "े", "ाँ", "ां"],
    key=len,
    reverse=True,
)


def _hi_stem(w: str) -> str:
    """Hindi plural/gender endings → one stem (छात्रवृत्तियाँ, छात्रवृत्ति → छात्रवृत्त; किसानों → किसान; खुली/खुले → खुल)."""
    if not re.search(r"[ऀ-ॿ]", w):
        return w
    for suf in _HI_SUFFIXES:
        if w.endswith(suf) and len(w) - len(suf) >= 2:
            return w[: -len(suf)]
    return w


def _in_vocab(w: str, vocab: str) -> bool:
    words = vocab.split()
    return w in words or (_hi_stem(w) != w and _hi_stem(w) in {_hi_stem(v) for v in words})


def parse_command(text: str) -> dict:
    """Turn a sentence ("scholarships for SC girls in Delhi that are open") into filters. Deterministic: it can only
    filter the catalogue, never invent a scheme."""
    low = " " + text.lower() + " "
    filters: dict[str, list[str]] = {}
    used: set[str] = set()
    explain: list[dict] = []

    def take(facet: str, value: str, word: str) -> None:
        if value not in filters.setdefault(facet, []):
            filters[facet].append(value)
            explain.append({"facet": facet, "value": value})
        used.add(word)

    words = [_norm(w) for w in re.findall(r"[\wऀ-ॿ&-]+", low)]
    for facet, value, phrase in _PHRASES:
        if phrase in low:
            take(facet, value, phrase)
            used.update(phrase.split())
    for name, hi_name in STATES:
        for alias in (name.lower(), hi_name):
            if f" {alias} " in low:
                take("where", name, alias)
                used.update(alias.split())
    for alias, name in _STATE_ALIASES.items():
        if f" {alias} " in low and len(alias) > 2:
            take("where", name, alias)
    for w in words:
        if w in _CENTRAL:
            take("where", "central", w)
        for cat, vocab in _CAT_WORDS.items():
            if _in_vocab(w, vocab):
                take("cat", cat, w)
        for grp, vocab in _GROUP_WORDS.items():
            if _in_vocab(w, vocab):
                take("group", grp, w)
        if w in _LIVE or _in_vocab(w, "खुली खुला चालू"):
            take("status", "live", w)
    if any(p in low for p in _SOON):
        take("status", "closing_soon", "soon")
        used.update(w for p in _SOON if p in low for w in p.split())
        filters["status"] = [s for s in filters["status"] if s != "live"]
    states = [w for w in filters.get("where", []) if w != "central"]
    if states and "central" not in filters["where"] and " only" not in low:
        filters["where"].append(
            "central"
        )  # a resident of a state can also get every central scheme
    intent = "eligible" if any(p in low for p in _ELIG) else "list"
    sort = (
        "deadline"
        if "status" in filters
        else ("newest" if any(w in _NEW for w in words) else "best")
    )
    rest = [
        w
        for w in words
        if w not in used
        and w not in _STOP
        and w not in _NEW
        and w not in _LIVE
        and not any(w in p.split() for p in _ELIG)
        and len(w) > 1
        and not w.isdigit()
    ]
    return {
        "filters": filters,
        "q": " ".join(rest),
        "intent": intent,
        "sort": sort,
        "explain": explain,
        "live": any(w in _NEW for w in words)
        or "live" in words
        or "internet" in words
        or "web" in words,
    }


# ------------------------------------------------------------------ live discovery (TinyFish Search → Fetch → Browser)
READ_JS = None  # set lazily from the crawler so both read pages identically


def _read_js() -> str:
    global READ_JS
    if READ_JS is None:
        import importlib.util

        p = DATA_DIR.parents[1] / "scripts" / "crawl_myscheme.py"
        spec = importlib.util.spec_from_file_location("crawl_myscheme", p)
        mod = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(mod)  # type: ignore[union-attr]
        READ_JS = mod.EXTRACT_JS
    return READ_JS


def _terms(parsed: dict) -> str:
    f = parsed["filters"]
    words = [parsed["q"]]
    words += [
        {
            "education": "scholarship",
            "pension": "pension",
            "health": "health",
            "farming": "farmers",
            "jobs": "employment skill",
            "business": "loan",
            "housing": "housing",
            "women_children": "women child",
            "insurance": "insurance",
        }.get(c, c)
        for c in f.get("cat", [])
    ]
    words += [GROUP_LABEL[g][0] for g in f.get("group", []) if g in GROUP_LABEL]
    words += [w for w in f.get("where", []) if w != "central"]
    return " ".join(w for w in words if w).strip() or "government scheme"


async def read_pages(
    slugs_urls: list[tuple[str, str]], emit, purpose: str
) -> dict[str, dict | None]:
    """Open myScheme pages on one TinyFish Browser session (Indian exit IP) and read the official sections."""
    from playwright.async_api import async_playwright

    out: dict[str, dict | None] = {}
    if not slugs_urls:
        return out
    tf = await tinyfish.browser_create(slugs_urls[0][1], timeout_seconds=300, purpose=purpose)
    pw = await async_playwright().start()
    try:
        browser = await pw.chromium.connect_over_cdp(tf["cdp_url"])
        page = browser.contexts[0].pages[0]
        for i, (slug, url) in enumerate(slugs_urls):
            await emit(
                {
                    "phase": "progress",
                    "step": "read",
                    "message": f"Reading {i + 1} of {len(slugs_urls)} on a TinyFish Browser",
                    "url": url,
                    "session_id": tf["session_id"],
                }
            )
            try:
                if i:
                    await page.goto(url, wait_until="domcontentloaded", timeout=30000)
                await page.wait_for_selector("#eligibility, #details", timeout=20000)
                await page.wait_for_timeout(600)
                data = await page.evaluate(_read_js())
            except Exception:  # noqa: BLE001 - one bad page must not stop the rest
                data = None
            if data and data.get("name") and (data.get("eligibility") or data.get("benefits")):
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
                    slug=slug, url=url, read_at=time.strftime("%Y-%m-%d %H:%M"), sha=_sha(body)
                )
                out[slug] = data
            else:
                out[slug] = None
        await browser.close()
    finally:
        await pw.stop()
        await tinyfish.browser_close(tf["session_id"])
    return out


async def live_search(text: str, job, read_limit: int = 3) -> dict:
    parsed = parse_command(text)
    terms = _terms(parsed)
    emit = job.emit
    INDEX.ensure()
    known = {r["slug"]: r for r in INDEX.rows if r.get("slug")}
    result: dict[str, Any] = {
        "terms": terms,
        "new": [],
        "already": [],
        "official": [],
        "ignored": 0,
        "replay": False,
    }

    await emit(
        {
            "phase": "progress",
            "step": "search",
            "message": f"Searching myScheme for “{terms}” with TinyFish Search",
        }
    )
    queries = [
        (f"site:myscheme.gov.in/schemes {terms}", "myscheme"),
        (f"site:gov.in {terms} scheme last date apply", "official"),
    ]
    hits: list[tuple[str, dict]] = []
    for q, kind in queries:
        try:
            res = await tinyfish.search(q, purpose=f"JAAGRUK Explore live search: {text[:200]}")
        except TinyFishUnavailable as exc:
            await emit(
                {
                    "phase": "progress",
                    "step": "search",
                    "message": f"Live search unavailable: {exc}",
                }
            )
            continue
        result["replay"] = result["replay"] or bool(res.get("_replay"))
        hits += [(kind, it) for it in res.get("results", [])]

    new_slugs: list[tuple[str, str]] = []
    official_urls: list[str] = []
    for kind, it in hits:
        url = (it.get("url") or "").split("?")[0]
        m = MYSCHEME.match(url)
        if m:
            slug = m.group(1)
            if slug in known:
                result["already"].append(known[slug]["id"])
            elif slug not in [s for s, _ in new_slugs]:
                new_slugs.append((slug, url))
                listed = {
                    "slug": slug,
                    "url": url,
                    "name": _clean_title(it.get("title", slug)),
                    "snippet": it.get("snippet", ""),
                    "listed": True,
                    "found_live": True,
                    "read_at": time.strftime("%Y-%m-%d %H:%M"),
                }
                db.cache_set(f"catalog:item:{slug}", listed)
        elif OFFICIAL.search(_host(url)):
            if url not in official_urls:
                official_urls.append(url)
                result["official"].append(
                    {
                        "title": it.get("title", ""),
                        "url": url,
                        "snippet": it.get("snippet", ""),
                        "date": it.get("date"),
                        "deadline": None,
                    }
                )
        else:
            result["ignored"] += (
                1  # not an official domain: never shown as a scheme
            )
    await emit(
        {
            "phase": "progress",
            "step": "found",
            "message": f"Found {len(new_slugs)} new myScheme pages, {len(set(result['already']))} already in JAAGRUK, "
            f"{len(official_urls)} official pages · {result['ignored']} non-official results ignored",
        }
    )

    if official_urls:  # free: read official pages for a "last date"
        await emit(
            {
                "phase": "progress",
                "step": "fetch",
                "message": f"Reading {min(6, len(official_urls))} official pages with TinyFish Fetch",
            }
        )
        try:
            fr = await tinyfish.fetch(
                official_urls[:6],
                purpose="Find application deadlines on official scheme pages",
                ttl=3600,
            )
            by = {r.get("url", "").split("?")[0]: r for r in fr.get("results", [])}
            for o in result["official"]:
                page = by.get(o["url"])
                if page and page.get("text"):
                    st, dl, ctx = deadline_status(page["text"])
                    o.update(status=st, deadline=dl, deadline_text=ctx)
        except TinyFishUnavailable:
            pass

    read = new_slugs[:read_limit]
    if read and tinyfish.live:
        try:
            pages = await read_pages(
                read, emit, purpose="Explore live search: read new myScheme pages"
            )
        except Exception as exc:  # noqa: BLE001
            pages = {}
            await emit(
                {
                    "phase": "progress",
                    "step": "read",
                    "message": f"Could not open a TinyFish Browser: {exc}",
                }
            )
        for slug, data in pages.items():
            if data:
                data.update(found_live=True)
                db.cache_set(f"catalog:item:{slug}", data)
    invalidate()
    INDEX.ensure()
    result["new"] = [
        _card(INDEX.by_id[f"ms:{s}"], set(), "en") for s, _ in new_slugs if f"ms:{s}" in INDEX.by_id
    ]
    result["already"] = sorted(set(result["already"]))
    # matching schemes JAAGRUK had already read, so the user can open them straight away
    result["already_items"] = [
        {"id": i, "name": INDEX.by_id[i].get("name")} for i in result["already"] if i in INDEX.by_id
    ][:10]
    await emit(
        {
            "phase": "progress",
            "step": "done",
            "message": f"Added {sum(1 for c in result['new'] if c['tier'] == 'verified')} schemes with full details "
            f"and {sum(1 for c in result['new'] if c['tier'] == 'listed')} listings to JAAGRUK",
        }
    )
    return result


def _clean_title(t: str) -> str:
    return re.sub(r"\s*[|\-–]\s*myScheme.*$", "", t or "", flags=re.I).strip()


# ------------------------------------------------------------------ re-check: did a deadline or rule change?
_SECTION_NAMES = {
    "eligibility": "eligibility",
    "benefits": "benefits",
    "application": "how to apply",
    "documents": "documents",
    "exclusions": "exclusions",
    "details": "details",
}


async def recheck(ids: list[str], job) -> dict:
    """Re-read tracked schemes. myScheme pages: TinyFish Browser + section diff. Proven rules: Fetch + Z3 (existing)."""
    from . import discover

    INDEX.ensure()
    out = []
    ms = [(i, INDEX.by_id[i]) for i in ids if i in INDEX.by_id and INDEX.by_id[i].get("slug")][:6]
    proven = [i for i in ids if i in INDEX.by_id and INDEX.by_id[i]["tier"] == "proven"][:4]
    out += [
        {
            "id": i,
            "outcome": "unknown",
            "changes": [],
            "error": "not in the catalogue",
            "checked_at": time.time(),
            "replay": False,
        }
        for i in ids
        if i not in INDEX.by_id
    ]
    for pid in proven:
        await job.emit(
            {
                "phase": "progress",
                "message": f"Re-checking {INDEX.by_id[pid]['name']} against the official page (TinyFish Fetch + Z3)",
            }
        )
        r = await discover.refresh_rule(pid)
        outcome = (
            "unreachable"
            if not r.get("ok")
            else ("changed" if r.get("status") == "needs_review" else "unchanged")
        )
        out.append(_record_check(pid, outcome, [], r.get("error"), r.get("replay", False)))
    if ms:
        try:
            pages = await read_pages(
                [(r["slug"], r["source_url"]) for _, r in ms],
                job.emit,
                purpose="Re-check tracked schemes for deadline and rule changes",
            )
        except Exception as exc:  # noqa: BLE001
            pages = {}
            await job.emit({"phase": "progress", "message": f"TinyFish Browser unavailable: {exc}"})
        for sid, row in ms:
            data = pages.get(row["slug"])
            if not data:
                out.append(
                    _record_check(sid, "unreachable", [], "the page could not be read", False)
                )
                continue
            new = normalize_myscheme(data)
            changes = _diff(row, new)
            if row["tier"] == "listed":
                # first full read of a newly found page: discovery, not a change to reviewed data
                db.cache_set(f"catalog:item:{row['slug']}", {**data, "found_live": row.get("found_live", False)})
            elif changes:
                # a public read never silently replaces what people already rely on: it becomes a review candidate
                db.cache_set(
                    f"catalog:candidate:{row['slug']}",
                    {"id": sid, "data": {**data, "found_live": row.get("found_live", False)}, "changes": changes, "read_at": time.time()},
                )
            outcome = "read" if row["tier"] == "listed" else ("changed" if changes else "unchanged")
            if changes and row["tier"] != "listed":
                _alert(new, changes)
            out.append(_record_check(sid, outcome, changes, None, False))
    invalidate()
    return {"results": out}


def _diff(old: dict, new: dict) -> list[dict]:
    if old["tier"] == "listed" or not old.get("sections"):
        return []
    changes = []
    if old.get("deadline") != new.get("deadline"):
        changes.append(
            {
                "what": "deadline",
                "before": old.get("deadline"),
                "after": new.get("deadline"),
                "text": new.get("deadline_text"),
            }
        )
    for k, label in _SECTION_NAMES.items():
        a, b = (old["sections"] or {}).get(k, ""), (new["sections"] or {}).get(k, "")
        if _sha(a) != _sha(b):
            changes.append({"what": label, "before": a[:400], "after": b[:400]})
    return changes


def _alert(row: dict, changes: list[dict]) -> None:
    kind = (
        "deadline"
        if any(c["what"] == "deadline" for c in changes)
        else "eligibility"
        if any(c["what"] == "eligibility" for c in changes)
        else "new_notification"
    )
    what = ", ".join(c["what"] for c in changes)
    title = f"{row['name']}: {what} changed on the official page — pending review"[:160]
    db.execute(
        "INSERT INTO alerts (ts, source_id, url, kind, title, summary, affects, evidence) VALUES (?,?,?,?,?,?,?,?)",
        (
            time.time(),
            "explore",
            row["source_url"],
            kind,
            title,
            json.dumps(changes)[:2000],
            json.dumps([]),
            json.dumps(
                {
                    "via": "browser",
                    "replay": False,
                    "scheme_ids": [row["id"]],
                    "importance": 3,
                    "dates": [row["deadline"]] if row.get("deadline") else [],
                    "changes": changes,
                }
            ),
        ),
    )


def _record_check(
    sid: str, outcome: str, changes: list[dict], error: str | None, replay: bool
) -> dict:
    rec = {
        "id": sid,
        "outcome": outcome,
        "changes": changes,
        "error": error,
        "checked_at": time.time(),
        "replay": replay,
    }
    db.cache_set(f"catalog:check:{sid}", rec)
    return rec


def due_for_check(ids: list[str], max_age_h: float = 24) -> list[str]:
    """Tracked schemes whose last check is older than max_age_h (the app re-checks these when it opens)."""
    out = []
    for i in ids:
        c = db.cache_get(f"catalog:check:{i}")
        if not c or time.time() - c.get("checked_at", 0) > max_age_h * 3600:
            out.append(i)
    return out
