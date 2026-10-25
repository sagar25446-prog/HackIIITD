"""Free-text life events propose changes. Only explicit confirmation changes person facts.

`interpret` is a local, rule-based reader (English, Hindi and Hinglish). It suggests the kind of
update, who it is about, and details such as renewal, course year, an amount or a date. Every
suggestion is shown to the user for review; nothing is applied until `apply` is called with an
explicit confirmation.
"""

from __future__ import annotations

import calendar
import re
import uuid
from datetime import date, datetime, timedelta
from datetime import timezone as _tz

from ..workspace_models import Case, CaseEvent, PersonalEvent, Workspace
from .planning import plan

IST = _tz(timedelta(hours=5, minutes=30))

STATES = [
    "Andhra Pradesh",
    "Arunachal Pradesh",
    "Assam",
    "Bihar",
    "Chhattisgarh",
    "Goa",
    "Gujarat",
    "Haryana",
    "Himachal Pradesh",
    "Jharkhand",
    "Karnataka",
    "Kerala",
    "Madhya Pradesh",
    "Maharashtra",
    "Manipur",
    "Meghalaya",
    "Mizoram",
    "Nagaland",
    "Odisha",
    "Punjab",
    "Rajasthan",
    "Sikkim",
    "Tamil Nadu",
    "Telangana",
    "Tripura",
    "Uttar Pradesh",
    "Uttarakhand",
    "West Bengal",
    "Delhi",
    "Jammu and Kashmir",
    "Ladakh",
    "Chandigarh",
    "Puducherry",
    "Andaman and Nicobar Islands",
    "Dadra and Nagar Haveli and Daman and Diu",
    "Lakshadweep",
]
HINDI = {
    "दिल्ली": "Delhi",
    "महाराष्ट्र": "Maharashtra",
    "बिहार": "Bihar",
    "उत्तर प्रदेश": "Uttar Pradesh",
    "राजस्थान": "Rajasthan",
    "कर्नाटक": "Karnataka",
    "गुजरात": "Gujarat",
    "पंजाब": "Punjab",
    "हरियाणा": "Haryana",
    "मध्य प्रदेश": "Madhya Pradesh",
    "केरल": "Kerala",
    "तमिलनाडु": "Tamil Nadu",
    "पश्चिम बंगाल": "West Bengal",
}


# Relation words a person may use, mapped to the canonical word stored in `Person.relation`.
RELATIONS = {
    "daughter": ["daughter", "beti", "bitiya", "बेटी", "पुत्री", "बिटिया"],
    "son": ["son", "beta", "बेटा", "पुत्र"],
    "wife": ["wife", "patni", "पत्नी", "biwi", "बीवी"],
    "husband": ["husband", "pati", "पति"],
    "mother": ["mother", "mom", "mummy", "maa", "mata", "माँ", "मां", "माता", "अम्मा"],
    "father": ["father", "dad", "papa", "pita", "पिता", "पापा", "बाबूजी"],
    "sister": ["sister", "behen", "bahan", "बहन"],
    "brother": ["brother", "bhai", "भाई"],
    "grandmother": ["grandmother", "grandma", "dadi", "nani", "दादी", "नानी"],
    "grandfather": ["grandfather", "grandpa", "dada", "nana", "दादा", "नाना"],
}
WE = r"\bwe\b|\bour family\b|\bwhole family\b|\bhum\b|\bहम\b|परिवार"
ORDINALS = {
    1: r"first|1st|पहले|पहला|pehle",
    2: r"second|2nd|दूसरे|दूसरा|doosre|dusre",
    3: r"third|3rd|तीसरे|तीसरा|teesre",
    4: r"fourth|4th|चौथे|चौथा",
    5: r"fifth|5th|पाँचवें|पांचवें",
}
MONTHS = {
    m.lower(): i
    for i in range(1, 13)
    for m in (calendar.month_name[i], calendar.month_abbr[i], "sept" if i == 9 else "")
    if m
}


def _word(term: str, low: str) -> bool:
    # \b does not work for Devanagari, so Hindi words are matched as substrings
    if re.search(r"[ऀ-ॿ]", term):
        return term in low
    return re.search(r"(?<![a-z])" + re.escape(term) + r"(?![a-z])", low) is not None


def _people_mentioned(low: str, people: list[dict]) -> tuple[list[dict], bool]:
    """People named or described in the text, and whether the text says 'we' / the family."""
    found: dict[str, dict] = {}
    for p in people:
        if p.get("relation") == "self":
            continue
        first = str(p.get("name", "")).strip().split(" ")[0].lower()
        if len(first) >= 3 and _word(first, low):
            found[p["id"]] = {**p, "how": "name"}
            continue
        relation = str(p.get("relation", "")).lower()
        for canonical, words in RELATIONS.items():
            if canonical in relation and any(_word(w, low) for w in words):
                found[p["id"]] = {**p, "how": "relation"}
                break
    return list(found.values()), bool(re.search(WE, low))


def _relation_words(low: str) -> list[str]:
    return [c for c, words in RELATIONS.items() if any(_word(w, low) for w in words)]


def _add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    year, month = d.year + y, m + 1
    return date(year, month, min(d.day, calendar.monthrange(year, month)[1]))


def _date(low: str, today: date) -> tuple[str | None, str | None]:
    """A date the text states or implies, as (ISO date, the words it came from)."""
    m = re.search(r"\b(\d{4})-(\d{1,2})-(\d{1,2})\b", low)
    if m:
        try:
            return date(int(m[1]), int(m[2]), int(m[3])).isoformat(), m[0]
        except ValueError:
            pass
    m = re.search(r"\b(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})\b", low)
    if m:
        year = int(m[3]) + (2000 if len(m[3]) == 2 else 0)
        try:
            return date(year, int(m[2]), int(m[1])).isoformat(), m[0]
        except ValueError:
            pass
    names = "|".join(sorted(MONTHS, key=len, reverse=True))
    m = re.search(
        rf"\b(\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?({names})\b\.?(?:,?\s+(\d{{4}}))?", low
    )
    m = m or re.search(rf"\b({names})\b\.?\s+(\d{{1,2}})(?:st|nd|rd|th)?(?:,?\s+(\d{{4}}))?", low)
    if m:
        a, b, year = m[1], m[2], m[3]
        day, month = (int(a), MONTHS[b]) if a.isdigit() else (int(b), MONTHS[a])
        try:
            return date(int(year) if year else today.year, month, day).isoformat(), m[0]
        except ValueError:
            pass
    relative = [
        (r"\btoday\b|आज|\baaj\b", lambda: today),
        (r"\byesterday\b", lambda: today - timedelta(days=1)),
        (r"\btomorrow\b", lambda: today + timedelta(days=1)),
        (r"last week|पिछले हफ्ते|पिछले सप्ताह|pichhle hafte", lambda: today - timedelta(days=7)),
        (r"next week|अगले हफ्ते|अगले सप्ताह|agle hafte", lambda: today + timedelta(days=7)),
        (r"last month|पिछले महीने|pichhle mahine|pichle mahine", lambda: _add_months(today, -1)),
        (r"next month|अगले महीने|agle mahine", lambda: _add_months(today, 1)),
        (r"last year|पिछले साल|pichhle saal", lambda: _add_months(today, -12)),
        (r"next year|अगले साल|agle saal", lambda: _add_months(today, 12)),
    ]
    for pattern, make in relative:
        m = re.search(pattern, low)
        if m:
            return make().isoformat(), m[0]
    return None, None


def _amount(low: str) -> tuple[int | None, str | None]:
    """An amount of money in the text, in rupees, and whether it was per month."""
    m = re.search(
        r"(?:₹|rs\.?|inr|rupees?)\s*([\d,]+(?:\.\d+)?)\s*(lakh|lac|लाख|crore|करोड़|k|thousand|हज़ार|हजार)?"
        r"|([\d,]+(?:\.\d+)?)\s*(lakh|lac|लाख|crore|करोड़|thousand|हज़ार|हजार|rupees|रुपये|रुपए)",
        low,
    )
    if not m:
        return None, None
    number = float((m[1] or m[3]).replace(",", ""))
    unit = (m[2] or m[4] or "").lower()
    scale = {
        "lakh": 1e5,
        "lac": 1e5,
        "लाख": 1e5,
        "crore": 1e7,
        "करोड़": 1e7,
        "k": 1e3,
        "thousand": 1e3,
        "हज़ार": 1e3,
        "हजार": 1e3,
    }.get(unit, 1)
    period = (
        "monthly"
        if re.search(r"per month|a month|monthly|/month|महीना|महीने|मासिक|mahina", low)
        else "yearly"
    )
    return int(round(number * scale)), period


def interpret(text: str, people: list[dict] | None = None):
    people = people or []
    low = text.lower()
    today = datetime.now(IST).date()
    kind = "note"
    if re.search(
        r"\bmov(?:e|ed|ing)\b|relocat|shift(?:ing|ed)? to|दूसरे राज्य|स्थानांतरण|जा रह|शिफ्ट", low
    ):
        kind = "moving"
    elif re.search(
        r"passed away|pass away|bereav|\bdied\b|\bdeath\b|\bexpired\b|no more|मृत्यु|देहांत|निधन|गुज़र|गुजर|नहीं रहे",
        low,
    ):
        kind = "bereavement"
    elif re.search(r"retir|turn(?:ed|ing|s)? 60|सेवानिवृ|रिटायर", low):
        kind = "retirement"
    elif re.search(
        r"scholarship|renew|college|admission|university|degree|semester|छात्रवृत्ति|स्कॉलरशिप|कॉलेज|नवीनीकरण|दाखिला|पढ़ाई",
        low,
    ):
        kind = "education"
    elif re.search(
        r"bonus|salary|pay rise|increment|income|\bjob\b|\bearn|promot|lost my job|बोनस|वेतन|आय|नौकरी|कमाई|तनख्वाह",
        low,
    ):
        kind = "income_review"
    destination = None
    if kind == "moving":
        candidates = [
            (m.start(), state)
            for state in STATES
            for m in re.finditer(r"\b" + re.escape(state.lower()) + r"\b", low)
        ]
        candidates += [
            (m.start(), state)
            for word, state in HINDI.items()
            for m in re.finditer(re.escape(word), text)
        ]
        if candidates:
            destination = sorted(candidates)[-1][1]

    mentioned, we = _people_mentioned(low, people)
    self_id = next((p["id"] for p in people if p.get("relation") == "self"), None)
    living = [p for p in people if not p.get("deceased")]
    subject_id = None
    if kind == "bereavement":
        # the survivor applies; the person who passed away is the case's related person
        person_ids = [self_id] if self_id else []
        subject_id = mentioned[0]["id"] if mentioned else None
    elif kind == "moving" and we:
        person_ids = [p["id"] for p in living]
    elif mentioned:
        person_ids = [p["id"] for p in mentioned if not p.get("deceased")]
    else:
        person_ids = [self_id] if self_id else []
    mode = None
    answers: dict = {}
    if kind == "education":
        if re.search(r"renew|again|नवीनीकरण|दोबारा|फिर से", low) or re.search(
            rf"(?:{ORDINALS[2]}|{ORDINALS[3]}|{ORDINALS[4]}|{ORDINALS[5]}|final)\s*(?:year|yr|साल|वर्ष)",
            low,
        ):
            mode = "renewal"
        elif re.search(
            rf"(?:{ORDINALS[1]})\s*(?:year|yr|साल|वर्ष)|admission|got into|दाखिला|new application",
            low,
        ):
            mode = "fresh"
        for year, pattern in ORDINALS.items():
            if re.search(rf"(?:{pattern})\s*(?:year|yr|साल|वर्ष)", low):
                answers["course_year"] = year
                break
    income, period = (None, None)
    if kind == "income_review" and re.search(r"salary|income|earn|वेतन|आय|कमाई|तनख्वाह|now|अब", low):
        amount, period = _amount(low)
        if amount is not None and not re.search(r"bonus|बोनस", low):
            income = amount * 12 if period == "monthly" else amount
    when, when_text = _date(low, today)
    explanations = {
        "note": (
            "Saved as your personal event. No eligibility facts are inferred.",
            "इसे निजी घटना के रूप में सहेजें। पात्रता के तथ्य अपने-आप नहीं बदलेंगे।",
        ),
        "income_review": (
            "This is a personal update. A bonus or job note does not automatically change your saved income. Confirm updated income only if you want a reassessment.",
            "यह निजी अपडेट है। बोनस या नौकरी का नोट सहेजी आय अपने-आप नहीं बदलता। पुनः जाँच के लिए नई आय की पुष्टि करें।",
        ),
        "moving": (
            "Confirm who moved, the destination and date. Only a confirmed current move changes residence facts and affected cases.",
            "कौन गया, नया राज्य और तिथि की पुष्टि करें। पुष्टि की गई वर्तमान यात्रा ही निवास और संबंधित मामलों को बदलेगी।",
        ),
        "bereavement": (
            "Choose the affected person and applicant before preparing any benefit or claim route.",
            "सहायता या दावे की तैयारी से पहले दिवंगत व्यक्ति और आवेदक चुनें।",
        ),
        "retirement": (
            "Confirm the applicant’s actual age and circumstances; a retirement note does not change their age automatically.",
            "आवेदक की वास्तविक आयु और स्थिति की पुष्टि करें; नोट से आयु नहीं बदलती।",
        ),
        "education": (
            "Choose fresh or renewal and confirm the student’s own situation.",
            "नया आवेदन या नवीनीकरण चुनें और छात्र की स्थिति की पुष्टि करें।",
        ),
    }
    known = {p["id"] for p in mentioned}
    unknown_relations = [
        r
        for r in _relation_words(low)
        if not any(r in str(p.get("relation", "")).lower() for p in people if p["id"] in known)
    ]
    return {
        "kind": kind,
        "suggested_destination": destination,
        "explanation": explanations[kind][0],
        "explanation_hi": explanations[kind][1],
        "parser": "local suggested intent; review required",
        "states": STATES,
        "person_ids": [p for p in person_ids if p],
        "mentioned": [
            {"id": p["id"], "name": p.get("name"), "relation": p.get("relation"), "how": p["how"]}
            for p in mentioned
        ],
        "unknown_relations": unknown_relations,
        "about_others": any(pid != self_id for pid in person_ids if pid),
        "subject_id": subject_id,
        "mode": mode,
        "answers": answers,
        "income": income,
        "income_period": period if income is not None else None,
        "occurred_on": when,
        "date_text": when_text,
    }


def apply(
    ws: Workspace,
    text,
    person_ids,
    kind,
    occurred_on,
    destination,
    confirm_move,
    income,
    confirm_income,
    mode=None,
    answers=None,
    subject_id=None,
    confirm_deceased=False,
):
    people = {p.id: p for p in ws.people}
    if (
        not person_ids
        or len(person_ids) != len(set(person_ids))
        or not set(person_ids) <= set(people)
    ):
        raise ValueError("Select each affected person once")
    if any(people[pid].deceased for pid in person_ids):
        raise ValueError("Select a living applicant for a personal update")
    if subject_id is not None and (subject_id not in people or subject_id in person_ids):
        raise ValueError("The person who passed away must be someone other than the applicant")
    # only details the reviewed case type uses are carried into the new case
    answers = {k: v for k, v in (answers or {}).items() if k in {"course_year"}}
    out = ws.model_copy(deep=True)
    now = datetime.now(IST)
    today = now.date()
    if kind == "bereavement" and occurred_on and occurred_on > today:
        # a death cannot be recorded ahead of time; present facts never change for a future event
        raise ValueError("A bereavement cannot have a future date. Check the date and try again.")
    subject_was_deceased = bool(subject_id and people.get(subject_id) and people[subject_id].deceased)
    if kind == "bereavement" and subject_id and confirm_deceased:
        subject = next(p for p in out.people if p.id == subject_id)
        subject.deceased = True
    event_id = uuid.uuid4().hex
    before = {p["case_id"]: p for p in plan(ws)["cases"]}
    changes = []
    scheduled = bool(occurred_on and occurred_on > today)
    new_cases = []
    for pid in person_ids:
        person = next(p for p in out.people if p.id == pid)
        if kind == "moving" and confirm_move and not scheduled:
            if destination not in STATES or not occurred_on:
                raise ValueError("Confirm the destination state and actual move date")
            origin = str(
                person.facts.get("state")
                or next(
                    (
                        f.value
                        for f in out.household
                        if f.field == "state" and f.confirmed and pid in f.person_ids
                    ),
                    "Unknown",
                )
            )
            if origin.lower() != destination.lower():
                years = max(
                    0,
                    today.year
                    - occurred_on.year
                    - ((today.month, today.day) < (occurred_on.month, occurred_on.day)),
                )
                person.facts["state"] = destination
                person.facts["years_in_state"] = years
                for c in out.cases:
                    if c.applicant_id == pid:
                        c.answers.update(state=destination, years_in_state=years)
                        c.events = (
                            c.events
                            + [
                                CaseEvent(
                                    id=uuid.uuid4().hex,
                                    at=now.isoformat(),
                                    actor="owner",
                                    text=f"Confirmed move from {origin} to {destination}; residence-dependent preparation reassessed",
                                )
                            ]
                        )[-100:]
                for doc in out.documents + [d for c in out.cases for d in c.documents]:
                    if doc.person_id == pid and doc.kind in (
                        "doc_domicile_certificate",
                        "doc_voter_id",
                        "doc_address_proof",
                    ):
                        doc.issued_state = doc.issued_state or origin
                changes.append(
                    {"person_id": pid, "field": "state", "before": origin, "after": destination}
                )
            c = Case(
                id=uuid.uuid4().hex,
                kind="moving",
                title=text[:150],
                applicant_id=pid,
                occurred_on=occurred_on,
                answers={"from_state": origin, "to_state": destination},
            )
            new_cases.append(c)
        elif kind == "income_review" and confirm_income and not scheduled:
            if income is None or income < 0:
                raise ValueError("Enter the confirmed annual personal income")
            old = person.facts.get("annual_personal_income")
            person.facts["annual_personal_income"] = income
            for c in out.cases:
                if c.applicant_id == pid:
                    c.answers["annual_personal_income"] = income
            changes.append(
                {
                    "person_id": pid,
                    "field": "annual_personal_income",
                    "before": old,
                    "after": income,
                }
            )
        elif kind in ("bereavement", "retirement", "education"):
            new_cases.append(
                Case(
                    id=uuid.uuid4().hex,
                    kind=kind,
                    title=text[:150],
                    applicant_id=pid,
                    subject_id=subject_id if kind == "bereavement" else None,
                    occurred_on=occurred_on,
                    mode=mode if kind == "education" and mode in ("fresh", "renewal") else "fresh",
                    answers=answers if kind == "education" else {},
                )
            )
    if kind == "bereavement" and subject_id and confirm_deceased and not subject_was_deceased:
        changes.append(
            {"person_id": subject_id, "field": "deceased", "before": False, "after": True}
        )
    out.cases.extend(new_cases)
    out.journal = (
        out.journal
        + [
            PersonalEvent(
                id=event_id,
                text=text,
                kind=kind,
                person_ids=person_ids,
                at=now.isoformat(),
                occurred_on=occurred_on,
                changed_fields=changes,
                scheduled=scheduled,
                case_ids=[c.id for c in new_cases],
            )
        ]
    )[-200:]
    # Revalidate the generated workspace as well as the request. Do not bypass case/answer limits.
    out = Workspace.model_validate(out.model_dump())
    after = plan(out)
    affected = []
    for p in after["cases"]:
        old = before.get(p["case_id"])
        if old and any(
            old.get(k) != p.get(k) for k in ("status", "missing", "requirements", "deadlines")
        ):
            affected.append(
                {"case_id": p["case_id"], "before": old["status"], "after": p["status"]}
            )
    return {
        "workspace": out.model_dump(mode="json"),
        "plan": after,
        "changes": changes,
        "affected_cases": affected,
        "new_case_ids": [c.id for c in new_cases],
        "scheduled": scheduled,
    }


# ------------------------------------------------------------------ "Preview what changes"
FIELD_NAMES = {
    "state": ("State", "राज्य"),
    "years_in_state": ("Years living in the state", "राज्य में निवास के वर्ष"),
    "annual_personal_income": ("Annual personal income", "वार्षिक व्यक्तिगत आय"),
    "deceased": ("Marked as passed away", "दिवंगत दर्ज"),
}
KIND_WHY = {
    "bereavement": (
        "A death in the family can make the survivor eligible for a widow pension and a family benefit; JAAGRUK opens a case that asks only what those rules need.",
        "परिवार में मृत्यु के बाद जीवित सदस्य विधवा पेंशन और पारिवारिक सहायता के पात्र हो सकते हैं; JAAGRUK एक मामला खोलता है जो केवल वही पूछता है जो इन नियमों के लिए ज़रूरी है।",
    ),
    "retirement": (
        "Turning 60 or retiring can open an old-age pension; the case checks age, residence, income and other pensions.",
        "60 वर्ष या सेवानिवृत्ति पर वृद्धावस्था पेंशन मिल सकती है; मामला उम्र, निवास, आय और अन्य पेंशन जाँचता है।",
    ),
    "education": (
        "A course year starting or renewing is when scholarships open; the case follows the reviewed CSSS rule for fresh or renewal applications.",
        "पाठ्यक्रम वर्ष शुरू या नवीनीकृत होने पर छात्रवृत्ति खुलती है; मामला नए या नवीनीकरण आवेदन के लिए समीक्षित CSSS नियम मानता है।",
    ),
    "moving": (
        "A confirmed move changes the state you live in; residence-based preparation is re-checked and a ration-card portability case is opened.",
        "पुष्टि किए गए स्थानांतरण से आपका राज्य बदलता है; निवास-आधारित तैयारी फिर से जाँची जाती है और राशन कार्ड पोर्टेबिलिटी का मामला खुलता है।",
    ),
}


def workspace_hash(ws: Workspace) -> str:
    import hashlib
    import json

    return hashlib.sha256(json.dumps(ws.model_dump(mode="json"), sort_keys=True).encode()).hexdigest()[:20]


def preview(ws: Workspace, text, person_ids, kind, occurred_on, destination, confirm_move, income, confirm_income, **kw):
    """Run apply() without keeping anything and explain each consequence in plain words."""
    from . import rules_registry

    res = apply(ws, text, person_ids, kind, occurred_on, destination, confirm_move, income, confirm_income, **kw)
    names = {p.id: p.name for p in ws.people}
    before = {p["case_id"]: p for p in plan(ws)["cases"]}
    after_cases = {p["case_id"]: p for p in res["plan"]["cases"]}

    def plan_view(p):
        return {
            "status": p["status"],
            "status_label": p.get("status_label"),
            "status_hi": p.get("status_hi"),
            "questions": [q["label"] for q in p.get("questions", [])],
            "questions_hi": [q["label_hi"] for q in p.get("questions", [])],
            "documents": [r["label"] for r in p.get("requirements", [])],
            "documents_hi": [r["label_hi"] for r in p.get("requirements", [])],
            "dates": [{"title": d["title"], "title_hi": d["title_hi"], "date": d["date"]} for d in p.get("deadlines", [])],
        }

    new_cases = []
    for cid in res["new_case_ids"]:
        c = next(x for x in res["workspace"]["cases"] if x["id"] == cid)
        new_cases.append(
            {
                "kind": c["kind"],
                "person": names.get(c["applicant_id"], ""),
                "subject": names.get(c.get("subject_id") or "", ""),
                "why": KIND_WHY.get(c["kind"], ("", ""))[0],
                "why_hi": KIND_WHY.get(c["kind"], ("", ""))[1],
                **plan_view(after_cases[cid]),
            }
        )
    affected = []
    for cid, old in before.items():
        new = after_cases.get(cid)
        if not new:
            continue
        a, b = plan_view(old), plan_view(new)
        if a != b:
            c = next(x for x in ws.cases if x.id == cid)
            affected.append(
                {
                    "title": c.title,
                    "person": names.get(c.applicant_id, ""),
                    "before": a,
                    "after": b,
                    "added_questions": [q for q in b["questions"] if q not in a["questions"]],
                    "removed_questions": [q for q in a["questions"] if q not in b["questions"]],
                    "added_documents": [d for d in b["documents"] if d not in a["documents"]],
                    "removed_documents": [d for d in a["documents"] if d not in b["documents"]],
                }
            )
    facts = [
        {
            "person": names.get(ch["person_id"], ""),
            "field": FIELD_NAMES.get(ch["field"], (ch["field"], ch["field"]))[0],
            "field_hi": FIELD_NAMES.get(ch["field"], (ch["field"], ch["field"]))[1],
            "before": ch.get("before"),
            "after": ch.get("after"),
        }
        for ch in res["changes"]
    ]
    unchanged, unchanged_hi = [], []
    others = [p.name for p in ws.people if p.id not in person_ids and p.id != kw.get("subject_id")]
    if others:
        unchanged.append("Nothing changes for " + ", ".join(others) + ".")
        unchanged_hi.append(", ".join(others) + " के लिए कुछ नहीं बदलता।")
    if res["scheduled"]:
        unchanged.append("This is a planned event, so present facts stay as they are until it happens.")
        unchanged_hi.append("यह आगे की घटना है, इसलिए वर्तमान जानकारी तब तक नहीं बदलती।")
    if kind == "income_review" and not (confirm_income and income is not None):
        unchanged.append("Income is not changed — this is kept as a note until you confirm a new annual income.")
        unchanged_hi.append("आय नहीं बदली — नई वार्षिक आय की पुष्टि होने तक यह केवल नोट है।")
    if kind == "moving" and not confirm_move:
        unchanged.append("Your state is not changed until you confirm the move and its date.")
        unchanged_hi.append("स्थानांतरण और तारीख की पुष्टि तक आपका राज्य नहीं बदलता।")
    if kind == "note":
        unchanged.append("A note is kept in your journal; it does not change any fact or case.")
        unchanged_hi.append("नोट आपकी डायरी में रहता है; इससे कोई जानकारी या मामला नहीं बदलता।")
    unknown = sorted({q for nc in new_cases for q in nc["questions"]})
    unknown_hi = sorted({q for nc in new_cases for q in nc["questions_hi"]})
    return {
        "base_hash": workspace_hash(ws),
        "rules_version": rules_registry.version(),
        "facts": facts,
        "new_cases": new_cases,
        "affected_cases": affected,
        "unchanged": unchanged,
        "unchanged_hi": unchanged_hi,
        "still_unknown": unknown,
        "still_unknown_hi": unknown_hi,
        "scheduled": res["scheduled"],
    }
