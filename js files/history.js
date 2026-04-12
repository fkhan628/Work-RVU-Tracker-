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
    <div style={{ ...S.card, border: "1px solid #334155", cursor: "pointer" }} onClick={() => fRef.current && fRef.current.click()}><input ref={fRef} type="file" accept=".csv,.tsv,.txt" style={{ display: "none" }} onChange={onFile} /><div style={{ textAlign: "center", padding: "24px 0" }}><div style={{ fontSize: 40, marginBottom: 8 }}></div><div style={{ fontSize: 16, fontWeight: 600, color: "#e2e8f0" }}>Upload CSV / Spreadsheet</div><div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Export from RVU Wallet and upload</div></div></div>
    <div style={{ textAlign: "center", color: "#475569", fontSize: 13, margin: "14px 0" }}>- or -</div>
    <div style={{ ...S.card, border: "1px solid #334155", cursor: "pointer" }} onClick={() => setMode("paste")}><div style={{ textAlign: "center", padding: "24px 0" }}><div style={{ fontSize: 40, marginBottom: 8 }}></div><div style={{ fontSize: 16, fontWeight: 600, color: "#e2e8f0" }}>Paste Data</div><div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>Copy rows from a spreadsheet and paste</div></div></div>
    <div style={{ ...S.card, marginTop: 16, background: "#0f172a", border: "1px solid #1e293b" }}><div style={{ ...S.cardLabel, marginBottom: 8 }}>Complete CMS Database</div><div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6 }}>{Object.keys(cptMap).length} preloaded codes  {DATA_VERSION}</div></div>
  </div>);

  if (mode === "paste") return (<div style={S.page}><div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}><button onClick={() => setMode("choose")} style={S.backBtn}></button><h1 style={{ ...S.title, marginBottom: 0 }}>Paste Data</h1></div>
    <textarea value={raw} onChange={e => setRaw(e.target.value)} placeholder={"Date,CPT,Description,wRVU,Modifier\n01/15/2025,47562,Lap cholecystectomy,10.21,"} style={{ ...S.notesInput, minHeight: 200, fontSize: 12, fontFamily: "'JetBrains Mono', monospace", lineHeight: 1.6 }} />
    <div style={{ display: "flex", gap: 8, marginTop: 12 }}><button onClick={() => setMode("choose")} style={S.secondaryBtn}>Cancel</button><button onClick={() => doParse(raw)} disabled={!raw.trim()} style={{ ...S.saveBtn, flex: 1, opacity: raw.trim() ? 1 : 0.4 }}>Parse Data </button></div>
  </div>);

  if (mode === "preview" && parsed) {
    const matched = parsed.entries.filter(e => cptMap[e.cptCode]); const tRVU = parsed.entries.reduce((s, e) => s + e.adjustedRVU, 0);
    return (<div style={S.page}><div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}><button onClick={() => { setMode(raw ? "paste" : "choose"); setParsed(null); }} style={S.backBtn}></button><h1 style={{ ...S.title, marginBottom: 0 }}>Import Preview</h1></div>
      {status === 'ok' && <div style={S.successBanner}> Imported {parsed.entries.length} procedures!</div>}
      <div style={{ ...S.card, background: "linear-gradient(135deg, #1e293b, #0f172a)", border: "1px solid #334155" }}><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>{[[parsed.entries.length, "Procedures", "#f8fafc"], [tRVU.toFixed(0), "Total wRVUs", "#0ea5e9"], [matched.length, "Matched", "#10b981"]].map(([v, l, c]) => (<div key={l} style={{ textAlign: "center" }}><div style={{ fontSize: 26, fontFamily: "JetBrains Mono", fontWeight: 700, color: c }}>{v}</div><div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{l}</div></div>))}</div></div>
      {parsed.errors.length > 0 && <div style={{ background: "rgba(251,191,36,0.1)", border: "1px solid rgba(251,191,36,0.25)", borderRadius: 10, padding: 12, marginBottom: 12 }}><div style={{ fontSize: 12, fontWeight: 600, color: "#fbbf24", marginBottom: 4 }}> Warnings</div>{parsed.errors.slice(0, 5).map((e, i) => <div key={i} style={{ fontSize: 11, color: "#fcd34d", padding: "2px 0" }}>{e}</div>)}</div>}
      <div style={S.card}><div style={S.cardLabel}>Preview ({parsed.entries.length} rows)</div><div style={{ marginTop: 8, maxHeight: 280, overflowY: "auto", scrollbarWidth: "thin" }}>{pEntries.map((e, i) => (<div key={i} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(51,65,85,0.5)" }}><div style={{ flex: 1, minWidth: 0 }}><span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: cptMap[e.cptCode] ? "#0ea5e9" : "#fbbf24", fontWeight: 600 }}>{e.cptCode}</span> <span style={{ fontSize: 10, color: "#64748b" }}>{fmtShort(e.date)}</span><div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{e.description}</div></div><div style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: "#e2e8f0", fontWeight: 600, marginLeft: 8 }}>{e.adjustedRVU.toFixed(2)}</div></div>))}</div>{tPages > 1 && <div style={{ display: "flex", justifyContent: "center", gap: 8, marginTop: 8 }}><button onClick={() => setPage(p => Math.max(0, p-1))} disabled={page === 0} style={{ ...S.pgBtn, opacity: page === 0 ? 0.3 : 1 }}></button><span style={{ fontSize: 11, color: "#64748b", fontFamily: "JetBrains Mono" }}>{page+1}/{tPages}</span><button onClick={() => setPage(p => Math.min(tPages-1, p+1))} disabled={page === tPages-1} style={{ ...S.pgBtn, opacity: page === tPages-1 ? 0.3 : 1 }}></button></div>}</div>
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
  const [dateRange, setDateRange] = useState("all");
  const [customStart, setCustomStart] = useState("");
  const [customEnd, setCustomEnd] = useState("");
  const [showCallFilter, setShowCallFilter] = useState("all");
  const { entries, settings } = data;

  var dateRangeBounds = useMemo(function() {
    var now = new Date();
    var todayStr = now.toISOString().slice(0, 10);
    if (dateRange === "all") return null;
    if (dateRange === "today") return { start: todayStr, end: todayStr };
    if (dateRange === "week") {
      var ws = new Date(now); ws.setDate(now.getDate() - now.getDay()); ws.setHours(0,0,0,0);
      return { start: ws.toISOString().slice(0, 10), end: todayStr };
    }
    if (dateRange === "month") {
      return { start: now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, "0") + "-01", end: todayStr };
    }
    if (dateRange === "lastMonth") {
      var lm = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      var lmEnd = new Date(now.getFullYear(), now.getMonth(), 0);
      return { start: lm.toISOString().slice(0, 10), end: lmEnd.toISOString().slice(0, 10) };
    }
    if (dateRange === "quarter") {
      var qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
      return { start: qStart.toISOString().slice(0, 10), end: todayStr };
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
    if (filter.trim()) { const q = filter.toLowerCase(); items = items.filter(e => e.cptCode.includes(q) || e.description.toLowerCase().includes(q) || e.category.toLowerCase().includes(q) || (e.notes && e.notes.toLowerCase().includes(q))); }
    items.sort((a, b) => { if (sortBy === "rvu") return b.adjustedRVU - a.adjustedRVU; if (sortBy === "code") return a.cptCode.localeCompare(b.cptCode); return new Date(b.date) - new Date(a.date); });
    return items;
  }, [entries, filter, sortBy, dateRangeBounds, showCallFilter]);
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
            {e.imported && <span style={{ fontSize: 9, color: "#64748b", background: "rgba(100,116,139,0.15)", padding: "1px 5px", borderRadius: 3 }}>imported</span>}
            {!compact && e.encounterId && <span style={{ fontSize: 9, color: "#94a3b8", background: "rgba(148,163,184,0.1)", padding: "1px 5px", borderRadius: 3 }}>{e.encounterId}</span>}
          </div>
          <div style={S.histDesc}>{e.description}</div>
          {groupBy !== "date" && <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{fmtShort(e.date)}</div>}
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
      return [e.date, e.cptCode, '"' + (e.description || "").replace(/"/g, '""') + '"', e.category, e.isCall ? "Call" : "Private", e.baseRVU, (e.modifiers || []).join(";"), e.adjustedRVU.toFixed(2), (e.adjustedRVU * settings.ratePerRVU).toFixed(2), e.encounterId || "", '"' + (e.notes || "").replace(/"/g, '""') + '"'];
    });
    var csv = [h.join(",")].concat(rows.map(function(r) { return r.join(","); })).join("\n");
    var b = new Blob([csv], { type: "text/csv" });
    var u = URL.createObjectURL(b);
    var a = document.createElement("a");
    a.href = u;
    var suffix = dateRange !== "all" ? "-" + dateRange : "";
    a.download = "rvu-history" + suffix + "-" + new Date().toISOString().slice(0, 10) + ".csv";
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
  };

  const cancelEdit = () => { setEditId(null); };

  const saveEdit = () => {
    var info = cptMap[editCode];
    var baseRVU = info ? info.wRVU : 0;
    var desc = info ? info.desc : ("CPT " + editCode);
    var cat = info ? info.category : "Other";
    var adj = calcAdj(baseRVU, editMods);
    upd(prev => ({ ...prev, entries: prev.entries.map(e => e.id === editId ? { ...e, date: editDate, cptCode: editCode, description: desc, category: cat, baseRVU: baseRVU, modifiers: editMods, adjustedRVU: adj, notes: editNotes, encounterId: editPatient || undefined, isCall: editIsCall } : e) }));
    setEditId(null);
  };

  const toggleEditMod = (mc) => { setEditMods(prev => prev.includes(mc) ? prev.filter(m => m !== mc) : [...prev, mc]); };

  const editFiltered = useMemo(() => {
    if (!editSearch.trim()) return [];
    var q = editSearch.toLowerCase();
    return db.filter(c => c.code.includes(q) || c.desc.toLowerCase().includes(q) || (c.keywords && c.keywords.toLowerCase().includes(q))).slice(0, 10);
  }, [editSearch, db]);

  // Edit mode
  if (editId) {
    var editInfo = cptMap[editCode];
    var editBase = editInfo ? editInfo.wRVU : 0;
    var editAdj = calcAdj(editBase, editMods);
    return (<div style={S.page}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}><button onClick={cancelEdit} style={S.backBtn}>Back</button><h1 style={{ ...S.title, marginBottom: 0 }}>Edit Procedure</h1></div>
      <div style={{ display: "flex", gap: 8 }}>
        <div style={{ flex: 1 }}><div style={S.fieldGroup}><label style={S.fieldLabel}>Date</label><input type="date" value={editDate} onChange={e => setEditDate(e.target.value)} style={S.searchInput} /></div></div>
        <div style={{ flex: 1 }}><div style={S.fieldGroup}><label style={S.fieldLabel}>Patient ID</label><input type="text" value={editPatient} onChange={function(e) { setEditPatient(e.target.value); }} placeholder="Initials" style={S.searchInput} /></div></div>
      </div>
      <div style={{ display: "flex", gap: 6, marginBottom: 10 }}>
        <button onClick={function() { setEditIsCall(false); }} style={{ flex: 1, padding: "8px 12px", borderRadius: 10, border: !editIsCall ? "2px solid #0ea5e9" : "1px solid #334155", background: !editIsCall ? "rgba(14,165,233,0.1)" : "#1e293b", color: !editIsCall ? "#0ea5e9" : "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Private</button>
        <button onClick={function() { setEditIsCall(true); }} style={{ flex: 1, padding: "8px 12px", borderRadius: 10, border: editIsCall ? "2px solid #a78bfa" : "1px solid #334155", background: editIsCall ? "rgba(139,92,246,0.1)" : "#1e293b", color: editIsCall ? "#a78bfa" : "#64748b", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>Call</button>
      </div>
      <div style={S.fieldGroup}><label style={S.fieldLabel}>CPT Code</label>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div style={{ flex: 1, padding: "8px 12px", background: "#1e293b", border: "1px solid #334155", borderRadius: 8, color: "#0ea5e9", fontFamily: "JetBrains Mono", fontWeight: 600 }}>{editCode}</div>
        </div>
        <input type="text" value={editSearch} onChange={e => setEditSearch(e.target.value)} placeholder="Search to change CPT code..." style={{ ...S.searchInput, marginTop: 8, fontSize: 13 }} />
        {editFiltered.length > 0 && <div style={{ maxHeight: 200, overflowY: "auto", marginTop: 4 }}>{editFiltered.map(c => (<button key={c.code} onClick={() => { setEditCode(c.code); setEditSearch(""); }} style={{ ...S.resultItem, padding: "6px 10px" }}><div style={{ display: "flex", justifyContent: "space-between" }}><span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "#0ea5e9" }}>{c.code}</span><span style={{ fontSize: 11, color: "#94a3b8" }}>{c.wRVU} wRVU</span></div><div style={{ fontSize: 11, color: "#94a3b8" }}>{c.desc}</div></button>))}</div>}
        {editInfo && <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{editInfo.desc}</div>}
      </div>
      <div style={S.fieldGroup}><label style={S.fieldLabel}>Modifiers</label><div style={S.modGrid}>{MODIFIERS.map(m => <button key={m.code} onClick={() => toggleEditMod(m.code)} style={editMods.includes(m.code) ? S.modBtnActive : S.modBtn}><span style={S.modCode}>{m.code}</span><span style={S.modLabel}>{m.label}</span></button>)}</div></div>
      <div style={{ ...S.card, marginBottom: 12 }}><div style={{ display: "flex", justifyContent: "space-around" }}><div style={{ textAlign: "center" }}><div style={{ fontSize: 11, color: "#64748b" }}>Base wRVU</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "#e2e8f0", fontWeight: 600 }}>{editBase.toFixed(2)}</div></div>{editMods.length > 0 && <div style={{ textAlign: "center" }}><div style={{ fontSize: 11, color: "#64748b" }}>Adjusted</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "#0ea5e9", fontWeight: 600 }}>{editAdj.toFixed(2)}</div></div>}<div style={{ textAlign: "center" }}><div style={{ fontSize: 11, color: "#64748b" }}>Compensation</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "#10b981", fontWeight: 600 }}>${(editAdj * settings.ratePerRVU).toFixed(0)}</div></div></div></div>
      <div style={S.fieldGroup}><label style={S.fieldLabel}>Case Notes</label><textarea value={editNotes} onChange={e => setEditNotes(e.target.value)} placeholder="Complexity, attending, indication, complications..." style={S.notesInput} rows={2} /></div>
      <div style={{ display: "flex", gap: 8 }}><button onClick={cancelEdit} style={S.secondaryBtn}>Cancel</button><button onClick={saveEdit} style={{ ...S.saveBtn, flex: 1 }}>Save Changes</button></div>
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
        <div style={{ flex: 1 }}><label style={{ fontSize: 10, color: "#64748b" }}>From</label><input type="date" value={customStart} onChange={function(e) { setCustomStart(e.target.value); }} style={{ ...S.dateInput, width: "100%", fontSize: 12, padding: "6px 8px" }} /></div>
        <div style={{ flex: 1 }}><label style={{ fontSize: 10, color: "#64748b" }}>To</label><input type="date" value={customEnd} onChange={function(e) { setCustomEnd(e.target.value); }} style={{ ...S.dateInput, width: "100%", fontSize: 12, padding: "6px 8px" }} /></div>
      </div>}
    </div>

    {/* Type filter + Sort/Group */}
    <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>{["all","private","call"].map(function(t) { return <button key={t} onClick={function() { setShowCallFilter(t); }} style={showCallFilter === t ? S.catBtnActive : S.catBtn}>{t === "all" ? "All Types" : t === "private" ? "Private" : "Call"}</button>; })}<div style={{ width: 8 }} />{["date","rvu","code"].map(s => <button key={s} onClick={() => setSortBy(s)} style={sortBy === s ? S.catBtnActive : S.catBtn}>Sort: {s === "rvu" ? "wRVU" : s}</button>)}<div style={{ width: 8 }} />{["date","category","none"].map(g => <button key={g} onClick={() => setGroupBy(g)} style={groupBy === g ? S.catBtnActive : S.catBtn}>Group: {g}</button>)}</div>

    {/* Filtered summary bar */}
    {dateRange !== "all" && <div style={{ marginTop: 8, padding: "6px 12px", borderRadius: 8, background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.15)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 11, color: "#0ea5e9" }}>{filteredCount} procedures | {tF.toFixed(1)} wRVUs | ${(tF * settings.ratePerRVU).toFixed(0)}</span>
      <button onClick={function() { setDateRange("all"); setShowCallFilter("all"); }} style={{ fontSize: 10, color: "#64748b", background: "none", border: "none", cursor: "pointer", textDecoration: "underline" }}>Clear filters</button>
    </div>}

    <div style={{ marginTop: 12 }}>
      {Object.keys(grouped).length === 0 && <div style={{ textAlign: "center", color: "#64748b", padding: 40 }}>{entries.length === 0 ? "No procedures logged yet" : "No procedures match your filters"}</div>}
      {Object.entries(grouped).map(([group, items]) => {
        var encounters = groupBy === "date" ? buildEncounters(items) : null;
        return (<div key={group} style={{ marginBottom: 16 }}>
          <div style={S.groupHeader}>{groupBy === "date" ? fmt(group) : group}<span style={{ color: "#64748b", fontWeight: 400 }}>  {items.reduce((s, e) => s + e.adjustedRVU, 0).toFixed(1)} wRVU  ({items.length})</span></div>
          {encounters ? encounters.map(function(enc, ei) {
            if (enc.type === "single") return renderProcRow(enc.entry, false);
            return (<div key={enc.patient + "-" + ei} style={{ background: "rgba(14,165,233,0.03)", border: "1px solid rgba(14,165,233,0.12)", borderRadius: 10, marginBottom: 6, overflow: "hidden" }}>
              <div style={{ padding: "8px 12px", display: "flex", justifyContent: "space-between", alignItems: "center", borderBottom: "1px solid rgba(14,165,233,0.1)" }}>
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 700, color: "#0ea5e9" }}>{enc.patient}</span>
                  <span style={{ fontSize: 10, color: "#64748b" }}>{enc.entries.length} procedures</span>
                  {enc.entries[0].isCall && <span style={{ fontSize: 9, color: "#a78bfa", background: "rgba(139,92,246,0.15)", padding: "1px 5px", borderRadius: 3 }}>call</span>}
                </div>
                <div style={{ textAlign: "right" }}>
                  <span style={{ fontSize: 14, fontFamily: "JetBrains Mono", color: "#e2e8f0", fontWeight: 700 }}>{enc.totalRVU.toFixed(2)}</span>
                  <span style={{ fontSize: 10, color: "#10b981", fontFamily: "JetBrains Mono", marginLeft: 6 }}>${(enc.totalRVU * settings.ratePerRVU).toFixed(0)}</span>
                </div>
              </div>
              <div style={{ padding: "0 4px" }}>
                {enc.entries.map(function(e) { return renderProcRow(e, true); })}
              </div>
              {enc.entries[0].notes && <div style={{ padding: "4px 12px 8px", fontSize: 11, color: "#64748b", fontStyle: "italic" }}>{enc.entries[0].notes}</div>}
            </div>);
          }) : items.map(function(e) { return renderProcRow(e, false); })}
        </div>);
      })}
    </div>
  </div>);
}

