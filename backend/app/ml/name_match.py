"""Wapsi name matcher.

Unclaimed-money records list names as 'R K Sharma', 'Ramesh Kr. Sarma' or 'रमेश कुमार शर्मा'.
Pipeline: Devanagari→Latin transliteration (with schwa deletion) → normalisation (honorifics,
abbreviations) → pair features (fuzzy, phonetic, initials-aware) → a logistic-regression pair
classifier trained on generated variants of common Indian names. Outputs a calibrated probability.
"""
from __future__ import annotations

import json
import random
import re
from functools import lru_cache

import jellyfish
import numpy as np
from indic_transliteration import sanscript
from rapidfuzz import fuzz
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import precision_recall_fscore_support, roc_auc_score
from sklearn.model_selection import train_test_split

from ..config import VAR_DIR

DEVANAGARI = re.compile(r"[ऀ-ॿ]")
HONORIFICS = {"shri", "sri", "shree", "smt", "shrimati", "mr", "mrs", "ms", "miss", "late", "lt", "dr", "km",
              "kumari", "sh", "mohtarma", "janab", "swargiya", "sw", "स्व", "श्री", "श्रीमती"}
ABBREV = {"kr": "kumar", "kmr": "kumar", "md": "mohammad", "mohd": "mohammad", "mohammed": "mohammad",
          "muhammad": "mohammad", "mohamed": "mohammad", "pd": "prasad", "prakesh": "prakash",
          "ch": "chand", "chd": "chand", "nr": "narayan", "lal": "lal", "bhai": "bhai", "ben": "ben"}


def translit(text: str) -> str:
    """Devanagari → simple Latin with schwa deletion: रमेश कुमार शर्मा → ramesh kumar sharma."""
    if not DEVANAGARI.search(text):
        return text
    out = []
    for word in text.split():
        if not DEVANAGARI.search(word):
            out.append(word)
            continue
        w = sanscript.transliterate(word, sanscript.DEVANAGARI, sanscript.ITRANS)
        if len(w) > 3 and w.endswith("a") and not w.endswith("aa"):
            w = w[:-1]  # inherent final schwa is not pronounced in Hindi
        w = (w.replace("A", "a").replace("I", "i").replace("U", "u").replace("RRi", "ri").replace("~N", "n")
             .replace(".n", "n").replace("M", "n").replace(".h", "").replace("Sh", "sh").replace("~n", "n")
             .replace("chh", "chh").replace("Ch", "chh").replace("aa", "a").replace("ii", "i").replace("uu", "u")
             .replace(".", ""))
        out.append(w.lower())
    return " ".join(out)


def normalize(name: str) -> str:
    s = translit(name or "").lower()
    s = re.sub(r"[^a-z\s]", " ", s.replace(".", ". "))
    toks = [ABBREV.get(t, t) for t in s.split() if t not in HONORIFICS]
    return " ".join(toks)


# Indian-name phonetic key: Sharma/Sarma, Mohammad/Muhammed, Vijay/Wijay map to one key (metaphone does not)
PHON = [("ksh", "x"), ("chh", "c"), ("sh", "s"), ("ph", "f"), ("kh", "k"), ("gh", "g"), ("bh", "b"), ("dh", "d"),
        ("th", "t"), ("ch", "c"), ("w", "v"), ("z", "j"), ("q", "k"), ("ee", "i"), ("oo", "u"), ("ou", "u")]


def phonetic_key(token: str) -> str:
    t = token.lower()
    for a, b in PHON:
        t = t.replace(a, b)
    t = re.sub(r"(.)\1+", r"\1", t)  # collapse doubled letters (aa→a, mm→m)
    t = re.sub(r"(?<=[^aeiou])[aeiou](?=[^aeiou]$)", "", t) if len(t) > 5 else t  # short final-syllable vowel
    return t[:-1] if len(t) > 3 and t[-1] in "ah" else t


def _initials_score(a: list[str], b: list[str]) -> float:
    """Fraction of tokens in the shorter name explained by the longer one (full, fuzzy or initial)."""
    short, long_ = (a, b) if len(a) <= len(b) else (b, a)
    if not short:
        return 0.0
    used, hits = set(), 0
    for t in short:
        best = None
        for j, u in enumerate(long_):
            if j in used:
                continue
            if t == u or fuzz.ratio(t, u) >= 85 or (len(t) == 1 and u.startswith(t)) or (len(u) == 1 and t.startswith(u)):
                best = j
                break
        if best is not None:
            used.add(best)
            hits += 1
    return hits / len(short)


def features(a: str, b: str) -> list[float]:
    na, nb = normalize(a), normalize(b)
    ta, tb = na.split(), nb.split()
    if not ta or not tb:
        return [0.0] * 10
    sur = fuzz.ratio(ta[-1], tb[-1]) / 100
    first = fuzz.ratio(ta[0], tb[0]) / 100 if len(ta[0]) > 1 and len(tb[0]) > 1 else float(ta[0][0] == tb[0][0])
    meta_a = {phonetic_key(t) for t in ta if len(t) > 1}
    meta_b = {phonetic_key(t) for t in tb if len(t) > 1}
    phon = len(meta_a & meta_b) / max(1, min(len(meta_a), len(meta_b)))
    return [
        fuzz.token_set_ratio(na, nb) / 100,
        fuzz.token_sort_ratio(na, nb) / 100,
        fuzz.partial_ratio(na, nb) / 100,
        jellyfish.jaro_winkler_similarity(na, nb),
        _initials_score(ta, tb),
        sur,
        first,
        phon,
        float(jellyfish.soundex(ta[-1]) == jellyfish.soundex(tb[-1])),
        abs(len(ta) - len(tb)) / 3,
    ]


# ---------------------------------------------------------------------------- training data
FIRST = ["ramesh", "suresh", "mahesh", "rajesh", "dinesh", "mukesh", "rakesh", "naresh", "sunita", "anita", "kavita",
         "savita", "geeta", "seema", "rekha", "pooja", "priya", "neha", "amit", "sumit", "rohit", "mohit", "vijay",
         "ajay", "sanjay", "manoj", "anil", "sunil", "ravi", "deepak", "arun", "varun", "kiran", "meena", "lakshmi",
         "mohammad", "abdul", "imran", "salim", "farhan", "harpreet", "gurpreet", "manpreet", "jaswinder", "ankit",
         "nitin", "sachin", "rahul", "vikas", "pankaj", "shalini", "radha", "usha", "asha", "nisha", "ritu"]
MIDDLE = ["kumar", "prasad", "chand", "lal", "singh", "devi", "kumari", "nath", "narayan", "", "", ""]
LAST = ["sharma", "verma", "gupta", "singh", "yadav", "kumar", "khan", "ansari", "patel", "shah", "mehta", "jain",
        "agarwal", "mishra", "pandey", "tiwari", "dubey", "chauhan", "rawat", "negi", "bisht", "das", "ghosh",
        "reddy", "naidu", "nair", "pillai", "iyer", "kaur", "gill", "sandhu", "chaudhary", "meena", "joshi"]
SPELL = [("sh", "s"), ("ee", "i"), ("oo", "u"), ("v", "w"), ("a", "aa"), ("ph", "f"), ("ksh", "x"), ("i", "ee")]


def _variant(rng: random.Random, f: str, m: str, l: str) -> str:
    toks = [f, m, l] if m else [f, l]
    ops = rng.sample(["initial_first", "initial_middle", "drop_middle", "abbrev", "spell", "swap", "honorific",
                      "typo", "devanagari", "dots"], k=rng.randint(1, 3))
    if "initial_first" in ops:
        toks[0] = toks[0][0]
    if "initial_middle" in ops and len(toks) == 3:
        toks[1] = toks[1][0]
    if "drop_middle" in ops and len(toks) == 3:
        toks.pop(1)
    if "abbrev" in ops:
        toks = ["kr" if t == "kumar" else "md" if t == "mohammad" else "pd" if t == "prasad" else t for t in toks]
    if "spell" in ops:
        i = rng.randrange(len(toks))
        a, b = rng.choice(SPELL)
        if a in toks[i] and len(toks[i]) > 2:
            toks[i] = toks[i].replace(a, b, 1)
    if "typo" in ops:
        i = rng.randrange(len(toks))
        t = toks[i]
        if len(t) > 4:
            j = rng.randrange(1, len(t) - 1)
            toks[i] = t[:j] + t[j + 1:]
    if "swap" in ops and len(toks) >= 2:
        toks = [toks[-1]] + toks[:-1]
    s = " ".join(toks)
    if "dots" in ops:
        s = " ".join(t + "." if len(t) == 1 else t for t in s.split())
    if "honorific" in ops:
        s = rng.choice(["Shri ", "Smt ", "Late ", "Mr "]) + s
    if "devanagari" in ops and not any(len(t) == 1 for t in s.split()):
        s = sanscript.transliterate(s, sanscript.ITRANS, sanscript.DEVANAGARI)
    return s


def make_pairs(n: int = 6000, seed: int = 7) -> tuple[list[tuple[str, str]], list[int]]:
    rng = random.Random(seed)
    pairs, y = [], []
    for _ in range(n // 2):
        f, m, l = rng.choice(FIRST), rng.choice(MIDDLE), rng.choice(LAST)
        full = " ".join(x for x in (f, m, l) if x)
        pairs.append((full, _variant(rng, f, m, l)))
        y.append(1)
        kind = rng.random()
        if kind < 0.4:      # same surname, different first name — the hard negative
            f2 = rng.choice([x for x in FIRST if x != f])
            other = " ".join(x for x in (f2, m, l) if x)
        elif kind < 0.7:    # same first name, different surname
            l2 = rng.choice([x for x in LAST if x != l])
            other = " ".join(x for x in (f, m, l2) if x)
        else:               # unrelated person
            other = " ".join(x for x in (rng.choice(FIRST), rng.choice(MIDDLE), rng.choice(LAST)) if x)
        if other == full:
            continue
        pairs.append((full, _variant(rng, *other.split()) if len(other.split()) == 3 and rng.random() < 0.5 else other))
        y.append(0)
    return pairs, y


@lru_cache(maxsize=1)
def model() -> tuple[LogisticRegression, dict]:
    pairs, y = make_pairs()
    X = np.array([features(a, b) for a, b in pairs])
    Xtr, Xte, ytr, yte = train_test_split(X, np.array(y), test_size=0.25, random_state=1, stratify=y)
    clf = LogisticRegression(max_iter=1000, C=3.0).fit(Xtr, ytr)
    prob = clf.predict_proba(Xte)[:, 1]
    p, r, f, _ = precision_recall_fscore_support(yte, prob >= 0.5, average="binary")
    metrics = {"model": "logistic regression on 10 fuzzy/phonetic/initials features",
               "train_pairs": int(len(ytr)), "test_pairs": int(len(yte)),
               "precision": round(float(p), 3), "recall": round(float(r), 3), "f1": round(float(f), 3),
               "auc": round(float(roc_auc_score(yte, prob)), 3)}
    try:
        (VAR_DIR / "name_match_metrics.json").write_text(json.dumps(metrics, indent=1))
    except OSError:
        pass
    return clf, metrics


def match_probability(a: str, b: str, *, dob_a: str | None = None, dob_b: str | None = None) -> dict:
    clf, _ = model()
    p = float(clf.predict_proba(np.array([features(a, b)]))[0, 1])
    evidence = []
    if dob_a and dob_b:
        if re.sub(r"\D", "", dob_a) == re.sub(r"\D", "", dob_b):
            p = 1 - (1 - p) * 0.25
            evidence.append("date of birth matches")
        else:
            p *= 0.2
            evidence.append("date of birth differs")
    return {"probability": round(p, 3), "normalized": [normalize(a), normalize(b)], "evidence": evidence,
            "band": "likely the same person" if p >= 0.85 else "possible match — verify" if p >= 0.5 else "unlikely"}


def baseline_exact_recall() -> float:
    """How many true variant pairs a naive exact-match search would find (for the pitch: why ML)."""
    pairs, y = make_pairs(2000, seed=11)
    pos = [(a, b) for (a, b), t in zip(pairs, y) if t == 1]
    return round(sum(a.lower().strip() == b.lower().strip() for a, b in pos) / len(pos), 3)


def pairwise_examples() -> list[dict]:
    ex = [("Ramesh Kumar Sharma", "R K Sharma"), ("Ramesh Kumar Sharma", "Ramesh Kr. Sarma"),
          ("Ramesh Kumar Sharma", "रमेश कुमार शर्मा"), ("Ramesh Kumar Sharma", "Suresh Kumar Sharma"),
          ("Mohammad Imran Khan", "Md. Imran Khan"), ("Sunita Devi", "Smt Sunita")]
    return [{"a": a, "b": b, **match_probability(a, b)} for a, b in ex]

