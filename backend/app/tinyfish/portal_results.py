"""Strict, portal-specific reading of official result pages and agent outputs.

The rule: "no match" is reported only when the portal's own result area shows its own no-record message.
Missing inputs, CAPTCHA/OTP/login walls, site errors, timeouts and anything unrecognised are kept distinct
(citizen_step / unavailable / failed / uncertain). A positive result keeps each record separately — no amounts
are added up and nothing is treated as ownership.
"""

from __future__ import annotations

import re
from html import unescape
from html.parser import HTMLParser

AMOUNT = re.compile(r"(?:₹|rs\.?|inr)?\s*([\d,]+(?:\.\d{1,2})?)", re.I)
WALL = re.compile(r"captcha|one[- ]time password|\botp\b|verify you are human|log ?in to continue|sign in to continue", re.I)
SITE_DOWN = re.compile(
    r"err_[a-z_]+|this site can.t be reached|temporarily down|service unavailable|internal server error|"
    r"something went wrong|bad gateway|gateway time-?out|under maintenance",
    re.I,
)

NO_MATCH = {
    "lic_unclaimed": re.compile(r"records with respect to entered data not found", re.I),
    "tata_aia_unclaimed": re.compile(r"no unclaimed funds? applicable for (the )?entered details", re.I),
}


class _Tables(HTMLParser):
    """Collect tables (rows of cell texts) and the text of red <font> elements (LIC's result area)."""

    def __init__(self) -> None:
        super().__init__()
        self.tables: list[list[list[str]]] = []
        self._stack: list[list[list[str]]] = []
        self._cell: list[str] | None = None
        self.red: list[str] = []
        self._red_depth = 0
        self._red_buf: list[str] = []

    def handle_starttag(self, tag, attrs):
        a = {k.lower(): (v or "") for k, v in attrs}
        if tag == "table":
            self._stack.append([])
        elif tag == "tr" and self._stack:
            self._stack[-1].append([])
        elif tag in ("td", "th") and self._stack:
            self._cell = []
        elif tag == "font" and a.get("color", "").lower() in ("red", "#ff0000"):
            self._red_depth += 1

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None and self._stack and self._stack[-1]:
            self._stack[-1][-1].append(" ".join("".join(self._cell).split()))
            self._cell = None
        elif tag == "table" and self._stack:
            self.tables.append(self._stack.pop())
        elif tag == "font" and self._red_depth:
            self._red_depth -= 1
            if not self._red_depth:
                self.red.append(" ".join("".join(self._red_buf).split()))
                self._red_buf = []

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)
        if self._red_depth:
            self._red_buf.append(data)


def _amount(text: str) -> float | None:
    m = AMOUNT.search(text or "")
    if not m:
        return None
    try:
        return float(m.group(1).replace(",", ""))
    except ValueError:
        return None


def candidates_from_tables(tables: list[list[list[str]]]) -> list[dict]:
    """Each data row of a result table with recognisable headers becomes one candidate. Never summed."""
    out = []
    for t in tables:
        rows = [r for r in t if any(c.strip() for c in r)]
        if len(rows) < 2:
            continue
        head = [h.lower() for h in rows[0]]
        if not (any("amount" in h for h in head) and any("name" in h or "policy" in h for h in head)):
            continue
        for r in rows[1:]:
            if len(r) != len(head):
                continue
            cell = dict(zip(head, r))
            out.append(
                {
                    "display_name": next((v for k, v in cell.items() if "name" in k), "")[:120],
                    "amount_inr": next((_amount(v) for k, v in cell.items() if "amount" in k), None),
                    "reference": next((v for k, v in cell.items() if "policy" in k or "folio" in k or "ref" in k), "")[:80],
                    "fields": {k[:40]: v[:120] for k, v in list(cell.items())[:12]},
                }
            )
    # the same row shown twice is one record
    seen, uniq = set(), []
    for c in out:
        key = (c["display_name"].lower(), c["reference"], c["amount_inr"])
        if key not in seen:
            seen.add(key)
            uniq.append(c)
    return uniq[:10]


def read_lic(html: str) -> dict:
    """Classify LIC's page after one submission."""
    p = _Tables()
    p.feed(html)
    text = " ".join(unescape(re.sub(r"<[^>]+>", " ", re.sub(r"<script[\s\S]*?</script>", " ", html))).split())
    if SITE_DOWN.search(text) and "unclaimed" not in text.lower():
        return {"outcome": "unavailable", "message": "LIC's page could not be reached."}
    if WALL.search(text):
        return {"outcome": "citizen_step", "message": "LIC's page asked for a check only you can complete."}
    if any(NO_MATCH["lic_unclaimed"].search(r) for r in p.red):
        return {"outcome": "no_match", "message": "LIC's result area: “Records with respect to entered data not found”."}
    cands = candidates_from_tables(p.tables)
    if cands:
        return {"outcome": "possible_record", "candidates": cands, "message": f"LIC's result lists {len(cands)} record(s)."}
    return {"outcome": "uncertain", "message": "LIC's page did not show a result JAAGRUK recognises. Check it yourself on the official site."}


def read_tata(text: str, tables: list[list[list[str]]] | None = None) -> dict:
    t = " ".join((text or "").split())
    if SITE_DOWN.search(t) and "unclaimed" not in t.lower():
        return {"outcome": "unavailable", "message": "Tata AIA's page could not be reached."}
    if WALL.search(t):
        return {"outcome": "citizen_step", "message": "Tata AIA asked for an OTP or a check only you can complete."}
    if NO_MATCH["tata_aia_unclaimed"].search(t):
        return {"outcome": "no_match", "message": "Tata AIA's result: “No unclaimed funds applicable for entered details”."}
    cands = candidates_from_tables(tables or [])
    if cands:
        return {"outcome": "possible_record", "candidates": cands, "message": f"Tata AIA lists {len(cands)} record(s)."}
    return {"outcome": "uncertain", "message": "Tata AIA's page did not show a result JAAGRUK recognises."}


AGENT_STATES = ("result_shown", "no_record_message", "captcha_or_otp", "login_required", "site_error", "form_not_found")

AGENT_SCHEMA = {
    "type": "object",
    "properties": {
        "page_state": {"type": "string", "enum": list(AGENT_STATES)},
        "result_area_text": {"type": "string"},
        "records": {
            "type": "array",
            "items": {
                "type": "object",
                "properties": {
                    "holder_name": {"type": "string"},
                    "amount_inr": {"type": "number", "nullable": True},
                    "policy_reference": {"type": "string"},
                },
                "required": ["holder_name"],
            },
        },
    },
    "required": ["page_state", "result_area_text", "records"],
}


def read_agent(source_id: str, status: str | None, result, error) -> dict:
    """Strictly typed reading of an agent's structured output. Anything off-schema is uncertain."""
    if status != "COMPLETED":
        msg = str((error or {}).get("message") if isinstance(error, dict) else error or "")
        if WALL.search(msg):
            return {"outcome": "citizen_step", "message": "The portal asked for a check only you can complete."}
        return {"outcome": "failed", "message": "The automated check did not finish" + (f": {msg[:160]}" if msg else ".")}
    if not isinstance(result, dict):
        return {"outcome": "uncertain", "message": "The automated check returned no structured result."}
    state = result.get("page_state")
    area = result.get("result_area_text")
    records = result.get("records")
    if state not in AGENT_STATES or not isinstance(area, str) or not isinstance(records, list):
        return {"outcome": "uncertain", "message": "The automated check returned an unexpected result shape."}
    if state in ("captcha_or_otp", "login_required") or WALL.search(area):
        return {"outcome": "citizen_step", "message": "The portal asked for a check only you can complete."}
    if state == "site_error" or SITE_DOWN.search(area):
        return {"outcome": "unavailable", "message": "The official portal returned an error."}
    if state == "form_not_found":
        return {"outcome": "failed", "message": "The search form was not found.", "pre_submission": True}
    rx = NO_MATCH.get(source_id)
    good = [
        r
        for r in records
        if isinstance(r, dict) and isinstance(r.get("holder_name"), str) and r["holder_name"].strip()
        and r["holder_name"].strip().lower() not in ("not found", "none", "n/a", "-")
        and (r.get("amount_inr") is None or (isinstance(r.get("amount_inr"), (int, float)) and not isinstance(r.get("amount_inr"), bool)))
    ]
    if state == "result_shown" and good:
        cands = [
            {
                "display_name": r["holder_name"].strip()[:120],
                "amount_inr": float(r["amount_inr"]) if r.get("amount_inr") is not None else None,
                "reference": str(r.get("policy_reference") or "")[:80],
                "fields": {},
            }
            for r in good[:10]
        ]
        return {"outcome": "possible_record", "candidates": cands, "message": area[:300]}
    if state == "no_record_message" and rx and rx.search(area) and not good:
        return {"outcome": "no_match", "message": f"Result area: “{area[:200]}”"}
    return {"outcome": "uncertain", "message": "The result could not be confirmed: " + (area[:200] or "no result text")}
