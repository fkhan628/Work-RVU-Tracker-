// =======================================
// LOG PROCEDURE
// =======================================
function LogProc({ data, db, cptMap, categories, upd, setView, showUndo }) {
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [patientId, setPatientId] = useState("");
  const [procs, setProcs] = useState([{ id: 1, code: null, search: "", mods: [] }]);
  const [notes, setNotes] = useState("");
  const [saved, setSaved] = useState(false);
  const [activeProc, setActiveProc] = useState(0);
  const [cat, setCat] = useState("All");
  const [showFavs, setShowFavs] = useState(true);
  const [isCall, setIsCall] = useState(false);
  var scanning = useRef(false);
  var [scanStatus, setScanStatus] = useState("");
  var [scanError, setScanError] = useState("");
  var imgRef = useRef(null);
  var clinicRef = useRef(null);
  var inpatientRef = useRef(null);
  var [hipaaAck, setHipaaAck] = useState(false);
  var [showHipaaWarn, setShowHipaaWarn] = useState(false);
  var pendingScanType = useRef(null);
  var nextId = useRef(2);

  var favorites = data.favorites || [];
  var favCodes = useMemo(function() {
    return favorites.map(function(code) { return cptMap[code]; }).filter(function(c) { return c; });
  }, [favorites, cptMap]);

  // Usage counts for each CPT code
  var usageCounts = useMemo(function() {
    var counts = {};
    (data.entries || []).forEach(function(e) {
      counts[e.cptCode] = (counts[e.cptCode] || 0) + 1;
    });
    return counts;
  }, [data.entries]);

  // Most-used codes (top 8 that aren't already in favorites)
  var mostUsed = useMemo(function() {
    var sorted = Object.entries(usageCounts)
      .filter(function(pair) { return cptMap[pair[0]] && !favorites.includes(pair[0]); })
      .sort(function(a, b) { return b[1] - a[1]; })
      .slice(0, 8)
      .map(function(pair) { return cptMap[pair[0]]; });
    return sorted;
  }, [usageCounts, cptMap, favorites]);

  var toggleFav = function(code) {
    upd(function(prev) {
      var favs = prev.favorites || [];
      if (favs.includes(code)) {
        return { ...prev, favorites: favs.filter(function(c) { return c !== code; }) };
      } else {
        return { ...prev, favorites: favs.concat([code]) };
      }
    });
  };

  var moveFav = function(code, direction) {
    upd(function(prev) {
      var favs = (prev.favorites || []).slice();
      var idx = favs.indexOf(code);
      if (idx === -1) return prev;
      var newIdx = idx + direction;
      if (newIdx < 0 || newIdx >= favs.length) return prev;
      var temp = favs[newIdx];
      favs[newIdx] = favs[idx];
      favs[idx] = temp;
      return { ...prev, favorites: favs };
    });
  };

  var isFav = function(code) { return favorites.includes(code); };

  var cur = procs[activeProc] || procs[0];
  var curSearch = cur.search;
  var curSel = cur.code ? cptMap[cur.code] : null;
  var curMods = cur.mods;

  var filtered = useMemo(function() {
    var items = db;
    if (cat !== "All") items = items.filter(function(c) { return c.category === cat; });
    if (curSearch.trim()) {
      var q = curSearch.toLowerCase().trim();
      items = items.filter(function(c) { return c.code.includes(q) || c.desc.toLowerCase().includes(q) || c.category.toLowerCase().includes(q) || (c.keywords && c.keywords.toLowerCase().includes(q)); });
    }
    return items;
  }, [curSearch, cat, db]);

  var updateProc = function(idx, updates) {
    setProcs(function(prev) {
      return prev.map(function(p, i) { return i === idx ? Object.assign({}, p, updates) : p; });
    });
  };

  var selectCode = function(cpt) {
    updateProc(activeProc, { code: cpt.code, search: cpt.code + " - " + cpt.desc });
  };

  var clearCode = function() {
    updateProc(activeProc, { code: null, search: "", mods: [] });
  };

  var toggleMod = function(mc) {
    var newMods = curMods.includes(mc) ? curMods.filter(function(m) { return m !== mc; }) : curMods.concat([mc]);
    updateProc(activeProc, { mods: newMods });
  };

  var addProc = function() {
    var newP = { id: nextId.current++, code: null, search: "", mods: [] };
    setProcs(function(prev) { return prev.concat([newP]); });
    setActiveProc(procs.length);
  };

  var removeProc = function(idx) {
    if (procs.length <= 1) return;
    setProcs(function(prev) { return prev.filter(function(_, i) { return i !== idx; }); });
    if (activeProc >= idx && activeProc > 0) setActiveProc(activeProc - 1);
  };

  var calcProcRVU = function(p) {
    var info = p.code ? cptMap[p.code] : null;
    return info ? calcAdj(info.wRVU, p.mods) : 0;
  };

  var totalRVU = procs.reduce(function(sum, p) { return sum + calcProcRVU(p); }, 0);
  var totalComp = totalRVU * data.settings.ratePerRVU;
  var canSave = procs.some(function(p) { return p.code; });

  var scanNote = function(file) {
    if (!file || scanning.current) return;
    getDecryptedApiKey(data.settings).then(function(apiKey) {
    if (!apiKey) { setScanError("No API key configured. Add one in Settings to enable scanning."); return; }
    scanning.current = true;
    var isPDF = file.type === "application/pdf" || (file.name && file.name.toLowerCase().endsWith(".pdf"));
    setScanStatus(isPDF ? "Reading PDF..." : "Reading image...");
    setScanError("");
    var reader = new FileReader();
    reader.onload = function(ev) {
      var base64 = ev.target.result.split(",")[1];
      var mediaType = isPDF ? "application/pdf" : (file.type || "image/jpeg");
      setScanStatus("Analyzing operative note...");
      var contentBlock = isPDF
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
        : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              contentBlock,
              { type: "text", text: "You are analyzing an operative report/note (which may be a PDF document or image) for a surgical RVU tracking app. The document may be multi-page - analyze ALL pages thoroughly.\n\nCRITICAL PRIVACY RULE: Do NOT include any Protected Health Information (PHI) in your response. Never return patient full names, MRNs, dates of birth, SSNs, addresses, phone numbers, or any other HIPAA identifiers. For patient field, generate only 2-letter initials (e.g. \"JD\"). For descriptions, use only generic procedure names - never include patient-specific clinical details.\n\nExtract:\n1. date: the procedure date in YYYY-MM-DD format (look for Date of Surgery, Date of Procedure, DOS, etc.)\n2. patient: 2-letter initials ONLY derived from patient name. If you cannot determine, use empty string.\n3. codes: an array of objects, each with:\n   - code: the most likely CPT code (5-digit number)\n   - description: brief GENERIC procedure name (e.g. \"Lap cholecystectomy\" not patient-specific details)\n   - confidence: high/medium/low\n   - modifiers: array of applicable modifier codes (e.g. [\"51\"] for multiple procedures, [\"50\"] for bilateral). First/primary procedure gets no modifier, subsequent procedures get \"51\".\n\nIMPORTANT: Suggest standard CPT codes based on the procedures described. Common surgical codes include:\n- 47562/47563 lap chole, 44970 lap appy, 49505 inguinal hernia\n- 44140/44204 colectomy, 44120 small bowel resection\n- 19301 partial mastectomy, 19303 simple mastectomy, 38525 axillary node dissection\n- 27447 TKA, 27130 THA, 27590 AKA, 27880 BKA\n- 35301 CEA, 36821 AV fistula, 47562 lap chole\n- Also look for: central line (36556/36561), chest tube (32551), tracheostomy (31600)\n- Include any separately billable add-on procedures mentioned\n\nIf the document contains MULTIPLE operative notes (e.g. a day's cases), extract ALL of them.\n\nRespond ONLY with valid JSON, no markdown backticks or other text:\n{\"date\": \"YYYY-MM-DD\", \"patient\": \"XX\", \"codes\": [{\"code\": \"XXXXX\", \"description\": \"...\", \"confidence\": \"high\", \"modifiers\": []}]}" }
            ]
          }]
        })
      }).then(function(res) { return res.json(); }).then(function(data) {
        var text = "";
        if (data.content) {
          data.content.forEach(function(item) { if (item.type === "text") text += item.text; });
        }
        text = text.replace(/```json|```/g, "").trim();
        try {
          var result = JSON.parse(text);
          if (result.date) setDate(result.date);
          if (result.patient) setPatientId(result.patient);
          if (result.codes && result.codes.length > 0) {
            var newProcs = [];
            result.codes.forEach(function(c, i) {
              var found = cptMap[c.code];
              if (found) {
                newProcs.push({ id: nextId.current++, code: c.code, search: "", mods: c.modifiers || [] });
              } else {
                newProcs.push({ id: nextId.current++, code: null, search: c.code + " " + c.description, mods: c.modifiers || [] });
              }
            });
            if (newProcs.length > 0) {
              setProcs(newProcs);
              setActiveProc(0);
            }
            setScanStatus("Found " + result.codes.length + " procedure(s)");
            setTimeout(function() { setScanStatus(""); }, 3000);
          } else {
            setScanStatus("");
            setScanError("No procedures identified in document");
          }
        } catch (e) {
          setScanStatus("");
          setScanError("Could not parse AI response. Try a clearer image or PDF.");
        }
        scanning.current = false;
      }).catch(function(err) {
        setScanStatus("");
        setScanError("Scan failed: " + err.message);
        scanning.current = false;
      });
    };
    reader.onerror = function() {
      setScanStatus("");
      setScanError("Failed to read file");
      scanning.current = false;
    };
    if (file.size > 30 * 1024 * 1024) {
      setScanStatus("");
      setScanError("File too large (max 30MB). Try a smaller file or image.");
      scanning.current = false;
      return;
    }
    reader.readAsDataURL(file);
    }); // end getDecryptedApiKey for scanNote
  };

  var scanClinicNote = function(file) {
    if (!file || scanning.current) return;
    getDecryptedApiKey(data.settings).then(function(apiKey) {
    if (!apiKey) { setScanError("No API key configured. Add one in Settings to enable scanning."); return; }
    scanning.current = true;
    var isPDF = file.type === "application/pdf" || (file.name && file.name.toLowerCase().endsWith(".pdf"));
    setScanStatus(isPDF ? "Reading PDF..." : "Reading image...");
    setScanError("");
    var reader = new FileReader();
    reader.onload = function(ev) {
      var base64 = ev.target.result.split(",")[1];
      var mediaType = isPDF ? "application/pdf" : (file.type || "image/jpeg");
      setScanStatus("Analyzing clinic note...");
      var contentBlock = isPDF
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
        : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              contentBlock,
              { type: "text", text: "You are analyzing an outpatient clinic encounter note (which may be a PDF or image) for a surgical RVU tracking app. This is a SINGLE patient visit note (H&P, progress note, or consult note). The document may be multi-page - analyze ALL pages thoroughly.\n\nCRITICAL PRIVACY RULE: Do NOT include any Protected Health Information (PHI) in your response. Never return patient full names, MRNs, dates of birth, SSNs, addresses, phone numbers, or any other HIPAA identifiers. For patient field, generate only 2-letter initials (e.g. \"JD\"). For descriptions, use only generic procedure names.\n\nExtract:\n1. date: the visit date in YYYY-MM-DD format\n2. patient: 2-letter initials ONLY derived from patient name. If you cannot determine, use empty string.\n3. codes: an array of objects, each with:\n   - code: the most likely CPT code (5-digit number)\n   - description: brief GENERIC description\n   - confidence: high/medium/low\n   - modifiers: array of applicable modifier codes\n\nE&M CODE SELECTION GUIDE - Determine level by Medical Decision Making (MDM) complexity:\n- New patient: 99202 (straightforward), 99203 (low), 99204 (moderate), 99205 (high)\n- Established patient: 99211 (minimal/nurse), 99212 (straightforward), 99213 (low), 99214 (moderate), 99215 (high)\n\nMDM complexity factors: number of diagnoses, data reviewed (labs, imaging, records), risk of complications/morbidity.\n- Straightforward: 1 self-limited problem, minimal data, minimal risk\n- Low: 2+ self-limited problems OR 1 stable chronic, limited data, low risk\n- Moderate: 1 chronic illness with exacerbation OR undiagnosed new problem, moderate data, moderate risk (Rx drug management)\n- High: 1 chronic illness with severe exacerbation OR acute life-threatening, extensive data, high risk (surgery, hospitalization)\n\nAlso look for office procedures performed during the visit:\n- Biopsy (skin 11102-11107, breast 19081-19086), I&D (10060-10061), excision, wound care\n- Joint injection (20610-20611), trigger point (20552-20553)\n- Lesion destruction, laceration repair, etc.\n- If procedure + E&M on same visit, include modifier 25 on the E&M code\n\nRespond ONLY with valid JSON, no markdown backticks or other text:\n{\"date\": \"YYYY-MM-DD\", \"patient\": \"XX\", \"codes\": [{\"code\": \"XXXXX\", \"description\": \"...\", \"confidence\": \"high\", \"modifiers\": []}]}" }
            ]
          }]
        })
      }).then(function(res) { return res.json(); }).then(function(apiResp) {
        var text = "";
        if (apiResp.content) {
          apiResp.content.forEach(function(item) { if (item.type === "text") text += item.text; });
        }
        text = text.replace(/```json|```/g, "").trim();
        try {
          var result = JSON.parse(text);
          if (result.date) setDate(result.date);
          if (result.patient) setPatientId(result.patient);
          if (result.codes && result.codes.length > 0) {
            var newProcs = [];
            result.codes.forEach(function(c) {
              var found = cptMap[c.code];
              if (found) {
                newProcs.push({ id: nextId.current++, code: c.code, search: "", mods: c.modifiers || [] });
              } else {
                newProcs.push({ id: nextId.current++, code: null, search: c.code + " " + c.description, mods: c.modifiers || [] });
              }
            });
            if (newProcs.length > 0) { setProcs(newProcs); setActiveProc(0); }
            setScanStatus("Found " + result.codes.length + " code(s)");
            setTimeout(function() { setScanStatus(""); }, 3000);
          } else {
            setScanStatus(""); setScanError("No codes identified in note");
          }
        } catch (e) {
          setScanStatus(""); setScanError("Could not parse AI response. Try a clearer image or PDF.");
        }
        scanning.current = false;
      }).catch(function(err) {
        setScanStatus(""); setScanError("Scan failed: " + err.message); scanning.current = false;
      });
    };
    reader.onerror = function() { setScanStatus(""); setScanError("Failed to read file"); scanning.current = false; };
    if (file.size > 30 * 1024 * 1024) { setScanStatus(""); setScanError("File too large (max 30MB)."); scanning.current = false; return; }
    reader.readAsDataURL(file);
    }); // end getDecryptedApiKey for scanClinicNote
  };

  var scanInpatient = function(file) {
    if (!file || scanning.current) return;
    getDecryptedApiKey(data.settings).then(function(apiKey) {
    if (!apiKey) { setScanError("No API key configured. Add one in Settings to enable scanning."); return; }
    scanning.current = true;
    var isPDF = file.type === "application/pdf" || (file.name && file.name.toLowerCase().endsWith(".pdf"));
    setScanStatus(isPDF ? "Reading PDF..." : "Reading image...");
    setScanError("");
    var reader = new FileReader();
    reader.onload = function(ev) {
      var base64 = ev.target.result.split(",")[1];
      var mediaType = isPDF ? "application/pdf" : (file.type || "image/jpeg");
      setScanStatus("Analyzing inpatient note...");
      var contentBlock = isPDF
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
        : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
      fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-api-key": apiKey, "anthropic-version": "2023-06-01", "anthropic-dangerous-direct-browser-access": "true" },
        body: JSON.stringify({
          model: "claude-sonnet-4-20250514",
          max_tokens: 2000,
          messages: [{
            role: "user",
            content: [
              contentBlock,
              { type: "text", text: "You are analyzing an INPATIENT hospital note (which may be a PDF or image) for a surgical RVU tracking app. This could be an H&P, progress note, consult note, discharge summary, or critical care note. The document may be multi-page - analyze ALL pages thoroughly.\n\nCRITICAL PRIVACY RULE: Do NOT include any Protected Health Information (PHI) in your response. Never return patient full names, MRNs, dates of birth, SSNs, addresses, phone numbers, or any other HIPAA identifiers. For patient field, generate only 2-letter initials (e.g. \"JD\"). For descriptions, use only generic procedure names.\n\nExtract:\n1. date: the note/service date in YYYY-MM-DD format\n2. patient: 2-letter initials ONLY derived from patient name. If you cannot determine, use empty string.\n3. codes: an array of objects, each with:\n   - code: the most likely CPT code (5-digit number)\n   - description: brief GENERIC description\n   - confidence: high/medium/low\n   - modifiers: array of applicable modifier codes\n\nINPATIENT E&M CODE GUIDE:\n- Initial hospital care (admission H&P): 99221 (straightforward/low MDM), 99222 (moderate MDM), 99223 (high MDM)\n- Subsequent hospital care (daily rounding): 99231 (straightforward/low), 99232 (moderate), 99233 (high)\n- Observation care: 99218 (straightforward/low), 99219 (moderate), 99220 (high)\n- Hospital discharge: 99238 (30 min or less), 99239 (more than 30 min)\n- Consult (inpatient): 99251 (straightforward), 99252 (low), 99253 (moderate), 99254 (high), 99255 (high complexity)\n- Critical care: 99291 (first 30-74 min), 99292 (each additional 30 min)\n\nMDM complexity factors: number of diagnoses, data reviewed, risk level.\n- Low: 2+ self-limited problems OR 1 stable chronic, limited data, low risk\n- Moderate: 1+ chronic illness with exacerbation OR undiagnosed new problem, moderate data, moderate risk (Rx management)\n- High: 1+ chronic illness with severe exacerbation OR acute life-threatening, extensive data, high risk (surgical decisions, ICU)\n\nAlso look for BEDSIDE PROCEDURES:\n- Central venous catheter: 36555-36558 (non-tunneled), 36560-36563 (tunneled)\n- Arterial line: 36620\n- Chest tube/thoracostomy: 32551\n- Paracentesis: 49083, Thoracentesis: 32554-32555\n- Lumbar puncture: 62270\n- Intubation: 31500\n- Tracheostomy: 31600-31601\n- Wound debridement: 97597-97598 or 11042-11047\n- If procedure + E&M on same day, include modifier 25 on the E&M code\n\nRespond ONLY with valid JSON, no markdown backticks or other text:\n{\"date\": \"YYYY-MM-DD\", \"patient\": \"XX\", \"codes\": [{\"code\": \"XXXXX\", \"description\": \"...\", \"confidence\": \"high\", \"modifiers\": []}]}" }
            ]
          }]
        })
      }).then(function(res) { return res.json(); }).then(function(apiResp) {
        var text = "";
        if (apiResp.content) {
          apiResp.content.forEach(function(item) { if (item.type === "text") text += item.text; });
        }
        text = text.replace(/```json|```/g, "").trim();
        try {
          var result = JSON.parse(text);
          if (result.date) setDate(result.date);
          if (result.patient) setPatientId(result.patient);
          if (result.codes && result.codes.length > 0) {
            var newProcs = [];
            result.codes.forEach(function(c) {
              var found = cptMap[c.code];
              if (found) {
                newProcs.push({ id: nextId.current++, code: c.code, search: "", mods: c.modifiers || [] });
              } else {
                newProcs.push({ id: nextId.current++, code: null, search: c.code + " " + c.description, mods: c.modifiers || [] });
              }
            });
            if (newProcs.length > 0) { setProcs(newProcs); setActiveProc(0); }
            setScanStatus("Found " + result.codes.length + " code(s)");
            setTimeout(function() { setScanStatus(""); }, 3000);
          } else {
            setScanStatus(""); setScanError("No codes identified in note");
          }
        } catch (e) {
          setScanStatus(""); setScanError("Could not parse AI response. Try a clearer image or PDF.");
        }
        scanning.current = false;
      }).catch(function(err) {
        setScanStatus(""); setScanError("Scan failed: " + err.message); scanning.current = false;
      });
    };
    reader.onerror = function() { setScanStatus(""); setScanError("Failed to read file"); scanning.current = false; };
    if (file.size > 30 * 1024 * 1024) { setScanStatus(""); setScanError("File too large (max 30MB)."); scanning.current = false; return; }
    reader.readAsDataURL(file);
    }); // end getDecryptedApiKey for scanInpatient
  };


  var save = function() {
    if (!canSave) return;
    var newEntries = [];
    procs.forEach(function(p) {
      if (!p.code) return;
      var info = cptMap[p.code];
      if (!info) return;
      var adj = calcAdj(info.wRVU, p.mods);
      newEntries.push({
        id: Date.now().toString() + "-" + p.id,
        date: date,
        cptCode: p.code,
        description: info.desc,
        category: info.category,
        baseRVU: info.wRVU,
        modifiers: p.mods.slice(),
        adjustedRVU: adj,
        notes: (patientId ? patientId + (notes ? " - " + notes : "") : notes),
        encounterId: patientId || undefined,
        isCall: isCall,
        imported: false
      });
    });
    upd(function(prev) { return { ...prev, entries: prev.entries.concat(newEntries) }; });
    var loggedRVU = newEntries.reduce(function(s, e) { return s + e.adjustedRVU; }, 0);
    showUndo({ type: "log", ids: newEntries.map(function(e) { return e.id; }), message: "Logged " + newEntries.length + " proc (" + loggedRVU.toFixed(1) + " wRVUs)" });
    setSaved(true);
    setTimeout(function() {
      setSaved(false);
      setProcs([{ id: nextId.current++, code: null, search: "", mods: [] }]);
      setActiveProc(0);
      setNotes("");
      setPatientId("");
      setIsCall(false);
    }, 1200);
  };

  return (<div style={S.page}>
    <div style={S.header}><h1 style={S.title}>Log Encounter</h1></div>
    {saved && <div style={S.successBanner}>Logged {procs.filter(function(p){return p.code;}).length} procedure(s) - {totalRVU.toFixed(2)} wRVUs</div>}

    {/* Scan Buttons */}
    {(function() { var hasKey = hasApiKey(data.settings); return (<div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input ref={imgRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={function(e) { if (e.target.files && e.target.files[0]) scanNote(e.target.files[0]); e.target.value = ""; }} />
        <input ref={clinicRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={function(e) { if (e.target.files && e.target.files[0]) scanClinicNote(e.target.files[0]); e.target.value = ""; }} />
        <input ref={inpatientRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={function(e) { if (e.target.files && e.target.files[0]) scanInpatient(e.target.files[0]); e.target.value = ""; }} />
        <button onClick={function() { if (!hasKey) { setScanError("No API key. Go to Settings to add one."); return; } if (hipaaAck) { imgRef.current && imgRef.current.click(); } else { pendingScanType.current = "opnote"; setShowHipaaWarn(true); } }} disabled={scanning.current} style={{ flex: 1, padding: "10px 6px", borderRadius: 12, border: hasKey ? "1px dashed #0ea5e9" : "1px dashed var(--border-default)", background: hasKey ? "rgba(14,165,233,0.05)" : "rgba(30,41,59,0.5)", color: hasKey ? "#0ea5e9" : "var(--text-faint)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
          <span style={{ fontSize: 18 }}>&#128247;</span>
          <div>Op Note</div>
        </button>
        <button onClick={function() { if (!hasKey) { setScanError("No API key. Go to Settings to add one."); return; } if (hipaaAck) { clinicRef.current && clinicRef.current.click(); } else { pendingScanType.current = "clinic"; setShowHipaaWarn(true); } }} disabled={scanning.current} style={{ flex: 1, padding: "10px 6px", borderRadius: 12, border: hasKey ? "1px dashed #10b981" : "1px dashed var(--border-default)", background: hasKey ? "rgba(16,185,129,0.05)" : "rgba(30,41,59,0.5)", color: hasKey ? "#10b981" : "var(--text-faint)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
          <span style={{ fontSize: 18 }}>&#128203;</span>
          <div>Clinic Note</div>
        </button>
        <button onClick={function() { if (!hasKey) { setScanError("No API key. Go to Settings to add one."); return; } if (hipaaAck) { inpatientRef.current && inpatientRef.current.click(); } else { pendingScanType.current = "inpatient"; setShowHipaaWarn(true); } }} disabled={scanning.current} style={{ flex: 1, padding: "10px 6px", borderRadius: 12, border: hasKey ? "1px dashed #a78bfa" : "1px dashed var(--border-default)", background: hasKey ? "rgba(139,92,246,0.05)" : "rgba(30,41,59,0.5)", color: hasKey ? "#a78bfa" : "var(--text-faint)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
          <span style={{ fontSize: 18 }}>&#127973;</span>
          <div>Inpatient Note</div>
        </button>
      </div>
      {!hasKey && <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-faint)", textAlign: "center" }}>Add an API key in Settings to enable AI scanning</div>}
    </div>); })()}

    {/* HIPAA Warning Modal */}
    {showHipaaWarn && <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "var(--overlay-bg)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ maxWidth: 400, width: "100%", background: "var(--bg-card)", borderRadius: 16, border: "1px solid #f59e0b", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", background: "rgba(245,158,11,0.1)", borderBottom: "1px solid rgba(245,158,11,0.2)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24 }}>&#9888;&#65039;</span>
          <div style={{ fontSize: 16, fontWeight: 700, color: "#f59e0b" }}>PHI / HIPAA Notice</div>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.6, marginBottom: 12 }}>
            This feature sends your image or PDF to Anthropic's API for analysis. If the file contains <span style={{ color: "#f59e0b", fontWeight: 600 }}>Protected Health Information (PHI)</span> such as patient names, MRNs, dates of birth, or other identifiers, that data will be transmitted to external servers.
          </div>
          <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.6, marginBottom: 12 }}>
            <span style={{ fontWeight: 600, color: "var(--text-bright)" }}>Safeguards in place:</span>
          </div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.7, marginBottom: 12, paddingLeft: 12 }}>
            {"\u2022"} The AI is instructed to return only CPT codes, dates, and generated initials - never patient names, MRNs, or other PHI{"\n"}
            {"\u2022"} Anthropic's API does not use inputs for model training by default{"\n"}
            {"\u2022"} No image or PDF data is stored in this app
          </div>
          <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.6, marginBottom: 16 }}>
            <span style={{ fontWeight: 600, color: "#f59e0b" }}>Recommendation:</span> When possible, crop or redact patient identifiers before scanning. Use at your own discretion as the treating provider.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={function() { setShowHipaaWarn(false); pendingScanType.current = null; }} style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "1px solid var(--border-default)", background: "var(--bg-inset)", color: "var(--text-muted)", fontSize: 14, cursor: "pointer" }}>Cancel</button>
            <button onClick={function() { setHipaaAck(true); setShowHipaaWarn(false); setTimeout(function() { if (pendingScanType.current === "opnote") { imgRef.current && imgRef.current.click(); } else if (pendingScanType.current === "clinic") { clinicRef.current && clinicRef.current.click(); } else if (pendingScanType.current === "inpatient") { inpatientRef.current && inpatientRef.current.click(); } pendingScanType.current = null; }, 100); }} style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "none", background: "#f59e0b", color: "#0f172a", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>I Understand</button>
          </div>
        </div>
      </div>
    </div>}

    {scanStatus && <div style={{ marginBottom: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(14,165,233,0.1)", color: "#0ea5e9", fontSize: 13, textAlign: "center" }}>{scanStatus}</div>}
    {scanError && <div style={{ marginBottom: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(239,68,68,0.1)", color: "#ef4444", fontSize: 13, textAlign: "center" }}>{scanError}</div>}


    <div style={{ display: "flex", gap: 8 }}>
      <div style={{ flex: 1 }}><div style={S.fieldGroup}><label style={S.fieldLabel}>Date</label><input type="date" value={date} onChange={function(e) { setDate(e.target.value); }} style={S.dateInput} /></div></div>
      <div style={{ flex: 1 }}><div style={S.fieldGroup}><label style={S.fieldLabel}>Patient ID</label><input type="text" value={patientId} onChange={function(e) { setPatientId(e.target.value); }} placeholder="Initials" style={S.searchInput} /></div></div>
    </div>

    {/* Call/Private toggle */}
    <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
      <button onClick={function() { setIsCall(false); }} style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: !isCall ? "2px solid #0ea5e9" : "1px solid var(--border-default)", background: !isCall ? "rgba(14,165,233,0.1)" : "var(--bg-card)", color: !isCall ? "#0ea5e9" : "var(--text-dim)", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <span style={{ width: 16, height: 16, borderRadius: 8, border: !isCall ? "2px solid #0ea5e9" : "2px solid #475569", display: "flex", alignItems: "center", justifyContent: "center" }}>{!isCall && <span style={{ width: 8, height: 8, borderRadius: 4, background: "#0ea5e9" }}></span>}</span>
        Private
      </button>
      <button onClick={function() { setIsCall(true); }} style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: isCall ? "2px solid #a78bfa" : "1px solid var(--border-default)", background: isCall ? "rgba(139,92,246,0.1)" : "var(--bg-card)", color: isCall ? "#a78bfa" : "var(--text-dim)", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <span style={{ width: 16, height: 16, borderRadius: 8, border: isCall ? "2px solid #a78bfa" : "2px solid #475569", display: "flex", alignItems: "center", justifyContent: "center" }}>{isCall && <span style={{ width: 8, height: 8, borderRadius: 4, background: "#a78bfa" }}></span>}</span>
        Call
      </button>
    </div>

    {/* Procedure tabs */}
    <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
      {procs.map(function(p, i) {
        var info = p.code ? cptMap[p.code] : null;
        var isActive = i === activeProc;
        return (<button key={p.id} onClick={function() { setActiveProc(i); }} style={{
          padding: "6px 12px", borderRadius: 8, border: isActive ? "2px solid #0ea5e9" : "1px solid var(--border-default)",
          background: isActive ? "rgba(14,165,233,0.1)" : "var(--bg-card)", color: isActive ? "#0ea5e9" : "var(--text-muted)",
          fontSize: 12, fontFamily: "JetBrains Mono", cursor: "pointer", fontWeight: isActive ? 700 : 400
        }}>
          {info ? info.code : "Proc " + (i + 1)}
          {procs.length > 1 && <span onClick={function(ev) { ev.stopPropagation(); removeProc(i); }} style={{ marginLeft: 6, color: "var(--text-dim)", fontSize: 10 }}>x</span>}
        </button>);
      })}
      <button onClick={addProc} style={{ padding: "6px 12px", borderRadius: 8, border: "1px dashed var(--border-default)", background: "transparent", color: "var(--text-dim)", fontSize: 12, cursor: "pointer" }}>+ Add</button>
    </div>

    {/* Search for active procedure */}
    <div style={S.fieldGroup}><label style={S.fieldLabel}>Search CPT Code or Procedure</label><input type="text" value={curSearch} onChange={function(e) { updateProc(activeProc, { search: e.target.value, code: null }); setShowFavs(false); }} placeholder="e.g. 47562, cholecystectomy, hernia..." style={S.searchInput} onFocus={function() { if (!curSearch.trim()) setShowFavs(true); }} /></div>
    <div style={S.catRow}><button onClick={function() { setCat("All"); setShowFavs(false); }} style={cat === "All" && !showFavs ? S.catBtnActive : S.catBtn}>All</button><button onClick={function() { setShowFavs(true); setCat("All"); updateProc(activeProc, { search: "", code: null }); }} style={showFavs ? { ...S.catBtnActive, color: "#fbbf24", borderColor: "rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.1)" } : { ...S.catBtn, color: "#fbbf24" }}>{"\u2605"} Favorites{favorites.length > 0 ? " (" + favorites.length + ")" : ""}</button>{categories.map(function(c) { return <button key={c} onClick={function() { setCat(c); setShowFavs(false); }} style={cat === c && !showFavs ? S.catBtnActive : S.catBtn}>{c}</button>; })}</div>

    {/* Favorites panel */}
    {!curSel && showFavs && !curSearch.trim() && <div style={S.resultsList}>
      {favCodes.length === 0 && mostUsed.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>{"\u2606"}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>No favorites yet</div>
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>Tap the {"\u2606"} star next to any CPT code to add it here for quick access.</div>
      </div>}
      {favCodes.length > 0 && <div style={{ padding: "4px 0 6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "#fbbf24", textTransform: "uppercase", letterSpacing: 1 }}>{"\u2605"} Favorites ({favCodes.length})</span>
      </div>}
      {favCodes.map(function(cpt, idx) {
        var count = usageCounts[cpt.code] || 0;
        var comp = (cpt.wRVU * data.settings.ratePerRVU);
        return (<button key={cpt.code} onClick={function() { selectCode(cpt); setShowFavs(false); }} style={{ ...S.resultItem, borderLeft: "3px solid rgba(251,191,36,0.4)", position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={S.resultCode}>{cpt.code}</span>
              {count > 0 && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "rgba(14,165,233,0.12)", color: "#38bdf8", fontFamily: "JetBrains Mono", fontWeight: 600 }}>{"x"}{count}</span>}
            </div>
            <div style={{ ...S.resultDesc, marginTop: 3 }}>{cpt.desc}</div>
            <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 4 }}>
              <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{cpt.category}</span>
            </div>
          </div>
          <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0, marginLeft: 8 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ textAlign: "right" }}>
                <span style={{ ...S.resultRVU, fontSize: 14 }}>{cpt.wRVU}</span>
                <span style={{ fontSize: 10, color: "var(--text-dim)" }}> wRVU</span>
              </div>
              <span onClick={function(ev) { ev.stopPropagation(); toggleFav(cpt.code); }} style={{ fontSize: 18, cursor: "pointer", color: "#fbbf24", lineHeight: 1 }}>{"\u2605"}</span>
            </div>
            <span style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "#10b981" }}>{"$"}{comp.toFixed(0)}</span>
            <div style={{ display: "flex", gap: 2 }}>
              {idx > 0 && <span onClick={function(ev) { ev.stopPropagation(); moveFav(cpt.code, -1); }} style={{ fontSize: 14, cursor: "pointer", color: "var(--text-faint)", padding: "0 4px", lineHeight: 1 }}>{"\u25B2"}</span>}
              {idx < favCodes.length - 1 && <span onClick={function(ev) { ev.stopPropagation(); moveFav(cpt.code, 1); }} style={{ fontSize: 14, cursor: "pointer", color: "var(--text-faint)", padding: "0 4px", lineHeight: 1 }}>{"\u25BC"}</span>}
            </div>
          </div>
        </div>
      </button>); })}
      {mostUsed.length > 0 && <>
        <div style={{ padding: "12px 0 6px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: favCodes.length > 0 ? "1px solid var(--border-default)" : "none", marginTop: favCodes.length > 0 ? 8 : 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "#0ea5e9", textTransform: "uppercase", letterSpacing: 1 }}>Most Used</span>
          <span style={{ fontSize: 10, color: "var(--text-faint)" }}>Based on your history</span>
        </div>
        {mostUsed.map(function(cpt) {
          var count = usageCounts[cpt.code] || 0;
          var comp = (cpt.wRVU * data.settings.ratePerRVU);
          return (<button key={cpt.code} onClick={function() { selectCode(cpt); setShowFavs(false); }} style={{ ...S.resultItem, borderLeft: "3px solid rgba(14,165,233,0.3)" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <span style={S.resultCode}>{cpt.code}</span>
                  <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "rgba(14,165,233,0.12)", color: "#38bdf8", fontFamily: "JetBrains Mono", fontWeight: 600 }}>{"x"}{count}</span>
                </div>
                <div style={{ ...S.resultDesc, marginTop: 3 }}>{cpt.desc}</div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>{cpt.category}</div>
              </div>
              <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 4, flexShrink: 0, marginLeft: 8 }}>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <div style={{ textAlign: "right" }}>
                    <span style={{ ...S.resultRVU, fontSize: 14 }}>{cpt.wRVU}</span>
                    <span style={{ fontSize: 10, color: "var(--text-dim)" }}> wRVU</span>
                  </div>
                  <span onClick={function(ev) { ev.stopPropagation(); toggleFav(cpt.code); }} style={{ fontSize: 18, cursor: "pointer", color: "var(--text-ghost)", lineHeight: 1 }}>{"\u2606"}</span>
                </div>
                <span style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "#10b981" }}>{"$"}{comp.toFixed(0)}</span>
              </div>
            </div>
          </button>);
        })}
      </>}
    </div>}

    {/* Search results */}
    {!curSel && (!showFavs || curSearch.trim()) && <div style={S.resultsList}>{filtered.slice(0, 20).map(function(cpt) {
      var count = usageCounts[cpt.code] || 0;
      var comp = (cpt.wRVU * data.settings.ratePerRVU);
      return (<button key={cpt.code} onClick={function() { selectCode(cpt); setShowFavs(false); }} style={S.resultItem}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span style={S.resultCode}>{cpt.code}</span>
            {count > 0 && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "rgba(14,165,233,0.12)", color: "#38bdf8", fontFamily: "JetBrains Mono", fontWeight: 600 }}>{"x"}{count}</span>}
          </div>
          <div style={{ ...S.resultDesc, marginTop: 3 }}>{cpt.desc}</div>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{cpt.category}</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0, marginLeft: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ textAlign: "right" }}>
              <span style={{ ...S.resultRVU, fontSize: 14 }}>{cpt.wRVU}</span>
              <span style={{ fontSize: 10, color: "var(--text-dim)" }}> wRVU</span>
            </div>
            <span onClick={function(ev) { ev.stopPropagation(); toggleFav(cpt.code); }} style={{ fontSize: 18, cursor: "pointer", color: isFav(cpt.code) ? "#fbbf24" : "var(--text-ghost)", lineHeight: 1 }}>{isFav(cpt.code) ? "\u2605" : "\u2606"}</span>
          </div>
          <span style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "#10b981" }}>{"$"}{comp.toFixed(0)}</span>
        </div>
      </div>
    </button>); })}{filtered.length === 0 && curSearch && <div style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>No matching CPT codes found</div>}</div>}

    {curSel && <><div style={S.selectedCard}><div style={{ display: "flex", justifyContent: "space-between" }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={S.selectedCode}>{curSel.code}</span><span onClick={function() { toggleFav(curSel.code); }} style={{ fontSize: 22, cursor: "pointer", color: isFav(curSel.code) ? "#fbbf24" : "var(--text-faint)", lineHeight: 1 }}>{isFav(curSel.code) ? "\u2605" : "\u2606"}</span>{usageCounts[curSel.code] > 0 && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: "rgba(14,165,233,0.12)", color: "#38bdf8", fontFamily: "JetBrains Mono", fontWeight: 600 }}>{"x"}{usageCounts[curSel.code]}</span>}</div><button onClick={clearCode} style={S.clearBtn}>x</button></div><div style={S.selectedDesc}>{curSel.desc}</div><div style={{ display: "flex", gap: 16, marginTop: 8 }}><div><div style={{ fontSize: 11, color: "var(--text-dim)" }}>Base wRVU</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 600 }}>{curSel.wRVU}</div></div>{curMods.length > 0 && <div><div style={{ fontSize: 11, color: "var(--text-dim)" }}>Adjusted</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "#0ea5e9", fontWeight: 600 }}>{calcProcRVU(cur).toFixed(2)}</div></div>}<div><div style={{ fontSize: 11, color: "var(--text-dim)" }}>Compensation</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "#10b981", fontWeight: 600 }}>${(calcProcRVU(cur) * data.settings.ratePerRVU).toFixed(0)}</div></div></div></div>
    <div style={S.fieldGroup}><label style={S.fieldLabel}>Modifiers</label><div style={S.modGrid}>{MODIFIERS.map(function(m) { return <button key={m.code} onClick={function() { toggleMod(m.code); }} style={curMods.includes(m.code) ? S.modBtnActive : S.modBtn}><span style={S.modCode}>{m.code}</span><span style={S.modLabel}>{m.label}</span><span style={S.modFactor}>{m.desc}</span></button>; })}</div></div></>}

    {/* Encounter summary */}
    {canSave && <div style={{ ...S.card, background: "linear-gradient(135deg, #1e293b, #0f172a)", border: isCall ? "1px solid rgba(139,92,246,0.3)" : "1px solid var(--border-default)", marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={S.cardLabel}>Encounter Summary</div>
        <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: isCall ? "rgba(139,92,246,0.15)" : "rgba(14,165,233,0.15)", color: isCall ? "#a78bfa" : "#0ea5e9", fontWeight: 600 }}>{isCall ? "Call" : "Private"}</span>
      </div>
      <div style={{ marginTop: 8 }}>{procs.filter(function(p){return p.code;}).map(function(p, i) {
        var info = cptMap[p.code];
        var adj = calcProcRVU(p);
        return (<div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: i < procs.filter(function(x){return x.code;}).length - 1 ? "1px solid rgba(51,65,85,0.5)" : "none" }}>
          <div><span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "#0ea5e9", fontWeight: 600 }}>{p.code}</span>{p.mods.map(function(m) { return <span key={m} style={{ fontSize: 10, color: "#fbbf24", marginLeft: 4 }}>{m}</span>; })}<div style={{ fontSize: 11, color: "var(--text-muted)" }}>{info ? info.desc : ""}</div></div>
          <div style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 600 }}>{adj.toFixed(2)}</div>
        </div>);
      })}</div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-default)" }}>
        <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>Total</span>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "var(--text-bright)", fontWeight: 700 }}>{totalRVU.toFixed(2)} wRVU</div>
          <div style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: "#10b981" }}>${totalComp.toFixed(0)}</div>
        </div>
      </div>
    </div>}

    <div style={S.fieldGroup}><label style={S.fieldLabel}>Case Notes (optional)</label><textarea value={notes} onChange={function(e) { setNotes(e.target.value); }} placeholder="Complexity, attending, indication, complications..." style={S.notesInput} rows={2} /></div>
    {canSave && <button onClick={save} style={{ ...S.saveBtn, background: isCall ? "linear-gradient(135deg, #8b5cf6, #7c3aed)" : "linear-gradient(135deg, #0ea5e9, #0284c7)" }}>Log {isCall ? "Call" : "Private"} Encounter - {totalRVU.toFixed(2)} wRVUs</button>}
  </div>);
}

// --- CMS PFS File Parser ---


