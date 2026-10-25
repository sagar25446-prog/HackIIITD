"""AND requirements with supported OR choices; document assertions are never authenticity checks."""

from datetime import date

from .planning import today

DOCUMENTS = {
    "doc_identity_proof": (
        "Accepted identity proof from the official list",
        "आधिकारिक सूची से स्वीकृत पहचान प्रमाण",
    ),
    "doc_address_proof": ("Accepted current-address proof", "स्वीकृत वर्तमान पता प्रमाण"),
    "doc_date_birth_proof": ("Accepted date-of-birth proof", "स्वीकृत जन्म तिथि प्रमाण"),
    "doc_aadhaar_readiness": (
        "Aadhaar with updated KYC (do not enter the number)",
        "अद्यतन KYC वाला आधार (संख्या न लिखें)",
    ),
    "doc_linked_mobile": (
        "Access to Aadhaar-linked mobile / DigiLocker as required",
        "आधार से जुड़े मोबाइल / आवश्यक DigiLocker की उपलब्धता",
    ),
    "doc_existing_pan": ("Existing PAN reference held privately", "मौजूदा पैन का निजी संदर्भ"),
    "doc_change_evidence": ("Evidence supporting the requested correction", "माँगे गए सुधार का प्रमाण"),
    "doc_application_form": (
        "Current application form from the official portal",
        "आधिकारिक पोर्टल का वर्तमान आवेदन फॉर्म",
    ),
    "doc_income_evidence": (
        "Salary slip or other family-income evidence",
        "वेतन पर्ची या अन्य पारिवारिक आय प्रमाण",
    ),
    "doc_expenditure_evidence": (
        "Supporting monthly-expenditure documents",
        "मासिक खर्च के सहायक दस्तावेज़",
    ),
    "doc_fitness_declaration": (
        "Form 1 physical-fitness declaration",
        "फॉर्म 1 शारीरिक फिटनेस स्व-घोषणा",
    ),
    "doc_medical_form1a": (
        "Medical certificate Form 1A, if applicable",
        "यदि लागू हो तो फॉर्म 1A चिकित्सा प्रमाण पत्र",
    ),
    "doc_learner_licence": (
        "Valid learner licence for the selected vehicle class",
        "चुनी वाहन श्रेणी का वैध लर्नर लाइसेंस",
    ),
    "doc_driving_licence": ("Existing driving licence", "मौजूदा ड्राइविंग लाइसेंस"),
    "doc_age_proof": ("Age proof", "आयु प्रमाण"),
    "doc_birth_certificate": ("Birth certificate", "जन्म प्रमाण पत्र"),
    "doc_domicile_certificate": ("Five-year residence evidence", "पाँच वर्ष का निवास प्रमाण"),
    "doc_voter_id": ("Voter ID with residence history", "निवास इतिहास सहित मतदाता पहचान पत्र"),
    "doc_ration_card": ("Existing NFSA ration-card reference", "मौजूदा NFSA राशन कार्ड का संदर्भ"),
    "doc_bank_account": ("Applicant bank-account readiness", "आवेदक के बैंक खाते की तैयारी"),
    "doc_bank_statement": ("Applicant bank statement/passbook", "आवेदक का बैंक विवरण/पासबुक"),
    "doc_income_declaration": (
        "Income self-declaration in the official format",
        "आधिकारिक प्रारूप में आय स्व-घोषणा",
    ),
    "doc_income_certificate": ("Issued family-income certificate", "जारी पारिवारिक आय प्रमाण पत्र"),
    "doc_death_certificate": (
        "Deceased person’s death certificate",
        "दिवंगत व्यक्ति का मृत्यु प्रमाण पत्र",
    ),
    "doc_photo": ("Recent applicant photograph", "आवेदक की हाल की फोटो"),
    "doc_marksheet": ("Class 12 marksheet", "कक्षा 12 की अंकतालिका"),
    "doc_previous_marksheet": ("Previous-year marksheet", "पिछले वर्ष की अंकतालिका"),
    "doc_caste_certificate": (
        "Applicant category certificate, if applicable",
        "यदि लागू हो तो आवेदक का वर्ग प्रमाण पत्र",
    ),
    "doc_udid": (
        "Applicant disability certificate, if applicable",
        "यदि लागू हो तो आवेदक का दिव्यांगता प्रमाण पत्र",
    ),
    "doc_claimant_relationship": (
        "Institution-required claimant evidence",
        "संस्थान द्वारा आवश्यक दावेदार संबंध प्रमाण",
    ),
    "doc_institution_reference": (
        "Known institution or policy reference (retain privately)",
        "ज्ञात संस्था या पॉलिसी संदर्भ (निजी रखें)",
    ),
}


def requirements(c, f, subject_deceased=False):
    # Every tuple is mandatory; each options list is an alternative for that requirement only.
    if c.kind == "paperwork":
        from .service_paperwork import service_requirements

        return service_requirements(c, f)
    if c.kind in ("retirement", "bereavement"):
        result = [
            ("age", ["doc_age_proof", "doc_birth_certificate"], c.applicant_id),
            ("residence", ["doc_domicile_certificate", "doc_voter_id"], c.applicant_id),
            ("bank", ["doc_bank_account"], c.applicant_id),
            ("aadhaar", ["doc_aadhaar_readiness"], c.applicant_id),
            ("income", ["doc_income_declaration"], c.applicant_id),
            ("photo", ["doc_photo"], c.applicant_id),
        ]
        if c.kind == "bereavement":
            result.append(("bank_statement", ["doc_bank_statement"], c.applicant_id))
            if c.subject_id:
                result.append(("death", ["doc_death_certificate"], c.subject_id))
        return result
    if c.kind == "education":
        if c.mode == "renewal":
            return [("marks", ["doc_previous_marksheet"], c.applicant_id)]
        result = [
            ("marks", ["doc_marksheet"], c.applicant_id),
            ("income", ["doc_income_certificate"], c.applicant_id),
        ]
        if f.get("category") in ("sc", "st", "obc"):
            result.append(("category", ["doc_caste_certificate"], c.applicant_id))
        if f.get("disability") is True:
            result.append(("disability", ["doc_udid"], c.applicant_id))
        return result
    if c.kind == "moving":
        return (
            [("existing_card", ["doc_ration_card"], c.applicant_id)]
            if f.get("nfsa_beneficiary") is True
            else []
        )
    if c.kind == "wapsi":
        result = [
            ("institution", ["doc_institution_reference"], c.subject_id or c.applicant_id),
            ("claimant", ["doc_claimant_relationship"], c.applicant_id),
        ]
        if subject_deceased:
            result.append(("death", ["doc_death_certificate"], c.subject_id or c.applicant_id))
        return result
    return []


def state_of(d, requirement, current_state=None):
    if not d or d.state == "unknown":
        return "needs_confirmation"
    if d.state == "missing":
        return "missing"
    if d.expires_on and d.expires_on < today():
        return "expired"
    if (
        d.issued_state
        and current_state
        and d.issued_state.lower() != str(current_state).lower()
        and requirement in ("residence", "doc_address_proof")
    ):
        return "needs_confirmation"
    if requirement == "residence":
        threshold = (
            today().replace(year=today().year - 5)
            if not (today().month == 2 and today().day == 29)
            else date(today().year - 5, 2, 28)
        )
        if (
            not d.covers_from
            or d.covers_from > threshold
            or not d.covers_to
            or d.covers_to < today()
        ):
            return "needs_confirmation"
    if requirement == "bank_statement":
        if (
            not d.covers_from
            or not d.covers_to
            or (d.covers_to - d.covers_from).days < 364
            or d.covers_to < today()
        ):
            return "needs_confirmation"
    return "already_available"


def attach(ws, c, p):
    from .planning import effective_facts

    docs = {(d.person_id, d.kind): d for d in ws.documents}
    docs.update({(d.person_id, d.kind): d for d in c.documents})
    reqs = []
    subject = next(
        (person for person in ws.people if person.id == (c.subject_id or c.applicant_id)), None
    )
    for key, options, person in requirements(
        c, effective_facts(ws, c), bool(subject and subject.deceased)
    ):
        choices = [
            (kind, state_of(docs.get((person, kind)), key, effective_facts(ws, c).get("state")))
            for kind in options
        ]
        selected, state = min(
            choices,
            key=lambda x: {
                "already_available": 0,
                "needs_confirmation": 1,
                "missing": 2,
                "expired": 3,
            }[x[1]],
        )
        en, hi = DOCUMENTS[selected]
        req = {
            "id": key,
            "label": en,
            "label_hi": hi,
            "person_id": person,
            "state": state,
            "selected": selected,
            "options": options,
            "alternative_available": len(options) > 1,
            "explanation": "Applies to this person and workflow. An assertion is not official document verification.",
            "explanation_hi": "यह आवश्यकता इसी व्यक्ति और प्रक्रिया के लिए है। उपलब्धता बताना आधिकारिक सत्यापन नहीं है।",
        }
        if key == "residence":
            req["explanation"] = (
                "The selected evidence must cover the required five-year residence period; a current address alone is insufficient."
            )
            req["explanation_hi"] = (
                "चुना प्रमाण पाँच वर्ष की निवास अवधि को कवर करे; केवल वर्तमान पता पर्याप्त नहीं है।"
            )
        reqs.append(req)
        tid = "document:" + key + ":" + person
        # Ticking a task never bypasses missing/expired document metadata.
        p["tasks"].append(
            {
                "id": tid,
                "label": en,
                "label_hi": hi,
                "person_id": person,
                "kind": "document",
                "done": state == "already_available",
            }
        )
    p["requirements"] = reqs
    p["paperwork_ready"] = all(r["state"] == "already_available" for r in reqs)
    p["ready_for_official_step"] = p["status"] == "preparing" and p["paperwork_ready"]
    if p["ready_for_official_step"]:
        p["tasks"].append(
            {
                "id": "official_handoff",
                "label": "Review and continue on the official service",
                "label_hi": "समीक्षा करके आधिकारिक सेवा पर आगे बढ़ें",
                "person_id": c.applicant_id,
                "kind": "handoff",
                "done": "official_handoff" in c.completed_tasks,
            }
        )
    if c.kind in ("bereavement", "retirement"):
        p["removed_tasks"] = [
            "Do not obtain a new income certificate solely for this workflow: use its published self-declaration format."
        ]
        p["removed_tasks_hi"] = [
            "केवल इस प्रक्रिया के लिए नया आय प्रमाण पत्र न बनवाएँ: प्रकाशित स्व-घोषणा प्रारूप का उपयोग करें।"
        ]
    elif c.kind == "education" and c.mode == "renewal":
        p["removed_tasks"] = [
            "The published renewal upload list asks for the previous-year marksheet, not a new fresh-application income certificate."
        ]
        p["removed_tasks_hi"] = [
            "प्रकाशित नवीनीकरण अपलोड सूची में पिछले वर्ष की अंकतालिका है, नया आय प्रमाण पत्र नहीं।"
        ]
    elif c.kind == "moving" and effective_facts(ws, c).get("nfsa_beneficiary") is True:
        p["removed_tasks"] = [
            "No new ration card or new portability registration is required for the existing eligible NFSA card route."
        ]
        p["removed_tasks_hi"] = [
            "मौजूदा पात्र NFSA कार्ड के पोर्टेबिलिटी मार्ग के लिए नया कार्ड या नया पंजीकरण आवश्यक नहीं है।"
        ]
