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
// CMS global-period distribution of CMS_RAW[5] (from the build-cpt-data.js
// report). Changes only together with CMS_ROW_BASELINE, in the yearly swap
// commit - a hand edit of any single row's global fails this.
const GLOB_BASELINE = { "000": 1194, "010": 464, "090": 3751, "XXX": 1390, "ZZZ": 488, "YYY": 1, "MMM": 17 };

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

// 5d. wRVU credit: isNoCredit / creditedRVU / noCreditRVU (top level of
// utils.js) are the ONE rule deciding whether a case counts toward wRVU and
// comp totals. A raw `.adjustedRVU` used in arithmetic (+ - * / %, compound
// assignment; directly or through ||, ?:, parens, unary,
// Number/parseFloat/round2) anywhere but inside the top-level utils.js
// creditedRVU/noCreditRVU would silently count no-credit cases. Sort
// comparators (raw a - raw b) and a row's own wRVU display stay raw; their
// per-file counts are pinned so any new raw read is a conscious choice -
// route totals through creditedRVU(e) (noCreditRVU(e) for the "Logged, no
// credit" lines) and bump RAW_RVU_PIN only for a sort or display. Reads the
// gate cannot classify (destructuring, e["adjustedRVU"], any "adjustedRVU"
// string) are refused. Further gates: only isNoCredit, repairData and
// withNoCredit may mention noCredit; the four helper names may only be called
// or passed (utils.js declares each once); adjustedRVU is never written as
// literal 0; withNoCredit is called only by entryWithCall (G7); casesEarnRVU
// is written only by paySiteWithCredit / repairData / the preset (G9).
const RAW_RVU_PIN = { "analytics.js": 4, "dashboard.js": 1, "history.js": 6, "settings.js": 3, "utils.js": 2 };
const CREDIT_HELPERS = ["creditedRVU", "isNoCredit", "noCreditRVU", "withNoCredit"];
const ARITH_OPS = { "+": 1, "-": 1, "*": 1, "/": 1, "%": 1 };
const WALK_SKIP = { loc: 1, start: 1, end: 1, leadingComments: 1, trailingComments: 1, innerComments: 1 };
const isRawRVU = n => !!n && n.type === "MemberExpression" && !n.computed && !!n.property && n.property.name === "adjustedRVU";
const isRVUWrap = (p, child) => p.type === "LogicalExpression" || p.type === "ParenthesizedExpression" || p.type === "UnaryExpression" ||
  (p.type === "ConditionalExpression" && p.test !== child) ||
  (p.type === "CallExpression" && p.callee.type === "Identifier" && /^(Number|parseFloat|round2)$/.test(p.callee.name));
// Visits every node with its ancestor stack: stack[0] is the Program and
// stack[1] the top-level statement that contains the node.
function walkStack(src, cb) {
  const stack = [];
  (function visit(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    cb(n, stack);
    stack.push(n);
    for (const k in n) { if (!WALK_SKIP[k] && n[k] && typeof n[k] === "object") visit(n[k]); }
    stack.pop();
  })(parser.parse(src, AST_OPTS).program);
}
// Inside a TOP-LEVEL utils.js function with one of these names (a nested or
// other-file function of the same name gets no exemption).
const inTopFn = (stack, file, names) => file === "utils.js" && !!stack[1] && stack[1].type === "FunctionDeclaration" && !!stack[1].id && names.indexOf(stack[1].id.name) !== -1;
const litValue = n => !n ? null : n.type === "StringLiteral" ? n.value : (n.type === "TemplateLiteral" && n.expressions.length === 0 ? n.quasis[0].value.cooked : null);
function rawRVUReads(src, file) {
  const out = [];
  walkStack(src, (n, stack) => {
    const parent = stack[stack.length - 1], gp = stack[stack.length - 2];
    if (isRawRVU(n)) {
      let child = n, i = stack.length - 1;
      while (i >= 0 && isRVUWrap(stack[i], child)) { child = stack[i]; i--; }
      const p = i >= 0 ? stack[i] : null;
      const sortPair = !!p && p.type === "BinaryExpression" && p.operator === "-" && isRawRVU(p.left) && isRawRVU(p.right);
      const arith = !!p && !sortPair && ((p.type === "BinaryExpression" && !!ARITH_OPS[p.operator]) ||
        (p.type === "AssignmentExpression" && p.operator !== "=" && p.right === child));
      out.push({ line: n.loc.start.line, arith: arith && !inTopFn(stack, file, ["creditedRVU", "noCreditRVU"]) });
    }
    // Reads the gate cannot classify are refused outright: a destructured
    // { adjustedRVU }, e["adjustedRVU"] / e[`adjustedRVU`], or any other
    // "adjustedRVU" string (an alias such as var k = "adjustedRVU"; e[k]).
    // An object-literal key is a write and is allowed; the key/property of
    // the two refused forms above is not counted twice.
    const keyOfObj = !!parent && parent.type === "ObjectProperty" && parent.key === n && !!gp && (gp.type === "ObjectExpression" || gp.type === "ObjectPattern");
    const propOfComputed = !!parent && parent.type === "MemberExpression" && parent.computed && parent.property === n;
    if ((n.type === "ObjectProperty" && parent && parent.type === "ObjectPattern" && (n.key.name || litValue(n.key)) === "adjustedRVU") ||
        (n.type === "MemberExpression" && n.computed && litValue(n.property) === "adjustedRVU") ||
        (litValue(n) === "adjustedRVU" && !keyOfObj && !propOfComputed)) {
      out.push({ line: n.loc.start.line, arith: true });
    }
  });
  return out;
}
// Any mention of the noCredit field (identifier, JSX prop, string or
// template key) outside the top-level utils.js isNoCredit / repairData /
// withNoCredit (the one writer).
function noCreditUses(src, file) {
  const out = [];
  walkStack(src, (n, stack) => {
    const hit = ((n.type === "Identifier" || n.type === "JSXIdentifier") && n.name === "noCredit") || litValue(n) === "noCredit";
    if (hit && !inTopFn(stack, file, ["isNoCredit", "repairData", "withNoCredit"])) out.push(n.loc.start.line);
  });
  return out;
}
// The helper names may only be called or passed as an argument; utils.js
// declares each as a top-level function (counted in decls).
function helperNameUses(src, file) {
  const bad = [], decls = {};
  walkStack(src, (n, stack) => {
    if (n.type !== "Identifier" || CREDIT_HELPERS.indexOf(n.name) === -1) return;
    const p = stack[stack.length - 1];
    if (p && p.type === "CallExpression" && (p.callee === n || p.arguments.indexOf(n) !== -1)) return;
    if (file === "utils.js" && stack.length === 2 && p.type === "FunctionDeclaration" && p.id === n) { decls[n.name] = (decls[n.name] || 0) + 1; return; }
    bad.push(n.name + "@" + n.loc.start.line);
  });
  return { bad: bad, decls: decls };
}
// adjustedRVU is never zeroed: refuse { adjustedRVU: 0 } and x.adjustedRVU = 0.
function zeroRVUWrites(src) {
  const out = [];
  const isZero = v => !!v && v.type === "NumericLiteral" && v.value === 0;
  const isKey = k => !!k && ((k.type === "Identifier" && k.name === "adjustedRVU") || litValue(k) === "adjustedRVU");
  walkStack(src, (n, stack) => {
    const parent = stack[stack.length - 1];
    if (n.type === "ObjectProperty" && parent && parent.type === "ObjectExpression" && isKey(n.key) && isZero(n.value)) out.push(n.loc.start.line);
    if (n.type === "AssignmentExpression" && n.operator === "=" && n.left.type === "MemberExpression" &&
        (n.left.computed ? litValue(n.left.property) === "adjustedRVU" : n.left.property.name === "adjustedRVU") && isZero(n.right)) out.push(n.loc.start.line);
  });
  return out;
}
const keyIs = (k, name) => !!k && ((k.type === "Identifier" && k.name === name) || litValue(k) === name);
const memberIs = (m, name) => !!m && m.type === "MemberExpression" && (m.computed ? litValue(m.property) === name : !!m.property && m.property.name === name);
// G7 (7b): withNoCredit, the one noCredit writer, appears only in its own
// declaration and inside the top-level utils.js entryWithCall.
function writerUses(src, file) {
  const out = [];
  walkStack(src, (n, stack) => { if (n.type === "Identifier" && n.name === "withNoCredit" && !inTopFn(stack, file, ["withNoCredit", "entryWithCall"])) out.push(n.loc.start.line); });
  return out;
}
// G9 (7b): a site's casesEarnRVU changes only through utils.js
// paySiteWithCredit (repairData's shape repair and the DEFAULT_PAY_SITES
// preset aside). Anywhere else the key may appear only as a literal true in
// a FRESH site literal (no spread, not an Object.assign source); assigning
// or deleting it is refused.
function casesEarnWrites(src, file) {
  const out = [];
  walkStack(src, (n, stack) => {
    if (inTopFn(stack, file, ["paySiteWithCredit", "repairData"])) return;
    if (file === "utils.js" && stack[1] && stack[1].type === "VariableDeclaration" && stack[1].declarations.some(d => d.id && d.id.name === "DEFAULT_PAY_SITES")) return;
    const p = stack[stack.length - 1], gp = stack[stack.length - 2];
    if (n.type === "ObjectProperty" && p && p.type === "ObjectExpression" && (n.computed ? litValue(n.key) === "casesEarnRVU" : keyIs(n.key, "casesEarnRVU"))) {
      const fresh = n.value.type === "BooleanLiteral" && n.value.value === true && !p.properties.some(q => q.type === "SpreadElement") &&
        !(gp && gp.type === "CallExpression" && memberIs(gp.callee, "assign"));
      if (!fresh) out.push(n.loc.start.line);
    }
    if ((n.type === "AssignmentExpression" && memberIs(n.left, "casesEarnRVU")) || (n.type === "UnaryExpression" && n.operator === "delete" && memberIs(n.argument, "casesEarnRVU"))) out.push(n.loc.start.line);
  });
  return out;
}
// G8 (7b): outside utils.js an entry's isCall is written only through
// entryWithCall - an object literal with an isCall key must be its FIRST
// argument; assigning or deleting .isCall is refused. siteId / siteName are
// written only in utils.js and callpay.js (call shifts own those keys there).
function callFieldWrites(src, file) {
  const out = [];
  if (file === "utils.js") return out;
  const named = (q, name) => q.type === "ObjectProperty" && (q.computed ? litValue(q.key) === name : keyIs(q.key, name));
  const writes = (n, name) => (n.type === "AssignmentExpression" && memberIs(n.left, name)) || (n.type === "UnaryExpression" && n.operator === "delete" && memberIs(n.argument, name));
  walkStack(src, (n, stack) => {
    const p = stack[stack.length - 1];
    if (n.type === "ObjectExpression" && n.properties.some(q => named(q, "isCall")) &&
        !(p && p.type === "CallExpression" && p.callee.type === "Identifier" && p.callee.name === "entryWithCall" && p.arguments[0] === n)) out.push(n.loc.start.line);
    if (writes(n, "isCall")) out.push(n.loc.start.line);
    if (file !== "callpay.js" && ((n.type === "ObjectExpression" && n.properties.some(q => named(q, "siteId") || named(q, "siteName"))) || writes(n, "siteId") || writes(n, "siteName"))) out.push(n.loc.start.line);
  });
  return out;
}
const gateSelfTest = [ // [src, raw reads, flagged, file]
  ["var t = list.reduce(function(s, e) { return s + e.adjustedRVU; }, 0);", 1, 1, "x.js"],
  ["m.total += (e.adjustedRVU || 0); var c = Number(e.adjustedRVU) * rate;", 2, 2, "x.js"],
  ["list.sort(function(a, b) { return b.adjustedRVU - a.adjustedRVU; });", 2, 0, "x.js"],
  ["var t = s + creditedRVU(e); var label = e.adjustedRVU.toFixed(2);", 1, 0, "x.js"],
  ["function creditedRVU(e) { return e.noCredit === true ? 0 : e.adjustedRVU + 0; }", 1, 0, "utils.js"],
  ["var t = list.reduce(function(s, { adjustedRVU }) { return s + adjustedRVU; }, 0); var u = e[\"adjustedRVU\"];", 2, 2, "x.js"],
  ["var o = { ...e, adjustedRVU: 2 }; var w = calcAdj(o.baseRVU, []);", 0, 0, "x.js"],
  ["function creditedRVU(e) { return isNoCredit(e) ? 0 : e.adjustedRVU + 0; }", 1, 1, "dashboard.js"],
  ["function noCreditRVU(e) { return isNoCredit(e) ? e.adjustedRVU : 0; }", 1, 0, "utils.js"],
  ["function noCreditRVU(e) { return isNoCredit(e) ? e.adjustedRVU + 0 : 0; }", 1, 0, "utils.js"],
  ["function outer() { function noCreditRVU(e) { return e.adjustedRVU + 0; } }", 1, 1, "utils.js"],
  ["var t = s + (e.noCredit === true ? e.adjustedRVU : 0);", 1, 1, "x.js"],
  ["var t = s + noCreditRVU(e);", 0, 0, "x.js"],
  ["var k = \"adjustedRVU\"; var t = s + e[k];", 1, 1, "x.js"],
  ["var t = s + e[`adjustedRVU`];", 1, 1, "x.js"],
  ["var o = { \"adjustedRVU\": 2 };", 0, 0, "x.js"],
  ["var { \"adjustedRVU\": a } = e;", 1, 1, "x.js"],
  ["var { [`adjustedRVU`]: a } = e; t = t + a;", 1, 1, "x.js"],
  ["var t = list.reduce(function(s, { [\"adjustedRVU\"]: a }) { return s + a; }, 0);", 1, 1, "x.js"],
];
const badSelf = gateSelfTest.filter(t => { const r = rawRVUReads(t[0], t[3]); return r.length !== t[1] || r.filter(x => x.arith).length !== t[2]; });
check("raw-wRVU gate self-test (" + gateSelfTest.length + " snippets)", badSelf.length === 0, badSelf.map(t => t[0]).join(" | "));
const ncSelfTest = [ // [src, file, must be flagged]
  ["if (e.noCredit) x();", "history.js", true], ["var v = e[\"noCredit\"];", "history.js", true],
  ["var t = e[`noCredit`];", "history.js", true], ["var h = \"noCredit\" in e;", "history.js", true],
  ["var { noCredit } = e;", "history.js", true], ["var o = { ...e, noCredit: true };", "history.js", true],
  ["delete e.noCredit;", "history.js", true], ["var r = <Row noCredit={x} />;", "history.js", true],
  ["var n = list.filter(isNoCredit).length;", "history.js", false],
  ["function isNoCredit(e) { return !!e && e.noCredit === true; }", "utils.js", false],
  ["function repairData(d) { d.entries.forEach(function(e) { if (e.noCredit !== true) delete e.noCredit; }); }", "utils.js", false],
  ["function helper(e) { return e.noCredit ? 1 : 0; }", "utils.js", true],
  ["function outer() { function isNoCredit(e) { return e.noCredit; } }", "utils.js", true],
  ["function withNoCredit(e, on) { var o = { ...e }; if (on === true) o.noCredit = true; else delete o.noCredit; return o; }", "utils.js", false],
  ["function withNoCredit(e, on) { var o = { ...e }; if (on === true) o.noCredit = true; return o; }", "history.js", true],
  ["function outer() { function withNoCredit(e) { e.noCredit = true; } }", "utils.js", true],
  ["var o = withNoCredit(e, editX);", "history.js", false],
];
const badNcSelf = ncSelfTest.filter(t => (noCreditUses(t[0], t[1]).length > 0) !== t[2]);
check("noCredit gate self-test (" + ncSelfTest.length + " snippets)", badNcSelf.length === 0, badNcSelf.map(t => t[0]).join(" | "));
const helperSelfTest = [ // [src, file, must be flagged]
  ["function isNoCredit(e) { return true; }", "history.js", true], ["function f(isNoCredit) { return isNoCredit; }", "history.js", true],
  ["var o = { creditedRVU: 1 };", "history.js", true], ["var p = x.noCreditRVU;", "history.js", true],
  ["var isNoCredit = function(e) { return false; };", "utils.js", true], ["function outer() { function creditedRVU(e) { return 0; } }", "utils.js", true],
  ["var a = list.filter(isNoCredit); var b = creditedRVU(e) + noCreditRVU(e);", "history.js", false],
  ["function creditedRVU(e) { return 0; }", "utils.js", false],
  ["var f = withNoCredit;", "history.js", true], ["function withNoCredit(e) { return e; }", "log.js", true],
];
const badHelperSelf = helperSelfTest.filter(t => (helperNameUses(t[0], t[1]).bad.length > 0) !== t[2]);
check("credit-helper name gate self-test (" + helperSelfTest.length + " snippets)", badHelperSelf.length === 0, badHelperSelf.map(t => t[0]).join(" | "));
check("zero-write gate self-test", zeroRVUWrites("var o = { ...e, adjustedRVU: 0 }; e.adjustedRVU = 0;").length === 2 &&
  zeroRVUWrites("var o = { ...e, adjustedRVU: adj }; e.adjustedRVU = calcAdj(b, m);").length === 0);
const writerSelfTest = [ // [src, file, must be flagged]
  ["var o = withNoCredit(e, true);", "log.js", true],
  ["function entryWithCall(e) { return withNoCredit(e, false); }", "utils.js", false],
  ["function helper(e) { return withNoCredit(e, true); }", "utils.js", true],
  ["function outer() { function entryWithCall(e) { return withNoCredit(e, true); } }", "utils.js", true],
  ["function withNoCredit(e, on) { return e; }", "utils.js", false],
];
const badWriterSelf = writerSelfTest.filter(t => (writerUses(t[0], t[1]).length > 0) !== t[2]);
check("G7 noCredit-writer gate self-test (" + writerSelfTest.length + " snippets)", badWriterSelf.length === 0, badWriterSelf.map(t => t[0]).join(" | "));
const earnSelfTest = [ // [src, file, must be flagged]
  ["var s = { id: i, name: n, weekendDays: [0, 6], casesEarnRVU: true, rates: [] };", "callpay.js", false],
  ["var s = { ...x, casesEarnRVU: false };", "callpay.js", true],
  ["var s = { ...x, casesEarnRVU: true };", "callpay.js", true],
  ["var s = { ...x, casesEarnRVU: on };", "callpay.js", true],
  ["var s = { \"casesEarnRVU\": false };", "callpay.js", true],
  ["Object.assign(x, { casesEarnRVU: true });", "callpay.js", true],
  ["x.casesEarnRVU = false;", "callpay.js", true],
  ["x[\"casesEarnRVU\"] = true;", "callpay.js", true],
  ["delete x.casesEarnRVU;", "callpay.js", true],
  ["var v = x.casesEarnRVU === false; var w = paySiteWithCredit(x, false);", "callpay.js", false],
  ["function paySiteWithCredit(site, earns) { return { ...site, casesEarnRVU: earns === true }; }", "utils.js", false],
  ["function paySiteWithCredit(site, earns) { return { ...site, casesEarnRVU: earns === true }; }", "callpay.js", true],
  ["function helper(s) { return { ...s, casesEarnRVU: false }; }", "utils.js", true],
  ["function repairData(d) { d.paySites.forEach(function(s) { var cs = { ...s }; cs.casesEarnRVU = s.casesEarnRVU !== false; }); }", "utils.js", false],
  ["var DEFAULT_PAY_SITES = [{ id: \"a\", name: \"A\", weekendDays: [], casesEarnRVU: false, rates: [] }];", "utils.js", false],
  ["var OTHER = [{ id: \"a\", name: \"A\", weekendDays: [], casesEarnRVU: false, rates: [] }];", "utils.js", true],
];
const badEarnSelf = earnSelfTest.filter(t => (casesEarnWrites(t[0], t[1]).length > 0) !== t[2]);
check("G9 casesEarnRVU-write gate self-test (" + earnSelfTest.length + " snippets)", badEarnSelf.length === 0, badEarnSelf.map(t => t[0]).join(" | "));
const callSelfTest = [ // [src, file, must be flagged]
  ["var o = { cptCode: c, isCall: x };", "history.js", true],
  ["var o = entryWithCall({ cptCode: c, isCall: x }, null, x, k, s, true);", "history.js", false],
  ["var o = entryWithCall(e, { isCall: x });", "history.js", true],
  ["f({ isCall: x });", "history.js", true],
  ["var o = { isCall };", "history.js", true],
  ["var o = { \"isCall\": true };", "log.js", true],
  ["Object.assign(e, { isCall: x });", "history.js", true],
  ["e.isCall = false;", "history.js", true],
  ["e[\"isCall\"] = true;", "history.js", true],
  ["delete e.isCall;", "history.js", true],
  ["var d = { call: isCall, nextId: 2 }; var t = e.isCall ? 1 : 0; var { isCall: ic } = e;", "log.js", false],
  ["var o = { ...e, siteId: x };", "history.js", true],
  ["e.siteName = n;", "history.js", true],
  ["delete e.siteId;", "log.js", true],
  ["var lbl = entrySiteLabel(e, s) + e.siteName;", "history.js", false],
  ["var sh = { id: i, siteId: s.id, siteName: s.name };", "callpay.js", false],
  ["var o = { isCall: true, siteId: \"a\" };", "utils.js", false],
];
const badCallSelf = callSelfTest.filter(t => (callFieldWrites(t[0], t[1]).length > 0) !== t[2]);
check("G8 call-field gate self-test (" + callSelfTest.length + " snippets)", badCallSelf.length === 0, badCallSelf.map(t => t[0]).join(" | "));
const rawCounts = {}, rawArith = [], ncMentions = [], helperBad = [], helperDecls = {}, zeroWrites = [], writerBad = [], earnWrites = [], callWrites = [];
jsFiles.filter(f => f !== "cpt-data.js").forEach(f => {
  let src = "", reads = [];
  try { src = fs.readFileSync(path.join(JS_DIR, f), "utf8"); reads = rawRVUReads(src, f); } catch (e) { return; } // parse failure is reported in step 1
  if (reads.length) rawCounts[f] = reads.length;
  reads.filter(r => r.arith).forEach(r => rawArith.push(f + ":" + r.line));
  noCreditUses(src, f).forEach(l => ncMentions.push(f + ":" + l));
  const h = helperNameUses(src, f);
  h.bad.forEach(b => helperBad.push(f + ":" + b));
  Object.keys(h.decls).forEach(k => { helperDecls[k] = (helperDecls[k] || 0) + h.decls[k]; });
  zeroRVUWrites(src).forEach(l => zeroWrites.push(f + ":" + l));
  writerUses(src, f).forEach(l => writerBad.push(f + ":" + l));
  casesEarnWrites(src, f).forEach(l => earnWrites.push(f + ":" + l));
  callFieldWrites(src, f).forEach(l => callWrites.push(f + ":" + l));
});
check("wRVU/comp sums go through creditedRVU/noCreditRVU (no raw adjustedRVU arithmetic, destructuring or \"adjustedRVU\" strings)", rawArith.length === 0, rawArith.join(", "));
const pinDiff = Object.keys(Object.assign({}, RAW_RVU_PIN, rawCounts)).filter(f => (RAW_RVU_PIN[f] || 0) !== (rawCounts[f] || 0));
check("raw adjustedRVU reads match the pinned sort/display counts", pinDiff.length === 0,
  pinDiff.map(f => f + " has " + (rawCounts[f] || 0) + ", pinned " + (RAW_RVU_PIN[f] || 0)).join("; "));
check("noCredit is mentioned only in utils.js isNoCredit / repairData / withNoCredit", ncMentions.length === 0, ncMentions.join(", "));
check("credit helpers: declared once each at the top of utils.js; elsewhere only called or passed",
  helperBad.length === 0 && CREDIT_HELPERS.every(k => helperDecls[k] === 1), helperBad.join(", ") + " decls " + JSON.stringify(helperDecls));
check("adjustedRVU is never written as a literal 0", zeroWrites.length === 0, zeroWrites.join(", "));
check("withNoCredit (the one noCredit writer) is used only inside utils.js entryWithCall", writerBad.length === 0, writerBad.join(", "));
check("casesEarnRVU changes only through utils.js paySiteWithCredit (repairData, the preset and a fresh site's literal true aside)", earnWrites.length === 0, earnWrites.join(", "));
check("entry isCall is written only through entryWithCall (first argument); siteId/siteName only in utils.js/callpay.js", callWrites.length === 0, callWrites.join(", "));

// 5e. Hooks before any conditional return (CLAUDE.md; this crashed analytics
// once). For every top-level component (capitalized function declaration)
// in the Babel files: from the first statement that contains a return of
// the component itself (an early return, or the final render), no
// use[A-Z]... call may follow - nested functions (callbacks) are ignored.
const NESTED_FN = { FunctionExpression: 1, ArrowFunctionExpression: 1, FunctionDeclaration: 1, ObjectMethod: 1, ClassMethod: 1 };
function ownNodes(node, cb) {
  (function visit(n) {
    if (!n || typeof n !== "object") return;
    if (Array.isArray(n)) { n.forEach(visit); return; }
    if (NESTED_FN[n.type]) return;
    cb(n);
    for (const k in n) { if (!WALK_SKIP[k] && n[k] && typeof n[k] === "object") visit(n[k]); }
  })(node);
}
function hooksAfterReturn(src) {
  const bad = [];
  parser.parse(src, AST_OPTS).program.body.forEach(fn => {
    if (fn.type !== "FunctionDeclaration" || !fn.id || !/^[A-Z]/.test(fn.id.name)) return;
    const stmts = fn.body.body;
    let first = -1;
    for (let i = 0; i < stmts.length && first === -1; i++) { let has = false; ownNodes(stmts[i], n => { if (n.type === "ReturnStatement") has = true; }); if (has) first = i; }
    if (first === -1) return;
    for (let i = first; i < stmts.length; i++) {
      ownNodes(stmts[i], n => {
        if (n.type !== "CallExpression") return;
        const c = n.callee, name = c.type === "Identifier" ? c.name : (c.type === "MemberExpression" && !c.computed ? c.property.name : "");
        if (/^use[A-Z]/.test(name)) bad.push(fn.id.name + ":" + n.loc.start.line + " " + name);
      });
    }
  });
  return bad;
}
const hookSelf = [
  ["function A() { const [a] = useState(0); if (a) return null; const b = useMemo(f, []); return a; }", 1],
  ["function B() { if (x) { y(); return null; } var c = useRef(0); return c; }", 1],
  ["function C() { const a = useState(0); if (a) return null; var cb = function() { useFoo(); }; return cb; }", 0],
  ["function D() { const a = useState(0); const b = useMemo(f, []); return a + b; }", 0],
];
const badHookSelf = hookSelf.filter(t => hooksAfterReturn(t[0]).length !== t[1]);
check("hooks-order gate self-test (" + hookSelf.length + " snippets)", badHookSelf.length === 0, badHookSelf.map(t => t[0]).join(" | "));
const hookBad = [];
jsFiles.filter(f => ["crypto.js", "cpt-data.js", "utils.js", "styles.js"].indexOf(f) === -1).forEach(f => {
  try { hooksAfterReturn(fs.readFileSync(path.join(JS_DIR, f), "utf8")).forEach(b => hookBad.push(f + " " + b)); } catch (e) { /* parse failure is reported in step 1 */ }
});
check("hooks before any conditional return (every component in the Babel files)", hookBad.length === 0, hookBad.join(", "));

// 6. CPT database integrity
const cpt = fs.readFileSync(path.join(JS_DIR, "cpt-data.js"), "utf8");
let rows = null, evalErr = null;
try { rows = new Function(cpt + "; return CMS_RAW;")(); } catch (e) { evalErr = e.message; }
check("cpt-data.js evaluates", !!rows, evalErr);
if (rows) {
  check("CMS_RAW row count == " + CMS_ROW_BASELINE, rows.length === CMS_ROW_BASELINE, "got " + rows.length);
  const badShape = rows.filter(r => !(Array.isArray(r) && typeof r[0] === "string" && r[0].length === 5 && typeof r[1] === "string" && typeof r[2] === "number" && typeof r[3] === "string"));
  check("all CMS_RAW rows well-formed", badShape.length === 0, badShape.length + " malformed row(s)");
  // Row contract [code, desc, wRVU, category, keywords ("" if none), CMS GLOB DAYS]
  const badGlobRows = rows.filter(r => !(r.length === 6 && typeof r[4] === "string" && /^(000|010|090|XXX|ZZZ|YYY|MMM)$/.test(r[5])));
  check("CMS_RAW rows: 6 elements, keywords string, CMS global", badGlobRows.length === 0, badGlobRows.slice(0, 5).map(r => r[0]).join(", "));
  const globDist = {};
  rows.forEach(r => { globDist[r[5]] = (globDist[r[5]] || 0) + 1; });
  const globKeys = Object.keys(Object.assign({}, GLOB_BASELINE, globDist));
  check("CMS global distribution == GLOB_BASELINE", globKeys.every(k => (GLOB_BASELINE[k] || 0) === (globDist[k] || 0)), JSON.stringify(globDist));
}
check("cpt-data.js has no raw < or > characters", !/[<>]/.test(cpt), "descriptors must escape angle brackets as unicode escapes");
// 6a. Global periods have ONE source (CMS_RAW[5]): no CPT code may be typed
// into utils.js between "var GLOBAL_DAYS" and "var COMPANION_CODES" again
// (a hand list there drifted from CMS on 399 codes). Self-tested so the gate
// can never silently become a no-op.
const CODE_TOKEN = /(^|[^0-9A-Za-z_])(\d{5}|\d{4}[A-Z]|[A-Z]\d{4})(?![0-9A-Za-z_])/;
const gdStart = utils.indexOf("var GLOBAL_DAYS"), gdEnd = utils.indexOf("var COMPANION_CODES");
check("global-days gate self-test (catches a hand list)", CODE_TOKEN.test("15734,15733") && CODE_TOKEN.test("\"49591\": 90") && CODE_TOKEN.test("G2211") && !CODE_TOKEN.test("\"000\" \"ZZZ\" CMS_RAW[5]"));
check("utils.js GLOBAL_DAYS section holds no typed CPT codes (derived from CMS_RAW)", gdStart !== -1 && gdEnd > gdStart && !CODE_TOKEN.test(utils.slice(gdStart, gdEnd)),
  gdStart === -1 || gdEnd <= gdStart ? "markers missing or out of order" : (utils.slice(gdStart, gdEnd).match(CODE_TOKEN) || [""])[0]);

// 6b. CPT search ranking (rankCPTMatches) on the REAL CPT database: same
// match set as matchesCPTQuery, reordered - exact code, prefix, usage,
// favorites, CPT order. Usage/favorites below are made up.
// (Runs after the sandbox loads; see section 7 for the sandbox.)

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

  // Section 6b: CPT search ranking.
  const db0 = vm.runInContext("CPT_DATABASE_DEFAULT", sb);
  const hits = q => db0.filter(c => sb.matchesCPTQuery(c, q));
  const herniaHits = hits("hernia");
  const ranked = sb.rankCPTMatches(herniaHits, "hernia", { "49650": 5, "49505": 2 }, ["49591"]);
  const sameSet = ranked.length === herniaHits.length && ranked.every(c => herniaHits.indexOf(c) !== -1);
  const topCodes = ranked.slice(0, 3).map(c => c.code).join(",");
  check("rankCPTMatches: same match set; usage then favorites first", sameSet && topCodes === "49650,49505,49591", topCodes + " of " + ranked.length);
  const syn = [{ code: "10021" }, { code: "49505" }, { code: "49507" }, { code: "20000" }];
  const order = (q, use) => sb.rankCPTMatches(syn, q, use, []).map(c => c.code).join(",");
  check("rankCPTMatches: exact code first, then code prefix beats heavy usage",
    order("49505", { "10021": 50 }) === "49505,10021,49507,20000" && order("4950", { "10021": 50 }) === "49505,49507,10021,20000",
    order("49505", { "10021": 50 }) + " | " + order("4950", { "10021": 50 }));
  const plain = sb.rankCPTMatches(herniaHits, "hernia", {}, []);
  check("rankCPTMatches: no usage/favorites = CPT order (stable)", plain.every((c, i) => c === herniaHits[i]));

  // Global-period chips: every database code's chip equals its CMS value
  // (independent copy of the approved label map), plus spot checks pinned to
  // CY2026 - update one deliberately only if CMS changes it in December.
  const GLABEL = { "000": "0-day", "010": "10-day", "090": "90-day", "ZZZ": "add-on" };
  const gBad = rows.filter(r => sb.getGlobalDays(r[0]) !== (GLABEL[r[5]] || ""));
  check("global chips: all " + rows.length + " database codes match their CMS GLOB DAYS",
    gBad.length === 0 && Object.keys(vm.runInContext("GLOBAL_DAYS", sb)).length === rows.length,
    gBad.slice(0, 10).map(r => r[0] + " " + r[5] + " -> " + sb.getGlobalDays(r[0])).join(", "));
  const GSPOT = [["49591", "0-day"], ["49650", "90-day"], ["47562", "90-day"], ["44970", "90-day"], ["11042", "0-day"], ["11045", "add-on"],
    ["37254", "0-day"], ["37255", "add-on"], ["11450", "90-day"], ["49320", "10-day"], ["37215", "90-day"], ["10060", "10-day"],
    ["99213", ""], ["97605", ""], ["59400", ""], ["69300", ""], ["", ""], ["ABCDE", ""]];
  const gSpotBad = GSPOT.filter(g => sb.getGlobalDays(g[0]) !== g[1]);
  check("global chips: CY2026 spot checks (hernia 0-day, chole/appy 90-day, add-ons, XXX/MMM/YYY none)", gSpotBad.length === 0,
    gSpotBad.map(g => g[0] + " -> " + JSON.stringify(sb.getGlobalDays(g[0])) + " want " + g[1]).join(", "));
  check("global chip colors are theme tokens (90 / 10 / 0-day + add-on)",
    sb.getGlobalColor("49650") === "var(--global-90)" && sb.getGlobalColor("49320") === "var(--global-10)" &&
    sb.getGlobalColor("49591") === "var(--global-0)" && sb.getGlobalColor("11045") === "var(--global-0)");
  const stylesSrc = fs.readFileSync(path.join(JS_DIR, "styles.js"), "utf8");
  check("global chip color tokens defined for dark AND light mode (each exactly twice in styles.js)",
    ["--global-90:", "--global-10:", "--global-0:"].every(t => stylesSrc.split(t).length - 1 === 2));
  // CSV import never reads the exports' Credit column back into a mark - it
  // warns FIRST instead (the preview shows only the first messages).
  const impMap = vm.runInContext("buildCPTMap(CPT_DATABASE_DEFAULT)", sb);
  // Row 2 (no valid CPT) errors BEFORE the note is added, so errors[0] tells
  // unshift from push; the RVU Wallet fixture does the same for its branch.
  const setCsv = "Date,CPT,Description,Category,Base wRVU,Modifiers,Adjusted wRVU,Compensation,Notes,Credit\n" +
    "2026-10-04,xx,Acute,Acute,0,,0,0.00,,Credited\n" +
    "2026-10-05,47562,Lap chole,General,10.21,,10.21,0.00,AB,No credit\n2026-10-06,49650,Lap hernia,Hernia,6.36,,6.36,350.00,CD,Credited\n";
  const histCsv = "Date,CPT,Description,Category,Type,Base wRVU,Modifiers,Adjusted wRVU,Compensation,Patient,Notes,Credit\n" +
    "2026-10-06,49650,Lap hernia,Hernia,Private,6.36,,6.36,350.00,CD,x,Credited\n";
  const walCsv = "Date,Codes,Total Work RVUs,Credit\n2026-10-05,99999,1,Credited\n2026-10-06,47562,10.21,No credit\n";
  const impA = sb.parseImport(setCsv, impMap), impB = sb.parseImport(histCsv, impMap), impW = sb.parseImport(walCsv, impMap);
  const noFlag = r => r.entries.every(e => !Object.prototype.hasOwnProperty.call(e, "noCredit"));
  check("CSV import: a Credit column warns first and never sets a no-credit mark",
    impA.entries.length === 2 && /^1 row is marked No credit and will import as CREDITED/.test(impA.errors[0] || "") &&
    impA.errors[1] === "Row 2: No valid CPT code" && noFlag(impA) &&
    impB.entries.length === 1 && impB.errors.every(m => !/No credit/.test(m)) && noFlag(impB) &&
    impW.entries.length === 2 && /^1 row is marked No credit/.test(impW.errors[0] || "") && /not in database/.test(impW.errors[1] || "") && noFlag(impW) &&
    JSON.stringify(sb.detectCols(["Credit"])) === JSON.stringify({ date: -1, cpt: -1, desc: -1, rvu: -1, modifier: -1, notes: -1 }),
    JSON.stringify({ a: impA.errors, b: impB.errors, w: impW.errors }));
  // A quoted note with a line break spans physical lines (CRLF too); an Excel
  // tab paste shifts cells when a description or modifier list holds a comma.
  const nlCsv = "Date,CPT,Description,Category,Base wRVU,Modifiers,Adjusted wRVU,Compensation,Notes,Credit\r\n" +
    "2026-10-05,47562,Lap chole,General,10.21,,10.21,0.00," + sb.csvField("AB \"x\"\nhard, case") + ",No credit\r\n" +
    "2026-10-07,49650,Lap hernia,Hernia,6.36,,6.36,0.00,EF,No credit\r\n2026-10-08,49650,Lap hernia,Hernia,6.36,,6.36,350.00," + sb.csvField("no\ncredit") + ",Credited\r\n";
  const tabCsv = ["Date", "CPT Code", "Description", "Category", "Type", "Base wRVU", "Modifiers", "Adjusted wRVU", "Compensation", "Patient", "Notes", "Credit"].join("\t") + "\n" +
    ["2026-10-05", "11042", "Debridement, subcutaneous tissue, first 20 sq cm", "Wound", "Call", "1.01", "-22, -51", "1.4", "0", "AB", "x", "No credit"].join("\t") + "\n";
  // A bare '"' (Excel leaves it unquoted in a tab paste) never closes a record;
  // the per-line count keeps the warning from collapsing to 1.
  const quoteCsv = "Date\tCPT\tNotes\tCredit\n2026-10-05\t49650\t2\" incision\tCredited\n2026-10-06\t47562\tAB\tNo credit\n2026-10-07\t47562\tCD\tNo credit\n";
  const impC = sb.parseImport(nlCsv, impMap), impD = sb.parseImport(tabCsv, impMap), impQ = sb.parseImport(quoteCsv, impMap);
  check("CSV import: the credit warning counts whole records (multi-line notes), comma-shifted and bare-quote tab pastes",
    /^2 rows are marked No credit/.test(impC.errors[0] || "") && noFlag(impC) && /^1 row is marked No credit/.test(impD.errors[0] || "") && noFlag(impD) &&
    /^2 rows are marked No credit/.test(impQ.errors[0] || "") && noFlag(impQ),
    JSON.stringify({ c: impC.errors, d: impD.errors, q: impQ.errors }));

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
  // Month totals (4b): by SHIFT-date month, whole-cent sums, current names.
  const mkShift = (id, site, date, events, o) => Object.assign(sb.payShiftFromDraft(draft(Object.assign({ id: id, siteId: site.id, date: date, callHours: String(site.rates[0].stipendHours), events: events || [] }, o || {})), site, null).shift);
  const S1b = Object.assign({}, S1, { name: "S1 renamed" });
  const tShifts = [
    mkShift("t1", S1, "2026-10-31", [dEv({ date: "2026-11-01", time: "01:00", cls: "we", hours: "1" })]),
    mkShift("t2", S2, "2026-10-05"),
    mkShift("t3", S1, "2026-11-02"),
    mkShift("t4", Object.assign({}, S1, { rates: [Object.assign({}, RA, { effective: "2025-01-01" })] }), "2025-12-31"),
    Object.assign({}, mkShift("t5", S2, "2026-10-07"), { siteId: "gone", siteName: "Old site" }),
    Object.assign({}, mkShift("t6", S2, "2026-10-08"), { rates: { bad: true } }),
  ];
  const tBefore = JSON.stringify(tShifts);
  const mt = sb.payMonthTotals(tShifts, 2026, [S1b, S2]);
  const oct = mt.months.filter(m => m.key === "2026-10")[0] || { sites: [], list: [] };
  const cents = v => Math.round(v * 100);
  const sumSites = m => m.sites.reduce((a, s) => a + cents(s.total), 0);
  check("payMonthTotals: shift-date month, newest first, year filter",
    mt.months.map(m => m.key).join(",") === "2026-11,2026-10" && oct.list.map(s => s.id).join(",") === "t1,t6,t5,t2" && mt.shifts === 5 && mt.callIns === 1,
    mt.months.map(m => m.key + ":" + m.list.map(s => s.id)).join(" "));
  check("payMonthTotals: sites sum to months, months to the year (whole cents)",
    mt.months.every(m => sumSites(m) === cents(m.total)) && mt.months.reduce((a, m) => a + cents(m.total), 0) === cents(mt.total));
  check("payMonthTotals: current site name; deleted site keeps its stored name",
    oct.sites.some(s => s.name === "S1 renamed" && !s.deleted) && oct.sites.some(s => s.name === "Old site" && s.deleted) && oct.sites.some(s => s.name === "S2"));
  check("payMonthTotals: an unpriceable shift is counted, never summed", mt.unpriced === 1 && oct.unpriced === 1 && oct.shifts === 4);
  check("payMonthTotals: input not mutated; other years empty", JSON.stringify(tShifts) === tBefore && sb.payMonthTotals(tShifts, 2024, []).months.length === 0);
  const RD = Object.assign({}, RA, { stipend: 0.1, stipendHours: 1, callInWeekday: 0, callInWeekendHoliday: 0, hourly: 0 });
  const SD = { id: "sd", name: "SD", weekendDays: [], rates: [RD] };
  const drift = [1, 2, 3].map(i => mkShift("d" + i, SD, "2026-03-0" + i));
  check("payMonthTotals: no float drift (3 x 0.10 = 0.30 exactly)", sb.payMonthTotals(drift, 2026, [SD]).total === 0.3);
  // Exact amounts (hand math, made-up rates): Oct = t1 1250 (1000 + 200 fee +
  // 50 hourly) + t2 2000.10 + t5 2000.10 = 5250.20; year adds Nov t3 1000.
  check("payMonthTotals: exact amounts", oct.total === 5250.2 && mt.total === 6250.2, oct.total + " / " + mt.total);
  // Grouping is by siteId: a site renamed mid-month is ONE row with its
  // current name; a deleted site sharing a live site's name stays separate.
  const SX = { id: "sx", name: "Now X", weekendDays: [0, 6], rates: [RA] };
  const ren = [Object.assign({}, mkShift("r1", S1, "2026-04-03"), { siteId: "sx", siteName: "Old X" }), Object.assign({}, mkShift("r2", S1, "2026-04-10"), { siteId: "sx", siteName: "Mid X" }),
    Object.assign({}, mkShift("r3", S1, "2026-04-12"), { siteId: "gone2", siteName: "Now X" })];
  const apr = sb.payMonthTotals(ren, 2026, [SX]).months[0];
  const live = apr.sites.filter(s => !s.deleted), dead = apr.sites.filter(s => s.deleted);
  check("payMonthTotals: grouped by siteId (rename = one row; same-name deleted site = separate)",
    apr.sites.length === 2 && live.length === 1 && live[0].name === "Now X" && live[0].shifts === 2 && dead.length === 1 && dead[0].shifts === 1,
    JSON.stringify(apr.sites));
  const nm = sb.paySiteNames([{ siteId: "g", siteName: "First", date: "2026-01-05" }, { siteId: "g", siteName: "Later", date: "2026-02-01" }, { siteId: "g", siteName: "Older", date: "2025-12-01" }, { siteId: "sx", siteName: "x", date: "2026-01-01" }], [SX]);
  check("paySiteNames: current name for live sites, newest stored name for deleted", nm.g === "Later" && nm.sx === "Now X", JSON.stringify(nm));
  // Re-pricing (4c). Made-up rates only.
  check("payRatesDiffer: amounts/flag matter; id, label, effective do not",
    !sb.payRatesDiffer(RA, Object.assign({}, RA, { id: "z", label: "x", effective: "2027-01-01" })) &&
    sb.payRatesDiffer(RA, Object.assign({}, RA, { hourly: 51 })) && sb.payRatesDiffer(RA, Object.assign({}, RA, { hourlyWeekdayDay: false })));
  const base24 = mkShift("rp1", S1, "2026-05-10");                      // 24h shift at RA (1000/24h)
  const part12 = Object.assign({}, base24, { id: "rp2", callHours: 12 }); // partial shift
  const R12 = Object.assign({}, RA, { id: "new12", effective: "2026-05-01", stipend: 1200, stipendHours: 12 });
  const S1back = Object.assign({}, S1, { rates: [RA, R12] });                               // backdated new version
  const S1fut = Object.assign({}, S1, { rates: [RA, Object.assign({}, R12, { effective: "2026-06-01" })] }); // starts after the shift
  const S1lbl = Object.assign({}, S1, { rates: [RA, Object.assign({}, RA, { id: "relabel", label: "renamed", effective: "2026-05-01" })] });
  check("payShiftStale: backdated different version = stale; future / label-only / other site = not",
    sb.payShiftStale(base24, S1back) && !sb.payShiftStale(base24, S1fut) && !sb.payShiftStale(base24, S1lbl) &&
    !sb.payShiftStale(base24, S2) && !sb.payShiftStale(base24, null));
  const rpBefore = JSON.stringify(base24);
  const rp = sb.payRepriceShift(base24, S1back), rpPart = sb.payRepriceShift(part12, S1back);
  check("payRepriceShift: full-length takes the new length; partial keeps its hours; hand-checked totals",
    !!rp && rp.callHours === 12 && rp.rates.id === "new12" && sb.computeShiftPay(rp).total === 1200 &&
    !!rpPart && rpPart.callHours === 12 && sb.computeShiftPay(rpPart).total === 1200 && sb.payRepriceShift(base24, S1lbl) === null);
  // Partial hours must be KEPT even when they differ from both lengths;
  // full-length grows as well as shrinks; the version IN FORCE is used (not
  // the newest); id and call-ins are kept.
  const R30 = Object.assign({}, RA, { id: "new30", effective: "2026-05-01", stipend: 3000, stipendHours: 30 });
  const S1grow = Object.assign({}, S1, { rates: [RA, R30, Object.assign({}, R12, { id: "later12", effective: "2026-09-01" })] });
  const hrs = h => Object.assign({}, base24, { id: "h" + h, callHours: h });
  const rp6 = sb.payRepriceShift(hrs(6), S1back), rp18 = sb.payRepriceShift(hrs(18), S1back), rp26 = sb.payRepriceShift(hrs(26), S1back);
  const rpGrow = sb.payRepriceShift(base24, S1grow);
  const withEv = Object.assign({}, mkShift("rpe", S1, "2026-05-10", [dEv({ date: "2026-05-10", time: "21:00", cls: "wn", hours: "1" })]));
  const rpEv = sb.payRepriceShift(withEv, S1back);
  check("payRepriceShift: partial/over-length hours kept, full grows, in-force version, id + call-ins kept",
    rp6.callHours === 6 && sb.computeShiftPay(rp6).total === 600 && rp18.callHours === 18 && sb.computeShiftPay(rp18).total === 1800 &&
    rp26.callHours === 26 && rpGrow.callHours === 30 && rpGrow.rates.id === "new30" && sb.computeShiftPay(rpGrow).total === 3000 &&
    rpEv.id === "rpe" && JSON.stringify(rpEv.events) === JSON.stringify(withEv.events),
    [rp6.callHours, rp18.callHours, rp26.callHours, rpGrow.callHours, rpGrow.rates.id].join(","));
  const rpStore = { entries: [], settings: { ratePerRVU: 55, annualGoal: 0, reconGoal: 0 }, paySites: [S1back], payShifts: JSON.parse(JSON.stringify([rp, rpPart])) };
  const rpJson = JSON.stringify(rpStore.payShifts);
  const rpFixed = sb.repairData(rpStore);
  check("payRepriceShift: rates copied (not shared), input untouched, passes repairData unchanged",
    rp.rates !== R12 && JSON.stringify(base24) === rpBefore && JSON.stringify(rpStore.payShifts) === rpJson && !rpFixed.some(f => /^payShifts/.test(f)), rpFixed.join(","));
  const useCur = sb.payShiftFromDraft(draft({ id: "rp1", date: "2026-05-10", events: [], reprice: true }), S1back, base24);
  check("payShiftFromDraft reprice flag re-takes the version in force", !!useCur.shift && useCur.ratesFrom === "inForce" && useCur.shift.rates.id === "new12");
  // payTotalInRange (Dashboard line): [from, to) by shift date, capped at upTo.
  const rangeShifts = [mkShift("q1", S1, "2026-06-30"), mkShift("q2", S1, "2026-07-01"), mkShift("q3", S1, "2026-10-11"), mkShift("q4", S1, "2027-06-30"), mkShift("q5", S1, "2027-07-01")];
  const fy = sb.payTotalInRange(rangeShifts, "2026-07-01", "2027-07-01");
  const ytd = sb.payTotalInRange(rangeShifts, "2026-07-01", "2027-07-01", "2026-10-11");
  const rangeOdd = sb.payTotalInRange(drift.concat([Object.assign({}, drift[0], { id: "bad", rates: { bad: true } })]), "2026-01-01", "2027-01-01");
  check("payTotalInRange: whole-cent sum (0.30 exactly); unpriceable counted, not summed", rangeOdd.total === 0.3 && rangeOdd.shifts === 4, JSON.stringify(rangeOdd));
  check("payTotalInRange: fiscal-year bounds, [from, to), YTD cap", fy.shifts === 3 && fy.total === 3000 && ytd.shifts === 2 && ytd.total === 2000 && sb.payTotalInRange([], "2026-01-01", "2027-01-01").total === 0,
    JSON.stringify([fy, ytd]));
  // Built-in sites (DEFAULT_PAY_SITES, made public by the owner): the
  // owner's confirmed worked examples must come out to the cent through the
  // preset, priced via rateInForce on dates after the Oct 1 2026 effective.
  const defs = sb.defaultPaySites();
  const SIL = defs.filter(s => s.name === "Silvis")[0], DAV = defs.filter(s => s.name === "Davenport")[0];
  const work = (site, shiftDate, hrs, evDate, time, h) => {
    const r = sb.rateInForce(site, shiftDate);
    const cls = sb.classifyPayEvent(evDate, time, site.weekendDays);
    const p = r && sb.computeShiftPay({ callHours: hrs, rates: r, events: [{ date: evDate, cls: cls, fee: true, hours: h }] });
    return p ? p.total.toFixed(2) + "/" + cls : "null";
  };
  const WORKED = [
    [work(SIL, "2026-10-13", 24, "2026-10-13", "21:00", 2.5), "2103.50/wn"],   // Silvis Tue 9pm 2.5h
    [work(SIL, "2026-10-16", 24, "2026-10-17", "01:00", 1.5), "2269.50/we"],   // Silvis Fri shift, Sat 1am 1.5h
    [work(SIL, "2026-11-26", 24, "2026-11-26", "14:00", 3), "2457.00/hol"],    // Silvis Thanksgiving 3h
    [work(DAV, "2026-10-14", 12, "2026-10-14", "20:00", 1), "4208.85/wn"],     // Davenport Wed 8pm 1h (3h min)
    [work(DAV, "2026-10-15", 12, "2026-10-15", "10:00", 2), "3480.78/wd"],     // Davenport Thu 10am 2h (no hourly)
    [work(DAV, "2026-10-17", 12, "2026-10-17", "11:00", 4), "4451.54/we"],     // Davenport Sat 4h
    [work(DAV, "2026-12-25", 12, "2026-12-25", "10:00", 2), "4208.85/hol"],    // Davenport Christmas day 2h (3h min)
    [work(DAV, "2027-07-05", 12, "2027-07-05", "10:00", 2), "4208.85/hol"],    // Davenport observed July 4 (Mon) 2h
  ];
  const badWorked = WORKED.filter(w => w[0] !== w[1]);
  check("built-in sites reproduce the owner's worked examples (8)", badWorked.length === 0, badWorked.map(w => w[0] + " want " + w[1]).join("; "));
  check("built-in sites: none in force before Oct 1 2026", sb.rateInForce(SIL, "2026-09-30") === null && sb.rateInForce(DAV, "2026-09-30") === null);
  const seedStore = (o) => Object.assign({ entries: [], settings: { ratePerRVU: 55, annualGoal: 0, reconGoal: 0 }, paySites: [], payShifts: [] }, o || {});
  const sEmpty = seedStore(); sb.repairData(sEmpty);
  const sHasSite = seedStore({ paySites: [S1] }); sb.repairData(sHasSite);
  const sHasShift = seedStore({ payShifts: [kept.shift] }); sb.repairData(sHasShift);
  const sMarked = seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true } }); sb.repairData(sMarked);
  check("seeding: empty store gets the built-in sites once; existing sites/shifts/marker untouched",
    sEmpty.paySites.map(s => s.name).join(",") === "Silvis,Davenport" && sEmpty.settings.paySitesSeeded === true &&
    sHasSite.paySites.length === 1 && sHasSite.settings.paySitesSeeded === true &&
    sHasShift.paySites.length === 0 && sMarked.paySites.length === 0);
  const sBad = seedStore({ paySites: { a: { name: "Mine" } } }); sb.repairData(sBad);
  check("seeding: a malformed (non-list) sites value is reset with a notice, not silently replaced",
    Array.isArray(sBad.paySites) && sBad.paySites.length === 0 && sBad.settings.paySitesSeeded === true &&
    sb.payWillSeed(seedStore()) === true && sb.payWillSeed(seedStore({ paySites: { x: 1 } })) === false &&
    sb.payWillSeed(seedStore({ settings: { paySitesSeeded: true } })) === false && sb.payWillSeed({ paySites: [] }) === false);
  const seededJson = JSON.stringify(sEmpty.paySites);
  const fixed2 = sb.repairData(sEmpty);
  check("built-in sites pass repairData unchanged (no rewrite on later loads)", JSON.stringify(sEmpty.paySites) === seededJson && fixed2.length === 0, fixed2.join(","));
  const ds = vm.runInContext("defState()", sb), ds2 = vm.runInContext("defState()", sb);
  check("new installs start with the built-in sites + marker (fresh copies)", ds.paySites.length === 2 && ds.settings.paySitesSeeded === true && ds.paySites[0] !== ds2.paySites[0]);
  // "Use built-in rates" (R1): a phone whose own same-named sites lack paying
  // rates gets the preset version on a confirmed tap. Names come from the
  // preset at run time; other rates are the made-up RA (paying) / RZ ($0).
  const BI = vm.runInContext("DEFAULT_PAY_SITES", sb), B0 = BI[0], B1 = BI[1], FROM = B0.rates[0].effective;
  const hand = (id, name, rates, wd) => ({ id: id, name: name, weekendDays: wd || [0, 6], casesEarnRVU: true, rates: rates || [] });
  const ver = (base, id, eff) => Object.assign({}, base, { id: id, effective: eff });
  const bf = (sites, def) => { const m = sb.payBuiltInFor(sites, def); return m ? m.by + ":" + (m.site ? m.site.id : "-") : "null"; };
  check("payBuiltInFor: id, then one same name (any case/spaces), then one '<name> ...' alias; ambiguous / other built-in ids / junk = no match",
    bf([hand(B0.id, "Renamed")], B0) === "id:" + B0.id && bf([hand("h1", "  " + B0.name.toUpperCase() + "  ")], B0) === "name:h1" &&
    bf([hand("h2", B1.name + " East")], B1) === "alias:h2" && bf([hand("h3", B1.name), hand("h4", B1.name.toLowerCase())], B1) === "ambiguous:-" &&
    bf([hand("h5", B1.name + " East"), hand("h6", B1.name + " West")], B1) === "ambiguous:-" && bf([hand("h7", B1.name), hand("h8", B1.name + " East")], B1) === "name:h7" &&
    bf([hand(B0.id, B1.name)], B1) === "null" && bf([hand("h9", B1.name + "ville")], B1) === "null" && bf(null, B0) === "null" && bf([null, 3, { id: "x" }], B0) === "null");
  check("payMissingBuiltIns: only defs with no standing site (an alias or ambiguous match counts as present)",
    sb.payMissingBuiltIns([]).length === 2 && sb.payMissingBuiltIns([hand("a", B0.name)]).map(d => d.id).join() === B1.id &&
    sb.payMissingBuiltIns([hand("a", B0.name + " Clinic"), hand("b", B1.name), hand("c", B1.name)]).length === 0);
  check("payRateZero: all four amounts 0", sb.payRateZero(RZ) === true && sb.payRateZero(RA) === false && sb.payRateZero(null) === false &&
    sb.payRateZero(Object.assign({}, RZ, { hourly: 0.01 })) === false);
  const PLAN_SHAPES = [ // [label, site, def, expected plan as JSON or null]
    ["hand-made, no rates", hand("s1", B0.name), B0, { remove: [], removeDates: [], later: "", days: true }],
    ["hand-made other site, no rates", hand("d1", B1.name), B1, { remove: [], removeDates: [], later: "", days: false }],
    ["seeded site whose rates were deleted", hand(B0.id, B0.name, [], B0.weekendDays.slice()), B0, { remove: [], removeDates: [], later: "", days: false }],
    ["own version only after the start", hand("s2", B0.name, [ver(RA, "v1", "2026-11-01")]), B0, { remove: [], removeDates: [], later: "2026-11-01", days: true }],
    ["... plus a later $0 version", hand("s3", B0.name, [ver(RA, "v1", "2026-11-01"), ver(RZ, "z1", "2026-12-01")]), B0, { remove: ["z1"], removeDates: ["2026-12-01"], later: "2026-11-01", days: true }],
    ["$0 version after the start", hand("d2", B1.name, [ver(RZ, "z1", "2026-10-05")]), B1, { remove: ["z1"], removeDates: ["2026-10-05"], later: "", days: false }],
    ["$0 version on exactly the start", hand("d3", B1.name, [ver(RZ, "z1", FROM)]), B1, { remove: ["z1"], removeDates: [FROM], later: "", days: false }],
    ["$0 version before the start (kept)", hand("d4", B1.name, [ver(RZ, "z0", "2026-09-01")]), B1, { remove: [], removeDates: [], later: "", days: false }],
    ["own paying version in force", hand("s4", B0.name, [ver(RA, "v0", "2026-09-01")]), B0, null],
    ["own paying version on exactly the start", hand("s5", B0.name, [ver(RA, "v0", FROM)]), B0, null],
    ["own paying version + a later $0 (no remove-only plan)", hand("s6", B0.name, [ver(RA, "v0", "2026-09-01"), ver(RZ, "z1", "2026-11-01")]), B0, null],
    ["hand-touched weekend days", hand("s7", B0.name, [], [5, 6]), B0, { remove: [], removeDates: [], later: "", days: false }],
  ];
  const planBad = [], applyBad = [];
  PLAN_SHAPES.forEach(t => {
    const before = JSON.stringify(t[1]);
    const plan = sb.payBuiltInPlan(t[1], t[2]);
    if (JSON.stringify(plan) !== JSON.stringify(t[3]) || JSON.stringify(t[1]) !== before) { planBad.push(t[0] + " -> " + JSON.stringify(plan)); return; }
    if (!plan) return;
    const inStore = seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: [JSON.parse(before)] });
    const inJson = JSON.stringify(inStore);
    if (sb.repairData(inStore).length || JSON.stringify(inStore) !== inJson) { applyBad.push(t[0] + ": fixture not canonical"); return; }
    const out = sb.payApplyBuiltIn(t[1], t[2], plan);
    const store = seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: [out] }), json = JSON.stringify(store);
    const fx = sb.repairData(store);
    const effs = out.rates.map(r => r.effective);
    const keptPaying = t[1].rates.filter(r => !sb.payRateZero(r)).every(r => out.rates.some(o => JSON.stringify(o) === JSON.stringify(r)));
    const ok = fx.length === 0 && JSON.stringify(store) === json && sb.payBuiltInPlan(out, t[2]) === null &&
      effs.length === new Set(effs).size && keptPaying && out.casesEarnRVU === t[1].casesEarnRVU && JSON.stringify(t[1]) === before &&
      JSON.stringify(out.weekendDays) === JSON.stringify(plan.days ? t[2].weekendDays : t[1].weekendDays) &&
      JSON.stringify(sb.rateInForce(out, FROM)) === JSON.stringify(t[2].rates[0]);
    if (!ok) applyBad.push(t[0] + " " + JSON.stringify({ fx: fx, effs: effs, keptPaying: keptPaying }));
  });
  check("payBuiltInPlan: " + PLAN_SHAPES.length + " phone shapes (paying amounts never touched; $0 versions from the start removed)", planBad.length === 0, planBad.join(" | "));
  check("payApplyBuiltIn: repairData fixed point, second apply a no-op, no duplicate dates, paying versions + casesEarnRVU kept, preset in force from the start",
    applyBad.length === 0, applyBad.join(" | "));
  const idFree = hand(B0.id, B0.name, [Object.assign({}, RZ, { id: B0.rates[0].id, effective: "2026-11-01" })], B0.weekendDays.slice());
  const idFreeOut = sb.payApplyBuiltIn(idFree, B0, sb.payBuiltInPlan(idFree, B0));
  const idTaken = hand("s8", B0.name, [ver(RA, B0.rates[0].id, "2027-01-01")]);
  const idTakenOut = sb.payApplyBuiltIn(idTaken, B0, sb.payBuiltInPlan(idTaken, B0));
  check("payApplyBuiltIn rate ids: a removed $0 version frees the preset id; a taken id gets a new one",
    idFreeOut.rates.length === 1 && idFreeOut.rates[0].id === B0.rates[0].id && JSON.stringify(idFreeOut.rates[0]) === JSON.stringify(B0.rates[0]) &&
    idTakenOut.rates.length === 2 && idTakenOut.rates[1].id !== B0.rates[0].id && idTakenOut.rates[1].id.indexOf(B0.rates[0].id + "-") === 0);
  const offerSites = [hand("s1", B0.name), hand("d9", B1.name + " East", [ver(RA, "v0", "2026-09-01")])];
  const offs = sb.payBuiltInOffers(offerSites);
  check("payBuiltInOffers: one offer per standing site without paying rates; a site with its own rates gets none",
    offs.length === 1 && offs[0].site === offerSites[0] && offs[0].def.id === B0.id && offs[0].by === "name" && sb.payBuiltInOffers([]).length === 0);
  // Filled hand-made sites must price the owner's examples exactly like the preset.
  const fS = sb.payApplyBuiltIn(hand("s1", B0.name), B0, sb.payBuiltInPlan(hand("s1", B0.name), B0));
  const fD = sb.payApplyBuiltIn(hand("d1", B1.name), B1, sb.payBuiltInPlan(hand("d1", B1.name), B1));
  const viaFilled = [work(fS, "2026-10-13", 24, "2026-10-13", "21:00", 2.5), work(fS, "2026-10-16", 24, "2026-10-17", "01:00", 1.5), work(fS, "2026-11-26", 24, "2026-11-26", "14:00", 3),
    work(fD, "2026-10-14", 12, "2026-10-14", "20:00", 1), work(fD, "2026-10-15", 12, "2026-10-15", "10:00", 2), work(fD, "2026-10-17", 12, "2026-10-17", "11:00", 4)];
  check("filled hand-made sites price the owner's worked examples exactly like the preset",
    viaFilled.join(",") === WORKED.slice(0, 6).map(w => w[1]).join(","), viaFilled.join(","));
  check("payMissingBuiltIns: a site of any id already using a built-in's name blocks adding a same-named second site",
    sb.payMissingBuiltIns([hand(B0.id, B1.name)]).length === 0 && sb.payMissingBuiltIns([hand(B1.id, "  " + B0.name.toLowerCase())]).length === 0);
  // Weekend days added by "Use built-in rates" (hand-made site on Sat/Sun ->
  // preset weekend): recorded weekday call-ins on an added day, dated from the
  // built-in start, re-price as weekend call-ins - the same pay as logging
  // them now. Holidays, weekend classes and earlier shifts are untouched.
  const zSite = hand("sz", B0.name, [ver(RZ, "z0", "2026-09-01")]);
  const zPlan = sb.payBuiltInPlan(zSite, B0), zFilled = sb.payApplyBuiltIn(zSite, B0, zPlan);
  const OLD = zSite.weekendDays, NEW = zFilled.weekendDays;
  const fri = mkShift("fz", zSite, "2026-10-02", [dEv({ date: "2026-10-02", time: "21:00", cls: "wn", hours: "2" })]);
  const friBefore = JSON.stringify(fri);
  const friRe = sb.payRepriceShift(fri, zFilled), friFix = sb.payReclassShift(friRe, OLD, NEW, FROM);
  const friNow = mkShift("fn", zFilled, "2026-10-02", [dEv({ date: "2026-10-02", time: "21:00", cls: "we", hours: "2" })]);
  const rcl = (date, ev) => sb.payReclassShift(mkShift("r", zSite, date, [dEv(ev)]), OLD, NEW, FROM);
  const timeless = rcl("2026-10-09", { date: "2026-10-09", time: "", cls: "wd", hours: "1" });
  const fixStore = seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: [zFilled], payShifts: [JSON.parse(JSON.stringify(friFix))] });
  const fixJson = JSON.stringify(fixStore), fixFixed = sb.repairData(fixStore);
  check("payReclassShift: a recorded Friday call-in re-prices at the weekend fee once Friday is added (same pay as logging it now)",
    !!zPlan && zPlan.days === true && !!friRe && friRe.events[0].cls === "wn" && !!friFix && friFix.events[0].cls === "we" &&
    sb.computeShiftPay(friFix).total === 2332 && sb.computeShiftPay(friFix).total === sb.computeShiftPay(friNow).total &&
    !!timeless && timeless.events[0].cls === "we" && JSON.stringify(fri) === friBefore && fixFixed.length === 0 && JSON.stringify(fixStore) === fixJson,
    JSON.stringify({ re: friRe && friRe.events[0].cls, fix: friFix && friFix.events[0].cls, total: friFix && sb.computeShiftPay(friFix).total, fixed: fixFixed }));
  check("payReclassShift: holidays, weekend classes, other weekdays, shifts before the start and no added days are untouched (null)",
    rcl("2026-12-25", { date: "2026-12-25", time: "10:00", cls: "hol" }) === null && rcl("2026-12-25", { date: "2026-12-25", time: "10:00", cls: "wd" }) === null &&
    rcl("2026-10-02", { date: "2026-10-03", time: "01:00", cls: "we" }) === null && rcl("2026-10-08", { date: "2026-10-08", time: "21:00", cls: "wn" }) === null &&
    rcl("2026-09-25", { date: "2026-09-25", time: "21:00", cls: "wn" }) === null &&
    sb.payReclassShift(fri, NEW, NEW, FROM) === null && sb.payReclassShift(null, OLD, NEW, FROM) === null);
  // ---- R2: the simple shift form's draft rules (pay math unchanged) ----
  const rif = (site, date) => sb.rateInForce(site, date);
  const keptD = { id: "k1", siteId: SIL.id, date: "2026-10-13", callHours: "24", events: [] };
  const keptO = Object.assign({}, keptD, { rates: Object.assign({}, rif(SIL, "2026-10-13"), { stipend: 1 }) });
  check("payDraftRate: kept copy while site+date unchanged; reprice / new date / no site = in force or none",
    sb.payDraftRate(keptD, SIL, keptO).from === "kept" && sb.payDraftRate(keptD, SIL, keptO).rates.stipend === 1 &&
    sb.payDraftRate(Object.assign({}, keptD, { reprice: true }), SIL, keptO).from === "inForce" &&
    sb.payDraftRate(Object.assign({}, keptD, { date: "2026-10-14" }), SIL, keptO).from === "inForce" &&
    sb.payDraftRate(keptD, null, null).from === "" && sb.payDraftRate(Object.assign({}, keptD, { date: "" }), SIL, null).rates === null &&
    sb.payDraftRate(keptD, SIL, keptO).rates !== keptO.rates);
  check("payAsksDayNight: only a non-holiday weekday where daytime hourly is unpaid",
    sb.payAsksDayNight("2026-10-14", DAV, rif(DAV, "2026-10-14")) === true && sb.payAsksDayNight("2026-10-17", DAV, rif(DAV, "2026-10-17")) === false &&
    sb.payAsksDayNight("2026-12-25", DAV, rif(DAV, "2026-12-25")) === false && sb.payAsksDayNight("2026-10-13", SIL, rif(SIL, "2026-10-13")) === false &&
    sb.payAsksDayNight("2026-10-16", SIL, rif(SIL, "2026-10-16")) === false && sb.payAsksDayNight("", DAV, rif(DAV, "2026-10-14")) === false);
  const MID = [
    [SIL, "2026-10-08", true], [SIL, "2026-10-11", true], [SIL, "2026-11-25", true], [SIL, "2026-12-23", true], [SIL, "2026-12-30", true], [SIL, "2027-05-31", true],
    [SIL, "2026-10-06", false], [SIL, "2026-10-09", false], [SIL, "2026-11-26", false], [SIL, "2026-12-25", false], [DAV, "2026-10-08", false], [DAV, "2026-10-09", false],
  ];
  const badMid = MID.filter(m => sb.payMidnightAsks(m[1], m[0], rif(m[0], m[1])) !== m[2]);
  check("payMidnightAsks: only where the next day's call-in fee differs (14 cases)",
    badMid.length === 0 && sb.payMidnightAsks("", SIL, rif(SIL, "2026-10-08")) === false && sb.payMidnightAsks("2026-10-08", SIL, null) === false,
    badMid.map(m => m[0].name + " " + m[1]).join(", "));
  // A full simple-form flow: pick site + day, then each trip = new trip +
  // the answers the form would collect (hours, before/after midnight, Day/Night).
  const sflow = (site, date, trips) => {
    let d = { id: "f-" + date, siteId: site.id, date: date, callHours: "", hoursSet: false, events: [], note: "" };
    const rate = sb.payDraftRate(d, site, null).rates;
    d = sb.payDraftRefresh(d, site, "", "", rate);
    (trips || []).forEach(t => {
      let e = sb.payDraftTrip(d.date, site, rate);
      e = Object.assign({}, e, { hours: t.hours }, t.rel ? { rel: t.rel, relSet: true } : {}, t.dn ? { dn: t.dn } : {});
      d.events.push(sb.payDraftEvent(e, d.date, site, "", "", rate));
    });
    const b = sb.payShiftFromDraft(d, site, null);
    return b.shift ? sb.computeShiftPay(b.shift).total.toFixed(2) : "blocked:" + b.problems.filter(p => p.block).map(p => p.code).sort().join("+");
  };
  const FLOWS = [
    ["Silvis Tue, went in 2.5h (no question)", sflow(SIL, "2026-10-13", [{ hours: "2.5" }]), "2103.50"],
    ["Davenport Thu, Day, 2h", sflow(DAV, "2026-10-15", [{ hours: "2", dn: "wd" }]), "3480.78"],
    ["Davenport Wed, Night, 1h (3h minimum)", sflow(DAV, "2026-10-14", [{ hours: "1", dn: "wn" }]), "4208.85"],
    ["Silvis, did not go in", sflow(SIL, "2026-10-13", []), "1500.00"],
    ["Davenport, did not go in", sflow(DAV, "2026-10-14", []), "3189.65"],
    ["Silvis Thu, midnight unanswered", sflow(SIL, "2026-10-15", [{ hours: "1.5" }]), "blocked:evCls+evDate"],
    ["Silvis Thu, after midnight, 1.5h", sflow(SIL, "2026-10-15", [{ hours: "1.5", rel: "next" }]), "2269.50"],
    ["Silvis Thu, before midnight, 1.5h", sflow(SIL, "2026-10-15", [{ hours: "1.5", rel: "same" }]), "1978.50"],
    ["Silvis Thanksgiving, 3h", sflow(SIL, "2026-11-26", [{ hours: "3" }]), "2457.00"],
    ["Davenport Sat, 4h", sflow(DAV, "2026-10-17", [{ hours: "4" }]), "4451.54"],
    ["Davenport Christmas, 2h", sflow(DAV, "2026-12-25", [{ hours: "2" }]), "4208.85"],
    ["Davenport weekday, Day/Night unanswered", sflow(DAV, "2026-10-14", [{ hours: "1" }]), "blocked:evCls"],
    ["Davenport two 1h trips at night", sflow(DAV, "2026-10-14", [{ hours: "1", dn: "wn" }, { hours: "1", dn: "wn" }]), "5228.05"],
  ];
  const badFlows = FLOWS.filter(f => f[1] !== f[2]);
  check("simple form flows on the built-in sites (" + FLOWS.length + ": the owner's examples, no call-in, questions blocking until answered)",
    badFlows.length === 0, badFlows.map(f => f[0] + " -> " + f[1] + " want " + f[2]).join("; "));
  const rr = (site, from, to, e) => { const rt = rif(site, to); return sb.payDraftRefresh({ id: "x", siteId: site.id, date: to, callHours: "12", hoursSet: true, events: [e] }, site, "", "", rt).events[0]; };
  const dnWed = sb.payDraftEvent(Object.assign(sb.payDraftTrip("2026-10-14", DAV, rif(DAV, "2026-10-14")), { dn: "wd" }), "2026-10-14", DAV, "", "", rif(DAV, "2026-10-14"));
  const toSat = rr(DAV, "2026-10-14", "2026-10-17", dnWed), backWed = rr(DAV, "2026-10-17", "2026-10-14", toSat);
  const triTue = sb.payDraftTrip("2026-10-13", SIL, rif(SIL, "2026-10-13"));
  const triThu = sb.payDraftRefresh({ id: "x", siteId: SIL.id, date: "2026-10-15", callHours: "24", hoursSet: true, events: [triTue] }, SIL, "", "", rif(SIL, "2026-10-15")).events[0];
  check("draft rules: a weekend date beats a Day/Night answer (and it returns on a weekday); an unanswered trip re-asks on a fee boundary",
    dnWed.cls === "wd" && toSat.cls === "we" && backWed.cls === "wd" && triTue.rel === "same" && triTue.date === "2026-10-13" && triTue.cls === "wn" &&
    triThu.rel === "" && triThu.date === "" && triThu.cls === "" && triTue.time === "" && triTue.timeAuto === false,
    JSON.stringify([dnWed.cls, toSat.cls, backWed.cls, triTue.rel, triThu.rel]));
  // Edit round trip: payDraftFromShift -> payShiftFromDraft rebuilds every
  // saved shift byte-identically (old-form shifts with times, timeless
  // Day/Night picks, overrides, fee off, unknown fields), also after every
  // call-in is re-run through payDraftEvent with the rate.
  const svd = (site, id, date, hrs, evs, extra) => Object.assign(sb.payShiftFromDraft({ id: id, siteId: site.id, date: date, callHours: hrs, note: "n", events: evs }, site, null).shift, extra || {});
  const RT = [
    svd(SIL, "rt1", "2026-10-13", "24", [{ date: "2026-10-13", time: "21:00", cls: "wn", fee: true, hours: "2" }, { date: "2026-10-14", time: "", cls: "wd", fee: false, hours: "1" }], { extra: "keep" }),
    svd(SIL, "rt2", "2026-10-13", "24", [{ date: "2026-10-13", time: "", cls: "we", fee: true, hours: "0" }, { date: "2026-10-20", time: "", cls: "hol", fee: true, hours: "1" }]),
    svd(DAV, "rt3", "2026-10-14", "12", [{ date: "2026-10-14", time: "", cls: "wn", fee: true, hours: "1" }, { date: "2026-10-15", time: "10:00", cls: "wd", fee: true, hours: "2" }]),
    svd(DAV, "rt4", "2026-10-14", "6", [{ date: "2026-10-17", time: "", cls: "we", fee: true, hours: "1" }]),
  ];
  const rtBad = [];
  RT.forEach(s => {
    const site = s.siteId === SIL.id ? SIL : DAV, json = JSON.stringify(s);
    const d = sb.payDraftFromShift(s, site);
    const b1 = sb.payShiftFromDraft(d, site, s).shift;
    const rate = sb.payDraftRate(d, site, s).rates;
    const d2 = Object.assign({}, d, { events: d.events.map(e => sb.payDraftEvent(e, d.date, site, "", "", rate)) });
    const b2 = sb.payShiftFromDraft(d2, site, s).shift;
    const store = seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: [SIL, DAV], payShifts: [JSON.parse(JSON.stringify(b2))] });
    const sj = JSON.stringify(store), fx = sb.repairData(store);
    if (JSON.stringify(b1) !== json || JSON.stringify(b2) !== json || fx.length || JSON.stringify(store) !== sj) rtBad.push(s.id + " " + JSON.stringify({ b1: JSON.stringify(b1) === json, b2: JSON.stringify(b2) === json, fx: fx }));
  });
  check("payDraftFromShift round trip: saved shifts rebuild byte-identically (also re-run through the rules) and pass repairData", rtBad.length === 0, rtBad.join(" | "));
  const full12 = sb.payDraftFromShift(RT[2], DAV), part6 = sb.payDraftFromShift(RT[3], DAV);
  const toSil = d => { const nd = Object.assign({}, d, { siteId: SIL.id }); return sb.payDraftRefresh(nd, SIL, "", "", sb.payDraftRate(nd, SIL, null).rates); };
  check("site switch in the editor: a full-length shift takes the new site's length; a partial one keeps its hours",
    full12.hoursSet === false && toSil(full12).callHours === "24" && part6.hoursSet === true && toSil(part6).callHours === "6");
  // A saved timeless Day/Night pick re-opens as the ANSWER (dn), not an
  // override - so moving the shift onto a weekend re-classifies it.
  const ev0 = sb.payDraftFromShift(RT[2], DAV).events[0];
  const movedSat = sb.payDraftRefresh(Object.assign({}, sb.payDraftFromShift(RT[2], DAV), { date: "2026-10-17" }), DAV, "", "", rif(DAV, "2026-10-17")).events[0];
  check("payDraftFromShift: a timeless Day/Night pick re-opens as the answer and still yields to a weekend date",
    ev0.dn === "wn" && ev0.clsSet === false && movedSat.cls === "we", JSON.stringify({ dn: ev0.dn, clsSet: ev0.clsSet, moved: movedSat.cls }));
  // Re-applying the SAME day to an edited full-length shift keeps the length
  // of the rates it is priced at (its kept copy), not the current version's.
  const DAVlen = Object.assign({}, DAV, { rates: [Object.assign({}, DAV.rates[0], { id: "dav-len", stipendHours: 24, stipend: 6000 })] });
  const keptLen = svd(DAVlen, "kl", "2026-10-14", "24", []);
  const DAVnow = Object.assign({}, DAV, { rates: [Object.assign({}, DAVlen.rates[0], { id: "dav-now", stipendHours: 12, stipend: 3000 })] });
  const kd = sb.payDraftFromShift(keptLen, DAVnow);
  const kr = sb.payDraftRefresh(kd, DAVnow, "", "", sb.payDraftRate(kd, DAVnow, keptLen).rates);
  check("payDraftRefresh: an edited full shift keeps its kept rate's length when the same day is re-applied",
    kd.hoursSet === false && kr.callHours === "24" && sb.payShiftFromDraft(kr, DAVnow, keptLen).shift.callHours === 24, kr.callHours);
  // R2 review: editing must never turn a DEFAULT into an answer. A shift
  // saved where no question applied re-asks after a day/site change that
  // makes the answer matter - exactly like the New shift form.
  const saveNew = (site, date, hours, dn) => {
    let d = { id: "sn-" + date, siteId: site.id, date: date, callHours: "", hoursSet: false, events: [], note: "" };
    const rate = sb.payDraftRate(d, site, null).rates;
    d = sb.payDraftRefresh(d, site, "", "", rate);
    d.events.push(sb.payDraftEvent(Object.assign(sb.payDraftTrip(date, site, rate), { hours: hours }, dn ? { dn: dn } : {}), date, site, "", "", rate));
    return sb.payShiftFromDraft(d, site, null).shift;
  };
  const editTo = (s, site0, site1, date1) => {
    const d = Object.assign(sb.payDraftFromShift(s, site0), { siteId: site1.id, date: date1 });
    const b = sb.payShiftFromDraft(sb.payDraftRefresh(d, site1, "", "", sb.payDraftRate(d, site1, s).rates), site1, s);
    return b.shift ? sb.computeShiftPay(b.shift).total.toFixed(2) : "blocked:" + b.problems.filter(p => p.block).map(p => p.code).sort().join("+");
  };
  const silTue = saveNew(SIL, "2026-10-13", "2"), silFri = saveNew(SIL, "2026-10-16", "2"), davThu = saveNew(DAV, "2026-10-15", "1", "wn");
  const silTueEv = sb.payDraftFromShift(silTue, SIL).events[0];
  check("edit: a quiet Silvis Night or an un-asked 'Before midnight' is NOT an answer - a site/day change re-asks (blocks)",
    silTue.events[0].cls === "wn" && silTueEv.dn === "" && silTueEv.relSet === false &&
    editTo(silTue, SIL, DAV, "2026-10-13") === "blocked:evCls" && editTo(silTue, SIL, SIL, "2026-10-15") === "blocked:evCls+evDate" &&
    editTo(silFri, SIL, SIL, "2026-10-15") === "blocked:evCls+evDate" && !!davThu && editTo(davThu, DAV, SIL, "2026-10-15") === "blocked:evCls+evDate" &&
    editTo(silTue, SIL, SIL, "2026-10-13") === "2041.00",
    [editTo(silTue, SIL, DAV, "2026-10-13"), editTo(silTue, SIL, SIL, "2026-10-15"), editTo(silFri, SIL, SIL, "2026-10-15"), davThu ? editTo(davThu, DAV, SIL, "2026-10-15") : "no davThu"].join(" | "));
  // "Use current rates" re-derives every call-in under the new rate: a trip
  // added under a kept $0 copy (equal fees, no question) re-asks after it.
  const zSil = hand("zs", B0.name, [ver(RZ, "z0", "2026-09-01")], B0.weekendDays.slice());
  const zThu = mkShift("zt", zSil, "2026-10-15", []);
  const zSilNow = Object.assign({}, zSil, { rates: zSil.rates.concat([JSON.parse(JSON.stringify(B0.rates[0]))]) });
  const zd = sb.payDraftFromShift(zThu, zSilNow);
  const zKept = sb.payDraftRate(zd, zSilNow, zThu).rates;
  zd.events.push(sb.payDraftEvent(Object.assign(sb.payDraftTrip(zd.date, zSilNow, zKept), { hours: "2" }), zd.date, zSilNow, "", "", zKept));
  const zRe = Object.assign({}, zd, { reprice: true });
  const zReB = sb.payShiftFromDraft(sb.payDraftRefresh(zRe, zSilNow, "", "", sb.payDraftRate(zRe, zSilNow, zThu).rates), zSilNow, zThu);
  check("Use current rates + refresh: a call-in added under the kept rate re-asks the midnight question under the new one",
    zd.events[0].rel === "same" && !zReB.shift && zReB.problems.some(p => p.code === "evDate" && p.block), JSON.stringify(zReB.problems));
  // Deleted site: weekend days unknown - saved classes are kept as-is, no
  // question is guessed, and a new call-in needs a picked rate type (a
  // holiday is still recognised).
  const satShift = svd(SIL, "ds", "2026-10-17", "24", [{ date: "2026-10-17", time: "", cls: "we", fee: true, hours: "2" }]);
  const STAND = { id: satShift.siteId, name: satShift.siteName, weekendDays: [], rates: [], deleted: true }; // as callpay.js siteFor builds it
  const dsd = sb.payDraftFromShift(satShift, STAND);
  const dsRate = sb.payDraftRate(dsd, STAND, satShift).rates;
  const dsTrip = sb.payDraftEvent(Object.assign(sb.payDraftTrip(dsd.date, STAND, dsRate), { hours: "1" }), dsd.date, STAND, "", "", dsRate);
  const xmasTrip = sb.payDraftTrip("2026-12-25", STAND, dsRate);
  const dsBlocked = sb.payShiftFromDraft(Object.assign({}, dsd, { events: dsd.events.concat([dsTrip]) }), STAND, satShift);
  // A quiet weekday Night saved at a site later deleted survives editing
  // (every call-in re-run through the rules) unchanged.
  const tueStand = { id: silTue.siteId, name: silTue.siteName, weekendDays: [], rates: [], deleted: true };
  const td = sb.payDraftFromShift(silTue, tueStand), tRate = sb.payDraftRate(td, tueStand, silTue).rates;
  const tdRe = Object.assign({}, td, { events: td.events.map(e => sb.payDraftEvent(e, td.date, tueStand, "", "", tRate)) });
  const tueKept = JSON.stringify(sb.payShiftFromDraft(tdRe, tueStand, silTue).shift) === JSON.stringify(silTue);
  check("deleted site: saved classes kept (round trip identical), no guessed class or question; holidays still recognised",
    JSON.stringify(sb.payShiftFromDraft(dsd, STAND, satShift).shift) === JSON.stringify(satShift) && dsd.events[0].clsSet === true &&
    dsTrip.cls === "" && !dsBlocked.shift && dsBlocked.problems.some(p => p.code === "evCls") && xmasTrip.cls === "hol" && tueKept &&
    sb.payAsksDayNight("2026-10-14", STAND, rif(DAV, "2026-10-14")) === false && sb.payMidnightAsks("2026-10-15", STAND, dsRate) === false,
    JSON.stringify({ trip: dsTrip.cls, xmas: xmasTrip.cls }));
  // Moving a deleted site's shift to a LIVE site re-applies the normal rules
  // (the kept class is only a deleted-site memo, never an answer).
  const standOf = s => ({ id: s.siteId, name: s.siteName, weekendDays: [], rates: [], deleted: true });
  const mine = hand("hm", B0.name + " (mine)", [JSON.parse(JSON.stringify(B0.rates[0]))], [0, 6]);
  const myFri = svd(mine, "hf", "2026-10-16", "24", [{ date: "2026-10-16", time: "21:00", cls: "wn", fee: true, hours: "2" }]);
  const timeEdit = (() => { const d = sb.payDraftFromShift(myFri, standOf(myFri)), r = sb.payDraftRate(d, standOf(myFri), myFri).rates;
    return sb.payDraftEvent(Object.assign({}, d.events[0], { time: "10:00" }), d.date, standOf(myFri), "", "", r).cls; })();
  check("deleted site -> live site: weekend day wins, quiet Night and un-asked midnight re-ask; a changed time on a deleted site asks the rate type",
    sb.computeShiftPay(myFri).total === 2041 && editTo(myFri, standOf(myFri), SIL, "2026-10-16") === "2332.00" &&
    editTo(silTue, standOf(silTue), DAV, "2026-10-13") === "blocked:evCls" && editTo(davThu, standOf(davThu), SIL, "2026-10-15") === "blocked:evCls+evDate" &&
    timeEdit === "",
    [editTo(myFri, standOf(myFri), SIL, "2026-10-16"), editTo(silTue, standOf(silTue), DAV, "2026-10-13"), editTo(davThu, standOf(davThu), SIL, "2026-10-15"), timeEdit].join(" | "));
  check("payShiftYears: distinct, newest first, bad dates ignored", sb.payShiftYears(tShifts.concat([{ date: "junk" }, null])).join(",") === "2026,2025");
  const noTime = sb.payShiftFromDraft(draft({ events: [dEv({ time: "" })] }), S1, null).shift;
  check("start time never changes pay", CONTRACT.every(s => sb.computeShiftPay(s) !== null) && sb.computeShiftPay(noTime).total === sb.computeShiftPay(CONTRACT[0]).total);
  // creditedRVU: strict noCredit === true gives 0; anything else passes the
  // raw snapshot through UNCHANGED (no coercion - same as the raw read), so
  // routing every sum through it changes no existing total.
  const ce = { adjustedRVU: 0.1 + 0.2 }, cn = { adjustedRVU: 7.96, noCredit: true };
  check("creditedRVU: raw value passes through; only noCredit === true gives 0; entry untouched",
    sb.creditedRVU(ce) === ce.adjustedRVU && sb.creditedRVU(cn) === 0 && cn.adjustedRVU === 7.96 &&
    [false, "true", 1, null, undefined].every(v => sb.creditedRVU({ adjustedRVU: 2.5, noCredit: v }) === 2.5) &&
    sb.creditedRVU({}) === undefined);
  // isNoCredit is the strict flag test; noCreditRVU mirrors creditedRVU for
  // the "Logged, no credit" lines.
  const NC_NOT = [false, "true", 1, "1", null, undefined, {}];
  check("isNoCredit: true only for noCredit === true; safe on null/undefined/{}",
    sb.isNoCredit(cn) === true && NC_NOT.every(v => sb.isNoCredit({ adjustedRVU: 2.5, noCredit: v }) === false) &&
    sb.isNoCredit(null) === false && sb.isNoCredit(undefined) === false && sb.isNoCredit({}) === false);
  const ncFix = [ce, cn, { adjustedRVU: 4.25 }, { adjustedRVU: 0 }, { adjustedRVU: 12.5, noCredit: true }, { adjustedRVU: 3, noCredit: "true" }];
  const ncFixJson = JSON.stringify(ncFix);
  check("noCreditRVU: mirrors creditedRVU (credited + no credit = adjustedRVU); inputs untouched",
    sb.noCreditRVU(cn) === 7.96 && sb.noCreditRVU(ce) === 0 && NC_NOT.every(v => sb.noCreditRVU({ adjustedRVU: 2.5, noCredit: v }) === 0) &&
    ncFix.every(x => sb.creditedRVU(x) + sb.noCreditRVU(x) === x.adjustedRVU) && JSON.stringify(ncFix) === ncFixJson);
  // repairData rule for entries[].noCredit (true or absent): false dropped
  // silently, anything else dropped LOUDLY in one combined banner, in-shape
  // data untouched (a fixed point), validateData deliberately not tightened.
  const ncE = (i, nc) => Object.assign({ id: "nc" + i, date: "2026-03-1" + i, cptCode: "4756" + i, adjustedRVU: 10 + i }, nc === undefined ? {} : { noCredit: nc });
  const ncStore = ents => seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, entries: ents });
  const realAlert = sb.showDataAlert, banners = [];
  try {
    sb.showDataAlert = function(msg) { banners.push(msg); };
    const sA = ncStore([ncE(1, true), ncE(2)]), jA = JSON.stringify(sA);
    const fA = sb.repairData(sA), bA = banners.length;
    const sB = ncStore([ncE(1, false), ncE(2, true)]);
    const fB = sb.repairData(sB), bB = banners.length - bA;
    const sC = ncStore([ncE(0, "true"), ncE(1, 1), ncE(2, "1"), ncE(3, null), ncE(4, "yes"), ncE(5, {}), ncE(6, true), ncE(7, false), null, 42]);
    const fC = sb.repairData(sC), bC = banners.slice(bA + bB);
    const kept = sC.entries.filter(x => !!x && typeof x === "object" && "noCredit" in x);
    const jC = JSON.stringify(sC), nBefore = banners.length;
    const fD = sb.repairData(sC);
    const sOne = ncStore([ncE(1, "x")]); sb.repairData(sOne);
    check("repairData noCredit rule: in-shape untouched; false dropped silently; garbled dropped with ONE ASCII banner; fixed point",
      JSON.stringify(sA) === jA && fA.length === 0 && bA === 0 &&
      !("noCredit" in sB.entries[0]) && sB.entries[1].noCredit === true && fB.filter(x => x === "entries.noCredit").length === 1 && bB === 0 &&
      kept.length === 1 && kept[0].id === "nc6" && fC.filter(x => x === "entries.noCredit").length === 1 && bC.length === 1 &&
      !/[^\x00-\x7f]/.test(bC[0]) && bC[0].indexOf("6 procedures (") !== -1 && bC[0].indexOf("and 1 more) were") !== -1 && bC[0].indexOf("they count") !== -1 &&
      sC.entries[8] === null && sC.entries[9] === 42 && fD.length === 0 && banners.length === nBefore + 1 && JSON.stringify(sC) === jC &&
      banners[banners.length - 1] === "The no-credit mark on procedure 2026-03-11 47561 was unreadable and removed - it counts for wRVU credit, as before. Check it in History.",
      JSON.stringify({ fA: fA, fB: fB, fC: fC, fD: fD, banners: banners }));
    check("validateData deliberately ignores noCredit (a bad mark never triggers last-good recovery)",
      [sA, sB, sC, ncStore([ncE(1, "junk")])].every(s => sb.validateData(s) === true));
  } finally { sb.showDataAlert = realAlert; }
  // "No rewrite on reload": loadData persists a noCredit repair ONCE; the
  // repaired store then reloads with no write, banner or warning, and an
  // in-shape store never writes on load.
  const realLS = sb.localStorage, realConsole = sb.console, realAlert2 = sb.showDataAlert;
  try {
    const mem = {}, writes = [], warns = [], banners2 = [];
    sb.localStorage = { getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null), setItem: (k, v) => { writes.push(k); mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
    sb.console = { log: () => {}, warn: m => warns.push(String(m)), error: () => {} };
    sb.showDataAlert = m => banners2.push(m);
    const SKEY = vm.runInContext("SK", sb);
    mem[SKEY] = JSON.stringify(ncStore([ncE(0, "true"), ncE(1, 1), ncE(6, true), ncE(7, false), ncE(8)]));
    sb.loadData();
    const w1 = writes.length, b1 = banners2.length, warn1 = warns.slice(), persisted = mem[SKEY];
    const l2 = sb.loadData();
    const w2 = writes.length - w1, b2 = banners2.length - b1, warn2 = warns.length - warn1.length;
    mem[SKEY] = JSON.stringify(ncStore([ncE(1, true), ncE(2)]));
    const w3start = writes.length, b3start = banners2.length, warn3start = warns.length;
    sb.loadData();
    check("loadData: a repaired noCredit store is written once, then reloads with no write, banner or warning; in-shape store never writes",
      w1 === 1 && b1 === 1 && warn1.length === 1 && warn1[0].indexOf("repaired field(s): entries.noCredit") !== -1 &&
      w2 === 0 && b2 === 0 && warn2 === 0 && JSON.stringify(l2.entries) === JSON.stringify(JSON.parse(persisted).entries) &&
      l2.entries.filter(x => x.noCredit === true).length === 1 &&
      writes.length === w3start && banners2.length === b3start && warns.length === warn3start,
      JSON.stringify({ w1: w1, b1: b1, warn1: warn1, w2: w2, b2: b2, warn2: warn2, w3: writes.length - w3start }));
  } finally { sb.localStorage = realLS; sb.console = realConsole; sb.showDataAlert = realAlert2; }

  // ---- 7b: call cases and wRVU credit (made-up site names; built-in names
  // come from DEFAULT_PAY_SITES at run time) ----
  const N7 = { id: "st-n", name: "North", weekendDays: [0, 6], casesEarnRVU: false, rates: [] };
  const C7 = { id: "st-c", name: "South", weekendDays: [0, 6], casesEarnRVU: true, rates: [] };
  const S7 = [N7, C7];
  const lit7 = d => ({ id: "w-" + d, date: d, cptCode: "47562", description: "x", category: "General", baseRVU: 10.21, modifiers: ["-22"], adjustedRVU: 12.7625, notes: "AB", encounterId: "AB", isCall: true, imported: false });
  const BNC = BI.filter(d => d.casesEarnRVU === false)[0], BCR = BI.filter(d => d.casesEarnRVU !== false)[0];
  const hasK7 = (o, k) => Object.prototype.hasOwnProperty.call(o, k);
  const ascii7 = s => typeof s === "string" && !/[^\x00-\x7f]/.test(s);
  // repairData fixed point for a store, with the loss banner captured.
  const fixedPoint7 = st => {
    const real = sb.showDataAlert, seen = [];
    try { sb.showDataAlert = m => seen.push(m); const j = JSON.stringify(st), fx = sb.repairData(st); return fx.length === 0 && seen.length === 0 && JSON.stringify(st) === j && sb.validateData(st) === true; }
    finally { sb.showDataAlert = real; }
  };
  const entStore7 = ents => seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, entries: ents, paySites: [N7, C7] });

  check("7b constants: CALL_NO_CREDIT_FROM is the no-credit built-in's first rate date; CALL_SITE_OTHER is no built-in id",
    sb.CALL_NO_CREDIT_FROM === "2026-10-01" && sb.isYMD(sb.CALL_NO_CREDIT_FROM) && !!BNC && !!BCR && BNC.rates[0].effective === sb.CALL_NO_CREDIT_FROM &&
    typeof sb.CALL_SITE_OTHER === "string" && sb.CALL_SITE_OTHER.length > 0 && BI.every(d => d.id !== sb.CALL_SITE_OTHER));

  const handNC = sb.payApplyNoCredit([hand("h", BNC.name)], ["h"])[0];
  const PCN = [ // [isCall, site, date, want]
    [true, N7, "2026-10-01", true], [true, N7, "2027-03-01", true],
    [true, N7, "2026-09-30", false], [true, N7, "", false], [true, N7, "2026-10-1", false], [true, N7, "2026-11-31", false], [true, N7, null, false],
    [true, C7, "2026-10-01", false], [true, C7, "2027-03-01", false],
    [false, N7, "2026-10-05", false], ["true", N7, "2026-10-05", false], [1, N7, "2026-10-05", false],
    [true, Object.assign({}, N7, { casesEarnRVU: undefined }), "2026-10-05", false], [true, Object.assign({}, N7, { casesEarnRVU: "false" }), "2026-10-05", false],
    [true, Object.assign({}, N7, { deleted: true }), "2026-10-05", false], [true, null, "2026-10-05", false], [true, "st-n", "2026-10-05", false],
    [true, hand("h", BNC.name), "2026-10-05", false], [true, handNC, "2026-10-05", true],
  ];
  const badPcn = PCN.filter(t => sb.payCaseNoCredit(t[0], t[1], t[2]) !== t[3]);
  check("payCaseNoCredit: only Call + a current no-credit site + a valid date on/after the start (" + PCN.length + " cases; a hand-made built-in name stays credited until applied)",
    badPcn.length === 0 && sb.callNoCreditDate("2026-10-01") === true && sb.callNoCreditDate("2026-09-30") === false && sb.callNoCreditDate(undefined) === false,
    badPcn.map(t => JSON.stringify([t[0], t[1] && t[1].name, t[2]])).join("; "));

  // CONTRACT: the one noCredit writer.
  {
    const base = Object.assign(lit7("2026-10-05"), { siteId: "st-n", siteName: "North" });
    const srcs = [base, Object.assign({}, base, { id: "w2", noCredit: true }), Object.assign({}, base, { id: "w3", noCredit: false }), Object.assign({}, base, { id: "w4", noCredit: "true" })];
    const srcJson = JSON.stringify(srcs), outs = [], bad = [];
    srcs.forEach(s => [true, false, undefined, "true", 1].forEach(on => {
      const o = sb.withNoCredit(s, on), want = on === true;
      outs.push(o);
      if (o === s || (want ? o.noCredit !== true : hasK7(o, "noCredit")) || o.adjustedRVU !== s.adjustedRVU || sb.isNoCredit(o) !== want ||
        Object.keys(s).filter(k => k !== "noCredit").some(k => JSON.stringify(o[k]) !== JSON.stringify(s[k]))) bad.push(s.id + "/" + String(on));
    }));
    check("CONTRACT: withNoCredit writes true or deletes the key (never false), copies, keeps every other field, passes repairData unchanged",
      bad.length === 0 && JSON.stringify(srcs) === srcJson && fixedPoint7(entStore7(JSON.parse(JSON.stringify(outs)))), JSON.stringify(bad));
  }

  // entryWithCall, Log path (src null, rederive true).
  const CALLK = ["isCall", "siteId", "siteName", "noCredit"];
  const otherSame7 = (o, i) => Object.keys(i).concat(Object.keys(o)).every(k => CALLK.indexOf(k) !== -1 || JSON.stringify(o[k]) === JSON.stringify(i[k]));
  const shape7 = o => (!hasK7(o, "siteId") || (typeof o.siteId === "string" && o.siteId !== "")) && (!hasK7(o, "siteName") || (typeof o.siteName === "string" && o.siteName !== "")) &&
    (!hasK7(o, "noCredit") || o.noCredit === true) && typeof o.isCall === "boolean";
  const LOGR = [ // [date, isCall, picker key, sites, extra input fields, want]
    ["2026-10-01", true, "st-n", S7, null, { site: "st-n", name: "North", nc: true }],
    ["2026-09-30", true, "st-n", S7, null, { site: "st-n", name: "North", nc: false }],
    ["2026-10-05", true, "st-c", S7, null, { site: "st-c", name: "South", nc: false }],
    ["2026-10-05", true, sb.CALL_SITE_OTHER, S7, null, { site: "", nc: false }],
    ["2026-10-05", true, "", S7, null, { site: "", nc: false }],
    ["2026-10-05", true, "zz", S7, null, { site: "", nc: false }],
    ["2026-11-31", true, "st-n", S7, null, { site: "st-n", name: "North", nc: false }],
    ["2026-10-05", true, "st-n", [Object.assign({}, N7, { deleted: true })], null, { site: "", nc: false }],
    ["2026-10-05", false, "st-n", S7, { siteId: "st-n", siteName: "North", noCredit: true }, { site: "", nc: false }],
  ];
  const badLog7 = [], logOuts7 = [];
  LOGR.forEach((r, i) => {
    const inp = Object.assign(lit7(r[0]), r[4] || {}), inJ = JSON.stringify(inp);
    const o = sb.entryWithCall(inp, null, r[1], r[2], r[3], true), w = r[5];
    logOuts7.push(o);
    const ok = JSON.stringify(inp) === inJ && o !== inp && o.isCall === r[1] && sb.isNoCredit(o) === w.nc && sb.entrySiteId(o) === w.site &&
      (w.site ? o.siteName === w.name : !hasK7(o, "siteName")) && otherSame7(o, inp) && shape7(o);
    if (!ok) badLog7.push(i + ":" + JSON.stringify(o));
  });
  const reg7 = lit7("2026-10-05");
  check("entryWithCall (Log path): a site only for a CURRENT site, credit by the rule, Private clears site + mark, input untouched; a siteless Call case writes exactly its input",
    badLog7.length === 0 && JSON.stringify(sb.entryWithCall(reg7, null, true, "", [], true)) === JSON.stringify(reg7) &&
    JSON.stringify(sb.entryWithCall(reg7, null, true, sb.CALL_SITE_OTHER, S7, true)) === JSON.stringify(reg7), badLog7.join(" | "));

  // entryWithCall, History path: the snapshot is kept unless the date crosses
  // the start, Call/Private or the site changes, or the rule is re-applied.
  {
    const F = sb.entryWithCall(lit7("2026-10-05"), null, true, "st-n", S7, true);
    const G = sb.entryWithCall(lit7("2026-09-28"), null, true, "st-n", S7, true);
    const Nearn = [sb.paySiteWithCredit(N7, true), C7];
    const Cc = sb.entryWithCall(lit7("2026-10-05"), null, true, "st-n", Nearn, true); // credited: N earned credit when it was written
    const FX = Object.assign({}, F); delete FX.siteName;
    const P = lit7("2026-10-05");
    const ed = (e, o) => Object.assign({}, e, o);
    const ROWS = [ // [label, src, next, isCall, key, sites, rederive, check(out)]
      ["notes edit, same rule: identical but notes", F, ed(F, { notes: "x2" }), true, "st-n", S7, false, o => JSON.stringify(o) === JSON.stringify(ed(F, { notes: "x2" }))],
      ["notes edit after the site switched to credit: mark kept", F, ed(F, { notes: "x2" }), true, "st-n", Nearn, false, o => sb.isNoCredit(o) && o.siteId === "st-n"],
      ["same, re-applied: credited, site kept", F, ed(F, { notes: "x2" }), true, "st-n", Nearn, true, o => !sb.isNoCredit(o) && o.siteName === "North"],
      ["date moved within the window after the switch: mark kept", F, ed(F, { date: "2026-10-07" }), true, "st-n", Nearn, false, o => sb.isNoCredit(o)],
      ["date moved before the start: credited, site kept", F, ed(F, { date: "2026-09-28" }), true, "st-n", S7, false, o => !sb.isNoCredit(o) && o.siteId === "st-n"],
      ["credited 09-28 case moved to 10-02: marked", G, ed(G, { date: "2026-10-02" }), true, "st-n", S7, false, o => sb.isNoCredit(o) && !sb.isNoCredit(G)],
      ["Private: everything cleared", F, ed(F, {}), false, "", S7, false, o => o.isCall === false && !hasK7(o, "siteId") && !hasK7(o, "siteName") && !hasK7(o, "noCredit")],
      ["pick the credited site: credited, its name", F, ed(F, {}), true, "st-c", S7, false, o => !sb.isNoCredit(o) && o.siteId === "st-c" && o.siteName === "South"],
      ["site renamed: mark kept, name refreshed in place", F, ed(F, {}), true, "st-n", [ed(N7, { name: "North 2" }), C7], false, o => sb.isNoCredit(o) && o.siteName === "North 2" && Object.keys(o).join() === Object.keys(F).join()],
      ["deleted site, notes edit: mark + label kept", F, ed(F, { notes: "x3" }), true, "st-n", [], false, o => sb.isNoCredit(o) && o.siteId === "st-n" && o.siteName === "North"],
      ["deleted site, date 10-07: mark kept", F, ed(F, { date: "2026-10-07" }), true, "st-n", [], false, o => sb.isNoCredit(o)],
      ["deleted site, date 09-20: credited, label kept", F, ed(F, { date: "2026-09-20" }), true, "st-n", [], false, o => !sb.isNoCredit(o) && o.siteName === "North"],
      ["deleted site, re-applied on 10-05: mark kept (it can only be lost)", F, ed(F, {}), true, "st-n", [], true, o => sb.isNoCredit(o)],
      ["deleted site, credited case never gains the mark", G, ed(G, { date: "2026-10-03" }), true, "st-n", [], false, o => !sb.isNoCredit(o)],
      ["deleted site, credited in-window case re-applied: stays credited", Cc, ed(Cc, {}), true, "st-n", [], true, o => !sb.isNoCredit(o) && o.siteId === "st-n" && o.siteName === "North"],
      ["Add from a case on its deleted site: label copied from the source", F, ed(lit7("2026-10-05"), { id: "new2" }), true, "st-n", [], false, o => o.siteName === "North" && sb.entrySiteLabel(o, []) === "North (deleted)" && sb.isNoCredit(o) && o.siteId === "st-n"],
      ["credited case, notes edit after the site switched to no credit: stays credited", Cc, ed(Cc, { notes: "m1" }), true, "st-n", S7, false, o => !sb.isNoCredit(o) && o.siteId === "st-n"],
      ["credited case, date 10-07 after the switch: stays credited", Cc, ed(Cc, { date: "2026-10-07" }), true, "st-n", S7, false, o => !sb.isNoCredit(o)],
      ["Add from a credited case after the switch: credited", Cc, ed(lit7("2026-10-05"), { id: "new3", cptCode: "49650" }), true, "st-n", S7, false, o => !sb.isNoCredit(o) && o.siteId === "st-n"],
      ["credited case, re-applied after the switch: marked", Cc, ed(Cc, { notes: "m1" }), true, "st-n", S7, true, o => sb.isNoCredit(o)],
      ["deleted site, Private: cleared", F, ed(F, {}), false, "", [], false, o => o.isCall === false && !hasK7(o, "siteId") && !hasK7(o, "noCredit")],
      ["deleted site with no stored name: no siteName key", FX, ed(FX, { notes: "x4" }), true, "st-n", [], false, o => o.siteId === "st-n" && !hasK7(o, "siteName") && sb.isNoCredit(o)],
      ["Add from the case, same date + picks: copies site + mark", F, ed(lit7("2026-10-05"), { id: "new1", cptCode: "49650" }), true, "st-n", Nearn, false, o => sb.isNoCredit(o) && o.siteId === "st-n" && o.cptCode === "49650"],
      ["pre-7b Call case, Other site, notes edit: exactly today's spread", P, ed(P, { notes: "y" }), true, sb.CALL_SITE_OTHER, S7, false, o => JSON.stringify(o) === JSON.stringify(ed(P, { notes: "y" }))],
      ["pre-7b Call case gets the no-credit site: marked", P, ed(P, {}), true, "st-n", S7, false, o => sb.isNoCredit(o) && o.siteName === "North"],
      ["no src: derived", null, ed(P, {}), true, "st-n", S7, false, o => sb.isNoCredit(o)],
    ];
    const bad = [], outs = [];
    ROWS.forEach(r => {
      const srcJ = JSON.stringify(r[1]), nextJ = JSON.stringify(r[2]);
      const o = sb.entryWithCall(r[2], r[1], r[3], r[4], r[5], r[6]);
      outs.push(o);
      if (!r[7](o) || !shape7(o) || !otherSame7(o, r[2]) || JSON.stringify(r[1]) !== srcJ || JSON.stringify(r[2]) !== nextJ) bad.push(r[0] + " -> " + JSON.stringify(o));
    });
    check("entryWithCall (History path): snapshot kept within the window, re-derived on a crossing/pick change/re-apply, deleted site can only lose the mark, inputs untouched (" + ROWS.length + " rows)",
      bad.length === 0, bad.join(" | "));
    check("entryWithCall outputs (Log + History) pass repairData unchanged (no rewrite on load)",
      fixedPoint7(entStore7(JSON.parse(JSON.stringify(logOuts7.concat(outs))))));

    // "No rewrite on reload" for a 7b store: written entries + a site
    // switched to no credit load with no write, banner or warning.
    const realLS7 = sb.localStorage, realConsole7 = sb.console, realAlert7 = sb.showDataAlert;
    try {
      const mem = {}, writes = [], warns = [], seen = [];
      sb.localStorage = { getItem: k => (hasK7(mem, k) ? mem[k] : null), setItem: (k, v) => { writes.push(k); mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
      sb.console = { log: () => {}, warn: m => warns.push(String(m)), error: () => {} };
      sb.showDataAlert = m => seen.push(m);
      mem[vm.runInContext("SK", sb)] = JSON.stringify(seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, entries: logOuts7.concat(outs), paySites: [N7, C7, handNC] }));
      sb.loadData();
      check("loadData: a store with 7b call cases and a switched site loads with no write, banner or warning", writes.length === 0 && seen.length === 0 && warns.length === 0,
        JSON.stringify({ writes: writes, seen: seen, warns: warns }));
    } finally { sb.localStorage = realLS7; sb.console = realConsole7; sb.showDataAlert = realAlert7; }
  }

  {
    const m0 = { id: "m0", date: "2026-10-05", encounterId: "AB" }, m1 = { id: "m1", date: "2026-10-05", encounterId: "AB" };
    const m2 = { id: "m2", date: "2026-10-06", encounterId: "AB" }, m3 = { id: "m3", date: "2026-10-05", encounterId: "ab" };
    const m4 = { id: "m4", date: "2026-10-05", encounterId: "" }, m5 = { id: "m5", date: "2026-10-05" }, m6 = { id: "m6", date: "2026-10-05", encounterId: "AB" };
    const got = sb.entryEncounterMates([m0, m1, m2, m3, m4, m5, null, 42, m6], m0).map(x => x.id).join(",");
    check("entryEncounterMates: same date + exact non-empty encounterId, self excluded", got === "m1,m6" &&
      sb.entryEncounterMates([m0, m4], m4).length === 0 && sb.entryEncounterMates([m0, m5], m5).length === 0 &&
      sb.entryEncounterMates(null, m0).length === 0 && sb.entryEncounterMates([m0], null).length === 0, got);
  }

  {
    const F = sb.entryWithCall(lit7("2026-10-05"), null, true, "st-n", S7, true);
    const LAB = [
      [Object.assign(lit7("2026-10-05"), { siteId: "st-n", siteName: "Old" }), [Object.assign({}, N7, { name: "North 2" })], "North 2"],
      [F, [], "North (deleted)"], [Object.assign(lit7("2026-10-05"), { siteId: "st-n" }), [], "Deleted site"],
      [lit7("2026-10-05"), S7, ""], [Object.assign(lit7("2026-10-05"), { siteId: 5, siteName: {} }), S7, ""],
    ];
    const badLab = LAB.filter(t => sb.entrySiteLabel(t[0], t[1]) !== t[2]);
    const JUNK = [Object.assign(lit7("2026-10-05"), { siteId: 5, siteName: {} }), null, {}, undefined, 42, "x"];
    const strs = JUNK.every(j => typeof sb.entrySiteId(j) === "string" && typeof sb.entrySiteKey(j) === "string" && typeof sb.entryCallKey(j) === "string" && typeof sb.entrySiteLabel(j, S7) === "string");
    check("call-site readers: current name after a rename, stored name + (deleted), junk-safe strings; picker keys",
      badLab.length === 0 && strs && sb.entrySiteKey(lit7("2026-10-05")) === sb.CALL_SITE_OTHER && sb.entrySiteKey(Object.assign(lit7("2026-10-05"), { isCall: false })) === "" &&
      sb.entrySiteKey(F) === "st-n" && sb.entryCallKey(F) === "call|st-n|nc" && sb.entryCallKey(Object.assign(lit7("2026-10-05"), { isCall: false })) === "private||",
      badLab.map(t => sb.entrySiteLabel(t[0], t[1])).join(", "));
    check("a garbled siteId/siteName passes repairData unchanged (no repair rule; readers ignore it)",
      fixedPoint7(entStore7([Object.assign(lit7("2026-10-05"), { siteId: 5, siteName: {} }), Object.assign(lit7("2026-10-06"), { siteId: "", siteName: null })])));
  }

  {
    const off = s => sb.payCreditOffers(s).map(o => o.site.id + ":" + o.by).join(",");
    const seeded = sb.defaultPaySites();
    const flippedSeed = seeded.map(s => s.id === BNC.id ? sb.paySiteWithCredit(s, true) : s);
    const offersOK = off([hand("h2", BNC.name)]) === "h2:name" && off([hand("h3", BNC.name + " East")]) === "h3:alias" &&
      off([hand("h4", BNC.name + " East"), hand("h5", BNC.name + " West")]) === "" && off(seeded) === "" && off(flippedSeed) === "" &&
      off([Object.assign(hand("h6", BNC.name), { casesEarnRVU: false })]) === "" && off([hand("h7", BCR.name)]) === "" &&
      off([hand("h8", "  " + BNC.name.toLowerCase() + "  ")]) === "h8:name" && off([]) === "" && off(null) === "";
    const L = [hand("h2", BNC.name), hand("h9", "Other")], Lj = JSON.stringify(L);
    const A1 = sb.payApplyNoCredit(L, ["h2", "h9"]);
    const A2 = sb.payApplyNoCredit(A1, ["h2"]);
    const applyOK = A1[0].casesEarnRVU === false && A1[0] !== L[0] && A1[1] === L[1] && JSON.stringify(L) === Lj && Object.keys(A1[0]).join() === Object.keys(L[0]).join() &&
      JSON.stringify(A2) === JSON.stringify(A1) && JSON.stringify(sb.payApplyNoCredit(L, [])) === Lj && sb.payApplyNoCredit("junk", ["h2"]) === "junk" && sb.payApplyNoCredit(null, ["h2"]) === null &&
      fixedPoint7(seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: JSON.parse(JSON.stringify(A1)) }));
    const ct = sb.payCreditConfirm(sb.payCreditOffers([hand("h3", BNC.name + " East")]));
    check("payCreditOffers / payApplyNoCredit: one name or alias match still crediting (never by built-in id, ambiguous or already set); confirmed apply flips only offered ids, re-planned, a fixed point",
      offersOK && applyOK && ascii7(ct) && ct.indexOf("Oct 1, 2026") !== -1 && ct.indexOf("(built-in " + BNC.name + ")") !== -1,
      JSON.stringify({ offersOK: offersOK, applyOK: applyOK, ct: ct }));
  }

  {
    const PS = [sb.defaultPaySites()[0], sb.defaultPaySites()[1], hand("hx", "X")];
    const ok = PS.every(s => { const j = JSON.stringify(s); return [true, false].every(e => { const o = sb.paySiteWithCredit(s, e); return o !== s && o.casesEarnRVU === e && Object.keys(o).join() === Object.keys(s).join() && JSON.stringify(s) === j; }); });
    check("paySiteWithCredit: new object, strict boolean, key order kept, a repairData fixed point",
      ok && sb.paySiteWithCredit(hand("hx", "X"), "yes").casesEarnRVU === false &&
      fixedPoint7(seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: JSON.parse(JSON.stringify(PS.map(s => sb.paySiteWithCredit(s, false)))) })) &&
      fixedPoint7(seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: JSON.parse(JSON.stringify(PS.map(s => sb.paySiteWithCredit(s, true)))) })));
    const notes = [sb.paySiteCreditNote(C7, "2026-10-05"), sb.paySiteCreditNote(N7, "2026-10-01"), sb.paySiteCreditNote(N7, "2026-09-30"), sb.paySiteCreditNote(N7, ""), sb.paySiteCreditNote(null, "2026-10-05")];
    check("paySiteCreditNote: \"\" for a crediting site; no credit / credited before / from the start; ASCII",
      notes[0] === "" && notes[1] === "no wRVU credit" && notes[2].indexOf("credited before ") === 0 && notes[3].indexOf("no wRVU credit from ") === 0 && notes[4] === "" && notes.every(ascii7),
      JSON.stringify(notes));
  }

  {
    // The rest of an encounter (History's checkbox).
    const cur = Object.assign(lit7("2026-10-05"), { id: "c0" });                     // siteless Call
    const m1 = Object.assign(lit7("2026-10-05"), { id: "c1", cptCode: "49650" });    // siteless Call
    const m2 = Object.assign(lit7("2026-10-05"), { id: "c2", isCall: false });       // Private
    const m3 = Object.assign(lit7("2026-10-06"), { id: "c3" });                     // another date
    const m4 = Object.assign(lit7("2026-10-05"), { id: "c4", encounterId: "ab" });  // other initials
    const m5 = sb.entryWithCall(Object.assign(lit7("2026-10-05"), { id: "c5" }), null, true, "st-n", S7, true); // Call at N, marked
    const m6 = sb.entryWithCall(Object.assign(lit7("2026-10-05"), { id: "c6" }), null, true, "st-n", [sb.paySiteWithCredit(N7, true)], true); // Call at N, credited when N still earned
    const ents = [cur, m1, m2, m3, m4, m5, m6], entsJ = JSON.stringify(ents);
    const keysOf = p => Object.keys(p).sort().join(",");
    const pN = sb.entryEncounterCallPlan(ents, cur, true, "st-n", S7, false);
    const pSame = sb.entryEncounterCallPlan(ents, cur, true, sb.CALL_SITE_OTHER, S7, false);
    const pRe = sb.entryEncounterCallPlan(ents, m5, true, "st-n", S7, true);
    const pPriv = sb.entryEncounterCallPlan(ents, m5, false, "", S7, false);
    const o0 = Object.assign(lit7("2026-09-28"), { id: "o0" }), o1 = Object.assign(lit7("2026-09-28"), { id: "o1" });
    const pOld = sb.entryEncounterCallPlan([o0, o1], o0, true, "st-n", S7, false);
    // A siteless Call pick may be "" (no sites to force a pick) or OTHER: same.
    const pBlank = sb.entryEncounterCallPlan(ents, cur, true, "", [], false);
    const q0 = Object.assign(lit7("2026-10-05"), { id: "q0", isCall: false, encounterId: "QQ" }), q1 = Object.assign(lit7("2026-10-05"), { id: "q1", isCall: false, encounterId: "QQ" });
    const pToCall = sb.entryEncounterCallPlan([q0, q1], q0, true, "", [], false);
    check("entryEncounterCallPlan: only same-date exact-initials mates whose call fields change, credit by each mate's own date; nothing when the picks are unchanged; inputs untouched",
      keysOf(pN) === "c1,c2,c6" && sb.isNoCredit(pN.c1) && pN.c1.siteId === "st-n" && pN.c2.isCall === true && sb.isNoCredit(pN.c2) && sb.isNoCredit(pN.c6) &&
      keysOf(pSame) === "" && keysOf(pPriv) === "c0,c1,c6" && pPriv.c0.isCall === false && !hasK7(pPriv.c0, "siteId") && !hasK7(pPriv.c1, "noCredit") &&
      keysOf(pRe) === "c0,c1,c2,c6" && [pRe.c0, pRe.c1, pRe.c2, pRe.c6].every(x => sb.isNoCredit(x) && x.siteName === "North") &&
      keysOf(pOld) === "o1" && !sb.isNoCredit(pOld.o1) && pOld.o1.siteId === "st-n" &&
      keysOf(pBlank) === "" && keysOf(pToCall) === "q1" && pToCall.q1.isCall === true && !hasK7(pToCall.q1, "siteId") && !hasK7(pToCall.q1, "noCredit") &&
      keysOf(sb.entryEncounterCallPlan(ents, null, true, "st-n", S7, true)) === "" && keysOf(sb.entryEncounterCallPlan(null, cur, true, "st-n", S7, true)) === "" &&
      JSON.stringify(ents) === entsJ &&
      fixedPoint7(entStore7(JSON.parse(JSON.stringify([pN.c1, pN.c2, pRe.c0, pPriv.c0, pOld.o1])))),
      JSON.stringify({ pN: keysOf(pN), pSame: keysOf(pSame), pRe: keysOf(pRe), pPriv: keysOf(pPriv), pOld: keysOf(pOld), pBlank: keysOf(pBlank), pToCall: keysOf(pToCall) }));
  }
}

console.log("");
if (failures.length) {
  console.log("CHECK FAILED (" + failures.length + "): " + failures.join(" | "));
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
