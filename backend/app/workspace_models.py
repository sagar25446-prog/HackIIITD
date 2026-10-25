"""Validated, person-scoped inputs. Private workspaces are evaluated, never persisted here."""

from __future__ import annotations

from datetime import date
from typing import Any, Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator

FACTS = {
    "state",
    "years_in_state",
    "annual_family_income",
    "annual_personal_income",
    "category",
    "bpl",
    "govt_employee_in_family",
    "has_lpg_connection",
    "owns_cultivable_land",
    "age",
    "gender",
    "occupation",
    "education",
    "marital_status",
    "disability",
    "has_bank_account",
    "income_tax_payer",
    "epfo_esic_member",
    "receives_other_pension",
    "breadwinner_died_18_59",
    "girl_child_under_10",
    "pregnant_or_new_mother",
    "in_full_time_education",
    "employed_full_time",
    "class12_percentile",
    "aicte_technical_course",
    "qhei_admission",
    "new_enterprise",
    "trade",
    "monthly_income",
    "previous_award",
    "marks_percent",
    "attendance_percent",
    "course_year",
    "degree_course",
    "took_gap_year",
    "other_scholarship",
    "nfsa_beneficiary",
    "same_household",
    "from_state",
    "to_state",
    "existing_policy",
    "nominee_known",
    "claimant_relation",
    "claimant_capacity",
    "responsible_institution",
    "asset_category",
    "institution",
    "service",
    "application_stage",
    "vehicle_type",
    "learner_issued_on",
    "already_has_pan",
    "aadhaar_ready",
    "linked_mobile",
    "representative_assessee",
}
SHARED_FACTS = {
    "state",
    "annual_family_income",
    "bpl",
    "govt_employee_in_family",
    "has_lpg_connection",
}
BOOLEAN_FACTS = {
    "bpl",
    "govt_employee_in_family",
    "has_lpg_connection",
    "owns_cultivable_land",
    "disability",
    "has_bank_account",
    "income_tax_payer",
    "epfo_esic_member",
    "receives_other_pension",
    "breadwinner_died_18_59",
    "girl_child_under_10",
    "pregnant_or_new_mother",
    "in_full_time_education",
    "employed_full_time",
    "aicte_technical_course",
    "qhei_admission",
    "new_enterprise",
    "previous_award",
    "degree_course",
    "took_gap_year",
    "other_scholarship",
    "nfsa_beneficiary",
    "same_household",
    "existing_policy",
    "nominee_known",
    "already_has_pan",
    "aadhaar_ready",
    "linked_mobile",
    "representative_assessee",
}
TEXT_FACTS = {
    "state",
    "category",
    "gender",
    "occupation",
    "marital_status",
    "trade",
    "from_state",
    "to_state",
    "claimant_relation",
    "claimant_capacity",
    "responsible_institution",
    "asset_category",
    "institution",
    "service",
    "application_stage",
    "vehicle_type",
    "learner_issued_on",
}


def validate_facts(value: dict) -> dict:
    if len(value) > 60 or set(value) - FACTS:
        raise ValueError("Only supported non-sensitive applicant facts may be saved")
    for key, v in value.items():
        if v is None:
            continue
        if key in BOOLEAN_FACTS and type(v) is not bool:
            raise ValueError(f"{key} must be true, false or unknown")
        if key in TEXT_FACTS and not isinstance(v, str):
            raise ValueError(f"{key} must be text or unknown")
        if type(v) not in (str, int, float, bool) or isinstance(v, str) and len(v) > 120:
            raise ValueError("Facts must be short, non-sensitive values")
        if isinstance(v, float) and (v != v or abs(v) == float("inf")):
            raise ValueError("Numbers must be finite")
        if key in {
            "age",
            "years_in_state",
            "annual_family_income",
            "annual_personal_income",
            "marks_percent",
            "attendance_percent",
            "class12_percentile",
            "monthly_income",
            "course_year",
            "education",
        }:
            if type(v) not in (int, float) or v < 0:
                raise ValueError(f"{key} must be a non-negative number")
            if key in {"marks_percent", "attendance_percent", "class12_percentile"} and v > 100:
                raise ValueError("Percentages must be within 0–100")
            if key == "age" and v > 120:
                raise ValueError("Age must be within 0–120")
            if key in {"course_year", "education"} and (
                not float(v).is_integer() or v > (5 if key == "course_year" else 7)
            ):
                raise ValueError(f"{key} must be a whole number in its supported range")
    return value


class Model(BaseModel):
    model_config = ConfigDict(extra="forbid", str_strip_whitespace=True)


class Person(Model):
    id: str = Field(min_length=1, max_length=80)
    name: str = Field(min_length=1, max_length=80)
    relation: str = Field(default="self", max_length=40)
    deceased: bool = False
    facts: dict[str, Any] = Field(default_factory=dict)
    _facts = field_validator("facts")(validate_facts)


class HouseholdFact(Model):
    field: str
    value: Any
    person_ids: list[str] = Field(max_length=20)
    confirmed: bool = False

    @model_validator(mode="after")
    def supported(self):
        if self.field not in SHARED_FACTS:
            raise ValueError("This fact cannot be shared between people")
        validate_facts({self.field: self.value})
        return self


class DocumentAssertion(Model):
    id: str = Field(min_length=1, max_length=100)
    person_id: str = Field(min_length=1, max_length=80)
    kind: str = Field(min_length=1, max_length=80)
    state: Literal["available", "missing", "unknown"] = "unknown"

    @field_validator("kind")
    @classmethod
    def safe_kind(cls, value):
        import re

        if not re.fullmatch(r"doc_[a-z_]+", value):
            raise ValueError("Choose a document type, never an identifier")
        return value

    issued_state: str | None = Field(default=None, max_length=80)
    expires_on: date | None = None
    covers_from: date | None = None
    covers_to: date | None = None

    @model_validator(mode="after")
    def interval(self):
        if self.covers_from and self.covers_to and self.covers_from > self.covers_to:
            raise ValueError("Coverage dates are reversed")
        return self


class CaseEvent(Model):
    id: str = Field(max_length=100)
    at: str = Field(max_length=40)
    actor: Literal["owner", "helper", "system"] = "owner"
    text: str = Field(max_length=500)


OUTCOMES = (
    "possible_record",
    "no_match",
    "citizen_step",
    "missing_input",
    "unavailable",
    "failed",
    "uncertain",
    "cancelled",
    "page_opened",
)


class Candidate(Model):
    """One record exactly as an official result showed it. Not ownership, not an approved claim."""

    display_name: str = Field(default="", max_length=120)
    amount_inr: float | None = Field(default=None, ge=0, le=1e10)
    reference: str = Field(default="", max_length=80)
    fields: dict[str, str] = Field(default_factory=dict, max_length=12)

    @field_validator("fields")
    @classmethod
    def short_fields(cls, v):
        return {str(k)[:40]: str(x)[:120] for k, x in v.items()}


class Observation(Model):
    """What one lookup or official visit showed. Provider evidence: helpers can never edit it."""

    id: str = Field(min_length=1, max_length=80)
    source_id: str = Field(min_length=1, max_length=60)
    holder_id: str | None = Field(default=None, max_length=80)
    checked_at: str = Field(max_length=40)
    provenance: Literal["automated_live", "automated_replay", "user_reported"]
    outcome: Literal[OUTCOMES]  # type: ignore[valid-type]
    engine: str = Field(default="", max_length=20)
    submitted: str = Field(default="", max_length=80)
    candidates: list[Candidate] = Field(default_factory=list, max_length=10)
    name_note: str = Field(default="", max_length=600)
    message: str = Field(default="", max_length=600)
    responsible_institution: str = Field(default="", max_length=120)
    job_id: str | None = Field(default=None, max_length=40)


class Case(Model):
    id: str = Field(min_length=1, max_length=80)
    kind: Literal["bereavement", "retirement", "education", "moving", "wapsi", "paperwork"]
    title: str = Field(min_length=1, max_length=150)
    applicant_id: str = Field(min_length=1, max_length=80)
    subject_id: str | None = Field(default=None, max_length=80)
    occurred_on: date | None = None
    stage: Literal[
        "preparing", "user_reported_submitted", "needs_attention", "user_reported_resolved"
    ] = "preparing"
    mode: Literal["fresh", "renewal"] = "fresh"
    answers: dict[str, Any] = Field(default_factory=dict)
    documents: list[DocumentAssertion] = Field(default_factory=list, max_length=80)
    completed_tasks: list[str] = Field(default_factory=list, max_length=100)
    notes: str = Field(default="", max_length=2000)
    follow_up: date | None = None
    events: list[CaseEvent] = Field(default_factory=list, max_length=100)
    observations: list[Observation] = Field(default_factory=list, max_length=40)
    _answers = field_validator("answers")(validate_facts)


class PersonalEvent(Model):
    id: str = Field(max_length=80)
    text: str = Field(min_length=1, max_length=1000)
    kind: str = Field(max_length=40)
    person_ids: list[str] = Field(max_length=20)
    at: str = Field(max_length=40)
    occurred_on: date | None = None
    changed_fields: list[dict] = Field(default_factory=list, max_length=40)
    scheduled: bool = False
    case_ids: list[str] = Field(default_factory=list, max_length=20)


class Workspace(Model):
    version: Literal[2] = 2
    owner_id: str | None = Field(default=None, min_length=1, max_length=80)
    people: list[Person] = Field(default_factory=list, max_length=20)
    household: list[HouseholdFact] = Field(default_factory=list, max_length=40)
    documents: list[DocumentAssertion] = Field(default_factory=list, max_length=200)
    cases: list[Case] = Field(default_factory=list, max_length=100)
    journal: list[PersonalEvent] = Field(default_factory=list, max_length=200)

    @model_validator(mode="after")
    def references(self):
        ids = [p.id for p in self.people]
        if len(ids) != len(set(ids)):
            raise ValueError("Duplicate person IDs")
        if self.owner_id is not None and self.owner_id not in ids:
            raise ValueError("Unknown workspace owner")
        case_ids = [c.id for c in self.cases]
        if len(case_ids) != len(set(case_ids)):
            raise ValueError("Duplicate case IDs")
        for c in self.cases:
            if c.applicant_id not in ids or c.subject_id and c.subject_id not in ids:
                raise ValueError("Unknown case person")
            if any(d.person_id not in {c.applicant_id, c.subject_id} for d in c.documents):
                raise ValueError("Document belongs to another person")
            if any(
                o.holder_id and o.holder_id not in {c.applicant_id, c.subject_id}
                for o in c.observations
            ):
                raise ValueError("A search result belongs to someone outside this case")
        if any(d.person_id not in ids for d in self.documents):
            raise ValueError("Unknown document owner")
        if any(not set(e.person_ids) <= set(ids) for e in self.journal):
            raise ValueError("Unknown event person")
        for fact in self.household:
            if not set(fact.person_ids) <= set(ids):
                raise ValueError("Unknown shared-fact person")
        return self
