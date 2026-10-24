# Engineering notes — what live testing taught us (19 Oct 2026)

Everything below was found by running JAAGRUK against the real portals with TinyFish and fixing what broke.


## Problems found by testing — and fixed

1. Indian portals blocked TinyFish's default network → India exit IP for browsers and agents.
2. An agent reported "COMPLETED, not found" after hitting a CAPTCHA (SBI Life) → verifier flags it; portal moved to assisted session.
3. IEPF moved behind the MCA login; an uncapped agent ran 83 steps → time caps (step caps where the account allows) + assisted session.
4. Account rejected `max_steps` (beta) → client degrades to the time cap automatically.
5. The myScheme checker errors after its last question → verifier reports "portal error", feature marked beta.
6. Extractor read "less than ₹1,00,000" as "≤" and a document note as an SC/ST rule → fixed; Z3 now proves 6 fields match the live page.
7. Our Post-Matric SC source link pointed to the Pre-Matric page → fixed with the official UMANG page and the real allowance.
8. Unclaimed-money total was wrong in our copy → corrected to PIB (Dec 2025).
9. **Z3 is not thread-safe** — two simultaneous home-screen requests crashed it → global solver lock + per-profile cache + regression test (72 parallel requests pass).
10. Name matcher scored "R. K. Sarma" at 12% → Indic phonetic key; now 99%, while "Suresh Kumar Sharma" stays at 4%.
11. Scam Shield cited irrelevant PIB pages and missed that the scheme was real → relevance filter + "real scheme, fake website" verdict.
12. Discover returned generic PIB news → relevance filtering; "For you" highlights limited to actionable notices.
13. The browser's EventSource silently **reconnected after a Research stream ended, re-running research every ~4 s** → explicit `end` event, no auto-reconnect anywhere, regression test.
14. TinyFish Research allows **5 runs per day** per account → per-question reuse for 6 h, one run at a time, clear "daily limit, resets 12:30 IST" message with the closest earlier research as fallback.

## Honest gaps (say them before a judge finds them)

* Only LIC and Tata AIA are automated end to end; five portals need the citizen (CAPTCHA/OTP/login) — by design, not a bug.
* No real "money found" demo: we only searched a fictional name. Use a consenting team member's late relative if you want a live hit.
* Without an `ANTHROPIC_API_KEY`, Ask answers are retrieved passages rather than written prose (the Claude path is implemented and request-shape tested).
* Hindi covers the main flows; some secondary screens (Ops, parts of Alerts/Scam details) remain English.
* Voice uses the browser's Web Speech API (Chrome/Edge, online) — Bhashini is future work.
* Monitors are code-complete but not registered by default (they bill per check); the webhook needs a public URL (e.g. a tunnel).
* Coverage: Central + Delhi schemes, 3 exams (UPSC CSE, SSC CGL, SSC CHSL).
