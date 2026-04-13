// =======================================
// ANALYTICS / TRENDS
// =======================================
function Analytics({ data, db, setView }) {
  var [timeRange, setTimeRange] = useState("ytd");
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

  // Filter entries by time range
  var now = new Date();
  var filteredEntries = useMemo(function() {
    return entries.filter(function(e) {
      var d = new Date(e.date + "T00:00:00");
      if (timeRange === "ytd") {
        return d >= yearStartDate && d < yearEndDate;
      } else if (timeRange === "q") {
        var qStart = new Date(now.getFullYear(), Math.floor(now.getMonth() / 3) * 3, 1);
        return d >= qStart && d <= now;
      } else if (timeRange === "all") {
        return true;
      }
      return true;
    });
  }, [entries, timeRange]);

  // Monthly breakdown
  var monthlyData = useMemo(function() {
    var months = {};
    filteredEntries.forEach(function(e) {
      var d = new Date(e.date + "T00:00:00");
      var key = d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0");
      if (!months[key]) months[key] = { key: key, rvu: 0, comp: 0, count: 0, entries: [] };
      months[key].rvu += e.adjustedRVU;
      months[key].comp += e.adjustedRVU * rate;
      months[key].count++;
      months[key].entries.push(e);
    });
    return Object.values(months).sort(function(a, b) { return a.key.localeCompare(b.key); });
  }, [filteredEntries, rate]);

  // YTD totals
  var ytdEntries = entries.filter(function(e) {
    var d = new Date(e.date + "T00:00:00");
    return d >= yearStartDate && d < yearEndDate;
  });
  var ytdRVU = ytdEntries.reduce(function(s, e) { return s + e.adjustedRVU; }, 0);
  var ytdComp = ytdRVU * rate;
  var ytdProcs = ytdEntries.length;

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

  // Top procedures by frequency
  var topProcs = useMemo(function() {
    var counts = {};
    filteredEntries.forEach(function(e) {
      if (!counts[e.cptCode]) counts[e.cptCode] = { code: e.cptCode, desc: e.description, count: 0, totalRVU: 0 };
      counts[e.cptCode].count++;
      counts[e.cptCode].totalRVU += e.adjustedRVU;
    });
    return Object.values(counts).sort(function(a, b) { return b.count - a.count; }).slice(0, 10);
  }, [filteredEntries]);

  // Top categories by RVU
  var topCats = useMemo(function() {
    var cats = {};
    filteredEntries.forEach(function(e) {
      var cat = e.category || "Other";
      if (!cats[cat]) cats[cat] = { name: cat, rvu: 0, count: 0 };
      cats[cat].rvu += e.adjustedRVU;
      cats[cat].count++;
    });
    return Object.values(cats).sort(function(a, b) { return b.rvu - a.rvu; }).slice(0, 8);
  }, [filteredEntries]);

  var maxMonthRVU = monthlyData.reduce(function(m, d) { return Math.max(m, d.rvu); }, 0);
  var maxCatRVU = topCats.length > 0 ? topCats[0].rvu : 1;

  var monthLabel = function(key) {
    var parts = key.split("-");
    var names = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return names[parseInt(parts[1]) - 1] + " " + parts[0].slice(2);
  };

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
        <div style={S.statCard}><div style={{ ...S.statValue, color: "#10b981" }}>${dm.comp.toFixed(0)}</div><div style={S.statLabel}>Compensation</div></div>
      </div>
      <div style={S.card}><div style={S.cardLabel}>Procedures</div><div style={{ marginTop: 8 }}>{monthProcList.map(function(p) {
        return (<div key={p.code} style={{ display: "flex", justifyContent: "space-between", padding: "8px 0", borderBottom: "1px solid rgba(51,65,85,0.3)" }}>
          <div><span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "#0ea5e9", fontWeight: 600 }}>{p.code}</span><span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 6 }}>x{p.count}</span><div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{p.desc}</div></div>
          <div style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 600 }}>{p.totalRVU.toFixed(2)}</div>
        </div>);
      })}</div></div>
    </div>);
  }

  // Monthly summary data
  var summaryData = useMemo(function() {
    var mEntries = entries.filter(function(e) { return e.date.slice(0, 7) === summaryMonth; });
    var totalRVU = mEntries.reduce(function(s, e) { return s + e.adjustedRVU; }, 0);
    var totalComp = totalRVU * rate;
    var caseCount = mEntries.length;
    var avgRVU = caseCount > 0 ? totalRVU / caseCount : 0;
    var privateEntries = mEntries.filter(function(e) { return !e.isCall; });
    var callEntries = mEntries.filter(function(e) { return e.isCall; });
    var privateRVU = privateEntries.reduce(function(s, e) { return s + e.adjustedRVU; }, 0);
    var callRVU = callEntries.reduce(function(s, e) { return s + e.adjustedRVU; }, 0);
    var codeMap = {};
    mEntries.forEach(function(e) {
      if (!codeMap[e.cptCode]) codeMap[e.cptCode] = { code: e.cptCode, desc: e.description, count: 0, rvu: 0 };
      codeMap[e.cptCode].count++;
      codeMap[e.cptCode].rvu += e.adjustedRVU;
    });
    var topProcs = Object.values(codeMap).sort(function(a, b) { return b.rvu - a.rvu; }).slice(0, 8);
    var patients = {};
    mEntries.forEach(function(e) { if (e.encounterId) patients[e.encounterId] = true; });
    var days = {};
    mEntries.forEach(function(e) { days[e.date] = true; });
    return { totalRVU: totalRVU, totalComp: totalComp, caseCount: caseCount, avgRVU: avgRVU, privateRVU: privateRVU, callRVU: callRVU, privateCases: privateEntries.length, callCases: callEntries.length, topProcs: topProcs, uniquePatients: Object.keys(patients).length, workDays: Object.keys(days).length };
  }, [entries, summaryMonth, rate]);

  var summaryMonthName = function(ym) {
    var parts = ym.split("-");
    return new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, 1).toLocaleDateString("en-US", { month: "long", year: "numeric" });
  };

  var generateSummaryText = function() {
    var s = summaryData;
    var lines = ["MONTHLY RVU SUMMARY - " + summaryMonthName(summaryMonth).toUpperCase(), "=".repeat(44), "", "Total wRVUs:        " + s.totalRVU.toFixed(2), "Total Compensation: $" + s.totalComp.toLocaleString(undefined, { maximumFractionDigits: 0 }), "Cases:              " + s.caseCount, "Avg wRVU/Case:      " + s.avgRVU.toFixed(2), "Working Days:       " + s.workDays, "Unique Patients:    " + s.uniquePatients, "", "Private: " + s.privateCases + " cases, " + s.privateRVU.toFixed(1) + " wRVUs", "Call:    " + s.callCases + " cases, " + s.callRVU.toFixed(1) + " wRVUs", ""];
    if (goal > 0) { lines.push("Monthly Goal Pace: " + ((s.totalRVU / (goal / 12)) * 100).toFixed(0) + "% of " + (goal / 12).toFixed(0) + " wRVU target"); lines.push(""); }
    if (s.topProcs.length > 0) { lines.push("TOP PROCEDURES:"); lines.push("-".repeat(44)); s.topProcs.forEach(function(p) { lines.push("  " + p.code + "  x" + p.count + "  " + p.rvu.toFixed(1) + " wRVU  " + p.desc.slice(0, 30)); }); }
    return lines.join("\n");
  };

  var copySummary = function() {
    if (navigator.clipboard) { navigator.clipboard.writeText(generateSummaryText()).then(function() { setCopyStatus("Copied!"); setTimeout(function() { setCopyStatus(""); }, 2000); }); }
  };

  return (<div style={S.page}>
    <div style={S.header}><h1 style={S.title}>Analytics</h1></div>

    {/* Time range selector */}
    <div style={{ display: "flex", gap: 6, marginBottom: 12 }}>{[["ytd","Year to Date"],["q","Quarter"],["all","All Time"]].map(function(t) {
      return <button key={t[0]} onClick={function() { setTimeRange(t[0]); }} style={timeRange === t[0] ? S.catBtnActive : S.catBtn}>{t[1]}</button>;
    })}</div>

    {/* Goal Pace Card */}
    {goal > 0 && <div style={{ ...S.card, background: "linear-gradient(135deg, #1e293b, #0f172a)", border: "1px solid var(--border-default)" }}>
      <div style={S.cardLabel}>Goal Pace</div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 12 }}>
        <div style={{ textAlign: "center" }}><div style={{ fontSize: 24, fontFamily: "JetBrains Mono", color: "var(--text-bright)", fontWeight: 700 }}>{ytdRVU.toFixed(0)}</div><div style={{ fontSize: 10, color: "var(--text-dim)" }}>Current</div></div>
        <div style={{ textAlign: "center" }}><div style={{ fontSize: 24, fontFamily: "JetBrains Mono", color: "var(--text-dim)", fontWeight: 700 }}>{expectedRVU.toFixed(0)}</div><div style={{ fontSize: 10, color: "var(--text-dim)" }}>Expected</div></div>
        <div style={{ textAlign: "center" }}><div style={{ fontSize: 24, fontFamily: "JetBrains Mono", color: "#0ea5e9", fontWeight: 700 }}>{goal.toFixed ? goal.toFixed(0) : goal}</div><div style={{ fontSize: 10, color: "var(--text-dim)" }}>Goal</div></div>
      </div>
      {/* Progress bar */}
      <div style={{ marginTop: 12, height: 8, background: "var(--bg-inset)", borderRadius: 4, overflow: "hidden", position: "relative" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: Math.min(100, (expectedRVU / goal * 100)) + "%", background: "rgba(100,116,139,0.3)", borderRadius: 4 }} />
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: Math.min(100, (ytdRVU / goal * 100)) + "%", background: ytdRVU >= expectedRVU ? "linear-gradient(90deg, #10b981, #34d399)" : "linear-gradient(90deg, #f59e0b, #fbbf24)", borderRadius: 4, transition: "width 0.5s" }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6 }}>
        <span style={{ fontSize: 11, color: ytdRVU >= expectedRVU ? "#10b981" : "#f59e0b" }}>{ytdRVU >= expectedRVU ? "Ahead of pace" : "Behind pace"} ({(ytdRVU - expectedRVU >= 0 ? "+" : "") + (ytdRVU - expectedRVU).toFixed(0)})</span>
        <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{(ytdRVU / goal * 100).toFixed(1)}%</span>
      </div>
      <div style={{ marginTop: 12, padding: "10px 0", borderTop: "1px solid var(--border-default)", display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12 }}>
        <div><div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase" }}>Remaining</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "var(--text-bright)", fontWeight: 600 }}>{rvuNeeded.toFixed(0)}</div></div>
        <div><div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase" }}>Needed/Month</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: rvuPerMonthNeeded > avgMonthly * 1.2 ? "#f87171" : "#10b981", fontWeight: 600 }}>{rvuPerMonthNeeded.toFixed(0)}</div></div>
        <div><div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase" }}>Projected Annual</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: projectedAnnual >= goal ? "#10b981" : "#f59e0b", fontWeight: 600 }}>{projectedAnnual.toFixed(0)}</div></div>
        <div><div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase" }}>Months Left</div><div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "var(--text-bright)", fontWeight: 600 }}>{monthsRemaining.toFixed(1)}</div></div>
      </div>
    </div>}

    {/* Averages */}
    <div style={S.statsRow}>
      <div style={S.statCard}><div style={S.statValue}>{avgMonthly.toFixed(0)}</div><div style={S.statLabel}>Avg/Month</div></div>
      <div style={S.statCard}><div style={S.statValue}>{avgWeekly.toFixed(0)}</div><div style={S.statLabel}>Avg/Week</div></div>
      <div style={S.statCard}><div style={{ ...S.statValue, color: "#10b981" }}>${ytdComp.toLocaleString(undefined, {maximumFractionDigits: 0})}</div><div style={S.statLabel}>Total Comp</div></div>
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
            <div style={{ width: 50, fontSize: 11, color: "var(--text-muted)", fontFamily: "JetBrains Mono" }}>{monthLabel(m.key)}</div>
            <div style={{ flex: 1, height: 20, background: "var(--bg-inset)", borderRadius: 4, position: "relative", overflow: "hidden" }}>
              <div style={{ height: "100%", width: pct + "%", background: m.rvu >= goalLine && goal > 0 ? "linear-gradient(90deg, #10b981, #34d399)" : "linear-gradient(90deg, #0ea5e9, #38bdf8)", borderRadius: 4, transition: "width 0.3s" }} />
              {goal > 0 && <div style={{ position: "absolute", top: 0, left: goalPct + "%", width: 2, height: "100%", background: "rgba(251,191,36,0.5)" }} />}
            </div>
            <div style={{ width: 55, textAlign: "right", fontSize: 12, fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 600 }}>{m.rvu.toFixed(0)}</div>
            <div style={{ width: 20, textAlign: "right", fontSize: 10, color: "var(--text-dim)" }}>{m.count}</div>
          </div>);
        })}
        {goal > 0 && <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}><div style={{ width: 12, height: 2, background: "rgba(251,191,36,0.5)" }} /><span style={{ fontSize: 10, color: "var(--text-dim)" }}>Monthly goal ({(goal/12).toFixed(0)})</span></div>}
      </div>
    </div>

    {/* Top Procedures */}
    {topProcs.length > 0 && <div style={S.card}>
      <div style={S.cardLabel}>Top Procedures</div>
      <div style={{ marginTop: 8 }}>{topProcs.map(function(p, i) {
        return (<div key={p.code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "6px 0", borderBottom: i < topProcs.length - 1 ? "1px solid rgba(51,65,85,0.3)" : "none" }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div><span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "#0ea5e9", fontWeight: 600 }}>{p.code}</span><span style={{ fontSize: 11, color: "var(--text-dim)", marginLeft: 6 }}>x{p.count}</span></div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{p.desc}</div>
          </div>
          <div style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 600, marginLeft: 8 }}>{p.totalRVU.toFixed(1)}</div>
        </div>);
      })}</div>
    </div>}

    {/* Category Breakdown - Enhanced */}
    {topCats.length > 0 && <div style={{ ...S.card, background: "linear-gradient(135deg, #1e293b, #0f172a)", border: "1px solid var(--border-default)", padding: 16 }}>
      <div style={{ fontSize: 14, fontWeight: 700, color: "var(--text-bright)", marginBottom: 4 }}>wRVU by Category</div>
      <div style={{ fontSize: 11, color: "var(--text-dim)", marginBottom: 14 }}>Total RVUs and top case per category</div>
      <div>{topCats.map(function(c, i) {
        var pct = maxCatRVU > 0 ? (c.rvu / maxCatRVU * 100) : 0;
        var catColors = ["#0ea5e9","#10b981","#8b5cf6","#f59e0b","#ef4444","#ec4899","#06b6d4","#f97316"];
        var color = catColors[i % catColors.length];
        // Find highest single case in this category
        var topCase = null;
        var topCaseRVU = 0;
        filteredEntries.forEach(function(e) {
          if ((e.category || "Other") === c.name && e.adjustedRVU > topCaseRVU) {
            topCaseRVU = e.adjustedRVU;
            topCase = e;
          }
        });
        return (<div key={c.name} style={{ padding: "10px 0", borderBottom: i < topCats.length - 1 ? "1px solid rgba(51,65,85,0.3)" : "none" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginBottom: 6 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <div style={{ width: 10, height: 10, borderRadius: 3, background: color, flexShrink: 0 }} />
              <span style={{ fontSize: 13, color: "var(--text-bright)", fontWeight: 600 }}>{c.name}</span>
            </div>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span style={{ fontSize: 11, color: "var(--text-dim)" }}>{c.count} case{c.count !== 1 ? "s" : ""}</span>
              <span style={{ fontSize: 16, fontFamily: "JetBrains Mono", color: color, fontWeight: 700 }}>{c.rvu.toFixed(1)}</span>
            </div>
          </div>
          <div style={{ height: 10, background: "var(--bg-inset)", borderRadius: 5, overflow: "hidden", marginBottom: 6 }}>
            <div style={{ height: "100%", width: pct + "%", background: "linear-gradient(90deg, " + color + ", " + color + "88)", borderRadius: 5, transition: "width 0.3s" }} />
          </div>
          {topCase && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 8px", background: "rgba(15,23,42,0.6)", borderRadius: 6, marginLeft: 18 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
              <span style={{ fontFamily: "JetBrains Mono", color: color, fontWeight: 600 }}>{topCase.cptCode}</span>
              <span style={{ marginLeft: 6 }}>{topCase.description.length > 28 ? topCase.description.slice(0, 28) + "..." : topCase.description}</span>
            </div>
            <span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 600 }}>{topCaseRVU.toFixed(2)}</span>
          </div>}
        </div>);
      })}</div>
      <div style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-default)", display: "flex", justifyContent: "space-between" }}>
        <span style={{ fontSize: 12, color: "var(--text-muted)" }}>Total</span>
        <span style={{ fontSize: 16, fontFamily: "JetBrains Mono", color: "var(--text-bright)", fontWeight: 700 }}>{topCats.reduce(function(s, c) { return s + c.rvu; }, 0).toFixed(1)} wRVUs</span>
      </div>
    </div>}

    {/* Monthly Summary Report */}
    <button onClick={function() { setShowSummary(!showSummary); }} style={{ ...S.secondaryBtn, width: "100%", marginBottom: 8, color: "#a78bfa", borderColor: "rgba(139,92,246,0.3)" }}>{showSummary ? "Hide Summary" : "Monthly Summary Report"}</button>
    {showSummary && <div style={{ ...S.card, border: "1px solid rgba(139,92,246,0.25)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <div style={S.cardLabel}>Monthly Report</div>
        <input type="month" value={summaryMonth} onChange={function(e) { setSummaryMonth(e.target.value); }} style={{ ...S.dateInput, fontSize: 12, padding: "4px 8px" }} />
      </div>
      <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-bright)", marginBottom: 12 }}>{summaryMonthName(summaryMonth)}</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div style={{ background: "var(--bg-inset)", borderRadius: 8, padding: 10, textAlign: "center" }}>
          <div style={{ fontSize: 22, fontFamily: "JetBrains Mono", color: "var(--text-bright)", fontWeight: 700 }}>{summaryData.totalRVU.toFixed(1)}</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase" }}>wRVUs</div>
        </div>
        <div style={{ background: "var(--bg-inset)", borderRadius: 8, padding: 10, textAlign: "center" }}>
          <div style={{ fontSize: 22, fontFamily: "JetBrains Mono", color: "#10b981", fontWeight: 700 }}>${summaryData.totalComp.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase" }}>Compensation</div>
        </div>
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr", gap: 6, marginBottom: 12 }}>
        {[[summaryData.caseCount, "Cases"], [summaryData.avgRVU.toFixed(1), "Avg/Case"], [summaryData.workDays, "Days"], [summaryData.uniquePatients, "Patients"]].map(function(item) { return <div key={item[1]} style={{ background: "var(--bg-inset)", borderRadius: 6, padding: "6px 4px", textAlign: "center" }}><div style={{ fontSize: 14, fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 600 }}>{item[0]}</div><div style={{ fontSize: 8, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5 }}>{item[1]}</div></div>; })}
      </div>
      {summaryData.privateCases + summaryData.callCases > 0 && <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <div style={{ flex: 1, padding: "6px 10px", borderRadius: 6, background: "rgba(14,165,233,0.06)", border: "1px solid rgba(14,165,233,0.15)" }}><div style={{ fontSize: 10, color: "#0ea5e9", fontWeight: 600 }}>Private</div><div style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: "var(--text-primary)" }}>{summaryData.privateRVU.toFixed(1)} wRVU | {summaryData.privateCases} cases</div></div>
        <div style={{ flex: 1, padding: "6px 10px", borderRadius: 6, background: "rgba(139,92,246,0.06)", border: "1px solid rgba(139,92,246,0.15)" }}><div style={{ fontSize: 10, color: "#a78bfa", fontWeight: 600 }}>Call</div><div style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: "var(--text-primary)" }}>{summaryData.callRVU.toFixed(1)} wRVU | {summaryData.callCases} cases</div></div>
      </div>}
      {goal > 0 && <div style={{ padding: "8px 10px", borderRadius: 6, background: "rgba(16,185,129,0.06)", border: "1px solid rgba(16,185,129,0.15)", marginBottom: 12, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div><span style={{ fontSize: 11, color: "#10b981", fontWeight: 600 }}>Monthly Goal Pace</span><div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>Target: {(goal / 12).toFixed(0)} wRVU/month</div></div>
        <span style={{ fontSize: 14, fontFamily: "JetBrains Mono", color: "#10b981", fontWeight: 700 }}>{((summaryData.totalRVU / (goal / 12)) * 100).toFixed(0)}%</span>
      </div>}
      {summaryData.topProcs.length > 0 && <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: "var(--text-muted)", textTransform: "uppercase", letterSpacing: 0.8, marginBottom: 6 }}>Top Procedures</div>
        {summaryData.topProcs.map(function(p) { return (<div key={p.code} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "4px 0", borderBottom: "1px solid rgba(51,65,85,0.3)" }}><div><span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "#0ea5e9", fontWeight: 600 }}>{p.code}</span><span style={{ fontSize: 10, color: "var(--text-dim)", marginLeft: 4 }}>x{p.count}</span><div style={{ fontSize: 11, color: "var(--text-muted)" }}>{p.desc.length > 35 ? p.desc.slice(0, 35) + "..." : p.desc}</div></div><span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 600, flexShrink: 0, marginLeft: 8 }}>{p.rvu.toFixed(1)}</span></div>); })}
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

