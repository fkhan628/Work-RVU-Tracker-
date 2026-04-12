// =======================================
// SETTINGS (with wRVU Editor)
// =======================================
function Settings({ data, db, cptMap, categories, upd, setView, theme, toggleTheme }) {
  const { settings } = data;
  const [editSearch, setEditSearch] = useState("");
  const [editCat, setEditCat] = useState("All");
  const [showEditor, setShowEditor] = useState(false);
  const [showRestore, setShowRestore] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [backupStatus, setBackupStatus] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [hintText, setHintText] = useState(function() {
    try { return localStorage.getItem("rvu-pin-hint") || ""; } catch(e) { return ""; }
  });
  const [editingHint, setEditingHint] = useState(false);
  const [lastBackupTime, setLastBackupTime] = useState(function() {
    try { return localStorage.getItem("rvu-backup-time") || ""; } catch(e) { return ""; }
  });

  // Auto-backup on mount
  useEffect(function() {
    if (data.entries.length > 0) {
      try {
        var backup = JSON.stringify(data);
        localStorage.setItem("rvu-backup", backup);
        var ts = new Date().toLocaleString();
        localStorage.setItem("rvu-backup-time", ts);
        setLastBackupTime(ts);
      } catch(e) {}
    }
  }, [data]);

  var copyBackup = function() {
    var pin = window.RVU_CRYPTO.getPin();
    if (!pin) { setBackupStatus("PIN session expired. Lock and unlock first."); return; }
    try {
      var backup = JSON.stringify(data);
      setBackupStatus("Encrypting backup...");
      window.RVU_CRYPTO.encrypt(pin, backup).then(function(enc) {
        var encoded = btoa(unescape(encodeURIComponent(JSON.stringify({ encrypted: true, v: 1, payload: enc }))));
        var copyFallback = function() {
          var ta = document.createElement("textarea");
          ta.value = encoded;
          ta.style.cssText = "position:fixed;left:-9999px;top:0;";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          try { document.execCommand("copy"); } catch(e) {}
          document.body.removeChild(ta);
          setBackupStatus("Encrypted backup copied! (" + data.entries.length + " procedures, " + (encoded.length / 1024).toFixed(0) + " KB)");
          setTimeout(function() { setBackupStatus(""); }, 4000);
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(encoded).then(function() {
            setBackupStatus("Encrypted backup copied! (" + data.entries.length + " procedures, " + (encoded.length / 1024).toFixed(0) + " KB)");
            setTimeout(function() { setBackupStatus(""); }, 4000);
          }).catch(function() {
            copyFallback();
          });
        } else {
          copyFallback();
        }
      }).catch(function(e) {
        setBackupStatus("Encryption error: " + e.message);
      });
    } catch(e) {
      setBackupStatus("Error creating backup: " + e.message);
    }
  };

  var doRestore = function() {
    if (!restoreText.trim()) return;
    var pin = window.RVU_CRYPTO.getPin();
    if (!pin) { alert("PIN session expired. Lock and unlock first."); return; }
    try {
      var decoded;
      try {
        decoded = decodeURIComponent(escape(atob(restoreText.trim())));
      } catch(e) {
        decoded = restoreText.trim();
      }
      // Check if this is an encrypted backup
      var parsed;
      try { parsed = JSON.parse(decoded); } catch(e) { alert("Invalid backup code. " + e.message); return; }
      if (parsed.encrypted && parsed.payload) {
        // Encrypted backup - decrypt first
        setBackupStatus("Decrypting backup...");
        window.RVU_CRYPTO.decrypt(pin, parsed.payload).then(function(plaintext) {
          var restored = JSON.parse(plaintext);
          finishRestore(restored);
        }).catch(function(e) {
          alert("Decryption failed. Wrong PIN or corrupted backup. " + e.message);
          setBackupStatus("");
        });
      } else if (parsed.entries) {
        // Legacy unencrypted backup
        finishRestore(parsed);
      } else {
        alert("Invalid backup: no procedure entries found.");
      }
    } catch(e) {
      alert("Could not restore: invalid backup code. " + e.message);
    }
  };

  var finishRestore = function(restored) {
    if (!restored.entries || !Array.isArray(restored.entries)) {
      alert("Invalid backup: no procedure entries found.");
      return;
    }
    var msg = "Restore " + restored.entries.length + " procedures? This will replace your current data (" + data.entries.length + " procedures).";
    if (confirm(msg)) {
      upd(function() {
        return {
          entries: restored.entries || [],
          settings: { ...defSettings(), ...(restored.settings || {}) },
          rvuOverrides: restored.rvuOverrides || {},
          favorites: restored.favorites || [],
          institutionData: restored.institutionData || [],
          dataVersion: restored.dataVersion || DATA_VERSION
        };
      });
      setShowRestore(false);
      setRestoreText("");
      setBackupStatus("");
      alert("Restored " + restored.entries.length + " procedures successfully!");
    }
  };

  const set = (k, v) => upd(prev => ({ ...prev, settings: { ...prev.settings, [k]: v } }));
  const setOverride = (code, val) => upd(prev => {
    const o = { ...prev.rvuOverrides };
    const orig = CPT_DATABASE_DEFAULT.find(c => c.code === code);
    if (orig && Math.abs(val - orig.wRVU) < 0.001) { delete o[code]; } else { o[code] = val; }
    return { ...prev, rvuOverrides: o };
  });
  const resetOverrides = () => { if (confirm("Reset all wRVU values to CMS defaults?")) upd(prev => ({ ...prev, rvuOverrides: {} })); };

  const editFiltered = useMemo(() => {
    let items = db;
    if (editCat !== "All") items = items.filter(c => c.category === editCat);
    if (editSearch.trim()) { const q = editSearch.toLowerCase(); items = items.filter(c => c.code.includes(q) || c.desc.toLowerCase().includes(q) || (c.keywords && c.keywords.toLowerCase().includes(q))); }
    return items;
  }, [db, editCat, editSearch]);

  const expCSV = () => { const h = ["Date","CPT","Description","Category","Base wRVU","Modifiers","Adjusted wRVU","Compensation","Notes"]; const rows = data.entries.map(e => [e.date, e.cptCode, `"${e.description}"`, e.category, e.baseRVU, e.modifiers.join(';'), e.adjustedRVU.toFixed(2), (e.adjustedRVU * settings.ratePerRVU).toFixed(2), `"${e.notes || ''}"`]); const csv = [h.join(','), ...rows.map(r => r.join(','))].join('\n'); const b = new Blob([csv], { type: "text/csv" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `rvu-export-${new Date().toISOString().slice(0,10)}.csv`; a.click(); URL.revokeObjectURL(u); };
  const expJSON = () => { const b = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = `rvu-export-${new Date().toISOString().slice(0,10)}.json`; a.click(); URL.revokeObjectURL(u); };

  const expExcel = () => {
    try {
      var wb = XLSX.utils.book_new();

      // Build monthMap first (needed by multiple sheets)
      var monthMap = {};
      data.entries.forEach(function(e) {
        var key = e.date.slice(0, 7);
        if (!monthMap[key]) monthMap[key] = { rvu: 0, comp: 0, cases: 0 };
        monthMap[key].rvu += e.adjustedRVU;
        monthMap[key].comp += e.adjustedRVU * settings.ratePerRVU;
        monthMap[key].cases += 1;
      });

      // Sheet 1: Institution Comparison (if data exists)
      var instData = data.institutionData || [];
      if (instData.length > 0) {
        var compHeaders = ["Month", "Work RVU (Private)", "Split RVU (Call)", "Institution Total", "Tracked RVUs", "Difference", "Diff %", "Inst Cases", "Tracked Cases"];
        var compSorted = instData.slice().sort(function(a, b) { return a.month.localeCompare(b.month); });
        var compRows = compSorted.map(function(d) {
          var instT = (d.workRVU || 0) + (d.splitRVU || 0);
          var meas = monthMap[d.month];
          var measT = meas ? meas.rvu : 0;
          var measCases = meas ? meas.cases : 0;
          var diff = measT - instT;
          var diffPct = instT > 0 ? ((diff / instT) * 100) : 0;
          return [d.month, parseFloat((d.workRVU || 0).toFixed(2)), parseFloat((d.splitRVU || 0).toFixed(2)), parseFloat(instT.toFixed(2)), parseFloat(measT.toFixed(2)), parseFloat(diff.toFixed(2)), parseFloat(diffPct.toFixed(1)), d.cases || 0, measCases];
        });
        var cTotWork = compRows.reduce(function(s, r) { return s + r[1]; }, 0);
        var cTotSplit = compRows.reduce(function(s, r) { return s + r[2]; }, 0);
        var cTotInst = compRows.reduce(function(s, r) { return s + r[3]; }, 0);
        var cTotMeas = compRows.reduce(function(s, r) { return s + r[4]; }, 0);
        var cTotDiff = cTotMeas - cTotInst;
        var cTotPct = cTotInst > 0 ? ((cTotDiff / cTotInst) * 100) : 0;
        var cTotICases = compRows.reduce(function(s, r) { return s + r[7]; }, 0);
        var cTotTCases = compRows.reduce(function(s, r) { return s + r[8]; }, 0);
        compRows.push(["TOTAL", parseFloat(cTotWork.toFixed(2)), parseFloat(cTotSplit.toFixed(2)), parseFloat(cTotInst.toFixed(2)), parseFloat(cTotMeas.toFixed(2)), parseFloat(cTotDiff.toFixed(2)), parseFloat(cTotPct.toFixed(1)), cTotICases, cTotTCases]);
        var compData = [compHeaders].concat(compRows);
        var ws3 = XLSX.utils.aoa_to_sheet(compData);
        ws3["!cols"] = [{ wch: 10 }, { wch: 17 }, { wch: 15 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 11 }, { wch: 13 }];
        XLSX.utils.book_append_sheet(wb, ws3, "Institution Comparison");
      }

      // Sheet 2: All Procedures
      var procHeaders = ["Date", "CPT Code", "Description", "Category", "Type", "Base wRVU", "Modifiers", "Adjusted wRVU", "Compensation", "Patient", "Notes"];
      var procRows = data.entries.slice().sort(function(a, b) { return a.date.localeCompare(b.date); }).map(function(e) {
        return [e.date, e.cptCode, e.description, e.category, e.isCall ? "Call" : "Private", e.baseRVU, (e.modifiers || []).join(", "), parseFloat(e.adjustedRVU.toFixed(2)), parseFloat((e.adjustedRVU * settings.ratePerRVU).toFixed(2)), e.encounterId || "", e.notes || ""];
      });
      var procData = [procHeaders].concat(procRows);
      var ws1 = XLSX.utils.aoa_to_sheet(procData);
      ws1["!cols"] = [{ wch: 11 }, { wch: 8 }, { wch: 40 }, { wch: 22 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 8 }, { wch: 30 }];
      XLSX.utils.book_append_sheet(wb, ws1, "Procedures");

      // Sheet 3: Monthly Summary
      var monthKeys = Object.keys(monthMap).sort();
      var sumHeaders = ["Month", "Tracked wRVUs", "Cases", "Avg wRVU/Case", "Compensation"];
      var sumRows = monthKeys.map(function(k) {
        var m = monthMap[k];
        return [k, parseFloat(m.rvu.toFixed(2)), m.cases, parseFloat((m.rvu / Math.max(m.cases, 1)).toFixed(2)), parseFloat(m.comp.toFixed(2))];
      });
      var sumTotRVU = sumRows.reduce(function(s, r) { return s + r[1]; }, 0);
      var sumTotCases = sumRows.reduce(function(s, r) { return s + r[2]; }, 0);
      var sumTotComp = sumRows.reduce(function(s, r) { return s + r[4]; }, 0);
      sumRows.push(["TOTAL", parseFloat(sumTotRVU.toFixed(2)), sumTotCases, parseFloat((sumTotRVU / Math.max(sumTotCases, 1)).toFixed(2)), parseFloat(sumTotComp.toFixed(2))]);
      var sumData = [sumHeaders].concat(sumRows);
      var ws2 = XLSX.utils.aoa_to_sheet(sumData);
      ws2["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 14 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Monthly Summary");

      // Sheet 4: Top Procedures
      var codeMap = {};
      data.entries.forEach(function(e) {
        if (!codeMap[e.cptCode]) codeMap[e.cptCode] = { code: e.cptCode, desc: e.description, cat: e.category, count: 0, totalRVU: 0 };
        codeMap[e.cptCode].count += 1;
        codeMap[e.cptCode].totalRVU += e.adjustedRVU;
      });
      var topList = Object.values(codeMap).sort(function(a, b) { return b.totalRVU - a.totalRVU; });
      var topHeaders = ["CPT Code", "Description", "Category", "Times Logged", "Total wRVUs", "Avg wRVU", "Total Compensation"];
      var topRows = topList.map(function(t) {
        return [t.code, t.desc, t.cat, t.count, parseFloat(t.totalRVU.toFixed(2)), parseFloat((t.totalRVU / t.count).toFixed(2)), parseFloat((t.totalRVU * settings.ratePerRVU).toFixed(2))];
      });
      var topData = [topHeaders].concat(topRows);
      var ws4 = XLSX.utils.aoa_to_sheet(topData);
      ws4["!cols"] = [{ wch: 10 }, { wch: 40 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws4, "Top Procedures");

      // Write file
      XLSX.writeFile(wb, "RVU-Export-" + new Date().toISOString().slice(0, 10) + ".xlsx");
    } catch (e) {
      alert("Excel export failed: " + e.message);
    }
  };
  const clear = () => { if (confirm("Delete all logged procedures? This cannot be undone.")) upd(prev => ({ ...prev, entries: [] })); };

  const removeDuplicates = () => {
    var seen = {};
    var unique = [];
    var dupeCount = 0;
    data.entries.forEach(function(e) {
      var key = e.date + '|' + e.cptCode + '|' + (e.modifiers || []).sort().join(',');
      if (!seen[key]) {
        seen[key] = true;
        unique.push(e);
      } else {
        dupeCount++;
      }
    });
    if (dupeCount === 0) {
      alert("No duplicates found!");
    } else if (confirm("Found " + dupeCount + " duplicate(s). Remove them?")) {
      upd(function(prev) { return { ...prev, entries: unique }; });
      alert("Removed " + dupeCount + " duplicate(s). " + unique.length + " entries remaining.");
    }
  };

  const tRVU = data.entries.reduce((s, e) => s + e.adjustedRVU, 0);
  const avg = data.entries.length > 0 ? tRVU / data.entries.length : 0;
  const overrideCount = Object.keys(data.rvuOverrides).length;

  return (<div style={S.page}>
    <div style={S.header}><h1 style={S.title}>Settings</h1></div>

    {/* Theme toggle */}
    <div style={S.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={S.cardLabel}>Appearance</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>{theme === "dark" ? "Dark mode" : "Light mode"}</div>
        </div>
        <button onClick={toggleTheme} style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid #334155", background: theme === "dark" ? "#1e293b" : "rgba(14,165,233,0.1)", color: theme === "dark" ? "#e2e8f0" : "#0ea5e9", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 16 }}>{theme === "dark" ? "\u2600" : "\u263D"}</span>
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
      </div>
    </div>

    {/* Security */}
    <div style={{ ...S.card, border: "1px solid rgba(16,185,129,0.2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={S.cardLabel}>Security</div>
          <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>PIN lock with AES-256-GCM encryption</div>
        </div>
        <button onClick={() => { if (window.RVU_CRYPTO && window.RVU_CRYPTO.lock) window.RVU_CRYPTO.lock(); }} style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }}>{"\uD83D\uDD12"}</span>
          Lock Now
        </button>
      </div>
      <div style={{ fontSize: 11, color: "#475569", marginTop: 8, lineHeight: 1.5 }}>Auto-locks after 5 min of inactivity. API key is encrypted at rest. Backups are AES encrypted with your PIN.</div>
      <div style={{ marginTop: 10, padding: "10px 12px", background: "rgba(15,23,42,0.5)", borderRadius: 8, border: "1px solid #1e293b" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 12, color: "#94a3b8", fontWeight: 600 }}>Recovery Hint</div>
          <button onClick={() => setEditingHint(!editingHint)} style={{ background: "none", border: "none", color: "#0ea5e9", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>{editingHint ? "Cancel" : (hintText ? "Edit" : "Add")}</button>
        </div>
        {!editingHint ? (
          <div style={{ fontSize: 12, color: hintText ? "#e2e8f0" : "#475569", marginTop: 4, fontStyle: hintText ? "normal" : "italic" }}>{hintText || "No hint set"}</div>
        ) : (
          <div style={{ marginTop: 6 }}>
            <input type="text" maxLength={100} value={hintText} onChange={e => setHintText(e.target.value)} placeholder="e.g. Birthday year + house number" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid #334155", background: "#0f172a", color: "#e2e8f0", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button onClick={() => { try { if (hintText.trim()) localStorage.setItem("rvu-pin-hint", hintText.trim()); else localStorage.removeItem("rvu-pin-hint"); } catch(e) {} setEditingHint(false); }} style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "none", background: "#0ea5e9", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Save Hint</button>
              {hintText && <button onClick={() => { setHintText(""); try { localStorage.removeItem("rvu-pin-hint"); } catch(e) {} setEditingHint(false); }} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid #334155", background: "none", color: "#ef4444", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Remove</button>}
            </div>
          </div>
        )}
      </div>
    </div>

    <div style={S.card}><div style={S.cardLabel}>Compensation Rate</div><div style={S.fieldGroup}><label style={S.fieldLabel}>$ per wRVU</label><input type="text" inputMode="decimal" value={settings.ratePerRVU === 0 ? "" : String(settings.ratePerRVU)} onChange={e => { const v = e.target.value.replace(/[^0-9.]/g, ''); if (v === '' || v === '.') { set("ratePerRVU", v); } else if (v.endsWith('.') || v.endsWith('.0') || v.endsWith('.00') || (v.includes('.') && v.endsWith('0'))) { set("ratePerRVU", v); } else { set("ratePerRVU", parseFloat(v) || 0); } }} placeholder="0" style={S.numberInput} /></div></div>
    <div style={S.card}><div style={S.cardLabel}>Annual Goal</div><div style={S.fieldGroup}><label style={S.fieldLabel}>Target wRVUs per year</label><input type="text" inputMode="decimal" value={settings.annualGoal === 0 ? "" : String(settings.annualGoal)} onChange={e => { const v = e.target.value.replace(/[^0-9.]/g, ''); if (v === '' || v === '.') { set("annualGoal", v); } else if (v.endsWith('.') || v.endsWith('.0') || v.endsWith('.00') || (v.includes('.') && v.endsWith('0'))) { set("annualGoal", v); } else { set("annualGoal", parseFloat(v) || 0); } }} placeholder="0" style={S.numberInput} /></div><div style={S.fieldGroup}><label style={S.fieldLabel}>Year Start Date</label><input type="date" value={settings.yearStart} onChange={e => set("yearStart", e.target.value)} style={S.dateInput} /></div></div>

    {/* API Key for Scan Features - Encrypted */}
    <div style={{ ...S.card, border: hasApiKey(settings) ? "1px solid rgba(16,185,129,0.3)" : "1px solid rgba(245,158,11,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={S.cardLabel}>AI Scan Features</div>
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: hasApiKey(settings) ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.15)", color: hasApiKey(settings) ? "#10b981" : "#f59e0b" }}>{hasApiKey(settings) ? "Active" : "Not configured"}</span>
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4, lineHeight: 1.5 }}>Enter an Anthropic API key to enable scanning operative notes and clinic schedules. Get a key at console.anthropic.com</div>
      {hasApiKey(settings) && !showApiKeyInput ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "#0f172a", borderRadius: 8, border: "1px solid #334155" }}>
            <span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "#64748b", letterSpacing: 2, flex: 1 }}>{"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}{settings.apiKeyLast4 || "\u2022\u2022\u2022\u2022"}</span>
            <span style={{ fontSize: 9, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "2px 6px", borderRadius: 3 }}>AES-256</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1, fontSize: 11, color: "#64748b", lineHeight: 1.4 }}>Key is AES-256-GCM encrypted with your PIN.</div>
            <button onClick={() => { setShowApiKeyInput(true); setNewApiKey(""); }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #334155", background: "transparent", color: "#94a3b8", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>Change</button>
            <button onClick={() => { upd(prev => { var s = { ...prev.settings }; delete s.encryptedApiKey; delete s.apiKey; delete s.apiKeyLast4; return { ...prev, settings: s }; }); }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid #334155", background: "transparent", color: "#ef4444", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>Remove</button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={S.fieldGroup}>
            <label style={S.fieldLabel}>API Key</label>
            <input type="password" value={newApiKey} onChange={e => setNewApiKey(e.target.value.trim())} placeholder="sk-ant-..." style={{ ...S.searchInput, fontFamily: "JetBrains Mono", fontSize: 12 }} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button disabled={!newApiKey || newApiKey.length < 10} onClick={() => { encryptAndStoreApiKey(newApiKey, upd).then(() => { setNewApiKey(""); setShowApiKeyInput(false); }); }} style={{ ...S.saveBtn, flex: 1, opacity: newApiKey.length >= 10 ? 1 : 0.4, padding: "8px 12px", fontSize: 12 }}>Encrypt & Save Key</button>
            {hasApiKey(settings) && <button onClick={() => { setShowApiKeyInput(false); setNewApiKey(""); }} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid #334155", background: "transparent", color: "#94a3b8", fontSize: 12, cursor: "pointer" }}>Cancel</button>}
          </div>
        </div>
      )}
    </div>

    {/* wRVU Editor */}
    <div style={S.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={S.cardLabel}>wRVU Values Editor</div>
        <button onClick={() => setShowEditor(!showEditor)} style={S.linkBtn}>{showEditor ? "Hide" : "Edit Values"}</button>
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4 }}>
        Data: CMS CY{DATA_YEAR} PFS  {db.length} codes  {overrideCount > 0 ? `${overrideCount} custom override(s)` : "No overrides"}
      </div>
      {showEditor && <>
        <input type="text" value={editSearch} onChange={e => setEditSearch(e.target.value)} placeholder="Search codes to edit..." style={{ ...S.searchInput, marginTop: 10, fontSize: 13 }} />
        <div style={{ ...S.catRow, marginTop: 6 }}><button onClick={() => setEditCat("All")} style={editCat === "All" ? S.catBtnActive : S.catBtn}>All</button>{categories.map(c => <button key={c} onClick={() => setEditCat(c)} style={editCat === c ? S.catBtnActive : S.catBtn}>{c}</button>)}</div>
        <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 8, scrollbarWidth: "thin", scrollbarColor: "#334155 transparent" }}>
          {editFiltered.slice(0, 30).map(cpt => {
            const orig = CPT_DATABASE_DEFAULT.find(c => c.code === cpt.code);
            const isOverridden = data.rvuOverrides[cpt.code] !== undefined;
            return (<div key={cpt.code} style={{ display: "flex", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(51,65,85,0.4)", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: isOverridden ? "#fbbf24" : "#0ea5e9", fontWeight: 600 }}>{cpt.code}</span>
                  {isOverridden && <span style={{ fontSize: 9, color: "#fbbf24", background: "rgba(251,191,36,0.1)", padding: "1px 5px", borderRadius: 3 }}>custom</span>}
                </div>
                <div style={{ fontSize: 11, color: "#94a3b8", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cpt.desc}</div>
              </div>
              <input type="text" inputMode="decimal" value={cpt.wRVU} onChange={e => { const v = parseFloat(e.target.value); if (!isNaN(v) && v >= 0) setOverride(cpt.code, v); }} style={{ width: 65, padding: "4px 6px", background: isOverridden ? "rgba(251,191,36,0.1)" : "#0f172a", border: `1px solid ${isOverridden ? "rgba(251,191,36,0.3)" : "#334155"}`, borderRadius: 6, color: "#f8fafc", fontSize: 13, fontFamily: "JetBrains Mono", fontWeight: 600, textAlign: "right", outline: "none" }} />
            </div>);
          })}
          {editFiltered.length > 30 && <div style={{ fontSize: 11, color: "#475569", padding: 8, textAlign: "center" }}>Showing 30 of {editFiltered.length} - narrow your search</div>}
        </div>
        {overrideCount > 0 && <button onClick={resetOverrides} style={{ ...S.dangerBtn, width: "100%", marginTop: 8, fontSize: 12, padding: "8px 12px" }}>Reset All to CMS Defaults</button>}
      </>}
    </div>

    <div style={S.card}><div style={S.cardLabel}>Summary Stats</div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>{[["Total Cases", data.entries.length, "#e2e8f0"], ["Total wRVUs", tRVU.toFixed(1), "#e2e8f0"], ["Avg wRVU/Case", avg.toFixed(2), "#0ea5e9"], ["Total Comp", "$" + (tRVU * settings.ratePerRVU).toLocaleString(), "#10b981"]].map(([l, v, c]) => (<div key={l}><div style={{ fontSize: 11, color: "#64748b" }}>{l}</div><div style={{ fontSize: 20, fontFamily: "JetBrains Mono", color: c, fontWeight: 600 }}>{v}</div></div>))}</div></div>
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}><button onClick={expExcel} style={{ ...S.secondaryBtn, color: "#10b981", borderColor: "rgba(16,185,129,0.3)" }}>Export Excel</button><button onClick={expCSV} style={S.secondaryBtn}>Export CSV</button><button onClick={expJSON} style={S.secondaryBtn}>JSON</button></div>

    {/* Backup & Restore */}
    <div style={{ ...S.card, border: "1px solid rgba(14,165,233,0.3)" }}>
      <div style={S.cardLabel}>Backup & Restore</div>
      <div style={{ fontSize: 12, color: "#94a3b8", marginTop: 4, lineHeight: 1.5 }}>Backups are AES-256 encrypted with your PIN. Paste the code on any device and enter your PIN to restore.</div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={copyBackup} style={{ ...S.secondaryBtn, flex: 1, color: "#0ea5e9", borderColor: "rgba(14,165,233,0.3)" }}>{"\uD83D\uDD12"} Copy Encrypted Backup</button>
        <button onClick={function() { setShowRestore(!showRestore); }} style={{ ...S.secondaryBtn, flex: 1 }}>{showRestore ? "Cancel" : "Restore"}</button>
      </div>
      {backupStatus && <div style={{ fontSize: 12, color: "#10b981", marginTop: 6, textAlign: "center" }}>{backupStatus}</div>}
      {showRestore && <div style={{ marginTop: 10 }}>
        <textarea value={restoreText} onChange={function(e) { setRestoreText(e.target.value); }} placeholder="Paste your backup code here..." style={{ ...S.notesInput, minHeight: 80, fontSize: 11, fontFamily: "JetBrains Mono" }} />
        <button onClick={doRestore} disabled={!restoreText.trim()} style={{ ...S.saveBtn, width: "100%", marginTop: 8, opacity: restoreText.trim() ? 1 : 0.4 }}>Restore Data</button>
      </div>}
      {lastBackupTime && <div style={{ fontSize: 10, color: "#475569", marginTop: 6 }}>Last auto-backup: {lastBackupTime}</div>}
    </div>

    <div style={{ marginTop: 8 }}><button onClick={removeDuplicates} style={{ ...S.secondaryBtn, width: "100%", color: "#fbbf24", borderColor: "rgba(251,191,36,0.3)" }}>Remove Duplicates</button></div>
    <div style={{ marginTop: 8 }}><button onClick={clear} style={{ ...S.dangerBtn, width: "100%" }}>Clear All Data</button></div>
  </div>);
}
