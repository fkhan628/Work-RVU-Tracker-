// =======================================
// SETTINGS (with wRVU Editor)
// =======================================
function Settings({ data, db, cptMap, categories, upd, setView, theme, toggleTheme, showComp, toggleComp, openAcute, openCallPay, showUndo, openHistory, backupFocus }) {
  const { settings } = data;
  const [editSearch, setEditSearch] = useState("");
  const [editCat, setEditCat] = useState("All");
  const [showEditor, setShowEditor] = useState(false);
  const [rvuDraft, setRvuDraft] = useState(null); // wRVU editor: { code, text } of the row being typed in
  const rvuEsc = useRef(false);                    // Escape pressed: that blur reverts instead of committing
  const [showRestore, setShowRestore] = useState(false);
  const [restoreText, setRestoreText] = useState("");
  const [backupStatus, setBackupStatus] = useState("");
  const [backupManual, setBackupManual] = useState(""); // encrypted code shown when auto-copy fails
  const [backupWarn, setBackupWarn] = useState(false);   // status line in amber
  const [backupFile, setBackupFile] = useState(null);    // encrypted file ready to share (memory only)
  const [fileBusy, setFileBusy] = useState(false);
  const [backupStamp, setBackupStamp] = useState(readBackupStamp); // per-device, NOT the store
  const restoreFileRef = useRef(null);
  const backupCardRef = useRef(null);
  const sharingRef = useRef(false);   // one share sheet at a time (iOS InvalidStateError)
  const [shareStatus, setShareStatus] = useState("");
  const [newApiKey, setNewApiKey] = useState("");
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [hintText, setHintText] = useState(function() {
    try { return localStorage.getItem("rvu-pin-hint") || ""; } catch(e) { return ""; }
  });
  const [editingHint, setEditingHint] = useState(false);
  const [bioAvailable, setBioAvailable] = useState(false);
  const [bioEnabled, setBioEnabled] = useState(function() { try { return window.RVU_CRYPTO && window.RVU_CRYPTO.hasBiometrics && window.RVU_CRYPTO.hasBiometrics(); } catch(e) { return false; } });
  const [bioStatus, setBioStatus] = useState("");

  useEffect(function() {
    try {
      if (window.RVU_CRYPTO && window.RVU_CRYPTO.biometricsAvailable) {
        window.RVU_CRYPTO.biometricsAvailable().then(function(avail) { setBioAvailable(avail); }).catch(function() {});
      }
    } catch(e) {}
  }, []);
  // A ready file is a snapshot: drop it whenever the data changes.
  useEffect(function() { setBackupFile(null); }, [data]);
  // Home's nudge opens More here, scrolled to Backup & Restore (one-shot ref;
  // the timeout lands after App's scroll-to-top on a view change).
  useEffect(function() {
    if (!backupFocus || !backupFocus.current) return;
    backupFocus.current = false;
    var t = setTimeout(function() {
      var el = backupCardRef.current, c = el && el.closest ? el.closest(".rvu-content") : null;
      if (c) c.scrollTop = c.scrollTop + (el.getBoundingClientRect().top - c.getBoundingClientRect().top) - 8;
    }, 80);
    return function() { clearTimeout(t); };
  }, []);

  // (Removed: legacy plaintext auto-backup. It wrote an UNENCRYPTED copy of all
  // entries incl. patient initials/notes to localStorage ("rvu-backup") and was
  // never read anywhere. The encrypted clipboard backup below is the real one.)

  // THE backup code. The clipboard copy and the file share this builder, so a
  // file's text pastes into Restore (and into an older build) unchanged.
  var buildBackupCode = function(pin) {
    return window.RVU_CRYPTO.encrypt(pin, JSON.stringify(data)).then(function(enc) {
      return btoa(unescape(encodeURIComponent(JSON.stringify({ encrypted: true, v: 1, payload: enc }))));
    });
  };

  var copyBackup = function() {
    setBackupWarn(false); setBackupFile(null);
    var pin = window.RVU_CRYPTO.getPin();
    if (!pin) { setBackupStatus("PIN session expired. Lock and unlock first."); setBackupWarn(true); return; }
    try {
      setBackupStatus("Encrypting backup...");
      buildBackupCode(pin).then(function(encoded) {
        var copyFallback = function() {
          var ta = document.createElement("textarea");
          ta.value = encoded;
          ta.style.cssText = "position:fixed;left:-9999px;top:0;";
          document.body.appendChild(ta);
          ta.focus();
          ta.select();
          // Only claim success when the copy really happened; otherwise
          // show the code in a selectable box (a backup that silently never
          // reached the clipboard is a backup the user does not have).
          var ok = false;
          try { ok = document.execCommand("copy"); } catch(e) { ok = false; }
          document.body.removeChild(ta);
          if (ok) {
            setBackupManual("");
            setBackupStamp(markBackupSaved("copy", todayLocal()));
            setBackupStatus("Encrypted backup copied! (" + data.entries.length + " procedures, " + (encoded.length / 1024).toFixed(0) + " KB)");
            setTimeout(function() { setBackupStatus(""); }, 4000);
          } else {
            setBackupManual(encoded);
            setBackupStatus("Couldn't copy automatically - select the backup code below and copy it.");
          }
        };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(encoded).then(function() {
            setBackupManual("");
            setBackupStamp(markBackupSaved("copy", todayLocal()));
            setBackupStatus("Encrypted backup copied! (" + data.entries.length + " procedures, " + (encoded.length / 1024).toFixed(0) + " KB)");
            setTimeout(function() { setBackupStatus(""); }, 4000);
          }).catch(function() {
            copyFallback();
          });
        } else {
          copyFallback();
        }
      }).catch(function(e) {
        setBackupStatus("Encryption error: " + e.message); setBackupWarn(true);
      });
    } catch(e) {
      setBackupStatus("Error creating backup: " + e.message); setBackupWarn(true);
    }
  };

  // Backup FILE: same code as the clipboard backup, shared as a .txt file.
  var canShareFile = function(f) { try { return !!(f && navigator.share && navigator.canShare && navigator.canShare({ files: [f] })); } catch(e) { return false; } };
  var finePointer = function() { try { return !!(window.matchMedia && window.matchMedia("(pointer: fine)").matches); } catch(e) { return false; } };
  var saveBackupFile = function() {
    if (fileBusy) return;
    var pin = window.RVU_CRYPTO.getPin();
    setBackupManual(""); setBackupFile(null); setBackupStatus(""); setBackupWarn(false);
    if (!pin) { setBackupStatus("PIN session expired. Lock and unlock first."); setBackupWarn(true); return; }
    var count = data.entries.length, shifts = (data.payShifts || []).length;
    setFileBusy(true);
    Promise.resolve().then(function() { return buildBackupCode(pin); }).then(function(encoded) {
      var name = backupFileName(todayLocal()), file = null;
      try { file = new File([encoded], name, { type: "text/plain" }); } catch(e) { file = null; }
      setFileBusy(false);
      setBackupFile({ text: encoded, name: name, file: file, kb: Math.max(1, Math.round(encoded.length / 1024)), count: count, shifts: shifts, shareFailed: false });
    }).catch(function(e) { setFileBusy(false); setBackupStatus("Encryption error: " + (e && e.message ? e.message : "unknown")); setBackupWarn(true); });
  };
  // TWO taps on purpose: iOS opens the share sheet only inside a user gesture,
  // and the async encrypt can use that gesture up. So navigator.share runs
  // directly from this tap - never after the encrypt.
  var shareBackupFile = function() {
    var bf = backupFile;
    if (!bf || sharingRef.current || !canShareFile(bf.file)) return;
    sharingRef.current = true;
    var failed = function(e) {
      sharingRef.current = false;
      setBackupFile(function(cur) { return cur === bf ? { ...bf, shareFailed: true } : cur; });
      setBackupStatus("Couldn't open the share sheet" + (e && e.name ? " (" + e.name + ")" : "") + ". Use Copy Encrypted Backup instead.");
      setBackupWarn(true);
    };
    try {
      navigator.share({ files: [bf.file] }).then(function() {   // files only: on iOS, adding text makes a second item
        sharingRef.current = false;
        setBackupStamp(markBackupSaved("file", todayLocal()));
        setBackupFile(null); setBackupWarn(false);
        setBackupStatus("Backup file saved (" + bf.count + " procedures).");
        setTimeout(function() { setBackupStatus(""); }, 5000);
      }).catch(function(e) { if (e && e.name === "AbortError") { sharingRef.current = false; return; } failed(e); });   // sheet closed: the panel stays
    } catch(e) { failed(e); }
  };
  var downloadBackupFile = function() {
    var bf = backupFile;
    if (!bf) return;
    try {
      var u = URL.createObjectURL(new Blob([bf.text], { type: "text/plain" }));
      var a = document.createElement("a");
      a.href = u; a.download = bf.name; a.style.display = "none";
      document.body.appendChild(a); a.click(); document.body.removeChild(a);
      setTimeout(function() { try { URL.revokeObjectURL(u); } catch(e) {} }, 60000);   // not in the same tick
      setBackupStamp(markBackupSaved("file", todayLocal()));
      setBackupFile(null); setBackupWarn(false);
      setBackupStatus("Backup file downloaded (" + bf.name + ").");
      setTimeout(function() { setBackupStatus(""); }, 5000);
    } catch(e) { setBackupStatus("Download failed. Use Copy Encrypted Backup instead."); setBackupWarn(true); }
  };

  var doShare = function() {
    var url = "https://fkhan628.github.io/Work-RVU-Tracker-/";
    var shareData = { title: "RVU Tracker", text: "RVU Tracker - surgical wRVU and CPT tracker (PWA)", url: url };
    var copyFallback = function() {
      var ta = document.createElement("textarea");
      ta.value = url;
      ta.style.cssText = "position:fixed;left:-9999px;top:0;";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand("copy"); } catch(e) {}
      document.body.removeChild(ta);
      setShareStatus("Link copied to clipboard!");
      setTimeout(function() { setShareStatus(""); }, 3000);
    };
    try {
      if (navigator.share) {
        navigator.share(shareData).then(function() {
          setShareStatus("Shared!");
          setTimeout(function() { setShareStatus(""); }, 2500);
        }).catch(function(e) {
          // User cancelled share sheet - no status update needed
          if (e && e.name !== "AbortError") {
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(url).then(function() {
                setShareStatus("Link copied to clipboard!");
                setTimeout(function() { setShareStatus(""); }, 3000);
              }).catch(copyFallback);
            } else {
              copyFallback();
            }
          }
        });
      } else if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(url).then(function() {
          setShareStatus("Link copied to clipboard!");
          setTimeout(function() { setShareStatus(""); }, 3000);
        }).catch(copyFallback);
      } else {
        copyFallback();
      }
    } catch(e) {
      copyFallback();
    }
  };

  // ONE restore path: a pasted code and a chosen file both land here, then
  // finishRestore (whose state object check.js 5c parses - keep it as is).
  // label (a file name, which carries the backup date) goes in the confirm.
  var restoreFromText = function(raw, src, label) {
    var text = String(raw || "").replace(/^\uFEFF/, "").trim();
    var notBackup = src === "file" ? "That file isn't an RVU Tracker backup." : "Invalid backup code.";
    if (!text) { if (src === "file") alert(notBackup); return; }
    var pin = window.RVU_CRYPTO.getPin();
    if (!pin) { alert("PIN session expired. Lock and unlock first."); return; }
    try {
      var decoded;
      try { decoded = decodeURIComponent(escape(atob(text))); } catch(e) { decoded = text; }
      var parsed;
      try { parsed = JSON.parse(decoded); } catch(e) { alert(notBackup + " " + e.message); return; }
      if (parsed && parsed.encrypted && parsed.payload) {
        setBackupStatus("Decrypting backup...");
        window.RVU_CRYPTO.decrypt(pin, parsed.payload).then(function(plaintext) {
          setBackupStatus(""); finishRestore(JSON.parse(plaintext), label);
        }, function(e) {
          setBackupStatus("");
          if (e && e.message === "Invalid encrypted data") { alert("This backup is damaged and can't be opened."); return; }
          // A new phone usually has a different PIN than the one the backup
          // was made with: ask once instead of dead-ending.
          var other = prompt("This backup did not open with this phone's PIN. If it was made with a different PIN, enter that PIN:");
          if (other === null || !String(other).trim()) return;
          setBackupStatus("Decrypting backup...");
          return window.RVU_CRYPTO.decrypt(String(other).trim(), parsed.payload).then(function(pt) {
            setBackupStatus(""); finishRestore(JSON.parse(pt), label);
          }, function() { setBackupStatus(""); alert("Decryption failed with that PIN too. Check the PIN - or the backup may be damaged."); });
        }).catch(function(e) { setBackupStatus(""); alert("Could not restore: " + (e && e.message ? e.message : "unreadable backup")); });
      } else if (parsed && parsed.entries) {
        finishRestore(parsed, label);   // also accepts the plain JSON export, as paste always has
      } else {
        alert(src === "file" ? notBackup : "Invalid backup: no procedure entries found.");
      }
    } catch(e) { alert("Could not restore: " + notBackup + " " + e.message); }
  };
  var doRestore = function() { restoreFromText(restoreText, "code"); };
  var restoreFromFile = function(f) {
    if (!f) return;
    if (f.size > 25 * 1024 * 1024) { alert("That file is too large to be an RVU Tracker backup."); return; }
    var r = new FileReader();
    r.onload = function(ev) { restoreFromText(ev && ev.target ? ev.target.result : "", "file", f.name); };
    r.onerror = function() { alert("Couldn't read that file. You can also open it, copy its text and paste it below."); };
    r.readAsText(f);
  };

  var finishRestore = function(restored, label) {
    if (!restored.entries || !Array.isArray(restored.entries)) {
      alert("Invalid backup: no procedure entries found.");
      return;
    }
    // Call-pay counts too: a backup without call-pay data REPLACES the
    // phone's sites/shifts with nothing, so say so before confirming.
    var cnt = function(v) { return Array.isArray(v) ? v.length : 0; };
    var plural = function(n, w) { return n + " " + w + (n === 1 ? "" : "s"); };
    var bShifts = cnt(restored.payShifts), bSites = cnt(restored.paySites);
    // An older backup with no call-pay data gets the built-in sites on
    // restore (same rule as loading) - count them so the warning is true.
    if (payWillSeed(restored)) bSites = DEFAULT_PAY_SITES.length;
    var pShifts = cnt(data.payShifts), pSites = cnt(data.paySites);
    var msg = (label ? "From " + label + ": " : "") + "Restore " + restored.entries.length + " procedures and " + plural(bShifts, "call-pay shift") + "? This will replace your current data (" + data.entries.length + " procedures, " + plural(pShifts, "call-pay shift") + ").";
    if (bShifts === 0 && bSites === 0 && (pShifts > 0 || pSites > 0)) msg += " WARNING: this backup has no call-pay data - the " + plural(pSites, "site") + " and " + plural(pShifts, "shift") + " on this phone will be removed.";
    if (confirm(msg)) {
      // A restore replaces everything: a pending Undo (e.g. from Delete All)
      // must not act on top of it.
      if (showUndo) showUndo(null);
      // Same repair/migration path as loadData - old backups containing the
      // legacy reconMonths field migrate into institutionData with zero loss.
      repairData(restored);
      upd(function() {
        return {
          entries: restored.entries || [],
          settings: { ...defSettings(), ...(restored.settings || {}) },
          rvuOverrides: restored.rvuOverrides || {},
          favorites: restored.favorites || [],
          institutionData: restored.institutionData || [],
          acuteRoster: restored.acuteRoster || [],
          acuteMe: restored.acuteMe || "",
          acuteMonths: restored.acuteMonths || {},
          templates: restored.templates || [],
          paySites: restored.paySites || [],
          payShifts: restored.payShifts || [],
          dataVersion: restored.dataVersion || DATA_VERSION
        };
      });
      setShowRestore(false);
      setRestoreText("");
      setBackupStatus("");
      alert("Restored " + restored.entries.length + " procedures and " + plural(cnt(restored.payShifts), "call-pay shift") + " successfully!");
    }
  };

  const set = (k, v) => upd(prev => ({ ...prev, settings: { ...prev.settings, [k]: v } }));

  // Single key-clearing path, reused by the Settings card's Remove button and the
  // stranded-key affordance shown when scanning is disabled. Do not duplicate.
  var removeApiKey = function() { upd(function(prev) { var s = { ...prev.settings }; delete s.encryptedApiKey; delete s.apiKey; delete s.apiKeyLast4; return { ...prev, settings: s }; }); };

  // Numeric settings inputs: keep the raw text in LOCAL state while typing and
  // commit only parseFloat-valid numbers to settings. Strings in the store used
  // to trip validateData and silently roll data back on the next launch.
  const [rateText, setRateText] = useState(function() { return settings.ratePerRVU === 0 ? "" : String(settings.ratePerRVU); });
  const [goalText, setGoalText] = useState(function() { return settings.annualGoal === 0 ? "" : String(settings.annualGoal); });
  useEffect(function() {
    if (parseFloat(rateText || "0") !== settings.ratePerRVU) setRateText(settings.ratePerRVU === 0 ? "" : String(settings.ratePerRVU));
  }, [settings.ratePerRVU]);
  useEffect(function() {
    if (parseFloat(goalText || "0") !== settings.annualGoal) setGoalText(settings.annualGoal === 0 ? "" : String(settings.annualGoal));
  }, [settings.annualGoal]);
  const [reconGoalText, setReconGoalText] = useState(function() { return !settings.reconGoal ? "" : String(settings.reconGoal); });
  useEffect(function() {
    if (parseFloat(reconGoalText || "0") !== (settings.reconGoal || 0)) setReconGoalText(!settings.reconGoal ? "" : String(settings.reconGoal));
  }, [settings.reconGoal]);

  // --- Monthly Reconciliation entry state ---
  // expandedMonth: which "YYYY-MM" row is open. Drafts hold raw text while
  // typing (parseFloat committed on Save - Batch 1 discipline; strings never
  // hit the store).
  const [expandedMonth, setExpandedMonth] = useState(null);
  var RECON_MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  // 12 months of the goal year (yearStart-based), pure string math - no Date/UTC.
  var reconYearMonths = useMemo(function() {
    var startStr = (settings.yearStart || (new Date().getFullYear() + "-01-01")).slice(0, 7);
    var y = parseInt(startStr.slice(0, 4), 10);
    var m = parseInt(startStr.slice(5, 7), 10);
    if (isNaN(y) || isNaN(m)) { y = new Date().getFullYear(); m = 1; }
    var out = [];
    for (var i = 0; i < 12; i++) {
      var yy = y + Math.floor((m - 1 + i) / 12);
      var mm = ((m - 1 + i) % 12) + 1;
      out.push(yy + "-" + String(mm).padStart(2, "0"));
    }
    return out;
  }, [settings.yearStart]);
  var reconMonthLabel = function(mk) { return RECON_MONTH_NAMES[parseInt(mk.slice(5, 7), 10) - 1] + " " + mk.slice(0, 4); };

  // --- Acute care group state ---
  var acuteRoster = data.acuteRoster || [];
  var acuteMonths = data.acuteMonths || {};
  const [newPartner, setNewPartner] = useState("");
  const [renaming, setRenaming] = useState(null);
  const [renameDraft, setRenameDraft] = useState("");
  // Procedure template management (create lives in Log, where a selection exists)
  const [tplRenaming, setTplRenaming] = useState(null);
  const [tplRenameDraft, setTplRenameDraft] = useState("");
  var moveTemplate = function(id, dir) {
    upd(function(prev) {
      var l = (prev.templates || []).slice();
      var i = -1;
      l.forEach(function(t, ix) { if (t.id === id) i = ix; });
      var j = i + dir;
      if (i < 0 || j < 0 || j >= l.length) return prev;
      var tmp = l[i]; l[i] = l[j]; l[j] = tmp;
      return { ...prev, templates: l };
    });
  };
  var renameTemplate = function(id) {
    var n = tplRenameDraft.trim();
    if (!n) { setTplRenaming(null); setTplRenameDraft(""); return; }
    upd(function(prev) { return { ...prev, templates: (prev.templates || []).map(function(t) { return t.id === id ? { ...t, name: n } : t; }) }; });
    setTplRenaming(null);
    setTplRenameDraft("");
  };
  var deleteTemplate = function(t) {
    if (!confirm('Delete template "' + t.name + '"? This does not affect any logged procedures.')) return;
    upd(function(prev) { return { ...prev, templates: (prev.templates || []).filter(function(x) { return x.id !== t.id; }) }; });
  };
  const [showAcuteImport, setShowAcuteImport] = useState(false);
  const [acuteImportText, setAcuteImportText] = useState("");
  const [acuteImportStatus, setAcuteImportStatus] = useState("");
  const [poolDraft, setPoolDraft] = useState("");
  const [shiftsDraft, setShiftsDraft] = useState({});
  const [showSplitFor, setShowSplitFor] = useState(null);
  const [copyStatus, setCopyStatus] = useState("");

  var addPartner = function() {
    var n = newPartner.trim();
    if (!n) return;
    upd(function(prev) {
      var r = (prev.acuteRoster || []).slice();
      if (r.indexOf(n) !== -1) return prev;
      r.push(n);
      return { ...prev, acuteRoster: r };
    });
    setNewPartner("");
  };
  var renamePartner = function(oldName) {
    var n = renameDraft.trim();
    if (!n || n === oldName) { setRenaming(null); setRenameDraft(""); return; }
    upd(function(prev) {
      var r = (prev.acuteRoster || []).slice();
      if (r.indexOf(n) !== -1) return prev; // collision with existing name: no-op
      var i = r.indexOf(oldName);
      if (i === -1) return prev;
      r[i] = n;
      // Migrate the name key inside every month so history follows the rename.
      var am = {};
      Object.keys(prev.acuteMonths || {}).forEach(function(mk) {
        var m = prev.acuteMonths[mk];
        var sh = { ...((m && m.shifts) || {}) };
        if (Object.prototype.hasOwnProperty.call(sh, oldName)) { sh[n] = sh[oldName]; delete sh[oldName]; }
        am[mk] = { pool: m.pool, shifts: sh };
      });
      return { ...prev, acuteRoster: r, acuteMonths: am, acuteMe: prev.acuteMe === oldName ? n : prev.acuteMe };
    });
    setRenaming(null);
    setRenameDraft("");
  };
  var removePartner = function(name) {
    var monthsWith = Object.keys(acuteMonths).filter(function(mk) { var s = (acuteMonths[mk] || {}).shifts || {}; return Object.prototype.hasOwnProperty.call(s, name); }).length;
    var warn = "Remove " + name + " from the roster?";
    if ((data.acuteMe || "") === name) warn += " NOTE: this partner is marked as YOU - your acute share lines will stop showing until you mark a new Me.";
    if (monthsWith > 0) warn += " " + monthsWith + " historical month(s) keep their entries; the name only stops appearing for new months.";
    if (!confirm(warn)) return;
    upd(function(prev) { return { ...prev, acuteRoster: (prev.acuteRoster || []).filter(function(x) { return x !== name; }) }; });
  };
  var setAcuteMe = function(name) { upd(function(prev) { return { ...prev, acuteMe: name }; }); };

  // All-or-nothing JSON import: numeric-coerce everything into a clean copy
  // first; if ANY month is malformed, import NOTHING and name the bad month.
  var doAcuteImport = function() {
    var txt = acuteImportText.trim();
    if (!txt) return;
    var parsed;
    try { parsed = JSON.parse(txt); } catch(e) { setAcuteImportStatus("Import failed: not valid JSON. Nothing was imported."); return; }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed) || !parsed.acuteMonths || typeof parsed.acuteMonths !== "object" || Array.isArray(parsed.acuteMonths)) {
      setAcuteImportStatus("Import failed: missing acuteMonths object. Nothing was imported."); return;
    }
    var cleanMonths = {};
    var namesSeen = {};
    var monthKeys = Object.keys(parsed.acuteMonths);
    for (var i = 0; i < monthKeys.length; i++) {
      var mk = monthKeys[i];
      if (!/^\d{4}-\d{2}$/.test(mk)) { setAcuteImportStatus("Import failed: bad month key \"" + mk + "\" (expected YYYY-MM). Nothing was imported."); return; }
      var m = parsed.acuteMonths[mk];
      if (!m || typeof m !== "object" || Array.isArray(m)) { setAcuteImportStatus("Import failed: month " + mk + " is not an object. Nothing was imported."); return; }
      var pool = typeof m.pool === "string" ? parseFloat(m.pool) : m.pool;
      if (typeof pool !== "number" || isNaN(pool) || pool < 0) { setAcuteImportStatus("Import failed: month " + mk + " has an unreadable pool value. Nothing was imported."); return; }
      var shifts = {};
      var sk = Object.keys(m.shifts || {});
      for (var j = 0; j < sk.length; j++) {
        var nm = String(sk[j]).trim();
        if (!nm) { setAcuteImportStatus("Import failed: month " + mk + " has an empty partner name. Nothing was imported."); return; }
        var sv = m.shifts[sk[j]];
        if (typeof sv === "string") sv = parseFloat(sv);
        if (typeof sv !== "number" || isNaN(sv) || sv < 0) { setAcuteImportStatus("Import failed: month " + mk + " has an unreadable shift count for " + nm + ". Nothing was imported."); return; }
        shifts[nm] = sv;
        namesSeen[nm] = true;
      }
      cleanMonths[mk] = { pool: pool, shifts: shifts };
    }
    var pastedRoster = Array.isArray(parsed.acuteRoster) ? parsed.acuteRoster.map(function(x) { return String(x).trim(); }).filter(function(x) { return x; }) : [];
    var pastedMe = (typeof parsed.acuteMe === "string" && parsed.acuteMe.trim()) ? parsed.acuteMe.trim() : null;
    upd(function(prev) {
      var roster = (prev.acuteRoster || []).slice();
      pastedRoster.forEach(function(n) { if (roster.indexOf(n) === -1) roster.push(n); });
      Object.keys(namesSeen).forEach(function(n) { if (roster.indexOf(n) === -1) roster.push(n); });
      var am = { ...(prev.acuteMonths || {}) };
      Object.keys(cleanMonths).forEach(function(k) { am[k] = cleanMonths[k]; });
      return { ...prev, acuteRoster: roster, acuteMonths: am, acuteMe: pastedMe !== null ? pastedMe : (prev.acuteMe || "") };
    });
    setAcuteImportStatus("Imported " + monthKeys.length + " month" + (monthKeys.length === 1 ? "" : "s") + ", " + Object.keys(namesSeen).length + " partner" + (Object.keys(namesSeen).length === 1 ? "" : "s") + ".");
    setAcuteImportText("");
  };

  // Clipboard with the mandated hidden-textarea fallback.
  var copyText = function(text, doneMsg) {
    var fallback = function() {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;left:-9999px;top:0;";
      document.body.appendChild(ta);
      ta.focus();
      ta.select();
      try { document.execCommand("copy"); } catch(e) {}
      document.body.removeChild(ta);
      setCopyStatus(doneMsg);
      setTimeout(function() { setCopyStatus(""); }, 3000);
    };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function() {
        setCopyStatus(doneMsg);
        setTimeout(function() { setCopyStatus(""); }, 3000);
      }).catch(fallback);
    } else { fallback(); }
  };
  var copyAcuteTable = function(mk) {
    var m = acuteMonths[mk];
    if (!m) return;
    var sp = computeAcuteSplit(m);
    var lines = ["Acute care split - " + reconMonthLabel(mk)];
    if (sp.empty) {
      lines.push("Pool: " + round2(sp.pool).toFixed(2) + " | no shifts entered");
    } else {
      lines.push("Pool: " + round2(sp.pool).toFixed(2) + " | Units: " + (sp.units % 1 === 0 ? String(sp.units) : round2(sp.units).toFixed(2)) + " | Value/unit: " + round2(sp.valuePerUnit).toFixed(2));
      Object.keys(m.shifts).forEach(function(n) {
        lines.push(n + ": " + m.shifts[n] + " shift" + (m.shifts[n] === 1 ? "" : "s") + " = " + round2(sp.shares[n]).toFixed(2));
      });
    }
    copyText(lines.join("\n"), "Split table copied!");
  };
  // Save commits the month's acute entry (pool + shifts). Institution totals
  // are read-only here - they live in Compare.
  var saveAcuteMonth = function() {
    var key = expandedMonth;
    if (!key) return;
    var pd = poolDraft.trim();
    var shiftEntries = {};
    var anyShift = false;
    Object.keys(shiftsDraft).forEach(function(nm) {
      var st = String(shiftsDraft[nm]).trim();
      if (st === "") return; // blank = not entered (never zero)
      var sv = parseFloat(st);
      if (isNaN(sv) || sv < 0) return;
      shiftEntries[nm] = sv;
      anyShift = true;
    });
    upd(function(prev) {
      var am = { ...(prev.acuteMonths || {}) };
      if (pd === "" && !anyShift) { delete am[key]; }
      else {
        var pv = pd === "" ? 0 : parseFloat(pd);
        if (isNaN(pv) || pv < 0) pv = 0;
        am[key] = { pool: pv, shifts: shiftEntries };
      }
      return { ...prev, acuteMonths: am };
    });
    setExpandedMonth(null);
    setPoolDraft("");
    setShiftsDraft({});
    setShowSplitFor(null);
  };
  var clearAcuteMonth = function() {
    var key = expandedMonth;
    if (!key) return;
    upd(function(prev) {
      var am = { ...(prev.acuteMonths || {}) };
      delete am[key];
      return { ...prev, acuteMonths: am };
    });
    setExpandedMonth(null);
    setPoolDraft("");
    setShiftsDraft({});
    setShowSplitFor(null);
  };
  var onNumericChange = function(raw, setText, key) {
    var v = raw.replace(/[^0-9.]/g, "");
    setText(v);
    if (v === "") { set(key, 0); return; }
    var n = parseFloat(v);
    if (!isNaN(n) && n >= 0) set(key, n);
  };
  // wRVU editor: a row commits its typed draft on blur or Enter (Escape
  // reverts) only when the text changed; rvuOverrideFromText (utils.js) is
  // the rule. Nothing changed = no store write.
  const commitOverride = (code, text) => {
    const orig = CPT_DATABASE_DEFAULT.find(c => c.code === code);
    const val = rvuOverrideFromText(text, orig ? orig.wRVU : undefined);
    if (val === undefined) return;
    const cur = data.rvuOverrides || {};
    if (val === null ? cur[code] === undefined : cur[code] === val) return;
    upd(prev => {
      const o = { ...(prev.rvuOverrides || {}) };
      if (val === null) delete o[code]; else o[code] = val;
      return { ...prev, rvuOverrides: o };
    });
  };
  const resetOverrides = () => { if (confirm("Reset all wRVU values to CMS defaults?")) upd(prev => ({ ...prev, rvuOverrides: {} })); };

  const editFiltered = useMemo(() => {
    let items = db;
    if (editCat !== "All") items = items.filter(c => c.category === editCat);
    if (editSearch.trim()) { const q = editSearch.trim(); items = items.filter(c => matchesCPTQuery(c, q)); }
    return items;
  }, [db, editCat, editSearch]);

  const expCSV = () => {
    // Credit is appended LAST so older spreadsheets keep their column layout;
    // every row is kept (a no-credit case shows Compensation 0.00).
    const h = ["Date","CPT","Description","Category","Base wRVU","Modifiers","Adjusted wRVU","Compensation","Notes","Credit"];
    const rows = data.entries.map(e => [e.date, e.cptCode, e.description || '', e.category, e.baseRVU, (e.modifiers || []).join(';'), e.adjustedRVU.toFixed(2), (creditedRVU(e) * settings.ratePerRVU).toFixed(2), e.notes || '', isNoCredit(e) ? "No credit" : "Credited"]);
    var csv = [h.join(','), ...rows.map(r => r.map(csvField).join(','))].join('\n');
    // Acute block appended as a second long-form table. Round-trip safety: under
    // the entries header the CPT column is index 1; every acute row (incl. its
    // header) has the "YYYY-MM" month there - never a 5-digit run - so the app's
    // own CSV importer rejects these rows instead of minting junk entries.
    var amKeys = Object.keys(acuteMonths).sort();
    if (amKeys.length > 0) {
      var acuteRows = [["Section","Month","Partner","Shifts","Share","Pool","Units","ValuePerUnit"]];
      amKeys.forEach(function(mk) {
        var m = acuteMonths[mk];
        var sp = computeAcuteSplit(m);
        var names = Object.keys((m && m.shifts) || {});
        if (names.length === 0) {
          acuteRows.push(["Acute", mk, "", "", "", round2(sp.pool).toFixed(2), "", ""]);
        } else {
          names.forEach(function(nm) {
            acuteRows.push(["Acute", mk, nm, m.shifts[nm], round2(sp.shares[nm] || 0).toFixed(2), round2(sp.pool).toFixed(2), sp.units, round2(sp.valuePerUnit).toFixed(2)]);
          });
        }
      });
      csv += "\n\n" + acuteRows.map(function(r) { return r.map(csvField).join(","); }).join("\n");
    }
    const b = new Blob([csv], { type: "text/csv" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = "rvu-export-" + todayLocal() + ".csv"; a.click(); URL.revokeObjectURL(u);
  };
  const expJSON = () => {
    // Key material is deliberately NOT part of the device-transfer export.
    // (The separate encrypted clipboard backup is PIN-bound and unaffected.)
    const clean = { ...data, settings: { ...data.settings } };
    delete clean.settings.encryptedApiKey;
    delete clean.settings.apiKey;
    delete clean.settings.apiKeyLast4;
    const b = new Blob([JSON.stringify(clean, null, 2)], { type: "application/json" }); const u = URL.createObjectURL(b); const a = document.createElement("a"); a.href = u; a.download = "rvu-export-" + todayLocal() + ".json"; a.click(); URL.revokeObjectURL(u);
  };

  // SheetJS is lazy-loaded on first use (loadXLSX in utils.js) - the
  // library is no longer present at boot.
  const [excelBusy, setExcelBusy] = useState(false);
  const expExcel = () => {
    if (excelBusy) return;
    setExcelBusy(true);
    loadXLSX().then(function() { setExcelBusy(false); doExcelExport(); }).catch(function(err) {
      setExcelBusy(false);
      alert(err && err.message ? err.message : "Could not load the Excel library.");
    });
  };
  const doExcelExport = () => {
    try {
      var wb = XLSX.utils.book_new();
      var monthMap = {};
      data.entries.forEach(function(e) {
        var key = e.date.slice(0, 7);
        if (!monthMap[key]) monthMap[key] = { rvu: 0, comp: 0, cases: 0, ncCases: 0, ncRVU: 0 };
        monthMap[key].rvu += creditedRVU(e);
        monthMap[key].comp += creditedRVU(e) * settings.ratePerRVU;
        if (isNoCredit(e)) { monthMap[key].ncCases += 1; monthMap[key].ncRVU += noCreditRVU(e); } else monthMap[key].cases += 1;
      });
      var instData = data.institutionData || [];
      if (instData.length > 0) {
        var compHeaders = ["Month", "Work RVU (Private)", "Split RVU (Call)", "Institution Total", "Tracked RVUs", "Difference", "Diff %", "Inst Cases", "Tracked Cases", "Logged, no credit (cases)"];
        var compSorted = instData.slice().sort(function(a, b) { return a.month.localeCompare(b.month); });
        var compRows = compSorted.map(function(d) {
          var instT = (d.workRVU || 0) + (d.splitRVU || 0);
          var meas = monthMap[d.month];
          var measT = meas ? meas.rvu : 0;
          var measCases = meas ? meas.cases : 0;
          var diff = measT - instT;
          var diffPct = instT > 0 ? ((diff / instT) * 100) : 0;
          return [d.month, parseFloat((d.workRVU || 0).toFixed(2)), parseFloat((d.splitRVU || 0).toFixed(2)), parseFloat(instT.toFixed(2)), parseFloat(measT.toFixed(2)), parseFloat(diff.toFixed(2)), parseFloat(diffPct.toFixed(1)), d.cases || 0, measCases, meas ? meas.ncCases : 0];
        });
        var cTotWork = compRows.reduce(function(s, r) { return s + r[1]; }, 0);
        var cTotSplit = compRows.reduce(function(s, r) { return s + r[2]; }, 0);
        var cTotInst = compRows.reduce(function(s, r) { return s + r[3]; }, 0);
        var cTotMeas = compRows.reduce(function(s, r) { return s + r[4]; }, 0);
        var cTotDiff = cTotMeas - cTotInst;
        var cTotPct = cTotInst > 0 ? ((cTotDiff / cTotInst) * 100) : 0;
        var cTotICases = compRows.reduce(function(s, r) { return s + r[7]; }, 0);
        var cTotTCases = compRows.reduce(function(s, r) { return s + r[8]; }, 0);
        var cTotNC = compRows.reduce(function(s, r) { return s + r[9]; }, 0);
        compRows.push(["TOTAL", parseFloat(cTotWork.toFixed(2)), parseFloat(cTotSplit.toFixed(2)), parseFloat(cTotInst.toFixed(2)), parseFloat(cTotMeas.toFixed(2)), parseFloat(cTotDiff.toFixed(2)), parseFloat(cTotPct.toFixed(1)), cTotICases, cTotTCases, cTotNC]);
        var compData = [compHeaders].concat(compRows);
        var ws3 = XLSX.utils.aoa_to_sheet(compData);
        ws3["!cols"] = [{ wch: 10 }, { wch: 17 }, { wch: 15 }, { wch: 16 }, { wch: 14 }, { wch: 12 }, { wch: 8 }, { wch: 11 }, { wch: 13 }, { wch: 22 }];
        XLSX.utils.book_append_sheet(wb, ws3, "Institution Comparison");
      }
      var procHeaders = ["Date", "CPT Code", "Description", "Category", "Type", "Base wRVU", "Modifiers", "Adjusted wRVU", "Compensation", "Patient", "Notes", "Credit"];
      var procRows = data.entries.slice().sort(function(a, b) { return a.date.localeCompare(b.date); }).map(function(e) {
        return [e.date, e.cptCode, e.description, e.category, e.isCall ? "Call" : "Private", e.baseRVU, (e.modifiers || []).join(", "), parseFloat(e.adjustedRVU.toFixed(2)), parseFloat((creditedRVU(e) * settings.ratePerRVU).toFixed(2)), e.encounterId || "", e.notes || "", isNoCredit(e) ? "No credit" : "Credited"];
      });
      var procData = [procHeaders].concat(procRows);
      var ws1 = XLSX.utils.aoa_to_sheet(procData);
      ws1["!cols"] = [{ wch: 11 }, { wch: 8 }, { wch: 40 }, { wch: 22 }, { wch: 8 }, { wch: 10 }, { wch: 12 }, { wch: 12 }, { wch: 13 }, { wch: 8 }, { wch: 30 }, { wch: 10 }];
      XLSX.utils.book_append_sheet(wb, ws1, "Procedures");
      var monthKeys = Object.keys(monthMap).sort();
      var sumHeaders = ["Month", "Tracked wRVUs", "Cases", "Avg wRVU/Case", "Compensation", "Logged, no credit (cases)", "Logged, no credit (wRVU)"];
      var sumRows = monthKeys.map(function(k) {
        var m = monthMap[k];
        return [k, parseFloat(m.rvu.toFixed(2)), m.cases, parseFloat((m.rvu / Math.max(m.cases, 1)).toFixed(2)), parseFloat(m.comp.toFixed(2)), m.ncCases, parseFloat(m.ncRVU.toFixed(2))];
      });
      var sumTotRVU = sumRows.reduce(function(s, r) { return s + r[1]; }, 0);
      var sumTotCases = sumRows.reduce(function(s, r) { return s + r[2]; }, 0);
      var sumTotComp = sumRows.reduce(function(s, r) { return s + r[4]; }, 0);
      var sumTotNC = sumRows.reduce(function(s, r) { return s + r[5]; }, 0);
      var sumTotNCRVU = sumRows.reduce(function(s, r) { return s + r[6]; }, 0);
      sumRows.push(["TOTAL", parseFloat(sumTotRVU.toFixed(2)), sumTotCases, parseFloat((sumTotRVU / Math.max(sumTotCases, 1)).toFixed(2)), parseFloat(sumTotComp.toFixed(2)), sumTotNC, parseFloat(sumTotNCRVU.toFixed(2))]);
      var sumData = [sumHeaders].concat(sumRows);
      var ws2 = XLSX.utils.aoa_to_sheet(sumData);
      ws2["!cols"] = [{ wch: 10 }, { wch: 14 }, { wch: 8 }, { wch: 14 }, { wch: 14 }, { wch: 22 }, { wch: 22 }];
      XLSX.utils.book_append_sheet(wb, ws2, "Monthly Summary");
      var codeMap = {};
      data.entries.forEach(function(e) {
        if (!codeMap[e.cptCode]) codeMap[e.cptCode] = { code: e.cptCode, desc: e.description, cat: e.category, count: 0, totalRVU: 0, ncCount: 0 };
        codeMap[e.cptCode].count += 1;
        codeMap[e.cptCode].totalRVU += creditedRVU(e);
        if (isNoCredit(e)) codeMap[e.cptCode].ncCount += 1;
      });
      var topList = Object.values(codeMap).sort(function(a, b) { return b.totalRVU - a.totalRVU; });
      // Times Logged counts every logged case; Avg wRVU is over credited cases.
      var topHeaders = ["CPT Code", "Description", "Category", "Times Logged", "Total wRVUs", "Avg wRVU", "Total Compensation", "Logged, no credit"];
      var topRows = topList.map(function(t) {
        var cred = t.count - t.ncCount;
        return [t.code, t.desc, t.cat, t.count, parseFloat(t.totalRVU.toFixed(2)), cred > 0 ? parseFloat((t.totalRVU / cred).toFixed(2)) : "", parseFloat((t.totalRVU * settings.ratePerRVU).toFixed(2)), t.ncCount];
      });
      var topData = [topHeaders].concat(topRows);
      var ws4 = XLSX.utils.aoa_to_sheet(topData);
      ws4["!cols"] = [{ wch: 10 }, { wch: 40 }, { wch: 22 }, { wch: 12 }, { wch: 12 }, { wch: 10 }, { wch: 16 }, { wch: 16 }];
      XLSX.utils.book_append_sheet(wb, ws4, "Top Procedures");
      XLSX.writeFile(wb, "RVU-Export-" + todayLocal() + ".xlsx");
    } catch (e) {
      alert("Excel export failed: " + e.message);
    }
  };
  // Deletes logged procedures only (settings, Compare, acute and call-pay
  // data stay) - with the standard 8s Undo, like History's delete.
  const clear = () => {
    var all = data.entries || [];
    if (!all.length) { alert("There are no logged procedures to delete."); return; }
    if (!confirm("Delete all " + all.length + " logged procedures? Settings, Compare, acute and call-pay data are kept. You can Undo for a few seconds.")) return;
    upd(prev => ({ ...prev, entries: [] }));
    if (showUndo) showUndo({ type: "delete", entries: all, message: "Deleted " + all.length + " procedures" });
  };

  const removeDuplicates = () => {
    // Duplicate = same date + CPT + modifiers + PATIENT + NOTES + call fields
    // (Call/Private, call site, credit) - the one rule is utils.js
    // entryDuplicateScan. The old key ignored encounterId/notes and silently
    // flattened legitimate same-day repeats (same code on two patients, or a
    // deliberate repeat procedure). The confirm PREVIEWS exactly what will be
    // removed, and the removal is undoable via the standard toast. Copies
    // that differ only in Call/Private, call site or credit are never merged -
    // they are reported for the user to check instead.
    var scan = entryDuplicateScan(data.entries);
    var unique = scan.unique, removed = scan.removed, mixed = scan.mixed;
    var mixedNote = mixed > 0 ? "\n\n" + mixed + " case" + (mixed === 1 ? " is" : "s are") + " logged more than once with a different Call/Private, call site or credit - not removed. Check " + (mixed === 1 ? "it" : "them") + " in History." : "";
    if (removed.length === 0) {
      alert("No duplicates found. (Same-day repeats with different patient initials, notes, Call/Private, call site or credit are not counted as duplicates.)" + mixedNote);
      return;
    }
    var preview = removed.slice(0, 8).map(function(e) {
      var site = e.isCall ? entrySiteLabel(e, data.paySites || []) : "";
      return "  " + e.date + "  " + e.cptCode + "  " + (e.adjustedRVU || 0).toFixed(2) + " wRVU" + (e.encounterId ? "  " + e.encounterId : "") + (e.isCall ? "  call" + (site ? " at " + site : "") : "") + (isNoCredit(e) ? "  no credit" : "");
    }).join("\n");
    if (removed.length > 8) preview += "\n  ...and " + (removed.length - 8) + " more";
    if (confirm("Remove " + removed.length + " duplicate(s)? Exact copies only - same date, code, modifiers, patient, notes, Call/Private, call site and credit.\n\n" + preview + mixedNote)) {
      upd(function(prev) { return { ...prev, entries: unique }; });
      if (showUndo) showUndo({ type: "delete", entries: removed, message: "Removed " + removed.length + " duplicate(s)" });
    }
  };

  const tRVU = data.entries.reduce((s, e) => s + creditedRVU(e), 0);
  // Summary Stats count credited cases; no-credit cases get one quiet line.
  const ncCount = data.entries.filter(isNoCredit).length;
  const ncRVU = data.entries.reduce((s, e) => s + noCreditRVU(e), 0);
  const credCount = data.entries.length - ncCount;
  const avg = credCount > 0 ? tRVU / credCount : 0;
  // Same test as getDB: only a truthy override is in force. A stored 0 is
  // inert, so it is neither counted nor badged "custom".
  const ovr = data.rvuOverrides || {};
  const overrideCount = Object.keys(ovr).filter(k => ovr[k]).length;

  return (<div style={S.page}>
    <div style={S.header}><h1 style={S.title}>Settings</h1></div>

    {/* Theme toggle */}
    <div style={S.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={S.cardLabel}>Appearance</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>{theme === "dark" ? "Dark mode" : "Light mode"}</div>
        </div>
        <button onClick={toggleTheme} style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid var(--border-default)", background: theme === "dark" ? "var(--bg-card)" : "rgba(14,165,233,0.1)", color: theme === "dark" ? "var(--text-primary)" : "#0ea5e9", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6, transition: "all 0.2s" }}>
          <span style={{ fontSize: 16 }}>{theme === "dark" ? "\u2600" : "\u263D"}</span>
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
      </div>
    </div>

    {/* Security */}
    <div style={{ ...S.card, border: "1px solid rgba(16,185,129,0.2)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div>
          <div style={S.cardLabel}>Security</div>
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>PIN lock with AES-256-GCM encryption</div>
        </div>
        <button onClick={() => { if (window.RVU_CRYPTO && window.RVU_CRYPTO.lock) window.RVU_CRYPTO.lock(); }} style={{ padding: "8px 16px", borderRadius: 10, border: "1px solid rgba(239,68,68,0.3)", background: "rgba(239,68,68,0.05)", color: "#ef4444", fontSize: 13, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", gap: 6 }}>
          <span style={{ fontSize: 14 }}>{"\uD83D\uDD12"}</span>
          Lock Now
        </button>
      </div>
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8, lineHeight: 1.5 }}>Auto-locks after 5 min of inactivity. API key is encrypted at rest. Backups are AES encrypted with your PIN.</div>
      <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--bg-inset)", borderRadius: 8, border: "1px solid var(--border-subtle)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>Recovery Hint</div>
          <button onClick={() => setEditingHint(!editingHint)} style={{ background: "none", border: "none", color: "#0ea5e9", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>{editingHint ? "Cancel" : (hintText ? "Edit" : "Add")}</button>
        </div>
        {!editingHint ? (
          <div style={{ fontSize: 12, color: hintText ? "var(--text-primary)" : "var(--text-faint)", marginTop: 4, fontStyle: hintText ? "normal" : "italic" }}>{hintText || "No hint set"}</div>
        ) : (
          <div style={{ marginTop: 6 }}>
            <input type="text" maxLength={100} value={hintText} onChange={e => setHintText(e.target.value)} placeholder="e.g. Birthday year + house number" style={{ width: "100%", padding: "8px 10px", borderRadius: 6, border: "1px solid var(--border-default)", background: "var(--bg-inset)", color: "var(--text-primary)", fontSize: 12, fontFamily: "inherit", outline: "none", boxSizing: "border-box" }} />
            <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
              <button onClick={() => { try { if (hintText.trim()) localStorage.setItem("rvu-pin-hint", hintText.trim()); else localStorage.removeItem("rvu-pin-hint"); } catch(e) {} setEditingHint(false); }} style={{ flex: 1, padding: "6px 10px", borderRadius: 6, border: "none", background: "#0ea5e9", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>Save Hint</button>
              {hintText && <button onClick={() => { setHintText(""); try { localStorage.removeItem("rvu-pin-hint"); } catch(e) {} setEditingHint(false); }} style={{ padding: "6px 10px", borderRadius: 6, border: "1px solid var(--border-default)", background: "none", color: "#ef4444", fontSize: 11, cursor: "pointer", fontFamily: "inherit" }}>Remove</button>}
            </div>
          </div>
        )}
      </div>
      {bioAvailable && <div style={{ marginTop: 10, padding: "10px 12px", background: "var(--bg-inset)", borderRadius: 8, border: "1px solid var(--border-subtle)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <div>
            <div style={{ fontSize: 12, color: "var(--text-muted)", fontWeight: 600 }}>{"\uD83E\uDDEC"} Biometric Unlock</div>
            <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 2 }}>Use Face ID or fingerprint to unlock</div>
          </div>
          <button onClick={function() {
            if (bioEnabled) {
              window.RVU_CRYPTO.disableBiometrics();
              setBioEnabled(false);
              setBioStatus("Biometrics disabled");
              setTimeout(function() { setBioStatus(""); }, 2000);
            } else {
              var pin = window.RVU_CRYPTO.getPin();
              if (!pin) { setBioStatus("PIN session expired. Lock and unlock first."); return; }
              setBioStatus("Setting up...");
              window.RVU_CRYPTO.enableBiometrics(pin).then(function() {
                setBioEnabled(true);
                setBioStatus("Biometrics enabled!");
                setTimeout(function() { setBioStatus(""); }, 2000);
              }).catch(function(e) {
                setBioStatus("Setup failed: " + (e.message || "Cancelled"));
                setTimeout(function() { setBioStatus(""); }, 3000);
              });
            }
          }} style={{ padding: "8px 16px", borderRadius: 10, border: bioEnabled ? "1px solid rgba(16,185,129,0.3)" : "1px solid var(--border-default)", background: bioEnabled ? "rgba(16,185,129,0.08)" : "var(--bg-card)", color: bioEnabled ? "#10b981" : "var(--text-muted)", fontSize: 12, fontWeight: 600, cursor: "pointer", fontFamily: "inherit" }}>
            {bioEnabled ? "Disable" : "Enable"}
          </button>
        </div>
        {bioStatus && <div style={{ fontSize: 11, color: bioStatus.includes("fail") || bioStatus.includes("expired") ? "#ef4444" : "#10b981", marginTop: 6 }}>{bioStatus}</div>}
      </div>}
    </div>

    <div style={S.card}><div style={S.cardLabel}>Compensation Rate</div><div style={S.fieldGroup}><label style={S.fieldLabel}>$ per wRVU</label><input type="text" inputMode="decimal" value={rateText} onChange={e => onNumericChange(e.target.value, setRateText, "ratePerRVU")} onBlur={function() { setRateText(settings.ratePerRVU === 0 ? "" : String(settings.ratePerRVU)); }} placeholder="0" style={S.numberInput} /></div></div>
    <div style={S.card}><div style={S.cardLabel}>Yearly Goals</div>
      <div style={S.fieldGroup}><label style={S.fieldLabel}>OR / Tracked goal (logged cases)</label><input type="text" inputMode="decimal" value={goalText} onChange={e => onNumericChange(e.target.value, setGoalText, "annualGoal")} onBlur={function() { setGoalText(settings.annualGoal === 0 ? "" : String(settings.annualGoal)); }} placeholder="0" style={S.numberInput} /></div>
      <div style={S.fieldGroup}><label style={S.fieldLabel}>Reconciliation goal (total incl. call + clinic)</label><input type="text" inputMode="decimal" value={reconGoalText} onChange={e => onNumericChange(e.target.value, setReconGoalText, "reconGoal")} onBlur={function() { setReconGoalText(!settings.reconGoal ? "" : String(settings.reconGoal)); }} placeholder="0" style={S.numberInput} /></div>
      <div style={S.fieldGroup}><label style={S.fieldLabel}>Year Start Date</label><input type="date" value={settings.yearStart} onChange={e => set("yearStart", e.target.value)} style={S.dateInput} /></div></div>

    {/* Monthly Acute Care - the group pool + per-partner shifts, per month.
        Institution monthly totals are read-only here; they live in Compare.
        The expanded panel is a labeled-fields stack - future per-month fields
        join it; do not rebuild it as a single-field widget. */}
    <div style={S.card}>
      <div style={S.cardLabel}>Monthly Acute Care</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>The group's acute-care pool and each partner's shifts, per month. Tap a month to add or edit. Institution totals are shown for reference - edit those in Compare.</div>
      <div style={{ marginTop: 8 }}>
        {reconYearMonths.map(function(mk) {
          var instRow = (data.institutionData || []).find(function(r) { return r && r.month === mk; });
          var instTotalRef = instRow ? (instRow.workRVU || 0) + (instRow.splitRVU || 0) : undefined;
          var acuteEntry = acuteMonths[mk];
          var isOpen = expandedMonth === mk;
          // Grid rows: roster order first, then any historical names in this
          // month that are no longer on the roster (so Save round-trips them).
          var gridNames = acuteRoster.slice();
          if (acuteEntry && acuteEntry.shifts) Object.keys(acuteEntry.shifts).forEach(function(n) { if (gridNames.indexOf(n) === -1) gridNames.push(n); });
          var openRow = function() {
            if (isOpen) { setExpandedMonth(null); setPoolDraft(""); setShiftsDraft({}); setShowSplitFor(null); return; }
            setExpandedMonth(mk);
            setPoolDraft(acuteEntry && acuteEntry.pool !== undefined ? String(acuteEntry.pool) : "");
            var sd = {};
            if (acuteEntry && acuteEntry.shifts) Object.keys(acuteEntry.shifts).forEach(function(n) { sd[n] = String(acuteEntry.shifts[n]); });
            setShiftsDraft(sd);
            setShowSplitFor(null);
          };
          var saveDisabled = poolDraft.trim() !== "" && isNaN(parseFloat(poolDraft));
          return (<div key={mk} style={{ borderBottom: "1px solid rgba(51,65,85,0.4)" }}>
            <div onClick={openRow} style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "10px 2px", cursor: "pointer" }}>
              <span style={{ fontSize: 13, color: acuteEntry ? "var(--text-primary)" : "var(--text-dim)" }}>{reconMonthLabel(mk)}</span>
              <span style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
                {instTotalRef !== undefined && <span style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "var(--text-faint)" }}>inst {round2(instTotalRef).toFixed(1)}</span>}
                <span style={{ fontSize: 13, fontFamily: "JetBrains Mono", color: acuteEntry ? "#34d399" : "var(--text-faint)", fontWeight: acuteEntry ? 600 : 400 }}>{acuteEntry ? round2(acuteEntry.pool).toLocaleString() : "\u2014"}</span>
              </span>
            </div>
            {isOpen && <div style={{ padding: "2px 2px 12px" }}>
              {/* per-month fields stack */}
              {instTotalRef !== undefined && <div style={{ fontSize: 11, color: "var(--text-faint)", marginBottom: 8, padding: "6px 10px", borderRadius: 6, background: "var(--bg-inset)", border: "1px dashed var(--border-default)" }}>
                Institution total (Compare): <span style={{ fontFamily: "JetBrains Mono", color: "var(--text-muted)" }}>{round2(instTotalRef).toLocaleString()}</span> - read-only, edit in Compare
              </div>}
              {acuteRoster.length > 0 && <>
                <div style={{ fontSize: 10, color: "#34d399", textTransform: "uppercase", letterSpacing: 0.8, fontWeight: 700, margin: "6px 0 6px" }}>Acute care (group)</div>
                <div style={S.fieldGroup}><label style={S.fieldLabel}>Pool wRVU (group total)</label>
                  <input type="text" inputMode="decimal" value={poolDraft} onChange={function(e) { setPoolDraft(e.target.value.replace(/[^0-9.]/g, "")); }} placeholder="0" autoFocus style={S.numberInput} />
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 10px", marginBottom: 8 }}>
                  {gridNames.map(function(nm) {
                    return (<div key={nm} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                      <span style={{ flex: 1, fontSize: 11, color: acuteRoster.indexOf(nm) === -1 ? "var(--text-faint)" : "var(--text-muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nm}</span>
                      <input type="text" inputMode="decimal" value={shiftsDraft[nm] !== undefined ? shiftsDraft[nm] : ""} onChange={function(e) { var v = e.target.value.replace(/[^0-9.]/g, ""); setShiftsDraft(function(prev) { var c = { ...prev }; c[nm] = v; return c; }); }} placeholder="-" style={{ width: 52, padding: "5px 6px", background: "var(--bg-inset)", border: "1px solid var(--border-default)", borderRadius: 6, color: "var(--text-bright)", fontSize: 12, fontFamily: "JetBrains Mono", textAlign: "right", outline: "none" }} />
                    </div>);
                  })}
                </div>
              </>}
              <div style={{ display: "flex", gap: 8 }}>
                <button onClick={saveAcuteMonth} disabled={saveDisabled} style={{ ...S.saveBtn, flex: 1, padding: "8px 12px", fontSize: 12, opacity: saveDisabled ? 0.4 : 1 }}>Save</button>
                {acuteEntry && <button onClick={function() { setShowSplitFor(showSplitFor === mk ? null : mk); }} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(52,211,153,0.3)", background: "transparent", color: "#34d399", fontSize: 12, cursor: "pointer" }}>{showSplitFor === mk ? "Hide split" : "View split"}</button>}
                <button onClick={function() { setExpandedMonth(null); setPoolDraft(""); setShiftsDraft({}); setShowSplitFor(null); }} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 12, cursor: "pointer" }}>Cancel</button>
                {acuteEntry && <button onClick={clearAcuteMonth} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "#ef4444", fontSize: 12, cursor: "pointer" }}>Clear</button>}
              </div>
              {showSplitFor === mk && (function() {
                var m = acuteMonths[mk];
                if (!m) return <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8 }}>No acute data saved for this month yet.</div>;
                var sp = computeAcuteSplit(m);
                if (sp.empty) return <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 8 }}>Pool {round2(sp.pool).toFixed(2)} - no shifts entered.</div>;
                return (<div style={{ marginTop: 10, padding: 10, borderRadius: 8, background: "var(--bg-inset)", border: "1px solid rgba(52,211,153,0.2)" }}>
                  <div style={{ fontSize: 11, fontFamily: "JetBrains Mono", color: "var(--text-muted)", marginBottom: 6 }}>Pool {round2(sp.pool).toFixed(2)} | Units {sp.units % 1 === 0 ? sp.units : round2(sp.units).toFixed(2)} | Value/unit {round2(sp.valuePerUnit).toFixed(2)}</div>
                  {Object.keys(m.shifts).map(function(nm) {
                    return (<div key={nm} style={{ display: "flex", justifyContent: "space-between", padding: "3px 0", borderTop: "1px solid rgba(51,65,85,0.4)" }}>
                      <span style={{ fontSize: 12, color: nm === (data.acuteMe || "") ? "#34d399" : "var(--text-primary)", fontWeight: nm === (data.acuteMe || "") ? 600 : 400 }}>{nm}</span>
                      <span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "var(--text-muted)" }}>{m.shifts[nm]} <span style={{ color: "var(--text-bright)", fontWeight: 600 }}>{round2(sp.shares[nm]).toFixed(2)}</span></span>
                    </div>);
                  })}
                  <button onClick={function() { copyAcuteTable(mk); }} style={{ marginTop: 8, padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>Copy table</button>
                  {copyStatus && <span style={{ marginLeft: 8, fontSize: 11, color: "#34d399" }}>{copyStatus}</span>}
                </div>);
              })()}
            </div>}
          </div>);
        })}
      </div>
    </div>

    {/* Acute Care Group - roster + JSON import. Partner names are USER-ENTERED
        data only; never hardcode names in source (public repo). */}
    <div style={S.card}>
      <div style={S.cardLabel}>Acute Care Group</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>Partner roster for the monthly acute-care pool split. Enter each month's pool and shifts in Monthly Acute Care above; shares are computed from shifts. Tap Me to mark yourself.</div>
      <button onClick={function() { if (openAcute) openAcute("settings"); }} style={{ marginTop: 8, padding: "6px 12px", borderRadius: 6, border: "1px solid rgba(52,211,153,0.3)", background: "rgba(16,185,129,0.06)", color: "#34d399", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>View full history</button>
      <div style={{ marginTop: 8 }}>
        {acuteRoster.length === 0 && <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "8px 0" }}>No partners yet - add names below or import JSON.</div>}
        {acuteRoster.map(function(nm) {
          var isMe = (data.acuteMe || "") === nm;
          return (<div key={nm} style={{ display: "flex", alignItems: "center", gap: 8, padding: "7px 0", borderBottom: "1px solid rgba(51,65,85,0.4)" }}>
            <button onClick={function() { setAcuteMe(nm); }} style={{ padding: "2px 8px", borderRadius: 10, border: isMe ? "1px solid rgba(52,211,153,0.5)" : "1px solid var(--border-default)", background: isMe ? "rgba(16,185,129,0.12)" : "transparent", color: isMe ? "#34d399" : "var(--text-faint)", fontSize: 10, fontWeight: 600, cursor: "pointer" }}>Me</button>
            {renaming === nm ? (<>
              <input type="text" value={renameDraft} onChange={function(e) { setRenameDraft(e.target.value); }} autoFocus style={{ ...S.searchInput, flex: 1, padding: "5px 8px", fontSize: 12, marginBottom: 0 }} />
              <button onClick={function() { renamePartner(nm); }} style={{ padding: "4px 10px", borderRadius: 6, border: "none", background: "#0ea5e9", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Save</button>
              <button onClick={function() { setRenaming(null); setRenameDraft(""); }} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>Cancel</button>
            </>) : (<>
              <span style={{ flex: 1, fontSize: 13, color: "var(--text-primary)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{nm}</span>
              <button onClick={function() { setRenaming(nm); setRenameDraft(nm); }} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 11, cursor: "pointer" }}>Rename</button>
              <button onClick={function() { removePartner(nm); }} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border-default)", background: "transparent", color: "#ef4444", fontSize: 11, cursor: "pointer" }}>x</button>
            </>)}
          </div>);
        })}
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <input type="text" value={newPartner} onChange={function(e) { setNewPartner(e.target.value); }} placeholder="New partner name" style={{ ...S.searchInput, flex: 1, marginBottom: 0, fontSize: 12 }} />
          <button onClick={addPartner} disabled={!newPartner.trim()} style={{ padding: "8px 14px", borderRadius: 8, border: "none", background: "#0ea5e9", color: "#fff", fontSize: 12, fontWeight: 600, cursor: "pointer", opacity: newPartner.trim() ? 1 : 0.4 }}>Add</button>
        </div>
      </div>
      <div style={{ marginTop: 12, borderTop: "1px solid var(--border-default)", paddingTop: 10 }}>
        <button onClick={function() { setShowAcuteImport(!showAcuteImport); setAcuteImportStatus(""); }} style={{ background: "none", border: "1px solid var(--border-default)", borderRadius: 6, color: showAcuteImport ? "#0ea5e9" : "var(--text-muted)", fontSize: 11, cursor: "pointer", padding: "4px 10px" }}>{showAcuteImport ? "Hide import" : "Import acute data (JSON)"}</button>
        {showAcuteImport && <div style={{ marginTop: 8 }}>
          <div style={{ fontSize: 10, color: "var(--text-faint)", lineHeight: 1.5, marginBottom: 6 }}>{'Paste: {"acuteRoster": [..], "acuteMe": "..", "acuteMonths": {"YYYY-MM": {"pool": n, "shifts": {"name": n}}}}. Pasted months overwrite same months; other months untouched. All-or-nothing: one bad month imports nothing.'}</div>
          <textarea value={acuteImportText} onChange={function(e) { setAcuteImportText(e.target.value); }} placeholder="Paste acute JSON here..." style={{ ...S.notesInput, minHeight: 80, fontSize: 11, fontFamily: "JetBrains Mono" }} />
          <button onClick={doAcuteImport} disabled={!acuteImportText.trim()} style={{ ...S.saveBtn, width: "100%", marginTop: 6, padding: "8px 12px", fontSize: 12, opacity: acuteImportText.trim() ? 1 : 0.4 }}>Import</button>
        </div>}
        {acuteImportStatus && <div style={{ marginTop: 6, fontSize: 11, color: acuteImportStatus.indexOf("failed") !== -1 ? "#ef4444" : "#34d399" }}>{acuteImportStatus}</div>}
      </div>
    </div>

    {/* Call Pay - dollar-only call-shift pay (callpay.js). Site names and
        rates are USER-ENTERED data; never hardcode them in source, except
        the built-in preset DEFAULT_PAY_SITES in utils.js (CLAUDE.md). */}
    <div style={S.card}>
      <div style={S.cardLabel}>Call Pay</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>Call stipends, call-in fees and hourly pay per site, in dollars. Kept separate from wRVUs and Comp.</div>
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6 }}>{(data.paySites || []).length + " site" + ((data.paySites || []).length === 1 ? "" : "s") + ", " + (data.payShifts || []).length + " shift" + ((data.payShifts || []).length === 1 ? "" : "s")}</div>
      <button onClick={function() { if (openCallPay) openCallPay("settings"); }} style={{ marginTop: 8, minHeight: 44, width: "100%", borderRadius: 8, border: "1px solid rgba(14,165,233,0.3)", background: "rgba(14,165,233,0.06)", color: "#0ea5e9", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>Open Call Pay</button>
    </div>

    {/* API Key for Scan Features - Encrypted (feature-flagged: hidden when SCAN_ENABLED is false) */}
    {SCAN_ENABLED && (<div style={{ ...S.card, border: hasApiKey(settings) ? "1px solid rgba(16,185,129,0.3)" : "1px solid rgba(245,158,11,0.3)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={S.cardLabel}>AI Scan Features</div>
        <span style={{ fontSize: 11, padding: "2px 8px", borderRadius: 4, background: hasApiKey(settings) ? "rgba(16,185,129,0.15)" : "rgba(245,158,11,0.15)", color: hasApiKey(settings) ? "#10b981" : "#f59e0b" }}>{hasApiKey(settings) ? "Active" : "Not configured"}</span>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>Enter an Anthropic API key to enable scanning operative notes and clinic schedules. Get a key at console.anthropic.com</div>
      {hasApiKey(settings) && !showApiKeyInput ? (
        <div style={{ marginTop: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 12px", background: "var(--bg-inset)", borderRadius: 8, border: "1px solid var(--border-default)" }}>
            <span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: "var(--text-dim)", letterSpacing: 2, flex: 1 }}>{"\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}{settings.apiKeyLast4 || "\u2022\u2022\u2022\u2022"}</span>
            <span style={{ fontSize: 9, color: "#10b981", background: "rgba(16,185,129,0.1)", padding: "2px 6px", borderRadius: 3 }}>AES-256</span>
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <div style={{ flex: 1, fontSize: 11, color: "var(--text-dim)", lineHeight: 1.4 }}>Key is AES-256-GCM encrypted with your PIN.</div>
            <button onClick={() => { setShowApiKeyInput(true); setNewApiKey(""); }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>Change</button>
            <button onClick={removeApiKey} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-default)", background: "transparent", color: "#ef4444", fontSize: 11, cursor: "pointer", whiteSpace: "nowrap" }}>Remove</button>
          </div>
        </div>
      ) : (
        <div style={{ marginTop: 10 }}>
          <div style={S.fieldGroup}>
            <label style={S.fieldLabel}>API Key</label>
            <input type="password" value={newApiKey} onChange={e => setNewApiKey(e.target.value.trim())} placeholder="sk-ant-..." style={{ ...S.searchInput, fontFamily: "JetBrains Mono", fontSize: 12 }} />
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
            <button disabled={!newApiKey || newApiKey.length < 10} onClick={() => { encryptAndStoreApiKey(newApiKey, upd).then(() => { setNewApiKey(""); setShowApiKeyInput(false); }); }} style={{ ...S.saveBtn, flex: 1, opacity: newApiKey.length >= 10 ? 1 : 0.4, padding: "8px 12px", fontSize: 12 }}>Encrypt & Save Key</button>
            {hasApiKey(settings) && <button onClick={() => { setShowApiKeyInput(false); setNewApiKey(""); }} style={{ padding: "8px 12px", borderRadius: 8, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 12, cursor: "pointer" }}>Cancel</button>}
          </div>
        </div>
      )}
    </div>)}

    {/* Procedure templates - management only; creation lives in Log */}
    <div style={S.card}>
      <div style={S.cardLabel}>Procedure Templates</div>
      <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>One-tap code bundles for the Log tab. To create one: build a selection in Log, then tap "Save as template" in the Encounter Summary.</div>
      <div style={{ marginTop: 8 }}>
        {(data.templates || []).length === 0 && <div style={{ fontSize: 12, color: "var(--text-faint)", padding: "6px 0" }}>No templates yet.</div>}
        {(data.templates || []).map(function(t, ti) {
          var list = data.templates || [];
          return (<div key={t.id} style={{ display: "flex", alignItems: "center", gap: 6, padding: "8px 0", borderBottom: ti < list.length - 1 ? "1px solid rgba(51,65,85,0.4)" : "none" }}>
            <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
              {ti > 0 ? <span onClick={function() { moveTemplate(t.id, -1); }} style={{ fontSize: 13, cursor: "pointer", color: "var(--text-faint)", padding: "0 4px", lineHeight: 1.1 }}>{"\u25B2"}</span> : <span style={{ fontSize: 13, padding: "0 4px", lineHeight: 1.1, visibility: "hidden" }}>{"\u25B2"}</span>}
              {ti < list.length - 1 ? <span onClick={function() { moveTemplate(t.id, 1); }} style={{ fontSize: 13, cursor: "pointer", color: "var(--text-faint)", padding: "0 4px", lineHeight: 1.1 }}>{"\u25BC"}</span> : <span style={{ fontSize: 13, padding: "0 4px", lineHeight: 1.1, visibility: "hidden" }}>{"\u25BC"}</span>}
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {tplRenaming === t.id
                ? <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                    <input type="text" value={tplRenameDraft} onChange={function(e) { setTplRenameDraft(e.target.value); }} autoFocus style={{ ...S.searchInput, flex: 1, padding: "5px 8px", fontSize: 12, marginBottom: 0 }} />
                    <button onClick={function() { renameTemplate(t.id); }} style={{ padding: "5px 10px", borderRadius: 6, border: "none", background: "#0ea5e9", color: "#fff", fontSize: 11, fontWeight: 600, cursor: "pointer" }}>Save</button>
                  </div>
                : <div>
                    <div style={{ fontSize: 13, color: "var(--text-primary)", fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.name}</div>
                    <div style={{ fontSize: 10, fontFamily: "JetBrains Mono", color: "var(--text-dim)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{t.codes.join(", ")}{t.note ? " | note" : ""}</div>
                  </div>}
            </div>
            {tplRenaming !== t.id && <button onClick={function() { setTplRenaming(t.id); setTplRenameDraft(t.name); }} style={{ padding: "4px 10px", borderRadius: 6, border: "1px solid var(--border-default)", background: "transparent", color: "var(--text-muted)", fontSize: 11, cursor: "pointer", flexShrink: 0 }}>Rename</button>}
            <button onClick={function() { deleteTemplate(t); }} style={{ padding: "4px 8px", borderRadius: 6, border: "1px solid rgba(239,68,68,0.3)", background: "transparent", color: "#ef4444", fontSize: 11, cursor: "pointer", flexShrink: 0 }}>x</button>
          </div>);
        })}
      </div>
    </div>

    {/* Stranded key: scanning is off but a key remains stored - let the user clear
        it without re-enabling scanning. Only renders when a key actually exists. */}
    {!SCAN_ENABLED && hasApiKey(settings) && (<div style={S.card}>
      <div style={S.cardLabel}>AI Scan Features</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>Scanning is turned off. An API key is still stored on this device.</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 10 }}>
        <span style={{ flex: 1, fontSize: 12, color: "var(--text-dim)" }}>{"\u2022\u2022\u2022\u2022"}{settings.apiKeyLast4 || ""} (AES-256, encrypted with your PIN)</span>
        <button onClick={removeApiKey} style={{ padding: "6px 12px", borderRadius: 6, border: "1px solid var(--border-default)", background: "transparent", color: "#ef4444", fontSize: 12, cursor: "pointer", whiteSpace: "nowrap" }}>Remove</button>
      </div>
    </div>)}

    {/* wRVU Editor */}
    <div style={S.card}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={S.cardLabel}>wRVU Values Editor</div>
        <button onClick={() => setShowEditor(!showEditor)} style={S.linkBtn}>{showEditor ? "Hide" : "Edit Values"}</button>
      </div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4 }}>
        Data: CMS CY{DATA_YEAR} PFS  {db.length} codes  {overrideCount > 0 ? overrideCount + " custom override(s)" : "No overrides"}
      </div>
      {showEditor && <>
        <input type="text" value={editSearch} onChange={e => setEditSearch(e.target.value)} placeholder="Search codes to edit..." autoCorrect="off" autoCapitalize="off" spellCheck={false} style={{ ...S.searchInput, marginTop: 10, fontSize: 13 }} />
        <div style={{ ...S.catRow, marginTop: 6 }}><button onClick={() => setEditCat("All")} style={editCat === "All" ? S.catBtnActive : S.catBtn}>All</button>{categories.map(c => <button key={c} onClick={() => setEditCat(c)} style={editCat === c ? S.catBtnActive : S.catBtn}>{c}</button>)}</div>
        <div style={{ maxHeight: 300, overflowY: "auto", marginTop: 8, scrollbarWidth: "thin", scrollbarColor: "var(--border-default) transparent" }}>
          {editFiltered.slice(0, 30).map(cpt => {
            const orig = CPT_DATABASE_DEFAULT.find(c => c.code === cpt.code);
            const isOverridden = !!ovr[cpt.code];
            return (<div key={cpt.code} style={{ display: "flex", alignItems: "center", padding: "8px 0", borderBottom: "1px solid rgba(51,65,85,0.4)", gap: 8 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                  <span style={{ fontSize: 12, fontFamily: "JetBrains Mono", color: isOverridden ? "#fbbf24" : "#0ea5e9", fontWeight: 600 }}>{cpt.code}</span>
                  {isOverridden && <span style={{ fontSize: 9, color: "#fbbf24", background: "rgba(251,191,36,0.1)", padding: "1px 5px", borderRadius: 3 }}>custom</span>}
                </div>
                <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cpt.friendly || cpt.desc}</div>
                {cpt.friendly && <div style={{ fontSize: 10, color: "var(--text-faint)", marginTop: 1, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{cpt.desc}</div>}
              </div>
              <input type="text" inputMode="decimal" value={rvuDraft && rvuDraft.code === cpt.code ? rvuDraft.text : String(cpt.wRVU)} placeholder={orig ? String(orig.wRVU) : ""} onFocus={function() { rvuEsc.current = false; setRvuDraft({ code: cpt.code, text: String(cpt.wRVU) }); }} onChange={function(e) { setRvuDraft({ code: cpt.code, text: e.target.value.replace(/,/g, ".").replace(/[^0-9.]/g, "") }); }} onKeyDown={function(e) { if (e.key === "Enter") { e.target.blur(); } else if (e.key === "Escape") { rvuEsc.current = true; e.target.blur(); } }} onBlur={function(e) { var t = e.target.value; var esc = rvuEsc.current; rvuEsc.current = false; setRvuDraft(null); if (!esc && t !== String(cpt.wRVU)) commitOverride(cpt.code, t); }} style={{ width: 65, padding: "4px 6px", background: isOverridden ? "rgba(251,191,36,0.1)" : "var(--bg-inset)", border: "1px solid " + (isOverridden ? "rgba(251,191,36,0.3)" : "var(--border-default)"), borderRadius: 6, color: "var(--text-bright)", fontSize: 13, fontFamily: "JetBrains Mono", fontWeight: 600, textAlign: "right", outline: "none" }} />
            </div>);
          })}
          {editFiltered.length > 30 && <div style={{ fontSize: 11, color: "var(--text-faint)", padding: 8, textAlign: "center" }}>Showing 30 of {editFiltered.length} - narrow your search</div>}
        </div>
        {overrideCount > 0 && <button onClick={resetOverrides} style={{ ...S.dangerBtn, width: "100%", marginTop: 8, fontSize: 12, padding: "8px 12px" }}>Reset All to CMS Defaults</button>}
      </>}
    </div>

    <div style={S.card}><div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}><div style={S.cardLabel}>Summary Stats</div><CompEye showComp={showComp} toggleComp={toggleComp} /></div><div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 12, marginTop: 8 }}>{[["Total Cases", credCount, "var(--text-primary)"], ["Total wRVUs", tRVU.toFixed(1), "var(--text-primary)"], ["Avg wRVU/Case", avg.toFixed(2), "#0ea5e9"], ["Total Comp", fmtDollar(tRVU * settings.ratePerRVU, showComp), "#10b981"]].map(function(item) { return (<div key={item[0]}><div style={{ fontSize: 11, color: "var(--text-dim)" }}>{item[0]}</div><div style={{ fontSize: 20, fontFamily: "JetBrains Mono", color: item[2], fontWeight: 600 }}>{item[1]}</div></div>); })}</div>
      {ncCount > 0 && <div onClick={function() { if (openHistory) openHistory(null); }} style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 8, cursor: "pointer", display: "flex", alignItems: "center", minHeight: 24 }}><span>{"Logged, no credit: "}<span style={{ fontFamily: "JetBrains Mono", color: "var(--text-primary)", fontWeight: 600 }}>{ncRVU.toFixed(1)}</span>{" wRVU across " + ncCount + " case" + (ncCount === 1 ? "" : "s")}</span><span style={{ marginLeft: 6, color: "var(--text-dim)", fontSize: 13, lineHeight: 1 }}>{"\u203A"}</span></div>}</div>
    <div style={{ display: "flex", gap: 8, marginTop: 8 }}><button onClick={expExcel} disabled={excelBusy} style={{ ...S.secondaryBtn, color: "#10b981", borderColor: "rgba(16,185,129,0.3)", opacity: excelBusy ? 0.6 : 1 }}>{excelBusy ? "Loading..." : "Export Excel"}</button><button onClick={expCSV} style={S.secondaryBtn}>Export CSV</button><button onClick={expJSON} style={S.secondaryBtn}>JSON</button></div>

    {/* Backup & Restore */}
    <div ref={backupCardRef} style={{ ...S.card, border: "1px solid rgba(14,165,233,0.3)" }}>
      <div style={S.cardLabel}>Backup & Restore</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>Backups are AES-256 encrypted with your PIN. Save the file to iCloud Drive (or anywhere off this phone) and keep it private - it holds patient initials and notes.</div>
      {(function() {
        var due = backupNudgeDue({ date: backupStamp.date }, todayLocal(), data.entries.length + (data.payShifts || []).length);
        var txt = backupStamp.date ? "Last backup: " + fmt(backupStamp.date) + (backupStamp.how === "copy" ? " (copied code)" : " (file)") + (due ? " - over 2 weeks ago" : "") : "No backup recorded on this phone yet";
        // var(--global-90) is the theme-aware amber (#f59e0b dark, #92400e light).
        return <div style={{ fontSize: 12, marginTop: 6, color: due ? "var(--global-90)" : "var(--text-dim)", fontWeight: due ? 600 : 400 }}>{txt}</div>;
      })()}
      <button onClick={saveBackupFile} disabled={fileBusy} style={{ ...S.saveBtn, marginTop: 10, fontSize: 15, opacity: fileBusy ? 0.6 : 1 }}>{fileBusy ? "Encrypting..." : "Save Backup File"}</button>
      {backupFile && (function() {
        var bf = backupFile, shareOk = canShareFile(bf.file), showDl = !shareOk || finePointer() || bf.shareFailed;
        return (<div style={{ marginTop: 8, padding: 10, borderRadius: 8, background: "var(--bg-inset)", border: "1px solid rgba(14,165,233,0.3)" }}>
          <div style={{ fontSize: 12, color: "var(--text-primary)", fontWeight: 600, wordBreak: "break-all" }}>{"Ready: " + bf.name}</div>
          <div style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 2, lineHeight: 1.5 }}>{bf.count + " procedures, " + bf.shifts + " call-pay shift" + (bf.shifts === 1 ? "" : "s") + ", " + bf.kb + " KB. Choose Save to Files - iCloud Drive is best."}</div>
          {shareOk && <button onClick={shareBackupFile} style={{ ...S.secondaryBtn, width: "100%", marginTop: 8, minHeight: 44, color: "#0ea5e9", borderColor: "rgba(14,165,233,0.3)" }}>Save / Share File</button>}
          {showDl && <button onClick={downloadBackupFile} style={{ ...S.secondaryBtn, width: "100%", marginTop: 8, minHeight: 44 }}>Download File</button>}
          <button onClick={function() { setBackupFile(null); }} style={{ ...S.linkBtn, display: "block", width: "100%", marginTop: 6, minHeight: 36 }}>Cancel</button>
        </div>);
      })()}
      <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
        <button onClick={copyBackup} style={{ ...S.secondaryBtn, flex: 1, color: "#0ea5e9", borderColor: "rgba(14,165,233,0.3)" }}>{"\uD83D\uDD12"} Copy Encrypted Backup</button>
        <button onClick={function() { setShowRestore(!showRestore); }} style={{ ...S.secondaryBtn, flex: 1 }}>{showRestore ? "Cancel" : "Restore"}</button>
      </div>
      {backupStatus && <div style={{ fontSize: 12, color: (backupManual || backupWarn) ? "#f59e0b" : "#10b981", marginTop: 6, textAlign: "center" }}>{backupStatus}</div>}
      {backupManual && <div style={{ marginTop: 6 }}>
        <textarea readOnly value={backupManual} onFocus={function(e) { e.target.select(); }} style={{ ...S.notesInput, minHeight: 80, fontSize: 10, fontFamily: "JetBrains Mono" }} />
        <button onClick={function() { setBackupManual(""); setBackupStatus(""); }} style={{ ...S.secondaryBtn, width: "100%", marginTop: 6, minHeight: 44 }}>Done</button>
      </div>}
      {showRestore && <div style={{ marginTop: 10 }}>
        <button onClick={function() { if (restoreFileRef.current) restoreFileRef.current.click(); }} style={{ ...S.secondaryBtn, width: "100%", minHeight: 44, color: "#0ea5e9", borderColor: "rgba(14,165,233,0.3)" }}>Restore from File...</button>
        <input ref={restoreFileRef} type="file" accept=".txt,.json,text/plain,application/json" style={{ display: "none" }} onChange={function(e) { var f = e.target.files && e.target.files[0]; e.target.value = ""; if (f) restoreFromFile(f); }} />
        <div style={{ fontSize: 11, color: "var(--text-faint)", textAlign: "center", margin: "10px 0 6px" }}>or paste a backup code</div>
        <textarea value={restoreText} onChange={function(e) { setRestoreText(e.target.value); }} placeholder="Paste your backup code here..." style={{ ...S.notesInput, minHeight: 80, fontSize: 11, fontFamily: "JetBrains Mono" }} />
        <button onClick={doRestore} disabled={!restoreText.trim()} style={{ ...S.saveBtn, width: "100%", marginTop: 8, opacity: restoreText.trim() ? 1 : 0.4 }}>Restore Data</button>
      </div>}
    </div>

    {/* Share App */}
    <div style={{ ...S.card, border: "1px solid rgba(139,92,246,0.3)" }}>
      <div style={S.cardLabel}>Share App</div>
      <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 4, lineHeight: 1.5 }}>Send RVU Tracker to a colleague. Opens your device share sheet, or copies the link if unavailable.</div>
      <div style={{ fontSize: 11, color: "var(--text-faint)", marginTop: 6, fontFamily: "JetBrains Mono", wordBreak: "break-all" }}>https://fkhan628.github.io/Work-RVU-Tracker-/</div>
      <div style={{ display: "flex", gap: 8, marginTop: 10 }}>
        <button onClick={doShare} style={{ ...S.secondaryBtn, flex: 1, color: "#8b5cf6", borderColor: "rgba(139,92,246,0.3)" }}>{"\uD83D\uDD17"} Share App Link</button>
      </div>
      {shareStatus && <div style={{ fontSize: 12, color: "#10b981", marginTop: 6, textAlign: "center" }}>{shareStatus}</div>}
    </div>

    <div style={{ marginTop: 8 }}><button onClick={removeDuplicates} style={{ ...S.secondaryBtn, width: "100%", color: "#fbbf24", borderColor: "rgba(251,191,36,0.3)" }}>Remove Duplicates</button></div>
    <div style={{ marginTop: 8 }}><button onClick={clear} style={{ ...S.dangerBtn, width: "100%" }}>Delete All Procedures</button></div>
    {/* Which build this phone runs (index.html ASSET_V) - a home-screen app
        can keep an old copy until it is fully closed and reopened. */}
    <div style={{ marginTop: 16, textAlign: "center", fontSize: 11, color: "var(--text-faint)" }}>{"App version " + (typeof ASSET_V === "string" ? ASSET_V : "?")}</div>
  </div>);
}
