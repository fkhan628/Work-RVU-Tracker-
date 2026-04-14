// =======================================
// DASHBOARD
// =======================================
function Dashboard({ data, db, setView }) {
  const { entries, settings } = data;
  const instData = data.institutionData || [];
  const now = new Date();
  const hasInst = instData.length > 0;

  // Detect available years from entries and institution data
  var availableYears = useMemo(function() {
    var ySet = {};
    entries.forEach(function(e) { ySet[e.date.slice(0, 4)] = true; });
    instData.forEach(function(d) { ySet[d.month.slice(0, 4)] = true; });
    return Object.keys(ySet).sort().reverse();
  }, [entries, instData]);

  var currentFiscalYear = settings.yearStart ? settings.yearStart.slice(0, 4) : String(now.getFullYear());
  var [selectedYear, setSelectedYear] = useState("current");

  // Calculate year boundaries based on selection
  var yearBounds = useMemo(function() {
    if (selectedYear === "current") {
      var ys = new Date(settings.yearStart);
      var ye = new Date(ys); ye.setFullYear(ye.getFullYear() + 1);
      return { start: ys, end: ye, isCurrent: true, label: currentFiscalYear };
    }
    var ys = new Date(selectedYear + "-01-01");
    var ye = new Date(parseInt(selectedYear) + 1 + "-01-01");
    var isCurrent = now >= ys && now < ye;
    return { start: ys, end: ye, isCurrent: isCurrent, label: selectedYear };
  }, [selectedYear, settings.yearStart, currentFiscalYear]);

  var ys = yearBounds.start;
  var isCurrent = yearBounds.isCurrent;
  var effectiveNow = isCurrent ? now : yearBounds.end;

  // Institution data filtered to selected year
  const instYTD = instData.filter(function(d) {
    var dDate = new Date(d.month + "-01");
    return dDate >= ys && dDate < yearBounds.end;
  });
  const instTotal = instYTD.reduce(function(s, d) { return s + (d.workRVU || 0) + (d.splitRVU || 0); }, 0);
  const instWork = instYTD.reduce(function(s, d) { return s + (d.workRVU || 0); }, 0);
  const instSplit = instYTD.reduce(function(s, d) { return s + (d.splitRVU || 0); }, 0);

  // Tracked data for selected year
  const ye = entries.filter(function(e) { var d = new Date(e.date + "T12:00:00"); return d >= ys && d < yearBounds.end; });
  const trackedRVU = ye.reduce((s, e) => s + e.adjustedRVU, 0);

  // Use institution if available, otherwise tracked
  const tRVU = hasInst ? instTotal : trackedRVU;
  const tComp = tRVU * settings.ratePerRVU;
  const gPct = settings.annualGoal > 0 ? Math.min((tRVU / settings.annualGoal) * 100, 100) : 0;
  const dp = Math.max(1, Math.floor((effectiveNow - ys) / 86400000));
  const ePct = (dp / 365) * 100;
  const pace = gPct >= ePct ? "ahead" : "behind";
  const pDiff = Math.abs(tRVU - (settings.annualGoal * dp / 365));

  // Monthly chart - for current year show last 6 months, for past years show all 12
  const months = [];
  var chartMonths = isCurrent ? 6 : 12;
  var chartBase = isCurrent ? now : new Date(parseInt(yearBounds.label), 11, 1);
  for (var i = chartMonths - 1; i >= 0; i--) {
    var md = new Date(chartBase.getFullYear(), chartBase.getMonth() - i, 1);
    var mKey = md.getFullYear() + "-" + String(md.getMonth() + 1).padStart(2, "0");
    var mLabel = md.toLocaleDateString("en-US", { month: "short" });
    var instMonth = instData.find(function(d) { return d.month === mKey; });
    var trackedMonth = entries.filter(function(e) { var ed = new Date(e.date + "T12:00:00"); return ed.getMonth() === md.getMonth() && ed.getFullYear() === md.getFullYear(); });
    var trackedMRVU = trackedMonth.reduce(function(s, e) { return s + e.adjustedRVU; }, 0);
    var instMRVU = instMonth ? (instMonth.workRVU || 0) + (instMonth.splitRVU || 0) : 0;
    months.push({ label: mLabel, inst: instMRVU, tracked: trackedMRVU, primary: hasInst ? instMRVU : trackedMRVU });
  }
  const maxM = Math.max(...months.map(m => Math.max(m.inst, m.tracked)), 1);

  // Today and this week from tracked entries (current year only)
  const ws = new Date(now); ws.setDate(now.getDate() - now.getDay()); ws.setHours(0,0,0,0);
  const wRVU = isCurrent ? entries.filter(e => new Date(e.date + "T12:00:00") >= ws).reduce((s, e) => s + e.adjustedRVU, 0) : 0;
  const todayRVU = isCurrent ? entries.filter(e => e.date === now.toISOString().slice(0,10)).reduce((s, e) => s + e.adjustedRVU, 0) : 0;

  // Projected annual based on current pace
  var monthsElapsed = instYTD.length || Math.max(1, dp / 30.44);
  var projected = hasInst && instYTD.length > 0 ? (instTotal / instYTD.length) * 12 : (trackedRVU / Math.max(1, dp / 30.44)) * 12;

  // Previous year comparison
  var prevYearRVU = useMemo(function() {
    var prevStart = new Date(ys); prevStart.setFullYear(prevStart.getFullYear() - 1);
    var prevEnd = new Date(ys);
    var prevEntries = entries.filter(function(e) { var d = new Date(e.date + "T12:00:00"); return d >= prevStart && d < prevEnd; });
    var prevTracked = prevEntries.reduce(function(s, e) { return s + e.adjustedRVU; }, 0);
    var prevInst = instData.filter(function(d) { var dDate = new Date(d.month + "-01"); return dDate >= prevStart && dDate < prevEnd; });
    var prevInstTotal = prevInst.reduce(function(s, d) { return s + (d.workRVU || 0) + (d.splitRVU || 0); }, 0);
    var prevInstWork = prevInst.reduce(function(s, d) { return s + (d.workRVU || 0); }, 0);
    var prevInstSplit = prevInst.reduce(function(s, d) { return s + (d.splitRVU || 0); }, 0);
    if (prevInstTotal > 0 || prevTracked > 0) {
      return { total: hasInst ? prevInstTotal : prevTracked, hasData: true, instTotal: prevInstTotal, instWork: prevInstWork, instSplit: prevInstSplit, monthCount: prevInst.length };
    }
    return { total: 0, hasData: false, instTotal: 0, instWork: 0, instSplit: 0, monthCount: 0 };
  }, [entries, instData, ys, hasInst]);

  // Compensation calculations
  var goalComp = settings.annualGoal * settings.ratePerRVU;
  var projectedComp = projected * settings.ratePerRVU;
  var prevYearComp = prevYearRVU.instTotal * settings.ratePerRVU;

  return (<div style={S.page}>
    <div style={S.header}><h1 style={S.title}>RVU Tracker</h1><p style={S.subtitle}>{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p></div>

    {/* Year selector - only show if multi-year data exists */}
    {availableYears.length > 1 && <div style={S.catRow}>
      <button onClick={function() { setSelectedYear("current"); }} style={selectedYear === "current" ? S.catBtnActive : S.catBtn}>Current</button>
      {availableYears.map(function(y) { return <button key={y} onClick={function() { setSelectedYear(y); }} style={selectedYear === y ? S.catBtnActive : S.catBtn}>{y}</button>; })}
    </div>}

    <div style={S.cardMain}><div style={{ display: "flex", alignItems: "center", gap: 24 }}>
      <svg width="100" height="100" viewBox="0 0 100 100"><circle cx="50" cy="50" r="42" fill="none" stroke="#1e293b" strokeWidth="8" /><circle cx="50" cy="50" r="42" fill="none" stroke={pace === "ahead" ? "#10b981" : "#f59e0b"} strokeWidth="8" strokeLinecap="round" strokeDasharray={`${gPct * 2.639} 263.9`} transform="rotate(-90 50 50)" style={{ transition: "stroke-dasharray 0.8s ease" }} /><text x="50" y="46" textAnchor="middle" fill="#f8fafc" fontSize="18" fontFamily="JetBrains Mono" fontWeight="600">{gPct.toFixed(0)}%</text><text x="50" y="62" textAnchor="middle" fill="#94a3b8" fontSize="9" fontFamily="DM Sans">of goal</text></svg>
      <div><div style={S.metricBig}>{tRVU.toFixed(1)}</div><div style={S.metricLabel}>wRVUs {isCurrent ? "YTD" : yearBounds.label}</div>
        {hasInst && <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>W: {instWork.toFixed(0)} | C: {instSplit.toFixed(0)}</div>}
        <div style={{ ...S.paceTag, background: pace === "ahead" ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.15)", color: pace === "ahead" ? "#34d399" : "#fbbf24" }}>{pDiff.toFixed(1)} wRVUs {pace}</div>
      </div>
    </div>
    {hasInst && <div style={{ marginTop: 10, padding: "6px 10px", borderRadius: 8, background: "rgba(139,92,246,0.08)", border: "1px solid rgba(139,92,246,0.15)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
      <span style={{ fontSize: 10, color: "#a78bfa" }}>Source: Institution Data</span>
      <span style={{ fontSize: 10, color: "#64748b" }}>Projected: {projected.toFixed(0)} wRVUs/yr</span>
    </div>}
    </div>

    <div style={S.statsRow}>
      {isCurrent ? <>
        <div style={S.statCard}><div style={S.statValue}>{todayRVU.toFixed(1)}</div><div style={S.statLabel}>Today</div></div>
        <div style={S.statCard}><div style={S.statValue}>{wRVU.toFixed(1)}</div><div style={S.statLabel}>This Week</div></div>
      </> : <>
        <div style={S.statCard}><div style={S.statValue}>{countEncounters(ye)}</div><div style={S.statLabel}>Encounters</div></div>
        <div style={S.statCard}><div style={S.statValue}>{countEncounters(ye) > 0 ? (tRVU / countEncounters(ye)).toFixed(1) : "0"}</div><div style={S.statLabel}>Avg/Enc</div></div>
      </>}
      <div style={S.statCard}><div style={{ ...S.statValue, color: "#10b981" }}>${tComp.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div><div style={S.statLabel}>{isCurrent ? "Comp YTD" : "Comp " + yearBounds.label}</div></div>
    </div>

    {/* Year-over-year comparison */}
    {prevYearRVU.hasData && <div style={{ ...S.card, border: "1px solid rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.02)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 10, color: "#a78bfa", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>vs. Prior Year</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>Same period last year: {prevYearRVU.total.toFixed(0)} wRVUs</div>
        </div>
        <div style={{ textAlign: "right" }}>
          {(function() {
            var yoyDiff = tRVU - prevYearRVU.total;
            var yoyPct = prevYearRVU.total > 0 ? ((yoyDiff / prevYearRVU.total) * 100) : 0;
            return <>
              <div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: yoyDiff >= 0 ? "#10b981" : "#f59e0b", fontWeight: 700 }}>{yoyDiff >= 0 ? "+" : ""}{yoyDiff.toFixed(0)}</div>
              <div style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "#64748b" }}>{yoyDiff >= 0 ? "+" : ""}{yoyPct.toFixed(1)}%</div>
            </>;
          })()}
        </div>
      </div>
    </div>}

    {/* Prior Year Institution RVU */}
    {hasInst && prevYearRVU.instTotal > 0 && <div style={{ ...S.card, border: "1px solid rgba(100,116,139,0.25)" }}>
      <div style={S.cardLabel}>Prior Year (Institution)</div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 24, fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 700 }}>{prevYearRVU.instTotal.toFixed(0)}</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 1 }}>wRVUs total</div>
          <div style={{ fontSize: 10, color: "#64748b", marginTop: 1 }}>W: {prevYearRVU.instWork.toFixed(0)} | C: {prevYearRVU.instSplit.toFixed(0)}</div>
        </div>
        <div style={{ textAlign: "right" }}>
          {settings.ratePerRVU > 0 && <div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "#10b981", fontWeight: 600 }}>${prevYearComp.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>}
          {settings.ratePerRVU > 0 && <div style={{ fontSize: 10, color: "var(--text-dim)" }}>prior year comp</div>}
          {prevYearRVU.monthCount > 0 && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>{prevYearRVU.monthCount} months | avg {(prevYearRVU.instTotal / prevYearRVU.monthCount).toFixed(0)}/mo</div>}
        </div>
      </div>
    </div>}

    {/* Compensation Breakdown */}
    {settings.ratePerRVU > 0 && settings.annualGoal > 0 && <div style={{ ...S.card, border: "1px solid rgba(16,185,129,0.2)", background: "rgba(16,185,129,0.02)" }}>
      <div style={S.cardLabel}>Compensation</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5 }}>Goal</div>
          <div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 600 }}>${goalComp.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{settings.annualGoal.toLocaleString()} wRVUs</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: projectedComp >= goalComp ? "#10b981" : "#f59e0b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Projected</div>
          <div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: projectedComp >= goalComp ? "#10b981" : "#f59e0b", fontWeight: 600 }}>${projectedComp.toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
          <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{projected.toFixed(0)} wRVUs</div>
        </div>
      </div>
      {(function() {
        var compDiff = projectedComp - goalComp;
        return <div style={{ marginTop: 10, padding: "6px 10px", borderRadius: 8, background: compDiff >= 0 ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.08)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <span style={{ fontSize: 11, color: compDiff >= 0 ? "#10b981" : "#f59e0b", fontWeight: 600 }}>{compDiff >= 0 ? "+" : ""}{compDiff.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 })} vs goal</span>
          <span style={{ fontSize: 10, color: "var(--text-dim)" }}>${settings.ratePerRVU}/wRVU</span>
        </div>;
      })()}
    </div>}

    <div style={S.card}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={S.cardLabel}>{isCurrent ? "Monthly wRVUs" : yearBounds.label + " Monthly wRVUs"}</div>{hasInst && <div style={{ display: "flex", gap: 8 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: "#a78bfa" }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#a78bfa" }}></span>Inst</span>
      <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: "#0ea5e9" }}><span style={{ display: "inline-block", width: 8, height: 3, borderRadius: 1, background: "#0ea5e9" }}></span>Tracked</span>
    </div>}</div>
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 110, marginTop: 12 }}>{months.map(function(m, i) {
      var instH = maxM > 0 ? (m.inst / maxM) * 80 : 0;
      var trackH = maxM > 0 ? (m.tracked / maxM) * 80 : 0;
      var isLast = i === months.length - 1 && isCurrent;
      return (<div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
        <span style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "#cbd5e1", fontWeight: 500 }}>{m.primary > 0 ? m.primary.toFixed(0) : ""}</span>
        <div style={{ width: "100%", position: "relative" }}>
          {hasInst && <div style={{ width: "100%", height: Math.max(instH > 0 ? instH : 0, instH > 0 ? 4 : 0), background: isLast ? "linear-gradient(to top, #8b5cf6, #a78bfa)" : "linear-gradient(to top, #334155, #475569)", borderRadius: 4, transition: "height 0.3s" }} />}
          {hasInst && m.tracked > 0 && <div style={{ position: "absolute", bottom: 0, left: "25%", width: "50%", height: Math.max(4, trackH), background: "#0ea5e9", borderRadius: 2, opacity: 0.8 }} />}
          {!hasInst && <div style={{ width: "100%", height: Math.max(4, trackH > 0 ? trackH : 0), background: isLast ? "linear-gradient(to top, #0ea5e9, #38bdf8)" : "linear-gradient(to top, #334155, #475569)", borderRadius: 4 }} />}
        </div>
        <span style={{ fontSize: 10, color: "#94a3b8" }}>{m.label}</span>
      </div>);
    })}</div></div>

    {entries.length > 0 && <div style={S.card}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={S.cardLabel}>Recent Procedures</div><button onClick={() => setView("history")} style={S.linkBtn}>View All </button></div><div style={{ marginTop: 8 }}>{entries.slice(-3).reverse().map((e, i) => (<div key={i} style={S.recentItem}><div><div style={S.recentCode}>{e.cptCode}</div><div style={S.recentDesc}>{e.description}</div></div><div style={{ textAlign: "right" }}><div style={S.recentRVU}>{e.adjustedRVU.toFixed(2)}</div><div style={S.recentDate}>{fmtShort(e.date)}</div></div></div>))}</div></div>}

    {!hasInst && <div style={{ ...S.card, border: "1px solid rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.03)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{"\u2194"}</span>
        <div>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#a78bfa" }}>Add Institution Data</div>
          <div style={{ fontSize: 11, color: "#64748b" }}>Go to Compare tab to import your institution's RVU data for goal tracking</div>
        </div>
      </div>
    </div>}

    <div style={{ ...S.card, background: "#0f172a", border: "1px solid #1e293b", padding: "10px 16px" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontSize: 11, color: "#475569" }}>Data: {hasInst ? "Institution" : "Self-tracked"} | CMS {DATA_YEAR}</span><span style={{ fontSize: 10, color: "#334155", fontFamily: "JetBrains Mono" }}>{DATA_VERSION}</span></div></div>
    <button onClick={() => setView("log")} style={S.fabBtn}>+ Log Procedure</button>
  </div>);
}

