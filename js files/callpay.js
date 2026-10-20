// =======================================
// CALL PAY (sites + dated rate versions)
// =======================================
// Dollar-only call-shift pay, fully separate from entries, wRVU totals and
// Comp. All pay math and validity rules live in utils.js (cleanPayRate,
// cleanPayTyped, payNum, rateInForce, computeShiftPay, payShiftsFromDraft) -
// this file only edits paySites and renders. Site names and rates are
// USER-ENTERED data: never hardcode either anywhere in source (public repo),
// except the built-in preset DEFAULT_PAY_SITES in utils.js (CLAUDE.md).
// Recorded shifts keep their own rate copy, so editing or deleting a rate
// version here never changes pay already recorded - unless the user confirms
// the re-price offered after a version is saved or deleted, or taps "Use
// current rates" while editing a shift. Two kinds of rate version share a
// site's list: LEGACY (stipend + call-in fees + hourly) and TYPED (Day/Night
// shift types: a flat amount, plus call-in pay once the night's time in
// reaches a threshold). A legacy shift dated where a typed version is in
// force "needs a type": it is never guessed and never summed until it is
// set here. Opened from Log, Home or Settings; onBack returns to whichever
// opened it. The nav stays visible, so an unsaved shift form is parked in
// App's memory-only `keep` ref across a tab switch (utils.js payParkedDraft
// decides whether it can come back). `focus` (App's one-shot ref) scrolls
// to the Call pay rates card once the list shows. Dollar amounts follow the app's show-$ toggle; with $
// hidden every rate amount shown without being opened is masked too (only
// an opened rate form shows amounts).
function CallPay({ data, upd, onBack, showComp, toggleComp, showUndo, focus, keep }) {
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
  const [rateForm, setRateForm] = useState(null); // { siteId, rateId, editing, kind: "legacy" | "typed", f } - f: legacy text fields, or the typed form (utils.js payTypedFormFromVersion)
  // A shift form parked by a tab switch: read ONCE and cleared at once, so a
  // form that throws while rendering is never restored again (the effect
  // above the form's return parks it only after a render that committed).
  const [parked] = useState(function() { var p = keep ? keep.current : null; if (keep) keep.current = null; return payParkedDraft(p, data.payShifts || [], data.paySites); });
  const [draft, setDraft] = useState(parked ? parked.draft : null);             // shift form draft (text as typed) or null
  const [draftInit, setDraftInit] = useState(parked ? parked.draftInit : "");   // draft JSON when opened, for the discard check
  const [draftBase, setDraftBase] = useState(parked && typeof parked.draftBase === "string" ? parked.draftBase : ""); // the saved shift's JSON before "+ Call-in" added its row ("" otherwise)
  const [editOrig, setEditOrig] = useState(parked ? parked.editOrig : null);    // the saved shift being edited (null = new)
  const savingRef = useRef(false);                // double-tap guard on Save
  const [allShifts, setAllShifts] = useState(false); // Recent: newest 5 vs every shift
  const [flagOnly, setFlagOnly] = useState(false);   // Recent: only the shifts that need Day or Night
  const listScroll = useRef(0);                      // list scroll position while a form is open
  const [repriceOffer, setRepriceOffer] = useState(null); // { siteIds: [...] } after rates change
  const [offerHidden, setOfferHidden] = useState(false); // "Not now" on the Built-in rates card (this visit)
  const [creditHidden, setCreditHidden] = useState(false); // "Not now" on the Built-in credit rule card (this visit)
  const [typedOfferHidden, setTypedOfferHidden] = useState(false); // "Not now" on the "Use new Davenport rates" card (this visit)
  const [typeCardHidden, setTypeCardHidden] = useState(false);     // "Not now" on the Day-or-Night card (this visit)
  const [hoursOpen, setHoursOpen] = useState(parked ? !!parked.hoursOpen : false);   // shift form: hours-on-call input shown
  const [moreOpen, setMoreOpen] = useState(parked && parked.moreOpen ? parked.moreOpen : {}); // shift form: call-in index -> "More options" open
  const [payYear, setPayYear] = useState("");     // Totals year chip ("" = newest)
  const [openMonth, setOpenMonth] = useState(""); // expanded Totals month "YYYY-MM"
  const ratesCardRef = useRef(null);              // the Call pay rates card (Settings' button scrolls here)
  var payYears = payShiftYears(shifts);
  var yr = payYears.indexOf(payYear) !== -1 ? payYear : (payYears[0] || "");
  const totals = useMemo(function() { return yr ? payMonthTotals(shifts, yr, sites) : null; }, [data.payShifts, data.paySites, yr]);
  // Settings' "Call pay rates" button opens this view scrolled to the rates
  // card (one-shot ref; the timeout lands after App's scroll-to-top). A
  // restored shift form is shown first: the jump waits for the list.
  useEffect(function() {
    if (draft || !focus || !focus.current) return;
    focus.current = false;
    var t = setTimeout(function() {
      var el = ratesCardRef.current, c = el && el.closest ? el.closest(".rvu-content") : null;
      if (!c) return;
      var top = c.scrollTop + (el.getBoundingClientRect().top - c.getBoundingClientRect().top) - 8;
      // An instant jump: the content's smooth scroll-behavior animates a plain
      // scrollTop assignment (which did not move at all in the preview pane).
      if (c.scrollTo) c.scrollTo({ top: top, behavior: "instant" }); else c.scrollTop = top;
    }, 80);
    return function() { clearTimeout(t); };
  }, [draft]);

  var money = function(v) { return "$" + Number(v).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); };
  var btn = function(extra) { return { minHeight: 44, padding: "0 14px", borderRadius: 8, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer", ...extra }; };
  var nameTaken = function(n, exceptId) { var k = n.trim().toLowerCase(); return sites.some(function(s) { return s.id !== exceptId && s.name.trim().toLowerCase() === k; }); };
  var updSites = function(fn) { upd(function(prev) { return { ...prev, paySites: fn(prev.paySites || []) }; }); };
  // Masking (show/hide $): every $ shown without being opened goes through
  // paid() or maskText(); only an opened rate form shows amounts.
  var MASK = "$\u2022\u2022\u2022\u2022\u2022";
  var paid = function(v) { return showComp ? money(v) : MASK; };
  var maskText = function(s) { return showComp ? s : String(s).replace(/\$[\d,]+(\.\d\d)?/g, MASK); };
  var plural = function(n, w) { return n + " " + w + (n === 1 ? "" : "s"); };

  var addSite = function() {
    var n = newSite.trim();
    if (!n || nameTaken(n, null)) return;
    updSites(function(l) { return l.concat([{ id: "site-" + Date.now().toString(36), name: n, weekendDays: [0, 6], casesEarnRVU: true, rates: [] }]); });
    setNewSite("");
  };
  // Built-in sites (utils.js DEFAULT_PAY_SITES) with no standing site at all
  // (payMissingBuiltIns: id, same name or "<name> ..." alias) - e.g. after
  // deleting one. A standing site that lacks rates gets the Built-in rates
  // card instead (payBuiltInOffers); one whose built-in now pays by shift
  // type gets the "Use new ... rates" card (payTypedOffers).
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
  var typedOffers = payTypedOffers(sites, shifts);
  var needsType = payNeedsTypeCount(shifts, sites);
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

  // Versions sort by payEffKey (a null date = the Original, earliest).
  var byStartDesc = function(a, b) { var ka = payEffKey(a), kb = payEffKey(b); return ka < kb ? 1 : ka > kb ? -1 : 0; };
  var MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  var fromLabel = function(ymd) { return isYMD(ymd) ? MONTHS[+ymd.slice(5, 7) - 1] + " " + (+ymd.slice(8, 10)) + ", " + ymd.slice(0, 4) : ymd; };
  // ---- Rates editor ----
  // Legacy form: numbers stay as typed text and are stored only when the
  // whole version passes cleanPayRate (the rule repairData enforces). Typed
  // form: the fields come from utils.js payTypedFormFromVersion and are
  // parsed ONCE on Save by payTypedVersionFromForm. "+ Add new rates" copies
  // the site's latest version (the Original counts as the oldest) under a
  // blank date; a new version may switch style, starting from the site's
  // latest version of the other style or a blank form.
  var numText = function(v) { return typeof v === "number" ? String(v) : ""; };
  var latestOf = function(s, typed) { return s.rates.filter(function(x) { return payRateIsTyped(x) === typed; }).sort(byStartDesc)[0] || null; };
  var legacyFormFrom = function(src, r) {
    var f = { effective: r ? (r.effective === null ? "" : r.effective) : "", original: !!r && r.effective === null, label: r && r.label ? r.label : "", hourlyWeekdayDay: src ? src.hourlyWeekdayDay === true : true };
    RATE_FIELDS.forEach(function(rf) { f[rf[0]] = src ? numText(src[rf[0]]) : ""; });
    return f;
  };
  var openRateForm = function(s, r) {
    var latest = s.rates.slice().sort(byStartDesc)[0] || null;
    var typed = r ? payRateIsTyped(r) : payRateIsTyped(latest);
    var f = typed ? (r ? payTypedFormFromVersion(r) : (latest ? payNewTypedForm(latest) : payBlankTypedForm())) : legacyFormFrom(r || latestOf(s, false), r);
    setRateForm({ siteId: s.id, rateId: r ? r.id : "rate-" + Date.now().toString(36), editing: !!r, kind: typed ? "typed" : "legacy", f: f });
  };
  var switchStyle = function(s, kind) {
    setRateForm(function(rf) {
      if (!rf || rf.editing || rf.kind === kind) return rf;
      var src = latestOf(s, kind === "typed");
      return { ...rf, kind: kind, f: kind === "typed" ? (src ? payNewTypedForm(src) : payBlankTypedForm()) : legacyFormFrom(src, null) };
    });
  };
  var setField = function(k, v) { setRateForm(function(rf) { return rf ? { ...rf, f: { ...rf.f, [k]: v } } : rf; }); };
  var setForm = function(fn) { setRateForm(function(rf) { return rf ? { ...rf, f: fn(rf.f) } : rf; }); };
  var fieldBad = function(k) { var n = payNum(rateForm.f[k]); return n === null || (k === "stipendHours" && !(n > 0)); };

  var formSite = rateForm ? sites.filter(function(s) { return s.id === rateForm.siteId; })[0] : null;
  var formRate = null, formErr = "";
  if (rateForm && formSite && rateForm.kind === "legacy") {
    var old = rateForm.editing ? formSite.rates.filter(function(r) { return r.id === rateForm.rateId; })[0] : null;
    var cand = { ...(old || {}), id: rateForm.rateId, effective: rateForm.f.original ? null : rateForm.f.effective, hourlyWeekdayDay: rateForm.f.hourlyWeekdayDay };
    RATE_FIELDS.forEach(function(rf) { cand[rf[0]] = rateForm.f[rf[0]]; });
    var lbl = rateForm.f.label.trim();
    if (lbl) cand.label = lbl; else delete cand.label;
    formRate = cleanPayRate(cand, rateForm.rateId);
    if (!rateForm.f.original && !isYMD(rateForm.f.effective)) formErr = "Pick the date these rates start.";
    else if (RATE_FIELDS.some(function(rf) { return fieldBad(rf[0]); })) formErr = "Fill every amount with a number (0 is allowed; shift length must be more than 0).";
    else if (!rateForm.f.original && formSite.rates.some(function(r) { return r.id !== rateForm.rateId && r.effective === rateForm.f.effective; })) formErr = "Another version already starts on " + fromLabel(rateForm.f.effective) + " - edit that one instead.";
    else if (!formRate) formErr = "Check the values.";
    if (formErr) formRate = null;
  }
  var typedRes = rateForm && formSite && rateForm.kind === "typed" ? payTypedVersionFromForm(rateForm.f, rateForm.rateId, formSite) : null;
  // Saving or deleting a version can move recorded legacy shifts under a
  // typed version (e.g. the Day/Night date moves from Oct 1 to Sep 1): ask first.
  var needsTypeAsk = function(s, nextRates, verb, imperative) {
    var delta = payNeedsTypeDelta(s, nextRates, shifts);
    if (delta.count === 0) return true;
    return confirm(verb + " puts " + plural(delta.count, "recorded " + s.name + " shift") + " (" + fromLabel(delta.from) + (delta.to !== delta.from ? " to " + fromLabel(delta.to) : "") + ") under shift-type rates. " + (delta.count === 1 ? "It" : "They") + " will need Day or Night and leave the totals until set. " + imperative + " anyway?");
  };
  var withVersion = function(s, nr) { return s.rates.some(function(r) { return r.id === nr.id; }) ? s.rates.map(function(r) { return r.id === nr.id ? nr : r; }) : s.rates.concat([nr]); };
  var saveRate = function() {
    if (!rateForm || !formSite) return;
    var nr = rateForm.kind === "typed" ? (typedRes && typedRes.version) : formRate;
    if (!nr) return;
    var s = formSite;
    if (!needsTypeAsk(s, withVersion(s, nr), "Saving", "Save")) return;
    var rf = rateForm;
    updSites(function(l) { return l.map(function(x) { return x.id !== rf.siteId ? x : { ...x, rates: withVersion(x, nr) }; }); });
    setRateForm(null);
    // Offer to re-price this site's shifts; the card shows only if any
    // recorded shift now prices differently from the version in force.
    setRepriceOffer({ siteIds: [rf.siteId] });
  };
  var deleteRate = function(s, r) {
    var rest = s.rates.filter(function(y) { return y.id !== r.id; });
    if (!confirm("Delete the " + s.name + " rates " + (r.effective === null ? "(the Original)" : "from " + fromLabel(r.effective)) + "? Recorded shifts keep their own rates; you'll be offered a re-price for shifts the remaining rates price differently.")) return;
    if (!needsTypeAsk(s, rest, "Deleting", "Delete")) return;
    updSites(function(l) { return l.map(function(x) { return x.id !== s.id ? x : { ...x, rates: x.rates.filter(function(y) { return y.id !== r.id; }) }; }); });
    if (rateForm && rateForm.rateId === r.id) setRateForm(null);
    setRepriceOffer({ siteIds: [s.id] });
  };
  var rateSummary = function(r) {
    return money(r.stipend) + " per " + r.stipendHours + "h shift" + DOT +
      "call-in " + money(r.callInWeekday) + " weekday / " + money(r.callInWeekendHoliday) + " weekend-holiday" + DOT +
      money(r.hourly) + "/hr" + (r.hourlyMinHours > 0 ? " (min " + r.hourlyMinHours + "h per trip)" : "") + DOT +
      (r.hourlyWeekdayDay ? "hourly any time" : "no hourly weekdays 7am-5pm");
  };
  // One line for a version of either kind (the only caller of rateSummary).
  var versionSummary = function(v) { return payRateIsTyped(v) ? payRateTypes(v).map(payTypePreview).join("; ") : rateSummary(v); };
  // ---- Shift form ----
  // The draft holds text as typed plus UI-only flags (rel, timeAuto, clsSet,
  // hoursSet) and the typed fields (types, ciRows, id2, savedTrips).
  // payShiftsFromDraft (utils.js) is the ONLY thing that turns it into stored
  // shifts (one, or two for a Day + Night pick) and computeShiftPay prices
  // them - no pay math here.
  var CLS = [["wd", "Day"], ["wn", "Night"], ["we", "Wknd"], ["hol", "Hol"]];
  var PROB = {
    site: "Pick a site.", date: "Pick the day you were on call.", hours: "Enter hours on call.",
    rates: "No rates for this site on this date - add them under Call pay rates.",
    overLength: "Hours on call are more than this rate's shift length.",
    future: "This shift is dated in the future.", duplicate: "Another shift at this site is already logged on this date.",
    payNothing: "This shift pays nothing - check the rates.", pay: "Pay can't be worked out - check the values.",
    evDate: "Pick the call-in date.", evBefore: "This call-in is dated before the shift.",
    evLate: "This call-in is dated well after the shift - check the date.",
    evCls: "Pick when you went in.", evHours: "Enter the hours you were in (0 if none).",
    midnight: "Pick before or after midnight.",
    noType: function(p) { return "Pick " + (p.label || "a shift type") + "."; },
    dupType: function(p) { return "Another " + (p.label || "") + " shift at this site is already logged on this date."; },
    dupFlagged: function(p) { return "A shift at this site on this date still needs " + (p.label || "Day or Night") + " - set it instead of adding another."; },
    ciBlank: "Enter how long you were in.", ciBad: "Use whole numbers for hours and minutes.", ciMin: "Minutes must be 0 to 59.",
    ciLong: "Call-ins add up to more than the shift length - check the times."
  };
  var probText = function(p) { var t = PROB[p.code]; return typeof t === "function" ? t(p) : (t || p.code); };
  var siteById = function(id) { return sites.filter(function(s) { return s.id === id; })[0] || null; };
  // A shift whose site was deleted stays editable: a stand-in site built from
  // the shift itself keeps its saved rates and name (payShiftsFromDraft then
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
  var monthLabel = function(mk) { return MONTHS[+mk.slice(5, 7) - 1] + " " + mk.slice(0, 4); };
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
  // One confirmed tap applies the preset version (payBuiltInVersion: legacy
  // or typed) to every offered site. The updater re-plans against the
  // CURRENT list, so a second tap is a no-op. Amounts only when $ is shown.
  var useBuiltIns = function() {
    if (!offers.length) return;
    var froms = offers.map(function(o) { return payBuiltInFrom(o.def); }).filter(function(f, i, a) { return a.indexOf(f) === i; });
    var anyTyped = offers.some(function(o) { return payRateIsTyped(payBuiltInVersion(o.def)); });
    var parts = offers.map(function(o) {
      var p = o.plan, n = p.removeDates.length, v = payBuiltInVersion(o.def);
      var added = o.def.weekendDays.filter(function(d) { return (o.site.weekendDays || []).indexOf(d) === -1; });
      // A typed built-in version can put recorded legacy shifts under it
      // (payApplyBuiltIn is pure): say so, as saveRate and deleteRate do.
      var nt = payNeedsTypeDelta(o.site, payApplyBuiltIn(o.site, o.def, o.plan).rates, shifts);
      return o.site.name + (o.site.name.trim().toLowerCase() !== o.def.name.toLowerCase() ? " (built-in " + o.def.name + ")" : "") + ": " +
        (showComp ? versionSummary(v) : (payRateIsTyped(v) ? "built-in Day/Night rates (amounts hidden)" : "built-in rates (amounts hidden)")) + "." +
        (n ? " Removes the $0 version" + (n > 1 ? "s" : "") + " from " + p.removeDates.join(", ") + "." : "") +
        (p.later ? " Your version from " + p.later + " still applies from that date." : "") +
        (p.days && added.length ? " Also counts " + dayList(added) + " as " + (added.length > 1 ? "weekend days" : "a weekend day") + ", as the built-in rates do." : "") +
        (nt.count ? " " + plural(nt.count, "recorded shift") + " from " + fromLabel(nt.from) + " will need Day or Night and leave the totals until set." : "");
    });
    if (!confirm("Use the built-in rates" + (froms.length === 1 ? " from " + fromLabel(froms[0]) : "") + "?\n\n" + parts.join("\n\n") +
      "\n\nYour other rate versions stay as they are. " + (anyTyped ? "Recorded shifts keep their pay; any that need Day or Night leave the totals until set." : "Recorded shifts keep their own rates until you re-price them."))) return;
    var ids = offers.map(function(o) { return o.site.id; });
    // Sites whose weekend days this tap extends: their recorded weekday
    // call-ins on the added days (from the built-in start) become weekend
    // call-ins in the re-price that follows (payReclassShift).
    var reclass = {};
    offers.forEach(function(o) { if (o.plan.days) reclass[o.site.id] = { oldDays: (o.site.weekendDays || []).slice(), from: payBuiltInFrom(o.def) }; });
    updSites(function(l) {
      var fresh = payBuiltInOffers(l);
      return l.map(function(s) { var o = fresh.filter(function(x) { return x.site === s; })[0]; return o ? payApplyBuiltIn(s, o.def, o.plan) : s; });
    });
    setRepriceOffer({ siteIds: ids, reclass: reclass });
  };
  // "Use new <built-in> rates": one confirmed tap adds the built-in's typed
  // version to the site standing for it and re-dates the site's start-date
  // legacy version to the Original (utils.js payTypedPlan / payApplyTyped,
  // re-planned inside the updater). It never opens a re-price: recorded
  // shifts keep their pay, and the Oct-and-later ones are flagged instead.
  var useTypedRates = function() {
    if (!typedOffers.length) return;
    var parts = typedOffers.map(function(o) {
      var v = payBuiltInVersion(o.def), from = fromLabel(payBuiltInFrom(o.def)), p = o.plan;
      var origV = p.original ? o.site.rates.filter(function(r) { return r.id === p.original; })[0] : null;
      var inForce = rateInForce(o.site, payBuiltInFrom(o.def));
      return o.site.name + ": new Day/Night rates from " + from + (showComp ? " - " + versionSummary(v) : " (amounts hidden)") + ". " +
        (origV ? "Your " + o.site.name + " rates from " + from + (origV.label ? " (" + origV.label + ")" : "") + " become the Original rates." : (inForce ? "Your " + o.site.name + " rates from " + fromLabel(inForce.effective) + " still apply before " + from + "." : "")) +
        (p.removeDates.length ? " Removes the $0 version" + (p.removeDates.length > 1 ? "s" : "") + " from " + p.removeDates.join(", ") + "." : "") +
        (p.later ? " Your version from " + fromLabel(p.later) + " still applies from that date." : "") +
        " Recorded shifts keep their pay; " + (p.needType ? plural(p.needType, "shift") + " from " + from + " will need Day or Night and leave the totals until set." : "none of them needs a type.");
    });
    if (!confirm("Use the new rates?\n\n" + parts.join("\n\n"))) return;
    updSites(function(l) {
      var fresh = payTypedOffers(l, shifts);
      return l.map(function(s) { var o = fresh.filter(function(x) { return x.site === s; })[0]; return o ? payApplyTyped(s, o.def, o.plan) : s; });
    });
  };
  // Rows use the SAME name rule as the Totals split (utils.js paySiteNames):
  // current name for a live site, newest stored name for a deleted one.
  var siteNameMap = paySiteNames(shifts, sites);
  var shiftSiteName = function(s) { return (s.siteId && siteNameMap[s.siteId]) || s.siteName || "Deleted site"; };
  // Draft rules live in utils.js (payDraftEvent / payDraftRefresh / payDraftTrip)
  // where check.js pins them; these wrappers only supply "now" and the
  // draft's rate choice (payDraftRate).
  // The form opens at the top (Cancel, title and site/date chips visible);
  // closing it returns the list to where it was (e.g. the expanded month).
  var scrollBox = function() { return document.querySelector(".rvu-content"); };
  var formOpened = function() { var sc = scrollBox(); if (sc) { listScroll.current = sc.scrollTop; sc.scrollTop = 0; } };
  var formClosed = function() { setTimeout(function() { var sc = scrollBox(); if (sc) sc.scrollTop = listScroll.current; }, 0); };
  // The draft's rate choice (utils.js payDraftRate) drives the form: which
  // kind of form shows, which questions to ask and the quiet class where day
  // and night pay the same. orig defaults to the shift being edited.
  var rateOf = function(d, orig) { var o = orig === undefined ? editOrig : orig; return payDraftRate(d, siteFor(d.siteId, o || undefined), o).rates; };
  var reEvent = function(e, d) { return payDraftEvent(e, d.date, siteFor(d.siteId), todayLocal(), nowHM(), rateOf(d)); };
  var refresh = function(d) { return payDraftRefresh(d, siteFor(d.siteId), todayLocal(), nowHM(), rateOf(d)); };
  var trip = function(d, orig) { return payDraftTrip(d.date, siteFor(d.siteId, orig || undefined), rateOf(d, orig)); };
  // A new shift starts with nothing picked (no guessed site, day or type).
  var openNew = function() {
    if (showUndo) showUndo(null); // a pending Undo must not act behind an open form
    var id = "shift-" + Date.now().toString(36);
    var d = refresh({ id: id, siteId: sites.length === 1 ? sites[0].id : "", date: "", callHours: "", hoursSet: false, events: [], note: "", types: [], ciRows: [], id2: payDraftId2(id, shifts), savedTrips: [] });
    setEditOrig(null);
    setHoursOpen(false);
    setMoreOpen({});
    setDraftInit(JSON.stringify(d));
    setDraftBase("");
    setDraft(d);
    formOpened();
  };
  var openEdit = function(s, addCallIn) {
    if (showUndo) showUndo(null);
    var d = { ...payDraftFromShift(s, siteFor(s.siteId, s)), id2: payDraftId2(s.id, shifts) };
    // "+ Call-in" adds a blank row. Both the form with that row and the saved
    // shift without it count as unchanged (utils.js payDraftDirty): an
    // untouched row, or one added then removed, is not a change.
    var base = addCallIn ? JSON.stringify(d) : "";
    if (addCallIn) d = payShiftIsTyped(s) ? { ...d, ciRows: d.ciRows.concat([{ h: "", m: "" }]) } : { ...d, events: d.events.concat([trip(d, s)]) };
    setDraftInit(JSON.stringify(d));
    setDraftBase(base);
    setEditOrig(s);
    setHoursOpen(false);
    setMoreOpen({});
    setDraft(d);
    formOpened();
  };
  var closeDraft = function() {
    if (payDraftDirty(draft, draftInit, draftBase) && !confirm("Discard changes to this shift?")) return;
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
  var setCi = function(i, k, v) { setD(function(d) { var rows = (d.ciRows || []).slice(); rows[i] = { ...rows[i], [k]: v }; return { ...d, ciRows: rows }; }); };

  var draftSite = draft ? siteFor(draft.siteId) : null;
  var built = draft ? payShiftsFromDraft(draft, draftSite, editOrig, { shifts: shifts, today: today, sites: sites }) : null;
  var builtShifts = built ? built.shifts : [];
  var dispRates = draft ? payDraftRate(draft, draftSite, editOrig).rates : null;
  var typedForm = !!dispRates && payRateIsTyped(dispRates);
  var editFlagged = !!editOrig && payShiftNeedsType(editOrig, sites);

  var saveDraft = function() {
    if (savingRef.current || !built || !builtShifts.length) return;
    savingRef.current = true;
    var list = builtShifts, old = editOrig, wasFlagged = editFlagged;
    upd(function(prev) {
      var l = (prev.payShifts || []).slice();
      list.forEach(function(ns) {
        var at = -1;
        l.forEach(function(s, i) { if (s.id === ns.id) at = i; });
        if (at === -1) l.push(ns); else l[at] = ns;
      });
      return { ...prev, payShifts: l };
    });
    var name = list[0].siteName ? " - " + list[0].siteName : "";
    var typeNames = payShiftIsTyped(list[0]) ? list.map(function(s) { return s.rates.shiftType.label; }).join(" + ") : "";
    var extra = old ? list.filter(function(s) { return s.id !== old.id; }).map(function(s) { return s.id; }) : list.map(function(s) { return s.id; });
    if (showUndo) showUndo(old
      ? { type: "pay", remove: extra, restore: [old], message: (wasFlagged && typeNames ? "Set to " + typeNames : "Shift updated") + name }
      : { type: "pay", remove: extra, restore: [], message: (list.length > 1 ? list.length + " shifts saved" : "Shift saved") + name });
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
    if (payShiftIsTyped(shift)) {
      var t = shift.rates.shiftType;
      if (l.kind === "flat") return t.label + " shift (" + t.hours + "h flat)";
      if (l.kind === "stipend") return t.stipendLabel || "Stipend";
      if (l.trips === 0) return "No call-ins";
      if (!l.met) return "Call-in " + payFmtHM(l.minutes) + DOT + "under " + payFmtHM(l.threshold) + " - not paid";
      return "Call-in " + payFmtHM(l.minutes) + " \u00D7 " + paid(l.hourly) + "/hr";
    }
    var r = shift.rates;
    if (l.kind === "stipend") {
      if (l.hours === r.stipendHours) return "Stipend (full " + r.stipendHours + "h shift)";
      if (l.hours > r.stipendHours && l.hours % r.stipendHours === 0) return "Stipend (" + l.hours + "h = " + (l.hours / r.stipendHours) + " \u00D7 " + r.stipendHours + "h shift)";
      return l.hours > r.stipendHours ? "Stipend (" + l.hours + "h at the " + r.stipendHours + "h rate)" : "Stipend (" + l.hours + " of " + r.stipendHours + "h)";
    }
    var ev = shift.events[l.ev], pre = shift.events.length > 1 ? "Call-in " + (l.ev + 1) + ": " : "";
    if (l.kind === "fee") return pre + "Call-in fee (" + (ev.cls === "we" || ev.cls === "hol" ? "weekend/holiday" : "weekday") + ")";
    if (!l.paid) return pre + ev.hours + "h weekday daytime - no hourly";
    return pre + (l.hours > ev.hours ? ev.hours + "h, paid " + l.hours + "h minimum" : l.hours + "h") + " \u00D7 " + paid(r.hourly) + "/hr";
  };
  // One row line for a shift of either kind (Recent and the month lists).
  var rowDetail = function(s, p) {
    if (payShiftIsTyped(s)) {
      var t = s.rates.shiftType, ci = p ? p.lines.filter(function(l) { return l.kind === "callIn"; })[0] : null;
      var part = !t.callIn ? t.hours + "h" : ci && ci.trips > 0 ? payFmtHM(ci.minutes) + " in" + DOT + (ci.met ? payFmtHM(ci.threshold) + " met" : "under " + payFmtHM(ci.threshold)) : "quiet night";
      return part + DOT + (p ? paid(p.total) : "?");
    }
    var n = (s.events || []).length;
    return s.callHours + "h" + DOT + n + " call-in" + (n === 1 ? "" : "s") + DOT + (p ? paid(p.total) : "?");
  };
  var typeTag = function(s) { return payShiftIsTyped(s) ? DOT + s.rates.shiftType.label : ""; };
  var FLAG_TAG = <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "rgba(245,158,11,0.15)", color: "var(--accent-amber)", fontFamily: "inherit", whiteSpace: "nowrap" }}>Set Day or Night</span>;
  // Shift list: newest shift date first, then most recently added. Shows the
  // newest 5 unless "Show all" is on - every shift must stay reachable. The
  // Day-or-Night card's Review shows only the shifts that need a type.
  var sortedShifts = shifts.map(function(s, i) { return { s: s, i: i }; })
    .sort(function(a, b) { return a.s.date < b.s.date ? 1 : a.s.date > b.s.date ? -1 : b.i - a.i; })
    .map(function(x) { return x.s; });
  var flaggedList = sortedShifts.filter(function(s) { return payShiftNeedsType(s, sites); });
  var recent = flagOnly && flaggedList.length ? flaggedList : allShifts ? sortedShifts : sortedShifts.slice(0, 5);
  var reviewFlagged = function() { setFlagOnly(true); setAllShifts(true); };

  // ---- Re-pricing (utils.js payShiftStale / payRepriceShift / payReclassShift) ----
  // fixShift: the shift re-priced at the version in force and, for a site
  // whose weekend days "Use built-in rates" just extended, re-classified;
  // null when nothing changes. Both kinds; re-pricing never crosses kinds.
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
  var dropOffer = function(siteId) {
    setRepriceOffer(function(o) { var rest = o ? o.siteIds.filter(function(id) { return id !== siteId; }) : []; return rest.length ? { siteIds: rest, reclass: o.reclass } : null; });
  };
  var repriceSite = function(site) {
    var rc = reclassFor(site);
    var stale = staleFor(site);
    if (!stale.length) { dropOffer(site.id); return; }
    var sum = payRepriceSummary(stale.map(function(x) { return { before: x, after: fixShift(x, site, rc) || x }; }));
    var msg = "Re-price " + plural(stale.length, "shift") + " at " + site.name + " (" + dateRange(stale) + ") with the rate version in force for each date?" +
      (sum.lenChange ? " Full-length shifts take the new shift length; partial shifts keep their hours." : "") +
      (sum.moved ? " " + plural(sum.moved, "call-in") + " on " + (sum.moved === 1 ? "a new weekend day becomes a weekend call-in." : "new weekend days become weekend call-ins.") : "") +
      (showComp ? " Their total changes from " + money(sum.before / 100) + " to " + money(sum.after / 100) + "." : "") + " You can Undo.";
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
    return payShiftStale(s, siteById(s.siteId)) ? <span style={{ marginLeft: 6, fontSize: 10, padding: "1px 6px", borderRadius: 8, background: "rgba(245,158,11,0.15)", color: "var(--accent-amber)", fontFamily: "inherit", whiteSpace: "nowrap" }}>Rates changed</span> : null;
  };

  var danger = { color: "var(--accent-red)", border: "1px solid rgba(239,68,68,0.3)" };
  var primary = { border: "none", background: "#0ea5e9", color: "#fff" };
  var amber = "var(--accent-amber)";

  var eyeBtn = <CompEye showComp={showComp} toggleComp={toggleComp} />;
  var chip = function(on, label, onClick, key, extra) {
    return (<button key={key} onClick={onClick} aria-pressed={on} style={btn({ flex: 1, padding: "0 6px", fontSize: 12, border: on ? "1px solid rgba(14,165,233,0.6)" : "1px solid var(--border-default)", background: on ? "rgba(14,165,233,0.15)" : "transparent", color: on ? "var(--accent-sky)" : "var(--text-muted)", ...(extra || {}) })}>{label}</button>);
  };
  var probLine = function(p, k) {
    return (<div key={k} style={{ fontSize: 11, lineHeight: 1.5, marginTop: 4, color: p.block ? "var(--accent-red)" : amber }}>{probText(p)}</div>);
  };
  var pick = function(on) { return { border: on ? "2px solid #0ea5e9" : "1px solid var(--border-default)", background: on ? "rgba(14,165,233,0.12)" : "transparent" }; };
  var payCard = function(shift, p, title) {
    return (<div key={shift.id} style={{ marginTop: title ? 8 : 0 }}>
      {title && <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-bright)" }}>{title}</div>}
      {p.lines.map(function(l, k) {
        return (<div key={k} style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, padding: "4px 0", color: l.paid ? "var(--text-primary)" : "var(--text-faint)" }}>
          <span>{lineLabel(l, shift)}</span><span style={{ fontFamily: "JetBrains Mono", flexShrink: 0 }}>{paid(l.amount)}</span>
        </div>);
      })}
    </div>);
  };

  // The shift form. Legacy rates (R2): tap a site, tap the day, tick "I went
  // in", type the hours - the Total updates live; it asks only what changes
  // pay (payAsksDayNight, payMidnightAsks). Typed (Day/Night) rates: a chip
  // per shift type (both chips = a Day and a Night on one date when creating
  // or setting a flagged shift), and call-in rows (hours + minutes boxes)
  // under a type that pays time in, with the running total and the
  // threshold status. A flagged legacy shift opens as "Set Day or Night".
  var renderForm = function() {
    var d = draft;
    var site = draftSite, r = dispRates;
    var probsOf = function(ev) { return built.problems.filter(function(p) { return p.ev === ev; }); };
    var topBlocked = probsOf(-1).some(function(p) { return p.code === "site" || p.code === "date" || p.code === "rates"; });
    // ciLong (call-ins longer than the shift) shows in the Call-ins card.
    var shiftProbs = probsOf(-1).filter(function(p) { return !(p.code === "hours" && topBlocked) && !(p.code === "noType" && topBlocked) && p.code !== "ciLong"; });
    var ciLongProbs = probsOf(-1).filter(function(p) { return p.code === "ciLong"; });
    var yesterday = addDaysYMD(today, -1);
    var feeOn = function(ymd) { return r ? (payWeOrHol(ymd, site) ? r.callInWeekendHoliday : r.callInWeekday) : 0; };
    var siteSummary = function(x) {
      if (payRateIsTyped(x)) return payRateTypes(x).map(payTypePreview).join(DOT);
      return cash(x.stipend) + " / " + x.stipendHours + "h shift" + (x.stipendHours < PAY_LONG_SHIFT_HOURS ? " (" + PAY_LONG_SHIFT_HOURS + "h wknd/hol)" : "") + DOT + "call-in " + cash(x.callInWeekday) +
        (x.callInWeekendHoliday !== x.callInWeekday ? " (" + cash(x.callInWeekendHoliday) + " wknd/hol)" : "") + DOT +
        cash(x.hourly) + "/hr" + (x.hourlyMinHours > 0 ? ", " + x.hourlyMinHours + "h min" : "") + (x.hourlyWeekdayDay ? "" : ", no hourly weekdays 7am-5pm");
    };
    // A deleted site's weekend days are unknown: name only a holiday there.
    var dayKind = function(ymd) { var h = payHolidayName(ymd); return h ? h : site && site.deleted ? "" : payWeOrHol(ymd, site) ? "weekend" : "weekday"; };
    var ratesWord = r ? (r.effective === null ? "Original rates" : "rates from " + fromLabel(r.effective)) + (r.label ? " (" + r.label + ")" : "") : "";
    // A flagged shift moved onto legacy rates (another site or an earlier
    // day) is a plain legacy edit again: the typed-only words go with typedForm.
    var title = editFlagged && typedForm ? "Set Day or Night" : editOrig ? "Edit shift" : "New shift";
    var moved = !!editOrig && (editOrig.siteId !== d.siteId || editOrig.date !== d.date);
    var header = (<div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <button onClick={closeDraft} style={S.backBtn}>Cancel</button>
      <h1 style={{ ...S.title, marginBottom: 0, flex: 1 }}>{title}</h1>
      {eyeBtn}
    </div>);
    var siteCard = (<div style={S.card}>
      <div style={S.fieldLabel}>Site</div>
      {site && site.deleted && <div style={{ padding: "10px 12px", marginTop: 6, borderRadius: 10, ...pick(true) }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--accent-sky)" }}>{site.name + " (deleted)"}</div>
        <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.5 }}>This site was deleted. The shift keeps the rates it was saved with; changing its day needs a current site.</div>
      </div>}
      {sites.map(function(s) {
        var on = d.siteId === s.id;
        var sr = rateInForce(s, isYMD(d.date) ? d.date : today);
        return (<button key={s.id} onClick={function() { setD(function(x) { return refresh({ ...x, siteId: s.id }); }); }} style={{ display: "block", width: "100%", textAlign: "left", minHeight: 56, padding: "10px 12px", marginTop: 6, borderRadius: 10, cursor: "pointer", ...pick(on) }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: on ? "var(--accent-sky)" : "var(--text-bright)" }}>{s.name}</div>
          <div style={{ fontSize: 11, marginTop: 2, lineHeight: 1.4, color: sr ? "var(--text-muted)" : amber }}>{sr ? maskText(siteSummary(sr)) : "No rates for this date"}</div>
        </button>);
      })}

      <div style={{ ...S.fieldLabel, marginTop: 14 }}>Day on call (the day the shift started)</div>
      <div style={{ display: "flex", gap: 6 }}>
        {chip(d.date === yesterday, "Yesterday" + DOT + dayLabel(yesterday), function() { setD(function(x) { return refresh({ ...x, date: yesterday }); }); }, "y")}
        {chip(d.date === today, "Today" + DOT + dayLabel(today), function() { setD(function(x) { return refresh({ ...x, date: today }); }); }, "t")}
      </div>
      <input type="date" value={d.date} onChange={function(e) { var v = e.target.value; setD(function(x) { return refresh({ ...x, date: v }); }); }} style={{ ...S.dateInput, marginTop: 6 }} />
      {isYMD(d.date) && r && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>
        {dayLabel(d.date) + (dayKind(d.date) ? DOT + dayKind(d.date) : "") + DOT + ratesWord + (built.ratesFrom === "kept" ? ", saved with this shift" : "")}
        {editOrig && built.ratesFrom === "inForce" && !editFlagged ? (d.reprice ? " - updated to the current rates." : moved ? " - updated for the new site/day." : "") : ""}
      </div>}
      {editOrig && built.ratesFrom === "kept" && site && !site.deleted && payShiftStale(editOrig, site) && <div style={{ marginTop: 8, padding: 10, borderRadius: 8, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.06)", fontSize: 11, color: "var(--text-primary)", lineHeight: 1.5 }}>
        {"This shift was saved with the version from " + payVersionDateLabel(editOrig.rates) + "; the version from " + payVersionDateLabel(rateInForce(site, d.date)) + " is now in force for its date."}
        <button onClick={useCurrentRates} style={btn({ display: "block", marginTop: 6, color: amber, border: "1px solid rgba(245,158,11,0.4)" })}>Use current rates</button>
      </div>}
    </div>);
    var noteCard = (<div style={S.card}>
      <div style={S.fieldLabel}>Note (optional - no patient info)</div>
      <input type="text" value={d.note} onChange={function(e) { var v = e.target.value; setD(function(x) { return { ...x, note: v }; }); }} style={{ ...S.searchInput, fontSize: 13, padding: "10px 12px" }} />
    </div>);
    var pays = builtShifts.map(function(s) { return { s: s, p: computeShiftPay(s) }; }).filter(function(x) { return !!x.p; });
    var wasPay = editFlagged ? computeShiftPay(editOrig) : null;
    var allTyped = builtShifts.length > 0 && builtShifts.every(payShiftIsTyped);
    var saveLabel = editOrig
      ? (editFlagged && allTyped ? "Save as " + builtShifts.map(function(s) { return s.rates.shiftType.label; }).join(" + ") : "Save changes")
      : builtShifts.length > 1 ? "Save " + builtShifts.length + " shifts" + DOT + builtShifts[0].siteName + DOT + dayLabel(builtShifts[0].date)
      : builtShifts.length ? "Save " + builtShifts[0].siteName + DOT + dayLabel(builtShifts[0].date) + typeTag(builtShifts[0]) : "Save shift";
    var footer = (<div>
      {pays.length > 0 && <div style={S.card}>
        <div style={S.cardLabel}>Pay</div>
        <div style={{ marginTop: 6 }}>{pays.map(function(x) { return payCard(x.s, x.p, pays.length > 1 ? x.s.rates.shiftType.label + " shift" : ""); })}</div>
      </div>}
      <div style={{ position: "sticky", bottom: 0, zIndex: 5, background: "var(--bg-base)", borderTop: "1px solid var(--border-default)", padding: "10px 0 12px", marginTop: 4 }}>
        {wasPay && <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, padding: "0 2px 4px", fontSize: 11, color: "var(--text-faint)" }}>
          <span>Was (old rates, not counted)</span><span style={{ fontFamily: "JetBrains Mono" }}>{paid(wasPay.total)}</span>
        </div>}
        <button onClick={function() { if (!showComp) toggleComp(); }} style={{ width: "100%", minHeight: 36, display: "flex", justifyContent: "space-between", alignItems: "baseline", gap: 8, background: "none", border: "none", padding: "0 2px 8px", cursor: showComp ? "default" : "pointer" }}>
          <span style={{ fontSize: 13, color: "var(--text-muted)" }}>{pays.length ? (pays.length > 1 ? "Total (" + pays.map(function(x) { return x.s.rates.shiftType.label; }).join(" + ") + ")" : "Total") + (showComp ? "" : " (tap to show)") : "Total - fill in the items above"}</span>
          <span style={{ fontSize: 20, fontWeight: 700, fontFamily: "JetBrains Mono", color: "var(--accent-green)" }}>{pays.length ? paid(built.total) : "-"}</span>
        </button>
        <button onClick={saveDraft} disabled={!builtShifts.length} style={btn({ ...primary, width: "100%", minHeight: 50, fontSize: 15, opacity: builtShifts.length ? 1 : 0.4 })}>{saveLabel}</button>
      </div>
      {editOrig && <button onClick={deleteShift} style={btn({ ...danger, width: "100%", marginTop: 10 })}>Delete shift</button>}
    </div>);

    if (typedForm) {
      // ---- Typed (Day/Night) shift ----
      // The chips come from the typed version in force at a live site (a
      // saved shift's kept copy holds only its own type, so Night -> Day is one
      // tap); a type that version no longer has stays offered while kept.
      // Pricing, the picked keys and the Call-ins card stay on r.
      var rif = site && !site.deleted ? rateInForce(site, d.date) : null;
      var chipSrc = payRateIsTyped(rif) ? rif : r;
      var types = payRateTypes(chipSrc);
      // The edited shift's own type stays a chip while its site and date are
      // unchanged, even after the version in force renamed or dropped its key
      // - then marked "(saved rates)", as is the only chip at a deleted site
      // or where no typed version is in force.
      var keptType = editOrig && payShiftIsTyped(editOrig) && !moved ? editOrig.rates.shiftType : null;
      if (keptType && !types.some(function(t) { return t.key === keptType.key; })) types = types.concat([keptType]);
      var picked = payDraftTypes(d, r);
      var typeOf = function(k) { return payTypeByKey(chipSrc, k) || payTypeByKey(r, k) || (keptType && keptType.key === k ? keptType : null); };
      var ciType = picked.map(function(k) { return payTypeByKey(r, k); }).filter(function(t) { return !!t && !!t.callIn; })[0] || null;
      var canBoth = !editOrig || editFlagged;
      var keptCopy = built.ratesFrom === "kept";
      var savedTag = function(t) { return (keptCopy && chipSrc === r) || (keptType && t.key === keptType.key && !payTypeByKey(chipSrc, t.key)) ? " (saved rates)" : ""; };
      var pickType = function(k) {
        var cur = Array.isArray(d.types) ? d.types.slice() : [], i = cur.indexOf(k), t = typeOf(k);
        if (i !== -1) cur.splice(i, 1);
        else {
          if (!canBoth) cur = [];
          if (t && t.callIn) cur = cur.filter(function(c) { var o = typeOf(c); return !(o && o.callIn); });   // one picked type may take call-ins
          cur.push(k);
        }
        var rows = d.ciRows || [], stillCi = cur.some(function(c) { var o = typeOf(c); return !!(o && o.callIn); });
        var losesCi = !!ciType && !stillCi && rows.length > 0 && !!editOrig && payShiftIsTyped(editOrig);
        if (losesCi && !confirm("Remove the " + plural(rows.length, "call-in") + " from this shift?")) return;
        setD(function(x) { return { ...x, types: cur, ciRows: losesCi ? [] : x.ciRows }; });
      };
      var rows = d.ciRows || [];
      var rowProbs = rows.map(payCiRowProblem);
      var ciSum = ciType ? payCallInSummary(rows.map(function(row) { return payHM(row.h, row.m); }).filter(function(m) { return m !== null; }), ciType.callIn) : null;
      var running = !ciType ? null : rowProbs.some(Boolean) ? { text: "Fix the call-in times above.", color: amber }
        : ciSum.trips === 0 ? { text: "No call-ins - quiet night.", color: "var(--text-muted)" }
        : !ciSum.met ? { text: "Total in " + payFmtHM(ciSum.minutes) + DOT + "under " + payFmtHM(ciSum.threshold) + " - not paid", color: "var(--text-muted)" }
        : { text: "Total in " + payFmtHM(ciSum.minutes) + DOT + payFmtHM(ciSum.threshold) + " met - all " + payFmtHM(ciSum.minutes) + " paid", color: "var(--accent-green)" };
      var savedMin = (d.savedTrips || []).reduce(function(a, t) { return a + (t.minutes || 0); }, 0);
      var savedText = (d.savedTrips || []).map(function(t) { return payFmtHM(t.minutes) + " on " + dayLabel(t.date); }).join(", ");
      var dayOnly = picked.length > 0 && !ciType;
      return (<div style={S.page}>
        {header}
        {editFlagged && <div style={{ ...S.card, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.06)" }}>
          <div style={{ fontSize: 12, fontWeight: 700, color: amber }}>Logged before Day/Night shifts</div>
          <div style={{ fontSize: 12, color: "var(--text-primary)", marginTop: 4, lineHeight: 1.5 }}>{dayLabel(editOrig.date) + DOT + editOrig.callHours + "h" + DOT + plural((editOrig.events || []).length, "call-in") + (savedMin ? " (" + payFmtHM(savedMin) + ")" : "")}</div>
          <div style={{ fontSize: 12, color: "var(--text-primary)", marginTop: 4, lineHeight: 1.5 }}>{"Pick Day, Night or both. It is re-priced with the " + ratesWord + "."}</div>
        </div>}
        {siteCard}
        <div style={S.card}>
          <div style={S.fieldLabel}>Shift</div>
          <div style={{ display: "flex", gap: 6, flexWrap: types.length > 2 ? "wrap" : "nowrap" }}>
            {types.map(function(t) { return chip(picked.indexOf(t.key) !== -1, t.label + DOT + t.hours + "h" + savedTag(t), function() { pickType(t.key); }, t.key, { minHeight: 44, minWidth: types.length > 2 ? "45%" : 0 }); })}
          </div>
          {canBoth && types.length > 1 && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>Tap both for a day + night (two shifts).</div>}
          {types.some(function(t) { return !!t.callIn; }) && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>A night is dated by the day it starts (Fri night = Fri).</div>}
          {shiftProbs.map(probLine)}
        </div>
        {ciType && <div style={S.card}>
          <div style={S.cardLabel}>Call-ins</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>{maskText(money(ciType.callIn.hourly)) + "/hr for time in" + (ciType.callIn.thresholdMinutes > 0 ? ", once the night's total reaches " + payFmtHM(ciType.callIn.thresholdMinutes) + ". Under " + payFmtHM(ciType.callIn.thresholdMinutes) + " pays $0." : ".")}</div>
          {editFlagged && (d.savedTrips || []).length > 0 && <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.5 }}>{"Saved with this shift: " + savedText}</div>
            <button onClick={function() { setD(function(x) { return payDraftUseSaved(x); }); }} style={btn({ width: "100%", marginTop: 6, color: "var(--accent-sky)", border: "1px solid rgba(14,165,233,0.3)" })}>{"Use saved call-ins (" + payFmtHM(savedMin) + ")"}</button>
          </div>}
          {rows.map(function(row, i) {
            var probs = probsOf(i);
            return (<div key={i} style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--border-default)" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                <div style={{ flex: 1, fontSize: 13, fontWeight: 700, color: "var(--text-bright)" }}>{"Call-in " + (i + 1)}</div>
                <button onClick={function() { setD(function(x) { return { ...x, ciRows: (x.ciRows || []).filter(function(y, j) { return j !== i; }) }; }); }} style={btn(danger)}>Remove</button>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 6 }}>
                <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} aria-label={"Call-in " + (i + 1) + " hours"} value={row.h} onChange={function(e) { setCi(i, "h", e.target.value); }} placeholder="0" style={{ ...S.numberInput, width: 64, fontSize: 18, textAlign: "center" }} />
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>h</span>
                <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} aria-label={"Call-in " + (i + 1) + " minutes"} value={row.m} onChange={function(e) { setCi(i, "m", e.target.value); }} placeholder="00" style={{ ...S.numberInput, width: 64, fontSize: 18, textAlign: "center" }} />
                <span style={{ fontSize: 12, color: "var(--text-muted)" }}>min</span>
              </div>
              {probs.map(probLine)}
            </div>);
          })}
          {running && <div style={{ fontSize: 12, fontWeight: 600, color: running.color, marginTop: 10 }}>{running.text}</div>}
          {ciLongProbs.map(probLine)}
          <button onClick={function() { setD(function(x) { return { ...x, ciRows: (x.ciRows || []).concat([{ h: "", m: "" }]) }; }); }} style={btn({ width: "100%", marginTop: 10, color: "var(--accent-sky)", border: "1px solid rgba(14,165,233,0.3)" })}>+ Add call-in</button>
        </div>}
        {dayOnly && editFlagged && savedMin > 0 && <div style={{ ...S.card, fontSize: 12, color: amber, lineHeight: 1.5 }}>{"The saved call-in (" + payFmtHM(savedMin) + ") is not paid on a " + picked.map(function(k) { return payTypeByKey(r, k).label; }).join(" + ") + " shift and is not kept."}</div>}
        {noteCard}
        {footer}
      </div>);
    }

    // ---- Legacy shift (unchanged rules) ----
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
    var rateLine = function(e) {
      if (!e.cls || !isYMD(e.date)) return "";
      if (e.clsSet) return "Rate type you picked: " + { wd: "Day", wn: "Night", we: "Weekend", hol: "Holiday" }[e.cls];
      if (site && site.deleted && e.cls !== "hol") return "Saved rate type: " + { wd: "Day", wn: "Night", we: "Weekend" }[e.cls];
      if (e.cls === "hol") return "Holiday rates (" + payHolidayName(e.date) + ")";
      if (e.cls === "we") return "Weekend rates (" + DAY_FULL[ymdWeekday(e.date)] + ")";
      if (r && r.hourlyWeekdayDay) return "Weekday rates (day and night pay the same)";
      return e.cls === "wd" ? "Weekday daytime rates (no hourly)" : "Weeknight rates";
    };
    return (<div style={S.page}>
      {header}
      {siteCard}
      <div style={S.card}>
        {r && lenChoices && <div>
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
        {r && !lenChoices && <div>
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
        {!r && shiftProbs.length === 0 && <div style={{ fontSize: 12, color: "var(--text-faint)" }}>Pick a site and a day.</div>}
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
                return (<button key={o[0]} onClick={function() { setRel(i, o[0]); }} style={btn({ display: "block", width: "100%", textAlign: "left", marginTop: 6, ...pick(on), color: on ? "var(--accent-sky)" : "var(--text-primary)" })}>{o[1] + DOT + dayLabel(o[2]) + DOT + maskText(cash(feeOn(o[2]))) + " fee"}</button>);
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
            <button onClick={function() { if (!forced) setMoreOpen({ ...moreOpen, [i]: !moreOpen[i] }); }} style={{ background: "none", border: "none", padding: "8px 0", minHeight: 36, color: forced ? "var(--text-faint)" : "var(--accent-sky)", fontSize: 12, fontWeight: 600, cursor: forced ? "default" : "pointer" }}>{more ? "Fewer options" : "More options"}</button>
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
              {pickType && <div style={{ fontSize: 11, color: amber, marginBottom: 6, lineHeight: 1.5 }}>This site was deleted, so its weekend days are unknown - pick the rate type for this call-in.</div>}
              <div style={{ display: "flex", gap: 6 }}>
                {CLS.map(function(c) { return chip(e.cls === c[0], c[1], function() { setEv(i, function(x) { x.cls = c[0]; x.clsSet = true; return x; }); }, c[0]); })}
              </div>
              {e.clsSet && <button onClick={function() { setEv(i, function(x, dd) { x.clsSet = false; return reEvent(x, dd); }); }} style={btn({ minHeight: 32, padding: "0 10px", fontSize: 11, marginTop: 6 })}>Use auto</button>}
            </div>}
            {evProbs.map(probLine)}
          </div>);
        })}
        {went && <button onClick={function() { setD(function(x) { return { ...x, events: x.events.concat([trip(x)]) }; }); }} style={btn({ width: "100%", marginTop: 10, color: "var(--accent-sky)", border: "1px solid rgba(14,165,233,0.3)" })}>+ Went in again</button>}
      </div>}
      {noteCard}
      {footer}
    </div>);
  };

  // ---- The rates editor forms (inside the site's block of the rates card) ----
  var renderLegacyRateForm = function(s) {
    return (<div style={{ marginTop: 10, padding: 12, borderRadius: 10, border: "1px solid rgba(14,165,233,0.3)", background: "var(--bg-inset)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-sky)", marginBottom: 10 }}>{rateForm.editing ? (rateForm.f.original ? "Edit the Original rates" : "Edit rate version") : "New rates - " + s.name}</div>
      {!rateForm.editing && styleToggle(s)}
      {rateForm.f.original
        ? <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>{"Original rates - apply before " + (firstDated(s) ? fromLabel(firstDated(s).effective) : "any dated version") + "."}</div>
        : <div style={S.fieldGroup}><label style={S.fieldLabel}>Starts on</label><input type="date" value={rateForm.f.effective} onChange={function(e) { setField("effective", e.target.value); }} style={S.dateInput} /></div>}
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
      {formErr && <div style={{ fontSize: 11, color: amber, marginBottom: 8, lineHeight: 1.5 }}>{formErr}</div>}
      {rateForm.editing && <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 8, lineHeight: 1.5 }}>Editing a version does not change shifts already recorded; after saving you'll be offered a re-price.</div>}
      <div style={{ display: "flex", gap: 8 }}>
        <button onClick={saveRate} disabled={!formRate} style={btn({ ...primary, flex: 1, opacity: formRate ? 1 : 0.4 })}>Save</button>
        <button onClick={function() { setRateForm(null); }} style={btn()}>Cancel</button>
      </div>
    </div>);
  };
  var firstDated = function(s) { return s.rates.filter(function(r) { return isYMD(r.effective); }).sort(byStartDesc).reverse()[0] || null; };
  var styleToggle = function(s) {
    return (<div style={{ marginBottom: 10 }}>
      <div style={S.fieldLabel}>Rate style</div>
      <div style={{ display: "flex", gap: 6 }}>
        {chip(rateForm.kind === "typed", "Shift types", function() { switchStyle(s, "typed"); }, "typed")}
        {chip(rateForm.kind === "legacy", "Stipend + call-in fees", function() { switchStyle(s, "legacy"); }, "legacy")}
      </div>
    </div>);
  };
  var renderTypedRateForm = function(s) {
    var f = rateForm.f, err = typedRes && typedRes.errors.length ? typedRes.errors[0] : "";
    var setT = function(i, k, v) { setForm(function(ff) { return { ...ff, types: ff.types.map(function(t, j) { return j === i ? { ...t, [k]: v } : t; }) }; }); };
    var numIn = function(i, k, width, ph) { return <input type="text" inputMode="decimal" value={f.types[i][k]} onChange={function(e) { setT(i, k, e.target.value); }} placeholder={ph || "0"} style={{ ...S.numberInput, width: width || 110 }} />; };
    return (<div style={{ marginTop: 10, padding: 12, borderRadius: 10, border: "1px solid rgba(14,165,233,0.3)", background: "var(--bg-inset)" }}>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--accent-sky)", marginBottom: 10 }}>{rateForm.editing ? (f.original ? "Edit the Original rates" : "Edit rates") : "New rates - " + s.name}</div>
      {!rateForm.editing && styleToggle(s)}
      {f.original
        ? <div style={{ fontSize: 11, color: "var(--text-muted)", marginBottom: 10, lineHeight: 1.5 }}>{"Original rates - apply before " + (firstDated(s) ? fromLabel(firstDated(s).effective) : "any dated version") + "."}</div>
        : <div style={S.fieldGroup}><label style={S.fieldLabel}>Starts on</label><input type="date" value={f.effective} onChange={function(e) { setField("effective", e.target.value); }} style={S.dateInput} /></div>}
      <div style={S.fieldGroup}><label style={S.fieldLabel}>Label (optional)</label><input type="text" value={f.label} onChange={function(e) { setField("label", e.target.value); }} style={{ ...S.searchInput, fontSize: 13, padding: "10px 12px" }} /></div>
      <div style={S.fieldLabel}>Shift types</div>
      {f.types.map(function(t, i) {
        var parsed = payTypeFromForm(t);
        return (<div key={t.key} style={{ marginTop: 8, padding: 10, borderRadius: 8, border: "1px solid var(--border-default)" }}>
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <input type="text" value={t.label} onChange={function(e) { setT(i, "label", e.target.value); }} placeholder="Name (e.g. Day)" style={{ ...S.searchInput, flex: 1, fontSize: 13, padding: "10px 12px" }} />
            {f.types.length > 1 && <button onClick={function() { setForm(function(ff) { return { ...ff, types: ff.types.filter(function(y, j) { return j !== i; }) }; }); }} style={btn(danger)}>Remove</button>}
          </div>
          <div style={{ display: "flex", gap: 12, marginTop: 8, flexWrap: "wrap" }}>
            <div><div style={S.fieldLabel}>Hours</div>{numIn(i, "hours", 72, "12")}</div>
            <div><div style={S.fieldLabel}>Flat $</div>{numIn(i, "flat", 120)}</div>
            <div><div style={S.fieldLabel}>Stipend $</div>{numIn(i, "stipend", 100)}</div>
          </div>
          {payAmountText(t.stipend) > 0 && <div style={{ marginTop: 8 }}><div style={S.fieldLabel}>Stipend name (prints on its pay line)</div><input type="text" value={t.stipendLabel} onChange={function(e) { setT(i, "stipendLabel", e.target.value); }} placeholder="e.g. Trauma" style={{ ...S.searchInput, fontSize: 13, padding: "10px 12px" }} /></div>}
          <label style={{ display: "flex", alignItems: "center", gap: 10, minHeight: 44, fontSize: 13, color: "var(--text-primary)", cursor: "pointer", marginTop: 4 }}>
            <input type="checkbox" checked={!!t.ci} onChange={function(e) { setT(i, "ci", e.target.checked); }} style={{ width: 20, height: 20 }} />
            Pays time in the hospital
          </label>
          {t.ci && <div style={{ paddingLeft: 4 }}>
            <div style={{ display: "flex", gap: 12, alignItems: "flex-end", flexWrap: "wrap" }}>
              <div><div style={S.fieldLabel}>$/hr</div>{numIn(i, "hourly", 110)}</div>
              <div>
                <div style={S.fieldLabel}>Paid once in</div>
                <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} aria-label="Threshold hours" value={t.thrH} onChange={function(e) { setT(i, "thrH", e.target.value); }} placeholder="0" style={{ ...S.numberInput, width: 56, textAlign: "center" }} />
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>h</span>
                  <input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={2} aria-label="Threshold minutes" value={t.thrM} onChange={function(e) { setT(i, "thrM", e.target.value); }} placeholder="00" style={{ ...S.numberInput, width: 56, textAlign: "center" }} />
                  <span style={{ fontSize: 12, color: "var(--text-muted)" }}>min</span>
                </div>
              </div>
            </div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4, lineHeight: 1.5 }}>Counted across the night: the trips are added up and paid in full once the total reaches this. 0:00 = paid from the first minute.</div>
          </div>}
          <div style={{ fontSize: 12, color: "var(--text-primary)", fontFamily: "JetBrains Mono", marginTop: 8, lineHeight: 1.5 }}>{payTypePreview(parsed)}</div>
        </div>);
      })}
      <button onClick={function() { setForm(function(ff) { return { ...ff, types: ff.types.concat([{ key: payNewTypeKey(), label: "", hours: "", flat: "", stipend: "", stipendLabel: "", ci: false, hourly: "", thrH: "", thrM: "" }]) }; }); }} style={btn({ width: "100%", marginTop: 10, color: "var(--accent-sky)", border: "1px solid rgba(14,165,233,0.3)" })}>+ Add shift type</button>
      {err && <div style={{ fontSize: 11, color: amber, marginTop: 8, lineHeight: 1.5 }}>{err}</div>}
      {rateForm.editing && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8, lineHeight: 1.5 }}>Renaming a type keeps its place; recorded shifts change only through the re-price you'll be offered after saving.</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={saveRate} disabled={!typedRes || !typedRes.version} style={btn({ ...primary, flex: 1, opacity: typedRes && typedRes.version ? 1 : 0.4 })}>Save</button>
        <button onClick={function() { setRateForm(null); }} style={btn()}>Cancel</button>
      </div>
    </div>);
  };
  // Version row status (d1): dates by string slicing, never new Date().
  var versionStatus = function(r, cur, newer) {
    if (r.effective === null) return r === cur ? "Original - current" : "Original - before " + (newer ? payVersionDateLabel(newer) : "");
    if (r === cur) return "From " + payDateLabel(r.effective) + " - current";
    if (payEffKey(r) > today) return "From " + payDateLabel(r.effective) + " - starts later";
    return "From " + payDateLabel(r.effective) + " - replaced " + (newer ? payVersionDateLabel(newer) : "");
  };
  // One split bucket line (utils.js payBucketInLine: Home, the year block and
  // the expanded month share the words).
  var nightsLine = payBucketInLine;
  var countsLine = function(x) { return x.split.map(function(b) { return b.label + " " + b.shifts; }).concat(x.needsType ? [x.needsType + " need" + (x.needsType === 1 ? "s" : "") + " type"] : []).join(DOT); };

  // Park the shift form in App's memory-only ref while it is changed
  // (utils.js payDraftDirty), so a tab switch does not throw away what was
  // typed (Log's draft precedent). Runs only after a render that committed;
  // Save, Delete and Cancel null the draft, which clears the ref.
  useEffect(function() {
    if (!keep) return;
    keep.current = payDraftDirty(draft, draftInit, draftBase)
      ? { draft: draft, draftInit: draftInit, draftBase: draftBase, editOrig: editOrig, hoursOpen: hoursOpen, moreOpen: moreOpen, sites: data.paySites }
      : null;
  }, [draft, draftInit, draftBase, editOrig, hoursOpen, moreOpen, data.paySites]);

  // Every hook is declared above this line (CLAUDE.md: hooks before any
  // conditional return).
  if (draft) return renderForm();

  return (<div style={S.page}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <button onClick={onBack} style={S.backBtn}>Back</button>
      <h1 style={{ ...S.title, marginBottom: 0, flex: 1 }}>Call Pay</h1>
      {eyeBtn}
    </div>

    {typedOffers.length > 0 && !typedOfferHidden && <div style={{ ...S.card, border: "1px solid rgba(14,165,233,0.4)", background: "rgba(14,165,233,0.06)" }}>
      <div style={S.cardLabel}>New Day/Night rates</div>
      {typedOffers.map(function(o) {
        var from = fromLabel(payBuiltInFrom(o.def)), v = payBuiltInVersion(o.def), p = o.plan;
        var origV = p.original ? o.site.rates.filter(function(r) { return r.id === p.original; })[0] : null, inForce = rateInForce(o.site, payBuiltInFrom(o.def));
        return (<div key={o.site.id} style={{ fontSize: 12, color: "var(--text-primary)", marginTop: 6, lineHeight: 1.5 }}>
          {o.site.name + ": new Day/Night rates from " + from + " - " + maskText(versionSummary(v)) + ". " +
            (origV ? "Your " + o.site.name + " rates from " + from + (origV.label ? " (" + origV.label + ")" : "") + " become the Original rates. " : (inForce ? "Your " + o.site.name + " rates from " + fromLabel(inForce.effective) + " still apply before " + from + ". " : "")) +
            "Recorded shifts keep their pay; " + (p.needType ? plural(p.needType, "shift") + " from " + from + " will need Day or Night and leave the totals until set." : "none of them needs a type.")}
        </div>);
      })}
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={useTypedRates} style={btn({ ...primary, flex: 1 })}>Use new rates</button>
        <button onClick={function() { setTypedOfferHidden(true); }} style={btn()}>Not now</button>
      </div>
    </div>}

    {needsType > 0 && !typeCardHidden && <div style={{ ...S.card, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.06)" }}>
      <div style={S.cardLabel}>Day or Night</div>
      <div style={{ fontSize: 12, color: "var(--text-primary)", marginTop: 6, lineHeight: 1.5 }}>{plural(needsType, "shift") + " " + (needsType === 1 ? "was" : "were") + " logged before Day/Night shifts. " + (needsType === 1 ? "It is" : "They are") + " left out of your totals until you set Day or Night."}</div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={reviewFlagged} style={btn({ ...primary, flex: 1 })}>{"Review " + plural(needsType, "shift")}</button>
        <button onClick={function() { setTypeCardHidden(true); }} style={btn()}>Not now</button>
      </div>
    </div>}

    {offers.length > 0 && !offerHidden && <div style={{ ...S.card, border: "1px solid rgba(14,165,233,0.4)", background: "rgba(14,165,233,0.06)" }}>
      <div style={S.cardLabel}>Built-in rates</div>
      {offers.map(function(o) {
        return (<div key={o.site.id} style={{ fontSize: 12, color: "var(--text-primary)", marginTop: 6, lineHeight: 1.5 }}>{o.site.name + ": no paying rates from " + fromLabel(payBuiltInFrom(o.def)) + (o.plan.later ? " until " + o.plan.later : "") + "."}</div>);
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
            {missingDefaults.length > 0 && <button onClick={addDefaults} style={btn({ width: "100%", marginTop: 10, color: "var(--accent-sky)", border: "1px solid rgba(14,165,233,0.3)" })}>{"Add built-in site" + (missingDefaults.length === 1 ? "" : "s") + ": " + missingDefaults.map(function(ds) { return ds.name; }).join(", ")}</button>}
          </div>
        : <div>
            <button onClick={openNew} style={btn({ ...primary, width: "100%", marginTop: 10, minHeight: 50, fontSize: 15 })}>+ New shift</button>
            {recent.length === 0
              ? <div style={{ fontSize: 12, color: "var(--text-faint)", marginTop: 10 }}>No shifts logged yet.</div>
              : <div style={{ marginTop: 10 }}>
                  <div style={{ fontSize: 11, color: flagOnly && flaggedList.length ? amber : "var(--text-muted)", marginBottom: 2 }}>{flagOnly && flaggedList.length ? "Need a type (" + flaggedList.length + ")" : allShifts ? "All shifts (" + shifts.length + ")" : "Recent"}</div>
                  {recent.map(function(s) {
                    var p = computeShiftPay(s), flagged = payShiftNeedsType(s, sites), typedS = payShiftIsTyped(s);
                    return (<div key={s.id} style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid rgba(51,65,85,0.4)" }}>
                      <button onClick={function() { openEdit(s, false); }} style={{ flex: 1, minWidth: 0, minHeight: 48, textAlign: "left", background: "none", border: "none", padding: "4px 0", cursor: "pointer" }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortDay(s.date) + DOT + shiftSiteName(s) + typeTag(s)}{flagged ? FLAG_TAG : null}</div>
                        <div style={{ fontSize: 11, color: flagged ? amber : "var(--text-muted)", fontFamily: "JetBrains Mono" }}>{flagged ? s.callHours + "h" + DOT + "(Set Day or Night)" : rowDetail(s, p)}{staleTag(s)}</div>
                      </button>
                      {flagged ? <button onClick={function() { openEdit(s, false); }} style={btn({ color: amber, border: "1px solid rgba(245,158,11,0.4)" })}>Set type</button>
                        : (!typedS || s.rates.shiftType.callIn) ? <button onClick={function() { openEdit(s, true); }} style={btn()}>+ Call-in</button> : null}
                    </div>);
                  })}
                  {flagOnly && flaggedList.length > 0 && <button onClick={function() { setFlagOnly(false); }} style={btn({ width: "100%", marginTop: 6 })}>Show all shifts</button>}
                  {!(flagOnly && flaggedList.length) && shifts.length > 5 && <button onClick={function() { setAllShifts(!allShifts); }} style={btn({ width: "100%", marginTop: 6 })}>{allShifts ? "Show recent only" : "Show all " + shifts.length + " shifts"}</button>}
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
        <div style={{ fontSize: 18, fontWeight: 700, fontFamily: "JetBrains Mono", color: "var(--accent-green)", flexShrink: 0 }}>{paid(totals.total)}</div>
      </div>
      {totals.split.length > 0 && <div style={{ marginTop: 6 }}>
        {totals.split.map(function(b) {
          return (<div key={b.key || "other"} style={{ paddingLeft: 8 }}>
            <div style={{ display: "flex", justifyContent: "space-between", gap: 8, fontSize: 12, color: "var(--text-primary)", lineHeight: 1.6 }}>
              <span>{b.label + DOT + plural(b.shifts, "shift")}</span><span style={{ fontFamily: "JetBrains Mono" }}>{paid(b.total)}</span>
            </div>
            {b.ciShifts > 0 && <div style={{ fontSize: 11, color: "var(--text-muted)", paddingLeft: 10 }}>{nightsLine(b)}</div>}
          </div>);
        })}
      </div>}
      {totals.needsType > 0 && <button onClick={reviewFlagged} style={{ display: "flex", justifyContent: "space-between", width: "100%", background: "none", border: "none", padding: "6px 0 2px 8px", minHeight: 32, fontSize: 12, color: amber, cursor: "pointer", textAlign: "left" }}>
        <span>{plural(totals.needsType, "shift") + " need" + (totals.needsType === 1 ? "s" : "") + " a type - not counted"}</span><span>{"\u203A"}</span>
      </button>}
      {totals.months.map(function(m) {
        var open = openMonth === m.key;
        return (<div key={m.key} style={{ borderTop: "1px solid rgba(51,65,85,0.4)", marginTop: 6 }}>
          <button onClick={function() { setOpenMonth(open ? "" : m.key); }} style={{ width: "100%", minHeight: 48, display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", padding: "4px 0", cursor: "pointer", textAlign: "left" }}>
            <span style={{ width: 12, fontSize: 12, color: "var(--text-faint)" }}>{open ? "\u25BE" : "\u25B8"}</span>
            <span style={{ flex: 1, fontSize: 14, fontWeight: 600, color: "var(--text-primary)" }}>{monthLabel(m.key)}</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{plural(m.shifts, "shift")}</span>
            <span style={{ minWidth: 88, textAlign: "right", fontSize: 13, fontWeight: 600, fontFamily: "JetBrains Mono", color: "var(--text-bright)" }}>{paid(m.total)}</span>
          </button>
          {!open && (m.split.length > 0 || m.needsType > 0) && <div style={{ fontSize: 11, color: m.needsType ? amber : "var(--text-muted)", padding: "0 0 6px 20px" }}>{countsLine(m)}</div>}
          {open && <div style={{ padding: "0 0 8px 20px" }}>
            {m.split.map(function(b) {
              return (<div key={b.key || "other"} style={{ fontSize: 11, color: "var(--text-primary)", lineHeight: 1.6 }}>
                {b.label + " " + b.shifts + DOT + paid(b.total)}{b.ciShifts > 0 ? <span style={{ color: "var(--text-muted)" }}>{DOT + nightsLine(b)}</span> : null}
              </div>);
            })}
            {m.needsType > 0 && <div style={{ fontSize: 11, color: amber, lineHeight: 1.6 }}>{plural(m.needsType, "shift") + " need" + (m.needsType === 1 ? "s" : "") + " a type - open " + (m.needsType === 1 ? "it" : "them") + " to set Day or Night."}</div>}
            {m.sites.length > 1 && <div style={{ fontSize: 11, color: "var(--text-muted)", lineHeight: 1.6, marginBottom: 4 }}>
              {m.sites.map(function(st) { return st.name + (st.deleted ? " (deleted)" : "") + " " + paid(st.total) + " (" + st.shifts + ")"; }).join(DOT)}
            </div>}
            {m.unpriced > 0 && <div style={{ fontSize: 11, color: amber, marginBottom: 4 }}>{plural(m.unpriced, "shift") + " could not be priced - open " + (m.unpriced === 1 ? "it" : "them") + " to check."}</div>}
            {m.list.map(function(s) {
              var p = computeShiftPay(s), flagged = payShiftNeedsType(s, sites);
              return (<button key={s.id} onClick={function() { openEdit(s, false); }} style={{ width: "100%", minHeight: 44, display: "flex", alignItems: "center", gap: 8, background: "none", border: "none", borderTop: "1px solid rgba(51,65,85,0.25)", padding: "2px 0", cursor: "pointer", textAlign: "left" }}>
                <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: flagged ? amber : "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{shortDay(s.date) + DOT + shiftSiteName(s) + typeTag(s) + DOT + (flagged ? "Set Day or Night" : plural(payShiftCallInCount(s), "call-in"))}</span>
                {staleTag(s)}
                <span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "var(--text-muted)", flexShrink: 0 }}>{flagged ? "-" : p ? paid(p.total) : "?"}</span>
              </button>);
            })}
          </div>}
        </div>);
      })}
    </div>}

    <div ref={ratesCardRef} style={S.card}>
      <div style={S.cardLabel}>Call pay rates</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>Each site keeps dated rate versions - when rates change, add a new version instead of overwriting. Recorded shifts keep the rates they were saved with.</div>
      {sites.length === 0 && <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "10px 0" }}>No sites yet.</div>}
      {sites.map(function(s) {
        var cur = rateInForce(s, today);
        var sorted = s.rates.slice().sort(byStartDesc);
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
              return (<button key={dn} onClick={function() { toggleWeekend(s.id, d); }} style={btn({ flex: 1, padding: 0, fontSize: 12, border: on ? "1px solid rgba(14,165,233,0.6)" : "1px solid var(--border-default)", background: on ? "rgba(14,165,233,0.15)" : "transparent", color: on ? "var(--accent-sky)" : "var(--text-faint)" })}>{dn}</button>);
            })}
          </div>
          {builtInDefOf[s.id] && wd.slice().sort().join(",") !== builtInDefOf[s.id].weekendDays.slice().sort().join(",") && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>{"The built-in " + builtInDefOf[s.id].name + " rates count " + dayList(builtInDefOf[s.id].weekendDays) + " as weekend days."}</div>}

          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10, marginBottom: 6 }}>Call cases logged here</div>
          <div style={{ display: "flex", gap: 6 }}>
            {[[true, "Earn wRVU credit"], [false, "No wRVU credit"]].map(function(c) {
              var on = (s.casesEarnRVU !== false) === c[0];
              return (<button key={c[1]} onClick={function() { setSiteCredit(s, c[0]); }} style={btn({ flex: 1, padding: "0 8px", fontSize: 12, border: on ? "1px solid rgba(14,165,233,0.6)" : "1px solid var(--border-default)", background: on ? "rgba(14,165,233,0.15)" : "transparent", color: on ? "var(--accent-sky)" : "var(--text-faint)" })}>{c[1]}</button>);
            })}
          </div>
          {s.casesEarnRVU === false && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>{"Call cases dated " + fromLabel(CALL_NO_CREDIT_FROM) + " or later are logged with no wRVU credit; earlier ones earn credit."}</div>}
          {creditOfferOf[s.id] && <div style={{ fontSize: 11, color: amber, marginTop: 6, lineHeight: 1.5 }}>{"The built-in " + creditOfferOf[s.id].def.name + " rule is no wRVU credit for call cases from " + fromLabel(CALL_NO_CREDIT_FROM) + " - tap No wRVU credit if that applies here."}</div>}

          <div style={{ marginTop: 10 }}>
            {sorted.length === 0 && <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "6px 0" }}>No rates yet - add the first version.</div>}
            {sorted.map(function(r, i) {
              var newer = sorted[i - 1], typedV = payRateIsTyped(r);
              return (<div key={r.id} style={{ padding: "8px 0", borderTop: "1px solid rgba(51,65,85,0.4)" }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: r === cur ? "var(--accent-green-soft)" : "var(--text-muted)" }}>{versionStatus(r, cur, newer) + (r.label ? " (" + r.label + ")" : "")}</div>
                {typedV
                  ? payRateTypes(r).map(function(t) { return <div key={t.key} style={{ fontSize: 12, color: "var(--text-primary)", fontFamily: "JetBrains Mono", marginTop: 3, lineHeight: 1.5 }}>{maskText(payTypePreview(t))}</div>; })
                  : <div style={{ fontSize: 12, color: "var(--text-primary)", fontFamily: "JetBrains Mono", marginTop: 3, lineHeight: 1.5 }}>{maskText(versionSummary(r))}</div>}
                <div style={{ display: "flex", gap: 8, marginTop: 6 }}>
                  <button onClick={function() { openRateForm(s, r); }} style={btn()}>Edit</button>
                  <button onClick={function() { deleteRate(s, r); }} style={btn(danger)}>Delete</button>
                </div>
              </div>);
            })}
          </div>

          {repriceOffer && repriceOffer.siteIds.indexOf(s.id) !== -1 && staleFor(s).length > 0 && <div style={{ marginTop: 10, padding: 12, borderRadius: 10, border: "1px solid rgba(245,158,11,0.4)", background: "rgba(245,158,11,0.06)" }}>
            <div style={{ fontSize: 12, color: "var(--text-primary)", lineHeight: 1.5 }}>{plural(staleFor(s).length, "recorded shift") + " (" + dateRange(staleFor(s)) + ") use rates that differ from the version now in force for their dates."}</div>
            <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
              <button onClick={function() { repriceSite(s); }} style={btn({ ...primary, flex: 1 })}>{"Re-price " + plural(staleFor(s).length, "shift")}</button>
              <button onClick={function() { dropOffer(s.id); }} style={btn()}>Not now</button>
            </div>
          </div>}

          {rateForm && rateForm.siteId === s.id
            ? (rateForm.kind === "typed" ? renderTypedRateForm(s) : renderLegacyRateForm(s))
            : <button onClick={function() { openRateForm(s, null); }} style={btn({ marginTop: 8, width: "100%", color: "var(--accent-sky)", border: "1px solid rgba(14,165,233,0.3)" })}>+ Add new rates</button>}
        </div>);
      })}

      <div style={{ display: "flex", gap: 8, marginTop: 14, paddingTop: 12, borderTop: "1px solid var(--border-default)" }}>
        <input type="text" value={newSite} onChange={function(e) { setNewSite(e.target.value); }} placeholder="New site name" style={{ ...S.searchInput, flex: 1, fontSize: 13, padding: "10px 12px" }} />
        <button onClick={addSite} disabled={!newSite.trim() || nameTaken(newSite, null)} style={btn({ ...primary, opacity: newSite.trim() && !nameTaken(newSite, null) ? 1 : 0.4 })}>Add site</button>
      </div>
      {newSite.trim() && nameTaken(newSite, null) && <div style={{ fontSize: 11, color: amber, marginTop: 6 }}>A site with that name already exists.</div>}
      {missingDefaults.length > 0 && <button onClick={addDefaults} style={btn({ width: "100%", marginTop: 10, color: "var(--accent-sky)", border: "1px solid rgba(14,165,233,0.3)" })}>{"Add built-in site" + (missingDefaults.length === 1 ? "" : "s") + ": " + missingDefaults.map(function(ds) { return ds.name; }).join(", ")}</button>}
    </div>
  </div>);
}
