// =======================================
// ANALYTICS / TRENDS
// =======================================
// Acute cross-check flag threshold, in wRVU. Rationale lives on the
// crossCheck memo inside Analytics.
var CROSSCHECK_FLAG = 0.75;

function Analytics({ data, db, setView, showComp, toggleComp }) {
  var [selectedYear, setSelectedYear] = useState("current");
  var [detailMonth, setDetailMonth] = useState(null);
  var [showSummary, setShowSummary] = useState(false);
  var [summaryMonth, setSummaryMonth] = useState(function() {
    var n = new Date();
    return n.getFullYear() + "-" + String(n.getMonth() + 1).padStart(2, "0");
  });
  var [copyStatus, setCopyStatus] = useState("");
  var entries = data.entries;
  var settings = data.settings;
  var goal = settings.annualGoal || 0;
  var rate = settings.ratePerRVU || 0;

  // Calculate year boundaries
  var yearStart = settings.yearStart || (new Date().getFullYear() + "-01-01");
  var yearStartDate = new Date(yearStart + "T00:00:00");
  var yearEndDate = new Date(yearStartDate);
  yearEndDate.setFullYear(yearEndDate.getFullYear() + 1);

  var now = new Date();

  // Year chips share the Dashboard's derivation (utils.js availableDataYears)
  // so the two chip rows always offer the same set.
  var availableYears = useMemo(function() {
    return availableDataYears(data);
  }, [data.entries, data.institutionData, data.acuteMonths]);
  var isCurrent = selectedYear === "current";
  var year = isCurrent ? String(now.getFullYear()) : selectedYear;

  // Scope predicates - pure string math on "YYYY-MM-DD" / "YYYY-MM" keys.
  // "Current" mirrors the Dashboard: the yearStart..+1yr window (identical to
  // the calendar year when yearStart is Jan 1); prior chips are calendar years.
  var yearEndStr = (parseInt(yearStart.slice(0, 4), 10) + 1) + yearStart.slice(4);
  var inSelectedYear = function(dateStr) {
    if (isCurrent) return dateStr >= yearStart && dateStr < yearEndStr;
    return dateStr.slice(0, 4) === year;
  };
  var monthInSelectedYear = function(mk) {
    if (isCurrent) return mk >= yearStart.slice(0, 7) && mk < yearEndStr.slice(0, 7);
    return mk.slice(0, 4) === year;
  };

  // Friendly labels only - every wRVU figure below comes from the entries'
  // snapshotted values, never re-looked-up from the CPT db.
  var cptMapLocal = useMemo(function() { return buildCPTMap(db); }, [db]);

  var filteredEntries = useMemo(function() {
    return entries.filter(function(e) { return inSelectedYear(e.date); });
  }, [entries, selectedYear, yearStart]);

  // Monthly breakdown
  var monthlyData = useMemo(function() {
    var months = {};
    filteredEntries.forEach(function(e) {
      var key = e.date.slice(0, 7);
      if (!months[key]) months[key] = { key: key, rvu: 0, comp: 0, count: 0, entries: [] };
      months[key].rvu += e.adjustedRVU;
      months[key].comp += e.adjustedRVU * rate;
      months[key].count++;
      months[key].entries.push(e);
    });
    return Object.values(months).sort(function(a, b) { return a.key.localeCompare(b.key); });
  }, [filteredEntries, rate]);
  var selTotal = filteredEntries.reduce(function(s, e) { return s + e.adjustedRVU; }, 0);
  var selComp = selTotal * rate;

  // YTD totals
  var ytdEntries = entries.filter(function(e) {
    var d = new Date(e.date + "T00:00:00");
    return d >= yearStartDate && d < yearEndDate;
  });
  var ytdRVU = ytdEntries.reduce(function(s, e) { return s + e.adjustedRVU; }, 0);

  // Pace calculations
  var daysPassed = Math.max(1, Math.floor((now - yearStartDate) / 86400000));
  var daysInYear = Math.floor((yearEndDate - yearStartDate) / 86400000);
  var daysRemaining = Math.max(0, daysInYear - daysPassed);
  var monthsRemaining = Math.max(0.5, daysRemaining / 30.44);
  var expectedRVU = goal > 0 ? (goal * daysPassed / daysInYear) : 0;
  var rvuNeeded = Math.max(0, goal - ytdRVU);
  var rvuPerMonthNeeded = monthsRemaining > 0 ? rvuNeeded / monthsRemaining : 0;
  var projectedAnnual = daysPassed > 0 ? (ytdRVU / daysPassed * daysInYear) : 0;
  var avgMonthly = monthlyData.length > 0 ? monthlyData.reduce(function(s, m) { return s + m.rvu; }, 0) / monthlyData.length : 0;
  var avgWeekly = daysPassed > 7 ? (ytdRVU / daysPassed * 7) : ytdRVU;
  var avgDaily = daysPassed > 0 ? ytdRVU / daysPassed : 0;

  // Top procedures by encounter frequency (grouped by procedure combination)
  var topProcs = useMemo(function() {
    // Group entries into encounters
    var encounters = {};
    filteredEntries.forEach(function(e) {
      var pid = e.encounterId || (e.notes && e.notes.substring(0, 2).trim());
      var key = (pid && pid.length >= 2) ? (e.date + "|" + pid.toUpperCase()) : ("solo|" + e.id);
      if (!encounters[key]) encounters[key] = [];
      encounters[key].push(e);
    });
    // For each encounter, build a sorted code combination
    var combos = {};
    Object.values(encounters).forEach(function(encEntries) {
      // Sort by RVU descending so primary procedure comes first
      var sorted = encEntries.slice().sort(function(a, b) { return b.adjustedRVU - a.adjustedRVU; });
      var codes = sorted.map(function(e) { return e.cptCode; });
      var comboKey = codes.join("+");
      var encRVU = sorted.reduce(function(s, e) { return s + e.adjustedRVU; }, 0);
      if (!combos[comboKey]) {
        combos[comboKey] = {
          key: comboKey,
          primaryCode: sorted[0].cptCode,
          primaryDesc: sorted[0].description,
          codes: codes,
          addons: codes.length > 1 ? codes.slice(1) : [],
          count: 0,
          totalRVU: 0
        };
      }
      combos[comboKey].count++;
      combos[comboKey].totalRVU += encRVU;
    });
    return Object.values(combos).sort(function(a, b) { return b.count - a.count; }).slice(0, 10);
  }, [filteredEntries]);

  // 1. CASE MIX - per-category procedure counts and snapshotted wRVU totals.
  // "Case" = procedure entry here (per-category encounter attribution would
  // be invented math); shares are over ALL categories so they sum to 100%.
  var caseMix = useMemo(function() {
    var cats = {};
    var totalProcs = 0, totalRVU = 0;
    filteredEntries.forEach(function(e) {
      var cat = e.category || "Other";
      if (!cats[cat]) cats[cat] = { name: cat, rvu: 0, count: 0 };
      cats[cat].rvu += e.adjustedRVU;
      cats[cat].count++;
      totalProcs++;
      totalRVU += e.adjustedRVU;
    });
    return { list: Object.values(cats).sort(function(a, b) { return b.rvu - a.rvu; }), totalProcs: totalProcs, totalRVU: totalRVU };
  }, [filteredEntries]);

  // 2. TOP CODES by total snapshotted wRVU (individual CPTs, unlike the
  // combo-based Top Encounters card).
  var topCodes = useMemo(function() {
    var m = {};
    filteredEntries.forEach(function(e) {
      if (!m[e.cptCode]) m[e.cptCode] = { code: e.cptCode, desc: e.description, count: 0, rvu: 0 };
      m[e.cptCode].count++;
      m[e.cptCode].rvu += e.adjustedRVU;
    });
    return Object.values(m).sort(function(a, b) { return b.rvu - a.rvu; }).slice(0, 10);
  }, [filteredEntries]);

  // 3. WRVU PER ENCOUNTER TREND - months with zero encounters are skipped,
  // not plotted as zero: an empty month has no average.
  var encTrend = useMemo(function() {
    var byMonth = {};
    filteredEntries.forEach(function(e) {
      var mk = e.date.slice(0, 7);
      if (!byMonth[mk]) byMonth[mk] = [];
      byMonth[mk].push(e);
    });
    return Object.keys(byMonth).sort().map(function(mk) {
      var arr = byMonth[mk];
      var encs = countEncounters(arr);
      var rvu = arr.reduce(function(s, e) { return s + e.adjustedRVU; }, 0);
      return { key: mk, encs: encs, avg: encs > 0 ? rvu / encs : 0 };
    }).filter(function(p) { return p.encs > 0; });
  }, [filteredEntries]);

  // 6. DAY OF WEEK - weekday from LOCAL date parts of "YYYY-MM-DD". Never
  // new Date(dateString): date-only strings parse as UTC midnight and shift
  // evening dates a day at this timezone (the Batch-1 trap).
  var dayOfWeek = useMemo(function() {
    var counts = [0, 0, 0, 0, 0, 0, 0];
    var rvus = [0, 0, 0, 0, 0, 0, 0];
    filteredEntries.forEach(function(e) {
      var p = e.date.split("-");
      var wd = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10)).getDay();
      counts[wd]++;
      rvus[wd] += e.adjustedRVU;
    });
    var order = [1, 2, 3, 4, 5, 6, 0];
    var names = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
    return order.map(function(i) { return { name: names[i], count: counts[i], rvu: rvus[i] }; });
  }, [filteredEntries]);

  // 4. VALUE PER SHIFT - all acute months, spans years by design.
  // computeAcuteSplit only; a month with pool but no shifts shows a dash.
  var shiftValueSeries = useMemo(function() {
    return Object.keys(data.acuteMonths || {}).sort().map(function(mk) {
      var sp = computeAcuteSplit(data.acuteMonths[mk]);
      return { key: mk, vpu: sp.empty ? null : sp.valuePerUnit };
    });
  }, [data.acuteMonths]);

  // 5. ACUTE CROSS-CHECK - Compare's stored call figure vs my computed share,
  // selected year. Flag threshold 0.75: the institution workbook stores
  // 2-decimal figures, but integer-class values occur in live data (Apr '26
  // displays C:38 against a computed 38.52), so 0.5 would false-flag a
  // matching integer-stored month (max honest gap ~0.51); 0.75 clears that
  // and still catches the ~1.2 restatement class. totalOnly months skipped -
  // their work/call split is unknown by construction.
  var crossCheck = useMemo(function() {
    var me = data.acuteMe || "";
    if (!me) return { rows: [], noMe: true, skipped: 0, cum: 0 };
    var instByMonth = {};
    (data.institutionData || []).forEach(function(r) { if (r && r.month) instByMonth[r.month] = r; });
    var rows = [];
    var skipped = 0;
    var cum = 0;
    Object.keys(data.acuteMonths || {}).sort().forEach(function(mk) {
      if (!monthInSelectedYear(mk)) return;
      var inst = instByMonth[mk];
      if (!inst) return;
      if (inst.totalOnly) { skipped++; return; }
      var sp = computeAcuteSplit(data.acuteMonths[mk]);
      if (sp.empty) return;
      var myShare = round2(sp.shares[me] || 0);
      var instCall = inst.splitRVU || 0;
      var diff = round2(myShare - instCall);
      cum += diff;
      rows.push({ key: mk, inst: instCall, share: myShare, diff: diff, flag: Math.abs(diff) > CROSSCHECK_FLAG });
    });
    return { rows: rows, noMe: false, skipped: skipped, cum: round2(cum) };
  }, [data.acuteMonths, data.institutionData, data.acuteMe, selectedYear, yearStart]);

  var maxMonthRVU = monthlyData.reduce(function(m, d) { return Math.max(m, d.rvu); }, 0);
  var emptyHint = { fontSize: 11, color: "#64748b", padding: "6px 0" };

  var monthLabel = function(key) {
    var parts = key.split("-");
    var names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return names[parseInt(parts[1]) - 1] + " " + parts[0].slice(2);
  };

  // Monthly summary data. MUST stay above the detailMonth early return: a
  // hook below a conditional return renders fewer hooks on detail views and
  // crashes React (rules of hooks).
  var summaryData = useMemo(function() {
    var mEntries = entries.filter(function(e) { return e.date.slice(0, 7) === summaryMonth; });
    var totalRVU = mEntries.reduce(function(s, e) { return s + e.adjustedRVU; }, 0);
    var totalComp = totalRVU * rate;
    var caseCount = countEncounters(mEntries);
    var avgRVU = caseCount > 0 ? totalRVU / caseCount : 0;
    var privateEntries = mEntries.filter(function(e) { return !e.isCall; });
    var callEntries = mEntries.filter(function(e) { return e.isCall; });
    var privateRVU = privateEntries.reduce(function(s, e) { return s + e.adjustedRVU; }, 0);
    var callRVU = callEntries.reduce(function(s, e) { return s + e.adjustedRVU; }, 0);
    // Group by encounter for top procedure combinations
    var mEncounters = {};
    mEntries.forEach(function(e) {
      var pid = e.encounterId || (e.notes && e.notes.substring(0, 2).trim());
      var key = (pid && pid.length >= 2) ? (e.date + "|" + pid.toUpperCase()) : ("solo|" + e.id);
      if (!mEncounters[key]) mEncounters[key] = [];
      mEncounters[key].push(e);
    });
    var mCombos = {};
    Object.values(mEncounters).forEach(function(encEntries) {
      var sorted = encEntries.slice().sort(function(a, b) { return b.adjustedRVU - a.adjustedRVU; });
      var codes = sorted.map(function(e) { return e.cptCode; });
      var comboKey = codes.join("+");
      var encRVU = sorted.reduce(function(s, e) { return s + e.adjustedRVU; }, 0);
      if (!mCombos[comboKey]) {
        mCombos[comboKey] = { key: comboKey, code: sorted[0].cptCode, desc: sorted[0].description, addons: codes.length > 1 ? codes.slice(1) : [], count: 0, rvu: 0 };
      }
      mCombos[comboKey].count++;
      mCombos[comboKey].rvu += encRVU;
    });
    var topProcsM = Object.values(mCombos).sort(function(a, b) { return b.rvu - a.rvu; }).slice(0, 8);
    var patients = {};
    mEntries.forEach(function(e) { if (e.encounterId) patients[e.encounterId] = true; });
    var days = {};
    mEntries.forEach(function(e) { days[e.date] = true; });
    return { totalRVU: totalRVU, totalComp: totalComp, caseCount: caseCount, avgRVU: avgRVU, privateRVU: privateRVU, callRVU: callRVU, privateCases: countEncounters(privateEntries), callCases: countEncounters(callEntries), topProcs: topProcsM, uniquePatients: Object.keys(patients).length, workDays: Object.keys(days).length, totalProcs: mEntries.length };
  }, [entries, summaryMonth, rate]);

  // Detail view for a specific month
  if (detailMonth) {
    var dm = monthlyData.find(function(m) { return m.key === detailMonth; });
    if (!dm) { setDetailMonth(null); return null; }
    var monthProcs = {};
    dm.entries.forEach(function(e) {
      if (!monthProcs[e.cptCode]) monthProcs[e.cptCode] = { code: e.cptCode, desc: e.description, count: 0, totalRVU: 0 };
      monthProcs[e.cptCode].count++;
      monthProcs[e.cptCode].totalRVU += e.adjustedRVU;
    });
    var monthProcList = Object.values(monthProcs).sort(function(a, b) { return b.totalRVU - a.totalRVU; });

    return (<div style={S.page}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}><button onClick={function() { setDetailMonth(null); }} style={S.backBtn}>Back</button><h1 style={{ ...S.title, marginBottom: 0 }}>{monthLabel(detailMonth)}</h1></div>
      <div style={S.statsRow}>
        <div style={S.statCard}><div style={S.statValue}>{dm.rvu.toFixed(1)}</div><div style={S.statLabel}>wRVUs</div></div>
        <div style={S.statCard}><div style={S.statValue}>{dm.count}</div><div style={S.statLabel}>Procedures</div></div>
        <div style={S.statCard}><div style={{ ...S.statValue, color: "#10b981" }}>{fmtDollar(dm.comp, showComp)}</div><div style={S.statLabel}>Compensation</div></div>
      </div>
      <div style={S.card}><div style={S.cardLabel}>Procedures</div><div style={{ marginTop: 8 }}>{monthProcList.map(function(p) {
        return (<div key={p.code} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(51,65,85,0.3)" }}>
          <div><span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "#0ea5e9", fontWeight: 600 }}>{p.code}</span><span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>x{p.count}</span><div style={{ fontSize: 11, color: "#94a3b8", marginTop: 2 }}>{p.desc}</div></div>
          <div style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: "#e2e8f0", fontWeight: 600 }}>{p.totalRVU.toFixed(2)}</div>
        </div>);
      })}</div></div>
    </div>);
  }

  var summaryMonthName = function(ym) {
    var parts = ym.split("-");
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  var generateSummaryText = function() {
    var s = summaryData;
    var lines = ["MONTHLY RVU SUMMARY - " + summaryMonthName(summaryMonth).toUpperCase(), "=".repeat(44), "", "Total wRVUs:        " + s.totalRVU.toFixed(2), "Total Compensation: $" + s.totalComp.toLocaleString(undefined, { maximumFractionDigits: 0 }), "Encounters:         " + s.caseCount, "Procedures:         " + s.totalProcs, "Avg wRVU/Encounter: " + s.avgRVU.toFixed(2), "Working Days:       " + s.workDays, "", "Private: " + s.privateCases + " enc, " + s.privateRVU.toFixed(1) + " wRVUs", "Call:    " + s.callCases + " enc, " + s.callRVU.toFixed(1) + " wRVUs", ""];
    if (goal > 0) { lines.push("Monthly Goal Pace: " + ((s.totalRVU / (goal / 12)) * 100).toFixed(0) + "% of " + (goal / 12).toFixed(0) + " wRVU target"); lines.push(""); }
    if (s.topProcs.length > 0) { lines.push("TOP ENCOUNTERS:"); lines.push("-".repeat(44)); s.topProcs.forEach(function(p) { var codes = p.addons.length > 0 ? p.code + " + " + p.addons.join(", ") : p.code; lines.push("  " + codes + "  x" + p.count + "  " + p.rvu.toFixed(1) + " wRVU  " + p.desc.slice(0, 30)); }); }
    return lines.join("\n");
  };

  var copySummary = function() {
    if (navigator.clipboard) { navigator.clipboard.writeText(generateSummaryText()).then(function() { setCopyStatus("Copied!"); setTimeout(function() { setCopyStatus(""); }, 2000); }); }
  };

  return (<div style={S.page}>
    <div style={S.header}><h1 style={S.title}>Analytics</h1></div>

    {/* Year selector - same pattern and same year set as the Dashboard */}
    {availableYears.length > 1 && (function() {
      var nowY = now.getFullYear();
      var pinned = [String(nowY - 1), String(nowY - 2)].filter(function(y) { return availableYears.indexOf(y) !== -1; });
      var older = availableYears.filter(function(y) { return y !== String(nowY) && pinned.indexOf(y) === -1; });
      var olderSelected = older.indexOf(selectedYear) !== -1;
      return (<div style={{ ...S.catRow, marginBottom: 12 }}>
        <button onClick={function() { setSelectedYear("current"); }} style={selectedYear === "current" ? S.catBtnActive : S.catBtn}>Current</button>
        {pinned.map(function(y) { return (
          <button key={y} onClick={function() { setSelectedYear(y); }} style={selectedYear === y ? S.catBtnActive : S.catBtn}>{y}</button>
        ); })}
        {older.length > 0 && <select
          value={olderSelected ? selectedYear : ""}
          onChange={function(e) { if (e.target.value) setSelectedYear(e.target.value); }}
          style={{
            flexShrink: 0, padding: "6px 22px 6px 12px", borderRadius: 20,
            background: olderSelected ? "#0ea5e9" : "var(--bg-card)",
            border: olderSelected ? "1px solid #0ea5e9" : "1px solid var(--border-default)",
            color: olderSelected ? "#fff" : "var(--text-muted)",
            fontSize: 12, fontWeight: olderSelected ? 600 : 400, cursor: "pointer",
            appearance: "none", WebkitAppearance: "none", MozAppearance: "none",
            backgroundImage: "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 10 10'><path d='M2 4l3 3 3-3' stroke='" + (olderSelected ? "%23fff" : "%2394a3b8") + "' stroke-width='1.5' fill='none' stroke-linecap='round'/></svg>\")",
            backgroundRepeat: "no-repeat", backgroundPosition: "right 6px center",
            fontFamily: "'DM Sans', sans-serif"
          }}
        >
          <option value="">{olderSelected ? selectedYear : "Older"}</option>
          {older.map(function(y) { return <option key={y} value={y}>{y}</option>; })}
        </select>}
      </div>);
    })()}

    {/* Goal Pace Card - pace math is meaningless on a finished year */}
    {goal > 0 && isCurrent && <div style={{ ...S.card, background: "linear-gradient(135deg, #1e293b, #0f172a)", border: "1px solid #334155" }}>
      <div style={S.cardLabel}>Goal Pace</div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
        <div style={{ textAlign: "center" }}><div style={{ fontSize: 24, fontFamily: "JetBrains Mono", color: "#f8fafc", fontWeight: 700 }}>{ytdRVU.toFixed(0)}</div><div style={{ fontSize: 10, color: "#64748b" }}>Current</div></div>
        <div style={{ textAlign: "center" }}><div style={{ fontSize: 24, fontFamily: "JetBrains Mono", color: "#64748b", fontWeight: 700 }}>{expectedRVU.toFixed(0)}</div><div style={{ fontSize: 10, color: "#64748b" }}>Expected</div></div>
        <div style={{ textAlign: "center" }}><div style={{ fontSize: 24, fontFamily: "JetBrains Mono", color: "#0ea5e9", fontWeight: 700 }}>{goal.toFixed ? goal.toFixed(0) : goal}</div><div style={{ fontSize: 10, color: "#64748b" }}>Goal</div></div>
      </div>
      {/* Progress bar */}
      <div style={{ marginTop: 12, height: 8, background: "#0f172a", borderRadius: 4, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: Math.min(100, (expectedRVU / goal * 100)) + "%", background: "rgba(100,116,139,0.3)", borderRadius: 4 }} />
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: Math.min(100, (ytdRVU / goal * 100)) + "%", background: ytdRVU >= expectedRVU ? "linear-gradient(90deg, #10b981, #34d399)" : "linear-gradient(90deg, #f59e0b, #fbbf24)", borderRadius: 4, transition: "width 0.5s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <span style={{ fontSize: 11, color: ytdRVU >= expectedRVU ? "#10b981" : "#f59e0b" }}>{ytdRVU >= expectedRVU ? "Ahead of pace" : "Behind pace"} ({(ytdRVU - expectedRVU >= 0 ? "+" : "") + (ytdRVU - expectedRVU).toFixed(0)})</span>
        <span style={{ fontSize: 11, color: "#64748b" }}>{(ytdRVU / goal * 100).toFixed(1)}%</span>
      </div>
      <div style={{ marginTop: 12, padding: "10px 0", borderTop: "1px solid #334155", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Remaining</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "#f8fafc", fontWeight: 600 }}>{rvuNeeded.toFixed(0)}</div></div>
        <div><div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Needed/Month</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: rvuPerMonthNeeded > avgMonthly * 1.2 ? "#f87171" : "#10b981", fontWeight: 600 }}>{rvuPerMonthNeeded.toFixed(0)}</div></div>
        <div><div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Projected Annual</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: projectedAnnual >= goal ? "#10b981" : "#f59e0b", fontWeight: 600 }}>{projectedAnnual.toFixed(0)}</div></div>
        <div><div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Months Left</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "#f8fafc", fontWeight: 600 }}>{monthsRemaining.toFixed(1)}</div></div>
      </div>
    </div>}

    {/* Averages - selected-year figures; weekly average only makes sense mid-year */}
    <div style={S.statsRow}>
      <div style={S.statCard}><div style={S.statValue}>{avgMonthly.toFixed(0)}</div><div style={S.statLabel}>Avg/Month</div></div>
      {isCurrent
        ? <div style={S.statCard}><div style={S.statValue}>{avgWeekly.toFixed(0)}</div><div style={S.statLabel}>Avg/Week</div></div>
        : <div style={S.statCard}><div style={S.statValue}>{monthlyData.length}</div><div style={S.statLabel}>Months</div></div>}
      <div style={S.statCard}><div style={{ ...S.statValue, color: "#10b981" }}>{fmtDollar(selComp, showComp)}</div><div style={S.statLabel}>Total Comp</div></div>
    </div>

    {/* Monthly bar chart */}
    <div style={S.card}>
      <div style={S.cardLabel}>Monthly wRVUs</div>
      <div style={{ marginTop: 12 }}>
        {monthlyData.map(function(m) {
          var pct = maxMonthRVU > 0 ? (m.rvu / maxMonthRVU * 100) : 0;
          var goalLine = goal > 0 ? (goal / 12) : 0;
          var goalPct = maxMonthRVU > 0 ? Math.min(100, goalLine / maxMonthRVU * 100) : 0;
          return (<div key={m.key} onClick={function() { setDetailMonth(m.key); }} style={{ display: "flex", alignItems: "center", gap: 8, padding: "6px 0", cursor: "pointer", borderBottom: "1px solid rgba(51,65,85,0.2)" }}>
            <div style={{ width: 50, fontSize: 11, color: "#94a3b8", fontFamily: "JetBrains Mono" }}>{monthLabel(m.key)}</div>
            <div style={{ flex: 1, height: 20, background: "#0f172a", borderRadius: 4, position: "relative", overflow: "hidden" }}>
              <div style={{ height: "100%", width: pct + "%", background: m.rvu >= goalLine && goal > 0 ? "linear-gradient(90deg, #10b981, #34d399)" : "linear-gradient(90deg, #0ea5e9, #38bdf8)", borderRadius: 4, transition: "width 0.3s" }} />
              {goal > 0 && <div style={{ position: "absolute", top: 0, left: goalPct + "%", width: 2, height: "100%", background: "rgba(251,191,36,0.5)" }} />}
            </div>
            <div style={{ width: 55, textAlign: "right", fontSize: 12, fontFamily: "JetBrains Mono", color: "#e2e8f0", fontWeight: 600 }}>{m.rvu.toFixed(0)}</div>
            <div style={{ width: 20, textAlign: "right", fontSize: 10, color: "#64748b" }}>{m.count}</div>
          </div>);
        })}
        {goal > 0 && <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}><div style={{ width: 12, height: 2, background: "rgba(251,191,36,0.5)" }} /><span style={{ fontSize: 10, color: "#64748b" }}>Monthly goal ({(goal/12).toFixed(0)})</span></div>}
        {monthlyData.length === 0 && <div style={emptyHint}>No procedures logged in {year}.</div>}
      </div>
    </div>

    {/* 1. CASE MIX - what fills time vs what pays */}
    <div style={{ ...S.card, background: "linear-gradient(135deg, #1e293b, #0f172a)", border: "1px solid #334155", padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "#f8fafc", marginBottom: 4 }}>Case Mix</div>
      <div style={{ fontSize: 11, color: "#64748b", marginBottom: 12 }}>Share of procedures (grey) vs share of wRVUs (color) - what fills time vs what pays</div>
      {caseMix.list.length === 0 ? <div style={emptyHint}>No procedures logged in {year}.</div> : caseMix.list.map(function(c, i) {
        var catColors = ["#0ea5e9","#10b981","#8b5cf6","#f59e0b","#ef4444","#ec4899","#06b6d4","#f97316"];
        var color = catColors[i % catColors.length];
        var caseShare = caseMix.totalProcs > 0 ? (c.count / caseMix.totalProcs * 100) : 0;
        var rvuShare = caseMix.totalRVU > 0 ? (c.rvu / caseMix.totalRVU * 100) : 0;
        return (<div key={c.name} style={{ padding: "8px 0", borderBottom: i < caseMix.list.length - 1 ? "1px solid rgba(51,65,85,0.3)" : "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 5 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: "#f8fafc", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{c.name}</span>
              <span style={{ fontSize: 11, color: "#64748b", flexShrink: 0 }}>x{c.count}</span>
            </div>
            <div style={{ textAlign: "right", flexShrink: 0, marginLeft: 8 }}>
              <span style={{ fontSize: 14, fontFamily: "JetBrains Mono", color: color, fontWeight: 700 }}>{c.rvu.toFixed(1)}</span>
              <div style={{ fontSize: 9, color: "#64748b" }}>avg {(c.count > 0 ? c.rvu / c.count : 0).toFixed(1)}/proc</div>
            </div>
          </div>
          {[["cases", caseShare, "#64748b"], ["wRVU", rvuShare, color]].map(function(b) {
            return (<div key={b[0]} style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 2 }}>
              <span style={{ width: 34, fontSize: 9, color: "#64748b", textTransform: "uppercase", flexShrink: 0 }}>{b[0]}</span>
              <div style={{ flex: 1, height: 6, background: "#0f172a", borderRadius: 3, overflow: "hidden" }}>
                <div style={{ height: "100%", width: b[1] + "%", background: b[2], borderRadius: 3, transition: "width 0.3s" }} />
              </div>
              <span style={{ width: 40, textAlign: "right", fontSize: 10, fontFamily: "JetBrains Mono", color: "#94a3b8", flexShrink: 0 }}>{b[1].toFixed(1)}%</span>
            </div>);
          })}
        </div>);
      })}
    </div>

    {/* 2. TOP CODES by total wRVU (snapshotted values; friendly labels only) */}
    <div style={S.card}>
      <div style={S.cardLabel}>Top Codes by wRVU</div>
      <div style={{ marginTop: 8 }}>
        {topCodes.length === 0 ? <div style={emptyHint}>No procedures logged in {year}.</div> : topCodes.map(function(c, i) {
          var f = cptMapLocal[c.code];
          var label = (f && f.friendly) || c.desc || ("CPT " + c.code);
          return (<div key={c.code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < topCodes.length - 1 ? "1px solid rgba(51,65,85,0.3)" : "none" }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div><span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "#0ea5e9", fontWeight: 600 }}>{c.code}</span><span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>x{c.count}</span></div>
              <div style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
            </div>
            <div style={{ textAlign: "right", marginLeft: 8, flexShrink: 0 }}>
              <div style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: "#e2e8f0", fontWeight: 600 }}>{c.rvu.toFixed(1)}</div>
              <div style={{ fontSize: 9, color: "#64748b" }}>avg {(c.rvu / c.count).toFixed(2)}</div>
            </div>
          </div>);
        })}
      </div>
    </div>

    {/* Top Procedures */}
    {topProcs.length > 0 && <div style={S.card}>
      <div style={S.cardLabel}>Top Encounters</div>
      <div style={{ marginTop: 8 }}>{topProcs.map(function(p, i) {
        return (<div key={p.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "8px 0", borderBottom: i < topProcs.length - 1 ? "1px solid rgba(51,65,85,0.3)" : "none" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div><span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "#0ea5e9", fontWeight: 600 }}>{p.primaryCode}</span><span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>x{p.count}</span></div>
            <div style={{ fontSize: 11, color: "#94a3b8", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.primaryDesc}</div>
            {p.addons.length > 0 && <div style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "#64748b", marginTop: 2 }}>+ {p.addons.join(", ")}</div>}
          </div>
          <div style={{ textAlign: "right", marginLeft: 8, flexShrink: 0 }}>
            <div style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: "#e2e8f0", fontWeight: 600 }}>{p.totalRVU.toFixed(1)}</div>
            <div style={{ fontSize: 9, color: "#64748b" }}>{(p.totalRVU / p.count).toFixed(1)}/enc</div>
          </div>
        </div>);
      })}</div>
    </div>}

    {/* 3. WRVU PER ENCOUNTER TREND - inline SVG polyline, no chart library */}
    <div style={S.card}>
      <div style={S.cardLabel}>wRVU per Encounter</div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, marginBottom: 8 }}>Monthly average, {year}. Months with no encounters are skipped.</div>
      {encTrend.length === 0 ? <div style={emptyHint}>No encounters logged in {year}.</div> : (function() {
        var W = 320, H = 90, PX = 12, PY = 14;
        var vals = encTrend.map(function(p) { return p.avg; });
        var min = Math.min.apply(null, vals);
        var max = Math.max.apply(null, vals);
        if (max - min < 0.5) { max += 0.5; min = Math.max(0, min - 0.5); }
        var pts = encTrend.map(function(p, i) {
          var x = encTrend.length === 1 ? W / 2 : PX + i * ((W - 2 * PX) / (encTrend.length - 1));
          var y = H - PY - ((p.avg - min) / (max - min)) * (H - 2 * PY);
          return x.toFixed(1) + "," + y.toFixed(1);
        });
        return (<div>
          <svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", height: "auto", display: "block" }}>
            <line x1={PX} y1={H - PY} x2={W - PX} y2={H - PY} stroke="rgba(51,65,85,0.6)" strokeWidth="1" />
            {encTrend.length > 1 && <polyline points={pts.join(" ")} fill="none" stroke="#0ea5e9" strokeWidth="2" strokeLinejoin="round" strokeLinecap="round" />}
            {pts.map(function(pt, i) { var xy = pt.split(","); return <circle key={encTrend[i].key} cx={xy[0]} cy={xy[1]} r="3" fill="#0ea5e9" />; })}
          </svg>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
            {encTrend.map(function(p) {
              return (<div key={p.key} style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "#94a3b8", background: "#0f172a", borderRadius: 4, padding: "2px 6px" }}>
                {monthLabel(p.key).split(" ")[0]} <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{p.avg.toFixed(1)}</span>
              </div>);
            })}
          </div>
        </div>);
      })()}
    </div>

    {/* 6. DAY OF WEEK - weekday from local date parts, never string parsing */}
    <div style={S.card}>
      <div style={S.cardLabel}>Day of Week</div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, marginBottom: 8 }}>Cases and wRVUs by weekday, {year}.</div>
      {filteredEntries.length === 0 ? <div style={emptyHint}>No procedures logged in {year}.</div> : (function() {
        var maxDow = dayOfWeek.reduce(function(m, d) { return Math.max(m, d.rvu); }, 0);
        return dayOfWeek.map(function(d) {
          return (<div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid rgba(51,65,85,0.2)" }}>
            <div style={{ width: 50, fontSize: 11, color: "#94a3b8", fontFamily: "JetBrains Mono" }}>{d.name}</div>
            <div style={{ flex: 1, height: 14, background: "#0f172a", borderRadius: 4, overflow: "hidden" }}>
              <div style={{ height: "100%", width: (maxDow > 0 ? d.rvu / maxDow * 100 : 0) + "%", background: "linear-gradient(90deg, #0ea5e9, #38bdf8)", borderRadius: 4, transition: "width 0.3s" }} />
            </div>
            <div style={{ width: 55, textAlign: "right", fontSize: 12, fontFamily: "JetBrains Mono", color: "#e2e8f0", fontWeight: 600 }}>{d.rvu.toFixed(0)}</div>
            <div style={{ width: 24, textAlign: "right", fontSize: 10, color: "#64748b" }}>{d.count}</div>
          </div>);
        });
      })()}
    </div>

    {/* 4. VALUE PER SHIFT - all acute months, deliberately not year-scoped */}
    <div style={S.card}>
      <div style={S.cardLabel}>Value per Shift (Acute)</div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, marginBottom: 8 }}>All acute months - spans years, not filtered by the year chips.</div>
      {shiftValueSeries.length === 0 ? <div style={emptyHint}>No acute months entered yet - add them in Settings.</div> : (function() {
        var maxV = shiftValueSeries.reduce(function(m, p) { return p.vpu !== null ? Math.max(m, p.vpu) : m; }, 0);
        return shiftValueSeries.map(function(p) {
          return (<div key={p.key} style={{ display: "flex", alignItems: "center", gap: 8, padding: "5px 0", borderBottom: "1px solid rgba(51,65,85,0.2)" }}>
            <div style={{ width: 50, fontSize: 11, color: "#94a3b8", fontFamily: "JetBrains Mono" }}>{monthLabel(p.key)}</div>
            <div style={{ flex: 1, height: 14, background: "#0f172a", borderRadius: 4, overflow: "hidden" }}>
              {p.vpu !== null && <div style={{ height: "100%", width: (maxV > 0 ? p.vpu / maxV * 100 : 0) + "%", background: "linear-gradient(90deg, #059669, #34d399)", borderRadius: 4, transition: "width 0.3s" }} />}
            </div>
            <div style={{ width: 50, textAlign: "right", fontSize: 12, fontFamily: "JetBrains Mono", color: p.vpu === null ? "#64748b" : "#e2e8f0", fontWeight: 600 }}>{p.vpu === null ? "\u2014" : round2(p.vpu).toFixed(2)}</div>
          </div>);
        });
      })()}
    </div>

    {/* 5. ACUTE CROSS-CHECK - catches institution restatements automatically */}
    <div style={S.card}>
      <div style={S.cardLabel}>Acute Cross-Check</div>
      <div style={{ fontSize: 10, color: "#64748b", marginTop: 2, marginBottom: 8 }}>Compare's call figure vs your computed acute share, {year}. Flags gaps over {CROSSCHECK_FLAG}.</div>
      {crossCheck.noMe ? <div style={emptyHint}>Tap Me on the partner roster in Settings to enable the cross-check.</div>
        : crossCheck.rows.length === 0 ? <div style={emptyHint}>No {year} months have both a Compare call figure and acute shifts yet.</div>
        : (<div>
          <div style={{ display: "grid", gridTemplateColumns: "50px 1fr 1fr 1fr", gap: 4, padding: "2px 0 6px", fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>
            <span>Month</span><span style={{ textAlign: "right" }}>Inst call</span><span style={{ textAlign: "right" }}>My share</span><span style={{ textAlign: "right" }}>Diff</span>
          </div>
          {crossCheck.rows.map(function(r) {
            return (<div key={r.key} style={{ display: "grid", gridTemplateColumns: "50px 1fr 1fr 1fr", gap: 4, padding: "5px 0", borderBottom: "1px solid rgba(51,65,85,0.2)", background: r.flag ? "rgba(245,158,11,0.07)" : "transparent", borderRadius: r.flag ? 4 : 0 }}>
              <span style={{ fontSize: 11, color: "#94a3b8", fontFamily: "JetBrains Mono" }}>{monthLabel(r.key).split(" ")[0]}</span>
              <span style={{ textAlign: "right", fontSize: 12, fontFamily: "JetBrains Mono", color: "#94a3b8" }}>{r.inst.toFixed(2)}</span>
              <span style={{ textAlign: "right", fontSize: 12, fontFamily: "JetBrains Mono", color: "#e2e8f0" }}>{r.share.toFixed(2)}</span>
              <span style={{ textAlign: "right", fontSize: 12, fontFamily: "JetBrains Mono", fontWeight: r.flag ? 700 : 400, color: r.flag ? "#f59e0b" : "#64748b" }}>{(r.diff >= 0 ? "+" : "") + r.diff.toFixed(2)}{r.flag ? " !" : ""}</span>
            </div>);
          })}
          <div style={{ display: "flex", justifyContent: "space-between", marginTop: 8, paddingTop: 8, borderTop: "1px solid #334155" }}>
            <span style={{ fontSize: 11, color: "#94a3b8" }}>Cumulative drift {year}</span>
            <span style={{ fontSize: 12, fontFamily: "JetBrains Mono", fontWeight: 700, color: Math.abs(crossCheck.cum) > CROSSCHECK_FLAG ? "#f59e0b" : "#64748b" }}>{(crossCheck.cum >= 0 ? "+" : "") + crossCheck.cum.toFixed(2)}</span>
          </div>
        </div>)}
      {crossCheck.skipped > 0 && <div style={{ fontSize: 10, color: "#64748b", marginTop: 6 }}>{crossCheck.skipped} month{crossCheck.skipped === 1 ? "" : "s"} skipped (total-only - work/call split unknown).</div>}
    </div>

    {/* Monthly Summary Report */}
    <button onClick={function() { setShowSummary(!showSummary); }} style={{ ...S.secondaryBtn, width: "100%", marginBottom: 8, color: "#a78bfa", borderColor: "rgba(139,92,246,0.3)" }}>{showSummary ? "Hide Summary" : "Monthly Summary Report"}</button>
    {showSummary && <div style={{ ...S.card, border: "1px solid rgba(139,92,246,0.25)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={S.cardLabel}>Monthly Report</div>
        <input type="month" value={summaryMonth} onChange={function(e) { setSummaryMonth(e.target.value); }} style={{ ...S.dateInput, fontSize: 12, padding: "4px 8px" }} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "#f8fafc", marginBottom: 12 }}>{summaryMonthName(summaryMonth)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div style={{ background: "#0f172a", borderRadius: 8, padding: 10, textAlign: "center" }}>
          <div style={{ fontSize: 22, fontFamily: "JetBrains Mono", color: "#f8fafc", fontWeight: 700 }}>{summaryData.totalRVU.toFixed(1)}</div>
          <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>wRVUs</div>
        </div>
        <div style={{ background: "#0f172a", borderRadius: 8, padding: 10, textAlign: "center" }}>
          <div style={{ fontSize: 22, fontFamily: "JetBrains Mono", color: "#10b981", fontWeight: 700 }}>{fmtDollar(summaryData.totalComp, showComp)}</div>
          <div style={{ fontSize: 10, color: "#64748b", textTransform: "uppercase" }}>Compensation</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 12 }}>
        {[[summaryData.caseCount, "Encounters"], [summaryData.totalProcs, "Procedures"], [summaryData.avgRVU.toFixed(1), "Avg/Enc"], [summaryData.workDays, "Days"]].map(function(item) { return <div key={item[1]} style={{ background: "#0f172a", borderRadius: 6, padding: "6px 4px", textAlign: "center" }}><div style={{ fontSize: 14, fontFamily: "JetBrains Mono", color: "#e2e8f0", fontWeight: 600 }}>{item[0]}</div><div style={{ fontSize: 8, color: "#64748b", textTransform: "uppercase", letterSpacing: 0.5 }}>{item[1]}</div></div>; })}
      </div>
      {summaryData.privateCases + summaryData.callCases > 0 && <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, padding: "6px 10px", borderRadius: 6, background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.15)" }}><div style={{ fontSize: 10, color: "#0ea5e9", fontWeight: 600 }}>Private</div><div style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: "#e2e8f0" }}>{summaryData.privateRVU.toFixed(1)} wRVU | {summaryData.privateCases} enc</div></div>
        <div style={{ flex: 1, padding: "6px 10px", borderRadius: 6, background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)" }}><div style={{ fontSize: 10, color: "#a78bfa", fontWeight: 600 }}>Call</div><div style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: "#e2e8f0" }}>{summaryData.callRVU.toFixed(1)} wRVU | {summaryData.callCases} enc</div></div>
      </div>}
      {goal > 0 && <div style={{ padding: "8px 10px", borderRadius: 6, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><span style={{ fontSize: 11, color: "#10b981", fontWeight: 600 }}>Monthly Goal Pace</span><div style={{ fontSize: 10, color: "#64748b", marginTop: 2 }}>Target: {(goal / 12).toFixed(0)} wRVU/month</div></div>
        <span style={{ fontSize: 14, fontFamily: "JetBrains Mono", color: "#10b981", fontWeight: 700 }}>{((summaryData.totalRVU / (goal / 12)) * 100).toFixed(0)}%</span>
      </div>}
      {summaryData.topProcs.length > 0 && <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "#94a3b8", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>Top Encounters</div>
        {summaryData.topProcs.map(function(p) { return (<div key={p.key} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "5px 0", borderBottom: "1px solid rgba(51,65,85,0.3)" }}><div style={{ flex: 1, minWidth: 0 }}><span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "#0ea5e9", fontWeight: 600 }}>{p.code}</span><span style={{ fontSize: 10, color: "#64748b", marginLeft: 4 }}>x{p.count}</span><div style={{ fontSize: 11, color: "#94a3b8" }}>{p.desc.length > 35 ? p.desc.slice(0, 35) + "..." : p.desc}</div>{p.addons.length > 0 && <div style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "#64748b" }}>+ {p.addons.join(", ")}</div>}</div><span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "#e2e8f0", fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>{p.rvu.toFixed(1)}</span></div>); })}
      </div>}
      <button onClick={copySummary} style={{ ...S.saveBtn, background: "linear-gradient(135deg, #8b5cf6, #7c3aed)" }}>{copyStatus || "Copy Summary to Clipboard"}</button>
    </div>}

    {/* Quick links */}
    <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
      <button onClick={function() { setView("import"); }} style={{ ...S.secondaryBtn, flex: 1 }}>Import Data</button>
      <button onClick={function() { setView("history"); }} style={{ ...S.secondaryBtn, flex: 1 }}>View History</button>
    </div>
  </div>);
}

