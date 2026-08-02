# CLAUDE.md — RVU Tracker

Mobile-first PWA for a surgical group tracking wRVUs, CPT codes, and
compensation. No build step: React 18.3.1 + Babel standalone via CDN,
static files served from GitHub Pages. This file is the constraint map for
AI-assisted sessions — keep it current in the SAME commit as any change it
describes.

## Architecture / load order (13 files)

index.html head defines `var ASSET_V = "<n>"` — the hand-bumped cache
version stamped as `?v=` on every local script URL (and the cpt-data
preload, derived from the same constant).

Script execution order:

1. React, ReactDOM, Babel standalone — SRI-pinned CDN tags. If a pinned
   version is ever bumped, recompute the sha384 hash or the script blocks.
2. **Plain scripts** (`var plain = ['crypto','cpt-data','utils','styles']`
   in index.html) — classic tags, execute during HTML parse, in order.
   ALL FOUR ARE JSX-FREE AND MUST STAY THAT WAY: adding JSX to any of them
   is a parse error at runtime (they never pass through Babel).
3. **Babel scripts** (`var js = ['dashboard','log','analytics','history',
   'compare','acute','settings','app']`) — `type="text/babel"`, transformed
   and executed at DOMContentLoaded, after every plain script.
4. SheetJS is NOT loaded at boot. `loadXLSX()` in utils.js lazy-injects it
   (same pinned version + SRI) on first Excel use with an in-flight guard.

`scripts/check.js` (`npm run check`) enforces this structure: both arrays
parsed, disk<->array set equality, pinned plain-set membership, ASSET_V
presence, plus the per-file gates below. Run it after EVERY file change.

## Deploy rules

- **Every deploy that changes any js file must bump ASSET_V** in
  index.html. Build reports must state the new value.
- index.html + the two load arrays + the files they name are an ATOMIC
  deploy set: a file shipped without its array entry (or vice versa) is a
  white screen. check.js catches this — keep it green before pushing.
- Commit and push from `RVU App Split/` (the repo root). Never commit
  billing data (`RVU Wallet Data/`), CMS source files (`CMS 2026/`), or
  any partner name — the repo is public and the roster is runtime user
  data only.

## Hard constraints (enforced by check.js where possible)

- NO optional chaining (`?.`) and NO `export` — Babel standalone script
  mode. Use `x && x.y` or ternaries.
- ASCII-only source in all js files. Unicode via escapes (`\u2014` for an
  em-dash, `\u2191` for an arrow); escape `<` in CPT descriptors as
  `\u003c` and `>` as `\u003e`.
- utils.js/styles.js top-level `const`/`let` names are parse-time GLOBAL
  LEXICAL BINDINGS (useState, CPT_DATABASE_DEFAULT, MODIFIERS, SK, S, ...).
  A Babel file that redeclares any of them at its own top level throws
  "already been declared" and that whole file dies. Components own only
  their component names.
- Hooks before any conditional return — a hook below an early return
  crashes the view (this bug shipped once in analytics.js).
- KEYWORD_SUPPLEMENT and FRIENDLY_DESC must stay above
  CPT_DATABASE_DEFAULT in utils.js.
- All date math from LOCAL parts: `todayLocal()`/`localYMD()`, month keys
  as "YYYY-MM" strings, weekday via `new Date(y, m-1, d)`. NEVER
  `new Date("YYYY-MM-DD")` (parses UTC midnight) and never `toISOString`
  for calendar math. Excel serials: epoch 1899-12-30 via local parts
  (compare.js excelDateToYM); `XLSX.read` runs with cellDates OFF so that
  helper is the only serial conversion path.
- Entries' snapshotted wRVUs are authoritative: analytics never re-look-up
  values from the CPT db, and an edit that doesn't change the CPT never
  re-derives base/description/category (history.js saveEdit).
- PIN pad DOM is appendChild-only (never `innerHTML +=`); clipboard writes
  need a catch fallback; no `viewport-fit=cover`; chunked u8toB64 in
  crypto paths.
- `crypto.js` DATA_KEY must equal `utils.js` SK (check.js asserts).
- CMS_RAW row count baseline lives in check.js — bump it consciously when
  the CPT database changes.

## Working protocol

Small approved batches; plan first for architecture changes (index.html is
always an architecture change); `npm run check` after every file edit;
live-verify in the browser preview with seeded data, then CLEAR test data;
pause for review before committing. State root causes before fixing bugs.
