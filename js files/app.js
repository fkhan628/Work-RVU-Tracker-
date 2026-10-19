class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null, errorInfo: null };
  }
  static getDerivedStateFromError(error) {
    return { hasError: true, error: error };
  }
  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo: errorInfo });
    console.error("ErrorBoundary caught in [" + (this.props.name || "unknown") + "]:", error, errorInfo);
  }
  render() {
    if (this.state.hasError) {
      var self = this;
      var name = this.props.name || "this section";
      var onRetry = this.props.onRetry;
      var onReset = this.props.onReset;
      return React.createElement("div", { style: { padding: 24, textAlign: "center", color: "var(--text-primary)", fontFamily: "'DM Sans', sans-serif" } },
        React.createElement("div", { style: { fontSize: 36, marginBottom: 12 } }, "\u26A0\uFE0F"),
        React.createElement("div", { style: { fontSize: 16, fontWeight: 600, marginBottom: 8 } }, "Something went wrong in " + name),
        React.createElement("div", { style: { fontSize: 13, color: "var(--text-muted)", marginBottom: 16, maxWidth: 300, margin: "0 auto 16px" } },
          "The rest of the app is still working. You can retry or go to another tab."
        ),
        this.state.error && React.createElement("details", { style: { fontSize: 11, color: "var(--text-dim)", marginBottom: 16, textAlign: "left", maxWidth: 320, margin: "0 auto 16px", background: "var(--bg-card)", padding: 12, borderRadius: 8, border: "1px solid var(--border-default)" } },
          React.createElement("summary", { style: { cursor: "pointer", marginBottom: 6 } }, "Error details"),
          React.createElement("pre", { style: { whiteSpace: "pre-wrap", wordBreak: "break-all", fontFamily: "'JetBrains Mono', monospace", fontSize: 10 } },
            String(this.state.error) + "\n" + (this.state.errorInfo ? this.state.errorInfo.componentStack : "")
          )
        ),
        React.createElement("div", { style: { display: "flex", gap: 10, justifyContent: "center", flexWrap: "wrap" } },
          React.createElement("button", {
            onClick: function() { self.setState({ hasError: false, error: null, errorInfo: null }); },
            style: { padding: "10px 20px", borderRadius: 10, border: "none", background: "#0ea5e9", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer" }
          }, "Retry"),
          onRetry && React.createElement("button", {
            onClick: function() { self.setState({ hasError: false, error: null, errorInfo: null }); if (onRetry) onRetry(); },
            style: { padding: "10px 20px", borderRadius: 10, border: "1px solid var(--border-default)", background: "none", color: "var(--text-muted)", fontSize: 14, cursor: "pointer" }
          }, "Go Home"),
          onReset && React.createElement("button", {
            onClick: function() {
              // Erasing everything must be deliberate: typed, not one tap.
              // Only the whole-app boundary offers it (per-view boundaries
              // keep Retry + Go Home), so a crash on one tab can't lead to
              // wiping all data.
              var typed = prompt("This ERASES ALL app data on this phone (procedures, settings, call pay, directorship hours and signature). If you can, export a backup from More first.\n\nType RESET to erase everything:");
              if (typed !== null && typed.trim().toUpperCase() === "RESET") {
                try { localStorage.removeItem(SK); localStorage.removeItem(LAST_GOOD_KEY); } catch(e) {}
                location.reload();
              }
            },
            style: { padding: "10px 20px", borderRadius: 10, border: "1px solid #ef4444", background: "none", color: "#ef4444", fontSize: 13, cursor: "pointer" }
          }, "Reset App")
        )
      );
    }
    return this.props.children;
  }
}

// =======================================
// APP (flex column layout - nav always visible)
// =======================================
function App() {
  const [data, setData] = useState(defState);
  const [view, setView] = useState("dashboard");
  const [loaded, setLoaded] = useState(false);
  const [undoAction, setUndoAction] = useState(null);
  const undoTimer = useRef(null);
  // Bumped per toast: keys the live region's text so a repeat of the same
  // message is a fresh insertion that screen readers announce again.
  const undoSeq = useRef(0);
  const contentRef = useRef(null);
  const [theme, setTheme] = useState(function() {
    try { return localStorage.getItem("rvu-theme") || "dark"; } catch(e) { return "dark"; }
  });

  useEffect(function() {
    document.body.className = theme === "light" ? "light-mode" : "";
    try { localStorage.setItem("rvu-theme", theme); } catch(e) {}
  }, [theme]);

  var toggleTheme = function() { setTheme(function(t) { return t === "dark" ? "light" : "dark"; }); };

  const [showComp, setShowComp] = useState(false);
  var toggleComp = function() { setShowComp(function(v) { return !v; }); };

  const db = useMemo(() => getDB(data.rvuOverrides), [data.rvuOverrides]);
  const cptMap = useMemo(() => buildCPTMap(db), [db]);
  const categories = useMemo(() => buildCategories(db), [db]);

  // localStorage is the single persistence layer (the old window.storage
  // mirror was a dead shim - never defined in production). The loaded gate
  // stays: the save effect below must not clobber localStorage with the
  // initial defState before loadData has run.
  useEffect(() => { var initialData = loadData(); if (validateData(initialData)) { saveLastGood(initialData); } setData(initialData); setLoaded(true); }, []);
  useEffect(() => { if (!loaded) return; saveData(data); }, [data, loaded]);
  const upd = fn => setData(prev => ({ ...fn(prev) }));

  // Scroll content to top on view change
  useEffect(function() {
    if (contentRef.current) contentRef.current.scrollTop = 0;
  }, [view]);

  var showUndo = function(action) {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    if (action) undoSeq.current++;
    setUndoAction(action);
    undoTimer.current = setTimeout(function() { setUndoAction(null); }, 8000);
  };

  var doUndo = function() {
    if (!undoAction) return;
    if (undoAction.type === "delete") {
      // Re-add only entries whose id is not already present (e.g. after a
      // restore brought them back) - never duplicate an entry.
      var delBack = undoAction.entries;
      upd(function(prev) {
        var have = {};
        prev.entries.forEach(function(e) { have[e.id] = true; });
        return { ...prev, entries: prev.entries.concat(delBack.filter(function(e) { return !have[e.id]; })) };
      });
    } else if (undoAction.type === "log") {
      var ids = undoAction.ids;
      upd(function(prev) { return { ...prev, entries: prev.entries.filter(function(e) { return ids.indexOf(e.id) === -1; }) }; });
    } else if (undoAction.type === "restore") {
      // Entries edited in place (History's call-site fix-up): the saved
      // copies go back where their ids are (utils.js entryRestoreInPlace).
      // Only cases still exactly as the fix-up wrote them go back.
      var copies = undoAction.entries, written = undoAction.written;
      upd(function(prev) { return { ...prev, entries: entryRestoreInPlace(prev.entries, copies, written) }; });
    } else if (undoAction.type === "pay") {
      // Call pay shifts: restores IN PLACE (utils.js payUndoApply, tested).
      var payAction = undoAction;
      upd(function(prev) { return { ...prev, payShifts: payUndoApply(prev.payShifts, payAction) }; });
    } else if (undoAction.type === "dir") {
      // Directorship time entries: the same tested id-list restore (save,
      // edit, delete, Repeat confirm).
      var dirAction = undoAction;
      upd(function(prev) { return { ...prev, dirEntries: payUndoApply(dirEntriesOf(prev), dirAction) }; });
    } else if (undoAction.type === "dirRemove") {
      // A removed directorship goes back at its index, only if still missing.
      var rmAction = undoAction;
      upd(function(prev) { return dirRemoveUndo(prev, rmAction); });
    }
    setUndoAction(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  };

  var goHome = function() { setView("dashboard"); };

  // Nav-less acute history view (Import-view precedent): remember which view
  // opened it so Back returns there, not to a fixed tab.
  const [acuteFrom, setAcuteFrom] = useState("dashboard");
  var openAcute = function(from) { setAcuteFrom(from === "settings" ? "settings" : "dashboard"); setView("acute"); };
  // Call pay view (callpay.js); opened from Log, Home or Settings, Back
  // returns to whichever opened it. The nav stays visible there.
  const [callPayFrom, setCallPayFrom] = useState("settings");
  // Log's unsaved encounter, kept across tab switches (memory only - never
  // persisted; LogProc clears it on save).
  const logDraft = useRef(null);
  // Call Pay's unsaved shift form, the same way (memory only, never
  // persisted): CallPay reads it ONCE on mount and clears it, and parks it
  // again only after a render that committed and only while it is dirty, so
  // a form that crashes never reopens (utils.js payParkedDraft).
  const callPayDraft = useRef(null);
  // Log's save bar is pinned (LogProc reports it via setLogBar): lifts the undo toast above it.
  const [logBar, setLogBar] = useState(false);
  // focus "rates" (Settings' "Call pay rates" button) scrolls Call Pay to
  // its rates card once (one-shot ref, like backupFocus below).
  const callPayFocus = useRef(false);
  var openCallPay = function(from, focus) { setCallPayFrom(from === "log" || from === "dashboard" ? from : "settings"); callPayFocus.current = focus === "rates"; setView("callpay"); };
  // History's one-shot filter preset from a "Logged, no credit" line (memory
  // only; History reads it when it mounts, then clears it). range: an
  // inclusive { start, end } of "YYYY-MM-DD" strings, or null for all time.
  const historyPreset = useRef(null);
  var openHistory = function(range) { historyPreset.current = { type: "nc", start: range ? range.start : "", end: range ? range.end : "" }; setView("history"); };
  // Home's backup nudge opens More scrolled to Backup & Restore (one-shot,
  // memory only; Settings reads and clears it).
  const backupFocus = useRef(false);
  var openBackup = function() { backupFocus.current = true; setView("settings"); };
  // Nav-less Directorships view (directorships.js); opened from More or from
  // Home's month-end reminder, which passes its month (one-shot, memory only).
  const [dirFrom, setDirFrom] = useState("settings");
  const dirMonth = useRef(null);
  var openDirectorships = function(from, month) {
    setDirFrom(from === "dashboard" ? "dashboard" : "settings");
    dirMonth.current = typeof month === "string" && /^\d{4}-\d{2}$/.test(month) ? month : null;
    setView("directorships");
  };

  if (!loaded) return <div style={S.loading}>Loading...</div>;
  return (
    <div style={S.shell} className="rvu-shell"><div style={S.app}>
      {/* Scrollable content area */}
      <div style={S.content} className="rvu-content" ref={contentRef}>
        {view === "dashboard" && <ErrorBoundary name="Dashboard" onRetry={goHome} key="eb-dash"><Dashboard data={data} db={db} setView={setView} showComp={showComp} toggleComp={toggleComp} openAcute={openAcute} openCallPay={openCallPay} openHistory={openHistory} openBackup={openBackup} openDirectorships={openDirectorships} /></ErrorBoundary>}
        {view === "log" && <ErrorBoundary name="Log Procedure" onRetry={goHome} key="eb-log"><LogProc data={data} db={db} cptMap={cptMap} categories={categories} upd={upd} setView={setView} showUndo={showUndo} openCallPay={openCallPay} logDraft={logDraft} setLogBar={setLogBar} /></ErrorBoundary>}
        {view === "analytics" && <ErrorBoundary name="Trends" onRetry={goHome} key="eb-analytics"><Analytics data={data} db={db} setView={setView} showComp={showComp} toggleComp={toggleComp} openHistory={openHistory} /></ErrorBoundary>}
        {view === "compare" && <ErrorBoundary name="Compare" onRetry={goHome} key="eb-compare"><Compare data={data} upd={upd} setView={setView} showComp={showComp} toggleComp={toggleComp} /></ErrorBoundary>}
        {view === "import" && <ErrorBoundary name="Import" onRetry={goHome} key="eb-import"><Import data={data} cptMap={cptMap} upd={upd} setView={setView} showUndo={showUndo} /></ErrorBoundary>}
        {view === "history" && <ErrorBoundary name="History" onRetry={goHome} key="eb-history"><History data={data} db={db} cptMap={cptMap} categories={categories} upd={upd} setView={setView} showUndo={showUndo} historyPreset={historyPreset} /></ErrorBoundary>}
        {view === "settings" && <ErrorBoundary name="Settings" onRetry={goHome} key="eb-settings"><Settings data={data} db={db} cptMap={cptMap} categories={categories} upd={upd} setView={setView} theme={theme} toggleTheme={toggleTheme} showComp={showComp} toggleComp={toggleComp} openAcute={openAcute} openCallPay={openCallPay} showUndo={showUndo} openHistory={openHistory} backupFocus={backupFocus} openDirectorships={openDirectorships} /></ErrorBoundary>}
        {view === "acute" && <ErrorBoundary name="Acute Care History" onRetry={goHome} key="eb-acute"><AcuteHistory data={data} onBack={function() { setView(acuteFrom); }} /></ErrorBoundary>}
        {view === "callpay" && <ErrorBoundary name="Call Pay" onRetry={function() { callPayDraft.current = null; goHome(); }} key="eb-callpay"><CallPay data={data} upd={upd} onBack={function() { setView(callPayFrom); }} showComp={showComp} toggleComp={toggleComp} showUndo={showUndo} focus={callPayFocus} keep={callPayDraft} /></ErrorBoundary>}
        {view === "directorships" && <ErrorBoundary name="Directorships" onRetry={goHome} key="eb-dir">{typeof Directorships === "function"
          ? <Directorships data={data} upd={upd} onBack={function() { setView(dirFrom); }} showComp={showComp} toggleComp={toggleComp} showUndo={showUndo} dirMonth={dirMonth} />
          : <div style={S.page}>Directorships did not load - reload the app.</div>}</ErrorBoundary>}
      </div>

      {/* Screen readers: an always-mounted, visually hidden live region
          announces each toast (one inserted with its text is often missed).
          The keyed child makes a repeated message a new insertion. */}
      <span role="status" aria-live="polite" style={{ position: "absolute", width: 1, height: 1, margin: -1, padding: 0, border: 0, overflow: "hidden", clip: "rect(0 0 0 0)", clipPath: "inset(50%)", whiteSpace: "nowrap" }}>{undoAction ? <span key={undoSeq.current}>{undoAction.message}</span> : null}</span>
      {/* Undo toast - above the nav; on Log, above the pinned save bar (log.js: 64px bar on the ~71px nav), so Undo never covers Save.
          Undo and Dismiss are 44px targets; the toast grows upward from its fixed bottom offset. */}
      {undoAction && <div style={{
        position: "absolute", bottom: view === "log" && logBar ? 148 : 64, left: "50%", transform: "translateX(-50%)",
        zIndex: 9990, background: "var(--bg-card)", border: "1px solid var(--border-default)",
        borderRadius: 12, padding: "10px 16px", display: "flex", alignItems: "center",
        gap: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.5)", maxWidth: 360, width: "90%",
        animation: "rvuSlideUp 0.25s ease-out"
      }}>
        <span style={{ fontSize: 13, color: "var(--text-primary)", flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{undoAction.message}</span>
        <button onClick={doUndo} style={{ minHeight: 44, flexShrink: 0, padding: "0 16px", borderRadius: 8, border: "none", background: "#0ea5e9", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Undo</button>
        <button onClick={function() { if (undoTimer.current) clearTimeout(undoTimer.current); setUndoAction(null); }} aria-label="Dismiss" style={{ minWidth: 44, minHeight: 44, flexShrink: 0, padding: 0, display: "flex", alignItems: "center", justifyContent: "center", background: "none", border: "none", color: "var(--text-faint)", fontSize: 16, cursor: "pointer", lineHeight: 1 }}>{"\u2715"}</button>
      </div>}

      {/* Nav bar - flex child, always at bottom */}
      <Nav view={view} setView={setView} />
    </div></div>
  );
}

function Nav({ view, setView }) {
  const tabs = [
    { id: "dashboard", icon: "\u25C9", label: "Home" },
    { id: "log", icon: "\uFF0B", label: "Log" },
    { id: "analytics", icon: "\u2191", label: "Trends" },
    { id: "compare", icon: "\u2194", label: "Compare" },
    { id: "history", icon: "\u2630", label: "History" },
    { id: "settings", icon: "\u2699", label: "More" }
  ];
  return (
    <div style={S.nav} className="rvu-nav-bar">
      {tabs.map(t => (
        <button key={t.id} onClick={() => setView(t.id)} aria-label={t.label} aria-current={view === t.id ? "page" : undefined} style={{
          ...S.navBtn,
          flex: 1, minHeight: 48,
          color: view === t.id ? "#0ea5e9" : "var(--text-muted)"
        }}>
          <span style={{ fontSize: t.id === "log" ? 22 : 17, transition: "transform 0.15s", transform: view === t.id ? "scale(1.15)" : "scale(1)" }}>{t.icon}</span>
          <span style={{ fontSize: 10, marginTop: 2, letterSpacing: 0.2, fontWeight: view === t.id ? 700 : 400 }}>{t.label}</span>
        </button>
      ))}
    </div>
  );
}

// The one show/hide-$ button. showComp lives in App (memory only: every
// launch starts hidden); every view that masks $ renders this near its $.
// Hook-free. Other Babel files use it at render time (app.js runs before
// root.render). JSX: never move it into a plain script.
function CompEye({ showComp, toggleComp, style }) {
  if (!toggleComp) return null;
  return <button onClick={toggleComp} aria-label="Show dollar amounts" aria-pressed={!!showComp} title={showComp ? "Hide $" : "Show $"} style={{ minHeight: 44, minWidth: 44, padding: 0, background: "none", border: "1px solid var(--border-default)", borderRadius: 8, cursor: "pointer", color: showComp ? "#10b981" : "var(--text-dim)", fontSize: 16, lineHeight: 1, flexShrink: 0, ...(style || {}) }}>{showComp ? "\uD83D\uDC41" : "\uD83D\uDC41\u200D\uD83D\uDDE8"}</button>;
}

// Global error handler - prevents white screen on unhandled errors
window.addEventListener("error", function(e) {
  console.error("RVU Tracker global error:", e.error);
});
window.addEventListener("unhandledrejection", function(e) {
  console.error("RVU Tracker unhandled rejection:", e.reason);
});

const root=ReactDOM.createRoot(document.getElementById("root"));
root.render(React.createElement(ErrorBoundary, { name: "RVU Tracker", onReset: true }, React.createElement(App)));
