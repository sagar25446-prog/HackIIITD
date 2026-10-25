# Using the feature build

## Personal first, family when needed

JAAGRUK starts in **Personal mode**. Use **My profile** to edit your own details. Home, the calendar and life updates use the personal view; optional Family mode exposes saved members and their cases. Your explicit mode choice is remembered locally. Switching back to Personal mode keeps the family data saved. A related person needed by one of your own cases, such as a deceased asset holder, can remain part of that case without opening the rest of the family workspace.

In Family mode, add people with separate IDs, select who an event applies to, and confirm any shared household facts. Two people with the same relationship remain distinct. An applicant's bank readiness, education, disability and personal document assertions do not come from a relative's record. Case-specific helper answers also do not silently rewrite the person's main profile.

## Type any life update

**Life updates** is a free-text journal, rather than a required choice among four events. Type a personal update in your own words and choose **See what this could change**. The application uses local pattern matching to suggest a note, move, income/job review, bereavement, retirement or education interpretation. Check or change that suggestion, enter the date and confirm the selected action before saving. Unrecognized text can still be saved as a personal note. This intent suggestion is not a trained ML model or a promise to understand every sentence.

- **“I got a bonus at work”** suggests an income review but does not alter income or eligibility. Save it as a note, or explicitly choose to update your confirmed annual personal income.
- **“I moved to Maharashtra”** needs a confirmed destination and actual move date. A confirmed move dated today or earlier updates residence and years-in-state for the selected people, preserves the origin of existing address documents, and reevaluates relevant saved cases. The result shows affected cases; it does not mean every benefit changes.
- **“I am moving next month”** can be saved with a future date. It remains a planned event; today's residence stays unchanged. The application does not automatically apply a future move when its date arrives.
- **Bereavement, retirement and education updates** can create preparation cases. The case still needs its applicant/related-person roles and factual answers. A retirement note does not automatically change age, and an education note does not establish a prior scholarship award.

Only explicit, supported factual changes alter planning. Unknown facts remain unknown; the journal does not infer entitlements from the wording of a note.

## A complete demonstration

1. Start your own profile or choose the fictional Sunita sample. Check Personal mode and **My profile** first. Type **“I got a bonus at work”** in Life updates, inspect the suggestion and save without confirming a new income; your facts stay unchanged.
2. Switch to Family mode to inspect the separate records; Riya does not receive her parent's bank or document assertions. In Life events, type an education update, confirm the Education interpretation and select Riya. Open the new case and choose Renewal. Explicitly answer prior selection, degree/regular study, marks, attendance, course year and other aid.
3. Open the saved case. Its renewal checklist asks for the previous-year marksheet rather than adding fresh-entry income-certificate paperwork. Mark only manually confirmed metadata; no document authenticity is asserted.
4. Home’s calendar shows the reviewed 2026–27 CSSS renewal student date separately from institute and nodal verification dates, only when prior award is confirmed. These initial public dates were checked on 24 October 2026; refresh/review official changes before relying on them later.
5. In the case, add a private note, open sharing and review the payload with **Include existing notes** left unchecked. Create a 24-hour private link; creation saves the reviewed draft locally. Open it in another browser/device, edit a case answer or helper note, save and synchronize on the owner page. Check that the private note and local timeline remain, while the helper's change is recorded. Make competing owner/helper edits to see the conflict comparison. Revoke the link and check it is denied.
6. Open **Paperwork planner** from Home. Try PAN → Instant e-PAN, Aadhaar → Address update, or Driving licence → Learner with Delhi selected. Answer the route-specific questions in the saved case.
7. Try an unknown service/state combination through **Find official guidance**. This uses TinyFish when available, returns only official-domain leads and does not fabricate a mandatory checklist.
8. Create a Wapsi case selecting a claimant and asset holder. Protected services open in the citizen’s own official tab. Optional supported searches require consent and do not count a possible match as recovered cash.
10. Home → Updates checks public sources. A changed live capture becomes a pending candidate, not an automatic rule. A team reviewer can activate supported fields with source evidence. Only affected cases receive personal consequences.
11. In Life events, confirm a current move to another state and inspect the affected case preparation. Then enter a future move: it appears as planned without replacing today's residence. Return to Personal mode and verify that unrelated family cases are hidden while their saved records are retained.

## Paperwork coverage

| Service | Modeled route | Boundary |
|---|---|---|
| Aadhaar | Adult document-based enrolment; name/address/DOB update proof categories; official mobile-update route | Use UIDAI’s exact current document/form tables. Children and Head-of-Family/NRI circumstances require official route confirmation. No Aadhaar number is stored. |
| PAN | Adult Instant e-PAN prerequisites; standard new/correction proof categories | Existing PAN, minors and representative-assessees cannot use the adult instant route. Citizenship/guardian exceptions and accepted proofs remain on the official list. |
| Driving licence | Delhi learner, permanent and renewal preparation categories | Additional classes, exact age-40 medical boundary and differing renewal form references are flagged for confirmation. Sarathi provides the current state/class form. |
| Income certificate | Delhi’s published identity, address, declaration, income and expenditure evidence categories | Other states do not inherit Delhi requirements. |
| Caste/domicile certificates, passport, birth/death certificates and another government service | Catalogue entry and contextual official-guidance search | No exhaustive reviewed checklist is asserted for unmodeled circumstances. State-specific certificate routes need confirmation with the selected authority; a catalogue entry is not nationwide reviewed coverage. |

The planner accepts a broad range of government paperwork requests through its catalogue and **Find official guidance**. Select the person, state, application stage and relevant circumstances. The displayed checklist distinguishes available, missing, expired, uncertain and alternative documents where the reviewed route supports those distinctions. Review the linked official accepted-proof list for exact document options and exceptions.

The service-first planner is part of the paperwork feature, not a nationwide automatic filing service. A service appearing in the catalogue does not establish an exhaustive checklist for every state, age or applicant type. A generic search result must never be presented as a reviewed state-specific checklist. Unavailable searches report that no requirements were invented.

## Public review fields

- Education: fresh percentile, renewal marks/attendance, income limit, all three actor-specific dates, academic year.
- Bereavement: modeled pension income limit.
- Retirement: modeled income limit and minimum age.
- Moving: source-wording review only; unsupported conditions cannot be silently invented.

A review needs the configured server key, pending live-source change, exact supporting excerpt and a note. The review UI is technical and intended for the team. Document alternatives, coverage and additional requirements are code-reviewed catalogue changes; they are not arbitrary JSON from a helper or LLM.

## Persistence and operations

- Local personal/family workspace, stable owner ID and life-event journal: `jaagruk.workspace.v2` in browser storage. The Personal/Family preference is stored separately.
- Plan export contains the current visible view. Use Family mode before exporting if you need the complete family workspace. Malformed saved data has a separate recovery export; storage errors are surfaced instead of silently claiming a successful save.
- Link management: a separate browser record; not included in workspace export.
- Shared snapshots, revisions and audit: server SQLite, separate from public captures/versions.
- Shared snapshots contain one selected case and its relevant applicant/related-person facts and document metadata. Existing owner history and notes excluded in the sharing preview stay private. A new share saves the original unredacted case locally; it does not replace the local case with the redacted payload.
- Helper edits remain user-reported. Synchronization merges helper history without removing local history and preserves excluded private notes; helper preparation notes can be added to the owner timeline. Owner drafts are retained if a shared revision arrives while editing. Compare versions and explicitly apply the chosen draft to resolve concurrent edits.
- Helpers cannot edit official rules, source evidence, lookup observations or verified-payment fields. Sharing has no access to unrelated members. Links expire after 24 hours by default and owner revocation takes effect immediately. A helper link on localhost is accessible only on that machine; use a reachable HTTPS deployment for another device.
- Demo private database: provide a disposable `JAAGRUK_DB` path; do not commit it.
- No source scan or paid lookup is started merely by viewing a case or reconnecting to an unavailable job.
- Preserve one persistent server process for current lookup jobs. Jobs remain in memory; after a restart the app reports an unavailable outcome rather than restarting the paid run. Shared cases and public reviews persist in SQLite.

## Feature handoff

The feature delivery consists of **14 sequential patches (31–44)** applied after the complete **30-import baseline**, with baseline-hash verification and validation recorded in the delivery guide. This chat creates no Git commits or pushes. Patches are implementation boundaries for review; contributor identities, messages and dates must describe the work actually reviewed and committed.

## Sources checked for the new preparation routes

The initial route guidance and dates below were checked on **24 October 2026**. Later live differences require review before they can become active planning rules.

- UIDAI document tables: https://uidai.gov.in/images/commdoc/valid_documents_list.pdf
- UIDAI enrolment/update: https://uidai.gov.in/en/enrolment-and-updates
- Income Tax Instant e-PAN FAQ: https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/Instant%20e-PAN-faq
- Income Tax PAN information: https://www.incometaxindia.gov.in/en/pan
- Delhi learner licence: https://transport.delhi.gov.in/transport/learner-licence
- Delhi renewal: https://transport.delhi.gov.in/transport/renewal-driving-licence
- Delhi income certificate: https://revenue.delhi.gov.in/revenue/income-certificate
- CSSS FAQ: https://scholarships.gov.in/public/schemeGuidelines/FAQ_DOHE_CSSS.pdf
- Current NSP scheme schedule: https://scholarships.gov.in/iver/All-Scholarships
- WCD pension process: https://wcd.delhi.gov.in/sites/default/files/WCD/circulars-orders/flow_chart_1_3-6_1.pdf
- ONORC FAQ: https://dfpd.gov.in/faqs/en
- UDGAM FAQ: https://www.rbi.org.in/commonman/English/Scripts/FAQs.aspx?Id=3579
