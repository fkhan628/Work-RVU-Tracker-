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

// --- Keyword supplement for enhanced search ---
// Maps CPT codes to additional searchable terms (merged at DB build time)
var KEYWORD_SUPPLEMENT = {
  // Soft tissue masses / lipoma
  "21930": "lipoma soft tissue mass subcutaneous tumor back",
  "21931": "lipoma soft tissue mass subcutaneous back flank",
  "21932": "lipoma soft tissue mass subcutaneous back flank medium",
  "21933": "lipoma soft tissue mass subcutaneous back flank large",
  "21552": "lipoma neck soft tissue mass anterior chest",
  "21554": "lipoma neck deep soft tissue tumor",
  "21555": "lipoma neck soft tissue mass anterior chest subcutaneous",
  "21556": "lipoma neck deep subfascial soft tissue tumor large",
  "23071": "lipoma shoulder soft tissue mass",
  "23075": "lipoma shoulder soft tissue mass small",
  "24071": "lipoma arm elbow soft tissue mass",
  "24075": "lipoma arm elbow soft tissue mass small",
  "25071": "lipoma forearm soft tissue mass",
  "25075": "lipoma forearm wrist soft tissue mass small",
  "26111": "lipoma hand soft tissue mass",
  "26115": "lipoma hand soft tissue mass small",
  "27043": "lipoma hip pelvis soft tissue mass",
  "27047": "lipoma hip pelvis soft tissue mass small",
  "27327": "lipoma thigh knee soft tissue mass",
  "27337": "lipoma thigh knee soft tissue mass large",
  "27618": "lipoma leg ankle soft tissue mass",
  "27632": "lipoma leg ankle soft tissue mass large",
  "28039": "lipoma foot toe soft tissue mass",
  "28043": "lipoma foot toe soft tissue mass small",
  // Abdominal wall soft tissue
  "22902": "lipoma abdominal wall soft tissue mass subcutaneous",
  "22903": "lipoma abdominal wall soft tissue mass subcutaneous large",
  "22900": "lipoma abdominal wall deep soft tissue tumor",

  // Component separation / TAR
  "15734": "tar transverse abdominis release component separation myofascial flap abdominal wall reconstruction",
  "15734": "tar transversus abdominis release posterior component separation complex hernia abdominal wall reconstruction",
  "15733": "component separation anterior face head neck myocutaneous flap",
  "49900": "repair abdominal wall component separation",

  // Common shorthand
  "44970": "appy lap appendectomy appendicitis",
  "44950": "appy open appendectomy appendicitis",
  "44960": "appy ruptured perforated appendicitis",
  "47562": "lap chole cholecystectomy gallbladder",
  "47563": "lap chole cholecystectomy gallbladder IOC cholangiogram",
  "47600": "open chole cholecystectomy gallbladder",
  "44005": "lysis adhesions adhesiolysis SBO small bowel obstruction",
  "44180": "lysis adhesions adhesiolysis laparoscopic SBO",
  "49505": "inguinal hernia groin",
  "49507": "inguinal hernia groin incarcerated strangulated",
  "49650": "inguinal hernia laparoscopic TAPP TEP groin",
  "49000": "ex lap exploratory laparotomy",
  "49002": "re-exploration reopen ex lap",
  "36556": "central line CVC IJ subclavian femoral triple lumen",
  "36561": "port mediport chemoport portacath implantable",
  "36590": "port removal mediport chemoport remove",
  "32551": "chest tube thoracostomy pigtail pleural",
  "31600": "trach tracheostomy",
  "44120": "small bowel resection SBR enterectomy",
  "44140": "colectomy colon resection hemicolectomy right left sigmoid",
  "44204": "lap colectomy laparoscopic colon resection hemicolectomy",
  "44205": "lap ileocecectomy right hemicolectomy laparoscopic",
  "44141": "hartmann colostomy colectomy",
  "44640": "hartmann reversal colostomy takedown",
  "44620": "ileostomy takedown reversal closure",
  "44310": "ileostomy creation ostomy",
  "44320": "colostomy creation ostomy",
  "19301": "lumpectomy partial mastectomy breast conserving",
  "19303": "mastectomy simple total breast removal",
  "38525": "axillary lymph node dissection ALND sentinel",
  "38900": "sentinel lymph node biopsy SLNB",
  "38745": "axillary lymph node dissection ALND complete",
  "35301": "CEA carotid endarterectomy",
  "36821": "AV fistula AVF dialysis access creation",
  "36830": "AV graft AVG dialysis access PTFE prosthetic",
  "27590": "AKA above knee amputation transfemoral",
  "27880": "BKA below knee amputation transtibial",
  "27447": "TKA total knee replacement arthroplasty",
  "27130": "THA total hip replacement arthroplasty",
  "10060": "I&D abscess incision drainage simple",
  "10061": "I&D abscess incision drainage complex multiple",
  "46040": "perianal abscess perirectal I&D ischiorectal",
  "46050": "perianal abscess I&D superficial",
  "46260": "hemorrhoidectomy hemorrhoids",
  "46930": "hemorrhoid banding rubber band ligation",
  "46270": "fistulotomy anal fistula",
  "46020": "seton anal fistula",
  "45378": "colonoscopy screening diagnostic",
  "45380": "colonoscopy biopsy",
  "45385": "colonoscopy polypectomy snare polyp",
  "43239": "EGD biopsy upper endoscopy esophagogastroduodenoscopy",
  "43235": "EGD diagnostic upper endoscopy",
  "43644": "gastric bypass RYGB Roux-en-Y bariatric weight loss",
  "43775": "sleeve gastrectomy VSG bariatric weight loss",
  "48150": "whipple pancreaticoduodenectomy pancreas",
  "60240": "thyroidectomy total thyroid",
  "60220": "thyroid lobectomy hemithyroidectomy",
  "49591": "ventral hernia umbilical epigastric small",
  "49593": "ventral hernia incisional medium",
  "49595": "ventral hernia incisional large complex",
  "49082": "paracentesis diagnostic ascites tap",
  "49083": "paracentesis therapeutic ascites drainage",
  "11042": "wound debridement subcutaneous",
  "11043": "wound debridement muscle fascia",
  "12001": "laceration repair simple wound closure suture",
  "12031": "laceration repair intermediate layered wound closure",
  "13100": "laceration repair complex wound closure trunk",
};

const CPT_DATABASE_DEFAULT=CMS_RAW.map(function(r){var kw=r[4]||"";var extra=KEYWORD_SUPPLEMENT[r[0]];if(extra)kw=kw?(kw+" "+extra):extra;return {code:r[0],desc:r[1],wRVU:r[2],category:r[3],keywords:kw}});
const buildCPTMap = (db) => { const m = {}; db.forEach(c => { m[c.code] = c; }); return m; };
const buildCategories = (db) => [...new Set(db.map(c => c.category))].sort();

const MODIFIERS = [
  { code: "-22", label: "Increased Complexity", factor: 1.2, desc: "~20% increase", guide: "Use when work significantly exceeds the usual effort. Requires documentation of specific factors (dense adhesions, morbid obesity, unusual anatomy, prior surgery). Must be substantial - minor extra effort does not qualify." },
  { code: "-26", label: "Professional Component", factor: 1.0, desc: "100% wRVU (PC only)", guide: "Use when billing only for the physician interpretation of a diagnostic test (e.g., reading an imaging study). The technical component (equipment, technician) is billed separately or by the facility." },
  { code: "-50", label: "Bilateral Procedure", factor: 1.5, desc: "150% of base", guide: "Use when the same procedure is performed on both sides of the body in the same operative session (e.g., bilateral inguinal hernia repair, bilateral breast procedures). Do not use for midline structures." },
  { code: "-51", label: "Multiple Procedures", factor: 0.5, desc: "50% (2nd+ proc)", guide: "Apply to the 2nd, 3rd, etc. procedure during the same operative session. The highest-RVU procedure is billed at 100% (no modifier), subsequent procedures get -51. Does not apply to add-on codes." },
  { code: "-62", label: "Co-Surgeon", factor: 0.625, desc: "62.5% of base", guide: "Two surgeons of different specialties each performing a distinct part of the same procedure. Each surgeon bills with -62 and receives 62.5%. Both surgeons must document their specific operative roles." },
  { code: "-80", label: "Assistant Surgeon", factor: 0.16, desc: "16% of base", guide: "Billed by the assistant surgeon when assisting at surgery. The primary surgeon bills without modifier. Common for cases requiring retraction, exposure, or a second pair of hands. Not all procedures allow an assistant." },
  { code: "-59", label: "Distinct Procedural Service", factor: 1.0, desc: "100% (unbundle)", guide: "Use to indicate a procedure is distinct and independent from another on the same date. Separates procedures that would otherwise be bundled (e.g., different anatomic site, separate incision, different encounter). Use sparingly and document clearly." },
  { code: "-78", label: "Return to OR, Related", factor: 0.7, desc: "70% of base", guide: "Unplanned return to the OR for a complication related to the original procedure, during the global period. Only the intraoperative portion of the RVU is paid (70%). Examples: post-op bleeding, wound dehiscence, anastomotic leak." },
  { code: "-79", label: "Unrelated Proc, Postop", factor: 1.0, desc: "100% of base", guide: "Use for a procedure performed during the global period of a prior surgery, but unrelated to the original procedure. Starts a new global period. Example: appendectomy during global period of a prior hernia repair." },
  { code: "-76", label: "Repeat Procedure, Same MD", factor: 1.0, desc: "100% of base", guide: "Same procedure repeated by the same physician on the same day. Examples: repeat I&D at a different time, second bronchoscopy later in the day. Must be medically necessary." },
  { code: "-77", label: "Repeat Procedure, Diff MD", factor: 1.0, desc: "100% of base", guide: "Same procedure repeated by a different physician on the same day. Example: a different surgeon performs a second look laparotomy or takes over a case." },
];
const MOD_MAP = {}; MODIFIERS.forEach(m => { MOD_MAP[m.code] = m; });

// --- Encounter counting ---
// An encounter = unique date + patient combination
// If no encounterId, each entry is its own encounter
function countEncounters(entries) {
  var seen = {};
  var count = 0;
  entries.forEach(function(e) {
    var pid = e.encounterId || e.notes && e.notes.substring(0, 2).trim();
    if (pid && pid.length >= 2) {
      var key = e.date + "|" + pid.toUpperCase();
      if (!seen[key]) { seen[key] = true; count++; }
    } else {
      count++; // no patient ID = count as individual encounter
    }
  });
  return count;
}

// --- Helpers ---
const fontLink = document.createElement("link");
fontLink.href = "https://fonts.googleapis.com/css2?family=DM+Sans:opsz,wght@9..40,300;9..40,400;9..40,500;9..40,600;9..40,700&family=JetBrains+Mono:wght@400;500;600&display=swap";
fontLink.rel = "stylesheet";
document.head.appendChild(fontLink);

const fmt = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtShort = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
function fmtDollar(val, show) { if (!show) return "$\u2022\u2022\u2022\u2022\u2022"; return "$" + val.toLocaleString(undefined, { maximumFractionDigits: 0 }); }
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
function extractMods(val) { if (!val) return []; const known = MODIFIERS.map(m => m.code); const mods = []; (val.match(/[-]?\d{2}/g) || []).forEach(raw => { const c = raw.startsWith('-') ? raw : '-' + raw; if (known.includes(c)) mods.push(c); }); return [...new Set(mods)]; }

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

