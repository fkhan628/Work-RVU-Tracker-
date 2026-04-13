// =======================================
// THEME CSS INJECTION (variables, animations, layout)
// =======================================
(function() {
  if (document.getElementById("rvu-theme-css")) return;
  var el = document.createElement("style");
  el.id = "rvu-theme-css";
  el.textContent = [
    /* --- Dark theme (default) --- */
    ":root {",
    "  --bg-base: #0f172a;",
    "  --bg-card: #1e293b;",
    "  --bg-input: #1e293b;",
    "  --bg-inset: #0f172a;",
    "  --border-subtle: #1e293b;",
    "  --border-default: #334155;",
    "  --text-bright: #f8fafc;",
    "  --text-primary: #e2e8f0;",
    "  --text-secondary: #cbd5e1;",
    "  --text-muted: #94a3b8;",
    "  --text-dim: #64748b;",
    "  --text-faint: #475569;",
    "  --text-ghost: #334155;",
    "  --nav-bg: rgba(15,23,42,0.95);",
    "  --card-shadow: 0 1px 2px rgba(0,0,0,0.25);",
    "  --card-main-from: #1e293b;",
    "  --card-main-to: #0f172a;",
    "  --overlay-bg: rgba(0,0,0,0.75);",
    "  color-scheme: dark;",
    "}",
    /* --- Light theme --- */
    "body.light-mode {",
    "  --bg-base: #f1f5f9;",
    "  --bg-card: #ffffff;",
    "  --bg-input: #ffffff;",
    "  --bg-inset: #f1f5f9;",
    "  --border-subtle: #e2e8f0;",
    "  --border-default: #cbd5e1;",
    "  --text-bright: #0f172a;",
    "  --text-primary: #1e293b;",
    "  --text-secondary: #475569;",
    "  --text-muted: #64748b;",
    "  --text-dim: #94a3b8;",
    "  --text-faint: #cbd5e1;",
    "  --text-ghost: #e2e8f0;",
    "  --nav-bg: rgba(255,255,255,0.92);",
    "  --card-shadow: 0 1px 3px rgba(0,0,0,0.06), 0 1px 2px rgba(0,0,0,0.04);",
    "  --card-main-from: #ffffff;",
    "  --card-main-to: #f8fafc;",
    "  --overlay-bg: rgba(0,0,0,0.45);",
    "  color-scheme: light;",
    "}",
    /* --- Animations --- */
    "@keyframes rvuFadeIn { from { opacity:0; transform:translateY(6px); } to { opacity:1; transform:translateY(0); } }",
    "@keyframes rvuSlideUp { from { opacity:0; transform:translateY(16px); } to { opacity:1; transform:translateY(0); } }",
    "@keyframes rvuScaleIn { from { opacity:0; transform:scale(0.97); } to { opacity:1; transform:scale(1); } }",
    "@keyframes rvuPulse { 0%,100% { opacity:1; } 50% { opacity:0.7; } }",
    /* --- Dynamic viewport height fix --- */
    "@supports (height: 100dvh) { .rvu-shell { height: 100dvh !important; } }",
    /* --- Smooth scrolling --- */
    ".rvu-content { -webkit-overflow-scrolling: touch; overscroll-behavior-y: contain; scroll-behavior: smooth; }",
    ".rvu-content::-webkit-scrollbar { width: 3px; }",
    ".rvu-content::-webkit-scrollbar-track { background: transparent; }",
    ".rvu-content::-webkit-scrollbar-thumb { background: var(--border-default); border-radius: 3px; }",
    /* --- Light mode input color scheme --- */
    "body.light-mode input[type='date'] { color-scheme: light; }",
    "body.light-mode input[type='month'] { color-scheme: light; }",
    /* --- Safe area nav padding --- */
    "@supports (padding-bottom: env(safe-area-inset-bottom)) {",
    "  .rvu-nav-bar { padding-bottom: calc(12px + env(safe-area-inset-bottom)) !important; }",
    "}",
    /* --- Button active states --- */
    "button:active { transform: scale(0.97); }",
  ].join("\n");
  document.head.appendChild(el);
})();

// =======================================
// STYLE CONSTANTS (CSS-variable aware)
// =======================================
var S = {
  // --- Layout: Flex column (fixes mobile nav pinning) ---
  shell: {
    width: "100%", height: "100vh",
    background: "var(--bg-base)",
    display: "flex", justifyContent: "center",
    fontFamily: "'DM Sans', sans-serif"
  },
  app: {
    width: "100%", maxWidth: 480, height: "100%",
    display: "flex", flexDirection: "column",
    background: "var(--bg-base)", position: "relative"
  },
  content: {
    flex: 1, overflowY: "auto", minHeight: 0
  },
  loading: {
    display: "flex", alignItems: "center", justifyContent: "center",
    height: "100vh", color: "var(--text-muted)", fontSize: 16,
    background: "var(--bg-base)"
  },

  // --- Page & Header ---
  page: {
    padding: "16px 16px 24px",
    animation: "rvuFadeIn 0.22s ease-out"
  },
  header: { marginBottom: 16 },
  title: {
    fontSize: 26, fontWeight: 700, color: "var(--text-bright)",
    margin: 0, letterSpacing: -0.5
  },
  subtitle: { fontSize: 13, color: "var(--text-dim)", margin: "4px 0 0" },

  // --- Cards ---
  cardMain: {
    background: "linear-gradient(135deg, var(--card-main-from) 0%, var(--card-main-to) 100%)",
    border: "1px solid var(--border-subtle)", borderRadius: 16,
    padding: 20, marginBottom: 12,
    boxShadow: "var(--card-shadow)",
    animation: "rvuScaleIn 0.25s ease-out"
  },
  card: {
    background: "var(--bg-card)", borderRadius: 12,
    padding: 16, marginBottom: 12,
    boxShadow: "var(--card-shadow)"
  },
  cardLabel: {
    fontSize: 12, fontWeight: 600, color: "var(--text-muted)",
    textTransform: "uppercase", letterSpacing: 1
  },

  // --- Dashboard Metrics ---
  metricBig: {
    fontSize: 36, fontWeight: 700, fontFamily: "'JetBrains Mono'",
    color: "var(--text-bright)", lineHeight: 1
  },
  metricLabel: { fontSize: 13, color: "var(--text-dim)", marginTop: 2 },
  paceTag: {
    display: "inline-block", fontSize: 11, fontWeight: 600,
    padding: "3px 8px", borderRadius: 6, marginTop: 6,
    fontFamily: "'JetBrains Mono'"
  },
  statsRow: { display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 8, marginBottom: 12 },
  statCard: {
    background: "var(--bg-card)", borderRadius: 10,
    padding: "12px 10px", textAlign: "center",
    boxShadow: "var(--card-shadow)"
  },
  statValue: {
    fontSize: 18, fontWeight: 600, fontFamily: "'JetBrains Mono'",
    color: "var(--text-primary)"
  },
  statLabel: {
    fontSize: 10, color: "var(--text-dim)", marginTop: 2,
    textTransform: "uppercase", letterSpacing: 0.5
  },

  // --- Recent Procedures ---
  recentItem: {
    display: "flex", justifyContent: "space-between", alignItems: "center",
    padding: "10px 0", borderBottom: "1px solid var(--border-default)"
  },
  recentCode: {
    fontSize: 13, fontFamily: "'JetBrains Mono'", color: "#0ea5e9", fontWeight: 600
  },
  recentDesc: {
    fontSize: 12, color: "var(--text-muted)", marginTop: 2,
    maxWidth: 200, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
  },
  recentRVU: {
    fontSize: 14, fontFamily: "'JetBrains Mono'", color: "var(--text-primary)", fontWeight: 600
  },
  recentDate: { fontSize: 11, color: "var(--text-dim)" },
  linkBtn: {
    background: "none", border: "none", color: "#0ea5e9",
    fontSize: 12, fontWeight: 500, cursor: "pointer", padding: 0
  },

  // --- Navigation (flex child, not fixed) ---
  nav: {
    width: "100%", display: "flex", justifyContent: "space-around",
    padding: "8px 0 12px", flexShrink: 0,
    background: "var(--nav-bg)",
    backdropFilter: "blur(20px)", WebkitBackdropFilter: "blur(20px)",
    borderTop: "1px solid var(--border-subtle)",
    zIndex: 100
  },
  navBtn: {
    background: "none", border: "none",
    display: "flex", flexDirection: "column", alignItems: "center",
    cursor: "pointer", padding: "4px 8px",
    transition: "color 0.2s, transform 0.15s"
  },

  // --- Form Inputs ---
  fieldGroup: { marginBottom: 12 },
  fieldLabel: {
    fontSize: 12, fontWeight: 500, color: "var(--text-muted)",
    marginBottom: 6, display: "block"
  },
  searchInput: {
    width: "100%", padding: "12px 14px",
    background: "var(--bg-input)", border: "1px solid var(--border-default)",
    borderRadius: 10, color: "var(--text-bright)", fontSize: 15,
    outline: "none", boxSizing: "border-box",
    transition: "border-color 0.15s"
  },
  dateInput: {
    padding: "10px 14px",
    background: "var(--bg-input)", border: "1px solid var(--border-default)",
    borderRadius: 10, color: "var(--text-bright)", fontSize: 14,
    outline: "none"
  },
  numberInput: {
    padding: "10px 14px",
    background: "var(--bg-inset)", border: "1px solid var(--border-default)",
    borderRadius: 10, color: "var(--text-bright)", fontSize: 18,
    fontFamily: "'JetBrains Mono'", fontWeight: 600,
    outline: "none", width: 120
  },
  notesInput: {
    width: "100%", padding: "10px 14px",
    background: "var(--bg-input)", border: "1px solid var(--border-default)",
    borderRadius: 10, color: "var(--text-bright)", fontSize: 14,
    outline: "none", resize: "vertical", boxSizing: "border-box"
  },

  // --- Category / Filter Row ---
  catRow: {
    display: "flex", gap: 6, overflowX: "auto",
    paddingBottom: 8, marginTop: 8, scrollbarWidth: "none"
  },
  catBtn: {
    flexShrink: 0, padding: "6px 12px",
    background: "var(--bg-card)", border: "1px solid var(--border-default)",
    borderRadius: 20, color: "var(--text-muted)", fontSize: 12,
    cursor: "pointer", whiteSpace: "nowrap",
    transition: "all 0.15s"
  },
  catBtnActive: {
    flexShrink: 0, padding: "6px 12px",
    background: "#0ea5e9", border: "1px solid #0ea5e9",
    borderRadius: 20, color: "#fff", fontSize: 12,
    cursor: "pointer", fontWeight: 600, whiteSpace: "nowrap"
  },

  // --- Search Results ---
  resultsList: {
    maxHeight: 360, overflowY: "auto", marginTop: 8,
    scrollbarWidth: "thin", scrollbarColor: "var(--border-default) transparent"
  },
  resultItem: {
    width: "100%", textAlign: "left",
    background: "var(--bg-card)", border: "1px solid var(--border-default)",
    borderRadius: 10, padding: "10px 14px", marginBottom: 6,
    cursor: "pointer", display: "block",
    transition: "border-color 0.15s, transform 0.1s"
  },
  resultCode: {
    fontSize: 14, fontFamily: "'JetBrains Mono'", color: "#0ea5e9", fontWeight: 600
  },
  resultRVU: {
    fontSize: 13, fontFamily: "'JetBrains Mono'", color: "#10b981", fontWeight: 500
  },
  resultDesc: { fontSize: 13, color: "var(--text-secondary)", marginTop: 2 },
  resultCat: { fontSize: 11, color: "var(--text-dim)", marginTop: 2 },

  // --- Selected Procedure Card ---
  selectedCard: {
    background: "linear-gradient(135deg, #0c4a6e 0%, var(--bg-card) 100%)",
    border: "1px solid #0ea5e9", borderRadius: 12,
    padding: 16, marginBottom: 12,
    animation: "rvuScaleIn 0.2s ease-out"
  },
  selectedCode: {
    fontSize: 20, fontFamily: "'JetBrains Mono'", color: "#38bdf8", fontWeight: 700
  },
  selectedDesc: { fontSize: 14, color: "var(--text-primary)", marginTop: 4 },
  clearBtn: {
    background: "none", border: "none", color: "var(--text-dim)",
    fontSize: 18, cursor: "pointer", padding: "0 4px"
  },

  // --- Modifiers ---
  modGrid: { display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 },
  modBtn: {
    display: "flex", flexDirection: "column", padding: "8px 10px",
    background: "var(--bg-card)", border: "1px solid var(--border-default)",
    borderRadius: 8, cursor: "pointer", textAlign: "left",
    transition: "all 0.15s"
  },
  modBtnActive: {
    display: "flex", flexDirection: "column", padding: "8px 10px",
    background: "rgba(14,165,233,0.15)", border: "1px solid #0ea5e9",
    borderRadius: 8, cursor: "pointer", textAlign: "left"
  },
  modCode: {
    fontSize: 13, fontFamily: "'JetBrains Mono'", color: "#38bdf8", fontWeight: 600
  },
  modLabel: { fontSize: 11, color: "var(--text-secondary)", marginTop: 1 },
  modFactor: {
    fontSize: 10, color: "var(--text-dim)", marginTop: 1,
    fontFamily: "'JetBrains Mono'"
  },

  // --- Action Buttons ---
  saveBtn: {
    width: "100%", padding: "14px 20px",
    background: "linear-gradient(135deg, #0ea5e9, #0284c7)",
    border: "none", borderRadius: 12, color: "#fff",
    fontSize: 16, fontWeight: 600, cursor: "pointer", marginTop: 8,
    transition: "opacity 0.15s, transform 0.1s"
  },
  fabBtn: {
    width: "100%", padding: "14px 20px",
    background: "linear-gradient(135deg, #0ea5e9, #0284c7)",
    border: "none", borderRadius: 12, color: "#fff",
    fontSize: 15, fontWeight: 600, cursor: "pointer", marginTop: 12,
    transition: "transform 0.1s"
  },
  secondaryBtn: {
    flex: 1, padding: "12px 16px",
    background: "var(--bg-card)", border: "1px solid var(--border-default)",
    borderRadius: 10, color: "var(--text-primary)",
    fontSize: 14, fontWeight: 500, cursor: "pointer",
    transition: "all 0.15s"
  },
  dangerBtn: {
    flex: 1, padding: "12px 16px",
    background: "rgba(239,68,68,0.1)", border: "1px solid rgba(239,68,68,0.3)",
    borderRadius: 10, color: "#f87171",
    fontSize: 14, fontWeight: 500, cursor: "pointer",
    transition: "all 0.15s"
  },
  successBanner: {
    background: "rgba(16,185,129,0.15)", border: "1px solid rgba(16,185,129,0.3)",
    borderRadius: 10, padding: "12px 16px", color: "#34d399",
    fontSize: 14, fontWeight: 600, marginBottom: 12, textAlign: "center",
    animation: "rvuSlideUp 0.3s ease-out"
  },

  // --- History ---
  groupHeader: {
    fontSize: 13, fontWeight: 600, color: "var(--text-primary)",
    padding: "8px 0 4px", borderBottom: "1px solid var(--border-default)",
    marginBottom: 6
  },
  historyItem: {
    display: "flex", gap: 12, padding: "10px 0",
    borderBottom: "1px solid rgba(51,65,85,0.5)"
  },
  histCode: {
    fontSize: 13, fontFamily: "'JetBrains Mono'", color: "#0ea5e9", fontWeight: 600
  },
  histMod: {
    fontSize: 10, fontFamily: "'JetBrains Mono'", color: "#fbbf24",
    background: "rgba(251,191,36,0.1)", padding: "1px 5px", borderRadius: 4
  },
  histDesc: { fontSize: 12, color: "var(--text-muted)", marginTop: 2 },
  histNotes: {
    fontSize: 11, color: "var(--text-dim)", marginTop: 3, fontStyle: "italic"
  },
  histRVU: {
    fontSize: 15, fontFamily: "'JetBrains Mono'", color: "var(--text-primary)", fontWeight: 600
  },
  deleteBtn: {
    background: "none", border: "none", color: "var(--text-dim)",
    fontSize: 12, cursor: "pointer", padding: "2px 4px", marginTop: 4
  },
  backBtn: {
    background: "none", border: "1px solid var(--border-default)",
    borderRadius: 8, color: "var(--text-muted)",
    fontSize: 18, cursor: "pointer", padding: "4px 10px"
  },
  pgBtn: {
    background: "none", border: "1px solid var(--border-default)",
    borderRadius: 6, color: "var(--text-primary)",
    fontSize: 16, cursor: "pointer", padding: "2px 8px"
  },
};
