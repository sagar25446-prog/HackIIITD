"""Change Radar: diff two snapshots of a notice page and classify what changed.

Only changes that matter (deadline, new notification, eligibility, vacancy, result, admit card) become
alerts; navigation tweaks, counters and other cosmetic edits are dropped.
"""
from __future__ import annotations

import hashlib
import re

KINDS: list[tuple[str, str, int]] = [
    ("deadline", r"last date|extended|extension|closing date|re-?open|reopen|अंतिम तिथि|बढ़ाई|deadline", 3),
    ("cancellation", r"cancel", 2),
    ("answer_key", r"answer key|challenges? thereon", 2),
    ("new_notification", r"notification|notice of (the )?(exam|recruitment|adv)|advertisement|advt\.?|exam notification|"
                         r"applications? (are )?invited|recruitment of|renewal applications|is currently open|"
                         r"portal is open|अधिसूचना", 3),
    ("eligibility", r"eligib|age limit|qualification|relaxation|neither the applicant|should not be|पात्रता", 3),
    ("admit_card", r"admit card|e-?admit|call letter|प्रवेश पत्र", 2),
    ("result", r"result|marks|merit list|cut-?off|shortlist|परिणाम", 2),
    ("vacancy", r"vacanc|posts? of|\d+ posts", 2),
    ("schedule", r"schedule|time ?table|exam date|calendar|date of exam", 2),
]
EXAM_KEYS = {
    "ssc_chsl": r"chsl|combined higher secondary",
    "ssc_cgl": r"\bcgl\b|combined graduate level",
    "upsc_cse": r"civil services|\bcse\b|\bias\b",
}
SCHEME_KEYS = {
    "csss": r"central sector scheme of scholarship|\bcsss\b|pm-?usp",
    "delhi_lakshmi_yojana": r"lakshmi yojana|delhi lakshmi",
    "post_matric_sc": r"post[- ]matric.{0,40}\bsc\b|scheduled castes?",
}
COSMETIC = re.compile(r"visitor count|last updated|copyright|©|skip to main|toggle navigation|font size|^\W*$", re.I)
DATE_RE = re.compile(r"\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s?\d{1,2}\s?,?\s?\d{4}\b"
                     r"|\b\d{1,2}[-/]\d{1,2}[-/]\d{4}\b"
                     r"|\b\d{1,2}\s(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s\d{4}\b", re.I)
BOARD_DATE = re.compile(r"^(?:new\s*)?(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s?(\d{1,2})\s?,?\s?(\d{4})$",
                        re.I)
MONTHS = "jan feb mar apr may jun jul aug sep oct nov dec".split()
SIZE = re.compile(r"^\(?[\d.]+\s?(kb|mb)\)?$", re.I)
POSTED = re.compile(r"^\[(\d{4}-\d\d-\d\d)\]\s*")


def _items(text: str, start_after: str | None = None) -> list[str]:
    """Split a notice page into items (one notice per paragraph or line); dated boards keep their date."""
    text = text or ""
    if start_after and start_after in text:
        text = text.split(start_after, 1)[1]
    blocks = [b.strip() for b in re.split(r"\n\s*\n", text) if b.strip()]
    items: list[str] = []
    date = None
    for b in blocks:
        lines = [ln.strip(" *-#") for ln in b.splitlines() if ln.strip()]
        joined = " ".join(lines)
        m = BOARD_DATE.match(joined.strip())
        if m:  # e.g. "New Oct122026" on the SSC board: the date of the next notice
            date = f"{m.group(3)}-{MONTHS.index(m.group(1).lower()[:3]) + 1:02d}-{int(m.group(2)):02d}"
            continue
        if SIZE.match(joined):
            continue
        if len(lines) > 6:  # a list-style page (one notice per line)
            items.extend(ln for ln in lines if len(ln) > 25)
        elif len(joined) > 25:
            items.append(f"[{date}] {joined}" if date else joined)
            date = None
    return [i for i in items if not COSMETIC.search(i)]


def fingerprint(item: str) -> str:
    item = POSTED.sub("", item)
    norm = re.sub(r"\s+", " ", re.sub(r"\(\d+(\.\d+)?\s?(kb|mb)\)", "", item.lower())).strip()
    return hashlib.sha1(norm.encode()).hexdigest()[:12]


def classify(item: str) -> dict:
    posted = POSTED.match(item)
    body = item[posted.end():] if posted else item
    low = body.lower()
    kind, weight = "other", 0
    for name, pat, w in KINDS:
        if re.search(pat, low):
            kind, weight = name, w
            break
    exams = [eid for eid, pat in EXAM_KEYS.items() if re.search(pat, low)]
    schemes = [sid for sid, pat in SCHEME_KEYS.items() if re.search(pat, low)]
    return {"kind": kind, "importance": weight, "exam_ids": exams, "scheme_ids": schemes, "text": body[:500],
            "posted": posted.group(1) if posted else None, "dates_in_text": DATE_RE.findall(body)[:3]}


def important_items(text: str, start_after: str | None = None) -> list[dict]:
    return [c for c in (classify(i) for i in _items(text, start_after)) if c["importance"] > 0]


def diff(old_text: str | None, new_text: str, start_after: str | None = None) -> list[dict]:
    old = {fingerprint(i) for i in _items(old_text or "", start_after)}
    changes = []
    for item in _items(new_text, start_after):
        if fingerprint(item) not in old:
            c = classify(item)
            if c["importance"] > 0:
                changes.append(c)
    return changes
