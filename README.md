# Survey Gateway

## Project layout
- `public/index.html` — responsive landing page (Tailwind CSS CDN)
- `public/styles.css` — custom visual styling
- `public/app.js` — mouse-signal heuristics and reCAPTCHA client flow
- `server.js` — server-side reCAPTCHA verification and fixed survey redirect mapping
- `.env.example` — required deployment environment variables

## Setup
1. Install Node.js 18.17+.
2. Put `index.html`, `styles.css`, and `app.js` in a folder named `public/`.
3. Run `npm install`.
4. Copy `.env.example` to `.env` for local development, then set the values below. Use your host's environment-variable settings in production.
5. In `public/index.html` and `public/app.js`, replace `YOUR_RECAPTCHA_SITE_KEY` with your reCAPTCHA v3 **Site key**.
6. Set `RECAPTCHA_SECRET_KEY` to the matching **Secret key** on the server only.
7. Set `RECAPTCHA_EXPECTED_HOSTNAME` to the exact hostname registered with Google (for example `survey.example.com`, without `https://`).
8. Replace `SURVEY_URL_1`, `SURVEY_URL_2`, and `SURVEY_URL_3` with your actual HTTPS survey links.
9. Run `npm start`, then deploy behind HTTPS.

## Security notes
- reCAPTCHA tokens are verified server-side with Google. The server validates success, action, score, and optionally hostname.
- Survey destinations are selected by fixed IDs, not supplied as arbitrary redirect URLs, to reduce open-redirect risk.
- Mouse patterns are weak signals and can be mimicked. They must not be treated as proof of automation or used to permanently lock out keyboard/touch/accessibility users.
- Add a persistent rate-limit store, request logging with privacy controls, monitoring, and a deployment-specific Content Security Policy for higher traffic production use.
- Tailwind's CDN is convenient for setup, but Tailwind recommends compiling CSS for production. The included CSP is a practical starting point, not a substitute for a security review.
- The browser-supplied `clientSignals` field is untrusted and intentionally not used as an authorization signal by the server.
