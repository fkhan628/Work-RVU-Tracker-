// =======================================
// CALL PAY (sites + dated rate versions)
// =======================================
// Dollar-only call-shift pay, fully separate from entries, wRVU totals and
// Comp. All pay math and validity rules live in utils.js (cleanPayRate,
// payNum, rateInForce, computeShiftPay) - this file only edits paySites and
// renders. Site names and rates are USER-ENTERED data only: never hardcode
// either anywhere in source (public repo). Recorded shifts keep their own
// rate copy, so editing or deleting a rate version here never changes pay
// already recorded. Nav-less view opened from Settings; onBack returns there.
function CallPay({ data, upd, onBack }) {
  var sites = data.paySites || [];
  var shifts = data.payShifts || [];
  var today = todayLocal();
  var DAYS = ["Su", "M", "Tu", "W", "Th", "F", "Sa"];
  var DOT = " \u00B7 ";
  var RATE_FIELDS = [
    ["stipend", "Stipend ($ per shift)"],
    ["stipendHours", "Shift length (hours)"],
    ["callInWeekday", "Call-in fee, weekday ($)"],
    ["callInWeekendHoliday", "Call-in fee, weekend/holiday ($)"],
    ["hourly", "Hourly rate ($/hr)"],
    ["hourlyMinHours", "Minimum hours per trip (0 = none)"]
  ];

  const [newSite, setNewSite] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [rateForm, setRateForm] = useState(null); // { siteId, rateId, editing, f: text fields }
  const [showAll, setShowAll] = useState({});

  var money = function(v) { return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var btn = function(extra) { return { minHeight: 44, padding: "0 14px", borderRadius: 8, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer", ...extra }; };
  var nameTaken = function(n, exceptId) { var k = n.trim().toLowerCase(); return sites.some(function(s) { return s.id !== exceptId && s.name.trim().toLowerCase() === k; }); };
  var updSites = function(fn) { upd(function(prev) { return { ...prev, paySites: fn(prev.paySites || []) }; }); };

  var addSite = function() {
    var n = newSite.trim();
    if (!n || nameTaken(n, null)) return;
    updSites(function(l) { return l.concat([{ id: "site-" + Date.now().toString(36), name: n, weekendDays: [0, 6], casesEarnRVU: true, rates: [] }]); });
    setNewSite("");
  };
  var saveRename = function(id) {
    var n = renameDraft.trim();
    if (!n || nameTaken(n, id)) return;
    updSites(function(l) { return l.map(function(s) { return s.id === id ? { ...s, name: n } : s; }); });
    setRenaming(null);
    setRenameDraft("");
  };
  var deleteSite = function(s) {
    var used = shifts.filter(function(p) { return p.siteId === s.id; }).length;
    var msg = "Delete " + s.name + " and its " + s.rates.length + " rate version" + (s.rates.length === 1 ? "" : "s") + "?" +
      (used ? " Its " + used + " recorded shift" + (used === 1 ? "" : "s") + " keep their own pay and rates." : "");
    if (!confirm(msg)) return;
    updSites(function(l) { return l.filter(function(x) { return x.id !== s.id; }); });
    if (rateForm && rateForm.siteId === s.id) setRateForm(null);
  };
  var toggleWeekend = function(siteId, d) {
    updSites(function(l) { return l.map(function(x) {
      if (x.id !== siteId) return x;
      var wd = (x.weekendDays || []).slice();
      var i = wd.indexOf(d);
      if (i === -1) wd.push(d); else wd.splice(i, 1);
      return { ...x, weekendDays: wd.sort() };
    }); });
  };

  // Rate form: numbers stay as typed text and are stored only when the whole
  // version passes cleanPayRate (the same rule repairData enforces). A new
  // version pre-fills from the site's latest one so a rate change is an edit
  // of the numbers that changed.
  var numText = function(v) { return typeof v === "number" ? String(v) : ""; };
  var openRateForm = function(s, r) {
    var latest = s.rates.slice().sort(function(a, b) { return a.effective < b.effective ? 1 : a.effective > b.effective ? -1 : 0; })[0];
    var src = r || latest || null;
    var f = { effective: r ? r.effective : today, label: r && r.label ? r.label : "", hourlyWeekdayDay: src ? src.hourlyWeekdayDay === true : true };
    RATE_FIELDS.forEach(function(rf) { f[rf[0]] = src ? numText(src[rf[0]]) : ""; });
    setRateForm({ siteId: s.id, rateId: r ? r.id : "rate-" + Date.now().toString(36), editing: !!r, f: f });
  };
  var setField = function(k, v) { setRateForm(function(rf) { return rf ? { ...rf, f: { ...rf.f, [k]: v } } : rf; }); };
  var fieldBad = function(k) { var n = payNum(rateForm.f[k]); return n === null || (k === "stipendHours" && !(n > 0)); };

  var formSite = rateForm ? sites.filter(function(s) { return s.id === rateForm.siteId; })[0] : null;
  var formRate = null, formErr = "";
  if (rateForm && formSite) {
    var old = rateForm.editing ? formSite.rates.filter(function(r) { return r.id === rateForm.rateId; })[0] : null;
    var cand = { ...(old || {}), id: rateForm.rateId, effective: rateForm.f.effective, hourlyWeekdayDay: rateForm.f.hourlyWeekdayDay };
    RATE_FIELDS.forEach(function(rf) { cand[rf[0]] = rateForm.f[rf[0]]; });
    var lbl = rateForm.f.label.trim();
    if (lbl) cand.label = lbl; else delete cand.label;
    formRate = cleanPayRate(cand, rateForm.rateId);
    if (!isYMD(rateForm.f.effective)) formErr = "Pick an effective date.";
    else if (RATE_FIELDS.some(function(rf) { return fieldBad(rf[0]); })) formErr = "Fill every amount with a number (0 is allowed; shift length must be more than 0).";
    else if (formSite.rates.some(function(r) { return r.id !== rateForm.rateId && r.effective === rateForm.f.effective; })) formErr = "Another version already starts on " + rateForm.f.effective + " - edit that one instead.";
    else if (!formRate) formErr = "Check the values.";
    if (formErr) formRate = null;
  }
  var saveRate = function() {
    if (!formRate || !rateForm) return;
    var rf = rateForm, nr = formRate;
    updSites(function(l) { return l.map(function(s) {
      if (s.id !== rf.siteId) return s;
      var exists = s.rates.some(function(r) { return r.id === rf.rateId; });
      return { ...s, rates: exists ? s.rates.map(function(r) { return r.id === rf.rateId ? nr : r; }) : s.rates.concat([nr]) };
    }); });
    setRateForm(null);
  };
  var deleteRate = function(s, r) {
    if (!confirm("Delete the " + s.name + " rate version starting " + r.effective + "? Recorded shifts keep their own rates.")) return;
    updSites(function(l) { return l.map(function(x) { return x.id !== s.id ? x : { ...x, rates: x.rates.filter(function(y) { return y.id !== r.id; }) }; }); });
    if (rateForm && rateForm.rateId === r.id) setRateForm(null);
  };
  var rateSummary = function(r) {
    return money(r.stipend) + " per " + r.stipendHours + "h shift" + DOT +
      "call-in " + money(r.callInWeekday) + " weekday / " + money(r.callInWeekendHoliday) + " weekend-holiday" + DOT +
      money(r.hourly) + "/hr" + (r.hourlyMinHours > 0 ? " (min " + r.hourlyMinHours + "h per trip)" : "") + DOT +
      (r.hourlyWeekdayDay ? "hourly any time" : "no hourly on weekday days");
  };
  var danger = { color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" };
  var primary = { border: "none", background: "#0ea5e9", color: "#fff" };

  return (<div style={S.page}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <button onClick={onBack} style={S.backBtn}>Back</button>
      <h1 style={{ ...S.title, marginBottom: 0 }}>Call Pay</h1>
    </div>

    <div style={S.card}>
      <div style={S.cardLabel}>Shifts</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
        {sites.length === 0 ? "Add a site and its rates below to get started." : "Shift logging is coming next. Set up each site's rates below."}
      </div>
    </div>

    <div style={S.card}>
      <div style={S.cardLabel}>{"Sites & rates"}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>Each site keeps dated rate versions - when rates change, add a new version instead of overwriting. Recorded shifts keep the rates they were priced with.</div>
      {sites.length === 0 && <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "10px 0" }}>No sites yet.</div>}
      {sites.map(function(s) {
        var cur = rateInForce(s, today);
        var sorted = s.rates.slice().sort(function(a, b) { return a.effective < b.effective ? 1 : a.effective > b.effective ? -1 : 0; });
        var visible = (showAll[s.id] || !cur) ? sorted : [cur];
        var hidden = sorted.length - visible.length;
        var wd = s.weekendDays || [];
        return (<div key={s.id} style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-default)" }}>
          {renaming === s.id
            ? <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="text" value={renameDraft} onChange={function(e) { setRenameDraft(e.target.value); }} autoFocus style={{ ...S.searchInput, flex: 1, fontSize: 13, padding: "10px 12px" }} />
                <button onClick={function() { saveRename(s.id); }} disabled={!renameDraft.trim() || nameTaken(renameDraft, s.id)} style={btn({ ...primary, opacity: renameDraft.trim() && !nameTaken(renameDraft, s.id) ? 1 : 0.4 })}>Save</button>
                <button onClick={function() { setRenaming(null); setRenameDraft(""); }} style={btn()}>Cancel</button>
              </div>
            : <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <div style={{ flex: 1, minWidth: 0, fontSize: 15, fontWeight: 700, color: "var(--text-bright)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{s.name}</div>
                <button onClick={function() { setRenaming(s.id); setRenameDraft(s.name); }} style={btn()}>Rename</button>
                <button onClick={function() { deleteSite(s); }} style={btn(danger)}>Delete</button>
              </div>}

          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, marginBottom: 6 }}>Weekend days (weekend call-in fee and weekend hourly)</div>
          <div style={{ display: "flex", gap: 4 }}>
            {DAYS.map(function(dn, d) {
              var on = wd.indexOf(d) !== -1;
              return (<button key={dn} onClick={function() { toggleWeekend(s.id, d); }} style={btn({ flex: 1, padding: 0, fontSize: 12, border: on ? "1px solid rgba(14,165,233,0.6)" : "1px solid var(--border-default)", background: on ? "rgba(14,165,233,0.15)" : "transparent", color: on ? "#0ea5e9" : "var(--text-faint)" })}>{dn}</button>);
            })}
          </div>

          <div style={{ marginTop: 10 }}>
            {sorted.length === 0 && <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "6px 0" }}>No rates yet - add the first version.</div>}
            {visible.map(function(r) {
              // A past version that is not current has been replaced by the
              // next newer one in the (newest-first) sorted list.
              var newer = sorted[sorted.indexOf(r) - 1];
              var status = r === cur ? "Current since " + r.effective
                : r.effective > today ? "Starts " + r.effective
                : "Replaced " + (newer ? newer.effective : "") + " (was from " + r.effective + ")";
              return (<div key={r.id} style={{ padding: "8px 0", borderTop: "1px solid rgba(51,65,85,0.4)" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: r === cur ? "#34d399" : "var(--text-muted)" }}>{status + (r.label ? " (" + r.label + ")" : "")}</div>
                <div style={{ fontSize: 12, color: "var(--text-primary)", fontFamily: "JetBrains Mono", marginTop: 3, lineHeight: 1.5 }}>{rateSummary(r)}</div>
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button onClick={function() { openRateForm(s, r); }} style={btn()}>Edit</button>
                  <button onClick={function() { deleteRate(s, r); }} style={btn(danger)}>Delete</button>
                </div>
              </div>);
            })}
            {(hidden > 0 || (showAll[s.id] && cur && sorted.length > 1)) && <button onClick={function() { setShowAll({ ...showAll, [s.id]: !showAll[s.id] }); }} style={btn({ marginTop: 4, width: "100%" })}>{showAll[s.id] ? "Show current only" : "Show " + hidden + " other version" + (hidden === 1 ? "" : "s")}</button>}
          </div>

          {rateForm && rateForm.siteId === s.id
            ? <div style={{ marginTop: 10, padding: 12, borderRadius: 10, border: "1px solid rgba(14,165,233,0.3)", background: "var(--bg-inset)" }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: "#0ea5e9", marginBottom: 10 }}>{rateForm.editing ? "Edit rate version" : "New rate version"}</div>
                <div style={S.fieldGroup}><label style={S.fieldLabel}>Effective from</label><input type="date" value={rateForm.f.effective} onChange={function(e) { setField("effective", e.target.value); }} style={S.dateInput} /></div>
                {RATE_FIELDS.map(function(rf) {
                  var bad = rateForm.f[rf[0]] !== "" && fieldBad(rf[0]);
                  return (<div key={rf[0]} style={S.fieldGroup}><label style={S.fieldLabel}>{rf[1]}</label>
                    <input type="text" inputMode="decimal" value={rateForm.f[rf[0]]} onChange={function(e) { setField(rf[0], e.target.value); }} placeholder="0" style={{ ...S.numberInput, width: 160, border: bad ? "1px solid #ef4444" : "1px solid var(--border-default)" }} />
                  </div>);
                })}
                <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 13, color: "var(--text-primary)", cursor: "pointer", marginBottom: 8 }}>
                  <input type="checkbox" checked={rateForm.f.hourlyWeekdayDay} onChange={function(e) { setField("hourlyWeekdayDay", e.target.checked); }} style={{ width: 20, height: 20 }} />
                  Hourly also paid on weekday daytime (7 am - 5 pm)
                </label>
                <div style={S.fieldGroup}><label style={S.fieldLabel}>Label (optional, e.g. Proposal)</label><input type="text" value={rateForm.f.label} onChange={function(e) { setField("label", e.target.value); }} style={{ ...S.searchInput, fontSize: 13, padding: "10px 12px" }} /></div>
                {formErr && <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 8, lineHeight: 1.5 }}>{formErr}</div>}
                {rateForm.editing && <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 8, lineHeight: 1.5 }}>Editing a version does not change shifts already recorded.</div>}
                <div style={{ display: "flex", gap: 8 }}>
                  <button onClick={saveRate} disabled={!formRate} style={btn({ ...primary, flex: 1, opacity: formRate ? 1 : 0.4 })}>Save</button>
                  <button onClick={function() { setRateForm(null); }} style={btn()}>Cancel</button>
                </div>
              </div>
            : <button onClick={function() { openRateForm(s, null); }} style={btn({ marginTop: 8, width: "100%", color: "#0ea5e9", border: "1px solid rgba(14,165,233,0.3)" })}>+ Add rate version</button>}
        </div>);
      })}

      <div style={{ display: "flex", gap: 8, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-default)" }}>
        <input type="text" value={newSite} onChange={function(e) { setNewSite(e.target.value); }} placeholder="New site name" style={{ ...S.searchInput, flex: 1, fontSize: 13, padding: "10px 12px" }} />
        <button onClick={addSite} disabled={!newSite.trim() || nameTaken(newSite, null)} style={btn({ ...primary, opacity: newSite.trim() && !nameTaken(newSite, null) ? 1 : 0.4 })}>Add site</button>
      </div>
      {newSite.trim() && nameTaken(newSite, null) && <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 6 }}>A site with that name already exists.</div>}
    </div>
  </div>);
}
