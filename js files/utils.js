// PLAIN SCRIPT - executes during HTML parse, BEFORE every text/babel file.
// Its top-level const/let names (useState, CPT_DATABASE_DEFAULT, MODIFIERS,
// SK, fmt, ...) are global LEXICAL bindings owned at parse time: a babel
// file that later declares any of these names at ITS top level throws
// "Identifier has already been declared" and that whole file dies. Never
// redeclare a utils.js or styles.js top-level name in a component file.
// Also: no JSX may ever be added here - this file is not Babel-transformed.
const {useState,useEffect,useRef,useMemo,useCallback}=React;

const DATA_VERSION = "CY2026-PFS-v1";
const DATA_YEAR = 2026;

var SCAN_ENABLED = false; // AI note scanning (op/clinic/inpatient). OFF by
// default: sends note text to the Anthropic API, which has HIPAA/BAA
// implications - review compliance before setting true. Flip to true to
// re-enable everywhere.

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
  // NOTE: size/depth terms verified against CMS CY2026 PFS official descriptors
  "21930": "lipoma soft tissue mass subcutaneous tumor back flank less than 3cm",
  "21931": "lipoma soft tissue mass subcutaneous back flank 3cm or more",
  "21932": "lipoma soft tissue mass deep subfascial intramuscular back flank less than 5cm",
  "21933": "lipoma soft tissue mass deep subfascial intramuscular back flank 5cm or more",
  "21552": "lipoma neck soft tissue mass anterior chest subcutaneous 3cm or more",
  "21554": "lipoma neck deep subfascial soft tissue tumor 5cm or more",
  "21555": "lipoma neck soft tissue mass anterior chest subcutaneous less than 3cm",
  "21556": "lipoma neck deep subfascial soft tissue tumor less than 5cm",
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
  "15734": "tar transversus abdominis release posterior component separation complex hernia abdominal wall reconstruction myofascial flap",
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

  // Recurrent inguinal hernia
  "49520": "recurrent inguinal hernia groin open",
  "49521": "recurrent inguinal hernia groin incarcerated strangulated open",
  "49651": "recurrent inguinal hernia laparoscopic TAPP TEP groin lap",

  // Recurrent ventral/incisional hernia
  "49613": "recurrent ventral hernia incisional small reducible",
  "49614": "recurrent ventral hernia incisional small incarcerated strangulated",
  "49615": "recurrent ventral hernia incisional medium reducible",
  "49616": "recurrent ventral hernia incisional medium incarcerated strangulated",
  "49617": "recurrent ventral hernia incisional large reducible",
  "49618": "recurrent ventral hernia incisional large incarcerated strangulated",

  // Skin cyst excision (benign lesions by location and size)
  "11400": "skin cyst excision benign lesion trunk extremity subcutaneous epidermal inclusion sebaceous pilar",
  "11401": "skin cyst excision benign lesion trunk extremity",
  "11402": "skin cyst excision benign lesion trunk extremity",
  "11403": "skin cyst excision benign lesion trunk extremity",
  "11404": "skin cyst excision benign lesion trunk extremity",
  "11406": "skin cyst excision benign lesion trunk extremity large",
  "11420": "skin cyst excision benign lesion scalp neck hands feet",
  "11421": "skin cyst excision benign lesion scalp neck hands feet",
  "11422": "skin cyst excision benign lesion scalp neck hands feet",
  "11423": "skin cyst excision benign lesion scalp neck hands feet",
  "11424": "skin cyst excision benign lesion scalp neck hands feet",
  "11426": "skin cyst excision benign lesion scalp neck hands feet large",
  "11440": "skin cyst excision benign lesion face ears eyelids nose lips",
  "11441": "skin cyst excision benign lesion face",
  "11442": "skin cyst excision benign lesion face",
  "11443": "skin cyst excision benign lesion face",
  "11444": "skin cyst excision benign lesion face",
  "11446": "skin cyst excision benign lesion face large",
};

// --- Friendly plain-language labels for common procedures ---
// Keyed by CPT code. Shown as the PRIMARY description in the UI; the official
// CMS short descriptor stays visible as secondary text. Display-only: saved
// entries and CSV/Excel exports keep the official descriptor.
// ACCURACY RULE: every label must match the official CPT definition exactly
// (site, depth, size cutoff) - verified against CMS 2026/PPRRVU2026_Jan.
// MUST be defined above CPT_DATABASE_DEFAULT (var hoisting).
var FRIENDLY_DESC = {
  // Soft tissue tumor excision (lipoma) - subcutaneous vs deep, by site and size
  "21930": "Lipoma / soft tissue tumor excision - back/flank, subcut, under 3 cm",
  "21931": "Lipoma / soft tissue tumor excision - back/flank, subcut, 3 cm or larger",
  "21932": "Lipoma / soft tissue tumor excision - back/flank, deep (subfascial/intramuscular), under 5 cm",
  "21933": "Lipoma / soft tissue tumor excision - back/flank, deep (subfascial/intramuscular), 5 cm or larger",
  "21555": "Lipoma / soft tissue tumor excision - neck/anterior chest, subcut, under 3 cm",
  "21552": "Lipoma / soft tissue tumor excision - neck/anterior chest, subcut, 3 cm or larger",
  "21556": "Lipoma / soft tissue tumor excision - neck/anterior chest, deep (subfascial), under 5 cm",
  "21554": "Lipoma / soft tissue tumor excision - neck/anterior chest, deep (subfascial), 5 cm or larger",
  "22902": "Lipoma / soft tissue tumor excision - abdominal wall, subcut, under 3 cm",
  "22903": "Lipoma / soft tissue tumor excision - abdominal wall, subcut, 3 cm or larger",
  "22900": "Lipoma / soft tissue tumor excision - abdominal wall, deep (subfascial), under 5 cm",
  "22901": "Lipoma / soft tissue tumor excision - abdominal wall, deep (subfascial), 5 cm or larger",
  "23075": "Lipoma / soft tissue tumor excision - shoulder, subcut, under 3 cm",
  "23071": "Lipoma / soft tissue tumor excision - shoulder, subcut, 3 cm or larger",
  "24075": "Lipoma / soft tissue tumor excision - upper arm/elbow, subcut, under 3 cm",
  "24071": "Lipoma / soft tissue tumor excision - upper arm/elbow, subcut, 3 cm or larger",
  "25075": "Lipoma / soft tissue tumor excision - forearm/wrist, subcut, under 3 cm",
  "25071": "Lipoma / soft tissue tumor excision - forearm/wrist, subcut, 3 cm or larger",
  "25073": "Lipoma / soft tissue tumor excision - forearm/wrist, deep (subfascial/intramuscular), 3 cm or larger",
  "26115": "Lipoma / soft tissue tumor excision - hand/finger, subcut, under 1.5 cm",
  "26111": "Lipoma / soft tissue tumor excision - hand/finger, subcut, 1.5 cm or larger",
  "27047": "Lipoma / soft tissue tumor excision - hip/pelvis, subcut, under 3 cm",
  "27043": "Lipoma / soft tissue tumor excision - hip/pelvis, subcut, 3 cm or larger",
  "27045": "Lipoma / soft tissue tumor excision - hip/pelvis, deep (subfascial/intramuscular), 5 cm or larger",
  "27327": "Lipoma / soft tissue tumor excision - thigh/knee, subcut, under 3 cm",
  "27337": "Lipoma / soft tissue tumor excision - thigh/knee, subcut, 3 cm or larger",
  "27618": "Lipoma / soft tissue tumor excision - lower leg/ankle, subcut, under 3 cm",
  "27632": "Lipoma / soft tissue tumor excision - lower leg/ankle, subcut, 3 cm or larger",
  "28043": "Lipoma / soft tissue tumor excision - foot/toe, subcut, under 1.5 cm",
  "28039": "Lipoma / soft tissue tumor excision - foot/toe, subcut, 1.5 cm or larger",
  "21011": "Lipoma / soft tissue tumor excision - face/scalp, subcut, under 2 cm",
  "21012": "Lipoma / soft tissue tumor excision - face/scalp, subcut, 2 cm or larger",
  "21013": "Lipoma / soft tissue tumor excision - face/scalp, deep (subfascial), under 2 cm",
  "21014": "Lipoma / soft tissue tumor excision - face/scalp, deep (subfascial), 2 cm or larger",

  // Benign skin lesion / cyst excision - size is EXCISED diameter incl margins
  "11400": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - trunk/arm/leg, excised 0.5 cm or less incl margins",
  "11401": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - trunk/arm/leg, excised 0.6-1 cm incl margins",
  "11402": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - trunk/arm/leg, excised 1.1-2 cm incl margins",
  "11403": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - trunk/arm/leg, excised 2.1-3 cm incl margins",
  "11404": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - trunk/arm/leg, excised 3.1-4 cm incl margins",
  "11406": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - trunk/arm/leg, excised over 4 cm incl margins",
  "11420": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - scalp/neck/hand/foot/genitalia, excised 0.5 cm or less incl margins",
  "11421": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - scalp/neck/hand/foot/genitalia, excised 0.6-1 cm incl margins",
  "11422": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - scalp/neck/hand/foot/genitalia, excised 1.1-2 cm incl margins",
  "11423": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - scalp/neck/hand/foot/genitalia, excised 2.1-3 cm incl margins",
  "11424": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - scalp/neck/hand/foot/genitalia, excised 3.1-4 cm incl margins",
  "11426": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - scalp/neck/hand/foot/genitalia, excised over 4 cm incl margins",
  "11440": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - face/ear/eyelid/nose/lip/mucosa, excised 0.5 cm or less incl margins",
  "11441": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - face/ear/eyelid/nose/lip/mucosa, excised 0.6-1 cm incl margins",
  "11442": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - face/ear/eyelid/nose/lip/mucosa, excised 1.1-2 cm incl margins",
  "11443": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - face/ear/eyelid/nose/lip/mucosa, excised 2.1-3 cm incl margins",
  "11444": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - face/ear/eyelid/nose/lip/mucosa, excised 3.1-4 cm incl margins",
  "11446": "Benign skin lesion excision (sebaceous/epidermal cyst, etc.) - face/ear/eyelid/nose/lip/mucosa, excised over 4 cm incl margins",

  // Malignant skin lesion excision - size is EXCISED diameter incl margins
  "11600": "Malignant skin lesion excision - trunk/arm/leg, excised 0.5 cm or less incl margins",
  "11601": "Malignant skin lesion excision - trunk/arm/leg, excised 0.6-1 cm incl margins",
  "11602": "Malignant skin lesion excision - trunk/arm/leg, excised 1.1-2 cm incl margins",
  "11603": "Malignant skin lesion excision - trunk/arm/leg, excised 2.1-3 cm incl margins",
  "11604": "Malignant skin lesion excision - trunk/arm/leg, excised 3.1-4 cm incl margins",
  "11606": "Malignant skin lesion excision - trunk/arm/leg, excised over 4 cm incl margins",
  "11620": "Malignant skin lesion excision - scalp/neck/hand/foot/genitalia, excised 0.5 cm or less incl margins",
  "11621": "Malignant skin lesion excision - scalp/neck/hand/foot/genitalia, excised 0.6-1 cm incl margins",
  "11622": "Malignant skin lesion excision - scalp/neck/hand/foot/genitalia, excised 1.1-2 cm incl margins",
  "11623": "Malignant skin lesion excision - scalp/neck/hand/foot/genitalia, excised 2.1-3 cm incl margins",
  "11624": "Malignant skin lesion excision - scalp/neck/hand/foot/genitalia, excised 3.1-4 cm incl margins",
  "11626": "Malignant skin lesion excision - scalp/neck/hand/foot/genitalia, excised over 4 cm incl margins",
  "11640": "Malignant skin lesion excision - face/ear/eyelid/nose/lip, excised 0.5 cm or less incl margins",
  "11641": "Malignant skin lesion excision - face/ear/eyelid/nose/lip, excised 0.6-1 cm incl margins",
  "11642": "Malignant skin lesion excision - face/ear/eyelid/nose/lip, excised 1.1-2 cm incl margins",
  "11643": "Malignant skin lesion excision - face/ear/eyelid/nose/lip, excised 2.1-3 cm incl margins",
  "11644": "Malignant skin lesion excision - face/ear/eyelid/nose/lip, excised 3.1-4 cm incl margins",
  "11646": "Malignant skin lesion excision - face/ear/eyelid/nose/lip, excised over 4 cm incl margins",

  // Pilonidal
  "11770": "Pilonidal cyst/sinus excision - simple",
  "11771": "Pilonidal cyst/sinus excision - extensive",
  "11772": "Pilonidal cyst/sinus excision - complicated",
  "10080": "Pilonidal cyst/abscess I&D - simple",
  "10081": "Pilonidal cyst/abscess I&D - complicated",

  // Incision & drainage
  "10060": "Skin abscess I&D - simple or single",
  "10061": "Skin abscess I&D - complicated or multiple",
  "10140": "Hematoma / seroma / fluid collection I&D",

  // Hidradenitis
  "11450": "Hidradenitis excision - axilla, simple/intermediate repair",
  "11451": "Hidradenitis excision - axilla, complex repair",
  "11462": "Hidradenitis excision - inguinal, simple/intermediate repair",
  "11463": "Hidradenitis excision - inguinal, complex repair",
  "11470": "Hidradenitis excision - perianal/perineal/umbilical, simple/intermediate repair",
  "11471": "Hidradenitis excision - perianal/perineal/umbilical, complex repair",
};

// =======================================
// GLOBAL SURGERY DAYS - one source: the 6th CMS_RAW element, which
// scripts/build-cpt-data.js copies from the CMS PFS "GLOB DAYS" column.
// "000"/"010"/"090" = global days. "ZZZ" = add-on code: no global of its
// own; included in the primary service's global period, if it has one.
// "XXX" = global concept does not apply; "YYY" = the MAC sets the global;
// "MMM" = maternity. Never type codes in this section: check.js refuses
// code literals between here and COMPANION_CODES.
// =======================================
var GLOBAL_DAYS = (function() {
  var map = {};
  CMS_RAW.forEach(function(r) { if (typeof r[5] === "string" && r[5]) map[r[0]] = r[5]; });
  return map;
})();

// Chip text: "0-day" / "10-day" / "90-day" / "add-on"; "" (no chip) for XXX,
// YYY, MMM and custom or unknown codes. Looked up at render time - never
// stored on entries - so a CMS change relabels past rows too.
function getGlobalDays(code) {
  var g = code ? GLOBAL_DAYS[code] : "";
  if (g === "000") return "0-day";
  if (g === "010") return "10-day";
  if (g === "090") return "90-day";
  if (g === "ZZZ") return "add-on";
  return "";
}
// Chip colors are theme tokens (styles.js --global-90/10/0), readable in
// both light and dark mode.
function getGlobalColor(code) {
  var g = code ? GLOBAL_DAYS[code] : "";
  if (g === "090") return "var(--global-90)";
  if (g === "010") return "var(--global-10)";
  return "var(--global-0)"; // 0-day and add-on
}

// =======================================
// COMPANION CODE SUGGESTIONS
// Maps CPT codes to commonly paired codes with labels
// =======================================
var COMPANION_CODES = {
  // Skin lesion excision -> closure codes
  "11400": [{ code: "12031", label: "Intermediate closure" }, { code: "13100", label: "Complex closure" }],
  "11401": [{ code: "12031", label: "Intermediate closure" }, { code: "13100", label: "Complex closure" }],
  "11402": [{ code: "12032", label: "Intermediate closure" }, { code: "13101", label: "Complex closure" }],
  "11403": [{ code: "12032", label: "Intermediate closure" }, { code: "13101", label: "Complex closure" }],
  "11404": [{ code: "12034", label: "Intermediate closure" }, { code: "13101", label: "Complex closure" }],
  "11406": [{ code: "12035", label: "Intermediate closure" }, { code: "13101", label: "Complex closure" }],
  "11420": [{ code: "12041", label: "Intermediate closure" }, { code: "13131", label: "Complex closure" }],
  "11421": [{ code: "12041", label: "Intermediate closure" }, { code: "13131", label: "Complex closure" }],
  "11422": [{ code: "12042", label: "Intermediate closure" }, { code: "13132", label: "Complex closure" }],
  "11423": [{ code: "12042", label: "Intermediate closure" }, { code: "13132", label: "Complex closure" }],
  "11424": [{ code: "12044", label: "Intermediate closure" }, { code: "13132", label: "Complex closure" }],
  "11426": [{ code: "12045", label: "Intermediate closure" }, { code: "13132", label: "Complex closure" }],
  "11440": [{ code: "12051", label: "Intermediate closure" }, { code: "13151", label: "Complex closure" }],
  "11441": [{ code: "12051", label: "Intermediate closure" }, { code: "13151", label: "Complex closure" }],
  "11442": [{ code: "12052", label: "Intermediate closure" }, { code: "13152", label: "Complex closure" }],
  "11443": [{ code: "12053", label: "Intermediate closure" }, { code: "13152", label: "Complex closure" }],
  "11444": [{ code: "12054", label: "Intermediate closure" }, { code: "13152", label: "Complex closure" }],
  "11446": [{ code: "12055", label: "Intermediate closure" }, { code: "13152", label: "Complex closure" }],
  // Malignant excision -> closure
  "11600": [{ code: "12031", label: "Intermediate closure" }, { code: "13100", label: "Complex closure" }],
  "11601": [{ code: "12031", label: "Intermediate closure" }, { code: "13100", label: "Complex closure" }],
  "11602": [{ code: "12032", label: "Intermediate closure" }, { code: "13101", label: "Complex closure" }],
  "11603": [{ code: "12032", label: "Intermediate closure" }, { code: "13101", label: "Complex closure" }],
  "11604": [{ code: "12034", label: "Intermediate closure" }, { code: "13101", label: "Complex closure" }],
  "11606": [{ code: "12035", label: "Intermediate closure" }, { code: "13101", label: "Complex closure" }],
  "11620": [{ code: "12041", label: "Intermediate closure" }, { code: "13131", label: "Complex closure" }],
  "11621": [{ code: "12041", label: "Intermediate closure" }, { code: "13131", label: "Complex closure" }],
  "11622": [{ code: "12042", label: "Intermediate closure" }, { code: "13132", label: "Complex closure" }],
  "11623": [{ code: "12042", label: "Intermediate closure" }, { code: "13132", label: "Complex closure" }],
  "11624": [{ code: "12044", label: "Intermediate closure" }, { code: "13132", label: "Complex closure" }],
  "11626": [{ code: "12045", label: "Intermediate closure" }, { code: "13132", label: "Complex closure" }],
  "11640": [{ code: "12051", label: "Intermediate closure" }, { code: "13151", label: "Complex closure" }],
  "11641": [{ code: "12051", label: "Intermediate closure" }, { code: "13151", label: "Complex closure" }],
  "11642": [{ code: "12052", label: "Intermediate closure" }, { code: "13152", label: "Complex closure" }],
  "11643": [{ code: "12053", label: "Intermediate closure" }, { code: "13152", label: "Complex closure" }],
  "11644": [{ code: "12054", label: "Intermediate closure" }, { code: "13152", label: "Complex closure" }],
  "11646": [{ code: "12055", label: "Intermediate closure" }, { code: "13152", label: "Complex closure" }],
  // Soft tissue / lipoma excision -> closure
  "21930": [{ code: "12031", label: "Intermediate closure" }, { code: "13100", label: "Complex closure" }],
  "21931": [{ code: "12032", label: "Intermediate closure" }, { code: "13101", label: "Complex closure" }],
  "21932": [{ code: "12034", label: "Intermediate closure" }, { code: "13101", label: "Complex closure" }],
  "21933": [{ code: "12035", label: "Intermediate closure" }, { code: "13101", label: "Complex closure" }],
  // Mastectomy -> SLNB, ALND
  "19301": [{ code: "38900", label: "Sentinel node" }, { code: "38525", label: "Axillary dissection" }, { code: "19283", label: "Breast localization" }],
  "19302": [{ code: "38900", label: "Sentinel node" }],
  "19303": [{ code: "38900", label: "Sentinel node" }, { code: "38745", label: "Axillary dissection" }],
  "19307": [{ code: "38900", label: "Sentinel node" }],
  // Breast biopsy -> localization
  "19081": [{ code: "19281", label: "Localization" }],
  "19083": [{ code: "19285", label: "US localization" }],
  "19120": [{ code: "38900", label: "Sentinel node" }, { code: "19281", label: "Localization" }],
  "19125": [{ code: "38900", label: "Sentinel node" }],
  // SLNB -> ALND
  "38900": [{ code: "38525", label: "Axillary dissection" }],
  // Cholecystectomy -> IOC
  "47562": [{ code: "47563", label: "With cholangiogram" }],
  // Colectomy -> mobilization, ileostomy
  "44204": [{ code: "44213", label: "Splenic flexure" }, { code: "44187", label: "Ileostomy" }],
  "44205": [{ code: "44213", label: "Splenic flexure" }],
  "44206": [{ code: "44213", label: "Splenic flexure" }],
  "44207": [{ code: "44213", label: "Splenic flexure" }, { code: "44187", label: "Ileostomy" }],
  "44140": [{ code: "44139", label: "Mobilization colon" }, { code: "44310", label: "Ileostomy" }],
  "44141": [{ code: "44139", label: "Mobilization colon" }],
  "44143": [{ code: "44139", label: "Mobilization colon" }],
  "44144": [{ code: "44139", label: "Mobilization colon" }],
  "44145": [{ code: "44139", label: "Mobilization colon" }, { code: "44310", label: "Ileostomy" }],
  "44150": [{ code: "44310", label: "Ileostomy" }],
  // Hernia -> mesh (component separation)
  "49595": [{ code: "15734", label: "TAR/component sep" }, { code: "49568", label: "Mesh implant" }],
  "49617": [{ code: "15734", label: "TAR/component sep" }],
  "49618": [{ code: "15734", label: "TAR/component sep" }],
  // Appendectomy with abscess
  "44970": [{ code: "49320", label: "Diagnostic lap" }],
  "44960": [{ code: "49062", label: "Perc drain abscess" }],
  // Small bowel resection -> additional resection
  "44120": [{ code: "44121", label: "Addl SB resection" }],
  "44202": [{ code: "44203", label: "Addl SB resection" }],
  // Ex-lap -> adhesiolysis
  "49000": [{ code: "44005", label: "Adhesiolysis" }, { code: "44310", label: "Ileostomy" }, { code: "44320", label: "Colostomy" }],
  // Thyroidectomy
  "60240": [{ code: "60220", label: "Lobectomy" }, { code: "38900", label: "Sentinel node" }],
  "60220": [{ code: "60240", label: "Total thyroidectomy" }],
  // CEA
  "35301": [{ code: "35390", label: "Patch closure" }],
  // AV fistula / graft
  "36821": [{ code: "36831", label: "Thrombectomy" }],
  "36830": [{ code: "36831", label: "Thrombectomy" }],
  // Central line -> US guidance
  "36556": [{ code: "76937", label: "US guidance" }],
  "36555": [{ code: "76937", label: "US guidance" }],
  "36561": [{ code: "76937", label: "US guidance" }, { code: "77001", label: "Fluoro guidance" }],
  // Debridement -> add-on sizes
  "11042": [{ code: "11045", label: "Addl 20 sq cm" }],
  "11043": [{ code: "11046", label: "Addl 20 sq cm" }],
  // Paracentesis / thoracentesis
  "49083": [{ code: "76942", label: "US guidance" }],
  "32554": [{ code: "76942", label: "US guidance" }],
  "32555": [{ code: "76942", label: "US guidance" }],
  // Endoscopy + biopsy
  "43235": [{ code: "43239", label: "EGD w/biopsy" }],
  "45378": [{ code: "45380", label: "Colonoscopy w/bx" }, { code: "45385", label: "Snare polypectomy" }],
  // I&D -> packing
  "10060": [{ code: "10061", label: "Complex I&D" }],
  // Hemorrhoidectomy + fissurectomy
  "46260": [{ code: "46261", label: "With fissurectomy" }, { code: "46262", label: "With fistulectomy" }],
  // Wound repair -> debridement
  "12031": [{ code: "11042", label: "Debridement subq" }],
  "12032": [{ code: "11042", label: "Debridement subq" }],
  "13100": [{ code: "11042", label: "Debridement subq" }, { code: "11043", label: "Debridement muscle" }],
  // Gastric bypass -> liver biopsy
  "43644": [{ code: "47100", label: "Liver bx wedge" }, { code: "47000", label: "Liver bx needle" }, { code: "43775", label: "Sleeve gastrectomy" }],
  "43775": [{ code: "47100", label: "Liver bx wedge" }, { code: "47000", label: "Liver bx needle" }],
  // Whipple
  "48150": [{ code: "47564", label: "Chole w/CBD explore" }],
  // Inguinal hernia bilateral
  "49505": [{ code: "49505", label: "Bilateral (mod -50)" }],
  "49650": [{ code: "49650", label: "Bilateral (mod -50)" }],
  // Port removal + new port
  "36590": [{ code: "36561", label: "New port placement" }],
  // Colostomy reversal
  "44640": [{ code: "44005", label: "Adhesiolysis" }],
  "44620": [{ code: "44005", label: "Adhesiolysis" }],
  // AKA/BKA
  "27590": [{ code: "27882", label: "BKA open/guillotine" }],
  "27880": [{ code: "27590", label: "AKA" }],
};

// Get companion suggestions combining clinical rules + user history
function getCompanionSuggestions(code, entries, cptMap, alreadySelected) {
  if (!code) return [];
  var seen = {};
  var results = [];
  // Already selected codes in this encounter
  var skipSet = {};
  (alreadySelected || []).forEach(function(c) { skipSet[c] = true; });
  skipSet[code] = true;

  // 1. Clinical companion codes
  var clinical = COMPANION_CODES[code];
  if (clinical) {
    clinical.forEach(function(c) {
      if (skipSet[c.code] || !cptMap[c.code]) return;
      if (seen[c.code]) return;
      seen[c.code] = true;
      var info = cptMap[c.code];
      results.push({ code: c.code, desc: info.desc, friendly: info.friendly, wRVU: info.wRVU, label: c.label, source: "clinical" });
    });
  }

  // 2. User history - find codes logged on the same date as this code
  if (entries && entries.length > 0) {
    var pairCounts = {};
    // Group entries by date
    var byDate = {};
    entries.forEach(function(e) {
      if (!byDate[e.date]) byDate[e.date] = [];
      byDate[e.date].push(e.cptCode);
    });
    // Count how often other codes appear on dates where this code was logged
    Object.values(byDate).forEach(function(codes) {
      if (codes.indexOf(code) === -1) return;
      codes.forEach(function(c) {
        if (c === code || skipSet[c]) return;
        pairCounts[c] = (pairCounts[c] || 0) + 1;
      });
    });
    // Sort by frequency, take top suggestions
    var sorted = Object.entries(pairCounts).sort(function(a, b) { return b[1] - a[1]; });
    sorted.slice(0, 5).forEach(function(pair) {
      var c = pair[0], count = pair[1];
      if (count < 2 || seen[c] || !cptMap[c]) return; // require at least 2 occurrences
      seen[c] = true;
      var info = cptMap[c];
      results.push({ code: c, desc: info.desc, friendly: info.friendly, wRVU: info.wRVU, label: "Logged together x" + count, source: "history" });
    });
  }

  return results;
}

const CPT_DATABASE_DEFAULT=CMS_RAW.map(function(r){var kw=r[4]||"";var extra=KEYWORD_SUPPLEMENT[r[0]];if(extra)kw=kw?(kw+" "+extra):extra;var fr=FRIENDLY_DESC[r[0]];if(fr)kw=kw?(kw+" "+fr):fr;return {code:r[0],desc:r[1],wRVU:r[2],category:r[3],keywords:kw,friendly:fr}});
const buildCPTMap = (db) => { const m = {}; db.forEach(c => { m[c.code] = c; }); return m; };

// Multi-term CPT search: every whitespace-separated term must match somewhere
// in code, desc, category, keywords, or friendly label (case-insensitive).
// Makes queries like "sebaceous cyst" or "lipoma back" work.
function matchesCPTQuery(c, query) {
  var terms = query.toLowerCase().split(/\s+/).filter(function(t) { return t; });
  if (terms.length === 0) return true;
  var hay = (c.code + " " + c.desc + " " + c.category + " " + (c.keywords || "") + " " + (c.friendly || "")).toLowerCase();
  for (var i = 0; i < terms.length; i++) {
    if (hay.indexOf(terms[i]) === -1) return false;
  }
  return true;
}
// Order search MATCHES so the likely code is on top - never adds or drops a
// match (same set as matchesCPTQuery). Stable: exact code, then code
// prefix, then the user's most-used codes (usage = { code: count }), then
// favorites, then database (CPT) order. Returns a new array.
function rankCPTMatches(items, query, usage, favorites) {
  var q = (query || "").trim().toLowerCase();
  var fav = {};
  (favorites || []).forEach(function(c) { fav[c] = true; });
  var u = usage || {};
  return (items || []).map(function(c, i) {
    var code = String(c.code).toLowerCase();
    return { c: c, i: i, tier: code === q ? 0 : (q && code.indexOf(q) === 0 ? 1 : 2), use: u[c.code] || 0, fav: fav[c.code] ? 1 : 0 };
  }).sort(function(a, b) { return a.tier - b.tier || b.use - a.use || b.fav - a.fav || a.i - b.i; })
    .map(function(x) { return x.c; });
}
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

// --- Encounter identity (THE shared definition) ---
// An encounter = unique date + patient combination, where the patient id is
// encounterId or, for imported entries, the first two characters of notes
// (RVU Wallet ref-id prefix). Returns null when no usable pid exists - the
// caller decides the fallback (countEncounters counts such entries
// individually; the analytics grouping buckets them as "solo|" + e.id).
// history.js buildEncounters is a deliberately different DISPLAY grouping
// (encounterId only, within one date, case-sensitive) - do not point it here.
function encounterKey(e) {
  var pid = e.encounterId || (e.notes && e.notes.substring(0, 2).trim());
  return (pid && pid.length >= 2) ? (e.date + "|" + pid.toUpperCase()) : null;
}

// --- Encounter counting ---
function countEncounters(entries) {
  var seen = {};
  var count = 0;
  entries.forEach(function(e) {
    var key = encounterKey(e);
    if (key !== null) {
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

// --- Local date helpers ---
// ALWAYS use these for "today"/date-string derivation. new Date().toISOString()
// yields the UTC date, which after ~6-7pm Central is TOMORROW - wrong dates on
// real billing entries. localYMD formats any Date as local YYYY-MM-DD.
function localYMD(d) {
  var m = String(d.getMonth() + 1).padStart(2, "0");
  var day = String(d.getDate()).padStart(2, "0");
  return d.getFullYear() + "-" + m + "-" + day;
}
function todayLocal() { return localYMD(new Date()); }
// Strict "YYYY-MM-DD" check via LOCAL parts (rejects 2026-02-30 etc.).
function isYMD(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  var p = s.split("-"), y = +p[0], m = +p[1], dd = +p[2];
  var dt = new Date(y, m - 1, dd);
  return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === dd;
}
// Local-parts day arithmetic: ymd + n days ("" for a bad date or non-integer n).
function addDaysYMD(ymd, n) {
  if (!isYMD(ymd) || typeof n !== "number" || n % 1 !== 0) return "";
  var p = ymd.split("-");
  return localYMD(new Date(+p[0], +p[1] - 1, +p[2] + n));
}
// Weekday 0 (Sun) - 6 (Sat) from local parts; -1 for a bad date.
function ymdWeekday(ymd) {
  if (!isYMD(ymd)) return -1;
  var p = ymd.split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]).getDay();
}
// "HH:MM" (24-hour) from a Date's LOCAL clock.
function localHM(d) { return String(d.getHours()).padStart(2, "0") + ":" + String(d.getMinutes()).padStart(2, "0"); }

// --- Visible data alert (save/load failures must never be silent) ---
// Plain-DOM banner so it works even if React is wedged. appendChild only.
function showDataAlert(msg, onDismiss) {
  try {
    var existing = document.getElementById("rvu-data-alert");
    if (existing && existing.parentNode) existing.parentNode.removeChild(existing);
    var bar = document.createElement("div");
    bar.id = "rvu-data-alert";
    bar.style.cssText = "position:fixed;top:0;left:0;right:0;z-index:99999;background:#7f1d1d;color:#fecaca;font-family:-apple-system,sans-serif;font-size:13px;line-height:1.5;padding:12px 44px 12px 14px;border-bottom:2px solid #ef4444;box-shadow:0 2px 12px rgba(0,0,0,0.4);";
    var text = document.createElement("span");
    text.textContent = msg;
    var btn = document.createElement("button");
    btn.textContent = "\u2715";
    btn.setAttribute("aria-label", "Dismiss");
    btn.style.cssText = "position:absolute;top:8px;right:10px;background:none;border:none;color:#fecaca;font-size:16px;cursor:pointer;padding:4px 8px;";
    btn.onclick = function() {
      if (bar.parentNode) bar.parentNode.removeChild(bar);
      if (onDismiss) { try { onDismiss(); } catch(e) {} }
    };
    bar.appendChild(text);
    bar.appendChild(btn);
    document.body.appendChild(bar);
  } catch(e) { try { alert(msg); if (onDismiss) onDismiss(); } catch(e2) {} }
}

const fmt = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const fmtShort = d => new Date(d + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric" });
function fmtDollar(val, show) { if (!show) return "$\u2022\u2022\u2022\u2022\u2022"; return "$" + val.toLocaleString(undefined, { maximumFractionDigits: 0 }); }
// annualGoal = OR / Tracked goal (logged cases). reconGoal = yearly goal for the
// manually-entered monthly reconciliation totals (incl. call + clinic). The two
// tracks are independent and never mix.
const defSettings = () => ({ ratePerRVU: 55, annualGoal: 6000, reconGoal: 0, yearStart: new Date().getFullYear() + "-01-01" });
// The Reconciliation track reads institution monthly totals directly from
// institutionData (Compare tab). The old hand-typed reconMonths store was
// migrated into institutionData and removed (see repairData migration).
// acuteRoster/acuteMe/acuteMonths: group acute-care pool tracking. Roster is
// USER-ENTERED data only - never hardcode partner names anywhere in source.
// acuteMonths: { "YYYY-MM": { pool: number, shifts: { name: number } } }.
// templates: saved procedure code bundles for one-tap Log pre-fill.
// [{ id, name, codes: ["47562", ...] (order preserved), note? }] - codes
// only, never wRVU values (those resolve from the current db at apply
// time) and never patient info.
// paySites / payShifts: call-pay tracking in DOLLARS - never touches entries
// or wRVU totals. Site names and rates are USER-ENTERED data - never hardcode
// a site name or rate anywhere in source, tests, or docs, except the
// built-in preset DEFAULT_PAY_SITES below (CLAUDE.md).
// paySites: [{ id, name, weekendDays: [0-6] (the site's weekend days: a
//   call-in on one gets the weekend fee and weekend hourly rules through
//   classifyPayEvent), casesEarnRVU: bool (false = call cases logged here
//   dated CALL_NO_CREDIT_FROM or later earn no wRVU credit; changed only
//   through paySiteWithCredit), rates: [RateVersion] }]
// RateVersion: { id, effective: "YYYY-MM-DD", stipend, stipendHours,
//   callInWeekday, callInWeekendHoliday, hourly, hourlyMinHours (numbers
//   >= 0; stipendHours > 0 - it is the stipend period divisor),
//   hourlyWeekdayDay: bool, label? }
// payShifts: [{ id, date: "YYYY-MM-DD" (shift start), siteId, siteName,
//   callHours, rates: RateVersion COPY (authoritative - like entry wRVU
//   snapshots, pay never re-looks-up the site's current rates), events:
//   [{ date, cls: "wd"|"wn"|"we"|"hol", fee: bool, hours, time? }], cases?,
//   note? }] - note never holds patient info. events[].time is an optional
//   "HH:MM" start, informational only: cls alone decides pay.
//   Every shift write goes through payShiftFromDraft (or payRepriceShift);
//   a shift's rate copy changes only when its site/date is edited, the
//   user taps "Use current rates" in the editor, or a confirmed re-price.
// Built-in call-pay sites - the owner's two call sites and rates, made public
// by the owner's choice (2026-10-11; see CLAUDE.md). Loaded ONCE into an empty
// call-pay store (repairData, marker settings.paySitesSeeded); after that they
// are ordinary user data - rates change by adding dated versions in Call Pay.
// Key order matches what repairData/cleanPayRate produce, so they load
// without a repair rewrite (check.js asserts this and the worked examples).
var DEFAULT_PAY_SITES = [
  { id: "site-silvis", name: "Silvis", weekendDays: [0, 5, 6], casesEarnRVU: true, rates: [
    { id: "rate-silvis-2026-10", effective: "2026-10-01", stipend: 1500, stipendHours: 24, callInWeekday: 291, callInWeekendHoliday: 582, hourly: 125, hourlyMinHours: 0, hourlyWeekdayDay: true }
  ] },
  { id: "site-davenport", name: "Davenport", weekendDays: [0, 6], casesEarnRVU: false, rates: [
    { id: "rate-davenport-2026-10", effective: "2026-10-01", label: "Proposal", stipend: 3189.65, stipendHours: 12, callInWeekday: 291.13, callInWeekendHoliday: 291.13, hourly: 242.69, hourlyMinHours: 3, hourlyWeekdayDay: false }
  ] }
];
function defaultPaySites() { return JSON.parse(JSON.stringify(DEFAULT_PAY_SITES)); }
// Would repairData load the built-in sites into d? Only a store never
// seeded whose call-pay fields are MISSING or EMPTY lists - a malformed
// (non-list) value goes through the normal reset-with-notice repair instead.
// Shared by repairData and the restore warning so they always agree.
function payWillSeed(d) {
  var empty = function(v) { return v === undefined || (Array.isArray(v) && v.length === 0); };
  return !!d && !!d.settings && typeof d.settings === "object" && d.settings.paySitesSeeded !== true && empty(d.paySites) && empty(d.payShifts);
}
// "Use built-in rates": a phone whose own same-named sites lack paying
// rates (e.g. sites typed in before the preset existed) gets the preset's
// version on ONE confirmed tap in Call Pay. These helpers are pure; callpay.js
// re-plans inside the updater so a stale render or a second tap is a no-op.
// repairData never adds rates, and amounts the user typed are never changed.
// payBuiltInFor: the site that stands for a built-in def - its id, else the
// ONE site with the same name (case/space-insensitive), else the ONE site
// named "<def name> <more>" (e.g. "Davenport East"). The name tiers skip
// sites carrying a built-in id; two candidates in a tier = ambiguous.
function payBuiltInFor(sites, def) {
  if (!Array.isArray(sites) || !def || typeof def.name !== "string") return null;
  var list = sites.filter(function(s) { return !!s && typeof s === "object" && typeof s.name === "string"; });
  var byId = list.filter(function(s) { return s.id === def.id; });
  if (byId.length) return { site: byId[0], by: "id" };
  var builtInIds = DEFAULT_PAY_SITES.map(function(x) { return x.id; });
  var pool = list.filter(function(s) { return builtInIds.indexOf(s.id) === -1; });
  var key = def.name.toLowerCase();
  var norm = function(s) { return s.name.trim().replace(/\s+/g, " ").toLowerCase(); };
  var tiers = [["name", function(s) { return norm(s) === key; }], ["alias", function(s) { return norm(s).indexOf(key + " ") === 0; }]];
  for (var i = 0; i < tiers.length; i++) {
    var hits = pool.filter(tiers[i][1]);
    if (hits.length === 1) return { site: hits[0], by: tiers[i][0] };
    if (hits.length > 1) return { site: null, by: "ambiguous" };
  }
  return null;
}
// Built-in defs with no standing site at all (the "Add built-in sites" list).
// A site of ANY id already using the def's name also counts as present, so
// adding never creates a second site with the same name.
function payMissingBuiltIns(sites) {
  var names = (Array.isArray(sites) ? sites : []).filter(function(s) { return !!s && typeof s.name === "string"; })
    .map(function(s) { return s.name.trim().replace(/\s+/g, " ").toLowerCase(); });
  return DEFAULT_PAY_SITES.filter(function(def) { return payBuiltInFor(sites, def) === null && names.indexOf(def.name.toLowerCase()) === -1; });
}
function payRateZero(r) {
  return !!r && r.stipend === 0 && r.callInWeekday === 0 && r.callInWeekendHoliday === 0 && r.hourly === 0;
}
// $0 versions dated on/after the built-in start: they would shadow it.
function payBuiltInDrops(site, from) {
  return site.rates.filter(function(r) { return payRateZero(r) && typeof r.effective === "string" && r.effective >= from; });
}
// What "Use built-in rates" would do to one site, or null when a non-$0
// version is in force on the built-in start date (then the site is never
// touched). remove/removeDates: the $0 versions dropped; later: the user's
// next own version after the start (it still applies from its date); days:
// a hand-made site still on the default Sat/Sun weekend takes the preset's
// weekend days (e.g. adds Friday).
function payBuiltInPlan(site, def) {
  if (!site || !Array.isArray(site.rates) || !def || !Array.isArray(def.rates) || !def.rates[0]) return null;
  var from = def.rates[0].effective;
  var drops = payBuiltInDrops(site, from);
  var left = site.rates.filter(function(r) { return drops.indexOf(r) === -1; });
  var inForce = rateInForce({ rates: left }, from);
  if (inForce && !payRateZero(inForce)) return null;
  var later = left.map(function(r) { return r && r.effective; }).filter(function(e) { return isYMD(e) && e > from; }).sort()[0] || "";
  var wd = Array.isArray(site.weekendDays) ? site.weekendDays.slice().sort() : [];
  var dwd = def.weekendDays.slice().sort();
  var days = site.id !== def.id && wd.join(",") === "0,6" && dwd.join(",") !== "0,6";
  return { remove: drops.map(function(r) { return r.id; }), removeDates: drops.map(function(r) { return r.effective; }), later: later, days: days };
}
// A NEW site object with the plan applied: $0 versions dropped, a deep copy
// of the preset version appended (preset key order = repairData's, so no
// rewrite on load), weekend days only when plan.days. casesEarnRVU is never
// touched here (only paySiteWithCredit changes it, on a confirmed tap).
function payApplyBuiltIn(site, def, plan) {
  var from = def.rates[0].effective;
  var drops = payBuiltInDrops(site, from);
  var rates = site.rates.filter(function(r) { return drops.indexOf(r) === -1; });
  var add = JSON.parse(JSON.stringify(def.rates[0]));
  if (rates.some(function(r) { return !!r && r.id === add.id; })) add.id = add.id + "-" + Date.now().toString(36);
  var out = { ...site, rates: rates.concat([add]) };
  if (plan && plan.days) out.weekendDays = def.weekendDays.slice();
  return out;
}
// Every built-in def whose standing site would take the preset version.
function payBuiltInOffers(sites) {
  var out = [];
  DEFAULT_PAY_SITES.forEach(function(def) {
    var m = payBuiltInFor(sites, def);
    if (!m || !m.site) return;
    var plan = payBuiltInPlan(m.site, def);
    if (plan) out.push({ def: def, site: m.site, by: m.by, plan: plan });
  });
  return out;
}
// Call cases and wRVU credit (7b). A CALL case logged at a current site whose
// casesEarnRVU is false earns no wRVU credit when dated on/after
// CALL_NO_CREDIT_FROM (owner 2026-10-12: the acute-care pool covers them;
// earlier cases stay credited). Private cases and every other site: credited.
// Decided when a case is WRITTEN (entryWithCall) and kept as the noCredit
// snapshot - a later site change never rewrites logged cases.
var CALL_NO_CREDIT_FROM = "2026-10-01";
// Log/History site picker: "Other site" = a Call case with no stored site.
// A picker key only - never stored.
var CALL_SITE_OTHER = "__other__";
function callNoCreditDate(ymd) { return isYMD(ymd) && ymd >= CALL_NO_CREDIT_FROM; }
function payCaseNoCredit(isCall, site, ymd) {
  return isCall === true && !!site && typeof site === "object" && site.deleted !== true && site.casesEarnRVU === false && callNoCreditDate(ymd);
}
// The CURRENT site with this id (null for "", junk, or a deleted stand-in).
function paySiteById(sites, id) {
  if (typeof id !== "string" || !id || !Array.isArray(sites)) return null;
  for (var i = 0; i < sites.length; i++) {
    var s = sites[i];
    if (s && typeof s === "object" && s.id === id && typeof s.name === "string" && s.deleted !== true) return s;
  }
  return null;
}
// The ONE way casesEarnRVU changes after a site is created: a confirmed tap
// in Call Pay or Log (check.js G9). A new object; the key keeps its place,
// so the result is a repairData fixed point.
function paySiteWithCredit(site, earns) { return { ...site, casesEarnRVU: earns === true }; }
// Built-in credit rule offers: a standing site that payBuiltInFor maps to a
// no-credit built-in def by ONE same name or ONE "<name> ..." alias (never an
// ambiguous match) and that still credits its cases. A site holding the
// built-in id is never offered: seeding gives it no credit, so crediting
// there is the user's own choice. A HINT only - nothing changes until the
// user confirms; repairData and name matching never change the flag.
function payCreditOffers(sites) {
  var out = [];
  DEFAULT_PAY_SITES.forEach(function(def) {
    if (def.casesEarnRVU !== false) return;
    var m = payBuiltInFor(sites, def);
    if (m && m.site && m.by !== "id" && m.site.casesEarnRVU !== false) out.push({ def: def, site: m.site, by: m.by });
  });
  return out;
}
// Applies the offer to the listed site ids, re-planned against THIS list (a
// stale render or a second tap changes nothing). Junk input comes back as is.
function payApplyNoCredit(sites, ids) {
  if (!Array.isArray(sites)) return sites;
  var want = Array.isArray(ids) ? ids : [];
  var hit = payCreditOffers(sites).filter(function(o) { return want.indexOf(o.site.id) !== -1; }).map(function(o) { return o.site; });
  return sites.map(function(s) { return hit.indexOf(s) !== -1 ? paySiteWithCredit(s, false) : s; });
}
// Confirm text for the offer (the Call Pay card and the Log line say the same).
function payCreditConfirm(offers) {
  var names = (Array.isArray(offers) ? offers : []).map(function(o) {
    return o.site.name + (o.site.name.trim().replace(/\s+/g, " ").toLowerCase() !== o.def.name.toLowerCase() ? " (built-in " + o.def.name + ")" : "");
  });
  return names.join(" and ") + ": call cases you log dated " + fmt(CALL_NO_CREDIT_FROM) + " or later will earn NO wRVU credit - logged for the record, out of your wRVU and comp totals.\n\nCases already logged keep their credit; you can change each one in History.";
}
// Picker note for a site on a case date ("" when the site credits its cases).
function paySiteCreditNote(site, ymd) {
  if (!site || typeof site !== "object" || site.casesEarnRVU !== false) return "";
  if (!isYMD(ymd)) return "no wRVU credit from " + fmt(CALL_NO_CREDIT_FROM);
  return callNoCreditDate(ymd) ? "no wRVU credit" : "credited before " + fmt(CALL_NO_CREDIT_FROM);
}
const defState = () => ({ entries: [], settings: { ...defSettings(), paySitesSeeded: true }, rvuOverrides: {}, favorites: [], institutionData: [], acuteRoster: [], acuteMe: "", acuteMonths: {}, templates: [], paySites: defaultPaySites(), payShifts: [], dataVersion: DATA_VERSION });
const SK = "rvu-tracker-data";

// One-time cleanup: remove the legacy PLAINTEXT auto-backup blob (an unencrypted
// copy of all entries incl. patient initials/notes, written by old Settings code
// and never read anywhere). The encrypted clipboard backup feature is unrelated.
try { localStorage.removeItem("rvu-backup"); localStorage.removeItem("rvu-backup-time"); } catch(e) {}

// Forensic copy of a store that failed to load. SINGLE key, always overwritten,
// never accumulates. Cleared on the next clean load and on user dismissal of the
// recovery alert - it must never become a lingering plaintext copy of the data.
var CORRUPT_KEY = "rvu-tracker-data-corrupt";
function clearCorruptCopy() { try { localStorage.removeItem(CORRUPT_KEY); } catch(e) {} }

// Call-pay shape helpers (repairData). A rate version is unreadable when its
// effective date or any number pay depends on is missing/negative/NaN, or a
// flag is not a real boolean - numeric strings coerce, nothing else guesses.
var PAY_RATE_NUMS = ["stipend", "stipendHours", "callInWeekday", "callInWeekendHoliday", "hourly", "hourlyMinHours"];
var PAY_EVENT_CLS = ["wd", "wn", "we", "hol"];
function payNum(v) {
  if (typeof v === "string" && v.trim() !== "") v = Number(v);
  return (typeof v === "number" && isFinite(v) && v >= 0) ? v : null;
}
// Returns a cleaned COPY (unknown fields kept) or null if unreadable.
function cleanPayRate(r, fallbackId) {
  if (!r || typeof r !== "object" || Array.isArray(r) || !isYMD(r.effective)) return null;
  if (typeof r.hourlyWeekdayDay !== "boolean") return null;
  var c = { ...r };
  for (var i = 0; i < PAY_RATE_NUMS.length; i++) {
    var n = payNum(r[PAY_RATE_NUMS[i]]);
    if (n === null) return null;
    c[PAY_RATE_NUMS[i]] = n;
  }
  if (!(c.stipendHours > 0)) return null;
  if (typeof c.id !== "string" || !c.id) c.id = fallbackId;
  if (c.label !== undefined && typeof c.label !== "string") delete c.label;
  return c;
}

// Repair-before-reject: coerce every field validateData requires to be numeric
// (currently only settings.ratePerRVU) plus settings.annualGoal, which shares
// the same text-input history. Returns the names of repaired fields.
function repairData(d) {
  var fixed = [];
  if (d && d.settings) {
    ["ratePerRVU", "annualGoal", "reconGoal"].forEach(function(k) {
      if (typeof d.settings[k] === "string") {
        var v = parseFloat(d.settings[k]);
        if (!isNaN(v)) { d.settings[k] = v; fixed.push(k); }
        else if (k === "reconGoal") { d.settings[k] = 0; fixed.push(k); } // reverting to unset is visible in Settings
      }
    });
  }
  // Typed monthly numbers (recon + acute). Coerce parseable strings silently;
  // anything unreadable is REMOVED and announced loudly - a typed number
  // vanishing silently is the exact loss class Batch 1 eliminated. All loss
  // notices are combined into ONE banner so none can overwrite another.
  var lossMsgs = [];
  // ONE-TIME MIGRATION: reconMonths -> institutionData. The Reconciliation
  // track now reads institution monthly totals (Compare tab) directly; the
  // hand-typed reconMonths store was a duplicate of the same fact. Rules:
  // institutionData wins on conflict (it carries the work/call split) - but a
  // hand-typed total that DIFFERS beyond rounding is surfaced loudly before
  // being dropped (this runs on every partner's phone; a differing number
  // must not vanish silently). A month missing from institutionData is
  // carried over with its total intact in workRVU and totalOnly: true marking
  // that the work/call split is unknown. Lives in repairData so loadData,
  // last-good recovery, and encrypted-backup restore all share the same path.
  if (d && d.reconMonths !== undefined) {
    if (typeof d.reconMonths === "object" && d.reconMonths !== null && !Array.isArray(d.reconMonths)) {
      if (!Array.isArray(d.institutionData)) d.institutionData = [];
      var instHave = {};
      d.institutionData.forEach(function(row) { if (row && row.month) instHave[row.month] = (row.workRVU || 0) + (row.splitRVU || 0); });
      Object.keys(d.reconMonths).forEach(function(mk) {
        var v = d.reconMonths[mk];
        if (typeof v === "string") v = parseFloat(v);
        if (typeof v !== "number" || isNaN(v)) {
          lossMsgs.push("Monthly reconciliation entry for " + mk + " was unreadable and could not be migrated - re-enter it in Compare if needed.");
          return;
        }
        if (Object.prototype.hasOwnProperty.call(instHave, mk)) {
          if (Math.abs(instHave[mk] - v) > 0.1) {
            lossMsgs.push("Monthly entry " + mk + " (" + round2(v).toFixed(1) + ") differed from Compare (" + round2(instHave[mk]).toFixed(1) + "); Compare's value was kept.");
          }
          return; // duplicate of institutionData: drop silently when totals match
        }
        d.institutionData.push({ month: mk, workRVU: v, splitRVU: 0, totalOnly: true });
      });
      delete d.reconMonths;
      fixed.push("reconMonths-migrated");
    } else {
      delete d.reconMonths; // malformed legacy field - nothing recoverable
      fixed.push("reconMonths-removed");
    }
  }
  // Acute care group data. A month is dropped WHOLE if any value in it is
  // unreadable: units = sum of shifts, so silently dropping one partner's
  // shifts would corrupt every partner's split.
  if (d && d.acuteRoster !== undefined && !Array.isArray(d.acuteRoster)) { d.acuteRoster = []; fixed.push("acuteRoster"); console.warn("RVU Tracker: acuteRoster was malformed and was reset"); }
  if (d && d.acuteMe !== undefined && typeof d.acuteMe !== "string") { d.acuteMe = ""; fixed.push("acuteMe"); }
  if (d && d.acuteMonths !== undefined) {
    if (typeof d.acuteMonths !== "object" || d.acuteMonths === null || Array.isArray(d.acuteMonths)) {
      d.acuteMonths = {};
      fixed.push("acuteMonths");
      lossMsgs.push("Acute care data was unreadable and has been reset - please re-import or re-enter it in Settings.");
    } else {
      var droppedA = [];
      Object.keys(d.acuteMonths).forEach(function(mk) {
        var m = d.acuteMonths[mk];
        var bad = false;
        if (!m || typeof m !== "object" || Array.isArray(m)) bad = true;
        else {
          if (typeof m.pool === "string") { var ppv = parseFloat(m.pool); if (!isNaN(ppv)) { m.pool = ppv; fixed.push("acuteMonths." + mk + ".pool"); } }
          if (typeof m.pool !== "number" || isNaN(m.pool)) bad = true;
          if (m.shifts === undefined || m.shifts === null) { m.shifts = {}; }
          else if (typeof m.shifts !== "object" || Array.isArray(m.shifts)) bad = true;
          else {
            var shKeys = Object.keys(m.shifts);
            for (var si = 0; si < shKeys.length && !bad; si++) {
              var sv = m.shifts[shKeys[si]];
              if (typeof sv === "string") { var spv = parseFloat(sv); if (!isNaN(spv)) { m.shifts[shKeys[si]] = spv; fixed.push("acuteMonths." + mk + ".shifts"); sv = spv; } }
              if (typeof sv !== "number" || isNaN(sv)) bad = true;
            }
          }
        }
        if (bad) { delete d.acuteMonths[mk]; droppedA.push(mk); }
      });
      if (droppedA.length > 0) {
        fixed.push("acuteMonths-dropped");
        lossMsgs.push("Acute care " + (droppedA.length === 1 ? "entry" : "entries") + " for " + droppedA.join(", ") + " " + (droppedA.length === 1 ? "was" : "were") + " unreadable and removed - please re-enter or re-import " + (droppedA.length === 1 ? "it" : "them") + " in Settings.");
      }
    }
  }
  // Procedure templates: code bundles only. Tolerant repair - a malformed
  // list resets loudly; an individual template is dropped WHOLE (with a
  // notice) when unreadable or left codeless after cleaning, never silently
  // truncated to a partial bundle.
  if (d && d.templates !== undefined) {
    if (!Array.isArray(d.templates)) {
      d.templates = [];
      fixed.push("templates");
      lossMsgs.push("Procedure templates were unreadable and have been reset.");
    } else {
      var droppedT = [];
      var cleanT = [];
      d.templates.forEach(function(t, ti) {
        if (!t || typeof t !== "object" || Array.isArray(t)) { droppedT.push("#" + (ti + 1)); return; }
        var tName = typeof t.name === "string" ? t.name : "";
        var tCodes = Array.isArray(t.codes) ? t.codes.filter(function(c) { return typeof c === "string" && c.trim() !== ""; }) : [];
        if (Array.isArray(t.codes) && tCodes.length !== t.codes.length) fixed.push("templates." + (ti + 1) + ".codes");
        if (tName.trim() === "" || tCodes.length === 0) { droppedT.push(tName.trim() || "#" + (ti + 1)); return; }
        var ct = { id: (typeof t.id === "string" && t.id) ? t.id : "", name: tName, codes: tCodes };
        if (!ct.id) { ct.id = "tpl-" + Date.now().toString(36) + "-" + ti; fixed.push("templates." + (ti + 1) + ".id"); }
        if (typeof t.note === "string" && t.note.trim() !== "") ct.note = t.note;
        cleanT.push(ct);
      });
      if (droppedT.length > 0) {
        fixed.push("templates-dropped");
        lossMsgs.push("Procedure template" + (droppedT.length === 1 ? "" : "s") + " " + droppedT.join(", ") + " " + (droppedT.length === 1 ? "was" : "were") + " unreadable and removed.");
      }
      d.templates = cleanT;
    }
  }
  // ONE-TIME: load the built-in call-pay sites into an empty call-pay store
  // (no sites, no shifts). The marker is set either way, so sites the user
  // deletes later never come back and existing sites are never touched.
  if (d && d.settings && typeof d.settings === "object" && d.settings.paySitesSeeded !== true) {
    if (payWillSeed(d)) d.paySites = defaultPaySites();
    d.settings.paySitesSeeded = true;
    fixed.push("paySites-seeded");
  }
  // Call pay sites. A malformed list resets loudly; a site with no usable
  // name is dropped whole; an unreadable rate version is dropped with a
  // notice (shifts carry their own rate copy, so no recorded pay changes).
  if (d && d.paySites !== undefined) {
    if (!Array.isArray(d.paySites)) {
      d.paySites = [];
      fixed.push("paySites");
      lossMsgs.push("Call pay sites were unreadable and have been reset - please re-enter them.");
    } else {
      var droppedS = [], droppedR = [], cleanS = [];
      d.paySites.forEach(function(s, si) {
        if (!s || typeof s !== "object" || Array.isArray(s) || typeof s.name !== "string" || s.name.trim() === "") { droppedS.push("#" + (si + 1)); return; }
        var cs = { ...s };
        if (typeof cs.id !== "string" || !cs.id) cs.id = "site-" + Date.now().toString(36) + "-" + si;
        cs.weekendDays = Array.isArray(s.weekendDays) ? s.weekendDays.filter(function(n) { return typeof n === "number" && n % 1 === 0 && n >= 0 && n <= 6; }) : [];
        cs.casesEarnRVU = s.casesEarnRVU !== false;
        cs.rates = [];
        if (s.rates !== undefined && !Array.isArray(s.rates)) droppedR.push(s.name + " (all rates)");
        (Array.isArray(s.rates) ? s.rates : []).forEach(function(r, ri) {
          var cr = cleanPayRate(r, cs.id + "-r" + ri);
          if (cr) cs.rates.push(cr);
          else droppedR.push(s.name + " " + (r && typeof r.effective === "string" ? r.effective : "#" + (ri + 1)));
        });
        if (JSON.stringify(cs) !== JSON.stringify(s)) fixed.push("paySites." + (si + 1));
        cleanS.push(cs);
      });
      if (droppedS.length > 0) {
        fixed.push("paySites-dropped");
        lossMsgs.push("Call pay site" + (droppedS.length === 1 ? " " : "s ") + droppedS.join(", ") + " " + (droppedS.length === 1 ? "was" : "were") + " unreadable and removed.");
      }
      if (droppedR.length > 0) {
        fixed.push("paySites-rates-dropped");
        lossMsgs.push("Call pay rate" + (droppedR.length === 1 ? " " : "s ") + droppedR.join(", ") + " " + (droppedR.length === 1 ? "was" : "were") + " unreadable and removed - please re-enter " + (droppedR.length === 1 ? "it" : "them") + ". Recorded shifts keep their own rates.");
      }
      d.paySites = cleanS;
    }
  }
  // Call pay shifts. A shift is dropped WHOLE when its date, hours, rate
  // copy, or any call-in is unreadable - keeping part of a shift would
  // silently misprice it. An unreadable case count alone is removed with a
  // notice (it never affects pay). Unknown fields are kept.
  if (d && d.payShifts !== undefined) {
    if (!Array.isArray(d.payShifts)) {
      d.payShifts = [];
      fixed.push("payShifts");
      lossMsgs.push("Call pay shifts were unreadable and have been reset - please re-enter them.");
    } else {
      var droppedP = [], droppedC = [], cleanP = [];
      d.payShifts.forEach(function(p, pi) {
        var isObj = !!p && typeof p === "object" && !Array.isArray(p);
        var label = (isObj && typeof p.date === "string" && p.date ? p.date : "#" + (pi + 1)) + (isObj && typeof p.siteName === "string" && p.siteName ? " " + p.siteName : "");
        var cp = isObj ? { ...p } : null;
        var ok = !!cp && isYMD(p.date);
        if (ok) { cp.rates = cleanPayRate(p.rates, "rate-" + p.date); ok = !!cp.rates; }
        if (ok) { cp.callHours = payNum(p.callHours); ok = cp.callHours !== null; }
        if (ok) {
          var evs = (p.events === undefined || p.events === null) ? [] : p.events;
          if (!Array.isArray(evs)) ok = false;
          cp.events = [];
          for (var ei = 0; ok && ei < evs.length; ei++) {
            var ev = evs[ei];
            var eh = (ev && typeof ev === "object") ? payNum(ev.hours) : null;
            if (Array.isArray(ev) || eh === null || !isYMD(ev.date) || PAY_EVENT_CLS.indexOf(ev.cls) === -1 || typeof ev.fee !== "boolean") ok = false;
            else cp.events.push({ ...ev, hours: eh });
          }
        }
        if (!ok) { droppedP.push(label); return; }
        if (typeof cp.id !== "string" || !cp.id) cp.id = "shift-" + Date.now().toString(36) + "-" + pi;
        if (typeof cp.siteId !== "string") cp.siteId = "";
        if (typeof cp.siteName !== "string") cp.siteName = "";
        if (cp.cases !== undefined) {
          var cc = payNum(cp.cases);
          if (cc === null) { delete cp.cases; droppedC.push(label); } else cp.cases = cc;
        }
        if (cp.note !== undefined && typeof cp.note !== "string") delete cp.note;
        if (JSON.stringify(cp) !== JSON.stringify(p)) fixed.push("payShifts." + (pi + 1));
        cleanP.push(cp);
      });
      if (droppedP.length > 0) {
        fixed.push("payShifts-dropped");
        lossMsgs.push("Call pay shift" + (droppedP.length === 1 ? " " : "s ") + droppedP.join(", ") + " " + (droppedP.length === 1 ? "was" : "were") + " unreadable and removed - please re-enter " + (droppedP.length === 1 ? "it" : "them") + ".");
      }
      if (droppedC.length > 0) {
        fixed.push("payShifts-cases");
        lossMsgs.push("Case count for call shift" + (droppedC.length === 1 ? " " : "s ") + droppedC.join(", ") + " " + (droppedC.length === 1 ? "was" : "were") + " unreadable and removed.");
      }
      d.payShifts = cleanP;
    }
  }
  // entries[].noCredit is true or absent. false is dropped silently (it
  // already means credited); any other value is dropped LOUDLY - the case
  // stays credited, exactly as creditedRVU already counted it, so no total
  // moves. Data already in shape is untouched (no tag, no banner, no rewrite).
  if (d && Array.isArray(d.entries)) {
    var ncBad = [], ncFix = false;
    d.entries.forEach(function(e) {
      if (!e || typeof e !== "object" || e.noCredit === undefined || e.noCredit === true) return;
      if (e.noCredit !== false) ncBad.push((typeof e.date === "string" ? e.date : "?") + " " + (typeof e.cptCode === "string" ? e.cptCode : "?"));
      delete e.noCredit; ncFix = true;
    });
    if (ncFix) fixed.push("entries.noCredit");
    if (ncBad.length > 0) {
      var ncOne = ncBad.length === 1;
      lossMsgs.push((ncOne ? "The no-credit mark on procedure " : "The no-credit marks on " + ncBad.length + " procedures (") + ncBad.slice(0, 5).join(", ") + (ncBad.length > 5 ? " and " + (ncBad.length - 5) + " more" : "") + (ncOne ? " was" : ") were") + " unreadable and removed - " + (ncOne ? "it counts" : "they count") + " for wRVU credit, as before. Check " + (ncOne ? "it" : "them") + " in History.");
    }
  }
  if (lossMsgs.length > 0) showDataAlert(lossMsgs.join(" "));
  return fixed;
}

// Loud recovery: never silently substitute older data for newer. Preserve the
// failing store first, tell the user exactly what state they are in, and make
// clear the preserved copy is a forensic lifeboat, not a one-click restore.
function recoverFromBad(raw, reason) {
  var preserved = false;
  try { if (raw) { localStorage.setItem(CORRUPT_KEY, raw); preserved = true; } } catch(e) {}
  var preservedMsg = preserved
    ? " The unreadable data was preserved as a raw forensic copy (it can NOT be restored with one click - recovery requires manual work). Dismissing this notice DISCARDS that copy."
    : " The unreadable data could NOT be preserved (storage full).";
  var lg = null;
  try { lg = loadLastGood(); if (lg) repairData(lg); } catch(e) { lg = null; }
  if (lg && validateData(lg)) {
    var age = "";
    try { var ts = localStorage.getItem(LAST_GOOD_TIME_KEY); if (ts) age = " (saved " + ts + ")"; } catch(e) {}
    showDataAlert("DATA RECOVERY: your saved data " + reason + ". An older snapshot" + age + " was loaded instead - anything logged after that snapshot is NOT in the app right now." + preservedMsg + " Export a backup from Settings before continuing.", clearCorruptCopy);
    return lg;
  }
  showDataAlert("DATA RECOVERY FAILED: your saved data " + reason + " and no valid snapshot exists, so the app is starting EMPTY." + preservedMsg, clearCorruptCopy);
  return defState();
}

function loadData() {
  var raw = null;
  try {
    raw = localStorage.getItem(SK);
    if (!raw) { clearCorruptCopy(); return defState(); }
    var s = JSON.parse(raw);
    var d = { entries: s.entries || [], settings: { ...defSettings(), ...s.settings }, rvuOverrides: s.rvuOverrides || {}, favorites: s.favorites || [], institutionData: s.institutionData || [], acuteRoster: s.acuteRoster || [], acuteMe: s.acuteMe || "", acuteMonths: s.acuteMonths || {}, templates: s.templates || [], paySites: s.paySites || [], payShifts: s.payShifts || [], dataVersion: s.dataVersion || DATA_VERSION };
    // Legacy field: carried through so repairData can run the one-time
    // reconMonths -> institutionData migration, after which it is deleted.
    if (s.reconMonths !== undefined) d.reconMonths = s.reconMonths;
    var repaired = repairData(d);
    if (validateData(d)) {
      if (repaired.length > 0) {
        // Persist the self-heal so the bad value is gone for good,
        // not re-coerced on every boot.
        try { localStorage.setItem(SK, JSON.stringify(d)); } catch(e) {}
        console.warn("RVU Tracker: repaired field(s): " + repaired.join(", "));
      }
      clearCorruptCopy();
      return d;
    }
    console.warn("RVU Tracker: primary data failed validation even after repair");
    return recoverFromBad(raw, "failed validation");
  } catch(e) {
    console.error("RVU Tracker: loadData error, attempting recovery:", e);
    return recoverFromBad(raw, "could not be read (" + (e && e.message ? e.message : "parse error") + ")");
  }
}
var _saveGoodCounter = 0;
function saveData(d) {
  try {
    localStorage.setItem(SK, JSON.stringify(d));
    _saveGoodCounter++;
    if (_saveGoodCounter % 5 === 0 && validateData(d)) { saveLastGood(d); }
  } catch(e) {
    console.error("RVU Tracker: saveData error:", e);
    showDataAlert("SAVE FAILED - your latest change was NOT saved (" + (e && e.message ? e.message : "storage error") + "). Free up space or export a backup from Settings before closing the app.");
  }
}
// (The old loadPersistent/savePersistent window.storage mirror was removed:
// window.storage was never defined in production - a dead shim from the
// app's artifact origins. localStorage is the single persistence layer.)

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

// wRVU credit - the ONE rule deciding whether a case counts toward wRVU and
// comp TOTALS. entry.noCredit === true (strict) marks a case logged for the
// record but credited elsewhere (e.g. acute-care pool call cases);
// adjustedRVU itself is never zeroed. Readers test the flag ONLY through
// isNoCredit; every sum of wRVU or comp goes through creditedRVU, and the
// "Logged, no credit" totals through noCreditRVU. Sorts and a row's own wRVU
// display keep the raw snapshot. Only isNoCredit, repairData and withNoCredit
// (the one writer, called only by entryWithCall) touch the noCredit field
// (check.js gates raw adjustedRVU arithmetic, any noCredit mention elsewhere,
// and any use of these four names other than calling them or passing them as
// a call argument, e.g. list.filter(isNoCredit)).
function isNoCredit(e) { return !!e && e.noCredit === true; }
function creditedRVU(e) { return isNoCredit(e) ? 0 : e.adjustedRVU; }
// Mirror of creditedRVU: for a numeric adjustedRVU,
// creditedRVU(e) + noCreditRVU(e) === e.adjustedRVU.
function noCreditRVU(e) { return isNoCredit(e) ? e.adjustedRVU : 0; }
// The ONE writer of entry.noCredit (7b): a NEW entry with noCredit: true when
// on === true (strict, like isNoCredit), else the key removed - never false
// (repairData would strip it: a rewrite on every load). Every other field,
// adjustedRVU included, is copied as is. Called ONLY by entryWithCall (G7).
function withNoCredit(e, on) {
  var out = { ...e };
  if (on === true) out.noCredit = true; else delete out.noCredit;
  return out;
}
// A case's stored call-site id ("" for none/junk), its picker key ("" for
// Private, CALL_SITE_OTHER for a siteless Call case), and the key History
// compares call fields by.
function entrySiteId(e) { return !!e && typeof e === "object" && typeof e.siteId === "string" ? e.siteId : ""; }
function entrySiteKey(e) { return !!e && typeof e === "object" && e.isCall ? (entrySiteId(e) || CALL_SITE_OTHER) : ""; }
function entryCallKey(e) { return (!!e && typeof e === "object" && e.isCall ? "call" : "private") + "|" + entrySiteId(e) + "|" + (isNoCredit(e) ? "nc" : ""); }
// THE writer of a case's call fields (check.js G8): isCall, siteId + siteName
// (Call at a CURRENT site; a case's own deleted site keeps its label) and the
// credit flag, all decided together; the rest of `next` is copied as is and
// keys keep their places (a notes edit writes what it read).
// src: the stored case it came from (null = a new Log case). While Call/
// Private and site are unchanged, the date stays on the same side of
// CALL_NO_CREDIT_FROM and rederive !== true, src's credit is KEPT (the
// snapshot - a later site change never rewrites it); otherwise it is derived
// by payCaseNoCredit. On the case's own deleted site credit can only be LOST
// (the date rule), never gained.
function entryWithCall(next, src, isCall, siteKey, sites, rederive) {
  var call = isCall === true;
  var sid = call && typeof siteKey === "string" && siteKey !== CALL_SITE_OTHER ? siteKey : "";
  var live = paySiteById(sites, sid);
  var gone = !live && sid !== "" && sid === entrySiteId(src);
  var same = !!src && typeof src === "object" && rederive !== true && callNoCreditDate(next.date) === callNoCreditDate(src.date) &&
    call === !!src.isCall && sid === entrySiteId(src);
  var nc = same ? call && isNoCredit(src) : gone ? isNoCredit(src) && callNoCreditDate(next.date) : payCaseNoCredit(call, live, next.date);
  var out = { ...next, isCall: call };
  if (live) { out.siteId = live.id; out.siteName = live.name; }
  else if (gone) { out.siteId = sid; if (typeof src.siteName === "string" && src.siteName) out.siteName = src.siteName; else delete out.siteName; }
  else { delete out.siteId; delete out.siteName; }
  return withNoCredit(out, nc);
}
// History's encounter (buildEncounters' rule): same date + EXACT non-empty
// encounterId, excluding e itself.
function entryEncounterMates(entries, e) {
  if (!e || typeof e !== "object" || typeof e.encounterId !== "string" || !e.encounterId || !Array.isArray(entries)) return [];
  return entries.filter(function(x) { return !!x && typeof x === "object" && x !== e && x.id !== e.id && x.date === e.date && x.encounterId === e.encounterId; });
}
// The rest of an encounter (History's checkbox): when a case's Call/Private
// or site changes, or the rule is re-applied, the other procedures of its
// encounter (entryEncounterMates of the case BEFORE the edit) take the same
// call fields, each with credit from its OWN date. Returns { id: new entry }
// for the mates whose call fields actually change (entryCallKey); every
// other mate is left out and stays exactly as it is.
function entryEncounterCallPlan(entries, cur, isCall, siteKey, sites, rederive) {
  var out = {};
  if (!cur || typeof cur !== "object") return out;
  var call = isCall === true;
  // A siteless Call pick is "" or CALL_SITE_OTHER - entryWithCall treats both
  // as no site, so they compare equal here too.
  var key = call ? (typeof siteKey === "string" && siteKey !== "" ? siteKey : CALL_SITE_OTHER) : "";
  if (call === !!cur.isCall && key === entrySiteKey(cur) && rederive !== true) return out;
  entryEncounterMates(entries, cur).forEach(function(m) {
    var m2 = entryWithCall(m, m, call, siteKey, sites, true);
    if (entryCallKey(m2) !== entryCallKey(m)) out[m.id] = m2;
  });
  return out;
}
// Row label: a current site's CURRENT name, else the stored name + " (deleted)"
// (paySiteNames precedent), "" when the case stores no site. Always a string.
function entrySiteLabel(e, sites) {
  var id = entrySiteId(e);
  if (!id) return "";
  var s = paySiteById(sites, id);
  if (s) return s.name;
  return typeof e.siteName === "string" && e.siteName ? e.siteName + " (deleted)" : "Deleted site";
}
// Date ranges for the "Logged, no credit" lines' tap-through to History
// (inclusive "YYYY-MM-DD" strings, local parts only).
// "YYYY-MM" -> { start: first day, end: last day }, else null.
function monthBoundsYMD(ym) {
  if (typeof ym !== "string" || !/^\d{4}-\d{2}$/.test(ym)) return null;
  var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
  if (m < 1 || m > 12) return null;
  var next = (m === 12 ? (y + 1) + "-01" : y + "-" + String(m + 1).padStart(2, "0")) + "-01";
  return { start: ym + "-01", end: addDaysYMD(next, -1) };
}
// A year from its start date: { start, end: the day before the same date a
// year later } - the Dashboard/Trends year window (a Feb 29 start ends on
// Feb 28), else null.
function fiscalYearBoundsYMD(ys) {
  if (!isYMD(ys)) return null;
  var next = (+ys.slice(0, 4) + 1) + ys.slice(4);
  if (!isYMD(next)) next = (+ys.slice(0, 4) + 1) + "-03-01";
  return { start: ys, end: addDaysYMD(next, -1) };
}

// --- Acute care group split math (single implementation - do not duplicate) ---
// Half-up rounding to 2dp with a precision guard: 992.31/62 is exactly 16.005 in
// decimal but 16.004999... in binary floats, and naive toFixed(2) would display
// 16.00 where the group's official table says 16.01. Used for ALL acute displays.
function round2(v) {
  return Math.round(parseFloat((v * 100).toPrecision(12))) / 100;
}

// month = { pool, shifts: { name: number } }. Shares are computed at FULL
// floating precision (shifts x pool/units) and rounded via round2 for DISPLAY
// only - never multiply by a rounded value/unit (11 x 16.005 = 176.06 right;
// 11 x 16.01 = 176.11 wrong). Guard divide-by-zero: no shifts -> empty: true.
function computeAcuteSplit(month) {
  var shifts = (month && month.shifts) || {};
  var pool = (month && typeof month.pool === "number") ? month.pool : 0;
  var units = 0;
  Object.keys(shifts).forEach(function(k) { units += shifts[k]; });
  if (!(units > 0)) return { pool: pool, units: units, valuePerUnit: 0, shares: {}, empty: true };
  var vpu = pool / units;
  var shares = {};
  Object.keys(shifts).forEach(function(k) { shares[k] = shifts[k] * vpu; });
  return { pool: pool, units: units, valuePerUnit: vpu, shares: shares, empty: false };
}

// --- Call pay math (dollars; single implementation - do not duplicate) ---
// Holidays: the SAME list at every site. Fixed-date "Day" holidays that fall
// on a weekend ALSO count on the observed weekday (Sat -> Fri, Sun -> Mon);
// the two Eves never shift. All dates built from LOCAL parts.
var _payHolCache = {};
function payHolidayMap(y) {
  if (_payHolCache[y]) return _payHolCache[y];
  var m = {};
  function add(d, name) { var k = localYMD(d); m[k] = m[k] ? m[k] + " / " + name : name; }
  function fixedDay(yy, mo, day, name) {
    var d = new Date(yy, mo, day), wd = d.getDay();
    add(d, name);
    if (wd === 6) add(new Date(yy, mo, day - 1), name + " (observed)");
    if (wd === 0) add(new Date(yy, mo, day + 1), name + " (observed)");
  }
  function nthWeekday(mo, wd, n) { var d = new Date(y, mo, 1); while (d.getDay() !== wd) d.setDate(d.getDate() + 1); d.setDate(d.getDate() + 7 * (n - 1)); return d; }
  function lastWeekday(mo, wd) { var d = new Date(y, mo + 1, 0); while (d.getDay() !== wd) d.setDate(d.getDate() - 1); return d; }
  fixedDay(y, 0, 1, "New Year's Day");
  add(lastWeekday(4, 1), "Memorial Day");
  fixedDay(y, 6, 4, "July 4");
  add(nthWeekday(8, 1, 1), "Labor Day");
  add(nthWeekday(10, 4, 4), "Thanksgiving");
  add(new Date(y, 11, 24), "Christmas Eve");
  fixedDay(y, 11, 25, "Christmas Day");
  add(new Date(y, 11, 31), "New Year's Eve");
  fixedDay(y + 1, 0, 1, "New Year's Day"); // a Saturday Jan 1 is observed Fri Dec 31 of THIS year
  _payHolCache[y] = m;
  return m;
}
function payHolidayName(ymd) {
  if (!isYMD(ymd)) return "";
  return payHolidayMap(+ymd.slice(0, 4))[ymd] || "";
}
// Night = 17:00 through 06:59 (night ends at 7 am); time is "HH:MM" 24-hour.
var PAY_NIGHT_START = 17, PAY_NIGHT_END = 7;
var PAY_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
// Pre-selects a call-in's class from its OWN date: holiday > the site's
// weekend days > weekday night/day by start time. Returns "" for a weekday
// with no readable time - the user must pick Day or Night (a guessed
// default would misprice silently).
function classifyPayEvent(ymd, time, weekendDays) {
  if (!isYMD(ymd)) return "";
  if (payHolidayName(ymd)) return "hol";
  var p = ymd.split("-");
  var wd = new Date(+p[0], +p[1] - 1, +p[2]).getDay();
  if (Array.isArray(weekendDays) && weekendDays.indexOf(wd) !== -1) return "we";
  if (typeof time !== "string" || !PAY_TIME_RE.test(time)) return "";
  var h = +time.slice(0, 2);
  return (h >= PAY_NIGHT_START || h < PAY_NIGHT_END) ? "wn" : "wd";
}
// Pay for ONE shift from its own rate copy (never the site's current rates).
// Returns null when anything pay depends on is unreadable (a draft with a
// blank field shows no total, never a silent partial), else
// { lines: [{ kind: "stipend"|"fee"|"hourly", ev?, hours?, paid, amount }], total }.
//   stipend = stipend x callHours / stipendHours
//   fee (ev.fee): weekend/holiday rate on "we"/"hol", else the weekday rate
//   hourly: unpaid on "wd" unless hourlyWeekdayDay; billed hours =
//     max(hours, hourlyMinHours), only when hours > 0 (a fee-only call-in
//     never triggers the minimum)
// Each line is rounded to the cent ONCE; total = sum of the rounded lines.
function computeShiftPay(shift) {
  if (!shift || typeof shift !== "object") return null;
  var r = cleanPayRate(shift.rates, "x");
  var callHours = payNum(shift.callHours);
  var evs = (shift.events === undefined || shift.events === null) ? [] : shift.events;
  if (!r || callHours === null || !Array.isArray(evs)) return null;
  var lines = [{ kind: "stipend", hours: callHours, paid: true, amount: round2(r.stipend * callHours / r.stipendHours) }];
  for (var i = 0; i < evs.length; i++) {
    var ev = evs[i];
    var h = (ev && typeof ev === "object") ? payNum(ev.hours) : null;
    if (h === null || PAY_EVENT_CLS.indexOf(ev.cls) === -1 || typeof ev.fee !== "boolean") return null;
    if (ev.fee) lines.push({ kind: "fee", ev: i, paid: true, amount: round2((ev.cls === "we" || ev.cls === "hol") ? r.callInWeekendHoliday : r.callInWeekday) });
    if (h > 0) {
      var paid = ev.cls !== "wd" || r.hourlyWeekdayDay;
      var billed = Math.max(h, r.hourlyMinHours);
      lines.push({ kind: "hourly", ev: i, hours: paid ? billed : h, paid: paid, amount: paid ? round2(billed * r.hourly) : 0 });
    }
  }
  var total = 0;
  lines.forEach(function(l) { total += l.amount; });
  return { lines: lines, total: round2(total) };
}
// The site's rate version in force on ymd: the latest effective date on or
// before ymd (string compare is safe on validated YYYY-MM-DD; on a tie the
// version added last wins). null when no version applies yet.
function rateInForce(site, ymd) {
  if (!site || !Array.isArray(site.rates) || !isYMD(ymd)) return null;
  var best = null;
  site.rates.forEach(function(r) {
    if (r && isYMD(r.effective) && r.effective <= ymd && (!best || r.effective >= best.effective)) best = r;
  });
  return best;
}
// Default date for a NEW shift: before 07:00 you are still on last night's
// shift, so yesterday; otherwise today. A blank/bad time keeps ymd.
function payDefaultShiftDate(ymd, hhmm) {
  if (!isYMD(ymd)) return "";
  if (typeof hhmm !== "string" || !PAY_TIME_RE.test(hhmm)) return ymd;
  return +hhmm.slice(0, 2) < PAY_NIGHT_END ? addDaysYMD(ymd, -1) : ymd;
}
// Start of a call-in that ended at ymd hhmm and lasted `hours`, as
// { date, time } - whole-minute arithmetic (no Date, so no DST drift);
// null for unreadable input.
function payStartBack(ymd, hhmm, hours) {
  var h = payNum(hours);
  if (!isYMD(ymd) || typeof hhmm !== "string" || !PAY_TIME_RE.test(hhmm) || h === null) return null;
  var mins = +hhmm.slice(0, 2) * 60 + +hhmm.slice(3) - Math.round(h * 60);
  var days = Math.floor(mins / 1440);
  var m = mins - days * 1440;
  return { date: addDaysYMD(ymd, days), time: String(Math.floor(m / 60)).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0") };
}
// The ONE rate choice for a draft (payShiftFromDraft, the form's questions
// and its displays): the edited shift's own copy while its site and date are
// unchanged ("kept"; draft.reprice - the editor's "Use current rates" -
// skips it), else a COPY of the version in force on the draft date.
function payDraftRate(draft, site, orig) {
  var siteOk = !!site && typeof site.id === "string" && site.id !== "" && typeof site.name === "string";
  if (!draft || typeof draft !== "object") return { rates: null, from: "" };
  if (orig && !draft.reprice && siteOk && orig.siteId === site.id && orig.date === draft.date && cleanPayRate(orig.rates, "x")) return { rates: { ...orig.rates }, from: "kept" };
  if (siteOk && isYMD(draft.date)) { var rif = rateInForce(site, draft.date); if (rif) return { rates: { ...rif }, from: "inForce" }; }
  return { rates: null, from: "" };
}
// Is a date a weekend or holiday for this site? (decides the call-in fee)
function payWeOrHol(ymd, site) {
  return isYMD(ymd) && (!!payHolidayName(ymd) || (!!site && Array.isArray(site.weekendDays) && site.weekendDays.indexOf(ymdWeekday(ymd)) !== -1));
}
// Ask "Day or Night?" for a call-in only where the answer changes pay: a
// non-holiday weekday when the rate pays no hourly on weekday daytime.
// Never for a deleted site's stand-in: its weekend days are unknown, so the
// form asks for the rate type itself instead.
function payAsksDayNight(ymd, site, rate) {
  if (site && site.deleted) return false;
  return isYMD(ymd) && !payWeOrHol(ymd, site) && !(rate && rate.hourlyWeekdayDay === true);
}
// Ask "before or after midnight?" only where it changes the call-in fee:
// the weekday and weekend/holiday fees differ AND the shift day and the
// next day fall on different sides of that line (never for a deleted site).
function payMidnightAsks(shiftDate, site, rate) {
  if (!rate || !isYMD(shiftDate) || rate.callInWeekday === rate.callInWeekendHoliday || (site && site.deleted)) return false;
  return payWeOrHol(shiftDate, site) !== payWeOrHol(addDaysYMD(shiftDate, 1), site);
}
// Builds the shift the call-pay form saves - the ONLY writer of payShifts.
// Output passes repairData UNCHANGED (check.js contract test): numbers are
// numbers, events/siteId/siteName always present, time/note only when set,
// unknown fields of orig kept.
//   draft: { id, siteId, date, callHours, note, events: [{ date, time, cls,
//     fee, hours }] } - values as typed; extra UI-only fields are ignored.
//   orig: the saved shift being edited (null for a new one). Its rate copy is
//     KEPT unless the site or date changed; otherwise a COPY of rateInForce.
//   ctx (optional): { shifts, today } for the duplicate / future warnings.
// Returns { shift (null if any blocking problem), problems: [{ code, ev,
// block }], ratesFrom: "kept" | "inForce" | "" }. ev is the call-in index,
// -1 for the shift itself.
function payShiftFromDraft(draft, site, orig, ctx) {
  var problems = [];
  var add = function(code, ev, block) { problems.push({ code: code, ev: ev, block: block }); };
  if (!draft || typeof draft !== "object") return { shift: null, problems: [{ code: "draft", ev: -1, block: true }], ratesFrom: "" };
  var siteOk = !!site && typeof site.id === "string" && site.id !== "" && typeof site.name === "string";
  if (!siteOk) add("site", -1, true);
  var dateOk = isYMD(draft.date);
  if (!dateOk) add("date", -1, true);
  var dr = payDraftRate(draft, site, orig);
  var rates = dr.rates, ratesFrom = dr.from;
  if (siteOk && dateOk && !rates) add("rates", -1, true);
  var callHours = payNum(draft.callHours);
  if (callHours === null) add("hours", -1, true);
  else if (rates && callHours > rates.stipendHours) add("overLength", -1, false);
  var lastOk = dateOk ? addDaysYMD(draft.date, Math.max(1, Math.ceil((callHours || 0) / 24))) : "";
  var events = [];
  (Array.isArray(draft.events) ? draft.events : []).forEach(function(e, i) {
    var ev = (e && typeof e === "object") ? e : {};
    var eh = payNum(ev.hours);
    if (!isYMD(ev.date)) add("evDate", i, true);
    else if (dateOk && ev.date < draft.date) add("evBefore", i, true);
    else if (dateOk && ev.date > lastOk) add("evLate", i, false);
    if (PAY_EVENT_CLS.indexOf(ev.cls) === -1) add("evCls", i, true);
    if (eh === null) add("evHours", i, true);
    var o = { date: ev.date, cls: ev.cls, fee: ev.fee === true, hours: eh };
    if (typeof ev.time === "string" && PAY_TIME_RE.test(ev.time)) o.time = ev.time;
    events.push(o);
  });
  if (ctx && dateOk) {
    if (isYMD(ctx.today) && draft.date > ctx.today) add("future", -1, false);
    if (siteOk && Array.isArray(ctx.shifts) && ctx.shifts.some(function(s) { return s && s.siteId === site.id && s.date === draft.date && !(orig && s.id === orig.id) && s.id !== draft.id; })) add("duplicate", -1, false);
  }
  if (problems.some(function(p) { return p.block; })) return { shift: null, problems: problems, ratesFrom: ratesFrom };
  var id = orig && typeof orig.id === "string" && orig.id ? orig.id : (typeof draft.id === "string" && draft.id ? draft.id : "shift-" + Date.now().toString(36));
  var shift = { ...(orig || {}), id: id, date: draft.date, siteId: site.id, siteName: site.name, callHours: callHours, rates: rates, events: events };
  var note = typeof draft.note === "string" ? draft.note.trim() : "";
  if (note) shift.note = note; else delete shift.note;
  var pay = computeShiftPay(shift);
  if (!pay) { add("pay", -1, true); return { shift: null, problems: problems, ratesFrom: ratesFrom }; }
  if (pay.total === 0) add("payNothing", -1, false);
  return { shift: shift, problems: problems, ratesFrom: ratesFrom };
}
// ---- Shift-form draft logic (pure; callpay.js only holds the state) ----
// A draft call-in is { date, rel: "same"|"next"|"other" (or "" while the
// midnight question is open), relSet?, time, timeAuto, cls, clsSet, dn?,
// fee, hours } with text as typed. The clock (today, nowHM) is passed
// in so check.js can pin it. One rule, re-applied on EVERY change so the
// result never depends on tap order: Shift day / Next day follow the shift
// date; an auto start time (now minus the hours it lasted) applies only while
// logging on the shift day or the day after - otherwise it is cleared and the
// class must come from the user; the class follows the date/time unless the
// user overrode it (clsSet).
// The simple form (R2) adds two UI-only fields, switched on by passing
// `rate` (the draft's rate choice, payDraftRate): relSet === false = the
// before/after-midnight question is not answered yet (rel "" and no date
// while payMidnightAsks; otherwise the shift day), and dn = the "Day or
// Night?" answer ("wd"/"wn"), used only where the date gives no class (a
// weekday with no time). With no answer, a rate that pays hourly on weekday
// daytime takes "wn" quietly (day and night pay the same there); otherwise
// the class stays "" and the form asks. A weekend/holiday date always wins
// over a Day/Night answer. Callers without `rate` behave exactly as before.
function payDraftEvent(e, shiftDate, site, today, nowHM, rate) {
  var ne = { ...e };
  var nextDay = addDaysYMD(shiftDate, 1);
  if (ne.timeAuto && !(isYMD(shiftDate) && (today === shiftDate || today === nextDay))) { ne.timeAuto = false; ne.time = ""; }
  if (ne.relSet === false) ne.rel = payMidnightAsks(shiftDate, site, rate) ? "" : "same";
  if (ne.rel === "same") ne.date = shiftDate; else if (ne.rel === "next") ne.date = nextDay; else if (ne.rel === "") ne.date = "";
  if (ne.timeAuto) {
    var sb = payStartBack(today, nowHM, ne.hours === "" ? 0 : ne.hours);
    if (sb && (sb.date === shiftDate || sb.date === nextDay)) { ne.date = sb.date; ne.time = sb.time; ne.rel = sb.date === shiftDate ? "same" : "next"; }
    else ne.time = "";
  }
  if (!ne.clsSet) {
    if (rate && site && site.deleted) {
      // A deleted site's weekend days are unknown: a saved call-in keeps its
      // saved class while its date and time are unchanged (keptCls, set by
      // payDraftFromShift); otherwise only a holiday is certain and the rest
      // waits for the user's rate type (the form asks).
      ne.cls = ne.keptCls && ne.date === ne.keptDate && ne.time === ne.keptTime ? ne.keptCls : payHolidayName(ne.date) ? "hol" : "";
    } else {
      ne.cls = classifyPayEvent(ne.date, ne.time, site && Array.isArray(site.weekendDays) ? site.weekendDays : []);
      if (ne.cls === "" && rate && isYMD(ne.date)) {
        if (ne.dn === "wd" || ne.dn === "wn") ne.cls = ne.dn;
        else if (rate.hourlyWeekdayDay === true) ne.cls = "wn";
      }
    }
  }
  return ne;
}
function payDraftNewEvent(shiftDate, site, today, nowHM) {
  return payDraftEvent({ date: shiftDate, rel: "same", time: "", timeAuto: true, cls: "", clsSet: false, fee: true, hours: "" }, shiftDate, site, today, nowHM);
}
// A new call-in for the simple form: no time guessed from the clock, the
// midnight question open where it matters, fee on.
function payDraftTrip(shiftDate, site, rate) {
  return payDraftEvent({ date: shiftDate, rel: "same", relSet: false, time: "", timeAuto: false, cls: "", clsSet: false, dn: "", fee: true, hours: "" }, shiftDate, site, "", "", rate);
}
// The edit draft for a saved shift (simple form). hoursSet is false for a
// full-length shift so a site/date change takes the new length (the
// payRepriceShift rule). Each call-in keeps its saved class - as the
// automatic class, a Day/Night answer (dn) or an override (clsSet) - so
// payShiftFromDraft rebuilds it unchanged. Only questions the saved rates
// actually ASKED come back answered: a shift-day call-in where no midnight
// question applied stays relSet false, and a quiet "wn" (a rate paying
// hourly on weekday daytime never asks Day/Night) leaves dn "" - so a later
// day or site change that makes the answer matter asks again. On a deleted
// site's stand-in (weekend days unknown) the saved class rides along in the
// UI-only keptCls/keptDate/keptTime - used only while the site is deleted and
// the call-in's date/time are unchanged - and the flags follow the same
// rules as above, so moving the shift to a live site re-applies the normal
// rules (a weekend day wins, the quiet rule, an unanswered question re-asks).
function payDraftFromShift(s, site) {
  var wdays = site && Array.isArray(site.weekendDays) ? site.weekendDays : [];
  var nextDay = addDaysYMD(s.date, 1);
  var gone = !!(site && site.deleted);
  var quiet = !!(s.rates && s.rates.hourlyWeekdayDay === true);
  var askedMid = payMidnightAsks(s.date, site, s.rates);
  return { id: s.id, siteId: s.siteId, date: s.date, callHours: String(s.callHours), hoursSet: !(s.rates && s.callHours === s.rates.stipendHours), note: s.note || "",
    events: (s.events || []).map(function(e) {
      var rel = e.date === s.date ? "same" : e.date === nextDay ? "next" : "other";
      var ne = { date: e.date, rel: rel, relSet: rel !== "same" || askedMid, time: e.time || "", timeAuto: false, cls: e.cls, clsSet: false, dn: "", fee: e.fee, hours: String(e.hours) };
      if (gone) { ne.keptCls = e.cls; ne.keptDate = ne.date; ne.keptTime = ne.time; }
      var auto = classifyPayEvent(ne.date, ne.time, wdays);
      if (auto === "") {
        if (e.cls === "wd" || (e.cls === "wn" && !quiet)) ne.dn = e.cls;
        else if (e.cls !== "wn") ne.clsSet = true;
      } else if (auto !== e.cls) ne.clsSet = true;
      return ne;
    }) };
}
// Undo for call-pay shifts (app.js doUndo type "pay"): drop the ids in
// action.remove (undoes a save), then put each action.restore copy back IN
// PLACE - swapped in where its id still is (undoes an edit) or re-inserted at
// action.at (undoes a delete), so the list order (newest-added last, the
// Recent tie-break) is kept. Returns a new array.
function payUndoApply(list, action) {
  var back = (action && action.restore) || [], rm = (action && action.remove) || [];
  var at = action ? action.at : undefined;
  var l = (Array.isArray(list) ? list : []).filter(function(s) { return rm.indexOf(s.id) === -1; });
  back.forEach(function(r) {
    var i = -1;
    l.forEach(function(s, j) { if (s.id === r.id) i = j; });
    if (i !== -1) l[i] = r;
    else l.splice(typeof at === "number" && at >= 0 ? Math.min(at, l.length) : l.length, 0, r);
  });
  return l;
}
// ---- Re-pricing (4c) ----
// Two rate versions price differently when any amount or the weekday-day
// flag differs; id, label and effective date do not matter.
function payRatesDiffer(a, b) {
  if (!a || !b) return true;
  for (var i = 0; i < PAY_RATE_NUMS.length; i++) { if (a[PAY_RATE_NUMS[i]] !== b[PAY_RATE_NUMS[i]]) return true; }
  return a.hourlyWeekdayDay !== b.hourlyWeekdayDay;
}
// A recorded shift is "stale" when the site's version in force for the
// shift's date prices differently from the shift's own rate copy. A deleted
// site or a date with no version in force is never stale (nothing to apply).
function payShiftStale(shift, site) {
  if (!shift || !site || shift.siteId !== site.id) return false;
  var rif = rateInForce(site, shift.date);
  return !!rif && payRatesDiffer(shift.rates, rif);
}
// The shift re-priced at the version in force for its date - a NEW object
// with a COPY of that version (never shared with the site). A full-length
// shift (hours on call = its old shift length) takes the new length; a
// partial shift keeps its hours. null when the shift is not stale. Output
// passes repairData unchanged (check.js).
function payRepriceShift(shift, site) {
  if (!payShiftStale(shift, site)) return null;
  var rif = rateInForce(site, shift.date);
  var full = shift.rates && shift.callHours === shift.rates.stipendHours;
  return { ...shift, siteName: site.name, callHours: full ? rif.stipendHours : shift.callHours, rates: { ...rif } };
}
// After "Use built-in rates" ADDED weekend days to a site (oldDays ->
// newDays), a recorded weekday call-in ("wd"/"wn") dated on or after `from`
// that falls on an added day becomes a weekend call-in ("we"), exactly as
// it would be classified if logged now; holidays, weekend/holiday classes
// and earlier shifts are untouched. Used only inside the confirmed re-price
// (before/after totals, Undo). A NEW shift, or null when nothing changes.
function payReclassShift(shift, oldDays, newDays, from) {
  if (!shift || !Array.isArray(shift.events) || !isYMD(shift.date) || !isYMD(from) || shift.date < from) return null;
  var od = Array.isArray(oldDays) ? oldDays : [], nd = Array.isArray(newDays) ? newDays : [];
  var added = nd.filter(function(x) { return od.indexOf(x) === -1; });
  if (!added.length) return null;
  var changed = false;
  var evs = shift.events.map(function(e) {
    if (!e || typeof e !== "object" || (e.cls !== "wd" && e.cls !== "wn")) return e;
    if (added.indexOf(ymdWeekday(e.date)) === -1 || classifyPayEvent(e.date, e.time || "", nd) !== "we") return e;
    changed = true;
    return { ...e, cls: "we" };
  });
  return changed ? { ...shift, events: evs } : null;
}
// Display name per siteId - ONE rule for the Totals split and every shift
// row: a current site shows its CURRENT name; a deleted site shows the name
// stored on its NEWEST shift (latest date, then most recently added).
function paySiteNames(shifts, sites) {
  var out = {}, cur = {}, del = {};
  (Array.isArray(sites) ? sites : []).forEach(function(s) { if (s && typeof s.id === "string") cur[s.id] = s.name; });
  (Array.isArray(shifts) ? shifts : []).forEach(function(s) {
    if (!s || typeof s.siteId !== "string" || !s.siteId || Object.prototype.hasOwnProperty.call(cur, s.siteId)) return;
    var d = isYMD(s.date) ? s.date : "";
    if (!del[s.siteId] || d >= del[s.siteId].date) del[s.siteId] = { date: d, name: s.siteName || "Deleted site" };
  });
  Object.keys(del).forEach(function(k) { out[k] = del[k].name; });
  Object.keys(cur).forEach(function(k) { out[k] = cur[k]; });
  return out;
}
// Call pay between two YYYY-MM-DD bounds by SHIFT date: from <= date < to,
// and (when upTo is given, e.g. today for a YTD line) date <= upTo. Whole-
// cent sum; an unpriceable shift is counted but never summed. String-date
// bounds, so a fiscal year starting on any day works.
function payTotalInRange(shifts, from, to, upTo) {
  var cents = 0, count = 0;
  (Array.isArray(shifts) ? shifts : []).forEach(function(s) {
    if (!s || !isYMD(s.date) || s.date < from || s.date >= to || (upTo && s.date > upTo)) return;
    count++;
    var p = computeShiftPay(s);
    if (p) cents += Math.round(p.total * 100);
  });
  return { total: cents / 100, shifts: count };
}
// Calendar years that have call-pay shifts, newest first ("YYYY" strings).
function payShiftYears(shifts) {
  var seen = {};
  (Array.isArray(shifts) ? shifts : []).forEach(function(s) { if (s && isYMD(s.date)) seen[s.date.slice(0, 4)] = true; });
  return Object.keys(seen).sort().reverse();
}
// Call-pay totals for one calendar year, by month of the SHIFT date (a call-in
// after midnight on the 1st still counts in the shift's month). Money is
// summed in whole cents so sites add up exactly to each month and months to
// the year. Sites show their CURRENT name; a deleted site keeps the name
// stored on its shifts (deleted: true). A shift that can't be priced is
// counted (unpriced) but never summed. Returns { total, shifts, callIns,
// unpriced, months: [{ key: "YYYY-MM", total, shifts, callIns, unpriced,
// sites: [{ key, name, deleted, total, shifts }], list: [shift, newest
// first] }] } with months newest first.
function payMonthTotals(shifts, year, sites) {
  var y = String(year);
  var current = {};
  (Array.isArray(sites) ? sites : []).forEach(function(s) { if (s && typeof s.id === "string") current[s.id] = true; });
  var names = paySiteNames(shifts, sites);
  var months = {}, cents = 0, count = 0, callIns = 0, unpriced = 0;
  (Array.isArray(shifts) ? shifts : []).forEach(function(s, idx) {
    if (!s || !isYMD(s.date) || s.date.slice(0, 4) !== y) return;
    var mk = s.date.slice(0, 7);
    var m = months[mk] || (months[mk] = { key: mk, cents: 0, shifts: 0, callIns: 0, unpriced: 0, sites: {}, list: [] });
    var p = computeShiftPay(s);
    var c = p ? Math.round(p.total * 100) : 0;
    var n = Array.isArray(s.events) ? s.events.length : 0;
    var sk = typeof s.siteId === "string" && s.siteId ? s.siteId : "name:" + (s.siteName || "");
    var deleted = !Object.prototype.hasOwnProperty.call(current, s.siteId);
    var site = m.sites[sk] || (m.sites[sk] = { key: sk, name: (s.siteId && names[s.siteId]) || s.siteName || "Deleted site", deleted: deleted, cents: 0, shifts: 0 });
    m.shifts++; m.callIns += n; site.shifts++;
    if (p) { m.cents += c; site.cents += c; cents += c; } else { m.unpriced++; unpriced++; }
    count++; callIns += n;
    m.list.push({ s: s, i: idx });
  });
  var out = Object.keys(months).sort().reverse().map(function(mk) {
    var m = months[mk];
    return {
      key: mk, total: m.cents / 100, shifts: m.shifts, callIns: m.callIns, unpriced: m.unpriced,
      sites: Object.keys(m.sites).map(function(k) { var st = m.sites[k]; return { key: st.key, name: st.name, deleted: st.deleted, total: st.cents / 100, shifts: st.shifts }; })
        .sort(function(a, b) { return b.total - a.total || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); }),
      list: m.list.sort(function(a, b) { return a.s.date < b.s.date ? 1 : a.s.date > b.s.date ? -1 : b.i - a.i; }).map(function(x) { return x.s; })
    };
  });
  return { total: cents / 100, shifts: count, callIns: callIns, unpriced: unpriced, months: out };
}
// Re-derive everything that follows the site/date: default hours on call
// (until the user edits them) and every call-in via payDraftEvent. `rate`
// (optional, the draft's payDraftRate choice) sets the full length and
// switches on the simple-form rules; without it the version in force does.
function payDraftRefresh(d, site, today, nowHM, rate) {
  var nd = { ...d };
  if (!nd.hoursSet) { var rif = rate || (site ? rateInForce(site, nd.date) : null); if (rif) nd.callHours = String(rif.stipendHours); }
  nd.events = (nd.events || []).map(function(e) { return payDraftEvent(e, nd.date, site, today, nowHM, rate); });
  return nd;
}

// Years that have ANY data (logged entries, institution months, acute
// months), newest first. Shared by the Dashboard and Trends year chips so
// the two surfaces can never drift. Callers wrap in useMemo.
function availableDataYears(data) {
  var ySet = {};
  (data.entries || []).forEach(function(e) { if (e && e.date) ySet[e.date.slice(0, 4)] = true; });
  (data.institutionData || []).forEach(function(d) { if (d && d.month) ySet[d.month.slice(0, 4)] = true; });
  Object.keys(data.acuteMonths || {}).forEach(function(mk) { ySet[mk.slice(0, 4)] = true; });
  return Object.keys(ySet).sort().reverse();
}

// --- Lazy SheetJS loader ---
// SheetJS (~1MB) is used only by Compare's Excel upload and Settings' Excel
// export, so it is injected on first use instead of loading at boot. Same
// pinned version + SRI hash + crossorigin as the old index.html head tag -
// if the version is ever bumped, recompute the sha384 or the script is
// blocked. A single in-flight promise guards double-injection; on failure
// the promise resets so the next tap retries cleanly.
var XLSX_SRC = "https://cdn.sheetjs.com/xlsx-0.20.1/package/dist/xlsx.full.min.js";
var XLSX_SRI = "sha384-QCIdq2UMVEoSRhR3ZWZwdz2/pivLowr+eokFMdYyukq7qI26VYRxFa4Nl6FKetmL";
var _xlsxLoad = null;
function loadXLSX() {
  if (window.XLSX) return Promise.resolve();
  if (_xlsxLoad) return _xlsxLoad;
  _xlsxLoad = new Promise(function(resolve, reject) {
    var s = document.createElement("script");
    s.src = XLSX_SRC;
    s.integrity = XLSX_SRI;
    s.crossOrigin = "anonymous";
    s.onload = function() {
      if (window.XLSX) { resolve(); }
      else { _xlsxLoad = null; reject(new Error("The Excel library loaded but did not initialize - try again.")); }
    };
    s.onerror = function() {
      _xlsxLoad = null;
      reject(new Error("Could not load the Excel library - check your connection and try again."));
    };
    document.head.appendChild(s);
  });
  return _xlsxLoad;
}

// --- CSV field escaping (RFC 4180) ---
// Shared by the History and Settings CSV exports - do not duplicate inline.
// Quotes a field only when it contains a comma, quote, or newline; internal
// quotes are doubled.
function csvField(val) {
  var s = (val === null || val === undefined) ? "" : String(val);
  if (s.indexOf('"') !== -1 || s.indexOf(",") !== -1 || s.indexOf("\n") !== -1 || s.indexOf("\r") !== -1) {
    return '"' + s.replace(/"/g, '""') + '"';
  }
  return s;
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
function parseDate2(val) { if (!val) return todayLocal(); const c = val.trim(); let x = c.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/); if (x) { const y = x[3].length === 2 ? '20' + x[3] : x[3]; return `${y}-${x[1].padStart(2,'0')}-${x[2].padStart(2,'0')}`; } x = c.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/); if (x) return `${x[1]}-${x[2].padStart(2,'0')}-${x[3].padStart(2,'0')}`; const d = new Date(c); if (!isNaN(d.getTime())) return localYMD(d); return todayLocal(); }
function extractCPT(val) { if (!val) return null; const x = val.replace(/[^0-9]/g, ' ').trim().match(/\b(\d{5})\b/); return x ? x[1] : null; }
function extractMods(val) { if (!val) return []; const known = MODIFIERS.map(m => m.code); const mods = []; (val.match(/[-]?\d{2}/g) || []).forEach(raw => { const c = raw.startsWith('-') ? raw : '-' + raw; if (known.includes(c)) mods.push(c); }); return [...new Set(mods)]; }

function parseImport(text, cptMap) {
  const lines = text.split('\n').filter(l => l.trim());
  if (lines.length < 2) return { entries: [], errors: ['Not enough data rows'], mapping: null, headers: [] };
  const headers = parseLine(lines[0]);
  const hNorm = headers.map(h => normH(h));
  // The app's own exports carry a Credit column. CSV import never turns it
  // back into a no-credit mark (import is not a writer of the flag); it warns
  // instead, so a re-import cannot silently credit no-credit cases. The note
  // goes FIRST: the Import preview shows only the first few messages.
  // Counted over whole records AND physical lines, keeping the larger (an
  // undercount is the silent case): csvField keeps a line break inside a
  // quoted note, splitting one record across lines (a record is open while
  // its '"' count is odd - inner quotes are doubled), while a bare '"' in a
  // tab paste never closes a record. Credit is LAST in every app export, so
  // the last cell counts too: an Excel tab paste shifts cells when a
  // description holds a comma.
  var creditCol = hNorm.indexOf("credit"), ncRows = 0;
  if (creditCol >= 0) {
    var isNC = function(c) { return normH(c[creditCol] || "") === "nocredit" || normH(c[c.length - 1]) === "nocredit"; };
    var rec = null, byLine = 0, byRec = 0;
    lines.slice(1).forEach(function(l) {
      if (isNC(parseLine(l))) byLine++;
      rec = rec === null ? l : rec + "\n" + l;
      if (rec.split('"').length % 2 === 1) { if (isNC(parseLine(rec))) byRec++; rec = null; }
    });
    if (rec !== null && isNC(parseLine(rec))) byRec++;
    ncRows = Math.max(byLine, byRec);
  }
  var creditNote = ncRows > 0 ? ncRows + " row" + (ncRows === 1 ? " is" : "s are") + " marked No credit and will import as CREDITED - to keep the marks, restore the JSON export or the encrypted backup in Settings instead." : "";

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

      const date = dateCol >= 0 ? parseDate2(cols[dateCol]) : todayLocal();
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
    if (creditNote) errors.unshift(creditNote);
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
    var date = mapping.date >= 0 ? parseDate2(cols[mapping.date]) : todayLocal();
    var mods = mapping.modifier >= 0 ? extractMods(cols[mapping.modifier]) : [];
    var notes = mapping.notes >= 0 ? (cols[mapping.notes] || '') : '';
    var info = cptMap[code]; var desc = mapping.desc >= 0 ? (cols[mapping.desc] || '') : ''; var base;
    if (info) { desc = desc || info.desc; base = (mapping.rvu >= 0 && cols[mapping.rvu]) ? (parseFloat(cols[mapping.rvu]) || info.wRVU) : info.wRVU; }
    else { unmatched2++; desc = desc || ('CPT ' + code); base = (mapping.rvu >= 0 && cols[mapping.rvu]) ? (parseFloat(cols[mapping.rvu]) || 0) : 0; }
    entries.push({ id: Date.now().toString() + '-' + i, date: date, cptCode: code, description: desc, category: info ? info.category : 'Imported', baseRVU: base, modifiers: mods, adjustedRVU: calcAdj(base, mods), notes: notes, imported: true });
  }
  if (unmatched2 > 0) errors.push(unmatched2 + ' CPT code(s) not in database');
  if (creditNote) errors.unshift(creditNote);
  return { entries: entries, errors: errors, mapping: mapping, headers: headers };
}

// =======================================
// ERROR BOUNDARY & CRASH RECOVERY
// =======================================
var LAST_GOOD_KEY = "rvu-tracker-last-good";
var LAST_GOOD_TIME_KEY = "rvu-tracker-last-good-time";

function saveLastGood(d) {
  try {
    localStorage.setItem(LAST_GOOD_KEY, JSON.stringify(d));
    // Stamped so a recovery alert can tell the user how old the snapshot is.
    localStorage.setItem(LAST_GOOD_TIME_KEY, new Date().toLocaleString());
  } catch(e) {}
}

function loadLastGood() {
  try { var s = localStorage.getItem(LAST_GOOD_KEY); return s ? JSON.parse(s) : null; } catch(e) { return null; }
}

function validateData(d) {
  if (!d || typeof d !== "object") return false;
  if (!Array.isArray(d.entries)) return false;
  if (!d.settings || typeof d.settings !== "object") return false;
  if (typeof d.settings.ratePerRVU !== "number") return false;
  // Acute fields are optional (older stores lack them) but must have sane
  // shapes when present. repairData resets bad shapes (and migrates away any
  // legacy reconMonths field) before this runs; these are backstops.
  if (d.acuteMonths !== undefined && (typeof d.acuteMonths !== "object" || d.acuteMonths === null || Array.isArray(d.acuteMonths))) return false;
  if (d.acuteRoster !== undefined && !Array.isArray(d.acuteRoster)) return false;
  if (d.acuteMe !== undefined && typeof d.acuteMe !== "string") return false;
  if (d.templates !== undefined && !Array.isArray(d.templates)) return false;
  if (d.paySites !== undefined && !Array.isArray(d.paySites)) return false;
  if (d.payShifts !== undefined && !Array.isArray(d.payShifts)) return false;
  return true;
}

