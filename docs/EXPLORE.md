# Explore: every scheme, searchable, live and tracked

Explore is the "find anything" view next to My Haq. My Haq shows the short list Z3 proves for this family; Explore shows
the whole catalogue, uncluttered.

## What the citizen sees
- **One search box that understands sentences**, in English, Hindi or Hinglish, typed or spoken: *"scholarships for SC
  girls that are open"*, *"दिल्ली में विधवा पेंशन"*, *"kisan ke liye yojana"*. The sentence becomes removable filter
  chips ("Education · Open now · Delhi + Central · SC · Girls"). It can only filter the catalogue; it never invents a scheme.
- **Browse by need**: 9 category tiles with counts.
- **Filters with counts**: where (central + 36 states/UTs), category, for whom, application status, benefit type, and
  how we know (proven / read from the official page / found live). The default is the family's state + central.
- **Clean result rows**: name, one-line benefit, and only the chips that matter: *You qualify* (from the Z3 proof),
  *Closes 31 Oct 2026 · 7 days left*, central/state.
- **Detail panel**: benefit, who can apply, documents, how to apply, exclusions (collapsed), official dates, source and
  when it was read, plus *Track*, *Re-check official page* and *Apply on the official site* buttons.
- **Track** (bookmark) any scheme. The Alerts page lists tracked schemes. When the app opens, it re-checks any tracked
  scheme not checked in 24 h, and a changed deadline or rule shows as a notification and an alert.
- **Search official sites live**: when the catalogue doesn't have it, TinyFish searches myScheme and `.gov.in` pages now,
  reads the new ones and adds them. Non-official domains are never shown as schemes.
- **Phone layout**: five bottom tabs (My Haq, Explore, Wapsi, Alerts, More). Filters open as a sheet, and the example
  questions scroll sideways.

## Where the data comes from (all through TinyFish)
| Source | TinyFish product | What we keep |
|---|---|---|
| myScheme (NeGD, Govt. of India) scheme pages | **Search** (free) discovers `myscheme.gov.in/schemes/*` URLs; **Browser** (Indian IP, ≈ $0.002/min) renders each page, because Fetch only sees the footer of this JS app | Parsed sections only: details, benefits, eligibility, exclusions, application process, documents, sources. Attribution on every card, as myScheme's copyright policy requires |
| National Scholarship Portal "Schemes on NSP" | **Fetch** (free) | Official *open from / apply till* dates for 31 scholarships, matched to catalogue schemes and shown as Open / Closing soon |
| Official `.gov.in` pages found by a live search | **Search** + **Fetch** | Title, link, and a "last date" if the page states one |
| Our 29 proven rules | (existing) | Z3 proofs; these rank first and carry *You qualify* |

Tiers shown to the user: **Proven** (Z3 rules), **Read from the official page** (TinyFish Browser), **Found live** (listing
only until someone opens it, then it is read in full).

## Deadline changes: how the user gets updated
1. **Official dates**: `POST /api/explore/deadlines/refresh` re-reads the NSP list with TinyFish Fetch. Each changed
   *apply till* date (or newly opened scheme) becomes an alert ("…: deadline moved, apply till 15-11-2026"). It runs
   when the app opens, if the last read is over 6 h old, and with every Change Radar scan.
2. **Tracked schemes**: `POST /api/explore/recheck` re-reads tracked myScheme pages on a TinyFish Browser and diffs
   every section (deadline, eligibility, benefits, documents, how to apply). Proven schemes use the existing
   Fetch + Z3 drift proof. A change gives an alert and an updated card; an unreachable page keeps the saved copy and
   says so.
3. **Change Radar** (existing): notice boards (SSC, UPSC, NSP home, Delhi Lakshmi Yojana) via Fetch, plus optional
   always-on Monitors.

## API
`GET /api/explore/stats` · `POST /api/explore/search` {q, filters, sort, page, eligible, lang} ·
`POST /api/explore/command` {text, eligible, lang, keep_where} · `GET /api/explore/scheme/{id}` ·
`POST /api/explore/live` {text} → job (SSE at `/api/jobs/{id}/events`) · `POST /api/explore/recheck` {ids} → job ·
`POST /api/explore/due` {ids} · `GET /api/explore/deadlines` · `POST /api/explore/deadlines/refresh`.
`/api/radar/alerts` and `/api/radar/scan` accept `tracked` so tracked schemes count as "for you".

## Building / refreshing the catalogue
```bash
python backend/scripts/crawl_myscheme.py discover            # TinyFish Search, free (30 searches/min limit)
python backend/scripts/crawl_myscheme.py read --limit 400    # TinyFish Browser, resumable, ~9 pages/min with 3 sessions
python backend/scripts/crawl_myscheme.py deadlines           # NSP official dates, TinyFish Fetch, free
```
The app picks up new pages without a restart (the index rebuilds when `data/catalog/myscheme.json` changes).

## Honest limits
- Coverage is what has been read so far (the count is on screen), not "every scheme in India". myScheme lists 4,000+.
- Most myScheme pages state no closing date, so those show none. Deadlines come from NSP (scholarships) and from
  official pages that state one.
- The sentence parser is rule-based (English, Hindi and Hinglish vocabulary plus Hindi word endings). An LLM parser can
  slot in behind the same JSON schema.
- TinyFish Search is limited to 30 requests a minute per account. A live search uses 2.
