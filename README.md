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

## Supabase (free, optional but recommended)

The app works without Supabase (real local `server/data.json` store). To go
multi-device:

1. Create free project at https://supabase.com/dashboard
2. SQL Editor → run `supabase/schema.sql`
3. API settings → copy URL + anon + service_role into `.env`
4. Restart `npm start` → `/api/health` shows `"supabase": true`

Details in `supabase/README.md`.

## What is real vs honest

- Chat / build / research summaries: real Gemini `gemini-2.5-flash` via backend.
- Research sources: real parallel fetch (Reddit JSON, HN Algolia, DuckDuckGo)
  with excerpts + cited briefing. No invented percentages or sample sizes.
- GitHub: real `GET user/repos`, `GET repos/{repo}/pulls`, real diff, Gemini
  review of the real diff. Token is per-request (`Authorization: Bearer`),
  never stored in logs, never sent to the model.
- Memory + vault: real backend persistence (Supabase or local JSON),
  encrypted at rest when `ENCRYPTION_KEY` is set. Vault values never enter
  model context — traces show `sec_••••` only.
- Gmail: honest stub — needs OAuth client, so the agent says so instead of
  inventing emails.

## Tests

```powershell
npm run smoke:real
```

`tests/smoke.real.js` boots the backend expectation (server must be running),
claims an agent, sends a real chat ("say Hej in 5 words"), checks the answer
is non-empty and not a canned simulation, adds a vault secret and checks the
UI masks it, and asserts `/api/health` reports `gemini:true`.

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
