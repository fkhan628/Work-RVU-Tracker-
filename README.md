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
- **Compensation tracking** — set your contracted $/RVU rate and annual wRVU goal (decimals supported) to see real earnings estimates.
- **Offline-first** — all data stored in browser `localStorage`; works without a network connection after first load.
- **Backup & Restore** — export/import your entire dataset as a base64 string via clipboard for easy cross-device transfer.
- **PIN lock with encryption** — optional PIN-protected access with AES-GCM encrypted API key storage.
- **Dark and light modes** — theme auto-persists across sessions.

---

## Architecture

The app is split into 12 files and loaded as a plain static site — no npm install, no bundler, no build step.

```
index.html              # ~60-line shell, loads scripts in order
manifest.json           # PWA manifest (name, icons, theme, scope)
icon-192.png            # PWA icon (Android/Chrome)
icon-512.png            # PWA icon (Android/Chrome, also used for iOS)
README.md               # This file
js files/
  crypto.js             # PIN auth + AES-GCM encryption helpers
  cpt-data.js           # 7,305 CPT codes (CMS CY2026 PFS) — loaded as plain script
  utils.js              # Constants, helpers, parsers, data persistence
  styles.js             # CSS variable injection + shared style object
  dashboard.js          # Home view
  log.js                # Procedure entry
  analytics.js          # Trends and projections
  history.js            # History browser + CSV import
  compare.js            # Period comparison
  settings.js           # Settings, backup/restore, theme toggle
  app.js                # ErrorBoundary, App root, Nav, render entry point
```

### Load order

1. React 18.3.1 and ReactDOM (UMD, from unpkg)
2. Babel standalone 7.26.10 (from unpkg)
3. SheetJS xlsx 0.20.1 (for Excel imports)
4. `crypto.js` and `cpt-data.js` — loaded as plain `<script>` tags to bypass Babel (data is too large to parse through Babel, and crypto uses only ES5)
5. The remaining 9 files — loaded via `document.write` with `type="text/babel"` and a `Date.now()` cache-buster so every page load gets fresh code

### Design principles

- **No build step.** You can edit any file and refresh. No `npm install`, no webpack, no TypeScript.
- **ASCII-clean app code.** Non-ASCII characters (em-dashes, box-drawing, etc.) break Babel standalone's parser — all app code uses Unicode escapes (`\u2014`) instead.
- **Data separated from logic.** `cpt-data.js` is parsed as plain JavaScript (not Babel) to avoid the 500KB+ file choking Babel at page load.
- **HTML-safe CPT descriptions.** Descriptions containing raw `<` or `>` (e.g., "hernia < 3 cm") are Unicode-escaped (`\u003c`, `\u003e`) to prevent HTML parser corruption when embedded in `<script>` tags.
- **Flex-column layout.** The root is a flex column with a scrollable content area and a `flex-shrink: 0` nav bar. This keeps the nav pinned to the bottom on all mobile browsers without the bugs that come from `position: fixed` + `100vh` on iOS Safari.
- **Error boundaries everywhere.** Each view is wrapped in its own React error boundary so a crash in one tab can't take down the whole app. A global window error handler logs unhandled exceptions.
- **Crash recovery.** A "last known good" copy of the data is saved to `localStorage` after every successful validation. The Reset App button clears both `localStorage` and the persistent storage keys.

---

## Data

- **Source:** CMS CY2026 Physician Fee Schedule (`PPRRVU2026_Jan_nonQPP.csv`)
- **Codes included:** All 7,305 codes from the PFS
- **Fields:** CPT, description, work RVU, category
- **Enhanced descriptions:** ~301 commonly used surgical codes have cleaned-up descriptions and keyword supplements (e.g., code 47562 matches "lap chole", "cholecystectomy", "gallbladder")
- **Storage:** `localStorage` for immediate access, plus `window.storage` key-value storage as a persistent backup

### Data versioning

```js
const DATA_VERSION = "CY2026-PFS-v1";
const DATA_YEAR = 2026;
```

When CMS releases a new fee schedule, update `cpt-data.js` with the new CSV, bump `DATA_VERSION`, and update `DATA_YEAR`.

---

## Development

### Running locally

Clone the repo and open `index.html` in a browser:

```bash
git clone https://github.com/fkhan628/Work-RVU-Tracker-.git
cd Work-RVU-Tracker-
open index.html         # macOS
# or: start index.html  # Windows
# or: xdg-open index.html  # Linux
```

The app runs entirely in the browser — no server required. For iPhone testing, host it somewhere (GitHub Pages works) since `file://` URLs don't support all PWA features.

### Cache busting

`index.html` appends `?<timestamp>` to every Babel-processed script on page load, so every refresh pulls fresh code. `crypto.js` and `cpt-data.js` don't get this treatment (they're static scripts and browsers cache them more aggressively — hard-refresh with `Cmd+Shift+R` / `Ctrl+Shift+R` if you edit them).

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
- **`localStorage`** + `window.storage` (data persistence)
- **Web Crypto API** (AES-GCM encryption for the optional PIN-locked API key)

No Node, no npm, no bundler, no TypeScript, no server.

---

## License

Personal project. Not intended for clinical billing use or as a replacement for your institution's official RVU tracking.

##