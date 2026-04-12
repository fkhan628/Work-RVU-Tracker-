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
      return React.createElement("div", { style: { padding: 24, textAlign: "center", color: "#e2e8f0", fontFamily: "'DM Sans', sans-serif" } },
        React.createElement("div", { style: { fontSize: 36, marginBottom: 12 } }, "\u26A0\uFE0F"),
        React.createElement("div", { style: { fontSize: 16, fontWeight: 600, marginBottom: 8 } }, "Something went wrong in " + name),
        React.createElement("div", { style: { fontSize: 13, color: "#94a3b8", marginBottom: 16, maxWidth: 300, margin: "0 auto 16px" } },
          "The rest of the app is still working. You can retry or go to another tab."
        ),
        this.state.error && React.createElement("details", { style: { fontSize: 11, color: "#64748b", marginBottom: 16, textAlign: "left", maxWidth: 320, margin: "0 auto 16px", background: "#1e293b", padding: 12, borderRadius: 8, border: "1px solid #334155" } },
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
            style: { padding: "10px 20px", borderRadius: 10, border: "1px solid #334155", background: "none", color: "#94a3b8", fontSize: 14, cursor: "pointer" }
          }, "Go Home"),
          onReset && React.createElement("button", {
            onClick: function() {
              if (confirm("This will reset all app data. Your entries will be lost. Continue?")) {
                try { localStorage.removeItem(SK); localStorage.removeItem(LAST_GOOD_KEY); } catch(e) {}
                try { window.storage.delete("rvu-tracker-all"); } catch(e) {}
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
// APP
// =======================================
function App() {
  const [data, setData] = useState(defState);
  const [view, setView] = useState("dashboard");
  const [loaded, setLoaded] = useState(false);
  const [undoAction, setUndoAction] = useState(null);
  const undoTimer = useRef(null);
  const [theme, setTheme] = useState(function() {
    try { return localStorage.getItem("rvu-theme") || "dark"; } catch(e) { return "dark"; }
  });

  useEffect(function() {
    document.body.className = theme === "light" ? "light-mode" : "";
    try { localStorage.setItem("rvu-theme", theme); } catch(e) {}
  }, [theme]);

  var toggleTheme = function() { setTheme(function(t) { return t === "dark" ? "light" : "dark"; }); };

  const db = useMemo(() => getDB(data.rvuOverrides), [data.rvuOverrides]);
  const cptMap = useMemo(() => buildCPTMap(db), [db]);
  const categories = useMemo(() => buildCategories(db), [db]);

  useEffect(() => { (async () => { const p = await loadPersistent(); var initialData = p && p.entries.length > 0 ? p : loadData(); if (validateData(initialData)) { saveLastGood(initialData); } setData(initialData); setLoaded(true); })(); }, []);
  useEffect(() => { if (!loaded) return; saveData(data); savePersistent(data); }, [data, loaded]);
  const upd = fn => setData(prev => ({ ...fn(prev) }));

  var showUndo = function(action) {
    if (undoTimer.current) clearTimeout(undoTimer.current);
    setUndoAction(action);
    undoTimer.current = setTimeout(function() { setUndoAction(null); }, 8000);
  };

  var doUndo = function() {
    if (!undoAction) return;
    if (undoAction.type === "delete") {
      upd(function(prev) { return { ...prev, entries: prev.entries.concat(undoAction.entries) }; });
    } else if (undoAction.type === "log") {
      var ids = undoAction.ids;
      upd(function(prev) { return { ...prev, entries: prev.entries.filter(function(e) { return ids.indexOf(e.id) === -1; }) }; });
    }
    setUndoAction(null);
    if (undoTimer.current) clearTimeout(undoTimer.current);
  };

  var goHome = function() { setView("dashboard"); };

  if (!loaded) return <div style={S.loading}>Loading...</div>;
  return (
    <div style={S.shell}><div style={S.app}>
      {view === "dashboard" && <ErrorBoundary name="Dashboard" onRetry={goHome} onReset={true} key="eb-dash"><Dashboard data={data} db={db} setView={setView} /></ErrorBoundary>}
      {view === "log" && <ErrorBoundary name="Log Procedure" onRetry={goHome} onReset={true} key="eb-log"><LogProc data={data} db={db} cptMap={cptMap} categories={categories} upd={upd} setView={setView} showUndo={showUndo} /></ErrorBoundary>}
      {view === "analytics" && <ErrorBoundary name="Trends" onRetry={goHome} onReset={true} key="eb-analytics"><Analytics data={data} db={db} setView={setView} /></ErrorBoundary>}
      {view === "compare" && <ErrorBoundary name="Compare" onRetry={goHome} onReset={true} key="eb-compare"><Compare data={data} upd={upd} setView={setView} /></ErrorBoundary>}
      {view === "import" && <ErrorBoundary name="Import" onRetry={goHome} onReset={true} key="eb-import"><Import data={data} cptMap={cptMap} upd={upd} setView={setView} /></ErrorBoundary>}
      {view === "history" && <ErrorBoundary name="History" onRetry={goHome} onReset={true} key="eb-history"><History data={data} db={db} cptMap={cptMap} categories={categories} upd={upd} setView={setView} showUndo={showUndo} /></ErrorBoundary>}
      {view === "settings" && <ErrorBoundary name="Settings" onRetry={goHome} onReset={true} key="eb-settings"><Settings data={data} db={db} cptMap={cptMap} categories={categories} upd={upd} setView={setView} theme={theme} toggleTheme={toggleTheme} /></ErrorBoundary>}
      {undoAction && <div style={{ position: "fixed", bottom: 64, left: "50%", transform: "translateX(-50%)", zIndex: 9990, background: "#1e293b", border: "1px solid #334155", borderRadius: 12, padding: "10px 16px", display: "flex", alignItems: "center", gap: 12, boxShadow: "0 4px 24px rgba(0,0,0,0.5)", maxWidth: 360, width: "90%" }}>
        <span style={{ fontSize: 13, color: "#e2e8f0", flex: 1 }}>{undoAction.message}</span>
        <button onClick={doUndo} style={{ padding: "6px 16px", borderRadius: 8, border: "none", background: "#0ea5e9", color: "#fff", fontSize: 13, fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Undo</button>
        <button onClick={function() { setUndoAction(null); }} style={{ background: "none", border: "none", color: "#475569", fontSize: 16, cursor: "pointer", padding: "0 4px", lineHeight: 1 }}>{"\u2715"}</button>
      </div>}
      <Nav view={view} setView={setView} />
    </div></div>
  );
}

function Nav({ view, setView }) {
  const tabs = [{ id: "dashboard", icon: "\u25C9", label: "Home" }, { id: "log", icon: "\uFF0B", label: "Log" }, { id: "analytics", icon: "\u2191", label: "Trends" }, { id: "compare", icon: "\u2194", label: "Compare" }, { id: "history", icon: "\u2630", label: "History" }, { id: "settings", icon: "\u2699", label: "More" }];
  return (<div style={S.nav}>{tabs.map(t => (<button key={t.id} onClick={() => setView(t.id)} style={{ ...S.navBtn, color: view === t.id ? "#0ea5e9" : "#94a3b8" }}><span style={{ fontSize: t.id === "log" ? 22 : 17 }}>{t.icon}</span><span style={{ fontSize: 8, marginTop: 2, letterSpacing: 0.3 }}>{t.label}</span></button>))}</div>);
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
