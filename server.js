const express = require("express");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const path = require("path");

const app = express();
const PORT = Number(process.env.PORT || 3000);
const RECAPTCHA_SECRET_KEY = process.env.RECAPTCHA_SECRET_KEY;
const EXPECTED_HOSTNAME = process.env.RECAPTCHA_EXPECTED_HOSTNAME || "";
const MIN_RECAPTCHA_SCORE = Number(process.env.RECAPTCHA_MIN_SCORE || 0.5);

// Configure these in your deployment environment. Never put survey URLs or the
// reCAPTCHA SECRET key in client-side JavaScript if you need them kept private.
const SURVEY_URLS = {
  survey1: process.env.SURVEY_URL_1,
  survey2: process.env.SURVEY_URL_2,
  survey3: process.env.SURVEY_URL_3
};

app.disable("x-powered-by");
app.use(helmet({
  // Tailwind CDN and Google's reCAPTCHA scripts require external scripts. For a
  // stricter CSP, self-host Tailwind's compiled CSS and configure CSP nonces/hashes.
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", "https://cdn.tailwindcss.com", "https://www.google.com/recaptcha/", "https://www.gstatic.com/recaptcha/"],
      frameSrc: ["https://www.google.com/recaptcha/", "https://recaptcha.google.com/recaptcha/"],
      connectSrc: ["'self'", "https://www.google.com/recaptcha/"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", "data:", "https:"]
    }
  }
}));
app.use(express.json({ limit: "12kb" }));
app.use("/api/", rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: "draft-7", legacyHeaders: false }));
app.use(express.static(path.join(__dirname, "public"), { extensions: ["html"] }));

function isAllowedSurveyUrl(value) {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password;
  } catch {
    return false;
  }
}

app.post("/api/verify", async (req, res) => {
  if (!RECAPTCHA_SECRET_KEY) {
    return res.status(503).json({ ok: false, message: "Security verification is not configured on the server." });
  }

  const { token, surveyId } = req.body || {};
  if (typeof token !== "string" || token.length < 20 || token.length > 5000) {
    return res.status(400).json({ ok: false, message: "Missing or invalid verification token." });
  }
  if (!Object.hasOwn(SURVEY_URLS, surveyId) || !isAllowedSurveyUrl(SURVEY_URLS[surveyId])) {
    return res.status(400).json({ ok: false, message: "This survey option is not configured." });
  }

  try {
    const body = new URLSearchParams({ secret: RECAPTCHA_SECRET_KEY, response: token });
    const verifyResponse = await fetch("https://www.google.com/recaptcha/api/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body,
      signal: AbortSignal.timeout(7000)
    });
    if (!verifyResponse.ok) throw new Error("reCAPTCHA verification endpoint failed");
    const captcha = await verifyResponse.json();

    const hostnameOk = !EXPECTED_HOSTNAME || captcha.hostname === EXPECTED_HOSTNAME;
    const actionOk = captcha.action === "survey_redirect";
    const scoreOk = typeof captcha.score === "number" && captcha.score >= MIN_RECAPTCHA_SCORE;

    if (!captcha.success || !hostnameOk || !actionOk || !scoreOk) {
      // Avoid returning detailed risk scores or verification internals to the browser.
      return res.status(403).json({ ok: false, message: "We couldn't verify this request. Please try again or contact support." });
    }

    return res.json({ ok: true, redirectUrl: SURVEY_URLS[surveyId] });
  } catch (error) {
    console.error("reCAPTCHA verification error:", error.message);
    return res.status(502).json({ ok: false, message: "Security verification is temporarily unavailable. Please try again." });
  }
});

app.get("/health", (_req, res) => res.json({ ok: true }));

app.listen(PORT, () => console.log(`Survey gateway listening on port ${PORT}`));
