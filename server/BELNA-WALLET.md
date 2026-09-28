# Belna Wallet production setup

Belna uses Whop's connected-account and virtual-card APIs through the existing
**TimeWarp** business (`biz_CpeJbprflNa2ju`). Whop's Neobank blueprint is an
example architecture, not a separate product that Belna has installed. Each
Belna owner needs their own connected account and identity check before Whop
can approve cards. The owner keeps control of the money; Belna requests each
purchase for approval and creates a card only for that exact total.

## Current status

On 27 September 2026 the four wallet migrations were applied to the app's configured
Supabase project alikzitdkdiatimjygdz (Arche). Wallet tables have RLS and only
backend service-role access. On 28 September the webhook queue and card-connection
recovery migrations were applied, and `whop-wallet-webhook` and `wallet-card-recovery` Edge Functions were
deployed. On 28 September a TimeWarp v1 webhook was created for five card-transaction
events from connected accounts, its `ws_` signing secret was stored in Supabase
Edge Function secrets, and the webhook was enabled. A signed Whop test for an
unsubscribed event returned 200 from the receiver. Whop's canned
`card_transaction.created` test returned 400 because its sample omitted the
account and card IDs required by the handler; no real card event or queue insertion
has been validated yet. Recovery now checks a server-only token generated
inside Supabase Vault; anonymous calls return 401. Its minute schedule is
installed but dormant until `wallet_recovery_enabled` is set to `true` after
live validation. A scoped TimeWarp Account API key named "Belna Wallet
Production Replacement" expires 28 September 2027 and is stored in Supabase Edge Function
secrets as `WHOP_COMPANY_API_KEY`. An authenticated recovery call returned 200
with zero wallets, purchases and queued events. A separate nine-scope TimeWarp
key named "Belna App Server Production" was saved as `WHOP_COMPANY_API_KEY` in
the Lingon Agent Helper Lovable project's server secrets. That project also has
`WHOP_PLATFORM_ACCOUNT_ID=biz_CpeJbprflNa2ju` and `WHOP_SANDBOX=false`.
Lovable says secret changes apply immediately to preview and require a publish
for the live app. Frontend and agent code changes are local and have not been
published by this task.

The hardened recovery worker was redeployed through Supabase Dashboard on
28 September as a single-file bundle. The authenticated production inspection
initially returned Whop HTTP 401. The rejected recovery key was replaced with
the same ten scopes and expiry, stored only in Supabase, and its stored SHA256
digest was checked against the one-time key. On 28 September at 13:09 UTC the
authenticated worker returned HTTP 200 and wrote `ok:true` health after reading
the live TimeWarp account and checking the recovery queues. There were zero
connected live wallets, pending purchases and queued card events. This validates
recovery-provider authentication, not card issuance or an actual checkout. The
separate Lovable app key has not been live-authenticated. The schedule remains
dormant. `node scripts/check-wallet-production.mjs` repeats this inspection
without creating wallets/cards or moving funds and never prints credentials.

**Real agent card checkout remains disabled.** An isolated checkout executor
and live issuer validation are still missing. Database deployment alone does not activate
payments. Existing saved cards and Shop Pay remain the available purchase paths.
Signing in to the TimeWarp dashboard by itself does not configure the backend.
TimeWarp's **team-member** Cards page reported an unsupported region for that
dashboard feature; it is not a test of the separate connected-account card API.
Whop's current card guide says each connected account's owner completes identity
verification and receives card approval individually. The older masked key named
"AI Agent Backend" cannot be copied from its dashboard row and is not configured
in Belna's server.
`WHOP_CARD_ISSUING_ENABLED` remains false as a release gate until the purchase
executor and live card recovery are validated, not because of the team Cards page.

## What you need from Whop

1. Verify TimeWarp can create child accounts with an Account API key, then test
   a single consenting owner in a supported country through identity verification
   and card approval. The team-member Cards warning does not settle connected
   account eligibility. Cards are production-only in Whop's current guide.
2. TimeWarp now has separate narrowly scoped Account API keys in Supabase Edge
   Function secrets and Lovable server secrets. Whop's card
   guide lists `payout:account:read`, `payout:account:update`,
   `company:balance:read`, `webhook_receive:card_applications`, and
   `webhook_receive:card_transactions`; child account creation additionally
   uses `company:create_child`. Add only the scopes needed for Belna's enabled
   deposit, payment-link, transfer, and financial-activity flows after checking
   the corresponding endpoint permissions.
   Grant only the permissions Whop confirms for this program. The **Account
   API key** on TimeWarp creates connected child accounts;
   a user token creates a different kind of account. The existing masked key
   cannot be recovered from its dashboard row. Keep keys in server secret stores,
   never in client code or chat.
3. Confirm single-purchase cancellation behavior, partial authorizations, split
   shipments, later capture and refunds. The published API supports a lifetime
   one_time spending limit and permanent cancellation, but does not promise
   automatic single-use expiry or merchant locking.
4. Request Belna-branded embedded flows. Whop may return a Sumsub-hosted
   identity session; deposits and payment links can also show partner branding
   and crypto funding methods. The verification redirect allows only Whop and
   Sumsub HTTPS hosts, while deposit and payment links allow only Whop hosts.
   Required issuer/legal disclosures must remain visible.

Keep keys out of chat, frontend code and VITE_ variables. In Supabase Dashboard,
open Edge Functions -> Secrets and set WHOP_COMPANY_API_KEY and
WHOP_WEBHOOK_SECRET. This deployed recovery worker is pinned to TimeWarp
`biz_CpeJbprflNa2ju` and live Whop; the app API's three Whop settings are now
stored in Lovable server secrets. The recovery bearer token is generated in
Supabase Vault, never copied into Edge Function secrets.
Supabase provides the function's own URL and service-role key. The app API reads
the Whop key, platform account ID, and explicit sandbox setting from its server
environment (server/ or src/lingon-server/).
That API does not run simply inside the Supabase database. `WHOP_SANDBOX=false`
selects the live Whop API, but no wallet API code has been published to Lovable yet. Sandbox wallet
accounts cannot become live accounts. Native API version is pinned to 2026-09-25.
`WHOP_CARD_ISSUING_ENABLED` defaults to false even when an API key is present;
enabling it is a separate release decision after issuer approval and private
checkout/recovery validation.

## Purchase backend implemented

On 28 September the purchase lifecycle was hardened further: the private
executor must verify the order before a card or allowance reservation is
created, then verify again after issuance. Changed orders, paused wallets,
expired attempts, invalid expiry dates and mismatched card metadata cannot
submit. Only the checkout fields needed for payment leave the issuer adapter;
the ATM PIN and unrelated provider fields are excluded. Recovery accepts a
completed spend on the matching card as payment evidence; a refund or another
card's transaction cannot mark an order paid.

The app now requires an enabled recovery schedule and a successful heartbeat
less than three minutes old for the same live TimeWarp connection, in addition
to the card release flag and injected private executor. Missing, stale or failed
health blocks new purchases. The worker records health in service-only Supabase
Vault as `wallet_recovery_health`; health contains no credentials. It validates
the live platform account before reporting health even with empty queues.
`scripts/bundle-wallet-recovery.mjs` creates a tested single-file entry point
for Dashboard deployment without relative files outside the function folder.
This does not implement the missing private browser or enable purchases.

browser_submit accepts payment.method=belna_wallet only if wallet_status reports
agentCardPayments=true. Owner approval binds the current checkout to merchant,
items, delivery address, payment method and exact total. The service supports
USD totals from $1 to $2,000 with at most two decimal places.

Supabase atomically reserves the owner's rolling purchase allowance and claims
an approval once. A separate card is created with BOTH its lifetime spend limit
and transaction limit equal to the final approved amount including delivery and
tax. The legal cardholder is the human owner. Unknown outcomes retain their
reservations; retrying the same approval never submits the merchant order twice.

Only masked card metadata is persisted or returned to model tools. Credentials
are transient in trusted server code and may be passed only to an isolated
checkout executor. Raw provider/executor errors never reach the model. A
submitted checkout is not described as confirmed payment.

Recovery requests permanent cancellation after the first transaction (including
a decline) or after 15 minutes if unused. An uncertain checkout also attempts
cancellation. Failures remain pending for retry. A card is marked closed only
when the issuer confirms cancellation. Settlement is checked separately.
Freezing the owner's card also requests closure of outstanding purchase cards.
The same recovery worker also checks card-application accounts for a late
"Belna card connection" card and cancels it. The application intent is saved
before the create request so a lost issuer response still enters recovery.
The deployed endpoint at
`https://alikzitdkdiatimjygdz.supabase.co/functions/v1/whop-wallet-webhook`
verifies Standard Webhooks signatures, inserts only event/account/card IDs into
a service-only, deduplicated queue, and acknowledges promptly. The recovery
worker leases queued events, re-reads Whop's current card state, and reconciles
the matching owner purchase before canceling its card. The webhook and signing
secret are configured; the worker schedule is dormant pending a real card event,
issuer cancellation test and recovery validation.

The TimeWarp webhook uses resource `biz_CpeJbprflNa2ju`, `api_version=v1`,
connected-account events, and events
`card_transaction.created`, `.updated`, `.completed`, `.declined`, and
`.reversed`. Connected-account events are needed for Belna users' accounts;
otherwise the webhook watches only TimeWarp's own cards. Its signing secret is
stored in Supabase. Before activating purchase cards, verify a real signed card
event creates a deduplicated queue row and that the recovery worker handles it.

The deadline is enforced asynchronously, not through an issuer expires_at field.
Polling and outages can delay cancellation. A lifetime budget does not guarantee
exactly one authorization. Recurring purchases and split-shipment merchants are
not ready for this flow. Non-USD purchases require verified FX handling first.

## Remaining engineering before enabling checkout

An isolated checkout executor is NOT implemented in this change. Implement a
secureCheckout factory and inject it into the wallet adapter in both agent
registries. Every purchase gets a separate context with these methods:

- verify(approved): verify the merchant, items, total/currency and delivery
  against authoritative checkout state immediately before payment.
- submit({approved,purchaseId,card}): fill and submit once without logging
  credentials or returning payment-page observations to the agent.
- close(): destroy private payment state even after errors.

This must run OUTSIDE the agent VM and code tools. The current VM can execute
code and access browser state; screenshot masking cannot guarantee private card
credentials. Securely transfer the approved checkout into that isolated payment
environment, support hosted payment frames and owner-only 3-D Secure challenges,
and refuse unsupported merchants. No model tool can access credentials or the
private browser. The injected interface by itself is not a production bridge.

The minute Supabase Cron schedule and Vault token are installed but gated off.
Enable it after a real card event and issuer cancellation test by storing `true` as the service-only
`wallet_recovery_enabled` Vault secret, then alert on failures. Test provider outages and
worker crashes. Do not enable purchases until both recovery paths and issuer
cancellation behavior are verified.

## Recovery schedule

Migrations `20260928130000_wallet_recovery_schedule.sql` and
`20260928140000_wallet_recovery_activation_gate.sql` created the secret and
installed the schedule. After Whop credentials, webhook signing and a live
delivery test are verified, set the Vault flag using the existing service-only
`put_server_secret` function, then check successful responses and monitor
unresolved counts. This endpoint uses
its own secret authentication; JWT verification is disabled specifically for
this service-to-service endpoint. Never substitute a user token. The poller
claims up to five queued webhook events and polls up to 100 pending purchase
cards. Monitor both queue age and unresolved purchase count, and increase
worker capacity before enabling purchase volume.

## Interface and verification

The Wallet panel matches the expandable Mail/Automations/Approvals layout, with
Belna Wallet and Existing card. Belna Wallet can receive earnings and send money
under owner control. Existing card supports spending only. Stripe remains for
app subscription billing, not as a wallet option. Both choices can coexist.
There is no cryptocurrency terminology inside Belna.

npm run test:wallet checks owner access, card privacy, approval binding, exact
budgets, duplicate prevention, cancellation recovery, expiry and SQL limits.
npm run test:wallet-ui checks desktop/mobile controls with mocked APIs.
node scripts/preview-wallet.cjs serves an interactive inspection fixture at
http://127.0.0.1:8012. It never connects real balances or sends real payments.

The wallet suite also checks recovery freshness, activation, platform and
environment isolation, worker authentication, error handling and compilation
of the Dashboard deployment bundle. The UI suite uses mock balances and
transactions; it does not demonstrate live deposits, cards or purchases.

These tests do not replace issuer sandbox and merchant checkout validation.
Validate sandbox-supported account flows separately; validate real identity checks, card issuance, declines, first authorization, later
settlement, refunds, owner pauses and cancellation failures. Earnings come from
actual balances, not creating payment links. Transfers currently target other
Belna users with a separate rolling $50 allowance; partner fees may be additional.

References:

- https://docs.whop.com/api-reference/beta/cards/create-card
- https://docs.whop.com/api-reference/beta/cards/update-card
- https://docs.whop.com/developer/guides/webhooks
- https://supabase.com/docs/guides/functions/secrets
- https://supabase.com/docs/guides/functions/schedule-functions

## Wallet settings and delivery addresses

Settings → Wallet stores Belna Wallet and Existing card connections, marks Active/Inactive and permits switching or deactivating future spending. Preferences persist in Supabase without deleting provider accounts, merchant sessions, balances or history. The agent reads the selection through wallet_status and checks it again before browser_submit or shop_purchase. Purchases require an active method; an unselected or deactivated wallet cannot be used. Shipping addresses live in this Settings tab, with a shortcut in the Wallet panel.

With no active wallet, the panel offers two connection cards. Existing card shows purchase history and supports Shop Pay or logged-in merchant payments. Enabling merchant payments is permission to use a saved card; it does not assert that a merchant session is already signed in. Browser purchase attempts are recorded once with “Confirmation needed”; they are not claimed as paid without a verified merchant result. Shop Pay history uses its existing order records.

Belna Wallet displays available/pending USD balances, Send, Deposit, Withdraw, Earn (payment link), card connection status and financial activity. Card connection starts the human owner’s issuer application/KYC; an application is not an approved card. Connection-only cards that finish provisioning are canceled on refresh and never exposed as a saved card. Each actual approved purchase uses the dedicated one-time purchase service. The UI never displays a permanent card or card number. Backend amount caps remain enforced without manual limit fields; the agent can request an exact allowance change with owner approval. Creating a payment link does not record earnings. USD activity comes from the owner-scoped native financial_activity endpoint; provider source details and credentials are excluded.

Bank withdrawals remain unavailable: the button explains this. Production requires a verified owner payout destination, fee/arrival quote, explicit approval and idempotent payout reconciliation before enabling it. The isolated purchase executor, code publication, and recovery scheduling still need configuration and live validation before real agent card checkout can be enabled.

Shipping addresses are stored per authenticated owner in Supabase, independently of Whop availability. The first address becomes default; replacing/removing a default is atomic. The agent reads shipping_addresses before purchases and includes shippingAddressId and the formatted address in its approval. Editing/deleting the address invalidates pending approvals.

Whop’s current card guide says cards are production-only, so sandbox card support must not be assumed. Test wallet/account flows in sandbox; verify issuer testing options before actual card issuance. Whop’s Neobank blueprint is a separate template. Belna uses the underlying connected-account and card APIs directly, with its own Supabase sign-in and interface.
