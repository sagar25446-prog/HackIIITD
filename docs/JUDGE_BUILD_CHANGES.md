# Judge build — changes and migration notes

Baseline: `JAAGRUK_FINAL.zip` (unchanged). This build lives in a separate working copy. No Git commits were made.

## Removed

* **Scam Shield** — page, `/api/scam/check`, `services/scam_shield.py`, `ml/scam.py`, `data/scam_dataset.json`, its
  search monitor, ops metrics, tests and its saved searches.
* **Assisted sessions** — `services/assisted.py`, every `/api/assist/*` route, the remote-browser modal and its
  privacy claims. Protected portals now open on the official website in a normal tab.

## Wapsi

* Start a recovery → My recovery cases → Official routes. The case is created **before** any lookup.
* Relationship and claim capacity are separate fields (`claimant_relation`, `claimant_capacity`).
* `POST /api/recovery/lookup` (idempotent) runs one qualified adapter for one case, holder and route; the frozen
  context is echoed in every event and in the observation. Consent must name the case, holder and route.
* Strict outcomes; portal-specific result reading (`tinyfish/portal_results.py`); bounded fallback only before
  submission; personal lookups are never recorded or replayed.
* Route registry `data/recovery_routes.json` (discovery service vs responsible institution, reviewed requirements,
  coverage labels) and `data/adapter_qualification.json` (live qualification).
* Recovery case view: Summary → Search evidence → Claim preparation → Official next step → Follow-up; printable
  bilingual preparation pack; follow-up date in the calendar.
* `/api/wapsi/start` remains as a compatibility wrapper over the same engine.

## Rules, jobs and privacy

* `services/rules_registry.py`: one active version for My plan, cases, Discover, Ask and the checker. Reviewed
  workflow thresholds now apply to the matching scheme rules. Every response carries `rules_version`.
* Discover re-checks of existing schemes create review candidates; "no date" means *availability unknown*.
* Explore qualification badges come from the server's own evaluation (`profile`), not client-supplied IDs.
* Job ledger in SQLite (`jobs` table): idempotency keys, cancellation (`POST /api/jobs/{id}/cancel`), paid-work
  limits, interrupted jobs reported as uncertain. SQLite runs in WAL mode.
* Research starts with `POST /api/ask/research`; exact recordings only.
* `no-store` on all API responses; operator key for monitors; private webhook token; hourly helper-link cleanup.

## Frontend

* Navigation: My plan · Life update · Paperwork · Wapsi (+ Ask, Under the hood). My plan tabs: Actions, Discover,
  Calendar, Updates. Old hash links (`#explore`, `#radar`) still work; `#scam` opens My plan.
* My plan: next three actions (cases and matching schemes), active cases, dates, benefit estimates by type.
* Life update: *Preview what changes* before applying; apply is refused if the plan or rules changed.
* Case drawer: unsaved-changes prompt; readable share summary; field-by-field conflict comparison.
* One accessible dialog primitive (focus containment/restoration, inert background, scroll lock); 48 px controls;
  contrast fixes; lazy-loaded screens; error boundary; self-healing reload after a new build.

## Migration notes

* Existing browser workspaces load unchanged; `observations` is optional on cases.
* Older Wapsi cases with `claimant_relation: "nominee"` show "Answers needed" until a claim capacity is chosen.
* Run `python backend/scripts/qualify_adapters.py` on the demo machine; without a passing qualification the app offers
  the official-site route for that portal instead of the automated check.
* Set `JAAGRUK_REVIEW_KEY` to use monitor and rule-review controls.
