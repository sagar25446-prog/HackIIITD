"""Forecasts the next exam notification window from the history of past notice months.

Months are angles on a circle (December is next to January), so we use circular statistics:
the circular mean gives the expected month and the circular standard deviation gives the window.
We report the empirical hit-rate of that window on the history, not an invented confidence.
"""
from __future__ import annotations

import math
from datetime import date

MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"]


def _angle(m: int) -> float:
    return 2 * math.pi * (m - 1) / 12


def next_notice(exam: dict, today: date | None = None) -> dict | None:
    hist = exam.get("notice_history_months") or []
    if len(hist) < 3:
        return None
    today = today or date.today()
    months = [int(h.split("-")[1]) for h in hist]
    s = sum(math.sin(_angle(m)) for m in months)
    c = sum(math.cos(_angle(m)) for m in months)
    mean = math.atan2(s, c) % (2 * math.pi)
    r = math.hypot(s, c) / len(months)
    std_months = max(1.0, math.sqrt(-2 * math.log(max(r, 1e-9))) * 12 / (2 * math.pi))
    centre = round(mean * 12 / (2 * math.pi)) % 12 + 1
    half = min(5, round(std_months))

    # next occurrence strictly after the current cycle's notification
    last = exam.get("current_cycle", {}).get("notified")
    year = (int(last[:4]) if last else today.year) + 1
    lo_m, hi_m = centre - half, centre + half

    def fmt(m: int, y: int) -> str:
        y += (m - 1) // 12
        m = (m - 1) % 12 + 1
        return f"{MONTHS[m - 1]} {y}"

    def dist(a: int, b: int) -> int:
        d = abs(a - b) % 12
        return min(d, 12 - d)

    hits = sum(dist(m, centre) <= half for m in months)
    return {"expected": fmt(centre, year), "window": f"{fmt(lo_m, year)} – {fmt(hi_m, year)}",
            "history_hits": f"{hits} of {len(months)} past notices fell in this window",
            "method": f"circular mean ± 1σ of {len(months)} past notice months"}
