(() => {
  "use strict";

  // Must match the Site key in index.html. This is public and may be exposed in the browser.
  const RECAPTCHA_SITE_KEY = "YOUR_RECAPTCHA_SITE_KEY";
  const buttons = [...document.querySelectorAll("[data-survey]")];
  const statusBox = document.getElementById("status");

  // Mouse heuristics are intentionally advisory. They are not reliable enough to block
  // keyboard, touch, trackpad, or assistive-technology users on their own.
  const movement = [];
  const MAX_SAMPLES = 100;
  const startedAt = performance.now();
  let lastClickAt = 0;
  let busy = false;

  function showStatus(message, kind = "info") {
    statusBox.textContent = message;
    statusBox.dataset.kind = kind;
    statusBox.classList.remove("hidden");
  }

  function setBusy(value) {
    busy = value;
    buttons.forEach((button) => { button.disabled = value; });
  }

  window.addEventListener("mousemove", (event) => {
    const now = performance.now();
    const prev = movement[movement.length - 1];
    movement.push({ x: event.clientX, y: event.clientY, t: now });
    if (movement.length > MAX_SAMPLES) movement.shift();

    // Keep a timestamp to support velocity/interval calculations; never transmit raw
    // coordinates to the server.
    if (prev && now - prev.t < 0) movement.length = 0;
  }, { passive: true });

  function analyzeMouse() {
    if (movement.length < 5) {
      // No mouse data is normal on touch/keyboard devices; do not flag it as a bot.
      return { score: 0, reasons: ["insufficient-mouse-data"] };
    }

    let teleportCount = 0;
    let nearZeroIntervals = 0;
    let distances = [];
    let intervals = [];
    let straightSegments = 0;
    const recent = movement.slice(-40);

    for (let i = 1; i < recent.length; i++) {
      const a = recent[i - 1], b = recent[i];
      const dt = b.t - a.t;
      const dx = b.x - a.x, dy = b.y - a.y;
      const distance = Math.hypot(dx, dy);
      if (dt <= 1) nearZeroIntervals++;
      if (dt > 0 && distance / dt > 4.0) teleportCount++; // > 4 CSS px/ms is unusual
      distances.push(distance);
      intervals.push(dt);
      if (i >= 2) {
        const p = recent[i - 2];
        const ux = a.x - p.x, uy = a.y - p.y;
        const vx = b.x - a.x, vy = b.y - a.y;
        const denom = Math.hypot(ux, uy) * Math.hypot(vx, vy);
        if (denom > 0) {
          const cosine = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / denom));
          if (cosine > 0.9995) straightSegments++;
        }
      }
    }

    const reasons = [];
    let score = 0;
    const segmentCount = Math.max(1, recent.length - 1);
    const teleportRatio = teleportCount / segmentCount;
    const zeroRatio = nearZeroIntervals / segmentCount;
    const straightRatio = straightSegments / Math.max(1, recent.length - 2);
    const avgInterval = intervals.reduce((a, b) => a + b, 0) / Math.max(1, intervals.length);

    if (teleportRatio > 0.18) { score += 2; reasons.push("many-high-speed-jumps"); }
    if (zeroRatio > 0.25) { score += 2; reasons.push("many-near-zero-intervals"); }
    if (straightRatio > 0.92 && recent.length >= 15) { score += 1; reasons.push("highly-linear-path"); }
    if (avgInterval < 2 && recent.length >= 10) { score += 2; reasons.push("unusually-fast-sampling"); }

    return { score, reasons, samples: recent.length };
  }

  function loadRecaptcha() {
    return new Promise((resolve, reject) => {
      if (!RECAPTCHA_SITE_KEY || RECAPTCHA_SITE_KEY === "YOUR_RECAPTCHA_SITE_KEY") {
        reject(new Error("reCAPTCHA is not configured yet. Add your Site key first."));
        return;
      }
      const deadline = Date.now() + 10000;
      const check = () => {
        if (window.grecaptcha && typeof window.grecaptcha.ready === "function") {
          window.grecaptcha.ready(() => resolve(window.grecaptcha));
        } else if (Date.now() > deadline) {
          reject(new Error("Security verification did not load. Check your connection and try again."));
        } else {
          window.setTimeout(check, 150);
        }
      };
      check();
    });
  }

  async function onSurveyChoice(event) {
    const button = event.currentTarget;
    if (busy) return;

    const now = performance.now();
    const clickDelay = now - startedAt;
    const mouse = analyzeMouse();
    lastClickAt = now;

    // High anomaly scores are only shown as a soft warning and do not independently
    // deny access; legitimate input devices can look atypical.
    if (mouse.score >= 5) {
      showStatus("We couldn't confidently verify this interaction. Please try again normally, or use your keyboard or touchscreen to choose an option.", "error");
      // Do not lock the user out. The server-side reCAPTCHA verification remains the gate.
    } else if (clickDelay < 250) {
      showStatus("Please take a moment, then continue with the security check.", "info");
    }

    setBusy(true);
    showStatus("Verifying your request securely…", "info");

    try {
      const grecaptcha = await loadRecaptcha();
      const token = await grecaptcha.execute(RECAPTCHA_SITE_KEY, { action: "survey_redirect" });
      if (!token) throw new Error("The security check did not return a token.");

      const response = await fetch("/api/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({
          token,
          surveyId: button.dataset.survey,
          // Send coarse heuristic counts only, not coordinates or detailed movement trails.
          clientSignals: {
            sampleCount: mouse.samples || 0,
            anomalyScore: mouse.score || 0,
            elapsedMs: Math.round(clickDelay)
          }
        })
      });

      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.ok || typeof result.redirectUrl !== "string") {
        throw new Error(result.message || "We couldn't verify this request. Please try again.");
      }

      window.location.assign(result.redirectUrl);
    } catch (error) {
      showStatus(error.message || "Something went wrong. Please try again.", "error");
      setBusy(false);
    }
  }

  buttons.forEach((button) => button.addEventListener("click", onSurveyChoice));
})();