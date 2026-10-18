// =======================================
// CALL PAY (sites + dated rate versions)
// =======================================
// Dollar-only call-shift pay, fully separate from entries, wRVU totals and
// Comp. All pay math and validity rules live in utils.js (cleanPayRate,
// payNum, rateInForce, computeShiftPay) - this file only edits paySites and
// renders. Site names and rates are USER-ENTERED data: never hardcode either
// anywhere in source (public repo), except the built-in preset
// DEFAULT_PAY_SITES in utils.js (CLAUDE.md). Recorded shifts keep their own
// rate copy, so editing or deleting a rate version here never changes pay
// already recorded - unless the user confirms the re-price offered after a
// version is saved, or taps "Use current rates" while editing a shift. Nav-less view opened from Log or Settings; onBack returns
// to whichever opened it. Dollar amounts follow the app's show-$ toggle.
function CallPay({ data, upd, onBack, showComp, toggleComp, showUndo }) {
  var sites = data.paySites || [];
  var shifts = data.payShifts || [];
  var today = todayLocal();
  var DAYS = ["Su", "M", "Tu", "W", "Th", "F", "Sa"];
  var DAY3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
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
  const [repriceOffer, setRepriceOffer] = useState(null); // { siteIds: [...] } after rates change
  const [offerHidden, setOfferHidden] = useState(false); // "Not now" on the Built-in rates card (this visit)
  const [creditHidden, setCreditHidden] = useState(false); // "Not now" on the Built-in credit rule card (this visit)
  const [hoursOpen, setHoursOpen] = useState(false);     // shift form: hours-on-call input shown
  const [moreOpen, setMoreOpen] = useState({});          // shift form: call-in index -> "More options" open
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
  // Built-in sites (utils.js DEFAULT_PAY_SITES) with no standing site at all
  // (payMissingBuiltIns: id, same name or "<name> ..." alias) - e.g. after
  // deleting one. A standing site that lacks rates gets the Built-in rates
  // card instead (payBuiltInOffers).
  var missingDefaults = payMissingBuiltIns(sites);
  var addDefaults = function() {
    var names = missingDefaults.map(function(ds) { return ds.name; }).join(" and ");
    if (!names || !confirm("Add " + names + " with the built-in rates? You can edit them afterwards.")) return;
    updSites(function(l) {
      var miss = payMissingBuiltIns(l).map(function(ds) { return ds.id; });
      return l.concat(defaultPaySites().filter(function(ds) { return miss.indexOf(ds.id) !== -1; }));
    });
  };
  var offers = payBuiltInOffers(sites);
  var builtInDefOf = {}; // site id -> the built-in def it stands for
  DEFAULT_PAY_SITES.forEach(function(def) { var m = payBuiltInFor(sites, def); if (m && m.site) builtInDefOf[m.site.id] = def; });
  // Built-in credit rule (7b): sites matched to a no-credit built-in by name
  // that still credit their call cases. Nothing changes without a confirmed tap.
  var creditOffers = payCreditOffers(sites);
  var creditOfferOf = {};
  creditOffers.forEach(function(o) { creditOfferOf[o.site.id] = o; });
  var dayList = function(days) { return days.slice().sort(function(a, b) { return (a + 6) % 7 - (b + 6) % 7; }).map(function(d) { return DAY3[d]; }).join(", "); };
  var saveRename = function(id) {
    var n = renameDraft.trim();
    if (!n || nameTaken(n, id)) return;
    updSites(function(l) { return l.map(function(s) { return s.id === id ? { ...s, name: n } : s; }); });
    setRenaming(null);
    setRenameDraft("");
  };
  var deleteSite = function(s) {
    var used = shifts.filter(function(p) { return p.siteId === s.id; }).length;
    var cases = (data.entries || []).filter(function(e) { return entrySiteId(e) === s.id; }).length;
    var msg = "Delete " + s.name + " and its " + s.rates.length + " rate version" + (s.rates.length === 1 ? "" : "s") + "?" +
      (used ? " Its " + used + " recorded shift" + (used === 1 ? "" : "s") + " keep their own pay and rates." : "") +
      (cases ? " Its " + cases + " logged call case" + (cases === 1 ? " keeps its" : "s keep their") + " site name and credit." : "");
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
    // Offer to re-price this site's shifts; the card shows only if any
    // recorded shift now prices differently from the version in force.
    setRepriceOffer({ siteIds: [rf.siteId] });
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
      (r.hourlyWeekdayDay ? "hourly any time" : "no hourly weekdays 7am-5pm");
  };
  // ---- Shift form ----
  // The draft holds text as typed plus UI-only flags (rel, timeAuto, clsSet,
  // hoursSet). payShiftFromDraft (utils.js) is the ONLY thing that turns it
  // into a stored shift and computeShiftPay prices it - no pay math here.
  var MASK = "$\u2022\u2022\u2022\u2022\u2022";
  var paid = function(v) { return showComp ? money(v) : MASK; };
  var CLS = [["wd", "Day"], ["wn", "Night"], ["we", "Wknd"], ["hol", "Hol"]];
  var PROB = {
    site: "Pick a site.", date: "Pick the day you were on call.", hours: "Enter hours on call.",
    rates: "No rates for this site on this date - add them under Sites & rates.",
    overLength: "Hours on call are more than this rate's shift length.",
    future: "This shift is dated in the future.", duplicate: "Another shift at this site is already logged on this date.",
    payNothing: "This shift pays nothing - check the rates.", pay: "Pay can't be worked out - check the values.",
    evDate: "Pick the call-in date.", evBefore: "This call-in is dated before the shift.",
    evLate: "This call-in is dated well after the shift - check the date.",
    evCls: "Pick when you went in.", evHours: "Enter the hours you were in (0 if none).",
    midnight: "Pick before or after midnight."
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
  var DAY_FULL = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  var dayLabel = function(ymd) { var w = ymdWeekday(ymd); return w < 0 ? ymd : DAY3[w] + " " + (+ymd.slice(5, 7)) + "/" + (+ymd.slice(8, 10)); };
  // Whole dollars without cents ($1,500), otherwise cents ($291.13).
  var cash = function(v) { var n = Number(v); return n === Math.round(n) ? "$" + n.toLocaleString("en-US") : money(n); };
  var shortDay = function(ymd) { var w = ymdWeekday(ymd); return w < 0 ? ymd : DAYS[w] + " " + (+ymd.slice(5, 7)) + "/" + (+ymd.slice(8, 10)); };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var monthLabel = function(mk) { return MONTHS[+mk.slice(5, 7) - 1] + " " + mk.slice(0, 4); };
  var fromLabel = function(ymd) { return isYMD(ymd) ? MONTHS[+ymd.slice(5, 7) - 1] + " " + (+ymd.slice(8, 10)) + ", " + ymd.slice(0, 4) : ymd; };
  // Site credit switch (7b). One confirmed tap; the offer is re-planned
  // inside the updater against the CURRENT list, so a stale render or a
  // second tap changes nothing. Logged cases keep their credit either way.
  var applyCreditRule = function() {
    if (!creditOffers.length || !confirm(payCreditConfirm(creditOffers))) return;
    var ids = creditOffers.map(function(o) { return o.site.id; });
    updSites(function(l) { return payApplyNoCredit(l, ids); });
  };
  var setSiteCredit = function(s, earns) {
    if ((s.casesEarnRVU !== false) === earns) return;
    if (!confirm(earns
      ? s.name + ": call cases you log here will earn wRVU credit.\n\nCases already logged keep their credit; you can change each one in History."
      : s.name + ": call cases you log here dated " + fromLabel(CALL_NO_CREDIT_FROM) + " or later will earn NO wRVU credit - logged for the record, out of your wRVU and comp totals.\n\nCases already logged keep their credit; you can change each one in History.")) return;
    var id = s.id;
    updSites(function(l) { return l.map(function(x) { return x.id === id ? paySiteWithCredit(x, earns) : x; }); });
  };
  // One confirmed tap applies the preset version to every offered site. The
  // updater re-plans against the CURRENT list, so a second tap is a no-op.
  var useBuiltIns = function() {
    if (!offers.length) return;
    var froms = offers.map(function(o) { return o.def.rates[0].effective; }).filter(function(f, i, a) { return a.indexOf(f) === i; });
    var parts = offers.map(function(o) {
      var p = o.plan, n = p.removeDates.length;
      var added = o.def.weekendDays.filter(function(d) { return (o.site.weekendDays || []).indexOf(d) === -1; });
      return o.site.name + (o.site.name.trim().toLowerCase() !== o.def.name.toLowerCase() ? " (built-in " + o.def.name + ")" : "") + ": " + rateSummary(o.def.rates[0]) + "." +
        (n ? " Removes the $0 version" + (n > 1 ? "s" : "") + " from " + p.removeDates.join(", ") + "." : "") +
        (p.later ? " Your version from " + p.later + " still applies from that date." : "") +
        (p.days && added.length ? " Also counts " + dayList(added) + " as " + (added.length > 1 ? "weekend days" : "a weekend day") + ", as the built-in rates do." : "");
    });
    if (!confirm("Use the built-in rates" + (froms.length === 1 ? " from " + fromLabel(froms[0]) : "") + "?\n\n" + parts.join("\n\n") +
      "\n\nYour other rate versions stay as they are. Recorded shifts keep their own rates until you re-price them.")) return;
    var ids = offers.map(function(o) { return o.site.id; });
    // Sites whose weekend days this tap extends: their recorded weekday
    // call-ins on the added days (from the built-in start) become weekend
    // call-ins in the re-price that follows (payReclassShift).
    var reclass = {};
    offers.forEach(function(o) { if (o.plan.days) reclass[o.site.id] = { oldDays: (o.site.weekendDays || []).slice(), from: o.def.rates[0].effective }; });
    updSites(function(l) {
      var fresh = payBuiltInOffers(l);
      return l.map(function(s) { var o = fresh.filter(function(x) { return x.site === s; })[0]; return o ? payApplyBuiltIn(s, o.def, o.plan) : s; });
    });
    setRepriceOffer({ siteIds: ids, reclass: reclass });
  };
  // Rows use the SAME name rule as the Totals split (utils.js paySiteNames):
  // current name for a live site, newest stored name for a deleted one.
  var siteNameMap = paySiteNames(shifts, sites);
  var shiftSiteName = function(s) { return (s.siteId && siteNameMap[s.siteId]) || s.siteName || "Deleted site"; };
  var plural = function(n, w) { return n + " " + w + (n === 1 ? "" : "s"); };
  // Draft rules live in utils.js (payDraftEvent / payDraftRefresh / payDraftTrip)
  // where check.js pins them; these wrappers only supply "now" and the
  // draft's rate choice (payDraftRate).
  // The form opens at the top (Cancel, title and site/date chips visible);
  // closing it returns the list to where it was (e.g. the expanded month).
  var scrollBox = function() { return document.querySelector(".rvu-content"); };
  var formOpened = function() { var sc = scrollBox(); if (sc) { listScroll.current = sc.scrollTop; sc.scrollTop = 0; } };
  var formClosed = function() { setTimeout(function() { var sc = scrollBox(); if (sc) sc.scrollTop = listScroll.current; }, 0); };
  // The draft's rate choice (utils.js payDraftRate) drives the simple-form
  // rules: which questions to ask and the quiet class where day and night
  // pay the same. orig defaults to the shift being edited.
  var rateOf = function(d, orig) { var o = orig === undefined ? editOrig : orig; return payDraftRate(d, siteFor(d.siteId, o || undefined), o).rates; };
  var reEvent = function(e, d) { return payDraftEvent(e, d.date, siteFor(d.siteId), todayLocal(), nowHM(), rateOf(d)); };
  var refresh = function(d) { return payDraftRefresh(d, siteFor(d.siteId), todayLocal(), nowHM(), rateOf(d)); };
  var trip = function(d, orig) { return payDraftTrip(d.date, siteFor(d.siteId, orig || undefined), rateOf(d, orig)); };
  // A new shift starts with nothing picked (no guessed site or day).
  var openNew = function() {
    if (showUndo) showUndo(null); // a pending Undo must not act behind an open form
    var d = refresh({ id: "shift-" + Date.now().toString(36), siteId: sites.length === 1 ? sites[0].id : "", date: "", callHours: "", hoursSet: false, events: [], note: "" });
    setEditOrig(null);
    setHoursOpen(false);
    setMoreOpen({});
    setDraftInit(JSON.stringify(d));
    setDraft(d);
    formOpened();
  };
  var openEdit = function(s, addCallIn) {
    if (showUndo) showUndo(null);
    var d = payDraftFromShift(s, siteFor(s.siteId, s));
    setDraftInit(JSON.stringify(d));
    if (addCallIn) d = { ...d, events: d.events.concat([trip(d, s)]) };
    setEditOrig(s);
    setHoursOpen(false);
    setMoreOpen({});
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
  var setRel = function(i, rel) { setEv(i, function(e, d) { e.rel = rel; e.relSet = true; e.timeAuto = false; return reEvent(e, d); }); };
  var setDn = function(i, v) { setEv(i, function(e, d) { e.dn = v; return reEvent(e, d); }); };
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
  var dispRates = draft ? payDraftRate(draft, draftSite, editOrig).rates : null;

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
  // Pay-line labels in plain words; "Call-in n: " only with 2+ call-ins.
  var lineLabel = function(l, shift) {
    var r = shift.rates;
    if (l.kind === "stipend") {
      if (l.hours === r.stipendHours) return "Stipend (full " + r.stipendHours + "h shift)";
      if (l.hours > r.stipendHours && l.hours % r.stipendHours === 0) return "Stipend (" + l.hours + "h = " + (l.hours / r.stipendHours) + " \u00D7 " + r.stipendHours + "h shift)";
      return l.hours > r.stipendHours ? "Stipend (" + l.hours + "h at the " + r.stipendHours + "h rate)" : "Stipend (" + l.hours + " of " + r.stipendHours + "h)";
    }
    var ev = shift.events[l.ev], pre = shift.events.length > 1 ? "Call-in " + (l.ev + 1) + ": " : "";
    if (l.kind === "fee") return pre + "Call-in fee (" + (ev.cls === "we" || ev.cls === "hol" ? "weekend/holiday" : "weekday") + ")";
    if (!l.paid) return pre + ev.hours + "h weekday daytime - no hourly";
    return pre + (l.hours > ev.hours ? ev.hours + "h, paid " + l.hours + "h minimum" : l.hours + "h") + " \u00D7 " + money(r.hourly) + "/hr";
  };
  // Shift list: newest shift date first, then most recently added. Shows the
  // newest 5 unless "Show all" is on - every shift must stay reachable.
  var sortedShifts = shifts.map(function(s, i) { return { s: s, i: i }; })
    .sort(function(a, b) { return a.s.date < b.s.date ? 1 : a.s.date > b.s.date ? -1 : b.i - a.i; })
    .map(function(x) { return x.s; });
  var recent = allShifts ? sortedShifts : sortedShifts.slice(0, 5);

  // ---- Re-pricing (utils.js payShiftStale / payRepriceShift / payReclassShift) ----
  // fixShift: the shift re-priced at the version in force and, for a site
  // whose weekend days "Use built-in rates" just extended, re-classified;
  // null when nothing changes.
  var reclassFor = function(site) { return repriceOffer && repriceOffer.reclass ? repriceOffer.reclass[site.id] || null : null; };
  var fixShift = function(x, site, rc) {
    if (!x || x.siteId !== site.id) return null;
    var r = payRepriceShift(x, site) || x;
    var c = rc ? payReclassShift(r, rc.oldDays, site.weekendDays || [], rc.from) : null;
    return c || (r !== x ? r : null);
  };
  var staleFor = function(site) { var rc = reclassFor(site); return shifts.filter(function(x) { return !!fixShift(x, site, rc); }); };
  var dateRange = function(list) {
    var ds = list.map(function(x) { return x.date; }).sort();
    return ds.length ? (ds[0] === ds[ds.length - 1] ? ds[0] : ds[0] + " to " + ds[ds.length - 1]) : "";
  };
  var shiftCents = function(x) { var p = computeShiftPay(x); return p ? Math.round(p.total * 100) : 0; };
  var dropOffer = function(siteId) {
    setRepriceOffer(function(o) { var rest = o ? o.siteIds.filter(function(id) { return id !== siteId; }) : []; return rest.length ? { siteIds: rest, reclass: o.reclass } : null; });
  };
  var repriceSite = function(site) {
    var rc = reclassFor(site);
    var stale = staleFor(site);
    if (!stale.length) { dropOffer(site.id); return; }
    var lenChange = false, before = 0, after = 0, moved = 0;
    stale.forEach(function(x) {
      var r = fixShift(x, site, rc) || x;
      if (r.callHours !== x.callHours) lenChange = true;
      r.events.forEach(function(e, i) { if (x.events[i] && e.cls !== x.events[i].cls) moved++; });
      before += shiftCents(x); after += shiftCents(r);
    });
    var msg = "Re-price " + plural(stale.length, "shift") + " at " + site.name + " (" + dateRange(stale) + ") with the rate version in force for each date?" +
      (lenChange ? " Full-length shifts take the new shift length; partial shifts keep their hours." : "") +
      (moved ? " " + plural(moved, "call-in") + " on " + (moved === 1 ? "a new weekend day becomes a weekend call-in." : "new weekend days become weekend call-ins.") : "") +
      (showComp ? " Their total changes from " + money(before / 100) + " to " + money(after / 100) + "." : "") + " You can Undo.";
    if (!confirm(msg)) return;
    var ids = stale.map(function(x) { return x.id; });
    upd(function(prev) {
      var cur = (prev.paySites || []).filter(function(x) { return x.id === site.id; })[0];
      return { ...prev, payShifts: (prev.payShifts || []).map(function(x) {
        if (ids.indexOf(x.id) === -1) return x;
        var r = cur ? fixShift(x, cur, rc) : null; // re-checked against the CURRENT site
        return r || x;
      }) };
    });
    if (showUndo) showUndo({ type: "pay", remove: [], restore: stale, message: "Re-priced " + plural(stale.length, "shift") + " - " + site.name });
    dropOffer(site.id);
  };
  // Editor: re-take the version in force for this date, like a bulk
  // re-price (utils.js payDraftUseCurrent: a full-length shift takes the new
  // shift length). A call-in set to Day/Night on a day the site counts as a
  // weekend day (e.g. Friday after "Use built-in rates") becomes a weekend
  // call-in only if the user confirms - it may be a deliberate pick - and
  // the question comes only when the answer changes the pay
  // (payDraftReopenAsks). confirm() runs in this tap, never in the updater.
  var useCurrentRates = function() {
    if (!draft) return;
    // Asked only when the answer changes the pay (payDraftReopenAsks).
    var site0 = siteFor(draft.siteId), picks = payDraftReopenAsks(draft, site0, editOrig, todayLocal(), nowHM());
    var one = picks.length === 1, siteName = site0 ? site0.name : "This site";
    var clsName = function(i) { return draft.events[i].cls === "wd" ? "Day" : "Night"; };
    var reopen = picks.length > 0 && confirm(one
      ? siteName + " counts " + dayLabel(draft.events[picks[0]].date) + " as a weekend day, but this call-in is set to " + clsName(picks[0]) +
        ".\n\nMake it a weekend call-in, as a call-in logged on that day now would be? Cancel keeps " + clsName(picks[0]) + " (the new rates apply either way)."
      : siteName + " counts these days as weekend days, but the call-ins are set to a weekday rate type:\n\n" +
        picks.map(function(i) { return dayLabel(draft.events[i].date) + " - " + clsName(i); }).join("\n") +
        "\n\nMake them weekend call-ins, as call-ins logged on those days now would be? Cancel keeps their rate types (the new rates apply either way).");
    setD(function(x) {
      // Every call-in is re-derived under the new rate, exactly like a
      // site/day change - a question that now matters re-opens and blocks.
      return refresh(payDraftUseCurrent(x, siteFor(x.siteId), editOrig, reopen));
    });
  };
  var staleTag = function(s) {
    return payShiftStale(s, siteById(s.siteId)) ? <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "rgba(245,158,11,0.15)", color: "#f59e0b", fontFamily: "inherit", whiteSpace: "nowrap" }}>Rates changed</span> : null;
  };

  var danger = { color: "#ef4444", border: "1px solid rgba(239,68,68,0.3)" };
  var primary = { border: "none", background: "#0ea5e9", color: "#fff" };

  var eyeBtn = <CompEye showComp={showComp} toggleComp={toggleComp} />;
  var chip = function(on, label, onClick, key) {
    return (<button key={key} onClick={onClick} style={btn({ flex: 1, padding: "0 6px", fontSize: 12, border: on ? "1px solid rgba(14,165,233,0.6)" : "1px solid var(--border-default)", background: on ? "rgba(14,165,233,0.15)" : "transparent", color: on ? "#0ea5e9" : "var(--text-muted)" })}>{label}</button>);
  };
  var probLine = function(p, k) {
    return (<div key={k} style={{ fontSize: 11, lineHeight: 1.5, marginTop: 4, color: p.block ? "#ef4444" : "#f59e0b" }}>{PROB[p.code] || p.code}</div>);
  };

  // The simple shift form (R2): tap a site (its rates show on the button),
  // tap the day, tick "I went in", type the hours - the Total updates live.
  // It asks only what changes pay: Day or Night on a weekday where daytime
  // hourly is unpaid (payAsksDayNight), before/after midnight where the next
  // day's call-in fee differs (payMidnightAsks). Exact time, call-in date,
  // fee and rate type sit under "More options".
  var renderForm = function() {
    var d = draft;
    var site = draftSite, r = dispRates;
    var probsOf = function(ev) { return built.problems.filter(function(p) { return p.ev === ev; }); };
    var topBlocked = probsOf(-1).some(function(p) { return p.code === "site" || p.code === "date" || p.code === "rates"; });
    var shiftProbs = probsOf(-1).filter(function(p) { return !(p.code === "hours" && topBlocked); });
    var yesterday = addDaysYMD(today, -1);
    var feeOn = function(ymd) { return r ? (payWeOrHol(ymd, site) ? r.callInWeekendHoliday : r.callInWeekday) : 0; };
    var siteSummary = function(x) {
      return cash(x.stipend) + " / " + x.stipendHours + "h shift" + (x.stipendHours < PAY_LONG_SHIFT_HOURS ? " (" + PAY_LONG_SHIFT_HOURS + "h wknd/hol)" : "") + DOT + "call-in " + cash(x.callInWeekday) +
        (x.callInWeekendHoliday !== x.callInWeekday ? " (" + cash(x.callInWeekendHoliday) + " wknd/hol)" : "") + DOT +
        cash(x.hourly) + "/hr" + (x.hourlyMinHours > 0 ? ", " + x.hourlyMinHours + "h min" : "") + (x.hourlyWeekdayDay ? "" : ", no hourly weekdays 7am-5pm");
    };
    // Shift length: where the stipend period is shorter than a 24h shift
    // (weekend and holiday call), a stipend-period / 24h choice; the form
    // starts at payDefaultShiftHours for the day. Any other length is typed.
    var fullH = r ? payDefaultShiftHours(d.date, site, r) : null;
    var lenChoices = r && r.stipendHours < PAY_LONG_SHIFT_HOURS ? [r.stipendHours, PAY_LONG_SHIFT_HOURS] : null;
    var curH = payNum(d.callHours);
    var showHoursInput = !!r && (hoursOpen || (lenChoices ? lenChoices.indexOf(curH) === -1 : curH !== fullH));
    var pickLen = function(h) { setHoursOpen(false); setD(function(x) { return { ...x, callHours: String(h), hoursSet: true }; }); };
    var went = d.events.length > 0;
    var setWent = function(on) {
      if (on) { setD(function(x) { return { ...x, events: x.events.concat([trip(x)]) }; }); return; }
      var details = (editOrig && (editOrig.events || []).length > 0) || d.events.some(function(e) { return e.hours !== "" || !!e.time || e.fee === false || e.clsSet || !!e.dn; });
      if (details && !confirm("Remove the call-in details from this shift?")) return;
      setMoreOpen({});
      setD(function(x) { return { ...x, events: [] }; });
    };
    // A deleted site's weekend days are unknown: name only a holiday there.
    var dayKind = function(ymd) { var h = payHolidayName(ymd); return h ? h : site && site.deleted ? "" : payWeOrHol(ymd, site) ? "weekend" : "weekday"; };
    var rateLine = function(e) {
      if (!e.cls || !isYMD(e.date)) return "";
      if (e.clsSet) return "Rate type you picked: " + { wd: "Day", wn: "Night", we: "Weekend", hol: "Holiday" }[e.cls];
      if (site && site.deleted && e.cls !== "hol") return "Saved rate type: " + { wd: "Day", wn: "Night", we: "Weekend" }[e.cls];
      if (e.cls === "hol") return "Holiday rates (" + payHolidayName(e.date) + ")";
      if (e.cls === "we") return "Weekend rates (" + DAY_FULL[ymdWeekday(e.date)] + ")";
      if (r && r.hourlyWeekdayDay) return "Weekday rates (day and night pay the same)";
      return e.cls === "wd" ? "Weekday daytime rates (no hourly)" : "Weeknight rates";
    };
    var pick = function(on) { return { border: on ? "2px solid #0ea5e9" : "1px solid var(--border-default)", background: on ? "rgba(14,165,233,0.12)" : "transparent" }; };
    return (<div style={S.page}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={closeDraft} style={S.backBtn}>Cancel</button>
        <h1 style={{ ...S.title, marginBottom: 0, flex: 1 }}>{editOrig ? "Edit shift" : "New shift"}</h1>
        {eyeBtn}
      </div>

      <div style={S.card}>
        <div style={S.fieldLabel}>Site</div>
        {site && site.deleted && <div style={{ padding: "10px 12px", marginTop: 6, borderRadius: 10, ...pick(true) }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: "#0ea5e9" }}>{site.name + " (deleted)"}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.5 }}>This site was deleted. The shift keeps the rates it was saved with; changing its day needs a current site.</div>
        </div>}
        {sites.map(function(s) {
          var on = d.siteId === s.id;
          var sr = rateInForce(s, isYMD(d.date) ? d.date : today);
          return (<button key={s.id} onClick={function() { setD(function(x) { return refresh({ ...x, siteId: s.id }); }); }} style={{ display: "block", width: "100%", textAlign: "left", minHeight: 56, padding: "10px 12px", marginTop: 6, borderRadius: 10, cursor: "pointer", ...pick(on) }}>
            <div style={{ fontSize: 15, fontWeight: 700, color: on ? "#0ea5e9" : "var(--text-bright)" }}>{s.name}</div>
            <div style={{ fontSize: 11, marginTop: 2, lineHeight: 1.4, color: sr ? "var(--text-muted)" : "#f59e0b" }}>{sr ? siteSummary(sr) : "No rates for this date"}</div>
          </button>);
        })}

        <div style={{ ...S.fieldLabel, marginTop: 14 }}>Day on call (the day the shift started)</div>
        <div style={{ display: "flex", gap: 6 }}>
          {chip(d.date === yesterday, "Yesterday" + DOT + dayLabel(yesterday), function() { setD(function(x) { return refresh({ ...x, date: yesterday }); }); }, "y")}
          {chip(d.date === today, "Today" + DOT + dayLabel(today), function() { setD(function(x) { return refresh({ ...x, date: today }); }); }, "t")}
        </div>
        <input type="date" value={d.date} onChange={function(e) { var v = e.target.value; setD(function(x) { return refresh({ ...x, date: v }); }); }} style={{ ...S.dateInput, marginTop: 6 }} />
        {isYMD(d.date) && r && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
          {dayLabel(d.date) + (dayKind(d.date) ? DOT + dayKind(d.date) : "") + DOT + "rates from " + fromLabel(r.effective) + (r.label ? " (" + r.label + ")" : "") + (built.ratesFrom === "kept" ? ", saved with this shift" : "")}
          {editOrig && built.ratesFrom === "inForce" ? (d.reprice ? " - updated to the current rates." : " - updated for the new site/day.") : ""}
        </div>}
        {editOrig && built.ratesFrom === "kept" && site && !site.deleted && payShiftStale(editOrig, site) && <div style={{ marginTop: 8, padding: 10, borderRadius: 8, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.06)", fontSize: 11, color: "var(--text-primary)", lineHeight: 1.5 }}>
          {"This shift was saved with the version from " + editOrig.rates.effective + "; the version from " + rateInForce(site, d.date).effective + " is now in force for its date."}
          <button onClick={useCurrentRates} style={btn({ display: "block", marginTop: 6, color: "#f59e0b", border: "1px solid rgba(245,158,11,0.4)" })}>Use current rates</button>
        </div>}

        {r && lenChoices && <div style={{ marginTop: 12 }}>
          <div style={S.fieldLabel}>Shift length</div>
          <div style={{ display: "flex", gap: 6 }}>
            {lenChoices.map(function(h) { return chip(!showHoursInput && curH === h, h + "h shift", function() { pickLen(h); }, "len" + h); })}
            {chip(showHoursInput, "Other hours", function() { setHoursOpen(true); }, "lenOther")}
          </div>
          {showHoursInput && <div style={{ marginTop: 8 }}>
            <div style={S.fieldLabel}>Hours on call</div>
            <input type="text" inputMode="decimal" value={d.callHours} onChange={function(e) { var v = e.target.value; setD(function(x) { return { ...x, callHours: v, hoursSet: true }; }); }} placeholder="0" style={{ ...S.numberInput, width: 110 }} />
          </div>}
        </div>}
        {r && !lenChoices && <div style={{ marginTop: 12 }}>
          {!showHoursInput
            ? <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, fontSize: 13, color: "var(--text-primary)" }}>{"Full shift: " + d.callHours + "h"}</div>
                <button onClick={function() { setHoursOpen(true); }} style={btn({ minHeight: 36, fontSize: 12 })}>Change hours</button>
              </div>
            : <div>
                <div style={S.fieldLabel}>Hours on call</div>
                <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <input type="text" inputMode="decimal" value={d.callHours} onChange={function(e) { var v = e.target.value; setD(function(x) { return { ...x, callHours: v, hoursSet: true }; }); }} placeholder="0" style={{ ...S.numberInput, width: 110 }} />
                  <button onClick={function() { setHoursOpen(false); setD(function(x) { return { ...x, callHours: String(fullH), hoursSet: false }; }); }} style={btn()}>{"Full " + fullH + "h"}</button>
                </div>
              </div>}
        </div>}
        {shiftProbs.map(probLine)}
      </div>

      {(r || went) && <div style={S.card}>
        <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 48, fontSize: 15, fontWeight: 600, color: "var(--text-bright)", cursor: "pointer" }}>
          <input type="checkbox" checked={went} onChange={function(e) { setWent(e.target.checked); }} style={{ width: 22, height: 22 }} />
          I went in to the hospital
        </label>
        {went && r && <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>{"Each time you go in is paid its own call-in fee" + (r.hourlyMinHours > 0 ? " and " + r.hourlyMinHours + "h minimum" : "") + "."}</div>}
        {d.events.map(function(e, i) {
          var asks = payMidnightAsks(d.date, site, r);
          var askDN = payAsksDayNight(e.date, site, r) && !e.time && !e.clsSet;
          var pickType = !!(site && site.deleted) && !e.cls; // deleted site: the rate type must be picked
          var forced = e.clsSet || !!e.time || e.rel === "other" || (e.rel === "next" && !asks) || e.fee === false || pickType;
          var more = forced || !!moreOpen[i];
          var next = addDaysYMD(d.date, 1);
          var evProbs = probsOf(i).filter(function(p) { return !(p.code === "evCls" && e.rel === ""); })
            .map(function(p) { return p.code === "evDate" && e.rel === "" ? { code: "midnight", ev: i, block: true } : p; });
          return (<div key={i} style={{ marginTop: 12, paddingTop: 12, borderTop: "1px solid var(--border-default)" }}>
            {d.events.length > 1 && <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 6 }}>
              <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--text-bright)" }}>{"Call-in " + (i + 1)}</div>
              <button onClick={function() { setMoreOpen({}); setD(function(x) { return { ...x, events: x.events.filter(function(y, j) { return j !== i; }) }; }); }} style={btn(danger)}>Remove</button>
            </div>}
            <div style={S.fieldLabel}>Hours in the hospital</div>
            <input type="text" inputMode="decimal" value={e.hours} onChange={function(ev) { setEvField(i, "hours", ev.target.value); }} placeholder="e.g. 2.5" style={{ ...S.numberInput, width: 110 }} />
            {(asks || e.rel === "") && <div style={{ marginTop: 10 }}>
              <div style={S.fieldLabel}>Did you go in before or after midnight?</div>
              {[["same", "Before midnight", d.date], ["next", "After midnight", next]].map(function(o) {
                var on = e.rel === o[0];
                return (<button key={o[0]} onClick={function() { setRel(i, o[0]); }} style={btn({ display: "block", width: "100%", textAlign: "left", marginTop: 6, ...pick(on), color: on ? "#0ea5e9" : "var(--text-primary)" })}>{o[1] + DOT + dayLabel(o[2]) + DOT + cash(feeOn(o[2])) + " fee"}</button>);
              })}
            </div>}
            {askDN && <div style={{ marginTop: 10 }}>
              <div style={S.fieldLabel}>When did you go in?</div>
              <div style={{ display: "flex", gap: 6 }}>
                {chip(e.dn === "wd", "Day, 7 am - 5 pm", function() { setDn(i, "wd"); }, "d")}
                {chip(e.dn === "wn", "Night, 5 pm - 7 am", function() { setDn(i, "wn"); }, "n")}
              </div>
              <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>{(site ? site.name : "This site") + " pays hourly only at night, on weekends and holidays."}</div>
            </div>}
            {rateLine(e) && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8 }}>{rateLine(e)}</div>}
            <button onClick={function() { if (!forced) setMoreOpen({ ...moreOpen, [i]: !moreOpen[i] }); }} style={{ background: "none", border: "none", padding: "8px 0", minHeight: 36, color: forced ? "var(--text-faint)" : "#0ea5e9", fontSize: 12, fontWeight: 600, cursor: forced ? "default" : "pointer" }}>{more ? "Fewer options" : "More options"}</button>
            {more && <div style={{ padding: 10, borderRadius: 8, background: "var(--bg-inset)", border: "1px solid var(--border-default)" }}>
              <div style={S.fieldLabel}>Start time (optional)</div>
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <input type="time" value={e.time} onChange={function(ev) { setEvField(i, "time", ev.target.value); }} style={S.dateInput} />
                {e.time && <button onClick={function() { setEvField(i, "time", ""); }} style={btn()}>Clear</button>}
              </div>
              <div style={{ ...S.fieldLabel, marginTop: 10 }}>{"Date of this call-in" + (isYMD(e.date) ? DOT + dayLabel(e.date) : "")}</div>
              <div style={{ display: "flex", gap: 6 }}>
                {chip(e.rel === "same", "Shift day", function() { setRel(i, "same"); }, "s")}
                {chip(e.rel === "next", "Next day", function() { setRel(i, "next"); }, "n")}
                {chip(e.rel === "other", "Other", function() { setRel(i, "other"); }, "o")}
              </div>
              {e.rel === "other" && <input type="date" value={e.date} onChange={function(ev) { setEvField(i, "date", ev.target.value); }} style={{ ...S.dateInput, marginTop: 6 }} />}
              <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 13, color: "var(--text-primary)", cursor: "pointer", marginTop: 6 }}>
                <input type="checkbox" checked={e.fee} onChange={function() { setEv(i, function(x) { x.fee = !x.fee; return x; }); }} style={{ width: 20, height: 20 }} />
                Call-in fee
              </label>
              <div style={{ ...S.fieldLabel, marginTop: 6 }}>Rate type</div>
              {pickType && <div style={{ fontSize: 11, color: "#f59e0b", marginBottom: 6, lineHeight: 1.5 }}>This site was deleted, so its weekend days are unknown - pick the rate type for this call-in.</div>}
              <div style={{ display: "flex", gap: 6 }}>
                {CLS.map(function(c) { return chip(e.cls === c[0], c[1], function() { setEv(i, function(x) { x.cls = c[0]; x.clsSet = true; return x; }); }, c[0]); })}
              </div>
              {e.clsSet && <button onClick={function() { setEv(i, function(x, dd) { x.clsSet = false; return reEvent(x, dd); }); }} style={btn({ minHeight: 32, padding: "0 10px", fontSize: 11, marginTop: 6 })}>Use auto</button>}
            </div>}
            {evProbs.map(probLine)}
          </div>);
        })}
        {went && <button onClick={function() { setD(function(x) { return { ...x, events: x.events.concat([trip(x)]) }; }); }} style={btn({ width: "100%", marginTop: 10, color: "#0ea5e9", border: "1px solid rgba(14,165,233,0.3)" })}>+ Went in again</button>}
      </div>}

      <div style={S.card}>
        <div style={S.fieldLabel}>Note (optional - no patient info)</div>
        <input type="text" value={d.note} onChange={function(e) { var v = e.target.value; setD(function(x) { return { ...x, note: v }; }); }} style={{ ...S.searchInput, fontSize: 13, padding: "10px 12px" }} />
      </div>

      {draftPay && <div style={S.card}>
        <div style={S.cardLabel}>Pay</div>
        <div style={{ marginTop: 6 }}>
          {draftPay.lines.map(function(l, k) {
            return (<div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "4px 0", color: l.paid ? "var(--text-primary)" : "var(--text-faint)" }}>
              <span>{lineLabel(l, built.shift)}</span><span style={{ fontFamily: "JetBrains Mono", flexShrink: 0 }}>{paid(l.amount)}</span>
            </div>);
          })}
        </div>
      </div>}

      <div style={{ position: "sticky", bottom: 0, zIndex: 5, background: "var(--bg-base)", borderTop: "1px solid var(--border-default)", padding: "10px 0 12px", marginTop: 4 }}>
        <button onClick={function() { if (!showComp) toggleComp(); }} style={{ width: "100%", minHeight: 36, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, background: "none", border: "none", padding: "0 2px 8px", cursor: showComp ? "default" : "pointer" }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{draftPay ? (showComp ? "Total" : "Total (tap to show)") : "Total - fill in the items above"}</span>
          <span style={{ fontSize: 20, fontWeight: 700, fontFamily: "JetBrains Mono", color: "#10b981" }}>{draftPay ? paid(draftPay.total) : "-"}</span>
        </button>
        <button onClick={saveDraft} disabled={!built.shift} style={btn({ ...primary, width: "100%", minHeight: 50, fontSize: 15, opacity: built.shift ? 1 : 0.4 })}>{editOrig ? "Save changes" : built.shift ? "Save " + built.shift.siteName + DOT + dayLabel(built.shift.date) : "Save shift"}</button>
      </div>
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

    {offers.length > 0 && !offerHidden && <div style={{ ...S.card, border: "1px solid rgba(14,165,233,0.4)", background: "rgba(14,165,233,0.06)" }}>
      <div style={S.cardLabel}>Built-in rates</div>
      {offers.map(function(o) {
        return (<div key={o.site.id} style={{ fontSize: 12, color: "var(--text-primary)", marginTop: 6, lineHeight: 1.5 }}>{o.site.name + ": no paying rates from " + fromLabel(o.def.rates[0].effective) + (o.plan.later ? " until " + o.plan.later : "") + "."}</div>);
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={useBuiltIns} style={btn({ ...primary, flex: 1 })}>Use built-in rates</button>
        <button onClick={function() { setOfferHidden(true); }} style={btn()}>Not now</button>
      </div>
    </div>}

    {creditOffers.length > 0 && !creditHidden && <div style={{ ...S.card, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.06)" }}>
      <div style={S.cardLabel}>Built-in credit rule</div>
      {creditOffers.map(function(o) {
        return (<div key={o.site.id} style={{ fontSize: 12, color: "var(--text-primary)", marginTop: 6, lineHeight: 1.5 }}>{o.site.name + ": the built-in " + o.def.name + " rule gives call cases from " + fromLabel(CALL_NO_CREDIT_FROM) + " no wRVU credit. This site still credits them."}</div>);
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={applyCreditRule} style={btn({ ...primary, flex: 1 })}>Use no credit</button>
        <button onClick={function() { setCreditHidden(true); }} style={btn()}>Not now</button>
      </div>
    </div>}

    <div style={S.card}>
      <div style={S.cardLabel}>Call shifts</div>
      {sites.length === 0
        ? <div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>Add a site and its rates below to get started.</div>
            {missingDefaults.length > 0 && <button onClick={addDefaults} style={btn({ width: "100%", marginTop: 10, color: "#0ea5e9", border: "1px solid rgba(14,165,233,0.3)" })}>{"Add built-in site" + (missingDefaults.length === 1 ? "" : "s") + ": " + missingDefaults.map(function(ds) { return ds.name; }).join(", ")}</button>}
          </div>
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
                        <div style={{ fontSize: 11, color: "var(--text-muted)", fontFamily: "JetBrains Mono" }}>{s.callHours + "h" + DOT + n + " call-in" + (n === 1 ? "" : "s") + DOT + (p ? paid(p.total) : "?")}{staleTag(s)}</div>
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
                {staleTag(s)}
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
          {builtInDefOf[s.id] && wd.slice().sort().join(",") !== builtInDefOf[s.id].weekendDays.slice().sort().join(",") && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>{"The built-in " + builtInDefOf[s.id].name + " rates count " + dayList(builtInDefOf[s.id].weekendDays) + " as weekend days."}</div>}

          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, marginBottom: 6 }}>Call cases logged here</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[[true, "Earn wRVU credit"], [false, "No wRVU credit"]].map(function(c) {
              var on = (s.casesEarnRVU !== false) === c[0];
              return (<button key={c[1]} onClick={function() { setSiteCredit(s, c[0]); }} style={btn({ flex: 1, padding: "0 8px", fontSize: 12, border: on ? "1px solid rgba(14,165,233,0.6)" : "1px solid var(--border-default)", background: on ? "rgba(14,165,233,0.15)" : "transparent", color: on ? "#0ea5e9" : "var(--text-faint)" })}>{c[1]}</button>);
            })}
          </div>
          {s.casesEarnRVU === false && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>{"Call cases dated " + fromLabel(CALL_NO_CREDIT_FROM) + " or later are logged with no wRVU credit; earlier ones earn credit."}</div>}
          {creditOfferOf[s.id] && <div style={{ fontSize: 11, color: "#f59e0b", marginTop: 6, lineHeight: 1.5 }}>{"The built-in " + creditOfferOf[s.id].def.name + " rule is no wRVU credit for call cases from " + fromLabel(CALL_NO_CREDIT_FROM) + " - tap No wRVU credit if that applies here."}</div>}

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

          {repriceOffer && repriceOffer.siteIds.indexOf(s.id) !== -1 && staleFor(s).length > 0 && <div style={{ marginTop: 10, padding: 12, borderRadius: 10, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.06)" }}>
            <div style={{ fontSize: 12, color: "var(--text-primary)", lineHeight: 1.5 }}>{plural(staleFor(s).length, "recorded shift") + " (" + dateRange(staleFor(s)) + ") use rates that differ from the version now in force for their dates."}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={function() { repriceSite(s); }} style={btn({ ...primary, flex: 1 })}>{"Re-price " + plural(staleFor(s).length, "shift")}</button>
              <button onClick={function() { dropOffer(s.id); }} style={btn()}>Not now</button>
            </div>
          </div>}

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
                {rateForm.editing && <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 8, lineHeight: 1.5 }}>Editing a version does not change shifts already recorded; after saving you'll be offered a re-price.</div>}
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
      {missingDefaults.length > 0 && <button onClick={addDefaults} style={btn({ width: "100%", marginTop: 10, color: "#0ea5e9", border: "1px solid rgba(14,165,233,0.3)" })}>{"Add built-in site" + (missingDefaults.length === 1 ? "" : "s") + ": " + missingDefaults.map(function(ds) { return ds.name; }).join(", ")}</button>}
    </div>
  </div>);
}
