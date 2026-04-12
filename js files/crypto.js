if("serviceWorker" in navigator){navigator.serviceWorker.getRegistrations().then(function(r){r.forEach(function(x){x.unregister()})});}
if(!window.CMS_RAW) window.CMS_RAW=[];

// =======================================
// SECURITY: PIN Lock + Crypto Utilities
// =======================================
(function() {
  var PIN_HASH_KEY = "rvu-pin-hash";
  var PIN_SALT_KEY = "rvu-pin-salt";
  var PIN_HINT_KEY = "rvu-pin-hint";
  var AUTO_LOCK_MS = 5 * 60 * 1000; // 5 minutes
  var lockEl = document.getElementById("pin-lock");
  var rootEl = document.getElementById("root");
  var _lockTimer = null;
  var _pinUnlocked = false;

  // --- SHA-256 for PIN verification ---
  function sha256(str) {
    var buf = new TextEncoder().encode(str);
    return crypto.subtle.digest("SHA-256", buf).then(function(h) {
      return Array.from(new Uint8Array(h)).map(function(b){return b.toString(16).padStart(2,"0");}).join("");
    });
  }

  // --- PBKDF2 key derivation from PIN ---
  function deriveKey(pin, salt) {
    var enc = new TextEncoder();
    return crypto.subtle.importKey("raw", enc.encode(pin), "PBKDF2", false, ["deriveKey"]).then(function(baseKey) {
      return crypto.subtle.deriveKey(
        { name: "PBKDF2", salt: salt, iterations: 100000, hash: "SHA-256" },
        baseKey,
        { name: "AES-GCM", length: 256 },
        false,
        ["encrypt", "decrypt"]
      );
    });
  }

  // --- AES-GCM Encrypt ---
  function aesEncrypt(pin, plaintext) {
    var salt = crypto.getRandomValues(new Uint8Array(16));
    var iv = crypto.getRandomValues(new Uint8Array(12));
    var enc = new TextEncoder();
    return deriveKey(pin, salt).then(function(key) {
      return crypto.subtle.encrypt({ name: "AES-GCM", iv: iv }, key, enc.encode(plaintext));
    }).then(function(ct) {
      return {
        ct: btoa(String.fromCharCode.apply(null, new Uint8Array(ct))),
        salt: btoa(String.fromCharCode.apply(null, salt)),
        iv: btoa(String.fromCharCode.apply(null, iv))
      };
    });
  }

  // --- AES-GCM Decrypt ---
  function aesDecrypt(pin, encObj) {
    try {
      var salt = new Uint8Array(atob(encObj.salt).split("").map(function(c){return c.charCodeAt(0);}));
      var iv = new Uint8Array(atob(encObj.iv).split("").map(function(c){return c.charCodeAt(0);}));
      var ct = new Uint8Array(atob(encObj.ct).split("").map(function(c){return c.charCodeAt(0);}));
    } catch(e) { return Promise.reject(new Error("Invalid encrypted data")); }
    return deriveKey(pin, salt).then(function(key) {
      return crypto.subtle.decrypt({ name: "AES-GCM", iv: iv }, key, ct);
    }).then(function(pt) {
      return new TextDecoder().decode(pt);
    });
  }

  // --- Get current PIN from sessionStorage ---
  function getCurrentPin() { try { return sessionStorage.getItem("rvu-pin-session"); } catch(e) { return null; } }
  function setCurrentPin(pin) { try { sessionStorage.setItem("rvu-pin-session", pin); } catch(e) {} }
  function clearCurrentPin() { try { sessionStorage.removeItem("rvu-pin-session"); } catch(e) {} }

  // --- Auto-lock ---
  function resetLockTimer() {
    if (_lockTimer) clearTimeout(_lockTimer);
    if (!_pinUnlocked) return;
    _lockTimer = setTimeout(function() {
      _pinUnlocked = false;
      clearCurrentPin();
      showPinScreen("locked");
    }, AUTO_LOCK_MS);
  }
  ["click","keydown","touchstart","scroll"].forEach(function(evt) {
    document.addEventListener(evt, resetLockTimer, { passive: true });
  });
  document.addEventListener("visibilitychange", function() {
    if (document.hidden) {
      // Start a shorter timer when app goes to background
      if (_lockTimer) clearTimeout(_lockTimer);
      if (_pinUnlocked) {
        _lockTimer = setTimeout(function() {
          _pinUnlocked = false;
          clearCurrentPin();
          showPinScreen("locked");
        }, AUTO_LOCK_MS);
      }
    } else {
      resetLockTimer();
    }
  });

  // --- PIN UI ---
  function showPinScreen(mode) {
    lockEl.style.display = "flex";
    rootEl.style.display = "none";
    var isSetup = (mode === "setup");
    var title = isSetup ? "Create PIN" : "Enter PIN";
    var subtitle = isSetup ? "Set a 4-6 digit PIN to protect your data" : "Enter your PIN to unlock RVU Tracker";
    lockEl.innerHTML = '<div style="margin:auto;text-align:center;max-width:320px;width:90%;padding:20px;">'
      + '<div style="font-size:40px;margin-bottom:16px;">' + (isSetup ? "\uD83D\uDD10" : "\uD83D\uDD12") + '</div>'
      + '<div style="font-size:20px;font-weight:700;color:#e2e8f0;margin-bottom:6px;">' + title + '</div>'
      + '<div id="pin-subtitle" style="font-size:13px;color:#94a3b8;margin-bottom:24px;">' + subtitle + '</div>'
      + '<div id="pin-dots" style="display:flex;justify-content:center;gap:12px;margin-bottom:24px;height:20px;"></div>'
      + '<div id="pin-error" style="font-size:12px;color:#ef4444;margin-bottom:12px;min-height:18px;"></div>'
      + '<div id="pin-pad" style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:240px;margin:0 auto;"></div>'
      + '<div id="pin-extra" style="margin-top:20px;"></div>'
      + '</div>';
    var pinVal = "";
    var confirmVal = "";
    var confirming = false;

    function renderDots() {
      var d = document.getElementById("pin-dots");
      var len = confirming ? confirmVal.length : pinVal.length;
      var html = "";
      for (var i = 0; i < 6; i++) {
        var filled = i < len;
        var active = i < (confirming ? confirmVal.length : pinVal.length);
        html += '<div style="width:14px;height:14px;border-radius:50%;border:2px solid ' + (active ? "#0ea5e9" : "#334155") + ';background:' + (filled ? "#0ea5e9" : "transparent") + ';transition:all 0.15s;"></div>';
      }
      d.innerHTML = html;
    }

    function renderPad() {
      var pad = document.getElementById("pin-pad");
      var keys = [1,2,3,4,5,6,7,8,9,"",0,"\u232B"];
      pad.innerHTML = "";
      keys.forEach(function(k) {
        if (k === "") { pad.innerHTML += '<div></div>'; return; }
        var btn = document.createElement("button");
        btn.textContent = k;
        btn.style.cssText = "width:100%;aspect-ratio:1;border-radius:50%;border:1px solid #334155;background:rgba(30,41,59,0.6);color:#e2e8f0;font-size:" + (k === "\u232B" ? "20" : "24") + "px;font-weight:600;cursor:pointer;font-family:inherit;transition:background 0.1s;";
        btn.onclick = function() { handleKey(k); };
        pad.appendChild(btn);
      });
    }

    function handleKey(k) {
      var errEl = document.getElementById("pin-error");
      errEl.textContent = "";
      if (k === "\u232B") {
        if (confirming) { confirmVal = confirmVal.slice(0,-1); }
        else { pinVal = pinVal.slice(0,-1); }
        renderDots();
        return;
      }
      if (confirming) {
        if (confirmVal.length >= 6) return;
        confirmVal += String(k);
        renderDots();
        if (confirmVal.length >= 4 && confirmVal.length === pinVal.length) {
          setTimeout(function() { finishConfirm(); }, 200);
        }
      } else {
        if (pinVal.length >= 6) return;
        pinVal += String(k);
        renderDots();
        if (!isSetup && pinVal.length >= 4) {
          setTimeout(function() { tryUnlock(); }, 200);
        }
      }
    }

    function tryUnlock() {
      var errEl = document.getElementById("pin-error");
      sha256(pinVal).then(function(hash) {
        var stored = localStorage.getItem(PIN_HASH_KEY);
        if (hash === stored) {
          unlock(pinVal);
        } else {
          if (pinVal.length < 6) return; // wait for more digits
          errEl.textContent = "Incorrect PIN";
          pinVal = "";
          renderDots();
          lockEl.querySelector("#pin-dots").style.animation = "shake 0.3s";
          setTimeout(function() { lockEl.querySelector("#pin-dots").style.animation = ""; }, 400);
        }
      });
    }

    function finishConfirm() {
      var errEl = document.getElementById("pin-error");
      if (pinVal === confirmVal) {
        // PINs match — show recovery hint prompt before saving
        showHintPrompt(pinVal);
      } else {
        errEl.textContent = "PINs don't match. Try again.";
        confirmVal = "";
        confirming = false;
        pinVal = "";
        document.getElementById("pin-subtitle").textContent = "Set a 4-6 digit PIN to protect your data";
        document.getElementById("pin-extra").innerHTML = "";
        renderDots();
      }
    }

    function showHintPrompt(finalPin) {
      lockEl.innerHTML = '<div style="margin:auto;text-align:center;max-width:320px;width:90%;padding:20px;">'
        + '<div style="font-size:40px;margin-bottom:16px;">\uD83D\uDCA1</div>'
        + '<div style="font-size:20px;font-weight:700;color:#e2e8f0;margin-bottom:6px;">Recovery Hint</div>'
        + '<div style="font-size:13px;color:#94a3b8;margin-bottom:20px;line-height:1.5;">Add a hint to help you remember your PIN if you forget it. This is stored in plain text on the device.</div>'
        + '<input id="pin-hint-input" type="text" maxlength="100" placeholder="e.g. Birthday year + house number" style="width:100%;padding:12px 14px;border-radius:10px;border:1px solid #334155;background:#0f172a;color:#e2e8f0;font-size:14px;font-family:inherit;outline:none;box-sizing:border-box;margin-bottom:16px;" />'
        + '<div style="display:flex;gap:10px;">'
        + '<button id="pin-hint-skip" style="flex:1;padding:12px;border-radius:10px;border:1px solid #334155;background:none;color:#94a3b8;font-size:14px;cursor:pointer;font-family:inherit;">Skip</button>'
        + '<button id="pin-hint-save" style="flex:1;padding:12px;border-radius:10px;border:none;background:#0ea5e9;color:#fff;font-size:14px;font-weight:700;cursor:pointer;font-family:inherit;">Save Hint</button>'
        + '</div>'
        + '</div>';

      var hintInput = document.getElementById("pin-hint-input");
      hintInput.focus();

      function saveAndUnlock(hint) {
        if (hint) localStorage.setItem(PIN_HINT_KEY, hint);
        else localStorage.removeItem(PIN_HINT_KEY);
        sha256(finalPin).then(function(hash) {
          localStorage.setItem(PIN_HASH_KEY, hash);
          migrateApiKey(finalPin).then(function() {
            unlock(finalPin);
          });
        });
      }

      document.getElementById("pin-hint-save").onclick = function() {
        saveAndUnlock(hintInput.value.trim());
      };
      document.getElementById("pin-hint-skip").onclick = function() {
        saveAndUnlock("");
      };
      hintInput.addEventListener("keydown", function(e) {
        if (e.key === "Enter") saveAndUnlock(hintInput.value.trim());
      });
    }

    renderDots();
    renderPad();

    if (isSetup) {
      // Show "Set PIN" button after entering 4-6 digits
      var extra = document.getElementById("pin-extra");
      var confirmBtn = document.createElement("button");
      confirmBtn.textContent = "Set PIN";
      confirmBtn.style.cssText = "padding:12px 32px;border-radius:10px;border:none;background:#0ea5e9;color:#fff;font-size:15px;font-weight:700;cursor:pointer;opacity:0.3;pointer-events:none;font-family:inherit;";
      confirmBtn.id = "pin-confirm-btn";
      extra.appendChild(confirmBtn);

      // Override handleKey to enable confirm button
      var origHandle = handleKey;
      handleKey = function(k) {
        origHandle(k);
        var btn = document.getElementById("pin-confirm-btn");
        if (btn && !confirming) {
          var valid = pinVal.length >= 4 && pinVal.length <= 6;
          btn.style.opacity = valid ? "1" : "0.3";
          btn.style.pointerEvents = valid ? "auto" : "none";
        }
      };
      confirmBtn.onclick = function() {
        if (pinVal.length < 4) return;
        confirming = true;
        confirmVal = "";
        document.getElementById("pin-subtitle").textContent = "Confirm your " + pinVal.length + "-digit PIN";
        confirmBtn.style.display = "none";
        renderDots();
      };
    }

    // Add forgot PIN flow for locked mode
    if (mode === "locked") {
      var extra2 = document.getElementById("pin-extra");
      var forgotBtn = document.createElement("button");
      forgotBtn.textContent = "Forgot PIN?";
      forgotBtn.style.cssText = "margin-top:4px;padding:8px 16px;border-radius:8px;border:none;background:none;color:#64748b;font-size:12px;cursor:pointer;font-family:inherit;text-decoration:underline;";
      forgotBtn.onclick = function() {
        var hint = localStorage.getItem(PIN_HINT_KEY);
        var hintSection = document.createElement("div");
        hintSection.style.cssText = "margin-top:12px;text-align:center;";
        if (hint) {
          hintSection.innerHTML = '<div style="padding:12px 16px;background:rgba(14,165,233,0.08);border:1px solid rgba(14,165,233,0.2);border-radius:10px;margin-bottom:12px;">'
            + '<div style="font-size:11px;color:#64748b;margin-bottom:4px;">Your recovery hint:</div>'
            + '<div style="font-size:14px;color:#e2e8f0;font-weight:600;">' + hint.replace(/</g, "&lt;").replace(/>/g, "&gt;") + '</div>'
            + '</div>';
        } else {
          hintSection.innerHTML = '<div style="font-size:12px;color:#64748b;margin-bottom:12px;">No recovery hint was set.</div>';
        }
        var resetBtn = document.createElement("button");
        resetBtn.textContent = "Reset PIN & start over";
        resetBtn.style.cssText = "padding:8px 16px;border-radius:8px;border:1px solid rgba(239,68,68,0.3);background:none;color:#ef4444;font-size:11px;cursor:pointer;font-family:inherit;";
        resetBtn.onclick = function() {
          if (confirm("This will reset your PIN and remove any encrypted API key. Your procedure data will NOT be deleted. Continue?")) {
            localStorage.removeItem(PIN_HASH_KEY);
            localStorage.removeItem(PIN_SALT_KEY);
            localStorage.removeItem(PIN_HINT_KEY);
            try {
              var sk = "rvu-tracker-data-v6";
              var raw = localStorage.getItem(sk);
              if (raw) {
                var d = JSON.parse(raw);
                if (d.settings) {
                  delete d.settings.encryptedApiKey;
                  delete d.settings.apiKey;
                  localStorage.setItem(sk, JSON.stringify(d));
                }
              }
            } catch(e) {}
            showPinScreen("setup");
          }
        };
        hintSection.appendChild(resetBtn);
        forgotBtn.replaceWith(hintSection);
      };
      extra2.appendChild(forgotBtn);
    }
  }

  function migrateApiKey(pin) {
    // If there's a plaintext API key in settings, encrypt it
    try {
      var sk = "rvu-tracker-data-v6";
      var raw = localStorage.getItem(sk);
      if (!raw) return Promise.resolve();
      var d = JSON.parse(raw);
      if (d.settings && d.settings.apiKey && !d.settings.encryptedApiKey) {
        var plainKey = d.settings.apiKey;
        return aesEncrypt(pin, plainKey).then(function(enc) {
          d.settings.encryptedApiKey = enc;
          d.settings.apiKeyLast4 = plainKey.slice(-4);
          delete d.settings.apiKey;
          localStorage.setItem(sk, JSON.stringify(d));
        });
      }
    } catch(e) { console.warn("Migration error:", e); }
    return Promise.resolve();
  }

  function unlock(pin) {
    _pinUnlocked = true;
    setCurrentPin(pin);
    lockEl.style.display = "none";
    rootEl.style.display = "";
    resetLockTimer();
  }

  // --- Expose crypto API for React app ---
  window.RVU_CRYPTO = {
    encrypt: aesEncrypt,
    decrypt: aesDecrypt,
    getPin: getCurrentPin,
    isUnlocked: function() { return _pinUnlocked; },
    lock: function() {
      _pinUnlocked = false;
      clearCurrentPin();
      showPinScreen("locked");
    }
  };

  // --- Init: check if PIN exists ---
  var hasPin = !!localStorage.getItem(PIN_HASH_KEY);
  var hasSession = !!getCurrentPin();
  if (!hasPin) {
    showPinScreen("setup");
  } else if (!hasSession) {
    showPinScreen("locked");
  } else {
    _pinUnlocked = true;
    rootEl.style.display = "";
    resetLockTimer();
  }
})();
