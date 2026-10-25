# Validation — judge build (25 Oct 2026)

Run on Windows 11, Python 3.12, Node 24, Chrome. Live TinyFish calls used the team's own key and only the fictional
test identity "Jaagrukdemo Testcase" (DOB 12/03/1971) or the fictional sample families.

## Automated checks

| Check | Result |
|---|---|
| `python -m pytest backend/tests -q` | **103 passed** (workspace, helpers, harness, eligibility, ML, Discover, life updates, recovery, jobs, rule registry) |
| `npm test` (frontend) | calendar/private cache, workspace scope/sharing/storage/stale responses, 35 life-update consent assertions — passed |
| `npm run build` | TypeScript + Vite production build passes; screens are lazy-loaded (main bundle 313 kB) |

### Delivery-blocking scenarios covered by tests (`backend/tests/test_recovery.py`)

| Scenario | Test |
|---|---|
| A result stays bound to its case, holder and route; consent must cover exactly that case, holder and route | `test_lookup_requires_matching_route_category_and_consent` |
| Missing input, CAPTCHA, outage, unknown page and uncertain agent output never become "no match" | `test_lic_unreachable_captcha_and_unknown_pages_are_never_no_match`, `test_agent_output_is_read_strictly`, `test_agent_failure_is_never_no_match` |
| The official no-record message on LIC's real page is recognised | `test_lic_official_no_record_message_is_no_match` (fixture saved from the live page) |
| A recorded false positive (`found: true` with "Found 0 unclaimed amounts") is not a record | `test_agent_output_is_read_strictly` |
| Records stay separate; duplicates collapse; nothing is summed | `test_candidates_stay_separate_and_duplicates_collapse` |
| Duplicate clicks return the same job; per-client limit; cancel works | `test_duplicate_starts_return_the_same_job_and_cancel_works` |
| A job interrupted by a restart reports "uncertain" | `test_interrupted_job_reports_uncertain` |
| Invalid route/category or claimant/holder combinations never produce a ready case | `test_invalid_combinations_never_produce_a_ready_case` |
| A record is not ownership; discovery routes ask for the responsible institution | `test_possible_record_is_not_ownership_and_discovery_needs_the_bank` |
| Helpers cannot rewrite provider evidence | `test_helper_cannot_rewrite_provider_evidence` |
| Personal lookups are never replayed offline, and name/DOB are not stored | `test_personal_lookups_are_never_replayed_offline` |
| Preview explains changes; a stale preview cannot overwrite newer edits or a newer rules version | `test_preview_explains_without_changing_and_stale_apply_is_refused` |
| A bonus stays a note; a future bereavement is refused | `test_bonus_stays_a_note_and_future_bereavement_is_refused` |
| One rules version across screens; client-supplied eligibility is ignored; private responses are `no-store` | `test_one_rules_version_everywhere_and_client_cannot_claim_eligibility` |
| Monitor controls and webhooks are protected; assisted sessions are gone | `test_monitor_and_webhook_controls_are_protected` |

## Live adapter qualification (`backend/scripts/qualify_adapters.py`)

| Adapter | Engine | Outcome | Latency | Approx. cost |
|---|---|---|---|---|
| LIC unclaimed policy dues | Playbook on TinyFish Browser (IN) | No match — official message recognised | 38.6 s | ≈ $0.002 |
| Tata AIA unclaimed funds | TinyFish Agent, 5 steps | No match — official message recognised | 66.2 s | ≈ $0.08 |

During development the first Tata AIA run was rejected by TinyFish *before submission* (an output-schema format
error); the bounded fallback ran the playbook once, which also read the official message. A first LIC probe hit
`ERR_TUNNEL_CONNECTION_FAILED` — the kind of outage the adapter now reports as "Unavailable", never "no match".

## Browser checks (Chrome; desktop and 375 px phone; English and Hindi)

| Flow | Verified |
|---|---|
| Sample family → My plan | Next three actions first; separate estimates (₹30,000/yr recurring, ₹20,000 one-time, ₹2 lakh cover); sample-data banner |
| "Prepare the application" | Created the widow-pension case with the deceased husband pre-selected and opened it |
| Case drawer with unsaved edits | Escape → Save / Discard / Keep editing; Save and close persisted the answer |
| Wapsi → Start a recovery | Holder (passed away), claimant, relationship, capacity, asset, LIC route → case created first |
| Automated LIC check from the case | Live; consent cleared after start; outcome "No match for these submitted details" saved into that case for that holder |
| Record what happened (official site) | Possible record with name/reference/amount saved as a user-reported observation |
| Life update → Preview what changes | Riya renewal: new case, why, questions, marksheet; Apply created the year-2 renewal case |
| Layout | No horizontal overflow on any screen at 375 px in English or Hindi; no console errors |
| New build while a tab is open | A missing lazy chunk reloads the page once instead of showing a blank screen; an error boundary covers the rest |

## What this does not establish

Tests and checks use fictional people. They do not prove government approval, a successful claim, recovered money or
the behaviour of portals on another day. Live results above are observations at the time of testing.
