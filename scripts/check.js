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
check("found 14 js files", jsFiles.length === 14, "got " + jsFiles.length + ": " + jsFiles.join(", "));

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
    // 3b. UTC date-key tripwire: new Date("YYYY-MM-DD") (or Date.parse) is UTC
    // midnight - the evening before in US time zones; it ran Home's pace day
    // count a day high every evening. A SYNTACTIC check of the shapes this
    // repo has shipped: a string literal, template or "+" chain whose string
    // pieces hold no "T" time (a bare key, x + "-01"), or end in "Z" or an
    // offset (UTC again), and a member named like a date key (x.date,
    // x.month, x.yearStart, x.effective, also as x["..."]). A key + a local
    // "T" time ("T12:00:00", ymd + "T" + hm) and plain number math pass. It
    // cannot see a key held in a plain variable (new Date(ymd)) - the
    // CLAUDE.md date rule still applies.
    const KEY_PROPS = ["date", "month", "yearStart", "effective"];
    const propName = m => m.computed ? (m.property.type === "StringLiteral" ? m.property.value : "") : (m.property && m.property.name) || "";
    // String pieces of a literal, a template or a "+" chain, in order; null
    // when the argument holds none (a Date, a number, ts + 86400000).
    const strPieces = e => {
      if (e.type === "StringLiteral") return [e.value];
      if (e.type === "TemplateLiteral") return e.quasis.map(q => q.value.cooked);
      if (e.type === "BinaryExpression" && e.operator === "+") { const l = strPieces(e.left), r = strPieces(e.right); return l || r ? (l || []).concat(r || []) : null; }
      return null;
    };
    const keyArg = a => {
      if (a.type === "MemberExpression") return KEY_PROPS.indexOf(propName(a)) !== -1;
      const p = strPieces(a);
      if (!p) return false;
      const txt = p.join("");
      return txt.indexOf("T") === -1 || /(Z|[+-]\d{2}:?\d{2})\s*$/.test(txt);
    };
    let utcParse = [];
    if (f !== "cpt-data.js") walk(ast.program, n => {
      const isNewDate = n.type === "NewExpression" && n.callee && n.callee.name === "Date" && n.arguments.length === 1;
      const isParse = n.type === "CallExpression" && n.callee && n.callee.type === "MemberExpression" && n.callee.object.name === "Date" && propName(n.callee) === "parse" && n.arguments.length === 1;
      if ((isNewDate || isParse) && keyArg(n.arguments[0])) utcParse.push(n.loc.start.line);
    });
    check("no UTC date-key parse (new Date(\"YYYY-MM-DD\")) in " + f, utcParse.length === 0, "line(s) " + utcParse.join(", ") + " - a date key becomes a Date through localDateYMD");
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

// 4c. Startup robustness (CLAUDE.md "Startup"). Each unpkg tag is DIRECTLY
// followed by a jsdelivr fallback with the SAME hash, path and crossorigin,
// guarded by its own global. Every attribute-less inline script parses (a
// syntax error there is a white screen the watchdog can't report). The
// watchdog sits after #app-loader and before the first CDN tag. React's
// first render into #root removing #app-loader is the started signal, so no
// js file may mention app-loader. index.html never writes or clears storage.
const bootCdn = [...html.matchAll(/<script crossorigin="anonymous" integrity="(sha384-[A-Za-z0-9+\/=]+)" src="https:\/\/unpkg\.com\/([^"]+)"><\/script>/g)];
check("index.html loads React, ReactDOM, Babel from unpkg with SRI", bootCdn.length === 3, "got " + bootCdn.length);
const bootGlobalOf = p => /^react@/.test(p) ? "React" : /^react-dom@/.test(p) ? "ReactDOM" : /^@babel\/standalone@/.test(p) ? "Babel" : "";
const bootNoFallback = bootCdn.filter(m => {
  const want = "<script>window." + bootGlobalOf(m[2]) + " || document.write('<script crossorigin=\"anonymous\" integrity=\"" + m[1] + "\" src=\"https://cdn.jsdelivr.net/npm/" + m[2] + "\"><\\/script>');</script>";
  const after = m.index + m[0].length, at = html.indexOf(want, after);
  return !bootGlobalOf(m[2]) || at === -1 || !/^\s*$/.test(html.slice(after, at));
}).map(m => m[2]);
check("each unpkg script is directly followed by its same-SRI, same-path jsdelivr fallback guarded by its own global", bootNoFallback.length === 0, "missing/misplaced: " + bootNoFallback.join(", "));
const bootInline = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
const bootInlineBad = [];
bootInline.forEach((s, i) => {
  try {
    let opt = 0;
    walk(parser.parse(s, { sourceType: "script" }).program, n => { if (n.type === "OptionalMemberExpression" || n.type === "OptionalCallExpression") opt++; });
    if (opt) bootInlineBad.push("inline #" + i + ": optional chaining");
  } catch (e) { bootInlineBad.push("inline #" + i + ": " + e.message); }
});
check("index.html inline scripts parse, no ?.", bootInline.length >= 7 && bootInlineBad.length === 0, bootInline.length + " found; " + bootInlineBad.join("; "));
const bootLoader = html.indexOf('id="app-loader"'), bootWatch = html.indexOf("// RVU startup watchdog"), bootFirstCdn = html.indexOf('src="https://unpkg.com/');
check("startup watchdog sits after #app-loader, before the CDN scripts", bootLoader !== -1 && bootWatch > bootLoader && bootFirstCdn > bootWatch);
const bootAppSrc = fs.readFileSync(path.join(JS_DIR, "app.js"), "utf8");
const bootMentions = jsFiles.filter(f => fs.readFileSync(path.join(JS_DIR, f), "utf8").indexOf("app-loader") !== -1);
check("app.js mounts into #root; no js file touches #app-loader", bootAppSrc.indexOf('ReactDOM.createRoot(document.getElementById("root"))') !== -1 && bootMentions.length === 0, bootMentions.join(", "));
check("index.html never writes or clears storage", !/\.(setItem|removeItem|clear)\s*\(/.test(html));
const bootNa = html.search(/[^\x00-\x7f]/);
check("index.html is ASCII-only", bootNa === -1, "non-ASCII at index " + bootNa);

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
// wRVU editor: the row input (the one whose value reads rvuDraft) writes the
// store only through commitOverride in its onBlur; no other handler on it
// calls commitOverride or upd, and commitOverride has no other caller (a
// keystroke or effect commit would bring back the 1021-for-10.21 bug).
const edCalls = (n, names) => { let c = 0; walk(n, x => { if (x.type === "CallExpression" && x.callee && x.callee.type === "Identifier" && names.indexOf(x.callee.name) !== -1) c++; }); return c; };
const edUses = (n, name) => { let hit = false; walk(n, x => { if (x.type === "Identifier" && x.name === name) hit = true; }); return hit; };
const edAttr = (n, name) => n.attributes.find(a => a.type === "JSXAttribute" && a.name && a.name.name === name);
const edInputs = [];
if (settingsAst) walk(settingsAst.program, n => {
  if (n.type !== "JSXOpeningElement" || !n.name || n.name.name !== "input") return;
  const v = edAttr(n, "value");
  if (v && edUses(v, "rvuDraft")) edInputs.push(n);
});
const edBlur = edInputs.length === 1 ? edAttr(edInputs[0], "onBlur") : null;
const edBad = edInputs.length === 1 ? edInputs[0].attributes.filter(a => a.type === "JSXAttribute" && a.name && /^on/.test(a.name.name) && a.name.name !== "onBlur" && edCalls(a, ["commitOverride", "upd"]) > 0).map(a => a.name.name) : [];
const edCommitAll = settingsAst ? edCalls(settingsAst.program, ["commitOverride"]) : -1;
check("wRVU editor: no override write on a keystroke (the row input commits only via commitOverride in its onBlur; no other handler calls commitOverride or upd)",
  settingsSrc.indexOf("setOverride(") === -1 && edInputs.length === 1 && !!edBlur && edCalls(edBlur, ["commitOverride"]) === 1 && edCommitAll === 1 && edBad.length === 0,
  JSON.stringify({ inputs: edInputs.length, blurCommits: edBlur ? edCalls(edBlur, ["commitOverride"]) : 0, commitAll: edCommitAll, bad: edBad }));

// Backup stamp ("Last backup" + Home nudge): ONE per-device key, outside the
// data store, touched only by the utils.js helpers, never a name utils.js
// deletes on load (rvu-backup / rvu-backup-time) or any other key's name.
const bkKey = (utils.match(/var BACKUP_STAMP_KEY = "([^"]+)"/) || [])[1];
const BK_RESERVED = ["rvu-backup", "rvu-backup-time", "rvu-tracker-last-good", "rvu-tracker-last-good-time", "rvu-tracker-data-corrupt", "rvu-theme", "rvu-theme-css",
  "rvu-pin-hint", "rvu-pin-hash", "rvu-pin-salt", "rvu-pin-session", "rvu-callfix-kept", "rvu-bio-pin", "rvu-bio-pass", "rvu-bio-enabled", "rvu-bio-cred", "rvu-dir-reminder"].concat(skMatch ? [skMatch[1]] : []);
check("backup stamp key defined and distinct from every other storage key", !!bkKey && BK_RESERVED.indexOf(bkKey) === -1, String(bkKey));
const bkLeak = jsFiles.filter(f => f !== "utils.js" && /BACKUP_STAMP_KEY|rvu-last-backup/.test(fs.readFileSync(path.join(JS_DIR, f), "utf8")));
check("only utils.js touches the backup stamp key", !!bkKey && bkLeak.length === 0 && utils.split('"' + bkKey + '"').length === 2, bkLeak.join(", "));
check("data store has no backup field", !!defObj && objKeys(defObj).every(k => !/backup/i.test(k)));
check("one backup-code builder in settings.js (copy and file share it)", (settingsSrc.match(/encrypted: true, v: 1/g) || []).length === 1 &&
  (settingsSrc.match(/buildBackupCode\(pin\)/g) || []).length === 2);
// iOS opens the share sheet only inside a user gesture: navigator.share for
// the backup file runs from its own tap, never inside the encrypt chain.
// Exactly two navigator.share calls (Share App + the file, no wrapper
// helper); the file one sits in shareBackupFile's own body; the encrypt
// chain (saveBackupFile) calls nothing share-like.
const bkSaveFn = (/var saveBackupFile = function\(\) \{[\s\S]*?\r?\n  \};/.exec(settingsSrc) || [""])[0];
const bkShareFn = (/var shareBackupFile = function\(\) \{\r?\n    var bf = backupFile;[\s\S]*?\r?\n  \};/.exec(settingsSrc) || [""])[0];
check("backup file share runs from its own tap (not after the async encrypt)",
  (settingsSrc.match(/navigator\.share\(/g) || []).length === 2 &&
  bkShareFn.indexOf("navigator.share({ files: [bf.file] })") !== -1 &&
  bkSaveFn.indexOf("buildBackupCode(pin)") !== -1 &&
  !/navigator|share\w*\s*\(/i.test(bkSaveFn.replace(/shareFailed/g, "")),
  String(bkSaveFn.length) + "/" + String(bkShareFn.length));
// ONE restore path: paste (doRestore) and file (restoreFromFile) both go
// through restoreFromText, which holds every finishRestore call; an
// undecodable payload ("Invalid encrypted data") is handled before the one
// other-PIN prompt in settings.js.
const bkRestoreFn = (/var restoreFromText = function\(raw, src, label\) \{[\s\S]*?\r?\n  \};/.exec(settingsSrc) || [""])[0];
const bkDoRestore = (/var doRestore = function\(\) \{[^\n]*/.exec(settingsSrc) || [""])[0];
const bkFromFile = (/var restoreFromFile = function\(f\) \{[\s\S]*?\r?\n  \};/.exec(settingsSrc) || [""])[0];
const bkFinishCalls = (settingsSrc.match(/finishRestore\(/g) || []).length;   // calls only ("var finishRestore = function(" never matches)
check("one restore path: paste and file -> restoreFromText -> finishRestore; undecodable payload never prompts; one other-PIN prompt",
  bkRestoreFn.length > 0 && bkDoRestore.indexOf("restoreFromText(") !== -1 && bkFromFile.indexOf("restoreFromText(") !== -1 &&
  bkFinishCalls > 0 && (bkRestoreFn.match(/finishRestore\(/g) || []).length === bkFinishCalls &&
  bkRestoreFn.indexOf('"Invalid encrypted data"') !== -1 && bkRestoreFn.indexOf('"Invalid encrypted data"') < bkRestoreFn.indexOf("prompt(") &&
  (settingsSrc.match(/\bprompt\(/g) || []).length === 1,
  JSON.stringify({ body: bkRestoreFn.length, finishCalls: bkFinishCalls, prompts: (settingsSrc.match(/\bprompt\(/g) || []).length }));

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
// Log has ONE Save control: the sticky save bar (app.js lifts the undo toast
// above it while pinned). A second onClick={save} would sit outside that care.
{
  let saveClicks = 0;
  try {
    walk(parser.parse(fs.readFileSync(path.join(JS_DIR, "log.js"), "utf8"), AST_OPTS).program, n => {
      if (n.type === "JSXAttribute" && n.name && n.name.name === "onClick" && n.value && n.value.type === "JSXExpressionContainer" && n.value.expression.type === "Identifier" && n.value.expression.name === "save") saveClicks++;
    });
  } catch (e) { saveClicks = -1; }
  check("log.js has exactly one Save control (onClick={save}, the sticky save bar)", saveClicks === 1, saveClicks + " found");
}
// History's call-site fix-up card: a case's credit is set when it is
// written, so the built-in credit offer renders BEFORE the site chips, the
// offered chip says "still credits", and its confirm says to take the offer
// first.
{
  const hs = fs.readFileSync(path.join(JS_DIR, "history.js"), "utf8");
  const offerAt = hs.indexOf("{fixOffers.map(function(o)"), chipsAt = hs.indexOf("{fixSites.map(function(s)");
  const orderOk = offerAt !== -1 && chipsAt !== -1 && offerAt < chipsAt;
  const markAt = hs.indexOf("var offered = fixOffers.some(function(o) { return o.site.id === s.id; });");
  const markOk = markAt > chipsAt && markAt - chipsAt < 80 && hs.indexOf("var note = offered ? \"still credits\" : paySiteCreditNote(s, CALL_NO_CREDIT_FROM);") !== -1;
  const lookupOk = hs.indexOf("var offer = fixOffers.filter(function(o) { return o.site.id === s.id; })[0];") !== -1;
  const hintOk = hs.indexOf("(offer ? \" \" + s.name + \" still credits call cases. For the built-in \" + offer.def.name") !== -1 &&
    hs.indexOf("tap Cancel, then \\\"No credit for \" + s.name + \"\\\" first.\" : \"\")") !== -1;
  check("History fix-up card: credit offer above the site chips; offered chip marked; its confirm says take the offer first",
    orderOk && markOk && lookupOk && hintOk,
    JSON.stringify({ offerAt: offerAt, chipsAt: chipsAt, orderOk: orderOk, markOk: markOk, lookupOk: lookupOk, hintOk: hintOk }));
}
// 5f. Show/hide $: every fmtDollar call passes App's showComp; every view
// that masks $ (calls fmtDollar, or Call Pay) renders the ONE CompEye
// (app.js, hook-free) so $ can be revealed where it is hidden; App passes
// showComp + toggleComp to those views. A missing or duplicate CompEye
// would crash every $ view into its ErrorBoundary.
{
  const PLAIN_FILES = ["crypto.js", "cpt-data.js", "utils.js", "styles.js"];
  const eyeAsts = {};
  jsFiles.filter(f => PLAIN_FILES.indexOf(f) === -1).forEach(f => {
    try { eyeAsts[f] = parser.parse(fs.readFileSync(path.join(JS_DIR, f), "utf8"), AST_OPTS); } catch (e) { eyeAsts[f] = null; }
  });
  const badFmt = [], fmtFiles = [], eyeMissing = [], eyeCount = {};
  Object.keys(eyeAsts).forEach(f => {
    const a = eyeAsts[f]; if (!a) { badFmt.push(f + ": parse"); return; }
    let calls = 0, eyes = 0;
    walk(a.program, n => {
      if (n.type === "CallExpression" && n.callee && n.callee.type === "Identifier" && (n.callee.name === "fmtDollar" || n.callee.name === "dirMoneyShown")) {
        calls++;
        if (n.arguments.length !== 2 || n.arguments[1].type !== "Identifier" || n.arguments[1].name !== "showComp") badFmt.push(f + ":" + n.loc.start.line);
      }
      if (n.type === "JSXOpeningElement" && n.name && n.name.name === "CompEye") {
        eyes++;
        // CompEye renders null without toggleComp: every use passes both
        // props straight from the view's own showComp / toggleComp.
        ["showComp", "toggleComp"].forEach(p => {
          const a = n.attributes.filter(x => x.type === "JSXAttribute" && x.name && x.name.name === p)[0];
          if (!a || !a.value || a.value.type !== "JSXExpressionContainer" || a.value.expression.type !== "Identifier" || a.value.expression.name !== p) eyeMissing.push(f + ":" + n.loc.start.line + " " + p);
        });
      }
    });
    eyeCount[f] = eyes;
    if (calls > 0) fmtFiles.push(f);
    if ((calls > 0 || f === "callpay.js" || f === "directorships.js") && eyes === 0) eyeMissing.push(f);
  });
  check("5f: every fmtDollar call passes showComp; every view that masks $ (and Call Pay) renders CompEye with both props",
    badFmt.length === 0 && eyeMissing.length === 0 && fmtFiles.length >= 4, JSON.stringify({ badFmt: badFmt, eyeMissing: eyeMissing, fmtFiles: fmtFiles }));
  // One eye per place $ is masked: Trends header + month detail + Monthly
  // Report; Compare card; More's Summary Stats; Home; Call Pay's shared
  // eyeBtn; Directorships' shared eyeBtn (its Review reuses it). Removing any one of them (or adding a stray one) fails here.
  const EYES = { "analytics.js": 3, "compare.js": 1, "settings.js": 1, "dashboard.js": 1, "callpay.js": 1, "directorships.js": 1 };
  const eyeOff = Object.keys(eyeAsts).filter(f => (eyeCount[f] || 0) !== (EYES[f] || 0)).map(f => f + "=" + (eyeCount[f] || 0));
  check("5f: CompEye count per file matches each masked place (" + JSON.stringify(EYES).replace(/"/g, "") + ")", eyeOff.length === 0, eyeOff.join(", "));
  const appAst = eyeAsts["app.js"];
  const topEye = appAst ? appAst.program.body.filter(n => n.type === "FunctionDeclaration" && n.id && n.id.name === "CompEye").length : 0;
  const otherDecl = jsFiles.filter(f => f !== "app.js" && /(function|var|let|const|class)\s+CompEye\b/.test(fs.readFileSync(path.join(JS_DIR, f), "utf8")));
  const plainMention = PLAIN_FILES.filter(f => jsFiles.indexOf(f) !== -1 && fs.readFileSync(path.join(JS_DIR, f), "utf8").indexOf("CompEye") !== -1);
  check("5f: app.js declares CompEye exactly once at top level; no other file declares it; plain scripts never mention it",
    topEye === 1 && otherDecl.length === 0 && plainMention.length === 0, JSON.stringify({ topEye: topEye, otherDecl: otherDecl, plainMention: plainMention }));
  const needProps = ["Dashboard", "Analytics", "Compare", "Settings", "CallPay", "Directorships"], propBad = [];
  if (appAst) walk(appAst.program, n => {
    if (n.type !== "JSXOpeningElement" || !n.name || needProps.indexOf(n.name.name) === -1) return;
    const names = n.attributes.filter(x => x.type === "JSXAttribute" && x.name).map(x => x.name.name);
    if (names.indexOf("showComp") === -1 || names.indexOf("toggleComp") === -1) propBad.push(n.name.name);
  });
  check("5f: App passes showComp + toggleComp to every view that masks $", !!appAst && propBad.length === 0, propBad.join(", "));
}

// 5f-2. Home's Compensation card (CLAUDE.md "Home's goal tracks"): utils.js
// compProjection is the ONE rule. dashboard.js calls it exactly once with the
// twin-card totals and the three settings (any key order), the twin paces
// come straight from it, and no projection math or goal of its own is left
// (AST checks, so comments and spacing neither satisfy nor dodge them).
// Comp YTD is exactly {fmtDollar(proj.ytdComp, showComp)}, unconditional (the
// old any-year `hasInst ? instTotal : trackedRVU` switch showed $0 for a year
// with no Compare months); no fmtDollar argument mentions the rate (a rate $
// on Home comes from a compProjection field or a DERIVED variable); Avg/Enc is
// the only `/ credEnc`: trackedRVU / credEnc; the current window's startYM is
// built from the isYMD-guarded Year Start.
// Plus a $ tripwire on all of dashboard.js. A money node - a proj.comp /
// goalComp / diff / ytdComp read; a settings.ratePerRVU read other than a
// `> 0` test, the compProjection argument or a factor of the prevYearComp
// product (whose READS are money instead); a toLocaleString with options
// that are not an inline literal or that mention "currency"; any Intl; "/wRVU"
// in a string, template or JSX text - must sit under fmtDollar(<it>, showComp),
// in a `showComp ? <it> : ...` consequent or in `showComp && <it>`. proj may be
// read only as proj.<COMP_PROJ_FIELDS> (no alias, destructuring or brackets),
// and the money-node count is pinned. Syntactic, like 3b: a $ figure built
// some other way is not seen - route new $ through fmtDollar.
const COMP_PROJ_FIELDS = ["comp", "comparePace", "diff", "goalComp", "goalName", "goalTile", "goalWRVU", "months", "onPace", "show", "source", "sourceLabel", "trackedPace", "wrvu", "ytdComp", "ytdWRVU"];
// proj.ytdComp (Comp YTD), prevYearComp read, proj.goalComp, proj.comp,
// proj.diff, the currency call, the rate and "/wRVU" in the pill. Bump only
// for a new masked $.
const COMP_MONEY_PIN = 8;
{
  const DERIVED = ["prevYearComp"];
  const isId = (n, name) => !!n && n.type === "Identifier" && n.name === name;
  const isMember = (n, obj, prop) => !!n && n.type === "MemberExpression" && !n.computed && isId(n.object, obj) && !!n.property && n.property.name === prop;
  const keyOf = (n, parent) => !!parent && ((parent.type === "MemberExpression" && parent.property === n && !parent.computed) ||
    (parent.type === "ObjectProperty" && parent.key === n && parent.value !== n && !parent.computed));
  const cardMoneyGate = src => {
    const leaks = [];
    let money = 0;
    walkStack(src, (n, stack) => {
      const parent = stack[stack.length - 1], gp = stack[stack.length - 2], ggp = stack[stack.length - 3];
      if (isId(n, "proj")) {
        const decl = parent && parent.type === "VariableDeclarator" && parent.id === n && !!parent.init && parent.init.type === "CallExpression" && isId(parent.init.callee, "compProjection");
        const field = parent && parent.type === "MemberExpression" && parent.object === n && !parent.computed && COMP_PROJ_FIELDS.indexOf(parent.property.name) !== -1;
        if (!keyOf(n, parent) && !decl && !field) leaks.push(n.loc.start.line + ":proj use");
        return;
      }
      let label = null;
      if (n.type === "MemberExpression" && !n.computed && isId(n.object, "proj") && ["comp", "goalComp", "diff", "ytdComp"].indexOf(n.property.name) !== -1) label = "proj." + n.property.name;
      else if (n.type === "CallExpression" && n.callee.type === "MemberExpression" && !n.callee.computed && n.callee.property.name === "toLocaleString" &&
        n.arguments.slice(1).some(a => a.type !== "ObjectExpression" || JSON.stringify(a).indexOf("\"currency\"") !== -1)) label = "currency";
      else if (isId(n, "Intl") && !keyOf(n, parent)) label = "Intl";
      else if ((n.type === "StringLiteral" || n.type === "JSXText") && n.value.indexOf("/wRVU") !== -1) label = "/wRVU";
      else if (n.type === "TemplateElement" && n.value.cooked.indexOf("/wRVU") !== -1) label = "/wRVU";
      else if (isMember(n, "settings", "ratePerRVU")) {
        const gt0 = parent.type === "BinaryExpression" && parent.operator === ">" && parent.left === n && parent.right.type === "NumericLiteral" && parent.right.value === 0;
        const arg = parent.type === "ObjectProperty" && parent.value === n && isId(parent.key, "rate") && !!ggp && ggp.type === "CallExpression" && isId(ggp.callee, "compProjection");
        const factor = parent.type === "BinaryExpression" && parent.operator === "*" && !!gp && gp.type === "VariableDeclarator" && gp.init === parent && gp.id.type === "Identifier" && DERIVED.indexOf(gp.id.name) !== -1;
        if (!gt0 && !arg && !factor) label = "settings.ratePerRVU";
      }
      else if (n.type === "Identifier" && DERIVED.indexOf(n.name) !== -1 && !keyOf(n, parent) && !(parent && parent.type === "VariableDeclarator" && parent.id === n)) label = n.name;
      if (!label) return;
      money++;
      const chain = stack.concat([n]);
      const masked = chain.some((a, i) => {
        const c = chain[i + 1];
        if (!c) return false;
        if (a.type === "CallExpression" && isId(a.callee, "fmtDollar") && a.arguments.length === 2 && a.arguments[0] === c && isId(a.arguments[1], "showComp")) return true;
        if (a.type === "ConditionalExpression" && isId(a.test, "showComp") && a.consequent === c) return true;
        return a.type === "LogicalExpression" && a.operator === "&&" && isId(a.left, "showComp") && a.right === c;
      });
      if (!masked) leaks.push(n.loc.start.line + ":" + label);
    });
    return { leaks: leaks, money: money };
  };
  // The gate's own self-test: masked forms pass, each leak is caught once.
  const leakSelf = [
    ["var a = fmtDollar(proj.comp, showComp);", 0], ["var a = showComp ? (proj.onPace ? \"+\" : \"\") + proj.diff.toLocaleString(\"en-US\", { style: \"currency\" }) : \"$\";", 0],
    ["var a = showComp ? \"$\" + settings.ratePerRVU + \"/wRVU\" : \"\";", 0], ["var a = showComp && <i>{\"$\" + settings.ratePerRVU + \"/wRVU\"}</i>;", 0],
    ["var prevYearComp = t * settings.ratePerRVU; var a = fmtDollar(prevYearComp, showComp);", 0], ["var a = settings.ratePerRVU > 0 && b;", 0],
    ["var a = fmtDollar(proj.ytdComp, showComp);", 0], ["var a = proj.ytdComp;", 1],
    ["var proj = compProjection({ rate: settings.ratePerRVU }); var a = proj.show;", 0], ["var a = proj.wrvu.toFixed(0) + proj.goalWRVU.toLocaleString();", 0],
    ["var a = proj.comp;", 1], ["var a = fmtDollar(proj.goalComp, true);", 1], ["var a = fmtDollar(proj.comp, showComp, 1);", 1], ["var a = showComp ? \"\" : proj.diff;", 1],
    ["var a = !showComp ? \"\" : proj.comp;", 1], ["var a = <b>{proj.goalComp}</b>;", 1],
    ["var a = x.toLocaleString(\"en-US\", { style: \"currency\", currency: \"USD\" });", 1], ["var a = x.toLocaleString(\"en-US\", { \"style\": \"currency\" });", 1],
    ["var a = x.toLocaleString(\"en-US\", USD);", 1], ["var a = new Intl.NumberFormat(\"en-US\").format(x);", 1],
    ["var a = \"$\" + r + \"/wRVU\";", 1], ["var a = <b>$55/wRVU</b>;", 1], ["var a = `$${r}/wRVU`;", 1],
    ["var a = settings.ratePerRVU * 2;", 1], ["var prevYearComp = t * settings.ratePerRVU; var a = prevYearComp;", 1], ["var tComp = t * settings.ratePerRVU;", 1],
    ["var c = proj; var a = c.wrvu;", 1], ["var { comp } = proj;", 1], ["var a = proj[\"wrvu\"];", 1], ["var a = proj.secret;", 1]]
    .filter(t => { try { return cardMoneyGate(t[0]).leaks.length !== t[1]; } catch (e) { return true; } });
  check("5f-2 self-test: Home's $ tripwire passes fmtDollar(x, showComp), showComp ? x : .. and showComp && x, and catches unmasked proj $ reads, rate reads, currency/Intl formatting, /wRVU text and any proj alias", leakSelf.length === 0, leakSelf.map(t => t[0]).join(" ; "));
  const dsrc = fs.readFileSync(path.join(JS_DIR, "dashboard.js"), "utf8");
  const WANT = { trackedWRVU: "trackedRVU", trackedDays: "dp", compareWRVU: "reconYTD", compareMonths: "reconCount", annualGoal: "settings.annualGoal", reconGoal: "settings.reconGoal", rate: "settings.ratePerRVU" };
  const exprText = n => !n ? "" : n.type === "Identifier" ? n.name : (n.type === "MemberExpression" && !n.computed && n.object.type === "Identifier" ? n.object.name + "." + n.property.name : "?");
  const calls = [], argBad = [], banned = [], declInit = {}, avgEnc = [];
  let gate = null, showGate = 0, pillName = 0, ytdRead = 0, rateFmt = 0, ytdUncond = 0, startGuard = 0;
  try {
    gate = cardMoneyGate(dsrc);
    walk(parser.parse(dsrc, AST_OPTS).program, n => {
      if (n.type === "CallExpression" && isId(n.callee, "compProjection")) {
        calls.push(n.loc.start.line);
        const o = n.arguments.length === 1 ? n.arguments[0] : null, got = {};
        if (o && o.type === "ObjectExpression") o.properties.forEach(p => { if (p.type === "ObjectProperty" && !p.computed && p.key.type === "Identifier") got[p.key.name] = exprText(p.value); else got["?"] = "?"; });
        const keys = Object.keys(got).sort();
        if (keys.join() !== Object.keys(WANT).sort().join() || keys.some(k => got[k] !== WANT[k])) argBad.push(n.loc.start.line + " " + JSON.stringify(got));
      }
      if (n.type === "VariableDeclarator" && n.id.type === "Identifier") {
        if (n.id.name === "reconPace" || n.id.name === "orPace") declInit[n.id.name] = (declInit[n.id.name] ? declInit[n.id.name] + "|" : "") + exprText(n.init);
        if (["projected", "goalComp", "projectedComp", "tRVU", "tComp", "instYTD", "instTotal"].indexOf(n.id.name) !== -1) banned.push(n.loc.start.line + ":var " + n.id.name);
      }
      if (n.type === "BinaryExpression" && n.operator === "/" && isId(n.right, "credEnc")) avgEnc.push(exprText(n.left));
      // Comp YTD is fmtDollar(proj.ytdComp, showComp), and no fmtDollar
      // argument mentions the rate at all (an inline total would dodge the
      // source rule).
      if (n.type === "CallExpression" && isId(n.callee, "fmtDollar") && isMember(n.arguments[0], "proj", "ytdComp")) ytdRead++;
      if (n.type === "CallExpression" && isId(n.callee, "fmtDollar") && n.arguments[0] && JSON.stringify(n.arguments[0]).indexOf("\"ratePerRVU\"") !== -1) rateFmt++;
      if (n.type === "NumericLiteral" && n.value === 30.44) banned.push(n.loc.start.line + ":30.44");
      // (instYTD was removed with the any-year Comp YTD switch; the clause
      // still refuses a pace divided by it however it comes back.)
      if (n.type === "BinaryExpression" && n.operator === "/" && (isId(n.right, "reconCount") || isMember(n.right, "instYTD", "length"))) banned.push(n.loc.start.line + ":pace division");
      if (n.type === "AssignmentExpression" && isId(n.left, "startYM") && JSON.stringify(n.right).indexOf("\"isYMD\"") !== -1) startGuard++;
      if (n.type === "LogicalExpression" && n.operator === "&&" && isMember(n.left, "proj", "show") && n.right.type === "JSXElement") showGate++;
      if (n.type === "BinaryExpression" && n.operator === "+" && isMember(n.right, "proj", "goalName")) pillName++;
    });
    // ...shown unconditionally: the call sits directly in a JSX {...}, so no
    // switch (e.g. hasInst ? .. : fmtDollar(0, ..)) can stand in front of it.
    walkStack(dsrc, (n, stack) => {
      const parent = stack[stack.length - 1];
      if (n.type === "CallExpression" && isId(n.callee, "fmtDollar") && isMember(n.arguments[0], "proj", "ytdComp") && parent && parent.type === "JSXExpressionContainer") ytdUncond++;
    });
  } catch (e) { gate = null; }
  check("5f-2: dashboard.js parses for the Compensation card gates", gate !== null);
  check("5f-2: Home calls compProjection exactly once with the twin-card totals and the three settings (any key order); reconPace / orPace come from it; the card shows on proj.show and names proj.goalName; no projection math, goal or any-year Comp YTD switch of its own; Avg/Enc = trackedRVU / credEnc",
    gate !== null && calls.length === 1 && argBad.length === 0 && declInit.reconPace === "proj.comparePace" && declInit.orPace === "proj.trackedPace" && banned.length === 0 && showGate === 1 && pillName === 1 &&
      avgEnc.length === 1 && avgEnc[0] === "trackedRVU" && ytdRead === 1 && ytdUncond === 1 && rateFmt === 0 && startGuard === 1,
    JSON.stringify({ calls: calls, argBad: argBad, declInit: declInit, banned: banned, showGate: showGate, pillName: pillName, avgEnc: avgEnc, ytdRead: ytdRead, ytdUncond: ytdUncond, rateFmt: rateFmt, startGuard: startGuard }));
  check("5f-2: Home's $ tripwire - every money node in dashboard.js is masked, proj is read only as proj.<field>, and the money-node count is " + COMP_MONEY_PIN,
    gate !== null && gate.leaks.length === 0 && gate.money === COMP_MONEY_PIN, gate ? JSON.stringify({ leaks: gate.leaks, money: gate.money }) : "parse");
}

// 2b. ASCII only in scripts/*.js too (the same CLAUDE.md rule; test
// fixtures use \u escapes).
fs.readdirSync(path.join(APP, "scripts")).filter(f => /\.js$/.test(f)).forEach(f => {
  const s = fs.readFileSync(path.join(APP, "scripts", f), "utf8"), i = s.search(/[^\x00-\x7f]/);
  check("ascii scripts/" + f, i === -1, i === -1 ? "" : "non-ASCII at index " + i + " (char " + JSON.stringify(s[i]) + ")");
});

// 5g. Directorships structure (directorships.js + its hooks into utils.js,
// settings.js, app.js, dashboard.js). AST-based where it matters.
{
  const PLAIN = ["crypto.js", "cpt-data.js", "utils.js", "styles.js"];
  const read = f => fs.readFileSync(path.join(JS_DIR, f), "utf8");
  const astOf = f => { try { return parser.parse(read(f), AST_OPTS); } catch (e) { return null; } };
  const dirSrc = fs.existsSync(path.join(JS_DIR, "directorships.js")) ? read("directorships.js") : "";
  const dirAst = dirSrc ? astOf("directorships.js") : null;
  // The source with every comment blanked (same offsets), so a text gate is
  // never satisfied by commented-out code.
  const dirCode = dirAst ? dirAst.comments.reduce((s, c) => s.slice(0, c.start) + " ".repeat(c.end - c.start) + s.slice(c.end), dirSrc) : dirSrc;
  const topNames = a => a ? a.program.body.reduce((out, n) => {
    if (n.type === "FunctionDeclaration" && n.id) out.push(n.id.name);
    else if (n.type === "VariableDeclaration") n.declarations.forEach(d => { if (d.id && d.id.type === "Identifier") out.push(d.id.name); else if (d.id && d.id.type === "ObjectPattern") d.id.properties.forEach(p => { if (p.value && p.value.name) out.push(p.value.name); }); });
    else if (n.type === "ClassDeclaration" && n.id) out.push(n.id.name);
    return out;
  }, []) : [];
  // G2: directorships passes through RAW (missing = seed, [] = removed).
  const fr = findDeclared(settingsAst, "finishRestore");
  const frSrc = fr ? settingsSrc.slice(fr.start, fr.end) : "";
  check("directorships G2: loadData and finishRestore pass `directorships` raw (no || []), and finishRestore repairs before it writes",
    /directorships: s\.directorships,/.test(utils) && !/directorships: s\.directorships \|\|/.test(utils) &&
    /directorships: restored\.directorships,/.test(frSrc) && frSrc.indexOf("repairData(restored)") !== -1 && frSrc.indexOf("repairData(restored)") < frSrc.indexOf("upd(function()"));
  // G3: the JSON export strips the signature.
  const ex = findDeclared(settingsAst, "expJSON");
  const exSrc = ex ? settingsSrc.slice(ex.start, ex.end) : "";
  check("directorships G3: the JSON export deletes dirSignatureEnc", exSrc.indexOf("delete clean.dirSignatureEnc;") !== -1);
  // G4 + G7: Babel files reach the four store fields only through the utils
  // accessors; the only member reads are finishRestore's rebuild and the
  // export's delete. The signature field never appears outside utils.js and
  // those two settings.js spots.
  const FIELDS = ["directorships", "dirEntries", "dirHandoff", "dirSignatureEnc"];
  const memberBad = [];
  jsFiles.filter(f => PLAIN.indexOf(f) === -1).forEach(f => {
    const a = astOf(f); if (!a) return;
    walk(a.program, n => {
      if (n.type !== "MemberExpression" || n.computed || !n.property || FIELDS.indexOf(n.property.name) === -1) return;
      const obj = n.object && n.object.type === "Identifier" ? n.object.name : "";
      const ok = f === "settings.js" && (obj === "restored" || (obj === "clean" && n.property.name === "dirSignatureEnc"));
      if (!ok) memberBad.push(f + ":" + n.loc.start.line + " ." + n.property.name);
    });
  });
  const sigMentions = jsFiles.filter(f => f !== "utils.js" && read(f).indexOf("dirSignatureEnc") !== -1);
  const setSig = (settingsSrc.match(/dirSignatureEnc/g) || []).length;
  check("directorships G4/G7: Babel files read the store fields only through the accessors; dirSignatureEnc only in utils.js + finishRestore + the export strip",
    memberBad.length === 0 && sigMentions.join() === "settings.js" && setSig === 3 && dirSrc.indexOf("dirSignatureEnc") === -1, JSON.stringify({ memberBad: memberBad, sigMentions: sigMentions, setSig: setSig }));
  // G5: no PIN-change flow exists; one must re-encrypt the API key AND the
  // signature together (CLAUDE.md). This trips on any new aesEncrypt call
  // site or PIN screen mode in crypto.js.
  const cryptoSrc = read("crypto.js");
  const modes = (cryptoSrc.match(/showPinScreen\("([a-z]+)"\)/g) || []).map(m => m.slice(15, -2)).filter((m, i, a) => a.indexOf(m) === i).sort();
  check("directorships G5: crypto.js still has exactly 2 aesEncrypt( call sites and only the setup/locked PIN modes - a new PIN flow must re-encrypt settings.encryptedApiKey AND dirSignatureEnc (CLAUDE.md)",
    (cryptoSrc.match(/aesEncrypt\(/g) || []).length === 3 && modes.join() === "locked,setup" && dirSrc.indexOf("RVU_CRYPTO") === -1, JSON.stringify({ aes: (cryptoSrc.match(/aesEncrypt\(/g) || []).length, modes: modes }));
  // G6: no email addresses in any tracked text file (this file included).
  const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/;
  const sample = "a" + "@" + "b.co";
  const tracked = [];
  [APP, JS_DIR, path.join(APP, "scripts")].forEach(dir => fs.readdirSync(dir).forEach(f => {
    const p = path.join(dir, f);
    if (fs.statSync(p).isFile() && /\.(js|html|md|json)$/.test(f) && f !== "package-lock.json" && f !== "cpt-data.js") tracked.push(p);
  }));
  const withEmail = tracked.filter(p => EMAIL.test(fs.readFileSync(p, "utf8"))).map(p => path.relative(APP, p));
  check("directorships G6: no email address in any tracked text file (" + tracked.length + " files); self-test matches a built sample and not package@version",
    EMAIL.test(sample) && !EMAIL.test("jspdf@4.2.1/dist") && !EMAIL.test("@babel/parser") && withEmail.length === 0, withEmail.join(", "));
  // G9: directorships.js names and the share hand-off.
  const dTop = topNames(dirAst).sort();
  let shares = [], shareArgOk = false, inShare = false, badApi = [];
  if (dirAst) walk(dirAst.program, n => {
    if (n.type === "CallExpression" && n.callee.type === "MemberExpression" && n.callee.object.name === "navigator" && n.callee.property.name === "share") {
      shares.push(n);
      const a = n.arguments[0];
      shareArgOk = n.arguments.length === 1 && a.type === "ObjectExpression" && a.properties.length === 1 && a.properties[0].key.name === "files";
    }
    if (n.type === "VariableDeclarator" && n.id.name === "sharePdf") inShare = n.init;
    if (n.type === "MemberExpression" && !n.computed && ["html", "addJS", "AcroForm", "createAnnotation", "innerHTML"].indexOf(n.property.name) !== -1) badApi.push(n.property.name + ":" + n.loc.start.line);
    if (n.type === "CallExpression" && n.callee.type === "MemberExpression" && n.callee.property.name === "output" && !(n.arguments[0] && n.arguments[0].value === "blob")) badApi.push("output:" + n.loc.start.line);
  });
  const shareInside = !!inShare && shares.length === 1 && shares[0].start >= inShare.start && shares[0].end <= inShare.end;
  const bodyOf = name => { let b = ""; if (dirAst) walk(dirAst.program, n => { if (n.type === "VariableDeclarator" && n.id.name === name && n.init) b = dirCode.slice(n.init.start, n.init.end); }); return b; };
  check("directorships G9: four top-level components; one navigator.share({ files }) inside sharePdf; PDF build never shares; no RVU_CRYPTO/localStorage/innerHTML; jsPDF calls stay in the allowed surface; settings.js share count unchanged",
    dTop.join() === "DirReview,DirSignaturePad,Directorships,DirectorshipsCard" && shareInside && shareArgOk &&
    !/share/i.test(bodyOf("createPdf").replace(/sharingRef|shareFailed/g, "")) && !/share/i.test(bodyOf("buildPdfFile")) &&
    dirSrc.indexOf("localStorage") === -1 && badApi.length === 0 && (settingsSrc.match(/navigator\.share\(/g) || []).length === 2,
    JSON.stringify({ top: dTop, shares: shares.length, shareInside: shareInside, shareArgOk: shareArgOk, badApi: badApi }));
  // G10: no Babel file redeclares a plain-script top-level name (CLAUDE.md 3c).
  const plainNames = {};
  ["crypto.js", "utils.js", "styles.js"].forEach(f => topNames(astOf(f)).forEach(n => { plainNames[n] = f; }));
  const clash = [];
  jsFiles.filter(f => PLAIN.indexOf(f) === -1).forEach(f => topNames(astOf(f)).forEach(n => { if (plainNames[n]) clash.push(f + ":" + n + " (" + plainNames[n] + ")"); }));
  check("directorships G10: no Babel file redeclares a plain-script top-level name", clash.length === 0, clash.join(", "));
  // G11: the lazy jsPDF loader's pinned shape.
  const pdfPath = (utils.match(/var PDF_PATH = "([^"]+)";/) || [])[1] || "", pdfSri = (utils.match(/var PDF_SRI = "([^"]+)";/) || [])[1] || "";
  const ld = findDeclared(utilsAst, "loadPDF"), ldSrc = ld ? utils.slice(ld.start, ld.end) : "";
  check("directorships G11: loadPDF pins PDF_PATH + PDF_SRI, tries unpkg then jsdelivr with crossOrigin anonymous, and index.html never loads jsPDF at boot",
    /^jspdf@\d+\.\d+\.\d+\/dist\/jspdf\.umd\.min\.js$/.test(pdfPath) && /^sha384-[A-Za-z0-9+\/]{64}$/.test(pdfSri) &&
    utils.indexOf('var PDF_HOSTS = ["https://unpkg.com/", "https://cdn.jsdelivr.net/npm/"];') !== -1 &&
    ldSrc.indexOf('s.crossOrigin = "anonymous"') !== -1 && ldSrc.indexOf("s.integrity = PDF_SRI") !== -1 && !/jspdf/i.test(html.replace(/<!--[\s\S]*?-->/g, "")),
    JSON.stringify({ pdfPath: pdfPath, sri: pdfSri.slice(0, 12) }));
  // G12: the reminder key - per device, outside the store, utils.js only.
  const remLeak = jsFiles.filter(f => f !== "utils.js" && /DIR_REMIND_KEY|rvu-dir-reminder/.test(read(f)));
  check("directorships G12: the reminder key is rvu-dir-reminder, reserved, utils.js-only and never a store field; routes and the Settings mount are typeof-guarded",
    utils.indexOf('var DIR_REMIND_KEY = "rvu-dir-reminder";') !== -1 && BK_RESERVED.filter(k => k === "rvu-dir-reminder").length === 1 && remLeak.length === 0 &&
    !!defObj && objKeys(defObj).every(k => !/remind/i.test(k)) &&
    read("app.js").indexOf('typeof Directorships === "function"') !== -1 && settingsSrc.indexOf('typeof DirectorshipsCard === "function"') !== -1, remLeak.join(", "));
  // G8: stored row keys, the hint and the printed attestation texts.
  const GK = "g_guidelines,g_oversee,g_orientation,g_dept_ed,g_community_ed,g_policy,g_safety,g_goals,g_budget,g_strategic,g_quality,g_ur,g_supplies,g_rules,g_research,g_idg,g_other,g_meeting";
  const SKs = "s_policies,s_qa_risk,s_liaison,s_outreach,s_committees,s_staff_ed,s_outcomes,s_meetings,s_travel,s_other";
  const keysIn = name => { const m = utils.match(new RegExp("var " + name + " = \\[([\\s\\S]*?)\\n\\];")); return m ? (m[1].match(/key: "([a-z_]+)"/g) || []).map(k => k.slice(6, -1)).join() : ""; };
  check("directorships G8: Genesis and Select row keys pinned in order (stored data); hint and CERTIFICATION text exact; the old red instruction line never appears",
    keysIn("DIR_GENESIS_ROWS") === GK && keysIn("DIR_SELECT_ROWS") === SKs && utils.indexOf('var DIR_DETAIL_HINT = "meeting or topic only - no patient information";') !== -1 &&
    utils.indexOf('var DIR_GENESIS_CERT = "CERTIFICATION: By signing this document,') !== -1 && utils.indexOf("CERTIFCATION") === -1 &&
    jsFiles.every(f => read(f).indexOf("Duration must be entered") === -1), JSON.stringify({ g: keysIn("DIR_GENESIS_ROWS"), s: keysIn("DIR_SELECT_ROWS") }));
  // G13: the PDF always prints the real Rate/Due/Total (owner clarification 1),
  // Create/Share/Download re-check the PIN before acting, share marks the hash
  // the PDF was built from; an entry/month change drops a ready PDF and the
  // finished step, a date change drops only an unsent PDF. All on comment-free code.
  const drawB = ["drawGenesis", "drawSelect", "buildPdfFile"].map(bodyOf), cpB = bodyOf("createPdf"), shB = bodyOf("sharePdf"), dlB = bodyOf("downloadPdf");
  const pinFirst = (b, chk, act) => b.indexOf(chk) !== -1 && b.indexOf(act) !== -1 && b.indexOf(chk) < b.indexOf(act);
  check("directorships G13: PDF draw path never masks money; Create/Share/Download re-check the PIN first (and return); share marks p.hash; entry/month change drops PDF + done, a date change drops only the PDF",
    drawB.every(b => b && !/dirMoneyShown|showComp|fmtDollar/.test(b)) &&
    drawB[0].indexOf("m.footer.rate") !== -1 && drawB[0].indexOf("m.footer.due") !== -1 && drawB[1].indexOf("m.header.totalDue") !== -1 &&
    pinFirst(cpB, 'if (!dirSigStillValid(sig.pin)) { setSig({ state: "locked", url: "", pin: "" }); setPdf(null); return; }', "buildPdfFile(") &&
    pinFirst(shB, "if (!dirSigStillValid(p.pinAt)) { wipe(); return; }", "navigator.share(") && pinFirst(dlB, "if (!dirSigStillValid(p.pinAt)) { wipe(); return; }", "downloadBlob(") &&
    /dirHandoffMark\([^;]*p\.hash\)/.test(shB) && shB.indexOf("model.hash") === -1 &&
    dirCode.indexOf('useEffect(function() { setPdf(null); setDone(""); setMsg(""); }, [model.hash, dirId, ym]);') !== -1 &&
    dirCode.indexOf("useEffect(function() { setPdf(null); }, [model.generatedYMD]);") !== -1 && dirCode.indexOf("model.generatedYMD, dirId") === -1);
  // G4 (utils side): dirSignatureEnc only inside the allowed top-level
  // functions; the load and PIN-binding bodies never touch storage, upd or console.
  const SIG_FNS = ["defState", "loadData", "repairData", "validateData", "dirSignatureSave", "dirSignatureRemove", "dirSignatureLoad", "dirHasSignature", "dirSigKey", "dirRestoreNote"];
  const topOfU = pos => { const t = utilsAst ? utilsAst.program.body.find(b => b.start <= pos && pos < b.end) : null; if (!t) return "?"; if (t.type === "FunctionDeclaration") return t.id.name; if (t.type === "VariableDeclaration") return t.declarations.map(d => d.id.name).join(); return t.type; };
  const sigOut = [];
  if (utilsAst) walk(utilsAst.program, n => {
    if ((n.type === "Identifier" && n.name === "dirSignatureEnc") || (n.type === "StringLiteral" && n.value === "dirSignatureEnc")) { const t = topOfU(n.start); if (SIG_FNS.indexOf(t) === -1) sigOut.push(t + ":" + n.loc.start.line); }
  });
  const sigBodyBad = ["dirSignatureLoad", "dirSigStillValid"].filter(fn => { const d = utilsAst && findDeclared(utilsAst, fn); return !d || /\b(localStorage|sessionStorage|upd|console)\b/.test(utils.slice(d.start, d.end)); });
  check("directorships G4 (utils): dirSignatureEnc only in " + SIG_FNS.join("/") + "; dirSignatureLoad + dirSigStillValid free of localStorage/sessionStorage/upd/console",
    !!utilsAst && sigOut.length === 0 && sigBodyBad.length === 0, JSON.stringify({ sigOut: sigOut, sigBodyBad: sigBodyBad }));
  // G5 (per file): encrypt/decrypt call sites through ANY receiver
  // (window.RVU_CRYPTO or the dirCrypto() alias); crypto.js is pinned above.
  const CRYPTO_CALLS = { "utils.js": [2, 2], "settings.js": [1, 2] }, cryptoOff = [];
  jsFiles.filter(f => f !== "crypto.js").forEach(f => {
    const a = astOf(f); if (!a) { cryptoOff.push(f + ":parse"); return; }
    const c = { encrypt: 0, decrypt: 0 };
    walk(a.program, n => { if (n.type === "CallExpression" && n.callee.type === "MemberExpression" && !n.callee.computed && n.callee.property && c[n.callee.property.name] !== undefined) c[n.callee.property.name]++; });
    const w = CRYPTO_CALLS[f] || [0, 0];
    if (c.encrypt !== w[0] || c.decrypt !== w[1]) cryptoOff.push(f + "=" + c.encrypt + "/" + c.decrypt);
  });
  check("directorships G5 (per file): .encrypt(/.decrypt( call sites utils 2/2, settings 1/2, 0 elsewhere - a new PIN flow must re-encrypt settings.encryptedApiKey AND dirSignatureEnc (CLAUDE.md)", cryptoOff.length === 0, cryptoOff.join(", "));
  // G14: the review fixes in the screens - the Review model follows the date,
  // both signature views key on the ciphertext, Save ignores a double tap,
  // opening a screen clears Log errors, Mark handed off survives a lock, the
  // pad follows one pointer and drops strokes when the PIN goes.
  let padSrc = "";
  if (dirAst) dirAst.program.body.forEach(n => { if (n.type === "FunctionDeclaration" && n.id.name === "DirSignaturePad") padSrc = dirCode.slice(n.start, n.end); });
  check("directorships G14: Review memo keyed on today (state, set by the 1 s check and before buildPdfFile); decrypt effects keyed on sigKey = dirSigKey(data); saveNew checks savingRef first; openScreen clears problems; Mark handed off outside the pdf block and works with pdf null; the Log hint normalizes the draft like Save; pad tracks its pointer and its PIN",
    dirCode.indexOf("dirFormModel(data, dirId, ym, today); }, [data, dirId, ym, today]);") !== -1 && dirCode.indexOf("const [today, setToday] = useState(todayLocal());") !== -1 &&
    dirCode.indexOf("setToday(function(d) { return d === t0 ? d : t0; });") !== -1 && pinFirst(cpB, "if (model.generatedYMD !== t1) { setToday(t1); return; }", "buildPdfFile(") &&
    (dirCode.match(/\}, \[sigKey, sigTick\]\);/g) || []).length === 2 && (dirCode.match(/sigKey = dirSigKey\(data\);/g) || []).length === 2 && dirCode.indexOf("[hasSig, sigTick]") === -1 &&
    /^function\(\) \{\s*if \(savingRef\.current\) return;/.test(bodyOf("saveNew")) && bodyOf("openScreen").indexOf("setProblems([]);") !== -1 &&
    dirCode.indexOf('{!pdf && done === "downloaded" && <button onClick={markAfterDownload}') !== -1 &&
    bodyOf("markAfterDownload").indexOf("p ? p.dirId : dirId") !== -1 && !/if \(!p\)/.test(bodyOf("markAfterDownload")) &&
    dirCode.indexOf("var dText = dirDetailText(dirAsciiPunct(f.detail)), dKey = dirDetailKey(dText);") !== -1 && dirCode.indexOf("category: row.key, detail: dText,") !== -1 &&
    (padSrc.match(/e\.pointerId !== activeId\.current/g) || []).length === 2 && (padSrc.match(/dirSigStillValid\(pinRef\.current\)/g) || []).length === 2,
    JSON.stringify({ pad: padSrc.length }));
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

  // wRVU overrides. getDB applies an override only when truthy: a stored 0
  // (the old keystroke editor could save one) stays inert - the code keeps its
  // CMS value. Honoring 0 would silently zero that code on any phone holding
  // one, so this is pinned. rvuOverrideFromText is the editor's commit rule:
  // null = remove, number = set, undefined = refuse and revert.
  const ovC = db0[0].code, ovCms = db0[0].wRVU;
  const ovOf = o => sb.getDB(o).find(c => c.code === ovC).wRVU;
  const ovSet = v => { const o = {}; o[ovC] = v; return o; };
  check("getDB: a truthy override applies; a stored 0 keeps the CMS value",
    ovOf(ovSet(5.5)) === 5.5 && ovOf(ovSet(0)) === ovCms && ovOf({}) === ovCms && ovOf(undefined) === ovCms);
  const OVT = [["", 6.2, undefined], ["  ", 6.2, undefined], [null, 6.2, undefined], ["6.2", 6.2, null], ["6.20", 6.2, null], ["10.", 6.2, 10], ["10.5", 6.2, 10.5], [".5", 6.2, 0.5],
    ["0", 6.2, undefined], ["0.0", 6.2, undefined], [".", 6.2, undefined], ["1.2.3", 6.2, undefined], ["abc", 6.2, undefined], ["-1", 6.2, undefined], ["7", undefined, 7]];
  const ovtBad = OVT.filter(t => sb.rvuOverrideFromText(t[0], t[1]) !== t[2]);
  check("rvuOverrideFromText: the CMS value removes, a positive number sets, blank/0/junk is refused (" + OVT.length + " cases)", ovtBad.length === 0,
    ovtBad.map(t => JSON.stringify(t[0]) + " -> " + JSON.stringify(sb.rvuOverrideFromText(t[0], t[1]))).join(", "));

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
  const ldy = sb.localDateYMD("2026-01-01"), ldyDst = sb.localDateYMD("2026-03-08");   // DST-day midnight: asserted in the pinned zone below
  check("localDateYMD: local midnight from local parts (never UTC); junk is an Invalid Date",
    ldy.getFullYear() === 2026 && ldy.getMonth() === 0 && ldy.getDate() === 1 && ldy.getHours() === 0 && ldy.getMinutes() === 0 &&
    ldyDst.getMonth() === 2 && ldyDst.getDate() === 8 &&
    [ "2026-02-30", "2026-1-01", "2026-01", "", undefined, null, 20260101 ].every(v => isNaN(sb.localDateYMD(v).getTime())));
  // The same helpers in a PINNED US zone (a child node with TZ set), so the
  // test means something on any machine - in UTC a UTC parse looks right.
  // localDaysBetween counts calendar days across both DST changes (a
  // floored millisecond count drops a day from 00:00 to 01:00 after March).
  {
    const uAst = parser.parse(utils, { sourceType: "script" });
    const fnSrc = ["isYMD", "localDateYMD", "localDaysBetween"].map(name => {
      const n = uAst.program.body.filter(s => s.type === "FunctionDeclaration" && s.id.name === name)[0];
      return n ? utils.slice(n.start, n.end) : "";
    });
    const probe = fnSrc.join("\n") + "\nvar j1 = localDateYMD(\"2026-01-01\"), j2 = localDateYMD(\"2026-03-08\");\nconsole.log(JSON.stringify([j1.getMonth(), j1.getDate(), j1.getHours(), j2.getDate(), j2.getHours(), " +
      "localDaysBetween(j1, new Date(2026, 0, 1, 23, 59)), localDaysBetween(j1, new Date(2026, 0, 2, 0, 0)), localDaysBetween(j1, new Date(2026, 2, 9, 0, 30)), " +
      "localDaysBetween(j1, new Date(2026, 10, 1, 23, 30)), localDaysBetween(j1, localDateYMD(\"2027-01-01\")), localDaysBetween(localDateYMD(\"2028-01-01\"), localDateYMD(\"2029-01-01\"))]));";
    let tzOut = "";
    try { tzOut = require("child_process").execFileSync(process.execPath, ["-e", probe], { env: Object.assign({}, process.env, { TZ: "America/Chicago" }), encoding: "utf8" }).trim(); }
    catch (e) { tzOut = "error: " + e.message; }
    check("localDateYMD / localDaysBetween in America/Chicago: local midnight, whole days across both DST changes",
      fnSrc.every(Boolean) && tzOut === JSON.stringify([0, 1, 0, 8, 0, 0, 1, 67, 304, 365, 366]), tzOut);
  }
  const floorDays = ["dashboard.js", "analytics.js"].filter(f => /Math\.floor\(\([^()]*-[^()]*\)\s*\/\s*86400000\)/.test(fs.readFileSync(path.join(JS_DIR, f), "utf8")));
  check("Home and Trends count year days with localDaysBetween (no floored millisecond day counts)", floorDays.length === 0, floorDays.join(", "));
  check("localDaysBetween: same day 0, next local day 1, Invalid Date NaN",
    sb.localDaysBetween(new Date(2026, 4, 1, 0, 0), new Date(2026, 4, 1, 23, 59)) === 0 && sb.localDaysBetween(new Date(2026, 4, 1, 23, 59), new Date(2026, 4, 2, 0, 1)) === 1 &&
    isNaN(sb.localDaysBetween(sb.localDateYMD(""), new Date(2026, 4, 1))));
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
  // base24 is a Sunday - a weekend day at S1 - so under a 12h version it
  // stays a 24h weekend shift (two stipends); the weekday copy takes 12h.
  const baseWd = Object.assign({}, base24, { id: "rpw", date: "2026-05-12" });
  const rp = sb.payRepriceShift(baseWd, S1back), rpWe = sb.payRepriceShift(base24, S1back), rpPart = sb.payRepriceShift(part12, S1back);
  check("payRepriceShift: full-length takes the new length (24h on a weekend day); partial keeps its hours; hand-checked totals",
    !!rp && rp.callHours === 12 && rp.rates.id === "new12" && sb.computeShiftPay(rp).total === 1200 &&
    !!rpWe && rpWe.callHours === 24 && sb.computeShiftPay(rpWe).total === 2400 &&
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
  // DAVT is the preset Davenport as shipped. DAV is the SAME site with only
  // its LEGACY rate version(s), re-dated 2026-10-01: every legacy fixture
  // below (WORKED, FLOWS, DEFH, the edit flows) prices October dates through
  // it, so those pinned figures prove pre-change pay is unchanged whatever
  // the preset's Day/Night version does. A legacy version has no shiftTypes.
  const SIL = defs.filter(s => s.name === "Silvis")[0], DAVT = defs.filter(s => s.name === "Davenport")[0];
  const DAV = Object.assign({}, DAVT, { rates: DAVT.rates.filter(r => !Array.isArray(r.shiftTypes)).map(r => Object.assign({}, r, { effective: "2026-10-01" })) });
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
  // Directorships: a store saved by this build always carries the field
  // (the preset passes repairData unchanged), so fixtures carry it too.
  const seedStore = (o) => Object.assign({ entries: [], settings: { ratePerRVU: 55, annualGoal: 0, reconGoal: 0 }, paySites: [], payShifts: [], directorships: sb.defaultDirectorships() }, o || {});
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
  // ---- Day/Night reader (commit A): the typed shapes (plan b1/b3) pass
  // through this build untouched, unpriced and never re-priced, so a rollback
  // to it keeps the data. Made-up amounts.
  const TV = { id: "tv", effective: "2026-10-01", shiftTypes: [
    { key: "day", label: "Day", hours: 12, flat: 1000, stipend: 0, stipendLabel: "", callIn: null },
    { key: "night", label: "Night", hours: 12, flat: 100, stipend: 0, stipendLabel: "", callIn: { hourly: 50, thresholdMinutes: 180 } }] };
  const ORIG = Object.assign({}, RA, { id: "orig", effective: null });
  const SX2 = { id: "sx2", name: "SX2", weekendDays: [0, 6], casesEarnRVU: true, rates: [ORIG, TV] };
  const TSHIFT = { id: "ts1", date: "2026-10-05", siteId: "sx2", siteName: "SX2", rates: { id: "tv", effective: "2026-10-01", shiftType: TV.shiftTypes[1] }, callIns: [120, 30] };
  const OSHIFT = mkShift("os1", { id: "sx2", name: "SX2", weekendDays: [0, 6], rates: [ORIG] }, "2026-09-10");
  const aStore = seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: [JSON.parse(JSON.stringify(SX2))], payShifts: JSON.parse(JSON.stringify([TSHIFT, OSHIFT])) });
  const aJson = JSON.stringify(aStore), aSeen = [], aReal = sb.showDataAlert;
  let aFixed = null;
  try { sb.showDataAlert = m => aSeen.push(m); aFixed = sb.repairData(aStore); } finally { sb.showDataAlert = aReal; }
  check("reader: an Original (null date), a typed version and a typed shift pass repairData byte for byte with no tag and no banner; validateData stays true",
    !!aFixed && aFixed.length === 0 && aSeen.length === 0 && JSON.stringify(aStore) === aJson && sb.validateData(aStore) === true, JSON.stringify({ fixed: aFixed, seen: aSeen }));
  check("reader: payRateIsTyped / payShiftIsTyped / payEffKey",
    sb.payRateIsTyped(TV) === true && sb.payRateIsTyped(TSHIFT.rates) === true && sb.payRateIsTyped(RA) === false && sb.payRateIsTyped(ORIG) === false && sb.payRateIsTyped(null) === false && sb.payRateIsTyped([]) === false &&
    sb.payShiftIsTyped(TSHIFT) === true && sb.payShiftIsTyped(OSHIFT) === false && sb.payShiftIsTyped({ rates: TV }) === false && sb.payShiftIsTyped(null) === false &&
    sb.payEffKey(ORIG) === "" && sb.payEffKey(TV) === "2026-10-01" && sb.payEffKey({ effective: "junk" }) === null && sb.payEffKey({}) === null && sb.payEffKey(null) === null);
  check("reader: rateInForce - the Original before the first dated version, the typed version from its date, a tie goes to the version added last, an Original alone applies to every date, junk never",
    sb.rateInForce(SX2, "2026-09-30") === ORIG && sb.rateInForce(SX2, "2026-10-01") === TV && sb.rateInForce(SX2, "2027-12-31") === TV &&
    sb.rateInForce({ rates: [ORIG, Object.assign({}, ORIG, { id: "orig2" })] }, "2026-01-01").id === "orig2" && sb.rateInForce({ rates: [ORIG] }, "2000-01-01") === ORIG &&
    sb.rateInForce({ rates: [TV] }, "2026-09-30") === null && sb.rateInForce({ rates: [{ effective: "junk", stipend: 1 }] }, "2026-10-01") === null);
  const aRange = sb.payTotalInRange([TSHIFT, OSHIFT], "2026-01-01", "2027-01-01"), aMonths = sb.payMonthTotals([TSHIFT, OSHIFT], 2026, [SX2]);
  check("typed shift pricing: a typed shift prices from its own type copy (here 150 min under a 3:00 threshold = the flat only); a typed VERSION inside a legacy-shaped shift never prices; a legacy shift priced from an Original copy still prices",
    sb.computeShiftPay(TSHIFT).total === 100 && sb.computeShiftPay(TSHIFT).typed === true && sb.computeShiftPay({ rates: TV, callHours: 12, events: [] }) === null && sb.computeShiftPay(OSHIFT).total === 1000 &&
    aRange.shifts === 2 && aRange.total === 1100 && aMonths.unpriced === 0 && aMonths.total === 1100 && !!sb.cleanPayRate(ORIG, "x") && sb.cleanPayRate(ORIG, "x").effective === null,
    JSON.stringify({ range: aRange, unpriced: aMonths.unpriced }));
  const legacyOct = Object.assign({}, OSHIFT, { id: "lo", date: "2026-10-10" });   // a legacy shift dated where the typed version is in force
  const aDraft = { id: "ad", siteId: "sx2", date: "2026-10-10", callHours: "24", note: "", events: [] };
  const aBuilt = sb.payShiftFromDraft(aDraft, SX2, null);
  check("kind guard: a legacy shift is never stale against a typed version, an unchanged typed shift is not stale, re-price returns null; a draft dated under a typed version takes it and blocks until a type is picked (nothing saved); legacy vs legacy still works with an Original",
    sb.payShiftStale(legacyOct, SX2) === false && sb.payRepriceShift(legacyOct, SX2) === null && sb.payShiftStale(TSHIFT, SX2) === false && sb.payRepriceShift(TSHIFT, SX2) === null &&
    sb.payShiftStale(OSHIFT, Object.assign({}, SX2, { rates: [Object.assign({}, ORIG, { stipend: 999 })] })) === true &&
    sb.payRateIsTyped(sb.payDraftRate(aDraft, SX2, null).rates) && !aBuilt.shift && aBuilt.problems.some(p => p.code === "noType" && p.block && p.label === "Day or Night") &&
    sb.payDraftRate({ id: "bd", siteId: "sx2", date: "2026-09-10" }, SX2, null).from === "inForce",
    JSON.stringify(aBuilt.problems));
  // ---- Typed (Day/Night) model, feature step 1 (made-up amounts; the
  // preset's own figures are pinned further down once it carries the typed
  // version) ----
  const TN = TV.shiftTypes[1], TD = TV.shiftTypes[0];
  const tsh = (callIns, type, extra) => Object.assign({ id: "t-" + (callIns || []).join("-"), date: "2026-10-05", siteId: "sx2", siteName: "SX2", rates: { id: "tv", effective: "2026-10-01", shiftType: type || TN }, callIns: callIns || [] }, extra || {});
  const tp = (callIns, type, extra) => { const p = sb.computeShiftPay(tsh(callIns, type, extra)); return p ? p.total : null; };
  const tline = (callIns, type) => { const p = sb.computeShiftPay(tsh(callIns, type)); return p ? p.lines.map(l => l.kind + ":" + l.amount + (l.kind === "callIn" ? "/" + l.paidMinutes + "/" + l.met : "")).join(" ") : "null"; };
  check("typed pricing: flat + call-in by the ONE threshold rule (the trips are summed and tested once; every minute is paid once met), each line rounded once; a Day has no call-in line; a stipend line only when > 0; unreadable = null",
    tp([]) === 100 && tp([120]) === 100 && tp([179]) === 100 && tp([180]) === 250 && tp([120, 60]) === 250 && tp([120, 30]) === 100 && tp([181]) === 250.83 && tp([200, 200]) === 433.33 &&
    tline([120, 60]) === "flat:100 callIn:150/180/true" && tline([120, 30]) === "flat:100 callIn:0/0/false" && tline([], TD) === "flat:1000" &&
    tp([45], Object.assign({}, TN, { callIn: { hourly: 50, thresholdMinutes: 0 } })) === 137.5 && tp([], Object.assign({}, TN, { callIn: { hourly: 50, thresholdMinutes: 0 } })) === 100 &&
    tline([], Object.assign({}, TD, { flat: 100, stipend: 50.005, stipendLabel: "Trauma" })) === "flat:100 stipend:50.01" && tp([], Object.assign({}, TD, { flat: 100, stipend: 50.005 })) === 150.01 &&
    sb.computeShiftPay(tsh([120], TN, { callIns: "x" })) === null && sb.computeShiftPay(tsh([], Object.assign({}, TN, { hours: 0 }))) === null && sb.computeShiftPay(tsh([90.5])) === null,
    JSON.stringify([tp([181]), tp([200, 200]), tline([120, 60]), tline([120, 30])]));
  const cis = sb.payCallInSummary([120, 120], TN.callIn), cis0 = sb.payCallInSummary([], TN.callIn), cisU = sb.payCallInSummary([170], TN.callIn);
  check("payCallInSummary: trips, minutes, paidMinutes, met, threshold, hourly, amount",
    JSON.stringify(cis) === JSON.stringify({ trips: 2, minutes: 240, paidMinutes: 240, met: true, threshold: 180, hourly: 50, amount: 200 }) &&
    JSON.stringify(cis0) === JSON.stringify({ trips: 0, minutes: 0, paidMinutes: 0, met: false, threshold: 180, hourly: 50, amount: 0 }) &&
    cisU.met === false && cisU.paidMinutes === 0 && cisU.minutes === 170 && sb.payCallInSummary([60], null).amount === 0, JSON.stringify(cis));
  // Repair table (plan Appendix A), one mutation at a time.
  const repTyped = (mut) => {
    const v = JSON.parse(JSON.stringify(TV)); mut(v);
    const st = seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: [{ id: "sx2", name: "SX2", weekendDays: [0, 6], casesEarnRVU: true, rates: [JSON.parse(JSON.stringify(ORIG)), v] }] });
    const real = sb.showDataAlert, seen = []; let fx;
    try { sb.showDataAlert = m => seen.push(m); fx = sb.repairData(st); } finally { sb.showDataAlert = real; }
    const j2 = JSON.stringify(st), fx2 = sb.repairData(st);
    return { n: st.paySites[0].rates.length, banner: seen.join(" | "), fixed: fx.join(","), v: st.paySites[0].rates[1], second: fx2.length === 0 && JSON.stringify(st) === j2 };
  };
  const DROP = [
    ["bad date", v => { v.effective = "2026-13-01"; }], ["no types", v => { v.shiftTypes = []; }], ["types not a list", v => { v.shiftTypes = {}; }],
    ["duplicate key", v => { v.shiftTypes[1].key = "day"; }], ["blank key", v => { v.shiftTypes[0].key = ""; }], ["blank label", v => { v.shiftTypes[0].label = " "; }],
    ["hours 0", v => { v.shiftTypes[0].hours = 0; }], ["flat -1", v => { v.shiftTypes[0].flat = -1; }], ["flat text", v => { v.shiftTypes[0].flat = "abc"; }],
    ["stipend -1", v => { v.shiftTypes[0].stipend = -1; }], ["stipendLabel a number", v => { v.shiftTypes[0].stipendLabel = 5; }],
    ["callIn hourly text", v => { v.shiftTypes[1].callIn.hourly = "x"; }], ["threshold not whole", v => { v.shiftTypes[1].callIn.thresholdMinutes = 90.5; }], ["callIn a list", v => { v.shiftTypes[1].callIn = []; }],
  ];
  const dropMsg = lbl => "Call pay rate SX2 " + lbl + " was unreadable and removed - please re-enter it. Recorded shifts keep their own rates.";
  const badDrop = DROP.filter(t => { const r = repTyped(t[1]); return !(r.n === 1 && r.banner.indexOf(dropMsg(t[0] === "bad date" ? "2026-13-01" : "2026-10-01")) !== -1 && r.second); });
  check("typed version repair: each bad case drops ONLY that version with the banner naming it (" + DROP.length + " cases); the second pass is clean", badDrop.length === 0, badDrop.map(t => t[0] + " -> " + JSON.stringify(repTyped(t[1])).slice(0, 200)).join(" | "));
  const rNum = repTyped(v => { v.shiftTypes[0].flat = "1000"; v.shiftTypes[1].callIn.thresholdMinutes = "180"; delete v.shiftTypes[0].stipend; delete v.shiftTypes[0].stipendLabel; delete v.shiftTypes[0].callIn; v.label = 7; });
  const rOrig = repTyped(v => { v.effective = null; }), rKeep = repTyped(v => { v.extra = { k: 1 }; v.shiftTypes[1].note = "x"; v.shiftTypes[1].callIn.basis = "total"; });
  check("typed version repair: numeric text converts, a missing stipend / stipendLabel / callIn fills in (0 / '' / null), a non-string label is removed - with a tag, no banner, then a fixed point; a null date is kept; unknown fields at every level are kept untouched",
    rNum.n === 2 && rNum.banner === "" && /paySites\.1/.test(rNum.fixed) && rNum.second && rNum.v.shiftTypes[0].flat === 1000 && rNum.v.shiftTypes[0].stipend === 0 && rNum.v.shiftTypes[0].stipendLabel === "" &&
    rNum.v.shiftTypes[0].callIn === null && rNum.v.shiftTypes[1].callIn.thresholdMinutes === 180 && rNum.v.label === undefined &&
    rOrig.n === 2 && rOrig.fixed === "" && rOrig.banner === "" && rOrig.v.effective === null &&
    rKeep.fixed === "" && rKeep.banner === "" && rKeep.v.extra.k === 1 && rKeep.v.shiftTypes[1].note === "x" && rKeep.v.shiftTypes[1].callIn.basis === "total",
    JSON.stringify({ num: rNum.v, fixed: rNum.fixed }));
  const repShift = (mut) => {
    const s = JSON.parse(JSON.stringify(TSHIFT)); mut(s);
    const st = seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: [JSON.parse(JSON.stringify(SX2))], payShifts: [s] });
    const real = sb.showDataAlert, seen = []; let fx;
    try { sb.showDataAlert = m => seen.push(m); fx = sb.repairData(st); } finally { sb.showDataAlert = real; }
    const j2 = JSON.stringify(st), fx2 = sb.repairData(st);
    return { n: st.payShifts.length, banner: seen.join(" | "), fixed: fx.join(","), s: st.payShifts[0], second: fx2.length === 0 && JSON.stringify(st) === j2 };
  };
  const SDROP = [["bad date", s => { s.date = "x"; }], ["bad type copy", s => { s.rates.shiftType.flat = -1; }], ["copy without a type", s => { delete s.rates.shiftType; s.rates.shiftTypes = TV.shiftTypes; }],
    ["callIns not a list", s => { s.callIns = 5; }], ["a non-whole minute", s => { s.callIns = [90.5]; }], ["a negative minute", s => { s.callIns = [-1]; }]];
  const badSDrop = SDROP.filter(t => { const r = repShift(t[1]); return !(r.n === 0 && r.banner.indexOf("Call pay shift " + (t[0] === "bad date" ? "x" : "2026-10-05") + " SX2 was unreadable and removed - please re-enter it.") !== -1); });
  const sFill = repShift(s => { delete s.callIns; s.rates.shiftType.flat = "100"; s.cases = "2"; }), sCases = repShift(s => { s.cases = "x"; }), sKeep = repShift(s => { s.extra = 1; s.rates.shiftType.callIn.basis = "each"; });
  check("typed shift repair: a bad date, type copy or call-in list drops the WHOLE shift with the banner (" + SDROP.length + " cases); missing callIns becomes [] and numeric text converts with a tag, no banner, then a fixed point; an unreadable case count alone goes with its notice; unknown fields kept",
    badSDrop.length === 0 && sFill.n === 1 && sFill.banner === "" && /payShifts\.1/.test(sFill.fixed) && sFill.second && JSON.stringify(sFill.s.callIns) === "[]" && sFill.s.rates.shiftType.flat === 100 && sFill.s.cases === 2 &&
    sCases.n === 1 && sCases.s.cases === undefined && /Case count for call shift 2026-10-05 SX2 was unreadable and removed/.test(sCases.banner) &&
    sKeep.fixed === "" && sKeep.s.extra === 1 && sKeep.s.rates.shiftType.callIn.basis === "each",
    badSDrop.map(t => t[0] + " -> " + JSON.stringify(repShift(t[1])).slice(0, 160)).join(" | "));
  check("validateData stays true for garbage typed data (repairData, not validateData, drops it - so a bad version or shift never sends the whole store to recovery)",
    sb.validateData(seedStore({ settings: { ratePerRVU: 55 }, paySites: [{ id: "g", name: "G", weekendDays: [], casesEarnRVU: true, rates: [{ id: "b", effective: "2026-10-01", shiftTypes: [{ key: "", hours: -1 }] }] }],
      payShifts: [{ id: "gs", date: "2026-10-05", rates: { shiftType: { key: "x" } }, callIns: "nope" }] })) === true);
  check("payHM / payFmtHM / payCiRowProblem: two boxes to whole minutes; one blank box is 0; both blank, a non-digit or minutes over 59 are refused with their codes",
    sb.payHM("2", "00") === 120 && sb.payHM("", "45") === 45 && sb.payHM("2", "") === 120 && sb.payHM(" 1 ", " 5 ") === 65 && sb.payHM("2", "60") === null && sb.payHM("x", "0") === null && sb.payHM("", "") === null && sb.payHM("1.5", "0") === null &&
    sb.payFmtHM(270) === "4:30" && sb.payFmtHM(0) === "0:00" && sb.payFmtHM(5) === "0:05" && sb.payFmtHM(1440) === "24:00" &&
    sb.payCiRowProblem({ h: "", m: "" }) === "ciBlank" && sb.payCiRowProblem({ h: "2", m: "" }) === "" && sb.payCiRowProblem({ h: "a", m: "0" }) === "ciBad" && sb.payCiRowProblem({ h: "1", m: "75" }) === "ciMin" && sb.payCiRowProblem(null) === "ciBlank");
  check("payMoney / payDateLabel / payVersionDateLabel / payTypePreview (made-up amounts)",
    sb.payMoney(2773.6) === "$2,773.60" && sb.payMoney(0) === "$0.00" && sb.payMoney(1234567.891) === "$1,234,567.89" && sb.payMoney("abc") === "" && sb.payMoney(16.005) === "$16.01" &&
    sb.payDateLabel("2026-10-01") === "Oct 1, 2026" && sb.payDateLabel("junk") === "" && sb.payVersionDateLabel({ effective: null }) === "Original" && sb.payVersionDateLabel({ effective: "2027-01-15" }) === "Jan 15, 2027" && sb.payVersionDateLabel(null) === "" &&
    sb.payTypePreview(TD) === "Day: $1,000.00" && sb.payTypePreview(TN) === "Night: $100.00 + $50.00/hr when in 3:00+" &&
    sb.payTypePreview(Object.assign({}, TN, { callIn: { hourly: 50, thresholdMinutes: 0 } })) === "Night: $100.00 + $50.00/hr" &&
    sb.payTypePreview(Object.assign({}, TD, { stipend: 500, stipendLabel: "Trauma" })) === "Day: $1,000.00 + $500.00 Trauma" &&
    sb.payTypePreview({ label: "Day", flat: "" }) === "Day: fill in the amounts" && sb.payTypePreview(null) === "Shift: fill in the amounts");
  const DEFT = { id: "site-made", name: "Made", weekendDays: [0, 6], casesEarnRVU: true, rates: [ORIG, TV, Object.assign({}, RA, { id: "later", effective: "2027-01-01" })] };
  check("payBuiltInVersion / payBuiltInFrom: the first DATED version (an Original is never it); payRateZero knows typed versions; payShiftCallInCount for both kinds",
    sb.payBuiltInVersion(DEFT) === TV && sb.payBuiltInFrom(DEFT) === "2026-10-01" && sb.payBuiltInFrom({ rates: [ORIG] }) === "" && sb.payBuiltInVersion(null) === null &&
    sb.payRateZero(TV) === false && sb.payRateZero({ shiftTypes: [{ key: "a", label: "A", hours: 1, flat: 0, stipend: 0, stipendLabel: "", callIn: null }] }) === true &&
    sb.payRateZero({ shiftTypes: [{ key: "a", label: "A", hours: 1, flat: 0, stipend: 0, stipendLabel: "", callIn: { hourly: 0, thresholdMinutes: 0 } }] }) === true &&
    sb.payRateZero({ shiftTypes: [{ key: "a", label: "A", hours: 1, flat: 0, stipend: 0, stipendLabel: "", callIn: { hourly: 1, thresholdMinutes: 0 } }] }) === false && sb.payRateZero({ shiftTypes: [] }) === false &&
    sb.payShiftCallInCount(TSHIFT) === 2 && sb.payShiftCallInCount(OSHIFT) === 0 && sb.payShiftCallInCount(mkShift("cc", S1, "2026-03-10", [dEv()])) === 1 && sb.payShiftCallInCount(null) === 0);
  const hand0 = (id, name, rates) => ({ id: id, name: name, weekendDays: [0, 6], casesEarnRVU: true, rates: rates });
  const propo = Object.assign({}, RA, { id: "prop", effective: "2026-10-01", label: "Proposal" });
  const seededLike = hand0("site-made", "Made", [propo]);
  const planA = sb.payTypedPlan(seededLike, DEFT, []), appliedA = sb.payApplyTyped(seededLike, DEFT, planA);
  const sepSite = hand0("m2", "Made", [Object.assign({}, RA, { id: "sep", effective: "2026-09-01" })]);
  const planB = sb.payTypedPlan(sepSite, DEFT, []), appliedB = sb.payApplyTyped(sepSite, DEFT, planB);
  const planC = sb.payTypedPlan(hand0("m3", "Made", [propo, Object.assign({}, RZ, { id: "z1", effective: "2026-11-01" }), Object.assign({}, RA, { id: "l1", effective: "2027-02-01" })]), DEFT, []);
  const NO_PLAN = [
    ["already typed", hand0("n1", "Made", [propo, TV])], ["has an Original", hand0("n2", "Made", [ORIG, propo])],
    ["two versions on the start", hand0("n3", "Made", [propo, Object.assign({}, RA, { id: "p2", effective: "2026-10-01" })])],
    ["no paying version in force", hand0("n4", "Made", [Object.assign({}, RZ, { id: "z0", effective: "2026-09-01" })])], ["no rates", hand0("n5", "Made", [])],
    ["in force starts later", hand0("n6", "Made", [Object.assign({}, RA, { id: "nov", effective: "2026-11-01" })])],
  ];
  const storeA = seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: [JSON.parse(JSON.stringify(appliedA))] }), jsonA = JSON.stringify(storeA), fxA = sb.repairData(storeA);
  check("payTypedPlan / payApplyTyped: the start-date version becomes the Original (values, id, label kept) and the typed version is appended (a fixed point; a second plan is null); an earlier version keeps its date (original ''); $0 versions from the start go and a later paying one is kept; a legacy def gives no plan; no plan for " + NO_PLAN.map(t => t[0]).join(", "),
    !!planA && planA.original === "prop" && planA.remove.length === 0 && planA.later === "" && appliedA.rates.length === 2 && appliedA.rates[0].effective === null && appliedA.rates[0].id === "prop" && appliedA.rates[0].label === "Proposal" && appliedA.rates[0].stipend === RA.stipend &&
    appliedA.rates[1].id === "tv" && JSON.stringify(appliedA.rates[1]) === JSON.stringify(TV) && appliedA.rates[1] !== TV && sb.payTypedPlan(appliedA, DEFT, []) === null && fxA.length === 0 && JSON.stringify(storeA) === jsonA &&
    JSON.stringify(seededLike.rates[0]) === JSON.stringify(propo) && appliedA.weekendDays === seededLike.weekendDays && appliedA.casesEarnRVU === seededLike.casesEarnRVU &&
    !!planB && planB.original === "" && appliedB.rates.length === 2 && appliedB.rates[0].effective === "2026-09-01" && appliedB.rates[1].id === "tv" && sb.rateInForce(appliedB, "2026-09-30").id === "sep" && sb.rateInForce(appliedB, "2026-10-01").id === "tv" &&
    !!planC && JSON.stringify(planC.remove) === JSON.stringify(["z1"]) && planC.later === "2027-02-01" && planC.original === "prop" &&
    NO_PLAN.every(t => sb.payTypedPlan(t[1], DEFT, []) === null) && sb.payTypedPlan(seededLike, { rates: [RA] }, []) === null && sb.payApplyTyped(seededLike, { rates: [RA] }, planA) === seededLike,
    JSON.stringify({ a: planA, b: planB, c: planC, no: NO_PLAN.map(t => sb.payTypedPlan(t[1], DEFT, [])) }));
  const jul = Object.assign({}, RA, { id: "jul", effective: "2026-07-01" }), siteJP = hand0("site-made", "Made", [jul, propo]);
  const legOct = mkShift("lg1", Object.assign({}, siteJP, { rates: [propo] }), "2026-10-10"), legSep = mkShift("lg2", Object.assign({}, siteJP, { rates: [jul] }), "2026-09-20");
  const planJP = sb.payTypedPlan(siteJP, DEFT, [legOct, legSep, TSHIFT]), appliedJP = sb.payApplyTyped(siteJP, DEFT, planJP);
  check("payTypedPlan.needType and the flag rule: a legacy shift at a CURRENT site whose version in force is typed needs a type; earlier dates, typed shifts, other sites, a deleted site and a site with no typed version never do; payNeedsTypeDelta lists only NEWLY flagged shifts",
    !!planJP && planJP.needType === 1 && planJP.original === "prop" &&
    sb.payShiftNeedsType(legOct, [appliedJP]) === true && sb.payShiftNeedsType(legSep, [appliedJP]) === false && sb.payShiftNeedsType(TSHIFT, [appliedJP]) === false &&
    sb.payShiftNeedsType(legOct, [siteJP]) === false && sb.payShiftNeedsType(legOct, []) === false && sb.payShiftNeedsType(legOct, [Object.assign({}, appliedJP, { id: "other" })]) === false &&
    sb.payShiftNeedsType(legOct, [Object.assign({}, appliedJP, { deleted: true })]) === false && sb.payShiftNeedsType(null, [appliedJP]) === false &&
    sb.payNeedsTypeCount([legOct, legSep, TSHIFT, Object.assign({}, legOct, { id: "lg3", date: "2026-12-01" })], [appliedJP]) === 2 && sb.payNeedsTypeCount([legOct], undefined) === 0 &&
    JSON.stringify(sb.payNeedsTypeDelta(siteJP, appliedJP.rates, [legOct, legSep])) === JSON.stringify({ count: 1, from: "2026-10-10", to: "2026-10-10" }) &&
    JSON.stringify(sb.payNeedsTypeDelta(appliedJP, appliedJP.rates, [legOct, legSep])) === JSON.stringify({ count: 0, from: "", to: "" }) &&
    JSON.stringify(sb.payNeedsTypeDelta(appliedJP, [jul, Object.assign({}, TV, { effective: "2026-09-01" })], [legOct, legSep])) === JSON.stringify({ count: 1, from: "2026-09-20", to: "2026-09-20" }),
    JSON.stringify({ plan: planJP }));
  // ---- Drafts and writers, feature step 2 (made-up amounts) ----
  const tdraft = (o) => Object.assign({ id: "td1", siteId: "sx2", date: "2026-10-05", callHours: "", hoursSet: false, note: "", events: [], types: ["night"], ciRows: [], id2: "td1-2", savedTrips: [] }, o || {});
  const ctxT = { shifts: [], today: "2026-12-31", sites: [SX2] };
  const codesT = r => r.problems.map(p => p.code + (p.block ? "!" : "") + (p.ev >= 0 ? "@" + p.ev : "") + (p.label ? "[" + p.label + "]" : "")).join(",");
  const bNight0 = sb.payShiftsFromDraft(tdraft(), SX2, null, ctxT), bNight1 = sb.payShiftsFromDraft(tdraft({ ciRows: [{ h: "2", m: "00" }] }), SX2, null, ctxT);
  const bNight3 = sb.payShiftsFromDraft(tdraft({ ciRows: [{ h: "1", m: "00" }, { h: "", m: "45" }, { h: "2", m: "" }] }), SX2, null, ctxT);
  const bDay = sb.payShiftsFromDraft(tdraft({ types: ["day"], ciRows: [{ h: "2", m: "00" }] }), SX2, null, ctxT);
  const legOrig = { id: "td1", date: "2026-10-05", siteId: "sx2", siteName: "SX2", callHours: 12, rates: Object.assign({}, ORIG), events: [], cases: 3, extra: { k: 1 } };
  const bBoth = sb.payShiftsFromDraft(tdraft({ types: ["night", "day"], ciRows: [{ h: "3", m: "30" }], note: " both " }), SX2, legOrig, ctxT);
  const bNone = sb.payShiftsFromDraft(tdraft({ types: [] }), SX2, null, ctxT), bMissing = sb.payShiftsFromDraft(tdraft({ types: ["holiday"] }), SX2, null, ctxT);
  const bBlank = sb.payShiftsFromDraft(tdraft({ ciRows: [{ h: "", m: "" }] }), SX2, null, ctxT), bBad = sb.payShiftsFromDraft(tdraft({ ciRows: [{ h: "x", m: "0" }] }), SX2, null, ctxT), bMin = sb.payShiftsFromDraft(tdraft({ ciRows: [{ h: "1", m: "75" }] }), SX2, null, ctxT);
  const bLong = sb.payShiftsFromDraft(tdraft({ ciRows: [{ h: "13", m: "00" }] }), SX2, null, ctxT), bFuture = sb.payShiftsFromDraft(tdraft(), SX2, null, { shifts: [], today: "2026-10-01", sites: [SX2] });
  check("payShiftsFromDraft typed: Night with 0 / 1 / 3 call-ins (one blank box = 0); a Day ignores the rows and saves callIns []; both types = two shifts (the first keeps orig id / cases / unknown fields, the second gets id2 and no cases; one whole-cent total; no legacy keys); no pick or a key the version lacks = noType with the 'Day or Night' label; ci rows block with their codes and row index; over the shift length warns; future warns",
    bNight0.shifts.length === 1 && JSON.stringify(bNight0.shifts[0].callIns) === "[]" && bNight0.total === 100 && bNight0.ratesFrom === "inForce" &&
    bNight1.shifts.length === 1 && JSON.stringify(bNight1.shifts[0].callIns) === "[120]" && bNight1.total === 100 &&
    bNight3.shifts.length === 1 && JSON.stringify(bNight3.shifts[0].callIns) === "[60,45,120]" && bNight3.total === 287.5 &&
    bDay.shifts.length === 1 && JSON.stringify(bDay.shifts[0].callIns) === "[]" && bDay.shifts[0].rates.shiftType.key === "day" && bDay.total === 1000 && !("callHours" in bDay.shifts[0]) && !("events" in bDay.shifts[0]) &&
    bBoth.shifts.length === 2 && bBoth.shifts[0].rates.shiftType.key === "day" && bBoth.shifts[0].id === "td1" && bBoth.shifts[0].cases === 3 && bBoth.shifts[0].extra.k === 1 && bBoth.shifts[0].note === "both" && JSON.stringify(bBoth.shifts[0].callIns) === "[]" &&
    bBoth.shifts[1].rates.shiftType.key === "night" && bBoth.shifts[1].id === "td1-2" && bBoth.shifts[1].cases === undefined && bBoth.shifts[1].extra === undefined && JSON.stringify(bBoth.shifts[1].callIns) === "[210]" && bBoth.total === 1275 &&
    !("callHours" in bBoth.shifts[0]) && !("events" in bBoth.shifts[0]) &&
    bNone.shifts.length === 0 && codesT(bNone) === "noType![Day or Night]" && bMissing.shifts.length === 0 && codesT(bMissing) === "noType![Day or Night]" &&
    codesT(bBlank) === "ciBlank!@0" && codesT(bBad) === "ciBad!@0" && codesT(bMin) === "ciMin!@0" && bLong.shifts.length === 1 && codesT(bLong) === "ciLong" && codesT(bFuture) === "future",
    JSON.stringify({ n3: bNight3.shifts[0] && bNight3.shifts[0].callIns, both: bBoth.shifts.map(s => s.id + ":" + s.rates.shiftType.key), total: bBoth.total, none: codesT(bNone), blank: codesT(bBlank) }));
  const tEdit = sb.payDraftFromShift(TSHIFT, SX2);
  const keptT = sb.payShiftsFromDraft(tEdit, SX2, TSHIFT, ctxT);
  const toDay = sb.payShiftsFromDraft(Object.assign({}, tEdit, { types: ["day"] }), SX2, TSHIFT, ctxT);
  const tlDraft = Object.assign({}, tEdit, { date: "2026-09-10" });
  const toLegacy = sb.payShiftsFromDraft(sb.payDraftRefresh(tlDraft, SX2, "", "", sb.payDraftRate(tlDraft, SX2, TSHIFT).rates), SX2, TSHIFT, ctxT);
  check("typed edits: payDraftFromShift picks the one type and rows the call-ins; an unchanged edit rebuilds the shift byte-identically from its kept copy; Night -> Day takes the version in force and saves callIns []; a date onto legacy rates saves a legacy shift (callIns gone, legacy keys present, id kept)",
    JSON.stringify(tEdit.types) === JSON.stringify(["night"]) && JSON.stringify(tEdit.ciRows) === JSON.stringify([{ h: "2", m: "00" }, { h: "0", m: "30" }]) && tEdit.id2 === "ts1-2" && tEdit.callHours === "" &&
    keptT.shifts.length === 1 && keptT.ratesFrom === "kept" && JSON.stringify(keptT.shifts[0]) === JSON.stringify(TSHIFT) &&
    toDay.shifts.length === 1 && toDay.ratesFrom === "inForce" && toDay.shifts[0].rates.shiftType.key === "day" && JSON.stringify(toDay.shifts[0].callIns) === "[]" && toDay.shifts[0].id === "ts1" &&
    toLegacy.shifts.length === 1 && !sb.payShiftIsTyped(toLegacy.shifts[0]) && toLegacy.shifts[0].callHours === 24 && JSON.stringify(toLegacy.shifts[0].events) === "[]" && !("callIns" in toLegacy.shifts[0]) && toLegacy.shifts[0].id === "ts1" && toLegacy.shifts[0].rates.effective === null,
    JSON.stringify({ kept: keptT.ratesFrom, keptEq: !!keptT.shifts[0] && JSON.stringify(keptT.shifts[0]) === JSON.stringify(TSHIFT), toLegacy: toLegacy.problems }));
  // A deleted site's stand-in (callpay.js siteFor) has no rates: the typed
  // shift's own copy stays the rate choice whatever is picked.
  const standT = { id: "sx2", name: "SX2", weekendDays: [], rates: [], deleted: true };
  const unpickedT = Object.assign({}, tEdit, { types: [] });
  const unpickedR = sb.payDraftRate(unpickedT, standT, TSHIFT), unpickedB = sb.payShiftsFromDraft(unpickedT, standT, TSHIFT, ctxT), repickedB = sb.payShiftsFromDraft(tEdit, standT, TSHIFT, ctxT);
  check("no typed version in force (a deleted site's stand-in, or a live site whose typed version is gone): a typed shift's kept copy is the rate choice whatever is picked - un-picking blocks with noType (never 'no rates'), re-picking rebuilds it byte-identically; at a live site with a typed version in force an un-pick falls to that version",
    unpickedR.from === "kept" && sb.payRateIsTyped(unpickedR.rates) && unpickedB.shifts.length === 0 && codesT(unpickedB) === "noType![Night]" &&
    repickedB.shifts.length === 1 && repickedB.ratesFrom === "kept" && JSON.stringify(repickedB.shifts[0]) === JSON.stringify(TSHIFT) &&
    sb.payDraftRate(unpickedT, Object.assign({}, SX2, { rates: [ORIG] }), TSHIFT).from === "kept" && sb.payRateIsTyped(sb.payDraftRate(unpickedT, Object.assign({}, SX2, { rates: [ORIG] }), TSHIFT).rates) &&
    sb.payDraftRate(unpickedT, SX2, TSHIFT).from === "inForce",
    JSON.stringify({ from: unpickedR.from, codes: codesT(unpickedB) }));
  const CONTRACT_T = [bNight0.shifts[0], bNight1.shifts[0], bNight3.shifts[0], bDay.shifts[0], bBoth.shifts[0], bBoth.shifts[1], toDay.shifts[0], toLegacy.shifts[0]];
  const storeT = seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: [JSON.parse(JSON.stringify(SX2))], payShifts: JSON.parse(JSON.stringify(CONTRACT_T)) });
  const beforeT = JSON.stringify(storeT.payShifts), fixedT = sb.repairData(storeT);
  check("CONTRACT: every typed / converted shift the form writes passes repairData unchanged", CONTRACT_T.every(Boolean) && JSON.stringify(storeT.payShifts) === beforeT && fixedT.length === 0, fixedT.join(","));
  const dayShift = bDay.shifts[0], nightShift = bNight1.shifts[0], flaggedSX = Object.assign({}, OSHIFT, { id: "fl", date: "2026-10-05" });
  const dctx = others => ({ shifts: others, today: "2026-12-31", sites: [SX2] });
  const pNightOnDay = sb.payShiftsFromDraft(tdraft({ id: "n2" }), SX2, null, dctx([dayShift])), pNightOnNight = sb.payShiftsFromDraft(tdraft({ id: "n3" }), SX2, null, dctx([nightShift]));
  const pOnFlagged = sb.payShiftsFromDraft(tdraft({ id: "n4" }), SX2, null, dctx([flaggedSX])), pSetFlagged = sb.payShiftsFromDraft(tdraft({ id: "fl", id2: "fl-2" }), SX2, flaggedSX, dctx([flaggedSX]));
  const pBothOnFlagged = sb.payShiftsFromDraft(tdraft({ id: "fl", id2: "fl-2", types: ["day", "night"] }), SX2, flaggedSX, dctx([flaggedSX]));
  check("duplicates: Day + Night on one date is no warning; Night + Night warns dupType (label Night); a typed shift on a date where a shift still needs a type warns dupFlagged; setting that flagged shift itself (one or both types) warns nothing",
    pNightOnDay.shifts.length === 1 && pNightOnDay.problems.length === 0 && codesT(pNightOnNight) === "dupType[Night]" && pNightOnNight.shifts.length === 1 &&
    codesT(pOnFlagged) === "dupFlagged[Day or Night]" && pSetFlagged.shifts.length === 1 && pSetFlagged.problems.length === 0 && pBothOnFlagged.shifts.length === 2 && pBothOnFlagged.problems.length === 0,
    JSON.stringify({ a: codesT(pNightOnDay), b: codesT(pNightOnNight), c: codesT(pOnFlagged), d: codesT(pSetFlagged), e: codesT(pBothOnFlagged) }));
  const pBothFuture = sb.payShiftsFromDraft(tdraft({ id: "n5", types: ["day", "night"] }), SX2, null, { shifts: [], today: "2026-10-01", sites: [SX2] });
  const pBothOnFlaggedNew = sb.payShiftsFromDraft(tdraft({ id: "n6", id2: "n6-2", types: ["day", "night"] }), SX2, null, dctx([flaggedSX]));
  const pBothOnBoth = sb.payShiftsFromDraft(tdraft({ id: "n7", id2: "n7-2", types: ["day", "night"] }), SX2, null, dctx([dayShift, nightShift]));
  check("a Day + Night pick reports each shift-level warning once (future, dupFlagged) while dupType stays per type",
    codesT(pBothFuture) === "future" && pBothFuture.shifts.length === 2 && codesT(pBothOnFlaggedNew) === "dupFlagged[Day or Night]" && pBothOnFlaggedNew.shifts.length === 2 && codesT(pBothOnBoth) === "dupType[Day],dupType[Night]",
    JSON.stringify({ f: codesT(pBothFuture), d: codesT(pBothOnFlaggedNew), t: codesT(pBothOnBoth) }));
  const TV27 = { id: "tv27", effective: "2027-01-01", shiftTypes: [TD, Object.assign({}, TN, { callIn: { hourly: 60, thresholdMinutes: 180 } })] };
  const SX27 = Object.assign({}, SX2, { rates: [ORIG, TV, TV27] });
  const n26 = tsh([270], TN, { id: "n26", date: "2026-10-12" }), n27 = tsh([270], TN, { id: "n27", date: "2027-01-08" }), d27 = tsh([], TD, { id: "d27", date: "2027-01-08" });
  const rp27 = sb.payRepriceShift(n27, SX27);
  const SXnoKey = Object.assign({}, SX2, { rates: [ORIG, TV, { id: "tvnk", effective: "2027-01-01", shiftTypes: [TD] }] });
  const rpStoreT = seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: [JSON.parse(JSON.stringify(SX27))], payShifts: [JSON.parse(JSON.stringify(rp27))] }), rpJT = JSON.stringify(rpStoreT), rpFxT = sb.repairData(rpStoreT);
  check("typed stale / re-price: a later typed version makes stale only the shifts it changes (the 2027 Night, not the 2026 Night or the 2027 Day); re-price copies the version's type (id, date and callIns kept) and passes repairData; a missing key, a legacy version in force or a legacy shift under a typed version is never stale; payTypeDiffer ignores label and hours",
    sb.payShiftStale(n27, SX27) === true && sb.payShiftStale(n26, SX27) === false && sb.payShiftStale(d27, SX27) === false && sb.payShiftStale(n27, SX2) === false &&
    !!rp27 && rp27.id === "n27" && rp27.rates.id === "tv27" && rp27.rates.shiftType.callIn.hourly === 60 && JSON.stringify(rp27.callIns) === "[270]" && sb.computeShiftPay(rp27).total === 370 && sb.computeShiftPay(n27).total === 325 &&
    rpFxT.length === 0 && JSON.stringify(rpStoreT) === rpJT && sb.payRepriceShift(n26, SX27) === null && sb.payShiftStale(n27, SXnoKey) === false && sb.payShiftStale(tsh([], TN, { date: "2026-09-10" }), SX2) === false &&
    sb.payShiftStale(Object.assign({}, OSHIFT, { date: "2026-10-10" }), SX2) === false &&
    sb.payTypeDiffer(TN, Object.assign({}, TN, { label: "Nite", hours: 10 })) === false && sb.payTypeDiffer(TN, Object.assign({}, TN, { flat: 101 })) === true && sb.payTypeDiffer(TN, Object.assign({}, TN, { callIn: null })) === true &&
    sb.payTypeDiffer(TN, Object.assign({}, TN, { callIn: { hourly: 50, thresholdMinutes: 120 } })) === true && sb.payTypeDiffer(TD, Object.assign({}, TD, { stipend: 1 })) === true && sb.payTypeDiffer(null, TD) === true,
    JSON.stringify({ rp27: rp27 && sb.computeShiftPay(rp27).total, n27: sb.computeShiftPay(n27).total, fx: rpFxT }));
  check("payRepriceSummary: typed count, legacy length change and moved call-ins, before / after cents over both kinds",
    JSON.stringify(sb.payRepriceSummary([{ before: n27, after: rp27 }, { before: base24, after: sb.payRepriceShift(base24, S1back) }])) === JSON.stringify({ lenChange: false, moved: 0, typed: 1, before: 132500, after: 277000 }) &&
    sb.payRepriceSummary([{ before: baseWd, after: sb.payRepriceShift(baseWd, S1back) }]).lenChange === true && sb.payRepriceSummary(null).before === 0,
    JSON.stringify(sb.payRepriceSummary([{ before: n27, after: rp27 }, { before: base24, after: sb.payRepriceShift(base24, S1back) }])));
  const flDraft = sb.payDraftFromShift(flaggedSX, SX2);
  const flWith = sb.payDraftFromShift(Object.assign({}, flaggedSX, { events: [{ date: "2026-10-05", cls: "wn", fee: true, hours: 2.5 }] }), SX2);
  const usedSaved = sb.payDraftUseSaved(flWith);
  check("flagged draft: nothing picked; savedTrips carry the legacy trips as whole minutes (2.5h = 150); payDraftUseSaved rows them (2 / 30) in a NEW draft; payDraftRate takes the typed version in force for a flagged legacy shift (never its kept copy) but keeps an unflagged legacy copy",
    JSON.stringify(flDraft.types) === "[]" && JSON.stringify(flDraft.savedTrips) === "[]" && JSON.stringify(flWith.savedTrips) === JSON.stringify([{ date: "2026-10-05", minutes: 150 }]) &&
    JSON.stringify(usedSaved.ciRows) === JSON.stringify([{ h: "2", m: "30" }]) && usedSaved !== flWith && JSON.stringify(flWith.ciRows) === "[]" &&
    sb.payDraftRate(flDraft, SX2, flaggedSX).from === "inForce" && sb.payRateIsTyped(sb.payDraftRate(flDraft, SX2, flaggedSX).rates) &&
    sb.payDraftRate(sb.payDraftFromShift(OSHIFT, SX2), SX2, OSHIFT).from === "kept");
  const typedChoice = sb.payDraftRate(tdraft(), SX2, null).rates;
  const reopenT = sb.payDraftReopenAsks(Object.assign({}, flWith, { events: [{ date: "2026-10-05", rel: "same", relSet: true, time: "", timeAuto: false, cls: "wd", clsSet: true, dn: "", fee: true, hours: "2" }] }), Object.assign({}, SX2, { weekendDays: [0, 1, 6] }), flaggedSX, "", "");
  const ucTyped = sb.payDraftUseCurrent(tdraft({ types: ["night"], ciRows: [{ h: "1", m: "00" }] }), SX2, TSHIFT, true);
  const refT = sb.payDraftRefresh(tdraft(), SX2, "", "", typedChoice);
  check("draft guards for a typed rate choice: payDraftReopenAsks is [] (even with a weekend Day pick in the legacy events); payDraftUseCurrent changes only reprice; payDraftRefresh leaves the legacy fields alone; payAsksDayNight and payMidnightAsks never ask; payDefaultShiftHours is null",
    JSON.stringify(reopenT) === "[]" && ucTyped.reprice === true && JSON.stringify(ucTyped.types) === JSON.stringify(["night"]) && JSON.stringify(ucTyped.ciRows) === JSON.stringify([{ h: "1", m: "00" }]) && ucTyped.callHours === "" &&
    refT.callHours === "" && JSON.stringify(refT.events) === "[]" && sb.payAsksDayNight("2026-10-07", SX2, typedChoice) === false && sb.payMidnightAsks("2026-10-09", SX2, typedChoice) === false && sb.payDefaultShiftHours("2026-10-10", SX2, typedChoice) === null);
  check("payDraftTypes: the picked keys the rate choice has, in version order; a key the version lacks drops out and the build then blocks with noType; payDraftId2 bumps past taken ids",
    JSON.stringify(sb.payDraftTypes({ types: ["night", "day"] }, TV)) === JSON.stringify(["day", "night"]) && JSON.stringify(sb.payDraftTypes({ types: ["holiday", "night"] }, TV)) === JSON.stringify(["night"]) &&
    JSON.stringify(sb.payDraftTypes({ types: ["night"] }, { id: "x", effective: "2026-10-01", shiftTypes: [TD] })) === "[]" && JSON.stringify(sb.payDraftTypes(null, TV)) === "[]" && JSON.stringify(sb.payDraftTypes({ types: ["night"] }, TSHIFT.rates)) === JSON.stringify(["night"]) &&
    codesT(sb.payShiftsFromDraft(tdraft({ types: ["night"] }), Object.assign({}, SX2, { rates: [ORIG, { id: "dayonly", effective: "2026-10-01", shiftTypes: [TD] }] }), null, ctxT)) === "noType![Day]" &&
    sb.payDraftId2("abc", [{ id: "abc-2" }, { id: "abc-3" }]) === "abc-4" && sb.payDraftId2("abc", []) === "abc-2");
  const FORM = sb.payTypedFormFromVersion(TV), tvJson = JSON.stringify(TV);
  const vOk = sb.payTypedVersionFromForm(FORM, "tv", SX2);
  const formWith = (patch, tpatch) => { const f = JSON.parse(JSON.stringify(FORM)); Object.assign(f, patch || {}); if (tpatch) Object.assign(f.types[tpatch[0]], tpatch[1]); return f; };
  const errOf = (f, id, site) => sb.payTypedVersionFromForm(f, id || "tv", site || SX2).errors.join(" | ");   // editing the version itself, so only the rule under test can fail
  const vParse = sb.payTypedVersionFromForm(formWith({ effective: "2027-03-01" }, [1, { flat: " 291.23 ", hourly: "2,773.60", thrH: "", thrM: "" }]), "new", SX2);
  // An edit keeps unknown fields on the version, a type and its callIn (the
  // decisions file's additive-field example); the form's own fields win.
  const vUnk = JSON.parse(JSON.stringify(TV)); vUnk.extra = { k: 1 }; vUnk.shiftTypes[1].note = "x"; vUnk.shiftTypes[1].callIn.basis = "total"; vUnk.label = "DN";
  const sxUnk = Object.assign({}, SX2, { rates: [ORIG, vUnk] });
  const vKeep = sb.payTypedVersionFromForm(sb.payTypedFormFromVersion(vUnk), "tv", sxUnk).version;
  const fRen = sb.payTypedFormFromVersion(vUnk); fRen.label = ""; Object.assign(fRen.types[1], { label: "Nights", hourly: "60" });
  const vRen = sb.payTypedVersionFromForm(fRen, "tv", sxUnk).version;
  const unkStore = seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: [Object.assign({}, sxUnk, { rates: [ORIG, vRen] })] }), unkJ = JSON.stringify(unkStore), unkFx = sb.repairData(unkStore);
  check("typed editor: an edit keeps unknown fields on the version, a type and its callIn (an untouched form round-trips byte-identically; a rename and a new $/hr keep them; a cleared label is removed); the result is a repairData fixed point",
    !!vKeep && JSON.stringify(vKeep) === JSON.stringify(vUnk) && vKeep.label === "DN" && !!vRen && vRen.extra.k === 1 && vRen.shiftTypes[1].note === "x" && vRen.shiftTypes[1].callIn.basis === "total" &&
    vRen.shiftTypes[1].label === "Nights" && vRen.shiftTypes[1].callIn.hourly === 60 && vRen.label === undefined && unkFx.length === 0 && JSON.stringify(unkStore) === unkJ,
    JSON.stringify({ keep: vKeep, ren: vRen, fx: unkFx }));
  const fromNew = sb.payNewTypedForm(TV);
  check("payTypedVersionFromForm: the version's own form round-trips to an identical version (a fixed point); one error per rule; ' 291.23 ' and '2,773.60' parse, a blank threshold is 0:00; '12abc', '-1' and a blank length are refused; payNewTypedForm keeps the keys, blanks the date and label and never mutates its source",
    !!vOk.version && JSON.stringify(vOk.version) === tvJson && vOk.errors.length === 0 &&
    errOf(formWith({ effective: "" })) === "Pick the date these rates start." && errOf(formWith({ effective: "2026-10-01" }), "new") === "Another version already starts on Oct 1, 2026 - edit that one instead." &&
    errOf(formWith({ effective: "", original: true })) === "This site already has Original rates - edit those instead." && errOf(formWith({ types: [] })) === "Add at least one shift type." &&
    errOf(formWith({}, [0, { label: " " }])) === "Name every shift type." && errOf(formWith({}, [0, { label: "night" }])) === "Two shift types are both named Night." &&
    errOf(formWith({}, [0, { hours: "" }])) === "Shift length must be more than 0 hours." && errOf(formWith({}, [0, { hours: "0" }])) === "Shift length must be more than 0 hours." &&
    errOf(formWith({}, [0, { flat: "12abc" }])) === "Fill every amount with a number (0 is allowed)." && errOf(formWith({}, [0, { flat: "-1" }])) === "Fill every amount with a number (0 is allowed)." &&
    errOf(formWith({}, [1, { hourly: "" }])) === "Fill every amount with a number (0 is allowed)." && errOf(formWith({}, [1, { thrM: "75" }])) === "Minutes must be 0 to 59." && errOf(formWith({}, [1, { thrH: "x" }])) === "Fill every amount with a number (0 is allowed)." &&
    !!vParse.version && vParse.version.shiftTypes[1].flat === 291.23 && vParse.version.shiftTypes[1].callIn.hourly === 2773.6 && vParse.version.shiftTypes[1].callIn.thresholdMinutes === 0 && vParse.version.effective === "2027-03-01" && vParse.version.id === "new" &&
    fromNew.effective === "" && fromNew.label === "" && fromNew.types.map(t => t.key).join() === "day,night" && fromNew.types[1].ci === true && fromNew.types[1].thrH === "3" && fromNew.types[1].thrM === "00" && JSON.stringify(TV) === tvJson &&
    sb.payTypeFromForm(fromNew.types[1]).callIn.thresholdMinutes === 180 && sb.payAmountText("2,773.60") === 2773.6 && sb.payAmountText("12abc") === null && sb.payAmountText(" 5 ") === 5 && sb.payBlankTypedForm().types.length === 1 && /^t-/.test(sb.payBlankTypedForm().types[0].key),
    JSON.stringify({ ok: vOk.errors, eq: !!vOk.version && JSON.stringify(vOk.version) === tvJson, dup: errOf(formWith({}, [0, { label: "night" }])), thr: errOf(formWith({}, [1, { thrM: "75" }])) }));
  // ---- The Day / Night / Other split, feature step 3 (made-up) ----
  const sDay = tsh([], TD, { id: "sp1", date: "2026-10-02" }), sN1 = tsh([120, 120], TN, { id: "sp2", date: "2026-10-03" }), sN2 = tsh([60], TN, { id: "sp3", date: "2026-10-04" });
  const sN3 = tsh([150], { key: "t-x", label: "night", hours: 12, flat: 100, stipend: 0, stipendLabel: "", callIn: { hourly: 50, thresholdMinutes: 120 } }, { id: "sp5", date: "2026-10-07" });
  const sHol = tsh([], { key: "t-h", label: "Holiday", hours: 12, flat: 500, stipend: 0, stipendLabel: "", callIn: null }, { id: "sp6", date: "2026-10-08" });
  const sOth = mkShift("sp7", S1, "2026-10-09");
  const SPL = [sDay, sN1, sN2, OSHIFT, flaggedSX, sN3, sHol, sOth], SITES_SP = [SX2, S1];
  const octR = sb.payTotalInRange(SPL, "2026-10-01", "2026-11-01", null, SITES_SP), yrR = sb.payTotalInRange(SPL, "2026-01-01", "2027-01-01", null, SITES_SP);
  const flOnly = sb.payTotalInRange(SPL, "2026-10-05", "2026-10-06", null, SITES_SP), legOnly = sb.payTotalInRange([sOth], "2026-10-01", "2026-11-01", null, SITES_SP), noSites = sb.payTotalInRange(SPL, "2026-10-01", "2026-11-01");
  const twoN = sb.payTotalInRange(SPL, "2026-10-03", "2026-10-05", null, SITES_SP);
  const splitOf = r => r.split.map(b => [b.key, b.label, b.shifts, b.total, b.callIns, b.inMin, b.ciShifts, b.metCount, b.threshold].join("|")).join(" ; ");
  check("payTotalInRange split: buckets by type (Day, Night, other types, then Other = legacy-priced), merged by label case-folded and named by the newest shift, adding up to the total to the cent; a flagged shift is only needsType; mixed thresholds give null; only-flagged = 0 shifts; legacy-only = no split; without sites nothing is flagged",
    octR.total === 3125 && octR.shifts === 6 && octR.needsType === 1 && octR.unpriced === 0 &&
    splitOf(octR) === "day|Day|1|1000|0|0|0|0| ; night|night|3|625|4|450|3|2| ; t-h|Holiday|1|500|0|0|0|0| ; |Other|1|1000|0|0|0|0|" &&
    octR.split.reduce((a, b) => a + Math.round(b.total * 100), 0) === Math.round(octR.total * 100) &&
    yrR.total === 4125 && yrR.shifts === 7 && yrR.split.filter(b => b.key === "")[0].shifts === 2 && yrR.split.filter(b => b.key === "")[0].total === 2000 &&
    flOnly.shifts === 0 && flOnly.total === 0 && flOnly.needsType === 1 && JSON.stringify(flOnly.split) === "[]" && JSON.stringify(legOnly.split) === "[]" && legOnly.total === 1000 &&
    noSites.needsType === 0 && noSites.shifts === 7 && noSites.total === 4125 && twoN.split[0].threshold === 180 && twoN.split[0].metCount === 1 && twoN.split[0].ciShifts === 2,
    JSON.stringify({ oct: splitOf(octR), tot: octR.total, two: splitOf(twoN) }));
  const mtS = sb.payMonthTotals(SPL, 2026, SITES_SP), octM = mtS.months.filter(m => m.key === "2026-10")[0], sepM = mtS.months.filter(m => m.key === "2026-09")[0];
  check("payMonthTotals: the year and each month carry split + needsType; a flagged shift stays in its month's list but out of its counts, total, call-ins and site rows",
    mtS.needsType === 1 && mtS.shifts === 7 && mtS.total === 4125 && splitOf(mtS) === splitOf(yrR) && !!octM && octM.shifts === 6 && octM.needsType === 1 && octM.list.length === 7 && octM.list.some(s => s.id === "fl") &&
    octM.total === 3125 && octM.callIns === 4 && splitOf(octM) === splitOf(octR) && octM.sites.every(st => st.shifts > 0) && !!sepM && sepM.split.length === 0 && sepM.needsType === 0 && sepM.shifts === 1,
    JSON.stringify({ y: splitOf(mtS), oct: octM && splitOf(octM), sites: octM && octM.sites }));
  const ds = vm.runInContext("defState()", sb), ds2 = vm.runInContext("defState()", sb);
  check("new installs start with the built-in sites + marker (fresh copies)", ds.paySites.length === 2 && ds.settings.paySitesSeeded === true && ds.paySites[0] !== ds2.paySites[0]);
  // "Use built-in rates" (R1): a phone whose own same-named sites lack paying
  // rates gets the preset version on a confirmed tap. Names come from the
  // preset at run time; other rates are the made-up RA (paying) / RZ ($0).
  // The built-in's start is its first DATED version (payBuiltInFrom /
  // payBuiltInVersion), never `rates[0]`: Davenport's rates[0] is its Original.
  const BI = vm.runInContext("DEFAULT_PAY_SITES", sb), B0 = BI[0], B1 = BI[1], FROM = sb.payBuiltInFrom(B0), B0V = sb.payBuiltInVersion(B0);
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
      JSON.stringify(sb.rateInForce(out, FROM)) === JSON.stringify(sb.payBuiltInVersion(t[2]));
    if (!ok) applyBad.push(t[0] + " " + JSON.stringify({ fx: fx, effs: effs, keptPaying: keptPaying }));
  });
  check("payBuiltInPlan: " + PLAN_SHAPES.length + " phone shapes (paying amounts never touched; $0 versions from the start removed)", planBad.length === 0, planBad.join(" | "));
  check("payApplyBuiltIn: repairData fixed point, second apply a no-op, no duplicate dates, paying versions + casesEarnRVU kept, preset in force from the start",
    applyBad.length === 0, applyBad.join(" | "));
  const idFree = hand(B0.id, B0.name, [Object.assign({}, RZ, { id: B0V.id, effective: "2026-11-01" })], B0.weekendDays.slice());
  const idFreeOut = sb.payApplyBuiltIn(idFree, B0, sb.payBuiltInPlan(idFree, B0));
  const idTaken = hand("s8", B0.name, [ver(RA, B0V.id, "2027-01-01")]);
  const idTakenOut = sb.payApplyBuiltIn(idTaken, B0, sb.payBuiltInPlan(idTaken, B0));
  check("payApplyBuiltIn rate ids: a removed $0 version frees the preset id; a taken id gets a new one",
    idFreeOut.rates.length === 1 && idFreeOut.rates[0].id === B0V.id && JSON.stringify(idFreeOut.rates[0]) === JSON.stringify(B0V) &&
    idTakenOut.rates.length === 2 && idTakenOut.rates[1].id !== B0V.id && idTakenOut.rates[1].id.indexOf(B0V.id + "-") === 0);
  const offerSites = [hand("s1", B0.name), hand("d9", B1.name + " East", [ver(RA, "v0", "2026-09-01")])];
  const offs = sb.payBuiltInOffers(offerSites);
  check("payBuiltInOffers: one offer per standing site without paying rates; a site with its own rates gets none",
    offs.length === 1 && offs[0].site === offerSites[0] && offs[0].def.id === B0.id && offs[0].by === "name" && sb.payBuiltInOffers([]).length === 0);
  // Filled hand-made sites must price the owner's examples exactly like the
  // preset: Silvis legacy as before; an empty Davenport takes ONLY the typed
  // Day/Night version (R1 adds payBuiltInVersion, never the Original).
  const fS = sb.payApplyBuiltIn(hand("s1", B0.name), B0, sb.payBuiltInPlan(hand("s1", B0.name), B0));
  const fD = sb.payApplyBuiltIn(hand("d1", B1.name), B1, sb.payBuiltInPlan(hand("d1", B1.name), B1));
  const viaFilled = [work(fS, "2026-10-13", 24, "2026-10-13", "21:00", 2.5), work(fS, "2026-10-16", 24, "2026-10-17", "01:00", 1.5), work(fS, "2026-11-26", 24, "2026-11-26", "14:00", 3)];
  check("filled hand-made sites: Silvis prices the owner's worked examples exactly like the preset; an empty Davenport gets only the typed Day/Night version",
    viaFilled.join(",") === WORKED.slice(0, 3).map(w => w[1]).join(",") && fD.rates.length === 1 && JSON.stringify(fD.rates[0]) === JSON.stringify(sb.payBuiltInVersion(B1)) && sb.payRateIsTyped(fD.rates[0]),
    viaFilled.join(",") + " / " + fD.rates.length);
  // ---- The preset's Day/Night figures (the owner's spec; the amounts are
  // public under CLAUDE.md's built-in exception). Hand-built typed shifts
  // priced from DAVT's own type copies; draft-built ones follow with the drafts. ----
  const DNV = sb.payBuiltInVersion(DAVT), DAY = sb.payTypeByKey(DNV, "day"), NIGHT = sb.payTypeByKey(DNV, "night");
  const dsh = (type, callIns, id, date) => ({ id: id || "dn-" + type.key + "-" + (callIns || []).join("-"), date: date || "2026-10-05", siteId: DAVT.id, siteName: DAVT.name, rates: { id: DNV.id, effective: DNV.effective, shiftType: JSON.parse(JSON.stringify(type)) }, callIns: callIns || [] });
  const dpay = (type, callIns) => { const p = sb.computeShiftPay(dsh(type, callIns)); return p ? p.total.toFixed(2) : "null"; };
  const dline = (callIns) => { const p = sb.computeShiftPay(dsh(NIGHT, callIns)); return p ? p.lines.map(l => l.kind + ":" + l.amount.toFixed(2)).join(" ") : "null"; };
  const DNFIG = [ // [label, got, want]
    ["Day", dpay(DAY, []), "2773.60"], ["Night, no call-in", dpay(NIGHT, []), "291.23"], ["Night 2:00", dpay(NIGHT, [120]), "291.23"], ["Night 2:59", dpay(NIGHT, [179]), "291.23"],
    ["Night 3:00", dpay(NIGHT, [180]), "1019.30"], ["Night 4:30", dpay(NIGHT, [270]), "1383.34"], ["Night 2:00 + 2:00", dpay(NIGHT, [120, 120]), "1261.99"], ["Night 3:00 + 2:00", dpay(NIGHT, [180, 120]), "1504.68"],
    ["Night 3:01", dpay(NIGHT, [181]), "1023.34"], ["Night 3:20 + 3:20", dpay(NIGHT, [200, 200]), "1909.16"], ["Night 3:30 + 1:00", dpay(NIGHT, [210, 60]), "1383.34"], ["Night 1:40 + 1:20", dpay(NIGHT, [100, 80]), "1019.30"],
    ["Night 4:30 lines", dline([270]), "flat:291.23 callIn:1092.11"], ["Night 2:59 lines", dline([179]), "flat:291.23 callIn:0.00"], ["Day lines", (sb.computeShiftPay(dsh(DAY, [])) || { lines: [] }).lines.map(l => l.kind).join(), "flat"],
  ];
  const badDn = DNFIG.filter(f => f[1] !== f[2]);
  const dayNight = sb.payTotalInRange([dsh(DAY, [], "d-a"), dsh(NIGHT, [], "d-b")], "2026-10-01", "2026-11-01");
  check("Davenport Day/Night figures (" + DNFIG.length + "): Day 2,773.60; Night 291.23 under 3:00, 1,019.30 at 3:00, 1,383.34 at 4:30, two 2:00 trips 1,261.99, 3:00 + 2:00 1,504.68; Day + quiet Night 3,064.83; never a stipend line",
    badDn.length === 0 && dayNight.total === 3064.83 && dayNight.shifts === 2 && [dsh(DAY, []), dsh(NIGHT, [270])].every(s => sb.computeShiftPay(s).lines.every(l => l.kind !== "stipend")),
    badDn.map(f => f[0] + " -> " + f[1] + " want " + f[2]).join("; ") + " | " + JSON.stringify(dayNight));
  // The same figures through the form's own writer (payShiftsFromDraft).
  const ddraft = (types, rows, date) => ({ id: "dd-" + types.join("") + "-" + (rows || []).map(r => r.h + r.m).join("_"), siteId: DAVT.id, date: date || "2026-10-05", callHours: "", hoursSet: false, note: "", events: [], types: types, ciRows: rows || [], id2: "", savedTrips: [] });
  const dtot = (types, rows, date) => { const b = sb.payShiftsFromDraft(ddraft(types, rows, date), DAVT, null, { shifts: [], today: "2026-12-31", sites: [DAVT] }); return b.shifts.length ? b.total.toFixed(2) : "blocked:" + b.problems.filter(p => p.block).map(p => p.code).join("+"); };
  const DNDRAFT = [
    ["Day 10-05", dtot(["day"], []), "2773.60"], ["Night, none", dtot(["night"], []), "291.23"], ["Night 2:00", dtot(["night"], [{ h: "2", m: "00" }]), "291.23"], ["Night 2:59", dtot(["night"], [{ h: "2", m: "59" }]), "291.23"],
    ["Night 3:00", dtot(["night"], [{ h: "3", m: "00" }]), "1019.30"], ["Night 4:30", dtot(["night"], [{ h: "4", m: "30" }]), "1383.34"], ["Night 2:00 + 2:00", dtot(["night"], [{ h: "2", m: "00" }, { h: "2", m: "00" }]), "1261.99"],
    ["Day + quiet Night", dtot(["day", "night"], []), "3064.83"], ["no type", dtot([], []), "blocked:noType"], ["a blank row", dtot(["night"], [{ h: "", m: "" }]), "blocked:ciBlank"], ["before Oct 1 = legacy rates (no hours yet)", dtot(["day"], [], "2026-09-30"), "blocked:hours"],
  ];
  const badDd = DNDRAFT.filter(f => f[1] !== f[2]);
  const bothDN = sb.payShiftsFromDraft(ddraft(["day", "night"], []), DAVT, null, { shifts: [], today: "2026-12-31", sites: [DAVT] });
  const dnStore = seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: sb.defaultPaySites(), payShifts: JSON.parse(JSON.stringify(bothDN.shifts.concat([sb.payShiftsFromDraft(ddraft(["night"], [{ h: "4", m: "30" }]), DAVT, null, null).shifts[0]]))) });
  const dnJ = JSON.stringify(dnStore), dnFx = sb.repairData(dnStore);
  check("Davenport through the form's writer (" + DNDRAFT.length + "): the spec figures to the cent; Day + Night = two shifts (ids id and id-2); no pick / a blank row / pre-Oct hours block; every written shift passes repairData unchanged; no stipend line anywhere",
    badDd.length === 0 && bothDN.shifts.length === 2 && bothDN.shifts[0].rates.shiftType.key === "day" && bothDN.shifts[1].rates.shiftType.key === "night" && bothDN.shifts[1].id === bothDN.shifts[0].id + "-2" &&
    dnFx.length === 0 && JSON.stringify(dnStore) === dnJ && dnStore.payShifts.every(s => sb.computeShiftPay(s).lines.every(l => l.kind !== "stipend")),
    badDd.map(f => f[0] + " -> " + f[1] + " want " + f[2]).join("; ") + " | " + dnFx.join(","));
  const DN27 = { id: "dn27", effective: "2027-01-01", shiftTypes: [DAY, Object.assign({}, NIGHT, { callIn: { hourly: 250, thresholdMinutes: 180 } })] };
  const DAVT27 = Object.assign({}, DAVT, { rates: DAVT.rates.concat([DN27]) });
  check("built-in Davenport: the Original (Proposal) before Oct 1 2026, the Day/Night version from Oct 1, a 2027 test version from its date; Silvis still none before Oct 1",
    sb.rateInForce(DAVT, "2026-09-30") === DAVT.rates[0] && DAVT.rates[0].effective === null && DAVT.rates[0].label === "Proposal" && !sb.payRateIsTyped(DAVT.rates[0]) &&
    sb.rateInForce(DAVT, "2026-10-01") === DNV && sb.rateInForce(DAVT, "2026-12-31") === DNV && sb.rateInForce(DAVT27, "2027-01-01") === DN27 && sb.rateInForce(DAVT27, "2026-12-31") === DNV &&
    sb.rateInForce(SIL, "2026-09-30") === null && sb.payBuiltInFrom(DAVT) === "2026-10-01" && sb.payBuiltInVersion(DAVT) === DNV && sb.payBuiltInFrom(SIL) === "2026-10-01");
  // The 2027 re-price through the preset (plan B10; figures preset-derived).
  const n27p = dsh(NIGHT, [270], "n27p", "2027-01-08"), rp27p = sb.payRepriceShift(n27p, DAVT27), n27q = dsh(NIGHT, [180], "n27q", "2027-01-08");
  check("Davenport 2027 re-price through the preset: only 2027 Nights are stale against a $250/hr version; 4:30 goes 1,383.34 -> 1,416.23 and 3:00 -> 1,041.23; deleting the version re-prices back to 1,383.34",
    sb.computeShiftPay(n27p).total === 1383.34 && sb.payShiftStale(n27p, DAVT27) === true && !!rp27p && rp27p.rates.id === "dn27" && sb.computeShiftPay(rp27p).total === 1416.23 &&
    sb.computeShiftPay(sb.payRepriceShift(n27q, DAVT27)).total === 1041.23 && !sb.payShiftStale(dsh(NIGHT, [270], "n26p", "2026-10-12"), DAVT27) && !sb.payShiftStale(dsh(DAY, [], "d27p", "2027-01-08"), DAVT27) &&
    sb.payShiftStale(rp27p, DAVT) === true && sb.computeShiftPay(sb.payRepriceShift(rp27p, DAVT)).total === 1383.34,
    JSON.stringify({ rp: rp27p && sb.computeShiftPay(rp27p).total, q: sb.computeShiftPay(sb.payRepriceShift(n27q, DAVT27) || n27q).total }));
  check("payTypePreview: the five pinned strings from the preset's types",
    sb.payTypePreview(DAY) === "Day: $2,773.60" && sb.payTypePreview(NIGHT) === "Night: $291.23 + $242.69/hr when in 3:00+" &&
    sb.payTypePreview(Object.assign({}, NIGHT, { callIn: { hourly: 242.69, thresholdMinutes: 0 } })) === "Night: $291.23 + $242.69/hr" &&
    sb.payTypePreview(Object.assign({}, DAY, { stipend: 500, stipendLabel: "Trauma" })) === "Day: $2,773.60 + $500.00 Trauma" &&
    sb.payTypePreview(Object.assign({}, DAY, { flat: "" })) === "Day: fill in the amounts");
  // The offer on a phone seeded from the OLD preset (Proposal dated Oct 1):
  // one tap gives exactly the new preset Davenport; a hand-made Jul 1 version
  // (the baseline phone) keeps its date; the seeded site gets no R1 offer.
  const oldDav = { id: DAVT.id, name: DAVT.name, weekendDays: DAVT.weekendDays.slice(), casesEarnRVU: DAVT.casesEarnRVU, rates: [Object.assign({}, DAVT.rates[0], { effective: "2026-10-01" })] };
  const octLeg = mkShift("ol1", oldDav, "2026-10-10"), octLeg2 = mkShift("ol2", oldDav, "2026-10-17"), sepLeg = mkShift("sl", Object.assign({}, oldDav, { rates: [Object.assign({}, oldDav.rates[0], { id: "jul", effective: "2026-07-01" })] }), "2026-09-19");
  const offs2 = sb.payTypedOffers([SIL, oldDav], [octLeg, octLeg2, sepLeg]);
  const tapped = offs2.length === 1 ? sb.payApplyTyped(oldDav, offs2[0].def, offs2[0].plan) : null;
  const julDav = Object.assign({}, oldDav, { rates: [Object.assign({}, oldDav.rates[0], { id: "jul", effective: "2026-07-01", label: "Made-up Jul", stipend: 3000 }), oldDav.rates[0]] });
  const julOff = sb.payTypedOffers([julDav], []), julTap = julOff.length === 1 ? sb.payApplyTyped(julDav, julOff[0].def, julOff[0].plan) : null;
  check("Use new Davenport rates: the old-preset Davenport is offered once (by id; original = Proposal; 2 shifts need a type) and the tap yields EXACTLY the new preset Davenport; no second offer; the seeded Davenport gets no R1 offer; a hand-made Jul 1 version keeps its date and still prices September",
    offs2.length === 1 && offs2[0].by === "id" && offs2[0].plan.original === DAVT.rates[0].id && offs2[0].plan.needType === 2 && !!tapped && JSON.stringify(tapped) === JSON.stringify(DAVT) &&
    sb.payTypedOffers([SIL, tapped], []).length === 0 && sb.payBuiltInOffers([SIL, tapped]).length === 0 && sb.payBuiltInOffers(sb.defaultPaySites()).length === 0 && sb.payTypedOffers(sb.defaultPaySites(), []).length === 0 &&
    !!julTap && julTap.rates.map(r => r.id).join() === "jul," + DAVT.rates[0].id + "," + DNV.id && julTap.rates[1].effective === null && sb.rateInForce(julTap, "2026-09-30").id === "jul" && sb.rateInForce(julTap, "2026-10-01").id === DNV.id &&
    sb.payNeedsTypeCount([octLeg, octLeg2, sepLeg], [tapped]) === 2 && sb.payNeedsTypeCount([octLeg, octLeg2, sepLeg], [oldDav]) === 0,
    JSON.stringify({ offs: offs2.map(o => o.plan), tappedEq: !!tapped && JSON.stringify(tapped) === JSON.stringify(DAVT), jul: julTap && julTap.rates.map(r => r.id + ":" + r.effective) }));
  const handDav = Object.assign({}, oldDav, { id: "h1" }), handDav2 = Object.assign({}, oldDav, { id: "h2", name: oldDav.name.toLowerCase() });
  check("Use new Davenport rates: one same-named hand-made site is offered by name; two same-named sites (ambiguous) get no offer",
    sb.payTypedOffers([SIL, handDav], []).length === 1 && sb.payTypedOffers([SIL, handDav], [])[0].by === "name" && sb.payTypedOffers([SIL, handDav, handDav2], []).length === 0);
  // Before and after the tap on a baseline-shaped phone (Jul 1 made-up +
  // Proposal Oct 1, Silvis): July, September and Silvis never change;
  // October loses exactly the two Davenport shifts that now need a type.
  const bShifts = [mkShift("b-jul", Object.assign({}, julDav, { rates: [julDav.rates[0]] }), "2026-07-15"), mkShift("b-sep", Object.assign({}, julDav, { rates: [julDav.rates[0]] }), "2026-09-19"),
    mkShift("b-o1", Object.assign({}, julDav, { rates: [julDav.rates[1]] }), "2026-10-10"), mkShift("b-o2", Object.assign({}, julDav, { rates: [julDav.rates[1]] }), "2026-10-17"), mkShift("b-sil", SIL, "2026-10-13")];
  const beforeSites = [SIL, julDav], afterSites = [SIL, julTap];
  const tot = (sites, from, to) => sb.payTotalInRange(bShifts, from, to, null, sites);
  const octB = tot(beforeSites, "2026-10-01", "2026-11-01"), octA = tot(afterSites, "2026-10-01", "2026-11-01");
  check("before and after the tap: July, September and Silvis totals identical; October differs by exactly the two flagged Davenport shifts (needsType 2, only Silvis in its split); payMonthTotals agrees",
    tot(beforeSites, "2026-07-01", "2026-08-01").total === tot(afterSites, "2026-07-01", "2026-08-01").total && tot(beforeSites, "2026-07-01", "2026-08-01").total === 3000 &&
    tot(beforeSites, "2026-09-01", "2026-10-01").total === tot(afterSites, "2026-09-01", "2026-10-01").total && octB.needsType === 0 && octA.needsType === 2 &&
    Math.round((octB.total - octA.total) * 100) === Math.round((sb.computeShiftPay(bShifts[2]).total + sb.computeShiftPay(bShifts[3]).total) * 100) &&
    octA.total === sb.computeShiftPay(bShifts[4]).total && octA.split.length === 1 && octA.split[0].key === "" && octA.split[0].shifts === 1 && octB.split.length === 0 &&
    sb.payMonthTotals(bShifts, 2026, afterSites).needsType === 2 && sb.payMonthTotals(bShifts, 2026, beforeSites).needsType === 0 && sb.payMonthTotals(bShifts, 2026, afterSites).total === tot(afterSites, "2026-01-01", "2027-01-01").total,
    JSON.stringify({ before: octB, after: octA }));
  // Setting one flagged shift (the form's path) prices it and lowers the count.
  const setO1 = sb.payShiftsFromDraft(Object.assign(sb.payDraftFromShift(bShifts[2], julTap), { types: ["night"], ciRows: [{ h: "4", m: "30" }] }), julTap, bShifts[2], { shifts: bShifts, today: "2026-12-31", sites: afterSites });
  const bAfterSet = bShifts.map(s => s.id === "b-o1" ? setO1.shifts[0] : s);
  check("setting a flagged shift to Night 4:30 prices it 1,383.34 under its own id and drops the needs-type count from 2 to 1 in both totals",
    setO1.shifts.length === 1 && setO1.shifts[0].id === "b-o1" && sb.computeShiftPay(setO1.shifts[0]).total === 1383.34 && setO1.problems.length === 0 &&
    sb.payTotalInRange(bAfterSet, "2026-10-01", "2026-11-01", null, afterSites).needsType === 1 && sb.payMonthTotals(bAfterSet, 2026, afterSites).needsType === 1 && sb.payNeedsTypeCount(bAfterSet, afterSites) === 1,
    JSON.stringify({ probs: setO1.problems, n: setO1.shifts.length }));
  // loadData over a mixed store (typed shifts, flagged legacy shifts, an
  // Original-priced shift, Silvis): no write, no banner, data untouched.
  {
    const realLS = sb.localStorage, realConsole = sb.console, realA = sb.showDataAlert;
    let okMixed = false, infoM = {};
    try {
      const mem = {}, writes = [], banners = [];
      sb.localStorage = { getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null), setItem: (k, v) => { writes.push(k); mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
      sb.console = { log: () => {}, warn: () => {}, error: () => {} };
      sb.showDataAlert = m => banners.push(String(m));
      const SKM = vm.runInContext("SK", sb);
      // julTap.rates[1] is the Proposal re-dated null: b-orig is priced from the Original.
      const mixed = seedStore({ settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: JSON.parse(JSON.stringify(afterSites)), payShifts: JSON.parse(JSON.stringify(bAfterSet.concat(bothDN.shifts, [mkShift("b-orig", Object.assign({}, julTap, { rates: [julTap.rates[1]] }), "2026-06-15")]))) });
      const mixedJ = JSON.stringify(mixed);
      mem[SKM] = mixedJ;
      const lm = sb.loadData();
      okMixed = writes.length === 0 && banners.length === 0 && JSON.stringify(lm.payShifts) === JSON.stringify(mixed.payShifts) && JSON.stringify(lm.paySites) === JSON.stringify(mixed.paySites) && mem[SKM] === mixedJ &&
        sb.payNeedsTypeCount(lm.payShifts, lm.paySites) === 1 && lm.payShifts.length === mixed.payShifts.length && mixed.payShifts.length === 8 &&
        mixed.payShifts.some(s => s.rates && s.rates.effective === null && !sb.payShiftIsTyped(s)) && mixed.payShifts.some(s => sb.payShiftIsTyped(s)) && new Set(mixed.payShifts.map(s => s.id)).size === mixed.payShifts.length;
      infoM = { writes: writes.length, banners: banners.length, n: lm.payShifts.length, want: mixed.payShifts.length };
    } finally { sb.localStorage = realLS; sb.console = realConsole; sb.showDataAlert = realA; }
    check("loadData over a mixed store (typed, flagged legacy, Original-priced, Silvis) writes nothing, shows no banner and returns it unchanged", okMixed, JSON.stringify(infoM));
  }
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
  // The shift editor's "Use current rates" (utils.js payDraftUseCurrent, then
  // the refresh callpay.js runs). Confirmed (reopen), it reaches the bulk
  // re-price + reclass result: the reopened Friday call-in (pinned as a
  // "pick" because the site's weekend days changed) becomes a weekend
  // call-in at the same pay. Declined, every pick is kept (new rates only).
  const viaUseCur = (shift, site, reopen) => {
    const dd = sb.payDraftUseCurrent(sb.payDraftFromShift(shift, site), site, shift, reopen);
    const nd = sb.payDraftRefresh(dd, site, "", "", sb.payDraftRate(dd, site, shift).rates);
    return sb.payShiftFromDraft(nd, site, shift).shift;
  };
  const friEd = viaUseCur(fri, zFilled, true), friKept = viaUseCur(fri, zFilled, false), friDefault = viaUseCur(fri, zFilled);
  const tlShift = mkShift("tz", zSite, "2026-10-09", [dEv({ date: "2026-10-09", time: "", cls: "wd", hours: "1" })]);
  const tlEd = viaUseCur(tlShift, zFilled, true), tlBulk = sb.payReclassShift(sb.payRepriceShift(tlShift, zFilled), OLD, NEW, FROM);
  // A next-day call-in: Thursday's shift, called in at 00:30 on Friday. Its
  // OWN date decides (a version using the shift date would keep it Night).
  const ndShift = mkShift("nz", zSite, "2026-10-01", [dEv({ date: "2026-10-02", time: "00:30", cls: "wn", hours: "1" })]);
  const ndEd = viaUseCur(ndShift, zFilled, true), ndBulk = sb.payReclassShift(sb.payRepriceShift(ndShift, zFilled), OLD, NEW, FROM);
  const reopened = sb.payDraftFromShift(fri, zFilled);
  check("payDraftUseCurrent: confirmed, Use current rates moves a Friday call-in (same-day, timeless, next-day) on a day Use built-in rates added to weekend, like the bulk re-price (same class, hours, rates, pay)",
    reopened.events[0].clsSet === true && !!friEd && friEd.events[0].cls === "we" && friEd.callHours === friFix.callHours &&
    JSON.stringify(friEd.rates) === JSON.stringify(friFix.rates) && sb.computeShiftPay(friEd).total === sb.computeShiftPay(friFix).total &&
    !!tlEd && tlEd.events[0].cls === "we" && !!tlBulk && tlBulk.events[0].cls === "we" && sb.computeShiftPay(tlEd).total === sb.computeShiftPay(tlBulk).total &&
    !!ndEd && ndEd.events[0].cls === "we" && ndEd.events[0].date === "2026-10-02" && !!ndBulk && sb.computeShiftPay(ndEd).total === sb.computeShiftPay(ndBulk).total &&
    JSON.stringify(fri) === friBefore,
    JSON.stringify({ clsSet: reopened.events[0].clsSet, ed: friEd && friEd.events[0].cls, edTotal: friEd && sb.computeShiftPay(friEd).total, bulk: sb.computeShiftPay(friFix).total,
      tl: tlEd && [tlEd.events[0].cls, sb.computeShiftPay(tlEd).total, tlBulk && sb.computeShiftPay(tlBulk).total], nd: ndEd && [ndEd.events[0].cls, sb.computeShiftPay(ndEd).total, ndBulk && sb.computeShiftPay(ndBulk).total] }));
  check("payDraftUseCurrent: declined (or not asked), the saved Day/Night pick stays and only the rates change",
    !!friKept && friKept.events[0].cls === "wn" && JSON.stringify(friKept.rates) === JSON.stringify(friFix.rates) &&
    !!friDefault && friDefault.events[0].cls === "wn" && sb.computeShiftPay(friKept).total === sb.computeShiftPay(friDefault).total && sb.computeShiftPay(friKept).total < sb.computeShiftPay(friEd).total,
    JSON.stringify({ kept: friKept && friKept.events[0].cls, def: friDefault && friDefault.events[0].cls }));
  const ucEv = (o) => Object.assign({ date: "2026-10-02", rel: "same", relSet: true, time: "21:00", timeAuto: false, cls: "wn", clsSet: true, dn: "", fee: true, hours: "2" }, o);
  const ucDr = (evs, date) => ({ id: "u", siteId: "sz", date: date || evs[0].date, callHours: "24", hoursSet: true, events: evs });
  const ucList = [ucEv({ date: "2026-10-08" }), ucEv({ date: "2026-12-25", cls: "wd", time: "10:00" }), ucEv({ date: "2026-10-03", cls: "we" }), ucEv({ clsSet: false }), ucEv({ cls: "hol" }), ucEv({}), ucEv({ date: "2026-10-02", time: "00:30" })];
  const ucPicks = sb.payDraftWeekendPicks(ucDr(ucList, "2026-10-01"), zFilled);
  const ucOn = sb.payDraftUseCurrent(ucDr(ucList, "2026-10-01"), zFilled, null, true).events.map(e => e.clsSet);
  const ucDraft = ucDr([ucEv({})]), ucDraftJson = JSON.stringify(ucDraft), ucRes = sb.payDraftUseCurrent(ucDraft, zFilled, null, true);
  check("payDraftWeekendPicks / payDraftUseCurrent: only Day/Night picks on a weekend day (by the call-in's own date) are listed and, confirmed, re-open; holidays, weekend, other days, automatic, deleted and site-less are kept; input never mutated",
    JSON.stringify(ucPicks) === "[5,6]" && JSON.stringify(ucOn) === JSON.stringify([true, true, true, false, true, false, false]) &&
    sb.payDraftWeekendPicks(ucDr([ucEv({})]), null).length === 0 && sb.payDraftWeekendPicks(ucDr([ucEv({})]), Object.assign({}, zFilled, { deleted: true })).length === 0 &&
    sb.payDraftUseCurrent(ucDr([ucEv({})]), zFilled, null, "yes").events[0].clsSet === true &&
    ucRes.reprice === true && ucRes.events[0].clsSet === false && JSON.stringify(ucDraft) === ucDraftJson && sb.payDraftUseCurrent(null, zFilled, null, true) === null,
    JSON.stringify({ picks: ucPicks, on: ucOn }));
  // Ask only when the answer changes the pay: Silvis pays a weekend call-in
  // more (asked); Davenport pays a Saturday night and a weekend call-in the
  // same (the pick stays silently - no pay question that changes nothing).
  const davSat = mkShift("ds", DAV, "2026-10-10", [dEv({ date: "2026-10-10", time: "21:00", cls: "wn", hours: "2" })]);
  const davDraft = sb.payDraftFromShift(davSat, DAV), friDraft = sb.payDraftFromShift(fri, zFilled), friDraftJson = JSON.stringify(friDraft);
  const askFri = sb.payDraftReopenAsks(friDraft, zFilled, fri, "", ""), askDav = sb.payDraftReopenAsks(davDraft, DAV, davSat, "", "");
  check("payDraftReopenAsks: asks only when re-opening changes the pay (Silvis Friday yes, Davenport Saturday night vs weekend no); input never mutated",
    JSON.stringify(askFri) === "[0]" && sb.payDraftWeekendPicks(davDraft, DAV).length === 1 && askDav.length === 0 &&
    sb.payDraftReopenAsks(ucDr([ucEv({ date: "2026-10-08" })]), zFilled, null, "", "").length === 0 && JSON.stringify(friDraft) === friDraftJson,
    JSON.stringify({ fri: askFri, dav: askDav }));
  // callpay.js holds no second copy of the rule (AST, so a comment or a
  // string cannot satisfy it): inside useCurrentRates, picks comes from
  // payDraftReopenAsks, reopen is exactly `picks.length > 0 && confirm(...)`
  // with confirm() run in the tap itself (not inside a nested function such
  // as the setD updater), and payDraftUseCurrent - called once in the file -
  // gets that reopen inside the setD updater. callpay.js never writes a
  // reprice flag itself.
  {
    const cpSrc = fs.readFileSync(path.join(JS_DIR, "callpay.js"), "utf8");
    const cpAst = parser.parse(cpSrc, { sourceType: "script", plugins: ["jsx"] });
    const calls = name => { const out = []; walk(cpAst.program, n => { if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === name) out.push(n); }); return out; };
    let ucFn = null;
    walk(cpAst.program, n => { if (n.type === "VariableDeclarator" && n.id.name === "useCurrentRates") ucFn = n.init; });
    const within = (n, outer) => !!outer && n.start >= outer.start && n.end <= outer.end;
    const nested = [];
    if (ucFn) walk(ucFn.body, n => { if (n.type === "FunctionExpression" || n.type === "ArrowFunctionExpression") nested.push(n); });
    const decl = name => { let d = null; if (ucFn) walk(ucFn.body, n => { if (n.type === "VariableDeclarator" && n.id.name === name) d = n.init; }); return d; };
    const picksInit = decl("picks"), reopenInit = decl("reopen");
    const confirmOk = !!reopenInit && reopenInit.type === "LogicalExpression" && reopenInit.operator === "&&" &&
      reopenInit.left.type === "BinaryExpression" && reopenInit.left.operator === ">" && reopenInit.left.left.type === "MemberExpression" &&
      reopenInit.left.left.object.name === "picks" && reopenInit.left.left.property.name === "length" && reopenInit.left.right.value === 0 &&
      reopenInit.right.type === "CallExpression" && reopenInit.right.callee.name === "confirm" && !nested.some(f => within(reopenInit.right, f));
    const useCalls = calls("payDraftUseCurrent"), setDs = calls("setD").filter(c => within(c, ucFn));
    const useOk = useCalls.length === 1 && setDs.length === 1 && setDs[0].arguments[0] && /Function/.test(setDs[0].arguments[0].type) && within(useCalls[0], setDs[0].arguments[0]) &&
      useCalls[0].arguments[3] && useCalls[0].arguments[3].type === "Identifier" && useCalls[0].arguments[3].name === "reopen";
    const asksOk = !!picksInit && picksInit.type === "CallExpression" && picksInit.callee.name === "payDraftReopenAsks" && calls("payDraftWeekendPicks").length === 0;
    let repriceWrites = 0;
    walk(cpAst.program, n => { if ((n.type === "ObjectProperty" && ((n.key.name || n.key.value) === "reprice")) || (n.type === "AssignmentExpression" && n.left.type === "MemberExpression" && n.left.property.name === "reprice")) repriceWrites++; });
    check("callpay.js Use current rates: picks from payDraftReopenAsks, reopen = picks.length > 0 && confirm(...) in the tap, payDraftUseCurrent(..., reopen) in the setD updater, no reprice writes",
      !!ucFn && asksOk && confirmOk && useOk && calls("confirm").filter(c => within(c, ucFn)).length === 1 && repriceWrites === 0,
      JSON.stringify({ uc: !!ucFn, asks: asksOk, confirm: confirmOk, use: useOk, repriceWrites: repriceWrites }));
  }
  // ---- Day/Night feature gates (plan (e); AST where it matters) ----
  // The Babel views may READ a typed shift or version, but the math and the
  // typed keys belong to utils.js, so an older or newer build never meets a
  // shape utils.js did not write.
  {
    const PLAIN_SET = ["crypto.js", "cpt-data.js", "utils.js", "styles.js"]; // index.html's plain array (pinned in 4c)
    const RULE_FILES = jsFiles.filter(f => PLAIN_SET.indexOf(f) === -1);
    const srcOf = {}, astOf = {};
    jsFiles.forEach(f => { if (f === "cpt-data.js") return; srcOf[f] = fs.readFileSync(path.join(JS_DIR, f), "utf8"); try { astOf[f] = parser.parse(srcOf[f], AST_OPTS); } catch (e) { astOf[f] = null; } });
    const prop = n => !n || n.type !== "MemberExpression" || !n.property ? "" : !n.computed ? n.property.name : n.property.type === "StringLiteral" ? n.property.value : "";
    const within2 = (n, outer) => !!outer && n.start >= outer.start && n.end <= outer.end;
    // (1) call-in math only in utils.js: outside it no * or / touches a rate
    // amount or a minutes field, and nothing multiplies or divides by 60
    // (payCallInSummary is the ONE rule; payHM reads the boxes).
    const RATE_PROPS = ["hourly", "flat", "stipend", "thresholdMinutes", "paidMinutes", "minutes", "inMin", "callIns"];
    const is60 = n => n && n.type === "NumericLiteral" && n.value === 60;
    // An operand may hide behind wrappers - (x || 0), a ? b : c, Number(x),
    // Math.round(x), String(x), !x, nested arithmetic: look through them.
    const unwrapOp = (n, test) => {
      for (;;) {
        if (!n) return false;
        if (test(n)) return true;
        if (n.type === "LogicalExpression" || n.type === "BinaryExpression") return unwrapOp(n.left, test) || unwrapOp(n.right, test);
        if (n.type === "ConditionalExpression") return unwrapOp(n.consequent, test) || unwrapOp(n.alternate, test);
        if (n.type === "UnaryExpression") { n = n.argument; continue; }
        if (n.type === "ParenthesizedExpression") { n = n.expression; continue; }
        if (n.type === "SequenceExpression") { n = n.expressions[n.expressions.length - 1]; continue; }
        if (n.type === "CallExpression" && n.arguments.length) {
          if (n.callee.type === "MemberExpression" && n.callee.object.type === "Identifier" && n.callee.object.name === "Math") return n.arguments.some(a => unwrapOp(a, test));
          if (n.callee.type === "Identifier" && /^(Number|parseFloat|parseInt|String|round2)$/.test(n.callee.name)) { n = n.arguments[0]; continue; }
        }
        return false;
      }
    };
    // A file's plain aliases of such an operand (`var hr = t.hourly;`) count as the operand.
    const aliasesOf = (ast, test) => { const s = {}; walk(ast.program, n => { if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && n.init && unwrapOp(n.init, test)) s[n.id.name] = true; }); return s; };
    const isRateOperand = n => (n.type === "MemberExpression" && RATE_PROPS.indexOf(prop(n)) !== -1) || is60(n);
    const rateMathHits = ast => {
      const al = aliasesOf(ast, isRateOperand), test = n => isRateOperand(n) || (n.type === "Identifier" && al[n.name] === true), hits = [];
      walk(ast.program, n => {
        if (((n.type === "BinaryExpression" && (n.operator === "*" || n.operator === "/")) || (n.type === "AssignmentExpression" && (n.operator === "*=" || n.operator === "/="))) &&
            (unwrapOp(n.left, test) || unwrapOp(n.right, test))) hits.push(n.loc.start.line);
      });
      return hits;
    };
    const mathHits = [];
    // directorships.js is out of scope: its time entries have their own
    // `minutes` and hours x 60 (time sheets, not call pay; pinned by its own
    // tests). Every other Babel file is held to the rule.
    RULE_FILES.filter(f => f !== "directorships.js").forEach(f => { if (!astOf[f]) return; rateMathHits(astOf[f]).forEach(l => mathHits.push(f + ":" + l)); });
    // The gate's own self-test: wrapped, compound-assigned and aliased forms are caught, plain counts are not.
    const mathSelf = [["var a = r.hourly * 2;", 1], ["var a = Number(r.hourly) * h;", 1], ["var a = (t.minutes || 0) / 30;", 1], ["var a = Math.round(t.callIn.hourly * 100) / 100;", 2], ["var a = (c ? t.flat : 0) * 2;", 1], ["var a = h * 60;", 1],
      ["var a = Math.max(0, t.minutes) / 30;", 1], ["x.hourly *= 2;", 1], ["var hr = t.hourly; var a = hr * h;", 1], ["var m = t.callIn.thresholdMinutes; var a = m / 30;", 1], ["var a = n.shifts * 2 + sum.before / 100;", 0], ["var a = l.hours / r.stipendHours;", 0]]
      .filter(c => rateMathHits(parser.parse(c[0], AST_OPTS)).length !== c[1]);
    check("Day/Night gate self-test: the call-in math gate sees through wrappers (Number, Math.* in any argument, || 0, ternaries), *= and /=, and same-file aliases, and ignores plain counts", mathSelf.length === 0, mathSelf.map(c => c[0]).join(" ; "));
    check("Day/Night gate: call-in math only in utils.js (no * or / on a rate amount or minutes field, no x60 or /60, outside utils.js)", mathHits.length === 0, mathHits.join(", "));
    // (2) the shiftType and callIns keys are written only in utils.js: no
    // object key, member assignment or delete of either in a Babel file.
    const TYPED_KEYS = ["shiftType", "callIns"];
    const keyName = k => !k ? "" : k.type === "Identifier" ? k.name : k.type === "StringLiteral" ? k.value : "";
    const keyHits = [];
    RULE_FILES.forEach(f => { if (!astOf[f]) return; walk(astOf[f].program, n => {
      if (n.type === "ObjectProperty" && TYPED_KEYS.indexOf(keyName(n.key)) !== -1) keyHits.push(f + ":" + n.loc.start.line);
      if (n.type === "AssignmentExpression" && TYPED_KEYS.indexOf(prop(n.left)) !== -1) keyHits.push(f + ":" + n.loc.start.line);
      if (n.type === "UnaryExpression" && n.operator === "delete" && TYPED_KEYS.indexOf(prop(n.argument)) !== -1) keyHits.push(f + ":" + n.loc.start.line);
    }); });
    check("Day/Night gate: the shiftType and callIns keys are written only in utils.js", keyHits.length === 0, keyHits.join(", "));
    // (3) only utils.js calls showDataAlert (repairData's one banner).
    const alertHits = [];
    // Any mention (a call, an alias, a member) counts, so no file can smuggle a reference.
    RULE_FILES.forEach(f => { if (!astOf[f]) return; walk(astOf[f].program, n => { if ((n.type === "Identifier" && n.name === "showDataAlert") || (n.type === "MemberExpression" && prop(n) === "showDataAlert")) alertHits.push(f + ":" + n.loc.start.line); }); });
    check("Day/Night gate: only utils.js calls (or even names) showDataAlert", alertHits.length === 0, alertHits.join(", "));
    // (4) no `.rates[0]` outside utils.js: a built-in's first DATED version
    // is payBuiltInVersion / payBuiltInFrom (the Original now sits first).
    const r0 = RULE_FILES.filter(f => /\.rates\s*\[\s*0\s*\]/.test(srcOf[f] || ""));
    check("Day/Night gate: no `.rates[0]` outside utils.js", r0.length === 0, r0.join(", "));
    // (5) callpay.js: rateSummary (legacy words) is called exactly once, as
    // the legacy branch of versionSummary's `payRateIsTyped(v) ? ... : rateSummary(v)`.
    const cpAst2 = astOf["callpay.js"];
    let vsInit = null, condOk = false; const rsCalls = [];
    if (cpAst2) walk(cpAst2.program, n => {
      if (n.type === "VariableDeclarator" && n.id.type === "Identifier" && n.id.name === "versionSummary") vsInit = n.init;
      if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "rateSummary") rsCalls.push(n);
    });
    if (vsInit) walk(vsInit, n => { if (n.type === "ConditionalExpression" && n.test.type === "CallExpression" && n.test.callee.name === "payRateIsTyped" && n.alternate.type === "CallExpression" && n.alternate.callee.name === "rateSummary") condOk = true; });
    check("Day/Night gate: callpay.js calls rateSummary once, on the legacy branch of versionSummary", !!vsInit && condOk && rsCalls.length === 1 && within2(rsCalls[0], vsInit), JSON.stringify({ vs: !!vsInit, cond: condOk, calls: rsCalls.length }));
    // (6) dashboard.js: payTotalInRange gets data.paySites (a flagged shift is
    // counted, never guessed) and BOTH call-pay render gates read
    // callPay.needsType in an || with callPay.shifts, so the Home line still
    // renders when a flagged shift is the only one in the window.
    let dGates = 0, dSites = false;
    const gt0 = (x, name) => x.type === "BinaryExpression" && x.operator === ">" && x.left.type === "MemberExpression" && x.left.object.type === "Identifier" && x.left.object.name === "callPay" && prop(x.left) === name && x.right.type === "NumericLiteral" && x.right.value === 0;
    const orLeaves = x => x.type === "LogicalExpression" && x.operator === "||" ? orLeaves(x.left).concat(orLeaves(x.right)) : [x];
    if (astOf["dashboard.js"]) walk(astOf["dashboard.js"].program, n => {
      // A JSX render gate `{(... callPay.shifts > 0 || callPay.needsType > 0 ...) && <div>}`: one || chain holds both tests.
      if (n.type === "JSXExpressionContainer" && n.expression && n.expression.type === "LogicalExpression" && n.expression.operator === "&&") {
        let ok = false;
        walk(n.expression.left, m => { if (m.type === "LogicalExpression" && m.operator === "||") { const l = orLeaves(m); if (l.some(x => gt0(x, "shifts")) && l.some(x => gt0(x, "needsType"))) ok = true; } });
        if (ok) dGates++;
      }
      if (n.type === "CallExpression" && n.callee.type === "Identifier" && n.callee.name === "payTotalInRange" && n.arguments.length === 5 && n.arguments[4].type === "MemberExpression" && n.arguments[4].object.type === "Identifier" && n.arguments[4].object.name === "data" && prop(n.arguments[4]) === "paySites") dSites = true;
    });
    check("Day/Night gate: dashboard.js passes data.paySites to payTotalInRange and both call-pay render gates are `callPay.shifts > 0 || callPay.needsType > 0`", dGates === 2 && dSites, JSON.stringify({ gates: dGates, sites: dSites }));
    // (7) every order compare of `effective` goes through payEffKey (a null
    // date, the Original, sorts before any string only there).
    const effHits = [], isEff = m => m.type === "MemberExpression" && prop(m) === "effective";
    Object.keys(astOf).forEach(f => { if (!astOf[f]) return;
      const al = aliasesOf(astOf[f], isEff), test = m => isEff(m) || (m.type === "Identifier" && al[m.name] === true);
      walkStack(srcOf[f], (n, stack) => {
        if (inTopFn(stack, f, ["payEffKey"])) return;
        if (n.type === "BinaryExpression" && ["<", ">", "<=", ">="].indexOf(n.operator) !== -1 && (unwrapOp(n.left, test) || unwrapOp(n.right, test))) effHits.push(f + ":" + n.loc.start.line);
        // localeCompare is an order compare too (and throws on the Original's null).
        if (n.type === "CallExpression" && n.callee.type === "MemberExpression" && prop(n.callee) === "localeCompare" && (unwrapOp(n.callee.object, test) || (n.arguments[0] && unwrapOp(n.arguments[0], test)))) effHits.push(f + ":" + n.loc.start.line);
      });
    });
    check("Day/Night gate: every order compare of `effective` (direct, wrapped, aliased or localeCompare) goes through payEffKey", effHits.length === 0, effHits.join(", "));
    // (8) the EYES counts above are unchanged by this work (pinned in 5f).
    check("payBucketInLine: the shared time-in words; mixed thresholds name none; null is empty",
      sb.payBucketInLine({ inMin: 1139, threshold: 180, metCount: 3, ciShifts: 8 }) === "18:59 in \u00B7 3:00+ on 3 of 8" &&
      sb.payBucketInLine({ inMin: 150, threshold: null, metCount: 1, ciShifts: 2 }) === "2:30 in \u00B7 met the threshold on 1 of 2" &&
      sb.payBucketInLine({ inMin: 0, threshold: 0, metCount: 1, ciShifts: 1 }) === "0:00 in \u00B7 0:00+ on 1 of 1" && sb.payBucketInLine(null) === "",
      JSON.stringify([sb.payBucketInLine({ inMin: 1139, threshold: 180, metCount: 3, ciShifts: 8 }), sb.payBucketInLine({ inMin: 150, threshold: null, metCount: 1, ciShifts: 2 })]));
  }
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
  // len: a shift length the user picked (else the form's default for the day).
  const sflow = (site, date, trips, len) => {
    let d = { id: "f-" + date, siteId: site.id, date: date, callHours: len || "", hoursSet: !!len, events: [], note: "" };
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
    ["Davenport Sat, 12h shift picked, 4h", sflow(DAV, "2026-10-17", [{ hours: "4" }], "12"), "4451.54"],
    ["Davenport Christmas, 12h shift picked, 2h", sflow(DAV, "2026-12-25", [{ hours: "2" }], "12"), "4208.85"],
    ["Davenport Sat, default 24h shift, 4h", sflow(DAV, "2026-10-17", [{ hours: "4" }]), "7641.19"],
    ["Davenport Christmas, default 24h shift, 2h", sflow(DAV, "2026-12-25", [{ hours: "2" }]), "7398.50"],
    ["Davenport Sun, default 24h shift, did not go in", sflow(DAV, "2026-10-18", []), "6379.30"],
    ["Davenport Thanksgiving (a Thursday), default 24h shift", sflow(DAV, "2026-11-26", []), "6379.30"],
    ["Davenport Wed, 24h shift picked, did not go in", sflow(DAV, "2026-10-14", [], "24"), "6379.30"],
    ["Silvis Sat, default stays its 24h shift", sflow(SIL, "2026-10-17", []), "1500.00"],
    ["Davenport weekday, Day/Night unanswered", sflow(DAV, "2026-10-14", [{ hours: "1" }]), "blocked:evCls"],
    ["Davenport two 1h trips at night", sflow(DAV, "2026-10-14", [{ hours: "1", dn: "wn" }, { hours: "1", dn: "wn" }]), "5228.05"],
  ];
  const badFlows = FLOWS.filter(f => f[1] !== f[2]);
  check("simple form flows on the built-in sites (" + FLOWS.length + ": the owner's examples, no call-in, questions blocking until answered, 24h weekend/holiday shifts)",
    badFlows.length === 0, badFlows.map(f => f[0] + " -> " + f[1] + " want " + f[2]).join("; "));
  // 24h weekend/holiday shifts (owner 2026-10-13): where the stipend period is
  // shorter, a weekend day or holiday starts at 24h; up to 24h is no warning.
  const DEFH = [ // [site, date, want]
    [DAV, "2026-10-17", 24], [DAV, "2026-10-18", 24], [DAV, "2026-12-25", 24], [DAV, "2026-11-26", 24], [DAV, "2026-12-24", 24],
    [DAV, "2026-10-14", 12], [DAV, "2026-10-16", 12], [DAV, "", 12], [SIL, "2026-10-17", 24], [SIL, "2026-10-14", 24],
  ];
  const badDefH = DEFH.filter(t => sb.payDefaultShiftHours(t[1], t[0], rif(t[0], "2026-10-14")) !== t[2]);
  const ghost = { id: DAV.id, name: DAV.name, weekendDays: [], rates: [], deleted: true };
  const warnAt = (h) => sb.payShiftFromDraft({ id: "w", siteId: DAV.id, date: "2026-10-14", callHours: String(h), events: [] }, DAV, null).problems.map(p => p.code).indexOf("overLength") !== -1;
  const S36 = hand("s36", "Long", [Object.assign({}, rif(DAV, "2026-10-14"), { id: "r36", stipendHours: 36 })]);
  const warn36 = (h) => sb.payShiftFromDraft({ id: "w", siteId: S36.id, date: "2026-10-14", callHours: String(h), events: [] }, S36, null).problems.map(p => p.code).indexOf("overLength") !== -1;
  check("payDefaultShiftHours: 24h on a weekend day or holiday where the stipend period is shorter, else the stipend period; a deleted site counts holidays only; over-length warns only past 24h",
    badDefH.length === 0 && sb.payDefaultShiftHours("2026-10-17", ghost, rif(DAV, "2026-10-17")) === 12 && sb.payDefaultShiftHours("2026-12-25", ghost, rif(DAV, "2026-12-25")) === 24 &&
    sb.payDefaultShiftHours("2026-10-17", DAV, null) === null && sb.payDefaultShiftHours("2026-10-17", DAV, { stipendHours: 0 }) === null &&
    sb.payDefaultShiftHours("2026-10-17", DAV, { stipendHours: 36 }) === 36 && sb.payDefaultShiftHours("2026-10-14", DAV, { stipendHours: 8 }) === 8 &&
    sb.payDefaultShiftHours("2026-10-17", DAV, { stipendHours: 8 }) === 24 && sb.payDefaultShiftHours("2026-07-03", DAV, rif(DAV, "2026-10-14")) === 24 &&
    !warn36(30) && !warn36(36) && warn36(37) &&
    !warnAt(12) && !warnAt(24) && warnAt(24.5) && sb.PAY_LONG_SHIFT_HOURS === 24,
    badDefH.map(t => t[0].name + " " + t[1] + " -> " + sb.payDefaultShiftHours(t[1], t[0], rif(t[0], "2026-10-14"))).join(", "));
  // Reopening a saved shift: hours count as picked unless they equal the
  // day's default, so a saved 12h weekend shift (logged before the 24h
  // default) stays 12h, and a default 24h weekend shift follows a day change.
  const savedSat12 = sb.payShiftFromDraft({ id: "s12", siteId: DAV.id, date: "2026-10-17", callHours: "12", events: [] }, DAV, null).shift;
  const savedSat24 = sb.payShiftFromDraft({ id: "s24", siteId: DAV.id, date: "2026-10-17", callHours: "24", events: [] }, DAV, null).shift;
  const re12 = sb.payDraftFromShift(savedSat12, DAV), re24 = sb.payDraftFromShift(savedSat24, DAV);
  const re12Wed = sb.payDraftRefresh(Object.assign({}, re12, { date: "2026-10-14" }), DAV, "", "", rif(DAV, "2026-10-14"));
  const re24Wed = sb.payDraftRefresh(Object.assign({}, re24, { date: "2026-10-14" }), DAV, "", "", rif(DAV, "2026-10-14"));
  const reSame12 = sb.payShiftFromDraft(re12, DAV, savedSat12).shift;
  check("payDraftFromShift: a saved 12h weekend shift reopens as picked (stays 12h, saves unchanged); a default 24h one follows a day change to 12h",
    re12.hoursSet === true && re12.callHours === "12" && re24.hoursSet === false && re24.callHours === "24" &&
    re12Wed.callHours === "12" && re24Wed.callHours === "12" && !!reSame12 && JSON.stringify(reSame12) === JSON.stringify(savedSat12) &&
    sb.computeShiftPay(savedSat12).total === 3189.65 && sb.computeShiftPay(savedSat24).total === 6379.3,
    JSON.stringify({ re12: re12.hoursSet, re24: re24.hoursSet, w12: re12Wed.callHours, w24: re24Wed.callHours }));
  // A picked 24h WEEKDAY shift (longer than the day's default) reopens as
  // picked, and a same-day refresh (re-tapping the site or day) keeps it.
  const savedWed24 = sb.payShiftFromDraft({ id: "w24", siteId: DAV.id, date: "2026-10-14", callHours: "24", events: [] }, DAV, null).shift;
  const reW24 = sb.payDraftFromShift(savedWed24, DAV);
  const reW24Same = sb.payDraftRefresh(reW24, DAV, "", "", sb.payDraftRate(reW24, DAV, savedWed24).rates);
  const reW24B = sb.payShiftFromDraft(reW24Same, DAV, savedWed24).shift;
  check("payDraftFromShift: a picked 24h weekday shift reopens as picked and a same-day refresh saves it byte-identical",
    reW24.hoursSet === true && reW24Same.callHours === "24" && !!reW24B && JSON.stringify(reW24B) === JSON.stringify(savedWed24) && sb.computeShiftPay(savedWed24).total === 6379.3,
    JSON.stringify({ hs: reW24.hoursSet, h: reW24Same.callHours }));
  // A shift on a DELETED site (stand-in: weekend days unknown). A stipend-
  // length one shorter than 24h is ambiguous (weekday default or a weekend
  // shift picked short), so it counts as picked: its hours survive any
  // sequence of site and date changes. A holiday 24h one keeps the holiday
  // default. No state rides in the draft, so tap order cannot matter.
  const DAV2 = Object.assign({}, DAV, { id: "dav-new" });
  const siteOfD = id => id === ghost.id ? ghost : [DAV2, SIL].filter(s => s.id === id)[0];
  const stepD = (dd, st, shift) => {
    const md = Object.assign({}, dd, typeof st === "string" ? { date: st } : { siteId: st.id });
    const site = siteOfD(md.siteId);
    return sb.payDraftRefresh(md, site, "", "", sb.payDraftRate(md, site, shift).rates);
  };
  const runSeq = (shift, steps) => steps.reduce((dd, st) => stepD(dd, st, shift), sb.payDraftFromShift(shift, ghost));
  const savedWd12 = sb.payShiftFromDraft({ id: "d12", siteId: DAV.id, date: "2026-10-14", callHours: "12", events: [] }, DAV, null).shift;
  const savedXmas24 = sb.payShiftFromDraft({ id: "x24", siteId: DAV.id, date: "2026-12-25", callHours: "24", events: [] }, DAV, null).shift;
  const SEQ = [ // [label, shift, steps, want hours]
    ["Sat 12h -> new site", savedSat12, [DAV2], "12"], ["Sat 12h -> 24h-stipend site -> new site", savedSat12, [SIL, DAV2], "12"],
    ["Sat 12h -> 24h-stipend site", savedSat12, [SIL], "12"], ["Sat 12h -> new site -> Wed", savedSat12, [DAV2, "2026-10-14"], "12"],
    ["Wed 12h -> new site -> Sat", savedWd12, [DAV2, "2026-10-17"], "12"], ["Wed 12h -> Sat -> new site", savedWd12, ["2026-10-17", DAV2], "12"],
    ["Christmas 24h -> new site", savedXmas24, [DAV2], "24"], ["Sat 12h, stays on the deleted site", savedSat12, [ghost], "12"],
  ];
  const badSeq = SEQ.filter(t => runSeq(t[1], t[2]).callHours !== t[3]);
  // Not ambiguous: a 24h-stipend site's full shift on a deleted site follows
  // the new site's default (a weekday at a 12h site = 12h).
  const silWd24 = sb.payShiftFromDraft({ id: "sw24", siteId: SIL.id, date: "2026-10-14", callHours: "24", events: [] }, SIL, null).shift;
  const ghostS = Object.assign({}, ghost, { id: SIL.id, name: SIL.name });
  const silD = sb.payDraftFromShift(silWd24, ghostS), silMd = Object.assign({}, silD, { siteId: DAV2.id });
  const silMoved = sb.payDraftRefresh(silMd, DAV2, "", "", sb.payDraftRate(silMd, DAV2, silWd24).rates);
  if (!(silD.hoursSet === false && silMoved.callHours === "12")) badSeq.push(["24h-stipend deleted weekday -> 12h site", silWd24, [DAV2], "12"]);
  const fromGhost = sb.payDraftFromShift(savedSat12, ghost);
  const viaSil = runSeq(savedSat12, [SIL, DAV2]), direct = runSeq(savedSat12, [DAV2]);
  check("deleted-site shift: a stipend-length one keeps its hours through any site/date sequence (order never matters); holiday 24h keeps the holiday default; nothing extra in the draft or the saved shift",
    badSeq.length === 0 && fromGhost.hoursSet === true && Object.keys(fromGhost).join() === Object.keys(sb.payDraftFromShift(savedSat12, DAV)).join() &&
    JSON.stringify(sb.payShiftFromDraft(viaSil, DAV2, savedSat12).shift) === JSON.stringify(sb.payShiftFromDraft(direct, DAV2, savedSat12).shift),
    badSeq.map(t => t[0] + " -> " + runSeq(t[1], t[2]).callHours).join("; "));
  // Bulk re-price and the editor's "Use current rates" give the same hours.
  const viaEditor = (shift, site) => {
    const dd = sb.payDraftUseCurrent(sb.payDraftFromShift(shift, site), site, shift); // callpay.js useCurrentRates (hours rule; no reopen)
    const nd =sb.payDraftRefresh(dd, site, "", "", sb.payDraftRate(dd, site, shift).rates);
    return sb.payShiftFromDraft(nd, site, shift).shift.callHours;
  };
  const R10 = Object.assign({}, rif(DAV, "2026-10-14"), { id: "dav10", effective: "2026-10-05", stipend: 2500, stipendHours: 10 });
  const DAV10 = Object.assign({}, DAV, { rates: DAV.rates.concat([R10]) });
  const SIL12 = Object.assign({}, SIL, { rates: SIL.rates.concat([Object.assign({}, rif(SIL, "2026-10-14"), { id: "sil12", effective: "2026-10-05", stipend: 800, stipendHours: 12 })]) });
  const silSat24 = sb.payShiftFromDraft({ id: "ss", siteId: SIL.id, date: "2026-10-17", callHours: "24", events: [] }, SIL, null).shift;
  const silWed24 = sb.payShiftFromDraft({ id: "sw", siteId: SIL.id, date: "2026-10-14", callHours: "24", events: [] }, SIL, null).shift;
  const AGREE = [[savedSat24, DAV10, 24], [savedSat12, DAV10, 10], [savedWd12, DAV10, 10], [savedWed24, DAV10, 24], [silSat24, SIL12, 24], [silWed24, SIL12, 12]];
  const badAgree = AGREE.filter(t => { const bulk = sb.payRepriceShift(t[0], t[1]); return !bulk || bulk.callHours !== t[2] || viaEditor(t[0], t[1]) !== t[2]; });
  check("bulk re-price and the editor's Use current rates agree on hours (default length takes the new default, stipend length the new stipend, other hours kept)",
    badAgree.length === 0, badAgree.map(t => t[0].id + " bulk " + (sb.payRepriceShift(t[0], t[1]) || {}).callHours + " editor " + viaEditor(t[0], t[1]) + " want " + t[2]).join("; "));
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
  const zSilNow = Object.assign({}, zSil, { rates: zSil.rates.concat([JSON.parse(JSON.stringify(B0V))]) });
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
  const mine = hand("hm", B0.name + " (mine)", [JSON.parse(JSON.stringify(B0V))], [0, 6]);
  const myFri = svd(mine, "hf", "2026-10-16", "24", [{ date: "2026-10-16", time: "21:00", cls: "wn", fee: true, hours: "2" }]);
  const timeEdit = (() => { const d = sb.payDraftFromShift(myFri, standOf(myFri)), r = sb.payDraftRate(d, standOf(myFri), myFri).rates;
    return sb.payDraftEvent(Object.assign({}, d.events[0], { time: "10:00" }), d.date, standOf(myFri), "", "", r).cls; })();
  check("deleted site -> live site: weekend day wins, quiet Night and un-asked midnight re-ask; a changed time on a deleted site asks the rate type",
    sb.computeShiftPay(myFri).total === 2041 && editTo(myFri, standOf(myFri), SIL, "2026-10-16") === "2332.00" &&
    editTo(silTue, standOf(silTue), DAV, "2026-10-13") === "blocked:evCls" && editTo(davThu, standOf(davThu), SIL, "2026-10-15") === "blocked:evCls+evDate" &&
    timeEdit === "",
    [editTo(myFri, standOf(myFri), SIL, "2026-10-16"), editTo(silTue, standOf(silTue), DAV, "2026-10-13"), editTo(davThu, standOf(davThu), SIL, "2026-10-15"), timeEdit].join(" | "));
  check("payShiftYears: distinct, newest first, bad dates ignored", sb.payShiftYears(tShifts.concat([{ date: "junk" }, null])).join(",") === "2026,2025");
  check("availableDataYears: entries, institution, acute AND call-pay-only years, newest first; missing/bad payShifts safe",
    sb.availableDataYears({ entries: [{ date: "2026-03-02" }], institutionData: [{ month: "2024-11" }], acuteMonths: { "2022-12": {} }, payShifts: [{ date: "2023-07-04" }, { date: "2023-01-01" }, { date: "junk" }, null] }).join(",") === "2026,2024,2023,2022" &&
    sb.availableDataYears({ entries: [], institutionData: [], acuteMonths: {} }).join(",") === "" &&
    sb.availableDataYears({ entries: [], payShifts: "bad" }).join(",") === "");
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
  // Last-good recovery keeps repairData's loss notice. showDataAlert keeps
  // ONE bar, so the recovery banner (the last one shown) must carry the
  // snapshot's fixed.loss text; the discarded primary's notice must not
  // appear; a clean snapshot's banner and the recovered data are unchanged.
  const realLS8 = sb.localStorage, realConsole8 = sb.console, realAlert8 = sb.showDataAlert;
  try {
    const mem = {}, seen = [];
    sb.localStorage = { getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null), setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
    sb.console = { log: () => {}, warn: () => {}, error: () => {} };
    sb.showDataAlert = (m, f) => seen.push([m, f]);
    const SK8 = vm.runInContext("SK", sb), LG8 = sb.LAST_GOOD_KEY, CK8 = sb.CORRUPT_KEY;
    const LOSS8 = "The no-credit mark on procedure 2026-03-11 47561 was unreadable and removed - it counts for wRVU credit, as before. Check it in History.";
    const fL = sb.repairData(ncStore([ncE(1, "x")])), bL = seen.map(s => s[0]);
    const fN = sb.repairData(ncStore([ncE(1, true)])), bN = seen.length - bL.length;
    // Primary fails validation (a non-numeric rate) and carries its own garbled mark (47563).
    const bad8 = JSON.stringify({ entries: [ncE(3, "y")], settings: { ratePerRVU: "abc" } });
    const last8 = () => seen[seen.length - 1];
    mem[sb.LAST_GOOD_TIME_KEY] = "T0";
    mem[SK8] = bad8; mem[LG8] = JSON.stringify(ncStore([ncE(2, true)]));
    const rC = sb.loadData(), bC = last8();
    mem[SK8] = bad8; mem[LG8] = JSON.stringify(ncStore([ncE(1, "x"), ncE(2, true)])); delete mem[CK8];
    const rL = sb.loadData(), bLg = last8();
    mem[SK8] = bad8; delete mem[LG8];
    const rE = sb.loadData(), bE = last8();
    // A lossy snapshot that itself fails validation is not used, so its loss
    // text must stay out of the FAILED banner.
    mem[SK8] = bad8; mem[LG8] = JSON.stringify(Object.assign(ncStore([ncE(1, "x")]), { settings: { ratePerRVU: "abc" } }));
    const rF = sb.loadData(), bF = last8();
    const HEAD8 = "DATA RECOVERY: your saved data failed validation. An older snapshot (saved T0) was loaded instead - anything logged after that snapshot is NOT in the app right now.";
    check("repairData exposes its loss text as fixed.loss (same text as its banner; length unchanged); in-shape data has none",
      fL.loss === LOSS8 && bL.length === 1 && bL[0] === LOSS8 && fL.length === 1 && fL[0] === "entries.noCredit" &&
      fN.loss === undefined && fN.length === 0 && bN === 0,
      JSON.stringify({ fL: fL, loss: fL.loss, bL: bL, fN: fN, bN: bN }));
    check("last-good recovery: the recovery banner carries the snapshot's loss notice (not the discarded primary's); clean snapshot and failed-recovery banners unchanged; data unchanged",
      bC[0].indexOf(HEAD8 + " The unreadable data was preserved") === 0 && bC[0].indexOf("In that snapshot") === -1 && bC[1] === sb.clearCorruptCopy &&
      bLg[0] === bC[0].replace(HEAD8, HEAD8 + " In that snapshot: " + LOSS8) && bLg[1] === sb.clearCorruptCopy &&
      seen.some(s => s[0].indexOf("2026-03-13 47563") !== -1) && bLg[0].indexOf("47563") === -1 && !/[^\x00-\x7f]/.test(bLg[0]) && mem[CK8] === bad8 &&
      JSON.stringify(rC) === JSON.stringify(ncStore([ncE(2, true)])) &&
      JSON.stringify(rL) === JSON.stringify(ncStore([ncE(1), ncE(2, true)])) &&
      bE[0].indexOf("DATA RECOVERY FAILED: your saved data failed validation and no valid snapshot exists") === 0 && bE[0].indexOf("In that snapshot") === -1 &&
      rE.entries.length === 0 && sb.validateData(rE) === true &&
      bF[0].indexOf("DATA RECOVERY FAILED") === 0 && bF[0].indexOf("In that snapshot") === -1 && bF[0].indexOf("47561") === -1 &&
      seen.some(s => s[0] === LOSS8 && s !== bF) && rF.entries.length === 0,
      JSON.stringify({ bC: bC[0], bLg: bLg[0], bE: bE[0], bF: bF[0] }));
  } finally { sb.localStorage = realLS8; sb.console = realConsole8; sb.showDataAlert = realAlert8; }

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
    sb.CALL_NO_CREDIT_FROM === "2026-10-01" && sb.isYMD(sb.CALL_NO_CREDIT_FROM) && !!BNC && !!BCR && sb.payBuiltInFrom(BNC) === sb.CALL_NO_CREDIT_FROM &&
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

  {
    // History's one-tap fix-up: siteless call cases dated on/after the start.
    const f1 = Object.assign(lit7("2026-10-05"), { id: "f1" }), f2 = Object.assign(lit7("2026-10-12"), { id: "f2", encounterId: "CD" });
    const fOld = Object.assign(lit7("2026-09-28"), { id: "fo" }), fPriv = Object.assign(lit7("2026-10-06"), { id: "fp", isCall: false });
    const fSited = sb.entryWithCall(Object.assign(lit7("2026-10-07"), { id: "fs" }), null, true, "st-c", S7, true);
    const fBad = Object.assign(lit7("2026-11-31"), { id: "fb" });
    const fEnts = [f1, fOld, fPriv, fSited, f2, fBad, null, 42], fJson = JSON.stringify(fEnts);
    const fIds = sb.entrySitelessCalls(fEnts).map(e => e.id).join(",");
    const pNC = sb.entrySitelessCallPlan(fEnts, "st-n", S7), pCR = sb.entrySitelessCallPlan(fEnts, "st-c", S7);
    const fixedEnts = fEnts.map(e => (e && pNC[e.id]) || e);
    const back = sb.entryRestoreInPlace(fixedEnts, [f1, f2]);
    check("call-site fix-up: only siteless Call cases dated on/after the start; at a no-credit site they lose credit, at a crediting site they keep it; unknown site does nothing; Undo restores in place",
      fIds === "f1,f2" && Object.keys(pNC).sort().join() === "f1,f2" && sb.isNoCredit(pNC.f1) && pNC.f1.siteId === "st-n" && pNC.f2.siteName === "North" &&
      Object.keys(pCR).sort().join() === "f1,f2" && !sb.isNoCredit(pCR.f1) && pCR.f1.siteId === "st-c" &&
      Object.keys(sb.entrySitelessCallPlan(fEnts, "zz", S7)).length === 0 && Object.keys(sb.entrySitelessCallPlan(fEnts, "st-n", [])).length === 0 &&
      JSON.stringify(fEnts) === fJson && sb.entrySitelessCalls(fixedEnts).length === 0 &&
      JSON.stringify(back) === JSON.stringify(fEnts) && back[1] === fOld && back[3] === fSited &&
      sb.entryRestoreInPlace(null, [f1]).length === 0 && sb.entryRestoreInPlace(fEnts, null).length === fEnts.length && sb.entrySitelessCalls(null).length === 0 &&
      fixedPoint7(entStore7(JSON.parse(JSON.stringify([pNC.f1, pNC.f2, pCR.f1])))),
      JSON.stringify({ fIds: fIds, nc: Object.keys(pNC), cr: Object.keys(pCR) }));
    // A Call case CREATED after the site picker shipped (id = Date.now()...)
    // went through a picker: siteless there = a deliberate "Other site" - never
    // listed or rewritten. Kept ids are skipped. Undo with `written` leaves a
    // case edited again since the fix-up as it is.
    const cut = sb.CALL_SITE_PICKER_MS;
    const fNew = Object.assign(lit7("2026-10-14"), { id: String(cut) + "-1-abcd" }), fPre = Object.assign(lit7("2026-10-12"), { id: String(cut - 1) + "-1-abcd" });
    const cEnts = [f1, fNew, fPre, f2];
    const cIds = sb.entrySitelessCalls(cEnts).map(e => e.id).join(",");
    const keptIds = sb.entrySitelessCalls(cEnts, ["f2", fPre.id]).map(e => e.id).join(",");
    const pKept = sb.entrySitelessCallPlan(cEnts, "st-n", S7, ["f2"]);
    const edited = Object.assign({}, pNC.f1, { notes: "edited later" });
    const afterEdit = fixedEnts.map(e => (e && e.id === "f1") ? edited : e);
    const undone = sb.entryRestoreInPlace(afterEdit, [f1, f2], pNC);
    check("call-site fix-up: cases created after the site picker (deliberate Other site) and kept ids are never listed or rewritten; Undo keeps a case edited since",
      Date.UTC(2026, 9, 13, 9, 50) < cut && cIds === "f1," + fPre.id + ",f2" && keptIds === "f1" && Object.keys(pKept).sort().join() === ["f1", fPre.id].sort().join() &&
      sb.entryCreatedMs(fNew) === cut && isNaN(sb.entryCreatedMs(f1)) && isNaN(sb.entryCreatedMs(null)) &&
      undone[0] === edited && undone[4] === f2 && undone[1] === fOld,
      JSON.stringify({ cIds: cIds, keptIds: keptIds, plan: Object.keys(pKept), u0: undone[0] && undone[0].notes }));
    // History + Add on an old siteless case asks for a site instead of
    // carrying "Other site" (which on a new id would leave the fix-up list).
    const addKeys = [sb.entryAddSiteKey(f1), sb.entryAddSiteKey(fPre), sb.entryAddSiteKey(f1, ["f1"]), sb.entryAddSiteKey(fNew), sb.entryAddSiteKey(fSited), sb.entryAddSiteKey(fPriv), sb.entryAddSiteKey(fOld)];
    check("entryAddSiteKey: an old siteless case (still listed) starts the add with no site; kept / deliberate / sited / Private / pre-start cases carry their own key",
      JSON.stringify(addKeys) === JSON.stringify(["", "", sb.CALL_SITE_OTHER, sb.CALL_SITE_OTHER, "st-c", "", sb.CALL_SITE_OTHER]) && JSON.stringify(fEnts) === fJson,
      JSON.stringify(addKeys));
  }

  {
    // Tap-through ranges for the "Logged, no credit" lines (inclusive strings).
    const MB = [["2028-02", "2028-02-01", "2028-02-29"], ["2026-02", "2026-02-01", "2026-02-28"], ["2026-12", "2026-12-01", "2026-12-31"], ["2026-04", "2026-04-01", "2026-04-30"]];
    const badMB = MB.filter(t => { const r = sb.monthBoundsYMD(t[0]); return !r || r.start !== t[1] || r.end !== t[2]; });
    const nullMB = ["2026-13", "2026-00", "2026-1", "", null, "2026-02-01"].every(v => sb.monthBoundsYMD(v) === null);
    const FY = [["2026-01-01", "2026-12-31"], ["2026-07-01", "2027-06-30"], ["2028-02-29", "2029-02-28"], ["2027-03-01", "2028-02-29"], ["2026-12-31", "2027-12-30"]];
    const badFY = FY.filter(t => { const r = sb.fiscalYearBoundsYMD(t[0]); return !r || r.start !== t[0] || r.end !== t[1]; });
    const nullFY = ["2026-02-30", "", null, "2026-1-01"].every(v => sb.fiscalYearBoundsYMD(v) === null);
    check("monthBoundsYMD / fiscalYearBoundsYMD: inclusive local-parts ranges (leap years, a Feb 29 start ends Feb 28), null for bad input",
      badMB.length === 0 && nullMB && badFY.length === 0 && nullFY, JSON.stringify({ badMB: badMB, badFY: badFY, nullMB: nullMB, nullFY: nullFY }));
  }

  {
    // vs. Prior Year (Dashboard): the year cut at today while today is inside
    // it, whole years otherwise; the prior side is the same span a year back
    // and never overlaps the current one (a Feb 29 bound stays "YYYY-02-29").
    const PS = [ // [ys, today, cur.start, cur.end, prev.start, prev.end, toDate]
      ["2026-01-01", "2026-10-14", "2026-01-01", "2026-10-14", "2025-01-01", "2025-10-14", true],
      ["2026-07-01", "2026-10-14", "2026-07-01", "2026-10-14", "2025-07-01", "2025-10-14", true],
      ["2026-07-01", "2027-03-10", "2026-07-01", "2027-03-10", "2025-07-01", "2026-03-10", true],
      ["2026-01-01", "2026-01-01", "2026-01-01", "2026-01-01", "2025-01-01", "2025-01-01", true],
      ["2028-01-01", "2028-02-29", "2028-01-01", "2028-02-29", "2027-01-01", "2027-02-29", true],
      ["2028-02-29", "2028-06-01", "2028-02-29", "2028-06-01", "2027-02-29", "2027-06-01", true],
      ["2026-01-01", "2026-12-31", "2026-01-01", "2026-12-31", "2025-01-01", "2025-12-31", false],
      ["2025-01-01", "2026-10-14", "2025-01-01", "2025-12-31", "2024-01-01", "2024-12-31", false],
      ["2027-01-01", "2026-10-14", "2027-01-01", "2026-10-14", "2026-01-01", "2025-10-14", true],
      ["2026-01-01", "", "2026-01-01", "2026-12-31", "2025-01-01", "2025-12-31", false],
      ["2028-03-01", "2029-10-14", "2028-03-01", "2029-02-28", "2027-03-01", "2028-02-29", false], // prior year keeps its leap Feb 29
      ["2028-03-01", "2029-02-28", "2028-03-01", "2029-02-28", "2027-03-01", "2028-02-29", false],
      ["2028-02-29", "2029-10-14", "2028-02-29", "2029-02-28", "2027-02-29", "2028-02-28", false],
      ["2026-07-01", "2027-08-01", "2026-07-01", "2027-06-30", "2025-07-01", "2026-06-30", false],
    ];
    const badPS = PS.filter(t => { const r = sb.priorSpanYMD(t[0], t[1]); return !r || r.cur.start !== t[2] || r.cur.end !== t[3] || r.prev.start !== t[4] || r.prev.end !== t[5] || r.toDate !== t[6] || !(r.prev.end < r.cur.start); });
    const nullPS = ["2026-02-30", "", null, "2026-1-01"].every(v => sb.priorSpanYMD(v, "2026-10-14") === null);
    check("priorSpanYMD: to-date same span a year back while today is in the year, whole years otherwise, never overlapping; null for a bad start",
      badPS.length === 0 && nullPS, JSON.stringify({ badPS: badPS, nullPS: nullPS }));
  }

  {
    // Home's Compensation card (compProjection): the source picks the pace -
    // the window's Compare months (the Reconciliation card's own months and
    // pace) when there are any, else the tracked pace. A Compare projection is
    // compared with the Reconciliation goal when one is set, else with the OR
    // goal (named as such); a tracked one only ever with the OR goal. No rate,
    // or no goal for that comparison, hides the card (diff and onPace are then
    // never shown, so they are not pinned). Literal expected values from
    // made-up settings: rate 55, OR goal 6000, Recon goal 8000, 290 days in,
    // 4000 logged, Compare 9 months x 650.
    const P = o => Object.assign({ trackedWRVU: 4000, trackedDays: 290, compareWRVU: 5850, compareMonths: 9, annualGoal: 6000, reconGoal: 8000, rate: 55 }, o || {});
    const R = o => sb.compProjection(P(o));
    const pick = r => [r.show, r.source, r.months, Math.round(r.wrvu), r.goalWRVU, r.goalName, r.goalTile, Math.round(r.comp), Math.round(r.goalComp), r.show ? Math.round(r.diff) : null, r.show ? r.onPace : null, r.sourceLabel];
    const CP = [ // [case, overrides, expected pick]
      ["Compare + Recon goal", {}, [true, "compare", 9, 7800, 8000, "Reconciliation goal", "Recon goal", 429000, 440000, -11000, false, "from Compare (9-mo avg)"]],
      ["tracked uses the OR goal even with a Recon goal set", { compareWRVU: 0, compareMonths: 0 }, [true, "tracked", 0, 5038, 6000, "OR goal", "OR goal", 277109, 330000, -52891, false, "from tracked pace"]],
      ["Compare, no Recon goal: the OR goal, named", { reconGoal: 0 }, [true, "compare", 9, 7800, 6000, "OR goal", "OR goal", 429000, 330000, 99000, true, "from Compare (9-mo avg)"]],
      ["Compare + Recon goal, no OR goal: shows", { annualGoal: 0 }, [true, "compare", 9, 7800, 8000, "Reconciliation goal", "Recon goal", 429000, 440000, -11000, false, "from Compare (9-mo avg)"]],
      ["Compare, neither goal: hidden", { reconGoal: 0, annualGoal: 0 }, [false, "compare", 9, 7800, 0, "OR goal", "OR goal", 429000, 0, null, null, "from Compare (9-mo avg)"]],
      ["tracked, no OR goal, Recon goal set: hidden", { compareWRVU: 0, compareMonths: 0, annualGoal: 0 }, [false, "tracked", 0, 5038, 0, "OR goal", "OR goal", 277109, 0, null, null, "from tracked pace"]],
      ["mid-month Year Start: the Recon card's 3 months", { compareWRVU: 1560, compareMonths: 3 }, [true, "compare", 3, 6240, 8000, "Reconciliation goal", "Recon goal", 343200, 440000, -96800, false, "from Compare (3-mo avg)"]],
      ["a saved 0-wRVU month counts", { compareMonths: 10 }, [true, "compare", 10, 7020, 8000, "Reconciliation goal", "Recon goal", 386100, 440000, -53900, false, "from Compare (10-mo avg)"]],
      ["exactly on goal", { reconGoal: 7800 }, [true, "compare", 9, 7800, 7800, "Reconciliation goal", "Recon goal", 429000, 429000, 0, true, "from Compare (9-mo avg)"]],
      ["past year, tracked (365 days)", { trackedWRVU: 4500, trackedDays: 365, compareWRVU: 0, compareMonths: 0 }, [true, "tracked", 0, 4503, 6000, "OR goal", "OR goal", 247690, 330000, -82310, false, "from tracked pace"]],
      ["one-month floor", { trackedWRVU: 400, trackedDays: 10, compareWRVU: 0, compareMonths: 0 }, [true, "tracked", 0, 4800, 6000, "OR goal", "OR goal", 264000, 330000, -66000, false, "from tracked pace"]],
    ];
    const badCP = CP.filter(t => JSON.stringify(pick(R(t[1]))) !== JSON.stringify(t[2])).map(t => t[0] + " got " + JSON.stringify(pick(R(t[1]))));
    // Exact paces: the twin cards' expressions, unrounded.
    const r0 = R();
    const exact = r0.wrvu === 7800 && r0.comp === 429000 && r0.trackedPace.toFixed(2) === "5038.34" && R({ compareWRVU: 9600, compareMonths: 12 }).wrvu === 9600 &&
      R({ compareWRVU: 0, compareMonths: 0 }).comparePace === 0 && R({ trackedWRVU: 4500, trackedDays: 365 }).trackedPace.toFixed(2) === "4503.45" &&
      [0, 10, 30].every(d => R({ trackedWRVU: 400, trackedDays: d, compareMonths: 0 }).wrvu === 4800);
    // A goal, the rate or the month count counts only as a finite number > 0.
    const notSet = [0, undefined, null, -5, NaN, Infinity, "8000", ""];
    const reconJunk = notSet.every(v => { const r = R({ reconGoal: v }); return r.show && r.goalWRVU === 6000 && r.goalName === "OR goal" && r.goalTile === "OR goal"; });
    const orJunk = notSet.every(v => { const r = R({ annualGoal: v, compareMonths: 0 }); return r.show === false && r.goalWRVU === 0; });
    const rateJunk = notSet.every(v => { const r = R({ rate: v }); return r.show === false && r.comp === 0; });
    const monthsJunk = [0, undefined, null, -3, NaN, "9"].every(v => R({ compareMonths: v }).source === "tracked");
    // Totals pass through unchanged (the twin cards show the same NaN today).
    const nanPass = isNaN(R({ trackedWRVU: NaN }).trackedPace) && isNaN(R({ compareWRVU: NaN }).comparePace);
    // Tracked figures never move a Compare projection, and Compare figures or
    // the Recon goal never move a tracked one.
    const nb1 = JSON.stringify(pick(R({ trackedWRVU: 999999, trackedDays: 1, annualGoal: 1 }))) === JSON.stringify(pick(R()));
    const nb2 = JSON.stringify(pick(R({ compareMonths: 0, compareWRVU: 999999, reconGoal: 1 }))) === JSON.stringify(pick(R({ compareMonths: 0, compareWRVU: 0 })));
    let noThrow = false;
    try { noThrow = sb.compProjection(undefined).show === false && sb.compProjection({}).show === false; } catch (e) { noThrow = false; }
    const inp = P(), inpJ = JSON.stringify(inp);
    sb.compProjection(inp);
    const untouched = JSON.stringify(inp) === inpJ;
    // The output fields are exactly the ones 5f-2 lets dashboard.js read.
    const fields = Object.keys(r0).sort().join() === COMP_PROJ_FIELDS.slice().sort().join();
    // Comp YTD: the same source as the projection - this window's Compare
    // months, else logged wRVU (never $0 for a year with logged cases just
    // because Compare has rows in another year) - shown even when the card is
    // hidden; tracked figures never move a Compare total and vice versa.
    const ytdOf = o => { const r = R(o); return [r.ytdWRVU, r.ytdComp]; };
    // Compare months that total 0 stay on the Compare source (0), as the
    // Recon card and the projection do - never a fall back to logged wRVU.
    const ytd = JSON.stringify([ytdOf(), ytdOf({ compareWRVU: 0, compareMonths: 0 }), ytdOf({ reconGoal: 0, annualGoal: 0 }), ytdOf({ compareWRVU: 1560, compareMonths: 3 }),
      ytdOf({ trackedWRVU: 4500, trackedDays: 365, compareWRVU: 0, compareMonths: 0 }), ytdOf({ trackedWRVU: 999999 }), ytdOf({ compareMonths: 0, compareWRVU: 999999 }), ytdOf({ compareWRVU: 0, compareMonths: 2 })]) ===
      JSON.stringify([[5850, 321750], [4000, 220000], [5850, 321750], [1560, 85800], [4500, 247500], [5850, 321750], [4000, 220000], [0, 0]]) &&
      R({ compareWRVU: 0, compareMonths: 2 }).comparePace === 0 && R({ compareWRVU: 0, compareMonths: 2 }).source === "compare" &&
      notSet.every(v => R({ rate: v }).ytdComp === 0) && isNaN(R({ compareWRVU: NaN }).ytdWRVU);
    check("compProjection: Compare months -> the Recon card's pace vs the Recon goal (the OR goal, named, when unset); else the tracked pace vs the OR goal; no rate or no goal for that comparison hides; Comp YTD from the same source; junk = not set; paces never cross tracks",
      badCP.length === 0 && exact && reconJunk && orJunk && rateJunk && monthsJunk && nanPass && nb1 && nb2 && noThrow && untouched && fields && ytd,
      JSON.stringify({ badCP: badCP, exact: exact, reconJunk: reconJunk, orJunk: orJunk, rateJunk: rateJunk, monthsJunk: monthsJunk, nanPass: nanPass, nb1: nb1, nb2: nb2, noThrow: noThrow, untouched: untouched, fields: fields, ytd: ytd, keys: Object.keys(r0) }));
  }

  {
    // Settings "Remove Duplicates": exact copies only - Call/Private, call
    // site and credit are part of the key; copies differing only in them are
    // kept and counted in mixed.
    const E7 = { id: "st-e", name: "East", weekendDays: [0, 6], casesEarnRVU: true, rates: [] };
    const SD = [N7, C7, E7];
    const at = (d, id, key, sites) => sb.entryWithCall(Object.assign(lit7(d), { id: id }), null, true, key, sites || SD, true);
    const d0 = Object.assign(lit7("2026-09-20"), { id: "d0", isCall: false, modifiers: ["-22", "-59"] }); // Private
    const d1 = Object.assign(lit7("2026-09-20"), { id: "d1", modifiers: ["-59", "-22"] });                // siteless Call, credited
    const d2 = Object.assign(lit7("2026-09-20"), { id: "d2", isCall: false, modifiers: ["-59", "-22"] }); // copy of d0
    const a1 = at("2026-10-05", "a1", "st-c"), a2 = at("2026-10-05", "a2", "st-e"), a3 = at("2026-10-05", "a3", "st-c"); // a3 copies a1
    const n1 = at("2026-10-06", "n1", "st-n"), n2 = at("2026-10-06", "n2", "st-n", [sb.paySiteWithCredit(N7, true)]); // same site, credit differs
    const o1 = Object.assign(lit7("2026-09-20"), { id: "o1", isCall: false, modifiers: ["-22", "-59"], encounterId: "XY" }); // other patient
    const o2 = Object.assign(lit7("2026-09-20"), { id: "o2", isCall: false, modifiers: ["-22", "-59"], notes: "CD" });       // other notes
    const o3 = Object.assign(lit7("2026-09-20"), { id: "o3", isCall: false, modifiers: ["-22", "-59"], cptCode: "47563" });  // other code
    const DE = [d0, d1, null, a1, d2, a2, n1, a3, n2, o1, o2, o3], deJ = JSON.stringify(DE);
    const ds = sb.entryDuplicateScan(DE);
    const ids = l => l.map(e => e ? e.id : String(e)).join(",");
    const empty = sb.entryDuplicateScan(null);
    // The new key only splits the old one (base + credit), so it never
    // removes a case the old rule kept.
    const oldSeen = {}, oldRemoved = [];
    DE.forEach(e => { if (!e) return; const k = e.date + "|" + e.cptCode + "|" + e.modifiers.slice().sort().join(",") + "|" + (e.encounterId || "") + "|" + (e.notes || "") + "|" + (sb.isNoCredit(e) ? "nc" : ""); if (oldSeen[k]) oldRemoved.push(e.id); else oldSeen[k] = true; });
    check("entryDuplicateScan: exact copies only (Call/Private, call site and credit in the key); copies differing only in them kept and counted; order kept, inputs untouched; Settings uses it",
      ids(ds.removed) === "d2,a3" && ids(ds.unique) === "d0,d1,null,a1,a2,n1,n2,o1,o2,o3" && ds.mixed === 3 &&
      sb.isNoCredit(n1) && !sb.isNoCredit(n2) && !sb.isNoCredit(a1) && !sb.isNoCredit(a2) &&
      ds.unique[0] === d0 && ds.removed[1] === a3 && JSON.stringify(DE) === deJ &&
      ds.removed.every(e => oldRemoved.indexOf(e.id) !== -1) &&
      sb.entryDuplicateScan([d0, d2]).mixed === 0 && sb.entryDuplicateScan([d0, d1]).removed.length === 0 &&
      empty.unique.length === 0 && empty.removed.length === 0 && empty.mixed === 0 &&
      settingsSrc.indexOf("entryDuplicateScan(data.entries)") !== -1,
      JSON.stringify({ removed: ids(ds.removed), unique: ids(ds.unique), mixed: ds.mixed, oldRemoved: oldRemoved }));
  }

  {
    // Backup stamp helpers (per-device "Last backup" + Home's 14-day nudge
    // with a 7-day snooze): junk-proof parse, writes only to the stamp key,
    // safe when storage throws, and the due rule by local string dates.
    const J = o => JSON.stringify(o);
    const realLSb = sb.localStorage;
    const EMPTY = J({ date: "", how: "", snooze: "" });
    let parseOk = false, seqOk = false, throwOk = false, seq = [], writesB = [];
    try {
      parseOk = [null, "", "{", "null", "[]", "42", J({ date: "2026-02-30", how: "cloud", snooze: 7 })].every(r => J(sb.backupStampParse(r)) === EMPTY) &&
        J(sb.backupStampParse(J({ date: "2026-10-14", how: "copy", snooze: "2026-10-20" }))) === J({ date: "2026-10-14", how: "copy", snooze: "2026-10-20" });
      const memB = {};
      sb.localStorage = { getItem: k => (Object.prototype.hasOwnProperty.call(memB, k) ? memB[k] : null), setItem: (k, v) => { writesB.push(k); memB[k] = String(v); }, removeItem: k => { delete memB[k]; } };
      const empty0 = J(sb.readBackupStamp());
      sb.markBackupSaved("file", "2026-10-14"); seq.push(J(sb.readBackupStamp()));
      sb.snoozeBackupNudge("2026-10-20"); seq.push(J(sb.readBackupStamp()));
      sb.markBackupSaved("copy", "2026-10-21"); seq.push(J(sb.readBackupStamp()));
      seqOk = empty0 === EMPTY && seq[0] === J({ date: "2026-10-14", how: "file", snooze: "" }) && seq[1] === J({ date: "2026-10-14", how: "file", snooze: "2026-10-27" }) &&
        seq[2] === J({ date: "2026-10-21", how: "copy", snooze: "" }) && writesB.length === 3 && writesB.every(k => k === sb.BACKUP_STAMP_KEY);
      sb.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => {} };
      const r1 = sb.readBackupStamp(), r2 = sb.markBackupSaved("file", "2026-10-14"), r3 = sb.snoozeBackupNudge("2026-10-14");
      throwOk = J(r1) === EMPTY && r2.date === "2026-10-14" && r2.how === "file" && r3.snooze === "2026-10-21";
    } finally { sb.localStorage = realLSb; }
    const st = (date, snooze) => ({ date: date || "", how: "file", snooze: snooze || "" });
    const DUE = [ // [stamp, today, itemCount, due]
      [st(""), "2026-10-14", 0, false], [st(""), "2026-10-14", 3, true],
      [st("2026-10-01"), "2026-10-14", 3, false], [st("2026-09-30"), "2026-10-14", 3, true],
      [st("2026-02-28"), "2026-03-14", 3, true], [st("2026-03-01"), "2026-03-14", 3, false],
      [st("2026-10-25"), "2026-11-08", 3, true], [st("2026-10-26"), "2026-11-08", 3, false],
      [st("", "2026-10-20"), "2026-10-14", 3, false], [st("", "2026-10-14"), "2026-10-14", 3, true],
      [st("", "2027-01-01"), "2026-10-14", 3, true], [st("2026-09-01", "2026-10-21"), "2026-10-14", 3, false],
      [st("2026-10-20"), "2026-10-14", 3, false], [null, "2026-10-14", 3, false], [st(""), "2026-10-32", 3, false],
    ];
    const dueBad = DUE.filter(t => sb.backupNudgeDue(t[0], t[1], t[2]) !== t[3]);
    check("backup stamp: junk-proof parse; mark/snooze write only the stamp key; storage errors never throw",
      parseOk && seqOk && throwOk, J({ parseOk: parseOk, seq: seq, writes: writesB, throwOk: throwOk }));
    check("backupNudgeDue: due at 14+ days (or never) with data to lose; a snooze within 7 days hides it (" + DUE.length + " cases)",
      dueBad.length === 0, J(dueBad.map(t => [t[0], t[1], t[2]])));
    check("backupFileName: rvu-backup-<date>.txt", sb.backupFileName("2026-10-14") === "rvu-backup-2026-10-14.txt" && /^rvu-backup-\d{4}-\d{2}-\d{2}\.txt$/.test(sb.backupFileName("junk")));
  }
  // ---- 7d. Directorships (the REAL utils.js). The preset is the owner's
  // built-in data (CLAUDE.md exception); every other value is made up. ----
  {
    const J = o => JSON.stringify(o);
    const PRESET_SPEC = [
      { id: "icu", name: "ICU Co-Director", shortName: "ICU", org: "MercyOne Genesis Davenport", form: "genesis", printName: "Faraz Khan, MD", emplNo: "", costCtr: "", rate: 200, maxHours: 4.5 },
      { id: "trauma", name: "Trauma Medical Director", shortName: "Trauma", org: "MercyOne Genesis Silvis - Illini", form: "genesis", printName: "Faraz Khan, MD", emplNo: "", costCtr: "", rate: 200, maxHours: 4.25 },
      { id: "wound", name: "Wound Care Program Director", shortName: "Wound", org: "Select Specialty Hospital - Quad Cities", form: "select", printName: "Faraz Khan, MD", rate: 215, maxHours: 8,
        selectHeader: { hospital: "Select Specialty Hospital - Quad Cities", programType: "Wound Care", physicianName: "Faraz Khan, MD", contractingParty: "MercyOne Genesis Health Group",
          remitAddress: ["1228 E Rusholme St. Suite 3020", "Davenport, IA 52803"], glNo: "150-6700-64931", hospitalNo: "" } }
    ];
    // Silent repair: no banner, no loss text.
    const quiet = (fn) => { const realA = sb.showDataAlert, seen = []; sb.showDataAlert = m => seen.push(String(m)); try { return { r: fn(), seen: seen }; } finally { sb.showDataAlert = realA; } };
    const dstore = o => seedStore(Object.assign({ settings: { ratePerRVU: 55, paySitesSeeded: true } }, o || {}));
    const fixedPt = s => { const before = J(s), q = quiet(() => sb.repairData(s)); return q.r.length === 0 && q.seen.length === 0 && J(s) === before && sb.validateData(s) === true; };
    const ICU = PRESET_SPEC[0], WC = PRESET_SPEC[2];
    const ent = (id, dirId, date, minutes, category, detail) => ({ id: id, dirId: dirId, date: date, minutes: minutes, category: category, detail: detail || "" });
    const withEntries = (list, extra) => dstore(Object.assign({ dirEntries: list }, extra || {}));

    // T1 preset
    const dd1 = sb.defaultDirectorships(), dd2 = sb.defaultDirectorships(), ds1 = vm.runInContext("defState", sb)(), ds2 = vm.runInContext("defState", sb)();
    check("directorships T1: DIRECTORSHIP_PRESET equals the spec literal, ASCII, ids icu/trauma/wound; copies and defState are fresh",
      J(sb.DIRECTORSHIP_PRESET) === J(PRESET_SPEC) && !/[^\x20-\x7e]/.test(J(sb.DIRECTORSHIP_PRESET)) &&
      sb.DIRECTORSHIP_PRESET.map(d => d.id).join() === "icu,trauma,wound" && dd1 !== dd2 && dd1[2].selectHeader !== dd2[2].selectHeader &&
      J(dd1) === J(PRESET_SPEC) && ds1.directorships !== ds2.directorships && J(ds1.directorships) === J(PRESET_SPEC) &&
      J(ds1.dirEntries) === "[]" && J(ds1.dirHandoff) === "{}" && ds1.dirSignatureEnc === null && fixedPt(ds1));

    // T2 seeding
    const t2a = { entries: [], settings: { ratePerRVU: 55, paySitesSeeded: true } }, q2a = quiet(() => sb.repairData(t2a));
    const t2b = dstore({ directorships: [] }), q2b = quiet(() => sb.repairData(t2b));
    const badSeed = [null, {}, "x"].map(v => { const s = dstore({ directorships: v }), q = quiet(() => sb.repairData(s)); return J(s.directorships) === "[]" && q.seen.length === 1 && !/[^\x20-\x7e]/.test(q.seen[0]) && /Restore built-in directorships/.test(q.seen[0]); });
    const again = JSON.parse(J(t2a)), q2c = quiet(() => sb.repairData(again));
    check("directorships T2: missing = seeded silently (tagged), [] stays [], malformed -> [] with one ASCII banner; dirWillSeed agrees; seeded store is a fixed point",
      J(t2a.directorships) === J(PRESET_SPEC) && q2a.r.indexOf("directorships-seeded") !== -1 && q2a.seen.length === 0 && !q2a.r.loss &&
      J(t2b.directorships) === "[]" && q2b.r.length === 0 && q2b.seen.length === 0 && badSeed.every(Boolean) &&
      sb.dirWillSeed({}) === true && sb.dirWillSeed({ directorships: [] }) === false && sb.dirWillSeed({ directorships: null }) === false &&
      q2c.r.length === 0 && q2c.seen.length === 0 && J(again) === J(t2a));

    // T3 loadData (in-memory storage)
    {
      const realLS = sb.localStorage, realConsole = sb.console, realA = sb.showDataAlert;
      let okA = false, okB = false, okC = false, info = {};
      try {
        const mem = {}, writes = [], banners = [], warns = [];
        sb.localStorage = { getItem: k => (Object.prototype.hasOwnProperty.call(mem, k) ? mem[k] : null), setItem: (k, v) => { writes.push(k); mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
        sb.console = { log: () => {}, warn: m => warns.push(String(m)), error: () => {} };
        sb.showDataAlert = m => banners.push(String(m));
        const SKD = vm.runInContext("SK", sb);
        mem[SKD] = J({ entries: [], settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: [], payShifts: [] });
        const l1 = sb.loadData(), w1 = writes.length, b1 = banners.length;
        const l2 = sb.loadData(), w2 = writes.length - w1;
        okA = J(l1.directorships) === J(PRESET_SPEC) && w1 === 1 && b1 === 0 && w2 === 0 && J(l2.directorships) === J(PRESET_SPEC);
        mem[SKD] = J({ entries: [], settings: { ratePerRVU: 55, paySitesSeeded: true }, paySites: [], payShifts: [], directorships: [] });
        const w3 = writes.length, l3 = sb.loadData(), l4 = sb.loadData();
        okB = J(l3.directorships) === "[]" && J(l4.directorships) === "[]" && writes.length === w3;
        // A pre-feature last-good snapshot behind an unreadable primary: seeded, and the banner never mentions it.
        mem[SKD] = "{not json"; mem[sb.LAST_GOOD_KEY] = J({ entries: [], settings: { ratePerRVU: 55, paySitesSeeded: true } }); mem[sb.LAST_GOOD_TIME_KEY] = "T0";
        const bStart = banners.length, l5 = sb.loadData(), last = banners[banners.length - 1] || "";
        okC = J(l5.directorships) === J(PRESET_SPEC) && banners.length === bStart + 1 && /DATA RECOVERY/.test(last) && !/irectorship/.test(last);
        info = { w1: w1, b1: b1, w2: w2, last: last.slice(0, 80) };
      } finally { sb.localStorage = realLS; sb.console = realConsole; sb.showDataAlert = realA; }
      check("directorships T3: loadData seeds a pre-feature store once (no banner, no rewrite after); [] stays [] with no write; a pre-feature last-good snapshot is seeded silently",
        okA && okB && okC, J(Object.assign({ okA: okA, okB: okB, okC: okC }, info)));
    }

    // T4 directorships repair table
    const t4 = dstore({ directorships: [
      Object.assign({}, ICU, { rate: "250", maxHours: "5" }),                               // numeric strings: silent
      Object.assign({}, ICU, { id: "icu", name: "Dup id", rate: "abc" }),                   // duplicate id: new id; unreadable rate -> 0 LOUD
      { id: "x1", name: "  ", form: "genesis" },                                             // blank name: dropped
      { id: "x2", name: "No form", form: "pdf" },                                            // bad form: dropped
      "junk",                                                                                // non-object: dropped
      Object.assign({}, WC, { id: "w2", name: "Header junk", selectHeader: "bad" }),         // header not an object: deleted LOUD
      Object.assign({}, WC, { id: "w3", name: "Remit string", shortName: 7, selectHeader: Object.assign({}, WC.selectHeader, { remitAddress: "1 Main St", glNo: 42 }) }),
      Object.assign({}, WC, { id: "w4", name: "Remit long", selectHeader: Object.assign({}, WC.selectHeader, { remitAddress: ["A", "B", "C"] }) }),
      Object.assign({}, ICU, { id: "c:1", name: "Colon id", extra: { keep: 1 } }),           // ":" in id: kept (keys split at the LAST ":"); unknown key kept
      { id: "trauma", name: "Trauma Medical Director", form: "pdf" },                        // a dropped BUILT-IN: the banner points to Restore
      { id: "icu", name: "ICU again", form: "pdf" }                                          // dropped, but ICU still holds its id: hours stay there
    ] });
    const q4 = quiet(() => sb.repairData(t4)), D4 = t4.directorships, banner4 = q4.seen[0] || "";
    const ids4 = D4.map(d => d.id);
    const pass2 = JSON.parse(J(t4)), q4b = quiet(() => sb.repairData(pass2));
    check("directorships T4: repair table - coercion silent, duplicate ids renewed, colon ids kept, bad items dropped LOUD (a built-in points to Restore, a custom one says it can't be reattached), unreadable numbers -> 0 LOUD, header rules; second pass clean",
      D4.length === 6 && D4[0].rate === 250 && D4[0].maxHours === 5 && D4[1].rate === 0 && ids4[1] !== "icu" && new Set(ids4).size === 6 && ids4[5] === "c:1" &&
      D4[2].selectHeader === undefined && D4[3].shortName === "7" && J(D4[3].selectHeader.remitAddress) === J(["1 Main St", ""]) && D4[3].selectHeader.glNo === "42" &&
      J(D4[4].selectHeader.remitAddress) === J(["A", "B, C"]) && J(D4[5].extra) === J({ keep: 1 }) &&
      q4.seen.length === 1 && banner4.indexOf("Directorships #3, No form, #5 were unreadable and removed. Their logged hours are kept but can't be reattached - add them again in Settings and re-log those hours.") !== -1 &&
      banner4.indexOf("Directorship Trauma Medical Director was unreadable and removed - tap Restore in Settings > Directorships to bring it back with its logged hours. Don't add it again by hand.") !== -1 &&
      banner4.indexOf("Directorship ICU again was unreadable and removed. It shared an id with a directorship you still have, so its logged hours stay on that one - check them in Directorships and don't re-log them.") !== -1 &&
      !/ICU again[^.]*(tap Restore|re-log those)/.test(banner4) &&
      /Dup id rate/.test(banner4) && /Header junk/.test(banner4) && !/[^\x20-\x7e]/.test(banner4) &&
      q4b.r.length === 0 && q4b.seen.length === 0 && J(pass2) === J(t4),
      J({ n: D4.length, ids: ids4, banner: banner4.slice(0, 600) }));

    // T5 dirEntries repair table
    const t5list = [
      ent("a1", "icu", "2026-10-02", "90", "g_policy"), ent("a2", "icu", "2026-10-02", 90.4, "g_policy"), ent("a3", "icu", "2026-10-02", "1:30", "g_policy"),
      ent("a4", "icu", "2026-10-02", 0, "g_policy"), ent("a5", "icu", "2026-10-02", 1441, "g_policy"), ent("a6", "icu", "2026-10-02", true, "g_policy"),
      ent("a7", "icu", "2026-10-02", -30, "g_policy"), ent("a8", "icu", "2026-10-02", "-30", "g_policy"), ent("a9", "icu", "2026-10-02", NaN, "g_policy"),
      ent(undefined, "icu", "2026-10-03", 30, "g_policy"), ent("a1", "icu", "2026-10-04", 30, "g_policy"), ent("b1", "icu", "2026-02-30", 30, "g_policy"),
      ent("b2", "", "2026-10-05", 30, "g_policy"), ent("b3", "gone", "2026-10-05", 30, "g_policy"), ent("b4", "icu", "2026-10-05", 30, "s_policies"),
      Object.assign(ent("b5", "icu", "2026-10-05", 30, 7), {}), Object.assign(ent("b6", "icu", "2026-10-05", 30, "g_other"), { detail: undefined }),
      Object.assign(ent("b7", "icu", "2026-10-05", 30, "g_other"), { detail: 7 }), Object.assign(ent("b8", "icu", "2026-10-05", 30, "g_other"), { detail: {} }), "junk"
    ];
    const t5 = dstore({ dirEntries: JSON.parse(J(t5list).replace(/null/g, "null")) });
    t5.dirEntries[8].minutes = NaN; t5.dirEntries[9].id = undefined; t5.dirEntries[15].category = 7; t5.dirEntries[16].detail = undefined;
    const q5 = quiet(() => sb.repairData(t5)), E5 = t5.dirEntries, banner5 = q5.seen[0] || "", byId5 = {};
    E5.forEach(e => { byId5[e.id] = e; });
    const pass5 = JSON.parse(J(t5)), q5b = quiet(() => sb.repairData(pass5));
    check("directorships T5: dirEntries repair - minutes coerced/rounded, unreadable or negative dropped LOUDLY by name, 0 and 1441 kept, ids renewed, unknown dirId/category kept, details coerced; 'and N more'",
      byId5.a1 && byId5.a1.minutes === 90 && byId5.a2.minutes === 90 && !byId5.a3 && byId5.a4.minutes === 0 && byId5.a5.minutes === 1441 && !byId5.a6 && !byId5.a7 && !byId5.a8 && !byId5.a9 &&
      E5.filter(e => e.date === "2026-10-03").length === 1 && E5.filter(e => e.id === "a1").length === 1 && E5.filter(e => e.date === "2026-10-04").length === 1 && !byId5.b1 && !byId5.b2 &&
      byId5.b3 && byId5.b4 && byId5.b5.category === "" && byId5.b6.detail === "" && byId5.b7.detail === "7" && byId5.b8.detail === "" && E5.length === 12 &&
      q5.seen.length === 1 && /Directorship time entries ICU 2026-10-02, ICU 2026-10-02, ICU 2026-10-02, ICU 2026-10-02, ICU 2026-10-02 and 3 more were unreadable/.test(banner5) &&
      q5b.r.length === 0 && J(pass5) === J(t5),
      J({ n: E5.length, banner: banner5.slice(0, 260) }));

    // T6 dirHandoff and dirSignatureEnc
    const t6 = dstore({ dirHandoff: { "icu:2026-10": { date: "2026-11-02", entriesHash: "h1-1-00000000000001" }, "bad": { date: "2026-11-02", entriesHash: "x" }, "icu:2026-13": { date: "2026-11-02", entriesHash: "x" },
      "icu:2026-09": { date: "junk", entriesHash: "x" }, "a:b:2026-08": { date: "2026-09-01", entriesHash: "y" }, "gone:2026-07": { date: "2026-08-01", entriesHash: "z" } }, dirSignatureEnc: { ct: "Y3Q=", salt: "c2E=", iv: "aXY=", v: 2 } });
    const q6 = quiet(() => sb.repairData(t6));
    const t6b = dstore({ dirHandoff: [], dirSignatureEnc: { ct: "", salt: "x", iv: "y" } }), q6b = quiet(() => sb.repairData(t6b));
    const t6c = dstore({ dirSignatureEnc: "plain" }), q6c = quiet(() => sb.repairData(t6c));
    check("directorships T6: hand-off records validated per key (bad ones dropped LOUDLY, unknown dirId kept); signature kept when well-formed, else null LOUDLY",
      J(Object.keys(t6.dirHandoff).sort()) === J(["a:b:2026-08", "gone:2026-07", "icu:2026-10"]) && q6.seen.length === 1 && /Hand-off records bad, icu:2026-13, icu:2026-09 were unreadable/.test(q6.seen[0]) &&
      J(t6.dirSignatureEnc) === J({ ct: "Y3Q=", salt: "c2E=", iv: "aXY=", v: 2 }) &&
      J(t6b.dirHandoff) === "{}" && t6b.dirSignatureEnc === null && q6b.seen.length === 1 && /hand-off records were unreadable/.test(q6b.seen[0]) && /signature was unreadable/.test(q6b.seen[0]) &&
      t6c.dirSignatureEnc === null && q6c.seen.length === 1,
      J({ keys: Object.keys(t6.dirHandoff), b: q6.seen }));

    // T7 writer contract: every writer's output passes repairData unchanged.
    const nG = sb.dirNew("genesis", "Pat Doe, MD"), nS = sb.dirNew("select", "Pat Doe, MD");
    const edDraft = { name: "ICU Co\u2013Director \u201CA\u201D", shortName: "ICU", org: "Org", printName: "Pat Doe, MD", form: "genesis", emplNo: "12", costCtr: "34", rate: "$1,200.50", maxHours: "4.5" };
    const ed1 = sb.dirFromEditorDraft([ICU], null, Object.assign({}, edDraft, { name: "Made-up Director" }));
    const ed2 = sb.dirFromEditorDraft(PRESET_SPEC, WC, { name: WC.name, shortName: "W", org: WC.org, printName: WC.printName, form: "select", rate: "215", maxHours: "8", hospital: "H", programType: "P", physicianName: "Pat", contractingParty: "C", remit1: "1 A St", remit2: "Town, ST 00000", glNo: "1-2", hospitalNo: "9" });
    const eB = sb.dirEntryFromDraft({ date: "2026-10-05", minutes: 90, category: "g_meeting", detail: "  CNO   team " }, ICU, sb.dirEntryId(0));
    const rep7 = sb.dirRepeatDraft([ent("r1", "icu", "2026-09-30", 60, "g_policy")], "icu", "2026-10", "2026-10-31").map((d, i) => sb.dirEntryFromDraft(d, ICU, sb.dirEntryId(i)).entry);
    const hm = sb.dirHandoffMark({}, "icu", "2026-10", "2026-11-02", "h1-1-00000000000001"), hc = sb.dirHandoffClear(hm, "icu", "2026-10");
    const prev7 = dstore({ directorships: sb.defaultDirectorships(), dirEntries: [eB.entry], dirHandoff: hm });
    const rm = sb.dirRemove(prev7, "trauma"), rmU = sb.dirRemoveUndo(rm.next, rm), rmU2 = sb.dirRemoveUndo(rmU, rm);
    const undoSave = Object.assign({}, prev7, { dirEntries: sb.payUndoApply(sb.dirEntriesOf(prev7), { remove: [eB.entry.id], restore: [] }) });
    const editOld = Object.assign({}, eB.entry, { minutes: 30 }), editNow = Object.assign({}, prev7, { dirEntries: [editOld] });
    const undoEdit = Object.assign({}, editNow, { dirEntries: sb.payUndoApply(sb.dirEntriesOf(editNow), { remove: [], restore: [eB.entry] }) });
    const undoDel = Object.assign({}, prev7, { dirEntries: sb.payUndoApply([], { remove: [], restore: [eB.entry], at: 0 }) });
    const sigStore = Object.assign({}, prev7, { dirSignatureEnc: { ct: "Y3Q=", salt: "c2E=", iv: "aXY=" } });
    const W7 = [
      ["defaultDirectorships", dstore({ directorships: sb.defaultDirectorships() })], ["dirNew genesis", dstore({ directorships: [nG] })], ["dirNew select", dstore({ directorships: [nS] })],
      ["dirFromEditorDraft new", dstore({ directorships: [ICU, ed1.dir] })], ["dirFromEditorDraft select", dstore({ directorships: [ICU, ed2.dir] })],
      ["dirEntryFromDraft", dstore({ dirEntries: [eB.entry] })], ["repeat confirm", dstore({ dirEntries: rep7 })],
      ["dirHandoffMark", dstore({ dirHandoff: hm })], ["dirHandoffClear", dstore({ dirHandoff: hc })],
      ["dirRestoreBuiltIns", sb.dirRestoreBuiltIns(dstore({ directorships: [] }))], ["dirRestoreBuiltIn", sb.dirRestoreBuiltIn(dstore({ directorships: [ICU] }), "wound")],
      ["dirDropOrphans", sb.dirDropOrphans(dstore({ directorships: [ICU], dirEntries: [eB.entry, ent("o1", "gone", "2026-10-05", 30, "g_policy")], dirHandoff: { "gone:2026-10": { date: "2026-11-01", entriesHash: "h" } } }))],
      ["dirRemove", rm.next], ["dirRemoveUndo", rmU], ["undo save", undoSave], ["undo edit", undoEdit], ["undo delete", undoDel], ["signature stored", sigStore],
      ["signature removed", Object.assign({}, sigStore, { dirSignatureEnc: null })]
    ];
    const bad7 = W7.filter(w => !fixedPt(JSON.parse(J(w[1]))));
    check("directorships T7 CONTRACT: every writer's output (and both undo paths) passes repairData unchanged and validates (" + W7.length + " cases)",
      bad7.length === 0 && ed1.errors.length === 0 && ed2.errors.length === 0 && eB.problems.length === 0 && rep7.length === 1 && rep7.every(Boolean) &&
      J(Object.keys(rep7[0])) === J(["id", "dirId", "date", "minutes", "category", "detail"]) && J(rmU) === J(prev7) && rmU2 === rmU &&
      J(undoEdit.dirEntries) === J([eB.entry]) && J(undoDel.dirEntries) === J([eB.entry]) && J(undoSave.dirEntries) === "[]",
      bad7.map(w => w[0]).join(", "));

    // T8 ids
    const idsE = [], idsD = [];
    for (let i = 0; i < 2000; i++) { idsE.push(sb.dirEntryId(i % 7)); idsD.push(sb.dirNewId()); }
    check("directorships T8: 2000 dirEntryId / dirNewId values are unique, well-formed and colon-free",
      new Set(idsE).size === 2000 && new Set(idsD).size === 2000 && idsE.every(x => /^\d{13}-dir\d+-[a-z0-9]{6}$/.test(x)) && idsD.every(x => /^dir-[a-z0-9]+-[a-z0-9]{6}$/.test(x)));

    // T9 hash
    const H = (list, id, ym) => sb.dirEntriesHash(list, id || "icu", ym || "2026-10");
    const base9 = [ent("h1", "icu", "2026-10-02", 45, "g_policy"), ent("h2", "icu", "2026-10-04", 30, "g_policy"), ent("h3", "trauma", "2026-10-03", 30, "g_policy"), ent("h4", "icu", "2026-09-30", 30, "g_policy")];
    const h0 = H(base9);
    const mod = (i, k, v) => base9.map((e, j) => j === i ? Object.assign({}, e, { [k]: v }) : e);
    const cnoA = [ent("c1", "icu", "2026-10-05", 60, "g_meeting", "cno"), ent("c2", "icu", "2026-10-05", 60, "g_meeting", "CNO")];
    const cnoB = cnoA.slice().reverse();
    const cnoStoreA = withEntries(cnoA, { directorships: [ICU] }), cnoStoreB = withEntries(cnoB, { directorships: [ICU] });
    check("directorships T9: hash h1-n-hex14, deterministic, order/id/other-month independent; changes on any printed field, add, delete; whitespace-only no, case yes; case-only tie is total",
      /^h1-\d+-[0-9a-f]{14}$/.test(h0) && h0 === H(base9.slice().reverse()) && h0 === H(base9.map(e => Object.assign({}, e, { id: e.id + "x" }))) && h0 === H(base9.slice(0, 2)) &&
      H(mod(0, "date", "2026-10-03")) !== h0 && H(mod(0, "category", "g_goals")) !== h0 && H(mod(0, "minutes", 46)) !== h0 &&
      H(base9.concat([ent("h5", "icu", "2026-10-06", 15, "g_goals")])) !== h0 && H(base9.slice(1)) !== h0 && H(base9.concat([base9[0]])) !== h0 &&
      H([ent("d1", "icu", "2026-10-05", 30, "g_other", "Budget")]) === H([ent("d1", "icu", "2026-10-05", 30, "g_other", "  Budget ")]) &&
      H([ent("d1", "icu", "2026-10-05", 30, "g_other", "Budget")]) !== H([ent("d1", "icu", "2026-10-05", 30, "g_other", "budget")]) &&
      H(cnoA) === H(cnoB) && J(sb.dirMonthEntries(cnoA, "icu", "2026-10").map(e => e.detail)) === J(["CNO", "cno"]) &&
      J(sb.dirMonthEntries(cnoB, "icu", "2026-10").map(e => e.detail)) === J(["CNO", "cno"]) &&
      sb.dirFormModel(cnoStoreA, "icu", "2026-10", "2026-11-02").rows.filter(r => r.key === "g_meeting")[0].text === "Meeting with CNO to discuss" &&
      sb.dirFormModel(cnoStoreB, "icu", "2026-10", "2026-11-02").rows.filter(r => r.key === "g_meeting")[0].text === "Meeting with CNO to discuss");

    // T10 status and count
    const st10 = dstore({});
    const S10 = () => sb.dirMonthStatus(st10, "icu", "2026-10").state;
    const s1 = S10(); st10.dirEntries = [ent("s1", "icu", "2026-10-02", 60, "g_policy")]; const s2 = S10();
    st10.dirHandoff = sb.dirHandoffMark({}, "icu", "2026-10", "2026-11-02", sb.dirEntriesHash(st10.dirEntries, "icu", "2026-10")); const s3 = S10(), c3 = sb.dirHandoffCount(st10, "2026-10");
    st10.dirEntries = st10.dirEntries.concat([ent("s2", "icu", "2026-10-03", 30, "g_policy")]); const s4 = S10();
    st10.dirHandoff = sb.dirHandoffMark(st10.dirHandoff, "icu", "2026-10", "2026-11-03", sb.dirEntriesHash(st10.dirEntries, "icu", "2026-10")); const s5 = S10();
    ["trauma", "wound"].forEach(id => { st10.dirHandoff = sb.dirHandoffMark(st10.dirHandoff, id, "2026-10", "2026-11-03", sb.dirEntriesHash(st10.dirEntries, id, "2026-10")); });
    const c6 = sb.dirHandoffCount(st10, "2026-10");
    st10.dirEntries = st10.dirEntries.concat([ent("s3", "wound", "2026-10-03", 30, "s_policies")]); const c7 = sb.dirHandoffCount(st10, "2026-10");
    check("directorships T10: none -> progress -> handed -> changed -> handed again; count counts only handed (a changed month is not done)",
      J([s1, s2, s3, s4, s5]) === J(["none", "progress", "handed", "changed", "handed"]) && J(c3) === J({ done: 1, total: 3 }) && J(c6) === J({ done: 3, total: 3 }) && J(c7) === J({ done: 2, total: 3 }) &&
      J(sb.dirHandoffCount(dstore({}), "2026-10")) === J({ done: 0, total: 3 }));

    // T11 signature pure parts
    const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";
    const realW = sb.window;
    let still = [];
    try {
      sb.window = { RVU_CRYPTO: { getPin: () => "246810" } };
      still = [sb.dirSigStillValid("246810"), sb.dirSigStillValid("135791"), sb.dirSigStillValid(""), sb.dirSigStillValid(null)];
      sb.window = { RVU_CRYPTO: { getPin: () => null } };
      still.push(sb.dirSigStillValid("246810"));
    } finally { sb.window = realW; }
    const ex1 = sb.dirSigExportSize(1800, 420), ex2 = sb.dirSigExportSize(300, 100), ex3 = sb.dirSigExportSize(0, 50);
    check("directorships T11: signature pure parts - precheck, PNG-only plaintext with a size cap, export size contain-fit (never upscaled), PIN binding",
      sb.dirSigPrecheck(null, "1") === "none" && sb.dirSigPrecheck({ ct: "a" }, null) === "locked" && sb.dirSigPrecheck({ ct: "a" }, "1") === "decrypt" &&
      J(sb.dirSigFromPlain(png)) === J({ state: "ok", url: png }) && sb.dirSigFromPlain("data:image/jpeg;base64,/9j/4AA=").state === "unreadable" && sb.dirSigFromPlain("junk").state === "unreadable" &&
      sb.dirSigPngOk("data:image/png;base64," + "A".repeat(sb.DIR_SIG_MAX)) === false && sb.dirSigPngOk(png + " ") === false && sb.dirSigPngOk(7) === false &&
      ex1.w <= 600 && ex1.h <= 200 && Math.abs(ex1.w / ex1.h - 1800 / 420) < 0.02 && J(ex2) === J({ w: 300, h: 100 }) && J(ex3) === J({ w: 0, h: 0 }) &&
      J(still) === J([true, false, false, false, false]),
      J({ ex1: ex1, still: still }));

    // T12 restore note
    const phone12 = dstore({ dirEntries: [ent("p1", "icu", "2026-10-02", 60, "g_policy")], dirSignatureEnc: { ct: "a", salt: "b", iv: "c" } });
    const preBackup = { entries: [], settings: { ratePerRVU: 55 } };
    const n12a = sb.dirRestoreNote(preBackup, phone12), n12b = sb.dirRestoreNote(preBackup, dstore({})), n12c = sb.dirRestoreNote(preBackup, dstore({ directorships: [ICU] }));
    const n12d = sb.dirRestoreNote(Object.assign({}, preBackup, { directorships: [], dirEntries: [ent("q", "icu", "2026-10-01", 5, "g_policy")] }), phone12);
    check("directorships T12: dirRestoreNote - hours and signature parts for a pre-change backup over a preset phone, '' for a clean phone, 'predates' only when the phone's list differs",
      n12a === " WARNING: this backup has no directorship hours - the 1 time entry on this phone will be removed; your saved signature will be removed (draw it again after restoring)." &&
      n12b === "" && n12c === " WARNING: this backup predates directorships - the built-in directorships will replace the ones on this phone." &&
      n12d === " WARNING: your saved signature will be removed (draw it again after restoring).",
      J([n12a, n12b, n12c, n12d]));

    // T13 editor
    const okDraft = { name: "Made-up Lead", shortName: "ML", org: "Org", printName: "Pat Doe, MD", form: "genesis", emplNo: "", costCtr: "", rate: "100", maxHours: "2" };
    const errs = o => sb.dirFromEditorDraft(PRESET_SPEC, null, Object.assign({}, okDraft, o)).errors.map(e => e.field).join();
    const curly = sb.dirFromEditorDraft(PRESET_SPEC, null, Object.assign({}, okDraft, { name: "Lead\u2019s ICU\u2013Group" }));
    const switched = sb.dirFromEditorDraft(PRESET_SPEC, ICU, Object.assign({}, okDraft, { name: ICU.name, form: "select", hospital: "H" }));
    const ents13 = [ent("f1", "icu", "2026-10-02", 60, "g_policy"), ent("f2", "icu", "2026-10-03", 60, "g_policy"), ent("f3", "trauma", "2026-10-03", 60, "g_policy")], ents13Json = J(ents13);
    check("directorships T13: dirNumFromText and dirFromEditorDraft refusals/acceptances; a form switch keeps entries and builds a full Select header",
      sb.dirNumFromText("4.5") === 4.5 && sb.dirNumFromText("$1,720") === 1720 && ["", "0", "-1", "abc", "1e3", null].every(v => sb.dirNumFromText(v) === null) &&
      errs({ name: "" }) === "name" && errs({ name: "A/B" }) === "name" && errs({ printName: ", MD" }) === "printName" && errs({ name: " icu   co-director " }) === "name" &&
      errs({ rate: "0", maxHours: "x" }) === "rate,maxHours" && curly.errors.length === 0 && curly.dir.name === "Lead's ICU-Group" && errs({ name: "Lead \u201CA\u201D" }) === "name" &&
      errs({ printName: "Faraz" }) === "" && switched.errors.length === 0 && switched.dir.form === "select" && switched.dir.selectHeader.hospital === "H" &&
      J(switched.dir.selectHeader.remitAddress) === J(["", ""]) && switched.dir.id === "icu" && J(ents13) === ents13Json &&
      sb.dirFormInUse(ents13, "icu") === 2 && sb.dirFormInUse(ents13, "wound") === 0);

    // T14 calendar
    let mdOk = true;
    for (let y = 2024; y <= 2030; y++) for (let m = 1; m <= 12; m++) if (sb.dirMonthDays(y, m) !== new Date(y, m, 0).getDate()) mdOk = false;
    const wk = ["2026-10-01", "2026-10-07", "2026-10-08", "2026-10-14", "2026-10-15", "2026-10-21", "2026-10-22", "2026-10-28", "2026-10-29", "2026-10-31", "2028-02-29"].map(sb.dirWeekOf);
    check("directorships T14: month lengths (leap years), weeks by day of month, week labels (Feb 2027 W5 blank), month arithmetic and formats",
      mdOk && sb.dirMonthDays(1900, 2) === 28 && sb.dirMonthDays(2000, 2) === 29 && sb.dirMonthDays(2027, 2) === 28 && sb.dirMonthDays(2028, 2) === 29 && sb.dirMonthDays(2100, 2) === 28 && sb.dirMonthDays(2026, 13) === 0 &&
      J(wk) === J([1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 5]) && ["2027-02-29", "2026-09-31", "2026-13-01", "2026-10-1", "junk"].every(x => sb.dirWeekOf(x) === 0) &&
      J(sb.dirWeekRanges("2026-10").map(w => w.label)) === J(["10/1-10/7", "10/8-10/14", "10/15-10/21", "10/22-10/28", "10/29-10/31"]) &&
      J(sb.dirWeekRanges("2027-02").map(w => w.label).slice(3)) === J(["2/22-2/28", ""]) && sb.dirWeekRanges("2028-02")[4].label === "2/29" && sb.dirWeekRanges("2026-09")[4].label === "9/29-9/30" &&
      sb.dirAddMonths("2026-12", 1) === "2027-01" && sb.dirAddMonths("2027-01", -1) === "2026-12" && sb.dirAddMonths("2026-10", -22) === "2024-12" &&
      sb.dirAddMonths("2026-13", 1) === "" && sb.dirAddMonths("junk", 1) === "" && sb.dirAddMonths("2026-10", 1.5) === "" &&
      sb.dirMonthLabel("2026-10") === "October 2026" && sb.dirMD("2026-10-02") === "10/2" && sb.dirMDY("2026-11-02") === "11/2/2026" && sb.dirMDY("2027-01-05") === "1/5/2027");

    // T15 h:mm, T16 decimal hours
    const HM = [[0, "0:00"], [15, "0:15"], [270, "4:30"], [300, "5:00"], [600, "10:00"], [1440, "24:00"], [59, "0:59"], [61, "1:01"]];
    const PH_OK = [[["4", "30"], 270], [["", "15"], 15], [["24", "0"], 1440], [["0", "21"], 21], [["0", "20"], 20]];
    const PH_BAD = [["0", "0"], ["1", "60"], ["24", "1"], ["1", "5.5"], ["-1", "0"], ["abc", ""], ["", ""]];
    check("directorships T15: h:mm format, and the custom-time parser (any whole minute 0:01-24:00; junk refused with a reason)",
      HM.every(t => sb.dirFmtHM(t[0]) === t[1]) && sb.dirFmtHM(-1) === "" && sb.dirFmtHM("x") === "" &&
      PH_OK.every(t => sb.dirParseHM(t[0][0], t[0][1]).min === t[1]) && PH_BAD.every(t => { const r = sb.dirParseHM(t[0], t[1]); return r.min === null && !!r.error; }));
    const DEC = [[480, "8"], [90, "1.5"], [45, "0.75"], [20, "0.33"], [10, "0.17"], [40, "0.67"], [0, "0"], [1, "0.02"], [125, "2.08"], [15, "0.25"], [270, "4.5"]];
    check("directorships T16: decimal hours print with up to 2 places, trailing zeros trimmed", DEC.every(t => sb.dirFmtHours(t[0]) === t[1]), J(DEC.map(t => sb.dirFmtHours(t[0]))));

    // T17 money
    const MON = [[0, "$0.00"], [900, "$900.00"], [1720, "$1,720.00"], [1234567.891, "$1,234,567.89"], [16.005, "$16.01"], [71.666666, "$71.67"], [0.1 + 0.2, "$0.30"], [200, "$200.00"], [53.75, "$53.75"]];
    const capless = Object.assign({}, ICU, { maxHours: 0 }), rateless = Object.assign({}, ICU, { rate: 0 });
    check("directorships T17: money format (no locale), the mask, the capped amount; a missing cap or rate blocks the form",
      MON.every(t => sb.dirMoney(t[0]) === t[1]) && sb.dirMoneyShown(900, false) === sb.fmtDollar(900, false) && sb.dirMoneyShown(900, true) === "$900.00" &&
      sb.dirAmount(270, ICU) === 900 && sb.dirAmount(300, ICU) === 900 && sb.dirAmount(480, WC) === 1720 && sb.dirAmount(510, WC) === 1720 && sb.dirAmount(21, WC) === 75.25 &&
      sb.dirFormModel(dstore({ directorships: [capless] }), "icu", "2026-10", "2026-11-02").flags.some(f => f.code === "cap" && f.level === "block") &&
      sb.dirFormModel(dstore({ directorships: [rateless] }), "icu", "2026-10", "2026-11-02").flags.some(f => f.code === "rate" && f.level === "block"));

    // Trauma Medical Director: 4.25 h a month at $200 (owner, 2026-10-18).
    const TR = PRESET_SPEC[1], mTR = sb.dirFormModel(dstore({ dirEntries: [ent("tr1", "trauma", "2026-10-05", 180, "g_policy"), ent("tr2", "trauma", "2026-10-12", 90, "g_safety")] }), "trauma", "2026-10", "2026-11-02");
    check("directorships T17b: Trauma caps at 4:15 - 4:30 logged prints 4:30, Due $850.00, with the over-cap warning",
      TR.maxHours === 4.25 && sb.dirAmount(255, TR) === 850 && sb.dirAmount(270, TR) === 850 && sb.dirAmount(240, TR) === 800 && mTR.footer.totalHrs === "4:30" && mTR.footer.due === "$850.00" &&
      mTR.flags.some(fl => fl.code === "overCap" && fl.text === "Over the 4:15 monthly cap: the form prints all 4:30; Due counts 4:15."), JSON.stringify(mTR.flags));
    // T18 file names (the exact contract the monthly email task depends on)
    const P18 = dstore({});
    const fnBad = (o) => sb.dirFileNameProblem(dstore({ directorships: [Object.assign({}, ICU, o), PRESET_SPEC[1]] }), Object.assign({}, ICU, o));
    check("directorships T18: the three October 2026 file names are EXACT; surname rule; every file-name problem text; rename note",
      sb.dirFileName(sb.dirById(P18, "icu"), "2026-10") === "Khan - ICU Co-Director Timesheet - 2026-10.pdf" &&
      sb.dirFileName(sb.dirById(P18, "trauma"), "2026-10") === "Khan - Trauma Medical Director Timesheet - 2026-10.pdf" &&
      sb.dirFileName(sb.dirById(P18, "wound"), "2026-10") === "Khan - Wound Care Program Director Timesheet - 2026-10.pdf" &&
      ["Faraz Khan, MD", "Faraz Khan", "Khan"].every(n => sb.dirSurname(n) === "Khan") && sb.dirSurname("  Faraz   Khan ,MD, FACS") === "Khan" &&
      sb.dirSurname("Mary Smith-Jones, DO") === "Smith-Jones" && ["", ", MD", null].every(n => sb.dirSurname(n) === "") &&
      fnBad({ printName: ", MD" }) === "Add a Print Name with a surname in Settings > Directorships." && fnBad({ name: " " }) === "Give this directorship a name in Settings > Directorships." &&
      fnBad({ name: "trauma  MEDICAL director" }) === "Two directorships are named trauma  MEDICAL director - rename one (their files would collide)." &&
      /character file names can't use/.test(fnBad({ name: "ICU/A" })) && /non-ASCII/.test(fnBad({ name: "ICU \u00E9" })) && fnBad({}) === "" &&
      sb.dirFileNameNote(ICU, Object.assign({}, ICU), "2026-10") === "" &&
      sb.dirFileNameNote(ICU, Object.assign({}, ICU, { name: "ICU Director" }), "2026-10") === "The monthly email task finds these PDFs by this exact file name: Khan - ICU Director Timesheet - 2026-10.pdf (was Khan - ICU Co-Director Timesheet - 2026-10.pdf).");

    // T19-T20 ICU model, October 2026
    const icuList = [ent("i1", "icu", "2026-10-04", 30, "g_policy"), ent("i2", "icu", "2026-10-02", 45, "g_policy"), ent("i3", "icu", "2026-10-13", 60, "g_quality"),
      ent("i4", "icu", "2026-10-20", 135, "g_meeting", "CNO"), ent("i5", "trauma", "2026-10-03", 60, "g_policy"), ent("i6", "icu", "2026-09-30", 60, "g_policy")];
    const S19 = dstore({ dirEntries: icuList }), S19json = J(S19), RowsJson = J(sb.DIR_GENESIS_ROWS) + J(sb.DIR_SELECT_ROWS);
    const m19 = sb.dirFormModel(S19, "icu", "2026-10", "2026-11-02"), pol = m19.rows.filter(r => r.key === "g_policy")[0];
    check("directorships T19: ICU October model - shared cell dates + summed duration, weekly totals, Total 4:30, $200.00, $900.00, DFEE, 23 rows, Meeting slots, ok",
      J({ d: pol.cells[0].datesText, u: pol.cells[0].dur }) === J({ d: "10/2, 10/4", u: "1:15" }) && J(m19.weekText) === J(["1:15", "1:00", "2:15", "0:00", "0:00"]) &&
      m19.totalText === "4:30" && m19.footer.rate === "$200.00" && m19.footer.due === "$900.00" && m19.footer.payCode === "DFEE" && m19.overCap === false &&
      m19.generatedText === "11/2/2026" && m19.rows.length === 23 && J(m19.rows.filter(r => r.key === "g_meeting").map(r => r.text)) === J(["Meeting with CNO to discuss", "Meeting with ____ to discuss", "Meeting with ____ to discuss", "Meeting with ____ to discuss"]) &&
      m19.ok === true && m19.header.printName === "Faraz Khan, MD" && m19.header.monthYear === "October 2026" && m19.sig.date === "11/2/2026" &&
      m19.fileName === "Khan - ICU Co-Director Timesheet - 2026-10.pdf" && m19.hash === sb.dirEntriesHash(icuList, "icu", "2026-10"),
      J({ cell: pol.cells[0], weeks: m19.weekText, total: m19.totalText, flags: m19.flags }));
    const m20 = sb.dirFormModel(dstore({ dirEntries: icuList.concat([ent("i7", "icu", "2026-10-27", 30, "g_goals")]) }), "icu", "2026-10", "2026-11-02");
    check("directorships T20: over the cap the form prints 5:00 and Due stays $900.00, with the exact amber warning",
      m20.totalText === "5:00" && m20.footer.due === "$900.00" && m20.overCap === true && m20.ok === true &&
      m20.flags.some(f => f.level === "warn" && f.code === "overCap" && f.text === "Over the 4:30 monthly cap: the form prints all 5:00; Due counts 4:30."));

    // T21 Wound model
    const wList = [ent("w1", "wound", "2026-10-01", 120, "s_policies"), ent("w2", "wound", "2026-10-09", 90, "s_committees"), ent("w3", "wound", "2026-10-16", 90, "s_travel", "Regional wound care committee"),
      ent("w4", "wound", "2026-10-23", 60, "s_staff_ed"), ent("w5", "wound", "2026-10-30", 120, "s_outcomes")];
    const m21 = sb.dirFormModel(dstore({ dirEntries: wList }), "wound", "2026-10", "2026-11-02"), m21f = sb.dirFormModel(dstore({}), "wound", "2027-02", "2027-03-02");
    check("directorships T21: Wound October model - Total Hours 8, $1,720.00, remit lines, weekly totals, row 9 detail, 10 rows; Feb 2027 W5 blank",
      m21.totalText === "8" && m21.header.totalDue === "$1,720.00" && J(m21.header.remit) === J(["1228 E Rusholme St. Suite 3020", "Davenport, IA 52803"]) &&
      J(m21.weekText) === J(["2", "1.5", "1.5", "1", "2"]) && m21.rows[8].detailText === "Regional wound care committee" && m21.rows.length === 10 &&
      m21.header.periodMonth === "OCTOBER" && m21.header.periodYear === "2026" && m21.header.glNo === "150-6700-64931" && m21.ok === true &&
      J(m21.weeks.map(w => w.label)) === J(["10/1-10/7", "10/8-10/14", "10/15-10/21", "10/22-10/28", "10/29-10/31"]) &&
      m21f.weeks[4].label === "" && m21f.weekText[4] === "" && m21f.weekText[3] === "0",
      J({ total: m21.totalText, weeks: m21.weekText, flags: m21.flags }));

    // T22 slots
    const meet = (id, d, det) => ent(id, "icu", d, 30, "g_meeting", det), oth = (id, d, det) => ent(id, "icu", d, 30, "g_other", det);
    const mText = list => sb.dirFormModel(dstore({ dirEntries: list }), "icu", "2026-10", "2026-11-02").rows.filter(r => r.key === "g_meeting").map(r => r.text);
    const oText = list => sb.dirFormModel(dstore({ dirEntries: list }), "icu", "2026-10", "2026-11-02").rows.filter(r => r.key === "g_other").map(r => r.text);
    const reuse = sb.dirFormModel(dstore({ dirEntries: [meet("m1", "2026-10-05", "CNO"), meet("m2", "2026-10-12", "  cno ")] }), "icu", "2026-10", "2026-11-02").rows.filter(r => r.key === "g_meeting")[0];
    const five = sb.dirFormModel(dstore({ dirEntries: ["A", "B", "C", "D", "E"].map((x, i) => meet("f" + i, "2026-10-0" + (i + 1), x)) }), "icu", "2026-10", "2026-11-02");
    check("directorships T22: Other/Meeting slots - first-appearance order, reuse across weeks, overflow combined into the last slot with the exact flag",
      J(mText([meet("a", "2026-10-05", "CNO"), meet("b", "2026-10-06", "Pharmacy"), meet("c", "2026-10-07", "Quality team")])) === J(["Meeting with CNO to discuss", "Meeting with Pharmacy to discuss", "Meeting with Quality team to discuss", "Meeting with ____ to discuss"]) &&
      reuse.text === "Meeting with CNO to discuss" && reuse.cells[0].datesText === "10/5" && reuse.cells[1].datesText === "10/12" &&
      J(five.rows.filter(r => r.key === "g_meeting").map(r => r.text)) === J(["Meeting with A to discuss", "Meeting with B to discuss", "Meeting with C to discuss", "Meeting with D; E to discuss"]) &&
      five.flags.some(f => f.code === "combined" && f.text === "Meeting: 5 different details for 4 lines - the last line combines 2 of them.") &&
      J(five.rows.filter(r => r.key === "g_meeting").map(r => r.cells[0].datesText)) === J(["10/1", "10/2", "10/3", "10/4, 10/5"]) &&
      J(oText(["A", "B", "C", "D", "E"].map((x, i) => oth("o" + i, "2026-10-0" + (i + 1), x)))) === J(["Other: A", "Other: B", "Other: C; D; E"]) &&
      J(mText([meet("x1", "2026-10-05", "B"), meet("x2", "2026-10-03", "A"), meet("x3", "2026-10-05", "C")]).slice(0, 3)) === J(["Meeting with A to discuss", "Meeting with B to discuss", "Meeting with C to discuss"]));

    // T23 cells: every date prints (owner decision 7 default), once each
    const cellOf = (list, key) => sb.dirFormModel(dstore({ dirEntries: list }), "icu", "2026-10", "2026-11-02").rows.filter(r => r.key === key)[0].cells;
    const run = (a, b) => { const out = []; for (let d = a; d <= b; d++) out.push(ent("r" + d, "icu", "2026-10-" + String(d).padStart(2, "0"), 15, "g_policy")); return out; };
    check("directorships T23: date cells list every date comma-joined (no ranges), a date logged twice prints once, storage order never matters",
      cellOf(run(5, 7).concat(run(8, 9)), "g_policy")[0].datesText === "10/5, 10/6, 10/7" && cellOf(run(8, 9), "g_policy")[1].datesText === "10/8, 10/9" &&
      cellOf(run(22, 28), "g_policy")[3].datesText === "10/22, 10/23, 10/24, 10/25, 10/26, 10/27, 10/28" &&
      cellOf([ent("t1", "icu", "2026-10-02", 30, "g_policy"), ent("t2", "icu", "2026-10-02", 15, "g_policy")], "g_policy")[0].datesText === "10/2" &&
      cellOf([ent("t3", "icu", "2026-10-04", 30, "g_policy"), ent("t4", "icu", "2026-10-02", 15, "g_policy")], "g_policy")[0].datesText === "10/2, 10/4");

    // T24 blocks, warns, notes; never mutates inputs or the row constants
    const flagsOf = (list, today, extra) => sb.dirFormModel(dstore(Object.assign({ dirEntries: list }, extra || {})), "icu", "2026-10", today || "2026-11-02").flags.map(f => f.level + ":" + f.code);
    const empty24 = sb.dirFormModel(dstore({}), "icu", "2026-10", "2026-11-02");
    const sel24 = sb.dirFormModel(dstore({ dirEntries: [ent("q1", "wound", "2026-10-01", 20, "s_policies"), ent("q2", "wound", "2026-10-02", 20, "s_policies"), ent("q3", "wound", "2026-10-03", 20, "s_policies")] }), "wound", "2026-10", "2026-11-02");
    check("directorships T24: each block fires alone (unplaced, noDetail, badMinutes, future, fileName); empty month warns but stays ok; Select rounding note; inputs and DIR_* untouched",
      flagsOf([ent("u1", "icu", "2026-10-02", 30, "s_policies")]).indexOf("block:unplaced") !== -1 && flagsOf([ent("u2", "icu", "2026-10-02", 30, "g_other", "  ")]).indexOf("block:noDetail") !== -1 &&
      flagsOf([ent("u3", "icu", "2026-10-02", 0, "g_policy")]).indexOf("block:badMinutes") !== -1 && flagsOf([ent("u4", "icu", "2026-10-20", 30, "g_policy")], "2026-10-15").indexOf("block:future") !== -1 &&
      flagsOf([], "2026-11-02", { directorships: [Object.assign({}, ICU, { printName: "" }), PRESET_SPEC[1], WC] }).indexOf("block:fileName") !== -1 &&
      empty24.ok === true && empty24.flags.some(f => f.code === "empty" && f.level === "warn") && empty24.footer.totalHrs === "0:00" && empty24.footer.due === "$0.00" &&
      J(empty24.weekText) === J(["0:00", "0:00", "0:00", "0:00", "0:00"]) && flagsOf([], "2026-10-20").indexOf("warn:monthOpen") !== -1 &&
      sel24.rows[0].cells[0].dur === "1" && sel24.rows[0].cells[0].datesText === "10/1, 10/2, 10/3" && sel24.flags.every(f => f.code !== "rounded") &&
      sb.dirFormModel(dstore({ dirEntries: [ent("q4", "wound", "2026-10-01", 20, "s_policies")] }), "wound", "2026-10", "2026-11-02").flags.some(f => f.code === "rounded" && f.level === "note") &&
      J(S19) === S19json && J(sb.DIR_GENESIS_ROWS) + J(sb.DIR_SELECT_ROWS) === RowsJson);

    // T25 default month and reminder
    const allDone = ym => { const s = dstore({}); ["icu", "trauma", "wound"].forEach(id => { s.dirHandoff = sb.dirHandoffMark(s.dirHandoff || {}, id, ym, "2026-11-02", sb.dirEntriesHash([], id, ym)); }); return s; };
    const oneChanged = (() => { const s = allDone("2026-10"); s.dirEntries = [ent("z", "icu", "2026-10-02", 30, "g_policy")]; return s; })();
    const WIN = [["2026-10-24", ""], ["2026-10-25", "2026-10"], ["2026-10-31", "2026-10"], ["2026-11-01", "2026-10"], ["2026-11-05", "2026-10"], ["2026-11-06", ""], ["2026-12-25", "2026-12"],
      ["2027-01-05", "2026-12"], ["2027-01-06", ""], ["2027-02-28", "2027-02"], ["2027-03-01", "2027-02"], ["junk", ""]];
    const half = (() => { const s = dstore({}); s.dirHandoff = sb.dirHandoffMark({}, "icu", "2026-10", "2026-11-01", sb.dirEntriesHash([], "icu", "2026-10")); return s; })();
    check("directorships T25: default month (1st-5th = previous until fully handed off), the 25th-5th reminder window, the reminder line text, dismissal and late flag",
      sb.dirDefaultMonth(dstore({}), "2026-11-03") === "2026-10" && sb.dirDefaultMonth(allDone("2026-10"), "2026-11-03") === "2026-11" && sb.dirDefaultMonth(oneChanged, "2026-11-05") === "2026-10" &&
      sb.dirDefaultMonth(dstore({}), "2026-11-06") === "2026-11" && sb.dirDefaultMonth(dstore({ directorships: [] }), "2026-11-03") === "2026-11" && sb.dirDefaultMonth(dstore({}), "2027-01-05") === "2026-12" &&
      WIN.every(t => sb.dirReminderMonth(t[0]) === t[1]) &&
      J(sb.dirReminderLine(half, "2026-10-25", "")) === J({ ym: "2026-10", text: "October directorship forms: 1 of 3 handed off", done: 1, total: 3, late: false }) &&
      sb.dirReminderLine(allDone("2026-10"), "2026-10-25", "") === null && sb.dirReminderLine(half, "2026-10-25", "2026-10") === null &&
      sb.dirReminderLine(dstore({ directorships: [] }), "2026-10-25", "") === null && sb.dirReminderLine(half, "2026-11-01", "").late === true && sb.dirReminderLine(half, "2026-10-20", "") === null,
      J(WIN.map(t => sb.dirReminderMonth(t[0]))));

    // T26 repeat
    const jan = [ent("j1", "icu", "2027-01-15", 30, "g_policy"), ent("j2", "icu", "2027-01-30", 45, "g_policy"), ent("j3", "icu", "2027-01-31", 60, "g_goals"), ent("j4", "trauma", "2027-01-10", 60, "g_policy")], janJson = J(jan);
    const rFeb = sb.dirRepeatDraft(jan, "icu", "2027-02", "2027-12-31"), rFeb28 = sb.dirRepeatDraft(jan.map(e => Object.assign({}, e, { date: e.date.replace("2027", "2028") })), "icu", "2028-02", "2028-12-31");
    const rNov = sb.dirRepeatDraft([ent("n1", "icu", "2026-10-30", 30, "g_policy"), ent("n2", "icu", "2026-10-02", 30, "g_policy"), ent("n3", "icu", "2026-11-02", 30, "g_policy")], "icu", "2026-11", "2026-11-25");
    check("directorships T26: Repeat drafts move to the same day (clamped), flag future and exact duplicates, carry no id, skip other directorships, never mutate",
      J(rFeb.map(d => d.date)) === J(["2027-02-15", "2027-02-28", "2027-02-28"]) && J(rFeb.map(d => d.clamped)) === J([false, true, true]) &&
      J(rFeb28.map(d => d.date)) === J(["2028-02-15", "2028-02-29", "2028-02-29"]) &&
      sb.dirRepeatDraft([ent("y", "icu", "2026-12-31", 30, "g_policy")], "icu", "2027-01", "2027-12-31")[0].date === "2027-01-31" &&
      sb.dirRepeatDraft([ent("y", "icu", "2026-09-30", 30, "g_policy")], "icu", "2026-10", "2026-12-31")[0].date === "2026-10-30" &&
      rNov.length === 2 && rNov.filter(d => d.date === "2026-11-30")[0].future === true && rNov.filter(d => d.date === "2026-11-30")[0].on === false &&
      rNov.filter(d => d.date === "2026-11-02")[0].dup === true && rNov.filter(d => d.date === "2026-11-02")[0].on === false &&
      rFeb.every(d => d.id === undefined && d.dirId === "icu") && J(jan) === janJson);

    // T27 YTD
    const ytd = dstore({ dirEntries: [ent("y1", "icu", "2026-10-05", 300, "g_policy"), ent("y2", "icu", "2026-10-20", 60, "g_policy"), ent("y3", "trauma", "2026-10-06", 60, "g_policy"),
      ent("y4", "wound", "2026-10-07", 510, "s_policies"), ent("y5", "icu", "2026-09-10", 120, "g_policy"), ent("y6", "gone", "2026-10-05", 600, "g_policy"), ent("y7", "icu", "2025-12-31", 60, "g_policy")] });
    const y1 = sb.dirTotalInRange(ytd, "2026-01-01", "2027-01-01", "2026-10-31"), y2 = sb.dirTotalInRange(ytd, "2026-01-01", "2027-01-01", "2026-10-15");
    const twoMonths = sb.dirTotalInRange(dstore({ dirEntries: [ent("t1", "icu", "2026-08-03", 240, "g_policy"), ent("t2", "icu", "2026-09-03", 240, "g_policy")] }), "2026-01-01", "2027-01-01", null);
    const fyJul = dstore({ dirEntries: [ent("j1", "icu", "2026-07-03", 180, "g_policy"), ent("j2", "icu", "2026-07-20", 180, "g_policy")] });
    check("directorships T27: YTD pay - capped per directorship-month, placed entries only, upTo cut, whole months by their 1st (mid-month fiscal start)",
      y1.total === 3220 && y1.entries === 5 && y2.total === 3220 && y2.entries === 4 && twoMonths.total === 1600 &&
      sb.dirTotalInRange(fyJul, "2026-07-15", "2027-07-15", null).entries === 0 && sb.dirTotalInRange(fyJul, "2025-07-15", "2026-07-15", null).total === 900,
      J({ y1: y1, y2: y2, twoMonths: twoMonths }));

    // T28 reminder key
    {
      const realLS = sb.localStorage, writesR = [];
      let okR = false;
      try {
        const memR = {};
        sb.localStorage = { getItem: k => (Object.prototype.hasOwnProperty.call(memR, k) ? memR[k] : null), setItem: (k, v) => { writesR.push(k); memR[k] = String(v); }, removeItem: () => {} };
        const r0 = sb.readDirReminder(); memR["rvu-dir-reminder"] = "junk"; const r1 = sb.readDirReminder();
        const d1 = sb.dismissDirReminder("2026-10"), r2 = sb.readDirReminder();
        sb.localStorage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("full"); }, removeItem: () => {} };
        const r3 = sb.readDirReminder(), d2 = sb.dismissDirReminder("2026-11");
        okR = r0 === "" && r1 === "" && d1 === "2026-10" && r2 === "2026-10" && r3 === "" && d2 === "2026-11" && J(writesR) === J(["rvu-dir-reminder"]) && sb.DIR_REMIND_KEY === "rvu-dir-reminder";
      } finally { sb.localStorage = realLS; }
      check("directorships T28: the reminder key is junk-proof, writes only rvu-dir-reminder, and storage errors never throw", okR, J(writesR));
    }

  // T30: the lazy jsPDF loader, in its own sandbox with a recording document
  // and fake timers (a child node process, because the steps are async).
  {
    const probe30 = String.raw`
      const vm = require("vm"), fs = require("fs");
      const mk = () => {
        const scripts = [], timers = [];
        const head = { appendChild: s => { s.parentNode = head; scripts.push(s); }, removeChild: s => { s.parentNode = null; } };
        const doc = { createElement: () => ({ style: {}, setAttribute: () => {}, appendChild: () => {} }), head: head, body: { appendChild: () => {} }, getElementById: () => null };
        const win = {};
        const ctx = vm.createContext({ console: { log: () => {}, warn: () => {}, error: () => {} }, React: {}, window: win, document: doc,
          localStorage: { getItem: () => null, setItem: () => {}, removeItem: () => {} },
          setTimeout: (fn, ms) => { timers.push({ fn: fn, ms: ms, live: true }); return timers.length - 1; }, clearTimeout: id => { if (timers[id]) timers[id].live = false; } });
        vm.runInContext(fs.readFileSync(process.argv[1], "utf8"), ctx);
        vm.runInContext(fs.readFileSync(process.argv[2], "utf8"), ctx);
        return { ctx: ctx, win: win, js: () => scripts.filter(s => typeof s.src === "string" && s.src.indexOf("jspdf") !== -1), lastTimer: () => timers.filter(t => t.live && t.ms === 15000).pop() };
      };
      const A = mk(), ctx = A.ctx, win = A.win, js = A.js, lastTimer = A.lastTimer;
      const tick = () => new Promise(r => setImmediate(r));
      (async () => {
        const out = {};
        // Removing a timed-out tag does not cancel its script: when it runs
        // late and defines jsPDF, that counts - while jsdelivr is pending...
        const B = mk(), q1 = B.ctx.loadPDF(); let rq1 = "pending";
        q1.then(J => { rq1 = J === B.win.jspdf.jsPDF ? "resolved" : "wrong"; }, e => { rq1 = "rejected:" + e.message; });
        const b0 = B.js()[0]; B.lastTimer().fn(); B.win.jspdf = { jsPDF: function J() {} }; b0.onload();
        await tick(); out.lateCounts = rq1 === "resolved" && B.js().length === 2;
        // ...and when jsdelivr then fails (the error never wins over a loaded library).
        const C = mk(), q2 = C.ctx.loadPDF(); let rq2 = "pending";
        q2.then(() => { rq2 = "resolved"; }, e => { rq2 = "rejected:" + e.message; });
        C.lastTimer().fn(); C.win.jspdf = { jsPDF: function J() {} }; C.js()[1].onerror();
        await tick(); out.errAfterLate = rq2 === "resolved";
        const p1 = ctx.loadPDF(), p2 = ctx.loadPDF();
        out.same = p1 === p2; out.first = js().length === 1 && js()[0].src === "https://unpkg.com/" + ctx.PDF_PATH && js()[0].integrity === ctx.PDF_SRI && js()[0].crossOrigin === "anonymous";
        let r1 = "pending"; p1.then(() => { r1 = "resolved"; }, e => { r1 = "rejected:" + e.message; });
        const s0 = js()[0];
        lastTimer().fn();                                   // unpkg hangs: the timer moves on
        out.second = js().length === 2 && js()[1].src === "https://cdn.jsdelivr.net/npm/" + ctx.PDF_PATH && js()[1].integrity === ctx.PDF_SRI && js()[1].crossOrigin === "anonymous" && s0.parentNode === null;
        s0.onload();                                        // a late unpkg load is ignored
        await tick(); out.lateIgnored = r1 === "pending";
        js()[1].onerror();                                  // jsdelivr fails too
        await tick(); out.friendly = r1 === "rejected:Could not load the PDF library - check your connection and try again.";
        const p3 = ctx.loadPDF();                           // a later tap retries
        out.retry = p3 !== p1 && js().length === 3;
        let r3 = "pending"; p3.then(() => { r3 = "resolved"; }, e => { r3 = "rejected:" + e.message; });
        js()[2].onload();                                   // loaded but no global
        await tick(); out.noInit = r3 === "rejected:The PDF library loaded but did not initialize - try again.";
        const p4 = ctx.loadPDF(); let r4 = "pending"; p4.then(J => { r4 = J === win.jspdf.jsPDF ? "resolved" : "wrong"; }, () => { r4 = "rejected"; });
        win.jspdf = { jsPDF: function J() {} };
        js()[3].onload(); await tick(); out.ok = r4 === "resolved";
        const p5 = ctx.loadPDF(); let r5 = ""; await p5.then(() => { r5 = "cached"; }); out.cached = r5 === "cached" && js().length === 4;
        console.log(JSON.stringify(out));
      })();`;
    let out30 = "";
    try { out30 = require("child_process").execFileSync(process.execPath, ["-e", probe30, path.join(JS_DIR, "cpt-data.js"), path.join(JS_DIR, "utils.js")], { encoding: "utf8" }).trim(); }
    catch (e) { out30 = "error: " + e.message; }
    let o30 = {}; try { o30 = JSON.parse(out30); } catch (e) { o30 = {}; }
    check("directorships T30: loadPDF - one in-flight promise; unpkg then jsdelivr (same SRI, crossOrigin); a hung host times out, a late load without jsPDF is ignored but one WITH jsPDF counts (even if jsdelivr then fails); friendly failure; retry; no-global load rejected; success cached",
      ["same", "first", "second", "lateIgnored", "friendly", "retry", "noInit", "ok", "cached", "lateCounts", "errAfterLate"].every(k => o30[k] === true), out30);
  }
    // T29 restore helpers
    const p29 = dstore({ directorships: [ICU, WC] });
    const r29 = sb.dirRestoreBuiltIn(p29, "trauma"), r29b = sb.dirRestoreBuiltIn(r29, "trauma");
    check("directorships T29: restore-all is a no-op on a non-empty list; restore-one never duplicates; missing built-ins listed; orphans dropped with their hand-offs only",
      sb.dirRestoreBuiltIns(p29) === p29 && J(sb.dirRestoreBuiltIns(dstore({ directorships: [] })).directorships) === J(PRESET_SPEC) &&
      J(sb.dirMissingBuiltIns(p29).map(d => d.id)) === J(["trauma"]) && sb.dirMissingBuiltIns(dstore({ directorships: [] })).length === 0 &&
      r29.directorships.map(d => d.id).join() === "icu,wound,trauma" && r29b === r29 &&
      sb.dirOrphanCount(dstore({ directorships: [ICU], dirEntries: [ent("o1", "gone", "2026-10-02", 30, "g_policy"), ent("o2", "icu", "2026-10-02", 30, "g_policy")] })) === 1 &&
      J(sb.dirDropOrphans(dstore({ directorships: [ICU], dirEntries: [ent("o1", "gone", "2026-10-02", 30, "g_policy"), ent("o2", "icu", "2026-10-02", 30, "g_policy")], dirHandoff: { "gone:2026-10": { date: "2026-11-01", entriesHash: "h" }, "icu:2026-10": { date: "2026-11-01", entriesHash: "h" } } })).dirHandoff) === J({ "icu:2026-10": { date: "2026-11-01", entriesHash: "h" } }));

    // ---- Review fixes (2026-10-18) and the coverage the review found missing ----
    // T31: the signature writers/reader themselves (async; child process like T30).
    {
      const probe31 = String.raw`
        const vm = require("vm"), fs = require("fs");
        const noop = () => {};
        const ctx = vm.createContext({ console: { log: noop, warn: noop, error: noop }, React: {},
          localStorage: { getItem: () => null, setItem: noop, removeItem: noop },
          document: { createElement: () => ({ style: {}, setAttribute: noop, appendChild: noop }), head: { appendChild: noop }, body: { appendChild: noop }, getElementById: () => null } });
        vm.runInContext(fs.readFileSync(process.argv[1], "utf8"), ctx);
        vm.runInContext(fs.readFileSync(process.argv[2], "utf8"), ctx);
        const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==", ENC = { ct: "Q1Q=", salt: "U0E=", iv: "SVY=" };
        let pin = "246810", dec = png, encArgs = null, encMode = "";
        ctx.window = { RVU_CRYPTO: { getPin: () => pin,
          encrypt: (p, t) => { encArgs = [p, t]; if (encMode === "THROW") throw new Error("x"); return encMode === "REJECT" ? Promise.reject(new Error("OperationError")) : encMode === "BAD" ? Promise.resolve({ ct: 1 }) : Promise.resolve({ ct: ENC.ct, salt: ENC.salt, iv: ENC.iv }); },
          decrypt: (p, e) => dec === "REJECT" ? Promise.reject(new Error("OperationError")) : Promise.resolve(dec) } };
        (async () => {
          const out = {}; let store = { keep: 1 }; const upd = f => { store = f(store); };
          out.saveR = await ctx.dirSignatureSave(png, upd);
          out.saved = JSON.stringify(store); out.encArgs = JSON.stringify(encArgs);
          let n = 0; const cnt = f => { n++; };
          out.bad = await ctx.dirSignatureSave("junk", cnt);
          pin = null; out.locked = await ctx.dirSignatureSave(png, cnt); pin = "246810";
          for (const m of ["REJECT", "BAD", "THROW"]) { encMode = m; out["enc" + m] = await ctx.dirSignatureSave(png, cnt).catch(() => "REJECTED"); }
          encMode = "";
          out.noWrite = n === 0;
          out.ok = JSON.stringify(await ctx.dirSignatureLoad(store));
          dec = "junk"; out.junk = JSON.stringify(await ctx.dirSignatureLoad(store));
          dec = "REJECT"; out.rej = JSON.stringify(await ctx.dirSignatureLoad(store)); dec = png;
          pin = null; out.lockedL = JSON.stringify(await ctx.dirSignatureLoad(store)); pin = "246810";
          out.none = JSON.stringify(await ctx.dirSignatureLoad({}));
          console.log(JSON.stringify(out));
        })();`;
      let out31 = "";
      try { out31 = require("child_process").execFileSync(process.execPath, ["-e", probe31, path.join(JS_DIR, "cpt-data.js"), path.join(JS_DIR, "utils.js")], { encoding: "utf8" }).trim(); }
      catch (e) { out31 = "error: " + e.message; }
      let o = {}; try { o = JSON.parse(out31); } catch (e) { o = {}; }
      const P31 = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==", E31 = { ct: "Q1Q=", salt: "U0E=", iv: "SVY=" };
      let rmStore = Object.assign({}, prev7, { dirSignatureEnc: E31 }); sb.dirSignatureRemove(f => { rmStore = f(rmStore); });
      const savedStore = o.saved ? Object.assign({}, prev7, { dirSignatureEnc: JSON.parse(o.saved).dirSignatureEnc }) : null;
      check("directorships T31: dirSignatureSave stores exactly the encrypt result (never the PNG) and is a fixed point; bad/locked never write; encrypt reject/throw/malformed -> 'error', never rejects, never writes; Load ok/unreadable/locked/none with the PIN bound only on ok; Remove writes null",
        o.saveR === "saved" && o.saved === J({ keep: 1, dirSignatureEnc: E31 }) && o.saved.indexOf("data:image") === -1 && o.encArgs === J(["246810", P31]) &&
        o.bad === "bad" && o.locked === "locked" && o.encREJECT === "error" && o.encBAD === "error" && o.encTHROW === "error" && o.noWrite === true &&
        o.ok === J({ state: "ok", url: P31, pin: "246810" }) && o.junk === J({ state: "unreadable", url: "", pin: "" }) && o.rej === J({ state: "unreadable", url: "", pin: "" }) &&
        o.lockedL === J({ state: "locked", url: "", pin: "" }) && o.none === J({ state: "none", url: "", pin: "" }) &&
        !!savedStore && fixedPt(JSON.parse(J(savedStore))) && rmStore.dirSignatureEnc === null && fixedPt(JSON.parse(J(rmStore))),
        out31);
    }

    // G8b: the printed (signed) wording, verbatim - the certification, the attestation and every row text.
    const DIR_CERT_PIN = "CERTIFICATION: By signing this document, the below listed individuals hereby affirm and attest that the Services and the number of hours recorded for such Services set forth herein were performed by Physician as Medical Director and that Physician fully performed all designated duties required during this month.";
    const DIR_ATTEST_PIN = "I hereby attest and certify to the validity and accuracy of the information reported for reimbursement of services rendered.";
    const DIR_GROWS_PIN = [
      ["g_guidelines", "Develop/review guidelines or protocols:"], ["g_oversee", "Oversee department provision of services:"], ["g_orientation", "Orientation or CEU development:"],
      ["g_dept_ed", "Department/professional education & training:"], ["g_community_ed", "Community education development/presentation:"],
      ["g_policy", "Policy/procedure development, review, education, enforcement:"], ["g_safety", "Patient safety call/initiatives:"], ["g_goals", "Departmental goal development:"],
      ["g_budget", "Departmental budget planning & discussion:"], ["g_strategic", "Departmental strategic planning activity:"], ["g_quality", "Quality management plan review:"],
      ["g_ur", "Utilization Review/medical records chart review:"], ["g_supplies", "Evaluate/review supplies, facilities, equipment needs:"], ["g_rules", "Review of rules, regulations, standards, etc:"],
      ["g_research", "Research, planning, recommendations, patient care issues:"], ["g_idg", "IDG meeting (Hospice MD only):"], ["g_other", "Other (details)"], ["g_meeting", "Meeting with ____ to discuss"]
    ];
    const DIR_SROWS_PIN = [
      ["s_policies", "Assist Hospital in formulating and implementing policies, procedures and clinical protocols for the treatment of patients at Hospital who need services under the Program and, along with the Medical Director of Hospital (the \"Medical Director\"), supervise the scheduling and rendering of such services to those patients."],
      ["s_qa_risk", "Assist the Medical Director in formulating and implementing policies for Hospital's quality assurance and risk management programs."],
      ["s_liaison", "Develop and maintain ongoing dialogue, and act as liaison, among the medical personnel of Hospital and administrators of Hospital (including the Medical Director) concerning the functioning of the Program."],
      ["s_outreach", "Assist Hospital in community outreach and education regarding Hospital's services, including, but not limited to, speaking engagements, written articles and interaction with physicians on staff and outside the immediate area to promote Hospital's programs."],
      ["s_committees", "Participate in ad hoc and standing committees of Hospital's medical staff, prepare reports to the Medical Director with respect to the Program and cooperate with the administrators of Hospital, all as necessary to carry out the obligations of the Corporation/Program Director in accordance with this document."],
      ["s_staff_ed", "Participate in clinical education and training of Hospital's employees."],
      ["s_outcomes", "Monitor and report on the medical progress and outcomes of patients treated under the Program."],
      ["s_meetings", "Attend MEC or OIC meetings or other Hospital administration meeting(s) as requested by Hospital's CEO."],
      ["s_travel", "Supplementary Services (when Physician is requested to travel away from Hospital to serve on committees, make presentations and/or attend meetings.) PROVIDE DESCRIPTION OF SERVICES:"],
      ["s_other", "Other Activity. PROVIDE DESCRIPTION OF SERVICES:"]
    ];
    const rowPairs = rows => rows.map(r => [r.key, r.text]);
    check("directorships G8b: printed CERTIFICATION, Select attestation and every Genesis/Select row text pinned verbatim",
      sb.DIR_GENESIS_CERT === DIR_CERT_PIN && sb.DIR_SELECT_ATTEST === DIR_ATTEST_PIN &&
      J(rowPairs(sb.DIR_GENESIS_ROWS)) === J(DIR_GROWS_PIN) && J(rowPairs(sb.DIR_SELECT_ROWS)) === J(DIR_SROWS_PIN),
      J({ cert: sb.DIR_GENESIS_CERT === DIR_CERT_PIN, attest: sb.DIR_SELECT_ATTEST === DIR_ATTEST_PIN, g: rowPairs(sb.DIR_GENESIS_ROWS).filter((p, i) => J(p) !== J(DIR_GROWS_PIN[i])), s: rowPairs(sb.DIR_SELECT_ROWS).filter((p, i) => J(p) !== J(DIR_SROWS_PIN[i])) }));

    // T24b: the flags T24 does not reach (regenerate = decision 6, noHeader, blanks, noDir, the Select over-cap text).
    const ft = (m, code) => m.flags.filter(f => f.code === code).map(f => f.level + ":" + f.text);
    const hoS = dstore({ dirEntries: [ent("h1", "icu", "2026-10-02", 30, "g_policy")] });
    hoS.dirHandoff = sb.dirHandoffMark({}, "icu", "2026-10", "2026-10-03", sb.dirEntriesHash(hoS.dirEntries, "icu", "2026-10"));
    const mHo = sb.dirFormModel(hoS, "icu", "2026-10", "2026-11-02");
    const mNoH = sb.dirFormModel(dstore({ directorships: [ICU, PRESET_SPEC[1], Object.assign({}, WC, { selectHeader: Object.assign({}, WC.selectHeader, { hospital: "" }) })] }), "wound", "2026-10", "2026-11-02");
    const mNoH2 = sb.dirFormModel(dstore({ directorships: [ICU, PRESET_SPEC[1], Object.assign({}, WC, { selectHeader: undefined })] }), "wound", "2026-10", "2026-11-02");
    const mGone = sb.dirFormModel(dstore({}), "gone", "2026-10", "2026-11-02");
    const mSelCap = sb.dirFormModel(dstore({ dirEntries: [ent("w9", "wound", "2026-10-05", 510, "s_policies")] }), "wound", "2026-10", "2026-11-02");
    const NOH = "warn:The Select header details are empty - add them in Settings > Directorships.";
    check("directorships T24b: regenerate (decision 6), noHeader, blanks, noDir and the Select over-cap text are exact",
      J(ft(mHo, "regenerate")) === J(["warn:Handed off 10/3. This form uses today's rate and cap."]) && mHo.ok === true &&
      ft(sb.dirFormModel(dstore({}), "icu", "2026-10", "2026-11-02"), "regenerate").length === 0 &&
      J(ft(mNoH, "noHeader")) === J([NOH]) && J(ft(mNoH2, "noHeader")) === J([NOH]) && ft(mSelCap, "noHeader").length === 0 &&
      J(ft(mHo, "blanks")) === J(["note:Empl # and Cost Ctr. print blank."]) &&
      J(ft(sb.dirFormModel(dstore({ directorships: [Object.assign({}, ICU, { emplNo: "123" }), PRESET_SPEC[1], WC] }), "icu", "2026-10", "2026-11-02"), "blanks")) === J(["note:Cost Ctr. prints blank."]) &&
      J(ft(mGone, "noDir")) === J(["block:This directorship no longer exists."]) && mGone.ok === false &&
      J(ft(mSelCap, "overCap")) === J(["warn:Over the 8 h monthly cap: the form prints all 8.5 hours; the amount counts 8."]) && mSelCap.overCap === true && mSelCap.header.totalDue === "$1,720.00",
      J({ ho: mHo.flags, noH: mNoH.flags, gone: mGone.flags, sel: mSelCap.flags }));

    // T24c: non-ASCII prints as "?" with the chars warn (header, Select detail, Genesis slot fill).
    const ascii24 = s => typeof s === "string" && !/[^\x20-\x7e]/.test(s);
    const charsOf = m => m.flags.filter(f => f.code === "chars").map(f => f.level + ":" + f.text);
    const WCx = Object.assign({}, WC, { selectHeader: Object.assign({}, WC.selectHeader, { hospital: "Saint-\u00C9tienne \u2013 West" }) });
    const sel24x = sb.dirFormModel(dstore({ directorships: [ICU, PRESET_SPEC[1], WCx], dirEntries: [ent("x1", "wound", "2026-10-05", 30, "s_other", "Caf\u00E9 \u00E0 \u2018huddle\u2019")] }), "wound", "2026-10", "2026-11-02");
    const gen24x = sb.dirFormModel(dstore({ directorships: [Object.assign({}, ICU, { emplNo: "N\u00BA 12" }), PRESET_SPEC[1], WC], dirEntries: [ent("x2", "icu", "2026-10-05", 30, "g_meeting", "Pharm\u00E1cy")] }), "icu", "2026-10", "2026-11-02");
    check("directorships T24c: a non-ASCII header field, Select detail and Genesis slot fill print as ? (smart punctuation mapped) with the exact chars warn",
      sel24x.header.hospital === "Saint-?tienne - West" && sel24x.rows.filter(r => r.key === "s_other")[0].detailText === "Caf? ? 'huddle'" &&
      J(charsOf(sel24x)) === J(["warn:3 characters could not print and show as ?."]) && sel24x.ok === true &&
      gen24x.header.emplNo === "N? 12" && gen24x.rows.filter(r => r.key === "g_meeting")[0].text === "Meeting with Pharm?cy to discuss" &&
      J(charsOf(gen24x)) === J(["warn:2 characters could not print and show as ?."]) &&
      [sel24x, gen24x].every(m => ascii24(J(m.header)) && ascii24(J(m.sig)) && m.rows.every(r => ascii24(r.text) && ascii24(r.detailText))),
      J({ sel: charsOf(sel24x), gen: charsOf(gen24x), h: sel24x.header.hospital }));

    // T24d: boundaries - an entry dated today is not future; detail 1-60; non-detail rows store ""; recent pickers.
    const d60 = "A".repeat(sb.DIR_DETAIL_MAX), dr = (cat, det) => sb.dirEntryFromDraft({ date: "2026-10-05", minutes: 30, category: cat, detail: det }, ICU, "e1");
    const rec24 = [ent("k0", "icu", "2026-09-30", 30, "g_goals"), ent("k1", "icu", "2026-10-01", 30, "g_meeting", "CNO"), ent("k2", "trauma", "2026-10-02", 30, "g_safety"), ent("k3", "icu", "2026-10-03", 30, "g_meeting", "Pharmacy"),
      ent("k4", "icu", "2026-10-04", 30, "g_goals"), ent("k5", "icu", "2026-10-05", 30, "g_meeting", "  cno ")];
    check("directorships T24d: an entry dated today is not future (month-end form still ok); 60-char detail kept, 61 refused; a non-detail row stores ''; recent categories/details newest-first and de-duplicated",
      sb.DIR_DETAIL_MAX === 60 && flagsOf([ent("v1", "icu", "2026-10-31", 30, "g_policy")], "2026-10-31").indexOf("block:future") === -1 &&
      sb.dirFormModel(dstore({ dirEntries: [ent("v1", "icu", "2026-10-31", 30, "g_policy")] }), "icu", "2026-10", "2026-10-31").ok === true &&
      (dr("g_other", d60).entry || {}).detail === d60 && dr("g_other", d60 + "B").entry === null && dr("g_other", d60 + "B").problems.join() === "Keep the detail to 60 characters." &&
      (dr("g_policy", "CNO").entry || {}).detail === "" && dr("g_policy", d60 + "B").problems.length === 0 &&
      J(sb.dirRecentCategories(rec24, "icu")) === J(["g_meeting", "g_goals"]) && J(sb.dirRecentCategories(rec24, "wound")) === "[]" &&
      J(sb.dirRecentDetails(rec24, "icu", "g_meeting")) === J(["cno", "Pharmacy"]) && J(sb.dirRecentDetails(rec24, "icu", "g_goals")) === "[]" &&
      J(sb.dirRecentCategories(["g_policy", "g_safety", "g_goals", "g_budget", "g_quality"].map((k, i) => ent("c" + i, "icu", "2026-10-0" + (i + 1), 30, k)), "icu")) === J(["g_quality", "g_budget", "g_goals", "g_safety"]) &&
      J(sb.dirRecentDetails(["A", "B", "C", "D", "E", "F", "G"].map((t, i) => ent("m" + i, "icu", "2026-10-0" + (i + 1), 30, "g_meeting", t)), "icu", "g_meeting")) === J(["G", "F", "E", "D", "C", "B"]));

    // T27b: YTD counts placed entries only (category on the form, minutes 1-1440), also after a form switch.
    const unplaced27 = sb.dirTotalInRange(dstore({ dirEntries: [ent("p1", "icu", "2026-09-10", 120, "g_policy"), ent("p2", "icu", "2026-09-11", 60, "s_policies"), ent("p3", "icu", "2026-09-12", 0, "g_policy"), ent("p4", "icu", "2026-09-13", 1441, "g_policy")] }), "2026-01-01", "2027-01-01", null);
    const c4s = dstore({ directorships: [Object.assign({}, ICU, { form: "select" }), PRESET_SPEC[1], WC], dirEntries: [ent("p5", "icu", "2026-09-10", 120, "g_policy")] });
    check("directorships T27b: YTD leaves out unplaced entries (wrong-form category, 0 or 1441 minutes, a switched form)",
      unplaced27.total === 400 && unplaced27.entries === 1 && sb.dirTotalInRange(c4s, "2026-01-01", "2027-01-01", null).entries === 0, J(unplaced27));

    // T32: the review fixes in the helpers.
    const capDraft = c => sb.dirFromEditorDraft(PRESET_SPEC, null, Object.assign({}, okDraft, { maxHours: c }));
    const tiny = sb.dirFormModel(dstore({ directorships: [Object.assign({}, ICU, { maxHours: 0.005 }), PRESET_SPEC[1], WC] }), "icu", "2026-10", "2026-11-02");
    const twin = dstore({ directorships: [ICU, WC, Object.assign({}, ICU, { id: "dir-x", name: " trauma  MEDICAL director" })] });
    const sigA = { ct: "a", salt: "s1", iv: "i1" }, sigB = { ct: "a", salt: "s2", iv: "i2" };
    const colon = dstore({ directorships: [ICU, Object.assign({}, WC, { id: "c:1", name: "Colon id" })], dirEntries: [ent("c1", "c:1", "2026-10-02", 30, "s_policies")], dirHandoff: { "c:1:2026-10": { date: "2026-11-01", entriesHash: "h" } } });
    const colonQ = quiet(() => sb.repairData(colon));
    const proto = dstore({ directorships: [ICU, Object.assign({}, WC, { id: "constructor", name: "Proto id" })], dirEntries: [ent("pp", "constructor", "2026-10-02", 30, "s_policies")] });
    const protoQ = quiet(() => sb.repairData(proto));
    check("directorships T32: a cap must be whole minutes (4.33 and 0.005 refused; a stored sub-minute cap blocks as not set); a decimal comma is refused, thousands commas kept; Restore never makes a twin; dirSigKey tracks the ciphertext; a ':' id keeps its entries and hand-off; the rename note carries Save's refusal",
      capDraft("4.25").errors.length === 0 && capDraft("4.5").errors.length === 0 && capDraft("8").errors.length === 0 &&
      capDraft("4.33").errors.map(e => e.field + ":" + e.text).join() === "maxHours:Use a cap that is a whole number of minutes (e.g. 4.25 or 4.5)." && capDraft("0.005").errors.length === 1 &&
      sb.dirCapMinutes({ maxHours: 0.005 }) === null && sb.dirCapMinutes({ maxHours: 4.25 }) === 255 && tiny.flags.some(f => f.code === "cap" && f.level === "block") && tiny.ok === false &&
      sb.dirNumFromText("4,25") === null && sb.dirNumFromText("200,50") === null && sb.dirNumFromText("1,72") === null && sb.dirNumFromText("$1,720.50") === 1720.5 && sb.dirNumFromText("12,345,678") === 12345678 &&
      sb.dirRestoreBuiltIn(twin, "trauma") === twin && sb.dirNameTaken(twin, "Trauma Medical Director") === true && sb.dirNameTaken(twin, "Nope") === false &&
      sb.dirSigKey(dstore({ dirSignatureEnc: sigA })) !== sb.dirSigKey(dstore({ dirSignatureEnc: sigB })) && sb.dirSigKey(dstore({})) === "" && sb.dirSigKey(null) === "" &&
      colonQ.r.length === 0 && colon.directorships[1].id === "c:1" && sb.dirOrphanCount(colon) === 0 && sb.dirMonthEntries(colon.dirEntries, "c:1", "2026-10").length === 1 &&
      J(Object.keys(sb.dirDropOrphans(colon).dirHandoff)) === J(["c:1:2026-10"]) &&
      protoQ.r.length === 0 && proto.directorships[1].id === "constructor" && sb.dirOrphanCount(proto) === 0 &&
      /character file names can't use/.test(sb.dirFileNameNote(ICU, Object.assign({}, ICU, { name: "ICU/A" }), "2026-10", P18)) &&
      /non-ASCII/.test(sb.dirFileNameNote(ICU, Object.assign({}, ICU, { name: "ICU \u00E9" }), "2026-10", P18)) &&
      /Two directorships are named/.test(sb.dirFileNameNote(ICU, Object.assign({}, ICU, { name: "trauma  medical director" }), "2026-10", P18)) &&
      sb.dirFileNameNote(ICU, Object.assign({}, ICU, { name: "ICU \u2013 Trauma" }), "2026-10", P18) === "The monthly email task finds these PDFs by this exact file name: Khan - ICU - Trauma Timesheet - 2026-10.pdf (was Khan - ICU Co-Director Timesheet - 2026-10.pdf).",
      J({ cap433: capDraft("4.33").errors, colon: colonQ.r, tinyFlags: tiny.flags.map(f => f.code) }));
  }
}

console.log("");
if (failures.length) {
  console.log("CHECK FAILED (" + failures.length + "): " + failures.join(" | "));
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
