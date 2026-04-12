const {useState,useEffect,useRef,useMemo,useCallback}=React;

const DATA_VERSION = "CY2026-PFS-v1";
const DATA_YEAR = 2026;

// --- Crypto helpers for API key ---
async function getDecryptedApiKey(settings) {
  if (settings.encryptedApiKey) {
    var pin = window.RVU_CRYPTO.getPin();
    if (!pin) return null;
    try { return await window.RVU_CRYPTO.decrypt(pin, settings.encryptedApiKey); } catch(e) { console.warn("Decrypt failed:", e); return null; }
  }
  return settings.apiKey || null; // fallback for unencrypted legacy
}
async function encryptAndStoreApiKey(newKey, updFn) {
  var pin = window.RVU_CRYPTO.getPin();
  if (!pin) { alert("PIN session expired. Please re-lock and unlock."); return; }
  var enc = await window.RVU_CRYPTO.encrypt(pin, newKey);
  updFn(function(prev) { var s = { ...prev.settings, encryptedApiKey: enc, apiKeyLast4: newKey.slice(-4) }; delete s.apiKey; return { ...prev, settings: s }; });
}
function hasApiKey(settings) { return !!(settings.encryptedApiKey || settings.apiKey); }

const CPT_DATABASE_DEFAULT=CMS_RAW.map(function(r){return {code:r[0],desc:r[1],wRVU:r[2],category:r[3],keywords:r[4]||""}});
const buildCPTMap = (db) => { const m = {}; db.forEach(c => { m[c.code] = c; }); return m; };
const buildCategories = (db) => [...new Set(db.map(c => c.category))].sort();

const MODIFIERS = [
  { code: "-22", label: "Increased Complexity", factor: 1.2, desc: "~20% increase" },
  { code: "-50", label: "Bilateral Procedure", factor: 1.5, desc: "150% of base" },
  { code: "-51", label: "Multiple Procedures", factor: 0.5, desc: "50% (2nd+ proc)" },
  { code: "-62", label: "Co-Surgeon", factor: 0.625, desc: "62.5% of base" },
  { code: "-80", label: "Assistant Surgeon", factor: 0.16, desc: "16% of base" },
  { code: "-AS", label: "PA/NP Assistant", factor: 0.135, desc: "13.5% of base" },
  { code: "-59", label: "Distinct Procedural Service", factor: 1.0, desc: "100% (unbundle)" },
  { code: "-78", label: "Return to OR, Related", factor: 0.7, desc: "70% of base" },
  { code: "-79", label: "Unrelated Proc, Postop", factor: 1.0, desc: "100% of base" },
  { code: "-76", label: "Repeat Procedure, Same MD", factor: 1.0, desc: "100% of base" },
  { code: "-77", label: "Repeat Procedure, Diff MD", factor: 1.0, desc: "100% of base" },
];
const MOD_MAP = {}; MODIFIERS.forEach(m => { MOD_MAP[m.code] = m; });

// --- Helpers ---
const fontLink = document.createElement("link");
fontLink.href = "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=JetBrains+Mono:wght@400;500;600&display=swap";
fontLink.rel = "stylesheet";
document.head.appendChild(fontLink);

const fmt = d => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtShort = d => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric" });
const defSettings = () => ({ ratePerRVU: 55, annualGoal: 6000, yearStart: new Date().getFullYear() + "-01-01" });
const defState = () => ({ entries: [], settings: defSettings(), rvuOverrides: {}, favorites: [], institutionData: [], dataVersion: DATA_VERSION });
const SK = "rvu-tracker-data";

function loadData() {
  try {
    var raw = localStorage.getItem(SK);
    if (!raw) return defState();
    var s = JSON.parse(raw);
    var d = { entries: s.entries || [], settings: { ...defSettings(), ...s.settings }, rvuOverrides: s.rvuOverrides || {}, favorites: s.favorites || [], institutionData: s.institutionData || [], dataVersion: s.dataVersion || DATA_VERSION };
    if (validateData(d)) return d;
    console.warn("RVU Tracker: primary data failed validation, trying last-good backup");
    var lg = loadLastGood();
    if (lg && validateData(lg)) return lg;
    return defState();
  } catch(e) {
    console.error("RVU Tracker: loadData error, attempting recovery:", e);
    try {
      var lg2 = loadLastGood();
      if (lg2 && validateData(lg2)) return lg2;
    } catch(e2) {}
    return defState();
  }
}
var _saveGoodCounter = 0;
function saveData(d) {
  try {
    localStorage.setItem(SK, JSON.stringify(d));
    _saveGoodCounter++;
    if (_saveGoodCounter % 5 === 0 && validateData(d)) { saveLastGood(d); }
  } catch(e) { console.error("RVU Tracker: saveData error:", e); }
}
async function loadPersistent() { try { const r = await window.storage.get("rvu-tracker-all"); if (r && r.value) { const p = JSON.parse(r.value); return { entries: p.entries || [], settings: { ...defSettings(), ...p.settings }, rvuOverrides: p.rvuOverrides || {}, favorites: p.favorites || [], institutionData: p.institutionData || [], dataVersion: p.dataVersion || DATA_VERSION }; } } catch {} return null; }
async function savePersistent(d) { try { await window.storage.set("rvu-tracker-all", JSON.stringify(d)); } catch {} }

// Apply user overrides to CPT database and include CMS imported codes
function getDB(overrides) {
  let db = [...CPT_DATABASE_DEFAULT];

  if (overrides && Object.keys(overrides).length > 0) {
    db = db.map(c => overrides[c.code] ? { ...c, wRVU: overrides[c.code] } : c);
  }
  return db;
}

function calcAdj(base, mods) {
  if (!mods || mods.length === 0) return base;
  if (mods.length === 1) { const m = MOD_MAP[mods[0]]; return m ? base * m.factor : base; }
  let r = base; mods.forEach(mc => { const m = MOD_MAP[mc]; if (m) r *= m.factor; }); return r;
}

// --- CSV Parse (same as before) ---
function parseLine(line) { const r = []; let cur = "", inQ = false; for (let i = 0; i < line.length; i++) { const c = line[i]; if (c === '"') inQ = !inQ; else if ((c === ',' || c === '\t') && !inQ) { r.push(cur.trim()); cur = ""; } else cur += c; } r.push(cur.trim()); return r; }
function normH(h) { return h.toLowerCase().replace(/[^a-z0-9]/g, ''); }
function detectCols(headers) {
  const m = { date: -1, cpt: -1, desc: -1, rvu: -1, modifier: -1, notes: -1 };
  const maps = { date: ['date','dos','servicedate','proceduredate','dateofservice','dosdate'], cpt: ['cpt','cptcode','code','procedure','proccode','procedurecode','cptcd'], desc: ['description','desc','proceduredesc','proceduredescription','name','procedurename'], rvu: ['rvu','wrvu','wrvus','rvuvalue','workrvu','totalrvu','totalwrvu','wrvuvalue','rvus'], modifier: ['modifier','modifiers','mod','mods'], notes: ['notes','note','comments','comment','memo'] };
  headers.forEach((h, i) => { const n = normH(h); Object.entries(maps).forEach(([k, vals]) => { if (m[k] === -1 && vals.includes(n)) m[k] = i; }); });
  return m;
}
function parseDate2(val) { if (!val) return new Date().toISOString().slice(0, 10); const c = val.trim(); let x = c.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/); if (x) { const y = x[3].length === 2 ? '20' + x[3] : x[3]; return `${y}-${x[1].padStart(2,'0')}-${x[2].padStart(2,'0')}`; } x = c.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/); if (x) return `${x[1]}-${x[2].padStart(2,'0')}-${x[3].padStart(2,'0')}`; const d = new Date(c); if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10); return new Date().toISOString().slice(0, 10); }
function extractCPT(val) { if (!val) return null; const x = val.replace(/[^0-9]/g, ' ').trim().match(/\b(\d{5})\b/); return x ? x[1] : null; }
function extractMods(val) { if (!val) return []; const known = MODIFIERS.map(m => m.code); const mods = []; (val.match(/[-]?\d{2}/g) || []).forEach(raw => { const c = raw.startsWith('-') ? raw : '-' + raw; if (known.includes(c)) mods.push(c); }); if (/AS/i.test(val)) mods.push('-AS'); return [...new Set(mods)]; }

function parseImport(text, cptMap) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { entries: [], errors: ['Not enough data rows'], mapping: null, headers: [] };
  const headers = parseLine(lines[0]);
  const hNorm = headers.map(h => normH(h));

  // Detect RVU Wallet format: Date, Encounter ID, Reference ID, Location, Codes, Total Work RVUs, Total Adjusted Work RVUs
  let isRVUWallet = false;
  let dateCol = -1, codesCol = -1, refCol = -1, locCol = -1, rvuCol = -1, adjRvuCol = -1;

  hNorm.forEach((h, i) => {
    if (h === 'date' || h === 'dos' || h === 'servicedate' || h === 'dateofservice') dateCol = i;
    if (h === 'codes' || h === 'code') codesCol = i;
    if (h === 'referenceid' || h === 'refid' || h === 'patientid') refCol = i;
    if (h === 'location') locCol = i;
    if (h === 'totalworkrvus' || h === 'totalwrvus' || h === 'workrvus') rvuCol = i;
    if (h === 'totaladjustedworkrvus' || h === 'adjustedrvus' || h === 'adjrvus') adjRvuCol = i;
  });

  // Check if this looks like RVU Wallet format
  if (codesCol >= 0 && (rvuCol >= 0 || adjRvuCol >= 0)) {
    isRVUWallet = true;
  }

  // Also try generic column detection
  const mapping = detectCols(headers);

  if (isRVUWallet) {
    // RVU Wallet parser - handles multi-code rows with inline modifiers
    const entries = [], errors = [];
    let unmatched = 0;

    for (let i = 1; i < lines.length; i++) {
      const cols = parseLine(lines[i]);
      if (cols.length < 3) continue;

      const date = dateCol >= 0 ? parseDate2(cols[dateCol]) : new Date().toISOString().slice(0, 10);
      const ref = refCol >= 0 ? (cols[refCol] || '') : '';
      const loc = locCol >= 0 ? (cols[locCol] || '') : '';
      const codesStr = codesCol >= 0 ? cols[codesCol] : '';
      const totalAdj = adjRvuCol >= 0 ? parseFloat(cols[adjRvuCol]) : 0;

      if (!codesStr.trim()) { errors.push('Row ' + (i+1) + ': No codes'); continue; }

      // Split multiple codes: "19301, 38525-51, 38900"
      const codeItems = codesStr.split(',').map(function(s) { return s.trim(); }).filter(function(s) { return s; });

      codeItems.forEach(function(codeStr, idx) {
        // Parse code and modifier: "38525-51" -> code=38525, mod=-51
        // Also handle: "19303-50", "47562-22", "44005-22"
        var code = '';
        var mods = [];
        var parts = codeStr.split('-');
        code = parts[0].replace(/[^0-9]/g, '');
        
        // Everything after first part is modifiers
        for (var p = 1; p < parts.length; p++) {
          var modStr = parts[p].trim();
          if (modStr) {
            var modCode = '-' + modStr;
            if (MOD_MAP[modCode]) mods.push(modCode);
            else if (modStr === 'LT' || modStr === 'RT') { /* laterality, skip */ }
          }
        }

        if (!code || code.length < 4) return;

        var info = cptMap[code];
        var desc = info ? info.desc : ('CPT ' + code);
        var baseRVU = info ? info.wRVU : 0;
        if (!info) unmatched++;

        var adjustedRVU = calcAdj(baseRVU, mods);

        // Build notes from reference ID and location
        var notes = '';
        if (ref) notes = ref;
        if (loc) notes = notes ? (notes + ' - ' + loc) : loc;

        entries.push({
          id: Date.now().toString() + '-' + i + '-' + idx,
          date: date,
          cptCode: code,
          description: desc,
          category: info ? info.category : 'Imported',
          baseRVU: baseRVU,
          modifiers: mods,
          adjustedRVU: adjustedRVU,
          notes: notes,
          imported: true
        });
      });
    }

    if (unmatched > 0) errors.push(unmatched + ' CPT code(s) not in database');
    return { entries: entries, errors: errors, mapping: { date: dateCol, cpt: codesCol, desc: -1, rvu: rvuCol, modifier: -1, notes: -1 }, headers: headers };
  }

  // Generic CSV parser (non-RVU Wallet format)
  if (mapping.cpt === -1) { var first = parseLine(lines[1]); first.forEach(function(v, i) { if (mapping.cpt === -1 && /^\d{5}$/.test(v.trim())) mapping.cpt = i; }); }
  if (mapping.cpt === -1) return { entries: [], errors: ['Could not detect CPT code column.'], mapping: mapping, headers: headers };
  var entries = [], errors = []; var unmatched2 = 0;
  for (var i = 1; i < lines.length; i++) {
    var cols = parseLine(lines[i]); if (cols.length < 2) continue;
    var code = extractCPT(mapping.cpt >= 0 ? cols[mapping.cpt] : '');
    if (!code) { errors.push('Row ' + (i + 1) + ': No valid CPT code'); continue; }
    var date = mapping.date >= 0 ? parseDate2(cols[mapping.date]) : new Date().toISOString().slice(0, 10);
    var mods = mapping.modifier >= 0 ? extractMods(cols[mapping.modifier]) : [];
    var notes = mapping.notes >= 0 ? (cols[mapping.notes] || '') : '';
    var info = cptMap[code]; var desc = mapping.desc >= 0 ? (cols[mapping.desc] || '') : ''; var base;
    if (info) { desc = desc || info.desc; base = (mapping.rvu >= 0 && cols[mapping.rvu]) ? (parseFloat(cols[mapping.rvu]) || info.wRVU) : info.wRVU; }
    else { unmatched2++; desc = desc || ('CPT ' + code); base = (mapping.rvu >= 0 && cols[mapping.rvu]) ? (parseFloat(cols[mapping.rvu]) || 0) : 0; }
    entries.push({ id: Date.now().toString() + '-' + i, date: date, cptCode: code, description: desc, category: info ? info.category : 'Imported', baseRVU: base, modifiers: mods, adjustedRVU: calcAdj(base, mods), notes: notes, imported: true });
  }
  if (unmatched2 > 0) errors.push(unmatched2 + ' CPT code(s) not in database');
  return { entries: entries, errors: errors, mapping: mapping, headers: headers };
}

// =======================================
// ERROR BOUNDARY & CRASH RECOVERY
// =======================================
var LAST_GOOD_KEY = "rvu-tracker-last-good";

function saveLastGood(d) {
  try { localStorage.setItem(LAST_GOOD_KEY, JSON.stringify(d)); } catch(e) {}
}

function loadLastGood() {
  try { var s = localStorage.getItem(LAST_GOOD_KEY); return s ? JSON.parse(s) : null; } catch(e) { return null; }
}

function validateData(d) {
  if (!d || typeof d !== "object") return false;
  if (!Array.isArray(d.entries)) return false;
  if (!d.settings || typeof d.settings !== "object") return false;
  if (typeof d.settings.ratePerRVU !== "number") return false;
  return true;
}

