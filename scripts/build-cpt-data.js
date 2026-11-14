#!/usr/bin/env node
// =======================================================================
// build-cpt-data.js - yearly CPT database update pipeline. LOCAL TOOLING:
// nothing here ships to the app; outputs are a candidate data file and a
// review report that gets human approval before any swap.
//
// USAGE:
//   node scripts/build-cpt-data.js \
//     --input      "..\CMS 2027\PPRRVU2027_Jan_nonQPP.csv"   (csv or xlsx)
//     --baseline   "..\CMS 2026\PPRRVU2026_Jan_nonQPP.csv"   (the CURRENT year's file)
//     --prior      "..\CMS 2025\PPRRVU2025_Oct.csv"          (csv or xlsx)
//     --prior-year 2025
//     --addon      "..\CMS NCCI\AOC_V2026Q4-F-MCR.txt"       (the fixed-width .txt)
//     --addon-date 2026-10-01
//     [--year 2027]
//   --input, --baseline and --prior must each be the nonQPP file of its
//   year (the QPP file is a subset: it lacks some of the app's codes, and as
//   --prior it would leave their 9th element null with nothing said); in a
//   year when CMS publishes ONE PPRRVU file, pass that file. --baseline is
//   the file the current data was built from: the run stops when a code
//   kept from the current data has no row in it.
//   The year in each file's title line is read: --input must say --year,
//   --prior must say --prior-year and --baseline must say --year or the year
//   before, or the run stops. A title line that names NO year (or words it
//   another way) does not stop the run: the report's head says so in bold,
//   and that file's year is then checked by hand.
//   A WORK RVU cell that is blank or not a number, on any row with a code,
//   stops the run: CMS prints 0.00 where it has no figure.
//   --prior is the PPRRVU file whose WORK RVU is carried as each row's 9th
//   element, and --prior-year its calendar year. WHICH year that is is a
//   decision (the year a user may still be credited from), never "last year"
//   by default - see checklist step 3e.
//   --addon is CMS's NCCI "Add-on Code Edits" file for Medicare and
//   --addon-date the day its pairs are judged on: a day in the quarter of
//   the file's name - normally that quarter's FIRST day, when the file took
//   effect (CMS replaces it up to four times a year; V2026Q4 -> 2026-10-01).
//   Only the quarter is compared, and only when the file's name carries
//   one: the run stops when the date lies in another quarter than the name
//   says, and any day of the right quarter is taken as typed (it becomes
//   addonAsOf), so type it with care. The run also STOPS when the file
//   holds an edit that starts after the date: for a file with a mid-quarter
//   edit pass that later day (an edit of a later quarter than the file's
//   name stops every run - handle such a file deliberately). A pair whose
//   last day in effect is before the date is left out, and so is a pair
//   CMS withdrew back to its start.
//   Outputs land NEXT TO the --input file (outside the repo):
//     cpt-data.<year>.js  and  cpt-update-REPORT.<year>.md
//   To add or refresh CMS columns WITHOUT changing the year, run it with the
//   current year's file as both --input (a copy in a scratch folder, so the
//   outputs land there) and --baseline, and with --year <the current year>
//   (the default is next year's label): the six curated / carried elements
//   then come out exactly as they are.
//
// ===================== QUARTERLY ADD-ON REFRESH =========================
// CMS replaces the add-on file each quarter. To take a new one mid-year:
//   1. Run the refresh above with the new file as --addon and its date, and
//      with the SAME --prior and --prior-year as the shipped data was built
//      with (CMS_MORE.priorYear names the year): another prior file would
//      move the 9th element of the rows, and a quarterly refresh must not.
//   2. Read the report's "Add-on and endoscopy changes": each one changes
//      which add-on codes are flagged without a primary.
//   3. Replace "js files/cpt-data.js" and update MORE_BASELINE in check.js
//      from the report. No other baseline moves: the report's other six
//      must be the ones check.js already has. When CMS changed a pair that
//      a check.js test names, these checks go red as well - re-derive their
//      cases from the new table: "add-on table lookups" (its typed codes)
//      and the lead-code proposal's "the four worked cases", "one check per
//      rule" and "every flag and note text". Then README.md's "add-on
//      pairs" date; bump ASSET_V.
//   4. One commit: cpt-data.js + check.js + index.html + README.md.
//
// ============================ DECEMBER SWAP CHECKLIST ===================
// After the report is reviewed and approved:
//   1. LOG PRIOR-YEAR STRAGGLERS FIRST. Entries snapshot wRVU at log time -
//      anything logged after the swap gets new-year values. Finish logging
//      old-year cases before replacing the database.
//   2. Replace "js files/cpt-data.js" with the approved candidate.
//   3. Update CMS_ROW_BASELINE in scripts/check.js to the new row count -
//      DELIBERATELY, in the SAME commit (the report states the count).
//   3b. Update GLOB_BASELINE in scripts/check.js from the report's global
//      period distribution, in the same commit as CMS_ROW_BASELINE.
//   3c. Read "Global period changes": each one relabels the global chip on
//      past History rows of that code. Update any check.js global spot
//      check that CMS changed.
//   3d. Update the policy baselines in scripts/check.js from the report, in
//      the same commit: IND_BASELINE (the four indicator distributions),
//      FAC_SUM_BASELINE, POLICY_HASH_BASELINE, PRIOR_BASELINE and
//      MORE_BASELINE (the add-on and endoscopy tables). Read "Indicator
//      changes" and "Add-on and endoscopy changes": each one changes what
//      the lead-code proposal says about past and future cases of that
//      code. EVERY check.js test that names a code's figures or indicators
//      carries that year's values - re-read them all: the four worked
//      proposal cases, the per-rule cases and the pinned texts, the add-on
//      and endoscopy lookup cases, and the CSV-import fixtures.
//   3e. --prior: decide which year's work RVU the 9th element carries. It
//      does NOT move forward by itself at a swap - pass the same file again
//      to keep it, or a newer one deliberately.
//   3f. --addon: pass the add-on file in force on the day the swap ships
//      (for a January swap the January file, V<year>Q1, once CMS has posted
//      it - the page lists one per quarter) and that quarter's first day.
//   4. Bump ASSET_V in index.html (deploy cache contract).
//   5. Update DATA_VERSION / DATA_YEAR in utils.js.
//   6. Work the report's "New codes - category worklist" and its
//      "Descriptor conflicts" BEFORE the swap commit, editing the candidate
//      directly.
//   7. Deploy atomically: cpt-data.js + check.js + index.html + utils.js
//      in one commit, with README.md's and CLAUDE.md's year words (the
//      prior-year file, "CY<year> figures", the add-on date). npm run check
//      must be green.
// =======================================================================
//
// MERGE PRECEDENCE (per field, for codes present in both years):
//   wRVU        -> CMS always (verified: zero curated wRVU edits exist).
//   descriptor  -> three-way diff on PARSED string values (JS escapes like
//                  < are resolved by evaluation before comparing;
//                  re-escaping happens only at emit):
//                    ours == cms-old, cms-new != cms-old -> take cms-new
//                    ours != cms-old, cms-new == cms-old -> keep ours (curated)
//                    ours != cms-old, cms-new != cms-old -> CONFLICT: keep
//                      ours in the candidate, flag in the report for review
//   category    -> ours (hand-curated), new codes get a nearest-neighbor
//                  guess plus a manual-review worklist entry
//   keywords    -> 5th row element, carried through UNTOUCHED for surviving
//                  codes (curated layer, same protection as descriptors);
//                  new codes get "" keywords
//   global days -> 6th row element: the CMS base-row GLOB DAYS, always
//                  (like wRVU), never curated.
//   indicators  -> 7th row element: ONE string of four digits, the CMS
//                  base-row MULT PROC, BILAT SURG, ASST SURG and CO- SURG
//                  indicators in that order ("2021"). CMS always.
//   facility    -> 8th row element: the FACILITY TOTAL (work + facility
//   total          practice expense + malpractice) a physician is paid for
//                  the code: the professional (-26) row's where CMS prints
//                  one for the code, else the base row's. (On a base row
//                  with a -26 beside it CMS prints the whole service, and
//                  where it marks the facility expense NA that figure is the
//                  office one.) A number, CMS always.
//   prior work  -> 9th row element: the WORK RVU of the same code in the
//                  --prior file: its base row's when that row is payable
//                  (status A, R, B or T - the inclusion rule's list), else
//                  its -26 row's when that one is payable, else null (the
//                  file has no payable row for the code: absent, priced by
//                  the carrier, or not valid that year). So 0 appears only
//                  where CMS prints 0.00 on a payable row. Never derived
//                  from the current value.
//   Every row has 9 elements:
//     [code, desc, wRVU, category, keywords or "", GLOB DAYS,
//      "MBAC" indicator digits, FACILITY TOTAL, prior-year work RVU or null]
//
// A second constant follows the rows, CMS_MORE:
//   addon      { add-on code: "<type>" or "<type>:<tokens>" } for the app's
//              codes that the add-on file lists. Type is the file's edit
//              type: 1 = the listed primaries are the whole list, 2 = no
//              list (contractor-defined), 3 = a partial list. Tokens are
//              separated by spaces; each is one primary code or A-B, a run
//              of codes that sit next to each other in the sorted list of
//              ALL codes of the --input file - so a plain string comparison
//              (A <= code && code <= B) decodes it. Primaries the --input
//              file does not hold follow as single codes.
//   endo       { base code: "member member ..." } for the app's MULT PROC 3
//              codes, by their ENDO BASE.
//   addonAsOf  --addon-date;  priorYear  --prior-year.
//
// INCLUSION RULE (inferred from the CY2026 set, reproduces 7305/7305):
//   base row (blank modifier) work RVU > 0 AND status in {A, R, B, T},
//   minus the EXCLUDE list below.

"use strict";

const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");

// 86153 satisfies the inclusion rule for CY2026 (status A, work RVU > 0)
// but is absent from the shipped set. WHY it is absent is unknown -
// historical omission or deliberate hand-exclusion; no record either way.
// It is listed here ONLY so the tool reproduces today's exact set. Do not
// over-trust this list: revisit at each yearly update whether the code
// should simply be included.
const EXCLUDE = ["86153"];

const APP_ROOT = path.join(__dirname, "..");
const CPT_DATA = path.join(APP_ROOT, "js files", "cpt-data.js");
const UTILS = path.join(APP_ROOT, "js files", "utils.js");

// --- args ---
function arg(name, fallback) {
  const i = process.argv.indexOf("--" + name);
  return i !== -1 && process.argv[i + 1] ? process.argv[i + 1] : fallback;
}
const inputPath = arg("input", null);
const baselinePath = arg("baseline", null);
const priorPath = arg("prior", null);
const priorYear = arg("prior-year", null);
const addonPath = arg("addon", null);
const addonDate = arg("addon-date", null);
const year = arg("year", "2027");
if (!inputPath || !baselinePath || !priorPath || !priorYear || !addonPath || !addonDate) {
  console.error("Usage: node scripts/build-cpt-data.js --input <new PPRRVU csv|xlsx> --baseline <current-year PPRRVU csv|xlsx> --prior <PPRRVU csv|xlsx for the 9th element> --prior-year <YYYY> --addon <NCCI add-on code edits .txt> --addon-date <YYYY-MM-DD> [--year 2027]");
  process.exit(1);
}
if (!/^(19|20)\d\d$/.test(year)) { console.error("--year must be a four-digit year, got " + year); process.exit(1); }
if (!/^(19|20)\d\d$/.test(priorYear)) { console.error("--prior-year must be a four-digit year, got " + priorYear); process.exit(1); }
if (!/^(19|20)\d\d-\d\d-\d\d$/.test(addonDate)) { console.error("--addon-date must be YYYY-MM-DD, got " + addonDate); process.exit(1); }
const outDir = path.dirname(path.resolve(inputPath));
const outCandidate = path.join(outDir, "cpt-data." + year + ".js");
const outReport = path.join(outDir, "cpt-update-REPORT." + year + ".md");

// --- generic table reader: csv (self-parsed) or xlsx (lazy dep) ---
function readTable(p) {
  if (/\.xlsx?$/i.test(p)) {
    const XLSX = require("xlsx"); // devDependency; lazy so csv-only runs never need it
    const wb = XLSX.readFile(p, { raw: true }); // no cellDates: serials/text stay raw
    const ws = wb.Sheets[wb.SheetNames[0]];
    return XLSX.utils.sheet_to_json(ws, { header: 1, defval: "" }).map(r => r.map(c => String(c === null || c === undefined ? "" : c)));
  }
  const lines = fs.readFileSync(p, "utf8").split(/\r?\n/);
  return lines.map(line => {
    const out = [];
    let cur = "", inQ = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') inQ = !inQ;
      else if (ch === "," && !inQ) { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out;
  });
}

// --- header-detecting PPRRVU parser: columns located by NAME (two header
// rows combined), never by fixed index. Hard-fails if the layout drifted.
// `policy` (the --input file only) also requires and reads the payment-policy
// columns; the combined name of the co-surgeon column is "CO- SURG", with a
// space (its header is split over the two rows as "CO-" and "SURG"). ---
const fileYears = {}; // path -> the year its title line states, or null
function parsePPRRVU(p, policy, wantYear) {
  const table = readTable(p);
  let headerIdx = -1;
  for (let i = 0; i < Math.min(table.length, 30); i++) {
    if (String(table[i][0]).trim().toUpperCase() === "HCPCS") { headerIdx = i; break; }
  }
  if (headerIdx === -1) throw new Error(p + ": no HCPCS header row found in the first 30 rows - not a PPRRVU file?");
  // The title line above the header names the year ("2026 National Physician
  // Fee Schedule Relative Value File January Release"). A file of another
  // year than the caller says is refused; a file with no such line is noted
  // in the report for a check by hand.
  let titleYear = null;
  for (let i = 0; i < headerIdx && titleYear === null; i++) {
    const m = /((?:19|20)\d\d) National Physician Fee Schedule Relative Value File/i.exec(table[i].join(" "));
    if (m) titleYear = m[1];
  }
  fileYears[p] = titleYear;
  if (wantYear && titleYear !== null && titleYear !== String(wantYear)) throw new Error(p + ": its title line says " + titleYear + ", but it was passed as the " + wantYear + " file");
  const prev = table[headerIdx - 1] || [];
  const combined = table[headerIdx].map((c, i) => ((String(prev[i] || "") + " " + String(c || "")).replace(/\s+/g, " ").trim().toUpperCase()));
  const twice = [];
  const col = name => { const hits = []; combined.forEach((h, i) => { if (h === name) hits.push(i); }); if (hits.length > 1) twice.push(name); return hits.length ? hits[0] : -1; };
  const cols = {
    code: col("HCPCS"),
    mod: col("MOD"),
    desc: col("DESCRIPTION"),
    status: col("STATUS CODE"),
    work: col("WORK RVU"),
    glob: col("GLOB DAYS")
  };
  const need = ["code", "mod", "desc", "status", "work", "glob"];
  if (policy) {
    cols.mult = col("MULT PROC");
    cols.bilat = col("BILAT SURG");
    cols.asst = col("ASST SURG");
    cols.co = col("CO- SURG");
    cols.fac = col("FACILITY TOTAL");
    cols.endo = col("ENDO BASE");
    need.push("mult", "bilat", "asst", "co", "fac", "endo");
  }
  for (const k of need) {
    if (cols[k] === -1) throw new Error(p + ": required column not found by name (" + k + "). Header layout changed - inspect the file and update the column mapping deliberately. Combined header row: " + combined.slice(0, 26).join(" | "));
  }
  if (twice.length) throw new Error(p + ": a required column name occurs more than once (" + twice.join(", ") + ") - which one is meant cannot be told. Combined header row: " + combined.slice(0, 26).join(" | "));
  // An amount is digits with an optional decimal part. Anything else in WORK
  // RVU stops the run, a blank cell too: CMS prints 0.00 where it has no
  // figure (no CY2025 or CY2026 file, csv or xlsx, holds a blank one on a
  // row with a code), so a blank cell was emptied or its row is cut short -
  // and read as 0 it would pass for "CMS removed the code". (This does NOT
  // catch a QPP file passed by mistake: its blank cells are all on rows
  // without a code, and the codes it lacks have no row at all.) A facility
  // total that is not an amount is NaN and stops the run only for a code the
  // app selects.
  const AMOUNT = /^\d+(\.\d+)?$/;
  const byCode = new Map();
  for (let i = headerIdx + 1; i < table.length; i++) {
    const r = table[i];
    const code = String(r[cols.code] || "").trim();
    if (!/^[A-Z0-9]{5}$/i.test(code)) continue;
    const row = {
      code: code,
      mod: String(r[cols.mod] || "").trim(),
      desc: String(r[cols.desc] || "").trim(),
      status: String(r[cols.status] || "").trim(),
      work: (() => { const t = String(r[cols.work] === undefined || r[cols.work] === null ? "" : r[cols.work]).trim(); if (t === "") throw new Error(p + ": " + code + " has a blank WORK RVU cell - CMS prints 0.00 where it has no figure, so the cell was emptied or the row is cut short: inspect the file"); if (!AMOUNT.test(t)) throw new Error(p + ": " + code + " WORK RVU is not a number: " + JSON.stringify(t)); return parseFloat(t); })(),
      glob: cols.glob === -1 ? "" : String(r[cols.glob] || "").trim()
    };
    if (policy) {
      row.mult = String(r[cols.mult] || "").trim();
      row.bilat = String(r[cols.bilat] || "").trim();
      row.asst = String(r[cols.asst] || "").trim();
      row.co = String(r[cols.co] || "").trim();
      row.facText = String(r[cols.fac] || "").trim();
      row.fac = AMOUNT.test(row.facText) ? parseFloat(row.facText) : NaN;
      row.endo = String(r[cols.endo] || "").trim();
    }
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(row);
  }
  // base row = blank modifier (the TC and 53 variants are ignored, matching
  // the app's data). blankRows / globs feed the selection-time integrity
  // checks. Of the professional (-26) row three things are kept: its work RVU
  // and status (the --prior file: priorWorkOf) and its facility total (the
  // --input file: facOf).
  const base = new Map();
  for (const [code, variants] of byCode) {
    const b = Object.assign({}, variants.find(v => !v.mod) || variants[0]);
    b.blankRows = variants.filter(v => !v.mod).length;
    const pro = variants.filter(v => v.mod === "26");
    if (pro.length > 1) throw new Error(p + ": " + code + " has more than one -26 row - decide deliberately");
    b.work26 = pro.length ? pro[0].work : null;
    b.status26 = pro.length ? pro[0].status : "";
    b.fac26 = pro.length && policy ? pro[0].fac : null;
    b.fac26Text = pro.length && policy ? pro[0].facText : "";
    b.otherInd = policy ? variants.filter(v => v.mod).map(v => ({ mod: v.mod, ind: v.mult + v.bilat + v.asst + v.co })) : [];
    b.globs = [...new Set(variants.map(v => v.glob))];
    base.set(code, b);
  }
  return base;
}

const PAYABLE = ["A", "R", "B", "T"];
function includable(row) {
  return row.work > 0 && PAYABLE.includes(row.status) && !EXCLUDE.includes(row.code);
}
// The 8th element: what a physician is paid in a facility - the -26 row's
// FACILITY TOTAL where the code has one, else the base row's.
function facOf(b) { return b.fac26 !== null ? b.fac26 : b.fac; }
function facTextOf(b) { return b.fac26 !== null ? b.fac26Text : b.facText; }
// Which row that figure was read from: a refused cell is named with its row.
function facRowOf(b) { return b.fac26 !== null ? "-26 row" : "base row"; }

// --- current app data: evaluated, so descriptor/keyword values arrive with
// JS escapes RESOLVED (the diff substrate is parsed strings, per spec) ---
const cptSrc = fs.readFileSync(CPT_DATA, "utf8");
const currentRows = new Function(cptSrc + "; return CMS_RAW;")();
const current = new Map(currentRows.map(r => [r[0], r]));

console.log("current cpt-data.js: " + currentRows.length + " rows (" + currentRows.filter(r => !!r[4]).length + " with inline keywords)");

const cmsOld = parsePPRRVU(path.resolve(baselinePath));
// --baseline is the file the current data was built from: this year's own in
// a refresh, last year's at a swap. A file of any other year would be taken
// for "what CMS said before" in the descriptor rule, so it stops the run (a
// title line that names no year is flagged in the report, as for the others).
const baselineYear = fileYears[path.resolve(baselinePath)];
if (baselineYear !== null && baselineYear !== year && baselineYear !== String(parseInt(year, 10) - 1)) {
  throw new Error(path.resolve(baselinePath) + ": its title line says " + baselineYear + ", but --baseline must be the file the current data was built from - the " + year + " file in a refresh, the " + (parseInt(year, 10) - 1) + " file at a yearly swap");
}
const cmsNew = parsePPRRVU(path.resolve(inputPath), true, year);
const cmsPrior = parsePPRRVU(path.resolve(priorPath), false, priorYear);
// The 9th element: the prior file's work RVU for a code (rule in the header).
function priorWorkOf(code) {
  const pr = cmsPrior.get(code);
  if (!pr) return null;
  if (pr.blankRows > 1) throw new Error(code + ": the --prior file has more than one blank-modifier row for it - decide deliberately");
  if (pr.blankRows === 1 && PAYABLE.includes(pr.status)) return pr.work;
  if (pr.work26 !== null && PAYABLE.includes(pr.status26)) return pr.work26;
  return null;
}
console.log("baseline codes: " + cmsOld.size + " | input codes: " + cmsNew.size + " | prior (" + priorYear + ") codes: " + cmsPrior.size);

// --- CMS NCCI add-on code edits: one fixed-width record per (add-on code,
// primary code) pair. Positions (1-based): 1 edit type; 2-6 add-on code;
// 7-13 add-on code deletion date; 14-18 primary code, or CCCCC for
// "contractor-defined primaries"; 19-25 primary code deletion date; 26-32
// edit effective date; 33-39 edit deletion date; 40+ notes. Dates are
// YYYYDDD (year, day of the year). A deletion date is the LAST day in effect
// (nearly always a quarter's last day), so a pair is live on --addon-date
// when it is in effect by then and none of its three deletion dates is
// before that day. One kind of record is never live: an edit deletion date
// that is NOT AFTER the effective date. CMS writes the two equal, on a
// quarter's first day (18 records of the 2026Q4 file, some with the note
// "Temporarily suspended retroactive to ..."): the pair was withdrawn back
// to its start and was never in effect.
// The run stops on: a file whose text does not end with a line break (CMS
// ends every record with one, so a file cut inside a record shows that way);
// a record that ends before its effective date is complete (32 characters -
// a record whose trailing blanks were trimmed ends there or after its edit
// deletion date, and is read as if the blanks were still there); a record
// that is not in the layout; a file with no live record; an edit that starts
// after --addon-date; a file name whose quarter (V2026Q4) is not the date's.
// A file cut cleanly BETWEEN two records cannot be told from a whole one
// here: the report's "Add-on and endoscopy changes" is the net for that. ---
function dayOfYear(ymd) {
  const y = parseInt(ymd.slice(0, 4), 10), m = parseInt(ymd.slice(5, 7), 10), d = parseInt(ymd.slice(8, 10), 10);
  const t = Date.UTC(y, m - 1, d);
  const back = new Date(t);
  if (back.getUTCFullYear() !== y || back.getUTCMonth() !== m - 1 || back.getUTCDate() !== d) throw new Error("--addon-date is not a real date: " + ymd);
  return y * 1000 + Math.round((t - Date.UTC(y, 0, 1)) / 86400000) + 1;
}
function parseAddon(p, asOf) {
  const text = fs.readFileSync(p, "utf8");
  // (An empty file has no line break either: it is reported below, as a file with no live record.)
  if (text !== "" && !/\n$/.test(text)) throw new Error(p + ": the file does not end with a line break (its last characters are " + JSON.stringify(text.slice(-24)) + ") - CMS's file ends every record with one, so this file is cut short: download it again. If an editor only took the final line break away, put it back");
  const lines = text.split(/\r?\n/).filter(l => l.length > 0);
  const live = new Map(); // add-on code -> { types: Set, prims: Set }
  let liveRows = 0, newest = 0;
  const named = /V((?:19|20)\d\d)Q([1-4])/i.exec(path.basename(p));
  if (named) {
    const dateQuarter = addonDate.slice(0, 4) + "Q" + (Math.floor((parseInt(addonDate.slice(5, 7), 10) - 1) / 3) + 1);
    if ((named[1] + "Q" + named[2]).toUpperCase() !== dateQuarter) throw new Error(p + ": its name says " + named[1] + "Q" + named[2] + ", but --addon-date " + addonDate + " is in " + dateQuarter);
  }
  lines.forEach((line, i) => {
    if (line.length < 32) throw new Error(p + " line " + (i + 1) + ": a record that ends before its effective date is complete (a damaged line, or a file cut short?): " + JSON.stringify(line));
    // Trailing blanks trimmed away (a blank edit deletion date, no notes): put them back, so every field is sliced from a whole record.
    const l = line.length < 39 ? (line + "       ").slice(0, 39) : line;
    const rec = { type: l.slice(0, 1), aoc: l.slice(1, 6), aocDel: l.slice(6, 13).trim(), prim: l.slice(13, 18), primDel: l.slice(18, 25).trim(), eff: l.slice(25, 32).trim(), del: l.slice(32, 39).trim() };
    const dateOk = v => v === "" || /^\d{7}$/.test(v);
    if (!/^[123]$/.test(rec.type) || !/^[A-Z0-9]{5}$/.test(rec.aoc) || !/^[A-Z0-9]{5}$/.test(rec.prim) || !dateOk(rec.aocDel) || !dateOk(rec.primDel) || !/^\d{7}$/.test(rec.eff) || !dateOk(rec.del)) {
      throw new Error(p + " line " + (i + 1) + ": not an add-on code edit record (layout changed?): " + JSON.stringify(line.slice(0, 40)));
    }
    if (parseInt(rec.eff, 10) > newest) newest = parseInt(rec.eff, 10);
    // Withdrawn back to its start (see above): never in effect, whatever the date.
    if (rec.del !== "" && parseInt(rec.del, 10) <= parseInt(rec.eff, 10)) return;
    const gone = v => v !== "" && parseInt(v, 10) < asOf;
    if (gone(rec.aocDel) || gone(rec.primDel) || gone(rec.del) || parseInt(rec.eff, 10) > asOf) return;
    liveRows++;
    if (!live.has(rec.aoc)) live.set(rec.aoc, { types: new Set(), prims: new Set() });
    const o = live.get(rec.aoc);
    o.types.add(rec.type);
    if (rec.prim !== "CCCCC") o.prims.add(rec.prim);
  });
  if (liveRows === 0) throw new Error(p + ": no add-on record is live on " + addonDate + " - an empty file, or the wrong --addon-date");
  if (newest > asOf) throw new Error(p + ": it holds an edit that starts on day " + newest + ", after --addon-date " + addonDate + " (" + asOf + ") - pass the day this file took effect");
  return { lines: lines.length, liveRows: liveRows, live: live };
}
const addonAsOf = dayOfYear(addonDate);
const addon = parseAddon(path.resolve(addonPath), addonAsOf);
console.log("add-on file: " + addon.lines + " records, " + addon.liveRows + " live on " + addonDate + " for " + addon.live.size + " add-on codes");

// --- merge ---
const candidate = [];
const report = {
  kept: 0, added: [], removed: [], rvuChanged: [],
  descTookCms: [], descKeptOurs: 0, descConflicts: [],
  newCategoryWorklist: [], keywordRows: 0, globChanged: [], modGlobDiffers: [], indChanged: [], modIndDiffers: [], facFrom26: []
};

// surviving + new set from the input year
const selected = [];
for (const [code, row] of cmsNew) {
  if (includable(row)) selected.push(code);
}
selected.sort();
// Each selected code must have exactly ONE blank-modifier (base) row - its
// wRVU and global come from it. Modifier rows with a different global are
// listed for information (the app uses the base row only).
const badBase = selected.filter(c => cmsNew.get(c).blankRows !== 1);
if (badBase.length) throw new Error("codes without exactly one blank-modifier row (decide each: add to EXCLUDE like 86153, or handle deliberately): " + badBase.slice(0, 20).join(", "));
selected.forEach(c => { const g = cmsNew.get(c).globs; if (g.length > 1) report.modGlobDiffers.push({ code: c, globs: g }); });
// For the report: modifier rows whose four indicators are not the base row's
// (the app carries the base row's), and the codes whose facility total is
// taken from the -26 row.
selected.forEach(c => {
  const b = cmsNew.get(c), ind = b.mult + b.bilat + b.asst + b.co;
  b.otherInd.forEach(o => { if (o.ind !== ind) report.modIndDiffers.push({ code: c, mod: o.mod, ind: o.ind, base: ind }); });
  if (b.fac26 !== null && b.fac26 !== b.fac) report.facFrom26.push({ code: c, fac26: b.fac26, fac: b.fac, ranked: b.mult === "2" || b.mult === "3" });
});
// Payment-policy columns of each selected code's base row: ONE digit each,
// from the values the app handles (CMS's layout also documents MULT PROC 1,
// which no code carries: it stops the run like any other new value); a
// facility total above zero and not below the work RVU; an endoscopy
// base on exactly the MULT PROC 3 codes, and that base is itself a selected
// code that follows the standard rule (MULT PROC 2) and belongs to no family.
// Anything else is a policy or layout change: handle it deliberately (here,
// utils.js proposeCaseModifiers, check.js) instead of emitting it.
const IND_VALUES = { mult: "02345679", bilat: "01239", asst: "0129", co: "0129" };
const pickedSet = new Set(selected);
selected.forEach(c => {
  const b = cmsNew.get(c);
  Object.keys(IND_VALUES).forEach(k => {
    if (b[k].length !== 1 || IND_VALUES[k].indexOf(b[k]) === -1) throw new Error(c + ": CMS indicator " + k + " is " + JSON.stringify(b[k]) + ", not one of " + IND_VALUES[k].split("").join(" ") + " - add it deliberately (generator, utils.js, check.js)");
  });
  if (!(facOf(b) > 0) || !isFinite(facOf(b))) throw new Error(c + " (" + facRowOf(b) + "): FACILITY TOTAL is not an amount above zero: " + JSON.stringify(facTextOf(b)));
  if (facOf(b) < b.work) throw new Error(c + " (" + facRowOf(b) + "): FACILITY TOTAL " + facOf(b) + " is below its work RVU " + b.work + " - it holds the work RVU, so this is a layout change or a damaged cell");
  if ((b.mult === "3") !== (b.endo !== "")) throw new Error(c + ": MULT PROC is " + b.mult + " but ENDO BASE is " + JSON.stringify(b.endo) + " - CMS fills the base on exactly the MULT PROC 3 codes");
  if (b.endo !== "") {
    const base = cmsNew.get(b.endo);
    if (!pickedSet.has(b.endo) || !base || base.mult !== "2" || base.endo !== "") throw new Error(c + ": its endoscopy base " + b.endo + " is not a selected MULT PROC 2 code outside any family - decide deliberately");
  }
});

// nearest-neighbor category guess for new numeric codes
const numericCurrent = currentRows.filter(r => /^\d{5}$/.test(r[0])).map(r => ({ n: parseInt(r[0], 10), cat: r[3] })).sort((a, b) => a.n - b.n);
function guessCategory(code) {
  if (!/^\d{5}$/.test(code)) return { cat: "Other", confidence: "none (non-numeric code)" };
  const n = parseInt(code, 10);
  let lo = null, hi = null;
  for (const e of numericCurrent) {
    if (e.n < n) lo = e;
    if (e.n > n) { hi = e; break; }
  }
  if (lo && hi && lo.cat === hi.cat) return { cat: lo.cat, confidence: "high (neighbors agree: " + lo.n + "/" + hi.n + ")" };
  const near = (lo && hi) ? ((n - lo.n) <= (hi.n - n) ? lo : hi) : (lo || hi);
  if (near && Math.abs(near.n - n) <= 200) return { cat: near.cat, confidence: "low (nearest " + near.n + ")" };
  return { cat: "Other", confidence: "none" };
}

for (const code of selected) {
  const nu = cmsNew.get(code);
  const ours = current.get(code);
  if (ours) {
    // surviving code: CMS wRVU, our category, three-way descriptor, keywords untouched
    const old = cmsOld.get(code);
    // Without its baseline row the descriptor rule cannot tell a curated
    // descriptor from CMS's old one, and would quietly keep ours.
    if (!old) throw new Error(code + ": the current data holds this code, but --baseline has no row for it - --baseline is not the file the current data was built from (the QPP file, or another year's), or it is cut short");
    const oursDesc = ours[1];
    const oldDesc = old ? old.desc : null;
    let desc = oursDesc;
    if (old && oursDesc.trim().toLowerCase() === oldDesc.trim().toLowerCase()) {
      // never curated - follow CMS
      if (nu.desc.trim().toLowerCase() !== oldDesc.trim().toLowerCase()) {
        desc = nu.desc;
        report.descTookCms.push({ code, from: oldDesc, to: nu.desc });
      }
    } else if (old) {
      // curated by us
      if (nu.desc.trim().toLowerCase() !== oldDesc.trim().toLowerCase()) {
        report.descConflicts.push({ code, ours: oursDesc, cmsOld: oldDesc, cmsNew: nu.desc });
        // keep ours in the candidate; the report decides
      } else {
        report.descKeptOurs++;
      }
    }
    if (Math.abs(nu.work - ours[2]) >= 0.005) report.rvuChanged.push({ code, from: ours[2], to: nu.work, desc: desc });
    // curated keywords untouched ("" when none); global always from CMS
    const row = [code, desc, nu.work, ours[3], ours[4] || "", nu.glob];
    if (ours[4]) report.keywordRows++;
    const prevGlob = ours[5] !== undefined ? ours[5] : (old ? old.glob : nu.glob);
    if (prevGlob !== nu.glob) report.globChanged.push({ code, from: prevGlob, to: nu.glob, desc: desc });
    candidate.push(row);
    report.kept++;
  } else {
    // new code
    const g = guessCategory(code);
    candidate.push([code, nu.desc, nu.work, g.cat, "", nu.glob]);
    report.added.push({ code, desc: nu.desc, work: nu.work, cat: g.cat, confidence: g.confidence });
    report.newCategoryWorklist.push({ code, desc: nu.desc, guess: g.cat, confidence: g.confidence });
  }
}

// --- the three CMS policy elements, appended to every row (indexes 6-8):
// the four indicator digits, the facility total (facOf) and the work RVU of
// the same code in the --prior file (priorWorkOf) ---
candidate.forEach(r => {
  const nu = cmsNew.get(r[0]), ours = current.get(r[0]);
  const ind = nu.mult + nu.bilat + nu.asst + nu.co;
  if (ours && typeof ours[6] === "string" && ours[6] !== ind) report.indChanged.push({ code: r[0], from: ours[6], to: ind, desc: r[1] });
  r.push(ind, facOf(nu), priorWorkOf(r[0]));
});

// --- CMS_MORE: the add-on pairs and the endoscopy families of the selected
// codes (encodings in the header comment) ---
const allCodes = [...cmsNew.keys()].sort();
const codePos = new Map(allCodes.map((c, i) => [c, i]));
function primaryTokens(prims) {
  const known = prims.filter(p => codePos.has(p)).sort((a, b) => codePos.get(a) - codePos.get(b));
  const unknown = prims.filter(p => !codePos.has(p)).sort();
  const out = [];
  let s = null, e = null;
  known.forEach(p => {
    if (s === null) { s = e = p; }
    else if (codePos.get(p) === codePos.get(e) + 1) e = p;
    else { out.push(s === e ? s : s + "-" + e); s = e = p; }
  });
  if (s !== null) out.push(s === e ? s : s + "-" + e);
  return out.concat(unknown);
}
const addonTable = [];
const addonStats = { codes: 0, types: { "1": 0, "2": 0, "3": 0 }, tokens: 0, chars: 0 };
let addonPairs = 0; // listed (add-on, primary) pairs behind the tokens - report only
selected.forEach(c => {
  const o = addon.live.get(c);
  if (!o) return;
  if (o.types.size !== 1) throw new Error(c + ": the add-on file gives it more than one edit type among its live rows (" + [...o.types].join(", ") + ") - decide deliberately");
  const t = [...o.types][0];
  const prims = [...o.prims];
  if (t === "1" && prims.length === 0) throw new Error(c + ": a type 1 add-on code with no live primary - decide deliberately");
  if (t === "2" && prims.length > 0) throw new Error(c + ": a type 2 add-on code with listed primaries - decide deliberately");
  const toks = primaryTokens(prims);
  const value = t + (toks.length ? ":" + toks.join(" ") : "");
  addonTable.push([c, value]);
  addonStats.codes++; addonStats.types[t]++; addonStats.tokens += toks.length; addonStats.chars += value.length;
  addonPairs += prims.length;
});
const endoFamilies = new Map();
selected.forEach(c => {
  const b = cmsNew.get(c);
  if (b.mult !== "3") return;
  if (!endoFamilies.has(b.endo)) endoFamilies.set(b.endo, []);
  endoFamilies.get(b.endo).push(c);
});
const endoTable = [...endoFamilies.keys()].sort().map(base => [base, endoFamilies.get(base).join(" ")]);
const endoStats = { bases: endoTable.length, members: endoTable.reduce((n, e) => n + e[1].split(" ").length, 0) };

// removed codes + dangling curated references
const selectedSet = new Set(selected);
for (const [code, r] of current) {
  if (!selectedSet.has(code)) {
    const nu = cmsNew.get(code);
    report.removed.push({ code, desc: r[1], work: r[2], newStatus: nu ? nu.status : "(absent from file)", newWork: nu ? nu.work : null });
  }
}

// utils.js curated-map cross-reference for dangling codes
function sectionCodes(src, startMarker, endMarker, regex) {
  const s = src.indexOf(startMarker);
  if (s === -1) return [];
  const e = endMarker ? src.indexOf(endMarker, s) : -1;
  const chunk = src.slice(s, e === -1 ? s + 400000 : e);
  const out = new Set();
  let m;
  while ((m = regex.exec(chunk)) !== null) out.add(m[1]);
  return [...out];
}
const utilsSrc = fs.readFileSync(UTILS, "utf8");
const refSections = {
  KEYWORD_SUPPLEMENT: sectionCodes(utilsSrc, "var KEYWORD_SUPPLEMENT", "var FRIENDLY_DESC", /"([0-9A-Z]{5})"\s*:/g),
  FRIENDLY_DESC: sectionCodes(utilsSrc, "var FRIENDLY_DESC", "var COMPANION_CODES", /"([0-9A-Z]{5})"\s*:/g),
  COMPANION_CODES_keys: sectionCodes(utilsSrc, "var COMPANION_CODES", "\nfunction", /"([0-9A-Z]{5})"\s*:/g),
  COMPANION_CODES_targets: sectionCodes(utilsSrc, "var COMPANION_CODES", "\nfunction", /code:\s*"([0-9A-Z]{5})"/g)
};
const removedSet = new Set(report.removed.map(r => r.code));
const dangling = [];
for (const [section, codes] of Object.entries(refSections)) {
  for (const code of codes) {
    if (removedSet.has(code)) dangling.push({ section, code });
  }
}

// --- emit candidate ---
function jsStr(s) {
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const ch = s[i], cc = s.charCodeAt(i);
    if (ch === "\\") out += "\\\\";
    else if (ch === '"') out += '\\"';
    else if (ch === "<") out += "\\u003c";
    else if (ch === ">") out += "\\u003e";
    else if (cc < 32 || cc > 126) out += "\\u" + ("0000" + cc.toString(16)).slice(-4);
    else out += ch;
  }
  return '"' + out + '"';
}
// wRVU keeps the shipped file's format: whole numbers as "4.0", not "4".
function emitNum(n) { return Number.isInteger(n) ? n.toFixed(1) : String(n); }
// The facility total and the prior-year work RVU print as plain numbers
// ("23", not "23.0"); a missing prior value prints as null.
function emitRow(r) {
  return "[" + jsStr(r[0]) + "," + jsStr(r[1]) + "," + emitNum(r[2]) + "," + jsStr(r[3]) + "," + jsStr(r[4] || "") + "," + jsStr(r[5]) +
    "," + jsStr(r[6]) + "," + String(r[7]) + "," + (r[8] === null ? "null" : String(r[8])) + "]";
}
// One row per line, and one table entry per line, so a change to a few codes
// is a diff of a few lines.
function emitTable(t) { return "{\n" + t.map(e => jsStr(e[0]) + ":" + jsStr(e[1])).join(",\n") + "\n}"; }
const body = "const CMS_RAW=[\n" + candidate.map(emitRow).join(",\n") + "\n];\n" +
  "const CMS_MORE={\"addonAsOf\":" + jsStr(addonDate) + ",\"priorYear\":" + priorYear + ",\"addon\":" + emitTable(addonTable) + ",\"endo\":" + emitTable(endoTable) + "};\n";

// self-validation BEFORE writing: parseable, ASCII, no raw angle brackets
parser.parse(body, { sourceType: "script" });
const nonAscii = body.search(/[^\x00-\x7f]/);
if (nonAscii !== -1) throw new Error("candidate contains non-ASCII at index " + nonAscii);
if (/[<>]/.test(body)) throw new Error("candidate contains raw < or > - escaping bug");
const evaluated = new Function(body + "; return [CMS_RAW, CMS_MORE];")();
const roundTrip = evaluated[0], moreTrip = evaluated[1];
if (roundTrip.length !== candidate.length) throw new Error("round-trip row count mismatch");
// Asserts on the EMITTED rows: 9 elements, a known CMS global equal to the
// input file's base row, every curated keyword row carried, and the three
// policy elements equal to the input and the prior file.
const GLOB_VALUES = /^(000|010|090|XXX|ZZZ|YYY|MMM)$/;
const globDist = {};
const indDist = { mult: {}, bilat: {}, asst: {}, co: {} };
let facCents = 0, priorCents = 0, priorNull = 0, priorZero = 0;
// One fingerprint over every row's CMS elements - wRVU, global, indicators,
// facility total, prior-year value - and one over each table (FNV-1a, 32
// bit, as 8 hex digits; check.js computes the same from the shipped file),
// so a hand edit that keeps every count and sum still shows.
function fnv1a(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return ("0000000" + h.toString(16)).slice(-8); }
let policyText = "";
roundTrip.forEach(r => {
  if (r.length !== 9) throw new Error(r[0] + ": emitted row does not have 9 elements");
  if (!GLOB_VALUES.test(r[5])) throw new Error(r[0] + ": unknown CMS GLOB DAYS value " + JSON.stringify(r[5]) + " - add it deliberately (generator, utils.js getGlobalDays, check.js)");
  const nu = cmsNew.get(r[0]);
  if (r[2] !== nu.work) throw new Error(r[0] + ": emitted wRVU differs from the input file");
  if (r[5] !== nu.glob) throw new Error(r[0] + ": emitted global differs from the input file");
  if (typeof r[6] !== "string" || r[6] !== nu.mult + nu.bilat + nu.asst + nu.co || !/^[0-9]{4}$/.test(r[6])) throw new Error(r[0] + ": emitted indicators differ from the input file");
  if (typeof r[7] !== "number" || r[7] !== facOf(nu) || !(r[7] > 0) || r[7] < r[2]) throw new Error(r[0] + ": emitted facility total differs from the input file");
  const wantPrior = priorWorkOf(r[0]);
  if (r[8] !== wantPrior || !(r[8] === null || (typeof r[8] === "number" && r[8] >= 0))) throw new Error(r[0] + ": emitted prior-year work RVU differs from the prior file");
  globDist[r[5]] = (globDist[r[5]] || 0) + 1;
  ["mult", "bilat", "asst", "co"].forEach((k, i) => { const d = r[6].charAt(i); indDist[k][d] = (indDist[k][d] || 0) + 1; });
  facCents += Math.round(r[7] * 100);
  if (r[8] === null) priorNull++; else { priorCents += Math.round(r[8] * 100); if (r[8] === 0) priorZero++; }
  policyText += r[0] + "|" + r[2] + "|" + r[5] + "|" + r[6] + "|" + r[7] + "|" + r[8] + "\n";
});
const policyHash = fnv1a(policyText);
const tableHash = t => fnv1a(Object.keys(t).sort().map(k => k + ":" + t[k]).join("\n"));
if (roundTrip.filter(r => !!r[4]).length !== report.keywordRows) throw new Error("keyword rows lost in emit");
// Asserts on the EMITTED tables: every key is a selected code; an add-on
// value is "<type>" or "<type>:<tokens>" and decodes (by string comparison)
// to exactly the live primaries of the add-on file that the input file
// holds; every endoscopy member is a selected MULT PROC 3 code whose base is
// its key.
const TOKEN = /^[0-9A-Z]{5}(-[0-9A-Z]{5})?$/;
if (moreTrip.addonAsOf !== addonDate || moreTrip.priorYear !== parseInt(priorYear, 10)) throw new Error("CMS_MORE dates lost in emit");
if (Object.keys(moreTrip.addon).length !== addonTable.length || Object.keys(moreTrip.endo).length !== endoTable.length) throw new Error("CMS_MORE table sizes changed in emit (a duplicate key?)");
Object.keys(moreTrip.addon).forEach(c => {
  const v = moreTrip.addon[c], o = addon.live.get(c);
  if (!pickedSet.has(c) || !o) throw new Error(c + ": add-on table key is not a selected add-on code");
  const m = /^([123])(?::(.+))?$/.exec(v);
  if (!m) throw new Error(c + ": add-on table value is malformed: " + JSON.stringify(v));
  const toks = m[2] ? m[2].split(" ") : [];
  toks.forEach(t => { if (!TOKEN.test(t)) throw new Error(c + ": add-on token is malformed: " + JSON.stringify(t)); });
  const allows = p => toks.some(t => t.length === 5 ? t === p : (t.slice(0, 5) <= p && p <= t.slice(6)));
  allCodes.forEach(p => { if (allows(p) !== o.prims.has(p)) throw new Error(c + ": add-on tokens decode wrongly for primary " + p); });
  o.prims.forEach(p => { if (!allows(p)) throw new Error(c + ": add-on tokens lose primary " + p); });
});
Object.keys(moreTrip.endo).forEach(base => {
  if (!pickedSet.has(base)) throw new Error(base + ": endoscopy base is not a selected code");
  moreTrip.endo[base].split(" ").forEach(c => { const b = cmsNew.get(c); if (!pickedSet.has(c) || !b || b.mult !== "3" || b.endo !== base) throw new Error(c + ": endoscopy table member does not match the input file"); });
});
if (endoStats.members !== (indDist.mult["3"] || 0)) throw new Error("endoscopy table does not hold every MULT PROC 3 code");
addonStats.hash = tableHash(moreTrip.addon);
endoStats.hash = tableHash(moreTrip.endo);

fs.writeFileSync(outCandidate, body, "utf8");

// --- report ---
const topRvu = report.rvuChanged.slice().sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from)).slice(0, 25);
const md = [];
md.push("# CPT database update report - CY" + year);
md.push("");
const nowD = new Date(), two = n => (n < 10 ? "0" : "") + n;
const saysYear = p => fileYears[path.resolve(p)] === null ? "**its title line names no year - check it by hand**" : "its title line says " + fileYears[path.resolve(p)];
md.push("Generated " + nowD.getFullYear() + "-" + two(nowD.getMonth() + 1) + "-" + two(nowD.getDate()) + " by scripts/build-cpt-data.js");
md.push("Input: " + path.resolve(inputPath) + " (" + saysYear(inputPath) + ")");
md.push("Baseline: " + path.resolve(baselinePath) + " (" + saysYear(baselinePath) + ")");
md.push("Prior: " + path.resolve(priorPath) + " (passed as " + priorYear + "; " + saysYear(priorPath) + ")");
md.push("Add-on: " + path.resolve(addonPath) + " (as of " + addonDate + ")");
md.push("");
md.push("## Counts");
md.push("");
md.push("| | |");
md.push("|---|---|");
md.push("| Candidate rows | **" + candidate.length + "** (this is the new CMS_ROW_BASELINE for check.js) |");
md.push("| Kept from current set | " + report.kept + " |");
md.push("| Added | " + report.added.length + " |");
md.push("| Removed | " + report.removed.length + " |");
md.push("| wRVU changed | " + report.rvuChanged.length + " |");
md.push("| Descriptors: took CMS update | " + report.descTookCms.length + " |");
md.push("| Descriptors: kept our curation | " + report.descKeptOurs + " |");
md.push("| Descriptors: CONFLICTS to review | **" + report.descConflicts.length + "** |");
md.push("| Inline keyword rows carried | " + report.keywordRows + " |");
md.push("| Dangling curated references | **" + dangling.length + "** |");
md.push("| Global period distribution (the new GLOB_BASELINE for check.js) | `" + JSON.stringify(globDist) + "` |");
md.push("| Global period changes | **" + report.globChanged.length + "** |");
md.push("| Modifier rows with a different global (info) | " + report.modGlobDiffers.length + " |");
md.push("| Modifier rows with other indicators than the base row (info) | " + report.modIndDiffers.length + " |");
md.push("| Facility total taken from the -26 row where it is another figure (info) | " + report.facFrom26.length + " codes, " + report.facFrom26.filter(c => c.ranked).length + " of them ranked (MULT PROC 2 or 3) |");
md.push("| Indicator distributions (the new IND_BASELINE for check.js) | `" + JSON.stringify(indDist) + "` |");
md.push("| Facility totals, summed in cents (the new FAC_SUM_BASELINE) | `" + facCents + "` |");
md.push("| Fingerprint of every row's wRVU, global, indicators, facility total and prior-year value (the new POLICY_HASH_BASELINE) | `" + policyHash + "` |");
md.push("| Prior-year (" + priorYear + ") work RVU (the new PRIOR_BASELINE) | `" + JSON.stringify({ year: parseInt(priorYear, 10), cents: priorCents, none: priorNull, zero: priorZero }) + "` |");
md.push("| Add-on and endoscopy tables (the new MORE_BASELINE) | `" + JSON.stringify({ addonAsOf: addonDate, addon: addonStats, endo: endoStats }) + "` |");
md.push("| Add-on pairs behind the tokens (info) | " + addonPairs + " listed pairs for " + addonStats.codes + " codes; " + addon.liveRows + " live records for " + addon.live.size + " add-on codes in the whole file |");
md.push("| Indicator changes | **" + report.indChanged.length + "** |");
// What changed in the two tables against the shipped CMS_MORE (none when the
// shipped file has no CMS_MORE yet).
const shippedMore = new Function(cptSrc + "; return typeof CMS_MORE !== 'undefined' && CMS_MORE ? CMS_MORE : null;")();
const moreChanged = [];
if (shippedMore && shippedMore.addon && shippedMore.endo) {
  const oldA = shippedMore.addon, newA = moreTrip.addon;
  Object.keys(newA).sort().forEach(c => { if (!Object.prototype.hasOwnProperty.call(oldA, c)) moreChanged.push("add-on " + c + ": new entry " + newA[c]); else if (oldA[c] !== newA[c]) moreChanged.push("add-on " + c + ": " + oldA[c] + " -> " + newA[c]); });
  Object.keys(oldA).sort().forEach(c => { if (!Object.prototype.hasOwnProperty.call(newA, c)) moreChanged.push("add-on " + c + ": entry gone (was " + oldA[c] + ")"); });
  const famOf = t => { const o = {}; Object.keys(t).forEach(b => String(t[b]).split(" ").forEach(c => { if (c) o[c] = b; })); return o; };
  const oldF = famOf(shippedMore.endo), newF = famOf(moreTrip.endo);
  Object.keys(newF).sort().forEach(c => { if (!Object.prototype.hasOwnProperty.call(oldF, c)) moreChanged.push("endoscopy " + c + ": now in the family of " + newF[c]); else if (oldF[c] !== newF[c]) moreChanged.push("endoscopy " + c + ": family of " + oldF[c] + " -> " + newF[c]); });
  Object.keys(oldF).sort().forEach(c => { if (!Object.prototype.hasOwnProperty.call(newF, c)) moreChanged.push("endoscopy " + c + ": no longer in a family (was " + oldF[c] + ")"); });
}
md.push("| Add-on and endoscopy changes | **" + (shippedMore ? moreChanged.length : "n/a (the shipped file has no tables yet)") + "** |");
md.push("");
md.push("## Add-on and endoscopy changes (" + moreChanged.length + ")");
md.push("");
md.push("Against the shipped tables. Each add-on change alters which add-on codes are flagged without a primary; each endoscopy change alters which scopes are left as entered.");
md.push("");
if (moreChanged.length === 0) md.push("None.");
moreChanged.forEach(c => md.push("- " + c));
md.push("");
md.push("## Indicator changes (" + report.indChanged.length + ")");
md.push("");
md.push("Digits are MULT PROC, BILAT SURG, ASST SURG, CO- SURG. Each change alters what the lead-code proposal says about cases of that code.");
md.push("");
if (report.indChanged.length === 0) md.push("None.");
report.indChanged.forEach(c => md.push("- " + c.code + ": " + c.from + " -> " + c.to + " (" + c.desc.replace(/\|/g, "/") + ")"));
md.push("");
md.push("## Global period changes (" + report.globChanged.length + ")");
md.push("");
md.push("Each relabels the global chip on past History rows of that code.");
md.push("");
if (report.globChanged.length === 0) md.push("None.");
report.globChanged.forEach(c => md.push("- " + c.code + ": " + c.from + " -> " + c.to + " (" + c.desc.replace(/\|/g, "/") + ")"));
md.push("");
md.push("## Modifier rows with a different global (" + report.modGlobDiffers.length + ")");
md.push("");
if (report.modGlobDiffers.length === 0) md.push("None.");
report.modGlobDiffers.forEach(c => md.push("- " + c.code + ": " + c.globs.join(", ")));
md.push("");
md.push("## Modifier rows with other indicators than the base row (" + report.modIndDiffers.length + ")");
md.push("");
md.push("The app carries the base row's four digits (MULT PROC, BILAT SURG, ASST SURG, CO- SURG). Listed so a row that says otherwise is seen.");
md.push("");
if (report.modIndDiffers.length === 0) md.push("None.");
report.modIndDiffers.forEach(c => md.push("- " + c.code + "-" + c.mod + ": " + c.ind + " (base row " + c.base + ")"));
md.push("");
md.push("## Ranked codes whose facility total comes from the -26 row (" + report.facFrom26.filter(c => c.ranked).length + " of " + report.facFrom26.length + " codes)");
md.push("");
md.push("The 8th row element is the professional row's FACILITY TOTAL where the code has one. Only ranked codes use it (a tie in work RVU, and the second order of the lead-code proposal), so those are listed.");
md.push("");
if (report.facFrom26.filter(c => c.ranked).length === 0) md.push("None.");
report.facFrom26.filter(c => c.ranked).forEach(c => md.push("- " + c.code + ": " + c.fac26 + " (base row " + c.fac + ")"));
md.push("");
md.push("## Top " + topRvu.length + " wRVU changes");
md.push("");
md.push("| Code | From | To | Delta | Descriptor |");
md.push("|---|---|---|---|---|");
topRvu.forEach(c => md.push("| " + c.code + " | " + c.from + " | " + c.to + " | " + (c.to - c.from > 0 ? "+" : "") + (c.to - c.from).toFixed(2) + " | " + c.desc.replace(/\|/g, "/") + " |"));
md.push("");
md.push("## Descriptor conflicts (ours kept in candidate - decide each)");
md.push("");
if (report.descConflicts.length === 0) md.push("None.");
report.descConflicts.forEach(c => {
  md.push("- **" + c.code + "**");
  md.push("  - ours (kept): " + c.ours);
  md.push("  - CMS " + (parseInt(year, 10) - 1) + ": " + c.cmsOld);
  md.push("  - CMS " + year + ": " + c.cmsNew);
});
md.push("");
md.push("## Removed codes (" + report.removed.length + ")");
md.push("");
if (report.removed.length === 0) md.push("None.");
report.removed.forEach(r => md.push("- " + r.code + " (" + r.desc.replace(/\|/g, "/") + ") - new status: " + r.newStatus + (r.newWork !== null ? ", work " + r.newWork : "")));
md.push("");
md.push("## Dangling curated references (utils.js still mentions removed codes)");
md.push("");
if (dangling.length === 0) md.push("None.");
dangling.forEach(d => md.push("- " + d.section + ": " + d.code));
md.push("");
md.push("## New codes - category worklist (" + report.newCategoryWorklist.length + ")");
md.push("");
if (report.newCategoryWorklist.length === 0) md.push("None.");
report.newCategoryWorklist.forEach(w => md.push("- " + w.code + " -> \"" + w.guess + "\" [" + w.confidence + "] " + w.desc.replace(/\|/g, "/")));
md.push("");
md.push("## Swap checklist");
md.push("");
md.push("See the header comment in scripts/build-cpt-data.js. Key points: log prior-year stragglers BEFORE the swap (entries snapshot wRVU at log time); update check.js CMS_ROW_BASELINE to " + candidate.length + ", GLOB_BASELINE to the distribution above and the five policy baselines (IND_BASELINE, FAC_SUM_BASELINE, POLICY_HASH_BASELINE, PRIOR_BASELINE, MORE_BASELINE) in the same commit; bump ASSET_V; update DATA_VERSION/DATA_YEAR; deploy atomically.");
md.push("");
fs.writeFileSync(outReport, md.join("\n"), "utf8");

console.log("candidate: " + outCandidate + " (" + candidate.length + " rows, " + report.keywordRows + " keyword rows)");
console.log("report:    " + outReport);
console.log("added " + report.added.length + " | removed " + report.removed.length + " | rvu changed " + report.rvuChanged.length + " | conflicts " + report.descConflicts.length + " | dangling " + dangling.length + " | indicators changed " + report.indChanged.length);
console.log("policy: indicators " + JSON.stringify(indDist) + " | facility cents " + facCents + " | prior " + priorYear + " cents " + priorCents + ", none " + priorNull + ", zero " + priorZero + " | fingerprint " + policyHash);
console.log("tables: add-on " + JSON.stringify(addonStats) + " | endoscopy " + JSON.stringify(endoStats) + " | " + Buffer.byteLength(body, "utf8") + " bytes");
