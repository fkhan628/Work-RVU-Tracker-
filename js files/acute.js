// =======================================
// ACUTE CARE HISTORY (read-only)
// =======================================
// Full-history table of the monthly acute-care pool split. Pure presentation:
// every number comes from computeAcuteSplit + round2 (utils.js) - this file
// does no math of its own beyond summing the totals row. YTD share = sum of
// per-month ROUNDED shares (matches the group's paper table, not round-of-sum).
// Nav-less view: opened from the Dashboard acute line or Settings; onBack
// returns to whichever view opened it.
function AcuteHistory({ data, onBack }) {
  var acuteMonths = data.acuteMonths || {};
  var roster = data.acuteRoster || [];
  var me = data.acuteMe || "";
  var MN = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var DASH = "\u2014";

  // Years with at least one entered month, newest first.
  var years = useMemo(function() {
    var ySet = {};
    Object.keys(acuteMonths).forEach(function(mk) { ySet[mk.slice(0, 4)] = true; });
    return Object.keys(ySet).sort().reverse();
  }, [data.acuteMonths]);

  const [year, setYear] = useState(years.length ? years[0] : "");

  if (!years.length) return (
    <div style={S.page}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={onBack} style={S.backBtn}>Back</button>
        <h1 style={{ ...S.title, marginBottom: 0 }}>Acute Care History</h1>
      </div>
      <div style={{ ...S.card, textAlign: "center", padding: "32px 16px" }}>
        <div style={{ fontSize: 13, color: "var(--text-muted)" }}>No acute-care months entered yet.</div>
        <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>Enter pool + shifts in Settings under Monthly Acute Care.</div>
      </div>
    </div>
  );

  var yr = years.indexOf(year) !== -1 ? year : years[0];

  // Columns: roster order first, then any names that appear only in this
  // year's months (removed partners keep their history honest).
  var names = roster.slice();
  var mks = [];
  for (var mi = 1; mi <= 12; mi++) mks.push(yr + "-" + (mi < 10 ? "0" + mi : String(mi)));
  mks.forEach(function(mk) {
    var m = acuteMonths[mk];
    if (m && m.shifts) Object.keys(m.shifts).forEach(function(nm) { if (names.indexOf(nm) === -1) names.push(nm); });
  });

  // Precompute each entered month's split once; accumulate the totals row.
  var rows = mks.map(function(mk, i) {
    var m = acuteMonths[mk];
    return { mk: mk, label: MN[i], m: m, sp: m ? computeAcuteSplit(m) : null };
  });
  // A partner entered with 0 shifts (real case in the official table) shows
  // 0 / 0.00; a partner absent from the month entirely shows a dash.
  var inMonth = function(m, nm) { return !!(m && m.shifts && Object.prototype.hasOwnProperty.call(m.shifts, nm)); };
  var tot = { pool: 0, units: 0, shifts: {}, shares: {}, present: {}, count: 0 };
  names.forEach(function(nm) { tot.shifts[nm] = 0; tot.shares[nm] = 0; });
  rows.forEach(function(r) {
    if (!r.sp) return;
    tot.count++;
    tot.pool += r.sp.pool;
    tot.units += r.sp.units;
    names.forEach(function(nm) {
      if (!inMonth(r.m, nm)) return;
      tot.present[nm] = true;
      tot.shifts[nm] += r.m.shifts[nm] || 0;
      tot.shares[nm] += round2(r.sp.shares[nm] || 0);
    });
  });

  var fmtUnits = function(u) { return u % 1 === 0 ? String(u) : round2(u).toFixed(2); };
  var thBase = { padding: "7px 10px", fontSize: 10, color: "var(--text-dim)", textTransform: "uppercase", letterSpacing: 0.5, fontWeight: 700, whiteSpace: "nowrap", textAlign: "right", borderBottom: "1px solid var(--border-default)", background: "var(--bg-card)" };
  var tdBase = { padding: "7px 10px", fontSize: 12, fontFamily: "JetBrains Mono", color: "var(--text-primary)", whiteSpace: "nowrap", textAlign: "right", borderBottom: "1px solid var(--border-subtle)" };
  var stickyCol = { position: "sticky", left: 0, zIndex: 1, background: "var(--bg-card)", textAlign: "left", borderRight: "1px solid var(--border-default)" };

  return (
    <div style={S.page}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={onBack} style={S.backBtn}>Back</button>
        <h1 style={{ ...S.title, marginBottom: 0 }}>Acute Care History</h1>
      </div>
      <p style={{ ...S.subtitle, marginTop: -8 }}>Read-only. Enter months in Settings under Monthly Acute Care.</p>

      {years.length > 1 && <div style={S.catRow}>
        {years.map(function(y) { return (
          <button key={y} onClick={function() { setYear(y); }} style={y === yr ? S.catBtnActive : S.catBtn}>{y}</button>
        ); })}
      </div>}

      <div style={{ overflowX: "auto", WebkitOverflowScrolling: "touch", background: "var(--bg-card)", border: "1px solid var(--border-default)", borderRadius: 12 }}>
        <table style={{ borderCollapse: "separate", borderSpacing: 0, width: "100%" }}>
          <thead>
            <tr>
              <th rowSpan={2} style={{ ...thBase, ...stickyCol, zIndex: 2, verticalAlign: "bottom" }}>Month</th>
              <th rowSpan={2} style={{ ...thBase, verticalAlign: "bottom" }}>Pool</th>
              <th rowSpan={2} style={{ ...thBase, verticalAlign: "bottom" }}>Units</th>
              <th rowSpan={2} style={{ ...thBase, verticalAlign: "bottom" }}>Value/Unit</th>
              {names.map(function(nm) { return (
                <th key={nm} colSpan={2} style={{ ...thBase, textAlign: "center", color: nm === me ? "#34d399" : "var(--text-muted)", borderLeft: "1px solid var(--border-subtle)" }}>{nm}{nm === me ? " (me)" : ""}</th>
              ); })}
            </tr>
            <tr>
              {names.map(function(nm) { return (
                <React.Fragment key={nm}>
                  <th style={{ ...thBase, borderLeft: "1px solid var(--border-subtle)" }}>Shifts</th>
                  <th style={thBase}>Share</th>
                </React.Fragment>
              ); })}
            </tr>
          </thead>
          <tbody>
            {rows.map(function(r) {
              if (!r.sp) return (
                <tr key={r.mk}>
                  <td style={{ ...tdBase, ...stickyCol, color: "var(--text-faint)", fontFamily: "'DM Sans', sans-serif", fontSize: 11 }}>{r.label}</td>
                  <td colSpan={3 + names.length * 2} style={{ ...tdBase, color: "var(--text-faint)", textAlign: "left", paddingLeft: 14 }}>{DASH}</td>
                </tr>
              );
              return (
                <tr key={r.mk}>
                  <td style={{ ...tdBase, ...stickyCol, fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: "var(--text-muted)", fontWeight: 600 }}>{r.label}</td>
                  <td style={tdBase}>{round2(r.sp.pool).toFixed(2)}</td>
                  <td style={tdBase}>{fmtUnits(r.sp.units)}</td>
                  <td style={tdBase}>{r.sp.empty ? DASH : round2(r.sp.valuePerUnit).toFixed(2)}</td>
                  {names.map(function(nm) {
                    var here = inMonth(r.m, nm);
                    return (
                      <React.Fragment key={nm}>
                        <td style={{ ...tdBase, color: "var(--text-muted)", borderLeft: "1px solid var(--border-subtle)" }}>{here ? fmtUnits(r.m.shifts[nm] || 0) : DASH}</td>
                        <td style={{ ...tdBase, color: nm === me ? "#34d399" : "var(--text-primary)", fontWeight: nm === me ? 700 : 400 }}>{!here || r.sp.empty ? DASH : round2(r.sp.shares[nm] || 0).toFixed(2)}</td>
                      </React.Fragment>
                    );
                  })}
                </tr>
              );
            })}
            <tr>
              <td style={{ ...tdBase, ...stickyCol, fontFamily: "'DM Sans', sans-serif", fontSize: 11, color: "var(--text-bright)", fontWeight: 700, borderBottom: "none", borderTop: "1px solid var(--border-default)" }}>Total</td>
              <td style={{ ...tdBase, fontWeight: 700, color: "var(--text-bright)", borderBottom: "none", borderTop: "1px solid var(--border-default)" }}>{round2(tot.pool).toFixed(2)}</td>
              <td style={{ ...tdBase, fontWeight: 700, color: "var(--text-bright)", borderBottom: "none", borderTop: "1px solid var(--border-default)" }}>{fmtUnits(round2(tot.units))}</td>
              <td style={{ ...tdBase, color: "var(--text-faint)", borderBottom: "none", borderTop: "1px solid var(--border-default)" }}>{DASH}</td>
              {names.map(function(nm) { return (
                <React.Fragment key={nm}>
                  <td style={{ ...tdBase, fontWeight: 700, color: "var(--text-muted)", borderLeft: "1px solid var(--border-subtle)", borderBottom: "none", borderTop: "1px solid var(--border-default)" }}>{tot.present[nm] ? fmtUnits(round2(tot.shifts[nm])) : DASH}</td>
                  <td style={{ ...tdBase, fontWeight: 700, color: nm === me ? "#34d399" : "var(--text-bright)", borderBottom: "none", borderTop: "1px solid var(--border-default)" }}>{tot.present[nm] ? round2(tot.shares[nm]).toFixed(2) : DASH}</td>
                </React.Fragment>
              ); })}
            </tr>
          </tbody>
        </table>
      </div>
      <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 8, lineHeight: 1.5, padding: "0 4px" }}>{tot.count} month{tot.count === 1 ? "" : "s"} entered in {yr}. Year share = sum of monthly rounded shares (matches the paper table). Swipe sideways to see all partners.</div>
    </div>
  );
}
