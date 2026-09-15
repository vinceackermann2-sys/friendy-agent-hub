# Lingon — your personal agent (REAL backend)

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

## Supabase setup

1. SQL Editor → run `supabase/schema.sql`, then `supabase/schema2.sql`
   (billing: subscriptions / api_usage / gift_cards / upgrade_requests + hardened RLS).
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

NOT the OpenAI Codex Agents API. Our own Gemini tool boundary
(`server/harness.js`): allowlisted fetch, read-only GitHub with your
per-request PAT (`X-GitHub-Token`), sandboxed HTML artifacts, approvals for
sensitive tools, full trace. Vault → Apps shows empty — no fake OAuth.

## What is real vs honest

- Chat / build / research: real Gemini `gemini-2.5-flash`, usage-logged.
- Research: live HN / DuckDuckGo / Wikipedia fetch + cited briefing, no invented stats.
- GitHub: real PR list + diff + Gemini review. PAT per-request, never logged/sent to model.
- Memory + vault: Supabase per-account, encrypted at rest. `sec_••••` only in traces.
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
