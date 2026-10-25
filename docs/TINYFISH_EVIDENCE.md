# TinyFish live validation log (19 Oct 2026)

Every portal JAAGRUK touches was tested against the real site with TinyFish. Tests used only
the fictional name **"Jaagrukdemo Testcase"** (DOB 12/03/1971) so no real person's records were searched.
Total spent on all live validation: **≈ $0.60** of the wallet (Search, Fetch and Research are free).

## What we learned — and how the product changed because of it

| Portal | TinyFish tool | Result | Decision in the product |
|---|---|---|---|
| **LIC — Unclaimed Policy Dues** (`merchant.licindia.in`) | Fetch | `proxy_error` from the default (US) network | Route through an **India exit IP** |
| LIC | **Browser** session, `country_code: IN` + Playwright | Form loads; needs any two of policy no. / name / DOB / PAN; no CAPTCHA; replies *"Records with respect to entered data not found !!!"* in ~10 s | **Playbook** (`playbooks.lic_unclaimed`), Agent as self-heal fallback |
| **Tata AIA — unclaimed funds** | Browser session (IN) | Name + DOB form; *"No unclaimed funds applicable for entered details"* | Playbook available as fallback |
| Tata AIA | **Agent** run `2854a552-6713-4ba3-a46c-f40508b71526`, proxy IN | COMPLETED in **5 steps / 50 s (≈ $0.08)**, correct structured result | **Agent is the primary engine** (live view + progress steps in the grid) |
| Tata AIA (through the app, REST `run-sse`) | Agent, proxy IN | 5 steps / 38 s; PROGRESS: "Input policy holder name → Input date of birth → Click Proceed → Report no unclaimed funds found" | Recorded for offline replay |
| **SBI Life — unclaimed amount disclosure** | Agent run `3abbd83d-10d8-409b-98f4-b548c6f8d343`, proxy IN | Status **COMPLETED** but the page had a **CAPTCHA**; the agent tried to get past it and reported `found:false` + echoed our name as `holder_name` | Verifier now flags "CAPTCHA + not found" as **blocked**, strips echoed names, and routes the portal to the **official site** (citizen completes the CAPTCHA there). JAAGRUK never solves CAPTCHAs |
| **IEPF / MCA search** | Fetch | Page HTML loads, but the search moved to `mca.gov.in` | — |
| IEPF / MCA | Agent run `c125a37e-d51a-49d2-a067-05960d2eaa88` | Hit the time limit after 83 steps; manual check showed the search **redirects to the MCA login** | Official-site route (citizen logs in). Agents now carry hard caps (`max_duration_seconds`, `max_steps` where enabled) |
| SSC, UPSC, NSP, Delhi Lakshmi Yojana | Fetch (4 URLs, one call, `ttl=0`) | Clean text; dated notices parsed (e.g. NSP: *CSSS renewal closes 31-10-2026*) | Change Radar baselines + live scans |
| Scheme source pages (UMANG, PIB, DFS, NSP PDFs) | Fetch | Rules re-verified; **Z3 proved** widow pension (6 fields), IGNWPS, Post-Matric SC, PMJJBY, CSSS identical to the live pages | "Re-check live" button; drift shows a concrete counter-example if a page changes |
| Post-Matric SC | Fetch | Our original source link pointed to the **Pre-Matric** page — caught on re-read | Fixed source + benefit (₹3,000/yr B.Sc. day-scholar allowance + fees) |
| Unclaimed-money totals | Search + Fetch (PIB, Dec 2025) | ₹78k cr bank deposits, ₹14k cr insurance, ₹9k cr dividends, ₹3k cr MFs | Cited in the app (≈ ₹1 lakh crore) |
| Ask: "Delhi widow pension amount & eligibility" | **Research** (free) | ~3.6 min, plans 5 sub-questions, reads UMANG/WCD/myScheme, cites ₹2,500/month | "Read official sites live" in Ask, streamed |
| **myScheme official checker** (`rules.myscheme.gov.in`) | Browser session (IN) + Playwright probe | 7 progressive Yes/No questions with polarity ("Does your income **exceed** ₹1,00,000?"); after the last answer the site itself showed *"We're Sorry! Something went wrong"* | Feature kept as **beta**; agent goal now reasons about polarity; verifier reports "official portal returned an error" instead of a verdict |
| Research quota | Research API | Returned **429 DAILY_LIMIT_EXCEEDED** after 5 runs ("limit 5/day, resets 07:00 UTC" = 12:30 IST). A browser EventSource reconnect loop had also re-triggered runs | Streams now always end and never auto-reconnect; one research at a time; the same question within 6 h reuses the stored real run; on the limit the app says so and shows the closest earlier research |
| Monitors | (schema validated against TinyFish's `create_monitor`) | Not created during development — they are standing, billed resources | Registered from the Alerts page when deployed (≈ $0.07/day) |

## Engine choice per Wapsi portal

| Portal | Engine | Why |
|---|---|---|
| LIC | Playbook on TinyFish Browser (IN), Agent fallback | Stable form, no CAPTCHA, fastest and cheapest |
| Tata AIA | TinyFish Agent (IN), playbook fallback | Shows the live agent view; 5 steps |
| SBI Life | Official site (citizen) | CAPTCHA |
| IEPF (MCA) | Official site (citizen) | MCA login |
| RBI UDGAM | Official site (citizen) | Citizen's mobile OTP |
| SEBI MITRA (MF Central) | Official site (citizen) | OTP login |
| EPFO | Official site (citizen) | UAN + OTP |
