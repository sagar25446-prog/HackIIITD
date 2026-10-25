"""Service-first paperwork. Reviewed categories, official handoff and explicit coverage limits."""

from .planning import effective_facts, today

CATALOG = {
    "aadhaar": {
        "name": "Aadhaar enrolment / update",
        "name_hi": "आधार नामांकन / अपडेट",
        "source": "https://uidai.gov.in/images/commdoc/valid_documents_list.pdf",
        "url": "https://uidai.gov.in/en/enrolment-and-updates",
        "stages": ["new", "name_update", "address_update", "dob_update", "mobile_update"],
        "states": "national",
    },
    "pan": {
        "name": "PAN / Instant e-PAN",
        "name_hi": "पैन / तत्काल ई-पैन",
        "source": "https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/Instant%20e-PAN-faq",
        "url": "https://www.incometax.gov.in/iec/foportal/",
        "stages": ["instant_epan", "new", "correction"],
        "states": "national",
    },
    "driving_licence": {
        "name": "Driving licence",
        "name_hi": "ड्राइविंग लाइसेंस",
        "source": "https://transport.delhi.gov.in/transport/learner-licence",
        "url": "https://sarathi.parivahan.gov.in/",
        "stages": ["learner", "permanent", "renewal"],
        "states": "Delhi",
    },
    "income_certificate": {
        "name": "Income certificate",
        "name_hi": "आय प्रमाण पत्र",
        "source": "https://revenue.delhi.gov.in/revenue/income-certificate",
        "url": "https://edistrict.delhi.gov.in/",
        "stages": ["new"],
        "states": "Delhi",
    },
    "caste_certificate": {
        "name": "Caste certificate",
        "name_hi": "जाति प्रमाण पत्र",
        "source": "https://revenue.delhi.gov.in/",
        "url": "https://edistrict.delhi.gov.in/",
        "stages": ["new"],
        "states": "official-guidance",
    },
    "domicile_certificate": {
        "name": "Domicile / residence certificate",
        "name_hi": "अधिवास / निवास प्रमाण पत्र",
        "source": "https://revenue.delhi.gov.in/",
        "url": "https://edistrict.delhi.gov.in/",
        "stages": ["new"],
        "states": "official-guidance",
    },
    "passport": {
        "name": "Passport",
        "name_hi": "पासपोर्ट",
        "source": "https://www.passportindia.gov.in/",
        "url": "https://www.passportindia.gov.in/",
        "stages": ["new", "renewal"],
        "states": "official-guidance",
    },
    "birth_death_certificate": {
        "name": "Birth / death certificate",
        "name_hi": "जन्म / मृत्यु प्रमाण पत्र",
        "source": "https://dc.crsorgi.gov.in/",
        "url": "https://dc.crsorgi.gov.in/",
        "stages": ["birth", "death"],
        "states": "official-guidance",
    },
    "other": {
        "name": "Another government service",
        "name_hi": "अन्य सरकारी सेवा",
        "source": "https://www.india.gov.in/",
        "url": "https://www.india.gov.in/",
        "stages": ["new"],
        "states": "official-guidance",
    },
}


def service_requirements(c, f):
    service = f.get("service")
    stage = f.get("application_stage")
    pid = c.applicant_id
    keys = []
    if service == "aadhaar":
        if (f.get("age") or 0) < 18:
            return []  # Child/HoF routes need the specific UIDAI age/form table.
        keys = {
            "new": ["doc_identity_proof", "doc_address_proof", "doc_date_birth_proof"],
            "name_update": ["doc_identity_proof"],
            "address_update": ["doc_address_proof"],
            "dob_update": ["doc_date_birth_proof"],
            "mobile_update": [],
        }.get(stage, [])
    elif service == "pan":
        keys = (
            ["doc_aadhaar_readiness", "doc_linked_mobile"]
            if stage == "instant_epan"
            else ["doc_identity_proof", "doc_address_proof", "doc_date_birth_proof"]
            + (
                ["doc_existing_pan", "doc_change_evidence"]
                if stage == "correction"
                else ["doc_application_form"]
            )
        )
    elif service == "income_certificate" and str(f.get("state") or "").lower() == "delhi":
        keys = [
            "doc_application_form",
            "doc_identity_proof",
            "doc_address_proof",
            "doc_income_declaration",
            "doc_income_evidence",
            "doc_expenditure_evidence",
            "doc_photo",
        ]
    elif service == "driving_licence" and str(f.get("state") or "").lower() == "delhi":
        keys = [
            "doc_age_proof",
            "doc_address_proof",
            "doc_photo",
            "doc_fitness_declaration",
            "doc_application_form",
        ]
        if stage == "permanent":
            keys += ["doc_learner_licence"]
        elif stage == "renewal":
            keys += ["doc_driving_licence"]
        if (isinstance(f.get("age"), (float, int)) and f["age"] > 40) or f.get(
            "vehicle_type"
        ) == "transport":
            keys += ["doc_medical_form1a"]
    return [(key, [key], pid) for key in keys]


def paperwork_plan(ws, c):
    f = effective_facts(ws, c)
    service = f.get("service")
    cfg = CATALOG.get(service, CATALOG["other"])
    stage = f.get("application_stage")
    missing = [
        k
        for k in ["service", "application_stage", "state", "age"]
        if f.get(k) is None or f.get(k) == ""
    ]
    review = []
    failed = []
    if service == "aadhaar" and f.get("age") is not None and f["age"] < 18:
        review.append(
            "Select the child/Head-of-Family route using the UIDAI age-specific document table. Adult document categories must not be used for a child."
        )
    if service == "pan" and stage == "instant_epan":
        for key in ["already_has_pan", "aadhaar_ready", "linked_mobile", "representative_assessee"]:
            if f.get(key) is None:
                missing.append(key)
        if (
            f.get("already_has_pan") is True
            or (f.get("age") is not None and f["age"] < 18)
            or f.get("representative_assessee") is True
        ):
            failed.append("instant_epan_route")
        if f.get("aadhaar_ready") is False or f.get("linked_mobile") is False:
            failed.append("instant_epan_prerequisites")
    if cfg["states"] == "Delhi" and str(f.get("state") or "").lower() != "delhi":
        review.append(
            "The detailed checklist is reviewed for Delhi only. Select your state on the official service for its exact list."
        )
    if cfg["states"] == "official-guidance":
        review.append(
            "Exact requirements depend on the authority, application stage and your situation. Use official guidance search below; no universal checklist is asserted."
        )
    if service == "driving_licence":
        if f.get("vehicle_type") is None:
            missing.append("vehicle_type")
        if f.get("vehicle_type") == "transport":
            review.append(
                "Transport classes have additional eligibility/training conditions. Confirm the exact class on Sarathi before applying."
            )
        if f.get("age") == 40:
            review.append(
                "Official pages differ at exactly age 40 for Form 1A. Confirm the current requirement on Sarathi."
            )
        if f.get("age") is not None and f["age"] < 18:
            review.append(
                "Under-18 vehicle classes and guardian-consent rules need the selected class; this is not an adult-licence eligibility decision."
            )
        if stage == "renewal":
            review.append(
                "Delhi and national pages use different renewal form references. Use the current form generated by Sarathi, and confirm medical requirements."
            )
        if stage == "permanent":
            if not f.get("learner_issued_on"):
                missing.append("learner_issued_on")
            else:
                from datetime import date

                try:
                    elapsed = (today() - date.fromisoformat(f["learner_issued_on"])).days
                    if elapsed < 30:
                        failed.append("learner_minimum_30_days")
                except ValueError:
                    failed.append("invalid_learner_date")
    if stage and stage not in cfg["stages"]:
        failed.append("unsupported_application_stage")
    status = (
        "not_supported"
        if failed
        else "needs_answers"
        if missing
        else "review_needed"
        if review
        else "preparing"
    )
    source = cfg["source"]
    if service == "driving_licence" and stage == "renewal":
        source = "https://transport.delhi.gov.in/transport/renewal-driving-licence"
    tasks = [
        {
            "id": "service_answer:" + key,
            "label": "Confirm " + key.replace("_", " "),
            "label_hi": "पुष्टि करें: " + key.replace("_", " "),
            "person_id": c.applicant_id,
            "kind": "answer",
            "done": False,
        }
        for key in missing
    ]
    return {
        "case_id": c.id,
        "person_id": c.applicant_id,
        "status": status,
        "status_label": {
            "preparing": "Prepare the service documents",
            "needs_answers": "Confirm your situation",
            "review_needed": "Official route needs confirmation",
            "not_supported": "Choose another supported application route",
        }[status],
        "status_hi": {
            "preparing": "सेवा के दस्तावेज़ तैयार करें",
            "needs_answers": "अपनी स्थिति बताएँ",
            "review_needed": "आधिकारिक मार्ग की पुष्टि चाहिए",
            "not_supported": "दूसरा उपयुक्त आवेदन मार्ग चुनें",
        }[status],
        "missing": missing,
        "failed": failed,
        "review": review,
        "questions": [],
        "tasks": tasks,
        "requirements": [],
        "deadlines": [],
        "source_url": source,
        "source_title": cfg["name"],
        "source_checked": "2026-10-24",
        "official_url": cfg["url"],
        "rule_version": "paperwork.2026-10-24",
        "coverage": "This is preparation guidance, not an exhaustive government approval checklist. Open the linked official document list for accepted proofs, exceptions and current fees. Do not upload or type ID numbers here.",
        "coverage_hi": "यह तैयारी मार्गदर्शन है, सरकारी स्वीकृति की पूर्ण सूची नहीं। स्वीकृत प्रमाण, अपवाद और वर्तमान शुल्क के लिए आधिकारिक सूची खोलें। यहाँ पहचान संख्या या फाइल न दें।",
        "removed_tasks": [],
        "removed_tasks_hi": [],
    }


async def find_guidance(service, state):
    from ..tinyfish.client import tinyfish
    from ..tinyfish.harness import is_official

    try:
        r = await tinyfish.search(
            f"{service[:100]} documents required {state[:80]} official",
            include_domains="gov.in,nic.in",
            purpose="Paperwork: discover public official guidance",
            exact_replay=True,
        )
    except Exception:
        return {
            "status": "unavailable",
            "items": [],
            "note": "Official guidance could not be checked. No requirements were invented.",
        }
    return {
        "status": "saved_recording" if r.get("_replay") else "live",
        "recorded_at": r.get("_recorded_at"),
        "items": [
            {
                "title": x.get("title", "Official guidance"),
                "url": x["url"],
                "snippet": x.get("snippet", "")[:600],
            }
            for x in r.get("results", [])
            if is_official(x.get("url"))
        ][:6],
        "note": "Search results are leads, not an activated document checklist. Confirm the exact service and stage with the authority.",
    }
