# FAQ — short, true answers about JAAGRUK

**How exactly do you use TinyFish?** Six APIs. Agent (run-sse, output_schema, India proxy) for unscripted portals and the official-checker second opinion; Browser (CDP) for fast playbooks and OTP/CAPTCHA assisted sessions; Fetch for notice boards and rule re-verification; Search for Scam Shield evidence and discovery; Monitor for always-on watching via webhook; Research for cited live answers. The Ops page lists every call with run IDs.

**Why not just use the agent everywhere?** We tested it. On a known form, a compiled playbook on a TinyFish Browser takes ~10 s and costs < ₹1; the agent is better on layouts we haven't scripted, and it's our self-heal when a playbook breaks. On IEPF an unbounded agent burned 83 steps on a login wall — so every agent now has hard time/step caps.

**"COMPLETED ≠ success" — what does your verifier catch?** Runs that end without data; required fields left empty; a CAPTCHA/OTP/login reported as "not found" (seen live on SBI Life); the agent echoing the searched name as the record holder; links to non-official domains. Each gets a verdict (verified / suspicious / blocked / failed) and a next step.

**Do you bypass CAPTCHAs or OTPs?** Never. Those portals open as an assisted session: a TinyFish remote browser the citizen drives; their OTP goes straight to the site and is never logged or sent to any AI. No OTP or password ever appears in an agent goal.

**How do you know the eligibility answer is right?** Rules come from official pages (each has a source URL and a verified date). Z3 proves eligible / not eligible / needs-info; for "not eligible" it gives the minimal failing clause (unsat core). "Re-check live" re-reads the official page with TinyFish Fetch and Z3 proves the rule is still equivalent — or shows a concrete counter-example (e.g. "income exactly ₹1,00,000 qualifies under the notice but not our rule").

**Isn't the Haq Meter inflated?** No. It counts only proven-eligible schemes, collapses mutually exclusive schemes (e.g. Delhi widow pension vs Delhi Lakshmi Yojana — confirmed on the DLY page) to the best one, and shows insurance cover and credit separately from cash.

**What ML is real here?** A Devanagari-aware name matcher (transliteration + an Indic phonetic key + fuzzy/initials features → logistic model; exact matching finds only ~14% of true name variants); a TF-IDF + logistic scam classifier with fraud-signal rules and look-alike domain detection (5-fold CV numbers on the Ops page); a change classifier for notices; circular statistics to forecast the next exam notification; Z3 for proofs and z3.Optimize for the unlock path. Claude (optional) writes cited answers and extracts rules with structured outputs; without a key everything falls back to deterministic code.

**Hallucination?** Answers may only use retrieved passages; every citation must point to a passage we retrieved, otherwise the answer is replaced by the source text itself. Research answers show which sources are official.

**What if the Wi-Fi dies?** Every successful live TinyFish call is recorded; `--replay` serves those real responses and the UI labels them "replay".

**Scale?** Rules are data (JSON) — adding a scheme is adding a rule with its source; Fetch re-verifies them on a schedule; Monitors push changes; playbooks are per-portal and the agent covers the long tail. SQLite → Postgres and in-process jobs → a queue are drop-in upgrades.

**Privacy?** No Aadhaar collected. The profile stays in the browser; the server stores only the TinyFish call log and notice snapshots. Every portal search needs explicit consent. Nothing is submitted on the citizen's behalf.

**Why would a citizen trust a WhatsApp-age app?** Every claim links to a .gov.in source; we never ask for money or OTPs, and we say so on every screen; Scam Shield cites PIB Fact Check.

**What didn't work?** IEPF moved behind the MCA login and SBI Life added a CAPTCHA — so they are assisted, not automated. We'd rather show that honestly than fake an automation.

**Cost per family?** One full Wapsi search ≈ $0.10 (one 5-step agent + a ~1-minute browser session). Search, Fetch and Research are free (Research is capped at 5 runs a day per account, so JAAGRUK reuses research per question). Monitors for 4 boards ≈ $0.07/day for *all* users.

**What's next?** More state schemes via the same pipeline; Bhashini voice; insurer playbooks for the IRDAI Bima Bharosa list; CSC-operator mode so one operator can serve a village.
