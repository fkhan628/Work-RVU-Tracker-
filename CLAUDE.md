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
  payDefaultShiftHours/PAY_LONG_SHIFT_HOURS (weekend and holiday call is a
  24h shift: where the stipend period is shorter the form starts there at
  24h, paid stipend x hours / stipendHours; up to 24h never warns),
  payDraftTrip/payDraftFromShift (dn and relSet are UI-only draft fields;
  passing `rate` to payDraftEvent/payDraftRefresh switches their rules on),
  payWeOrHol, payReclassShift, payUndoApply, the
  whole-cent month totals payShiftYears/payMonthTotals/paySiteNames, the
  Dashboard's payTotalInRange (a separate line, never added to Comp),
  re-pricing payRatesDiffer/payShiftStale/payRepriceShift, and the built-in
  rates fill-in payBuiltInFor/payMissingBuiltIns/payRateZero/
  payBuiltInPlan/payApplyBuiltIn/payBuiltInOffers, and the call-case credit
  rule payCaseNoCredit/paySiteCreditNote with the site credit switch
  paySiteWithCredit/payCreditOffers/payApplyNoCredit/payCreditConfirm);
  callpay.js only holds state and passes "now" in. Built-in rates reach an
  existing site ONLY through the user's confirmed "Use built-in rates" tap
  (re-planned inside the updater); repairData never adds rates, amounts the
  user typed are never changed, and casesEarnRVU is never touched by it.
  casesEarnRVU (false = call cases logged at the site from
  CALL_NO_CREDIT_FROM earn no wRVU credit) changes ONLY through
  paySiteWithCredit on the user's confirmed tap: the site's "Call cases
  logged here" control, or the "Built-in credit rule" offer
  (payCreditOffers: one same name or one alias of a no-credit built-in,
  never by built-in id or an ambiguous match; payApplyNoCredit re-plans
  inside the updater). repairData and name matches never change it;
  check.js G9 refuses any other write (a fresh site's literal true aside).
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
  utils.js touches noCredit: isNoCredit, repairData and the one writer
  withNoCredit (true or the key deleted, never false; check.js contract
  test), which only entryWithCall calls (G7). repairData strips any
  non-true value, so a change to the field's type must deploy its
  repairData change first. check.js refuses raw adjustedRVU arithmetic
  outside creditedRVU/noCreditRVU, destructuring adjustedRVU, any
  "adjustedRVU" string or template literal (an object-literal key - a
  write - aside), a literal-0 adjustedRVU write, any noCredit mention
  outside isNoCredit/repairData/withNoCredit, and any use of the four
  helper names other than calling them or passing them as a call argument; RAW_RVU_PIN
  pins the remaining raw reads (utils.js 2) - bump it only for a new
  sort/display.
- No-credit readers (7a): counts and averages shown next to, or dividing,
  a credited wRVU or $ figure count CREDITED cases only; no-credit cases
  appear once, on a quiet "Logged, no credit" line (Home, Trends, month
  detail, Monthly Report + its copied text, Settings Summary Stats).
  Counts that label visible rows or records count every entry (History
  lists, encounter cards, backup/restore, usage ranking, companions, Excel
  "Times Logged"). Top Encounters lists encounters with at least one
  credited case, under their full code combination. A no-credit row gets
  the grey S.ncTag "no credit" tag and a dimmed wRVU; a partly flagged
  encounter card is "mixed". Exports keep every row and append a Credit
  column (Credited / No credit) LAST; CSV import never reads it back - it
  warns first instead. Remove Duplicates keys on credit and reports
  same-case pairs that differ only in credit. Each "Logged, no credit"
  line opens History on its No credit chip with the same range (App's
  one-shot historyPreset; utils.js fiscalYearBoundsYMD/monthBoundsYMD);
  the chip shows only when something is flagged, and History's filtered
  bar (with Clear filters) shows for a date range or the No credit chip.
- Call cases and credit (7b): a case is no-credit only when it is Call,
  logged at a CURRENT site whose casesEarnRVU === false, and dated on/after
  CALL_NO_CREDIT_FROM ("2026-10-01", pinned by check.js to the no-credit
  built-in's first rate date). payCaseNoCredit is that rule. Credit is
  decided when a case is WRITTEN (entryWithCall) and kept as the noCredit
  snapshot: an edit keeps it while Call/Private and site are unchanged and
  the date stays on the same side of the start; a later site change never
  rewrites logged cases (no bulk tool, by the owner's choice). Call cases at
  a site store siteId + siteName; Private and siteless Call cases store
  neither (CALL_SITE_OTHER is a picker key, never stored). There is no
  repair rule for siteId/siteName: readers use entrySiteId/entrySiteKey/
  entrySiteLabel, which ignore junk. Every entry write of isCall goes
  through entryWithCall (check.js G8: an isCall object literal must be its
  first argument; siteId/siteName are written only in utils.js and
  callpay.js). Log derives (src null). History edits pass the stored case
  as src and preview with the same call; "Apply site rule" re-derives;
  Private clears site and credit; + Add inherits from its source; the rest
  of the encounter (checkbox, entryEncounterCallPlan) gets only the call
  fields, credit from each case's own date; a case's own deleted site can
  only lose the mark. Log asks for the call site when the user has any
  (an "Other site" chip saves Call with no site; Save waits for a pick);
  its totals, save bar and selected-code Compensation come from an
  entryWithCall preview of the encounter; the toast and the bar's frozen
  "Logged" line come from the entries save() wrote. History offers a
  one-tap fix-up for Call cases dated on/after the start that have no site
  and were CREATED before the Log site picker (CALL_SITE_PICKER_MS, read
  from the id's Date.now() prefix - a later siteless Call case is a
  deliberate "Other site"); "Keep as is" ids are remembered per device in
  localStorage "rvu-callfix-kept" (outside the data store). It writes
  through entryWithCall (entrySitelessCalls / entrySitelessCallPlan) with an
  in-place Undo (app.js undo type "restore", entryRestoreInPlace, which
  restores only cases still exactly as the fix-up wrote them).
- Entries' snapshotted wRVUs are authoritative: analytics never re-look-up
  values from the CPT db, and an edit that doesn't change the CPT never
  re-derives base/description/category (history.js saveEdit).
- Log's one Save control is the 64px save bar (log.js; check.js counts
  onClick={save}), pinned once the active procedure has a code. While
  pinned, LogProc reports it (setLogBar) and App lifts the undo toast to
  bottom 148 so Undo never covers Save; otherwise the toast stays at 64.
  After the post-save reset, the next case's first code dismisses that
  save's pending Undo (same Log visit; Call Pay precedent). Change the bar height, nav height or toast offset together;
  never hide the bar on input focus.
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
