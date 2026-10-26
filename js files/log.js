// =======================================
// LOG PROCEDURE
// =======================================
function LogProc({ data, db, cptMap, categories, upd, setView, showUndo, openCallPay, logDraft, setLogBar }) {
  // An unsaved encounter survives switching tabs: App owns a MEMORY-ONLY
  // draft ref (never written to storage); these lazy initialisers read it and
  // the effect below keeps it current. Saving or emptying the form clears it.
  var dr = logDraft && logDraft.current;
  const [date, setDate] = useState(function() { return dr ? dr.date : todayLocal(); });
  const [patientId, setPatientId] = useState(function() { return dr ? dr.patientId : ""; });
  const [procs, setProcs] = useState(function() { return dr ? dr.procs : [{ id: 1, code: null, search: "", mods: [] }]; });
  const [notes, setNotes] = useState(function() { return dr ? dr.notes : ""; });
  const [saved, setSaved] = useState(false); // false, or the frozen "Logged ..." line the save bar shows in the 1.2s post-save window (truthiness reads only)
  const [activeProc, setActiveProc] = useState(function() { return dr ? dr.activeProc : 0; });
  const [cat, setCat] = useState("All");
  // Favorites show when the ACTIVE procedure is empty (as after addProc).
  const [showFavs, setShowFavs] = useState(function() { var ap = dr ? (dr.procs[dr.activeProc] || dr.procs[0]) : null; return !(ap && (ap.code || ap.search)); });
  const [isCall, setIsCall] = useState(function() { return dr ? dr.call : false; });
  // Call site pick (7b): "" (none yet), a site id, or CALL_SITE_OTHER. Only the
  // id is kept; the site is looked up again on every render and in save().
  const [callSite, setCallSite] = useState(function() { return dr && dr.call && typeof dr.callSite === "string" ? dr.callSite : ""; });
  const [creditOfferHidden, setCreditOfferHidden] = useState(false); // "Keep credit" (this Log visit)
  // Procedure templates: PRE-FILL only. applyTemplate composes the exact
  // state manual entry writes (selectCode / companion addSuggestion draft
  // shapes) and then STOPS - it never saves, never touches the save
  // guards, and never adds a second save path.
  const [tplNotice, setTplNotice] = useState(null); // { text, warn }
  const [tplSaving, setTplSaving] = useState(false);
  const [tplName, setTplName] = useState("");
  const [tplNote, setTplNote] = useState("");
  var scanning = useRef(false);
  var scanAbort = useRef(null);
  var [scanStatus, setScanStatus] = useState("");
  var [scanError, setScanError] = useState("");

  var cancelScan = function() {
    if (scanAbort.current) { try { scanAbort.current.abort(); } catch(e) {} scanAbort.current = null; }
    scanning.current = false;
    setScanStatus("");
    setScanError("Scan cancelled.");
    setTimeout(function() { setScanError(""); }, 3000);
  };

  var fetchWithTimeout = function(url, opts, timeoutMs) {
    var controller = new AbortController();
    scanAbort.current = controller;
    opts.signal = controller.signal;
    var timer = setTimeout(function() { controller.abort(); }, timeoutMs || 90000);
    return fetch(url, opts).then(function(res) {
      clearTimeout(timer);
      if (!res.ok) {
        return res.json().catch(function() { return { error: { message: "HTTP " + res.status + " " + res.statusText } }; }).then(function(body) {
          if (body.error) throw new Error(body.error.message || "HTTP " + res.status);
          throw new Error("HTTP " + res.status + " " + res.statusText);
        });
      }
      return res.json();
    }).catch(function(err) {
      clearTimeout(timer);
      if (err.name === "AbortError") throw new Error("Request timed out or was cancelled. Try a smaller/clearer image.");
      throw err;
    });
  };

  // Compress image if base64 exceeds ~4.5MB (API limit is 5MB)
  var MAX_IMG_B64 = 4.5 * 1024 * 1024; // 4.5MB in base64 chars (~3.3MB raw)
  var compressImage = function(dataURL, callback, statusFn) {
    var b64 = dataURL.split(",")[1];
    if (b64.length <= MAX_IMG_B64) {
      callback(b64, "image/jpeg");
      return;
    }
    if (statusFn) statusFn("Compressing image...");
    var img = new Image();
    img.onload = function() {
      var maxDim = 2048;
      var w = img.width, h = img.height;
      // Scale down if needed
      if (w > maxDim || h > maxDim) {
        var scale = maxDim / Math.max(w, h);
        w = Math.round(w * scale);
        h = Math.round(h * scale);
      }
      var canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      var ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      // Try quality levels until under limit
      var qualities = [0.85, 0.7, 0.5, 0.35, 0.2];
      for (var qi = 0; qi < qualities.length; qi++) {
        var compressed = canvas.toDataURL("image/jpeg", qualities[qi]);
        var compB64 = compressed.split(",")[1];
        if (compB64.length <= MAX_IMG_B64) {
          callback(compB64, "image/jpeg");
          return;
        }
      }
      // Last resort: scale down further
      var scale2 = 0.5;
      canvas.width = Math.round(w * scale2);
      canvas.height = Math.round(h * scale2);
      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
      var final64 = canvas.toDataURL("image/jpeg", 0.5).split(",")[1];
      callback(final64, "image/jpeg");
    };
    img.onerror = function() {
      // If image load fails, send original and let API error naturally
      callback(b64, "image/jpeg");
    };
    img.src = dataURL;
  };
  var imgRef = useRef(null);
  var clinicRef = useRef(null);
  var inpatientRef = useRef(null);
  var [hipaaAck, setHipaaAck] = useState(false);
  var [showHipaaWarn, setShowHipaaWarn] = useState(false);
  var [showModHelp, setShowModHelp] = useState(false);
  var pendingScanType = useRef(null);
  var nextId = useRef(dr && dr.nextId ? dr.nextId : 2);
  // Synchronous double-save lock: a fast double-tap fires both clicks before
  // React re-renders, so the `saved` state alone is a stale closure - the ref
  // is the real guard.
  var savingRef = useRef(false);
  var resetTimer = useRef(null); // the 1.2s post-save reset
  var afterSaveRef = useRef(false); // set by the post-save reset; the next case's first code dismisses the old Undo
  var mountedRef = useRef(true);
  // Leaving Log during the post-save window: cancel the reset and drop the
  // draft, so the encounter just saved can never come back pre-filled (a
  // duplicate-save / wrong-patient risk).
  useEffect(function() {
    mountedRef.current = true;
    return function() {
      mountedRef.current = false;
      if (resetTimer.current) { clearTimeout(resetTimer.current); resetTimer.current = null; if (logDraft) logDraft.current = null; }
    };
  }, []);
  // Keep App's memory-only draft current. Only real content (codes, a search,
  // initials, notes, the Call toggle) keeps a draft - a date on its own does
  // NOT, so a stale date can never carry into a later case after a save.
  // Skipped while a save is pending (save() already cleared the draft).
  useEffect(function() {
    if (!logDraft || savingRef.current) return;
    var empty = !procs.some(function(p) { return p.code || p.search; }) && !notes && !patientId && !isCall;
    logDraft.current = empty ? null : { date: date, patientId: patientId, procs: procs, notes: notes, activeProc: activeProc, call: isCall, callSite: callSite, nextId: nextId.current };
  }, [date, patientId, procs, notes, activeProc, isCall, callSite]);

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
      var q = curSearch.trim();
      // Same matches, ranked: exact code, code prefix, your most-used codes,
      // favorites, then CPT order (utils.js rankCPTMatches).
      items = rankCPTMatches(items.filter(function(c) { return matchesCPTQuery(c, q); }), q, usageCounts, favorites);
    }
    return items;
    // `favorites` is deliberately NOT a dependency: starring a row in the
    // results must not re-rank the list under the user's finger (the next
    // tap would land on a neighbouring code). New favorites apply the next
    // time the search, category or database changes.
  }, [curSearch, cat, db, usageCounts]);

  var updateProc = function(idx, updates) {
    setProcs(function(prev) {
      return prev.map(function(p, i) { return i === idx ? Object.assign({}, p, updates) : p; });
    });
  };

  var selectCode = function(cpt) {
    updateProc(activeProc, { code: cpt.code, search: cpt.code + " - " + (cpt.friendly || cpt.desc) });
  };

  // Picking a code or typing hides the favorites list (setShowFavs(false));
  // every way back to an empty draft must bring it back, or the next case
  // starts on the first 20 codes in CMS order instead of the user's favorites.
  var showFavList = function() { setShowFavs(true); setCat("All"); };

  var clearCode = function() {
    updateProc(activeProc, { code: null, search: "", mods: [] });
    showFavList();
  };

  var toggleMod = function(mc) {
    var newMods = curMods.includes(mc) ? curMods.filter(function(m) { return m !== mc; }) : curMods.concat([mc]);
    updateProc(activeProc, { mods: newMods });
  };

  var addProc = function() {
    var newP = { id: nextId.current++, code: null, search: "", mods: [] };
    setProcs(function(prev) { return prev.concat([newP]); });
    setActiveProc(procs.length);
    showFavList();
  };

  // Apply a template: resolve codes against the CURRENT db (correct across
  // yearly CPT updates), fill the first empty draft, append the rest as new
  // drafts - the identical shapes selectCode and the companion-chip
  // addSuggestion write, same nextId counter. Codes missing from the db are
  // listed in a visible notice; known ones still apply; nothing is zeroed.
  // Duplicates are applied literally (visible in the Encounter Summary
  // before save, exactly like manual double-entry). Default note fills only
  // an empty note field. Then it STOPS - save and its guards are untouched.
  var applyTemplate = function(tpl) {
    var known = [];
    var missing = [];
    tpl.codes.forEach(function(code) {
      var info = cptMap[code];
      if (info) known.push(info); else missing.push(code);
    });
    if (known.length > 0) {
      var next = procs.slice();
      var lastIdx = activeProc;
      known.forEach(function(info) {
        var draft = { code: info.code, search: info.code + " - " + (info.friendly || info.desc), mods: [] };
        var emptyIdx = -1;
        for (var i = 0; i < next.length; i++) { if (!next[i].code) { emptyIdx = i; break; } }
        if (emptyIdx !== -1) { next[emptyIdx] = Object.assign({}, next[emptyIdx], draft); lastIdx = emptyIdx; }
        else { next = next.concat([Object.assign({ id: nextId.current++ }, draft)]); lastIdx = next.length - 1; }
      });
      setProcs(next);
      setActiveProc(lastIdx);
      setShowFavs(false);
    }
    if (tpl.note && !notes.trim()) setNotes(tpl.note);
    if (missing.length > 0) {
      setTplNotice({ warn: true, text: '"' + tpl.name + '": ' + known.length + " code" + (known.length === 1 ? "" : "s") + " added. Not in the current database, skipped: " + missing.join(", ") });
    } else if (known.length > 0) {
      setTplNotice(null);
    } else {
      setTplNotice({ warn: true, text: '"' + tpl.name + '": none of its codes are in the current database - nothing added.' });
    }
  };

  var openTplForm = function() {
    setTplName("");
    setTplNote(notes); // VISIBLE prefill - edit or clear before saving
    setTplSaving(true);
  };
  var saveTemplate = function() {
    var name = tplName.trim();
    var codes = procs.filter(function(p) { return p.code; }).map(function(p) { return p.code; });
    if (!name || codes.length === 0) return;
    var t = { id: "tpl-" + Date.now().toString(36) + "-" + Math.random().toString(36).slice(2, 6), name: name, codes: codes };
    var dn = tplNote.trim();
    if (dn) t.note = dn;
    upd(function(prev) { return { ...prev, templates: (prev.templates || []).concat([t]) }; });
    setTplSaving(false);
    setTplNotice({ warn: false, text: 'Template "' + name + '" saved (' + codes.length + " code" + (codes.length === 1 ? "" : "s") + ")." });
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
  var canSave = procs.some(function(p) { return p.code; });
  // Call site + credit (7b). Credit comes from the SAME writer save() uses
  // (utils.js entryWithCall), run on a preview: every procedure of the
  // encounter shares its date and site, so one preview decides them all.
  var callSites = data.paySites || [];
  var pickedSite = isCall ? paySiteById(callSites, callSite) : null;
  var siteGone = isCall && callSite !== "" && callSite !== CALL_SITE_OTHER && !pickedSite;
  var needSite = isCall && callSites.length > 0 && !pickedSite && callSite !== CALL_SITE_OTHER;
  var encPreview = function(v) { return entryWithCall({ date: date, adjustedRVU: v }, null, isCall, callSite, callSites, true); };
  var pvAll = encPreview(totalRVU);
  var ncNow = isNoCredit(pvAll), credRVU = creditedRVU(pvAll), ncRVUNow = noCreditRVU(pvAll);
  var totalComp = credRVU * data.settings.ratePerRVU;
  var saveReady = isYMD(date) && !needSite;
  // Sticky save bar (end of render). PINNED once the active procedure has a
  // code, and through the post-save window; while a code is being picked
  // (+ Add list) it sits in flow at the page end so it never covers list rows.
  // While pinned, App lifts the undo toast above it (app.js) so Undo never
  // sits on Save; otherwise the toast keeps its old spot (bottom 64).
  var barPinned = !!(saved || (canSave && curSel));
  useEffect(function() {
    if (setLogBar) setLogBar(barPinned);
    return function() { if (setLogBar) setLogBar(false); };
  }, [barPinned]);
  // After a save, the NEXT case's first code dismisses the previous case's
  // Undo (Call Pay precedent, callpay.js openNew/openEdit): an Undo left up
  // would float over the next case's controls. History can still delete it.
  useEffect(function() {
    if (canSave && afterSaveRef.current) { afterSaveRef.current = false; if (showUndo) showUndo(null); }
  }, [canSave]);
  var creditOffer = pickedSite && callNoCreditDate(date) ? (payCreditOffers(callSites).filter(function(o) { return o.site.id === pickedSite.id; })[0] || null) : null;
  var applySiteRule = function() {
    if (!creditOffer || !confirm(payCreditConfirm([creditOffer]))) return;
    var id = creditOffer.site.id;
    upd(function(prev) { return { ...prev, paySites: payApplyNoCredit(prev.paySites || [], [id]) }; });
  };

  // --- Robust JSON extraction from AI responses ---
  var extractJSON = function(raw) {
    // Strip markdown fences
    var text = raw.replace(/```json\s*/gi, "").replace(/```\s*/g, "").trim();
    // Try direct parse first
    try { return JSON.parse(text); } catch(e) {}
    // Find first { and last } to extract JSON object
    var start = text.indexOf("{");
    var end = text.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try { return JSON.parse(text.substring(start, end + 1)); } catch(e2) {}
    }
    // Find first [ and last ] for array responses
    var aStart = text.indexOf("[");
    var aEnd = text.lastIndexOf("]");
    if (aStart !== -1 && aEnd > aStart) {
      try { return { codes: JSON.parse(text.substring(aStart, aEnd + 1)) }; } catch(e3) {}
    }
    return null;
  };

  // PHI rule: the scanned patient field must never store more than 2-letter
  // initials, even if the model returns a fuller name.
  var sanitizeInitials = function(v) {
    if (!v) return "";
    var words = String(v).trim().split(/\s+/).filter(function(w) { return /[A-Za-z]/.test(w); });
    var init = "";
    if (words.length >= 2) {
      init = words[0].replace(/[^A-Za-z]/g, "").charAt(0) + words[1].replace(/[^A-Za-z]/g, "").charAt(0);
    } else {
      init = String(v).replace(/[^A-Za-z]/g, "").substring(0, 2);
    }
    return init.toUpperCase();
  };

  var handleScanResponse = function(apiResp, label) {
    // Check for API errors first
    if (apiResp.error) {
      setScanStatus(""); setScanError("API error: " + (apiResp.error.message || "Unknown error")); scanning.current = false;
      return;
    }
    var text = "";
    if (apiResp.content) {
      apiResp.content.forEach(function(item) { if (item.type === "text") text += item.text; });
    }
    if (!text) {
      setScanStatus(""); setScanError("Empty response from AI. Try again."); scanning.current = false;
      return;
    }
    var result = extractJSON(text);
    if (!result) {
      // PHI rule: never log response CONTENT - an unparseable response is exactly
      // the case where the model may have echoed note text. Metadata only.
      console.warn("Scan parse failed. Response length: " + text.length + " chars; contains '{': " + (text.indexOf("{") !== -1) + "; contains '[': " + (text.indexOf("[") !== -1));
      setScanStatus(""); setScanError("Could not parse AI response. Try a clearer image or PDF."); scanning.current = false;
      return;
    }
    if (result.date) setDate(result.date);
    if (result.patient) setPatientId(sanitizeInitials(result.patient));
    if (result.codes && result.codes.length > 0) {
      var newProcs = [];
      result.codes.forEach(function(c) {
        var found = cptMap[c.code];
        if (found) {
          newProcs.push({ id: nextId.current++, code: c.code, search: "", mods: c.modifiers || [] });
        } else {
          newProcs.push({ id: nextId.current++, code: null, search: c.code + " " + (c.description || ""), mods: c.modifiers || [] });
        }
      });
      if (newProcs.length > 0) { setProcs(newProcs); setActiveProc(0); }
      setScanStatus("Found " + result.codes.length + " " + label);
      setTimeout(function() { setScanStatus(""); }, 3000);
    } else {
      setScanStatus(""); setScanError("No codes identified in note");
    }
    scanning.current = false;
  };

  var scanNote = function(file) {
    if (!SCAN_ENABLED) return; // feature flag: no PHI leaves the browser when off
    if (!file || scanning.current) return;
    getDecryptedApiKey(data.settings).then(function(apiKey) {
    if (!apiKey) { setScanError("No API key configured. Add one in Settings to enable scanning."); return; }
    scanning.current = true;
    var isPDF = file.type === "application/pdf" || (file.name && file.name.toLowerCase().endsWith(".pdf"));
    setScanStatus(isPDF ? "Reading PDF..." : "Reading image...");
    setScanError("");
    var reader = new FileReader();
    reader.onload = function(ev) {
      var sendToAPI = function(base64, mediaType) {
        setScanStatus("Analyzing operative note...");
        var contentBlock = isPDF
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
          : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
      fetchWithTimeout("https://api.anthropic.com/v1/messages", {
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
      }, 90000).then(function(apiResp) {
        handleScanResponse(apiResp, "procedure(s)");
      }).catch(function(err) {
        setScanStatus("");
        setScanError("Scan failed: " + err.message);
        scanning.current = false;
      });
      }; // end sendToAPI
      if (isPDF) {
        sendToAPI(ev.target.result.split(",")[1], "application/pdf");
      } else {
        compressImage(ev.target.result, sendToAPI, setScanStatus);
      }
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
    if (!SCAN_ENABLED) return; // feature flag: no PHI leaves the browser when off
    if (!file || scanning.current) return;
    getDecryptedApiKey(data.settings).then(function(apiKey) {
    if (!apiKey) { setScanError("No API key configured. Add one in Settings to enable scanning."); return; }
    scanning.current = true;
    var isPDF = file.type === "application/pdf" || (file.name && file.name.toLowerCase().endsWith(".pdf"));
    setScanStatus(isPDF ? "Reading PDF..." : "Reading image...");
    setScanError("");
    var reader = new FileReader();
    reader.onload = function(ev) {
      var sendToAPI = function(base64, mediaType) {
        setScanStatus("Analyzing clinic note...");
        var contentBlock = isPDF
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
          : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
      fetchWithTimeout("https://api.anthropic.com/v1/messages", {
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
      }, 90000).then(function(apiResp) {
        handleScanResponse(apiResp, "code(s)");
      }).catch(function(err) {
        setScanStatus(""); setScanError("Scan failed: " + err.message); scanning.current = false;
      });
      }; // end sendToAPI
      if (isPDF) {
        sendToAPI(ev.target.result.split(",")[1], "application/pdf");
      } else {
        compressImage(ev.target.result, sendToAPI, setScanStatus);
      }
    };
    reader.onerror = function() { setScanStatus(""); setScanError("Failed to read file"); scanning.current = false; };
    if (file.size > 30 * 1024 * 1024) { setScanStatus(""); setScanError("File too large (max 30MB)."); scanning.current = false; return; }
    reader.readAsDataURL(file);
    }); // end getDecryptedApiKey for scanClinicNote
  };

  var scanInpatient = function(file) {
    if (!SCAN_ENABLED) return; // feature flag: no PHI leaves the browser when off
    if (!file || scanning.current) return;
    getDecryptedApiKey(data.settings).then(function(apiKey) {
    if (!apiKey) { setScanError("No API key configured. Add one in Settings to enable scanning."); return; }
    scanning.current = true;
    var isPDF = file.type === "application/pdf" || (file.name && file.name.toLowerCase().endsWith(".pdf"));
    setScanStatus(isPDF ? "Reading PDF..." : "Reading image...");
    setScanError("");
    var reader = new FileReader();
    reader.onload = function(ev) {
      var sendToAPI = function(base64, mediaType) {
        setScanStatus("Analyzing inpatient note...");
        var contentBlock = isPDF
          ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: base64 } }
          : { type: "image", source: { type: "base64", media_type: mediaType, data: base64 } };
      fetchWithTimeout("https://api.anthropic.com/v1/messages", {
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
      }, 90000).then(function(apiResp) {
        handleScanResponse(apiResp, "code(s)");
      }).catch(function(err) {
        setScanStatus(""); setScanError("Scan failed: " + err.message); scanning.current = false;
      });
      }; // end sendToAPI
      if (isPDF) {
        sendToAPI(ev.target.result.split(",")[1], "application/pdf");
      } else {
        compressImage(ev.target.result, sendToAPI, setScanStatus);
      }
    };
    reader.onerror = function() { setScanStatus(""); setScanError("Failed to read file"); scanning.current = false; };
    if (file.size > 30 * 1024 * 1024) { setScanStatus(""); setScanError("File too large (max 30MB)."); scanning.current = false; return; }
    reader.readAsDataURL(file);
    }); // end getDecryptedApiKey for scanInpatient
  };


  var save = function() {
    if (!canSave || !saveReady || saved || savingRef.current) return;
    savingRef.current = true;
    if (logDraft) logDraft.current = null; // the saved encounter is no longer a draft
    var newEntries = [];
    procs.forEach(function(p) {
      if (!p.code) return;
      var info = cptMap[p.code];
      if (!info) return;
      var adj = calcAdj(info.wRVU, p.mods);
      // Call fields (site + credit) go through utils.js entryWithCall
      // (check.js G8); a new case always derives its credit.
      newEntries.push(entryWithCall({
        id: Date.now().toString() + "-" + p.id + "-" + Math.random().toString(36).slice(2, 8),
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
      }, null, isCall, callSite, callSites, true));
    });
    upd(function(prev) { return { ...prev, entries: prev.entries.concat(newEntries) }; });
    var loggedRVU = newEntries.reduce(function(s, e) { return s + creditedRVU(e); }, 0);
    var loggedNC = newEntries.reduce(function(s, e) { return s + noCreditRVU(e); }, 0);
    var allNC = newEntries.length > 0 && newEntries.every(isNoCredit);
    showUndo({ type: "log", ids: newEntries.map(function(e) { return e.id; }), message: "Logged " + newEntries.length + " proc" + (pickedSite ? " at " + pickedSite.name : "") +
      (allNC ? " - no credit (" + loggedNC.toFixed(1) + " wRVU)" : " (" + loggedRVU.toFixed(1) + " wRVUs)") });
    // The bar's confirmation comes from the entries actually written, not the
    // live preview, so an edit during the 1.2s window cannot change it.
    setSaved("Logged " + newEntries.length + " code" + (newEntries.length === 1 ? "" : "s") + " \u00B7 " + (allNC ? "no credit (" + loggedNC.toFixed(2) + " wRVU)" : loggedRVU.toFixed(2) + " wRVU"));
    resetTimer.current = setTimeout(function() {
      resetTimer.current = null;
      savingRef.current = false;
      setSaved(false);
      // Armed only now: a code changed inside the saved window is still the
      // case just saved, so it must not dismiss that case's Undo.
      afterSaveRef.current = true;
      setProcs([{ id: nextId.current++, code: null, search: "", mods: [] }]);
      setActiveProc(0);
      setNotes("");
      // A "Save as template" form left open must not carry this case's note
      // into the next case (it closed only by its own buttons before).
      setTplSaving(false);
      setTplName("");
      setTplNote("");
      setPatientId("");
      setIsCall(false);
      setCallSite("");
      showFavList();
      // Next case starts at the top of the screen (the scroll container is
      // App's .rvu-content).
      var sc = mountedRef.current ? document.querySelector(".rvu-content") : null;
      if (sc) sc.scrollTop = 0;
    }, 1200);
  };

  return (<div style={S.page}>
    <div style={{ ...S.header, display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <h1 style={S.title}>Log Encounter</h1>
      {openCallPay && <button onClick={function() { openCallPay("log"); }} style={{ minHeight: 44, padding: "0 12px", borderRadius: 8, border: "1px solid rgba(14,165,233,0.3)", background: "rgba(14,165,233,0.06)", color: "var(--accent-sky)", fontSize: 13, fontWeight: 600, cursor: "pointer", flexShrink: 0 }}>Call pay</button>}
    </div>

    {/* Scan Buttons (feature-flagged: hidden entirely when SCAN_ENABLED is false) */}
    {SCAN_ENABLED && (function() { var hasKey = hasApiKey(data.settings); return (<div style={{ marginBottom: 12 }}>
      <div style={{ display: "flex", gap: 6 }}>
        <input ref={imgRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={function(e) { if (e.target.files && e.target.files[0]) scanNote(e.target.files[0]); e.target.value = ""; }} />
        <input ref={clinicRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={function(e) { if (e.target.files && e.target.files[0]) scanClinicNote(e.target.files[0]); e.target.value = ""; }} />
        <input ref={inpatientRef} type="file" accept="image/*,application/pdf" style={{ display: "none" }} onChange={function(e) { if (e.target.files && e.target.files[0]) scanInpatient(e.target.files[0]); e.target.value = ""; }} />
        <button onClick={function() { if (!hasKey) { setScanError("No API key. Go to Settings to add one."); return; } if (hipaaAck) { imgRef.current && imgRef.current.click(); } else { pendingScanType.current = "opnote"; setShowHipaaWarn(true); } }} disabled={scanning.current} style={{ flex: 1, padding: "10px 6px", borderRadius: 12, border: hasKey ? "1px dashed #0ea5e9" : "1px dashed var(--border-default)", background: hasKey ? "rgba(14,165,233,0.05)" : "rgba(30,41,59,0.5)", color: hasKey ? "var(--accent-sky)" : "var(--text-faint)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
          <span style={{ fontSize: 18 }}>&#128247;</span>
          <div>Op Note</div>
        </button>
        <button onClick={function() { if (!hasKey) { setScanError("No API key. Go to Settings to add one."); return; } if (hipaaAck) { clinicRef.current && clinicRef.current.click(); } else { pendingScanType.current = "clinic"; setShowHipaaWarn(true); } }} disabled={scanning.current} style={{ flex: 1, padding: "10px 6px", borderRadius: 12, border: hasKey ? "1px dashed #10b981" : "1px dashed var(--border-default)", background: hasKey ? "rgba(16,185,129,0.05)" : "rgba(30,41,59,0.5)", color: hasKey ? "var(--accent-green)" : "var(--text-faint)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
          <span style={{ fontSize: 18 }}>&#128203;</span>
          <div>Clinic Note</div>
        </button>
        <button onClick={function() { if (!hasKey) { setScanError("No API key. Go to Settings to add one."); return; } if (hipaaAck) { inpatientRef.current && inpatientRef.current.click(); } else { pendingScanType.current = "inpatient"; setShowHipaaWarn(true); } }} disabled={scanning.current} style={{ flex: 1, padding: "10px 6px", borderRadius: 12, border: hasKey ? "1px dashed #a78bfa" : "1px dashed var(--border-default)", background: hasKey ? "rgba(139,92,246,0.05)" : "rgba(30,41,59,0.5)", color: hasKey ? "var(--accent-violet)" : "var(--text-faint)", fontSize: 12, fontWeight: 600, cursor: "pointer", display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 2 }}>
          <span style={{ fontSize: 18 }}>&#127973;</span>
          <div>Inpatient Note</div>
        </button>
      </div>
      {!hasKey && <div style={{ marginTop: 6, fontSize: 11, color: "var(--text-faint)", textAlign: "center" }}>Add an API key in Settings to enable AI scanning</div>}
    </div>); })()}

    {/* HIPAA Warning Modal (scan-consent only; suppressed when scanning is off) */}
    {SCAN_ENABLED && showHipaaWarn && <div style={{ position: "fixed", top: 0, left: 0, right: 0, bottom: 0, background: "var(--overlay-bg)", zIndex: 9999, display: "flex", alignItems: "center", justifyContent: "center", padding: 20 }}>
      <div style={{ maxWidth: 400, width: "100%", background: "var(--bg-card)", borderRadius: 16, border: "1px solid #f59e0b", overflow: "hidden" }}>
        <div style={{ padding: "16px 20px", background: "rgba(245,158,11,0.1)", borderBottom: "1px solid rgba(245,158,11,0.2)", display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ fontSize: 24 }}>&#9888;&#65039;</span>
          <div style={{ fontSize: 16, fontWeight: 700, color: "var(--accent-amber)" }}>PHI / HIPAA Notice</div>
        </div>
        <div style={{ padding: "16px 20px" }}>
          <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.6, marginBottom: 12 }}>
            This feature sends your image or PDF to Anthropic's API for analysis. If the file contains <span style={{ color: "var(--accent-amber)", fontWeight: 600 }}>Protected Health Information (PHI)</span> such as patient names, MRNs, dates of birth, or other identifiers, that data will be transmitted to external servers.
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
            <span style={{ fontWeight: 600, color: "var(--accent-amber)" }}>Recommendation:</span> When possible, crop or redact patient identifiers before scanning. Use at your own discretion as the treating provider.
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={function() { setShowHipaaWarn(false); pendingScanType.current = null; }} style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "1px solid var(--border-default)", background: "var(--bg-inset)", color: "var(--text-muted)", fontSize: 14, cursor: "pointer" }}>Cancel</button>
            <button onClick={function() { setHipaaAck(true); setShowHipaaWarn(false); setTimeout(function() { if (pendingScanType.current === "opnote") { imgRef.current && imgRef.current.click(); } else if (pendingScanType.current === "clinic") { clinicRef.current && clinicRef.current.click(); } else if (pendingScanType.current === "inpatient") { inpatientRef.current && inpatientRef.current.click(); } pendingScanType.current = null; }, 100); }} style={{ flex: 1, padding: "12px 16px", borderRadius: 10, border: "none", background: "#f59e0b", color: "#0f172a", fontSize: 14, fontWeight: 700, cursor: "pointer" }}>I Understand</button>
          </div>
        </div>
      </div>
    </div>}

    {scanStatus && <div style={{ marginBottom: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(14,165,233,0.1)", color: "var(--accent-sky)", fontSize: 13, textAlign: "center", display: "flex", alignItems: "center", justifyContent: "center", gap: 10 }}>
      <span style={{ animation: "rvuPulse 1.5s ease-in-out infinite" }}>{scanStatus}</span>
      <button onClick={cancelScan} style={{ padding: "3px 10px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.4)", background: "rgba(239,68,68,0.1)", color: "var(--accent-red-soft)", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Cancel</button>
    </div>}
    {scanError && <div style={{ marginBottom: 8, padding: "8px 12px", borderRadius: 8, background: "rgba(239,68,68,0.1)", color: "var(--accent-red)", fontSize: 13, textAlign: "center" }}>{scanError}</div>}


    <div style={{ display: "flex", gap: 8 }}>
      <div style={{ flex: 1 }}><div style={S.fieldGroup}><label style={S.fieldLabel}>Date</label><input type="date" value={date} onChange={function(e) { setDate(e.target.value); }} style={S.dateInput} />
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          {[["Today", todayLocal()], ["Yesterday", addDaysYMD(todayLocal(), -1)]].map(function(c) {
            var on = date === c[1];
            // The date is computed when TAPPED (not at render) so the chip is
            // right after midnight even if the screen has not re-rendered.
            return (<button key={c[0]} onClick={function() { setDate(c[0] === "Today" ? todayLocal() : addDaysYMD(todayLocal(), -1)); }} style={{ flex: 1, minHeight: 40, borderRadius: 8, border: on ? "1px solid rgba(14,165,233,0.6)" : "1px solid var(--border-default)", background: on ? "rgba(14,165,233,0.15)" : "transparent", color: on ? "var(--accent-sky)" : "var(--text-muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{c[0]}</button>);
          })}
        </div>
      </div></div>
      <div style={{ flex: 1 }}><div style={S.fieldGroup}><label style={S.fieldLabel}>Patient ID</label><input type="text" value={patientId} onChange={function(e) { setPatientId(e.target.value); }} placeholder="Initials" style={S.searchInput} /></div></div>
    </div>

    {/* Call/Private toggle */}
    <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
      <button onClick={function() { setIsCall(false); setCallSite(""); }} style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: !isCall ? "2px solid #0ea5e9" : "1px solid var(--border-default)", background: !isCall ? "rgba(14,165,233,0.1)" : "var(--bg-card)", color: !isCall ? "var(--accent-sky)" : "var(--text-dim)", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <span style={{ width: 16, height: 16, borderRadius: 8, border: !isCall ? "2px solid var(--accent-sky)" : "2px solid var(--text-faint)", display: "flex", alignItems: "center", justifyContent: "center" }}>{!isCall && <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--accent-sky)" }}></span>}</span>
        Private
      </button>
      <button onClick={function() { setIsCall(true); }} style={{ flex: 1, padding: "10px 12px", borderRadius: 10, border: isCall ? "2px solid #a78bfa" : "1px solid var(--border-default)", background: isCall ? "rgba(139,92,246,0.1)" : "var(--bg-card)", color: isCall ? "var(--accent-violet)" : "var(--text-dim)", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center", gap: 6 }}>
        <span style={{ width: 16, height: 16, borderRadius: 8, border: isCall ? "2px solid var(--accent-violet)" : "2px solid var(--text-faint)", display: "flex", alignItems: "center", justifyContent: "center" }}>{isCall && <span style={{ width: 8, height: 8, borderRadius: 4, background: "var(--accent-violet)" }}></span>}</span>
        Call
      </button>
    </div>
    {isCall && callSites.length > 0 && <div style={{ marginBottom: 10 }}>
      <div style={{ fontSize: 11, color: needSite ? "var(--accent-amber)" : "var(--text-muted)", marginBottom: 6 }}>{needSite ? "Pick the call site" : "Call site"}</div>
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {callSites.map(function(s) { return { key: s.id, on: !!pickedSite && pickedSite.id === s.id, label: s.name, note: paySiteCreditNote(s, date), pick: s.id }; })
          .concat([{ key: "other", on: callSite === CALL_SITE_OTHER, label: "Other site", note: "", pick: CALL_SITE_OTHER }])
          .map(function(c) {
            return (<button key={c.key} onClick={function() { setCallSite(c.pick); }} style={{ flex: "1 1 120px", minHeight: 44, padding: "6px 10px", borderRadius: 10, border: c.on ? "2px solid #a78bfa" : "1px solid var(--border-default)", background: c.on ? "rgba(139,92,246,0.1)" : "var(--bg-card)", color: c.on ? "var(--accent-violet)" : "var(--text-dim)", fontSize: 13, fontWeight: 600, cursor: "pointer", textAlign: "left" }}>{c.label}{c.note ? <span style={{ fontWeight: 400, fontSize: 11 }}>{" - " + c.note}</span> : null}</button>);
          })}
      </div>
      {siteGone && <div style={{ fontSize: 11, color: "var(--accent-amber)", marginTop: 6 }}>That site was removed - pick again.</div>}
      {creditOffer && !creditOfferHidden && <div style={{ marginTop: 8, padding: "8px 10px", borderRadius: 8, border: "1px solid rgba(245,158,11,0.3)", background: "rgba(245,158,11,0.06)" }}>
        <div style={{ fontSize: 11, color: "var(--text-primary)", lineHeight: 1.5 }}>{"The built-in " + creditOffer.def.name + " rule gives call cases from " + fmt(CALL_NO_CREDIT_FROM) + " no wRVU credit; " + pickedSite.name + " still credits them."}</div>
        <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
          <button onClick={applySiteRule} style={{ flex: 1, minHeight: 44, borderRadius: 8, border: "none", background: "#f59e0b", color: "#0f172a", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>{"No credit for " + pickedSite.name}</button>
          <button onClick={function() { setCreditOfferHidden(true); }} style={{ minHeight: 44, padding: "0 12px", borderRadius: 8, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 12, cursor: "pointer" }}>Keep credit</button>
        </div>
      </div>}
    </div>}

    {/* Template chips - one-tap pre-fill of the selection below. 44pt min
        touch height; green lane (favorites own amber, companions blue/violet). */}
    {(data.templates || []).length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 8 }}>
      {(data.templates || []).map(function(t) {
        return (<button key={t.id} onClick={function() { applyTemplate(t); }} style={{
          minHeight: 44, padding: "6px 12px", borderRadius: 10, cursor: "pointer",
          border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.06)",
          display: "flex", flexDirection: "column", alignItems: "flex-start", justifyContent: "center", gap: 1
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-green-soft)" }}>{t.name}</span>
          <span style={{ fontSize: 9, fontFamily: "JetBrains Mono", color: "var(--text-dim)" }}>{t.codes.length + " code" + (t.codes.length === 1 ? "" : "s")}</span>
        </button>);
      })}
    </div>}
    {tplNotice && <div style={{ marginBottom: 8, padding: "8px 12px", borderRadius: 8, background: tplNotice.warn ? "rgba(245,158,11,0.08)" : "rgba(16,185,129,0.08)", border: tplNotice.warn ? "1px solid rgba(245,158,11,0.25)" : "1px solid rgba(16,185,129,0.25)", color: tplNotice.warn ? "var(--accent-amber)" : "var(--accent-green-soft)", fontSize: 11, display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 8 }}>
      <span>{tplNotice.text}</span>
      <span onClick={function() { setTplNotice(null); }} style={{ cursor: "pointer", fontWeight: 700, flexShrink: 0 }}>x</span>
    </div>}

    {/* Procedure tabs */}
    <div style={{ display: "flex", gap: 4, marginBottom: 8, flexWrap: "wrap" }}>
      {procs.map(function(p, i) {
        var info = p.code ? cptMap[p.code] : null;
        var isActive = i === activeProc;
        return (<button key={p.id} onClick={function() { setActiveProc(i); }} style={{
          padding: "6px 12px", borderRadius: 8, border: isActive ? "2px solid #0ea5e9" : "1px solid var(--border-default)",
          background: isActive ? "rgba(14,165,233,0.1)" : "var(--bg-card)", color: isActive ? "var(--accent-sky)" : "var(--text-muted)",
          fontSize: 12, fontFamily: "JetBrains Mono", cursor: "pointer", fontWeight: isActive ? 700 : 400
        }}>
          {info ? info.code : "Proc " + (i + 1)}
          {procs.length > 1 && <span onClick={function(ev) { ev.stopPropagation(); removeProc(i); }} style={{ marginLeft: 6, color: "var(--text-dim)", fontSize: 10 }}>x</span>}
        </button>);
      })}
      <button onClick={addProc} style={{ padding: "6px 12px", borderRadius: 8, border: "1px dashed var(--border-default)", background: "transparent", color: "var(--text-dim)", fontSize: 12, cursor: "pointer" }}>+ Add</button>
    </div>

    {/* Search for active procedure */}
    <div style={S.fieldGroup}><label style={S.fieldLabel}>Search CPT Code or Procedure</label><input type="text" value={curSearch} onChange={function(e) { updateProc(activeProc, { search: e.target.value, code: null }); setShowFavs(false); }} placeholder="e.g. 47562, cholecystectomy, hernia..." autoCorrect="off" autoCapitalize="off" spellCheck={false} style={S.searchInput} onFocus={function() { if (!curSearch.trim()) setShowFavs(true); }} /></div>
    {/* Category / Favorites chips: only while the ACTIVE procedure has no
        picked code - the same !curSel both lists below lead with, so a
        filter never hides while a list shows. With a code picked a chip tap
        did nothing or (Favorites) silently cleared the pick; + Add, the
        card's x, typing in the search box or an empty Proc tab bring it
        back (check.js 5f-12). */}
    {!curSel && <div style={S.catRow}><button onClick={function() { setCat("All"); setShowFavs(false); }} style={cat === "All" && !showFavs ? S.catBtnActive : S.catBtn}>All</button><button onClick={function() { setShowFavs(true); setCat("All"); updateProc(activeProc, { search: "", code: null }); }} style={showFavs ? { ...S.catBtnActive, color: "var(--accent-amber-soft)", borderColor: "rgba(251,191,36,0.4)", background: "rgba(251,191,36,0.1)" } : { ...S.catBtn, color: "var(--accent-amber-soft)" }}>{"\u2605"} Favorites{favorites.length > 0 ? " (" + favorites.length + ")" : ""}</button>{categories.map(function(c) { return <button key={c} onClick={function() { setCat(c); setShowFavs(false); }} style={cat === c && !showFavs ? S.catBtnActive : S.catBtn}>{c}</button>; })}</div>}

    {/* Favorites panel */}
    {!curSel && showFavs && !curSearch.trim() && <div style={S.resultsList}>
      {favCodes.length === 0 && mostUsed.length === 0 && <div style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>
        <div style={{ fontSize: 28, marginBottom: 8 }}>{"\u2606"}</div>
        <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>No favorites yet</div>
        <div style={{ fontSize: 12, lineHeight: 1.5 }}>Tap the {"\u2606"} star next to any CPT code to add it here for quick access.</div>
      </div>}
      {favCodes.length > 0 && <div style={{ padding: "4px 0 6px", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent-amber-soft)", textTransform: "uppercase", letterSpacing: 1 }}>{"\u2605"} Favorites ({favCodes.length})</span>
      </div>}
      {favCodes.map(function(cpt, idx) {
        var count = usageCounts[cpt.code] || 0;
        var comp = (cpt.wRVU * data.settings.ratePerRVU);
        return (<button key={cpt.code} onClick={function() { selectCode(cpt); setShowFavs(false); }} style={{ ...S.resultItem, borderLeft: "3px solid rgba(251,191,36,0.4)", position: "relative" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <span style={S.resultCode}>{cpt.code}</span>
              {count > 0 && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "rgba(14,165,233,0.12)", color: "var(--accent-sky-soft)", fontFamily: "JetBrains Mono", fontWeight: 600 }}>{"x"}{count}</span>}
            </div>
            <div style={{ ...S.resultDesc, marginTop: 3 }}>{cpt.friendly || cpt.desc}</div>
            {cpt.friendly && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>{cpt.desc}</div>}
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
              <span onClick={function(ev) { ev.stopPropagation(); toggleFav(cpt.code); }} style={{ fontSize: 18, cursor: "pointer", color: "var(--accent-star)", lineHeight: 1 }}>{"\u2605"}</span>
            </div>
            <span style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "var(--accent-green)" }}>{"$"}{comp.toFixed(0)}</span>
            <div style={{ display: "flex", gap: 2 }}>
              {idx > 0 && <span onClick={function(ev) { ev.stopPropagation(); moveFav(cpt.code, -1); }} style={{ fontSize: 14, cursor: "pointer", color: "var(--text-faint)", padding: "0 4px", lineHeight: 1 }}>{"\u25B2"}</span>}
              {idx < favCodes.length - 1 && <span onClick={function(ev) { ev.stopPropagation(); moveFav(cpt.code, 1); }} style={{ fontSize: 14, cursor: "pointer", color: "var(--text-faint)", padding: "0 4px", lineHeight: 1 }}>{"\u25BC"}</span>}
            </div>
          </div>
        </div>
      </button>); })}
      {mostUsed.length > 0 && <>
        <div style={{ padding: "12px 0 6px", display: "flex", justifyContent: "space-between", alignItems: "center", borderTop: favCodes.length > 0 ? "1px solid var(--border-default)" : "none", marginTop: favCodes.length > 0 ? 8 : 0 }}>
          <span style={{ fontSize: 11, fontWeight: 600, color: "var(--accent-sky)", textTransform: "uppercase", letterSpacing: 1 }}>Most Used</span>
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
                  <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "rgba(14,165,233,0.12)", color: "var(--accent-sky-soft)", fontFamily: "JetBrains Mono", fontWeight: 600 }}>{"x"}{count}</span>
                </div>
                <div style={{ ...S.resultDesc, marginTop: 3 }}>{cpt.friendly || cpt.desc}</div>
                {cpt.friendly && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>{cpt.desc}</div>}
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
                <span style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "var(--accent-green)" }}>{"$"}{comp.toFixed(0)}</span>
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
            {count > 0 && <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 10, background: "rgba(14,165,233,0.12)", color: "var(--accent-sky-soft)", fontFamily: "JetBrains Mono", fontWeight: 600 }}>{"x"}{count}</span>}
          </div>
          <div style={{ ...S.resultDesc, marginTop: 3 }}>{cpt.friendly || cpt.desc}</div>
          {cpt.friendly && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>{cpt.desc}</div>}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 3 }}>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{cpt.category}</span>
            {getGlobalDays(cpt.code) && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 4, background: "rgba(100,116,139,0.1)", border: "1px solid rgba(100,116,139,0.15)", color: getGlobalColor(cpt.code), fontFamily: "JetBrains Mono", fontWeight: 600 }}>{getGlobalDays(cpt.code)}</span>}
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 2, flexShrink: 0, marginLeft: 8 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ textAlign: "right" }}>
              <span style={{ ...S.resultRVU, fontSize: 14 }}>{cpt.wRVU}</span>
              <span style={{ fontSize: 10, color: "var(--text-dim)" }}> wRVU</span>
            </div>
            <span onClick={function(ev) { ev.stopPropagation(); toggleFav(cpt.code); }} style={{ fontSize: 18, cursor: "pointer", color: isFav(cpt.code) ? "var(--accent-star)" : "var(--text-ghost)", lineHeight: 1 }}>{isFav(cpt.code) ? "\u2605" : "\u2606"}</span>
          </div>
          <span style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "var(--accent-green)" }}>{"$"}{comp.toFixed(0)}</span>
        </div>
      </div>
    </button>); })}{filtered.length === 0 && curSearch && <div style={{ padding: 20, textAlign: "center", color: "var(--text-dim)" }}>No matching CPT codes found</div>}{filtered.length > 20 && <div style={{ padding: "8px 4px", textAlign: "center", fontSize: 11, color: "var(--text-dim)" }}>{"Showing 20 of " + filtered.length + " matches - type more to narrow"}</div>}</div>}

    {curSel && <><div style={S.selectedCard}><div style={{ display: "flex", justifyContent: "space-between" }}><div style={{ display: "flex", alignItems: "center", gap: 8 }}><span style={S.selectedCode}>{curSel.code}</span><span onClick={function() { toggleFav(curSel.code); }} style={{ fontSize: 22, cursor: "pointer", color: isFav(curSel.code) ? "var(--accent-star)" : "var(--text-faint)", lineHeight: 1 }}>{isFav(curSel.code) ? "\u2605" : "\u2606"}</span>{usageCounts[curSel.code] > 0 && <span style={{ fontSize: 10, padding: "2px 7px", borderRadius: 10, background: "rgba(14,165,233,0.12)", color: "var(--accent-sky-soft)", fontFamily: "JetBrains Mono", fontWeight: 600 }}>{"x"}{usageCounts[curSel.code]}</span>}</div><button onClick={clearCode} style={S.clearBtn}>x</button></div><div style={S.selectedDesc}>{curSel.friendly || curSel.desc}</div>{curSel.friendly && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{curSel.desc}</div>}<div style={{ display: "flex", gap: 16, marginTop: 8 }}><div><div style={{ fontSize: 11, color: "var(--text-dim)" }}>Base wRVU</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 600 }}>{curSel.wRVU}</div></div>{curMods.length > 0 && <div><div style={{ fontSize: 11, color: "var(--text-dim)" }}>Adjusted</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "var(--accent-sky)", fontWeight: 600 }}>{calcProcRVU(cur).toFixed(2)}</div></div>}<div><div style={{ fontSize: 11, color: "var(--text-dim)" }}>Compensation</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "var(--accent-green)", fontWeight: 600 }}>${(creditedRVU(encPreview(calcProcRVU(cur))) * data.settings.ratePerRVU).toFixed(0)}{ncNow && <span style={{ ...S.ncTag, marginLeft: 6 }}>no credit</span>}</div></div></div></div>
    {(function() {
      var alreadyCodes = procs.map(function(p) { return p.code; }).filter(Boolean);
      var suggestions = getCompanionSuggestions(curSel.code, data.entries, cptMap, alreadyCodes);
      if (suggestions.length === 0) return null;
      var addSuggestion = function(s) {
        var newP = { id: nextId.current++, code: s.code, search: s.code + " - " + (s.friendly || s.desc), mods: [] };
        setProcs(function(prev) { return prev.concat([newP]); });
        setActiveProc(procs.length);
      };
      return (<div style={{ marginBottom: 8, animation: "rvuFadeIn 0.2s ease-out" }}>
        <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 5, fontWeight: 600 }}>Also add?</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {suggestions.map(function(s) {
            return (<button key={s.code} onClick={function() { addSuggestion(s); }} style={{
              padding: "6px 10px", borderRadius: 8, cursor: "pointer",
              border: s.source === "history" ? "1px solid rgba(139,92,246,0.3)" : "1px solid rgba(14,165,233,0.25)",
              background: s.source === "history" ? "rgba(139,92,246,0.06)" : "rgba(14,165,233,0.06)",
              display: "flex", flexDirection: "column", gap: 1, alignItems: "flex-start",
              transition: "all 0.15s ease"
            }}>
              <div style={{ display: "flex", alignItems: "center", gap: 5 }}>
                <span style={{ fontSize: 11, fontFamily: "JetBrains Mono", fontWeight: 700, color: s.source === "history" ? "var(--accent-violet)" : "var(--accent-sky)" }}>{s.code}</span>
                <span style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "var(--accent-green)" }}>{s.wRVU}</span>
              </div>
              <span style={{ fontSize: 10, color: "var(--text-muted)", lineHeight: 1.2 }}>{s.label}</span>
            </button>);
          })}
        </div>
      </div>);
    })()}
    <div style={S.fieldGroup}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}><label style={{ ...S.fieldLabel, marginBottom: 0 }}>Modifiers</label><button onClick={function() { setShowModHelp(!showModHelp); }} style={{ background: "none", border: "1px solid var(--border-default)", borderRadius: 6, color: showModHelp ? "var(--accent-sky)" : "var(--text-dim)", fontSize: 11, cursor: "pointer", padding: "2px 8px", fontFamily: "inherit" }}>{showModHelp ? "Hide Guide" : "? Guide"}</button></div>
    {showModHelp && <div style={{ marginBottom: 10, padding: 12, borderRadius: 10, background: "var(--bg-inset)", border: "1px solid var(--border-default)", animation: "rvuFadeIn 0.2s ease-out" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-bright)", marginBottom: 8 }}>When to Use Each Modifier</div>
      {MODIFIERS.map(function(m) { return <div key={m.code} style={{ padding: "8px 0", borderBottom: "1px solid var(--border-default)" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
          <span style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: "var(--accent-sky)", fontWeight: 700 }}>{m.code}</span>
          <span style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 600 }}>{m.label}</span>
          <span style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "var(--accent-green)" }}>{m.desc}</span>
        </div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>{m.guide}</div>
      </div>; })}
    </div>}
    <div style={S.modGrid}>{MODIFIERS.map(function(m) { return <button key={m.code} onClick={function() { toggleMod(m.code); }} style={curMods.includes(m.code) ? S.modBtnActive : S.modBtn}><span style={S.modCode}>{m.code}</span><span style={S.modLabel}>{m.label}</span><span style={S.modFactor}>{m.desc}</span></button>; })}</div></div></>}

    {/* Encounter summary */}
    {canSave && <div style={{ ...S.card, background: "linear-gradient(135deg, var(--card-main-from), var(--card-main-to))", border: isCall ? "1px solid rgba(139,92,246,0.3)" : "1px solid var(--border-default)", marginTop: 8 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={S.cardLabel}>Encounter Summary</div>
        <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
          {!tplSaving && <button onClick={openTplForm} style={{ padding: "3px 9px", borderRadius: 6, border: "1px solid rgba(16,185,129,0.3)", background: "transparent", color: "var(--accent-green-soft)", fontSize: 10, fontWeight: 700, cursor: "pointer" }}>Save as template</button>}
          <span style={{ fontSize: 10, padding: "2px 8px", borderRadius: 4, background: isCall ? "rgba(139,92,246,0.15)" : "rgba(14,165,233,0.15)", color: isCall ? "var(--accent-violet)" : "var(--accent-sky)", fontWeight: 600 }}>{isCall ? "Call" + (pickedSite ? " - " + pickedSite.name : "") : "Private"}</span>
          {ncNow && <span style={S.ncTag}>no credit</span>}
        </div>
      </div>
      {tplSaving && <div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "var(--bg-inset)", border: "1px solid rgba(16,185,129,0.25)" }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--accent-green-soft)", marginBottom: 6 }}>New template from this selection ({procs.filter(function(p) { return p.code; }).length} code{procs.filter(function(p) { return p.code; }).length === 1 ? "" : "s"})</div>
        <input type="text" value={tplName} onChange={function(e) { setTplName(e.target.value); }} placeholder="Template name (e.g. Lap chole + IOC)" autoFocus style={{ ...S.searchInput, fontSize: 13, marginBottom: 6 }} />
        <label style={{ ...S.fieldLabel, fontSize: 10 }}>Default note (optional - applied only when the note field is empty)</label>
        <input type="text" value={tplNote} onChange={function(e) { setTplNote(e.target.value); }} placeholder="No default note" style={{ ...S.searchInput, fontSize: 12, marginBottom: 6 }} />
        <div style={{ fontSize: 10, color: "var(--text-faint)", lineHeight: 1.5, marginBottom: 8 }}>Templates store CPT codes only - keep names and default notes free of patient info. The note above was copied from the current case; edit or clear it before saving.</div>
        <div style={{ display: "flex", gap: 6 }}>
          <button onClick={function() { setTplSaving(false); }} style={{ padding: "7px 12px", borderRadius: 8, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 12, cursor: "pointer" }}>Cancel</button>
          <button onClick={saveTemplate} disabled={!tplName.trim()} style={{ ...S.saveBtn, flex: 1, padding: "7px 12px", fontSize: 12, opacity: tplName.trim() ? 1 : 0.4 }}>Save template</button>
        </div>
      </div>}
      <div style={{ marginTop: 8 }}>{procs.filter(function(p){return p.code;}).map(function(p, i) {
        var info = cptMap[p.code];
        var adj = calcProcRVU(p);
        return (<div key={p.id} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", borderBottom: i < procs.filter(function(x){return x.code;}).length - 1 ? "1px solid rgba(51,65,85,0.5)" : "none" }}>
          <div><span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "var(--accent-sky)", fontWeight: 600 }}>{p.code}</span>{p.mods.map(function(m) { return <span key={m} style={{ fontSize: 10, color: "var(--accent-amber-soft)", marginLeft: 4 }}>{m}</span>; })}<div style={{ fontSize: 11, color: "var(--text-muted)" }}>{info ? (info.friendly || info.desc) : ""}</div></div>
          <div style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: ncNow ? "var(--text-dim)" : "var(--text-primary)", fontWeight: 600 }}>{adj.toFixed(2)}</div>
        </div>);
      })}</div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid var(--border-default)" }}>
        <span style={{ fontSize: 13, color: "var(--text-muted)", fontWeight: 600 }}>Total</span>
        <div style={{ textAlign: "right" }}>
          <div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "var(--text-bright)", fontWeight: 700 }}>{ncNow ? <span style={{ color: "var(--text-dim)" }}>{ncRVUNow.toFixed(2) + " wRVU "}<span style={S.ncTag}>no credit</span></span> : credRVU.toFixed(2) + " wRVU"}</div>
          <div style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: "var(--accent-green)" }}>${totalComp.toFixed(0)}</div>
        </div>
      </div>
    </div>}

    <div style={S.fieldGroup}><label style={S.fieldLabel}>Case Notes (optional)</label><textarea value={notes} onChange={function(e) { setNotes(e.target.value); }} placeholder="Complexity, attending, indication, complications..." style={S.notesInput} rows={2} /></div>
    {/* Save bar - the ONE Save control (Call Pay precedent, callpay.js).
        Inside .rvu-content it rides on the nav and goes behind the iOS
        keyboard like the nav; pinned only when barPinned. Fixed 64px tall:
        app.js lifts the undo toast to bottom 148 (nav ~71 + 64 + gap) while
        it is pinned - change bar height, nav height and toast offset
        together. Never hide it on input focus (a missed blur strands Save). */}
    {(canSave || saved) && (function() {
      var nCodes = procs.filter(function(p) { return p.code; }).length;
      var mode = isCall ? "Call" + (pickedSite ? " - " + pickedSite.name : callSite === CALL_SITE_OTHER ? " - other site" : "") : "Private";
      var fix = saved ? "" : !isYMD(date) ? "Pick a valid date" : needSite ? "Pick the call site" : "";
      var toTop = function() { var sc = document.querySelector(".rvu-content"); if (sc) sc.scrollTop = 0; };
      var line1 = <div style={{ fontSize: 11, color: "var(--text-muted)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{nCodes + " code" + (nCodes === 1 ? "" : "s") + " \u00B7 " + mode}</div>;
      return (<div style={{ position: barPinned ? "sticky" : "static", bottom: 0, zIndex: 5, height: 64, boxSizing: "border-box", display: "flex", alignItems: "center", gap: 10, marginTop: 8, background: "var(--bg-base)", borderTop: "1px solid var(--border-default)" }}>
        {saved ? <div style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--accent-green)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{saved}</div>
        : fix ? <button onClick={toTop} style={{ flex: 1, minWidth: 0, minHeight: 44, textAlign: "left", background: "none", border: "none", padding: 0, cursor: "pointer" }}>{line1}<div style={{ fontSize: 13, fontWeight: 600, color: "var(--accent-amber)" }}>{fix + " \u2191"}</div></button>
        : <div style={{ flex: 1, minWidth: 0 }}>{line1}<div style={{ fontSize: 16, fontFamily: "JetBrains Mono", fontWeight: 700, color: "var(--text-bright)", whiteSpace: "nowrap" }}>{ncNow ? <span style={{ color: "var(--text-dim)" }}>{ncRVUNow.toFixed(2) + " wRVU "}<span style={S.ncTag}>no credit</span></span> : credRVU.toFixed(2) + " wRVU"}</div></div>}
        <button onClick={save} disabled={!!saved || !saveReady} style={{ flexShrink: 0, height: 48, padding: "0 18px", borderRadius: 12, border: "none", color: "#fff", fontSize: 15, fontWeight: 700, cursor: "pointer", opacity: saved || saveReady ? 1 : 0.45, background: saved ? "linear-gradient(135deg, #10b981, #059669)" : isCall ? "linear-gradient(135deg, #8b5cf6, #7c3aed)" : "linear-gradient(135deg, #0369a1, #075985)" }}>{saved ? "\u2713 Logged" : "Log " + (isCall ? "Call" : "Private")}</button>
      </div>);
    })()}
  </div>);
}

// --- CMS PFS File Parser ---


