"""Builds the citizen's personalised picture: matches, exams, Haq Meter, unlock path, next questions."""
from __future__ import annotations

import copy
import json
import time
from collections import OrderedDict, defaultdict
from functools import lru_cache
from typing import Any

from ..config import DATA_DIR
from ..ml import eligibility as el
from ..ml import forecaster, ranker
from . import persona


@lru_cache(maxsize=1)
def life_events() -> dict[str, dict]:
    return {e["id"]: e for e in json.loads((DATA_DIR / "life_events.json").read_text(encoding="utf-8"))}


def _exclusive_groups(ids: list[str], rules: dict[str, dict]) -> list[set[str]]:
    """Connected components of the 'exclusive_with' graph among the given schemes."""
    parent = {i: i for i in ids}

    def find(x):
        while parent[x] != x:
            parent[x] = parent[parent[x]]
            x = parent[x]
        return x

    for i in ids:
        for j in rules[i].get("exclusive_with", []):
            if j in parent:
                parent[find(i)] = find(j)
    groups: dict[str, set[str]] = defaultdict(set)
    for i in ids:
        groups[find(i)].add(i)
    return list(groups.values())


_CACHE: OrderedDict[str, dict] = OrderedDict()


def evaluate(raw_profile: dict[str, Any], wapsi_found_inr: int = 0) -> dict[str, Any]:
    """Cached front door: the home screen asks for the same family several times while it loads."""
    key = json.dumps([raw_profile, wapsi_found_inr], sort_keys=True, default=str)
    with el.Z3_LOCK:
        if key not in _CACHE:
            t0 = time.perf_counter()
            _CACHE[key] = _evaluate(raw_profile, wapsi_found_inr)
            _CACHE[key]["solver_ms"] = int((time.perf_counter() - t0) * 1000)  # the real solve, not a cache hit
            if len(_CACHE) > 64:
                _CACHE.popitem(last=False)
        _CACHE.move_to_end(key)
        return copy.deepcopy(_CACHE[key])


def _evaluate(raw_profile: dict[str, Any], wapsi_found_inr: int = 0) -> dict[str, Any]:
    rules = {r["id"]: r for r in el.load_schemes()}
    head = persona.build(raw_profile)
    tags = set(persona.tags(head))
    events = set(head.get("life_events") or [])

    people = [("self", head.get("name") or "You", head)]
    for m in head.get("family") or []:
        if not m.get("deceased"):
            people.append((m.get("relation", "member"), m.get("name") or m.get("relation", "member"),
                           persona.member_profile(head, m)))

    matches, decisions_all, questions = [], [], defaultdict(float)
    for who, who_name, prof in people:
        ptags = set(persona.tags(prof)) | (tags if who == "self" else set())
        for rule in rules.values():
            d = el.decide(rule, prof)
            dd = d.to_dict()
            if d.status == "needs_info":
                rel = set(rule.get("tags", [])) & ptags or "all" in rule.get("tags", []) \
                    or set(rule.get("life_events", [])) & events
                if not rel:
                    continue  # don't nag people about schemes that don't fit their life
                for f in d.missing_facts:
                    questions[(who, f)] += ranker.money_value(rule) + 1
            if d.status == "not_eligible":
                continue
            s, parts = ranker.score(rule, dd, ptags, events)
            matches.append({"scheme_id": rule["id"], "who": who, "who_name": who_name, "decision": dd,
                            "score": s, "score_parts": parts})
            if who == "self" or d.status == "eligible":
                decisions_all.append(d)
    matches.sort(key=lambda m: m["score"], reverse=True)

    # exams for everyone in the household
    exams = []
    for who, who_name, prof in people:
        for ex in el.load_exams():
            r = el.decide_exam(ex, prof)
            if r["status"] in ("eligible", "not_yet"):
                exams.append({**r, "who": who, "who_name": who_name, "forecast": forecaster.next_notice(ex)})

    haq = haq_meter(matches, rules, wapsi_found_inr, events)
    unlock = el.unlock_paths([d for d in decisions_all], rules)
    for plan in unlock:  # count mutually exclusive schemes once
        plan["value_inr"] = _value_with_exclusivity(plan["unlocks"], rules)
    unlock.sort(key=lambda p: (-p["value_inr"], len(p["documents"])))

    qs = []
    for (who, f), w in sorted(questions.items(), key=lambda kv: -kv[1])[:4]:
        if f in persona.QUESTIONS:
            qs.append({"field": f, "who": who, **persona.QUESTIONS[f], "weight": round(w)})

    checklists = [life_events()[e] for e in events if e in life_events()]
    return {"profile": head, "tags": sorted(tags), "matches": matches, "exams": exams, "haq_meter": haq,
            "unlock_paths": unlock[:2], "questions": qs, "life_events": checklists}


def _value_with_exclusivity(ids: list[str], rules: dict[str, dict]) -> int:
    total = 0
    for g in _exclusive_groups(list(dict.fromkeys(ids)), rules):
        total += max(el.scheme_value(rules[i]) for i in g)
    return total


def haq_meter(matches: list[dict], rules: dict[str, dict], wapsi_found_inr: int, events: set[str]) -> dict:
    eligible = [m for m in matches if m["decision"]["status"] == "eligible"]
    # per person, collapse mutually exclusive schemes to the best one
    yearly = one_time = cover = credit = 0
    counted, choose_one = [], []
    by_person: dict[str, list[str]] = defaultdict(list)
    for m in eligible:
        by_person[m["who"]].append(m["scheme_id"])
    for who, ids in by_person.items():
        for g in _exclusive_groups(ids, rules):
            best = max(g, key=lambda i: el.scheme_value(rules[i]))
            b = rules[best]["benefit"]
            yearly += int(b.get("annual_value") or 0)
            one_time += int(b.get("one_time_value") or 0)
            counted.append({"scheme_id": best, "who": who})
            if len(g) > 1:
                choose_one.append(sorted(g))
            for i in g:
                cover += int(rules[i]["benefit"].get("cover_value") or 0)
                credit = max(credit, int(rules[i]["benefit"].get("loan_value") or 0))
    possible_claims = sum(c.get("value", 0) for e in events for c in life_events().get(e, {}).get("claims", [])
                          if c.get("value"))
    return {"total_inr": yearly + one_time + wapsi_found_inr, "yearly_inr": yearly, "one_time_inr": one_time,
            "unclaimed_inr": wapsi_found_inr, "possible_claims_inr": possible_claims, "cover_inr": cover,
            "credit_inr": credit,
            "counted": counted, "choose_one": choose_one,
            "pending_documents": sorted({d for m in eligible for d in m["decision"].get("docs_missing", [])})}
