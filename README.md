# Lingon — your personal agent (REAL backend)

**Runtime:** Gemini 3.5 is the model. Each user gets an isolated Azure VM
sandbox for untrusted code/files/browser. Until `AZURE_*` is set, the harness
uses a per-user local workspace and keeps `code_run` disabled. OpenAI / Codex
Agents API is **not** used. See `server/agents/azure-vm.js`.

Every user claims, names and customizes their own agent, then works with it
through chat + visual canvas + sealed vault. **This build is real: nothing is
simulated.** AI answers come from Gemini server-side, research does live web
fetches with citations, GitHub reviews hit the real api.github.com with your
own token, pages are Gemini-generated.

## Quick start (Windows)

```powershell
cd C:\lingon
Copy-Item .env.example .env   # then edit .env and paste GEMINI_API_KEY
npm install
npm start
```

Open http://localhost:8000
Health: http://localhost:8000/api/health → `{ ok:true, gemini:true, ... }`

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
work with no extra setup.

## Supabase setup

1. SQL Editor → run `supabase/schema.sql`, then `supabase/schema2.sql`,
   `supabase/schema3.sql`, and `supabase/schema4.sql` in order. The fourth
   migration adds owner-scoped triggers, automation runs, and automation chats.
   For an already linked project, deploy tracked updates with `npx supabase db push`.
2. API settings → URL + publishable + secret into `.env` (already done here).
3. Restart `npm start` → `/api/health` shows `"supabase": true`.

## Plans (real credits, no fake charges)

- Free $0 → $10 API credit
- Pro $30 (was $50) → $20 credit + $50 gift card (use or gift)
- Max $50 (was $100) → $50 credit + $100 gift card (use or gift)
Usage is metered from real Gemini token counts. Caps return 402 with upgrade
prompt. Gift redeem adds real credit. Upgrades are recorded requests until
payments connect — no charge is made. See Billing in the app.

## Harness (honest)

Gemini 3.5 decides tools via function calling (`server/agents/vm-harness.js`).
Untrusted work runs in the user's Azure VM (`server/agents/azure-vm.js`).
Until Azure is configured, the fallback is an isolated per-user workspace and
`code_run` stays disabled. Secrets never enter the model or the VM.

## What is real vs honest

- Chat / build / research: real Gemini `gemini-2.5-flash`, usage-logged.
- Agent chat: the main agent stays responsive while cancellable sub-agents do
  task work; unrelated tasks are isolated in automatically opened chats.
- Research: live HN / DuckDuckGo / Wikipedia fetch + cited briefing, no invented stats.
- GitHub: real PR list + diff + Gemini review. PAT per-request, never logged/sent to model.
- Memory + vault: Supabase per-account, encrypted at rest. `sec_••••` only in traces.
- Triggers + sub-agents: durable schedule/app/sub-agent watchers. Every run is an isolated chat, usage-metered and visible in Trace.
- Gmail/apps: honestly empty — no fake connections.

## Tests

```powershell
npm run smoke:real
```

Signs up a fresh test user, checks landing pricing + honest harness wording,
onboards, real chat, live research, vault masking, Apps empty, Billing Free $10.

## GitHub repo

```powershell
gh auth login
gh repo create lingon-agent --private --source=. --push
```

## Project layout

- `app/` — frontend (config.js, mascot.js, engine.js fallback, engine.real.js, app.js, styles.css)
- `server/` — real backend (index.js, gemini.js, research.js, store.js)
- `supabase/` — schema.sql + setup guide
- `tests/smoke.real.js` — Playwright verification against the real backend
