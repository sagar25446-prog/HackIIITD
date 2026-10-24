"""Ranks matches for the 'For You' feed.

A transparent weighted utility (certainty, ₹ value, relevance to the persona, effort to apply).
Every score is explainable to the citizen; a learned ranker (LambdaMART on click data) replaces the
weights once there is usage data — see ROADMAP.
"""
from __future__ import annotations

import math

from .eligibility import load_documents

CERTAINTY = {"eligible": 1.0, "needs_info": 0.45, "not_eligible": 0.0}
WEIGHTS = {"certainty": 0.35, "value": 0.30, "relevance": 0.20, "effort": 0.15}


def money_value(rule: dict) -> float:
    b = rule.get("benefit", {})
    return (b.get("annual_value") or 0) + (b.get("one_time_value") or 0) + (b.get("cover_value") or 0) / 10 \
        + (b.get("loan_value") or 0) / 100


def score(rule: dict, decision: dict, persona_tags: set[str], life_events: set[str]) -> tuple[float, dict]:
    docs = load_documents()
    certainty = CERTAINTY.get(decision["status"], 0) * (0.85 if decision.get("docs_missing") else 1.0)
    value = min(1.0, math.log1p(money_value(rule)) / math.log1p(500_000))
    rule_tags = set(rule.get("tags", []))
    relevance = 0.4 if "all" in rule_tags else 0.0
    if rule_tags & persona_tags:
        relevance = 0.8
    if set(rule.get("life_events", [])) & life_events:
        relevance = 1.0
    days = sum(docs.get(d, {}).get("days", 14) for d in decision.get("docs_missing", []))
    effort = 1.0 - min(1.0, days / 60)
    parts = {"certainty": certainty, "value": value, "relevance": relevance, "effort": effort}
    return round(sum(WEIGHTS[k] * v for k, v in parts.items()), 4), {k: round(v, 2) for k, v in parts.items()}
