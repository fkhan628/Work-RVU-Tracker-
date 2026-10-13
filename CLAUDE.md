# CLAUDE.md — RVU Tracker

Mobile-first PWA for a surgical group tracking wRVUs, CPT codes, and
compensation. No build step: React 18.3.1 + Babel standalone via CDN,
static files served from GitHub Pages. This file is the constraint map for
AI-assisted sessions — keep it current in the SAME commit as any change it
describes.

## Architecture / load order (14 files)

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
   'compare','acute','callpay','settings','app']`) — `type="text/babel"`, transformed
   and executed at DOMContentLoaded, after every plain script.
4. SheetJS is NOT loaded at boot. `loadXLSX()` in utils.js lazy-injects it
   (same pinned version + SRI) on first Excel use with an in-flight guard.

`scripts/check.js` (`npm run check`) enforces this structure: both arrays
parsed, disk<->array set equality, pinned plain-set membership, ASSET_V
presence, store-field parity (defState = loadData = finishRestore),
call-pay math tests (the REAL utils.js run in a Node vm sandbox), plus
the per-file gates below. Run it after EVERY file change.

## Deploy rules

- **Every deploy that changes any js file must bump ASSET_V** in
  index.html. Build reports must state the new value.
- index.html + the two load arrays + the files they name are an ATOMIC
  deploy set: a file shipped without its array entry (or vice versa) is a
  white screen. check.js catches this — keep it green before pushing.
- Commit and push from `RVU App Split/` (the repo root). Never commit
  billing data (`RVU Wallet Data/`), CMS source files (`CMS 2026/`), or
  any partner name — the repo is public and the roster is runtime user
  data only. The same goes for call-pay site names and rates (paySites),
  with ONE exception the owner chose on 2026-10-11: the built-in preset
  DEFAULT_PAY_SITES in utils.js (two sites + their rates, public) and the
  check.js test of the owner's worked examples against it. Any other
  site or rate stays runtime user data.

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
- New top-level store field: add it to defState, loadData AND Settings
  finishRestore (check.js asserts parity), give it repairData +
  validateData shape rules, and read it as `(data.x || [])` - last-good
  recovery can return a snapshot that predates the field.
- Call-pay math has ONE implementation in utils.js (payHolidayName,
  classifyPayEvent, computeShiftPay, rateInForce, plus the entry helpers
  addDaysYMD/payDefaultShiftDate/payStartBack, the shift-form draft rules
  payDraftEvent/payDraftNewEvent/payDraftRefresh plus the simple form's
  payDraftRate (the ONE rate choice: kept copy or version in force),
  payAsksDayNight/payMidnightAsks (ask only where the answer changes pay),
  payDraftTrip/payDraftFromShift (dn and relSet are UI-only draft fields;
  passing `rate` to payDraftEvent/payDraftRefresh switches their rules on),
  payWeOrHol, payReclassShift, payUndoApply, the
  whole-cent month totals payShiftYears/payMonthTotals/paySiteNames, the
  Dashboard's payTotalInRange (a separate line, never added to Comp),
  re-pricing payRatesDiffer/payShiftStale/payRepriceShift, and the built-in
  rates fill-in payBuiltInFor/payMissingBuiltIns/payRateZero/
  payBuiltInPlan/payApplyBuiltIn/payBuiltInOffers);
  callpay.js only holds state and passes "now" in. Built-in rates reach an
  existing site ONLY through the user's confirmed "Use built-in rates" tap
  (re-planned inside the updater); repairData never adds rates, amounts the
  user typed are never changed, and casesEarnRVU is never touched by it.
  Shifts are priced only
  from their own rate copy. Every payShifts write goes through
  payShiftFromDraft (or payRepriceShift for a confirmed re-price), whose
  output must pass repairData unchanged (check.js contract tests) -
  otherwise every load silently rewrites user data. utils.js must stay loadable in check.js's vm sandbox: a
  new top-level browser-API call needs a stub there, not a skipped test.
- CPT search: matchesCPTQuery (utils.js) defines WHICH codes match;
  rankCPTMatches only reorders them (exact, prefix, usage, favorites,
  CPT order). Log and History both use it; check.js pins it.
- wRVU credit has ONE rule, in utils.js: isNoCredit(e) is the only
  no-credit test (strict e.noCredit === true); creditedRVU(e) feeds every
  wRVU or comp SUM (the snapshot adjustedRVU, uncoerced, or 0);
  noCreditRVU(e) is the only way to total no-credit wRVU. adjustedRVU is
  never zeroed to remove credit; sort comparators and a row's own wRVU
  display stay raw. entry.noCredit is `true` or absent: repairData deletes
  `false` silently and any other value LOUDLY (the case stays credited) and
  is a fixed point; validateData deliberately ignores the field. Only
  utils.js touches noCredit (isNoCredit, repairData; 7b's single writer
  joins them with a repairData contract test). repairData strips any
  non-true value, so a change to the field's type must deploy its
  repairData change first. check.js refuses raw adjustedRVU arithmetic
  outside creditedRVU/noCreditRVU, destructuring adjustedRVU, any
  "adjustedRVU" string or template literal (an object-literal key - a
  write - aside), a literal-0 adjustedRVU write, any noCredit mention
  outside isNoCredit/repairData, and any use of the three helper names
  other than calling them or passing them as a call argument; RAW_RVU_PIN
  pins the remaining raw reads (utils.js 2) - bump it only for a new
  sort/display.
- Entries' snapshotted wRVUs are authoritative: analytics never re-look-up
  values from the CPT db, and an edit that doesn't change the CPT never
  re-derives base/description/category (history.js saveEdit).
- PIN pad DOM is appendChild-only (never `innerHTML +=`); clipboard writes
  need a catch fallback; no `viewport-fit=cover`; chunked u8toB64 in
  crypto paths.
- `crypto.js` DATA_KEY must equal `utils.js` SK (check.js asserts).
- cpt-data.js is built by scripts/build-cpt-data.js. Row contract `[code,
  desc, wRVU, category, keywords ("" if none), CMS GLOB DAYS]`. wRVU (r[2])
  and the global (r[5]) always come from the CMS nonQPP PPRRVU file - never
  hand-edit them. The curated fields - descriptor (r[1]), category (r[3]),
  keywords (r[4]) - may be edited in place; the generator carries them
  forward on its next run (and its swap checklist edits them in the
  candidate). CMS_ROW_BASELINE and GLOB_BASELINE live in check.js and change
  together, deliberately, in the yearly swap commit.
- Global period has ONE source: CMS_RAW[5]. utils.js derives GLOBAL_DAYS;
  getGlobalDays/getGlobalColor are the only label and color source (000
  0-day, 010 10-day, 090 90-day, ZZZ add-on, anything else no chip; colors
  are the styles.js --global-90/10/0 theme tokens). Never type codes between
  `var GLOBAL_DAYS` and `var COMPANION_CODES` (check.js refuses). Chips are
  looked up at render time, not stored on entries, so a CMS change relabels
  past rows.

## Working protocol

Small approved batches; plan first for architecture changes (index.html is
always an architecture change); `npm run check` after every file edit;
live-verify in the browser preview with seeded data, then CLEAR test data;
pause for review before committing. State root causes before fixing bugs.
