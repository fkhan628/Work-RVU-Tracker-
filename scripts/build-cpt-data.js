#!/usr/bin/env node
// =======================================================================
// build-cpt-data.js - yearly CPT database update pipeline. LOCAL TOOLING:
// nothing here ships to the app; outputs are a candidate data file and a
// review report that gets human approval before any swap.
//
// USAGE:
//   node scripts/build-cpt-data.js \
//     --input    "..\CMS 2027\PPRRVU2027_Jan_nonQPP.csv"   (csv or xlsx)
//     --baseline "..\CMS 2026\PPRRVU2026_Jan_nonQPP.csv"   (the CURRENT year's file)
//     [--year 2027]
//   Outputs land NEXT TO the --input file (outside the repo):
//     cpt-data.<year>.js  and  cpt-update-REPORT.<year>.md
//
// ============================ DECEMBER SWAP CHECKLIST ===================
// After the report is reviewed and approved:
//   1. LOG PRIOR-YEAR STRAGGLERS FIRST. Entries snapshot wRVU at log time -
//      anything logged after the swap gets new-year values. Finish logging
//      old-year cases before replacing the database.
//   2. Replace "js files/cpt-data.js" with the approved candidate.
//   3. Update CMS_ROW_BASELINE in scripts/check.js to the new row count -
//      DELIBERATELY, in the SAME commit (the report states the count).
//   4. Bump ASSET_V in index.html (deploy cache contract).
//   5. Update DATA_VERSION / DATA_YEAR in utils.js.
//   6. Work the report's "needs manual category" worklist and descriptor
//      conflicts BEFORE the swap commit, editing the candidate directly.
//   7. Deploy atomically: cpt-data.js + check.js + index.html + utils.js
//      in one commit. npm run check must be green.
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
//                  new codes emit 4-tuples
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
const year = arg("year", "2027");
if (!inputPath || !baselinePath) {
  console.error("Usage: node scripts/build-cpt-data.js --input <new PPRRVU csv|xlsx> --baseline <current-year PPRRVU csv|xlsx> [--year 2027]");
  process.exit(1);
}
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
// rows combined), never by fixed index. Hard-fails if the layout drifted. ---
function parsePPRRVU(p) {
  const table = readTable(p);
  let headerIdx = -1;
  for (let i = 0; i < Math.min(table.length, 30); i++) {
    if (String(table[i][0]).trim().toUpperCase() === "HCPCS") { headerIdx = i; break; }
  }
  if (headerIdx === -1) throw new Error(p + ": no HCPCS header row found in the first 30 rows - not a PPRRVU file?");
  const prev = table[headerIdx - 1] || [];
  const combined = table[headerIdx].map((c, i) => ((String(prev[i] || "") + " " + String(c || "")).replace(/\s+/g, " ").trim().toUpperCase()));
  const col = name => combined.findIndex(h => h === name);
  const cols = {
    code: col("HCPCS"),
    mod: col("MOD"),
    desc: col("DESCRIPTION"),
    status: col("STATUS CODE"),
    work: col("WORK RVU"),
    glob: col("GLOB DAYS")
  };
  for (const k of ["code", "desc", "status", "work"]) {
    if (cols[k] === -1) throw new Error(p + ": required column not found by name (" + k + "). Header layout changed - inspect the file and update the column mapping deliberately. Combined header row: " + combined.slice(0, 20).join(" | "));
  }
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
      work: parseFloat(r[cols.work]) || 0,
      glob: cols.glob === -1 ? "" : String(r[cols.glob] || "").trim()
    };
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(row);
  }
  // base row = blank modifier (TC/26/53 variants ignored, matching the app's data)
  const base = new Map();
  for (const [code, variants] of byCode) {
    base.set(code, variants.find(v => !v.mod) || variants[0]);
  }
  return base;
}

function includable(row) {
  return row.work > 0 && ["A", "R", "B", "T"].includes(row.status) && !EXCLUDE.includes(row.code);
}

// --- current app data: evaluated, so descriptor/keyword values arrive with
// JS escapes RESOLVED (the diff substrate is parsed strings, per spec) ---
const cptSrc = fs.readFileSync(CPT_DATA, "utf8");
const currentRows = new Function(cptSrc + "; return CMS_RAW;")();
const current = new Map(currentRows.map(r => [r[0], r]));

console.log("current cpt-data.js: " + currentRows.length + " rows (" + currentRows.filter(r => r.length === 5).length + " with inline keywords)");

const cmsOld = parsePPRRVU(path.resolve(baselinePath));
const cmsNew = parsePPRRVU(path.resolve(inputPath));
console.log("baseline codes: " + cmsOld.size + " | input codes: " + cmsNew.size);

// --- merge ---
const candidate = [];
const report = {
  kept: 0, added: [], removed: [], rvuChanged: [],
  descTookCms: [], descKeptOurs: 0, descConflicts: [],
  newCategoryWorklist: [], keywordRows: 0
};

// surviving + new set from the input year
const selected = [];
for (const [code, row] of cmsNew) {
  if (includable(row)) selected.push(code);
}
selected.sort();

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
    const row = [code, desc, nu.work, ours[3]];
    if (ours.length === 5) { row.push(ours[4]); report.keywordRows++; } // curated keywords: untouched
    candidate.push(row);
    report.kept++;
  } else {
    // new code
    const g = guessCategory(code);
    candidate.push([code, nu.desc, nu.work, g.cat]);
    report.added.push({ code, desc: nu.desc, work: nu.work, cat: g.cat, confidence: g.confidence });
    report.newCategoryWorklist.push({ code, desc: nu.desc, guess: g.cat, confidence: g.confidence });
  }
}

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
  FRIENDLY_DESC: sectionCodes(utilsSrc, "var FRIENDLY_DESC", "var GLOBAL_DAYS", /"([0-9A-Z]{5})"\s*:/g),
  GLOBAL_DAYS: sectionCodes(utilsSrc, "var GLOBAL_DAYS", "var COMPANION_CODES", /([0-9A-Z]{5})/g),
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
function emitRow(r) {
  let s = "[" + jsStr(r[0]) + "," + jsStr(r[1]) + "," + r[2] + "," + jsStr(r[3]);
  if (r.length === 5) s += "," + jsStr(r[4]);
  return s + "]";
}
const body = "const CMS_RAW=[" + candidate.map(emitRow).join(",") + "];\n";

// self-validation BEFORE writing: parseable, ASCII, no raw angle brackets
parser.parse(body, { sourceType: "script" });
const nonAscii = body.search(/[^\x00-\x7f]/);
if (nonAscii !== -1) throw new Error("candidate contains non-ASCII at index " + nonAscii);
if (/[<>]/.test(body)) throw new Error("candidate contains raw < or > - escaping bug");
const roundTrip = new Function(body + "; return CMS_RAW;")();
if (roundTrip.length !== candidate.length) throw new Error("round-trip row count mismatch");

fs.writeFileSync(outCandidate, body, "utf8");

// --- report ---
const topRvu = report.rvuChanged.slice().sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from)).slice(0, 25);
const md = [];
md.push("# CPT database update report - CY" + year);
md.push("");
md.push("Generated " + new Date().toISOString().slice(0, 10) + " by scripts/build-cpt-data.js");
md.push("Input: " + path.resolve(inputPath));
md.push("Baseline: " + path.resolve(baselinePath));
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
md.push("See the header comment in scripts/build-cpt-data.js. Key points: log prior-year stragglers BEFORE the swap (entries snapshot wRVU at log time); update check.js CMS_ROW_BASELINE to " + candidate.length + " in the same commit; bump ASSET_V; update DATA_VERSION/DATA_YEAR; deploy atomically.");
md.push("");
fs.writeFileSync(outReport, md.join("\n"), "utf8");

console.log("candidate: " + outCandidate + " (" + candidate.length + " rows, " + report.keywordRows + " keyword rows)");
console.log("report:    " + outReport);
console.log("added " + report.added.length + " | removed " + report.removed.length + " | rvu changed " + report.rvuChanged.length + " | conflicts " + report.descConflicts.length + " | dangling " + dangling.length);
