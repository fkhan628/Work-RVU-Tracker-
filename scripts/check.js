#!/usr/bin/env node
// =======================================================================
// RVU Tracker regression smoke check.
// Run after EVERY code change:  node scripts/check.js
// Guards the CLAUDE.md invariants of the no-build Babel-standalone app.
// Exits 1 on any failure.
// =======================================================================
const fs = require("fs");
const path = require("path");
const parser = require("@babel/parser");

const ROOT = path.join(__dirname, "..");
// Layout-aware: the local working folder nests the app under "RVU App Split";
// the GitHub repo serves the same app from the repo root.
const APP = fs.existsSync(path.join(ROOT, "RVU App Split")) ? path.join(ROOT, "RVU App Split") : ROOT;
const JS_DIR = path.join(APP, "js files");

// Baseline: the CPT database must hold exactly this many rows.
// If you intentionally add/remove codes, update this number consciously.
const CMS_ROW_BASELINE = 7305;

const failures = [];
function check(name, ok, detail) {
  console.log((ok ? "PASS" : "FAIL") + "  " + name + (ok || !detail ? "" : "  -> " + detail));
  if (!ok) failures.push(name);
}

// minimal AST walker (no @babel/traverse dependency)
function walk(node, cb) {
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) { for (let i = 0; i < node.length; i++) walk(node[i], cb); return; }
  if (node.type) cb(node);
  for (const k in node) {
    if (k === "loc" || k === "start" || k === "end" || k === "leadingComments" || k === "trailingComments") continue;
    walk(node[k], cb);
  }
}

const jsFiles = fs.readdirSync(JS_DIR).filter(f => f.endsWith(".js")).sort();
check("found 13 js files", jsFiles.length === 13, "got " + jsFiles.length + ": " + jsFiles.join(", "));

jsFiles.forEach(f => {
  const src = fs.readFileSync(path.join(JS_DIR, f), "utf8");

  // 1. must parse with @babel/parser (jsx plugin, script mode - `export` fails here)
  let ast = null, parseErr = null;
  try { ast = parser.parse(src, { sourceType: "script", plugins: ["jsx"] }); }
  catch (e) { parseErr = e.message; }
  check("parse " + f, !!ast, parseErr);

  // 2. ASCII only (char code > 127 breaks Babel-standalone loading on some setups)
  const naIdx = src.search(/[^\x00-\x7f]/);
  check("ascii " + f, naIdx === -1, naIdx === -1 ? "" : "non-ASCII at index " + naIdx + " (char " + JSON.stringify(src[naIdx]) + ")");

  // 3. no optional chaining, no export (AST-based, no string false-positives)
  if (ast) {
    let opt = 0, exp = 0;
    walk(ast.program, n => {
      if (n.type === "OptionalMemberExpression" || n.type === "OptionalCallExpression") opt++;
      if (n.type === "ExportDefaultDeclaration" || n.type === "ExportNamedDeclaration" || n.type === "ExportAllDeclaration") exp++;
    });
    check("no optional chaining in " + f, opt === 0, opt + " occurrence(s)");
    check("no export in " + f, exp === 0, exp + " occurrence(s)");
  }
});

// 4. index.html must NOT use viewport-fit=cover (iPhone status-bar overlap)
const html = fs.readFileSync(path.join(APP, "index.html"), "utf8");
check("index.html has no viewport-fit=cover", html.indexOf("viewport-fit=cover") === -1);

// 4b. Atomic deploy set + loader structure. index.html carries TWO literal
// arrays: `plain` (classic scripts, execute during parse - must stay
// JSX-free) and `js` (text/babel). Every js file on disk must appear in
// exactly one array, the plain set is pinned (a JSX file drifting into it
// is a white screen; utils/styles drifting out doubles their execution),
// and the hand-bumped ASSET_V constant must exist - it is the deploy cache
// contract (bump on every deploy that changes any js file).
const plainArrMatch = html.match(/var plain = \[([^\]]+)\]/);
const jsArrMatch = html.match(/var js = \[([^\]]+)\]/);
check("index.html has plain + js load arrays", !!plainArrMatch && !!jsArrMatch);
if (plainArrMatch && jsArrMatch) {
  const parseArr = m => m[1].split(",").map(s => s.trim().replace(/'/g, ""));
  const plainNames = parseArr(plainArrMatch);
  const babelNames = parseArr(jsArrMatch);
  const loadNames = plainNames.concat(babelNames);
  const missingOnDisk = loadNames.filter(n => !fs.existsSync(path.join(JS_DIR, n + ".js")));
  check("all index.html-loaded scripts exist on disk", missingOnDisk.length === 0, "missing: " + missingOnDisk.join(", "));
  const diskNames = jsFiles.map(f => f.replace(/\.js$/, ""));
  const unlisted = diskNames.filter(n => loadNames.indexOf(n) === -1);
  check("every js file on disk is in a load array", unlisted.length === 0, "unlisted: " + unlisted.join(", "));
  const dup = loadNames.filter((n, i) => loadNames.indexOf(n) !== i);
  check("no file in both load arrays", dup.length === 0, "duplicated: " + dup.join(", "));
  const EXPECTED_PLAIN = ["cpt-data", "crypto", "styles", "utils"];
  check("plain set is exactly crypto/cpt-data/utils/styles", plainNames.slice().sort().join(",") === EXPECTED_PLAIN.join(","), "got: " + plainNames.join(", "));
  check("index.html defines hand-bumped ASSET_V", /var ASSET_V = "[^"]+"/.test(html));
}

// 5. utils.js: keyword/friendly maps must be defined ABOVE CPT_DATABASE_DEFAULT
const utils = fs.readFileSync(path.join(JS_DIR, "utils.js"), "utf8");
const kIdx = utils.indexOf("var KEYWORD_SUPPLEMENT");
const fIdx = utils.indexOf("var FRIENDLY_DESC");
const dIdx = utils.indexOf("const CPT_DATABASE_DEFAULT");
check("utils.js defines KEYWORD_SUPPLEMENT", kIdx !== -1);
check("utils.js defines FRIENDLY_DESC", fIdx !== -1);
check("utils.js defines CPT_DATABASE_DEFAULT", dIdx !== -1);
check("KEYWORD_SUPPLEMENT above CPT_DATABASE_DEFAULT", kIdx !== -1 && dIdx !== -1 && kIdx < dIdx);
check("FRIENDLY_DESC above CPT_DATABASE_DEFAULT", fIdx !== -1 && dIdx !== -1 && fIdx < dIdx);

// 5b. Storage-key consistency: crypto.js loads before the Babel files, so it
// owns its own copy of the app data key. The two literals must never drift
// (a past drift left "-v6" in crypto.js and silently broke API-key migration
// and the Forgot-PIN reset).
const cryptoSrc = fs.readFileSync(path.join(JS_DIR, "crypto.js"), "utf8");
const dkMatch = cryptoSrc.match(/var DATA_KEY = "([^"]+)"/);
const skMatch = utils.match(/const SK = "([^"]+)"/);
check("crypto.js defines DATA_KEY", !!dkMatch);
check("utils.js defines SK", !!skMatch);
check("crypto.js DATA_KEY === utils.js SK", !!dkMatch && !!skMatch && dkMatch[1] === skMatch[1],
  (dkMatch ? dkMatch[1] : "(missing)") + " vs " + (skMatch ? skMatch[1] : "(missing)"));

// 5c. Store-field parity: every top-level field in utils.js defState() must
// also be carried by loadData() and by Settings' finishRestore - a field
// missing from either is silently WIPED on the next reload or restore.
const AST_OPTS = { sourceType: "script", plugins: ["jsx"] };
const objKeys = o => o.properties.filter(p => p.type === "ObjectProperty").map(p => p.key.name || p.key.value).sort();
function findDeclared(ast, name) {
  let hit = null;
  walk(ast.program, n => {
    if (hit) return;
    if (n.type === "FunctionDeclaration" && n.id && n.id.name === name) hit = n;
    if (n.type === "VariableDeclarator" && n.id && n.id.name === name) hit = n.init;
  });
  return hit;
}
function findStateObject(scope, mustHave) {
  let hit = null;
  if (scope) walk(scope, n => {
    if (!hit && n.type === "ObjectExpression") {
      const k = objKeys(n);
      if (mustHave.every(m => k.indexOf(m) !== -1)) hit = n;
    }
  });
  return hit;
}
const settingsSrc = fs.readFileSync(path.join(JS_DIR, "settings.js"), "utf8");
let utilsAst = null, settingsAst = null;
try { utilsAst = parser.parse(utils, AST_OPTS); settingsAst = parser.parse(settingsSrc, AST_OPTS); } catch (e) {}
const STATE_MARKERS = ["entries", "dataVersion"];
const defObj = utilsAst && findStateObject(findDeclared(utilsAst, "defState"), STATE_MARKERS);
const loadObj = utilsAst && findStateObject(findDeclared(utilsAst, "loadData"), STATE_MARKERS);
const restoreObj = settingsAst && findStateObject(findDeclared(settingsAst, "finishRestore"), STATE_MARKERS);
check("found defState / loadData / finishRestore state objects", !!defObj && !!loadObj && !!restoreObj);
if (defObj && loadObj && restoreObj) {
  const dk = objKeys(defObj), lk = objKeys(loadObj), rk = objKeys(restoreObj);
  const diff = (a, b) => a.filter(k => b.indexOf(k) === -1);
  check("loadData carries every defState field", diff(dk, lk).length === 0 && diff(lk, dk).length === 0,
    "missing: " + diff(dk, lk).join(", ") + " | extra: " + diff(lk, dk).join(", "));
  check("finishRestore carries every defState field", diff(dk, rk).length === 0 && diff(rk, dk).length === 0,
    "missing: " + diff(dk, rk).join(", ") + " | extra: " + diff(rk, dk).join(", "));
}

// 6. CPT database integrity
const cpt = fs.readFileSync(path.join(JS_DIR, "cpt-data.js"), "utf8");
let rows = null, evalErr = null;
try { rows = new Function(cpt + "; return CMS_RAW;")(); } catch (e) { evalErr = e.message; }
check("cpt-data.js evaluates", !!rows, evalErr);
if (rows) {
  check("CMS_RAW row count == " + CMS_ROW_BASELINE, rows.length === CMS_ROW_BASELINE, "got " + rows.length);
  const badShape = rows.filter(r => !(Array.isArray(r) && typeof r[0] === "string" && r[0].length === 5 && typeof r[1] === "string" && typeof r[2] === "number" && typeof r[3] === "string"));
  check("all CMS_RAW rows well-formed", badShape.length === 0, badShape.length + " malformed row(s)");
}
check("cpt-data.js has no raw < or > characters", !/[<>]/.test(cpt), "descriptors must escape angle brackets as unicode escapes");

// 7. Call-pay math. Runs the REAL cpt-data.js + utils.js in a Node vm
// sandbox (minimal DOM/localStorage stubs) - no copy of the logic lives
// here. All rates below are MADE UP: real site names/rates never go in
// source (CLAUDE.md). If utils.js gains a new top-level browser API call,
// extend the stubs rather than skipping these tests.
const vm = require("vm");
let sb = null, sbErr = null;
try {
  const noop = () => {};
  const elt = () => ({ style: {}, appendChild: noop, setAttribute: noop });
  sb = vm.createContext({ console, React: {},
    localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
    document: { createElement: elt, head: { appendChild: noop }, body: { appendChild: noop }, getElementById: () => null } });
  vm.runInContext(cpt, sb, { filename: "cpt-data.js" });
  vm.runInContext(utils, sb, { filename: "utils.js" });
} catch (e) { sbErr = e.message; sb = null; }
check("utils.js loads in a vm sandbox", !!sb, sbErr);
if (sb) {
  const ymdOf = d => d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  const holidaysIn = y => { const out = []; for (let d = new Date(y, 0, 1); d.getFullYear() === y; d.setDate(d.getDate() + 1)) { if (sb.payHolidayName(ymdOf(d))) out.push(ymdOf(d)); } return out; };
  const HOL = {
    2026: ["2026-01-01", "2026-05-25", "2026-07-03", "2026-07-04", "2026-09-07", "2026-11-26", "2026-12-24", "2026-12-25", "2026-12-31"],
    2027: ["2027-01-01", "2027-05-31", "2027-07-04", "2027-07-05", "2027-09-06", "2027-11-25", "2027-12-24", "2027-12-25", "2027-12-31"],
  };
  Object.keys(HOL).forEach(y => {
    const got = holidaysIn(+y);
    check("call-pay holidays " + y + " exact set", got.join(",") === HOL[y].join(","), "got " + got.join(","));
  });
  check("Sat Jan 1 observed on prior Fri Dec 31", /New Year's Day \(observed\)/.test(sb.payHolidayName("2021-12-31")), sb.payHolidayName("2021-12-31"));
  check("Sun Christmas observed Mon; Sat Eve not shifted",
    sb.payHolidayName("2022-12-26") !== "" && sb.payHolidayName("2022-12-23") === "" && sb.payHolidayName("2022-12-24") !== "");
  check("non-holidays stay plain", ["2026-07-05", "2026-11-27", "2027-12-26", "2026-02-30", "junk"].every(d => sb.payHolidayName(d) === ""));
  check("Sat New Year's Eve not shifted; Sun Jan 1 observed Mon",
    sb.payHolidayName("2022-12-30") === "" && /observed/.test(sb.payHolidayName("2023-01-02")));
  check("Thanksgiving is the 4th Thursday, not the last", sb.payHolidayName("2028-11-23") !== "" && sb.payHolidayName("2028-11-30") === "");

  const A_WKND = [5, 6, 0], B_WKND = [6, 0];
  const CLS = [
    ["2026-03-10", "21:00", B_WKND, "wn"], ["2026-03-10", "06:59", B_WKND, "wn"], ["2026-03-10", "07:00", B_WKND, "wd"],
    ["2026-03-10", "16:59", B_WKND, "wd"], ["2026-03-10", "17:00", B_WKND, "wn"], ["2026-03-10", "", B_WKND, ""],
    ["2026-03-10", "7:00", B_WKND, ""], ["2026-03-10", "24:00", B_WKND, ""],
    ["2026-03-13", "10:00", A_WKND, "we"], ["2026-03-13", "10:00", B_WKND, "wd"], ["2026-03-14", "", B_WKND, "we"],
    ["2026-07-03", "10:00", B_WKND, "hol"], ["2026-11-26", "", A_WKND, "hol"], ["2026-02-30", "10:00", A_WKND, ""],
    ["2026-07-04", "", B_WKND, "hol"], ["2026-12-25", "10:00", A_WKND, "hol"],
  ];
  const badCls = CLS.filter(c => sb.classifyPayEvent(c[0], c[1], c[2]) !== c[3]);
  check("call-in classification (" + CLS.length + " cases)", badCls.length === 0,
    badCls.map(c => c[0] + " " + c[1] + " -> " + sb.classifyPayEvent(c[0], c[1], c[2]) + " (want " + c[3] + ")").join("; "));

  // Generic made-up rate shapes (not any real contract): A pays hourly any
  // time with no minimum and a higher weekend/holiday fee; B has one fee for
  // all days, a per-trip minimum, and no weekday-day hourly.
  const RA = { id: "a", effective: "2026-01-01", stipend: 1000, stipendHours: 24, callInWeekday: 100, callInWeekendHoliday: 200, hourly: 50, hourlyMinHours: 0, hourlyWeekdayDay: true };
  const RB = { id: "b", effective: "2026-01-01", stipend: 2000.10, stipendHours: 10, callInWeekday: 150.15, callInWeekendHoliday: 150.15, hourly: 100.33, hourlyMinHours: 2, hourlyWeekdayDay: false };
  const RC = { id: "c", effective: "2026-01-01", stipend: 100, stipendHours: 3, callInWeekday: 0, callInWeekendHoliday: 0, hourly: 10.005, hourlyMinHours: 0, hourlyWeekdayDay: true };
  const ev = (cls, fee, hours) => ({ date: "2026-03-10", cls, fee, hours });
  const sh = (rates, callHours, events) => ({ id: "t", date: "2026-03-10", siteId: "", siteName: "", callHours, rates, events });
  const PAY = [
    ["A weekday night", sh(RA, 24, [ev("wn", true, 2.5)]), 1225],
    ["A weekend", sh(RA, 24, [ev("we", true, 1.5)]), 1275],
    ["A holiday", sh(RA, 24, [ev("hol", true, 3)]), 1350],
    ["A weekday day: fee + hourly", sh(RA, 24, [ev("wd", true, 2)]), 1200],
    ["B night under minimum", sh(RB, 10, [ev("wn", true, 1)]), 2350.91],
    ["B weekday day: fee, no hourly", sh(RB, 10, [ev("wd", true, 2)]), 2150.25],
    ["B weekend 4h", sh(RB, 10, [ev("we", true, 4)]), 2551.57],
    ["B holiday under minimum", sh(RB, 10, [ev("hol", true, 1)]), 2350.91],
    ["B fee-only (0h) skips minimum", sh(RB, 10, [ev("wn", true, 0)]), 2150.25],
    ["B two short trips: minimum per trip", sh(RB, 10, [ev("wn", true, 1), ev("wn", true, 1)]), 2701.72],
    ["A partial 12h shift, no call-ins", sh(RA, 12, []), 500],
    ["A two call-ins (night + weekend)", sh(RA, 24, [ev("wn", true, 1), ev("we", true, 2)]), 1450],
    ["A hours without fee", sh(RA, 24, [ev("we", false, 2)]), 1100],
    ["per-line rounding beats total-only rounding", sh(RC, 3, [ev("we", false, 1), ev("we", false, 1)]), 120.02],
    ["events missing = none", { callHours: 24, rates: RA }, 1000],
  ];
  const badPay = PAY.filter(p => { const r = sb.computeShiftPay(p[1]); return !r || r.total !== p[2]; });
  check("shift pay totals (" + PAY.length + " cases)", badPay.length === 0,
    badPay.map(p => { const r = sb.computeShiftPay(p[1]); return p[0] + " -> " + (r ? r.total : "null") + " (want " + p[2] + ")"; }).join("; "));
  const wd = sb.computeShiftPay(sh(RB, 10, [ev("wd", true, 2)]));
  check("unpaid weekday-day hours shown as a $0 line", !!wd && wd.lines.some(l => l.kind === "hourly" && l.paid === false && l.amount === 0 && l.hours === 2));
  const rc = sb.computeShiftPay(sh(RC, 1, [ev("we", false, 1)]));
  check("each line rounded half-up to the cent", !!rc && rc.lines.map(l => l.amount).join(",") === "33.33,10.01" && rc.total === 43.34,
    rc ? rc.lines.map(l => l.amount).join(",") + " = " + rc.total : "null");
  const input = sh(RB, 10, [ev("wn", true, 1)]);
  const before = JSON.stringify(input);
  sb.computeShiftPay(input);
  check("computeShiftPay does not mutate its input", JSON.stringify(input) === before);
  const NULLS = [
    ["no rates", sh(undefined, 24, [])], ["blank callHours", sh(RA, "", [])], ["bad class", sh(RA, 24, [ev("xx", true, 1)])],
    ["negative hours", sh(RA, 24, [ev("wn", true, -1)])], ["string fee flag", sh(RA, 24, [ev("wn", "true", 1)])],
    ["string weekday-day flag", sh(Object.assign({}, RA, { hourlyWeekdayDay: "false" }), 24, [])],
  ];
  const badNull = NULLS.filter(n => sb.computeShiftPay(n[1]) !== null);
  check("unreadable shift input yields no total (" + NULLS.length + " cases)", badNull.length === 0, badNull.map(n => n[0]).join(", "));

  // rateInForce: latest effective on/before the date; a same-date tie goes
  // to the version added last; nothing before the first version.
  const v = (id, effective) => Object.assign({}, RA, { id, effective });
  const site = { rates: [v("v1", "2026-01-01"), v("v2", "2026-07-01"), v("v3", "2027-01-01"), v("v2b", "2026-07-01")] };
  const RIF = [["2025-12-31", null], ["2026-01-01", "v1"], ["2026-03-15", "v1"], ["2026-07-01", "v2b"], ["2026-12-31", "v2b"], ["2027-02-01", "v3"]];
  const badRif = RIF.filter(c => { const r = sb.rateInForce(site, c[0]); return (r ? r.id : null) !== c[1]; });
  check("rateInForce picks the version in force (" + RIF.length + " cases)", badRif.length === 0,
    badRif.map(c => { const r = sb.rateInForce(site, c[0]); return c[0] + " -> " + (r ? r.id : "null") + " (want " + c[1] + ")"; }).join("; "));
  check("rateInForce: no rates / bad date / no site -> null",
    sb.rateInForce({ rates: [] }, "2026-05-01") === null && sb.rateInForce(site, "2026-02-30") === null && sb.rateInForce(null, "2026-05-01") === null);

  // Shift-entry helpers (call pay form). Local-parts date math only.
  const ADD = [["2026-01-31", 1, "2026-02-01"], ["2026-12-31", 1, "2027-01-01"], ["2028-02-28", 1, "2028-02-29"],
    ["2026-03-08", 1, "2026-03-09"], ["2026-11-01", 1, "2026-11-02"], ["2026-03-01", -1, "2026-02-28"],
    ["2026-02-30", 1, ""], ["2026-01-01", 1.5, ""]];
  const badAdd = ADD.filter(c => sb.addDaysYMD(c[0], c[1]) !== c[2]);
  check("addDaysYMD rollovers + bad input (" + ADD.length + " cases)", badAdd.length === 0, badAdd.map(c => c[0] + "+" + c[1] + " -> " + sb.addDaysYMD(c[0], c[1])).join("; "));
  check("ymdWeekday from local parts", sb.ymdWeekday("2026-10-10") === 6 && sb.ymdWeekday("2026-10-11") === 0 && sb.ymdWeekday("2026-02-30") === -1);
  check("localHM pads hours/minutes", sb.localHM(new Date(2026, 0, 1, 0, 0)) === "00:00" && sb.localHM(new Date(2026, 0, 1, 7, 5)) === "07:05" && sb.localHM(new Date(2026, 0, 1, 23, 59)) === "23:59");
  const DSD = [["2026-10-11", "06:59", "2026-10-10"], ["2026-10-11", "07:00", "2026-10-11"], ["2027-01-01", "00:10", "2026-12-31"], ["2026-10-11", "", "2026-10-11"], ["junk", "08:00", ""]];
  const badDsd = DSD.filter(c => sb.payDefaultShiftDate(c[0], c[1]) !== c[2]);
  check("payDefaultShiftDate: before 07:00 = yesterday", badDsd.length === 0, badDsd.map(c => c[0] + " " + c[1] + " -> " + sb.payDefaultShiftDate(c[0], c[1])).join("; "));
  const SB = [["2026-10-11", "01:00", 3, "2026-10-10 22:00"], ["2026-11-01", "00:30", 1, "2026-10-31 23:30"], ["2027-01-01", "00:15", 0.5, "2026-12-31 23:45"],
    ["2026-10-11", "10:00", "2.5", "2026-10-11 07:30"], ["2026-10-11", "10:00", 0, "2026-10-11 10:00"]];
  const badSb = SB.filter(c => { const r = sb.payStartBack(c[0], c[1], c[2]); return !r || r.date + " " + r.time !== c[3]; });
  check("payStartBack across midnight/month/year (" + SB.length + " cases)", badSb.length === 0, badSb.map(c => JSON.stringify(sb.payStartBack(c[0], c[1], c[2]))).join("; "));
  check("payStartBack: bad time/hours -> null", sb.payStartBack("2026-10-11", "25:00", 1) === null && sb.payStartBack("2026-10-11", "10:00", "x") === null && sb.payStartBack("2026-10-11", "10:00", -1) === null);

  // payShiftFromDraft - the ONLY writer of payShifts. Made-up sites S1/S2.
  const S1 = { id: "s1", name: "S1", weekendDays: [0, 5, 6], casesEarnRVU: true, rates: [RA] };
  const S2 = { id: "s2", name: "S2", weekendDays: [0, 6], casesEarnRVU: true, rates: [RB] };
  const dEv = (o) => Object.assign({ date: "2026-03-10", time: "21:00", cls: "wn", fee: true, hours: "2.5" }, o || {});
  const draft = (o) => Object.assign({ id: "d1", siteId: "s1", date: "2026-03-10", callHours: "24", note: "", events: [dEv()] }, o || {});
  const codes = (r) => r.problems.map(p => p.code + (p.block ? "!" : "")).join(",");
  const SITE_FUT = { id: "s3", name: "S3", weekendDays: [0, 6], rates: [Object.assign({}, RA, { effective: "2027-01-01" })] };
  const BLOCK = [
    ["site", sb.payShiftFromDraft(draft(), null, null)], ["date", sb.payShiftFromDraft(draft({ date: "2026-02-30" }), S1, null)],
    ["rates", sb.payShiftFromDraft(draft({ siteId: "s3" }), SITE_FUT, null)], ["hours", sb.payShiftFromDraft(draft({ callHours: "" }), S1, null)],
    ["evDate", sb.payShiftFromDraft(draft({ events: [dEv({ date: "" })] }), S1, null)], ["evBefore", sb.payShiftFromDraft(draft({ events: [dEv({ date: "2026-03-09" })] }), S1, null)],
    ["evCls", sb.payShiftFromDraft(draft({ events: [dEv({ cls: "" })] }), S1, null)], ["evHours", sb.payShiftFromDraft(draft({ events: [dEv({ hours: "" })] }), S1, null)],
  ];
  const badBlock = BLOCK.filter(b => b[1].shift !== null || !b[1].problems.some(p => p.code === b[0] && p.block));
  check("payShiftFromDraft blocking codes (" + BLOCK.length + ")", badBlock.length === 0, badBlock.map(b => b[0] + " -> " + codes(b[1])).join("; "));
  const RZ = Object.assign({}, RA, { stipend: 0, callInWeekday: 0, callInWeekendHoliday: 0, hourly: 0 });
  const WARN = [
    ["evLate", sb.payShiftFromDraft(draft({ events: [dEv({ date: "2026-03-13" })] }), S1, null)],
    ["overLength", sb.payShiftFromDraft(draft({ callHours: "30" }), S1, null)],
    ["payNothing", sb.payShiftFromDraft(draft({ events: [] }), Object.assign({}, S1, { rates: [RZ] }), null)],
    ["duplicate", sb.payShiftFromDraft(draft(), S1, null, { shifts: [{ id: "other", siteId: "s1", date: "2026-03-10" }], today: "2026-12-31" })],
    ["future", sb.payShiftFromDraft(draft(), S1, null, { shifts: [], today: "2026-03-01" })],
  ];
  const badWarn = WARN.filter(w => !w[1].shift || !w[1].problems.some(p => p.code === w[0] && !p.block));
  check("payShiftFromDraft warnings never block (" + WARN.length + ")", badWarn.length === 0, badWarn.map(w => w[0] + " -> " + codes(w[1])).join("; "));
  const selfDup = sb.payShiftFromDraft(draft(), S1, { id: "d1", siteId: "s1", date: "2026-03-10", rates: RA }, { shifts: [{ id: "d1", siteId: "s1", date: "2026-03-10" }], today: "2026-12-31" });
  check("editing a shift is not a duplicate of itself", !!selfDup.shift && !selfDup.problems.some(p => p.code === "duplicate"));
  const din = draft({ note: "  ", events: [dEv({ time: "" }), dEv({ date: "2026-03-11", time: "01:30", cls: "we", fee: false, hours: "0" })] });
  const dinBefore = JSON.stringify(din);
  const built = sb.payShiftFromDraft(din, S1, null);
  const bs = built.shift;
  check("payShiftFromDraft shape: numbers, no blank time/note, input untouched",
    !!bs && bs.callHours === 24 && bs.events[0].hours === 2.5 && !("time" in bs.events[0]) && bs.events[1].time === "01:30" && bs.events[1].fee === false &&
    !("note" in bs) && bs.siteId === "s1" && bs.siteName === "S1" && bs.rates !== S1.rates[0] && bs.rates.stipend === 1000 && JSON.stringify(din) === dinBefore);
  check("payShiftFromDraft trims the note; writes events: [] when none",
    sb.payShiftFromDraft(draft({ note: " fake note " }), S1, null).shift.note === "fake note" && JSON.stringify(sb.payShiftFromDraft(draft({ events: [] }), S1, null).shift.events) === "[]");
  const RA2 = Object.assign({}, RA, { id: "old", stipend: 900 });
  const orig = { id: "keep-me", date: "2026-03-10", siteId: "s1", siteName: "S1", callHours: 24, rates: RA2, events: [], extra: { k: 1 } };
  const kept = sb.payShiftFromDraft(draft(), S1, orig);
  const moved = sb.payShiftFromDraft(draft({ date: "2026-03-12", events: [dEv({ date: "2026-03-12" })] }), S1, orig);
  check("edit keeps saved rates + id + unknown fields; a date change re-takes rates",
    !!kept.shift && kept.ratesFrom === "kept" && kept.shift.rates.stipend === 900 && kept.shift.id === "keep-me" && kept.shift.extra.k === 1 &&
    !!moved.shift && moved.ratesFrom === "inForce" && moved.shift.rates.stipend === 1000, kept.ratesFrom + "/" + moved.ratesFrom + " " + codes(moved));
  // CONTRACT: whatever the form saves must come back from repairData
  // byte-identical with no payShifts repair (else every load rewrites it).
  const CONTRACT = [
    sb.payShiftFromDraft(draft(), S1, null).shift,
    sb.payShiftFromDraft(din, S1, null).shift,
    sb.payShiftFromDraft(draft({ siteId: "s2", callHours: "10", events: [dEv({ cls: "wd", time: "10:00", hours: "1" })] }), S2, null).shift,
    sb.payShiftFromDraft(draft({ note: "fake", events: [] }), S1, null).shift,
    kept.shift,
  ];
  const store = { entries: [], settings: { ratePerRVU: 55, annualGoal: 0, reconGoal: 0 }, paySites: [S1, S2], payShifts: JSON.parse(JSON.stringify(CONTRACT)) };
  const beforeRepair = JSON.stringify(store.payShifts);
  const fixed = sb.repairData(store);
  check("CONTRACT: built shifts pass repairData unchanged", CONTRACT.every(Boolean) && JSON.stringify(store.payShifts) === beforeRepair && !fixed.some(f => /^payShifts/.test(f)),
    "fixed: " + fixed.join(", "));
  // Draft rules (payDraftEvent/NewEvent/Refresh) with a PINNED clock: the
  // result must not depend on tap order (date-then-call-in vs call-in-then-date).
  const SW = { id: "sw", name: "SW", weekendDays: [0, 6], rates: [RA] };
  const flow = (steps, today, now, site) => {
    let d = sb.payDraftRefresh({ id: "f", siteId: site.id, date: steps[0], callHours: "", hoursSet: false, events: [], note: "" }, site, today, now);
    steps.slice(1).forEach(st => {
      if (st === "add") d = Object.assign({}, d, { events: d.events.concat([sb.payDraftNewEvent(d.date, site, today, now)]) });
      else if (st.hours !== undefined) d = Object.assign({}, d, { events: d.events.map(e => sb.payDraftEvent(Object.assign({}, e, { hours: st.hours }), d.date, site, today, now)) });
      else if (st.date) d = sb.payDraftRefresh(Object.assign({}, d, { date: st.date }), site, today, now);
    });
    const e = d.events[0];
    return e ? [e.date, e.rel, e.time, e.cls, e.timeAuto].join(" ") : "none";
  };
  // Mon 2026-10-12 08:00, a Sunday-night call-in that lasted 2h.
  const A = flow(["2026-10-12", "add", { hours: "2" }, { date: "2026-10-11" }], "2026-10-12", "08:00", SW);
  const B = flow(["2026-10-11", "add", { hours: "2" }], "2026-10-12", "08:00", SW);
  check("draft: auto time is the same whatever the tap order", A === B && A === "2026-10-12 next 06:00 wn true", "A=" + A + " | B=" + B);
  // Moving the shift far back drops the auto time; a timeless weekday needs a pick.
  const C = flow(["2026-10-12", "add", { hours: "2" }, { date: "2026-10-06" }], "2026-10-12", "08:00", SW);
  const D = flow(["2026-10-06", "add", { hours: "2" }], "2026-10-12", "08:00", SW);
  check("draft: no auto time when logging days later (any order)", C === D && C === "2026-10-06 same  " + " false", "C=" + C + " | D=" + D);
  const H1 = flow(["2026-07-03", "add", { hours: "2" }, { date: "2026-07-02" }], "2026-07-03", "09:00", SW);
  const H2 = flow(["2026-07-02", "add", { hours: "2" }], "2026-07-03", "09:00", SW);
  check("draft: holiday call-in keeps its own date + class (any order)", H1 === H2 && H1 === "2026-07-03 next 07:00 hol true", "H1=" + H1 + " | H2=" + H2);
  const manual = sb.payDraftEvent({ date: "2026-10-01", rel: "next", time: "23:00", timeAuto: false, cls: "we", clsSet: true, fee: true, hours: "1" }, "2026-10-06", SW, "2026-10-12", "08:00");
  const follow = sb.payDraftEvent({ date: "2026-10-01", rel: "next", time: "23:00", timeAuto: false, cls: "", clsSet: false, fee: true, hours: "1" }, "2026-10-06", SW, "2026-10-12", "08:00");
  check("draft: Next day follows the shift date; a class override survives",
    manual.date === "2026-10-07" && manual.cls === "we" && manual.time === "23:00" && follow.date === "2026-10-07" && follow.cls === "wn");
  const dHours = sb.payDraftRefresh({ siteId: "sw", date: "2026-10-06", callHours: "", hoursSet: false, events: [] }, SW, "2026-10-12", "08:00");
  const dKept = sb.payDraftRefresh({ siteId: "sw", date: "2026-10-06", callHours: "12", hoursSet: true, events: [] }, SW, "2026-10-12", "08:00");
  check("draft: hours default to the rate's shift length until edited", dHours.callHours === "24" && dKept.callHours === "12");

  // payUndoApply: restores IN PLACE so the last-used site is unchanged.
  const u = (ids) => ids.map(id => ({ id }));
  const ids = (l) => l.map(s => s.id + (s.v ? s.v : "")).join(",");
  const undoList = u(["a", "b", "c"]);
  const undoBefore = JSON.stringify(undoList);
  check("payUndoApply: save / edit / delete undo in place",
    ids(sb.payUndoApply(u(["a", "b", "n"]), { remove: ["n"] })) === "a,b" &&
    ids(sb.payUndoApply([{ id: "a" }, { id: "b", v: "2" }, { id: "c" }], { restore: [{ id: "b", v: "1" }] })) === "a,b1,c" &&
    ids(sb.payUndoApply(u(["a", "c"]), { restore: [{ id: "b" }], at: 1 })) === "a,b,c" &&
    ids(sb.payUndoApply(u(["a"]), { restore: [{ id: "b" }] })) === "a,b" &&
    ids(sb.payUndoApply(undoList, { remove: ["b"] })) === "a,c" && JSON.stringify(undoList) === undoBefore);
  const noTime = sb.payShiftFromDraft(draft({ events: [dEv({ time: "" })] }), S1, null).shift;
  check("start time never changes pay", CONTRACT.every(s => sb.computeShiftPay(s) !== null) && sb.computeShiftPay(noTime).total === sb.computeShiftPay(CONTRACT[0]).total);
}

console.log("");
if (failures.length) {
  console.log("CHECK FAILED (" + failures.length + "): " + failures.join(" | "));
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
