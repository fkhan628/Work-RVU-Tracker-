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
check("found 11 js files", jsFiles.length === 11, "got " + jsFiles.length + ": " + jsFiles.join(", "));

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

console.log("");
if (failures.length) {
  console.log("CHECK FAILED (" + failures.length + "): " + failures.join(" | "));
  process.exit(1);
}
console.log("ALL CHECKS PASSED");
