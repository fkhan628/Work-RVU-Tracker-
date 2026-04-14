// =======================================
// COMPARE (Institution vs Measured)
// =======================================
function Compare({ data, upd, setView }) {
  var instData = data.institutionData || [];
  var entries = data.entries || [];
  var settings = data.settings || {};

  var [editMonth, setEditMonth] = useState("");
  var [editWork, setEditWork] = useState("");
  var [editSplit, setEditSplit] = useState("");
  var [editCases, setEditCases] = useState("");
  var [showAdd, setShowAdd] = useState(false);
  var [editIdx, setEditIdx] = useState(-1);
  var [viewYear, setViewYear] = useState("all");
  var [xlPreview, setXlPreview] = useState(null);
  var [xlError, setXlError] = useState("");
  var [xlSheet, setXlSheet] = useState(0);
  var [xlSheets, setXlSheets] = useState([]);
  var [xlRawWb, setXlRawWb] = useState(null);
  var xlRef = useRef(null);

  // Excel date serial to JS date
  var excelDateToYM = function(serial) {
    if (!serial) return null;
    // If it's already a date string like "2024-01"
    if (typeof serial === "string" && serial.match(/^\d{4}-\d{2}/)) return serial.slice(0, 7);
    // If it's a JS Date object from SheetJS
    if (serial instanceof Date) {
      var y = serial.getFullYear();
      var m = (serial.getMonth() + 1).toString().padStart(2, "0");
      if (y > 2000 && y < 2100) return y + "-" + m;
      return null;
    }
    // Excel serial number
    if (typeof serial === "number" && serial > 40000 && serial < 60000) {
      var d = new Date((serial - 25569) * 86400000);
      var y = d.getFullYear();
      var m = (d.getMonth() + 1).toString().padStart(2, "0");
      if (y > 2000 && y < 2100) return y + "-" + m;
    }
    return null;
  };

  var parseExcelSheet = function(wb, sheetIdx) {
    var sheetName = wb.SheetNames[sheetIdx];
    var ws = wb.Sheets[sheetName];
    if (!ws) return [];

    var raw = XLSX.utils.sheet_to_json(ws, { header: 1, defval: null, raw: true });

    // Strategy: find columns by scanning headers, then extract data rows
    var dateCol = -1, workCol = -1, splitCol = -1, casesCol = -1;

    // Scan first 5 rows for header patterns
    for (var r = 0; r < Math.min(raw.length, 5); r++) {
      var row = raw[r] || [];
      for (var c = 0; c < row.length; c++) {
        var val = String(row[c] || "").toLowerCase().trim();
        if (val.includes("work rvu") && !val.includes("split") && !val.includes("total") && !val.includes("predicted") && workCol === -1) workCol = c;
        if ((val.includes("split") || val.includes("call")) && splitCol === -1) splitCol = c;
        if ((val === "case totals" || val === "cases" || val === "case count") && casesCol === -1) casesCol = c;
      }
    }

    // Fallback: if we found Work RVU, assume Split is next col, cases is +2 or +3
    if (workCol >= 0 && splitCol === -1) splitCol = workCol + 1;

    // Extract data rows
    var results = [];
    raw.forEach(function(row) {
      if (!row || !row[0]) return;
      var ym = excelDateToYM(row[0]);
      if (!ym) return;

      var work = parseFloat(row[workCol >= 0 ? workCol : 1]) || 0;
      var split = parseFloat(row[splitCol >= 0 ? splitCol : 2]) || 0;
      var cases = 0;
      // Try to find cases column - scan for an integer in reasonable range
      if (casesCol >= 0) {
        cases = parseInt(row[casesCol]) || 0;
      } else {
        // Look for a small integer (1-100) in columns after split
        for (var ci = (splitCol >= 0 ? splitCol : 2) + 1; ci < Math.min((row.length || 0), 10); ci++) {
          var v = parseFloat(row[ci]);
          if (Number.isInteger(v) && v > 0 && v <= 200) { cases = v; break; }
        }
      }

      if (work > 0 || split > 0) {
        results.push({ month: ym, workRVU: work, splitRVU: split, cases: cases });
      }
    });

    return results;
  };

  var handleExcelUpload = function(file) {
    if (!file) return;
    setXlError("");
    setXlPreview(null);
    var reader = new FileReader();
    reader.onload = function(ev) {
      try {
        var ab = ev.target.result;
        var wb = XLSX.read(ab, { type: "array", cellDates: true });
        setXlRawWb(wb);
        setXlSheets(wb.SheetNames);
        // Auto-pick: prefer sheet with "work rvu" in name, then first sheet with data
        var bestSheet = 0;
        var bestScore = 0;
        wb.SheetNames.forEach(function(name, idx) {
          var n = name.toLowerCase();
          var score = 0;
          if (n.includes("work") && n.includes("rvu")) score = 10;
          else if (n.includes("rvu") && n.includes("recon")) score = 8;
          else if (n.includes("calculated") && n.includes("rvu")) score = 7;
          else if (n === "work rvu" || n === "rvu data") score = 9;
          else if (n.includes("rvu") && !n.includes("partner") && !n.includes("salary")) score = 5;
          if (score > bestScore) { bestScore = score; bestSheet = idx; }
        });
        // If no good match by name, try each sheet and pick first with parseable data
        if (bestScore === 0) {
          for (var si = 0; si < wb.SheetNames.length; si++) {
            var testParsed = parseExcelSheet(wb, si);
            if (testParsed.length > 0) { bestSheet = si; break; }
          }
        }
        setXlSheet(bestSheet);
        var parsed = parseExcelSheet(wb, bestSheet);
        if (parsed.length === 0) {
          setXlError("No monthly RVU data found in '" + wb.SheetNames[bestSheet] + "'. Try a different sheet.");
        } else {
          setXlPreview(parsed);
        }
      } catch (e) {
        setXlError("Could not read Excel file: " + e.message);
      }
    };
    reader.readAsArrayBuffer(file);
  };

  var switchXlSheet = function(idx) {
    setXlSheet(idx);
    if (xlRawWb) {
      var parsed = parseExcelSheet(xlRawWb, idx);
      if (parsed.length === 0) {
        setXlError("No monthly RVU data found in '" + xlRawWb.SheetNames[idx] + "'. Try a different sheet.");
        setXlPreview(null);
      } else {
        setXlError("");
        setXlPreview(parsed);
      }
    }
  };

  var importXlData = function(mode) {
    if (!xlPreview || xlPreview.length === 0) return;
    upd(function(prev) {
      var arr = mode === "replace" ? [] : (prev.institutionData || []).slice();
      xlPreview.forEach(function(entry) {
        var existIdx = arr.findIndex(function(d) { return d.month === entry.month; });
        if (existIdx >= 0) {
          arr[existIdx] = entry;
        } else {
          arr.push(entry);
        }
      });
      return { ...prev, institutionData: arr };
    });
    var total = xlPreview.reduce(function(s, e) { return s + e.workRVU + e.splitRVU; }, 0);
    setXlPreview(null);
    setXlRawWb(null);
    setXlSheets([]);
    setXlError("Imported " + xlPreview.length + " months (" + total.toFixed(0) + " total wRVUs)");
    setTimeout(function() { setXlError(""); }, 4000);
  };

  // Get measured RVUs per month from user entries
  var measuredByMonth = useMemo(function() {
    var m = {};
    entries.forEach(function(e) {
      var key = e.date.slice(0, 7); // YYYY-MM
      if (!m[key]) m[key] = { rvu: 0, cases: 0 };
      m[key].rvu += e.adjustedRVU;
      m[key].cases += 1;
    });
    return m;
  }, [entries]);

  // All unique years in institution data
  var years = useMemo(function() {
    var ySet = {};
    instData.forEach(function(d) { ySet[d.month.slice(0, 4)] = true; });
    return Object.keys(ySet).sort().reverse();
  }, [instData]);

  // Filtered and sorted institution data
  var displayData = useMemo(function() {
    var sorted = instData.slice().sort(function(a, b) { return a.month.localeCompare(b.month); });
    if (viewYear !== "all") {
      sorted = sorted.filter(function(d) { return d.month.startsWith(viewYear); });
    }
    return sorted;
  }, [instData, viewYear]);

  // Totals
  var totals = useMemo(function() {
    var instWork = 0, instSplit = 0, instTotal = 0, instCases = 0, measRVU = 0, measCases = 0;
    displayData.forEach(function(d) {
      instWork += d.workRVU || 0;
      instSplit += d.splitRVU || 0;
      instTotal += (d.workRVU || 0) + (d.splitRVU || 0);
      instCases += d.cases || 0;
      var mKey = d.month;
      var m = measuredByMonth[mKey];
      if (m) { measRVU += m.rvu; measCases += m.cases; }
    });
    return { instWork: instWork, instSplit: instSplit, instTotal: instTotal, instCases: instCases, measRVU: measRVU, measCases: measCases };
  }, [displayData, measuredByMonth]);

  var diff = totals.measRVU - totals.instTotal;
  var diffPct = totals.instTotal > 0 ? ((diff / totals.instTotal) * 100) : 0;

  var saveMonth = function() {
    if (!editMonth) return;
    var entry = {
      month: editMonth,
      workRVU: parseFloat(editWork) || 0,
      splitRVU: parseFloat(editSplit) || 0,
      cases: parseInt(editCases) || 0
    };
    upd(function(prev) {
      var arr = (prev.institutionData || []).slice();
      if (editIdx >= 0) {
        arr[editIdx] = entry;
      } else {
        // Check for existing month
        var existIdx = arr.findIndex(function(d) { return d.month === editMonth; });
        if (existIdx >= 0) {
          arr[existIdx] = entry;
        } else {
          arr.push(entry);
        }
      }
      return { ...prev, institutionData: arr };
    });
    resetForm();
  };

  var deleteMonth = function(idx) {
    if (!confirm("Delete this month's institution data?")) return;
    upd(function(prev) {
      var arr = (prev.institutionData || []).slice();
      arr.splice(idx, 1);
      return { ...prev, institutionData: arr };
    });
  };

  var startEdit = function(idx) {
    var d = instData[idx];
    if (!d) return;
    setEditMonth(d.month);
    setEditWork(String(d.workRVU || 0));
    setEditSplit(String(d.splitRVU || 0));
    setEditCases(String(d.cases || 0));
    setEditIdx(idx);
    setShowAdd(true);
  };

  var resetForm = function() {
    setEditMonth("");
    setEditWork("");
    setEditSplit("");
    setEditCases("");
    setEditIdx(-1);
    setShowAdd(false);
  };

  // Line chart data
  var chartData = useMemo(function() {
    var mx = 0;
    var points = displayData.map(function(d, i) {
      var instT = (d.workRVU || 0) + (d.splitRVU || 0);
      var mKey = d.month;
      var measT = measuredByMonth[mKey] ? measuredByMonth[mKey].rvu : 0;
      mx = Math.max(mx, instT, measT);
      return { month: d.month, inst: instT, meas: measT, work: d.workRVU || 0, split: d.splitRVU || 0 };
    });
    // Round max up to nice number
    var ceil = mx > 0 ? Math.ceil(mx / 100) * 100 : 800;
    return { points: points, max: ceil };
  }, [displayData, measuredByMonth]);

  var monthLabel = function(m) {
    var parts = m.split("-");
    var months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    return months[parseInt(parts[1]) - 1] + " '" + parts[0].slice(2);
  };

  var monthLabelShort = function(m) {
    var parts = m.split("-");
    var months = ["J","F","M","A","M","J","J","A","S","O","N","D"];
    return months[parseInt(parts[1]) - 1];
  };

  var [hoverIdx, setHoverIdx] = useState(-1);

  return (<div style={S.page}>
    <div style={S.header}><h1 style={S.title}>Compare</h1><p style={S.subtitle}>Institution vs. Your Tracked RVUs</p></div>

    {/* Summary cards */}
    {instData.length > 0 && <>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 12 }}>
        <div style={{ ...S.card, border: "1px solid rgba(139,92,246,0.3)" }}>
          <div style={{ fontSize: 10, color: "#a78bfa", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>Institution Total</div>
          <div style={{ fontSize: 24, fontFamily: "JetBrains Mono", color: "#a78bfa", fontWeight: 700, marginTop: 4 }}>{totals.instTotal.toFixed(1)}</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>Work: {totals.instWork.toFixed(1)} | Call: {totals.instSplit.toFixed(1)}</div>
        </div>
        <div style={{ ...S.card, border: "1px solid rgba(14,165,233,0.3)" }}>
          <div style={{ fontSize: 10, color: "#0ea5e9", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>Your Tracked</div>
          <div style={{ fontSize: 24, fontFamily: "JetBrains Mono", color: "#0ea5e9", fontWeight: 700, marginTop: 4 }}>{totals.measRVU.toFixed(1)}</div>
          <div style={{ fontSize: 10, color: "var(--text-dim)", marginTop: 2 }}>{totals.measCases} cases logged</div>
        </div>
      </div>
      <div style={{ ...S.card, border: diff >= 0 ? "1px solid rgba(16,185,129,0.3)" : "1px solid rgba(245,158,11,0.3)", marginBottom: 12 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 10, color: diff >= 0 ? "#10b981" : "#f59e0b", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 600 }}>Difference</div>
            <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2 }}>{diff >= 0 ? "You tracked more than institution reported" : "Institution reported more than you tracked"}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 22, fontFamily: "JetBrains Mono", color: diff >= 0 ? "#10b981" : "#f59e0b", fontWeight: 700 }}>{diff >= 0 ? "+" : ""}{diff.toFixed(1)}</div>
            <div style={{ fontSize: 11, fontFamily: "JetBrains Mono", color: "var(--text-dim)" }}>{diff >= 0 ? "+" : ""}{diffPct.toFixed(1)}%</div>
          </div>
        </div>
      </div>
    </>}

    {/* Year filter */}
    {years.length > 0 && <div style={S.catRow}>
      <button onClick={function() { setViewYear("all"); }} style={viewYear === "all" ? S.catBtnActive : S.catBtn}>All</button>
      {years.map(function(y) { return <button key={y} onClick={function() { setViewYear(y); }} style={viewYear === y ? S.catBtnActive : S.catBtn}>{y}</button>; })}
    </div>}

    {/* Line chart */}
    {displayData.length > 1 && (function() {
      var pts = chartData.points;
      var maxV = chartData.max;
      var W = 440, H = 200, padL = 40, padR = 10, padT = 15, padB = 30;
      var cW = W - padL - padR;
      var cH = H - padT - padB;
      var n = pts.length;
      if (n < 2) return null;

      var xOf = function(i) { return padL + (i / (n - 1)) * cW; };
      var yOf = function(v) { return padT + cH - (v / maxV) * cH; };

      // Grid lines
      var gridLines = [];
      var gridCount = 4;
      for (var gi = 0; gi <= gridCount; gi++) {
        var gVal = (maxV / gridCount) * gi;
        var gy = yOf(gVal);
        gridLines.push({ y: gy, label: gVal.toFixed(0) });
      }

      // Build path strings
      var instPath = pts.map(function(p, i) { return (i === 0 ? "M" : "L") + xOf(i).toFixed(1) + "," + yOf(p.inst).toFixed(1); }).join(" ");
      var measPath = pts.map(function(p, i) { return (i === 0 ? "M" : "L") + xOf(i).toFixed(1) + "," + yOf(p.meas).toFixed(1); }).join(" ");

      // Area fill under institution line
      var instArea = instPath + " L" + xOf(n-1).toFixed(1) + "," + (padT + cH) + " L" + xOf(0).toFixed(1) + "," + (padT + cH) + " Z";

      return (<div style={{ ...S.card, marginBottom: 12, overflow: "hidden" }}>
        <div style={S.cardLabel}>Monthly Comparison</div>
        <div style={{ overflowX: "auto", marginTop: 8 }}>
          <svg viewBox={"0 0 " + W + " " + H} style={{ width: "100%", maxWidth: W, height: "auto", display: "block" }}>
            {/* Grid lines */}
            {gridLines.map(function(g, i) {
              return (<g key={i}>
                <line x1={padL} y1={g.y} x2={W - padR} y2={g.y} stroke="var(--border-subtle)" strokeWidth="1" />
                <text x={padL - 4} y={g.y + 3} textAnchor="end" fill="var(--text-faint)" fontSize="9" fontFamily="JetBrains Mono">{g.label}</text>
              </g>);
            })}

            {/* Area fill */}
            <path d={instArea} fill="rgba(139,92,246,0.08)" />

            {/* Institution line */}
            <path d={instPath} fill="none" stroke="#a78bfa" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />

            {/* Tracked line */}
            <path d={measPath} fill="none" stroke="#0ea5e9" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" strokeDasharray={pts.some(function(p) { return p.meas > 0; }) ? "none" : "4,4"} />

            {/* Data points - Institution */}
            {pts.map(function(p, i) {
              return <circle key={"i" + i} cx={xOf(i)} cy={yOf(p.inst)} r={hoverIdx === i ? 5 : 3} fill="#a78bfa" stroke="var(--bg-base)" strokeWidth="1.5" />;
            })}

            {/* Data points - Tracked */}
            {pts.map(function(p, i) {
              if (p.meas === 0) return null;
              return <circle key={"m" + i} cx={xOf(i)} cy={yOf(p.meas)} r={hoverIdx === i ? 5 : 3} fill="#0ea5e9" stroke="var(--bg-base)" strokeWidth="1.5" />;
            })}

            {/* Hover targets (invisible wider hit areas) */}
            {pts.map(function(p, i) {
              return <rect key={"h" + i} x={xOf(i) - (cW / n / 2)} y={padT} width={cW / n} height={cH} fill="transparent"
                onMouseEnter={function() { setHoverIdx(i); }} onMouseLeave={function() { setHoverIdx(-1); }}
                onTouchStart={function() { setHoverIdx(i); }} onTouchEnd={function() { setTimeout(function() { setHoverIdx(-1); }, 2000); }}
              />;
            })}

            {/* Hover tooltip */}
            {hoverIdx >= 0 && hoverIdx < pts.length && (function() {
              var hp = pts[hoverIdx];
              var tx = xOf(hoverIdx);
              var flipLeft = tx > W - 100;
              return (<g>
                <line x1={tx} y1={padT} x2={tx} y2={padT + cH} stroke="var(--border-default)" strokeWidth="1" strokeDasharray="3,3" />
                <rect x={flipLeft ? tx - 108 : tx + 8} y={padT} width={100} height={52} rx="4" fill="var(--bg-inset)" stroke="var(--border-default)" strokeWidth="1" opacity="0.95" />
                <text x={flipLeft ? tx - 103 : tx + 13} y={padT + 12} fill="var(--text-muted)" fontSize="9" fontFamily="DM Sans">{monthLabel(hp.month)}</text>
                <text x={flipLeft ? tx - 103 : tx + 13} y={padT + 25} fill="#a78bfa" fontSize="10" fontFamily="JetBrains Mono" fontWeight="600">{"Inst: " + hp.inst.toFixed(0)}</text>
                <text x={flipLeft ? tx - 103 : tx + 13} y={padT + 37} fill="#0ea5e9" fontSize="10" fontFamily="JetBrains Mono" fontWeight="600">{"Trk: " + hp.meas.toFixed(0)}</text>
                <text x={flipLeft ? tx - 103 : tx + 13} y={padT + 49} fill={hp.meas - hp.inst >= 0 ? "#10b981" : "#f59e0b"} fontSize="9" fontFamily="JetBrains Mono">{(hp.meas - hp.inst >= 0 ? "+" : "") + (hp.meas - hp.inst).toFixed(0) + " diff"}</text>
              </g>);
            })()}

            {/* X-axis labels */}
            {pts.map(function(p, i) {
              var showLabel = n <= 12 || i % Math.ceil(n / 12) === 0 || i === n - 1;
              if (!showLabel) return null;
              return <text key={"xl" + i} x={xOf(i)} y={H - 5} textAnchor="middle" fill="var(--text-faint)" fontSize={n > 18 ? "7" : "8"} fontFamily="JetBrains Mono">{n > 18 ? monthLabelShort(p.month) : monthLabel(p.month)}</text>;
            })}
          </svg>
        </div>
        <div style={{ display: "flex", gap: 16, justifyContent: "center", marginTop: 6 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{ width: 16, height: 3, borderRadius: 2, background: "#a78bfa" }}></div><span style={{ fontSize: 10, color: "var(--text-muted)" }}>Institution</span></div>
          <div style={{ display: "flex", alignItems: "center", gap: 4 }}><div style={{ width: 16, height: 3, borderRadius: 2, background: "#0ea5e9" }}></div><span style={{ fontSize: 10, color: "var(--text-muted)" }}>Tracked</span></div>
        </div>
      </div>);
    })()}

    {/* Add/Edit form */}
    {/* Action buttons */}
    <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
      <input ref={xlRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: "none" }} onChange={function(e) { if (e.target.files && e.target.files[0]) handleExcelUpload(e.target.files[0]); e.target.value = ""; }} />
      <button onClick={function() { if (showAdd) { resetForm(); } else { setShowAdd(true); setEditMonth(new Date().toISOString().slice(0, 7)); } }} style={{ ...S.secondaryBtn, flex: 1, color: "#a78bfa", borderColor: "rgba(139,92,246,0.3)" }}>{showAdd ? "Cancel" : "+ Add Month"}</button>
      <button onClick={function() { xlRef.current && xlRef.current.click(); }} style={{ ...S.secondaryBtn, flex: 1, color: "#10b981", borderColor: "rgba(16,185,129,0.3)" }}>{"\u2191"} Upload Excel</button>
    </div>

    {xlError && <div style={{ marginBottom: 10, padding: "8px 12px", borderRadius: 8, background: xlError.startsWith("Imported") ? "rgba(16,185,129,0.1)" : "rgba(239,68,68,0.1)", color: xlError.startsWith("Imported") ? "#10b981" : "#ef4444", fontSize: 13, textAlign: "center" }}>{xlError}</div>}

    {/* Excel preview panel */}
    {xlPreview && <div style={{ ...S.card, border: "1px solid rgba(16,185,129,0.3)", marginBottom: 12 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: "#10b981" }}>Excel Import Preview</div>
          <div style={{ fontSize: 11, color: "var(--text-dim)" }}>{xlPreview.length} months found</div>
        </div>
        <button onClick={function() { setXlPreview(null); setXlRawWb(null); setXlSheets([]); setXlError(""); }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>Cancel</button>
      </div>

      {/* Sheet selector */}
      {xlSheets.length > 1 && <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 10, color: "var(--text-dim)", marginBottom: 4 }}>Sheet:</div>
        <div style={{ display: "flex", gap: 4, flexWrap: "wrap" }}>
          {xlSheets.map(function(name, idx) {
            return <button key={idx} onClick={function() { switchXlSheet(idx); }} style={{ padding: "4px 10px", borderRadius: 6, border: idx === xlSheet ? "1px solid #10b981" : "1px solid var(--border-default)", background: idx === xlSheet ? "rgba(16,185,129,0.1)" : "transparent", color: idx === xlSheet ? "#10b981" : "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>{name}</button>;
          })}
        </div>
      </div>}

      {/* Preview table */}
      <div style={{ maxHeight: 280, overflowY: "auto", marginTop: 10, scrollbarWidth: "thin" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 0, fontSize: 10, color: "var(--text-dim)", padding: "4px 0", borderBottom: "1px solid var(--border-default)", fontWeight: 600 }}>
          <span>Month</span><span style={{ textAlign: "right" }}>Work</span><span style={{ textAlign: "right" }}>Call</span><span style={{ textAlign: "right" }}>Total</span><span style={{ textAlign: "right" }}>Cases</span>
        </div>
        {xlPreview.map(function(d) {
          var total = d.workRVU + d.splitRVU;
          var existing = instData.find(function(x) { return x.month === d.month; });
          return (<div key={d.month} style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 0, fontSize: 12, padding: "6px 0", borderBottom: "1px solid rgba(51,65,85,0.3)", alignItems: "center" }}>
            <span style={{ color: "var(--text-bright)", fontFamily: "JetBrains Mono", fontSize: 11 }}>{d.month}{existing && <span style={{ fontSize: 8, color: "#f59e0b", marginLeft: 3 }} title="Will update existing">{"\u25CF"}</span>}</span>
            <span style={{ textAlign: "right", color: "#a78bfa", fontFamily: "JetBrains Mono" }}>{d.workRVU.toFixed(1)}</span>
            <span style={{ textAlign: "right", color: "var(--text-muted)", fontFamily: "JetBrains Mono" }}>{d.splitRVU.toFixed(1)}</span>
            <span style={{ textAlign: "right", color: "var(--text-primary)", fontFamily: "JetBrains Mono", fontWeight: 600 }}>{total.toFixed(1)}</span>
            <span style={{ textAlign: "right", color: "var(--text-dim)", fontFamily: "JetBrains Mono" }}>{d.cases || "-"}</span>
          </div>);
        })}
      </div>

      {/* Import totals and buttons */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr 1fr 1fr", gap: 0, fontSize: 11, padding: "8px 0 4px", borderTop: "1px solid var(--border-default)", marginTop: 4, fontWeight: 600 }}>
        <span style={{ color: "var(--text-muted)" }}>Total</span>
        <span style={{ textAlign: "right", color: "#a78bfa", fontFamily: "JetBrains Mono" }}>{xlPreview.reduce(function(s, d) { return s + d.workRVU; }, 0).toFixed(0)}</span>
        <span style={{ textAlign: "right", color: "var(--text-muted)", fontFamily: "JetBrains Mono" }}>{xlPreview.reduce(function(s, d) { return s + d.splitRVU; }, 0).toFixed(0)}</span>
        <span style={{ textAlign: "right", color: "var(--text-primary)", fontFamily: "JetBrains Mono" }}>{xlPreview.reduce(function(s, d) { return s + d.workRVU + d.splitRVU; }, 0).toFixed(0)}</span>
        <span style={{ textAlign: "right", color: "var(--text-dim)", fontFamily: "JetBrains Mono" }}>{xlPreview.reduce(function(s, d) { return s + (d.cases || 0); }, 0)}</span>
      </div>

      {instData.length > 0 && <div style={{ fontSize: 10, color: "#f59e0b", marginTop: 6 }}>{"\u25CF"} Orange dot = month already exists and will be updated</div>}

      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        {instData.length > 0 && <button onClick={function() { importXlData("merge"); }} style={{ ...S.saveBtn, flex: 1, fontSize: 13, background: "linear-gradient(135deg, #10b981, #059669)" }}>Merge ({xlPreview.length} months)</button>}
        <button onClick={function() { importXlData("replace"); }} style={{ ...S.saveBtn, flex: 1, fontSize: 13, background: instData.length > 0 ? "linear-gradient(135deg, #8b5cf6, #7c3aed)" : "linear-gradient(135deg, #10b981, #059669)" }}>{instData.length > 0 ? "Replace All" : "Import " + xlPreview.length + " months"}</button>
      </div>
    </div>}

    {showAdd && <div style={{ ...S.card, border: "1px solid rgba(139,92,246,0.3)", marginBottom: 12 }}>
      <div style={S.cardLabel}>{editIdx >= 0 ? "Edit Month" : "Add Month"}</div>
      <div style={S.fieldGroup}>
        <label style={S.fieldLabel}>Month</label>
        <input type="month" value={editMonth} onChange={function(e) { setEditMonth(e.target.value); }} style={{ ...S.dateInput, width: "100%" }} />
      </div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
        <div style={S.fieldGroup}>
          <label style={S.fieldLabel}>Work RVUs (Private)</label>
          <input type="text" inputMode="decimal" value={editWork} onChange={function(e) { setEditWork(e.target.value.replace(/[^0-9.]/g, "")); }} placeholder="0" style={{ ...S.numberInput, width: "100%" }} />
        </div>
        <div style={S.fieldGroup}>
          <label style={S.fieldLabel}>Split RVUs (Call)</label>
          <input type="text" inputMode="decimal" value={editSplit} onChange={function(e) { setEditSplit(e.target.value.replace(/[^0-9.]/g, "")); }} placeholder="0" style={{ ...S.numberInput, width: "100%" }} />
        </div>
      </div>
      <div style={S.fieldGroup}>
        <label style={S.fieldLabel}>Case Count (optional)</label>
        <input type="text" inputMode="numeric" value={editCases} onChange={function(e) { setEditCases(e.target.value.replace(/[^0-9]/g, "")); }} placeholder="0" style={{ ...S.numberInput, width: "100%" }} />
      </div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", marginBottom: 8 }}>Total: <span style={{ fontFamily: "JetBrains Mono", color: "#a78bfa", fontWeight: 600 }}>{((parseFloat(editWork) || 0) + (parseFloat(editSplit) || 0)).toFixed(1)} wRVUs</span></div>
      <button onClick={saveMonth} disabled={!editMonth} style={{ ...S.saveBtn, opacity: editMonth ? 1 : 0.4, background: "linear-gradient(135deg, #8b5cf6, #7c3aed)" }}>{editIdx >= 0 ? "Update Month" : "Save Month"}</button>
    </div>}

    {/* Monthly detail list */}
    {displayData.length > 0 && <div style={S.card}>
      <div style={S.cardLabel}>Monthly Detail</div>
      <div style={{ marginTop: 8 }}>
        {displayData.map(function(d, dispIdx) {
          var realIdx = instData.indexOf(d);
          var instT = (d.workRVU || 0) + (d.splitRVU || 0);
          var mKey = d.month;
          var m = measuredByMonth[mKey];
          var measT = m ? m.rvu : 0;
          var mDiff = measT - instT;
          return (<div key={d.month} style={{ padding: "10px 0", borderBottom: dispIdx < displayData.length - 1 ? "1px solid rgba(51,65,85,0.5)" : "none" }}>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-bright)" }}>{monthLabel(d.month)}</div>
                <div style={{ display: "flex", gap: 12, marginTop: 4 }}>
                  <div>
                    <div style={{ fontSize: 9, color: "#a78bfa", textTransform: "uppercase", letterSpacing: 0.5 }}>Institution</div>
                    <div style={{ fontSize: 15, fontFamily: "JetBrains Mono", color: "#a78bfa", fontWeight: 600 }}>{instT.toFixed(1)}</div>
                    <div style={{ fontSize: 9, color: "var(--text-dim)" }}>W:{(d.workRVU || 0).toFixed(0)} C:{(d.splitRVU || 0).toFixed(0)}{d.cases ? " | " + d.cases + " cases" : ""}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: "#0ea5e9", textTransform: "uppercase", letterSpacing: 0.5 }}>Tracked</div>
                    <div style={{ fontSize: 15, fontFamily: "JetBrains Mono", color: "#0ea5e9", fontWeight: 600 }}>{measT.toFixed(1)}</div>
                    <div style={{ fontSize: 9, color: "var(--text-dim)" }}>{m ? m.cases + " cases" : "No data"}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: 9, color: mDiff >= 0 ? "#10b981" : "#f59e0b", textTransform: "uppercase", letterSpacing: 0.5 }}>Diff</div>
                    <div style={{ fontSize: 15, fontFamily: "JetBrains Mono", color: mDiff >= 0 ? "#10b981" : "#f59e0b", fontWeight: 600 }}>{mDiff >= 0 ? "+" : ""}{mDiff.toFixed(1)}</div>
                  </div>
                </div>
              </div>
              <div style={{ display: "flex", gap: 4, flexShrink: 0 }}>
                <button onClick={function() { startEdit(realIdx); }} style={{ ...S.deleteBtn, color: "var(--text-muted)" }}>{"\u270E"}</button>
                <button onClick={function() { deleteMonth(realIdx); }} style={S.deleteBtn}>{"\u2715"}</button>
              </div>
            </div>
          </div>);
        })}
      </div>
    </div>}

    {/* Compensation estimate */}
    {instData.length > 0 && settings.ratePerRVU > 0 && <div style={{ ...S.card, border: "1px solid rgba(16,185,129,0.3)" }}>
      <div style={S.cardLabel}>Compensation Estimate</div>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>
        <div>
          <div style={{ fontSize: 10, color: "var(--text-dim)" }}>Institution Based</div>
          <div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "#a78bfa", fontWeight: 600 }}>{"$"}{(totals.instTotal * settings.ratePerRVU).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
        <div>
          <div style={{ fontSize: 10, color: "var(--text-dim)" }}>Your Tracked</div>
          <div style={{ fontSize: 18, fontFamily: "JetBrains Mono", color: "#0ea5e9", fontWeight: 600 }}>{"$"}{(totals.measRVU * settings.ratePerRVU).toLocaleString(undefined, { maximumFractionDigits: 0 })}</div>
        </div>
      </div>
      <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 6 }}>Based on {"$"}{settings.ratePerRVU}/wRVU rate</div>
    </div>}

    {instData.length === 0 && !showAdd && !xlPreview && <div style={{ ...S.card, textAlign: "center", padding: 30 }}>
      <div style={{ fontSize: 28, marginBottom: 8 }}>{"\u2194"}</div>
      <div style={{ fontSize: 14, fontWeight: 600, color: "var(--text-muted)", marginBottom: 4 }}>No Institution Data Yet</div>
      <div style={{ fontSize: 12, color: "var(--text-dim)", lineHeight: 1.5 }}>Upload your Excel spreadsheet or add months manually to compare institution RVUs against what you're tracking.</div>
    </div>}
  </div>);
}

