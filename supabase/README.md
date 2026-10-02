# Supabase backend

The linked project `alikzitdkdiatimjygdz` is already bootstrapped. Its chat,
message, subscription, usage, credit-grant, and token tables exist, and the
tracked migrations are applied. Do not rerun `schema.sql` through `schema4.sql`
in that project's SQL Editor. For future updates, use
`npx supabase db push --linked --skip-vault`; this includes the tracked billing
and connector-permission migrations.

The wallet migrations use the versions recorded when they were applied through
the dashboard. Their SQL is unchanged; keep these filenames so the CLI can
match the existing production history. Preview pending changes with
`npx supabase db push --linked --skip-vault --dry-run`. When intentionally
applying an older missing migration, inspect the preview with `--include-all`
before adding that flag to the push. Do not mark applied migrations reverted
to resolve missing local files.

For a brand new, empty project only, run `schema.sql`, `schema2.sql`,
`schema3.sql`, and `schema4.sql` once in that order, then apply the tracked
migrations with the CLI. Configure the project keys afterward:

1. Project Settings → API → copy (new dashboard names):
   - `SUPABASE_URL` = Project URL
   - `SUPABASE_PUBLISHABLE_KEY` (sb_publishable_…, anon equivalent)
   - `SUPABASE_SECRET_KEY` (sb_secret_…, service_role equivalent — server only)
   Old ANON / SERVICE_ROLE names also work.
2. In `C:\lingon`, values are already in `.env` (gitignored). Restart: `npm start`.
   Health: http://localhost:8000/api/health should show `"supabase": true`
   AND memory writes should stop logging “Could not find table public.memories”.

The app works without Supabase too (local `server/data.json` fallback), but with
these keys every chat/memory/vault row is real, multi-device, and RLS-protected.

The branded passwordless sign-in email is a separate Auth template, not a SQL
migration. Follow [`templates/README.md`](templates/README.md) to install and
verify it in the Supabase dashboard.
