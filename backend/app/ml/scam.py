"""Scam Shield model: text classifier + URL/domain analysis + fraud-signal rules → risk with reasons."""
from __future__ import annotations

import json
import re
from functools import lru_cache
from urllib.parse import urlparse

import jellyfish
import numpy as np
from sklearn.linear_model import LogisticRegression
from sklearn.model_selection import StratifiedKFold, cross_val_predict
from sklearn.metrics import f1_score, precision_score, recall_score
from sklearn.pipeline import FeatureUnion, Pipeline
from sklearn.feature_extraction.text import TfidfVectorizer

from ..config import DATA_DIR, VAR_DIR

DOMAIN_RE = re.compile(r"\b((?:https?://)?(?:[a-z0-9-]+\.)+[a-z]{2,}(?:/[^\s]*)?)", re.I)
SUSPICIOUS_TLDS = (".xyz", ".top", ".online", ".site", ".click", ".info", ".shop", ".live", ".buzz", ".icu", ".org",
                   ".com", ".co", ".in")
SHORTENERS = ("bit.ly", "tinyurl.com", "t.co", "cutt.ly", "rb.gy", "is.gd", "shorturl.at", "goo.gl")
GOV_WORDS = ("gov", "yojana", "yojna", "sarkari", "pm", "pradhan", "kisan", "ujjwala", "scholarship", "rozgar",
             "bharat", "aadhaar", "ayushman", "lakshmi", "ladli", "berojgari", "awas", "nsp", "kyc", "refund", "itr")

SIGNALS: list[tuple[str, str, float, str]] = [
    ("fee", r"(fee|fees|charge|charges|deposit|pay|bhejo|send ₹|शुल्क|फीस|जमा कर|चार्ज)\b.{0,40}(₹|rs\.?|inr|\d{2,})|(₹|rs\.?)\s?\d+.{0,30}(fee|charge|deposit|शुल्क|फीस)", 0.45,
     "Asks you to pay a fee — genuine government schemes do not charge to apply"),
    ("otp", r"\b(otp|pin|cvv|upi pin|6 digit code|ओटीपी|पिन)\b.{0,40}(share|send|enter|bhejo|batao|साझा|भेजें|दर्ज)|(share|send|enter).{0,30}\b(otp|pin|cvv)\b", 0.55,
     "Asks for an OTP / PIN — never share these"),
    ("apk", r"\.apk\b|download (this|the) app|ऐप डाउनलोड", 0.45, "Asks you to install an app outside the official store"),
    ("urgency", r"\b(today|immediately|turant|abhi|within \d+ hours?|last date today|tonight|seats fill|limited offer)\b|आज अंतिम|तुरंत|आज ही", 0.2,
     "Creates urgency to stop you from checking"),
    ("lottery", r"\b(lottery|won|winner|kbc|jackpot|prize)\b|लॉटरी|जीते", 0.45, "Promises a lottery or prize you never entered"),
    ("guarantee", r"\b(guaranteed|100% (result|placement|approval)|without exam|bina exam|no interview|minister quota|paper leak)\b|बिना परीक्षा", 0.45,
     "Promises guaranteed selection or returns"),
    ("easy_money", r"(earn|kamao|kamaye|कमाएं).{0,25}(₹|rs\.?)\s?[\d,]+.{0,20}(daily|per day|roz|रोज़|month)|like (youtube )?videos|rating hotels|prepaid task|vip level", 0.4,
     "Easy-money task scheme"),
    ("chat_channel", r"\b(telegram|whatsapp)\b.{0,30}(join|contact|group|bhejo|share)|(join|contact).{0,20}\b(telegram|whatsapp)\b", 0.2,
     "Moves the conversation to WhatsApp/Telegram instead of an official portal"),
    ("agent", r"\b(agent|representative|officer|dalal)\b.{0,30}(pay|fee|advance|upi|bhejo|bhejiye|de do|dena)|through our agent|एजेंट", 0.35,
     "Routes money through an 'agent' — official claims are free and paid only by the bank/insurer"),
    ("pay_first", r"(₹|rs\.?)?\s?\d{3,}[\d,]*\s?(rupaye|rupees|rs)?\s?(bhejo|bhejiye|bhej do|send karo|pay karo|jama karo)|pay.{0,25}(offer letter|id card|training kit|certificate|joining letter)", 0.45,
     "Wants money up front before you receive anything"),
    ("digital_arrest", r"digital arrest|money laundering case|cbi officer|police case.{0,20}video call", 0.6,
     "'Digital arrest' threat — a known fraud pattern"),
    ("block_threat", r"(account|sim|whatsapp).{0,30}(blocked|deactivated|banned|band)|disconnected tonight|बंद होने", 0.3,
     "Threatens to block your account/SIM"),
]


@lru_cache(maxsize=1)
def dataset() -> dict:
    return json.loads((DATA_DIR / "scam_dataset.json").read_text(encoding="utf-8"))


def _pipeline() -> Pipeline:
    return Pipeline([
        ("feats", FeatureUnion([
            ("char", TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 5), sublinear_tf=True, min_df=1)),
            ("word", TfidfVectorizer(analyzer="word", ngram_range=(1, 2), sublinear_tf=True, token_pattern=r"(?u)\b\w+\b")),
        ])),
        ("clf", LogisticRegression(max_iter=2000, C=4.0, class_weight="balanced")),
    ])


@lru_cache(maxsize=1)
def model() -> tuple[Pipeline, dict]:
    ex = dataset()["examples"]
    X = [e["text"] for e in ex]
    y = np.array([e["label"] for e in ex])
    cv = StratifiedKFold(n_splits=5, shuffle=True, random_state=3)
    pred = cross_val_predict(_pipeline(), X, y, cv=cv)
    metrics = {"model": "TF-IDF (char 2-5 + word 1-2) + logistic regression", "examples": len(ex),
               "cv": "5-fold stratified", "precision": round(float(precision_score(y, pred)), 3),
               "recall": round(float(recall_score(y, pred)), 3), "f1": round(float(f1_score(y, pred)), 3)}
    try:
        (VAR_DIR / "scam_metrics.json").write_text(json.dumps(metrics, indent=1))
    except OSError:
        pass
    return _pipeline().fit(X, y), metrics


def _domain(token: str) -> str:
    t = token if "://" in token else "http://" + token
    return (urlparse(t).hostname or "").lower().removeprefix("www.")


def analyze_domains(text: str) -> list[dict]:
    data = dataset()
    official = set(data["official_domains"])
    fakes = {d["domain"]: d["source"] for d in data["known_fake_domains"]}
    out = []
    for m in DOMAIN_RE.finditer(text):
        host = _domain(m.group(1))
        if not host or "." not in host or host.replace(".", "").isdigit() or len(host) < 5:
            continue
        info = {"domain": host, "status": "unknown", "reason": ""}
        if host in fakes:
            info.update(status="known_fake", reason="Flagged as fake by the Government of India", source=fakes[host])
        elif host.endswith((".gov.in", ".nic.in")) or host in official or any(host.endswith("." + o) for o in official):
            info.update(status="official", reason="Official government domain")
        elif host in SHORTENERS:
            info.update(status="shortener", reason="Shortened link hides the real destination")
        else:
            near = min(official, key=lambda o: jellyfish.levenshtein_distance(host, o))
            dist = jellyfish.levenshtein_distance(host, near)
            if dist <= 4:
                info.update(status="lookalike", reason=f"Looks like the official {near} but is a different site")
            elif any(w in host for w in GOV_WORDS):
                info.update(status="impersonation", reason="Uses government-scheme words but is not a .gov.in/.nic.in site")
            elif host.endswith(SUSPICIOUS_TLDS):
                info.update(status="unofficial", reason="Not an official government website")
        out.append(info)
    # dedupe
    seen, uniq = set(), []
    for d in out:
        if d["domain"] not in seen:
            seen.add(d["domain"])
            uniq.append(d)
    return uniq


DOMAIN_WEIGHT = {"known_fake": 0.9, "lookalike": 0.7, "impersonation": 0.6, "shortener": 0.4, "unofficial": 0.2}


def score(text: str) -> dict:
    clf, metrics = model()
    p_text = float(clf.predict_proba([text])[0, 1])
    low = text.lower()
    hits = [(name, w, why) for name, pat, w, why in SIGNALS if re.search(pat, low, re.I)]
    domains = analyze_domains(text)
    rule_keep = 1.0
    for _, w, _ in hits:
        rule_keep *= (1 - w)
    for d in domains:
        rule_keep *= (1 - DOMAIN_WEIGHT.get(d["status"], 0))
    rule_risk = 1 - rule_keep
    risk = 1 - (1 - 0.55 * p_text) * (1 - rule_risk)
    if any(d["status"] == "official" for d in domains) and not any(h[0] in ("fee", "otp", "apk") for h in hits) \
            and not any(d["status"] in DOMAIN_WEIGHT for d in domains):
        risk *= 0.5  # points only to official sites and asks for nothing sensitive
    risk = round(min(0.99, risk) * 100)
    verdict = "likely_fake" if risk >= 70 else "suspicious" if risk >= 40 else "looks_genuine"
    reasons = [why for _, _, why in hits] + [f"{d['domain']}: {d['reason']}" for d in domains if d["status"] != "unknown"]
    return {"risk": risk, "verdict": verdict, "text_model_probability": round(p_text, 3), "signals": [h[0] for h in hits],
            "domains": domains, "reasons": reasons, "model_metrics": metrics}
