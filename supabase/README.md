# Supabase free backend (5 min)

1. Go to https://supabase.com/dashboard → New project (free tier).
2. SQL Editor → paste `schema.sql` → Run.
3. Project Settings → API → copy:
   - `SUPABASE_URL` (Project URL)
   - `SUPABASE_ANON_KEY` (anon public)
   - `SUPABASE_SERVICE_ROLE_KEY` (service_role, secret — server only)
4. In `C:\lingon`, copy `.env.example` to `.env` and paste the values + your `GEMINI_API_KEY`.
5. Restart: `npm start`. Health check: http://localhost:8000/api/health should show `"supabase": true`.

The app works without Supabase too (local `server/data.json` fallback), but with
these keys every chat/memory/vault row is real, multi-device, and RLS-protected.
