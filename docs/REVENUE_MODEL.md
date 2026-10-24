# JAAGRUK — revenue model, pricing and market research

**Principle: citizens never pay.** JAAGRUK tells people that genuine government schemes never charge a fee — so the
citizen app must be free forever. Money comes from the institutions that already pay to reach these citizens or that
earn when a citizen is reunited with their money.

## 1. Market facts we price against (all official sources)

| Fact | Number | Source |
|---|---|---|
| Unclaimed financial assets in India | ≈ ₹1.04 lakh crore (bank deposits ₹78k cr, insurance ₹14k cr, dividends ₹9k cr, mutual funds ₹3k cr) | PIB backgrounder "Your Money, Your Right", 26 Dec 2025 |
| Returned when people were *helped* to claim | ₹5,777 crore across **22.95 lakh claims** in a 3-month campaign (≈ ₹25,000 per claim) | PIB, Ministry of Finance, 24 Mar 2026 (Rajya Sabha reply) |
| What banks earn for settling an unclaimed deposit | RBI incentive of **5 % – 7.5 % of the amount** (subject to a cap), effective 1 Oct 2025 | same PIB release, 24 Mar 2026 |
| Demand for self-service search | 18.86 lakh registered users on RBI's UDGAM portal (1 Mar 2026) | same PIB release |
| Assisted-service channel | 5.16 lakh functional Common Service Centres (June 2026) | PIB, Ministry of I&B, 2026 |
| What citizens already pay an assisted centre | **₹30** fixed charge for a full scholarship application at a CSC (NSP OTR + application) | National Scholarship Portal home page (read with TinyFish Fetch, 19 Oct 2026) |
| Scale of the scam problem | ₹3,216 crore lost to job & investment scams in 11 months (1 lakh+ cases) | Government data Jan–Nov 2024 (as cited in our deck) |

## 2. Our costs (measured, not guessed)

Measured on live portals on 19 Oct 2026 (see [TINYFISH_EVIDENCE.md](TINYFISH_EVIDENCE.md)):

| Action | TinyFish cost | In ₹ (at ₹85/$, assumption) |
|---|---|---|
| Eligibility proof, Haq Meter, Scam Shield model, name matching | ₹0 (runs on our server) | ₹0 |
| Reading official pages (Search, Fetch, Research) | $0 (free tiers) | ₹0 |
| One full Wapsi search (one 5-step agent + ~1 browser-minute) | ≈ $0.10 | ≈ ₹8.5 |
| Always-on Change Radar (13 monitor checks/day, shared by *all* users) | ≈ $0.07/day | ≈ ₹180/month total |
| Hosting (1 small VM + SQLite → Postgres later) | — | ≈ ₹2,000–4,000/month (assumption) |

So the marginal cost of serving a family is **≈ ₹10 per Wapsi search** and close to zero for everything else.

## 3. Revenue streams and prices

### A. Citizens — free
The full app (profile, Haq Meter, proofs, Life-event mode, Scam Shield, alerts, Wapsi search) is free. This is what
drives adoption and trust.

### B. CSC / NGO operator console — ₹199 per centre per month
*Who pays:* Common Service Centre operators (VLEs), NGOs, ASHA/self-help-group networks, college scholarship cells.
*What they get:* multi-family dashboard, the Haq Meter for every walk-in, pre-filled application packs, deadline alerts
for all their families, Wapsi runs included (fair-use 100/month).
*Why ₹199 is justified:* a CSC already earns ₹30 per scholarship application (NSP). JAAGRUK finds *which* schemes
each walk-in qualifies for and pre-fills them, so **7 extra applications a month pays for the subscription**; the
operator's time saved on manual eligibility checks is extra margin. Our cost for 100 Wapsi runs is ≈ ₹850 worst case,
but typical use is far lower and Search/Fetch reads are free — fair-use limits keep the plan profitable.
*Market:* 5.16 lakh CSCs. **1 % adoption = 5,160 centres × ₹199 × 12 ≈ ₹1.23 crore a year.**

### C. Banks, insurers and AMCs — success fee for reunited money
*Who pays:* banks (UDGAM / DEA Fund), life insurers (unclaimed policy dues), mutual fund AMCs/RTAs.
*What they get:* consented, name-matched, document-ready claimants for *their* unclaimed accounts (JAAGRUK's Wapsi +
claim kit), arriving at the branch with the right forms — fewer failed claims and walk-ins.
*Price:* **1 % of the settled amount, capped at ₹500 per claim.**
*Why it's justified:* RBI pays the bank **5–7.5 %** of every unclaimed deposit it settles. Our fee is a fraction of
that incentive, charged only on success. At the campaign's average claim of ≈ ₹25,000, the fee is ≈ ₹250 per claim
and the bank still keeps 4–6.5 %.
*Market:* the government settled 22.95 lakh claims in one 3-month campaign. **Facilitating 50,000 claims a year
(≈ 2 % of one campaign's volume) ≈ ₹1.25 crore a year.**

### D. Government (B2G) — district entitlement-gap dashboard (pilot, then licence)
*Who pays:* district administrations / state social-welfare departments.
*What they get:* privacy-preserving, aggregated "who is eligible but not enrolled" maps per scheme, scam-message
trends, notice-change alerts.
*Price:* free 3-month pilot, then **₹2 lakh per district per year** (to be validated in pilots — we have no signed
customer yet). Funded from IEC/awareness budgets that schemes already carry.

### E. Open data, never sold: the machine-readable scheme-rules dataset stays free for researchers and civic apps.

## 4. Projection (conservative, year 2)

| Stream | Assumption | Annual revenue |
|---|---|---|
| CSC/NGO console | 1 % of CSCs (5,160) at ₹199/month | ≈ ₹1.23 cr |
| Bank/insurer success fee | 50,000 settled claims × ≈ ₹250 | ≈ ₹1.25 cr |
| B2G dashboards | 20 districts × ₹2 lakh | ≈ ₹0.40 cr |
| **Total** | | **≈ ₹2.9 crore** |

Costs at that scale: TinyFish for ≈ 5 lakh Wapsi runs/year ≈ ₹42 lakh (at today's measured ≈ ₹8.5/run), hosting and a
small team — the model is profitable without charging a single citizen.

## 5. Competition and why we still win

| Alternative | Gap JAAGRUK fills |
|---|---|
| myScheme (government scheme finder) | Lists schemes; does not prove eligibility per family, watch notice boards, check scams or search unclaimed money |
| UDGAM / Bima Bharosa / MITRA / IEPF | One asset type each, separate logins; JAAGRUK searches across them and hands OTP/CAPTCHA steps to the citizen |
| RBI's planned single unclaimed-assets portal | Complements us: JAAGRUK becomes the assisted, multilingual front door (CSC console) and covers schemes + exams too |
| Paid "claim agents" | Charge citizens and are a fraud risk; JAAGRUK is free to citizens and tells them never to pay an agent |

## 6. Risks to the model
* Government portals change → playbooks + agent self-heal + live re-verification (see README).
* Bank partnerships take time → start with CSC/NGO console (self-serve), add success fees after pilots.
* Pricing for B2G is a hypothesis → validated through free pilots before charging.
