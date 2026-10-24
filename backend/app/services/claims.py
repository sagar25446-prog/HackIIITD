"""'Acts for you': application packs, claim kits and grievance drafts — always with the citizen's approval.

JAAGRUK prepares everything (documents list, where to go, a pre-filled letter) but never submits on its
own. For an online submission the citizen opens an assisted session and logs in with their own OTP.
"""
from __future__ import annotations

import time

from ..ml import eligibility as el
from ..ml import llm
from . import persona

CPGRAMS_URL = "https://pgportal.gov.in"


def application_pack(scheme_id: str, raw_profile: dict, who: str | None = None) -> dict:
    rule = next(r for r in el.load_schemes() if r["id"] == scheme_id)
    prof = persona.subject(raw_profile, who)
    d = el.decide(rule, prof)
    docs = el.load_documents()
    need = sorted({c.get("doc") for c in rule["conditions"] if c.get("doc")})
    have = [x for x in need if prof.get(x)]
    missing = [x for x in need if not prof.get(x)]
    prefill = {k: prof[k] for k in ("name", "age", "gender", "state", "category", "marital_status",
                                    "annual_family_income") if prof.get(k) not in (None, "")}
    return {"scheme_id": scheme_id, "name": rule["name"], "status": d.status, "apply_url": rule["apply_url"],
            "documents_ready": [{"id": x, **docs.get(x, {"name": x})} for x in have],
            "documents_missing": [{"id": x, **docs.get(x, {"name": x})} for x in missing],
            "prefill": prefill, "fee": "₹0 — government schemes never charge to apply",
            "steps": [f"Open {rule['apply_url']} (official site)",
                      "Sign in with your own mobile OTP — JAAGRUK never sees it",
                      "Copy the pre-filled details below into the form and upload the documents",
                      "Save the application number; JAAGRUK will remind you to track it"],
            "source_url": rule["source_url"], "verified_on": rule.get("verified_on")}


TEMPLATES = {
    "en": ("To,\nThe Public Grievance Officer,\n{department}\n\nSubject: {subject}\n\nRespected Sir/Madam,\n\n"
           "I, {name}, resident of {state}, wish to bring the following to your kind attention:\n\n{details}\n\n"
           "I request you to kindly look into this and take necessary action at the earliest. Copies of relevant "
           "documents can be provided on request.\n\nThank you.\n\nYours faithfully,\n{name}\nDate: {date}"),
    "hi": ("सेवा में,\nलोक शिकायत अधिकारी,\n{department}\n\nविषय: {subject}\n\nमहोदय/महोदया,\n\n"
           "मैं, {name}, निवासी {state}, आपका ध्यान निम्नलिखित की ओर दिलाना चाहती/चाहता हूँ:\n\n{details}\n\n"
           "कृपया इस पर शीघ्र आवश्यक कार्रवाई करें। आवश्यक दस्तावेज़ माँगने पर उपलब्ध कराए जा सकते हैं।\n\n"
           "धन्यवाद।\n\nभवदीय/भवदीया,\n{name}\nदिनांक: {date}"),
}

POLISH_SCHEMA = llm.schema_obj({"subject": {"type": "string"}, "details": {"type": "string"}})


async def grievance_draft(raw_profile: dict, *, department: str, subject: str, details: str,
                          lang: str = "en") -> dict:
    prof = persona.build(raw_profile)
    polished = None
    if llm.available():
        polished = await llm.json_call(
            system="Rewrite a citizen's grievance for India's CPGRAMS portal: polite, factual, under 150 words, "
                   "no invented facts, no ID numbers. Reply in " + ("Hindi (Devanagari)." if lang == "hi" else "English."),
            user=f"Subject: {subject}\nWhat happened: {details}", schema=POLISH_SCHEMA, purpose="grievance draft")
    subj = (polished or {}).get("subject") or subject
    body = (polished or {}).get("details") or details
    text = TEMPLATES["hi" if lang == "hi" else "en"].format(
        department=department, subject=subj, name=prof.get("name", ""), state=prof.get("state", ""),
        details=body, date=time.strftime("%d-%m-%Y"))
    return {"text": text, "portal": CPGRAMS_URL, "polished_by": "claude" if polished else "template",
            "note": "Review and edit before submitting. JAAGRUK does not submit on your behalf; open an assisted "
                    "session to log in to CPGRAMS with your own OTP and paste this."}
