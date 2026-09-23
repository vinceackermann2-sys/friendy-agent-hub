# Token rollout review — 23 September 2026

## Prepared locally

- Plans: Free 50M, Pro 100M, Max 200M raw tokens per month. Daily image limits: 5/10/15. Daily transcription limits: 10/15/20.
- Seven non-expiring token packs (10M–500M), priced in `server/plans.js`. Packs, gifts, and referrals use the same wallet without increasing the plan's daily limits.
- Successful provider calls charge reported raw usage; explicit estimates are recorded when a provider omits usage. The meter includes VM runtime. A call started with a positive balance can finish slightly beyond zero; the overage becomes debt and later calls are blocked until new tokens cover it.
- The migration preserves legacy credit rows, converts the existing gift grant, and refuses to run if paid credit packs require manual conversion.
- `npm test` and `npm run build` pass. SQL behavior was exercised in PGlite. Production provider calls and payments have not been exercised with this release.

## Production preflight (read-only)

- `supabase migration list`: `20260923084323` is recorded remotely; `20260923095000` is local only.
- `supabase db push --linked --dry-run --skip-vault`: exactly `20260923095000_monthly_token_wallet.sql` would apply.
- No paid credit packs or active subscriptions were found. One gift credit grant needs the legacy grant backfill included in the new migration.
- Existing Stripe Pro, Max, and gift prices are active at $50/month, $100/month, $50, and $100. The new token pack price IDs are absent.

## Rollout order after approval

1. Apply `20260923095000_monthly_token_wallet.sql` through the linked Supabase migration workflow. Do not reapply the already recorded billing atomicity migration.
2. Run `node scripts/setup-stripe.mjs` against the intended Stripe account. It reuses the existing $50/$100 plans and gift prices and creates/reuses seven token pack prices. It does not create new discounted promo prices.
3. Configure all `STRIPE_TOKENS_*_PRICE_ID` values in the production app environment, then deploy the matching server and client release together.
4. Verify an authenticated Free balance and daily counts, one test-mode token pack checkout/webhook, a gift redemption, a paid invoice renewal, and a short VM lease/meter cycle before opening general purchases. Use test-mode products and a non-production account for paid-flow checks where possible.

## Commercial limits

The revised token pack prices do not protect margin at the $15/M image-output rate. The retained $50/$100 Pro and Max plans can also lose money under heavy usage. See `docs/token-economics-2026-09-23.md` for the full table. Confirm the actual Azure image rate, Stripe fee, and VM invoice before treating any margin as guaranteed.
