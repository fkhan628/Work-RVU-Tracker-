// =======================================
// DIRECTORSHIPS (monthly hours + signed time sheets)
// =======================================
// Logs directorship time, shows one card per directorship per month, and
// produces each month's signed time sheet as a PDF that is handed to Google
// Drive through the share sheet (files only). A scheduled task OUTSIDE this
// app finds those PDFs in Drive by their exact file name and drafts the
// emails - this app never stores, shows or sends email addresses.
// Every rule, number and printed string comes from utils.js (dirFormModel is
// the ONE source for the Review screen and the PDF); this file only holds
// state and renders. Four top-level names (check.js G9): Directorships,
// DirReview, DirectorshipsCard, DirSignaturePad.

// Nav-less view opened from More (Settings) or Home's reminder line.
function Directorships({ data, upd, onBack, showComp, toggleComp, showUndo, dirMonth }) {
  var dirs = dirList(data), entries = dirEntriesOf(data), today = todayLocal();
  var DAY3 = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  var DOT = " \u00B7 ";
  const [ym, setYm] = useState(function() {
    var m = dirMonth && dirMonth.current;
    return typeof m === "string" && dirYMParts(m) ? m : (dirDefaultMonth(data, todayLocal()) || todayLocal().slice(0, 7));
  });
  useEffect(function() { if (dirMonth) dirMonth.current = null; }, []);
  var freshForm = function(dirId) { return { dirId: dirId || "", category: "", minutes: null, custom: false, ch: "", cm: "", date: todayLocal(), detail: "", all: false }; };
  const [form, setForm] = useState(function() { var l = dirList(data); return freshForm(l.length === 1 ? l[0].id : ""); });
  const [screen, setScreen] = useState(null);   // null | { kind: "edit", entry, f } | { kind: "repeat", dirId, rows, open } | { kind: "review", dirId }
  const [msg, setMsg] = useState("");
  const [problems, setProblems] = useState([]);
  const savingRef = useRef(false);
  const listScroll = useRef(0);

  var btn = function(extra) { return { minHeight: 44, padding: "0 14px", borderRadius: 8, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer", ...extra }; };
  var primary = { border: "none", background: "#0369a1", color: "#fff" };
  var amber = "var(--global-90)";
  var chip = function(on, label, onClick, key, extra) {
    return (<button key={key} onClick={onClick} style={btn({ padding: "6px 10px", fontSize: 12, textAlign: "left", lineHeight: 1.3, border: on ? "1px solid rgba(14,165,233,0.6)" : "1px solid var(--border-default)", background: on ? "rgba(14,165,233,0.15)" : "transparent", color: on ? "var(--accent-sky)" : "var(--text-muted)", ...(extra || {}) })}>{label}</button>);
  };
  var eyeBtn = <CompEye showComp={showComp} toggleComp={toggleComp} />;
  var scrollBox = function() { return document.querySelector(".rvu-content"); };
  var openScreen = function(s) {
    if (showUndo) showUndo(null);   // a pending Undo must never act behind an open form
    setProblems([]);                // Log-card errors must not show on Edit / Repeat
    var sc = scrollBox(); if (sc) { listScroll.current = sc.scrollTop; sc.scrollTop = 0; }
    setScreen(s);
  };
  var closeScreen = function() { setScreen(null); setTimeout(function() { var sc = scrollBox(); if (sc) sc.scrollTop = listScroll.current; }, 0); };
  var dayName = function(ymd) { var w = ymdWeekday(ymd); return w < 0 ? ymd : DAY3[w] + " " + dirMD(ymd); };
  var catLabel = function(dir, e) {
    var r = dir ? dirRowByKey(dir.form, e.category) : null;
    if (!r) return "Needs a category";
    var d = dirDetailText(e.detail);
    if (e.category === "g_meeting") return "Meeting: " + (d || "?");
    if (e.category === "g_other") return "Other: " + (d || "?");
    return r.label + (r.detail && d ? ": " + d : "");
  };
  var minutesOf = function(f) { return f.custom ? dirParseHM(f.ch, f.cm).min : f.minutes; };
  // Month total for a directorship, as the form would add it (placed entries).
  var monthMinutes = function(dirId, month, exceptId) {
    var dir = dirById(data, dirId), n = 0;
    dirMonthEntries(entries, dirId, month).forEach(function(e) { if (e.id !== exceptId && dir && dirRowByKey(dir.form, e.category) && dirMinutesOk(e.minutes)) n += e.minutes; });
    return n;
  };

  // ---- The entry fields (log card, edit screen) ----
  var renderFields = function(f, setF, exceptId, allowDir) {
    var dir = dirById(data, f.dirId), rows = dir ? dirRowsFor(dir.form) : [], row = dir ? dirRowByKey(dir.form, f.category) : null;
    var recent = dir ? dirRecentCategories(entries, dir.id).filter(function(k) { return !!dirRowByKey(dir.form, k); }) : [];
    var set = function(patch) { setF(function(x) { return { ...x, ...patch }; }); };
    var parsed = f.custom ? dirParseHM(f.ch, f.cm) : null, mins = minutesOf(f);
    var month = isYMD(f.date) ? f.date.slice(0, 7) : "";
    var cap = dir ? dirCapMinutes(dir) : null, after = dir && month && mins ? monthMinutes(dir.id, month, exceptId) + mins : 0;
    var used = row && row.detail ? dirRecentDetails(entries, dir.id, row.key) : [];
    var dText = dirDetailText(dirAsciiPunct(f.detail)), dKey = dirDetailKey(dText);   // normalized as Save stores it
    var slotNote = "";
    if (row && row.slots && dKey && month) {
      // The real plan with this draft in it (lines go by date order, so a
      // backdated topic moves the others down).
      var others = dirMonthEntries(entries, dir.id, month).filter(function(e) { return e.id !== exceptId; });
      var draftE = { id: "__draft", dirId: dir.id, date: f.date, category: row.key, detail: dText, minutes: mins || 0 };
      var plan = dirSlotPlan(dirMonthEntries(others.concat([draftE]), dir.id, month), row);
      var slot = plan.slotOf[dKey], last = row.slots - 1;
      if (typeof slot !== "number") slotNote = "";
      else if (plan.combined && slot === last) slotNote = "Will be combined into " + row.flagName + " line " + row.slots + ": " + plan.fills[last] + " (all " + row.slots + " lines are used this month).";
      else slotNote = row.flagName + " line " + (slot + 1) + " of " + row.slots + (plan.combined ? " - line " + row.slots + " combines " + plan.fills[last] : "");
    }
    var prints = !row ? "" : row.key === "g_meeting" ? "Meeting with " + (dText || "____") + " to discuss" : row.key === "g_other" ? "Other: " + (dText || "(details)") : row.text + (row.detail && dText ? " " + dText : "");
    var yday = addDaysYMD(today, -1);
    return (<div>
      {allowDir && <div>
        {dirs.length > 1 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {dirs.map(function(d) { return chip(f.dirId === d.id, d.shortName || d.name, function() { setF(function(x) { var nd = dirById(data, d.id), same = nd && dir && nd.form === dir.form; return { ...x, dirId: d.id, category: same ? x.category : "", detail: same ? x.detail : "" }; }); }, d.id, { flex: 1, textAlign: "center", minWidth: 80 }); })}
        </div>}
        {dirs.length === 1 && <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{dirs[0].name}</div>}
      </div>}
      {!allowDir && dir && <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{dir.name}</div>}
      {dir && <div>
        <div style={{ ...S.fieldLabel, marginTop: 12 }}>Activity</div>
        {recent.length > 0 && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
          {recent.map(function(k) { var r = dirRowByKey(dir.form, k); return chip(f.category === k, r.label, function() { set({ category: k }); }, "r" + k); })}
        </div>}
        {recent.length > 0 && <button onClick={function() { set({ all: !f.all }); }} style={{ ...S.linkBtn, marginTop: 6, minHeight: 32 }}>{f.all ? "Hide the full list" : "All " + rows.length + " activities"}</button>}
        {(f.all || recent.length === 0) && <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6, marginTop: 4 }}>
          {rows.map(function(r) { return chip(f.category === r.key, r.label, function() { set({ category: r.key }); }, r.key); })}
        </div>}
        {row && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>{"Prints: " + prints}</div>}

        <div style={{ ...S.fieldLabel, marginTop: 12 }}>Time</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6 }}>
          {DIR_QUICK_MIN.map(function(m) { return chip(!f.custom && f.minutes === m, dirFmtHM(m), function() { set({ minutes: m, custom: false }); }, "q" + m, { textAlign: "center", fontFamily: "JetBrains Mono" }); })}
          {chip(f.custom, "Custom", function() { set({ custom: true }); }, "custom", { gridColumn: "span 2", textAlign: "center" })}
        </div>
        {f.custom && <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 8 }}>
          <input inputMode="numeric" aria-label="Hours" value={f.ch} onChange={function(e) { set({ ch: e.target.value }); }} placeholder="0" style={{ ...S.dateInput, width: 64, textAlign: "center" }} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>h</span>
          <input inputMode="numeric" aria-label="Minutes" value={f.cm} onChange={function(e) { set({ cm: e.target.value }); }} placeholder="0" style={{ ...S.dateInput, width: 64, textAlign: "center" }} />
          <span style={{ fontSize: 12, color: "var(--text-muted)" }}>min</span>
          <span style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: parsed && parsed.min ? "var(--text-primary)" : "var(--text-faint)", marginLeft: 6 }}>{parsed && parsed.min ? "= " + dirFmtHM(parsed.min) : ""}</span>
        </div>}
        {f.custom && parsed && parsed.error && (f.ch !== "" || f.cm !== "") && <div style={{ fontSize: 11, color: amber, marginTop: 4 }}>{parsed.error}</div>}
        {dir.form === "select" && mins && !dirHoursExact(mins) && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{"Prints as " + dirFmtHours(mins) + " h (rounded)"}</div>}

        <div style={{ ...S.fieldLabel, marginTop: 12 }}>Date</div>
        <div style={{ display: "flex", gap: 6 }}>
          {chip(f.date === today, "Today" + DOT + dayName(today), function() { set({ date: today }); }, "t", { flex: 1, textAlign: "center" })}
          {chip(f.date === yday, "Yesterday" + DOT + dayName(yday), function() { set({ date: yday }); }, "y", { flex: 1, textAlign: "center" })}
        </div>
        <input type="date" value={f.date} onChange={function(e) { set({ date: e.target.value }); }} style={{ ...S.dateInput, marginTop: 6, width: "100%", boxSizing: "border-box" }} />
        {isYMD(f.date) && f.date > today && <div style={{ fontSize: 11, color: amber, marginTop: 4 }}>Dated in the future - it can't be on a form until then.</div>}
        {isYMD(f.date) && !screen && f.date.slice(0, 7) !== ym && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{"Saves to " + dirMonthLabel(f.date.slice(0, 7))}</div>}

        {row && row.detail && <div>
          <div style={{ ...S.fieldLabel, marginTop: 12 }}>{row.key === "g_meeting" ? "Meeting with ___ to discuss" : row.key === "g_other" ? "Other (details)" : "Description of services"}</div>
          <input value={f.detail} maxLength={DIR_DETAIL_MAX} onChange={function(e) { set({ detail: e.target.value }); }} placeholder={DIR_DETAIL_HINT} style={{ ...S.dateInput, width: "100%", boxSizing: "border-box" }} />
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{DIR_DETAIL_HINT}</div>
          {used.length > 0 && <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6, alignItems: "center" }}>
            <span style={{ fontSize: 11, color: "var(--text-faint)" }}>Used before:</span>
            {used.map(function(u) { return chip(dirDetailKey(u) === dKey, u, function() { set({ detail: u }); }, "u" + u); })}
          </div>}
          {slotNote && <div style={{ fontSize: 11, color: slotNote.indexOf("combined") !== -1 ? amber : "var(--text-muted)", marginTop: 4 }}>{slotNote}</div>}
        </div>}
        {cap !== null && after > cap && <div style={{ fontSize: 11, color: amber, marginTop: 8, lineHeight: 1.5 }}>{"Makes " + (dir.shortName || dir.name) + " " + dirFmtHM(after) + " for " + dirMonthLabel(month) + " - over the " + dirFmtHours(cap) + " h cap (the amount stays capped)."}</div>}
      </div>}
    </div>);
  };

  // ---- Save (double-tap safe: the Log ref lock) ----
  var lock = function() { if (savingRef.current) return false; savingRef.current = true; setTimeout(function() { savingRef.current = false; }, 400); return true; };
  var saveNew = function() {
    if (savingRef.current) return;   // 2nd tap of a double tap: the form was just reset - do nothing
    var dir = dirById(data, form.dirId);
    var b = dirEntryFromDraft({ date: form.date, minutes: minutesOf(form), category: form.category, detail: form.detail }, dir, dirEntryId(0));
    if (!b.entry) { setProblems(b.problems); return; }
    if (!lock()) return;
    var e = b.entry;
    upd(function(prev) { return { ...prev, dirEntries: dirEntriesOf(prev).concat([e]) }; });
    setProblems([]);
    setForm(function(x) { return { ...freshForm(x.dirId), date: x.date }; });
    var m = "Saved " + dirFmtHM(e.minutes) + DOT + (dir.shortName || dir.name) + " " + dayName(e.date) + (e.date.slice(0, 7) !== ym ? " (" + dirMonthLabel(e.date.slice(0, 7)) + ")" : "");
    if (showUndo) showUndo({ type: "dir", remove: [e.id], restore: [], message: m });
  };
  var openEdit = function(e) {
    var quick = DIR_QUICK_MIN.indexOf(e.minutes) !== -1;
    openScreen({ kind: "edit", entry: e, f: { dirId: e.dirId, category: e.category, minutes: quick ? e.minutes : null, custom: !quick, ch: quick ? "" : String(Math.floor(e.minutes / 60)), cm: quick ? "" : String(e.minutes % 60), date: e.date, detail: e.detail || "", all: !dirRecentCategories(entries, e.dirId).length } });
  };
  var setEditF = function(fn) { setScreen(function(s) { return s && s.kind === "edit" ? { ...s, f: fn(s.f) } : s; }); };
  var saveEdit = function() {
    var s = screen, dir = dirById(data, s.f.dirId);
    var b = dirEntryFromDraft({ date: s.f.date, minutes: minutesOf(s.f), category: s.f.category, detail: s.f.detail }, dir, s.entry.id);
    if (!b.entry) { setProblems(b.problems); return; }
    if (!lock()) return;
    var old = s.entry, e = b.entry;
    upd(function(prev) { return { ...prev, dirEntries: dirEntriesOf(prev).map(function(x) { return x.id === old.id ? e : x; }) }; });
    setProblems([]); closeScreen();
    if (showUndo) showUndo({ type: "dir", remove: [], restore: [old], message: "Entry updated" });
  };
  var deleteEntry = function() {
    var old = screen.entry, at = -1;
    entries.forEach(function(x, i) { if (x.id === old.id) at = i; });
    upd(function(prev) { return { ...prev, dirEntries: dirEntriesOf(prev).filter(function(x) { return x.id !== old.id; }) }; });
    setProblems([]); closeScreen();
    if (showUndo) showUndo({ type: "dir", remove: [], restore: [old], at: at, message: "Entry deleted" });
  };
  var cancelEdit = function() {
    var s = screen, o = s.entry, f = s.f;
    var changed = f.dirId !== o.dirId || f.category !== o.category || minutesOf(f) !== o.minutes || f.date !== o.date || dirDetailText(f.detail) !== dirDetailText(o.detail);
    if (changed && !confirm("Discard changes?")) return;
    setProblems([]); closeScreen();
  };

  // ---- Repeat last month (a draft; nothing is saved until Save) ----
  var openRepeat = function(dirId) { openScreen({ kind: "repeat", dirId: dirId, rows: dirRepeatDraft(entries, dirId, ym, today), open: -1 }); };
  var setRepeat = function(fn) { setScreen(function(s) { return s && s.kind === "repeat" ? fn(s) : s; }); };
  var saveRepeat = function() {
    var s = screen, dir = dirById(data, s.dirId), out = [], probs = [];
    s.rows.forEach(function(r, i) {
      if (!r.on) return;
      if (r.date.slice(0, 7) !== ym || r.date > today) { probs.push(dayName(r.date) + ": must be in " + dirMonthLabel(ym) + " and not after today."); return; }
      var b = dirEntryFromDraft(r, dir, dirEntryId(i));
      if (b.entry) out.push(b.entry); else probs.push(dayName(r.date) + ": " + b.problems.join(" "));
    });
    if (probs.length || !out.length) { setProblems(probs.length ? probs : ["Tick at least one entry."]); return; }
    if (!lock()) return;
    upd(function(prev) { return { ...prev, dirEntries: dirEntriesOf(prev).concat(out) }; });
    setProblems([]); closeScreen();
    if (showUndo) showUndo({ type: "dir", remove: out.map(function(e) { return e.id; }), restore: [], message: "Added " + out.length + " " + (out.length === 1 ? "entry" : "entries") + " to " + dirMonthLabel(ym) });
  };

  // ---- Hand-off toggle (for a file saved some other way) ----
  var toggleHandoff = function(dir) {
    var st = dirMonthStatus(data, dir.id, ym);
    if (st.state === "handed") {
      if (!confirm("Clear the hand-off record for " + dir.name + " - " + dirMonthLabel(ym) + "?")) return;
      upd(function(prev) { return { ...prev, dirHandoff: dirHandoffClear(dirHandoffOf(prev), dir.id, ym) }; });
      return;
    }
    var hash = dirEntriesHash(entries, dir.id, ym);
    upd(function(prev) { return { ...prev, dirHandoff: dirHandoffMark(dirHandoffOf(prev), dir.id, ym, todayLocal(), hash) }; });
  };

  // Every hook is declared above this line (CLAUDE.md: hooks before any
  // conditional return).
  if (screen && screen.kind === "review") return <DirReview data={data} upd={upd} dirId={screen.dirId} ym={ym} showComp={showComp} eye={eyeBtn} onClose={closeScreen} />;

  var probBox = problems.length > 0 && <div style={{ marginTop: 10 }}>{problems.map(function(p, i) { return <div key={i} style={{ fontSize: 12, color: "var(--accent-red)", lineHeight: 1.5 }}>{p}</div>; })}</div>;

  if (screen && screen.kind === "edit") {
    var eSt = dirMonthStatus(data, screen.entry.dirId, screen.entry.date.slice(0, 7));
    return (<div style={S.page}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={cancelEdit} style={S.backBtn}>Cancel</button>
        <h1 style={{ ...S.title, marginBottom: 0, flex: 1 }}>Edit entry</h1>
        {eyeBtn}
      </div>
      <div style={S.card}>
        {renderFields(screen.f, setEditF, screen.entry.id, true)}
        {eSt.state === "handed" && <div style={{ fontSize: 11, color: amber, marginTop: 10, lineHeight: 1.5 }}>{dirMonthLabel(screen.entry.date.slice(0, 7)).split(" ")[0] + " is handed off - saving marks the form CHANGED SINCE HANDOFF."}</div>}
        {probBox}
        <button onClick={saveEdit} style={btn({ ...primary, width: "100%", minHeight: 50, fontSize: 15, marginTop: 14 })}>Save changes</button>
        <button onClick={deleteEntry} style={btn({ width: "100%", marginTop: 10, color: "var(--accent-red)", border: "1px solid rgba(239,68,68,0.3)" })}>Delete entry</button>
      </div>
    </div>);
  }

  if (screen && screen.kind === "repeat") {
    var rDir = dirById(data, screen.dirId), on = screen.rows.filter(function(r) { return r.on; });
    var have = dirMonthEntries(entries, screen.dirId, ym).length;
    return (<div style={S.page}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
        <button onClick={function() { setProblems([]); closeScreen(); }} style={S.backBtn}>Cancel</button>
        <h1 style={{ ...S.title, marginBottom: 0, flex: 1, fontSize: 22 }}>Repeat last month</h1>
        {eyeBtn}
      </div>
      <div style={S.card}>
        <div style={{ fontSize: 13, color: "var(--text-primary)", lineHeight: 1.5 }}>{"From " + dirMonthLabel(dirAddMonths(ym, -1)) + DOT + (rDir ? rDir.name : "") + " -> " + dirMonthLabel(ym)}</div>
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>Nothing is saved until you tap Save.</div>
        {have > 0 && <div style={{ fontSize: 11, color: amber, marginTop: 6 }}>{dirMonthLabel(ym).split(" ")[0] + " already has " + have + " " + (have === 1 ? "entry" : "entries") + " - these are added, not replaced."}</div>}
        {screen.rows.map(function(r, i) {
          var open = screen.open === i;
          var setRow = function(patch) { setRepeat(function(s) { return { ...s, rows: s.rows.map(function(x, j) { return j === i ? { ...x, ...patch } : x; }) }; }); };
          var rRow = rDir ? dirRowByKey(rDir.form, r.category) : null;
          return (<div key={i} style={{ borderTop: "1px solid rgba(51,65,85,0.4)", marginTop: i ? 0 : 10 }}>
            <div style={{ display: "flex", alignItems: "center", gap: 8, minHeight: 48 }}>
              <input type="checkbox" checked={r.on} onChange={function(e) { setRow({ on: e.target.checked }); }} aria-label="Include" style={{ width: 22, height: 22 }} />
              <button onClick={function() { setRepeat(function(s) { return { ...s, open: open ? -1 : i }; }); }} style={{ flex: 1, minWidth: 0, textAlign: "left", background: "none", border: "none", padding: "4px 0", cursor: "pointer" }}>
                <div style={{ fontSize: 13, color: r.on ? "var(--text-primary)" : "var(--text-faint)" }}>{dayName(r.date) + "  " + catLabel(rDir, r) + "  " + dirFmtHM(r.minutes)}</div>
                <div style={{ fontSize: 11, color: "var(--text-faint)" }}>{"was " + dirMD(r.from) + (r.clamped ? " (clamped)" : "") + (r.dup ? DOT + "already logged" : "") + (r.date > today ? DOT + "after today" : "")}</div>
              </button>
            </div>
            {open && <div style={{ padding: "4px 0 10px 30px" }}>
              <input type="date" value={r.date} onChange={function(e) { setRow({ date: e.target.value }); }} style={{ ...S.dateInput, width: "100%", boxSizing: "border-box" }} />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 6, marginTop: 6 }}>
                {DIR_QUICK_MIN.map(function(m) { return chip(r.minutes === m, dirFmtHM(m), function() { setRow({ minutes: m }); }, "m" + m, { textAlign: "center", fontFamily: "JetBrains Mono" }); })}
              </div>
              {rRow && rRow.detail && <input value={r.detail} maxLength={DIR_DETAIL_MAX} onChange={function(e) { setRow({ detail: e.target.value }); }} placeholder={DIR_DETAIL_HINT} style={{ ...S.dateInput, width: "100%", boxSizing: "border-box", marginTop: 6 }} />}
              <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>To change the activity, untick this row and log a new entry.</div>
            </div>}
          </div>);
        })}
        <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 10 }}>{on.length + " of " + screen.rows.length + " entries" + DOT + dirFmtHM(on.reduce(function(s, r) { return s + (dirMinutesOk(r.minutes) ? r.minutes : 0); }, 0))}</div>
        {probBox}
        <button onClick={saveRepeat} disabled={!on.length} style={btn({ ...primary, width: "100%", minHeight: 50, fontSize: 15, marginTop: 12, opacity: on.length ? 1 : 0.4 })}>{"Save " + on.length + " " + (on.length === 1 ? "entry" : "entries") + " to " + dirMonthLabel(ym).split(" ")[0]}</button>
      </div>
    </div>);
  }

  var count = dirHandoffCount(data, ym), curYm = today.slice(0, 7);
  var formDir = dirById(data, form.dirId), formMins = minutesOf(form);
  var saveLabel = formDir && formMins && isYMD(form.date) ? "Save " + dirFmtHM(formMins) + DOT + (formDir.shortName || formDir.name) + DOT + dayName(form.date) : "Save";
  return (<div style={S.page}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <button onClick={onBack} style={S.backBtn}>Back</button>
      <h1 style={{ ...S.title, marginBottom: 0, flex: 1 }}>Directorships</h1>
      {eyeBtn}
    </div>

    {dirs.length === 0 ? <div style={S.card}>
      <div style={{ fontSize: 13, color: "var(--text-muted)", lineHeight: 1.5 }}>No directorships - add or restore them in More &gt; Directorships.</div>
      <button onClick={onBack} style={btn({ width: "100%", marginTop: 10 })}>Back</button>
    </div> : <div>
      <div style={S.card}>
        <div style={S.cardLabel}>Log hours</div>
        <div style={{ marginTop: 10 }}>{renderFields(form, setForm, null, true)}</div>
        {probBox}
        <button onClick={saveNew} style={btn({ ...primary, width: "100%", minHeight: 50, fontSize: 15, marginTop: 14, opacity: formDir && form.category && formMins ? 1 : 0.5 })}>{saveLabel}</button>
      </div>

      <div style={S.card}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button onClick={function() { setYm(dirAddMonths(ym, -1)); }} aria-label="Previous month" style={btn({ width: 44, padding: 0, fontSize: 18 })}>{"<"}</button>
          <div style={{ flex: 1, textAlign: "center" }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: "var(--text-bright)" }}>{dirMonthLabel(ym)}</div>
            <div style={{ fontSize: 12, color: count.done < count.total ? "var(--text-muted)" : "var(--accent-green)" }}>{count.done + " of " + count.total + " handed off"}</div>
          </div>
          <button onClick={function() { setYm(dirAddMonths(ym, 1)); }} disabled={ym >= curYm} aria-label="Next month" style={btn({ width: 44, padding: 0, fontSize: 18, opacity: ym >= curYm ? 0.3 : 1 })}>{">"}</button>
        </div>
        {ym !== curYm && <button onClick={function() { setYm(curYm); }} style={{ ...S.linkBtn, display: "block", margin: "6px auto 0" }}>This month</button>}
        {msg && <div style={{ fontSize: 12, color: "var(--accent-green)", marginTop: 8, textAlign: "center" }}>{msg}</div>}
      </div>

      {dirs.map(function(dir) {
        var st = dirMonthStatus(data, dir.id, ym), model = dirFormModel(data, dir.id, ym, today);
        var list = dirMonthEntries(entries, dir.id, ym), weeks = dirWeekRanges(ym), cap = dirCapMinutes(dir);
        var pill = st.state === "handed" ? ["Handed off " + fmtShort(st.date), "var(--accent-green)"] : st.state === "changed" ? ["CHANGED SINCE HANDOFF", amber] : st.state === "progress" ? ["In progress", "var(--accent-sky)"] : ["No entries", "var(--text-faint)"];
        var prevN = dirMonthEntries(entries, dir.id, dirAddMonths(ym, -1)).length;
        var unplaced = list.filter(function(e) { return !dirRowByKey(dir.form, e.category); });
        var total = model.totalMinutes;
        return (<div key={dir.id} style={S.card}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ ...S.cardLabel }}>{dir.name}</div>
              {dir.org && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>{dir.org}</div>}
            </div>
            <span style={{ fontSize: 10, fontWeight: 700, padding: "3px 8px", borderRadius: 10, border: "1px solid " + pill[1], color: pill[1], whiteSpace: "nowrap" }}>{pill[0]}</span>
          </div>
          {st.state === "changed" && <div style={{ fontSize: 11, color: amber, marginTop: 6, lineHeight: 1.5 }}>{"Handed off " + fmtShort(st.date) + " - save the updated form to Drive again and delete the older copy."}</div>}
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline", marginTop: 8 }}>
            <span style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: model.overCap ? amber : "var(--text-primary)" }}>{dirFmtHM(total) + " (" + dirFmtHours(total) + " h)" + (cap !== null ? " of " + dirFmtHours(cap) + " h max" : "") + (model.overCap ? " - over cap, paid for " + dirFmtHours(cap) + " h" : "")}</span>
            <span style={{ fontSize: 14, fontWeight: 700, fontFamily: "JetBrains Mono", color: "var(--accent-green)" }}>{dirMoneyShown(model.amount, showComp)}</span>
          </div>
          {cap !== null && <div style={{ height: 6, borderRadius: 3, background: "var(--border-default)", marginTop: 6, overflow: "hidden" }}><div style={{ height: "100%", width: Math.min(100, total / cap * 100) + "%", background: model.overCap ? amber : "#0ea5e9" }} /></div>}
          {weeks.map(function(w) {
            var we = list.filter(function(e) { return dirWeekOf(e.date) === w.week && dirRowByKey(dir.form, e.category); });
            if (!we.length) return null;
            return (<div key={w.week} style={{ marginTop: 8 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 11, color: "var(--text-muted)" }}><span>{"W" + w.week + "  " + w.label}</span><span style={{ fontFamily: "JetBrains Mono" }}>{dirFmtHM(model.weekMinutes[w.week - 1])}</span></div>
              {we.map(function(e) {
                return (<button key={e.id} onClick={function() { openEdit(e); }} style={{ display: "flex", width: "100%", alignItems: "center", gap: 8, minHeight: 44, background: "none", border: "none", borderTop: "1px solid rgba(51,65,85,0.3)", padding: "2px 0 2px 10px", cursor: "pointer", textAlign: "left" }}>
                  <span style={{ fontSize: 12, color: "var(--text-muted)", width: 64, flexShrink: 0 }}>{dayName(e.date)}</span>
                  <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{catLabel(dir, e)}</span>
                  <span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: dirMinutesOk(e.minutes) ? "var(--text-primary)" : amber }}>{dirFmtHM(e.minutes)}</span>
                  <span style={{ color: "var(--text-faint)" }}>{">"}</span>
                </button>);
              })}
            </div>);
          })}
          {unplaced.length > 0 && <div style={{ marginTop: 8 }}>
            <div style={{ fontSize: 11, color: amber }}>Needs a category (not on this form - edit to re-pick)</div>
            {unplaced.map(function(e) { return (<button key={e.id} onClick={function() { openEdit(e); }} style={{ display: "flex", width: "100%", gap: 8, minHeight: 44, alignItems: "center", background: "none", border: "none", borderTop: "1px solid rgba(51,65,85,0.3)", padding: "2px 0 2px 10px", cursor: "pointer", textAlign: "left" }}><span style={{ fontSize: 12, color: "var(--text-muted)", width: 64 }}>{dayName(e.date)}</span><span style={{ flex: 1, fontSize: 12, color: amber }}>Needs a category</span><span style={{ fontSize: 12, fontFamily: "JetBrains Mono" }}>{dirFmtHM(e.minutes)}</span></button>); })}
          </div>}
          <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
            <button onClick={function() { setMsg(""); openScreen({ kind: "review", dirId: dir.id }); }} style={btn({ ...primary, flex: 1 })}>{"Review & Send"}</button>
            <button onClick={function() { toggleHandoff(dir); }} style={btn({ flex: 1, color: st.state === "handed" ? "var(--accent-green)" : "var(--text-muted)" })}>{st.state === "handed" ? "Handed off - clear" : st.state === "changed" ? "Mark handed off again" : "Mark handed off"}</button>
          </div>
          {prevN > 0 && <button onClick={function() { openRepeat(dir.id); }} style={{ ...S.linkBtn, display: "block", marginTop: 8, textAlign: "left", minHeight: 36 }}>
            Repeat last month
            <span style={{ display: "block", fontSize: 11, color: "var(--text-faint)", fontWeight: 400 }}>{dirMonthLabel(dirAddMonths(ym, -1)).split(" ")[0] + DOT + prevN + " " + (prevN === 1 ? "entry" : "entries")}</span>
          </button>}
        </div>);
      })}
    </div>}
  </div>);
}

// Review & Send: the attestation glance (every printed row, cell, total,
// the signature and the generation date) BEFORE any PDF exists, then the
// two-tap flow - Create PDF, then Save to Google Drive in its own tap (iOS
// opens the share sheet only inside a user gesture; the async work uses it
// up). The share payload is FILES ONLY. The PDF always prints the real Rate
// and Due; the screen masks them like every other screen until the eye is
// tapped. The decrypted signature lives only in this component's state,
// bound to the PIN that decrypted it.
function DirReview({ data, upd, dirId, ym, showComp, eye, onClose }) {
  // Today is state, refreshed by the 1 s check below: a screen left open
  // across midnight must not print yesterday as the signature date.
  const [today, setToday] = useState(todayLocal());
  const [sig, setSig] = useState({ state: "opening", url: "", pin: "" });
  const [sigTick, setSigTick] = useState(0);
  const [lib, setLib] = useState({ state: "loading", msg: "" });
  const [libTick, setLibTick] = useState(0);
  const [pdf, setPdf] = useState(null);           // { file, blob, name, kb, dirId, ym, hash, pinAt, shareFailed } - memory only
  const [msg, setMsg] = useState("");
  const [done, setDone] = useState("");           // "", "shared", "downloaded"
  const [padOpen, setPadOpen] = useState(false);
  const pdfRef = useRef(false), sharingRef = useRef(false);
  var hasSig = dirHasSignature(data), sigKey = dirSigKey(data);
  const sigRef = useRef(sig);
  sigRef.current = sig;
  var model = useMemo(function() { return dirFormModel(data, dirId, ym, today); }, [data, dirId, ym, today]);
  var dir = dirById(data, dirId);

  useEffect(function() {
    var live = true;
    setLib({ state: "loading", msg: "" });
    loadPDF().then(function() { if (live) setLib({ state: "ok", msg: "" }); }).catch(function(e) { if (live) setLib({ state: "error", msg: e && e.message ? e.message : "Could not load the PDF library." }); });
    return function() { live = false; };
  }, [libTick]);
  useEffect(function() {
    var live = true;
    setSig({ state: "opening", url: "", pin: "" });
    dirSignatureLoad(data).then(function(r) { if (live) setSig(r); });
    return function() { live = false; };
  }, [sigKey, sigTick]);
  // The decrypted image and a built PDF never outlive the PIN that opened
  // them (auto-lock or Forgot PIN only hide the app; this wipes them).
  useEffect(function() {
    var check = function() {
      var t0 = todayLocal();
      setToday(function(d) { return d === t0 ? d : t0; });   // same value = no re-render
      var s = sigRef.current;
      if (s.state === "ok" && !dirSigStillValid(s.pin)) { setPdf(null); setSig({ state: "locked", url: "", pin: "" }); }
      else if (s.state === "locked" && hasSig && dirPinNow()) setSigTick(function(t) { return t + 1; });
    };
    var t = setInterval(check, 1000);
    document.addEventListener("visibilitychange", check);
    return function() { clearInterval(t); document.removeEventListener("visibilitychange", check); };
  }, [hasSig]);
  // A ready PDF is a snapshot of the model: an entry or month change drops it
  // and the finished step; a date change (midnight) drops only an unsent PDF
  // - a finished download keeps its Mark handed off (same entries, same hash).
  useEffect(function() { setPdf(null); setDone(""); setMsg(""); }, [model.hash, dirId, ym]);
  useEffect(function() { setPdf(null); }, [model.generatedYMD]);

  // ---- Layout (pure numbers from a measuring jsPDF doc) ----
  var mkDoc = function(orientation) { var J = window.jspdf.jsPDF; return new J({ orientation: orientation, unit: "pt", format: "letter", compress: true, putOnlyUsedFonts: true }); };
  var hexRGB = function(h) { return [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)]; };
  var fill = function(doc, h) { var c = hexRGB(h); doc.setFillColor(c[0], c[1], c[2]); };
  var fitText = function(doc, text, width, font, style, sizes, maxLines) {
    for (var i = 0; i < sizes.length; i++) {
      doc.setFont(font, style); doc.setFontSize(sizes[i]);
      var lines = text ? doc.splitTextToSize(text, width) : [""];
      if (lines.length === 1 || (i === sizes.length - 1 && lines.length <= maxLines)) return { size: sizes[i], lines: lines, ok: true };
    }
    return { size: sizes[sizes.length - 1], lines: lines, ok: false };
  };
  // A free-text header/footer value is measured with the font, sizes and
  // width its draw call uses; one that can't fit on its line blocks the form
  // (the form never truncates - reachable only with edited Settings text).
  var hdrCheck = function(doc, flags, name, text, width, font, style, sizes) {
    if (!fitText(doc, text, width, font, style, sizes, 1).ok) flags.push({ level: "block", code: "layout", text: name + " is too long to print on its line - shorten it in Settings > Directorships." });
  };
  var G = { x0: 36, desc: 316, colW: 44, rowH: 11.1, top: 106, split: 165 };
  var fitGenesis = function(doc, m) {
    var flags = [], rows = [], extra = 0, grown = 0;
    // ONE "Meeting with | to discuss" split for all four Meeting rows: the
    // form's own split, moved right only as far as the longest detail needs
    // (the label shrinks to the floor first).
    doc.setFont("times", "normal"); doc.setFontSize(8);
    var maxSplit = G.desc - doc.getTextWidth("to discuss") - 8, split = G.split;
    m.rows.forEach(function(r) {
      if (r.key !== "g_meeting") return;
      var leftText = r.parts.pre + (r.parts.fill ? " " + r.parts.fill : "");
      if (!fitText(doc, leftText, G.split - G.x0 - 6, "times", "normal", [8, 7.5, 7, 6.5], 1).ok) {
        doc.setFont("times", "normal"); doc.setFontSize(6.5);
        split = Math.max(split, Math.min(maxSplit, G.x0 + 6 + doc.getTextWidth(leftText) + 2));
      }
    });
    m.rows.forEach(function(r, ri) {
      var isMeet = r.key === "g_meeting", label, right = null;
      if (isMeet) {
        label = fitText(doc, r.parts.pre + (r.parts.fill ? " " + r.parts.fill : ""), split - G.x0 - 6, "times", "normal", [8, 7.5, 7, 6.5], 2);
        right = r.parts.post;
      } else label = fitText(doc, r.text, G.desc - G.x0 - 6, "times", "normal", [8, 7.5, 7, 6.5], 2);
      var cells = r.cells.map(function(c) { return fitText(doc, c.datesText, G.colW - 4, "times", "normal", [8, 7.5, 7, 6.5], 4); });
      var lines = Math.max(label.lines.length, cells.reduce(function(a, c) { return Math.max(a, c.lines.length); }, 1));
      var h = lines <= 1 ? G.rowH : 2.5 + 6.5 * lines;
      if (!label.ok) flags.push({ level: "block", code: "layout", text: "Row '" + r.text.slice(0, 40) + "' holds more text than one page can print - shorten the details." });
      cells.forEach(function(c, w) { if (!c.ok) flags.push({ level: "block", code: "layout", text: "Row '" + r.text.slice(0, 40) + "' week " + (w + 1) + " holds more dates than one page can print - move entries." }); });
      if (h > G.rowH) { extra += h - G.rowH; grown++; }
      rows.push({ h: h, label: label, cells: cells, split: split, right: right });
    });
    var budget = 18 + 1.5 * (m.rows.length - grown), push = Math.min(extra, 18);
    if (extra > budget) {
      var tall = m.rows.filter(function(r, i) { return rows[i].h > G.rowH; }).map(function(r) { return "'" + (r.text.length > 34 ? r.text.slice(0, 33) + "..." : r.text) + "'"; });
      flags.push({ level: "block", code: "layout", text: "This month holds more dates and text than one page can print (rows " + tall.join(", ") + ") - shorten details or move entries. No date is ever dropped." });
    }
    var shrink = extra > 18 ? (extra - 18) / Math.max(1, m.rows.length - grown) : 0;
    rows.forEach(function(r) { if (r.h === G.rowH) r.h = G.rowH - shrink; });
    // Header + footer values (widths = drawGenesis: lab(), the footer boxes,
    // the signature-block Print Name line 169-360).
    doc.setFont("times", "bold"); doc.setFontSize(9.5);
    var wN = doc.getTextWidth("Medical Director's Name:"), wE = doc.getTextWidth("Empl #:");
    hdrCheck(doc, flags, "The Print Name", m.header.printName, 318 - (39 + wN + 4), "times", "normal", [9.5, 8.5, 7.5, 6.5]);
    hdrCheck(doc, flags, "Empl #", m.header.emplNo, 488 - (323 + wE + 4), "times", "normal", [9.5, 8.5, 7.5, 6.5]);
    hdrCheck(doc, flags, "Cost Ctr.", m.footer.costCtr, 448 - 362, "helvetica", "normal", [8]);
    hdrCheck(doc, flags, "The rate", m.footer.rate, 624 - 582, "helvetica", "normal", [8]);
    hdrCheck(doc, flags, "The signature-block Print Name", m.sig.printName, 360 - 169 - 2, "times", "normal", [10]);
    return { rows: rows, push: push, flags: flags };
  };
  var S_ = { x0: 30, x1: 582, left: 325, top: 172, bottomMax: 700, totalH: 38 };
  var S_MIN = [0, 0, 0, 0, 0, 24, 0, 0, 84, 66];
  var fitSelect = function(doc, m) {
    var flags = [], rowsOut = null, size = 8.5, keepMin = true;
    var build = function(sz, mins) {
      doc.setFont("helvetica", "normal"); doc.setFontSize(sz);
      var lead = sz * 1.18, out = [], sum = 0;
      m.rows.forEach(function(r, i) {
        // Row 9: its parenthetical prints bold (the reference form), so its
        // main text is wrapped with the (wider) bold font.
        var main = r.text, tail = "", boldRow = false;
        var k = main.indexOf("PROVIDE DESCRIPTION OF SERVICES:");
        if (i === 8 && k > 0) { tail = main.slice(k); main = main.slice(0, k).trim(); boldRow = main.indexOf("(") > 0; }
        if (boldRow) doc.setFont("helvetica", "bold");
        var mainLines = doc.splitTextToSize(main, 287);
        doc.setFont("helvetica", "normal");
        var lines = mainLines.concat(tail ? [tail] : []);
        var det = r.detailText ? doc.splitTextToSize(r.detailText, 281) : [];
        var moreLine = i === 9 ? 1 : 0;
        var h = 6 + (lines.length + det.length + moreLine) * lead + (det.length ? 2 : 0);
        if (mins && S_MIN[i]) h = Math.max(h, S_MIN[i]);
        out.push({ h: h, lines: lines, det: det, lead: lead, size: sz, boldN: boldRow ? mainLines.length : 0 });
        sum += h;
      });
      return { rows: out, sum: sum };
    };
    var room = S_.bottomMax - S_.totalH - S_.top;
    var b = build(size, true);
    if (b.sum > room) { b = build(size, false); keepMin = false; }
    while (b.sum > room && size > 6.5) { size = Math.round((size - 0.25) * 100) / 100; b = build(size, false); }
    if (b.sum > room) flags.push({ level: "block", code: "layout", text: "Row 9 or 10 holds more text than one page can print - shorten the descriptions." });
    rowsOut = b.rows;
    // Header values (widths = drawSelect: the centred program line, hl(),
    // the remit lines left of GL # / the black bar, GL #, Hospital #).
    hdrCheck(doc, flags, "The program type", "TYPE OF PROGRAM: " + m.header.programType, S_.x1 - S_.x0, "helvetica", "bold", [10]);
    [["HOSPITAL:", m.header.hospital, "The hospital name"], ["PHYSICIAN NAME:", m.header.physicianName, "The physician name"], ["CONTRACTING PARTY NAME:", m.header.contractingParty, "The contracting party"]].forEach(function(x) {
      hdrCheck(doc, flags, x[2], x[0] + " " + x[1], 340 - 60, "helvetica", "normal", [9, 8, 7, 6.5]);
    });
    hdrCheck(doc, flags, "Remit address line 1", m.header.remit[0], 355 - 150, "helvetica", "normal", [9]);
    hdrCheck(doc, flags, "Remit address line 2", m.header.remit[1], 355 - 150, "helvetica", "normal", [9]);
    hdrCheck(doc, flags, "GL #", m.header.glNo, S_.x1 - 416, "helvetica", "normal", [9]);
    hdrCheck(doc, flags, "Hospital #", m.header.hospitalNo, S_.x1 - 537, "helvetica", "normal", [9.5]);
    var tableBottom = S_.top + b.sum + S_.totalH;
    return { rows: rowsOut, tableBottom: tableBottom, off: Math.max(0, tableBottom - 666), flags: flags, keepMin: keepMin };
  };
  var layout = useMemo(function() {
    if (lib.state !== "ok") return null;
    try { var doc = mkDoc(model.form === "select" ? "portrait" : "landscape"); return model.form === "select" ? fitSelect(doc, model) : fitGenesis(doc, model); }
    catch (e) { return { flags: [{ level: "block", code: "layout", text: "Couldn't lay out the form - try again." }] }; }
  }, [lib.state, model]);

  // ---- Drawing ----
  var drawSig = function(doc, url, x0, y0, x1, y1) {
    var p = doc.getImageProperties(url), bw = x1 - x0, bh = y1 - y0 - 1;
    var k = Math.min(bw / p.width, bh / p.height), w = p.width * k, h = p.height * k;
    doc.addImage(url, "PNG", x0, y1 - 1 - h, w, h, "sig", "FAST");
  };
  var drawGenesis = function(doc, L, m, url) {
    var W = [0, 1, 2, 3, 4], blue = "#DBE5F1", peach = "#FDE9D9", wFill = function(w) { return w === 0 || w === 2 ? blue : peach; };
    var dc = function(w) { return G.desc + w * 2 * G.colW; }, du = function(w) { return dc(w) + G.colW; };
    doc.setTextColor(0, 0, 0); doc.setDrawColor(0, 0, 0);
    doc.setFont("times", "bold"); doc.setFontSize(10);
    doc.text(DIR_GENESIS_TITLE, 396, 30, { align: "center" }); doc.text(DIR_GENESIS_SUBTITLE, 396, 43, { align: "center" });
    // Header row 54-72
    doc.setFontSize(9.5);
    var lab = function(t, x, y, val, maxX) { doc.setFont("times", "bold"); doc.text(t, x, y); var w = doc.getTextWidth(t); doc.setFont("times", "normal"); var f = fitText(doc, val, maxX - (x + w + 4), "times", "normal", [9.5, 8.5, 7.5, 6.5], 1); doc.setFontSize(f.size); doc.text(f.lines[0] || "", x + w + 4, y); doc.setFontSize(9.5); };
    lab("Medical Director's Name:", 39, 66, m.header.printName, 318);
    lab("Empl #:", 323, 66, m.header.emplNo, 488);
    lab("Month/Year:", 512, 66, m.header.monthYear, 752);
    // Week headers + sub-headers (fills first, then text and rules)
    W.forEach(function(w) { fill(doc, wFill(w)); doc.rect(dc(w), 72, 2 * G.colW, 13, "F"); doc.rect(dc(w), 85, 2 * G.colW, 21, "F"); });
    doc.setFont("times", "bold"); doc.setFontSize(9.5); doc.text("Description of Medical Director Services", 39, 82);
    doc.setFont("times", "italic"); doc.text("(Include detail after the activity as appropriate)", 39, 98.5);
    W.forEach(function(w) {
      doc.setFont("times", "bold"); doc.setFontSize(7.5); doc.text("Week " + (w + 1), dc(w) + G.colW, 81.5, { align: "center" });
      doc.setFont("times", "normal"); doc.setFontSize(6.5);
      doc.text("Date", dc(w) + G.colW / 2, 93.5, { align: "center" }); doc.text("(m/d)", dc(w) + G.colW / 2, 101.5, { align: "center" });
      doc.text("Duration", du(w) + G.colW / 2, 93.5, { align: "center" }); doc.text("(h:mm)", du(w) + G.colW / 2, 101.5, { align: "center" });
    });
    // Activity rows
    var y = G.top;
    m.rows.forEach(function(r, ri) {
      var lr = L.rows[ri], h = lr.h;
      W.forEach(function(w) { fill(doc, wFill(w)); doc.rect(du(w), y, G.colW, h, "F"); });
      doc.setFont("times", "normal");
      doc.setFontSize(lr.label.size);
      var ty = y + (lr.label.lines.length > 1 ? 6.5 : 8.2);
      lr.label.lines.forEach(function(t, k) { doc.text(t, 39, ty + k * 6.5); });
      if (lr.right !== null) { doc.setFontSize(8); doc.text(lr.right, lr.split + 3, y + 8.2); doc.setLineWidth(0.75); doc.line(lr.split, y, lr.split, y + h); }
      // A one-line cell sits on the same baseline as its duration (centred in
      // a grown row); a wrapped date list starts at the top.
      var midY = y + Math.min(8.2, h - 2.9) + (h > G.rowH + 1 ? (h - G.rowH) / 2 : 0);
      W.forEach(function(w) {
        var c = lr.cells[w], cell = r.cells[w];
        if (cell.datesText) { doc.setFontSize(c.size); var cy = c.lines.length > 1 ? y + 6.5 : midY; c.lines.forEach(function(t, k) { doc.text(t, dc(w) + G.colW / 2, cy + k * 6.5, { align: "center" }); }); }
        if (cell.dur) { doc.setFontSize(8); doc.text(cell.dur, du(w) + G.colW / 2, midY, { align: "center" }); }
      });
      doc.setLineWidth(0.75); doc.line(G.x0, y + h, 756, y + h);
      y += h;
    });
    // Monthly total row
    var tt = y, th = 26;
    fill(doc, "#FFFF00"); doc.rect(G.x0, tt, G.desc - G.x0, th, "F");
    W.forEach(function(w) { if (w < 4) { fill(doc, wFill(w)); doc.rect(du(w), tt, G.colW, th, "F"); } });
    doc.setFont("times", "bold"); doc.setFontSize(11); doc.text("MONTHLY TOTAL", 39, tt + 12.2);
    doc.setFont("times", "normal"); doc.setFontSize(6); doc.text("(combined weekly totals)", 39, tt + 22.7);
    doc.setFont("times", "bold"); doc.setFontSize(8);
    W.forEach(function(w) { doc.text(m.weekText[w], du(w) + G.colW / 2, tt + 16.2, { align: "center" }); });
    var tb = tt + th;
    // Table rules
    doc.setLineWidth(0.75);
    [72, 85, 106].forEach(function(yy) { doc.line(G.x0, yy, 756, yy); });
    doc.line(G.x0, tt, 756, tt);
    doc.line(G.desc, 72, G.desc, tb);
    W.forEach(function(w) { doc.line(dc(w), 72, dc(w), tb); doc.line(du(w), 85, du(w), tb); });
    doc.line(492, 54, 492, 72);
    doc.setLineWidth(1.25); doc.rect(G.x0, 54, 720, tb - 54, "S");
    // Footer (moves with the growth push)
    var dy = tb - 387.3;
    fill(doc, "#BFBFBF"); doc.rect(38, tb, 278, 26.2, "F");
    fill(doc, "#FFFF99");
    [[360, 448], [492, 536], [580, 624], [668, 756]].forEach(function(f) { doc.rect(f[0], 389 + dy, f[1] - f[0], 12.5, "F"); });
    doc.rect(360, 402 + dy, 44, 11.5, "F");
    doc.setFont("helvetica", "normal"); doc.setFontSize(8);
    [["Cost Ctr.:", 358, m.footer.costCtr], ["Total Hrs.:", 490, m.footer.totalHrs], ["Rate:", 578, m.footer.rate], ["Due:", 666, m.footer.due]].forEach(function(f) {
      doc.setFont("helvetica", "normal"); doc.text(f[0], f[1], 398 + dy, { align: "right" }); doc.text(f[2], f[1] + 4, 398 + dy);
    });
    doc.text("Pay Code:", 358, 411 + dy, { align: "right" }); doc.setFont("helvetica", "bold"); doc.text(m.footer.payCode, 362, 411 + dy);
    // Certification (CERTIFICATION: in bold, the rest wrapped)
    doc.setFont("times", "normal"); doc.setFontSize(8);
    var certLines = doc.splitTextToSize(DIR_GENESIS_CERT, 678), lead = "CERTIFICATION:";
    certLines.forEach(function(t, k) {
      var yy = 422 + dy + k * 10;
      if (k === 0 && t.indexOf(lead) === 0) { doc.setFont("times", "bold"); doc.text(lead, 39, yy); var lw = doc.getTextWidth(lead + " "); doc.setFont("times", "normal"); doc.text(t.slice(lead.length).trim(), 39 + lw, yy); }
      else { doc.setFont("times", "normal"); doc.text(t, 39, yy); }
    });
    // Signature blocks: fill ONLY the Medical Director block
    [["Medical Director:", 462], ["Department Leader:", 499], ["COO or Executive:", 536]].forEach(function(b) {
      var by = b[1] + dy;
      doc.setFont("times", "bold"); doc.setFontSize(9.5); doc.text(b[0], 162, by, { align: "right" });
      doc.setLineWidth(0.75); doc.line(165, by + 4, 360, by + 4); doc.line(404, by + 4, 580, by + 4); doc.line(624, by + 4, 711, by + 4);
      doc.setFont("helvetica", "italic"); doc.setFontSize(7.5);
      doc.text("Print Name", 169, by + 12.5); doc.text("Signature", 411, by + 12.5); doc.text("Date", 627, by + 12.5);
    });
    doc.setFont("times", "normal"); doc.setFontSize(10);
    doc.text(m.sig.printName, 169, 463.5 + dy); doc.text(m.sig.date, 627, 463.5 + dy);
    drawSig(doc, url, 406, 437 + dy, 578, 465 + dy);
    doc.setFont("helvetica", "normal"); doc.setFontSize(7.5); doc.text(DIR_GENESIS_FOOTER, 28, 581);
  };
  var drawSelect = function(doc, L, m, url) {
    var wc = function(w) { return S_.left + (S_.x1 - S_.left) / 5 * (w + 0.5); }, wx = function(w) { return S_.left + (S_.x1 - S_.left) / 5 * w; };
    doc.setTextColor(0, 0, 0); doc.setDrawColor(0, 0, 0);
    doc.setFont("helvetica", "bold"); doc.setFontSize(10.5); doc.text(DIR_SELECT_TITLE, 306, 44, { align: "center" });
    doc.setFontSize(10); doc.text("TYPE OF PROGRAM: " + m.header.programType, 306, 60, { align: "center" });
    var hl = function(label, val, y) { doc.setFont("helvetica", "normal"); var f = fitText(doc, label + " " + val, 340 - 60, "helvetica", "normal", [9, 8, 7, 6.5], 1); doc.setFontSize(f.size); doc.text(f.lines[0], 60, y); };
    hl("HOSPITAL:", m.header.hospital, 78); hl("PHYSICIAN NAME:", m.header.physicianName, 88.5); hl("CONTRACTING PARTY NAME:", m.header.contractingParty, 99);
    doc.setFontSize(9); doc.text("Remit to Address:", 60, 109.5); doc.text(m.header.remit[0], 150, 109.5); doc.text(m.header.remit[1], 150, 120);
    doc.text("Total Amount Due:", 347, 79); doc.text(m.header.totalDue, 431, 79); doc.setLineWidth(0.75); doc.line(428, 81, 540, 81);
    doc.text("Total Hours:", 381, 97); doc.text(m.header.totalHours, 431, 97); doc.line(428, 99, 544, 99);
    doc.text("GL #:", 381, 115); doc.text(m.header.glNo, 416, 115);
    doc.setFillColor(0, 0, 0); doc.rect(359, 121, 159, 9, "F");
    doc.setTextColor(255, 255, 255); doc.setFontSize(7); doc.text("CHECK HERE IF NEW ADDRESS", 362, 128); doc.setTextColor(0, 0, 0);
    doc.rect(518, 121, 40, 9, "S");
    // Table header
    var runs = [["PERIOD:  ", "bold"], ["MONTH: ", "bold"], [m.header.periodMonth + " ", "normal"], ["YEAR: ", "bold"], [m.header.periodYear, "normal"]];
    doc.setFontSize(10); var tw = 0; runs.forEach(function(r) { doc.setFont("helvetica", r[1]); tw += doc.getTextWidth(r[0]); });
    var rx = 177.5 - tw / 2; runs.forEach(function(r) { doc.setFont("helvetica", r[1]); doc.text(r[0], rx, 143); rx += doc.getTextWidth(r[0]); });
    doc.setFont("helvetica", "normal"); doc.text("RESPONSIBILITIES / DUTIES", 177.5, 167, { align: "center" });
    doc.setFont("helvetica", "bold"); doc.setFontSize(7.5);
    m.weeks.forEach(function(w, i) { doc.text("WEEK " + w.week, wc(i), 139, { align: "center" }); doc.text(w.label, wc(i), 150, { align: "center" }); doc.text("# OF", wc(i), 160, { align: "center" }); doc.text("HOURS", wc(i), 168, { align: "center" }); });
    // Rows
    var y = S_.top;
    doc.setLineWidth(0.75); doc.line(S_.x0, y, S_.x1, y);
    m.rows.forEach(function(r, i) {
      var lr = L.rows[i];
      doc.setFont("helvetica", "normal"); doc.setFontSize(lr.size);
      var ly = y + 3 + lr.size * 0.85;
      var boldOn = false;   // bold from the "(" to the end of the main text
      lr.lines.forEach(function(t, k) {
        var yy = ly + k * lr.lead;
        if (k >= (lr.boldN || 0)) { doc.text(t, 34, yy); return; }
        var cut = boldOn ? 0 : t.indexOf("(");
        if (cut < 0) { doc.text(t, 34, yy); return; }
        boldOn = true;
        if (cut > 0) { var pre = t.slice(0, cut), preW = doc.getTextWidth(pre); doc.text(pre, 34, yy); doc.setFont("helvetica", "bold"); doc.text(t.slice(cut), 34 + preW, yy); }   // measure in the normal font, before the switch
        else { doc.setFont("helvetica", "bold"); doc.text(t, 34, yy); }
        doc.setFont("helvetica", "normal");
      });
      if (lr.det.length) { var dy0 = ly + lr.lines.length * lr.lead + 2; lr.det.forEach(function(t, k) { doc.text(t, 40, dy0 + k * lr.lead); }); }
      if (i === 9) doc.text(DIR_SELECT_MORE, 34, y + lr.h - 4);
      doc.setFontSize(9);
      r.cells.forEach(function(c, w) { if (c.dur) doc.text(c.dur, wc(w), y + lr.h / 2 + 3, { align: "center" }); });
      y += lr.h; doc.line(S_.x0, y, S_.x1, y);
    });
    // Totals row
    var tt = y;
    doc.setFont("helvetica", "bold"); doc.setFontSize(12); doc.text("TOTAL TIME SPENT ON DUTIES PER WEEK", 33, tt + 15);
    m.weeks.forEach(function(w, i) { doc.setFontSize(7.5); doc.text("WEEK " + w.week, wc(i), tt + 10, { align: "center" }); doc.setFontSize(10); doc.text(m.weekText[i], wc(i), tt + 29, { align: "center" }); });
    var tb = tt + S_.totalH;
    doc.line(S_.x0, tb, S_.x1, tb);
    doc.line(S_.left, 130, S_.left, tb);
    for (var w = 1; w < 5; w++) doc.line(wx(w), 130, wx(w), tb);
    doc.setLineWidth(1.25); doc.rect(S_.x0, 130, S_.x1 - S_.x0, tb - 130, "S");
    var off = Math.max(0, tb - 666);
    var at = fitText(doc, DIR_SELECT_ATTEST, 552, "helvetica", "normal", [9, 8.75, 8.5, 8, 7.5], 1);
    doc.setFont("helvetica", "normal"); doc.setFontSize(at.size); doc.text(at.lines[0], 306, 682 + off, { align: "center" });
    doc.setLineWidth(0.75);
    [[30, 205], [220, 285], [300, 440], [455, 520], [535, 582]].forEach(function(l) { doc.line(l[0], 722 + off, l[1], 722 + off); });
    doc.setFontSize(9.5);
    [["Signature of Physician", 30], ["Date", 220], ["Signature of Hospital CEO", 300], ["Date", 455], ["Hospital #", 535]].forEach(function(l) { doc.text(l[0], l[1], 733 + off); });
    doc.text(m.sig.date, 222, 719 + off); doc.text(m.header.hospitalNo, 537, 719 + off);
    drawSig(doc, url, 32, 692 + off, 203, 721 + off);
  };
  var buildPdfFile = function(m, L, url) {
    var doc = mkDoc(m.form === "select" ? "portrait" : "landscape");
    if (m.form === "select") drawSelect(doc, L, m, url); else drawGenesis(doc, L, m, url);
    doc.setProperties({ title: m.fileName.replace(/\.pdf$/, "") });
    var blob = doc.output("blob"), file = null;
    try { file = new File([blob], m.fileName, { type: "application/pdf" }); } catch (e) { file = null; }
    return { file: file, blob: blob };
  };

  var layoutFlags = layout && layout.flags ? layout.flags : [];
  var blocked = !model.ok || layoutFlags.some(function(f) { return f.level === "block"; });
  var canCreate = lib.state === "ok" && !!layout && sig.state === "ok" && !blocked;
  var createPdf = function() {
    if (pdfRef.current || !canCreate) return;
    if (!dirSigStillValid(sig.pin)) { setSig({ state: "locked", url: "", pin: "" }); setPdf(null); return; }
    var t1 = todayLocal();
    if (model.generatedYMD !== t1) { setToday(t1); return; }   // the date changed: show the new date and flags first
    pdfRef.current = true; setMsg("");
    try {
      var b = buildPdfFile(model, layout, sig.url);
      setPdf({ file: b.file, blob: b.blob, name: model.fileName, kb: Math.max(1, Math.round(b.blob.size / 1024)), dirId: model.dirId, ym: model.ym, hash: model.hash, pinAt: sig.pin, shareFailed: false });
    } catch (e) { setMsg("Couldn't create the PDF - try again. If it keeps failing, re-sign in Settings > Directorships."); }
    pdfRef.current = false;
  };
  var wipe = function() { setPdf(null); setSig({ state: "locked", url: "", pin: "" }); };
  // Tap 2 - runs directly from its own tap. FILES ONLY: no title, text or url.
  var sharePdf = function() {
    var p = pdf;
    if (!p || sharingRef.current || !canShareFile(p.file)) return;
    if (!dirSigStillValid(p.pinAt)) { wipe(); return; }
    var failed = function(e) {
      sharingRef.current = false;
      setPdf(function(cur) { return cur === p ? { ...p, shareFailed: true } : cur; });
      setMsg("Couldn't open the share sheet" + (e && e.name ? " (" + e.name + ")" : "") + " - download the PDF instead.");
    };
    sharingRef.current = true;
    try {
      navigator.share({ files: [p.file] }).then(function() {
        sharingRef.current = false;
        upd(function(prev) { return { ...prev, dirHandoff: dirHandoffMark(dirHandoffOf(prev), p.dirId, p.ym, todayLocal(), p.hash) }; });
        setPdf(null); setDone("shared"); setMsg("Saved. " + dirMonthLabel(p.ym) + " is marked handed off.");
      }).catch(function(e) { if (e && e.name === "AbortError") { sharingRef.current = false; return; } failed(e); });
    } catch (e) { failed(e); }
  };
  var downloadPdf = function() {
    var p = pdf;
    if (!p) return;
    if (!dirSigStillValid(p.pinAt)) { wipe(); return; }
    try { downloadBlob(p.blob, p.name); setDone("downloaded"); setMsg("Downloaded " + p.name + ". Save it to Google Drive, then tap Mark handed off."); }
    catch (e) { setMsg("Download failed - try again."); }
  };
  var markAfterDownload = function() {
    var p = pdf;
    var hash = dirEntriesHash(dirEntriesOf(data), p ? p.dirId : dirId, p ? p.ym : ym);
    upd(function(prev) { return { ...prev, dirHandoff: dirHandoffMark(dirHandoffOf(prev), p ? p.dirId : dirId, p ? p.ym : ym, todayLocal(), hash) }; });
    setPdf(null); setDone("shared"); setMsg(dirMonthLabel(ym) + " is marked handed off.");
  };

  // ---- Render ----
  var btn = function(extra) { return { minHeight: 44, padding: "0 14px", borderRadius: 8, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer", ...extra }; };
  var primary = { border: "none", background: "#0369a1", color: "#fff" };
  var amber = "var(--global-90)";
  var line = function(label, value, key) { return <div key={key} style={{ fontSize: 12, color: "var(--text-primary)", marginTop: 3, lineHeight: 1.45 }}><span style={{ fontWeight: 700 }}>{label}</span>{" " + (value === "" ? "(blank)" : value)}</div>; };
  var allFlags = model.flags.concat(layoutFlags);
  var strip = function(r) {
    return (<div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 2, marginTop: 4 }}>
      {r.cells.map(function(c, w) {
        var none = !model.weeks[w].label;
        return (<div key={w} style={{ minHeight: 30, padding: "2px 3px", borderRadius: 4, background: none ? "repeating-linear-gradient(45deg, transparent, transparent 3px, rgba(148,163,184,0.15) 3px, rgba(148,163,184,0.15) 6px)" : "rgba(148,163,184,0.08)" }}>
          <div style={{ fontSize: 9, color: "var(--text-faint)" }}>{"W" + (w + 1)}</div>
          <div style={{ fontSize: 11, fontFamily: "JetBrains Mono", color: "var(--text-primary)" }}>{c.dur}</div>
          {model.form === "genesis" && <div style={{ fontSize: 9, fontFamily: "JetBrains Mono", color: "var(--text-muted)", wordBreak: "break-word" }}>{c.datesText}</div>}
        </div>);
      })}
    </div>);
  };
  var sigPanel = (function() {
    if (padOpen || sig.state === "none") return (<div>
      {sig.state === "none" && !padOpen && <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No signature saved - draw one here or in More &gt; Directorships.</div>}
      <DirSignaturePad upd={upd} onSaved={function() { setPadOpen(false); setSigTick(function(t) { return t + 1; }); }} onCancel={sig.state === "none" ? null : function() { setPadOpen(false); }} />
    </div>);
    if (sig.state === "opening") return <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Opening signature...</div>;
    if (sig.state === "locked") return <div style={{ fontSize: 12, color: amber }}>Lock and unlock to use your signature.</div>;
    if (sig.state === "unreadable") return (<div>
      <div style={{ fontSize: 12, color: amber, lineHeight: 1.5 }}>Your saved signature can't be opened with this PIN (it was saved under a different PIN - after a PIN reset or on another phone). Draw it again.</div>
      <button onClick={function() { setPadOpen(true); }} style={btn({ marginTop: 6 })}>Re-sign</button>
    </div>);
    return (<div style={{ background: "#fff", borderRadius: 8, padding: 8, display: "flex", alignItems: "flex-end", justifyContent: "space-between", gap: 8 }}>
      <img src={sig.url} alt="Your signature" style={{ maxHeight: 60, maxWidth: "70%", pointerEvents: "none", WebkitTouchCallout: "none", userSelect: "none" }} />
      <span style={{ fontSize: 12, color: "#000", fontFamily: "JetBrains Mono" }}>{model.generatedText}</span>
    </div>);
  })();

  var h = model.header, f = model.footer;
  return (<div style={S.page}>
    <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 16 }}>
      <button onClick={onClose} style={S.backBtn}>Cancel</button>
      <h1 style={{ ...S.title, marginBottom: 0, flex: 1, fontSize: 20 }}>{"Review: " + (dir ? dir.name : "")}</h1>
      {eye}
    </div>
    <div style={S.card}>
      {model.form === "genesis" ? <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-bright)", textAlign: "center" }}>{DIR_GENESIS_TITLE}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-bright)", textAlign: "center", marginBottom: 6 }}>{DIR_GENESIS_SUBTITLE}</div>
        {line("Medical Director's Name:", h.printName, "n")}{line("Empl #:", h.emplNo, "e")}{line("Month/Year:", h.monthYear, "m")}
      </div> : <div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-bright)", textAlign: "center" }}>{DIR_SELECT_TITLE}</div>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-bright)", textAlign: "center", marginBottom: 6 }}>{"TYPE OF PROGRAM: " + h.programType}</div>
        {line("HOSPITAL:", h.hospital, "h")}{line("PHYSICIAN NAME:", h.physicianName, "p")}{line("CONTRACTING PARTY NAME:", h.contractingParty, "c")}
        {line("Remit to Address:", h.remit[0], "r0")}{h.remit[1] && line("", h.remit[1], "r1")}
        {line("Total Amount Due:", dirMoneyShown(model.amount, showComp), "td")}{line("Total Hours:", h.totalHours, "th")}{line("GL #:", h.glNo, "gl")}
        <div style={{ fontSize: 12, color: "var(--text-primary)", marginTop: 3 }}>{"[ ] CHECK HERE IF NEW ADDRESS"}</div>
        {line("PERIOD: MONTH:", h.periodMonth + " YEAR: " + h.periodYear, "pd")}
      </div>}
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>{"Weeks: " + model.weeks.map(function(w) { return "W" + w.week + " " + (w.label || "(no days)"); }).join("  ")}</div>
    </div>
    <div style={S.card}>
      <div style={S.cardLabel}>{model.form === "genesis" ? "Description of Medical Director Services" : "Responsibilities / Duties"}</div>
      {model.rows.map(function(r, i) {
        var has = r.minutes > 0;
        return (<div key={i} style={{ borderTop: "1px solid rgba(51,65,85,0.4)", padding: "6px 0", marginTop: i ? 0 : 6 }}>
          <div style={{ display: "flex", gap: 6 }}>
            <span style={{ fontSize: 10, color: "var(--text-faint)", width: 16, flexShrink: 0 }}>{i + 1}</span>
            <span style={{ flex: 1, fontSize: 12, lineHeight: 1.4, color: has ? "var(--text-primary)" : "var(--text-faint)" }}>{r.text}</span>
            {!has && <span style={{ fontSize: 10, color: "var(--text-faint)" }}>blank</span>}
          </div>
          {r.detailText && <div style={{ fontSize: 12, color: "var(--text-primary)", margin: "2px 0 0 22px" }}>{r.detailText}</div>}
          {has && <div style={{ marginLeft: 22 }}>{strip(r)}</div>}
        </div>);
      })}
      {model.form === "select" && <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>{DIR_SELECT_MORE}</div>}
      <div style={{ borderTop: "1px solid rgba(51,65,85,0.6)", marginTop: 6, paddingTop: 6 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)" }}>{model.form === "genesis" ? "MONTHLY TOTAL (combined weekly totals)" : "TOTAL TIME SPENT ON DUTIES PER WEEK"}</div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 2, marginTop: 4 }}>
          {model.weekText.map(function(t, w) { return <div key={w} style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "var(--text-primary)" }}>{t || "-"}</div>; })}
        </div>
      </div>
    </div>
    <div style={S.card}>
      {model.form === "genesis" && <div>
        {line("Cost Ctr.:", f.costCtr, "cc")}{line("Pay Code:", f.payCode, "pc")}
        {line("Total Hrs.:", f.totalHrs, "tr")}{line("Rate:", dirMoneyShown(model.rate, showComp), "rt")}{line("Due:", dirMoneyShown(model.amount, showComp), "du")}
      </div>}
      {!showComp && <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>Tap the eye to check the amount before creating the PDF (the PDF always prints the real amount).</div>}
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>{model.form === "genesis" ? DIR_GENESIS_CERT : DIR_SELECT_ATTEST}</div>
      <div style={{ fontSize: 12, fontWeight: 700, color: "var(--text-primary)", marginTop: 10 }}>{(model.form === "genesis" ? "Medical Director: " : "Signature of Physician - ") + model.sig.printName}</div>
      <div style={{ marginTop: 6 }}>{sigPanel}</div>
      {model.form === "genesis" ? <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>Department Leader: (blank) - COO or Executive: (blank)</div>
        : <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>{"Signature of Hospital CEO: (blank) - Hospital #: " + (h.hospitalNo || "(blank)")}</div>}
    </div>
    <div style={S.card}>
      {allFlags.map(function(fl, i) { return <div key={i} style={{ fontSize: 12, lineHeight: 1.5, marginTop: i ? 4 : 0, color: fl.level === "block" ? "var(--accent-red)" : fl.level === "warn" ? amber : "var(--text-muted)" }}>{(fl.level === "block" ? "x " : fl.level === "warn" ? "! " : "i ") + fl.text}</div>; })}
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: allFlags.length ? 8 : 0, wordBreak: "break-word" }}>{"File: " + (model.fileName || "(none)")}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{"Generated: " + model.generatedText}</div>
      {lib.state === "loading" && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8 }}>Preparing form...</div>}
      {lib.state === "error" && <div style={{ marginTop: 8 }}>
        <div style={{ fontSize: 12, color: amber }}>{lib.msg}</div>
        <button onClick={function() { setLibTick(function(t) { return t + 1; }); }} style={btn({ marginTop: 6 })}>Retry</button>
      </div>}
      {!pdf && done !== "shared" && <button onClick={createPdf} disabled={!canCreate} style={btn({ ...primary, width: "100%", minHeight: 50, fontSize: 15, marginTop: 12, opacity: canCreate ? 1 : 0.4 })}>Create PDF</button>}
      {pdf && <div style={{ marginTop: 12 }}>
        <div style={{ fontSize: 12, color: "var(--text-primary)", wordBreak: "break-word" }}>{"Ready: " + pdf.name + " (" + pdf.kb + " KB)"}</div>
        {canShareFile(pdf.file) && !pdf.shareFailed && <div>
          <button onClick={sharePdf} style={btn({ ...primary, width: "100%", minHeight: 50, fontSize: 15, marginTop: 8 })}>Save to Google Drive</button>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Choose Drive in the share sheet and keep the file name as is.</div>
        </div>}
        {(!canShareFile(pdf.file) || finePointer() || pdf.shareFailed) && done !== "downloaded" && <button onClick={downloadPdf} style={btn({ width: "100%", marginTop: 8 })}>Download PDF</button>}
        {done === "downloaded" && <button onClick={markAfterDownload} style={btn({ ...primary, width: "100%", marginTop: 8 })}>Mark handed off</button>}
        <button onClick={function() { setPdf(null); setDone(""); setMsg(""); }} style={{ ...S.linkBtn, display: "block", marginTop: 8 }}>Cancel</button>
      </div>}
      {/* An auto-lock drops the PDF after a download; marking needs neither the PDF nor the signature. */}
      {!pdf && done === "downloaded" && <button onClick={markAfterDownload} style={btn({ ...primary, width: "100%", marginTop: 8 })}>Mark handed off</button>}
      {msg && <div style={{ fontSize: 12, color: done === "shared" ? "var(--accent-green)" : done === "downloaded" ? "var(--text-primary)" : amber, marginTop: 8, lineHeight: 1.5 }}>{msg}</div>}
    </div>
  </div>);
}

// More (Settings) card: the directorships list and editor, restore lines,
// and the signature (pad, preview, Re-sign, Remove). No $ shown here.
function DirectorshipsCard({ data, upd, openDirectorships, showUndo }) {
  var dirs = dirList(data), entries = dirEntriesOf(data), ym = todayLocal().slice(0, 7);
  const [edit, setEdit] = useState(null);        // { origId | null, d: raw strings, errors: [] }
  const [sig, setSig] = useState({ state: "none", url: "", pin: "" });
  const [sigTick, setSigTick] = useState(0);
  const [padOpen, setPadOpen] = useState(false);
  var hasSig = dirHasSignature(data), sigKey = dirSigKey(data);
  const sigRef = useRef(sig);
  sigRef.current = sig;
  // Keyed on the stored ciphertext itself: a restore that replaces the
  // signature re-opens it instead of showing the old image.
  useEffect(function() {
    var live = true;
    if (!hasSig) { setSig({ state: "none", url: "", pin: "" }); return function() { live = false; }; }
    setSig({ state: "opening", url: "", pin: "" });
    dirSignatureLoad(data).then(function(r) { if (live) setSig(r); });
    return function() { live = false; };
  }, [sigKey, sigTick]);
  useEffect(function() {
    if (!hasSig) return undefined;
    var t = setInterval(function() {
      var s = sigRef.current;
      if (s.state === "ok" && !dirSigStillValid(s.pin)) setSig({ state: "locked", url: "", pin: "" });
      else if (s.state === "locked" && dirPinNow()) setSigTick(function(x) { return x + 1; });
    }, 1000);
    return function() { clearInterval(t); };
  }, [hasSig]);

  var btn = function(extra) { return { minHeight: 44, padding: "0 14px", borderRadius: 8, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer", ...extra }; };
  var amber = "var(--global-90)";
  var draftOf = function(x) {
    var hdr = x && x.selectHeader ? x.selectHeader : {}, ra = Array.isArray(hdr.remitAddress) ? hdr.remitAddress : [];
    var s = function(v) { return typeof v === "string" ? v : typeof v === "number" ? String(v) : ""; };
    return { name: s(x && x.name), shortName: s(x && x.shortName), org: s(x && x.org), printName: s(x && x.printName), form: x ? x.form : "", emplNo: s(x && x.emplNo), costCtr: s(x && x.costCtr),
      rate: x && x.rate ? String(x.rate) : "", maxHours: x && x.maxHours ? String(x.maxHours) : "", hospital: s(hdr.hospital), programType: s(hdr.programType), physicianName: s(hdr.physicianName),
      contractingParty: s(hdr.contractingParty), remit1: s(ra[0]), remit2: s(ra[1]), glNo: s(hdr.glNo), hospitalNo: s(hdr.hospitalNo) };
  };
  var openEdit = function(x) { if (showUndo) showUndo(null); setEdit({ origId: x ? x.id : null, d: x ? draftOf(x) : { ...draftOf(null), printName: dirs.length ? dirs[0].printName : "" }, errors: [] }); };
  var setD = function(k, v) { setEdit(function(e) { return e ? { ...e, d: { ...e.d, [k]: v } } : e; }); };
  var save = function() {
    var orig = edit.origId ? dirById(data, edit.origId) : null;
    var r = dirFromEditorDraft(dirs, orig, edit.d);
    if (!r.dir) { setEdit(function(e) { return { ...e, errors: r.errors }; }); return; }
    var n = orig ? dirFormInUse(entries, orig.id) : 0;
    if (orig && orig.form !== r.dir.form && n > 0 && !confirm("Change " + orig.name + " to the " + (r.dir.form === "select" ? "Select" : "Genesis") + " form? Its " + n + " " + (n === 1 ? "entry keeps its" : "entries keep their") + " " + (orig.form === "select" ? "Select" : "Genesis") + " " + (n === 1 ? "category" : "categories") + " and must be re-picked before a form can include " + (n === 1 ? "it" : "them") + ".")) return;
    var d = r.dir;
    upd(function(prev) { var l = dirList(prev); return { ...prev, directorships: orig ? l.map(function(x) { return x.id === orig.id ? d : x; }) : l.concat([d]) }; });
    setEdit(null);
  };
  var remove = function() {
    var orig = dirById(data, edit.origId);
    if (!orig) return;
    var n = dirFormInUse(entries, orig.id), h = Object.keys(dirHandoffOf(data)).filter(function(k) { return k.slice(0, k.lastIndexOf(":")) === orig.id; }).length;
    var builtIn = DIRECTORSHIP_PRESET.some(function(p) { return p.id === orig.id; });
    var msg = "Remove " + orig.name + "?" + (n || h ? " Its " + n + " time " + (n === 1 ? "entry" : "entries") + " and " + h + " hand-off " + (h === 1 ? "record are" : "records are") + " kept" + (builtIn ? " and come back if you restore it." : " but can't be reattached - delete them from Settings afterwards.") : "");
    if (!confirm(msg)) return;
    var res = dirRemove({ directorships: dirs }, orig.id);
    upd(function(prev) { return dirRemove(prev, orig.id).next; });
    setEdit(null);
    if (showUndo) showUndo({ type: "dirRemove", removed: res.removed, at: res.at, message: "Removed " + orig.name });
  };

  var orphans = dirOrphanCount(data), missing = dirMissingBuiltIns(data);
  var field = function(label, k, extra) {
    var err = edit.errors.filter(function(e) { return e.field === k; })[0];
    return (<div key={k} style={{ marginTop: 8, ...(extra || {}) }}>
      <div style={{ ...S.fieldLabel, marginBottom: 3 }}>{label}</div>
      <input value={edit.d[k]} inputMode={k === "rate" || k === "maxHours" ? "decimal" : undefined} onChange={function(e) { setD(k, e.target.value); }} style={{ ...S.dateInput, width: "100%", boxSizing: "border-box", borderColor: err ? "#ef4444" : undefined }} />
      {err && <div style={{ fontSize: 11, color: "var(--accent-red)", marginTop: 2 }}>{err.text}</div>}
    </div>);
  };
  var renderEditor = function() {
    var orig = edit.origId ? dirById(data, edit.origId) : null, d = edit.d;
    var note = orig ? dirFileNameNote(orig, d, ym, data) : "", fname = dirFileName({ name: dirAsciiPunct(d.name).trim(), printName: dirAsciiPunct(d.printName).trim() }, ym);
    var n = orig ? dirFormInUse(entries, orig.id) : 0, formErr = edit.errors.filter(function(e) { return e.field === "form"; })[0];
    return (<div style={{ border: "1px solid rgba(14,165,233,0.4)", borderRadius: 10, padding: 12, marginTop: 10 }}>
      {field("Name", "name")}{field("Short name", "shortName")}{field("Organization", "org")}{field("Print name", "printName")}
      <div style={{ ...S.fieldLabel, marginTop: 10, marginBottom: 3 }}>Form</div>
      <div style={{ display: "flex", gap: 6 }}>
        {[["genesis", "Genesis"], ["select", "Select"]].map(function(o) { var on = d.form === o[0]; return <button key={o[0]} onClick={function() { setD("form", o[0]); }} style={btn({ flex: 1, border: on ? "1px solid rgba(14,165,233,0.6)" : "1px solid var(--border-default)", background: on ? "rgba(14,165,233,0.15)" : "transparent", color: on ? "var(--accent-sky)" : "var(--text-muted)" })}>{o[1]}</button>; })}
      </div>
      {formErr && <div style={{ fontSize: 11, color: "var(--accent-red)", marginTop: 2 }}>{formErr.text}</div>}
      {orig && d.form && d.form !== orig.form && n > 0 && <div style={{ fontSize: 11, color: amber, marginTop: 4, lineHeight: 1.5 }}>{n + " " + (n === 1 ? "entry uses" : "entries use") + " " + (orig.form === "select" ? "Select" : "Genesis") + " rows. After the change they show under Needs a category, and forms that include them are blocked until you re-pick each one."}</div>}
      {d.form === "genesis" && <div style={{ display: "flex", gap: 8 }}>{field("Empl #", "emplNo", { flex: 1 })}{field("Cost Ctr.", "costCtr", { flex: 1 })}</div>}
      <div style={{ display: "flex", gap: 8 }}>{field("Rate ($/h)", "rate", { flex: 1 })}{field("Max h/month", "maxHours", { flex: 1 })}</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4 }}>Rate and max hours apply to every month you generate, including past months.</div>
      {d.form === "select" && <div>
        {field("Hospital", "hospital")}{field("Program type", "programType")}{field("Physician name", "physicianName")}{field("Contracting party", "contractingParty")}
        {field("Remit line 1", "remit1")}{field("Remit line 2", "remit2")}
        <div style={{ display: "flex", gap: 8 }}>{field("GL #", "glNo", { flex: 1 })}{field("Hospital #", "hospitalNo", { flex: 1 })}</div>
      </div>}
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, wordBreak: "break-word" }}>{"File: " + (fname || "(needs a name and a Print Name with a surname)")}</div>
      {note && <div style={{ fontSize: 11, color: amber, marginTop: 4, lineHeight: 1.5, wordBreak: "break-word" }}>{"! " + note + " Forms already saved to Drive don't change - regenerate a month if needed."}</div>}
      <div style={{ display: "flex", gap: 8, marginTop: 12 }}>
        <button onClick={save} style={btn({ flex: 1, border: "none", background: "#0369a1", color: "#fff" })}>Save</button>
        <button onClick={function() { setEdit(null); }} style={btn({ flex: 1 })}>Cancel</button>
        {orig && <button onClick={remove} style={btn({ color: "var(--accent-red)", border: "1px solid rgba(239,68,68,0.3)" })}>Remove</button>}
      </div>
    </div>);
  };

  var thisMonth = entries.filter(function(e) { return e && typeof e.date === "string" && e.date.slice(0, 7) === ym; }).length;
  return (<div style={S.card}>
    <div style={S.cardLabel}>Directorships</div>
    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6, lineHeight: 1.5 }}>Monthly signed time sheets, saved to Google Drive. Separate from wRVUs and Comp.</div>
    <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>{dirs.length + " " + (dirs.length === 1 ? "directorship" : "directorships") + " - " + thisMonth + " " + (thisMonth === 1 ? "entry" : "entries") + " in " + dirMonthLabel(ym).split(" ")[0]}</div>
    <button onClick={function() { if (openDirectorships) openDirectorships("settings"); }} style={{ marginTop: 8, minHeight: 44, width: "100%", borderRadius: 8, border: "1px solid rgba(14,165,233,0.3)", background: "rgba(14,165,233,0.06)", color: "var(--accent-sky)", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Open Directorships</button>
    {dirs.length === 0 && <div style={{ marginTop: 10 }}>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>No directorships.</div>
      <button onClick={function() { upd(function(prev) { return dirRestoreBuiltIns(prev); }); }} style={btn({ width: "100%", marginTop: 6, color: "var(--accent-sky)", border: "1px solid rgba(14,165,233,0.3)" })}>Restore built-in directorships</button>
    </div>}
    {dirs.map(function(x) {
      if (edit && edit.origId === x.id) return <div key={x.id}>{renderEditor()}</div>;
      return (<div key={x.id} style={{ display: "flex", alignItems: "center", gap: 8, borderTop: "1px solid rgba(51,65,85,0.4)", marginTop: 8, paddingTop: 8 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>{x.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{(x.form === "select" ? "Select" : "Genesis") + " form - max " + (x.maxHours ? dirFmtHours(Math.round(x.maxHours * 60)) : "?") + " h/month"}</div>
        </div>
        <button onClick={function() { openEdit(x); }} disabled={!!edit} style={btn({ opacity: edit ? 0.4 : 1 })}>Edit</button>
      </div>);
    })}
    {missing.map(function(p) {
      if (dirNameTaken(data, p.name)) return <div key={p.id} style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>{"To restore " + p.name + " (and its earlier hours), first rename or remove the other directorship with that name."}</div>;
      return <button key={p.id} onClick={function() { upd(function(prev) { return dirRestoreBuiltIn(prev, p.id); }); }} style={{ ...S.linkBtn, display: "block", marginTop: 8, minHeight: 36 }}>{"Restore " + p.name}</button>;
    })}
    {orphans > 0 && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 8, lineHeight: 1.5 }}>
      {orphans + " time " + (orphans === 1 ? "entry belongs" : "entries belong") + " to a removed directorship. "}
      <button onClick={function() { if (confirm("Delete " + orphans + " time " + (orphans === 1 ? "entry" : "entries") + " of removed directorships? This can't be undone.")) upd(function(prev) { return dirDropOrphans(prev); }); }} style={btn({ color: "var(--accent-red)", border: "1px solid rgba(239,68,68,0.3)", minHeight: 36, marginLeft: 4 })}>Delete them</button>
    </div>}
    {edit && edit.origId === null && renderEditor()}
    {!edit && <button onClick={function() { openEdit(null); }} style={btn({ width: "100%", marginTop: 10 })}>+ Add directorship</button>}

    <div style={{ ...S.fieldLabel, marginTop: 14 }}>Signature</div>
    {(!hasSig || padOpen) ? <DirSignaturePad upd={upd} onSaved={function() { setPadOpen(false); setSigTick(function(t) { return t + 1; }); }} onCancel={hasSig ? function() { setPadOpen(false); } : null} /> : <div>
      <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Saved, encrypted with your PIN.</div>
      {sig.state === "opening" && <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 6 }}>Opening signature...</div>}
      {sig.state === "locked" && <div style={{ fontSize: 12, color: amber, marginTop: 6 }}>Lock and unlock to use your signature.</div>}
      {sig.state === "unreadable" && <div style={{ fontSize: 12, color: amber, marginTop: 6, lineHeight: 1.5 }}>Your saved signature can't be opened with this PIN (it was saved under a different PIN - after a PIN reset or on another phone). Draw it again.</div>}
      {sig.state === "ok" && <div style={{ background: "#fff", borderRadius: 8, padding: 8, marginTop: 6 }}><img src={sig.url} alt="Your signature" style={{ maxHeight: 60, maxWidth: "100%", pointerEvents: "none", WebkitTouchCallout: "none", userSelect: "none" }} /></div>}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={function() { setPadOpen(true); }} style={btn({ flex: 1 })}>Re-sign</button>
        <button onClick={function() { if (confirm("Remove your saved signature? Forms can't be created until you draw it again.")) dirSignatureRemove(upd); }} style={btn({ flex: 1, color: "var(--accent-red)", border: "1px solid rgba(239,68,68,0.3)" })}>Remove</button>
      </div>
    </div>}
  </div>);
}

// The signature pad: a canvas with pointer events (touch-safe; the page
// never scrolls while drawing), black ink on white whatever the theme.
// Save crops to the ink, fits it into 600 x 200 and stores it encrypted
// (utils.js dirSignatureSave). No library.
function DirSignaturePad({ upd, onSaved, onCancel }) {
  const canvasRef = useRef(null);
  const strokes = useRef([]);                     // [[{x, y}, ...], ...] in CSS px
  const drawing = useRef(false);
  const activeId = useRef(null);                  // the pointer drawing the open stroke (others are ignored)
  const pinRef = useRef(null);                    // the PIN active at the first stroke
  const busyRef = useRef(false);
  const [points, setPoints] = useState(0);
  const [msg, setMsg] = useState("");
  var paint = function() {
    var c = canvasRef.current;
    if (!c) return;
    var dpr = window.devicePixelRatio || 1, w = c.clientWidth, h = 140;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) { c.width = Math.round(w * dpr); c.height = Math.round(h * dpr); }
    var g = c.getContext("2d");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.fillStyle = "#fff"; g.fillRect(0, 0, w, h);
    g.strokeStyle = "#000"; g.lineWidth = 2.2; g.lineCap = "round"; g.lineJoin = "round";
    strokes.current.forEach(function(s) {
      if (!s.length) return;
      g.beginPath(); g.moveTo(s[0].x, s[0].y);
      if (s.length === 1) g.lineTo(s[0].x + 0.1, s[0].y + 0.1);
      for (var i = 1; i < s.length; i++) g.lineTo(s[i].x, s[i].y);
      g.stroke();
    });
  };
  // Unsaved strokes are the plaintext signature too: they never outlive the
  // PIN that was active when drawing started (auto-lock / Forgot PIN only
  // hide the app), so they are wiped within a second of a lock.
  var wipeStrokes = function() { strokes.current = []; drawing.current = false; activeId.current = null; pinRef.current = null; setPoints(0); setMsg(""); paint(); };
  useEffect(function() {
    paint();
    var onResize = function() { paint(); };
    var check = function() { if (strokes.current.length && !dirSigStillValid(pinRef.current)) wipeStrokes(); };
    var t = setInterval(check, 1000);
    window.addEventListener("resize", onResize);
    document.addEventListener("visibilitychange", check);
    return function() { clearInterval(t); window.removeEventListener("resize", onResize); document.removeEventListener("visibilitychange", check); };
  }, []);
  var pos = function(e) { var r = canvasRef.current.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  var down = function(e) {
    if (drawing.current || e.isPrimary === false || (e.button !== undefined && e.button !== 0)) return;
    e.preventDefault();
    if (!strokes.current.length) pinRef.current = dirPinNow();
    if (!pinRef.current) { setMsg("Lock and unlock to sign."); return; }
    activeId.current = e.pointerId;
    try { canvasRef.current.setPointerCapture(e.pointerId); } catch (x) {}
    drawing.current = true; strokes.current.push([pos(e)]); paint();
  };
  var move = function(e) {
    if (!drawing.current || e.pointerId !== activeId.current) return;
    e.preventDefault();
    var s = strokes.current[strokes.current.length - 1], list = e.nativeEvent && e.nativeEvent.getCoalescedEvents ? e.nativeEvent.getCoalescedEvents() : [];
    if (!list || !list.length) list = [e];
    list.forEach(function(p) { s.push(pos(p)); });
    paint();
  };
  var up = function(e) {
    if (!drawing.current || (e && e.pointerId !== activeId.current)) return;
    drawing.current = false; activeId.current = null;
    setPoints(strokes.current.reduce(function(n, s) { return n + s.length; }, 0));
  };
  var clear = function() { wipeStrokes(); };
  var save = function() {
    if (busyRef.current || points < 2) return;
    if (!dirSigStillValid(pinRef.current)) { wipeStrokes(); setMsg("Lock and unlock to save your signature."); return; }
    var all = [].concat.apply([], strokes.current);
    var minX = Math.min.apply(null, all.map(function(p) { return p.x; })) - 8, maxX = Math.max.apply(null, all.map(function(p) { return p.x; })) + 8;
    var minY = Math.min.apply(null, all.map(function(p) { return p.y; })) - 8, maxY = Math.max.apply(null, all.map(function(p) { return p.y; })) + 8;
    var size = dirSigExportSize(maxX - minX, maxY - minY);
    if (!size.w || !size.h) return;
    var k = size.w / (maxX - minX), out = document.createElement("canvas");
    out.width = size.w; out.height = size.h;
    var g = out.getContext("2d");
    g.strokeStyle = "#000"; g.lineWidth = Math.max(1.2, 2.2 * k); g.lineCap = "round"; g.lineJoin = "round";
    strokes.current.forEach(function(s) {
      g.beginPath(); g.moveTo((s[0].x - minX) * k, (s[0].y - minY) * k);
      if (s.length === 1) g.lineTo((s[0].x - minX) * k + 0.1, (s[0].y - minY) * k + 0.1);
      for (var i = 1; i < s.length; i++) g.lineTo((s[i].x - minX) * k, (s[i].y - minY) * k);
      g.stroke();
    });
    busyRef.current = true; setMsg("Saving...");
    dirSignatureSave(out.toDataURL("image/png"), upd).then(function(r) {
      busyRef.current = false;
      if (r === "saved") { setMsg(""); strokes.current = []; pinRef.current = null; setPoints(0); if (onSaved) onSaved(); }
      else setMsg(r === "locked" ? "Lock and unlock to save your signature." : r === "bad" ? "That signature is too large - draw it a little smaller." : "Couldn't save the signature - try again.");
    });
  };
  var b = { minHeight: 44, padding: "0 14px", borderRadius: 8, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 13, fontWeight: 600, cursor: "pointer" };
  return (<div>
    <canvas ref={canvasRef} onPointerDown={down} onPointerMove={move} onPointerUp={up} onPointerCancel={up} onLostPointerCapture={up}
      style={{ display: "block", width: "100%", height: 140, background: "#fff", borderRadius: 8, border: "1px solid var(--border-default)", touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", overscrollBehavior: "contain" }} />
    <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 4 }}>Sign with your finger. It is stored encrypted with your PIN.</div>
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
      <button onClick={clear} style={{ ...b, flex: 1 }}>Clear</button>
      <button onClick={save} disabled={points < 2} style={{ ...b, flex: 1, border: "none", background: "#0369a1", color: "#fff", opacity: points < 2 ? 0.4 : 1 }}>Save signature</button>
      {onCancel && <button onClick={onCancel} style={b}>Cancel</button>}
    </div>
    {msg && <div style={{ fontSize: 12, color: "var(--global-90)", marginTop: 6 }}>{msg}</div>}
  </div>);
}
