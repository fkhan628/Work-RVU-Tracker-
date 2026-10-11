// =======================================
// CALL PAY (sites + dated rate versions)
// =======================================
// Dollar-only call-shift pay, fully separate from entries, wRVU totals and
// Comp. All pay math and validity rules live in utils.js (cleanPayRate,
// payNum, rateInForce, computeShiftPay) - this file only edits paySites and
// renders. Site names and rates are USER-ENTERED data only: never hardcode
// either anywhere in source (public repo). Recorded shifts keep their own
// rate copy, so editing or deleting a rate version here never changes pay
// already recorded. Nav-less view opened from Log or Settings; onBack returns
// to whichever opened it. Dollar amounts follow the app's show-$ toggle.
function CallPay({ data, upd, onBack, showComp, toggleComp, showUndo }) {
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
  const [draft, setDraft] = useState(null);       // shift form draft (text as typed) or null
  const [draftInit, setDraftInit] = useState(""); // draft JSON when opened, for the discard check
  const [editOrig, setEditOrig] = useState(null); // the saved shift being edited (null = new)
  const savingRef = useRef(false);                // double-tap guard on Save
  const [allShifts, setAllShifts] = useState(false); // Recent: newest 5 vs every shift
  const listScroll = useRef(0);                      // list scroll position while a form is open
  const [payYear, setPayYear] = useState("");     // Totals year chip ("" = newest)
  const [openMonth, setOpenMonth] = useState(""); // expanded Totals month "YYYY-MM"
  var payYears = payShiftYears(shifts);
  var yr = payYears.indexOf(payYear) !== -1 ? payYear : (payYears[0] || "");
  const totals = useMemo(function() { return yr ? payMonthTotals(shifts, yr, sites) : null; }, [data.payShifts, data.paySites, yr]);

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
  // ---- Shift form ----
  // The draft holds text as typed plus UI-only flags (rel, timeAuto, clsSet,
  // hoursSet). payShiftFromDraft (utils.js) is the ONLY thing that turns it
  // into a stored shift and computeShiftPay prices it - no pay math here.
  var MASK = "$\u2022\u2022\u2022\u2022\u2022";
  var paid = function(v) { return showComp ? money(v) : MASK; };
  var CLS = [["wd", "Day"], ["wn", "Night"], ["we", "Wknd"], ["hol", "Hol"]];
  var PROB = {
    site: "Pick a site.", date: "Pick the shift date.", hours: "Enter hours on call.",
    rates: "No rate version is in force on this date - add one under Sites & rates.",
    overLength: "Hours on call are more than this rate's shift length.",
    future: "This shift is dated in the future.", duplicate: "Another shift at this site is already logged on this date.",
    payNothing: "This shift pays nothing - check the rates.", pay: "Pay can't be worked out - check the values.",
    evDate: "Pick the call-in date.", evBefore: "This call-in is dated before the shift.",
    evLate: "This call-in is dated well after the shift - check the date.",
    evCls: "Pick Day or Night (or Wknd / Hol).", evHours: "Enter hours came in (0 if you didn't come in)."
  };
  var siteById = function(id) { return sites.filter(function(s) { return s.id === id; })[0] || null; };
  // A shift whose site was deleted stays editable: a stand-in site built from
  // the shift itself keeps its saved rates and name (payShiftFromDraft then
  // reports ratesFrom "kept"). orig defaults to the shift being edited.
  var siteFor = function(id, orig) {
    var s = siteById(id);
    var o = orig || editOrig;
    if (s || !o || !id || id !== o.siteId) return s;
    return { id: o.siteId, name: o.siteName || "Deleted site", weekendDays: [], rates: [], deleted: true };
  };
  var nowHM = function() { return localHM(new Date()); };
  var autoClass = function(e, site) { return classifyPayEvent(e.date, e.time, site ? site.weekendDays : []); };
  var shortDay = function(ymd) { var w = ymdWeekday(ymd); return w < 0 ? ymd : DAYS[w] + " " + (+ymd.slice(5, 7)) + "/" + (+ymd.slice(8, 10)); };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var monthLabel = function(mk) { return MONTHS[+mk.slice(5, 7) - 1] + " " + mk.slice(0, 4); };
  // Rows use the SAME name rule as the Totals split (utils.js paySiteNames):
  // current name for a live site, newest stored name for a deleted one.
  var siteNameMap = paySiteNames(shifts, sites);
  var shiftSiteName = function(s) { return (s.siteId && siteNameMap[s.siteId]) || s.siteName || "Deleted site"; };
  var plural = function(n, w) { return n + " " + w + (n === 1 ? "" : "s"); };
  // Draft rules live in utils.js (payDraftEvent / payDraftRefresh) where
  // check.js pins the clock; these wrappers only supply "now".
  // The form opens at the top (Cancel, title and site/date chips visible);
  // closing it returns the list to where it was (e.g. the expanded month).
  var scrollBox = function() { return document.querySelector(".rvu-content"); };
  var formOpened = function() { var sc = scrollBox(); if (sc) { listScroll.current = sc.scrollTop; sc.scrollTop = 0; } };
  var formClosed = function() { setTimeout(function() { var sc = scrollBox(); if (sc) sc.scrollTop = listScroll.current; }, 0); };
  var reEvent = function(e, d) { return payDraftEvent(e, d.date, siteFor(d.siteId), todayLocal(), nowHM()); };
  var refresh = function(d) { return payDraftRefresh(d, siteFor(d.siteId), todayLocal(), nowHM()); };
  var newEvent = function(d) { return payDraftNewEvent(d.date, siteFor(d.siteId), todayLocal(), nowHM()); };
  var openNew = function() {
    if (showUndo) showUndo(null); // a pending Undo must not act behind an open form
    var lastSite = shifts.length ? siteById(shifts[shifts.length - 1].siteId) : null;
    var site = lastSite || (sites.length === 1 ? sites[0] : null);
    var d = refresh({ id: "shift-" + Date.now().toString(36), siteId: site ? site.id : "", date: payDefaultShiftDate(todayLocal(), nowHM()), callHours: "", hoursSet: false, events: [], note: "" });
    setEditOrig(null);
    setDraftInit(JSON.stringify(d));
    setDraft(d);
    formOpened();
  };
  var openEdit = function(s, addCallIn) {
    if (showUndo) showUndo(null);
    var site = siteFor(s.siteId, s);
    var nextDay = addDaysYMD(s.date, 1);
    var d = { id: s.id, siteId: s.siteId, date: s.date, callHours: String(s.callHours), hoursSet: true, note: s.note || "",
      events: (s.events || []).map(function(e) {
        var ne = { date: e.date, rel: e.date === s.date ? "same" : e.date === nextDay ? "next" : "other", time: e.time || "", timeAuto: false, cls: e.cls, clsSet: false, fee: e.fee, hours: String(e.hours) };
        ne.clsSet = autoClass(ne, site) !== e.cls; // a saved override stays an override
        return ne;
      }) };
    setDraftInit(JSON.stringify(d));
    if (addCallIn) d = { ...d, events: d.events.concat([payDraftNewEvent(d.date, site, todayLocal(), nowHM())]) };
    setEditOrig(s);
    setDraft(d);
    formOpened();
  };
  var closeDraft = function() {
    if (draft && JSON.stringify(draft) !== draftInit && !confirm("Discard changes to this shift?")) return;
    setDraft(null);
    formClosed();
    setEditOrig(null);
  };
  var setD = function(fn) { setDraft(function(d) { return d ? fn(d) : d; }); };
  var setEv = function(i, fn) { setD(function(d) { var evs = d.events.slice(); evs[i] = fn({ ...evs[i] }, d); return { ...d, events: evs }; }); };
  // Every call-in change goes back through payDraftEvent, so the date /
  // auto time / class rules apply the same way whatever the tap order.
  var setRel = function(i, rel) { setEv(i, function(e, d) { e.rel = rel; e.timeAuto = false; return reEvent(e, d); }); };
  var setEvField = function(i, k, v) {
    setEv(i, function(e, d) {
      e[k] = v;
      if (k === "time" || k === "date") e.timeAuto = false;
      if (k === "date") e.rel = "other";
      return reEvent(e, d);
    });
  };

  var draftSite = draft ? siteFor(draft.siteId) : null;
  var built = draft ? payShiftFromDraft(draft, draftSite, editOrig, { shifts: shifts, today: today }) : null;
  var draftPay = built && built.shift ? computeShiftPay(built.shift) : null;
  var dispRates = !built ? null : built.ratesFrom === "kept" ? editOrig.rates : built.ratesFrom === "inForce" ? rateInForce(draftSite, draft.date) : null;

  var saveDraft = function() {
    if (savingRef.current || !built || !built.shift) return;
    savingRef.current = true;
    var ns = built.shift, old = editOrig;
    upd(function(prev) {
      var l = (prev.payShifts || []).slice();
      var at = -1;
      l.forEach(function(s, i) { if (s.id === ns.id) at = i; });
      if (at === -1) l.push(ns); else l[at] = ns;
      return { ...prev, payShifts: l };
    });
    if (showUndo) showUndo(old
      ? { type: "pay", remove: [], restore: [old], message: "Shift updated" + (ns.siteName ? " - " + ns.siteName : "") }
      : { type: "pay", remove: [ns.id], restore: [], message: "Shift saved" + (ns.siteName ? " - " + ns.siteName : "") });
    setDraft(null);
    formClosed();
    setEditOrig(null);
    setTimeout(function() { savingRef.current = false; }, 400);
  };
  var deleteShift = function() {
    if (!editOrig) return;
    var old = editOrig;
    var at = -1;
    shifts.forEach(function(s, i) { if (s.id === old.id) at = i; });
    upd(function(prev) { return { ...prev, payShifts: (prev.payShifts || []).filter(function(s) { return s.id !== old.id; }) }; });
    if (showUndo) showUndo({ type: "pay", remove: [], restore: [old], at: at, message: "Deleted " + shortDay(old.date) + " shift" + (old.siteName ? " - " + old.siteName : "") });
    setDraft(null);
    formClosed();
    setEditOrig(null);
  };
  var lineLabel = function(l, shift) {
    if (l.kind === "stipend") return "Stipend (" + l.hours + " of " + shift.rates.stipendHours + "h)";
    var ev = shift.events[l.ev], n = "Call-in " + (l.ev + 1);
    if (l.kind === "fee") return n + " fee (" + (ev.cls === "we" || ev.cls === "hol" ? "weekend/holiday" : "weekday") + ")";
    if (!l.paid) return n + ": " + l.hours + "h not paid (weekday day)";
    return n + " hourly " + l.hours + "h" + (l.hours > ev.hours ? " (minimum)" : "");
  };
  // Shift list: newest shift date first, then most recently added. Shows the
  // newest 5 unless "Show all" is on - every shift must stay reachable.
  var sortedShifts = shifts.map(function(s, i) { return { s: s, i: i }; })
    .sort(function(a, b) { return a.s.date < b.s.date ? 1 : a.s.date > b.s.date ? -1 : b.i - a.i; })
    .map(function(x) { return x.s; });
  var recent = allShifts ? sortedShifts : sortedShifts.slice(0, 5);

  var danger = { color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" };
  var primary = { border: "none", background: "#0ea5e9", color: "#fff" };

  var eyeBtn = <button onClick={toggleComp} style={{ minHeight: 44, minWidth: 44, background: "none", border: "1px solid var(--border-default)", borderRadius: 8, cursor: "pointer", color: showComp ? "#10b981" : "var(--text-dim)", fontSize: 16, lineHeight: 1, flexShrink: 0 }} title={showComp ? "Hide pay" : "Show pay"}>{showComp ? "\uD83D\uDC41" : "\uD83D\uDC41\u200D\uD83D\uDDE8"}</button>;
  var chip = function(on, label, onClick, key) {
    return (<button key={key} onClick={onClick} style={btn({ flex: 1, padding: "0 6px", fontSize: 12, border: on ? "1px solid rgba(14,165,233,0.6)" : "1px solid var(--border-default)", background: on ? "rgba(14,165,233,0.15)" : "transparent", color: on ? "#0ea5e9" : "var(--text-muted)" })}>{label}</button>);
  };
  var probLine = function(p, k) {
    return (<div key={k} style={{ fontSize: 11, lineHeight: 1.5, marginTop: 4, color: p.block ? "#ef4444" : "#f59e0b" }}>{PROB[p.code] || p.code}</div>);
  };

  var renderForm = function() {
    var d = draft;
    var shiftProbs = built.problems.filter(function(p) { return p.ev === -1; });
    var yesterday = addDaysYMD(today, -1);
    return (<div style={S.page}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={closeDraft} style={S.backBtn}>Cancel</button>
        <h1 style={{ ...S.title, marginBottom: 0, flex: 1 }}>{editOrig ? "Edit shift" : "New shift"}</h1>
        {eyeBtn}
      </div>

      <div style={S.card}>
        <div style={S.fieldLabel}>Site</div>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {draftSite && draftSite.deleted && chip(true, draftSite.name + " (deleted)", function() {}, "deleted-site")}
          {sites.map(function(s) { return chip(d.siteId === s.id, s.name, function() { setD(function(x) { return refresh({ ...x, siteId: s.id }); }); }, s.id); })}
        </div>
        {draftSite && draftSite.deleted && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>This site was deleted. The shift keeps the rates it was saved with; changing its date needs a current site.</div>}
        <div style={{ ...S.fieldLabel, marginTop: 12 }}>Shift date (the day the shift started)</div>
        <div style={{ display: "flex", gap: 6 }}>
          {chip(d.date === today, "Today", function() { setD(function(x) { return refresh({ ...x, date: today }); }); }, "t")}
          {chip(d.date === yesterday, "Yesterday", function() { setD(function(x) { return refresh({ ...x, date: yesterday }); }); }, "y")}
        </div>
        <input type="date" value={d.date} onChange={function(e) { var v = e.target.value; setD(function(x) { return refresh({ ...x, date: v }); }); }} style={{ ...S.dateInput, marginTop: 6 }} />
        <div style={{ ...S.fieldLabel, marginTop: 12 }}>Hours on call</div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <input type="text" inputMode="decimal" value={d.callHours} onChange={function(e) { var v = e.target.value; setD(function(x) { return { ...x, callHours: v, hoursSet: true }; }); }} placeholder="0" style={{ ...S.numberInput, width: 110 }} />
          {dispRates && <button onClick={function() { setD(function(x) { return { ...x, callHours: String(dispRates.stipendHours), hoursSet: true }; }); }} style={btn()}>{"Full " + dispRates.stipendHours + "h"}</button>}
        </div>
        {dispRates && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
          {built.ratesFrom === "kept"
            ? "Priced at the rates saved with this shift (version from " + dispRates.effective + (dispRates.label ? ", " + dispRates.label : "") + ")"
            : "Rates: version from " + dispRates.effective + (dispRates.label ? " (" + dispRates.label + ")" : "")}
          {editOrig && built.ratesFrom === "inForce" ? " - updated for the new site/date." : ""}
        </div>}
        {shiftProbs.map(probLine)}
      </div>

      {d.events.map(function(e, i) {
        var hol = payHolidayName(e.date);
        return (<div key={i} style={S.card}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <div style={{ flex: 1, fontSize: 14, fontWeight: 700, color: "var(--text-bright)" }}>{"Call-in " + (i + 1)}</div>
            <button onClick={function() { setD(function(x) { return { ...x, events: x.events.filter(function(y, j) { return j !== i; }) }; }); }} style={btn(danger)}>Remove</button>
          </div>
          <div style={{ ...S.fieldLabel, marginTop: 10 }}>Hours came in (0 if you didn't come in)</div>
          <input type="text" inputMode="decimal" value={e.hours} onChange={function(ev) { setEvField(i, "hours", ev.target.value); }} placeholder="0" style={{ ...S.numberInput, width: 110 }} />
          <div style={{ ...S.fieldLabel, marginTop: 10 }}>{"Started " + (isYMD(e.date) ? shortDay(e.date) : "")}</div>
          <div style={{ display: "flex", gap: 6 }}>
            {chip(e.rel === "same", "Shift day", function() { setRel(i, "same"); }, "s")}
            {chip(e.rel === "next", "Next day", function() { setRel(i, "next"); }, "n")}
            {chip(e.rel === "other", "Other", function() { setRel(i, "other"); }, "o")}
          </div>
          {e.rel === "other" && <input type="date" value={e.date} onChange={function(ev) { setEvField(i, "date", ev.target.value); }} style={{ ...S.dateInput, marginTop: 6 }} />}
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginTop: 6 }}>
            <input type="time" value={e.time} onChange={function(ev) { setEvField(i, "time", ev.target.value); }} style={S.dateInput} />
            {e.timeAuto && e.time && <span style={{ fontSize: 11, color: "var(--text-faint)" }}>auto</span>}
            {e.time && <button onClick={function() { setEvField(i, "time", ""); }} style={btn()}>Clear</button>}
          </div>
          <div style={{ ...S.fieldLabel, marginTop: 10 }}>{"Class" + (hol ? " - " + hol : "")}</div>
          <div style={{ display: "flex", gap: 6 }}>
            {CLS.map(function(c) { return chip(e.cls === c[0], c[1], function() { setEv(i, function(x) { x.cls = c[0]; x.clsSet = true; return x; }); }, c[0]); })}
          </div>
          <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>
            {e.clsSet
              ? <button onClick={function() { setEv(i, function(x, dd) { x.clsSet = false; return reEvent(x, dd); }); }} style={btn({ minHeight: 32, padding: "0 10px", fontSize: 11 })}>Use auto</button>
              : (e.cls ? "Picked automatically from the date" + (e.time ? " and time" : "") : "")}
          </div>
          <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 13, color: "var(--text-primary)", cursor: "pointer", marginTop: 4 }}>
            <input type="checkbox" checked={e.fee} onChange={function() { setEv(i, function(x) { x.fee = !x.fee; return x; }); }} style={{ width: 20, height: 20 }} />
            Call-in fee
          </label>
          {built.problems.filter(function(p) { return p.ev === i; }).map(probLine)}
        </div>);
      })}
      <button onClick={function() { setD(function(x) { return { ...x, events: x.events.concat([newEvent(x)]) }; }); }} style={btn({ width: "100%", marginBottom: 12, color: "#0ea5e9", border: "1px solid rgba(14,165,233,0.3)" })}>+ Add call-in</button>

      <div style={S.card}>
        <div style={S.fieldLabel}>Note (optional - no patient info)</div>
        <input type="text" value={d.note} onChange={function(e) { var v = e.target.value; setD(function(x) { return { ...x, note: v }; }); }} style={{ ...S.searchInput, fontSize: 13, padding: "10px 12px" }} />
      </div>

      <div style={S.card}>
        <div style={S.cardLabel}>Pay</div>
        {draftPay ? <div style={{ marginTop: 6 }}>
          {draftPay.lines.map(function(l, k) {
            return (<div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "4px 0", color: l.paid ? "var(--text-primary)" : "var(--text-faint)" }}>
              <span>{lineLabel(l, built.shift)}</span><span style={{ fontFamily: "JetBrains Mono", flexShrink: 0 }}>{paid(l.amount)}</span>
            </div>);
          })}
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, fontWeight: 700, padding: "8px 0 0", marginTop: 4, borderTop: "1px solid var(--border-default)", color: "var(--text-bright)" }}>
            <span>Total</span><span style={{ fontFamily: "JetBrains Mono" }}>{paid(draftPay.total)}</span>
          </div>
        </div> : <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 6 }}>Fix the items in red to see pay.</div>}
      </div>

      <button onClick={saveDraft} disabled={!built.shift} style={btn({ ...primary, width: "100%", minHeight: 50, fontSize: 15, opacity: built.shift ? 1 : 0.4 })}>{editOrig ? "Save changes" : "Save shift"}</button>
      {editOrig && <button onClick={deleteShift} style={btn({ ...danger, width: "100%", marginTop: 10 })}>Delete shift</button>}
    </div>);
  };

  // Every hook is declared above this line (CLAUDE.md: hooks before any
  // conditional return).
  if (draft) return renderForm();

  return (<div style={S.page}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <button onClick={onBack} style={S.backBtn}>Back</button>
      <h1 style={{ ...S.title, marginBottom: 0, flex: 1 }}>Call Pay</h1>
      {eyeBtn}
    </div>

    <div style={S.card}>
      <div style={S.cardLabel}>Call shifts</div>
      {sites.length === 0
        ? <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>Add a site and its rates below to get started.</div>
        : <div>
            <button onClick={openNew} style={btn({ ...primary, width: "100%", marginTop: 10, minHeight: 50, fontSize: 15 })}>+ New shift</button>
            {recent.length === 0
              ? <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 10 }}>No shifts logged yet.</div>
              : <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 2 }}>{allShifts ? "All shifts (" + shifts.length + ")" : "Recent"}</div>
                  {recent.map(function(s) {
                    var p = computeShiftPay(s);
                    var n = (s.events || []).length;
                    return (<div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid rgba(51,65,85,0.4)" }}>
                      <button onClick={function() { openEdit(s, false); }} style={{ flex: 1, minWidth: 0, minHeight: 48, textAlign: "left", background: "none", border: "none", padding: "4px 0", cursor: "pointer" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortDay(s.date) + DOT + shiftSiteName(s)}</div>
                        <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "JetBrains Mono" }}>{s.callHours + "h" + DOT + n + " call-in" + (n === 1 ? "" : "s") + DOT + (p ? paid(p.total) : "?")}</div>
                      </button>
                      <button onClick={function() { openEdit(s, true); }} style={btn()}>+ Call-in</button>
                    </div>);
                  })}
                  {shifts.length > 5 && <button onClick={function() { setAllShifts(!allShifts); }} style={btn({ width: "100%", marginTop: 6 })}>{allShifts ? "Show recent only" : "Show all " + shifts.length + " shifts"}</button>}
                </div>}
          </div>}
    </div>

    {totals && <div style={S.card}>
      <div style={S.cardLabel}>Totals</div>
      {payYears.length > 1 && <div style={{ display: "flex", gap: 6, marginTop: 8, flexWrap: "wrap" }}>
        {payYears.map(function(y) { return chip(y === yr, y, function() { setPayYear(y); setOpenMonth(""); }, y); })}
      </div>}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, marginTop: 10 }}>
        <div style={{ fontSize: 12, color: "var(--text-muted)" }}>{yr + DOT + plural(totals.shifts, "shift") + DOT + plural(totals.callIns, "call-in")}</div>
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "JetBrains Mono", color: "#10b981", flexShrink: 0 }}>{paid(totals.total)}</div>
      </div>
      {totals.months.map(function(m) {
        var open = openMonth === m.key;
        return (<div key={m.key} style={{ borderTop: "1px solid rgba(51,65,85,0.4)", marginTop: 6 }}>
          <button onClick={function() { setOpenMonth(open ? "" : m.key); }} style={{ width: "100%", minHeight: 48, display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", padding: "4px 0", cursor: "pointer", textAlign: "left" }}>
            <span style={{ width: 12, fontSize: 12, color: "var(--text-faint)" }}>{open ? "\u25BE" : "\u25B8"}</span>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{monthLabel(m.key)}</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{plural(m.shifts, "shift")}</span>
            <span style={{ minWidth: 88, textAlign: "right", fontSize: 13, fontWeight: 600, fontFamily: "JetBrains Mono", color: "var(--text-bright)" }}>{paid(m.total)}</span>
          </button>
          {open && <div style={{ padding: "0 0 8px 20px" }}>
            {m.sites.length > 1 && <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 4 }}>
              {m.sites.map(function(st) { return st.name + (st.deleted ? " (deleted)" : "") + " " + paid(st.total) + " (" + st.shifts + ")"; }).join(DOT)}
            </div>}
            {m.unpriced > 0 && <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 4 }}>{plural(m.unpriced, "shift") + " could not be priced - open " + (m.unpriced === 1 ? "it" : "them") + " to check."}</div>}
            {m.list.map(function(s) {
              var p = computeShiftPay(s);
              var n = (s.events || []).length;
              return (<button key={s.id} onClick={function() { openEdit(s, false); }} style={{ width: "100%", minHeight: 44, display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", borderTop: "1px solid rgba(51,65,85,0.25)", padding: "2px 0", cursor: "pointer", textAlign: "left" }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortDay(s.date) + DOT + shiftSiteName(s) + DOT + plural(n, "call-in")}</span>
                <span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "var(--text-muted)", flexShrink: 0 }}>{p ? paid(p.total) : "?"}</span>
              </button>);
            })}
          </div>}
        </div>);
      })}
    </div>}

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
