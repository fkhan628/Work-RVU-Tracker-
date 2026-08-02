// =======================================
// IMPORT
// =======================================
function Import({ data, cptMap, upd, setView }) {
  const [mode, setMode] = useState("choose"); const [raw, setRaw] = useState(""); const [parsed, setParsed] = useState(null); const [status, setStatus] = useState(null); const [page, setPage] = useState(0); const fRef = useRef(null);
  
  const doParse = t => { setParsed(parseImport(t, cptMap)); setPage(0); setMode("preview"); };
  const onFile = e => { const f = e.target.files[0]; if (!f) return; const r = new FileReader(); r.onload = ev => { setRaw(ev.target.result); doParse(ev.target.result); }; r.readAsText(f); };
  const doImport = () => { if (!parsed || !parsed.entries || !parsed.entries.length) return; upd(prev => { var existing = prev.entries; var newEntries = parsed.entries.filter(function(ne) { return !existing.some(function(ex) { return ex.date === ne.date && ex.cptCode === ne.cptCode && ex.notes === ne.notes; }); }); return { ...prev, entries: [...prev.entries, ...newEntries] }; }); setStatus('ok'); setTimeout(() => { setStatus(null); setView("dashboard"); }, 2000); };
  const PS = 20; const pEntries = parsed ? parsed.entries.slice(page * PS, (page + 1) * PS) : []; const tPages = parsed ? Math.ceil(parsed.entries.length / PS) : 0;

  if (mode === "choose") return (<div style={S.page}><div style={S.header}><h1 style={S.title}>Import Data</h1><p style={S.subtitle}>Import your procedure history</p></div>
    <div style={{ ...S.card, border: "1px solid var(--border-default)", cursor: "pointer" }} onClick={() => fRef.current && fRef.current.click()}><input ref={fRef} type="file" accept=".csv,.tsv,.txt" style={{ display: "none" }} onChange={onFile} /><div style={{ textAlign: "center", padding: "24px 0" }}><div style={{ fontSize: 40, marginBottom: 8 }}></div><div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>Upload CSV / Spreadsheet</div><div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 4 }}>Export from RVU Wallet and upload</div></div></div>
    <div style={{ textAlign: "center", color: "var(--text-faint)", fontSize: 13, margin: "14px 0" }}>- or -</div>
    <div style={{ ...S.card, border: "1px solid var(--border-default)", cursor: "pointer" }} onClick={() => setMode("paste")}><div style={{ textAlign: "center", padding: "24px 0" }}><div style={{ fontSize: 40, marginBottom: 8 }}></div><div style={{ fontSize: 16, fontWeight: 600, color: "var(--text-primary)" }}>Paste Data</div><div style={{ fontSize: 13, color: "var(--text-dim)", marginTop: 4 }}>Copy rows from a spreadsheet and paste</div></div></div>
    <div style={{ ...S.card, marginTop: 16, background: "var(--bg-inset)", border: "1px solid var(--border-subtle)" }}><div style={{ ...S.cardLabel, marginBottom: 8 }}>Complete CMS Database</div><div style={{ fontSize: 12, color: "var(--text-muted)", lineHeight: 1.6 }}>{Object.keys(cptMap).length} preloaded codes  {DATA_VERSION}</div></div>
  </div>);

  if (mode === "paste") return (<div style={S.page}><div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}><button onClick={() => setMode("choose")} style={S.backBtn}></button><h1 style={{ ...S.title, marginBottom: 0 }}>Paste Data</h1></div>
    <textarea value={raw} onChange={e => setRaw(e.target.value)} placeholder={"Date,CPT,Description,wRVU,Modifier\n01/15/2025,47562,Lap cholecystectomy,10.21,"} style={{ ...S.notesInput, minHeight: 200, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6 }} />
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button onClick={() => setMode("choose")} style={S.secondaryBtn}>Cancel</button><button onClick={() => doParse(raw)} disabled={!raw.trim()} style={{ ...S.saveBtn, flex: 1, opacity: raw.trim() ? 1 : 0.4 }}>Parse Data </button></div>
  </div>);

  if (mode === "preview" && parsed) {
    const matched = parsed.entries.filter(e => cptMap[e.cptCode]); const tRVU = parsed.entries.reduce((s, e) => s + e.adjustedRVU, 0);
    return (<div style={S.page}><div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}><button onClick={() => { setMode(raw ? "paste" : "choose"); setParsed(null); }} style={S.backBtn}></button><h1 style={{ ...S.title, marginBottom: 0 }}>Import Preview</h1></div>
      {status === 'ok' && <div style={S.successBanner}> Imported {parsed.entries.length} procedures!</div>}
      <div style={{ ...S.card, background: "linear-gradient(135deg, var(--bg-card), var(--bg-inset))", border: "1px solid var(--border-default)" }}><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>{[[parsed.entries.length, "Procedures", "var(--text-bright)"], [tRVU.toFixed(0), "Total wRVUs", "#0ea5e9"], [matched.length, "Matched", "#10b981"]].map(([v, l, c]) => (<div key={l} style={{ textAlign: "center" }}><div style={{ fontSize: 26, fontFamily: "JetBrains Mono", fontWeight: 700, color: c }}>{v}</div><div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5 }}>{l}</div></div>))}</div></div>
      {parsed.errors.length > 0 && <div style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 10, padding: 12, marginBottom: 12 }}><div style={{ fontSize: 12, fontWeight: 600, color: "#fbbf24", marginBottom: 4 }}> Warnings</div>{parsed.errors.slice(0, 5).map((e, i) => <div key={i} style={{ fontSize: 11, color: "#fcd34d", padding: "2px 0" }}>{e}</div>)}</div>}
      <div style={S.card}><div style={S.cardLabel}>Preview ({parsed.entries.length} rows)</div><div style={{ marginTop: 8, maxHeight: 280, overflowY: "auto", scrollbarWidth: "thin" }}>{pEntries.map((e, i) => (<div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(51,65,85,0.5)" }}><div style={{ flex: 1, minWidth: 0 }}><span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: cptMap[e.cptCode] ? "#0ea5e9" : "#fbbf24", fontWeight: 600 }}>{e.cptCode}</span> <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{fmtShort(e.date)}</span><div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.description}</div></div><div style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 600, marginLeft: 8 }}>{e.adjustedRVU.toFixed(2)}</div></div>))}</div>{tPages > 1 && <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 8 }}><button onClick={() => setPage(p => Math.max(0, p-1))} disabled={page === 0} style={{ ...S.pgBtn, opacity: page === 0 ? 0.3 : 1 }}></button><span style={{ fontSize: 11, color: "var(--text-dim)", fontFamily: "JetBrains Mono" }}>{page+1}/{tPages}</span><button onClick={() => setPage(p => Math.min(tPages-1, p+1))} disabled={page === tPages-1} style={{ ...S.pgBtn, opacity: page === tPages-1 ? 0.3 : 1 }}></button></div>}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}><button onClick={() => { setParsed(null); setMode("choose"); setRaw(""); }} style={S.secondaryBtn}>Cancel</button><button onClick={doImport} disabled={!parsed.entries.length} style={{ ...S.saveBtn, flex: 2, background: "linear-gradient(135deg, #10b981, #059669)" }}>Import {parsed.entries.length} Procedures</button></div>
    </div>);
  }
  return null;
}

// =======================================
// HISTORY
// =======================================
function History({ data, db, cptMap, categories, upd, setView, showUndo }) {
  const [filter, setFilter] = useState(""); const [sortBy, setSortBy] = useState("date"); const [groupBy, setGroupBy] = useState("date");
  const [editId, setEditId] = useState(null);
  const [editDate, setEditDate] = useState("");
  const [editCode, setEditCode] = useState("");
  const [editMods, setEditMods] = useState([]);
  const [editNotes, setEditNotes] = useState("");
  const [editSearch, setEditSearch] = useState("");
  const [editPatient, setEditPatient] = useState("");
  const [editIsCall, setEditIsCall] = useState(false);
  // Manual wRVU draft, used ONLY when the user actively changes an entry's
  // code to one the database doesn't know. Prefilled with the entry's prior
  // base value, so leaving it untouched means "keep prior value".
  const [editManualBase, setEditManualBase] = useState("");
  // Add-mode: editId === ADD_SENTINEL means the panel is creating a NEW
  // sibling procedure instead of editing one. addSourceId is the entry the
  // panel was opened from - needed to backfill initials onto a standalone
  // source entry so the pair merges into an encounter card (buildEncounters
  // keys on encounterId). Real ids are Date.now()-based; no collision.
  const [addSourceId, setAddSourceId] = useState(null);
  const addSavingRef = useRef(false);
  var ADD_SENTINEL = "__add__";
  const [dateRange, setDateRange] = useState("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showCallFilter, setShowCallFilter] = useState("all");
  const { entries, settings } = data;

  var dateRangeBounds = useMemo(function() {
    var now = new Date();
    var todayStr = localYMD(now);
    if (dateRange === "all") return null;
    if (dateRange === "today") return { start: todayStr, end: todayStr };
    if (dateRange === "week") {
      var ws = new Date(now); ws.setDate(now.getDate() - now.getDay()); ws.setHours(0,0,0,0);
      return { start: localYMD(ws), end: todayStr };
    }
    if (dateRange === "month") {
      return { start: now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-01", end: todayStr };
    }
    if (dateRange === "lastMonth") {
      var lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      var lmEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: localYMD(lm), end: localYMD(lmEnd) };
    }
    if (dateRange === "quarter") {
      var qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      return { start: localYMD(qStart), end: todayStr };
    }
    if (dateRange === "ytd") {
      var ys = settings.yearStart || (now.getFullYear() + "-01-01");
      return { start: ys, end: todayStr };
    }
    if (dateRange === "custom") {
      return { start: customStart || "2000-01-01", end: customEnd || todayStr };
    }
    return null;
  }, [dateRange, customStart, customEnd, settings.yearStart]);

  const filtered = useMemo(() => {
    let items = [...entries];
    if (dateRangeBounds) {
      items = items.filter(function(e) { return e.date >= dateRangeBounds.start && e.date <= dateRangeBounds.end; });
    }
    if (showCallFilter === "private") items = items.filter(function(e) { return !e.isCall; });
    if (showCallFilter === "call") items = items.filter(function(e) { return e.isCall; });
    if (filter.trim()) {
      const terms = filter.toLowerCase().split(/\s+/).filter(function(t) { return t; });
      items = items.filter(function(e) {
        var f = cptMap[e.cptCode];
        var hay = (e.cptCode + " " + e.description + " " + e.category + " " + (e.notes || "") + " " + (f && f.friendly ? f.friendly : "")).toLowerCase();
        for (var i = 0; i < terms.length; i++) { if (hay.indexOf(terms[i]) === -1) return false; }
        return true;
      });
    }
    items.sort((a, b) => { if (sortBy === "rvu") return b.adjustedRVU - a.adjustedRVU; if (sortBy === "code") return a.cptCode.localeCompare(b.cptCode); return new Date(b.date + "T12:00:00") - new Date(a.date + "T12:00:00"); });
    return items;
  }, [entries, filter, sortBy, dateRangeBounds, showCallFilter, cptMap]);
  const grouped = useMemo(() => { if (groupBy === "none") return { "All": filtered }; const g = {}; filtered.forEach(e => { const k = groupBy === "date" ? e.date : e.category; if (!g[k]) g[k] = []; g[k].push(e); }); return g; }, [filtered, groupBy]);
  const del = function(id) {
    var entry = data.entries.find(function(e) { return e.id === id; });
    upd(prev => ({ ...prev, entries: prev.entries.filter(e => e.id !== id) }));
    if (entry) {
      showUndo({ type: "delete", entries: [entry], message: "Deleted " + (entry.cptCode || "entry") + " (" + entry.adjustedRVU.toFixed(2) + " wRVU)" });
    }
  };
  const tF = filtered.reduce((s, e) => s + e.adjustedRVU, 0);
  const filteredCount = filtered.length;
  const [swipedId, setSwipedId] = useState(null);
  var touchStart = useRef({ x: 0, id: null });

  var handleTouchStart = function(id, e) {
    touchStart.current = { x: e.touches[0].clientX, id: id };
  };
  var handleTouchEnd = function(id, e) {
    var dx = e.changedTouches[0].clientX - touchStart.current.x;
    if (dx < -60 && touchStart.current.id === id) { setSwipedId(id); }
    else if (dx > 30) { setSwipedId(null); }
  };

  // Build encounter groups within a date group
  var buildEncounters = function(items) {
    var encounters = [];
    var encMap = {};
    var order = [];
    items.forEach(function(e) {
      if (e.encounterId) {
        if (!encMap[e.encounterId]) {
          encMap[e.encounterId] = [];
          order.push({ type: "enc", key: e.encounterId });
        }
        encMap[e.encounterId].push(e);
      } else {
        order.push({ type: "single", entry: e });
      }
    });
    return order.map(function(o) {
      if (o.type === "enc") {
        var ents = encMap[o.key];
        if (ents.length === 1) return { type: "single", entry: ents[0] };
        return { type: "encounter", patient: o.key, entries: ents, totalRVU: ents.reduce(function(s, x) { return s + x.adjustedRVU; }, 0) };
      }
      return o;
    });
  };

  // Single procedure row (reused by both grouped and ungrouped)
  var renderProcRow = function(e, compact) {
    var isSwiped = swipedId === e.id;
    return (<div key={e.id} style={{ position: "relative", overflow: "hidden" }}
      onTouchStart={function(ev) { handleTouchStart(e.id, ev); }}
      onTouchEnd={function(ev) { handleTouchEnd(e.id, ev); }}
    >
      <div style={{ ...S.historyItem, transform: isSwiped ? "translateX(-80px)" : "translateX(0)", transition: "transform 0.2s ease", borderBottom: compact ? "1px solid rgba(51,65,85,0.3)" : "1px solid rgba(51,65,85,0.5)" }}>
        <div style={{ flex: 1, cursor: "pointer" }} onClick={function() { startEdit(e); }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
            <span style={S.histCode}>{e.cptCode}</span>
            {e.modifiers.map(function(m) { return <span key={m} style={S.histMod}>{m}</span>; })}
            {e.isCall && <span style={{ fontSize: 9, color: "#a78bfa", background: "rgba(139,92,246,0.15)", padding: "1px 5px", borderRadius: 3 }}>call</span>}
            {e.imported && <span style={{ fontSize: 9, color: "var(--text-dim)", background: "rgba(100,116,139,0.15)", padding: "1px 5px", borderRadius: 3 }}>imported</span>}
            {!compact && getGlobalDays(e.cptCode) && <span style={{ fontSize: 9, padding: "1px 5px", borderRadius: 3, background: "rgba(100,116,139,0.1)", border: "1px solid rgba(100,116,139,0.15)", color: getGlobalColor(e.cptCode), fontFamily: "JetBrains Mono", fontWeight: 600 }}>{getGlobalDays(e.cptCode)}</span>}
            {!compact && e.encounterId && <span style={{ fontSize: 9, color: "var(--text-muted)", background: "rgba(148,163,184,0.1)", padding: "1px 5px", borderRadius: 3 }}>{e.encounterId}</span>}
          </div>
          <div style={S.histDesc}>{(cptMap[e.cptCode] && cptMap[e.cptCode].friendly) || e.description}</div>
          {cptMap[e.cptCode] && cptMap[e.cptCode].friendly && !compact && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 1 }}>{e.description}</div>}
          {groupBy !== "date" && <div style={{ fontSize: 11, color: "var(--text-dim)", marginTop: 2 }}>{fmtShort(e.date)}</div>}
          {e.notes && !compact && <div style={S.histNotes}>{e.notes}</div>}
        </div>
        <div style={{ textAlign: "right", flexShrink: 0 }}>
          <div style={S.histRVU}>{e.adjustedRVU.toFixed(2)}</div>
          <div style={{ fontSize: 11, color: "#10b981", fontFamily: "JetBrains Mono" }}>${(e.adjustedRVU * settings.ratePerRVU).toFixed(0)}</div>
          {!isSwiped && <button onClick={function(ev) { ev.stopPropagation(); del(e.id); }} style={S.deleteBtn}>Delete</button>}
        </div>
      </div>
      {isSwiped && <div style={{ position: "absolute", right: 0, top: 0, bottom: 0, width: 80, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <button onClick={function() { del(e.id); setSwipedId(null); }} style={{ width: "100%", height: "100%", background: "#ef4444", border: "none", color: "#fff", fontSize: 12, fontWeight: 700, cursor: "pointer" }}>Delete</button>
      </div>}
    </div>);
  };

  var exportFiltered = function() {
    var h = ["Date","CPT","Description","Category","Type","Base wRVU","Modifiers","Adjusted wRVU","Compensation","Patient","Notes"];
    var rows = filtered.map(function(e) {
      return [e.date, e.cptCode, e.description || "", e.category, e.isCall ? "Call" : "Private", e.baseRVU, (e.modifiers || []).join(";"), e.adjustedRVU.toFixed(2), (e.adjustedRVU * settings.ratePerRVU).toFixed(2), e.encounterId || "", e.notes || ""];
    });
    var csv = [h.join(",")].concat(rows.map(function(r) { return r.map(csvField).join(","); })).join("\n");
    var b = new Blob([csv], { type: "text/csv" });
    var u = URL.createObjectURL(b);
    var a = document.createElement("a");
    a.href = u;
    var suffix = dateRange !== "all" ? "-" + dateRange : "";
    a.download = "rvu-history" + suffix + "-" + todayLocal() + ".csv";
    a.click();
    URL.revokeObjectURL(u);
  };

  const startEdit = (e) => {
    setEditId(e.id);
    setEditDate(e.date);
    setEditCode(e.cptCode);
    setEditMods(e.modifiers || []);
    setEditNotes(e.notes || "");
    setEditSearch("");
    setEditPatient(e.encounterId || "");
    setEditIsCall(!!e.isCall);
    setEditManualBase(String(e.baseRVU || 0));
  };

  const cancelEdit = () => { setEditId(null); setAddSourceId(null); };

  // Open the panel in add mode, inheriting the encounter context (date,
  // initials, call status, notes) from a source entry. Notes are copied
  // verbatim: siblings logged together share one identical notes string, and
  // the encounter-count fallback keys on notes.substring(0,2).
  var startAdd = function(src) {
    setEditId(ADD_SENTINEL);
    setAddSourceId(src.id);
    setEditDate(src.date);
    setEditCode("");
    setEditMods([]);
    setEditNotes(src.notes || "");
    setEditSearch("");
    setEditPatient(src.encounterId || "");
    setEditIsCall(!!src.isCall);
    addSavingRef.current = false;
  };

  // From inside the edit panel: commit the current edits first (so the new
  // sibling inherits exactly what was just saved), then reopen in add mode.
  var addAnother = function() {
    var srcId = editId;
    saveEdit();
    setAddSourceId(srcId);
    setEditId(ADD_SENTINEL);
    setEditCode("");
    setEditMods([]);
    setEditSearch("");
    addSavingRef.current = false;
  };

  // Add-mode save: appends a NEW entry in the Log flow's shape. Unlike
  // saveEdit, an unknown code is refused (the Log flow skips unknown codes;
  // a 0-RVU orphan would be silent junk). Append is not idempotent, so the
  // ref lock guards double-taps; it resets on the next startAdd/addAnother.
  var saveAdd = function() {
    var info = cptMap[editCode];
    if (!info || addSavingRef.current) return;
    addSavingRef.current = true;
    var adj = calcAdj(info.wRVU, editMods);
    var newEntry = {
      id: Date.now().toString() + "-h-" + Math.random().toString(36).slice(2, 8),
      date: editDate,
      cptCode: editCode,
      description: info.desc,
      category: info.category,
      baseRVU: info.wRVU,
      modifiers: editMods.slice(),
      adjustedRVU: adj,
      notes: editNotes,
      encounterId: editPatient || undefined,
      isCall: editIsCall,
      imported: false
    };
    var srcId = addSourceId;
    var pat = editPatient;
    upd(function(prev) {
      var next = prev.entries.concat([newEntry]);
      // Backfill initials onto a source entry that had none so the pair
      // groups into one encounter card. Undo removes only the new entry;
      // the backfilled initials stay (harmless).
      if (pat && srcId) {
        next = next.map(function(x) { return x.id === srcId && !x.encounterId ? { ...x, encounterId: pat } : x; });
      }
      return { ...prev, entries: next };
    });
    showUndo({ type: "log", ids: [newEntry.id], message: "Added " + editCode + " (" + adj.toFixed(2) + " wRVU)" });
    setEditId(null);
    setAddSourceId(null);
  };

  // Snapshot-authoritative save. An edit that does not change the CPT code
  // NEVER re-derives wRVU/description/category from the database - the old
  // path looked the code up on every save and silently wrote 0 for any
  // imported/unknown code (editing just a note destroyed the value). The db
  // is consulted only when the user actively changed to a KNOWN code; a
  // change to an unknown code takes the explicit manual value - never a
  // silent zero. Adjusted is recomputed from the resolved base so modifier
  // edits still apply.
  const saveEdit = () => {
    var orig = data.entries.find(function(e) { return e.id === editId; });
    if (!orig) { setEditId(null); return; }
    var info = cptMap[editCode];
    var codeChanged = editCode !== orig.cptCode;
    var baseRVU, desc, cat;
    if (!codeChanged) {
      baseRVU = orig.baseRVU || 0;
      desc = orig.description;
      cat = orig.category;
    } else if (info) {
      baseRVU = info.wRVU;
      desc = info.desc;
      cat = info.category;
    } else {
      baseRVU = parseFloat(editManualBase);
      if (isNaN(baseRVU)) return; // Save is disabled in this state; backstop
      desc = "CPT " + editCode;
      cat = "Other";
    }
    var adj = calcAdj(baseRVU, editMods);
    upd(prev => ({ ...prev, entries: prev.entries.map(e => e.id === editId ? { ...e, date: editDate, cptCode: editCode, description: desc, category: cat, baseRVU: baseRVU, modifiers: editMods, adjustedRVU: adj, notes: editNotes, encounterId: editPatient || undefined, isCall: editIsCall } : e) }));
    setEditId(null);
  };

  const toggleEditMod = (mc) => { setEditMods(prev => prev.includes(mc) ? prev.filter(m => m !== mc) : [...prev, mc]); };

  const editFiltered = useMemo(() => {
    if (!editSearch.trim()) return [];
    var q = editSearch.toLowerCase();
    return db.filter(c => matchesCPTQuery(c, q)).slice(0, 10);
  }, [editSearch, db]);

  // Edit / add panel (add mode when editId is the sentinel)
  if (editId) {
    var isAddMode = editId === ADD_SENTINEL;
    var editInfo = cptMap[editCode];
    var editOrig = isAddMode ? null : data.entries.find(function(e) { return e.id === editId; });
    var editCodeChanged = editOrig ? editCode !== editOrig.cptCode : false;
    var editUnknownChanged = editCodeChanged && !editInfo;
    // Display mirrors what save will write: db value for a known code,
    // the snapshot for an unchanged unknown code, the manual draft for an
    // actively-changed unknown code. Never a phantom 0.
    var editBase = editInfo ? editInfo.wRVU
      : editUnknownChanged ? (parseFloat(editManualBase) || 0)
      : (editOrig ? (editOrig.baseRVU || 0) : 0);
    var editAdj = calcAdj(editBase, editMods);
    var editSaveDisabled = editUnknownChanged && isNaN(parseFloat(editManualBase));
    return (<div style={S.page}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}><button onClick={cancelEdit} style={S.backBtn}>Back</button><h1 style={{ ...S.title, marginBottom: 0 }}>{isAddMode ? "Add Procedure" : "Edit Procedure"}</h1></div>
      {isAddMode && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: -10, marginBottom: 12 }}>Adding to this encounter - date, patient, and call status are carried over. Pick the CPT code below.</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}><div style={S.fieldGroup}><label style={S.fieldLabel}>Date</label><input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} style={S.searchInput} /></div></div>
        <div style={{ flex: 1 }}><div style={S.fieldGroup}><label style={S.fieldLabel}>Patient ID</label><input type="text" value={editPatient} onChange={function(e) { setEditPatient(e.target.value); }} placeholder="Initials" style={S.searchInput} /></div></div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button onClick={function() { setEditIsCall(false); }} style={{ flex: 1, padding: "8px 12px", borderRadius: 10, border: !editIsCall ? "2px solid #0ea5e9" : "1px solid var(--border-default)", background: !editIsCall ? "rgba(14,165,233,0.1)" : "var(--bg-card)", color: !editIsCall ? "#0ea5e9" : "var(--text-dim)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Private</button>
        <button onClick={function() { setEditIsCall(true); }} style={{ flex: 1, padding: "8px 12px", borderRadius: 10, border: editIsCall ? "2px solid #a78bfa" : "1px solid var(--border-default)", background: editIsCall ? "rgba(139,92,246,0.1)" : "var(--bg-card)", color: editIsCall ? "#a78bfa" : "var(--text-dim)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Call</button>
      </div>
      <div style={S.fieldGroup}><label style={S.fieldLabel}>CPT Code</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1, padding: "8px 12px", background: "var(--bg-card)", border: "1px solid var(--border-default)", borderRadius: 8, color: editCode ? "#0ea5e9" : "var(--text-faint)", fontFamily: "JetBrains Mono", fontWeight: 600 }}>{editCode || "\u2014"}</div>
        </div>
        <input type="text" value={editSearch} onChange={e => setEditSearch(e.target.value)} placeholder={isAddMode ? "Search for the CPT code..." : "Search to change CPT code..."} autoFocus={isAddMode} style={{ ...S.searchInput, marginTop: 8, fontSize: 13 }} />
        {editFiltered.length > 0 && <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 4 }}>{editFiltered.map(c => (<button key={c.code} onClick={() => { setEditCode(c.code); setEditSearch(""); }} style={{ ...S.resultItem, padding: "6px 10px" }}><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "#0ea5e9" }}>{c.code}</span><span style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.wRVU} wRVU</span></div><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.friendly || c.desc}</div>{c.friendly && <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{c.desc}</div>}</button>))}</div>}
        {!isAddMode && /^\d{5}$/.test(editSearch.trim()) && !cptMap[editSearch.trim()] && <button onClick={function() { setEditCode(editSearch.trim()); setEditSearch(""); }} style={{ ...S.resultItem, padding: "6px 10px", marginTop: 4, border: "1px dashed rgba(245,158,11,0.4)" }}><span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "#f59e0b", fontWeight: 600 }}>{editSearch.trim()}</span><span style={{ fontSize: 11, color: "var(--text-muted)", marginLeft: 6 }}>use as entered - not in database, set wRVU below</span></button>}
        {editInfo && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{editInfo.friendly || editInfo.desc}</div>}
        {editInfo && editInfo.friendly && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>{editInfo.desc}</div>}
      </div>
      {editUnknownChanged && <div style={{ padding: "10px 12px", borderRadius: 10, background: "rgba(245,158,11,0.06)", border: "1px solid rgba(245,158,11,0.3)", marginBottom: 10 }}>
        <div style={{ fontSize: 11, color: "#f59e0b", fontWeight: 600, marginBottom: 6 }}>CPT {editCode} is not in the database</div>
        <div style={{ fontSize: 10, color: "var(--text-muted)", marginBottom: 6 }}>Set its wRVU yourself - the prior value ({editOrig ? (editOrig.baseRVU || 0) : 0}) is prefilled, so leaving it keeps that value.</div>
        <input type="text" inputMode="decimal" value={editManualBase} onChange={function(e) { setEditManualBase(e.target.value.replace(/[^0-9.]/g, "")); }} placeholder="wRVU" style={{ ...S.numberInput, fontSize: 13 }} />
      </div>}
      <div style={S.fieldGroup}><label style={S.fieldLabel}>Modifiers</label><div style={S.modGrid}>{MODIFIERS.map(m => <button key={m.code} onClick={() => toggleEditMod(m.code)} style={editMods.includes(m.code) ? S.modBtnActive : S.modBtn}><span style={S.modCode}>{m.code}</span><span style={S.modLabel}>{m.label}</span></button>)}</div></div>
      <div style={{ ...S.card, marginBottom: 12 }}><div style={{ display: "flex", justifyContent: "space-around" }}><div style={{ textAlign: "center" }}><div style={{ fontSize: 11, color: "var(--text-dim)" }}>Base wRVU</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 600 }}>{editBase.toFixed(2)}</div></div>{editMods.length > 0 && <div style={{ textAlign: "center" }}><div style={{ fontSize: 11, color: "var(--text-dim)" }}>Adjusted</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "#0ea5e9", fontWeight: 600 }}>{editAdj.toFixed(2)}</div></div>}<div style={{ textAlign: "center" }}><div style={{ fontSize: 11, color: "var(--text-dim)" }}>Compensation</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "#10b981", fontWeight: 600 }}>${(editAdj * settings.ratePerRVU).toFixed(0)}</div></div></div></div>
      <div style={S.fieldGroup}><label style={S.fieldLabel}>Case Notes</label><textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Complexity, attending, indication, complications..." style={S.notesInput} rows={2} /></div>
      {!isAddMode && <button onClick={addAnother} disabled={editSaveDisabled} style={{ width: "100%", marginBottom: 10, padding: "9px 12px", borderRadius: 10, border: "1px dashed rgba(14,165,233,0.4)", background: "rgba(14,165,233,0.04)", color: "#0ea5e9", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: editSaveDisabled ? 0.4 : 1 }}>+ Save + add another procedure to this encounter</button>}
      <div style={{ display: "flex", gap: 8 }}><button onClick={cancelEdit} style={S.secondaryBtn}>Cancel</button>{isAddMode
        ? <button onClick={saveAdd} disabled={!editInfo} style={{ ...S.saveBtn, flex: 1, opacity: editInfo ? 1 : 0.4 }}>Add Procedure</button>
        : <button onClick={saveEdit} disabled={editSaveDisabled} style={{ ...S.saveBtn, flex: 1, opacity: editSaveDisabled ? 0.4 : 1 }}>Save Changes</button>}</div>
    </div>);
  }

  return (<div style={S.page}>
    <div style={S.header}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}><div><h1 style={S.title}>History</h1><p style={S.subtitle}>{filteredCount === entries.length ? entries.length + " procedures" : filteredCount + " of " + entries.length + " procedures"}  {tF.toFixed(1)} wRVUs{filteredCount < entries.length ? " (filtered)" : ""}</p></div>{filtered.length > 0 && <button onClick={exportFiltered} style={{ padding: "6px 12px", borderRadius: 8, border: "1px solid rgba(16,185,129,0.3)", background: "rgba(16,185,129,0.05)", color: "#10b981", fontSize: 11, fontWeight: 600, cursor: "pointer", whiteSpace: "nowrap", marginTop: 4 }}>Export CSV</button>}</div></div>
    <input type="text" value={filter} onChange={e => setFilter(e.target.value)} placeholder="Search procedures, codes, notes..." style={S.searchInput} />

    {/* Date range filter */}
    <div style={{ marginTop: 8 }}>
      <div style={S.catRow}>{[
        { id: "all", label: "All" },
        { id: "today", label: "Today" },
        { id: "week", label: "Week" },
        { id: "month", label: "Month" },
        { id: "lastMonth", label: "Last Mo" },
        { id: "quarter", label: "Quarter" },
        { id: "ytd", label: "YTD" },
        { id: "custom", label: "Custom" }
      ].map(function(r) { return <button key={r.id} onClick={function() { setDateRange(r.id); }} style={dateRange === r.id ? S.catBtnActive : S.catBtn}>{r.label}</button>; })}</div>
      {dateRange === "custom" && <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
        <div style={{ flex: 1 }}><label style={{ fontSize: 10, color: "var(--text-dim)" }}>From</label><input type="date" value={customStart} onChange={function(e) { setCustomStart(e.target.value); }} style={{ ...S.dateInput, width: "100%", fontSize: 12, padding: "6px 8px" }} /></div>
        <div style={{ flex: 1 }}><label style={{ fontSize: 10, color: "var(--text-dim)" }}>To</label><input type="date" value={customEnd} onChange={function(e) { setCustomEnd(e.target.value); }} style={{ ...S.dateInput, width: "100%", fontSize: 12, padding: "6px 8px" }} /></div>
      </div>}
    </div>

    {/* Type filter + Sort/Group */}
    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>{["all","private","call"].map(function(t) { return <button key={t} onClick={function() { setShowCallFilter(t); }} style={showCallFilter === t ? S.catBtnActive : S.catBtn}>{t === "all" ? "All Types" : t === "private" ? "Private" : "Call"}</button>; })}<div style={{ width: 8 }} />{["date","rvu","code"].map(s => <button key={s} onClick={() => setSortBy(s)} style={sortBy === s ? S.catBtnActive : S.catBtn}>Sort: {s === "rvu" ? "wRVU" : s}</button>)}<div style={{ width: 8 }} />{["date","category","none"].map(g => <button key={g} onClick={() => setGroupBy(g)} style={groupBy === g ? S.catBtnActive : S.catBtn}>Group: {g}</button>)}</div>

    {/* Filtered summary bar */}
    {dateRange !== "all" && <div style={{ marginTop: 8, padding: "6px 12px", borderRadius: 8, background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.15)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 11, color: "#0ea5e9" }}>{filteredCount} procedures | {tF.toFixed(1)} wRVUs | ${(tF * settings.ratePerRVU).toFixed(0)}</span>
      <button onClick={function() { setDateRange("all"); setShowCallFilter("all"); }} style={{ fontSize: 10, color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Clear filters</button>
    </div>}

    <div style={{ marginTop: 12 }}>
      {Object.keys(grouped).length === 0 && <div style={{ textAlign: "center", color: "var(--text-dim)", padding: 40 }}>{entries.length === 0 ? "No procedures logged yet" : "No procedures match your filters"}</div>}
      {Object.entries(grouped).map(([group, items]) => {
        var encounters = groupBy === "date" ? buildEncounters(items) : null;
        return (<div key={group} style={{ marginBottom: 16 }}>
          <div style={S.groupHeader}>{groupBy === "date" ? fmt(group) : group}<span style={{ color: "var(--text-dim)", fontWeight: 400 }}>  {items.reduce((s, e) => s + e.adjustedRVU, 0).toFixed(1)} wRVU  ({items.length})</span></div>
          {encounters ? encounters.map(function(enc, ei) {
            if (enc.type === "single") return renderProcRow(enc.entry, false);
            return (<div key={enc.patient + "-" + ei} style={{ background: "rgba(14,165,233,0.03)", border: "1px solid rgba(14,165,233,0.12)", borderRadius: 10, marginBottom: 6, overflow: "hidden" }}>
              <div style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(14,165,233,0.1)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#0ea5e9" }}>{enc.patient}</span>
                  <span style={{ fontSize: 10, color: "var(--text-dim)" }}>{enc.entries.length} procedures</span>
                  {enc.entries[0].isCall && <span style={{ fontSize: 9, color: "#a78bfa", background: "rgba(139,92,246,0.15)", padding: "1px 5px", borderRadius: 3 }}>call</span>}
                </div>
                <div style={{ textAlign: "right", display: "flex", alignItems: "center", gap: 8 }}>
                  <div>
                    <span style={{ fontSize: 14, fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 700 }}>{enc.totalRVU.toFixed(2)}</span>
                    <span style={{ fontSize: 10, color: "#10b981", fontFamily: "JetBrains Mono", marginLeft: 6 }}>${(enc.totalRVU * settings.ratePerRVU).toFixed(0)}</span>
                  </div>
                  <button onClick={function() { startAdd(enc.entries[0]); }} style={{ padding: "3px 9px", borderRadius: 6, border: "1px solid rgba(14,165,233,0.35)", background: "transparent", color: "#0ea5e9", fontSize: 10, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>+ Add</button>
                </div>
              </div>
              <div style={{ padding: "0 4px" }}>
                {enc.entries.map(function(e) { return renderProcRow(e, true); })}
              </div>
              {enc.entries[0].notes && <div style={{ padding: "4px 12px 8px", fontSize: 11, color: "var(--text-dim)", fontStyle: "italic" }}>{enc.entries[0].notes}</div>}
            </div>);
          }) : items.map(function(e) { return renderProcRow(e, false); })}
        </div>);
      })}
    </div>
  </div>);
}

