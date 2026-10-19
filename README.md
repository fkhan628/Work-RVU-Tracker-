# RVU Tracker

A mobile-first Progressive Web App for physicians to track surgical procedure work RVUs and compensation. Built as a self-contained, no-build-step web app using React via Babel standalone — just static files served from GitHub Pages.

**Live app:** https://fkhan628.github.io/Work-RVU-Tracker-/

---

## Features

- **Full CMS CY2026 CPT database** — all 7,305 codes from the CMS Physician Fee Schedule embedded directly in the app, with 300+ enhanced surgical descriptions and search keywords for common shorthand (e.g., "lap chole", "appy", "TAR").
- **Multi-procedure encounter logging** — log multiple CPTs per patient encounter with inline modifier support and patient initials.
- **RVU Wallet CSV import** — auto-detects the RVU Wallet format, splits multi-code rows, and extracts modifiers automatically. Generic CSV import also supported.
- **Analytics & Trends** — goal pacing, monthly bar charts, projected year-end totals, top procedures, and category breakdowns.
- **History** — browse and edit past encounters, grouped by date.
- **Compare** — compare RVU performance across time periods.
- **Compensation tracking** — set your contracted $/RVU rate and two yearly wRVU goals (decimals supported): an OR goal for the cases you log, and a Reconciliation goal for the hospital's monthly totals from Compare (incl. call + clinic). Home's Compensation card projects the year from this year's Compare months when you have them and compares that with the Reconciliation goal (or, if none is set, the OR goal); otherwise it projects your logged pace and compares it with the OR goal. The card names the goal it used, and is hidden with no rate or no goal to compare with.
- **Offline-first** — all data stored in browser `localStorage`; works without a network connection after first load.
- **Backup & Restore** — export/import your entire dataset as a base64 string via clipboard for easy cross-device transfer.
- **PIN lock with encryption** — optional PIN-protected access with AES-GCM encrypted API key storage.
- **Dark and light modes** — theme auto-persists across sessions.

---

## Architecture

The app is split into 14 files and loaded as a plain static site — no bundler, no build step (npm is only for the dev tools).

```
index.html              # ~60-line shell, loads scripts in order
manifest.json           # PWA manifest (name, icons, theme, scope)
icon-192.png            # PWA icon (Android/Chrome)
icon-512.png            # PWA icon (Android/Chrome, also used for iOS)
README.md               # This file
js files/
  crypto.js             # PIN auth + AES-GCM encryption helpers
  cpt-data.js           # 7,305 CPT codes (CMS CY2026 PFS, incl. global period) — loaded as plain script
  utils.js              # Constants, helpers, parsers, data persistence
  styles.js             # CSS variable injection + shared style object
  dashboard.js          # Home view
  log.js                # Procedure entry
  analytics.js          # Trends and projections
  history.js            # History browser + CSV import
  compare.js            # Period comparison
  acute.js              # Acute-care history table (read-only, nav-less view)
  callpay.js            # Call pay: shift log, sites + dated rate versions (no nav tab of its own; an unsaved shift form survives a tab switch)
  settings.js           # Settings, backup/restore, theme toggle
  app.js                # ErrorBoundary, App root, Nav, render entry point
```

### Load order

1. React 18.3.1 and ReactDOM (UMD, from unpkg)
2. Babel standalone 7.26.10 (from unpkg)
3. **Plain scripts** (execute during parse, in document order): `crypto`, `cpt-data`, `utils`, `styles` — all JSX-free. utils/styles were moved out of Babel to skip two compiles; their top-level `const` names become parse-time global bindings that no Babel file may redeclare.
4. **Babel scripts** (`type="text/babel"`, execute after transform at DOMContentLoaded): `dashboard`, `log`, `analytics`, `history`, `compare`, `acute`, `callpay`, `settings`, `app`.
5. All local script URLs carry `?v=ASSET_V` — a hand-bumped constant in index.html's head. **Every deploy that changes any js file must bump ASSET_V** (build reports state the new value). Browsers cache and revalidate per GitHub Pages headers (~10-min max-age), so updates propagate even without a bump; the bump forces immediate refetch.
6. SheetJS xlsx 0.20.1 is **not loaded at boot** — Compare's Excel upload and Settings' Excel export lazy-load it via `loadXLSX()` (utils.js) with the same pinned SRI hash.

### Design principles

- **No build step.** You can edit any file and refresh the local preview. The app itself needs no `npm install`, no webpack, no TypeScript (`npm install` only fetches the dev tools).
- **ASCII-clean app code.** Non-ASCII characters (em-dashes, box-drawing, etc.) break Babel standalone's parser — all app code uses Unicode escapes (`\u2014`) instead.
- **Data separated from logic.** `cpt-data.js` is parsed as plain JavaScript (not Babel) to avoid the 500KB+ file choking Babel at page load.
- **HTML-safe CPT descriptions.** Descriptions containing raw `<` or `>` (e.g., "hernia < 3 cm") are Unicode-escaped (`\u003c`, `\u003e`) to prevent HTML parser corruption when embedded in `<script>` tags.
- **Flex-column layout.** The root is a flex column with a scrollable content area and a `flex-shrink: 0` nav bar. This keeps the nav pinned to the bottom on all mobile browsers without the bugs that come from `position: fixed` + `100vh` on iOS Safari.
- **Error boundaries everywhere.** Each view is wrapped in its own React error boundary so a crash in one tab can't take down the whole app. A global window error handler logs unhandled exceptions.
- **Crash recovery.** A "last known good" copy of the data is kept in `localStorage` (refreshed every few validated saves). If the live data can't be read, the app loads that snapshot with a loud banner and keeps a single forensic copy of the unreadable data, which is discarded when you dismiss the banner or on the next clean load. The whole-app crash screen's Reset App asks you to type RESET before it erases the data and the snapshot.

---

## Data

- **Source:** CMS CY2026 Physician Fee Schedule (`PPRRVU2026_Jan_nonQPP.csv`)
- **Codes included:** All 7,305 codes from the PFS
- **Fields:** CPT, description, work RVU, category, global period (CMS "GLOB DAYS")
- **Enhanced descriptions:** ~301 commonly used surgical codes have cleaned-up descriptions and keyword supplements (e.g., code 47562 matches "lap chole", "cholecystectomy", "gallbladder")
- **Storage:** `localStorage` on the device is the only persistence layer. A "last known good" snapshot is kept beside the live data, and backups are PIN-encrypted codes or files the user saves.

### Data versioning

```js
const DATA_VERSION = "CY2026-PFS-v1";
const DATA_YEAR = 2026;
```

When CMS releases a new fee schedule, update `cpt-data.js` via `scripts/build-cpt-data.js` (see its header checklist), bump `DATA_VERSION`, and update `DATA_YEAR`.

---

## Development

### Running locally

Clone the repo and serve it locally:

```bash
git clone https://github.com/fkhan628/Work-RVU-Tracker-.git
cd Work-RVU-Tracker-
npm install       # dev tools for npm run check (the app itself needs none)
npm run serve     # http://127.0.0.1:4173
```

The app itself runs entirely in the browser. It still needs a local server, because opening `index.html` as a `file://` URL fails: Babel standalone fetches the `text/babel` scripts, and browsers block those fetches from `file://` pages. For iPhone testing, host it somewhere (GitHub Pages works).

### Cache busting

`index.html` defines `var ASSET_V = "<n>"` in its head: a version number bumped by hand. Every local script URL, plain and Babel alike (`crypto`, `cpt-data`, `utils`, `styles`, and all the views), plus the `cpt-data.js` preload, is requested as `js files/<name>.js?v=<ASSET_V>`. Bumping it changes every URL at once, so the next load asks for the new copy of every file instead of reusing cached old ones.

- **Every deploy that changes any js file must bump ASSET_V**, and the build report states the new value. `npm run check` confirms the constant exists, but it can't know whether you bumped it.
- Without a bump, GitHub Pages' cache headers (about 10 minutes) still let a change through eventually. Until then, a phone can run old and new files side by side, which can white-screen when files depend on each other.
- The CDN libraries (React, ReactDOM, Babel standalone, and the lazily loaded SheetJS) are pinned to exact versions with SRI hashes, so they never change underneath the app. Bumping a pinned version means recomputing its hash.
- The local preview server (`npm run serve`) sends `Cache-Control: no-store`, so a plain refresh always shows your latest edits there.

### Editing gotchas

- **Don't use non-ASCII characters in app code.** Use Unicode escapes (`\u00A0`, `\u2014`, etc.) instead of literal curly quotes, em-dashes, or emoji in source files. Babel standalone breaks on some of these.
- **Don't duplicate `const` declarations at the React destructuring line.** `utils.js` already does `const {useState, useEffect, useRef, useMemo, useCallback} = React;` — only declare once per file or you'll get "Identifier already declared" errors.
- **Don't set `viewport-fit=cover`.** It causes status bar overlap and nav bloat on iPhone. The current viewport meta is tuned for the flex-column layout.
- **If you see a blank screen after editing**, open devtools and check the console. The ErrorBoundary catches React errors, but syntax errors in Babel-parsed files fail silently at parse time — the console will show the actual error.

---

## Tech stack

- **React 18.3.1** (UMD build, loaded via unpkg)
- **Babel standalone 7.26.10** (in-browser JSX transform)
- **SheetJS xlsx 0.20.1** (Excel file imports)
- **GitHub Pages** (hosting)
- **`localStorage`** (data persistence, on the device only)
- **Web Crypto API** (AES-GCM encryption for the optional PIN-locked API key)

No bundler, no TypeScript, no build step. Node is used only for the dev tools (`npm run check`, `npm run serve`); GitHub Pages serves the files as they are.

---

## License

Personal project. Not intended for clinical billing use or as a replacement for your institution's official RVU tracking.

##