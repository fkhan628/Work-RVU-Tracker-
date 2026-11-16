# CLAUDE.md — RVU Tracker

Mobile-first PWA for surgeons tracking wRVUs, CPT codes, and
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
   reset on failure, 15 s per host because a blackholed CDN never fires
   onerror). loadPDF tries unpkg, then the same path and hash on
   jsdelivr; its provenance comment records the cross-mirror hash check -
   bump PDF_PATH and PDF_SRI together (check.js G11). loadXLSX has one
   host, cdn.sheetjs.com (0.20.x is not on npm, so there is no same-path
   mirror); check.js X1/X2 pin its shape and timeout.

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
presence (its floor, and the three stamped script URL lines as texts),
store-field parity (defState = loadData = finishRestore),
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
- History's keep rule (ASSET_V 66: utils.js entryEditFields, called by
  history.js saveEdit) is never reverted and never removed: a build without
  it recalculates a stored case's adjusted wRVU from the CURRENT modifier
  table on every History save, a note edit included, so any later change to
  MODIFIERS would silently re-price old cases. Anything that changes what
  calcAdj returns for an existing modifier list - MODIFIERS (a factor, a
  code added or removed), MOD_MAP, or calcAdj itself - is therefore its OWN,
  LATER deploy: never in the same push as the keep rule, and only once
  ASSET_V 66 or later has been confirmed live for at least an hour. GitHub
  Pages caches each file for about ten minutes, and inside that window a
  phone can load a cached history.js 65 beside the new utils.js - which
  would price a note edit with the new table. check.js pins all three
  (MODIFIERS pin) so the session that edits one is stopped and sent here
  first. Back out a later modifier-table change by shipping a forward build
  that keeps this rule - never by reverting to a build older than 66.
- Commit and push from `RVU App Split/` (the repo root). Never commit
  billing data (`RVU Wallet Data/`), CMS source files (the `CMS 2026/`, `CMS 2025/` and `CMS NCCI/` folders
  beside the repo), or
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
  2027 re-price test), and Call Pay's load label "Load Davenport / Silvis
  general surgery rates". Any other site or rate stays runtime user data;
  made-up test rates stay literal. Public does not mean default: it is
  opt-in on a fresh install ("More than one user" below).
- A second exception, chosen by the owner on 2026-10-15, is limited to
  the built-in DIRECTORSHIP_PRESET in utils.js and check.js's copy and
  worked-example tests of it. It allows exactly: the owner's own name,
  the organization names, the clinic remit address, the GL number, the
  hourly rates and monthly hour caps, and the Settings load label "Load
  built-in directorships (Faraz Khan)". It is opt-in on a fresh install
  too ("More than one user" below). Everything else stays forbidden
  as before: no colleagues' names, no email addresses, no partner names,
  no PHI. No tracked file may contain an email address at all (check.js
  G6; its self-test builds its sample at runtime).

## Hard constraints (enforced by check.js where possible)

- More than one user: the app can have users other than Faraz, so anything
  specific to Faraz or his group (presets, rates, names, institutions) must
  be opt-in on a fresh install and is never seeded automatically. Being
  public does not make something a default. defState holds none of it: empty
  lists, rate and goal 0 (the zeros live in defState; defSettings keeps 55 /
  6000 because it also fills a key an old store lacks). repairData and
  loadData never add a site, a rate version or a directorship. It reaches a
  store only through a named one-tap load (payLoadBuiltIns, Call Pay, at zero
  sites; dirRestoreBuiltIns, the Settings card, on an empty list) or a tap
  beside what was already loaded ("Add built-in site", "Restore <name>").
  There is no "new phone" flag: each surface keys off what the store holds,
  so a store that already holds data stays byte-identical on load, with no
  banner or prompt. Group features with nothing in them stay hidden
  (acuteInUse: Settings' acute cards and Trends' acute cards, with one "Track
  a group acute-care pool" button showing Settings' cards for that visit;
  reconInUse: Home's Reconciliation card and Settings' goal box, which stays
  for the visit once shown so retyping a goal never removes it). A site typed
  in the app has an id starting "own-" and never matches a built-in by name
  (payBuiltInFor), so another user's own "Davenport" gets no card or hint;
  older ids still match, because the owner's hand-made sites rely on it. Call
  cases earn wRVU credit by default: both built-in sites load with
  casesEarnRVU true (owner's choice, 2026-11-06) and "No wRVU credit" is each
  user's own switch per site; a site already stored keeps its flag.
  check.js U0-U13c pin this.
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
  A hook inside any function nested in a component's JSX (an IIFE such as
  Log's lead-code card or "Also add?" block, a map callback, a tap handler)
  is a conditional hook too (check.js Log hooks checks every function in
  LogProc's JSX; Log card C2 and Log hernia picker P2 their guards).
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
  payTypePreview/payVersionDateLabel/payDateLabel/payShiftCallInCount/payShiftCallInWords/
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
  callpay.js only holds state and passes "now" in. The built-in sites reach a
  store ONLY through a tap in Call Pay: the one-tap load at zero sites
  (payLoadBuiltIns, a no-op once any site exists) or the confirmed "Add
  built-in site" (payMissingBuiltIns, offered only beside a site that stands
  for a built-in). Built-in rates reach an
  existing site ONLY through two confirmed taps, each re-planned inside the
  updater: "Use built-in rates" (payBuiltInOffers/payApplyBuiltIn - the
  preset's first DATED version, payBuiltInVersion/payBuiltInFrom, never
  `rates[0]`) and "Use new Davenport rates" (payTypedOffers/payTypedPlan/
  payApplyTyped: adds the built-in's typed version and re-dates the site's
  start-date legacy version to null, the Original; it never re-prices -
  recorded shifts keep their pay and the later ones are flagged instead);
  repairData never adds sites or rates, amounts the
  user typed are never changed, and casesEarnRVU is never touched by it.
  casesEarnRVU (false = call cases logged at the site from
  CALL_NO_CREDIT_FROM earn no wRVU credit) changes ONLY through
  paySiteWithCredit on the user's confirmed tap: the site's "Call cases
  logged here" control, or the "Built-in credit rule" offer
  (payCreditOffers: one same name or one alias of the built-in that holds
  the owner's no-credit rule, PAY_CREDIT_RULE_ID, on a site older than the
  "own-" ids; never by built-in id or an ambiguous match; payApplyNoCredit re-plans
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
  rankCPTMatches only reorders them (exact, prefix, usage, favorites, the
  short-word step, CPT order). The short-word step (ASSET_V 69) looks only
  at typed words of 3 characters or fewer that are not all digits (so
  typing a code keeps the order of the earlier steps), in the text
  matchesCPTQuery reads:
  a whole word first, then a word start, then only inside a word ("hra" in
  "urethra"; letters and digits are word characters, so "a1" only starts a
  word in "a13"); each word counts at its best place, the worst such word
  decides, and a longer word never reorders anything. Log and History both
  use it; check.js pins it (the order on made-up rows, 6b-order; the owner's
  search terms on the real data as a fresh install, 6b-terms).
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
  pins the remaining raw reads (utils.js 3: the third is caseSavedMates'
  stored figure, which Log's lead-code card shows beside a saved case) -
  bump it only for a new sort/display.
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
  warns instead (first, or second when the wRVU note below is there). Remove Duplicates (utils.js entryDuplicateScan)
  keys on the call fields - Call/Private, call site and credit
  (entryCallKey) - and reports same-case copies that differ only in
  them. Each "Logged, no credit"
  line opens History on its No credit chip with the same range (App's
  one-shot historyPreset; utils.js fiscalYearBoundsYMD/monthBoundsYMD);
  the chip shows only when something is flagged, and History's filtered
  bar (with Clear filters) shows for a date range or the No credit chip.
- Call cases and credit (7b): a case is no-credit only when it is Call,
  logged at a CURRENT site whose casesEarnRVU === false, and dated on/after
  CALL_NO_CREDIT_FROM ("2026-10-01", pinned by check.js to the first DATED rate
  of the PAY_CREDIT_RULE_ID built-in, payBuiltInFrom). payCaseNoCredit is that rule. Credit is
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
  discards it (no nav guard) (check.js 5f-7). What Save writes for the
  case's modifiers and adjusted wRVU is the snapshot rule below (utils.js
  entryEditFields; saveEdit also returns false when it gives null). Patient
  ID keeps Log's
  "<initials> - " notes prefix in step, live in the Notes box (utils.js
  notesHasInitials / notesForInitials), only when the panel opened on notes
  starting with exactly "<stored initials> - " OR equal to them (Log's bare
  "AB" for a case saved with initials and no notes) (editNotesLinked, set in
  startEdit / startAdd, and by "+ Save + add another" from the row it just
  saved). While linked the box is rebuilt the way Log writes it - initials,
  then " - " and the note only when there is one: new initials replace the
  prefix ("AB" -> "CD"), cleared ones remove it ("AB" -> ""), typing
  initials again puts it back, and a stored "AB - " with nothing after it
  becomes "AB" once the initials are touched. A hand edit of the Notes box
  (notesLinkAfterEdit) can keep or restore the link only on a panel that
  opened linked (editNotesLinkable): with initials, while the text starts
  with their prefix or equals them (a prefix broken and retyped re-links; a
  note trimmed back to the bare initials stays linked); with the
  initials empty, unless the text now starts with a "<x> - " prefix of its
  own (a hand-typed prefix is never doubled; a body edit keeps the link).
  Notes a panel opened without that prefix or bare form are never touched
  (imported notes, notes in neither form for the stored initials). Save
  writes the box as shown. Like the initials, this edits ONE row. Clearing
  removes the prefix, so Home and Trends then count the case by the first
  two characters of its notes, trimmed and case-insensitive (encounterKey's
  existing fallback): it splits from the old patient and can JOIN a
  same-day case whose initials match ("lap chole" -> LA), or count alone
  when the trimmed key is shorter than two ("L - inguinal hernia", "x", or
  a cleared bare case's empty notes) (check.js 5f-11 + notesForInitials
  value tests).
- Entries' snapshotted wRVUs are authoritative: analytics never re-look-up
  values from the CPT db, and an edit that doesn't change the CPT never
  re-derives base/description/category. What History's Save writes over a
  stored case has ONE rule, utils.js entryEditFields (ASSET_V 66): an edit
  that changes neither the code nor the SET of modifiers (entryEditKeeps /
  entryModsSame - order and repeats ignored, a value that is not a list
  counts as none) writes NEITHER `modifiers` NOR `adjustedRVU`, so both stay
  byte for byte as stored, whatever MODIFIERS says today (a factor changed
  since, a modifier the table dropped, a dashless one it never held). Only a
  changed code or modifier set is recalculated, from the resolved base with
  the current table (the stored base for the same code, the database row for
  a changed known code, the typed wRVU for a changed unknown code - null, and
  no save, when that is not a number). The panel follows the same test: its
  Adjusted and Compensation tiles show the STORED value while the rule keeps
  it, and a recalculation that moves the figure prints "Saved <stored> wRVU,
  after save <new>" under the tiles before Save (not while Save is disabled
  for a changed code with no usable typed wRVU). The preview's base
  (history.js editBase) is a second copy of the rule's base and must mirror
  it. saveEdit passes the stored case as found, never calls calcAdj, never
  writes an adjustedRVU or modifiers key itself and stores entryWithCall's
  result as it is; + Add (saveAdd) and Log price a NEW case with the current
  table (5f-18 pins both: in Log's save the figure is calcAdj(info.wRVU,
  p.mods), stored as it is). The panel's modifier state IS the stored list
  (startEdit), codes the table does not hold included: such a code has no
  chip, stays on the case and keeps its stored figure until the user changes
  the set - never filter, de-duplicate or normalise that seed or the stored
  case before the rule (a note edit would then re-price the case). Nothing
  else prices a STORED case: loading, saving, restore, Undo, the encounter
  plan and the call-site fix-up copy a case's modifiers and adjusted wRVU as
  they are.
  check.js: 5f-18 pins the shapes of all of this and counts, per file, every
  calcAdj call, every mention of its name and every `.factor` read (a new
  one must price NEW cases only, or only show a figure and write nothing, as
  proposeCaseModifiers does; the count is syntactic) and, since ASSET_V 67,
  every object-literal adjustedRVU key, every mention of the name factor, of
  MOD_MAP and of proposeCaseModifiers, and no string or template that holds
  calcAdj or proposeCaseModifiers as part of its text (a name put together
  from pieces is not seen); 5f-19 runs History's real startEdit / toggle /
  saveEdit / saveAdd text on made-up cases and compares the store; a
  stale-priced store goes through loadData and saveData byte for byte; the
  entryEditFields contract tests pin the rule's values. Any change to what calcAdj returns for an existing list
  ships ON TOP of this rule, as its own later deploy (Deploy rules; check.js
  MODIFIERS pin).
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
  starts empty). Its preview panel opens on xlPanel (a preview, or a loaded
  workbook of two or more sheets), so a sheet with no rows keeps the sheet
  chooser and says so, and the open panel reads xlPreview only under an
  xlPreview guard; a FileReader error shows the banner and frees Upload,
  whose busy state lasts until the file is read (check.js 5f-3b).
  Readers of a duplicate an older build left: Home's
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
  While the lead-code card suggests a change that was not kept (in Log, or
  to a saved case in History), the bar's small first line ends in an amber
  "sequencing suggested"; nothing else in the bar changes and Save is never
  blocked.
  After the post-save reset, the next case's first code dismisses that
  save's pending Undo (same Log visit; Call Pay precedent). Change the bar height, nav height or toast offset together;
  never hide the bar on input focus. The toast's Undo and aria-labelled
  Dismiss are 44px targets; it grows upward from its fixed bottom offset,
  and an always-mounted, visually hidden role="status" region in App
  announces each message: its text is a child keyed by undoSeq, which
  showUndo bumps, so a repeat of the same text is announced again. The
  post-save reset also closes the Save-as-template form, and the
  Encounter Summary card uses --card-main-from / --card-main-to, never a
  hard-coded gradient (check.js 5f-8). The category / Favorites chip row
  renders only while the ACTIVE procedure has no picked code
  (`{!curSel && <div style={S.catRow}>}`, the same !curSel both result
  lists lead with, so a category filter is never hidden while a list shows;
  with a code picked the selected card sits right under the search box - or
  under the hernia picker's line or card when the code is one of the twelve
  ventral hernia repairs; with no code picked that line or card sits between
  the search box and the chip row).
  '+ Add' and the card's x bring it back on Favorites (showFavList resets
  the category to All); typing in the search box, or a Proc tab / proc
  removal that leaves a code-less procedure active, brings it back with the
  chosen category still highlighted (the row remounts, so a chip far to the
  right may be scrolled out of view). The search box always stays (check.js
  5f-12: one row, its chips inside it, curSel never reassigned).
- Tap targets (Log / History): nothing clickable is a `<span>` and no button
  sits inside a button. Small glyph controls (favourite stars, the card's
  remove x, the Proc-tab remove x, Favorites' move arrows, the template
  notice x, "? Guide") are labelled buttons on styles.js S.hitBtn (44x44,
  zIndex 1 so the overhang wins over the next non-clickable element; pulled
  back with a negative margin - only as far as it covers nothing clickable:
  "? Guide" overhangs 6px each way and grows its row by 12px rather than
  steal the first modifier's top). In the result rows and Proc tabs they are
  SIBLING buttons laid over the row: an 18px spacer keeps the row's layout;
  Favorites rows with arrows are at least 88px with the row gap on the
  wrapper (a child margin would collapse through it and lift the arrows), so
  star and arrow areas never overlap; a Proc tab with a remove x has 44px of
  right padding and the x covers only that, never the label that selects
  the tab (the tab row's rowGap 8 keeps the x's 6px overhang off a wrapped
  row). Every S.hitBtn button has an aria-label; a star's label is fixed
  ("Favorite <code>") and aria-pressed carries the state. Check overlaps
  with elementFromPoint after any change here. Today / Yesterday,
  Private / Call (Log and History's edit panel), History's Back buttons and
  the row Delete are 44px tall (Delete grows up over the $ line - the row
  clips below). The chip rows (S.catBtn, History filters) stay 27-32px by
  the owner's choice (check.js 5f-17). The hernia picker's buttons are at
  least 44px and its two big buttons 64px; its Close is a text button, not
  S.hitBtn (the S.hitBtn count in log.js stays 10).
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
  --text-primary; Top Encounters heading and descriptions --text-muted;
  its stat tiles are --bg-inset theme tiles. Its month input ignores
  a cleared value and keeps the previous month (check.js 5f-8).
- Theme colours (styles.js): every token has a value in BOTH the :root
  (dark) and body.light-mode blocks. Text on a theme surface uses a token -
  the --text-* greys or an --accent-* hue (sky, green, amber, violet, red,
  plus their soft / pale / deep variants, --accent-star and the Case Mix
  pink / cyan / orange) - never a raw hex: each accent's DARK value is the
  literal it replaced (dark mode unchanged) and its LIGHT value is a darker
  shade of the same hue, at least 4.5:1 on white and the page #f1f5f9 (most
  also on their pale tints; star, cyan and orange drop below 4.5:1 on a 0.1
  tint of their own hue, so keep them off tints). Light red (#9f1239) and
  amber (#8a5a00, also --global-90's light value, so every warning line is
  one amber) are chosen to stay apart, also for colour-blind eyes: a
  Call Pay blocking line (red) and warning (amber) sit side by side (they
  also carry Directorships' "x " / "! " prefixes - callpay.js probLine, the
  one renderer, check.js 5f-14), and amber must stay apart from green (the
  pace verdicts) - re-check both pairs before moving either. Literals stay
  for fills under white text (every such fill colour, both gradient stops,
  is at least 4.5:1 with white in both themes: blue #0369a1, gradients
  #0369a1 to #075985, never #0ea5e9 at 2.77:1 or var(--accent-sky), which is
  #0ea5e9 in dark; green #047857 to #065f46 for Logged and Compare import /
  merge; violet #7c3aed to #6d28d9 for Log Call, Copy Summary and Compare
  save / replace; red #dc2626 for History's swipe Delete; check.js 5f-16),
  chart marks, most borders (the Log Private / Call radio rings and the
  directorship status pill follow their token text colour), rgba tints, the
  data-URI select chevrons, and everything exported (directorship PDF,
  Excel, CSV). Trends has no hard-coded dark surface: Goal Pace and Case Mix
  use --card-main-from/to and --border-default, bar tracks --bg-track-deep,
  the monthly-goal marker --mark-goal; Home's goal tracks are --bg-track and
  its resting month bars --bar-rest-from/to; the grey "no credit" /
  "imported" tags --tag-bg. check.js 5f-13 pins the dark values (new tokens
  and the existing surface / text tokens they map to), light AA for every
  --text-* / --accent-* / --global-* / --selected-code token (--text-ghost,
  the empty favourite star, is faint in both themes by design), var(--x)
  defined in both blocks, no accent or caption-grey hex as a style color or
  SVG <text fill>, and no slate dark-surface literal as a style background
  (the hidden scan buttons aside) - syntactic: a hex held in a variable is
  not seen. The phone status bar (meta theme-color) matches what is on
  screen: crypto.js syncThemeColor, its one writer, sets #0f172a while the
  always-dark PIN screen shows, else the theme's page background (#f1f5f9
  in light); showPinScreen, unlock and app.js's theme effect call it. Its
  colours equal index.html's body / body.light-mode / #pin-lock backgrounds
  and the static meta (check.js 5f-15). manifest.json's theme_color stays
  dark (launch only).
- Unsaved forms survive a tab switch through App's MEMORY-ONLY refs (never
  persisted): Log's encounter (logDraft, which also parks the lead-code
  card's Keep as is, seqKept: it never keeps a draft on its own and the
  post-save reset clears it; the hernia picker's open card is never parked,
  check.js Log hernia picker P4) and Call Pay's shift form
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
  crypto paths. The React app loads the data even behind the lock screen,
  so a lock-screen write to the store is overwritten by the app's next
  save unless the page reloads. "Reset PIN & start over" ends in
  `location.reload()` (the fresh load opens Create PIN), never an in-place
  setup screen - otherwise the stripped API key comes back and Settings
  keeps the old hint (check.js G5b). Unsaved memory-only drafts (logDraft,
  callPayDraft) are lost on a reset. Known gap: Create PIN's migrateApiKey
  (a legacy plaintext settings.apiKey) still writes in place and unlocks, so
  the next save can restore the plaintext key; only pre-encryption data
  reaches it.
- Settings' Recovery Hint: hintText mirrors the STORED "rvu-pin-hint" (what
  the lock screen's Forgot PIN shows). The editor types into hintDraft,
  seeded from hintText on every open, so Cancel just closes; only Save (after
  its storage write, the trimmed value) and Remove set hintText (check.js
  pins it).
- AI note scanning (log.js scanNote / scanClinicNote / scanInpatient) stays
  OFF: utils.js `var SCAN_ENABLED = false;` is written nowhere else (check.js
  scanners S1). Turning it on is the owner's decision: Anthropic's
  documentation says PHI needs a signed BAA and a HIPAA-enabled
  organisation, and its documented path for a web page is a back end. Each
  scanner's first statement is `if (!SCAN_ENABLED) return;`, before the key
  is decrypted, and the app's one fetch is log.js fetchWithTimeout's, called
  only by sendScan, the ONE request, which only the three scanners call (S2).
  The model is the ONE constant utils.js SCAN_MODEL ("claude-sonnet-5-5", a
  pinned snapshot): change it, and its pin, when Anthropic's deprecations
  page names a replacement; no other model id may sit in a js file (S3).
  sendScan sends max_tokens 16 * 1000 (thinking is on by default and counts
  against it), output_config effort "medium", anthropic-version 2023-06-01
  and one user turn - no thinking, sampling or prefill field, no beta header
  and no fallback (beta features are generally outside a BAA) (S4). A reply
  is read only through utils.js scanReplyText: only stop_reason end_turn is
  used, and a refusal, a cut-off answer or any other stop fills nothing
  (S5); HTTP errors are worded by scanHttpErrorText, which never shows a key
  (S6). A scanned modifier reaches a row only through scanModifiersFrom with
  that scanner's list (SCAN_MODS_OPNOTE -50, -78, -79; clinic and inpatient
  none; never -51, which Log's card proposes; -80 / -82 / -62 are left to
  the user): the dash added, kept only when MODIFIERS holds it (S7). What it
  drops rides on the row as scanDropped (memory only; save() never copies
  it) and Log names it in one amber line. Each prompt's privacy paragraph and
  initials line, sanitizeInitials and the metadata-only parse-failure log are
  pinned word for word, and the op-note prompt asks only for documented
  modifiers, never 51 (S8); check.js runs handleScanResponse itself on
  made-up replies (S9). No real scan has been run on this model.
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
- Downloads: every file download (History Export CSV, Settings Export
  CSV/JSON, the backup file, the directorships PDF, a Plain directorship's
  own form) goes through utils.js
  downloadBlob(blob, name) under its exact file name and MIME type: the
  anchor is attached for the click and the object URL is revoked on a
  60 s timer, never in the same tick (WebKit - iOS Safari and the
  home-screen app - can cancel or blank such a download). No other file
  calls createObjectURL/revokeObjectURL or sets .download, and
  downloadBlob never shares. Export Excel stays on SheetJS XLSX.writeFile
  (it revokes on its own 60 s timer). check.js pins it.
- Directorships (directorships.js holds only state and rendering; every
  rule is in utils.js - the `// --- Directorships ---` block):
  - Store fields `directorships`, `dirEntries`, `dirHandoff`,
    `dirSignatureEnc`. `directorships` passes RAW through loadData and
    finishRestore to repairData: MISSING (a backup older than the feature)
    becomes `[]` silently, a malformed value `[]` with a banner; neither is
    ever seeded. An empty list's Settings card shows a neutral line, the button
    "Load built-in directorships (Faraz Khan)" (dirRestoreBuiltIns) and "+ Add
    directorship" for a user's own post (the form-type chips then read Genesis /
    Select / Plain: owner's choice, 2026-11-06),
    with no count, Open or signature pad (a saved signature still shows). The
    pre-filled Print Name comes from the list's first entry, so it starts blank
    on an empty list. "Restore <name>" links (dirMissingBuiltIns) show
    only beside a preset in the list, or for a preset whose hours or hand-offs
    are still stored, so Remove's "come back if you restore it" stays true.
    Babel files read the fields only through
    dirList / dirEntriesOf / dirHandoffOf / dirHasSignature and the
    signature only through dirSignatureLoad(data); the sole member reads
    are finishRestore's rebuild and the JSON export's `delete
    clean.dirSignatureEnc` (check.js G2-G4, G7).
  - NO ROLLBACK: never remove the loadData/finishRestore lines or the
    repair block, and never back the feature out by reverting its commit -
    an older build drops all four fields on its first save (logged hours
    and the signature gone). Back out by shipping a build that keeps the
    fields and hides the UI. A build older than ASSET_V 63 seeds a MISSING
    field but never `[]`, and seeds sites unless paySitesSeeded is set, so
    defState saves `[]` and keeps that marker, and repairData still writes it.
    A build older than ASSET_V 65 does not know form "plain": its repairData
    drops those directorships on load, so back Plain out by hiding its chip,
    never by reverting.
  - One implementation: the row keys (STORED data, pinned by check.js
    G8 - never rename one), weeks, slots, money (dirMoney, no locale), the
    file-name contract ("<Surname> - <name> Timesheet - YYYY-MM.pdf",
    exact or no file - the monthly email task outside the app finds files
    by that name; never "clean" a name, refuse it), and dirFormModel - the
    ONE source for the Review screen and the PDF, so what is reviewed is
    what prints.
  - Forms: `form` is STORED data, "genesis", "select" or "plain" (DIR_FORMS,
    dirFormOk; repairData drops any other). Plain is the neutral time sheet
    for anyone without a built-in layout (owner's choice, 2026-11-06): no
    hospital's wording and no certification text. Each entry prints on its own
    line (model.lines, dirPlainText) and it has no line slots (dirSlotPlan is
    Genesis only), so nothing combines. It shares the Genesis row keys
    (dirFormsShareRows), so changing between the two keeps every entry placed
    and asks nothing. It keeps the file-name contract, and its own screens name
    no Drive or email task (dirFormName names a form in any message). The sheet
    runs onto more pages, each later page repeating the directorship, name and
    month (check.js G9c; jsPDF cannot run there, so re-check the PDF live after
    editing drawPlain).
  - A Plain directorship's own form (DirFormFile, shown in the Settings card
    and on Review): one PDF or photo per directorship, in IndexedDB ("rvu-forms")
    because a file is too big for the store, which is rewritten whole on every
    save. Per device and not encrypted: NEVER in the store, a backup or an
    export, so the user uploads it again after restoring on another phone. The app never reads
    or fills it in: it stores it, shows a photo and hands it to the share sheet
    or downloadBlob (there is no in-app PDF viewer). Only the utils.js helpers
    (dirFormDbOpen, dirFormTx, dirFormFileSave/Load/Remove, dirFormFilesErase)
    touch the database and
    every helper's callers are named (check.js G9b, plain P6), so nothing opens
    it at load. The ways in are DirFormFile, which shows only under a Plain
    directorship, the tap that removes a Plain directorship, and Reset App, so a
    phone with no Plain directorship never creates it (deleteDatabase creates
    nothing). A file is deleted only by a tap: Remove or Replace on the card,
    removing its Plain directorship (after the confirm, which says so; an Undo
    brings back the directorship and hours, not the form), or Reset App, which
    erases the whole database and reloads once that settles. Nothing deletes a
    file by comparing lists, so a data recovery, a restore or a stale tab can
    never lose one. A file left behind (by a restore, by removing a directorship
    no longer Plain, or by a delete that failed) stays hidden, using its space,
    and returns if that directorship does, as Plain; changing to another form
    and back keeps it too.
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
    exactly twice: inside sharePdf and inside DirFormFile's shareForm, which
    shares the file loaded when the card showed, directly in its tap (check.js
    G9). A resolved PDF share records
    dirHandoff {date, entriesHash} captured when the PDF was built; an
    AbortError records nothing; no file sharing -> download under the exact
    contract name and the user taps Mark handed off.
  - jsPDF is loaded only by loadPDF; directorships.js uses only the plain
    drawing surface (no .html/addJS/AcroForm/annotations; output("blob")
    only). A form never truncates: text shrinks to a 6.5 pt floor, and what
    still does not fit blocks Create with a layout flag. Plain wraps its lines
    and runs onto more pages instead, so only a one-line header value can
    block it.
  - Home's month-end reminder dismissal lives in ONE per-device key,
    DIR_REMIND_KEY ("rvu-dir-reminder"), OUTSIDE the store; only the
    utils.js helpers touch it (check.js G12, the BACKUP_STAMP_KEY rule).
- cpt-data.js is built by scripts/build-cpt-data.js. Row contract `[code,
  desc, wRVU, category, keywords ("" if none), CMS GLOB DAYS, "MBAC" (four
  indicator digits: MULT PROC, BILAT SURG, ASST SURG, CO- SURG), FACILITY
  TOTAL, prior-year work RVU or null]`, one row per line. wRVU (r[2]), the
  global (r[5]), the indicators (r[6]) and the facility total (r[7]) always
  come from the CMS nonQPP PPRRVU file - the code's base row, except r[7],
  which is the professional (-26) row's FACILITY TOTAL where CMS prints one
  for the code (what a physician is paid in a facility; the base row then
  holds the whole service, and 25 ranked codes would otherwise lead on an
  office figure). r[8] is the WORK RVU of the same code in the builder's
  --prior file (CY2025 today; which year that is is decided at each swap,
  never "last year" by default): its base row's when that row is payable,
  else its -26 row's when that one is payable, else null - so a 0 there is a
  real 0.00. Never hand-edit any of them.
  The curated fields - descriptor (r[1]), category (r[3]), keywords (r[4]) -
  may be edited in place; the generator carries them forward on its next run
  (and its swap checklist edits them in the candidate). Edit them with the
  builder's own row writer (jsStr, emitNum, emitRow), never by hand: plain
  ASCII wording, no < > " or backslash. check.js fingerprints them
  (CURATED_HASH_BASELINE: every row's code|r[1]|r[3]|r[4]), so an edit sets
  the new value in the same commit, deliberately - and so does a yearly swap
  (CMS's new short text for codes never curated, codes added and removed;
  take the value from the check's failure line once the builder's report of
  descriptor changes is reviewed). The 53 rows reworded in ASSET_V 69 are
  also pinned word for word, and the five newborn repairs 49600-49611 sit
  under Abdomen/Peritoneum (search reads the category: under Hernia/Abdomen
  "large hernia" listed one). Wording never names what a code is NOT (search
  matches those words too; CMS's own "non-infected" is the one exception)
  and leads with the words that tell neighbours apart (Home's Recent list
  shows about 33 characters). A second constant,
  CMS_MORE, follows the rows: `addon` (CMS's NCCI add-on code edits for the
  app's codes, "<type>" or "<type>:<tokens>", a token being one primary code
  or a range A-B in string order), `endo` (endoscopy families by base code),
  `addonAsOf` (--addon-date as typed: a day in the quarter of the add-on
  file's name, normally its first day) and `priorYear`. To add or refresh a
  CMS column without changing the year, run the builder with the current
  file as both --input and --baseline (its header says how). --baseline is
  always the file the data was built from: the run stops when its title
  names another year than --year or the year before, or when a code it
  keeps has no row there. CMS_ROW_BASELINE, GLOB_BASELINE,
  IND_BASELINE, FAC_SUM_BASELINE, POLICY_HASH_BASELINE, CURATED_HASH_BASELINE,
  PRIOR_BASELINE and MORE_BASELINE live in check.js and change together with
  the data file, deliberately. The row fingerprint covers every CMS element
  of every row - wRVU, global, indicators, facility total, prior-year value -
  the two table fingerprints every table entry, and the curated fingerprint
  every descriptor, category and keywords, so a hand edit of any of them fails;
  check.js also holds the file to the builder's exact text: every row line
  as the builder's row writer prints it, each table key once. For that it
  carries a COPY of the writer (jsStr, emitNum, emitRow) and holds the copy
  to the builder's own functions - change them in both files together. The
  builder itself is tested by check.js on made-up files: which codes it
  selects (status A, R, B, T; the one excluded code), what it keeps of a
  code the data already holds (the curated descriptor, category and
  keywords; a descriptor conflict), a new code's category, the -26 row, the
  prior-year value, the add-on dates and tokens, its report (sources, row
  count, baselines, change lists) and the inputs it must refuse. Change a
  rule there and that test together. The test types two real codes - 47562 as
  "a code the data holds" (its row is read from the data file) and 86153,
  the one code the builder leaves out - and a made-up 40491 in a gap between
  two shipped codes, whose category it reads. Every check.js test that names a code's
  figures or indicators carries that year's values - the worked cases, the
  per-rule cases and pinned texts, the lookup cases, the import fixtures -
  so the yearly swap re-reads them all.
- Global period has ONE source: CMS_RAW[5]. utils.js derives GLOBAL_DAYS;
  getGlobalDays/getGlobalColor are the only label and color source (000
  0-day, 010 10-day, 090 90-day, ZZZ add-on, anything else no chip; colors
  are the styles.js --global-90/10/0 theme tokens). Never type codes between
  `var GLOBAL_DAYS` and `var COMPANION_CODES` (check.js refuses, and each of
  the two markers must occur exactly once in utils.js, comments included).
  Chips are looked up at render time, not stored on entries, so a CMS change
  relabels past rows.
- CMS payment policy has ONE source too: CMS_RAW[6..8] and CMS_MORE. utils.js
  derives CMS_POLICY, CMS_ADDON and CMS_ENDO in the same section as
  GLOBAL_DAYS (so the no-typed-codes gate covers them) and everything reads
  them through cmsPolicy, addOnRule, addOnAllows and endoFamily only. A row
  without the new elements has no policy and CMS_MORE is read behind
  `typeof`: for a moment after an update a phone can hold this utils.js
  beside an older cpt-data.js, and only CMS_RAW has a fallback when the data
  file fails to load. Every reader then gets "no CMS data" and proposes
  nothing (check.js runs both mixes). Beside a CMS_MORE it cannot read the
  rows keep their policy and only the add-on and family lookups answer
  nothing (check.js runs that too). Typed
  codes are held out by three pins beside the gate: the lookups sit between
  the two markers, the literals of that stretch are the pinned ones, and the
  code-shaped tokens of utils.js outside its four curated tables
  (KEYWORD_SUPPLEMENT, FRIENDLY_DESC, COMPANION_CODES and HERNIA_PICK, Log's
  hernia picker), and of every other file, are the pinned ones. The
  builder's dangling-reference list scans the same four. A token is any
  five characters shaped like a code, so a code typed WHOLE anywhere moves
  a pin - and so
  does a plain five-digit number or a word in a comment (write a new number
  that is no code as a product, 15 * 1000; the failure line names the token
  and its line). A prefix test or a code put together from pieces is not
  seen: review those by eye. Log's "Also add?" chips (getCompanionSuggestions)
  offer an add-on whose CMS list is complete (type 1) only once a code in the
  case is one of its primaries - typed, or in a saved case of the same date
  and exactly the same initials (Log passes the card's saved cases' codes;
  they are not skipped as already selected). In the built-in list that
  holds back only 38900; a "Logged together" chip from the user's own
  history waits the same way (44121 after 47562, say, until 44120 is in the
  case). Type 2 and 3 add-ons and every other suggestion are unchanged.
  Every key and code of the table is a database code (check.js). ASSET_V 69
  removed the deleted 49568 (under 49595), 19281 under 19120 (a marker placed
  by imaging makes the case 19125), the adhesiolysis chips of 44620 and
  44640 and every chip of 49000 (CMS's NCCI manual: enterolysis, and an ex
  lap beside another open abdominal operation, are not billed apart;
  extensive adhesiolysis is -22 on the main code), and 38525 reads
  "Sentinel/deep axillary node" under 19301 and 38900 (38745 keeps "Axillary
  dissection"); check.js pins these by value. The ventral hernia repairs'
  mesh add-ons are offered by the hernia picker, not as chips (11008 would
  warn at once); a mesh line adds its row through the chips' own writer,
  addSuggestion, at LogProc's top level.
- Lead code and -51 have ONE rule, utils.js proposeCaseModifiers. It is pure:
  it proposes and flags, writes nothing and leaves its input untouched, and
  a caller applies a proposal only on the user's tap. Its one caller is
  Log's lead-code card (one mention in log.js; check.js 5f-18 pins the
  count). Lines are { code, modifiers, baseRVU }: a stored case's cptCode is
  read where the code is missing, null or empty, and a line without a usable
  baseRVU ranks and prices as 0, so a caller passes the wRVU itself. Its
  `before` / `after` and totals are TODAY's prices of the modifiers entered
  and proposed, never a saved case's stored figure: a caller that shows saved
  cases puts the stored adjustedRVU beside them, and what a save then writes
  is History's keep rule. The owner's choice of 2026-11-13: the LEADER is the
  ranked line with the highest WORK RVU - the line's own base, x1.5 for -50
  where BILAT SURG is 1 - not CMS's facility total. A tie in work RVU goes to
  a line without -51 (a case entered in order is never re-sequenced for no
  gain), then to the higher facility total, then to the earlier line; both
  ranks are compared to four decimals. When the facility total would name
  another leader, the result carries that order too (`alt`, with its own
  lead marks) and a measures-disagree note: a caller shows both and never
  picks silently. The facility order's leader is found by facility total,
  then work RVU, then a line that is not a line of an endoscopy family of
  two or more carrying -51, then a line without -51, then the earlier line
  (the third step, Batch 2's, keeps the other order in place after Apply and
  changes no other tie). No other order is offered when
  the two leaders tie in work RVU, when a line of an endoscopy family of two
  or more has the leader's work RVU (the leader itself included), or when
  the facility leader is such a line and carries -51; then a
  measures-not-offered note names both leaders and why (none when both
  leaders are family lines, or when they also tie in facility total). Each
  alt line carries `followed`: true on every line of a group the other order
  flips whose ranked lines are all as alt has them.
  `settled` says that nothing NEEDS a tap: every line is as the proposal has
  it, except that a group where the other order is offered may follow that
  order instead (decided group by group). A tap may still be on offer: where
  `alt` exists, `changed` or `alt.changed` stays true, and the card offers
  that order quietly. Nor does it say that nothing is wrong - show flags
  whatever it says, with one exception: a 51-on-lead flag on a line whose alt
  line is `followed` belongs to the order the user did not choose and is not
  an error (caseCardPlan leaves it out). A family leader that carries -51
  has a flag kind of its own, 51-on-family-lead: an error by the work-RVU
  order, with nothing to tap. While one group holds ranked lines the texts
  say "here"; with two or more, each leader, all-51, not-sequenced,
  family-lead and measures text names its group, and a leader's flag says it
  leads there, not that it has the highest work RVU.
  Ranked lines are MULT PROC 2 and 3; every other code never takes -51
  (flagged on any line; proposed away except on a -76 / -77 / -78 line).
  Groups never mix: the user's own lines, assistant lines (-80, -82, AS),
  co-surgeon lines (-62), and -79 lines apart within each; -76, -77 and -78
  lines are never sequenced or changed, and a row with no code takes no
  part. Two or more lines of one endoscopy family in a group are left as
  entered (the app has no modifier for CMS's family rule; the note says so):
  they still count when the leader is found, and a family leader that
  carries -51 is flagged and nothing is then proposed around it. A group
  with a code that has no CMS data, or whose ranked lines all carry -51,
  gets no sequencing proposal (a -51 on a code that never takes it is still
  proposed away). Flags (bilateral, assistant, co-surgeon, add-on pairing,
  unknown or repeated modifier) never change a proposal. It never throws for
  anything JSON can hold: a modifier that is neither text nor a number is an
  unknown modifier.
  Log's lead-code card (ASSET_V 68) sits under the Encounter Summary in the
  amber style of the call-credit card. Its decisions are utils.js helpers,
  and Log only wires them: caseLinesFromRows (Log's rows, priced from the
  code map as save() prices them), caseSavedMates (the saved cases of the
  same date and exactly the same initials - History's encounter rule),
  caseCardPlan (nothing, flags, a proposal, or both orders; needsTap; the
  error flags; the notes to list - measures-not-offered, all-51 and
  not-sequenced open the card on their own, the other kinds only beside
  something else), caseApplyOrder (new rows with only the -51 changes of the
  chosen order; null for an order that would change a saved case, or for a
  stale result) and caseCardTotals (the figures it prints: the typed lines
  as the Encounter Summary totals them, a no-credit encounter's too; each
  saved case shown at its stored figure and counted in the encounter's
  column - its credited figure, or its no-credit one while the encounter
  being typed earns no credit, as History's totals count it). None of them
  calls the function or prices anything. The card never changes a saved
  case: an order that would is shown as "edit it in History", with no
  button. check.js tests each helper by value, and pins Log's wiring with
  Log card C1-C6: C1 that an order reaches the rows only in an onClick
  (`var x = caseApplyOrder(procs, <result>, "main" | "alt"); if (x)
  setProcs(x);`); C2 that the card renders only under ONE typeof guard of
  the five helpers, with no hook under it (for about ten minutes after a
  deploy a phone can hold the new log.js beside the old utils.js: the card
  then simply does not show); C3 runs LogProc's card state (the seq* lines,
  lifted out of log.js) on made-up cases; C4 that the card's own function
  writes state only in its three taps; C5 that Apply and Use this order show
  only where their order applies; C6 that Keep as is survives a tab switch
  and is forgotten after a save. The card's words are not tested: review
  them by eye. Keep as is hides the card while the case's codes and
  modifiers - the typed rows' and the saved cases' - stay as they were
  (seqKept). Known limits: the result carries no group id, so one Apply
  covers the whole case; a caller that holds a stored case and a draft code
  passes only the draft (an empty code falls back to cptCode); the typed
  rows come first, so in a full tie (same work RVU and facility total, no
  -51 on either) a typed line leads over a saved one and the card asks for
  the saved case to be changed in History, although the equal order with
  the saved line leading could be applied in Log. check.js pins
  the four worked cases with their CY2026 figures, one case per rule, every
  flag and note text word for word, the result's shape, and every card
  helper by value.
- Log's hernia picker (ASSET_V 69) sits directly under the search box, sky
  like Private / Call (amber means a warning). utils.js decides: HERNIA_PICK
  (the fourth curated table: the twelve anterior abdominal wall repairs
  49591-49596 / 49613-49618 by initial or recurrent, size and reducible or
  incarcerated, the mesh-removal add-ons 49623 and 11008, and the words for
  11008's CMS primaries) and herniaPickerFor(cptMap, code, query), pure:
  null, or the grid with each code's wRVU from the code map (overrides
  apply), `at` (the picked code's cell) and the mesh add-ons, the infected
  one with the primaries CMS lists (addOnRule) and the line Log shows. It
  shows for a picked code of the twelve, or with no code picked for a search
  that uses a hernia word (a typed word starting with hern, ventral,
  incisional, umbilic, epigastr or spigel; part of one, such as "vent" or
  "incision", is not) AND finds one of the twelve (so inguinal, femoral,
  hiatal and parastomal searches show nothing); never when one of the
  twelve is missing from the map; without CMS's add-on list it offers
  no 11008. Log only wires it: ONE typeof guard (a new log.js beside an
  older utils.js shows nothing);
  its value is held back in the post-save window (!saved); its state
  { id, kind, size } is memory only and keyed to the active row, and one
  effect on cur.id closes it whenever the active row changes (a Proc tab,
  + Add, a mesh line, the post-save reset); a big button is exactly the
  search-result tap (`selectCode(cptMap[code]); setShowFavs(false);` -
  modifiers carry over) and a mesh line exactly the "Also add?" writer.
  check.js: HERNIA_PICK by value against the CMS data, herniaPickerFor by
  value, Log hernia picker P1-P4 (taps, guard, place, state) and Log hooks.
  The card's words are not tested: review them by eye. Not in History's
  + Add.
- MODIFIERS since ASSET_V 67: -22 counts 1.0 and its chip reads "no wRVU
  change" (cases saved at 1.2 keep their stored figure - the History keep
  rule - so the panel of such a case shows that chip beside the kept
  figure); -82 (0.16) sits beside -80. History's chips show each modifier's
  desc line like Log's (check.js pins both grids whole, and every row's
  code, label and desc). Both importers follow the table, so an "82" in a
  file is now read as -82. CSV import never takes a row's ADJUSTED wRVU from
  the file. A wRVU column of the file's own (detectCols' rvu names; the
  app's exports have none, and the RVU Wallet branch never reads one) is the
  base only in a row whose cell reads as a number other than 0: a blank, 0
  or non-numeric cell means today's database value, and 0 for a code the
  database lacks. When the file's adjusted column shows another figure than
  the row will be stored at, parseImport's FIRST message says for how many
  rows, and the credit note comes second, in both branches. A row with more
  cells than the header (a comma inside a cell of a tab paste) is not
  compared and may be stored with the wrong modifiers or wRVU: it is counted
  apart, in the same message, which asks the user to check such rows before
  importing (only a file with an adjusted column gets either count). An RVU
  Wallet row prints one total for its codes and is allowed half a cent per
  code, so a real difference of up to half a cent per code there is not
  counted. The preview shows the first six messages (5f-20 pins its Warnings
  block whole, from its condition on). check.js reads the export header rows
  out of the app - `h` in settings.js expCSV, `h` in history.js
  exportFiltered, `procHeaders` in settings.js doExcelExport - and requires
  each to keep the columns import reads, an adjusted column the note
  compares, no wRVU column of its own, and Credit last: renaming one of
  those arrays or functions fails the first CSV-import check. check.js's
  ASSET_V floor (67) rises with this table.

## Working protocol

Small approved batches; plan first for architecture changes (index.html is
always an architecture change); `npm run check` after every file edit;
live-verify in the browser preview with seeded data, then CLEAR test data;
pause for review before committing. State root causes before fixing bugs.
