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
// Local-midnight Date for a "YYYY-MM-DD" key (an Invalid Date for anything
// else). new Date("YYYY-MM-DD") parses as UTC midnight - the evening before
// in US time zones - so a bare date key becomes a Date through here (a
// wall-clock time is key + a local "T" time, never "Z" or an offset).
function localDateYMD(ymd) {
  if (!isYMD(ymd)) return new Date(NaN);
  var p = ymd.split("-");
  return new Date(+p[0], +p[1] - 1, +p[2]);
}
// Whole calendar days from Date a's local day to Date b's (NaN for an
// Invalid Date). Counting local days - not flooring the milliseconds -
// keeps a DST change from moving the day boundary off midnight.
function localDaysBetween(a, b) {
  var da = new Date(a.getFullYear(), a.getMonth(), a.getDate()), db = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((db - da) / 86400000);
}
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
// annualGoal = OR / Tracked goal (logged cases). reconGoal = yearly goal for
// Compare's monthly institution totals (incl. call + clinic). The two tracks
// are independent; Home's Compensation card uses the OR goal for a Compare
// projection only when reconGoal is unset, and says so (compProjection).
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
// RateVersion, LEGACY kind: { id, effective: "YYYY-MM-DD" | null (null =
//   the site's Original rates, in force before every dated version), stipend,
//   stipendHours, callInWeekday, callInWeekendHoliday, hourly, hourlyMinHours
//   (numbers >= 0; stipendHours > 0 - it is the stipend period divisor),
//   hourlyWeekdayDay: bool, label? }
// RateVersion, TYPED kind (Day/Night): { id, effective: "YYYY-MM-DD" | null,
//   label?, shiftTypes: [{ key (fixed for good), label, hours, flat, stipend,
//   stipendLabel, callIn: null | { hourly, thresholdMinutes } }] } - the
//   rules are with the typed helpers (cleanPayTyped) below.
// payShifts: [{ id, date: "YYYY-MM-DD" (shift start), siteId, siteName,
//   callHours, rates: RateVersion COPY (authoritative - like entry wRVU
//   snapshots, pay never re-looks-up the site's current rates), events:
//   [{ date, cls: "wd"|"wn"|"we"|"hol", fee: bool, hours, time? }], cases?,
//   note? }] - note never holds patient info. events[].time is an optional
//   "HH:MM" start, informational only: cls alone decides pay.
//   A TYPED shift (priced by a Day/Night version) is { id, date, siteId,
//   siteName, rates: { id, effective, label?, shiftType: the ONE type it was
//   priced with }, callIns: [whole minutes, in logged order], cases?, note? }
//   - no callHours and no events (a typed write deletes them, a legacy
//   write deletes callIns).
//   Every shift write goes through payShiftFromDraft (or payRepriceShift);
//   a shift's rate copy changes only when its site/date is edited, the
//   user taps "Use current rates" in the editor, or a confirmed re-price.
// Built-in call-pay sites - the owner's two call sites and rates, made public
// by the owner's choice (2026-10-11; see CLAUDE.md). Loaded ONCE into an empty
// call-pay store (repairData, marker settings.paySitesSeeded); after that they
// are ordinary user data - rates change by adding dated versions in Call Pay.
// Key order matches what repairData/cleanPayRate/cleanPayTyped produce, so
// they load without a repair rewrite (check.js asserts this and the worked
// examples). Davenport (owner, 2026-10-18): its earlier "Proposal" rates are
// the Original (effective null), and from 2026-10-01 it pays per shift type -
// Day $2,773.60 flat; Night $291.23 flat + $242.69/hr for time in the
// hospital, paid only once the night's total time in reaches 3:00; no
// stipend. A phone seeded from the older preset gets these through ONE
// confirmed tap ("Use new Davenport rates", payTypedOffers), never repairData.
var DEFAULT_PAY_SITES = [
  { id: "site-silvis", name: "Silvis", weekendDays: [0, 5, 6], casesEarnRVU: true, rates: [
    { id: "rate-silvis-2026-10", effective: "2026-10-01", stipend: 1500, stipendHours: 24, callInWeekday: 291, callInWeekendHoliday: 582, hourly: 125, hourlyMinHours: 0, hourlyWeekdayDay: true }
  ] },
  { id: "site-davenport", name: "Davenport", weekendDays: [0, 6], casesEarnRVU: false, rates: [
    { id: "rate-davenport-2026-10", effective: null, label: "Proposal", stipend: 3189.65, stipendHours: 12, callInWeekday: 291.13, callInWeekendHoliday: 291.13, hourly: 242.69, hourlyMinHours: 3, hourlyWeekdayDay: false },
    { id: "rate-davenport-2026-10-dn", effective: "2026-10-01", shiftTypes: [
      { key: "day", label: "Day", hours: 12, flat: 2773.6, stipend: 0, stipendLabel: "", callIn: null },
      { key: "night", label: "Night", hours: 12, flat: 291.23, stipend: 0, stipendLabel: "", callIn: { hourly: 242.69, thresholdMinutes: 180 } }
    ] }
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
// Built-in directorships - the owner's three medical directorships, made
// public by the owner's choice (2026-10-15; see CLAUDE.md): his name, the
// organization names, the clinic remit address, the GL number, the hourly
// rates and the monthly hour caps. Loaded silently into a store whose
// `directorships` field is MISSING (fresh install, pre-feature store,
// pre-change backup); an EMPTY list means the user removed them and is never
// re-seeded. After seeding, stored data is the source of truth.
var DIRECTORSHIP_PRESET = [
  { id: "icu", name: "ICU Co-Director", shortName: "ICU", org: "MercyOne Genesis Davenport", form: "genesis", printName: "Faraz Khan, MD", emplNo: "", costCtr: "", rate: 200, maxHours: 4.5 },
  { id: "trauma", name: "Trauma Medical Director", shortName: "Trauma", org: "MercyOne Genesis Silvis - Illini", form: "genesis", printName: "Faraz Khan, MD", emplNo: "", costCtr: "", rate: 200, maxHours: 4.25 },
  { id: "wound", name: "Wound Care Program Director", shortName: "Wound", org: "Select Specialty Hospital - Quad Cities", form: "select", printName: "Faraz Khan, MD", rate: 215, maxHours: 8,
    selectHeader: { hospital: "Select Specialty Hospital - Quad Cities", programType: "Wound Care", physicianName: "Faraz Khan, MD", contractingParty: "MercyOne Genesis Health Group",
      remitAddress: ["1228 E Rusholme St. Suite 3020", "Davenport, IA 52803"], glNo: "150-6700-64931", hospitalNo: "" } }
];
function defaultDirectorships() { return JSON.parse(JSON.stringify(DIRECTORSHIP_PRESET)); }
// Missing = never seeded (repairData seeds it); [] = the user removed them.
function dirWillSeed(d) { return !!d && typeof d === "object" && d.directorships === undefined; }
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
// The built-in's first DATED version is its start: payBuiltInVersion is that
// version (legacy or typed), payBuiltInFrom its date. An Original (null
// date) is never it.
function payBuiltInVersion(def) {
  var best = null;
  (def && Array.isArray(def.rates) ? def.rates : []).forEach(function(r) { if (r && isYMD(r.effective) && (!best || payEffKey(r) < payEffKey(best))) best = r; });
  return best;
}
function payBuiltInFrom(def) { var v = payBuiltInVersion(def); return v ? v.effective : ""; }
// $0 rates of either kind: every legacy amount 0, or every type's flat and
// stipend 0 with no call-in hourly.
function payRateZero(r) {
  if (payRateIsTyped(r)) { var l = payRateTypes(r); return l.length > 0 && l.every(function(t) { return !!t && payNum(t.flat) === 0 && (t.stipend === undefined || payNum(t.stipend) === 0) && (!t.callIn || payNum(t.callIn.hourly) === 0); }); }
  return !!r && r.stipend === 0 && r.callInWeekday === 0 && r.callInWeekendHoliday === 0 && r.hourly === 0;
}
// $0 versions dated on/after the built-in start: they would shadow it.
function payBuiltInDrops(site, from) {
  return site.rates.filter(function(r) { return payRateZero(r) && typeof r.effective === "string" && payEffKey(r) >= from; });
}
// What "Use built-in rates" would do to one site, or null when a non-$0
// version is in force on the built-in start date (then the site is never
// touched). remove/removeDates: the $0 versions dropped; later: the user's
// next own version after the start (it still applies from its date); days:
// a hand-made site still on the default Sat/Sun weekend takes the preset's
// weekend days (e.g. adds Friday).
function payBuiltInPlan(site, def) {
  if (!site || !Array.isArray(site.rates) || !payBuiltInVersion(def)) return null;
  var from = payBuiltInFrom(def);
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
  var from = payBuiltInFrom(def);
  var drops = payBuiltInDrops(site, from);
  var rates = site.rates.filter(function(r) { return drops.indexOf(r) === -1; });
  var add = JSON.parse(JSON.stringify(payBuiltInVersion(def)));
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
// "Use new Davenport rates" (one confirmed tap): a built-in whose first
// dated version is TYPED is offered to the site that stands for it
// (payBuiltInFor) while that site has no typed version and a PAYING legacy
// version is in force on the start date. Never together with R1; never for
// an ambiguous name, a site that already has an Original, or two versions
// dated exactly on the start (the editor sorts those out). The plan:
//   original: the id of the legacy version dated exactly on the start,
//     which becomes the Original (effective null) with its values, id and
//     label kept - "" when the version in force is dated earlier (it then
//     keeps its date and keeps pricing the dates before the start);
//   remove / removeDates: $0 versions dated from the start (the R1 rule);
//   later: the site's next paying version after the start (kept);
//   needType: how many recorded shifts would then need Day or Night.
// repairData never does any of this; callpay.js re-plans inside the updater.
function payTypedPlan(site, def, shifts) {
  var v = payBuiltInVersion(def), from = payBuiltInFrom(def);
  if (!site || !Array.isArray(site.rates) || !payRateIsTyped(v)) return null;
  if (site.rates.some(function(r) { return payRateIsTyped(r) || (!!r && r.effective === null); })) return null;
  var onStart = site.rates.filter(function(r) { return !!r && r.effective === from; });
  if (onStart.length > 1) return null;
  var inForce = rateInForce(site, from);
  if (!inForce || payRateIsTyped(inForce) || payRateZero(inForce)) return null;
  var drops = payBuiltInDrops(site, from);
  var later = site.rates.map(function(r) { return r && !payRateZero(r) ? r.effective : null; }).filter(function(e) { return isYMD(e) && e > from; }).sort()[0] || "";
  var out = { original: onStart.length === 1 && onStart[0] === inForce ? inForce.id : "", remove: drops.map(function(r) { return r.id; }), removeDates: drops.map(function(r) { return r.effective; }), later: later, needType: 0 };
  if (Array.isArray(shifts)) out.needType = payNeedsTypeCount(shifts, [payApplyTyped(site, def, out)]);
  return out;
}
// A NEW site object with the plan applied: $0 versions dropped, the start-
// date version re-dated to null (same object otherwise), a deep copy of the
// typed version appended (a fresh id if that id is taken). weekendDays and
// casesEarnRVU are never touched.
function payApplyTyped(site, def, plan) {
  var v = payBuiltInVersion(def);
  if (!site || !Array.isArray(site.rates) || !plan || !payRateIsTyped(v)) return site;
  var rm = Array.isArray(plan.remove) ? plan.remove : [];
  var rates = site.rates.filter(function(r) { return !r || rm.indexOf(r.id) === -1; }).map(function(r) { return r && plan.original && r.id === plan.original ? { ...r, effective: null } : r; });
  var add = JSON.parse(JSON.stringify(v));
  if (rates.some(function(r) { return !!r && r.id === add.id; })) add.id = add.id + "-" + Date.now().toString(36);
  return { ...site, rates: rates.concat([add]) };
}
function payTypedOffers(sites, shifts) {
  var out = [];
  DEFAULT_PAY_SITES.forEach(function(def) {
    if (!payRateIsTyped(payBuiltInVersion(def))) return;
    var m = payBuiltInFor(sites, def);
    if (!m || !m.site) return;
    var plan = payTypedPlan(m.site, def, shifts);
    if (plan) out.push({ def: def, site: m.site, by: m.by, plan: plan });
  });
  return out;
}
// A legacy shift that needs Day or Night: its site is a CURRENT site whose
// version in force on the shift's date is typed. The type is never guessed;
// such a shift is counted (needsType) and never summed until it is set.
function payShiftNeedsType(shift, sites) {
  if (!shift || typeof shift !== "object" || payShiftIsTyped(shift) || !isYMD(shift.date)) return false;
  var site = paySiteById(sites, shift.siteId);
  return !!site && payRateIsTyped(rateInForce(site, shift.date));
}
function payNeedsTypeCount(shifts, sites) { var n = 0; (Array.isArray(shifts) ? shifts : []).forEach(function(s) { if (payShiftNeedsType(s, sites)) n++; }); return n; }
// Saving `rates` for `site` would NEWLY flag these recorded shifts (the
// rates editor asks first): { count, from, to } over their dates.
function payNeedsTypeDelta(site, rates, shifts) {
  var now = site ? [site] : [], next = site ? [{ ...site, rates: Array.isArray(rates) ? rates : [] }] : [], dates = [];
  (Array.isArray(shifts) ? shifts : []).forEach(function(s) { if (s && !payShiftNeedsType(s, now) && payShiftNeedsType(s, next)) dates.push(s.date); });
  dates.sort();
  return { count: dates.length, from: dates[0] || "", to: dates[dates.length - 1] || "" };
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
const defState = () => ({ entries: [], settings: { ...defSettings(), paySitesSeeded: true }, rvuOverrides: {}, favorites: [], institutionData: [], acuteRoster: [], acuteMe: "", acuteMonths: {}, templates: [], paySites: defaultPaySites(), payShifts: [], directorships: defaultDirectorships(), dirEntries: [], dirHandoff: {}, dirSignatureEnc: null, dataVersion: DATA_VERSION });
const SK = "rvu-tracker-data";

// One-time cleanup: remove the legacy PLAINTEXT auto-backup blob (an unencrypted
// copy of all entries incl. patient initials/notes, written by old Settings code
// and never read anywhere). The encrypted clipboard backup feature is unrelated.
try { localStorage.removeItem("rvu-backup"); localStorage.removeItem("rvu-backup-time"); } catch(e) {}

// Backup stamp: when THIS phone last saved a backup, plus Home's nudge snooze.
// ONE localStorage key OUTSIDE the data store: never a defState/loadData/
// finishRestore field, never inside a backup, untouched by restore and by
// last-good recovery. Only these helpers touch it (check.js). Never name it
// "rvu-backup"/"rvu-backup-time": the line above deletes those on every load.
var BACKUP_STAMP_KEY = "rvu-last-backup";
var BACKUP_NUDGE_DAYS = 14;
var BACKUP_SNOOZE_DAYS = 7;
function backupStampParse(raw) {
  var o = null;
  if (typeof raw === "string") { try { o = JSON.parse(raw); } catch(e) { o = null; } }
  if (!o || typeof o !== "object" || Array.isArray(o)) o = {};
  return { date: isYMD(o.date) ? o.date : "", how: (o.how === "file" || o.how === "copy") ? o.how : "", snooze: isYMD(o.snooze) ? o.snooze : "" };
}
function readBackupStamp() { var raw = null; try { raw = localStorage.getItem(BACKUP_STAMP_KEY); } catch(e) { raw = null; } return backupStampParse(raw); }
function backupStampWrite(st) { try { localStorage.setItem(BACKUP_STAMP_KEY, JSON.stringify(st)); } catch(e) {} return st; }
// A backup left the app today (file shared/downloaded, or code copied). Clears any snooze.
function markBackupSaved(how, today) { return backupStampWrite({ date: isYMD(today) ? today : todayLocal(), how: how === "copy" ? "copy" : "file", snooze: "" }); }
// Home's x: hide the nudge for BACKUP_SNOOZE_DAYS and keep the date.
function snoozeBackupNudge(today) { var st = readBackupStamp(); st.snooze = addDaysYMD(isYMD(today) ? today : todayLocal(), BACKUP_SNOOZE_DAYS); return backupStampWrite(st); }
// Due when there is something to lose and the last backup is >= 14 days old
// (or none). A snooze counts only while it ends within 7 days of today, so a
// clock change cannot silence it for good.
function backupNudgeDue(st, today, itemCount) {
  if (!st || typeof st !== "object" || !isYMD(today) || !(itemCount > 0)) return false;
  if (isYMD(st.snooze) && today < st.snooze && st.snooze <= addDaysYMD(today, BACKUP_SNOOZE_DAYS)) return false;
  if (!isYMD(st.date)) return true;
  return addDaysYMD(st.date, BACKUP_NUDGE_DAYS) <= today;
}
function backupFileName(today) { return "rvu-backup-" + (isYMD(today) ? today : todayLocal()) + ".txt"; }

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
// Two kinds of rate version share one site's `rates` list (Day/Night batch):
// a TYPED version carries `shiftTypes`, and a typed shift's rate copy carries
// the one `shiftType` it was priced with; everything else is a LEGACY
// version (the stipend / call-in fee / hourly shape below). `effective:
// null` marks a site's Original rates - in force before every dated version.
// This build only READS the typed shapes: repairData keeps them exactly as
// they are, computeShiftPay prices none of them (unpriced), payDraftRate
// never picks one, and re-pricing never crosses kinds - so a rollback to it
// never drops or misprices Day/Night data.
function payRateIsTyped(r) { return !!r && typeof r === "object" && !Array.isArray(r) && (Array.isArray(r.shiftTypes) || (!!r.shiftType && typeof r.shiftType === "object" && !Array.isArray(r.shiftType))); }
function payShiftIsTyped(s) { return !!s && typeof s === "object" && !Array.isArray(s) && payRateIsTyped(s.rates) && !!s.rates.shiftType; }
// A version's start as a sort / compare key: its date, "" for an Original
// (sorts before every date, so plain string compares still work), or null
// when it is neither (unreadable - never in force).
function payEffKey(r) { if (!r || typeof r !== "object") return null; if (r.effective === null) return ""; return isYMD(r.effective) ? r.effective : null; }
// Returns a cleaned COPY (unknown fields kept) or null if unreadable.
function cleanPayRate(r, fallbackId) {
  if (!r || typeof r !== "object" || Array.isArray(r) || payEffKey(r) === null) return null;
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

// --- Typed (Day/Night) rate versions: shapes, repair, pricing ---
// Typed version: { id, effective: "YYYY-MM-DD" | null, label?, shiftTypes: [ShiftType, ...] }
// ShiftType:     { key, label, hours, flat, stipend, stipendLabel,
//                  callIn: null | { hourly, thresholdMinutes } }
// Typed shift:   { id, date (the day the shift STARTS), siteId, siteName,
//                  rates: { id, effective, label?, shiftType }, callIns: [whole
//                  minutes, in logged order], cases?, note? } - no callHours,
//                  no events.
// `key` is fixed for good (renaming a type changes only its label): stale
// checks, re-pricing and the totals split match by key. Pay = flat + stipend
// (a line only when > 0) + call-in pay, each line rounded once. The call-in
// rule is ONE rule (owner, 2026-10-18): the night's call-in minutes are
// summed and tested against thresholdMinutes once - under it nothing is
// paid, at or over it every minute is paid (there is no per-trip option).
function payWholeMin(v) { var n = payNum(v); return n !== null && n % 1 === 0 ? n : null; }
// A cleaned COPY of one shift type (unknown fields kept) or null: key and
// label non-empty, hours > 0, flat >= 0, stipend >= 0 (missing = 0),
// stipendLabel a string (missing = ""), callIn null or { hourly >= 0,
// thresholdMinutes a whole number >= 0 }. Numeric text converts.
function cleanPayTypeDef(t) {
  if (!t || typeof t !== "object" || Array.isArray(t)) return null;
  if (typeof t.key !== "string" || !t.key || typeof t.label !== "string" || !t.label.trim()) return null;
  var c = { ...t };
  var hours = payNum(t.hours); if (hours === null || !(hours > 0)) return null; c.hours = hours;
  var flat = payNum(t.flat); if (flat === null) return null; c.flat = flat;
  var stipend = t.stipend === undefined ? 0 : payNum(t.stipend); if (stipend === null) return null; c.stipend = stipend;
  if (t.stipendLabel === undefined) c.stipendLabel = ""; else if (typeof t.stipendLabel !== "string") return null;
  if (t.callIn === undefined || t.callIn === null) c.callIn = null;
  else {
    if (typeof t.callIn !== "object" || Array.isArray(t.callIn)) return null;
    var hourly = payNum(t.callIn.hourly), thr = payWholeMin(t.callIn.thresholdMinutes);
    if (hourly === null || thr === null) return null;
    c.callIn = { ...t.callIn, hourly: hourly, thresholdMinutes: thr };
  }
  return c;
}
// A cleaned COPY of a typed version or null: a real date or null, at least
// one type, unique keys, every type readable.
function cleanPayTyped(r, fallbackId) {
  if (!r || typeof r !== "object" || Array.isArray(r) || !Array.isArray(r.shiftTypes) || r.shiftTypes.length === 0 || payEffKey(r) === null) return null;
  var c = { ...r }, keys = {}, types = [];
  for (var i = 0; i < r.shiftTypes.length; i++) {
    var t = cleanPayTypeDef(r.shiftTypes[i]);
    if (!t || keys[t.key] === true) return null;
    keys[t.key] = true; types.push(t);
  }
  c.shiftTypes = types;
  if (typeof c.id !== "string" || !c.id) c.id = fallbackId;
  if (c.label !== undefined && typeof c.label !== "string") delete c.label;
  return c;
}
// A typed shift's own rate copy (the version's id, date and label plus the
// ONE type it was priced with): a cleaned COPY or null.
function cleanPayTypeCopy(r, fallbackId) {
  if (!r || typeof r !== "object" || Array.isArray(r) || payEffKey(r) === null) return null;
  var t = cleanPayTypeDef(r.shiftType);
  if (!t) return null;
  var c = { ...r, shiftType: t };
  if (typeof c.id !== "string" || !c.id) c.id = fallbackId;
  if (c.label !== undefined && typeof c.label !== "string") delete c.label;
  return c;
}
// Call-in minutes: a list of whole minutes >= 0 (numeric text converts);
// missing or null = none. null when unreadable.
function payCleanCallIns(v) {
  if (v === undefined || v === null) return [];
  if (!Array.isArray(v)) return null;
  var out = [];
  for (var i = 0; i < v.length; i++) { var m = payWholeMin(v[i]); if (m === null) return null; out.push(m); }
  return out;
}
// The type list of a typed version, or the one type of a typed shift's copy.
function payRateTypes(r) { return r && Array.isArray(r.shiftTypes) ? r.shiftTypes : r && r.shiftType && typeof r.shiftType === "object" ? [r.shiftType] : []; }
function payTypeByKey(r, key) { var l = payRateTypes(r); for (var i = 0; i < l.length; i++) { if (l[i] && l[i].key === key) return l[i]; } return null; }
// The ONE call-in rule. minutes: the night's trips in whole minutes. Returns
// { trips, minutes (all time in), paidMinutes, met, threshold, hourly,
// amount } with amount = round2(paidMinutes / 60 x hourly).
function payCallInSummary(minutes, callIn) {
  var list = payCleanCallIns(minutes) || [], total = 0;
  list.forEach(function(m) { total += m; });
  var thr = callIn ? payWholeMin(callIn.thresholdMinutes) : null, hourly = callIn ? payNum(callIn.hourly) : null;
  if (thr === null) thr = 0;
  if (hourly === null) hourly = 0;
  var met = list.length > 0 && total >= thr, paid = met ? total : 0;
  return { trips: list.length, minutes: total, paidMinutes: paid, met: met, threshold: thr, hourly: hourly, amount: round2(paid / 60 * hourly) };
}
// Whole minutes from two numeric boxes (the iOS number pad has no ":"): one
// blank box counts as 0; both blank, a non-digit, or minutes over 59 = null.
function payHM(h, m) {
  var hs = typeof h === "string" ? h.trim() : typeof h === "number" ? String(h) : "";
  var ms = typeof m === "string" ? m.trim() : typeof m === "number" ? String(m) : "";
  if (hs === "" && ms === "") return null;
  if ((hs !== "" && !/^\d{1,3}$/.test(hs)) || (ms !== "" && !/^\d{1,2}$/.test(ms))) return null;
  var mm = ms === "" ? 0 : +ms;
  if (mm > 59) return null;
  return (hs === "" ? 0 : +hs) * 60 + mm;
}
// Why a call-in row { h, m } cannot be read: "" (fine), "ciBlank", "ciBad"
// or "ciMin" - the shift form's problem codes.
function payCiRowProblem(row) {
  var hs = row && typeof row.h === "string" ? row.h.trim() : "", ms = row && typeof row.m === "string" ? row.m.trim() : "";
  if (hs === "" && ms === "") return "ciBlank";
  if ((hs !== "" && !/^\d{1,3}$/.test(hs)) || (ms !== "" && !/^\d{1,2}$/.test(ms))) return "ciBad";
  if (ms !== "" && +ms > 59) return "ciMin";
  return "";
}
function payFmtHM(min) { var t = Math.round(payNum(min) || 0); return Math.floor(t / 60) + ":" + (t % 60 < 10 ? "0" : "") + (t % 60); }
// Money and dates for the texts built here (no locale: a preview or a
// confirm must read the same on every phone).
function payMoney(v) {
  var n = payNum(v);
  if (n === null) return "";
  var c = Math.round(parseFloat((n * 100).toPrecision(12)));
  return "$" + String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + (c % 100 < 10 ? "0" : "") + (c % 100);
}
var PAY_MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function payDateLabel(ymd) { return isYMD(ymd) ? PAY_MONTHS[+ymd.slice(5, 7) - 1] + " " + (+ymd.slice(8, 10)) + ", " + ymd.slice(0, 4) : ""; }
// "Original" for a null date, else e.g. "Oct 1, 2026".
function payVersionDateLabel(v) { return v && v.effective === null ? "Original" : v ? payDateLabel(v.effective) : ""; }
// One-line preview of a shift type (the rates editor and the shift form).
function payTypePreview(t) {
  var c = cleanPayTypeDef(t), name = t && typeof t.label === "string" && t.label.trim() ? t.label.trim() : "Shift";
  if (!c) return name + ": fill in the amounts";
  var s = name + ": " + payMoney(c.flat);
  if (c.stipend > 0) s += " + " + payMoney(c.stipend) + (c.stipendLabel ? " " + c.stipendLabel : "");
  if (c.callIn) s += " + " + payMoney(c.callIn.hourly) + "/hr" + (c.callIn.thresholdMinutes > 0 ? " when in " + payFmtHM(c.callIn.thresholdMinutes) + "+" : "");
  return s;
}
// Call-ins on a shift of either kind.
function payShiftCallInCount(s) { return !s ? 0 : payShiftIsTyped(s) ? (Array.isArray(s.callIns) ? s.callIns.length : 0) : (Array.isArray(s.events) ? s.events.length : 0); }
// The time-in line of a split bucket (paySplitOut), e.g. "18:59 in \u00B7 3:00+
// on 3 of 8" - the same words on Home, the Totals year block and a month.
function payBucketInLine(b) {
  if (!b) return "";
  var n = b.ciShifts || 0, met = b.metCount || 0;
  return payFmtHM(b.inMin) + " in \u00B7 " + (typeof b.threshold === "number" ? payFmtHM(b.threshold) + "+ on " + met + " of " + n : "met the threshold on " + met + " of " + n);
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
          var rLbl = s.name + " " + (r && r.effective === null ? "original" : r && typeof r.effective === "string" ? r.effective : "#" + (ri + 1));
          // A typed (Day/Night) version has its own rules (cleanPayTyped); a
          // bad one drops with the same notice. Either kind may be the Original.
          var cr = payRateIsTyped(r) ? cleanPayTyped(r, cs.id + "-r" + ri) : cleanPayRate(r, cs.id + "-r" + ri);
          if (cr) cs.rates.push(cr);
          else droppedR.push(rLbl);
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
        if (payShiftIsTyped(p)) {
          // A typed (Day/Night) shift: its date, its type copy and its call-in
          // minutes must all read, or the whole shift drops (same notice).
          var tl = (typeof p.date === "string" && p.date ? p.date : "#" + (pi + 1)) + (typeof p.siteName === "string" && p.siteName ? " " + p.siteName : "");
          var tp = { ...p }, tok = isYMD(p.date);
          if (tok) { tp.rates = cleanPayTypeCopy(p.rates, "rate-" + p.date); tok = !!tp.rates; }
          if (tok) { tp.callIns = payCleanCallIns(p.callIns); tok = !!tp.callIns; }
          if (!tok) { droppedP.push(tl); return; }
          if (typeof tp.id !== "string" || !tp.id) tp.id = "shift-" + Date.now().toString(36) + "-" + pi;
          if (typeof tp.siteId !== "string") tp.siteId = "";
          if (typeof tp.siteName !== "string") tp.siteName = "";
          if (tp.cases !== undefined) { var tcc = payNum(tp.cases); if (tcc === null) { delete tp.cases; droppedC.push(tl); } else tp.cases = tcc; }
          if (tp.note !== undefined && typeof tp.note !== "string") delete tp.note;
          if (JSON.stringify(tp) !== JSON.stringify(p)) fixed.push("payShifts." + (pi + 1));
          cleanP.push(tp);
          return;
        }
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
  // Directorships. MISSING directorships = never seeded -> the preset,
  // silently (fresh install, pre-feature store, pre-change backup); an EMPTY
  // list means the user removed them and is never re-seeded. Repair never
  // drops an entry over its range or its category (hours must never fall
  // off a pay form; the form blocks until it is edited) - only an entry
  // whose directorship, date or minutes are unreadable, and LOUDLY.
  var dirJoin = function(list) { return list.slice(0, 5).join(", ") + (list.length > 5 ? " and " + (list.length - 5) + " more" : ""); };
  var dirLbl = function(s) { s = String(s); return s.length > 40 ? s.slice(0, 39) + "." : s; };
  var dirNames = {};
  if (d && typeof d === "object") {
    if (d.directorships === undefined) { d.directorships = defaultDirectorships(); fixed.push("directorships-seeded"); }
    else if (!Array.isArray(d.directorships)) {
      d.directorships = []; fixed.push("directorships");
      lossMsgs.push("Directorships were unreadable and have been reset - tap Restore built-in directorships in Settings. Logged hours are kept.");
    } else {
      var dDrop = [], dDropIds = [], dNums = [], dHdr = [], dSeen = {}, cleanD = [];
      d.directorships.forEach(function(x, xi) {
        var ok = dirPlainObj(x) && typeof x.name === "string" && x.name.trim() !== "" && (x.form === "genesis" || x.form === "select");
        if (!ok) { dDrop.push(dirLbl(dirPlainObj(x) && typeof x.name === "string" && x.name.trim() ? x.name.trim() : "#" + (xi + 1))); dDropIds.push(dirPlainObj(x) && typeof x.id === "string" ? x.id : ""); return; }
        var before = JSON.stringify(x), c = { ...x }, nm = dirLbl(x.name.trim());
        // A ":" in an id is fine (every key parser splits at the LAST ":");
        // renewing it would orphan its entries and hand-offs.
        if (typeof c.id !== "string" || !c.id.trim() || dSeen[c.id] === true) c.id = dirNewId() + "-" + xi;
        dSeen[c.id] = true;
        ["rate", "maxHours"].forEach(function(k) {
          var v = payNum(c[k]);
          if (v === null) { c[k] = 0; dNums.push(nm + " " + (k === "rate" ? "rate" : "max hours")); } else c[k] = v;
        });
        ["shortName", "org", "printName", "emplNo", "costCtr"].forEach(function(k) {
          if (c[k] === undefined || typeof c[k] === "string") return;
          c[k] = typeof c[k] === "number" && isFinite(c[k]) ? String(c[k]) : "";
        });
        if (c.selectHeader !== undefined) {
          if (!dirPlainObj(c.selectHeader)) { delete c.selectHeader; dHdr.push(nm); }
          else {
            var h = { ...c.selectHeader };
            ["hospital", "programType", "physicianName", "contractingParty", "glNo", "hospitalNo"].forEach(function(k) {
              if (h[k] === undefined || typeof h[k] === "string") return;
              h[k] = typeof h[k] === "number" && isFinite(h[k]) ? String(h[k]) : "";
            });
            var ra = h.remitAddress;
            if (typeof ra === "string") h.remitAddress = [ra, ""];
            else if (Array.isArray(ra)) {
              var rs = ra.map(function(v) { return typeof v === "string" ? v : typeof v === "number" && isFinite(v) ? String(v) : ""; });
              if (rs.length !== 2 || rs.some(function(v, i) { return v !== ra[i]; })) h.remitAddress = [rs[0] || "", rs.slice(1).filter(function(v) { return v !== ""; }).join(", ")];
            } else if (ra !== undefined) h.remitAddress = ["", ""];
            c.selectHeader = h;
          }
        }
        if (JSON.stringify(c) !== before) fixed.push("directorships." + (xi + 1));
        dirNames[c.id] = c.shortName && typeof c.shortName === "string" ? c.shortName : c.name.trim();
        cleanD.push(c);
      });
      if (dDrop.length) {
        // Three cases: the id is still held by a kept directorship (its hours
        // stay there); a dropped BUILT-IN comes back with its hours through
        // Restore; any other cannot be reattached (re-adding makes a new id).
        fixed.push("directorships-dropped");
        var biIds = {}, dropDup = [], dropBI = [], dropOther = [];
        DIRECTORSHIP_PRESET.forEach(function(p) { biIds[p.id] = true; });
        dDrop.forEach(function(l, i) { var id = dDropIds[i]; (id && dSeen[id] === true ? dropDup : id && biIds[id] === true ? dropBI : dropOther).push(l); });
        var one = function(list, a, b) { return list.length === 1 ? a : b; };
        if (dropDup.length) lossMsgs.push("Directorship" + one(dropDup, " ", "s ") + dirJoin(dropDup) + " " + one(dropDup, "was", "were") + " unreadable and removed. " + one(dropDup, "It", "They") + " shared an id with a directorship you still have, so " + one(dropDup, "its", "their") + " logged hours stay on that one - check them in Directorships and don't re-log them.");
        if (dropBI.length) lossMsgs.push("Directorship" + one(dropBI, " ", "s ") + dirJoin(dropBI) + " " + one(dropBI, "was", "were") + " unreadable and removed - tap Restore in Settings > Directorships to bring " + one(dropBI, "it", "them") + " back with " + one(dropBI, "its", "their") + " logged hours. Don't add " + one(dropBI, "it", "them") + " again by hand.");
        if (dropOther.length) lossMsgs.push("Directorship" + one(dropOther, " ", "s ") + dirJoin(dropOther) + " " + one(dropOther, "was", "were") + " unreadable and removed. " + one(dropOther, "Its", "Their") + " logged hours are kept but can't be reattached - add " + one(dropOther, "it", "them") + " again in Settings and re-log those hours.");
      }
      if (dNums.length) lossMsgs.push("Directorship numbers were unreadable and cleared - re-enter them in Settings > Directorships: " + dirJoin(dNums) + ".");
      if (dHdr.length) lossMsgs.push("The Select form details for " + dirJoin(dHdr) + " were unreadable and removed - re-enter them in Settings > Directorships.");
      d.directorships = cleanD;
    }
    if (d.dirEntries !== undefined) {
      if (!Array.isArray(d.dirEntries)) {
        d.dirEntries = []; fixed.push("dirEntries");
        lossMsgs.push("Directorship time entries were unreadable and have been reset - please re-enter them in Directorships.");
      } else {
        var eDrop = [], eSeen = {}, cleanE = [];
        d.dirEntries.forEach(function(e, ei) {
          var isObj = dirPlainObj(e);
          var mins = isObj ? payNum(e.minutes) : null;
          if (!isObj || typeof e.dirId !== "string" || !e.dirId || !isYMD(e.date) || mins === null) {
            eDrop.push(dirLbl(isObj && typeof e.dirId === "string" && e.dirId ? (dirNames[e.dirId] || e.dirId) + (typeof e.date === "string" ? " " + e.date : "") : "#" + (ei + 1)));
            return;
          }
          var before = JSON.stringify(e), c = { ...e };
          c.minutes = Math.round(mins);
          if (typeof c.id !== "string" || !c.id || eSeen[c.id]) c.id = dirEntryId(ei);
          eSeen[c.id] = true;
          if (typeof c.category !== "string") c.category = "";
          if (typeof c.detail !== "string") c.detail = typeof c.detail === "number" && isFinite(c.detail) ? String(c.detail) : "";
          if (JSON.stringify(c) !== before) fixed.push("dirEntries." + (ei + 1));
          cleanE.push(c);
        });
        if (eDrop.length) { fixed.push("dirEntries-dropped"); lossMsgs.push("Directorship time " + (eDrop.length === 1 ? "entry " : "entries ") + dirJoin(eDrop) + " " + (eDrop.length === 1 ? "was" : "were") + " unreadable and removed - please re-enter " + (eDrop.length === 1 ? "it" : "them") + " in Directorships."); }
        d.dirEntries = cleanE;
      }
    }
    if (d.dirHandoff !== undefined) {
      if (!dirPlainObj(d.dirHandoff)) {
        d.dirHandoff = {}; fixed.push("dirHandoff");
        lossMsgs.push("Directorship hand-off records were unreadable and have been reset - use Mark handed off for any month already saved to Drive.");
      } else {
        var hDrop = [];
        Object.keys(d.dirHandoff).forEach(function(k) {
          var v = d.dirHandoff[k];
          if (/^(.+):(\d{4})-(0[1-9]|1[0-2])$/.test(k) && dirPlainObj(v) && isYMD(v.date) && typeof v.entriesHash === "string" && v.entriesHash) return;
          hDrop.push(dirLbl(k)); delete d.dirHandoff[k];
        });
        if (hDrop.length) { fixed.push("dirHandoff-dropped"); lossMsgs.push("Hand-off record" + (hDrop.length === 1 ? " " : "s ") + dirJoin(hDrop) + " " + (hDrop.length === 1 ? "was" : "were") + " unreadable and removed - use Mark handed off if " + (hDrop.length === 1 ? "that month was" : "those months were") + " already saved to Drive."); }
      }
    }
    if (d.dirSignatureEnc !== undefined && d.dirSignatureEnc !== null) {
      var se = d.dirSignatureEnc;
      if (!(dirPlainObj(se) && typeof se.ct === "string" && se.ct && typeof se.salt === "string" && se.salt && typeof se.iv === "string" && se.iv)) {
        d.dirSignatureEnc = null; fixed.push("dirSignatureEnc");
        lossMsgs.push("Your saved signature was unreadable and was removed - draw it again in Settings > Directorships.");
      }
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
  // The banner text also rides on the result as fixed.loss (a non-index
  // property: length/join/JSON are unchanged) so recoverFromBad, whose own
  // banner replaces this one, can carry it.
  if (lossMsgs.length > 0) { fixed.loss = lossMsgs.join(" "); showDataAlert(fixed.loss); }
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
  // showDataAlert keeps ONE bar, so the snapshot's repair-loss notice
  // (fixed.loss) goes inside the recovery banner or it is never seen.
  var lg = null, lgLoss = "";
  try { lg = loadLastGood(); if (lg) { var lgFixed = repairData(lg); if (lgFixed && lgFixed.loss) lgLoss = " In that snapshot: " + lgFixed.loss; } } catch(e) { lg = null; }
  if (lg && validateData(lg)) {
    var age = "";
    try { var ts = localStorage.getItem(LAST_GOOD_TIME_KEY); if (ts) age = " (saved " + ts + ")"; } catch(e) {}
    showDataAlert("DATA RECOVERY: your saved data " + reason + ". An older snapshot" + age + " was loaded instead - anything logged after that snapshot is NOT in the app right now." + lgLoss + preservedMsg + " Export a backup from Settings before continuing.", clearCorruptCopy);
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
    var d = { entries: s.entries || [], settings: { ...defSettings(), ...s.settings }, rvuOverrides: s.rvuOverrides || {}, favorites: s.favorites || [], institutionData: s.institutionData || [], acuteRoster: s.acuteRoster || [], acuteMe: s.acuteMe || "", acuteMonths: s.acuteMonths || {}, templates: s.templates || [], paySites: s.paySites || [], payShifts: s.payShifts || [], directorships: s.directorships, dirEntries: s.dirEntries || [], dirHandoff: s.dirHandoff || {}, dirSignatureEnc: s.dirSignatureEnc || null, dataVersion: s.dataVersion || DATA_VERSION };
    // directorships passes through RAW: missing = never seeded (repairData
    // seeds the preset), [] = the user removed them (never re-seeded).
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

// Apply user overrides to the CPT database. An override is in force only when
// truthy: a stored 0 (the old keystroke editor could save one) is inert and the
// code keeps its CMS value. Deliberate - honoring 0 would silently zero that
// code on any phone holding one. check.js pins it; the Settings editor badges
// and counts with the same test.
function getDB(overrides) {
  let db = [...CPT_DATABASE_DEFAULT];

  if (overrides && Object.keys(overrides).length > 0) {
    db = db.map(c => overrides[c.code] ? { ...c, wRVU: overrides[c.code] } : c);
  }
  return db;
}

// wRVU editor commit rule (Settings). text = a row's typed draft, cms = the
// code's CMS wRVU. Returns null = remove the override (the CMS value itself),
// a number > 0 = the override, undefined = refuse and revert (blank,
// unreadable, or 0 - getDB ignores a 0, so storing one would badge "custom"
// while Log kept CMS).
function rvuOverrideFromText(text, cms) {
  var t = String(text == null ? "" : text).trim();
  if (t === "" || !/^\d*\.?\d*$/.test(t) || !/\d/.test(t)) return undefined;
  var n = parseFloat(t);
  if (typeof cms === "number" && Math.abs(n - cms) < 0.001) return null;
  return n > 0 ? n : undefined;
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
// Settings "Remove Duplicates" (one rule; check.js tests it): a case is a
// duplicate only when an earlier case in the list (list order, not date) has
// the same date, code, modifiers (any order), patient (encounterId), notes
// AND call fields (entryCallKey: Call/Private, call site, credit). The first
// copy is kept, list order is unchanged and no entry is changed. Copies that
// differ only in their call fields are never merged: mixed counts those
// cases for the user to check in History. A non-object entry is kept.
function entryDuplicateScan(entries) {
  var seen = {}, callSeen = {}, unique = [], removed = [];
  (Array.isArray(entries) ? entries : []).forEach(function(e) {
    if (!e || typeof e !== "object") { unique.push(e); return; }
    var base = e.date + "|" + e.cptCode + "|" + (Array.isArray(e.modifiers) ? e.modifiers.slice().sort().join(",") : "") + "|" + (e.encounterId || "") + "|" + (e.notes || "");
    var ck = entryCallKey(e);
    callSeen[base] = callSeen[base] === undefined || callSeen[base] === ck ? ck : "mixed";
    var key = base + "|" + ck;
    if (seen[key] === true) removed.push(e); else { seen[key] = true; unique.push(e); }
  });
  var mixed = Object.keys(callSeen).filter(function(k) { return callSeen[k] === "mixed"; }).length;
  return { unique: unique, removed: removed, mixed: mixed };
}
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
// When Log got the call-site picker (fb7375f, 2026-10-13 09:50 UTC) plus a
// margin for phones still running the old version. A Call case CREATED
// later went through a site picker, so a siteless one is a deliberate
// "Other site" pick and the fix-up never lists it.
var CALL_SITE_PICKER_MS = Date.UTC(2026, 9, 16);
// An entry's creation time from its id (Log, History and import ids start
// with Date.now()); NaN when the id carries none - it then counts as older.
function entryCreatedMs(e) {
  var m = !!e && typeof e === "object" && typeof e.id === "string" ? /^(\d{12,})/.exec(e.id) : null;
  return m ? +m[1] : NaN;
}
// Call cases dated on/after CALL_NO_CREDIT_FROM with NO stored site, created
// before the site picker (so not a deliberate "Other site"), minus the ids
// the user chose to keep as they are: they earn credit until a site is
// picked. History's one-tap fix-up lists them.
function entrySitelessCalls(entries, kept) {
  var skip = Array.isArray(kept) ? kept : [];
  return (Array.isArray(entries) ? entries : []).filter(function(e) {
    return !!e && typeof e === "object" && !!e.isCall && entrySiteId(e) === "" && callNoCreditDate(e.date) &&
      !(entryCreatedMs(e) >= CALL_SITE_PICKER_MS) && skip.indexOf(e.id) === -1;
  });
}
// History + Add's starting site pick: a case the fix-up still lists has NO
// known site, so a case added to its encounter asks for one ("") instead of
// carrying "Other site" - which, on a new id, would read as a deliberate
// pick and leave the fix-up. Any other source carries its own key.
function entryAddSiteKey(src, kept) { return entrySitelessCalls([src], kept).length ? "" : entrySiteKey(src); }
// The fix-up at one CURRENT site: { id: new entry } for every listed case,
// through entryWithCall (credit derived by the rule for each case's own
// date). {} for a site that is not current.
function entrySitelessCallPlan(entries, siteId, sites, kept) {
  var out = {};
  if (!paySiteById(sites, siteId)) return out;
  entrySitelessCalls(entries, kept).forEach(function(e) { out[e.id] = entryWithCall(e, e, true, siteId, sites, true); });
  return out;
}
// Undo of an in-place edit of entries (app.js undo type "restore"): each
// saved copy goes back where its id is - but with `written` (id -> the
// object the edit wrote), only while the entry is still that very object,
// so a case changed again since (an edit in the Undo window, a restore)
// keeps the newer version. Every other entry is kept as is.
function entryRestoreInPlace(entries, copies, written) {
  var byId = {};
  (Array.isArray(copies) ? copies : []).forEach(function(c) { if (c && typeof c === "object" && typeof c.id === "string") byId[c.id] = c; });
  var w = written && typeof written === "object" ? written : null;
  return (Array.isArray(entries) ? entries : []).map(function(e) {
    if (!e || typeof e !== "object" || !Object.prototype.hasOwnProperty.call(byId, e.id)) return e;
    return !w || w[e.id] === e ? byId[e.id] : e;
  });
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

// vs. Prior Year (Dashboard): the year window starting on ys, cut at today
// while today is inside it, and the SAME span one year earlier -
// { cur: { start, end }, prev: { start, end }, toDate }, inclusive
// "YYYY-MM-DD" strings - else null. A window that does not contain today
// (a past year, a year already over) is compared whole; before the year
// starts both spans are empty. A bound moved back a year stays a plain
// string: Feb 29 becomes "YYYY-02-29" of a common year, which still sorts
// between Feb 28 and Mar 1. A whole prior year ends the day before this
// one starts (so a Mar 1 year keeps a leap Feb 29). Only cur.end is ever
// displayed.
function priorSpanYMD(ys, today) {
  var fy = fiscalYearBoundsYMD(ys);
  if (!fy) return null;
  var back = function(k) { return (+k.slice(0, 4) - 1) + k.slice(4); };
  var end = isYMD(today) && today < fy.end ? today : fy.end;
  return { cur: { start: fy.start, end: end }, prev: { start: back(fy.start), end: end === fy.end ? addDaysYMD(fy.start, -1) : back(end) }, toDate: end !== fy.end };
}

// Home Compensation card: the ONE projection rule. Home's two goal tracks:
// Tracked OR = logged cases (creditedRVU), goal settings.annualGoal;
// Reconciliation = Compare's monthly institution totals (incl. call +
// clinic), goal settings.reconGoal. The card projects from the year window's
// Compare months when there are any (the Reconciliation card's own months and
// pace), else from the tracked pace. A Compare projection is compared with the
// Reconciliation goal when one is set, otherwise with the OR goal, named as
// such (owner's choice, 2026-10-18); a tracked projection only ever with the
// OR goal. No rate, or no goal for that comparison (the OR goal for a tracked
// projection), hides the card. The pill's sign and colour both follow onPace
// (wrvu >= goal, the twin cards' test). A goal, rate or month count
// counts only as a finite number > 0 (0, blank, an old snapshot's undefined,
// NaN or text = not set); the wRVU totals pass through unchanged, so both
// paces are the twin cards' exact expressions. Home's Comp YTD tile (ytdWRVU /
// ytdComp) adds up the SAME source - the window's Compare months, else logged
// wRVU - whether or not the card shows (an any-year Compare switch once
// showed $0 for a year with no Compare months). dashboard.js only formats and
// masks the result.
function compProjection(p) {
  var q = p || {};
  var pos = function(v) { return typeof v === "number" && isFinite(v) && v > 0 ? v : 0; };
  var months = pos(q.compareMonths);
  var compare = months > 0;
  var trackedPace = (q.trackedWRVU / Math.max(1, q.trackedDays / 30.44)) * 12;
  var comparePace = compare ? (q.compareWRVU / months) * 12 : 0;
  var recon = compare && pos(q.reconGoal) > 0;
  var goal = recon ? pos(q.reconGoal) : pos(q.annualGoal);
  var rate = pos(q.rate);
  var wrvu = compare ? comparePace : trackedPace;
  var ytd = compare ? q.compareWRVU : q.trackedWRVU;
  return {
    trackedPace: trackedPace, comparePace: comparePace,
    source: compare ? "compare" : "tracked", months: months,
    ytdWRVU: ytd, ytdComp: ytd * rate,
    wrvu: wrvu, comp: wrvu * rate,
    goalWRVU: goal, goalComp: goal * rate, diff: wrvu * rate - goal * rate,
    onPace: goal > 0 && wrvu >= goal,
    show: rate > 0 && goal > 0,
    goalName: recon ? "Reconciliation goal" : "OR goal",
    goalTile: recon ? "Recon goal" : "OR goal",
    sourceLabel: compare ? "from Compare (" + months + "-mo avg)" : "from tracked pace"
  };
}

// Compare's manual month rows (institutionData): ONE row per month. A row is
// found by IDENTITY (the object the user tapped), never by list position, so
// a delete or an import while the form is open can never redirect a save or
// a delete onto another month. instSameMonth lists the OTHER rows already
// holding a month (the tap confirms before they are replaced - an older build
// could leave duplicates); instSaveMonth drops them, writes the entry at the
// edited row's position (or appends it when adding, or when that row is
// gone), and keeps a migrated month's totalOnly flag when its edit leaves the
// call split at 0; instDeleteRow removes exactly that row (a no-op once it is
// gone). Inputs are never mutated. The Excel import keeps its own merge.
function instSameMonth(rows, editRow, month) {
  return (Array.isArray(rows) ? rows : []).filter(function(r) { return !!r && r !== editRow && r.month === month; });
}
function instSaveMonth(rows, editRow, entry) {
  var arr = (Array.isArray(rows) ? rows : []).filter(function(r) { return !(r && r !== editRow && r.month === entry.month); });
  var out = Object.assign({}, entry);
  var i = editRow ? arr.indexOf(editRow) : -1;
  if (i >= 0 && editRow.totalOnly === true && entry.splitRVU === 0) out.totalOnly = true;
  if (i >= 0) arr[i] = out; else arr.push(out);
  return arr;
}
function instDeleteRow(rows, row) {
  var arr = (Array.isArray(rows) ? rows : []).slice();
  var i = arr.indexOf(row);
  if (i >= 0) arr.splice(i, 1);
  return arr;
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
  if (payShiftIsTyped(shift)) {
    // Typed (Day/Night) branch: flat, stipend (a line only when > 0) and the
    // call-in line (payCallInSummary - the ONE threshold rule), from the
    // shift's own type copy. The legacy branch below is unchanged.
    var tc = cleanPayTypeCopy(shift.rates, "x"), ci = payCleanCallIns(shift.callIns);
    if (!tc || !ci) return null;
    var t = tc.shiftType, tl = [{ kind: "flat", hours: t.hours, paid: true, amount: round2(t.flat) }];
    if (t.stipend > 0) tl.push({ kind: "stipend", label: t.stipendLabel, paid: true, amount: round2(t.stipend) });
    if (t.callIn) {
      var cs = payCallInSummary(ci, t.callIn);
      tl.push({ kind: "callIn", trips: cs.trips, minutes: cs.minutes, paidMinutes: cs.paidMinutes, met: cs.met, threshold: cs.threshold, hourly: cs.hourly, paid: cs.met, amount: cs.amount });
    }
    var tt = 0;
    tl.forEach(function(l) { tt += l.amount; });
    return { lines: tl, total: round2(tt), typed: true };
  }
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
// version added last wins). An Original (effective null, key "") applies
// to every date a dated version does not. Either kind can come back -
// callers that price branch on payRateIsTyped. null when no version applies.
function rateInForce(site, ymd) {
  if (!site || !Array.isArray(site.rates) || !isYMD(ymd)) return null;
  var best = null, bestKey = null;
  site.rates.forEach(function(r) {
    var k = payEffKey(r);
    if (k !== null && k <= ymd && (best === null || k >= bestKey)) { best = r; bestKey = k; }
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
// Typed shifts: the kept copy holds while the site, the date AND the picked
// type (draft.types = [its key]) are unchanged. A FLAGGED legacy shift (a
// typed version now in force for its date) always takes that version, so
// setting Day or Night re-prices it. Either kind can come back.
function payDraftRate(draft, site, orig) {
  var siteOk = !!site && typeof site.id === "string" && site.id !== "" && typeof site.name === "string";
  if (!draft || typeof draft !== "object") return { rates: null, from: "" };
  var same = !!orig && !draft.reprice && siteOk && orig.siteId === site.id && orig.date === draft.date;
  if (same && payShiftIsTyped(orig)) {
    var picks = Array.isArray(draft.types) ? draft.types : [];
    // Where no typed version is in force (a deleted site's stand-in, or a live
    // site whose typed version was deleted or re-dated) the copy is the only
    // typed source: kept whatever is picked, so an un-pick blocks with noType
    // instead of turning the shift legacy. Otherwise kept only while the pick
    // is the copy's own type.
    if (cleanPayTypeCopy(orig.rates, "x") && (site.deleted === true || !payRateIsTyped(rateInForce(site, draft.date)) || (picks.length === 1 && picks[0] === orig.rates.shiftType.key))) return { rates: { ...orig.rates }, from: "kept" };
  } else if (same && cleanPayRate(orig.rates, "x") && !payRateIsTyped(rateInForce(site, draft.date))) {
    return { rates: { ...orig.rates }, from: "kept" };
  }
  if (siteOk && isYMD(draft.date)) { var rif = rateInForce(site, draft.date); if (rif) return { rates: { ...rif }, from: "inForce" }; }
  return { rates: null, from: "" };
}
// The draft's picked type keys that the rate choice has, in version order:
// a key the version lacks drops out, so a type is never guessed.
function payDraftTypes(d, rate) {
  var picks = d && Array.isArray(d.types) ? d.types : [];
  return payRateTypes(rate).map(function(t) { return t && t.key; }).filter(function(k) { return typeof k === "string" && picks.indexOf(k) !== -1; });
}
// The second shift's id for a Day + Night save: id + "-2", bumped while taken.
function payDraftId2(id, shifts) {
  var ids = {}, n = 2, out = String(id || "shift") + "-2";
  (Array.isArray(shifts) ? shifts : []).forEach(function(s) { if (s && typeof s.id === "string") ids[s.id] = true; });
  while (ids[out] === true) { n++; out = String(id || "shift") + "-" + n; }
  return out;
}
// Is a date a weekend or holiday for this site? (decides the call-in fee)
function payWeOrHol(ymd, site) {
  return isYMD(ymd) && (!!payHolidayName(ymd) || (!!site && Array.isArray(site.weekendDays) && site.weekendDays.indexOf(ymdWeekday(ymd)) !== -1));
}
// Weekend and holiday call is a 24-hour shift (owner 2026-10-13): at a site
// whose stipend covers a shorter period, a weekend-day or holiday shift
// starts at PAY_LONG_SHIFT_HOURS, paid stipend x hours / stipendHours (a 24h
// shift on a 12h stipend = two stipends). The user can always pick another
// length; up to PAY_LONG_SHIFT_HOURS is a normal shift, not an over-length one.
var PAY_LONG_SHIFT_HOURS = 24;
// The shift length the form starts at for this day (null without a rate).
// A deleted site's stand-in has no weekend days, so only holidays count there.
function payDefaultShiftHours(ymd, site, rate) {
  if (!rate || !(rate.stipendHours > 0)) return null;
  return rate.stipendHours < PAY_LONG_SHIFT_HOURS && payWeOrHol(ymd, site) ? PAY_LONG_SHIFT_HOURS : rate.stipendHours;
}
// Ask "Day or Night?" for a call-in only where the answer changes pay: a
// non-holiday weekday when the rate pays no hourly on weekday daytime.
// Never for a deleted site's stand-in: its weekend days are unknown, so the
// form asks for the rate type itself instead.
function payAsksDayNight(ymd, site, rate) {
  if ((site && site.deleted) || payRateIsTyped(rate)) return false;
  return isYMD(ymd) && !payWeOrHol(ymd, site) && !(rate && rate.hourlyWeekdayDay === true);
}
// Ask "before or after midnight?" only where it changes the call-in fee:
// the weekday and weekend/holiday fees differ AND the shift day and the
// next day fall on different sides of that line (never for a deleted site).
function payMidnightAsks(shiftDate, site, rate) {
  if (!rate || payRateIsTyped(rate) || !isYMD(shiftDate) || rate.callInWeekday === rate.callInWeekendHoliday || (site && site.deleted)) return false;
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
  if (rates && payRateIsTyped(rates)) return payTypedShiftFromDraft(draft, site, orig, ctx, rates, ratesFrom, problems);
  var callHours = payNum(draft.callHours);
  if (callHours === null) add("hours", -1, true);
  else if (rates && callHours > Math.max(rates.stipendHours, PAY_LONG_SHIFT_HOURS)) add("overLength", -1, false);
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
  delete shift.callIns;   // a legacy write never carries the typed shape's key
  var note = typeof draft.note === "string" ? draft.note.trim() : "";
  if (note) shift.note = note; else delete shift.note;
  var pay = computeShiftPay(shift);
  if (!pay) { add("pay", -1, true); return { shift: null, problems: problems, ratesFrom: ratesFrom }; }
  if (pay.total === 0) add("payNothing", -1, false);
  return { shift: shift, problems: problems, ratesFrom: ratesFrom };
}
// The typed (Day/Night) branch of payShiftFromDraft. draft.type is the ONE
// type key this shift takes (payShiftsFromDraft splits a Day + Night pick
// into two drafts); draft.ciRows are the call-in boxes [{ h, m }], read only
// for a type with a call-in rule (a Day always saves callIns: []). Problems
// may carry a `label` for the form's text (noType: the version's type names
// joined with "or"; dupType: the type's name). ctx.sites feeds the
// dupFlagged warning; ctx.skipIds are the ids the duplicate checks ignore
// (the edited shift and the other half of a Day + Night pair).
function payTypedShiftFromDraft(draft, site, orig, ctx, rates, ratesFrom, problems) {
  var add = function(code, ev, block, label) { var p = { code: code, ev: ev, block: block }; if (label) p.label = label; problems.push(p); };
  var names = payRateTypes(rates).map(function(t) { return t && t.label; }).filter(Boolean);
  var typeLabel = names.length > 1 ? names.slice(0, -1).join(", ") + " or " + names[names.length - 1] : names.join("");
  var key = typeof draft.type === "string" ? draft.type : "";
  var type = key ? payTypeByKey(rates, key) : null;
  if (!type) add("noType", -1, true, typeLabel);
  var callIns = [];
  if (type && type.callIn) {
    (Array.isArray(draft.ciRows) ? draft.ciRows : []).forEach(function(row, i) {
      var pr = payCiRowProblem(row);
      if (pr) { add(pr, i, true); return; }
      var m = payHM(row.h, row.m);
      if (m === null) { add("ciBad", i, true); return; }
      callIns.push(m);
    });
    var sum = 0;
    callIns.forEach(function(m) { sum += m; });
    if (sum > type.hours * 60) add("ciLong", -1, false);
  }
  if (ctx && isYMD(draft.date)) {
    if (isYMD(ctx.today) && draft.date > ctx.today) add("future", -1, false);
    var skip = (Array.isArray(ctx.skipIds) ? ctx.skipIds : []).concat([orig && orig.id, draft.id, draft.id2]).filter(function(x) { return typeof x === "string" && x; });
    var others = (Array.isArray(ctx.shifts) ? ctx.shifts : []).filter(function(s) { return s && s.siteId === site.id && s.date === draft.date && skip.indexOf(s.id) === -1; });
    if (type && others.some(function(s) { return payShiftIsTyped(s) && s.rates.shiftType.key === type.key; })) add("dupType", -1, false, type.label);
    if (others.some(function(s) { return payShiftNeedsType(s, ctx.sites); })) add("dupFlagged", -1, false, typeLabel);
  }
  if (problems.some(function(p) { return p.block; })) return { shift: null, problems: problems, ratesFrom: ratesFrom };
  var id = orig && typeof orig.id === "string" && orig.id ? orig.id : (typeof draft.id === "string" && draft.id ? draft.id : "shift-" + Date.now().toString(36));
  var copy = { id: rates.id, effective: rates.effective };
  if (typeof rates.label === "string") copy.label = rates.label;
  copy.shiftType = JSON.parse(JSON.stringify(type));
  var shift = { ...(orig || {}), id: id, date: draft.date, siteId: site.id, siteName: site.name, rates: copy, callIns: callIns };
  delete shift.callHours; delete shift.events;   // the legacy shape's keys never ride on a typed shift
  var note = typeof draft.note === "string" ? draft.note.trim() : "";
  if (note) shift.note = note; else delete shift.note;
  var pay = computeShiftPay(shift);
  if (!pay) { add("pay", -1, true); return { shift: null, problems: problems, ratesFrom: ratesFrom }; }
  if (pay.total === 0) add("payNothing", -1, false);
  return { shift: shift, problems: problems, ratesFrom: ratesFrom };
}
// Every shift the form saves, through payShiftFromDraft: one for a legacy
// draft; for a typed draft one per picked type (draft.types), in version
// order. The FIRST keeps orig (its id, cases, note and unknown fields); the
// SECOND is a fresh record with id draft.id2 and no cases, and the two skip
// each other (and the edited shift) in the duplicate checks. Returns
// { shifts, problems, ratesFrom, total } - total is a whole-cent sum; an
// empty shifts list means a blocking problem.
function payShiftsFromDraft(draft, site, orig, ctx) {
  var rate = payDraftRate(draft, site, orig).rates;
  if (!payRateIsTyped(rate)) {
    var one = payShiftFromDraft(draft, site, orig, ctx);
    var p1 = one.shift ? computeShiftPay(one.shift) : null;
    return { shifts: one.shift ? [one.shift] : [], problems: one.problems, ratesFrom: one.ratesFrom, total: p1 ? p1.total : 0 };
  }
  var keys = payDraftTypes(draft, rate), out = [], problems = [], ratesFrom = "", cents = 0;
  var ctx2 = ctx ? { ...ctx, skipIds: [orig && orig.id, draft && draft.id, draft && draft.id2] } : ctx;
  if (!keys.length) {
    var b0 = payShiftFromDraft({ ...draft, type: "" }, site, orig, ctx2);
    return { shifts: [], problems: b0.problems, ratesFrom: b0.ratesFrom, total: 0 };
  }
  keys.forEach(function(k, i) {
    var d = { ...draft, type: k };
    if (i > 0) { d.id = typeof draft.id2 === "string" && draft.id2 ? draft.id2 : String(draft.id) + "-2"; }
    var b = payShiftFromDraft(d, site, i === 0 ? orig : null, ctx2);
    ratesFrom = b.ratesFrom || ratesFrom;
    // Shift-level warnings (future, dupFlagged, payNothing) are the same for
    // every picked type: reported once. dupType carries its own type's label.
    b.problems.forEach(function(p) { if (p.ev !== -1 || !problems.some(function(q) { return q.ev === -1 && q.code === p.code && q.label === p.label; })) problems.push(p); });
    if (b.shift) { out.push(b.shift); var p = computeShiftPay(b.shift); if (p) cents += Math.round(p.total * 100); }
  });
  if (problems.some(function(p) { return p.block; })) return { shifts: [], problems: problems, ratesFrom: ratesFrom, total: 0 };
  return { shifts: out, problems: problems, ratesFrom: ratesFrom, total: cents / 100 };
}
// "Use saved call-ins" on a flagged shift: its legacy trips (savedTrips,
// from payDraftFromShift) become call-in rows. A NEW draft.
function payDraftUseSaved(d) {
  if (!d || typeof d !== "object") return d;
  var rows = (Array.isArray(d.savedTrips) ? d.savedTrips : []).map(function(t) { var m = payWholeMin(t && t.minutes); return m === null ? null : { h: String(Math.floor(m / 60)), m: String(m % 60).padStart(2, "0") }; }).filter(Boolean);
  return { ...d, ciRows: rows };
}
// Is the shift form changed from how it opened? Its JSON differs from the
// baseline (init) - and, when "+ Call-in" opened it with a blank row added,
// also from the saved shift without that row (base), so adding then
// removing that row is not a change. Cancel's prompt and the tab-switch
// parking share this one rule.
function payDraftDirty(draft, init, base) {
  if (!draft || typeof draft !== "object") return false;
  var j = JSON.stringify(draft);
  return j !== init && !(typeof base === "string" && base !== "" && j === base);
}
// Call Pay's shift form parked across a tab switch (App's memory-only
// callPayDraft ref - never stored): { draft, draftInit, draftBase, editOrig,
// hoursOpen, moreOpen, sites }. Restored only while it can still be
// trusted: the site list is the SAME object it was parked with (ANY
// paySites write replaces it - a rates or site edit in Call Pay, Log's or
// History's built-in credit-rule confirm, a restore - and the form is then
// dropped: fail-safe, since its site-derived fields could be stale), and a
// parked EDIT's shift is still saved exactly as it was (it then comes back
// as the live shift object). Anything else - or junk - is null (the list
// shows). The changed-shift and lost-site branches are defence in depth:
// with today's writers the site-list check already covers them.
function payParkedDraft(p, shifts, sites) {
  if (!p || typeof p !== "object" || !p.draft || typeof p.draft !== "object" || p.sites !== sites) return null;
  if (p.editOrig) {
    var live = (Array.isArray(shifts) ? shifts : []).filter(function(s) { return s && s.id === p.editOrig.id; })[0];
    if (!live || JSON.stringify(live) !== JSON.stringify(p.editOrig)) return null;
    return { ...p, editOrig: live };
  }
  var siteOk = !p.draft.siteId || (Array.isArray(sites) ? sites : []).some(function(s) { return s && s.id === p.draft.siteId; });
  return siteOk ? p : { ...p, draft: { ...p.draft, siteId: "" } };
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
  // A typed shift: its one type picked, its call-ins as rows; the legacy
  // fields stay blank (a site/day change onto legacy rates fills them).
  if (payShiftIsTyped(s)) {
    return { id: s.id, siteId: s.siteId, date: s.date, callHours: "", hoursSet: false, note: s.note || "", events: [],
      types: [s.rates.shiftType.key], ciRows: (Array.isArray(s.callIns) ? s.callIns : []).map(function(m) { return { h: String(Math.floor(m / 60)), m: String(m % 60).padStart(2, "0") }; }), id2: String(s.id) + "-2", savedTrips: [] };
  }
  var wdays = site && Array.isArray(site.weekendDays) ? site.weekendDays : [];
  var nextDay = addDaysYMD(s.date, 1);
  var gone = !!(site && site.deleted);
  var quiet = !!(s.rates && s.rates.hourlyWeekdayDay === true);
  var askedMid = payMidnightAsks(s.date, site, s.rates);
  // Hours count as "set" unless they equal the length the form would start
  // at for this day - so a saved 12h weekend shift stays 12h when edited. A
  // deleted site's weekend days are unknown, so there a stipend-length shift
  // shorter than 24h may be a weekend shift picked short: it counts as set
  // too, and keeps its hours through any later site or date change.
  var hoursSet = !(s.rates && s.callHours === payDefaultShiftHours(s.date, site, s.rates)) ||
    (gone && !!s.rates && s.rates.stipendHours < PAY_LONG_SHIFT_HOURS && s.callHours === s.rates.stipendHours);
  var d = { id: s.id, siteId: s.siteId, date: s.date, callHours: String(s.callHours), hoursSet: hoursSet, note: s.note || "",
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
  // The typed fields: nothing picked (a type is never guessed), and the saved
  // trips as whole minutes for "Use saved call-ins" (a flagged shift).
  d.types = []; d.ciRows = []; d.id2 = String(s.id) + "-2";
  d.savedTrips = (s.events || []).map(function(e) { var h = payNum(e && e.hours); return { date: e && e.date, minutes: h === null ? 0 : Math.round(h * 60) }; });
  return d;
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
// KIND GUARD: a typed (Day/Night) shift, or a typed version in force, is
// never stale here - a re-price must never put a typed version into a legacy
// shift (an older build would then drop that shift) or the other way round.
// Two shift types price differently when flat, stipend or the call-in rule
// (hourly, threshold) differ; key, label and hours do not matter.
function payTypeDiffer(a, b) {
  if (!a || !b) return true;
  if (a.flat !== b.flat || a.stipend !== b.stipend || !!a.callIn !== !!b.callIn) return true;
  return !!a.callIn && (a.callIn.hourly !== b.callIn.hourly || a.callIn.thresholdMinutes !== b.callIn.thresholdMinutes);
}
function payShiftStale(shift, site) {
  if (!shift || !site || shift.siteId !== site.id) return false;
  var rif = rateInForce(site, shift.date);
  if (!rif) return false;
  if (payShiftIsTyped(shift)) {
    // A typed shift re-prices only to the SAME key in a typed version; a
    // missing key, or a legacy version in force, is left to the editor.
    if (!payRateIsTyped(rif) || !Array.isArray(rif.shiftTypes)) return false;
    var t = payTypeByKey(rif, shift.rates.shiftType.key);
    return !!t && payTypeDiffer(shift.rates.shiftType, t);
  }
  if (payRateIsTyped(shift.rates) || payRateIsTyped(rif)) return false;
  return payRatesDiffer(shift.rates, rif);
}
// The shift re-priced at the version in force for its date - a NEW object
// with a COPY of that version (never shared with the site). The same length
// rule as the editor's "Use current rates": a shift at the day's default
// length (payDefaultShiftHours - 24h on a weekend day or holiday where the
// stipend period is shorter) takes the new default; one at the old stipend
// period takes the new stipend period; any other hours are kept. null when
// the shift is not stale. Output passes repairData unchanged (check.js).
function payRepriceShift(shift, site) {
  if (!payShiftStale(shift, site)) return null;
  var rif = rateInForce(site, shift.date);
  if (payShiftIsTyped(shift)) {
    var copy = { id: rif.id, effective: rif.effective };
    if (typeof rif.label === "string") copy.label = rif.label;
    copy.shiftType = JSON.parse(JSON.stringify(payTypeByKey(rif, shift.rates.shiftType.key)));
    return { ...shift, siteName: site.name, rates: copy };
  }
  var old = shift.rates, h = shift.callHours;
  if (old && h === payDefaultShiftHours(shift.date, site, old)) h = payDefaultShiftHours(shift.date, site, rif);
  else if (old && h === old.stipendHours) h = rif.stipendHours;
  return { ...shift, siteName: site.name, callHours: h, rates: { ...rif } };
}
// The shift editor's "Use current rates": the draft re-takes the version in
// force for its date (reprice; a stipend-length shift takes the new stipend
// length, as payRepriceShift does). payDraftWeekendPicks lists its saved
// weekday/night call-ins on a day the site counts as a weekend day (Use
// built-in rates can add Friday): payDraftFromShift reopens them as picks,
// so a rate refresh alone keeps their weekday fee. With reopen === true (the
// user confirmed in callpay.js) they re-open as automatic and the refresh
// makes them weekend call-ins, as a call-in logged on that day now would
// be. For a day "Use built-in rates" added, that is the bulk re-price's
// payReclassShift result; the editor also covers older weekend days and
// dates before the built-in start, because the user is asked first.
// Without reopen every pick stays, so a deliberate Day/Night choice is
// never thrown away unasked. Weekend and holiday classes never change;
// each call-in is judged by its OWN date (a next-day call-in included).
// payDraftReopenAsks: the picks worth asking about - [] when re-opening
// would only change the label, not the pay (both ways priced exactly as
// the editor saves; a draft that cannot be priced yet still asks).
function payDraftWeekendPicks(d, site) {
  var wdays = site && !site.deleted && Array.isArray(site.weekendDays) ? site.weekendDays : [];
  var out = [];
  (d && typeof d === "object" && Array.isArray(d.events) ? d.events : []).forEach(function(e, i) {
    if (e && typeof e === "object" && e.clsSet && (e.cls === "wd" || e.cls === "wn") && classifyPayEvent(e.date, e.time || "", wdays) === "we") out.push(i);
  });
  return out;
}
function payDraftUseCurrent(d, site, orig, reopen) {
  if (!d || typeof d !== "object") return d;
  var nd = { ...d, reprice: true };
  var rif = site ? rateInForce(site, nd.date) : null;
  if (rif && orig && orig.rates && +nd.callHours === orig.rates.stipendHours) nd.callHours = String(rif.stipendHours);
  var picks = reopen === true ? payDraftWeekendPicks(nd, site) : [];
  nd.events = (Array.isArray(nd.events) ? nd.events : []).map(function(e, i) { return picks.indexOf(i) !== -1 ? { ...e, clsSet: false } : e; });
  return nd;
}
function payDraftReopenAsks(d, site, orig, today, nowHM) {
  // Use current rates onto a typed (Day/Night) version: the legacy call-ins
  // are not priced, so the weekend question would be pointless.
  if (payRateIsTyped(site && d && typeof d === "object" ? rateInForce(site, d.date) : null)) return [];
  var picks = payDraftWeekendPicks(d, site);
  if (!picks.length) return picks;
  var cents = function(reopen) {
    var nd = payDraftUseCurrent(d, site, orig, reopen);
    var built = payShiftFromDraft(payDraftRefresh(nd, site, today, nowHM, payDraftRate(nd, site, orig).rates), site, orig);
    var p = built.shift ? computeShiftPay(built.shift) : null;
    return p ? Math.round(p.total * 100) : null;
  };
  var keep = cents(false), open = cents(true);
  return keep === null || open === null || keep !== open ? picks : [];
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
// For the re-price confirm: what re-pricing these [{ before, after }] pairs
// (either kind) does - { lenChange, moved (legacy call-ins moved to the
// weekend fee), typed (typed shifts among them), before, after } in cents.
function payRepriceSummary(pairs) {
  var out = { lenChange: false, moved: 0, typed: 0, before: 0, after: 0 };
  (Array.isArray(pairs) ? pairs : []).forEach(function(p) {
    var x = p && p.before, r = p && p.after;
    if (!x || !r) return;
    if (payShiftIsTyped(x)) out.typed++;
    else {
      if (r.callHours !== x.callHours) out.lenChange = true;
      (Array.isArray(r.events) ? r.events : []).forEach(function(e, i) { if (Array.isArray(x.events) && x.events[i] && e.cls !== x.events[i].cls) out.moved++; });
    }
    var pb = computeShiftPay(x), pa = computeShiftPay(r);
    out.before += pb ? Math.round(pb.total * 100) : 0;
    out.after += pa ? Math.round(pa.total * 100) : 0;
  });
  return out;
}
// --- The typed rates editor's form (strings as typed; parsed ONCE on Save) ---
// form: { effective: "YYYY-MM-DD" | "", original: bool (the Original has no
// date), label, types: [{ key, label, hours, flat, stipend, stipendLabel,
// ci: bool, hourly, thrH, thrM }] }. Amounts: commas stripped, then the
// whole string must be a number (payNum) - "12abc" is refused, not read as 12.
function payAmountText(s) { return payNum(typeof s === "string" ? s.replace(/,/g, "") : s); }
function payNewTypeKey() { return "t-" + Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }
function payTypedFormFromVersion(v) {
  var types = payRateTypes(v).map(function(t) {
    return { key: t.key, label: t.label, hours: String(t.hours), flat: String(t.flat), stipend: String(t.stipend), stipendLabel: t.stipendLabel || "", ci: !!t.callIn,
      hourly: t.callIn ? String(t.callIn.hourly) : "", thrH: t.callIn ? String(Math.floor(t.callIn.thresholdMinutes / 60)) : "", thrM: t.callIn ? String(t.callIn.thresholdMinutes % 60).padStart(2, "0") : "" };
  });
  return { effective: v && isYMD(v.effective) ? v.effective : "", original: !!v && v.effective === null, label: v && typeof v.label === "string" ? v.label : "", types: types };
}
// "+ Add new rates" from the latest typed version: keys and values copied,
// the date and label blank (the user picks the start).
function payNewTypedForm(src) { var f = payTypedFormFromVersion(src); f.effective = ""; f.original = false; f.label = ""; return f; }
function payBlankTypedForm() { return { effective: "", original: false, label: "", types: [{ key: payNewTypeKey(), label: "", hours: "", flat: "", stipend: "", stipendLabel: "", ci: false, hourly: "", thrH: "", thrM: "" }] }; }
// One form type parsed (null amounts where the text is not a number).
function payTypeFromForm(ft) {
  var f = ft || {};
  var t = { key: typeof f.key === "string" ? f.key : "", label: typeof f.label === "string" ? f.label.trim() : "", hours: payAmountText(f.hours), flat: payAmountText(f.flat),
    stipend: f.stipend === "" || f.stipend === undefined ? 0 : payAmountText(f.stipend), stipendLabel: typeof f.stipendLabel === "string" ? f.stipendLabel.trim() : "", callIn: null };
  if (f.ci) t.callIn = { hourly: payAmountText(f.hourly), thresholdMinutes: (f.thrH || "") === "" && (f.thrM || "") === "" ? 0 : payHM(f.thrH || "", f.thrM || "") };
  return t;
}
// { version | null, errors: [text] }. The version passes repairData unchanged.
function payTypedVersionFromForm(form, id, site) {
  var errors = [], f = form || {}, types = Array.isArray(f.types) ? f.types : [], others = site && Array.isArray(site.rates) ? site.rates.filter(function(r) { return !!r && r.id !== id; }) : [];
  if (!f.original && !isYMD(f.effective)) errors.push("Pick the date these rates start.");
  if (!f.original && isYMD(f.effective) && others.some(function(r) { return r.effective === f.effective; })) errors.push("Another version already starts on " + payDateLabel(f.effective) + " - edit that one instead.");
  if (f.original && others.some(function(r) { return r.effective === null; })) errors.push("This site already has Original rates - edit those instead.");
  if (!types.length) errors.push("Add at least one shift type.");
  var parsed = types.map(payTypeFromForm);
  if (parsed.some(function(t) { return !t.label; })) errors.push("Name every shift type.");
  var seen = {}, dupName = "";
  parsed.forEach(function(t) { var k = t.label.toLowerCase(); if (k && seen[k] === true) dupName = dupName || t.label; seen[k] = true; });
  if (dupName) errors.push("Two shift types are both named " + dupName + ".");
  if (parsed.some(function(t) { return !(t.hours > 0); })) errors.push("Shift length must be more than 0 hours.");
  var thrBad = false, thrMin = false;
  types.forEach(function(ft) {
    if (!ft || !ft.ci) return;
    var h = ft.thrH || "", m = ft.thrM || "";
    if (h === "" && m === "") return;   // blank = 0:00, paid from the first minute
    var pr = payCiRowProblem({ h: h, m: m });
    if (pr === "ciMin") thrMin = true; else if (pr) thrBad = true;
  });
  if (parsed.some(function(t) { return t.flat === null || t.stipend === null || (t.callIn && t.callIn.hourly === null); }) || thrBad) errors.push("Fill every amount with a number (0 is allowed).");
  if (thrMin) errors.push("Minutes must be 0 to 59.");
  if (errors.length) return { version: null, errors: errors };
  // An edit keeps the unknown fields of the stored version, of each type (by
  // key) and of its callIn, as the legacy editor and repairData do; the
  // form's own fields win.
  var old = site && Array.isArray(site.rates) ? site.rates.filter(function(r) { return !!r && r.id === id && payRateIsTyped(r); })[0] : null;
  var v = { ...(old || {}), id: typeof id === "string" && id ? id : "rate-" + Date.now().toString(36), effective: f.original ? null : f.effective };
  var lbl = typeof f.label === "string" ? f.label.trim() : "";
  if (lbl) v.label = lbl; else delete v.label;
  v.shiftTypes = parsed.map(function(t) {
    var ot = old ? payTypeByKey(old, t.key) : null, nt = { ...(ot || {}), ...t };
    if (t.callIn && ot && ot.callIn && typeof ot.callIn === "object" && !Array.isArray(ot.callIn)) nt.callIn = { ...ot.callIn, ...t.callIn };
    return nt;
  });
  var clean = cleanPayTyped(v, v.id);
  if (!clean) return { version: null, errors: ["Check the values."] };
  return { version: clean, errors: [] };
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
// --- The Day / Night / Other split (one accumulator for every total) ---
// Buckets by type key ("" = legacy-priced "Other"), each { key, label,
// shifts, total, callIns, inMin (all time in), ciShifts (shifts whose type
// pays call-ins), metCount (of those, nights that reached their threshold),
// threshold (the minutes shared by every such shift, or null when they
// differ) }. A bucket is named by its NEWEST shift; buckets whose labels
// match case-folded merge. Order: Day, Night, other types, then Other. The
// split is empty when the range has no typed or flagged shift. A FLAGGED
// shift (payShiftNeedsType) is counted only in needsType - never in shifts,
// total or any bucket. Sums are whole cents, so the buckets add up exactly.
function paySplitNew() { return { buckets: {}, order: [], any: false }; }
function paySplitAdd(acc, s, p, flagged) {
  if (flagged || payShiftIsTyped(s)) acc.any = true;
  if (flagged || !p) return;
  var typed = payShiftIsTyped(s), key = typed ? s.rates.shiftType.key : "";
  var b = acc.buckets[key];
  if (!b) { b = acc.buckets[key] = { key: key, label: typed ? s.rates.shiftType.label : "Other", labelDate: typed ? s.date : "", shifts: 0, cents: 0, callIns: 0, inMin: 0, ciShifts: 0, metCount: 0, thresholds: [] }; acc.order.push(key); }
  if (typed && s.date >= b.labelDate) { b.label = s.rates.shiftType.label; b.labelDate = s.date; }
  b.shifts++; b.cents += Math.round(p.total * 100); b.callIns += payShiftCallInCount(s);
  var ci = typed ? p.lines.filter(function(l) { return l.kind === "callIn"; })[0] : null;
  if (ci) { b.inMin += ci.minutes; b.ciShifts++; if (ci.met) b.metCount++; if (b.thresholds.indexOf(ci.threshold) === -1) b.thresholds.push(ci.threshold); }
}
function paySplitOut(acc) {
  if (!acc.any) return [];
  var byLabel = {}, merged = [];
  acc.order.forEach(function(k) {
    var b = acc.buckets[k], lk = b.key === "" ? "" : "t:" + b.label.trim().toLowerCase(), m = byLabel[lk];
    if (!m) { byLabel[lk] = b; merged.push(b); return; }
    m.shifts += b.shifts; m.cents += b.cents; m.callIns += b.callIns; m.inMin += b.inMin; m.ciShifts += b.ciShifts; m.metCount += b.metCount;
    b.thresholds.forEach(function(t) { if (m.thresholds.indexOf(t) === -1) m.thresholds.push(t); });
    if (b.labelDate > m.labelDate) { m.label = b.label; m.labelDate = b.labelDate; }
  });
  var rank = function(b) { var l = b.label.trim().toLowerCase(); return b.key === "" ? 3 : l === "day" ? 0 : l === "night" ? 1 : 2; };
  merged.sort(function(a, b) { return rank(a) - rank(b) || acc.order.indexOf(a.key) - acc.order.indexOf(b.key); });
  return merged.map(function(b) { return { key: b.key, label: b.label, shifts: b.shifts, total: b.cents / 100, callIns: b.callIns, inMin: b.inMin, ciShifts: b.ciShifts, metCount: b.metCount, threshold: b.thresholds.length === 1 ? b.thresholds[0] : null }; });
}
// Call pay between two YYYY-MM-DD bounds by SHIFT date: from <= date < to,
// and (when upTo is given, e.g. today for a YTD line) date <= upTo. Whole-
// cent sum; an unpriceable shift is counted but never summed; a shift that
// needs Day or Night (payShiftNeedsType against `sites`; without sites
// nothing is flagged) is only counted in needsType. String-date bounds, so
// a fiscal year starting on any day works. Returns { total, shifts,
// unpriced, needsType, split }.
function payTotalInRange(shifts, from, to, upTo, sites) {
  var cents = 0, count = 0, unpriced = 0, needsType = 0, acc = paySplitNew();
  (Array.isArray(shifts) ? shifts : []).forEach(function(s) {
    if (!s || !isYMD(s.date) || s.date < from || s.date >= to || (upTo && s.date > upTo)) return;
    if (payShiftNeedsType(s, sites)) { needsType++; paySplitAdd(acc, s, null, true); return; }
    count++;
    var p = computeShiftPay(s);
    if (p) cents += Math.round(p.total * 100); else unpriced++;
    paySplitAdd(acc, s, p, false);
  });
  return { total: cents / 100, shifts: count, unpriced: unpriced, needsType: needsType, split: paySplitOut(acc) };
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
// counted (unpriced) but never summed. A shift that needs Day or Night
// (payShiftNeedsType) stays in its month's list but is counted only in
// needsType. Returns { total, shifts, callIns, unpriced, needsType, split,
// months: [{ key: "YYYY-MM", total, shifts, callIns, unpriced, needsType,
// split, sites: [{ key, name, deleted, total, shifts }], list: [shift,
// newest first] }] } with months newest first.
function payMonthTotals(shifts, year, sites) {
  var y = String(year);
  var current = {};
  (Array.isArray(sites) ? sites : []).forEach(function(s) { if (s && typeof s.id === "string") current[s.id] = true; });
  var names = paySiteNames(shifts, sites);
  var months = {}, cents = 0, count = 0, callIns = 0, unpriced = 0, needsType = 0, yAcc = paySplitNew();
  (Array.isArray(shifts) ? shifts : []).forEach(function(s, idx) {
    if (!s || !isYMD(s.date) || s.date.slice(0, 4) !== y) return;
    var mk = s.date.slice(0, 7);
    var m = months[mk] || (months[mk] = { key: mk, cents: 0, shifts: 0, callIns: 0, unpriced: 0, needsType: 0, acc: paySplitNew(), sites: {}, list: [] });
    m.list.push({ s: s, i: idx });
    if (payShiftNeedsType(s, sites)) { m.needsType++; needsType++; paySplitAdd(m.acc, s, null, true); paySplitAdd(yAcc, s, null, true); return; }
    var p = computeShiftPay(s);
    var c = p ? Math.round(p.total * 100) : 0;
    var n = payShiftCallInCount(s);
    var sk = typeof s.siteId === "string" && s.siteId ? s.siteId : "name:" + (s.siteName || "");
    var deleted = !Object.prototype.hasOwnProperty.call(current, s.siteId);
    var site = m.sites[sk] || (m.sites[sk] = { key: sk, name: (s.siteId && names[s.siteId]) || s.siteName || "Deleted site", deleted: deleted, cents: 0, shifts: 0 });
    m.shifts++; m.callIns += n; site.shifts++;
    if (p) { m.cents += c; site.cents += c; cents += c; } else { m.unpriced++; unpriced++; }
    count++; callIns += n;
    paySplitAdd(m.acc, s, p, false); paySplitAdd(yAcc, s, p, false);
  });
  var out = Object.keys(months).sort().reverse().map(function(mk) {
    var m = months[mk];
    return {
      key: mk, total: m.cents / 100, shifts: m.shifts, callIns: m.callIns, unpriced: m.unpriced, needsType: m.needsType, split: paySplitOut(m.acc),
      sites: Object.keys(m.sites).map(function(k) { var st = m.sites[k]; return { key: st.key, name: st.name, deleted: st.deleted, total: st.cents / 100, shifts: st.shifts }; })
        .sort(function(a, b) { return b.total - a.total || (a.name < b.name ? -1 : a.name > b.name ? 1 : 0); }),
      list: m.list.sort(function(a, b) { return a.s.date < b.s.date ? 1 : a.s.date > b.s.date ? -1 : b.i - a.i; }).map(function(x) { return x.s; })
    };
  });
  return { total: cents / 100, shifts: count, callIns: callIns, unpriced: unpriced, needsType: needsType, split: paySplitOut(yAcc), months: out };
}
// Re-derive everything that follows the site/date: default hours on call
// (until the user picks them - payDefaultShiftHours: 24h on a weekend day or
// holiday where the stipend period is shorter) and every call-in via
// payDraftEvent. `rate` (optional, the draft's payDraftRate choice) sets the
// lengths and switches on the simple-form rules; without it the version in
// force does.
function payDraftRefresh(d, site, today, nowHM, rate) {
  var nd = { ...d };
  if (payRateIsTyped(rate)) return nd;   // a typed rate choice: the legacy fields are left alone
  if (!nd.hoursSet) { var rif = rate || (site ? rateInForce(site, nd.date) : null); if (rif) nd.callHours = String(payDefaultShiftHours(nd.date, site, rif)); }
  nd.events = (nd.events || []).map(function(e) { return payDraftEvent(e, nd.date, site, today, nowHM, rate); });
  return nd;
}

// =======================================
// --- Directorships ---
// Monthly directorship hours and their signed time sheets (directorships.js
// holds only state and rendering; every rule is here, pure and tested by
// check.js). Store fields: directorships, dirEntries, dirHandoff,
// dirSignatureEnc. Babel files read them ONLY through dirList /
// dirEntriesOf / dirHandoffOf / dirHasSignature / dirSignatureLoad.
// Calendar math is integer math on "YYYY-MM-DD" / "YYYY-MM" strings - no
// Date parsing, no UTC. The caller passes "today" in.
// =======================================
var DIR_MONTH_NAMES = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
var DIR_MAX_ENTRY_MIN = 1440;
var DIR_QUICK_MIN = [15, 30, 45, 60, 90, 120];
var DIR_DETAIL_MAX = 60;
var DIR_DETAIL_HINT = "meeting or topic only - no patient information";
var DIR_PAY_CODE = "DFEE";
var DIR_GENESIS_TITLE = "MONTHLY ACTIVITY LOG/TIMESHEET";
var DIR_GENESIS_SUBTITLE = "MEDICAL DIRECTOR SERVICES";
var DIR_GENESIS_CERT = "CERTIFICATION: By signing this document, the below listed individuals hereby affirm and attest that the Services and the number of hours recorded for such Services set forth herein were performed by Physician as Medical Director and that Physician fully performed all designated duties required during this month.";
var DIR_GENESIS_FOOTER = "Medical Director Time Sheet 5/18/2020";
var DIR_SELECT_TITLE = "PROGRAM DIRECTOR TIME REPORT";
var DIR_SELECT_ATTEST = "I hereby attest and certify to the validity and accuracy of the information reported for reimbursement of services rendered.";
var DIR_SELECT_MORE = "If additional space is needed, please attach another sheet.";
// Row definitions. `key` is STORED data (dirEntries[].category) - never
// rename one (check.js pins the list). `text` prints exactly.
var DIR_GENESIS_ROWS = [
  { key: "g_guidelines", label: "Guidelines/protocols", text: "Develop/review guidelines or protocols:" },
  { key: "g_oversee", label: "Oversee services", text: "Oversee department provision of services:" },
  { key: "g_orientation", label: "Orientation/CEU", text: "Orientation or CEU development:" },
  { key: "g_dept_ed", label: "Staff education/training", text: "Department/professional education & training:" },
  { key: "g_community_ed", label: "Community education", text: "Community education development/presentation:" },
  { key: "g_policy", label: "Policy/procedure", text: "Policy/procedure development, review, education, enforcement:" },
  { key: "g_safety", label: "Patient safety", text: "Patient safety call/initiatives:" },
  { key: "g_goals", label: "Goal development", text: "Departmental goal development:" },
  { key: "g_budget", label: "Budget planning", text: "Departmental budget planning & discussion:" },
  { key: "g_strategic", label: "Strategic planning", text: "Departmental strategic planning activity:" },
  { key: "g_quality", label: "Quality plan review", text: "Quality management plan review:" },
  { key: "g_ur", label: "UR/chart review", text: "Utilization Review/medical records chart review:" },
  { key: "g_supplies", label: "Supplies/facilities/equipment", text: "Evaluate/review supplies, facilities, equipment needs:" },
  { key: "g_rules", label: "Rules/regulations/standards", text: "Review of rules, regulations, standards, etc:" },
  { key: "g_research", label: "Research/patient care issues", text: "Research, planning, recommendations, patient care issues:" },
  { key: "g_idg", label: "IDG meeting (Hospice)", text: "IDG meeting (Hospice MD only):" },
  { key: "g_other", label: "Other", text: "Other (details)", detail: true, slots: 3, pre: "Other:", post: "", flagName: "Other" },
  { key: "g_meeting", label: "Meeting with...", text: "Meeting with ____ to discuss", detail: true, slots: 4, pre: "Meeting with", post: "to discuss", flagName: "Meeting" }
];
var DIR_SELECT_ROWS = [
  { key: "s_policies", label: "Policies/protocols & scheduling", text: "Assist Hospital in formulating and implementing policies, procedures and clinical protocols for the treatment of patients at Hospital who need services under the Program and, along with the Medical Director of Hospital (the \"Medical Director\"), supervise the scheduling and rendering of such services to those patients." },
  { key: "s_qa_risk", label: "QA & risk management policies", text: "Assist the Medical Director in formulating and implementing policies for Hospital's quality assurance and risk management programs." },
  { key: "s_liaison", label: "Liaison with medical staff/admin", text: "Develop and maintain ongoing dialogue, and act as liaison, among the medical personnel of Hospital and administrators of Hospital (including the Medical Director) concerning the functioning of the Program." },
  { key: "s_outreach", label: "Community outreach & education", text: "Assist Hospital in community outreach and education regarding Hospital's services, including, but not limited to, speaking engagements, written articles and interaction with physicians on staff and outside the immediate area to promote Hospital's programs." },
  { key: "s_committees", label: "Committees & reports to Medical Director", text: "Participate in ad hoc and standing committees of Hospital's medical staff, prepare reports to the Medical Director with respect to the Program and cooperate with the administrators of Hospital, all as necessary to carry out the obligations of the Corporation/Program Director in accordance with this document." },
  { key: "s_staff_ed", label: "Clinical education/training of staff", text: "Participate in clinical education and training of Hospital's employees." },
  { key: "s_outcomes", label: "Monitor & report patient progress/outcomes", text: "Monitor and report on the medical progress and outcomes of patients treated under the Program." },
  { key: "s_meetings", label: "MEC/OIC/admin meetings", text: "Attend MEC or OIC meetings or other Hospital administration meeting(s) as requested by Hospital's CEO." },
  { key: "s_travel", label: "Supplementary Services (travel)", text: "Supplementary Services (when Physician is requested to travel away from Hospital to serve on committees, make presentations and/or attend meetings.) PROVIDE DESCRIPTION OF SERVICES:", detail: true },
  { key: "s_other", label: "Other Activity", text: "Other Activity. PROVIDE DESCRIPTION OF SERVICES:", detail: true }
];
function dirRowsFor(form) { return form === "select" ? DIR_SELECT_ROWS : form === "genesis" ? DIR_GENESIS_ROWS : []; }
function dirRowByKey(form, key) { var rows = dirRowsFor(form); for (var i = 0; i < rows.length; i++) { if (rows[i].key === key) return rows[i]; } return null; }
function dirNeedsDetail(form, key) { var r = dirRowByKey(form, key); return !!(r && r.detail); }

// --- Accessors (last-good recovery can return a snapshot without a field) ---
function dirPlainObj(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
function dirList(d) { return d && Array.isArray(d.directorships) ? d.directorships : []; }
function dirEntriesOf(d) { return d && Array.isArray(d.dirEntries) ? d.dirEntries : []; }
function dirHandoffOf(d) { return d && dirPlainObj(d.dirHandoff) ? d.dirHandoff : {}; }
function dirHasSignature(d) { return !!d && dirPlainObj(d.dirSignatureEnc); }
// Changes whenever the stored ciphertext is replaced (encrypt draws a fresh
// salt + iv every time), so a decrypted view can tell it is stale.
function dirSigKey(d) { return dirHasSignature(d) && typeof d.dirSignatureEnc.salt === "string" && typeof d.dirSignatureEnc.iv === "string" ? d.dirSignatureEnc.salt + ":" + d.dirSignatureEnc.iv : ""; }
function dirById(d, id) { var l = dirList(d); for (var i = 0; i < l.length; i++) { if (l[i] && l[i].id === id) return l[i]; } return null; }

// --- Calendar ---
function dirPad2(n) { return (n < 10 ? "0" : "") + n; }
function dirMonthDays(y, m) {
  if (typeof y !== "number" || typeof m !== "number" || y % 1 !== 0 || m % 1 !== 0 || y < 1 || m < 1 || m > 12) return 0;
  if (m === 2) return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 29 : 28;
  return m === 4 || m === 6 || m === 9 || m === 11 ? 30 : 31;
}
function dirYMParts(ym) {
  var x = typeof ym === "string" ? /^(\d{4})-(\d{2})$/.exec(ym) : null;
  if (!x) return null;
  var y = +x[1], m = +x[2];
  return y >= 1 && m >= 1 && m <= 12 ? { y: y, m: m } : null;
}
function dirYMDParts(ymd) {
  var x = typeof ymd === "string" ? /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd) : null;
  if (!x) return null;
  var y = +x[1], m = +x[2], d = +x[3], n = dirMonthDays(y, m);
  return n && d >= 1 && d <= n ? { y: y, m: m, d: d } : null;
}
function dirAddMonths(ym, n) {
  var p = dirYMParts(ym);
  if (!p || typeof n !== "number" || n % 1 !== 0) return "";
  var i = p.y * 12 + (p.m - 1) + n, y = Math.floor(i / 12), m = i - y * 12 + 1;
  if (y < 1 || y > 9999) return "";
  return String(y).padStart(4, "0") + "-" + dirPad2(m);
}
function dirWeekOf(ymd) { var p = dirYMDParts(ymd); return p ? Math.floor((p.d - 1) / 7) + 1 : 0; }
function dirWeekRanges(ym) {
  var p = dirYMParts(ym), out = [], n = p ? dirMonthDays(p.y, p.m) : 0;
  for (var w = 1; w <= 5; w++) {
    var a = (w - 1) * 7 + 1, b = w === 5 ? n : w * 7;
    if (!p || a > n) { out.push({ week: w, start: "", end: "", label: "" }); continue; }
    out.push({ week: w, start: ym + "-" + dirPad2(a), end: ym + "-" + dirPad2(b), label: a === b ? p.m + "/" + a : p.m + "/" + a + "-" + p.m + "/" + b });
  }
  return out;
}
function dirMD(ymd) { var p = dirYMDParts(ymd); return p ? p.m + "/" + p.d : ""; }
function dirMDY(ymd) { var p = dirYMDParts(ymd); return p ? p.m + "/" + p.d + "/" + p.y : ""; }
function dirMonthLabel(ym) { var p = dirYMParts(ym); return p ? DIR_MONTH_NAMES[p.m - 1] + " " + p.y : ""; }

// --- Durations (stored as whole minutes) ---
function dirMinutesOk(n) { return typeof n === "number" && n % 1 === 0 && n >= 1 && n <= DIR_MAX_ENTRY_MIN; }
function dirFmtHM(min) {
  if (typeof min !== "number" || !isFinite(min) || min < 0) return "";
  var t = Math.round(min);
  return Math.floor(t / 60) + ":" + dirPad2(t % 60);
}
// Custom time from two numeric boxes (the iOS number pad has no ":").
function dirParseHM(h, m) {
  var hs = typeof h === "string" ? h.trim() : typeof h === "number" ? String(h) : "";
  var ms = typeof m === "string" ? m.trim() : typeof m === "number" ? String(m) : "";
  if (hs === "" && ms === "") return { min: null, error: "Type the hours and minutes." };
  if ((hs !== "" && !/^\d{1,2}$/.test(hs)) || (ms !== "" && !/^\d{1,2}$/.test(ms))) return { min: null, error: "Use whole numbers: hours 0-24, minutes 0-59." };
  var hh = hs === "" ? 0 : +hs, mm = ms === "" ? 0 : +ms;
  if (hh > 24 || mm > 59) return { min: null, error: "Use whole numbers: hours 0-24, minutes 0-59." };
  var t = hh * 60 + mm;
  if (!dirMinutesOk(t)) return { min: null, error: t === 0 ? "The time must be at least 0:01." : "The time can be at most 24:00." };
  return { min: t, error: "" };
}
// Decimal hours with no floating-point steps: hundredths of an hour.
function dirFmtHours(min) {
  if (typeof min !== "number" || !isFinite(min) || min < 0) return "";
  var h = Math.round(Math.round(min) * 5 / 3), i = Math.floor(h / 100), f = h % 100;
  return f === 0 ? String(i) : f % 10 === 0 ? i + "." + (f / 10) : i + "." + dirPad2(f);
}
function dirHoursExact(min) { return Math.round(min) * 5 % 3 === 0; }

// --- Money (never toLocaleString: a locale must not change an attestation) ---
function dirMoney(v) {
  var n = typeof v === "number" && isFinite(v) ? v : 0;
  var c = Math.round(parseFloat((Math.abs(n) * 100).toPrecision(12)));
  return (n < 0 && c > 0 ? "-" : "") + "$" + String(Math.floor(c / 100)).replace(/\B(?=(\d{3})+(?!\d))/g, ",") + "." + dirPad2(c % 100);
}
function dirMoneyShown(v, show) { return show ? dirMoney(v) : "$\u2022\u2022\u2022\u2022\u2022"; }
function dirRateOk(dir) { return !!dir && typeof dir.rate === "number" && isFinite(dir.rate) && dir.rate > 0; }
// Whole minutes (the editor refuses a cap that isn't); under 1 minute = not set.
function dirCapMinutes(dir) { var h = dir ? dir.maxHours : 0, c = typeof h === "number" && isFinite(h) && h > 0 ? Math.round(h * 60) : 0; return c >= 1 ? c : null; }
// amount = round2(min(minutes, maxHours*60) / 60 * rate); 0 when the rate or
// the cap is not set (the form blocks on both).
function dirAmount(min, dir) {
  var cap = dirCapMinutes(dir), m = typeof min === "number" && isFinite(min) && min > 0 ? min : 0;
  if (cap === null || !dirRateOk(dir)) return 0;
  return round2((m > cap ? cap : m) / 60 * dir.rate);
}
// Typed money / hours: "$1,720.50" or "4.5"; null when not a number > 0.
// Commas only as thousands groups: a decimal comma ("4,25") is refused,
// never read as 425.
function dirNumFromText(text) {
  var s = (typeof text === "number" ? String(text) : typeof text === "string" ? text : "").replace(/[$\s]/g, "");
  if (s.indexOf(",") !== -1) {
    if (!/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return null;
    s = s.replace(/,/g, "");
  }
  if (!/^\d*\.?\d*$/.test(s) || !/\d/.test(s)) return null;
  var v = parseFloat(s);
  return isFinite(v) && v > 0 ? v : null;
}

// --- Text ---
// Smart punctuation from phone keyboards -> plain ASCII (writers apply it).
function dirAsciiPunct(s) {
  return String(typeof s === "string" ? s : "").replace(/[\u2018\u2019\u201A\u2032]/g, "'").replace(/[\u201C\u201D\u201E\u2033]/g, "\"")
    .replace(/[\u2010-\u2015\u2212]/g, "-").replace(/\u2026/g, "...").replace(/[\u00A0\u2007\u202F]/g, " ");
}
// The PDF's standard fonts print ASCII only: any other character becomes "?"
// and is counted (the form shows the "chars" warning).
function dirAscii(s) {
  var t = dirAsciiPunct(s), n = 0;
  var out = t.replace(/[^\x20-\x7e]/g, function() { n++; return "?"; });
  return { text: out, replaced: n };
}
function dirDetailKey(s) { return String(typeof s === "string" ? s : "").trim().replace(/\s+/g, " ").toLowerCase(); }
function dirDetailText(s) { return String(typeof s === "string" ? s : "").trim().replace(/\s+/g, " "); }
function dirNameKey(s) { return String(typeof s === "string" ? s : "").trim().replace(/\s+/g, " ").toLowerCase(); }
// Surname = last word of printName before its first comma ("Faraz Khan, MD" -> "Khan").
function dirSurname(printName) {
  var w = String(typeof printName === "string" ? printName : "").split(",")[0].trim().split(/\s+/);
  return w[w.length - 1] || "";
}
var DIR_FILE_BAD = /[\\\/:*?"<>|\x00-\x1f\x7f]/;
// The monthly email task finds the PDFs by EXACT file name, so a name is
// either exactly the contract or refused - never silently "cleaned".
function dirFileNameProblem(data, dir) {
  if (!dir) return "Pick a directorship.";
  if (!dirSurname(dir.printName)) return "Add a Print Name with a surname in Settings > Directorships.";
  var nm = typeof dir.name === "string" ? dir.name.trim() : "";
  if (!nm) return "Give this directorship a name in Settings > Directorships.";
  var key = dirNameKey(nm), twin = dirList(data).some(function(o) { return o && o !== dir && o.id !== dir.id && dirNameKey(o.name) === key; });
  if (twin) return "Two directorships are named " + nm + " - rename one (their files would collide).";
  if (DIR_FILE_BAD.test(nm) || DIR_FILE_BAD.test(dir.printName)) return "The name or Print Name contains a character file names can't use (\\ / : * ? \" < > |) - edit it in Settings.";
  if (/[^\x20-\x7e]/.test(nm) || /[^\x20-\x7e]/.test(dir.printName)) return "The name or Print Name has a non-ASCII character - retype it with plain letters.";
  return "";
}
// "<Surname> - <name> Timesheet - YYYY-MM.pdf" (or "" when it can't be made).
function dirFileName(dir, ym) {
  var sur = dir ? dirSurname(dir.printName) : "", nm = dir && typeof dir.name === "string" ? dir.name.trim() : "";
  if (!sur || !nm || !dirYMParts(ym)) return "";
  return sur + " - " + nm + " Timesheet - " + ym + ".pdf";
}
// Settings editor warning while name or printName differs from the stored
// one. The draft is normalized the way Save does it, and a name Save would
// refuse carries the problem text (data = the store, for the twin check).
function dirFileNameNote(saved, draft, ym, data) {
  if (!saved || !draft) return "";
  var sn = typeof saved.name === "string" ? saved.name.trim() : "", sp = typeof saved.printName === "string" ? saved.printName.trim() : "";
  var dn = dirAsciiPunct(draft.name).trim(), dp = dirAsciiPunct(draft.printName).trim();
  if (sn === dn && sp === dp) return "";
  var probe = { id: saved.id, name: dn, printName: dp }, prob = dirFileNameProblem(data, probe);
  var now = dirFileName(probe, ym), was = dirFileName(saved, ym);
  return "The monthly email task finds these PDFs by this exact file name: " + (now || "(none - add a name and a Print Name with a surname)") + (was ? " (was " + was + ")." : ".") + (prob ? " " + prob : "");
}

// --- IDs (never shown, never contain ":") ---
function dirEntryId(i) { return Date.now().toString() + "-dir" + (typeof i === "number" ? i : 0) + "-" + (Math.random().toString(36) + "000000").slice(2, 8); }
function dirNewId() { return "dir-" + Date.now().toString(36) + "-" + (Math.random().toString(36) + "000000").slice(2, 8); }

// --- One month of one directorship, in FORM ORDER ---
// date, then detail key, then category, then minutes, then the exact detail
// text (case-sensitive) - a total order over exactly the hashed fields, so
// slots, printed spelling and the hash can never disagree.
function dirMonthEntries(entries, dirId, ym) {
  var out = (Array.isArray(entries) ? entries : []).filter(function(e) {
    return !!e && typeof e === "object" && e.dirId === dirId && typeof e.date === "string" && e.date.slice(0, 7) === ym && !!dirYMDParts(e.date);
  });
  var cmp = function(a, b) { return a < b ? -1 : a > b ? 1 : 0; };
  return out.slice().sort(function(a, b) {
    return cmp(a.date, b.date) || cmp(dirDetailKey(a.detail), dirDetailKey(b.detail)) || cmp(String(a.category), String(b.category)) ||
      cmp(Number(a.minutes), Number(b.minutes)) || cmp(dirDetailText(a.detail), dirDetailText(b.detail));
  });
}
// cyrb53: a synchronous 53-bit change detector (not a security control).
function dirCyrb53(str) {
  var h1 = 0xdeadbeef, h2 = 0x41c6ce57;
  for (var i = 0; i < str.length; i++) { var ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507); h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507); h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}
// Hash of a month's PRINTED entry fields; "h1-" versions the canonical form.
function dirEntriesHash(entries, dirId, ym) {
  var rows = dirMonthEntries(entries, dirId, ym).map(function(e) { return JSON.stringify([e.date, e.category, e.minutes, dirDetailText(e.detail)]); });
  return "h1-" + rows.length + "-" + dirCyrb53(rows.join("\n")).toString(16).padStart(14, "0");
}
function dirMonthStatus(data, dirId, ym) {
  var rec = dirHandoffOf(data)[dirId + ":" + ym];
  var list = dirMonthEntries(dirEntriesOf(data), dirId, ym);
  if (dirPlainObj(rec)) return { state: rec.entriesHash === dirEntriesHash(dirEntriesOf(data), dirId, ym) ? "handed" : "changed", date: rec.date, count: list.length };
  return { state: list.length ? "progress" : "none", date: "", count: list.length };
}
// done counts only "handed" - a month CHANGED SINCE HANDOFF is not done.
function dirHandoffCount(data, ym) {
  var l = dirList(data), done = 0;
  l.forEach(function(x) { if (x && dirMonthStatus(data, x.id, ym).state === "handed") done++; });
  return { done: done, total: l.length };
}
// On the 1st-5th: the previous month while it isn't fully handed off.
function dirDefaultMonth(data, today) {
  var p = dirYMDParts(today);
  if (!p) return "";
  var cur = today.slice(0, 7), prev = dirAddMonths(cur, -1);
  if (p.d <= 5 && dirList(data).length > 0) { var c = dirHandoffCount(data, prev); if (c.done < c.total) return prev; }
  return cur;
}
// Home's reminder window: the 25th of month M through the 5th of M+1.
function dirReminderMonth(today) {
  var p = dirYMDParts(today);
  if (!p) return "";
  if (p.d >= 25) return today.slice(0, 7);
  if (p.d <= 5) return dirAddMonths(today.slice(0, 7), -1);
  return "";
}
function dirReminderLine(data, today, dismissedYM) {
  var ym = dirReminderMonth(today);
  if (!ym || dirList(data).length === 0 || dismissedYM === ym) return null;
  var c = dirHandoffCount(data, ym);
  if (c.done >= c.total) return null;
  var p = dirYMParts(ym);
  return { ym: ym, text: DIR_MONTH_NAMES[p.m - 1] + " directorship forms: " + c.done + " of " + c.total + " handed off", done: c.done, total: c.total, late: dirYMDParts(today).d <= 5 };
}

// --- The form model: ONE source for the Review screen and the PDF ---
// Other/Meeting slots: each distinct detail (by dirDetailKey) takes the next
// free slot in order of first appearance; the same detail in another week
// reuses its slot; more details than slots -> the LAST slot joins the rest
// with "; " (details may contain commas) and the Review flags it.
function dirSlotPlan(list, row) {
  var keys = [], texts = [], slotOf = {};
  list.forEach(function(e) {
    if (!e || e.category !== row.key) return;
    var k = dirDetailKey(e.detail);
    if (!k || Object.prototype.hasOwnProperty.call(slotOf, k)) return;
    slotOf[k] = Math.min(keys.length, row.slots - 1);
    keys.push(k); texts.push(dirDetailText(e.detail));
  });
  var fills = [];
  for (var s = 0; s < row.slots; s++) fills.push((s < row.slots - 1 ? texts.slice(s, s + 1) : texts.slice(s)).join("; "));
  return { fills: fills, slotOf: slotOf, distinct: texts.length, combined: texts.length > row.slots ? texts.length - row.slots + 1 : 0 };
}
function dirDatesText(dates) { return dates.map(dirMD).join(", "); }
function dirModelFlag(flags, level, code, text) { flags.push({ level: level, code: code, text: text }); }
function dirFormModel(data, dirId, ym, today) {
  var dir = dirById(data, dirId), p = dirYMParts(ym);
  var form = dir && dir.form === "select" ? "select" : "genesis";
  var flags = [], chars = 0;
  var A = function(s) { var r = dirAscii(s); chars += r.replaced; return r.text; };
  var list = dirMonthEntries(dirEntriesOf(data), dirId, ym);
  var defs = dirRowsFor(form), weeks = dirWeekRanges(ym), rows = [], rowAt = {};
  var fmt = form === "select" ? dirFmtHours : dirFmtHM;
  var emptyCells = function() { var c = []; for (var w = 0; w < 5; w++) c.push({ dates: [], datesText: "", minutes: 0, dur: "" }); return c; };
  var plans = {};
  defs.forEach(function(r) {
    if (form === "genesis" && r.slots) {
      var plan = dirSlotPlan(list, r);
      plans[r.key] = plan;
      for (var s = 0; s < r.slots; s++) {
        var fill = A(plan.fills[s]), filled = !!fill;
        var text = !filled ? r.text : r.pre + " " + fill + (r.post ? " " + r.post : "");
        rowAt[r.key + ":" + s] = rows.length;
        rows.push({ key: r.key, slot: s, text: text, parts: { pre: filled || r.post ? r.pre : r.text, fill: fill, post: r.post }, filled: filled, details: [], detailText: "", cells: emptyCells(), minutes: 0 });
      }
      if (plan.combined) dirModelFlag(flags, "warn", "combined", r.flagName + ": " + plan.distinct + " different details for " + r.slots + " lines - the last line combines " + plan.combined + " of them.");
    } else {
      rowAt[r.key] = rows.length;
      rows.push({ key: r.key, slot: -1, text: r.text, filled: true, details: [], detailText: "", cells: emptyCells(), minutes: 0 });
    }
  });
  var weekMinutes = [0, 0, 0, 0, 0], total = 0, nUnplaced = 0, nNoDetail = 0, nBad = 0, nFuture = 0, dKeys = {};
  list.forEach(function(e) {
    var r = dirRowByKey(form, e.category);
    if (!r) { nUnplaced++; return; }
    if (!dirMinutesOk(e.minutes)) { nBad++; return; }
    var dk = dirDetailKey(e.detail);
    if (r.detail && !dk) { nNoDetail++; return; }
    if (isYMD(today) && e.date > today) nFuture++;
    var row = rows[form === "genesis" && r.slots ? rowAt[r.key + ":" + plans[r.key].slotOf[dk]] : rowAt[r.key]];
    var c = row.cells[dirWeekOf(e.date) - 1];
    if (c.dates.indexOf(e.date) === -1) c.dates.push(e.date);
    c.minutes += e.minutes; row.minutes += e.minutes;
    weekMinutes[dirWeekOf(e.date) - 1] += e.minutes; total += e.minutes;
    if (form === "select" && r.detail) {
      dKeys[r.key] = dKeys[r.key] || {};
      if (!dKeys[r.key][dk]) { dKeys[r.key][dk] = true; row.details.push(A(dirDetailText(e.detail))); }
    }
  });
  var inexact = !dirHoursExact(total);
  rows.forEach(function(row) {
    row.detailText = row.details.join("; ");
    row.cells.forEach(function(c) { c.datesText = dirDatesText(c.dates); c.dur = c.minutes ? fmt(c.minutes) : ""; if (c.minutes && !dirHoursExact(c.minutes)) inexact = true; });
  });
  var weekText = weekMinutes.map(function(m, i) { if (m && !dirHoursExact(m)) inexact = true; return weeks[i].label ? fmt(m) : ""; });
  var cap = dirCapMinutes(dir), rate = dirRateOk(dir) ? dir.rate : 0, amount = dirAmount(total, dir), mName = p ? DIR_MONTH_NAMES[p.m - 1] : "";
  var model = { ok: true, form: form, dirId: dirId, ym: ym, monthLabel: dirMonthLabel(ym), monthUpper: mName.toUpperCase(), year: p ? String(p.y) : "",
    fileName: dirFileName(dir, ym), hash: dirEntriesHash(dirEntriesOf(data), dirId, ym), generatedYMD: today, generatedText: dirMDY(today),
    weeks: weeks, rows: rows, weekMinutes: weekMinutes, weekText: weekText, totalMinutes: total,
    totalHM: dirFmtHM(total), totalDec: dirFmtHours(total), totalText: fmt(total),
    capMinutes: cap, overCap: cap !== null && total > cap, rate: rate, amount: amount, entryCount: list.length, flags: flags };
  var str = function(v) { return typeof v === "string" ? A(v.trim()) : typeof v === "number" ? String(v) : ""; };
  if (form === "genesis") {
    model.header = { printName: str(dir && dir.printName), emplNo: str(dir && dir.emplNo), monthYear: model.monthLabel };
    model.footer = { costCtr: str(dir && dir.costCtr), payCode: DIR_PAY_CODE, totalHrs: model.totalHM, rate: dirMoney(rate), due: dirMoney(amount) };
  } else {
    var h = dir && dirPlainObj(dir.selectHeader) ? dir.selectHeader : {}, ra = Array.isArray(h.remitAddress) ? h.remitAddress : [];
    model.header = { programType: str(h.programType), hospital: str(h.hospital), physicianName: str(h.physicianName), contractingParty: str(h.contractingParty),
      remit: [str(ra[0]), str(ra[1])], totalDue: dirMoney(amount), totalHours: model.totalDec, glNo: str(h.glNo), hospitalNo: str(h.hospitalNo),
      periodMonth: model.monthUpper, periodYear: model.year };
  }
  model.sig = { printName: str(dir && dir.printName), date: model.generatedText };
  // Flags: block = no PDF; warn = amber, still allowed; note = grey.
  var plural = function(n, one, many) { return n === 1 ? one : many; };
  if (!dir) dirModelFlag(flags, "block", "noDir", "This directorship no longer exists.");
  if (!p) dirModelFlag(flags, "block", "month", "Pick a month.");
  if (list.length === 0) dirModelFlag(flags, "warn", "empty", "No time logged for " + model.monthLabel + " - this form reports zero hours.");
  if (nUnplaced) dirModelFlag(flags, "block", "unplaced", nUnplaced + " " + plural(nUnplaced, "entry uses", "entries use") + " a category the " + (form === "select" ? "Select" : "Genesis") + " form does not have - edit " + plural(nUnplaced, "it", "them") + " first.");
  if (nNoDetail) dirModelFlag(flags, "block", "noDetail", nNoDetail + " " + plural(nNoDetail, "entry needs", "entries need") + " a detail - edit " + plural(nNoDetail, "it", "them") + " first.");
  if (nBad) dirModelFlag(flags, "block", "badMinutes", nBad + " " + plural(nBad, "entry has", "entries have") + " an invalid duration - edit " + plural(nBad, "it", "them") + " first.");
  if (nFuture) dirModelFlag(flags, "block", "future", nFuture + " " + plural(nFuture, "entry is", "entries are") + " dated after today - forms can only cover work already done.");
  var fnp = dirFileNameProblem(data, dir);
  if (dir && fnp) dirModelFlag(flags, "block", "fileName", fnp);
  if (dir && !dirRateOk(dir)) dirModelFlag(flags, "block", "rate", "Set an hourly rate in Settings > Directorships.");
  if (dir && cap === null) dirModelFlag(flags, "block", "cap", "Set a monthly hour cap in Settings > Directorships.");
  if (model.overCap) {
    if (form === "genesis") dirModelFlag(flags, "warn", "overCap", "Over the " + dirFmtHM(cap) + " monthly cap: the form prints all " + dirFmtHM(total) + "; Due counts " + dirFmtHM(cap) + ".");
    else dirModelFlag(flags, "warn", "overCap", "Over the " + dirFmtHours(cap) + " h monthly cap: the form prints all " + dirFmtHours(total) + " hours; the amount counts " + dirFmtHours(cap) + ".");
  }
  if (isYMD(today) && today.slice(0, 7) === ym && p) dirModelFlag(flags, "warn", "monthOpen", mName + " isn't over (it ends " + p.m + "/" + dirMonthDays(p.y, p.m) + ").");
  var rec = dirHandoffOf(data)[dirId + ":" + ym];
  if (dirPlainObj(rec)) dirModelFlag(flags, "warn", "regenerate", "Handed off " + dirMD(rec.date) + ". This form uses today's rate and cap.");
  if (form === "select" && (!dir || !dirPlainObj(dir.selectHeader) || !model.header.hospital || !model.header.programType || !model.header.physicianName)) dirModelFlag(flags, "warn", "noHeader", "The Select header details are empty - add them in Settings > Directorships.");
  if (chars) dirModelFlag(flags, "warn", "chars", chars + " " + plural(chars, "character", "characters") + " could not print and " + plural(chars, "shows", "show") + " as ?.");
  if (form === "select" && inexact) dirModelFlag(flags, "note", "rounded", "Hours print rounded to 2 places, so printed hours x rate may not equal the amount due.");
  if (form === "genesis" && (!model.header.emplNo || !model.footer.costCtr)) dirModelFlag(flags, "note", "blanks", (!model.header.emplNo && !model.footer.costCtr ? "Empl # and Cost Ctr. print" : !model.header.emplNo ? "Empl # prints" : "Cost Ctr. prints") + " blank.");
  model.ok = !flags.some(function(f) { return f.level === "block"; });
  return model;
}

// --- Writers: every write of the four fields goes through one of these; ---
// --- each output passes repairData unchanged (check.js contract tests). ---
function dirNew(form, printName) {
  var d = { id: dirNewId(), name: "New directorship", shortName: "", org: "", form: form === "select" ? "select" : "genesis", printName: typeof printName === "string" ? printName : "", emplNo: "", costCtr: "", rate: 0, maxHours: 0 };
  if (d.form === "select") d.selectHeader = { hospital: "", programType: "", physicianName: "", contractingParty: "", remitAddress: ["", ""], glNo: "", hospitalNo: "" };
  return d;
}
function dirFormInUse(entries, id) { return (Array.isArray(entries) ? entries : []).filter(function(e) { return !!e && e.dirId === id; }).length; }
var DIR_EDIT_TEXT = ["name", "shortName", "org", "printName", "emplNo", "costCtr"];
var DIR_EDIT_SELECT = ["hospital", "programType", "physicianName", "contractingParty", "glNo", "hospitalNo"];
// The Settings editor's ONE Save path. draft holds raw strings as typed;
// returns { dir, errors: [{ field, text }] } (dir null when refused).
function dirFromEditorDraft(dirs, orig, draft) {
  var errors = [], src = orig && typeof orig === "object" ? orig : null;
  var t = function(k) { return dirAsciiPunct(draft && typeof draft[k] === "string" ? draft[k] : "").trim(); };
  var form = draft && draft.form === "select" ? "select" : draft && draft.form === "genesis" ? "genesis" : (src ? src.form : "");
  if (form !== "genesis" && form !== "select") errors.push({ field: "form", text: "Pick the form type." });
  var name = t("name"), printName = t("printName");
  if (!name) errors.push({ field: "name", text: "Give it a name." });
  else if (DIR_FILE_BAD.test(name) || /[^\x20-\x7e]/.test(name)) errors.push({ field: "name", text: "The name goes into the file name: use plain letters and no \\ / : * ? \" < > |." });
  else if ((Array.isArray(dirs) ? dirs : []).some(function(o) { return o && (!src || o.id !== src.id) && dirNameKey(o.name) === dirNameKey(name); })) errors.push({ field: "name", text: "Another directorship already has this name - the files would collide." });
  if (!dirSurname(printName)) errors.push({ field: "printName", text: "Add a Print Name with a surname (e.g. \"Faraz Khan, MD\")." });
  else if (DIR_FILE_BAD.test(printName) || /[^\x20-\x7e]/.test(printName)) errors.push({ field: "printName", text: "The Print Name's surname goes into the file name: use plain letters and no \\ / : * ? \" < > |." });
  var rate = dirNumFromText(draft ? draft.rate : ""), maxHours = dirNumFromText(draft ? draft.maxHours : "");
  if (rate === null) errors.push({ field: "rate", text: "Type the hourly rate (a number above 0)." });
  if (maxHours === null) errors.push({ field: "maxHours", text: "Type the monthly hour cap (a number above 0)." });
  else if (Math.round(maxHours * 60) < 1 || Math.abs(maxHours * 60 - Math.round(maxHours * 60)) > 1e-6) errors.push({ field: "maxHours", text: "Use a cap that is a whole number of minutes (e.g. 4.25 or 4.5)." });
  if (errors.length) return { dir: null, errors: errors };
  var d = src ? { ...src } : dirNew(form, "");
  DIR_EDIT_TEXT.forEach(function(k) { if (k === "emplNo" || k === "costCtr") { if (form === "genesis" || d[k] !== undefined) d[k] = t(k); } else d[k] = t(k); });
  d.form = form; d.rate = rate; d.maxHours = maxHours;
  if (form === "select" || dirPlainObj(d.selectHeader)) {
    var h = dirPlainObj(d.selectHeader) ? { ...d.selectHeader } : { hospital: "", programType: "", physicianName: "", contractingParty: "", remitAddress: ["", ""], glNo: "", hospitalNo: "" };
    if (form === "select") {
      DIR_EDIT_SELECT.forEach(function(k) { h[k] = t(k); });
      h.remitAddress = [t("remit1"), t("remit2")];
    }
    d.selectHeader = h;
  }
  return { dir: d, errors: [] };
}
// Log save, edit and the Repeat confirm all build entries here.
// draft: { date, minutes (number), category, detail } -> { entry, problems }.
function dirEntryFromDraft(draft, dir, id) {
  var problems = [];
  if (!dir || typeof dir.id !== "string") problems.push("Pick a directorship.");
  var date = draft && typeof draft.date === "string" ? draft.date : "";
  if (!isYMD(date)) problems.push("Pick a date.");
  var minutes = draft ? draft.minutes : null;
  if (!dirMinutesOk(minutes)) problems.push("Pick a time (0:01 to 24:00).");
  var cat = draft && typeof draft.category === "string" ? draft.category : "";
  var row = dir ? dirRowByKey(dir.form, cat) : null;
  if (dir && !row) problems.push("Pick an activity.");
  var detail = row && row.detail ? dirDetailText(dirAsciiPunct(draft && typeof draft.detail === "string" ? draft.detail : "")) : "";
  if (row && row.detail && !detail) problems.push("Add the " + (cat === "g_meeting" ? "meeting" : "activity") + " detail (" + DIR_DETAIL_HINT + ").");
  if (detail.length > DIR_DETAIL_MAX) problems.push("Keep the detail to " + DIR_DETAIL_MAX + " characters.");
  if (problems.length) return { entry: null, problems: problems };
  return { entry: { id: typeof id === "string" && id ? id : dirEntryId(0), dirId: dir.id, date: date, minutes: minutes, category: cat, detail: detail }, problems: [] };
}
function dirHandoffMark(h, dirId, ym, date, hash) { var o = { ...(dirPlainObj(h) ? h : {}) }; o[dirId + ":" + ym] = { date: date, entriesHash: hash }; return o; }
function dirHandoffClear(h, dirId, ym) { var o = { ...(dirPlainObj(h) ? h : {}) }; delete o[dirId + ":" + ym]; return o; }
function dirRestoreBuiltIns(prev) { return dirList(prev).length > 0 ? prev : { ...prev, directorships: defaultDirectorships() }; }
function dirMissingBuiltIns(data) {
  var l = dirList(data);
  if (l.length === 0) return [];
  return defaultDirectorships().filter(function(p) { return !l.some(function(x) { return x && x.id === p.id; }); });
}
function dirNameTaken(data, name) { var k = dirNameKey(name); return dirList(data).some(function(x) { return !!x && dirNameKey(x.name) === k; }); }
// Never makes a twin: refused while another directorship has the name.
function dirRestoreBuiltIn(prev, id) {
  var miss = dirMissingBuiltIns(prev).filter(function(p) { return p.id === id; })[0];
  return miss && !dirNameTaken(prev, miss.name) ? { ...prev, directorships: dirList(prev).concat([miss]) } : prev;
}
// Entries / hand-off records whose directorship was removed (kept hidden so
// a restored built-in gets its hours back).
function dirOrphanCount(data) {
  var ids = {};
  dirList(data).forEach(function(x) { if (x && typeof x.id === "string") ids[x.id] = true; });
  return dirEntriesOf(data).filter(function(e) { return !!e && !ids[e.dirId]; }).length;
}
function dirDropOrphans(prev) {
  var ids = {};
  dirList(prev).forEach(function(x) { if (x && typeof x.id === "string") ids[x.id] = true; });
  var h = {}, hh = dirHandoffOf(prev);
  Object.keys(hh).forEach(function(k) { if (ids[k.slice(0, k.lastIndexOf(":"))]) h[k] = hh[k]; });
  var next = { ...prev, dirEntries: dirEntriesOf(prev).filter(function(e) { return !!e && ids[e.dirId]; }) };
  if (prev.dirHandoff !== undefined) next.dirHandoff = h;
  return next;
}
// Remove only the directorship; its entries and hand-offs stay (hidden).
function dirRemove(prev, dirId) {
  var l = dirList(prev), at = -1;
  l.forEach(function(x, i) { if (x && x.id === dirId) at = i; });
  if (at < 0) return { next: prev, removed: null, at: -1 };
  return { next: { ...prev, directorships: l.filter(function(x, i) { return i !== at; }) }, removed: l[at], at: at };
}
function dirRemoveUndo(prev, a) {
  if (!a || !a.removed || dirById(prev, a.removed.id)) return prev;
  var l = dirList(prev).slice(), at = typeof a.at === "number" && a.at >= 0 && a.at <= l.length ? a.at : l.length;
  l.splice(at, 0, a.removed);
  return { ...prev, directorships: l };
}

// --- Logging helpers ---
function dirRecentCategories(entries, dirId) {
  var out = [], l = Array.isArray(entries) ? entries : [];
  for (var i = l.length - 1; i >= 0 && out.length < 4; i--) { var e = l[i]; if (e && e.dirId === dirId && typeof e.category === "string" && out.indexOf(e.category) === -1) out.push(e.category); }
  return out;
}
function dirRecentDetails(entries, dirId, category) {
  var out = [], seen = {}, l = Array.isArray(entries) ? entries : [];
  for (var i = l.length - 1; i >= 0 && out.length < 6; i--) {
    var e = l[i];
    if (!e || e.dirId !== dirId || e.category !== category) continue;
    var k = dirDetailKey(e.detail);
    if (k && !seen[k]) { seen[k] = true; out.push(dirDetailText(e.detail)); }
  }
  return out;
}
// "Repeat last month": a DRAFT of the previous month's entries, moved to the
// same day of the month (clamped to its length). Never saved by itself.
function dirRepeatDraft(entries, dirId, ym, today) {
  var tp = dirYMParts(ym);
  if (!tp) return [];
  var n = dirMonthDays(tp.y, tp.m), have = {};
  dirMonthEntries(entries, dirId, ym).forEach(function(e) { have[[e.date, e.category, e.minutes, dirDetailKey(e.detail)].join("|")] = true; });
  return dirMonthEntries(entries, dirId, dirAddMonths(ym, -1)).map(function(e) {
    var d = +e.date.slice(8, 10), d2 = Math.min(d, n), date = ym + "-" + dirPad2(d2);
    var dup = !!have[[date, e.category, e.minutes, dirDetailKey(e.detail)].join("|")], future = isYMD(today) && date > today;
    return { dirId: dirId, date: date, minutes: e.minutes, category: e.category, detail: typeof e.detail === "string" ? e.detail : "", from: e.date, clamped: d2 !== d, dup: dup, future: future, on: !dup && !future };
  });
}
// Pay for months whose 1st lies in [from, to) (a month counts whole in the
// period that holds its 1st), PLACED entries only, each directorship-month
// capped, summed in whole cents. upTo: count only entries dated <= upTo.
function dirTotalInRange(data, from, to, upTo) {
  var groups = {}, n = 0, cents = 0, months = 0;
  dirEntriesOf(data).forEach(function(e) {
    if (!e || typeof e.date !== "string" || !dirYMDParts(e.date)) return;
    var first = e.date.slice(0, 7) + "-01";
    if (first < from || first >= to || (upTo && e.date > upTo)) return;
    var dir = dirById(data, e.dirId);
    if (!dir || !dirRowByKey(dir.form, e.category) || !dirMinutesOk(e.minutes) || !dirRateOk(dir) || dirCapMinutes(dir) === null) return;
    var k = e.dirId + ":" + e.date.slice(0, 7);
    groups[k] = (groups[k] || 0) + e.minutes; n++;
  });
  Object.keys(groups).forEach(function(k) { months++; cents += Math.round(dirAmount(groups[k], dirById(data, k.slice(0, k.lastIndexOf(":")))) * 100); });
  return { total: cents / 100, entries: n, months: months };
}
// Restore confirm: what a backup would take away (computed before repair).
function dirRestoreNote(restored, data) {
  var parts = [], bN = restored && Array.isArray(restored.dirEntries) ? restored.dirEntries.length : 0, pN = dirEntriesOf(data).length;
  if (bN === 0 && pN > 0) parts.push("this backup has no directorship hours - the " + pN + " time " + (pN === 1 ? "entry" : "entries") + " on this phone will be removed");
  if (dirWillSeed(restored) && JSON.stringify(dirList(data)) !== JSON.stringify(DIRECTORSHIP_PRESET)) parts.push("this backup predates directorships - the built-in directorships will replace the ones on this phone");
  if (dirHasSignature(data) && !(restored && dirPlainObj(restored.dirSignatureEnc))) parts.push("your saved signature will be removed (draw it again after restoring)");
  return parts.length ? " WARNING: " + parts.join("; ") + "." : "";
}

// --- Signature ---
// The signature PNG is stored ENCRYPTED with the session PIN (RVU_CRYPTO,
// the API key's mechanism). What that does: it keeps the signature from
// being readable as plain data - someone browsing the app's storage, or any
// future plaintext export (the JSON export also strips it). What it does
// NOT do: stop code running on fkhan628.github.io, which can read the
// unsalted PIN hash and guess a 4-6 digit PIN almost instantly. The real fix
// is moving the app to its own web address - a separate decision.
// Decrypted only at render time; the plaintext lives only in the asking
// component's state, bound to the PIN that decrypted it.
var DIR_SIG_MAX = 200000;
function dirSigPngOk(s) { return typeof s === "string" && s.length <= DIR_SIG_MAX && /^data:image\/png;base64,[A-Za-z0-9+\/]+=*$/.test(s); }
// Export size: the ink box contain-fit into 600 x 200 (device independent).
function dirSigExportSize(w, h) {
  if (!(w > 0) || !(h > 0)) return { w: 0, h: 0 };
  var k = Math.min(1, 600 / w, 200 / h);
  return { w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)) };
}
function dirCrypto() { return typeof window !== "undefined" && window.RVU_CRYPTO ? window.RVU_CRYPTO : null; }
function dirPinNow() { var c = dirCrypto(); try { return c && c.getPin ? c.getPin() : null; } catch (e) { return null; } }
function dirSigPrecheck(enc, pin) { return !dirPlainObj(enc) ? "none" : !pin ? "locked" : "decrypt"; }
function dirSigFromPlain(pt) { return dirSigPngOk(pt) ? { state: "ok", url: pt } : { state: "unreadable" }; }
function dirSigStillValid(pinAt) { return !!pinAt && dirPinNow() === pinAt; }
// -> Promise<{ state: "none"|"locked"|"ok"|"unreadable", url, pin }>; never rejects.
function dirSignatureLoad(data) {
  var enc = data && dirPlainObj(data.dirSignatureEnc) ? data.dirSignatureEnc : null, pin = dirPinNow(), c = dirCrypto();
  var pre = dirSigPrecheck(enc, pin);
  if (pre !== "decrypt") return Promise.resolve({ state: pre, url: "", pin: "" });
  if (!c || !c.decrypt) return Promise.resolve({ state: "locked", url: "", pin: "" });
  return Promise.resolve().then(function() { return c.decrypt(pin, enc); }).then(function(pt) {
    var r = dirSigFromPlain(pt);
    return { state: r.state, url: r.url || "", pin: r.state === "ok" ? pin : "" };
  }).catch(function() { return { state: "unreadable", url: "", pin: "" }; });
}
// -> Promise<"saved"|"locked"|"bad"|"error">; never rejects.
function dirSignatureSave(dataUrl, upd) {
  if (!dirSigPngOk(dataUrl)) return Promise.resolve("bad");
  var pin = dirPinNow(), c = dirCrypto();
  if (!pin || !c || !c.encrypt) return Promise.resolve("locked");
  return Promise.resolve().then(function() { return c.encrypt(pin, dataUrl); }).then(function(enc) {
    if (!enc || typeof enc.ct !== "string" || typeof enc.salt !== "string" || typeof enc.iv !== "string") return "error";
    upd(function(prev) { return { ...prev, dirSignatureEnc: { ct: enc.ct, salt: enc.salt, iv: enc.iv } }; });
    return "saved";
  }).catch(function() { return "error"; });
}
function dirSignatureRemove(upd) { upd(function(prev) { return { ...prev, dirSignatureEnc: null }; }); }

// --- Home reminder dismissal: ONE per-device key, outside the store ---
var DIR_REMIND_KEY = "rvu-dir-reminder";
function readDirReminder() { var v = ""; try { v = localStorage.getItem(DIR_REMIND_KEY) || ""; } catch (e) { v = ""; } return dirYMParts(v) ? v : ""; }
function dismissDirReminder(ym) { try { localStorage.setItem(DIR_REMIND_KEY, ym); } catch (e) {} return ym; }

// --- File hand-off helpers (the Share Backup patterns, settings.js) ---
function canShareFile(f) { try { return !!(f && navigator.share && navigator.canShare && navigator.canShare({ files: [f] })); } catch (e) { return false; } }
function finePointer() { try { return !!(window.matchMedia && window.matchMedia("(pointer: fine)").matches); } catch (e) { return false; } }
function downloadBlob(blob, name) {
  var u = URL.createObjectURL(blob), a = document.createElement("a");
  a.href = u; a.download = name; a.style.display = "none";
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(function() { try { URL.revokeObjectURL(u); } catch (e) {} }, 60000);   // not in the same tick
}

// Years that have ANY data (logged entries, institution months, acute
// months, call-pay shifts via payShiftYears), newest first. Shared by the
// Dashboard and Trends year chips so the two surfaces can never drift (a
// call-pay-only year shows Home's Call pay line and Trends' empty states).
// Callers wrap in useMemo with data.payShifts among the deps.
function availableDataYears(data) {
  var ySet = {};
  (data.entries || []).forEach(function(e) { if (e && e.date) ySet[e.date.slice(0, 4)] = true; });
  (data.institutionData || []).forEach(function(d) { if (d && d.month) ySet[d.month.slice(0, 4)] = true; });
  Object.keys(data.acuteMonths || {}).forEach(function(mk) { ySet[mk.slice(0, 4)] = true; });
  payShiftYears(data.payShifts).forEach(function(y) { ySet[y] = true; });
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

// --- Lazy jsPDF loader (Directorships time sheets) ---
// Provenance (2026-10-18): jspdf@4.2.1/dist/jspdf.umd.min.js, 420165 bytes,
// byte-identical on unpkg, jsdelivr and the npm tarball (registry
// dist.integrity sha512-YyAXyvnmjTbR4bHQRLzex3CuINCDlQnBqoSYyjJwTP2x9jDLuKDzy7aKUl0hgx3uhcl7xzg32agn5vlie6HIlQ==),
// sha256 5lUfzcMvCdaFOyxRJtGNAdlEfg2mGKQaEevu4PbCDVQ= (equals jsDelivr's
// index). A version bump changes PDF_PATH and PDF_SRI together (check.js
// pins both). Loaded only from Review & Send, never at boot. Tried on unpkg,
// then the same path and hash on jsdelivr (the index.html CDN pattern), 15 s
// per host because a blackholed CDN never fires onerror. One in-flight
// promise, reset on failure so the next tap retries.
var PDF_PATH = "jspdf@4.2.1/dist/jspdf.umd.min.js";
var PDF_SRI = "sha384-qovJwSBbRDPP5cEjCp8S0UP66wrvnjaa60XMOGzTNanrThcrGfXfnZkvgY8N1KT3";
var PDF_HOSTS = ["https://unpkg.com/", "https://cdn.jsdelivr.net/npm/"];
var PDF_HOST_MS = 15000;
var _pdfLoad = null;
function pdfReady() { return typeof window !== "undefined" && !!(window.jspdf && typeof window.jspdf.jsPDF === "function"); }
function loadPDF() {
  if (pdfReady()) return Promise.resolve(window.jspdf.jsPDF);
  if (_pdfLoad) return _pdfLoad;
  _pdfLoad = new Promise(function(resolve, reject) {
    var tryHost = function(i) {
      var done = false, s = document.createElement("script"), t = null;
      var next = function() {
        if (done) return;
        done = true; clearTimeout(t);
        if (s.parentNode) s.parentNode.removeChild(s);
        if (pdfReady()) { resolve(window.jspdf.jsPDF); return; }   // a timed-out host's script ran after all
        if (i + 1 < PDF_HOSTS.length) { tryHost(i + 1); return; }
        _pdfLoad = null;
        reject(new Error("Could not load the PDF library - check your connection and try again."));
      };
      s.src = PDF_HOSTS[i] + PDF_PATH; s.integrity = PDF_SRI; s.crossOrigin = "anonymous";
      s.onload = function() {
        // Removing a timed-out tag does not cancel its script: a late load
        // that defines jsPDF still counts (a no-op once the promise settled).
        if (done) { if (pdfReady()) resolve(window.jspdf.jsPDF); return; }
        done = true; clearTimeout(t);
        if (pdfReady()) { resolve(window.jspdf.jsPDF); return; }
        _pdfLoad = null; reject(new Error("The PDF library loaded but did not initialize - try again."));
      };
      s.onerror = next;                       // network failure OR an SRI mismatch
      t = setTimeout(next, PDF_HOST_MS);
      document.head.appendChild(s);
    };
    tryHost(0);
  });
  return _pdfLoad;
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
  if (d.directorships !== undefined && !Array.isArray(d.directorships)) return false;
  if (d.dirEntries !== undefined && !Array.isArray(d.dirEntries)) return false;
  if (d.dirHandoff !== undefined && (typeof d.dirHandoff !== "object" || d.dirHandoff === null || Array.isArray(d.dirHandoff))) return false;
  if (d.dirSignatureEnc !== undefined && d.dirSignatureEnc !== null && (typeof d.dirSignatureEnc !== "object" || Array.isArray(d.dirSignatureEnc))) return false;
  return true;
}

