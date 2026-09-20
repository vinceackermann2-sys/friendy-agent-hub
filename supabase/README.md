# Supabase free backend (5 min)

1. Go to https://supabase.com/dashboard → your project `alikzitdkdiatimjygdz`.
2. SQL Editor → New query → run `supabase/schema.sql`, `schema2.sql`, `schema3.sql`, and `schema4.sql` in order.
   You must see “Success”. This creates profiles / agents / chats / messages /
   memories / vault_secrets / vault_apps / approvals / connector_permissions.
   Run `migrations/20260919120000_billing_totals.sql` after those files to
   enable the fast billing summary.
   For an existing linked project, run `npx supabase db push` instead; deployable
   updates are tracked in `supabase/migrations/`. The connector permissions
   table is added by `20260920120000_connector_permissions.sql` with RLS enabled.
3. Project Settings → API → copy (new dashboard names):
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_PUBLISHABLE_KEY` (sb_publishable_…, anon equivalent)
   - `SUPABASE_SECRET_KEY` (sb_secret_…, service_role equivalent — server only)
   Old ANON / SERVICE_ROLE names also work.
4. In `C:\lingon`, values are already in `.env` (gitignored). Restart: `npm start`.
   Health: http://localhost:8000/api/health should show `"supabase": true`
   AND memory writes should stop logging “Could not find table public.memories”.

The app works without Supabase too (local `server/data.json` fallback), but with
these keys every chat/memory/vault row is real, multi-device, and RLS-protected.

The branded passwordless sign-in email is a separate Auth template, not a SQL
migration. Follow [`templates/README.md`](templates/README.md) to install and
verify it in the Supabase dashboard.
