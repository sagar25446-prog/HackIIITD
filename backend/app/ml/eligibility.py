"""Neuro-symbolic eligibility engine.

Scheme rules (extracted from official sources) are compiled into Z3 constraints. For a citizen
profile with some facts unknown, Z3 *proves* one of:
  eligible      — the rules hold for every possible value of the unknown facts
  not_eligible  — the rules fail for every possible value (with the minimal failing clauses)
  needs_info    — it depends on facts we don't know yet (we say which)
The unlock-path optimiser then uses z3.Optimize to pick the 1–2 documents that unlock the most ₹.
"""
from __future__ import annotations

import functools
import json
import threading
from dataclasses import dataclass, field
from functools import lru_cache
from typing import Any

import z3

from ..config import DATA_DIR

# Z3's Python API shares one global context and is not thread-safe; the API runs solver work in worker
# threads, so every entry point takes this lock (re-entrant: entry points call each other).
Z3_LOCK = threading.RLock()


def z3_safe(fn):
    @functools.wraps(fn)
    def wrapper(*args, **kwargs):
        with Z3_LOCK:
            return fn(*args, **kwargs)
    return wrapper

ENUMS: dict[str, list[str]] = {
    "gender": ["male", "female", "other"],
    "state": ["Delhi", "Uttar Pradesh", "Haryana", "Bihar", "Maharashtra", "Karnataka", "Tamil Nadu",
              "West Bengal", "Rajasthan", "Other"],
    "category": ["general", "obc", "sc", "st", "ews"],
    "marital_status": ["single", "married", "widowed", "divorced", "separated"],
    "occupation": ["student", "job_seeker", "farmer", "gig_worker", "self_employed", "artisan", "street_vendor",
                   "private_employee", "govt_employee", "homemaker", "retired"],
    "trade": ["none", "carpenter", "boat_maker", "armourer", "blacksmith", "tool_kit_maker", "locksmith", "goldsmith",
              "potter", "sculptor", "cobbler", "mason", "basket_weaver", "toy_maker", "barber", "garland_maker",
              "washerman", "tailor", "fishing_net_maker"],
}
INTS: dict[str, tuple[int, int]] = {
    "age": (0, 120), "years_in_state": (0, 120), "annual_family_income": (0, 100_000_000),
    "monthly_income": (0, 10_000_000), "education": (0, 7), "class12_percentile": (0, 100),
}
EDUCATION_LABELS = ["No schooling", "Below Class 8", "Class 8", "Class 10", "Class 12", "Diploma / ITI",
                    "Graduate", "Postgraduate"]


def _is_bool_field(name: str) -> bool:
    return name not in ENUMS and name not in INTS


@lru_cache(maxsize=1)
def load_schemes() -> list[dict]:
    return json.loads((DATA_DIR / "schemes.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_exams() -> list[dict]:
    return json.loads((DATA_DIR / "exams.json").read_text(encoding="utf-8"))


@lru_cache(maxsize=1)
def load_documents() -> dict:
    return json.loads((DATA_DIR / "documents.json").read_text(encoding="utf-8"))


class Vars:
    """Lazily created Z3 variables with their domain constraints."""

    def __init__(self) -> None:
        self.v: dict[str, z3.ExprRef] = {}
        self.domain: list[z3.BoolRef] = []

    def get(self, name: str) -> z3.ExprRef:
        if name not in self.v:
            if name in ENUMS:
                x = z3.Int(name)
                self.domain += [x >= 0, x < len(ENUMS[name])]
            elif name in INTS:
                x = z3.Int(name)
                lo, hi = INTS[name]
                self.domain += [x >= lo, x <= hi]
            else:
                x = z3.Bool(name)
            self.v[name] = x
        return self.v[name]


def _code(field_name: str, value: Any) -> Any:
    if field_name in ENUMS:
        vals = ENUMS[field_name]
        return vals.index(value) if value in vals else vals.index("Other") if "Other" in vals else -1
    return value


def compile_cond(c: dict, V: Vars) -> z3.BoolRef:
    f, op, val = c["field"], c["op"], c.get("value")
    x = V.get(f)
    if op == "true":
        return x == True  # noqa: E712 - z3 expression
    if op == "false":
        return x == False  # noqa: E712
    if op == "in":
        return z3.Or(*[x == _code(f, v) for v in val])
    if op == "not_in":
        return z3.And(*[x != _code(f, v) for v in val])
    code = _code(f, val)
    return {"eq": x == code, "ne": x != code, "ge": x >= code, "le": x <= code, "gt": x > code,
            "lt": x < code}[op]


def profile_constraints(profile: dict, V: Vars, fields: set[str]) -> list[z3.BoolRef]:
    out = []
    for f in fields:
        if f not in profile or profile[f] is None or profile[f] == "":
            continue
        x, val = V.get(f), profile[f]
        if f in ENUMS:
            out.append(x == _code(f, val))
        elif f in INTS:
            out.append(x == int(val))
        else:
            out.append(x == bool(val))
    return out


def _fmt_value(f: str, v: Any) -> str:
    if f == "education" and isinstance(v, int) and 0 <= v < len(EDUCATION_LABELS):
        return EDUCATION_LABELS[v]
    if f in ("annual_family_income", "monthly_income") and isinstance(v, (int, float)):
        return f"₹{int(v):,}"
    if isinstance(v, bool):
        return "yes" if v else "no"
    return str(v)


@dataclass
class Decision:
    id: str
    status: str                       # eligible | not_eligible | needs_info
    reasons: list[dict] = field(default_factory=list)      # per-condition proof lines
    failing: list[str] = field(default_factory=list)       # minimal failing clauses (unsat core)
    missing_facts: list[str] = field(default_factory=list)
    docs_missing: list[str] = field(default_factory=list)
    advisories: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return self.__dict__.copy()


@z3_safe
def decide(rule: dict, profile: dict) -> Decision:
    V = Vars()
    hard = [c for c in rule.get("conditions", []) if not c.get("soft")]
    soft = [c for c in rule.get("conditions", []) if c.get("soft")]
    groups = rule.get("any_of", [])
    all_conds = hard + soft + [c for g in groups for c in g]
    fields = {c["field"] for c in all_conds}

    exprs = [(c, compile_cond(c, V)) for c in hard]
    group_exprs = [z3.Or(*[z3.And(*[compile_cond(c, V) for c in g]) for g in groups])] if groups else []
    E = z3.And(*([e for _, e in exprs] + group_exprs)) if (exprs or group_exprs) else z3.BoolVal(True)
    P = profile_constraints(profile, V, fields)

    s = z3.Solver()
    s.add(*V.domain, *P)
    eligible = s.check(z3.Not(E)) == z3.unsat
    impossible = s.check(E) == z3.unsat
    d = Decision(id=rule["id"], status="eligible" if eligible else "not_eligible" if impossible else "needs_info")

    # per-condition proof lines (three-valued)
    for c, e in exprs:
        holds = s.check(z3.Not(e)) == z3.unsat
        fails = s.check(e) == z3.unsat
        state = "pass" if holds else "fail" if fails else "unknown"
        val = profile.get(c["field"])
        d.reasons.append({"label": c["label"], "state": state, "field": c["field"],
                          "value": None if val is None else _fmt_value(c["field"], val)})
    if groups:
        g_hold = s.check(z3.Not(group_exprs[0])) == z3.unsat
        g_fail = s.check(group_exprs[0]) == z3.unsat
        d.reasons.append({"label": " OR ".join(" & ".join(c["label"] for c in g) for g in groups),
                          "state": "pass" if g_hold else "fail" if g_fail else "unknown", "field": "any_of"})

    if impossible:
        # minimal failing set via unsat core
        t = z3.Solver()
        t.add(*V.domain, *P)
        trackers = {}
        for i, (c, e) in enumerate(exprs):
            lit = z3.Bool(f"__c{i}")
            trackers[str(lit)] = c["label"]
            t.assert_and_track(e, lit)
        if group_exprs:
            lit = z3.Bool("__group")
            trackers["__group"] = d.reasons[-1]["label"]
            t.assert_and_track(group_exprs[0], lit)
        if t.check() == z3.unsat:
            d.failing = [trackers[str(x)] for x in t.unsat_core() if str(x) in trackers]
    elif not eligible:
        d.missing_facts = sorted({c["field"] for c in all_conds if profile.get(c["field"]) in (None, "")})

    if d.status != "not_eligible":
        needs_proof = list(hard)
        # for an either/or rule, ask only for the documents of the alternative that applies
        for g in groups:
            if all(s.check(z3.Not(compile_cond(c, V))) == z3.unsat for c in g):
                needs_proof += g
                break
        for c in needs_proof:
            doc = c.get("doc")
            if doc and not profile.get(doc) and doc not in d.docs_missing:
                d.docs_missing.append(doc)
        for c in soft:
            e = compile_cond(c, V)
            if s.check(e) == z3.unsat:
                d.advisories.append(f"Check: {c['label']}")
    return d


# ---------------------------------------------------------------------------- exams
@z3_safe
def decide_exam(exam: dict, profile: dict) -> dict:
    """Age window with category relaxation, education requirement — proved with Z3."""
    V = Vars()
    age, cat, edu, dis = V.get("age"), V.get("category"), V.get("education"), V.get("disability")
    a = exam["age"]
    relax = z3.If(cat == ENUMS["category"].index("obc"), a["relax"].get("obc", 0),
                  z3.If(z3.Or(cat == ENUMS["category"].index("sc"), cat == ENUMS["category"].index("st")),
                        a["relax"].get("sc", 0), 0)) + z3.If(dis, a.get("pwd_extra", 0), 0)
    upper = a["max"] + relax
    P = profile_constraints(profile, V, {"age", "category", "education", "disability"})
    s = z3.Solver()
    s.add(*V.domain, *P)
    need_edu = exam["education"]["min"]
    final_year_ok = exam["education"].get("final_year_ok") and profile.get("in_full_time_education") \
        and (profile.get("education") or 0) >= need_edu - 2
    conds = {"age_min": age >= a["min"], "age_max": age <= upper,
             "education": edu >= need_edu if not final_year_ok else edu >= need_edu - 2}

    def state(e):
        return "pass" if s.check(z3.Not(e)) == z3.unsat else "fail" if s.check(e) == z3.unsat else "unknown"

    st = {k: state(e) for k, e in conds.items()}
    relax_years = None
    if profile.get("category") is not None and s.check() == z3.sat:
        # relaxation is fully determined once category and disability are known
        relax_years = s.model().eval(relax, model_completion=True).as_long()
    out = {"id": exam["id"], "checks": st, "relaxation_years": relax_years,
           "upper_age": a["max"] + (relax_years or 0)}
    if all(v == "pass" for v in st.values()):
        out["status"] = "eligible"
        out["years_left"] = out["upper_age"] - int(profile["age"]) if profile.get("age") is not None else None
    elif st["age_max"] == "fail":
        out["status"] = "not_eligible"
        out["why"] = f"Above the age limit ({out['upper_age']} incl. relaxation)"
    elif st["age_min"] == "fail":
        out["status"] = "not_yet"
        out["why"] = f"Eligible from age {a['min']}"
        if profile.get("age") is not None:
            out["in_years"] = a["min"] - int(profile["age"])
    elif st["education"] == "fail":
        out["status"] = "not_yet"
        out["why"] = f"Needs: {exam['education']['label']}"
    else:
        out["status"] = "needs_info"
    return out


# ---------------------------------------------------------------------------- unlock path
def scheme_value(rule: dict) -> int:
    b = rule.get("benefit", {})
    return int(b.get("annual_value") or 0) + int(b.get("one_time_value") or 0)


@z3_safe
def unlock_paths(decisions: list[Decision], rules_by_id: dict[str, dict], max_docs: int = 2) -> list[dict]:
    """Weighted set cover with z3.Optimize: which 1–2 documents unlock the most value?"""
    candidates = [d for d in decisions if d.status != "not_eligible" and d.docs_missing]
    docs = sorted({doc for d in candidates for doc in d.docs_missing})
    if not docs:
        return []
    plans = []
    for k in range(1, min(max_docs, len(docs)) + 1):
        opt = z3.Optimize()
        pick = {doc: z3.Bool(f"pick_{doc}") for doc in docs}
        unlocked = []
        for d in candidates:
            u = z3.And(*[pick[x] for x in d.docs_missing])
            # every scheme is worth at least ₹1 so schemes without a ₹ figure still count
            unlocked.append((d, u, max(1, scheme_value(rules_by_id[d.id]))))
        opt.add(z3.Sum([z3.If(p, 1, 0) for p in pick.values()]) <= k)
        total = z3.Sum([z3.If(u, v, 0) for _, u, v in unlocked])
        opt.maximize(total)
        if opt.check() != z3.sat:
            continue
        m = opt.model()
        chosen = [doc for doc, p in pick.items() if z3.is_true(m.eval(p, model_completion=True))]
        gained = [d.id for d, u, _ in unlocked if z3.is_true(m.eval(u, model_completion=True))]
        if not gained:
            continue
        value = sum(scheme_value(rules_by_id[i]) for i in gained)
        plan = {"documents": chosen, "unlocks": gained, "value_inr": value}
        if plan not in plans and (not plans or set(plan["unlocks"]) != set(plans[-1]["unlocks"])):
            plans.append(plan)
    return plans
