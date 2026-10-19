# CLAUDE.md — RVU Tracker

Mobile-first PWA for a surgical group tracking wRVUs, CPT codes, and
compensation. No build step: React 18.3.1 + Babel standalone via CDN,
static files served from GitHub Pages. This file is the constraint map for
AI-assisted sessions — keep it current in the SAME commit as any change it
describes.

## Architecture / load order (15 files)

index.html head defines `var ASSET_V = "<n>"` — the hand-bumped cache
version stamped as `?v=` on every local script URL (and the cpt-data
preload, derived from the same constant).

Script execution order:

1. React, ReactDOM, Babel standalone — SRI-pinned unpkg tags. Each is
   DIRECTLY followed by an inline `window.X || document.write(...)`
   jsdelivr fallback with the SAME path, hash and crossorigin="anonymous".
   If a pinned version is ever bumped, recompute the sha384 hash and change
   BOTH lines, or the script blocks (check.js 4c).
2. **Plain scripts** (`var plain = ['crypto','cpt-data','utils','styles']`
   in index.html) — classic tags, execute during HTML parse, in order.
   ALL FOUR ARE JSX-FREE AND MUST STAY THAT WAY: adding JSX to any of them
   is a parse error at runtime (they never pass through Babel).
3. **Babel scripts** (`var js = ['dashboard','log','analytics','history',
   'compare','acute','callpay','settings','directorships','app']`) —
   `type="text/babel"`, transformed and executed at DOMContentLoaded, after
   every plain script.
4. SheetJS and jsPDF are NOT loaded at boot: `loadXLSX()` and `loadPDF()`
   in utils.js lazy-inject them (pinned version + SRI, in-flight guard,
   reset on failure). loadPDF tries unpkg, then the same path and hash on
   jsdelivr, 15 s per host (a blackholed CDN never fires onerror); its
   provenance comment records the cross-mirror hash check - bump PDF_PATH
   and PDF_SRI together (check.js G11).

Startup: an inline watchdog in index.html sits AFTER #app-loader and
BEFORE the CDN tags (so it still runs while one hangs). At 15 s it shows
"Still loading..." + Retry (the spinner keeps going); it shows "RVU Tracker
couldn't start" + Retry + details when a CDN global is missing at
DOMContentLoaded, or at 15 s after a script error or a failed same-origin
script. Retry only reloads; the watchdog never reads app data or writes
storage. The started signal is React's first commit into #root removing
#app-loader: keep `ReactDOM.createRoot(document.getElementById("root"))`
and never use the id app-loader in js files. check.js 4c pins the
STRUCTURE (placement, one same-SRI fallback per CDN tag, every inline
script parses, no storage writes, ASCII); the watchdog's behaviour (timer,
levels, Retry) is covered only by live tests - re-run them after editing
it. Known gap: a text/babel file whose download drops mid-launch reaches
Babel as an empty file (no error), so that case shows level 1, not 2. A
pre-paint light-mode theme
is deferred until the PIN pad is theme-aware (it would add a light-to-dark
flash on every cold launch).

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
- Day/Night call pay ships in two commits: the READER (ASSET_V 37 -
  utils.js payEffKey / payRateIsTyped / payShiftIsTyped, a null `effective`
  as the Original, typed shapes passed through repairData untouched,
  unpriced and never re-priced; callpay.js placeholders) and the FEATURE on
  top of it. Roll the feature back by reverting ITS commit only, never the
  reader, and bump ASSET_V again: a build without the reader drops every
  typed version, typed shift and Original-priced shift on its first load
  (announced in a banner, but permanent on that device).
- Commit and push from `RVU App Split/` (the repo root). Never commit
  billing data (`RVU Wallet Data/`), CMS source files (`CMS 2026/`), or
  any partner name — the repo is public and the roster is runtime user
  data only. The same goes for call-pay site names and rates (paySites),
  with ONE exception the owner chose on 2026-10-11: the built-in preset
  DEFAULT_PAY_SITES in utils.js (two sites + their rates, public - this
  covers Davenport's Original rates and its Day/Night shift types from
  2026-10-01: Day $2,773.60 flat; Night $291.23 flat + $242.69/hr for time
  in, paid only once the night's time in reaches 3:00, counted across the
  night; no stipend) and the check.js tests that price through the preset:
  the owner's worked examples, the spec's Day/Night figures and preview
  strings, and figures computed from the preset (edge cases, previews, the
  2027 re-price test). Any other site or rate stays runtime user data;
  made-up test rates stay literal.
- A second exception, chosen by the owner on 2026-10-15, is limited to
  the built-in DIRECTORSHIP_PRESET in utils.js and check.js's copy and
  worked-example tests of it. It allows exactly: the owner's own name,
  the organization names, the clinic remit address, the GL number, and
  the hourly rates and monthly hour caps. Everything else stays forbidden
  as before: no colleagues' names, no email addresses, no partner names,
  no PHI. No tracked file may contain an email address at all (check.js
  G6; its self-test builds its sample at runtime).

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
  for calendar math: a date key becomes a Date through utils.js
  `localDateYMD` (or, for a wall-clock time, key + a local "T" time such
  as "T12:00:00" - never "Z" or an offset), and whole days between two
  Dates come from `localDaysBetween` (never a floored millisecond
  difference - DST moves its day boundary off midnight). check.js 3b is a
  syntactic tripwire for the shipped UTC shapes (a literal, "+" chain or
  template with no "T" time or ending in "Z"/an offset,
  x.date/x.month/x.yearStart/x.effective, also via Date.parse); it cannot
  see a key held in a plain variable. Excel serials: epoch 1899-12-30 via local parts
  (compare.js excelDateToYM); `XLSX.read` runs with cellDates OFF so that
  helper is the only serial conversion path.
- New top-level store field: add it to defState, loadData AND Settings
  finishRestore (check.js asserts parity), give it repairData +
  validateData shape rules, and read it as `(data.x || [])` - last-good
  recovery can return a snapshot that predates the field.
- A repairData loss notice goes into lossMsgs (never a direct
  showDataAlert from a rule): it is shown once and also returned as
  fixed.loss, which recoverFromBad carries into its recovery banner
  (showDataAlert keeps ONE bar; check.js pins this).
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
  re-pricing payRatesDiffer/payShiftStale/payRepriceShift, the version-kind
  readers payEffKey/payRateIsTyped/payShiftIsTyped and the Day/Night
  helpers (cleanPayTyped/payRateTypes/payTypeByKey; the ONE call-in rule
  payCallInSummary with payHM/payFmtHM/payCiRowProblem; the labels
  payTypePreview/payVersionDateLabel/payDateLabel/payShiftCallInCount/
  payBucketInLine; payBuiltInFrom/payBuiltInVersion; the offer
  payTypedOffers/payTypedPlan/payApplyTyped; the writer payShiftsFromDraft
  with payDraftTypes/payDraftId2/payDraftUseSaved; the flags
  payShiftNeedsType/payNeedsTypeCount/payNeedsTypeDelta;
  payTypeDiffer/payRepriceSummary; the split paySplitNew/paySplitAdd/
  paySplitOut; the editor's payAmountText/payNewTypeKey/
  payTypedFormFromVersion/payNewTypedForm/payBlankTypedForm/
  payTypeFromForm/payTypedVersionFromForm), the shift
  editor's "Use current rates" payDraftUseCurrent (its stipend-length rule;
  a Day/Night call-in on a day the site counts as weekend - listed by
  payDraftWeekendPicks - becomes a weekend call-in only when the user
  confirms, so a deliberate pick is never dropped unasked; the question
  comes only when the answer changes the pay, payDraftReopenAsks, and its
  confirm() runs in the tap, never in the setD updater), and the built-in
  rates fill-in payBuiltInFor/payMissingBuiltIns/payRateZero/
  payBuiltInPlan/payApplyBuiltIn/payBuiltInOffers, and the call-case credit
  rule payCaseNoCredit/paySiteCreditNote with the site credit switch
  paySiteWithCredit/payCreditOffers/payApplyNoCredit/payCreditConfirm);
  callpay.js only holds state and passes "now" in. Built-in rates reach an
  existing site ONLY through two confirmed taps, each re-planned inside the
  updater: "Use built-in rates" (payBuiltInOffers/payApplyBuiltIn - the
  preset's first DATED version, payBuiltInVersion/payBuiltInFrom, never
  `rates[0]`) and "Use new Davenport rates" (payTypedOffers/payTypedPlan/
  payApplyTyped: adds the built-in's typed version and re-dates the site's
  start-date legacy version to null, the Original; it never re-prices -
  recorded shifts keep their pay and the later ones are flagged instead);
  repairData never adds rates, amounts the
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
- Day/Night rate versions (reader ASSET_V 37, feature 38): a site's `rates`
  list holds two kinds - LEGACY (the stipend / fee / hourly shape above) and
  TYPED (`shiftTypes`: each `{ key, label, hours, flat, stipend,
  stipendLabel, callIn: null | { hourly, thresholdMinutes } }`). A typed
  shift stores `{ rates: { id, effective, label?, shiftType: the ONE type it
  was priced with }, callIns: [whole minutes per trip] }` and never
  callHours/events; the `shiftType`/`callIns` keys are written only in
  utils.js (check.js gate). `effective: null` is the site's Original rates -
  at most one per site and dates unique (the editor refuses a second):
  cleanPayRate/cleanPayTyped accept it, rateInForce treats it as earlier
  than any date, and every compare of version starts goes through payEffKey
  (never `a.effective < b.effective`; check.js gate). Type keys are stable:
  renaming a type keeps its key, so re-pricing (payShiftStale/
  payRepriceShift with payTypeDiffer) finds the same key in the version in
  force; re-pricing stays within one kind - never legacy to typed or back.
  A legacy shift dated where a typed version is in force at its CURRENT
  site "needs a type" (payShiftNeedsType): it is never guessed and never
  summed - payTotalInRange/payMonthTotals count it only in needsType, every
  total (Home, Totals year and months, Settings' card) shows that count,
  and only the user resolves it in Call Pay's "Set Day or Night" form (one
  shift, or a Day + Night pair through payShiftsFromDraft). Every total
  shows the Day / Night / Other split (paySplitOut: buckets by type key,
  merged by label, Day, Night, others, Other; whole cents; payBucketInLine
  for the time-in line). Call-in math lives ONLY in utils.js
  (payCallInSummary: a night's trips are summed and tested against the
  threshold ONCE, every minute paid once met, the flat paid once; payHM
  reads the two numeric boxes) - callpay.js and dashboard.js never multiply
  or divide a rate (check.js gate). repairData: a bad typed version or typed
  shift is dropped whole with one banner naming it, numeric text is
  converted once, unknown fields are kept; the typed writer's output is a
  repairData fixed point (contract tests). callpay.js: versionSummary is the
  only caller of rateSummary (legacy branch); a null date reads "Original".
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
  warns first instead. Remove Duplicates (utils.js entryDuplicateScan)
  keys on the call fields - Call/Private, call site and credit
  (entryCallKey) - and reports same-case copies that differ only in
  them. Each "Logged, no credit"
  line opens History on its No credit chip with the same range (App's
  one-shot historyPreset; utils.js fiscalYearBoundsYMD/monthBoundsYMD);
  the chip shows only when something is flagged, and History's filtered
  bar (with Clear filters) shows for a date range or the No credit chip.
- Call cases and credit (7b): a case is no-credit only when it is Call,
  logged at a CURRENT site whose casesEarnRVU === false, and dated on/after
  CALL_NO_CREDIT_FROM ("2026-10-01", pinned by check.js to the no-credit
  built-in's first DATED rate, payBuiltInFrom). payCaseNoCredit is that rule. Credit is
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
- History's edit / add panel: Save, "+ Save + add another" and Add
  Procedure need a valid date (isYMD - a cleared date would save "" and drop
  the case out of every dated total; saveEdit / saveAdd return early too,
  saveEdit returns true only when it wrote, and addAnother opens add mode
  only after `if (!saveEdit()) return;`); Back / Cancel (onClick={cancelEdit})
  ask before discarding a change (editJSON, an
  ARRAY of the panel's values, against the snapshot the editId effect takes
  when the panel opens or switches to add mode); Delete and the saves close
  directly; the panel opens at the top and closing it returns the list to
  where it was (instant jumps). A tab switch with the panel open still
  discards it (no nav guard) (check.js 5f-7). Patient ID keeps Log's
  "<initials> - " notes prefix in step, live in the Notes box (utils.js
  notesHasInitials / notesForInitials), only when the panel opened on notes
  starting with exactly "<stored initials> - " (editNotesLinked, set in
  startEdit / startAdd, and by "+ Save + add another" from the row it just
  saved): new initials replace the prefix, cleared ones remove it, typing
  initials again puts it back. A hand edit of the Notes box
  (notesLinkAfterEdit) can keep or restore the link only on a panel that
  opened linked (editNotesLinkable): with initials, while the text starts
  with their prefix (a prefix broken and retyped re-links); with the
  initials empty, unless the text now starts with a "<x> - " prefix of its
  own (a hand-typed prefix is never doubled; a body edit keeps the link).
  Notes a panel opened without that prefix are never touched (Log's bare
  "AB" for a case saved with no notes, imported notes). Save writes the box
  as shown. Like the initials, this edits ONE row. Clearing removes the
  prefix, so Home and Trends then count the case by the first two
  characters of its notes, trimmed and case-insensitive (encounterKey's
  existing fallback): it splits from the old patient and can JOIN a
  same-day case whose initials match ("lap chole" -> LA), or count alone
  when the trimmed key is shorter than two ("L - inguinal hernia", "x")
  (check.js 5f-11 + notesForInitials value tests).
- Entries' snapshotted wRVUs are authoritative: analytics never re-look-up
  values from the CPT db, and an edit that doesn't change the CPT never
  re-derives base/description/category (history.js saveEdit).
- wRVU overrides (rvuOverrides, { code: number }): getDB applies one only
  when truthy - a stored 0 is inert (the code keeps its CMS value; check.js
  pins it, since honoring 0 would silently zero that code on any phone that
  holds one). The Settings editor badges and counts with the same test and
  commits a row only on blur/Enter when its text changed (Escape reverts)
  through rvuOverrideFromText: the CMS value removes the override; blank, 0
  or junk is refused and the field reverts. Overrides reach only cases
  logged, added, imported or re-coded later (entries keep their snapshot).
- Compare months (institutionData rows `{ month, workRVU, splitRVU, cases,
  totalOnly? }`): ONE row per month. compare.js writes a manual month only
  through utils.js instSaveMonth and deletes only through instDeleteRow,
  both by the row OBJECT - never a list index (a delete or import while the
  form is open would shift it onto another month). Replacing another row of
  the same month (an Add over a saved month, an edit moved onto one, or a
  duplicate an older build left) is confirmed in the tap via instSameMonth,
  never in the updater; a save whose edited row is gone asks first, and an
  Excel import closes an edit form whose row it replaced. A migrated month
  keeps totalOnly when its edit leaves the call split at 0. The Excel import
  keeps its own merge (Merge overwrites a month's FIRST row; Replace All
  starts empty). Readers of a duplicate an older build left: Home's
  Reconciliation / pace / Comp / vs. Prior Year / monthly chart and Trends'
  cross-check keep the LAST row; Settings' Acute reference reads the
  FIRST; Compare's list and totals, Home's Prior Year (Institution) card and
  Settings' Excel export add EVERY row - so it reads differently across them
  until it is saved again from Compare's form, one copy is deleted, or
  Replace All re-imports it (a Merge leaves the later copy) (check.js 5f-3 +
  value tests for Compare's writes; 5f-5 for Home's chart reading the last
  row).
- Home's goal tracks: Tracked OR (logged cases via creditedRVU; goal
  settings.annualGoal) and Reconciliation (Compare's institutionData months
  in the year window, incl. call + clinic; goal settings.reconGoal).
  utils.js compProjection is the ONE rule for both Home paces and the
  Compensation card: the card projects from the window's Compare months (the
  Reconciliation card's own months and pace) when there are any, else from
  the tracked pace. (Trends' Goal Pace reads only its trackedPace, never
  Compare - see the Trends Goal Pace bullet.) A Compare projection is compared with the Reconciliation
  goal when one is set, otherwise with the OR goal, named "OR goal" on the
  card (owner's choice, 2026-10-18); a tracked projection only ever with the
  OR goal. No rate, or no goal for that comparison, hides the card. Comp YTD
  (ytdWRVU / ytdComp) adds up the SAME source - the window's Compare months,
  else logged wRVU - card shown or not (an any-year `hasInst` switch once
  showed $0 for a year with no Compare months); past-year Avg/Enc is logged
  credited wRVU / credited encounters, never a Compare total. Home's
  monthly chart, vs. Prior Year and footer read Compare months, never
  "Compare data from any year": the chart styles itself on its OWN months
  (chartInst - on Current the last 6 calendar months, which can reach
  before Year Start) and, when one of them has a row, shows a month's
  Compare total where it has a row (0 included) and its logged figure
  (Tracked colour, narrow in-flow bar) where it does not - otherwise it is
  the plain tracked chart; vs. Prior Year (utils.js yoyTotals - Home only
  labels it) compares the window's Compare months that also have the month
  a year earlier, and when there are none (no Compare month in the window,
  or none with last year's month) the logged span instead (priorSpanYMD:
  the window cut at today while today is inside it, else whole years, vs
  the same span a year earlier; credited wRVU) - never both; one matched
  month (a stored 0 included) keeps it on Compare. Its label names the
  source ("Compare - same N months, prior year" / "Tracked OR - ..."); the
  card is wRVU only (no $, nothing to mask), shows only yoy's figures and
  hides when the prior side rounds to 0. The footer tags Compare when the
  window has a Compare month or the chart does (reconCount > 0 ||
  chartInst). check.js 5f-5 pins the reads, chartInst, the bar guards,
  yoySpan, the yoyTotals call and its yoy.source label, a read-only yoy, the
  $-free card and the footer; value tests pin yoyTotals. The any-year
  hasInst is left only for the Prior Year (Institution) card and the "Add
  Institution Data" card (which opens Compare when tapped). Today and This
  Week compare date keys (This Week = localYMD(Sunday)..localYMD(today),
  like the call-pay window), and the acute share line, like its siblings,
  says YTD only on Current (check.js 5f-6). The Compare
  months are the Reconciliation card's: one row per month (a duplicated
  month counts once, the last row) in a "YYYY-MM" window whose current start
  is curYS - the Year window bullet below (as ys / cpFrom / ncRange). A goal,
  rate or month count counts only as a finite number > 0; the wRVU totals
  pass through unchanged. dashboard.js only formats and masks the result and
  its vs line names the goal used; the pill's sign and colour both follow
  onPace. check.js pins the rule (compProjection tests) and the wiring (5f-2,
  AST: Comp YTD is exactly {fmtDollar(proj.ytdComp, showComp)}, shown
  unconditionally; Avg/Enc is the only `/ credEnc`, trackedRVU / credEnc;
  no fmtDollar argument in dashboard.js mentions settings.ratePerRVU, so a
  new rate-based $ on Home comes from a compProjection field or a check.js
  DERIVED variable, never an inline product). 5f-2 is also a $ tripwire on dashboard.js: proj is read only as
  proj.<field> (COMP_PROJ_FIELDS = the helper's output keys), and every proj
  comp/goalComp/diff/ytdComp read, settings.ratePerRVU read (other than a
  `> 0` test, the helper argument, or a factor of prevYearComp, whose reads
  count instead), currency toLocaleString or Intl, and "/wRVU" text must sit under
  fmtDollar(x, showComp), a showComp ternary's consequent or `showComp && x`;
  the count is pinned (COMP_MONEY_PIN). It is syntactic and cannot see a $
  figure built another way - route any new $ through fmtDollar.
- Year window ('Current'): Year Start (settings.yearStart) is a yearly
  ANNIVERSARY. Home, Trends, History's YTD chip and Settings' Monthly Acute
  Care get the current window only from utils.js
  currentYearStartYMD(settings.yearStart, todayLocal()): only Year Start's
  month and day matter, and the window starts on their latest occurrence on
  or before today. So 'Current' moves into the new year by itself and
  nothing stored changes; a future or long-past Year Start lands in the
  window holding today, a Feb 29 start is Mar 1 in EVERY year (windows and
  their month windows tile Mar..Feb), and a cleared or malformed one is Jan
  1. Only Settings' date input writes yearStart (plus defSettings' default);
  it shows the STORED date with a "Current year: ... to ..." line under it.
  Past-year chips stay calendar years; Compare's, Acute's and Call Pay's year
  chips are calendar years and never read Year Start. Settings' acute rows
  are acuteEntryMonths(curYS, today, acuteEarlier): the window's 12 months,
  plus the 3 months before it while today is in the window's first 3 months
  (a statement that arrives after the rollover), plus 12 more per "Show the
  12 months before ..." tap (Settings state, per visit - it resets when
  Settings is left; the only way to reach an older month, since changing
  Year Start's year no longer moves the list - only its month and day
  matter). A stored
  Year Start whose window does not hold today (more than a year old, or in
  the future) moves 'Current' as soon as this ships. check.js 5f-10: every
  Babel-file yearStart read is the helper's first argument (with
  todayLocal()), a hook deps entry, or that date input's value (which stores
  e.target.value); nothing else writes it and utils.js never reads it;
  Home / Trends / History / Settings use the exact shapes above. Value tests
  cover the helper (Feb 29, a future start, the anniversary, bad input, a
  day-by-day sweep that each change is the anniversary, one year on) and
  acuteEntryMonths.
- Show/hide $: App's showComp is memory only (every launch starts hidden)
  and reaches each view that masks $ along with toggleComp. Masked $ goes
  through utils.js fmtDollar(v, showComp) (always passed showComp), a
  showComp ternary (Dashboard vs-goal and $/wRVU lines, Compare's rate
  line), Call Pay's paid()/MASK/maskText() (with $ hidden Call Pay masks
  every rate amount shown without being opened: the shift form's site
  buttons and fee chips, pay lines and rows, the offer cards, the version
  list, and the "Use built-in rates" confirm leaves amounts out; only an
  opened rate edit form shows amounts) or utils.js dirMoneyShown(v, showComp)
  (Directorships and Home's Directorships line; cents, no locale), and
  each such view renders CompEye (app.js, hook-free) near its $ -
  Directorships' Review reuses its view's one eye. CompEye is shared
  across Babel files; Settings also renders DirectorshipsCard from
  directorships.js (typeof-guarded, in its own ErrorBoundary). Log and
  History print $ unmasked (owner decision). Exports, CSV, Excel, the Copy
  Summary text and the directorship PDF stay unmasked (the PDF ALWAYS
  prints the real Rate and Due). check.js 5f pins the fmtDollar /
  dirMoneyShown argument, CompEye on every masking view, ONE CompEye
  declaration and the App props.
- Log's one Save control is the 64px save bar (log.js; check.js counts
  onClick={save}), pinned once the active procedure has a code. While
  pinned, LogProc reports it (setLogBar) and App lifts the undo toast to
  bottom 148 so Undo never covers Save; otherwise the toast stays at 64.
  After the post-save reset, the next case's first code dismisses that
  save's pending Undo (same Log visit; Call Pay precedent). Change the bar height, nav height or toast offset together;
  never hide the bar on input focus. The toast's Undo and aria-labelled
  Dismiss are 44px targets; it grows upward from its fixed bottom offset,
  and an always-mounted, visually hidden role="status" region in App
  announces each message: its text is a child keyed by undoSeq, which
  showUndo bumps, so a repeat of the same text is announced again. The
  post-save reset also closes the Save-as-template form, and the
  Encounter Summary card uses --card-main-from / --card-main-to, never a
  hard-coded gradient (check.js 5f-8).
- Trends' Goal Pace card (Current only, like Home's pace line) uses Home's
  Tracked OR pace: Projected Annual = compProjection({ trackedWRVU: ytdRVU,
  trackedDays: daysPassed }).trackedPace with Home's inputs (logged credited
  wRVU in the Current window; daysPassed = Home's dp), and onPace =
  projectedAnnual >= goal drives Ahead/Behind, its sign and colour, the bar
  and the Projected colour. Expected = goal x trackedPaceMonths(daysPassed)
  / 12; utils.js trackedPaceMonths is the ONE 30.44-day-month, at-least-one
  rule compProjection also divides by, so (both windows coming from
  currentYearStartYMD) Trends' figure and verdict always match Home's
  Tracked OR pace line, and the first
  month expects a full month's share. Home's Compensation card can still
  differ when the window has Compare months (it projects from Compare - owner
  decision). Needed/Month, Months Left, Avg/Week and the Monthly Report's
  Monthly Goal Pace are not projections and keep their own math (so in the
  first month Needed/Month can read green beside "Behind pace"). The 'Logged
  Comp' tile is selComp = selTotal * rate, the selected year's logged
  credited wRVU, never Compare months, so it can differ from Home's Comp YTD
  (check.js 5f-9 pins the inputs, the five onPace ternaries and Expected;
  trackedPaceMonths value tests).
- Trends' Monthly Report sits on a theme card, so its text uses theme
  tokens: title --text-bright; Private / Call lines and top-encounter wRVU
  --text-primary; Top Encounters heading and descriptions --text-muted
  (the dark stat tiles stay dark in both themes). Its month input ignores
  a cleared value and keeps the previous month (check.js 5f-8).
- Unsaved forms survive a tab switch through App's MEMORY-ONLY refs (never
  persisted): Log's encounter (logDraft) and Call Pay's shift form
  (callPayDraft, passed as `keep`). CallPay reads keep.current ONCE in a
  useState initialiser that clears it and returns utils.js payParkedDraft
  (the same site-list object - ANY paySites write drops the form, fail-safe:
  a rates or site edit, Log's or History's built-in credit-rule confirm, a
  restore - and for an edit a shift still saved exactly as parked), so a
  form that crashes is restored at most once; ONE effect parks it again
  only after a committed render and only while utils.js payDraftDirty says
  it changed (the same rule as Cancel's prompt: "+ Call-in"'s blank row,
  untouched or added then removed, is not a change); Save, Delete and
  Cancel null the draft, which clears it; the Call Pay error boundary's Go
  Home (its onRetry) clears it too - its Retry remounts and restores the
  last committed form once. With a form parked, every way into Call Pay
  opens the form, and Settings' rates focus waits for the list (check.js
  5f-4).
- PIN pad DOM is appendChild-only (never `innerHTML +=`); clipboard writes
  need a catch fallback; no `viewport-fit=cover`; chunked u8toB64 in
  crypto paths.
- `crypto.js` DATA_KEY must equal `utils.js` SK (check.js asserts).
- Backups: the file text IS the clipboard code (one builder, settings.js
  buildBackupCode). "Restore from File..." and a pasted code share
  restoreFromText -> finishRestore (a bad PIN asks once for the backup's
  PIN; a payload that cannot be decoded - crypto.js "Invalid encrypted
  data", bad base64 - never does. A corrupted ciphertext looks exactly
  like a wrong PIN, so it prompts and the retry's alert says the backup
  may be damaged). The "Last backup" date and Home's
  14-day nudge (7-day snooze) live in ONE localStorage key,
  BACKUP_STAMP_KEY ("rvu-last-backup"): per device, OUTSIDE the data store
  (never a defState/loadData/finishRestore field, never in a backup), and
  only the utils.js helpers readBackupStamp/markBackupSaved/
  snoozeBackupNudge/backupNudgeDue touch it. Never name it
  rvu-backup/rvu-backup-time (deleted on every load). navigator.share runs
  directly from its own tap (iOS gesture rule; one sheet at a time), never
  after the async encrypt - in settings.js and in directorships.js alike.
  check.js pins all of this.
- Directorships (directorships.js holds only state and rendering; every
  rule is in utils.js - the `// --- Directorships ---` block):
  - Store fields `directorships`, `dirEntries`, `dirHandoff`,
    `dirSignatureEnc`. `directorships` passes RAW through loadData and
    finishRestore: MISSING = seed DIRECTORSHIP_PRESET silently (fresh
    install, pre-feature store, pre-change backup); `[]` = the user removed
    them, never re-seeded. Babel files read the fields only through
    dirList / dirEntriesOf / dirHandoffOf / dirHasSignature and the
    signature only through dirSignatureLoad(data); the sole member reads
    are finishRestore's rebuild and the JSON export's `delete
    clean.dirSignatureEnc` (check.js G2-G4, G7).
  - NO ROLLBACK: never remove the loadData/finishRestore lines or the
    repair block, and never back the feature out by reverting its commit -
    an older build drops all four fields on its first save (logged hours
    and the signature gone). Back out by shipping a build that keeps the
    fields and hides the UI.
  - One implementation: the row keys (STORED data, pinned by check.js
    G8 - never rename one), weeks, slots, money (dirMoney, no locale), the
    file-name contract ("<Surname> - <name> Timesheet - YYYY-MM.pdf",
    exact or no file - the monthly email task outside the app finds files
    by that name; never "clean" a name, refuse it), and dirFormModel - the
    ONE source for the Review screen and the PDF, so what is reviewed is
    what prints.
  - Writers: every write of the four fields goes through a utils.js writer
    whose output passes repairData unchanged (check.js T7):
    defaultDirectorships, dirNew, dirFromEditorDraft, dirEntryFromDraft,
    dirHandoffMark/dirHandoffClear, dirSignatureSave/dirSignatureRemove,
    dirRestoreBuiltIns, dirRestoreBuiltIn, dirDropOrphans, dirRemove, and
    app.js's undo paths ("dir": payUndoApply on dirEntriesOf(prev);
    "dirRemove": dirRemoveUndo). A new writer joins this list and T7.
  - Signature: stored ENCRYPTED with the session PIN (RVU_CRYPTO, the API
    key's mechanism). Say only what that does: it keeps the signature from
    being readable as plain data (someone browsing the app's storage, any
    future plaintext export - the JSON export also strips it). It does NOT
    stop code running on fkhan628.github.io, which can read the unsalted
    4-6 digit PIN hash and guess the PIN almost instantly; the real fix is
    moving the app to its own web address (a separate owner decision).
    Decrypted only at render time; the plaintext lives only in the asking
    component's state, bound to the PIN that decrypted it
    (dirSigStillValid) - never stored, logged or kept in a module variable.
  - PIN flows: there is NO PIN-change flow. One must re-encrypt
    settings.encryptedApiKey AND dirSignatureEnc in the same write
    (check.js G5 trips on any new aesEncrypt call site or PIN screen mode).
    Forgot-PIN leaves dirSignatureEnc unreadable by design; Re-sign
    replaces it.
  - Sharing: navigator.share in directorships.js is FILES ONLY (no title,
    text or url - some share targets save text as a second file in Drive),
    exactly once, inside sharePdf (check.js G9). A resolved share records
    dirHandoff {date, entriesHash} captured when the PDF was built; an
    AbortError records nothing; no file sharing -> download under the exact
    contract name and the user taps Mark handed off.
  - jsPDF is loaded only by loadPDF; directorships.js uses only the plain
    drawing surface (no .html/addJS/AcroForm/annotations; output("blob")
    only). A form never truncates: text shrinks to a 6.5 pt floor, and what
    still does not fit blocks Create with a layout flag.
  - Home's month-end reminder dismissal lives in ONE per-device key,
    DIR_REMIND_KEY ("rvu-dir-reminder"), OUTSIDE the store; only the
    utils.js helpers touch it (check.js G12, the BACKUP_STAMP_KEY rule).
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
