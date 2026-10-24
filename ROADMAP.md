# JAAGRUK — status and roadmap

## Built and working today (MVP)

| Feature | Status | Where |
|---|---|---|
| 10-question voice profile (Hindi/English), multi-label persona | ✅ | `frontend/src/pages/Onboarding.tsx`, `backend/app/services/persona.py` |
| Haq Meter — proven-eligible ₹ for the whole family, exclusive schemes counted once | ✅ | `services/entitlements.py` |
| Z3 eligibility proofs (eligible / not eligible / needs one answer + failing clause) | ✅ | `ml/eligibility.py` |
| Unlock path ("this one document makes ₹X claimable") via z3.Optimize | ✅ | `ml/eligibility.py::unlock_paths` |
| Live rule re-check: TinyFish Fetch → extractor → Z3 equivalence proof / counter-example | ✅ | `services/discover.py`, `ml/extract.py` |
| Life-event mode (death, birth, Class 12, job loss, turning 60, business) | ✅ | `data/life_events.json`, Life page |
| Wapsi — 7 unclaimed-money portals in parallel (playbook / agent / assisted) | ✅ | `services/wapsi.py`, `tinyfish/harness.py`, `tinyfish/playbooks.py` |
| Assisted session — TinyFish Browser over CDP, citizen types OTP/CAPTCHA | ✅ | `services/assisted.py` |
| Scam Shield — ML + rules + look-alike domains + live PIB Fact Check evidence | ✅ | `ml/scam.py`, `services/scam_shield.py` |
| Change Radar — notice boards via Fetch, personalised alerts, Monitor + webhook | ✅ (monitors opt-in) | `services/change_radar.py` |
| Ask JAAGRUK — cited answers + TinyFish Research | ✅ | `ml/assistant.py` |
| Application packs and CPGRAMS grievance drafts (citizen approves, never auto-submitted) | ✅ | `services/claims.py` |
| "Under the hood" — every TinyFish call, model metrics | ✅ | Ops page |
| Record/replay of real TinyFish runs for offline evaluation | ✅ | `tinyfish/recorder.py`, `data/captures/` |

Coverage today: Central + Delhi — 29 schemes, 3 exams (UPSC CSE, SSC CGL, SSC CHSL), 7 unclaimed-money portals,
4 watched notice boards, 3 demo families.

## Next

| Phase | Scope |
|---|---|
| Pilot (3 months) | 100 portals · 2 states · WhatsApp bot · CSC/NGO console with 50 centres |
| Growth (9 months) | 300 portals · 10 states · insurer playbooks from IRDAI's Bima Bharosa list · bank success-fee pilots |
| Scale (18 months) | All 36 States/UTs · B2G district entitlement-gap dashboards · open scheme-rules dataset |

Also planned: DigiLocker consent-based auto-fill, IVR / missed-call alerts for feature phones, Bhashini voice in all
22 scheduled languages, claim-appeal copilot for rejected claims.

See [docs/REVENUE_MODEL.md](docs/REVENUE_MODEL.md) for who pays and why, and
[docs/ENGINEERING_NOTES.md](docs/ENGINEERING_NOTES.md) for known gaps.
