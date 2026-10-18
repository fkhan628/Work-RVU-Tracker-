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
- Commit and push from `RVU App Split/` (the repo root). Never commit
  billing data (`RVU Wallet Data/`), CMS source files (`CMS 2026/`), or
  any partner name — the repo is public and the roster is runtime user
  data only. The same goes for call-pay site names and rates (paySites),
  with ONE exception the owner chose on 2026-10-11: the built-in preset
  DEFAULT_PAY_SITES in utils.js (two sites + their rates, public) and the
  check.js test of the owner's worked examples against it. Any other
  site or rate stays runtime user data.
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
  re-pricing payRatesDiffer/payShiftStale/payRepriceShift, the shift
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
- wRVU overrides (rvuOverrides, { code: number }): getDB applies one only
  when truthy - a stored 0 is inert (the code keeps its CMS value; check.js
  pins it, since honoring 0 would silently zero that code on any phone that
  holds one). The Settings editor badges and counts with the same test and
  commits a row only on blur/Enter when its text changed (Escape reverts)
  through rvuOverrideFromText: the CMS value removes the override; blank, 0
  or junk is refused and the field reverts. Overrides reach only cases
  logged, added, imported or re-coded later (entries keep their snapshot).
- Show/hide $: App's showComp is memory only (every launch starts hidden)
  and reaches each view that masks $ along with toggleComp. Masked $ goes
  through utils.js fmtDollar(v, showComp) (always passed showComp), a
  showComp ternary (Dashboard vs-goal and $/wRVU lines, Compare's rate
  line), Call Pay's paid()/MASK or utils.js dirMoneyShown(v, showComp)
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
  never hide the bar on input focus.
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
