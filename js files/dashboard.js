// =======================================
// DASHBOARD
// =======================================
function Dashboard({ data, db, setView, showComp, toggleComp, openAcute, openCallPay, openHistory, openBackup, openDirectorships }) {
  const { entries, settings } = data;
  const instData = data.institutionData || [];
  const now = new Date();
  const hasInst = instData.length > 0;

  // Years with any data - shared derivation with Trends (utils.js), so the
  // two chip rows can never drift.
  var availableYears = useMemo(function() {
    return availableDataYears(data);
  }, [entries, instData, data.acuteMonths, data.payShifts]);

  // "Current" is the year window holding today: Year Start read as a yearly
  // anniversary (utils.js currentYearStartYMD; nothing stored changes).
  var curYS = currentYearStartYMD(settings.yearStart, todayLocal());
  var [selectedYear, setSelectedYear] = useState("current");
  // Backup nudge: per-device stamp outside the store (utils.js). Home remounts
  // on every view switch, so a backup saved in More is picked up on return.
  var [backupStamp, setBackupStamp] = useState(readBackupStamp);
  // Directorships month-end reminder: dismissed per month, per device, in a
  // key OUTSIDE the store (utils.js readDirReminder / dismissDirReminder).
  var [dirHide, setDirHide] = useState(readDirReminder);

  // Calculate year boundaries based on selection. LOCAL midnights
  // (localDateYMD): new Date("YYYY-MM-DD") is UTC midnight - the evening
  // before in US time zones - which ran the pace day count one day high
  // every evening. curYS is always a valid key (a cleared or malformed Year
  // Start reads as Jan 1).
  var yearBounds = useMemo(function() {
    if (selectedYear === "current") {
      var ys = localDateYMD(curYS);
      var ye = new Date(ys); ye.setFullYear(ye.getFullYear() + 1);
      return { start: ys, end: ye, isCurrent: true, label: curYS.slice(0, 4) };
    }
    var ys = localDateYMD(selectedYear + "-01-01");
    var ye = localDateYMD((parseInt(selectedYear, 10) + 1) + "-01-01");
    var isCurrent = now >= ys && now < ye;
    return { start: ys, end: ye, isCurrent: isCurrent, label: selectedYear };
  }, [selectedYear, curYS]);

  var ys = yearBounds.start;
  var isCurrent = yearBounds.isCurrent;
  var effectiveNow = isCurrent ? now : yearBounds.end;

  // Tracked data for selected year
  const ye = entries.filter(function(e) { var d = new Date(e.date + "T12:00:00"); return d >= ys && d < yearBounds.end; });
  const trackedRVU = ye.reduce((s, e) => s + creditedRVU(e), 0);
  // No-credit cases (isNoCredit - e.g. acute-care pool call cases) are logged
  // for the record but are out of every total: they show once, on a quiet
  // line. Counts beside or dividing a credited figure count credited cases.
  // The line counts the SAME date-string window it opens in History (and
  // Trends uses): the Date-based window above can differ by a boundary day.
  var ncRange = fiscalYearBoundsYMD(selectedYear === "current" ? curYS : selectedYear + "-01-01");
  const yeNC = ncRange ? entries.filter(function(e) { return isNoCredit(e) && e.date >= ncRange.start && e.date <= ncRange.end; }) : [];
  const yeCredited = ye.filter(function(e) { return !isNoCredit(e); });
  const ncRVU = yeNC.reduce(function(s, e) { return s + noCreditRVU(e); }, 0);
  const ncEnc = countEncounters(yeNC);
  const credEnc = countEncounters(yeCredited);

  // Comp YTD comes from proj.ytdComp below (compProjection: this window's
  // Compare months when there are any, else logged wRVU).
  const dp = Math.max(1, localDaysBetween(ys, effectiveNow));

  // Compare months, one row per month (a duplicated month counts once, the
  // last row) - shared by the chart below and the Reconciliation track.
  var instByMonth = {};
  instData.forEach(function(row) { if (row && row.month) instByMonth[row.month] = (row.workRVU || 0) + (row.splitRVU || 0); });

  // Monthly chart - for current year show last 6 months, for past years show
  // all 12. The chart's OWN months decide its style (chartInst: one of them
  // has a Compare row - on Current these are the last 6 calendar months,
  // which can reach before Year Start), never Compare data from any year.
  // When chartInst, a month with a row shows that total (0 included) and a
  // month without one (the current month, before its statement is entered)
  // shows its logged figure in the Tracked colour over a narrow in-flow bar;
  // otherwise it is the plain tracked chart.
  const months = [];
  var chartMonths = isCurrent ? 6 : 12;
  var chartBase = isCurrent ? now : new Date(parseInt(yearBounds.label), 11, 1);
  for (var i = chartMonths - 1; i >= 0; i--) {
    var md = new Date(chartBase.getFullYear(), chartBase.getMonth() - i, 1);
    var mKey = md.getFullYear() + "-" + String(md.getMonth() + 1).padStart(2, "0");
    var mLabel = md.toLocaleDateString("en-US", { month: "short" });
    var hasRow = instByMonth[mKey] !== undefined;
    var trackedMonth = entries.filter(function(e) { var ed = new Date(e.date + "T12:00:00"); return ed.getMonth() === md.getMonth() && ed.getFullYear() === md.getFullYear(); });
    var trackedMRVU = trackedMonth.reduce(function(s, e) { return s + creditedRVU(e); }, 0);
    var instMRVU = hasRow ? instByMonth[mKey] : 0;
    months.push({ label: mLabel, inst: instMRVU, tracked: trackedMRVU, hasRow: hasRow, primary: hasRow ? instMRVU : trackedMRVU });
  }
  var chartInst = months.some(function(m) { return m.hasRow; });
  const maxM = Math.max(...months.map(m => Math.max(m.inst, m.tracked)), 1);

  // Today and this week from tracked entries (current year only). This Week
  // is Sunday through TODAY, as date keys (a case dated later this week
  // counts on its own day, like Today and the call-pay window).
  const ws = new Date(now); ws.setDate(now.getDate() - now.getDay()); ws.setHours(0,0,0,0);
  const wRVU = isCurrent ? entries.filter(e => e.date >= localYMD(ws) && e.date <= localYMD(now)).reduce((s, e) => s + creditedRVU(e), 0) : 0;
  const todayRVU = isCurrent ? entries.filter(e => e.date === localYMD(now)).reduce((s, e) => s + creditedRVU(e), 0) : 0;

  // --- Two independent tracks (never blended) ---
  // Track 1 "Tracked OR": logged entries only. Track 2 "Reconciliation":
  // institution monthly totals read directly from institutionData (Compare).
  // Year window as "YYYY-MM" strings - pure string math, no Date/UTC involved,
  // over instByMonth (above: one row per month, the last). The current
  // window starts from curYS, like ys, cpFrom and ncRange.
  var startYM;
  if (selectedYear === "current") {
    startYM = curYS.slice(0, 7);
  } else {
    startYM = selectedYear + "-01";
  }
  var endYM = (parseInt(startYM.slice(0, 4), 10) + 1) + startYM.slice(4);
  var reconKeys = Object.keys(instByMonth).filter(function(k) { return k >= startYM && k < endYM; }).sort();
  var reconYTD = reconKeys.reduce(function(s, k) { return s + instByMonth[k]; }, 0);
  var reconCount = reconKeys.length;
  var reconGoal = settings.reconGoal || 0;
  var reconPct = reconGoal > 0 ? Math.min((reconYTD / reconGoal) * 100, 100) : 0;
  // Both paces and the Compensation card come from ONE rule (utils.js
  // compProjection): Recon pace annualizes from months actually ENTERED, not
  // days elapsed; Tracked OR pace from logged entries ONLY, never institution
  // data. The card projects from the Compare months when there are any (the
  // Reconciliation card's own months and pace), else from the tracked pace;
  // Comp YTD (proj.ytdComp) adds up the same source.
  var proj = compProjection({ trackedWRVU: trackedRVU, trackedDays: dp, compareWRVU: reconYTD, compareMonths: reconCount, annualGoal: settings.annualGoal, reconGoal: settings.reconGoal, rate: settings.ratePerRVU });
  var reconPace = proj.comparePace;
  var orPace = proj.trackedPace;
  var orPct = settings.annualGoal > 0 ? Math.min((trackedRVU / settings.annualGoal) * 100, 100) : 0;
  // Derived call + clinic: reconciliation minus tracked OR over the SAME months
  // only. Negative means more OR logged than the institution credited - real
  // information, shown plainly, never clamped.
  var reconKeySet = {};
  reconKeys.forEach(function(k) { reconKeySet[k] = true; });
  var orSameMonths = ye.reduce(function(s, e) { return reconKeySet[e.date.slice(0, 7)] ? s + creditedRVU(e) : s; }, 0);
  var derivedCallClinic = reconYTD - orSameMonths;

  // --- Acute care: my share + derived decomposition (quiet lines, no cards) ---
  // YTD = sum of per-month ROUNDED shares (matches how the group's monthly
  // statements add up on paper; round-of-sum can differ by a cent).
  var acuteMonthsAll = data.acuteMonths || {};
  var acuteMe = data.acuteMe || "";
  var acuteKeys = Object.keys(acuteMonthsAll).filter(function(k) { return k >= startYM && k < endYM; }).sort();
  // Call pay (dollars) for the selected period - a SEPARATE line, never
  // added to Comp YTD. Same window as the rest of the page: the fiscal year
  // from curYS for "current", the calendar year for a chip;
  // the current period counts only shifts dated today or earlier.
  var cpFrom = selectedYear === "current" ? curYS : selectedYear + "-01-01";
  var cpTo = (+cpFrom.slice(0, 4) + 1) + cpFrom.slice(4);
  // Sites are passed so a shift that still needs Day or Night (payShiftNeedsType)
  // is counted in needsType, never guessed into the total.
  var callPay = payTotalInRange(data.payShifts || [], cpFrom, cpTo, isCurrent ? todayLocal() : null, data.paySites);
  // Directorship pay: the same window, its own line - never added to Comp.
  var dirPay = dirTotalInRange(data, cpFrom, cpTo, isCurrent ? todayLocal() : null);
  var dirLine = dirReminderLine(data, todayLocal(), dirHide);

  var myAcuteYTD = 0;
  var myAcuteCount = 0;
  acuteKeys.forEach(function(k) {
    var sp = computeAcuteSplit(acuteMonthsAll[k]);
    if (sp.empty || !acuteMe) return;
    myAcuteYTD += round2(((acuteMonthsAll[k].shifts || {})[acuteMe] || 0) * sp.valuePerUnit);
    myAcuteCount++;
  });
  myAcuteYTD = round2(myAcuteYTD);
  // Decompose derived call+clinic over the recon-AND-acute overlapping months only.
  var overlapKeys = reconKeys.filter(function(k) { return acuteKeys.indexOf(k) !== -1; });
  var overlapKeySet = {};
  overlapKeys.forEach(function(k) { overlapKeySet[k] = true; });
  var overlapRecon = overlapKeys.reduce(function(s, k) { return s + instByMonth[k]; }, 0);
  var overlapOR = ye.reduce(function(s, e) { return overlapKeySet[e.date.slice(0, 7)] ? s + creditedRVU(e) : s; }, 0);
  var overlapMyAcute = 0;
  overlapKeys.forEach(function(k) {
    var sp = computeAcuteSplit(acuteMonthsAll[k]);
    if (sp.empty || !acuteMe) return;
    overlapMyAcute += round2(((acuteMonthsAll[k].shifts || {})[acuteMe] || 0) * sp.valuePerUnit);
  });
  var clinicOther = overlapRecon - overlapOR - overlapMyAcute;

  // Prior Year (Institution) card: the WHOLE prior year of institution rows.
  // (vs. Prior Year below compares the same span instead - see yoy.)
  var prevYearRVU = useMemo(function() {
    var prevStart = new Date(ys); prevStart.setFullYear(prevStart.getFullYear() - 1);
    var prevEnd = new Date(ys);
    var prevInst = instData.filter(function(d) { var dDate = localDateYMD(d.month + "-01"); return dDate >= prevStart && dDate < prevEnd; });
    var prevInstTotal = prevInst.reduce(function(s, d) { return s + (d.workRVU || 0) + (d.splitRVU || 0); }, 0);
    var prevInstWork = prevInst.reduce(function(s, d) { return s + (d.workRVU || 0); }, 0);
    var prevInstSplit = prevInst.reduce(function(s, d) { return s + (d.splitRVU || 0); }, 0);
    return { instTotal: prevInstTotal, instWork: prevInstWork, instSplit: prevInstSplit, monthCount: prevInst.length };
  }, [instData, ys]);

  // vs. Prior Year: the SAME span on both sides (utils.js yoyTotals over
  // priorSpanYMD, string date keys only). This window's Compare months that
  // ALSO have the month a year earlier (a month missing on either side drops
  // out of both); when there are none - no Compare month here, or none with
  // last year's month - logged cases (creditedRVU) over the year window cut
  // at today vs the same span a year earlier (a past-year chip, or a year
  // already over, compares whole years). The label names the source; the
  // tracks never blend.
  var yoySpan = priorSpanYMD(cpFrom, todayLocal());
  var yoy = yoyTotals(reconKeys, instByMonth, entries, yoySpan);
  var yoyLabel = yoy.source === "compare" ? "Compare - same " + yoy.months + " month" + (yoy.months === 1 ? "" : "s") + ", prior year"
    : "Tracked OR - " + (yoySpan && yoySpan.toDate ? "same period last year (to " + fmtShort(yoySpan.cur.end) + ")" : "prior full year");

  // Compensation card figures come from proj (compProjection) above.
  var prevYearComp = prevYearRVU.instTotal * settings.ratePerRVU;
  var backupDue = backupNudgeDue(backupStamp, todayLocal(), entries.length + (data.payShifts || []).length + dirEntriesOf(data).length);

  return (<div style={S.page}>
    <div style={S.header}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}><div><h1 style={S.title}>RVU Tracker</h1><p style={S.subtitle}>{now.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</p></div>
      <CompEye showComp={showComp} toggleComp={toggleComp} style={{ marginTop: 4 }} />
    </div></div>

    {/* Year selector - Compare's pattern: Current + 2 prior years pinned,
        older data-years in a dropdown */}
    {availableYears.length > 1 && (function() {
      var nowY = now.getFullYear();
      var pinned = [String(nowY - 1), String(nowY - 2)].filter(function(y) { return availableYears.indexOf(y) !== -1; });
      var older = availableYears.filter(function(y) { return y !== String(nowY) && pinned.indexOf(y) === -1; });
      var olderSelected = older.indexOf(selectedYear) !== -1;
      return (<div style={S.catRow}>
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

    {/* Two independent goal tracks, equal weight. Wraps to stacked below ~340px. */}
    <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginBottom: 12 }}>
      <div style={{ ...S.card, flex: "1 1 150px", marginBottom: 0 }}>
        <div style={{ fontSize: 10, color: "#38bdf8", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>Tracked OR wRVUs</div>
        <div style={{ fontSize: 26, fontFamily: "JetBrains Mono", fontWeight: 700, color: "var(--text-bright)", marginTop: 6 }}>{trackedRVU.toFixed(1)}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{settings.annualGoal > 0 ? "of " + settings.annualGoal.toLocaleString() + " goal" : "no goal set"}</div>
        <div style={{ height: 6, borderRadius: 3, background: "rgba(51,65,85,0.6)", marginTop: 8, overflow: "hidden" }}><div style={{ width: orPct + "%", height: "100%", borderRadius: 3, background: "linear-gradient(90deg, #0ea5e9, #38bdf8)", transition: "width 0.5s" }} /></div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, minHeight: 13 }}>
          <span style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "var(--text-dim)" }}>{settings.annualGoal > 0 ? orPct.toFixed(0) + "%" : ""}</span>
          {isCurrent && <span style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: settings.annualGoal > 0 ? (orPace >= settings.annualGoal ? "#34d399" : "#fbbf24") : "var(--text-dim)" }}>pace {orPace.toFixed(0)}/yr</span>}
        </div>
      </div>
      <div style={{ ...S.card, flex: "1 1 150px", marginBottom: 0 }}>
        <div style={{ fontSize: 10, color: "#34d399", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700 }}>Reconciliation</div>
        <div style={{ fontSize: 26, fontFamily: "JetBrains Mono", fontWeight: 700, color: "var(--text-bright)", marginTop: 6 }}>{reconYTD.toFixed(1)}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{reconGoal > 0 ? "of " + reconGoal.toLocaleString() + " goal" : "no goal set"}</div>
        <div style={{ height: 6, borderRadius: 3, background: "rgba(51,65,85,0.6)", marginTop: 8, overflow: "hidden" }}><div style={{ width: reconPct + "%", height: "100%", borderRadius: 3, background: "linear-gradient(90deg, #059669, #34d399)", transition: "width 0.5s" }} /></div>
        <div style={{ display: "flex", justifyContent: "space-between", marginTop: 6, minHeight: 13 }}>
          <span style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "var(--text-dim)" }}>{reconGoal > 0 && reconCount > 0 ? reconPct.toFixed(0) + "%" : ""}</span>
          {reconCount > 0 ? (isCurrent && <span style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: reconGoal > 0 ? (reconPace >= reconGoal ? "#34d399" : "#fbbf24") : "var(--text-dim)" }}>pace {reconPace.toFixed(0)}/yr</span>) : <span onClick={function() { setView("compare"); }} style={{ fontSize: 10, color: "var(--text-faint)", cursor: "pointer" }}>{"add months in Compare \u203A"}</span>}
        </div>
      </div>
    </div>
    {/* Quiet derived lines - no goals, no cards */}
    {(yeNC.length > 0 || reconCount > 0 || myAcuteCount > 0 || callPay.shifts > 0 || callPay.needsType > 0 || (dirList(data).length > 0 && dirPay.entries > 0)) && <div style={{ padding: "0 4px", marginTop: -6, marginBottom: 12 }}>
      {yeNC.length > 0 && <div onClick={function() { if (openHistory) openHistory(ncRange); }} style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3, cursor: "pointer", display: "flex", alignItems: "center", minHeight: 24 }}>
        <span>{"Logged, no credit (" + (isCurrent ? "YTD" : yearBounds.label) + "): "}<span style={{ fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 600 }}>{ncRVU.toFixed(1)}</span>{" wRVU across " + ncEnc + " encounter" + (ncEnc === 1 ? "" : "s")}</span>
        <span style={{ marginLeft: 6, color: "var(--text-dim)", fontSize: 13, lineHeight: 1 }}>{"\u203A"}</span>
      </div>}
      {/* Call pay: the total, then (only where the window has Day/Night or
          flagged shifts - utils.js payTotalInRange.split) the per-type split,
          one line per type that pays time in, and the amber needs-type count.
          A flagged shift is never in the total, so the line also shows when
          it is the only thing in the window. */}
      {(callPay.shifts > 0 || callPay.needsType > 0) && <div onClick={function() { if (openCallPay) openCallPay("dashboard"); }} style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3, cursor: "pointer" }}>
        <div style={{ display: "flex", alignItems: "center", minHeight: 24 }}>
          <span>{"Call pay (" + (isCurrent ? "YTD" : yearBounds.label) + "): "}{callPay.shifts > 0
            ? <span><span style={{ fontFamily: "JetBrains Mono", color: "#10b981", fontWeight: 600 }}>{fmtDollar(callPay.total, showComp)}</span>{" across " + callPay.shifts + " shift" + (callPay.shifts === 1 ? "" : "s")}</span>
            : <span style={{ color: "#f59e0b" }}>nothing counted yet</span>}</span>
          <span style={{ marginLeft: 6, color: "#10b981", fontSize: 13, lineHeight: 1 }}>{"\u203A"}</span>
        </div>
        {callPay.split.length > 0 && <div style={{ paddingLeft: 10, color: "var(--text-faint)", lineHeight: 1.6 }}>
          {callPay.split.map(function(b, i) { return (<span key={b.key || "other"} style={{ whiteSpace: "nowrap" }}>{(i ? " \u00B7 " : "") + b.label + " " + b.shifts + " "}<span style={{ fontFamily: "JetBrains Mono" }}>{fmtDollar(b.total, showComp)}</span></span>); })}
        </div>}
        {callPay.split.filter(function(b) { return b.ciShifts > 0; }).map(function(b) { return (<div key={"in-" + (b.key || "other")} style={{ paddingLeft: 10, color: "var(--text-faint)", lineHeight: 1.6 }}>{b.label + "s: " + payBucketInLine(b)}</div>); })}
        {callPay.needsType > 0 && <div style={{ paddingLeft: 10, color: "#f59e0b", lineHeight: 1.6 }}>{callPay.needsType + " shift" + (callPay.needsType === 1 ? " needs" : "s need") + " a type - not in the total"}</div>}
      </div>}
      {dirList(data).length > 0 && dirPay.entries > 0 && <div onClick={function() { if (openDirectorships) openDirectorships("dashboard"); }} style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 3, cursor: "pointer", display: "flex", alignItems: "center", minHeight: 24 }}>
        <span>{"Directorships (" + (isCurrent ? "YTD" : yearBounds.label) + "): "}<span style={{ fontFamily: "JetBrains Mono", color: "#10b981", fontWeight: 600 }}>{dirMoneyShown(dirPay.total, showComp)}</span></span>
        <span style={{ marginLeft: 6, color: "#10b981", fontSize: 13, lineHeight: 1 }}>{"\u203A"}</span>
      </div>}
      {reconCount > 0 && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>
        Call + clinic (derived): <span style={{ fontFamily: "JetBrains Mono", color: derivedCallClinic >= 0 ? "var(--text-primary)" : "#f59e0b", fontWeight: 600 }}>{(derivedCallClinic >= 0 ? "+" : "") + derivedCallClinic.toFixed(1)}</span> across {reconCount} entered month{reconCount === 1 ? "" : "s"}
      </div>}
      {myAcuteCount > 0 && <div onClick={function() { if (openAcute) openAcute("dashboard"); }} style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3, cursor: "pointer", display: "flex", alignItems: "center" }}>
        <span>{"My acute share (" + (isCurrent ? "YTD" : yearBounds.label) + "): "}<span style={{ fontFamily: "JetBrains Mono", color: "#34d399", fontWeight: 600 }}>{myAcuteYTD.toFixed(2)}</span> across {myAcuteCount} entered month{myAcuteCount === 1 ? "" : "s"}</span>
        <span style={{ marginLeft: 6, color: "#34d399", fontSize: 13, lineHeight: 1 }}>{"\u203A"}</span>
      </div>}
      {myAcuteCount > 0 && reconCount > 0 && overlapKeys.length > 0 && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 3 }}>
        Clinic + other (derived): <span style={{ fontFamily: "JetBrains Mono", color: clinicOther >= 0 ? "var(--text-primary)" : "#f59e0b", fontWeight: 600 }}>{(clinicOther >= 0 ? "+" : "") + clinicOther.toFixed(1)}</span> across {overlapKeys.length} overlapping month{overlapKeys.length === 1 ? "" : "s"}
      </div>}
    </div>}
    {/* Backup nudge: 14+ days since this phone saved a backup (or never),
        only with data to lose; the x snoozes it for 7 days. */}
    {backupDue && <div style={{ padding: "0 4px", marginTop: -6, marginBottom: 12, display: "flex", alignItems: "center", gap: 4 }}>
      <div onClick={function() { if (openBackup) openBackup(); }} style={{ flex: 1, fontSize: 11, color: "var(--global-90)", cursor: "pointer", display: "flex", alignItems: "center", minHeight: 24 }}>
        <span>{backupStamp.date ? "Last backup " + fmt(backupStamp.date) + " - save a new backup file" : "No backup recorded on this phone yet - save a backup file"}</span>
        <span style={{ marginLeft: 6, fontSize: 13, lineHeight: 1 }}>{"\u203A"}</span>
      </div>
      <button onClick={function() { setBackupStamp(snoozeBackupNudge(todayLocal())); }} aria-label="Remind me in a week" style={{ background: "none", border: "none", color: "var(--text-faint)", fontSize: 13, cursor: "pointer", minWidth: 32, minHeight: 32, padding: 0 }}>{"\u2715"}</button>
    </div>}
    {/* Directorships: from the 25th of a month through the 5th of the next,
        until every form for that month is handed off; x hides that month. */}
    {dirLine && <div style={{ padding: "0 4px", marginTop: -6, marginBottom: 12, display: "flex", alignItems: "center", gap: 4 }}>
      <div onClick={function() { if (openDirectorships) openDirectorships("dashboard", dirLine.ym); }} style={{ flex: 1, fontSize: 11, color: dirLine.late ? "var(--global-90)" : "var(--text-muted)", cursor: "pointer", display: "flex", alignItems: "center", minHeight: 24 }}>
        <span>{dirLine.text}</span>
        <span style={{ marginLeft: 6, fontSize: 13, lineHeight: 1 }}>{"\u203a"}</span>
      </div>
      <button onClick={function() { setDirHide(dismissDirReminder(dirLine.ym)); }} aria-label={"Hide for " + dirMonthLabel(dirLine.ym).split(" ")[0]} style={{ background: "none", border: "none", color: "var(--text-faint)", fontSize: 13, cursor: "pointer", minWidth: 32, minHeight: 32, padding: 0 }}>{"\u2715"}</button>
    </div>}

    <div style={S.statsRow}>
      {isCurrent ? <>
        <div style={S.statCard}><div style={S.statValue}>{todayRVU.toFixed(1)}</div><div style={S.statLabel}>Today</div></div>
        <div style={S.statCard}><div style={S.statValue}>{wRVU.toFixed(1)}</div><div style={S.statLabel}>This Week</div></div>
      </> : <>
        <div style={S.statCard}><div style={S.statValue}>{credEnc}</div><div style={S.statLabel}>Encounters</div></div>
        {/* Per logged encounter: logged credited wRVU / credited encounters,
            never a Compare total (that includes call + clinic). */}
        <div style={S.statCard}><div style={S.statValue}>{credEnc > 0 ? (trackedRVU / credEnc).toFixed(1) : "0"}</div><div style={S.statLabel}>Avg/Enc</div></div>
      </>}
      <div style={S.statCard}><div style={{ ...S.statValue, color: "#10b981" }}>{fmtDollar(proj.ytdComp, showComp)}</div><div style={S.statLabel}>{isCurrent ? "Comp YTD" : "Comp " + yearBounds.label}</div></div>
    </div>

    {/* Year-over-year comparison - the same span on both sides (yoy) */}
    {Math.round(yoy.prev) > 0 && <div style={{ ...S.card, border: "1px solid rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.02)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 10, color: "#a78bfa", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>vs. Prior Year</div>
          <div style={{ fontSize: 11, color: "#64748b", marginTop: 2 }}>{yoyLabel}: {yoy.prev.toFixed(0)} wRVUs</div>
        </div>
        <div style={{ textAlign: "right" }}>
          {(function() {
            var yoyDiff = yoy.cur - yoy.prev;
            var yoyPct = (yoyDiff / yoy.prev) * 100;
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
          {settings.ratePerRVU > 0 && <div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "#10b981", fontWeight: 600 }}>{fmtDollar(prevYearComp, showComp)}</div>}
          {settings.ratePerRVU > 0 && <div style={{ fontSize: 10, color: "var(--text-dim)" }}>prior year comp</div>}
          {prevYearRVU.monthCount > 0 && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 2 }}>{prevYearRVU.monthCount} months | avg {(prevYearRVU.instTotal / prevYearRVU.monthCount).toFixed(0)}/mo</div>}
        </div>
      </div>
    </div>}

    {/* Compensation Breakdown. Source, goal and labels all come from
        compProjection (utils.js): the goal is the source's own track's,
        except a Compare projection with no Reconciliation goal, which is
        compared with the OR goal and says so. This only formats and masks. */}
    {proj.show && <div style={{ ...S.card, border: "1px solid rgba(16,185,129,0.2)", background: "rgba(16,185,129,0.02)" }}>
      <div style={S.cardLabel}>Compensation</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 10 }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5 }}>{proj.goalTile}</div>
          <div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 600 }}>{fmtDollar(proj.goalComp, showComp)}</div>
          <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{proj.goalWRVU.toLocaleString()} wRVUs</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: proj.onPace ? "#10b981" : "#f59e0b", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 600 }}>Projected</div>
          <div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: proj.onPace ? "#10b981" : "#f59e0b", fontWeight: 600 }}>{fmtDollar(proj.comp, showComp)}</div>
          <div style={{ fontSize: 10, color: "var(--text-faint)" }}>{proj.wrvu.toFixed(0)} wRVUs</div>
          <div style={{ fontSize: 9, color: "var(--text-dim)" }}>{proj.sourceLabel}</div>
        </div>
      </div>
      <div style={{ marginTop: 10, padding: "6px 10px", borderRadius: 8, background: proj.onPace ? "rgba(16,185,129,0.08)" : "rgba(245,158,11,0.08)", display: "flex", flexWrap: "wrap", gap: 4, justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 11, color: proj.onPace ? "#10b981" : "#f59e0b", fontWeight: 600 }}>{(showComp ? (proj.onPace ? "+" : "") + proj.diff.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }) : "$\u2022\u2022\u2022\u2022\u2022") + " vs " + proj.goalName}</span>
        <span style={{ marginLeft: "auto", fontSize: 10, color: "var(--text-dim)" }}>{showComp ? "$" + settings.ratePerRVU + "/wRVU" : ""}</span>
      </div>
    </div>}

    <div style={S.card}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={S.cardLabel}>{isCurrent ? "Monthly wRVUs" : yearBounds.label + " Monthly wRVUs"}</div>{chartInst && <div style={{ display: "flex", gap: 8 }}>
      <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: "#a78bfa" }}><span style={{ display: "inline-block", width: 8, height: 8, borderRadius: 2, background: "#a78bfa" }}></span>Inst (Compare)</span>
      <span style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 9, color: "#0ea5e9" }}><span style={{ display: "inline-block", width: 8, height: 3, borderRadius: 1, background: "#0ea5e9" }}></span>Tracked</span>
    </div>}</div>
    <div style={{ display: "flex", alignItems: "flex-end", gap: 8, height: 110, marginTop: 12 }}>{months.map(function(m, i) {
      var instH = maxM > 0 ? (m.inst / maxM) * 80 : 0;
      var trackH = maxM > 0 ? (m.tracked / maxM) * 80 : 0;
      var isLast = i === months.length - 1 && isCurrent;
      return (<div key={i} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 3 }}>
        <span style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: chartInst && !m.hasRow ? "var(--global-10)" : "var(--text-secondary)", fontWeight: 500 }}>{(chartInst && m.hasRow) || m.primary > 0 ? m.primary.toFixed(0) : ""}</span>
        <div style={{ width: "100%", position: "relative" }}>
          {chartInst && m.hasRow && <div style={{ width: "100%", height: Math.max(instH > 0 ? instH : 0, instH > 0 ? 4 : 0), background: isLast ? "linear-gradient(to top, #8b5cf6, #a78bfa)" : "linear-gradient(to top, #334155, #475569)", borderRadius: 4, transition: "height 0.3s" }} />}
          {chartInst && m.hasRow && m.inst > 0 && m.tracked > 0 && <div style={{ position: "absolute", bottom: 0, left: "25%", width: "50%", height: Math.max(4, trackH), background: "#0ea5e9", borderRadius: 2, opacity: 0.8 }} />}
          {/* No Compare bar to sit on (no row, or a row of 0): the narrow
              Tracked bar sits in the flow, so the number stays above it. */}
          {chartInst && !(m.hasRow && m.inst > 0) && m.tracked > 0 && <div style={{ width: "50%", margin: "0 auto", height: Math.max(4, trackH), background: "#0ea5e9", borderRadius: 2, opacity: 0.8 }} />}
          {!chartInst && <div style={{ width: "100%", height: Math.max(4, trackH > 0 ? trackH : 0), background: isLast ? "linear-gradient(to top, #0ea5e9, #38bdf8)" : "linear-gradient(to top, #334155, #475569)", borderRadius: 4 }} />}
        </div>
        <span style={{ fontSize: 10, color: "var(--text-muted)" }}>{m.label}</span>
      </div>);
    })}</div></div>

    {entries.length > 0 && <div style={S.card}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={S.cardLabel}>Recent Procedures</div><button onClick={() => setView("history")} style={S.linkBtn}>View All </button></div><div style={{ marginTop: 8 }}>{entries.slice(-3).reverse().map((e, i) => (<div key={i} style={S.recentItem}><div><div style={S.recentCode}>{e.cptCode}{isNoCredit(e) && <span style={{ ...S.ncTag, marginLeft: 6 }}>no credit</span>}</div><div style={S.recentDesc}>{e.description}</div></div><div style={{ textAlign: "right" }}><div style={isNoCredit(e) ? { ...S.recentRVU, color: "var(--text-dim)" } : S.recentRVU}>{e.adjustedRVU.toFixed(2)}</div><div style={S.recentDate}>{fmtShort(e.date)}</div></div></div>))}</div></div>}

    {/* Onboarding card (no Compare data at all): tapping it opens Compare. */}
    {!hasInst && <div onClick={function() { setView("compare"); }} style={{ ...S.card, border: "1px solid rgba(139,92,246,0.2)", background: "rgba(139,92,246,0.03)", cursor: "pointer", minHeight: 44 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span style={{ fontSize: 18 }}>{"\u2194"}</span>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "#a78bfa" }}>Add Institution Data</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>Open Compare to add your institution's monthly RVU figures for a month-by-month comparison</div>
        </div>
        <span style={{ color: "#a78bfa", fontSize: 16, lineHeight: 1 }}>{"\u203a"}</span>
      </div>
    </div>}

    <div style={{ ...S.card, background: "var(--bg-inset)", border: "1px solid var(--border-subtle)", padding: "10px 16px" }}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><span style={{ fontSize: 11, color: "var(--text-faint)" }}>Data: Tracked{reconCount > 0 || chartInst ? " | Compare" : ""} | CMS {DATA_YEAR}</span><span style={{ fontSize: 10, color: "var(--text-faint)", fontFamily: "JetBrains Mono" }}>{DATA_VERSION}</span></div></div>
    <button onClick={() => setView("log")} style={S.fabBtn}>+ Log Procedure</button>
  </div>);
}

