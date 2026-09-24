# Lingon — your personal agent (REAL backend)

**Runtime:** Microsoft Foundry serves `gpt-6-luna` with `xhigh` reasoning.
Each user gets an isolated Azure VM
sandbox for untrusted code/files/browser. Until `AZURE_*` is set, the harness
uses a per-user local workspace and keeps `code_run` disabled. The agent uses
the Foundry resource Responses API; no hosted Codex agent is used. See
`server/foundry.js` and `server/agents/azure-vm.js`.

Every user claims, names and customizes their own agent, then works with it
through chat + visual canvas + sealed vault. **This build is real: nothing is
simulated.** AI answers come from Foundry server-side, research does live web
fetches with citations, GitHub reviews hit the real api.github.com with your
own token, and pages are model-generated. Microphone speech is converted into
prompt-box text with `gpt-4o-transcribe`, and image creation uses `gpt-image-2`.
Those values are Azure deployment names; each model must be deployed in the
resource, or its custom deployment alias must be supplied in `.env`.

Browser/computer work appears in Canvas through a persistent Chromium CDP
screencast relay. It is a continuous interactive stream over an authenticated
outbound WebSocket from the private VM; it does not expose VNC/RDP and does not
wait for a new screenshot after every action. Set `LINGON_PUBLIC_ORIGIN` (or
`SITE_URL`) to the public HTTPS app origin so VMs can connect back to the relay.

## Quick start (Windows)

```powershell
cd C:\lingon
Copy-Item .env.example .env   # then set the Foundry endpoint, key, and deployment names
npm install
npm start
```

Open http://localhost:8000
Health: http://localhost:8000/api/health → `{ ok:true, foundry:true, ... }`

`.env` is gitignored and never committed. The frontend never sees the key —
it only calls `/api/*` on the same origin.

## Auth (real Supabase Auth)

Sign up / sign in in the app (email + 8-char password). The backend verifies
your Supabase JWT on every stateful request and derives `user_id` from the
token — client-supplied ids are ignored. Memories, vault, usage and gifts are
per-account. Rate limits + security headers are on.

Google sign-in runs through our own OAuth bridge (`GET /api/auth/oauth-url` →
`accounts.google.com` → `GET /api/auth/google/callback`): the browser only
ever sees belna.se + Google, never a third-party hosted auth page. The server
exchanges the code, verifies the email via userinfo, and bridges it into an
app session server-side. Needs `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` in
`.env` (see `.env.example`) plus the redirect URI registered in Google Cloud
console. Passwordless email one-time codes (`/api/auth/otp` → `/api/auth/verify`)
work with no extra setup. To use the branded code email, install the template
from `supabase/templates/magic_link.html` as described in
`supabase/templates/README.md`; `db push` does not publish Auth templates.

## Supabase setup

The linked project `alikzitdkdiatimjygdz` already has the base chat and billing
tables. Do not rerun `schema.sql` through `schema4.sql` in its SQL Editor. Apply
new tracked migrations with `npx supabase db push --linked --skip-vault`.

For a brand new, empty Supabase project only, bootstrap `supabase/schema.sql`,
`schema2.sql`, `schema3.sql`, and `schema4.sql` in that order before pushing the
tracked migrations. Then put the project URL, publishable key, and server-only
secret key in `.env` and restart `npm start`. `/api/health` should show
`"supabase": true`.

## Plans and raw-token wallet

Apply the tracked migrations with `npx supabase db push --linked --skip-vault`,
including `20260923095000_monthly_token_wallet.sql`, together with the matching
server and client release. The Supabase RPCs charge usage and enforce daily
limits atomically across workers. Use the Supabase service key on the server;
the local JSON fallback is for development. Run `node scripts/setup-stripe.mjs`
to create the token pack prices, then configure the printed IDs in production.
See `docs/token-rollout-2026-09-23.md` before a live rollout.

- Free $0 → 50M tokens monthly, 5 images and 10 transcriptions daily.
- Pro $50/month → 100M tokens monthly, 10 images and 15 transcriptions daily.
- Max $100/month → 200M tokens monthly, 15 images and 20 transcriptions daily.
- One-time token packs add 10M, 20M, 30M, 50M, 75M, 100M, or 500M tokens without raising daily limits. Purchased tokens carry over until used.

Input, output, cached, image, transcription, and VM usage draw from the token
wallet. Depleted accounts receive a 402 response. Gift codes grant tokens when
redeemed. See Billing in the app and `docs/token-economics-2026-09-23.md` for
the pricing and margin assumptions.

## Harness (honest)

GPT-6 Luna decides tools through the Foundry Responses API (`server/agents/vm-harness.js`).
Untrusted work runs in the user's Azure VM (`server/agents/azure-vm.js`).
Until Azure is configured, the fallback is an isolated per-user workspace and
`code_run` stays disabled. Secrets never enter the model or the VM.

## What is real vs honest

- Chat / build / research: Foundry `gpt-6-luna` with `xhigh` reasoning, usage-logged.
- Voice input: `gpt-4o-transcribe` converts microphone recordings into prompt-box text.
- Images: `gpt-image-2` through the `image_generate` agent tool, returned as Canvas PNG files.
- Agent chat: the main agent stays responsive while cancellable sub-agents do
  task work; unrelated tasks are isolated in automatically opened chats.
- Research: live HN / DuckDuckGo / Wikipedia fetch + cited briefing, no invented stats.
- GitHub: real PR list + diff + model review. PAT per-request, never logged/sent to model.
- Memory + vault: Supabase per-account, encrypted at rest. `sec_••••` only in traces.
- Triggers + sub-agents: durable schedule/app/sub-agent watchers. Every run is an isolated chat, usage-metered and visible in Trace.
- Apps: per-user Composio OAuth connections, including multiple accounts per
  connector and per-tool permissions. Disabled tools are blocked server-side.

## Tests

```powershell
npm run smoke:real
```

Signs up a fresh test user, checks landing pricing and harness wording,
onboards, real chat, live research, vault masking, Apps, and Billing.

## GitHub repo

```powershell
gh auth login
gh repo create lingon-agent --private --source=. --push
```

## Project layout

- `app/` — frontend (config.js, mascot.js, engine.js fallback, engine.real.js, app.js, styles.css)
- `server/` — real backend (index.js, foundry.js, research.js, store.js)
- `supabase/` — schema, tracked migrations, Auth email template, and setup guide
- `tests/smoke.real.js` — Playwright verification against the real backend
