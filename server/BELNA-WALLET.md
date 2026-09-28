# Belna Wallet production setup

Belna uses Whop's connected-account, card and payment APIs through TimeWarp
(`biz_CpeJbprflNa2ju`), with Supabase authentication, owner permissions, activity
and recovery. Whop's Neobank blueprint is a starter architecture for those APIs;
Belna does not deploy that template. Each human owner needs their own connected
account and issuer identity/card approval. The owner controls all funds.

## Deployment status — 28 September 2026

- Eight wallet migrations are deployed to Supabase `alikzitdkdiatimjygdz`
  (Arche). Wallet records and purchase claims have service-only RLS.
- `whop-wallet-webhook` and `wallet-card-recovery` are deployed. TimeWarp's
  enabled connected-account webhook subscribes to five card transaction events.
  Its signing secret and the recovery provider key are stored in Supabase.
- Authenticated recovery returned HTTP 200 after reading the live TimeWarp
  account. Anonymous requests return 401. There were zero connected live wallets,
  pending purchases and queued events. This proves provider authentication;
  it does not prove card issuance, cancellation or a real transaction event.
- The minute recovery schedule is installed but gated by Vault's
  `wallet_recovery_enabled`, currently false. The application additionally
  requires a successful recovery heartbeat less than three minutes old.
- TimeWarp's twelve-scope "Belna App Server Wallet and Withdrawals" key was saved
  as `WHOP_COMPANY_API_KEY` in the Lingon Agent Helper Lovable project. It adds
  the three bank withdrawal scopes to the previous wallet scopes and expires
  28 September 2027. `WHOP_PLATFORM_ACCOUNT_ID` and `WHOP_SANDBOX=false` are saved.
  The new app key still needs live authentication after this release is published.
- The private checkout source, agent session bridge and owner-only bank challenge
  screen are implemented and tested with a fake card in an isolated browser.
  The dedicated Azure host passed authenticated HTTPS health with a sandboxed
  browser; anonymous health returned 401. Its server token exists only on that
  host and in Supabase Vault. Lovable's checkout origin and token are still
  pending. No Whop or app execution credential goes to the payment host.
- This source release must be published in Lovable before its routes appear
  on the live site. Live purchase card issuing remains disabled until a
  consenting owner's issuer and merchant tests pass.

Secrets belong only in server stores; never use VITE_ variables or chat.
Lovable preview receives secret changes immediately, while the live app requires
publishing. Supabase runs wallet storage and recovery; the application API runs
in Lovable's server runtime. Dashboard sign-in alone does not configure it.

## Owner experience

Settings → Wallet retains both Belna Wallet and Existing card connections,
with Active/Inactive status, switching and saved shipping addresses. Switching
preserves balances, history and signed-in merchant sessions. The agent rechecks
that the approved method and address are still active before buying.

Existing card supports Shop Pay or saved payments in a signed-in merchant
account. Enabling this option does not sign into every merchant. It supports
spending only. Purchases require owner approval, and an unverified merchant
submission is shown as needing confirmation rather than paid.

Belna Wallet shows available and pending USD balances, Send, Deposit, Withdraw,
Earn (payment link), card connection and financial activity. Creating a payment
link is not an earning until money arrives. Transfers currently target another
Belna Wallet owner by email, with a separate $50 rolling daily allowance;
provider fees may be additional. Manual card limit fields and permanent card
previews are absent. The agent can request an allowance change with approval.
Stripe remains only for Belna subscription billing.

Card connection starts the human owner's issuer application. Whop may send the
owner to Whop, Sumsub or `verify.raincards.xyz` for verification. Connection-only
cards are canceled by refresh/recovery and never presented as saved cards.
The team-member Cards dashboard is a different feature and does not establish
connected-account eligibility.

Withdrawals use Whop Elements in an owner-only screen. The backend issues a
child-account scoped, fifteen-minute token with exactly
`payout:withdraw_funds`, `payout:destination:read` and `payout:create_destination`.
The owner enters bank details, reviews fees and confirms the withdrawal inside
that secure screen. The model receives no bank details or access token.
Required provider/issuer disclosures remain visible in their secure flows.

## Private card checkout

A purchase approval binds merchant URL, visible checkout state, items, shipping
address, method and exact USD total. Supported totals are $1–$2,000 with at most
two decimals. Supabase atomically reserves the owner's allowance and claims an
approval once. Unknown outcomes cannot be automatically retried.

The trusted app transfers the approved merchant session from the shopping VM to
an isolated payment host using a one-use, two-minute upload capability. No master
checkout token or card credential enters the agent VM. The host runs sandboxed
Chrome with private temporary profiles, UID egress firewall, downloads disabled,
no public debugging endpoint and no request-body/access logs. Its authenticated
health check must actually launch sandboxed Chrome before new purchases proceed.
See `server/private-checkout/DEPLOYMENT.md` and
`scripts/deploy-private-checkout.mjs` for host setup.

The executor validates the order before card creation and again after issuance.
A card receives only the exact approved total as its lifetime `one_time` spend
limit. No transaction-limit override is added. Card metadata/ownership/expiry
are checked, and only the minimal card-entry fields leave the issuer adapter.
Credentials are transient and never stored in Supabase or returned to tools.
The executor submits once. Bank challenges are accessible only to the authenticated
owner through Wallet. A submitted order is not claimed as confirmed payment.

Recovery requests permanent cancellation on the first transaction, including a
decline, or after fifteen minutes unused. Failed cancellation remains pending
for retry. Closure is recorded only after the issuer confirms it; settlement is
checked separately from closure using a matching completed card spend. Polling
and outages can delay cancellation. A lifetime limit does not guarantee exactly
one authorization. Split shipments, recurring purchases and FX are not supported.

The conservative generic recognizer refuses ambiguous payment forms, changed
orders, multiple totals or unsupported session transfers. It supports some common
hosted payment fields, but cannot guarantee checkout on every website. Delayed
bank challenges, redirects and merchant confirmation need live validation.

## Activation and live validation

1. Publish the wallet release in Lovable and verify the new app key against the
   live TimeWarp account. Install/configure the dedicated private host and save
   `PRIVATE_CHECKOUT_URL` and `PRIVATE_CHECKOUT_TOKEN` only as Lovable server secrets.
2. Enable owner card applications and bank withdrawal UI only with the required
   provider scopes. A consenting owner must create their wallet, complete KYC
   and receive issuer approval themselves. Do not infer card access from the
   team-member dashboard or promise every country is eligible.
3. Check live signed card event ingestion/deduplication, issuer cancellation,
   later capture/refund, connection-card cleanup and recovery failures. Activate
   Vault `wallet_recovery_enabled` only after validating the recovery paths.
   Monitor queue age and unresolved attempts; current recovery processes five
   queued events and up to 100 pending cards per run.
4. With explicit merchant/item/maximum-budget approval, test a small purchase,
   decline, expiry, owner pause, bank challenge and unknown outcome. Enable
   `WHOP_CARD_ISSUING_ENABLED=true` only after these gates are met. Missing or stale
   recovery or private host health still blocks card creation automatically.

Whop cards are production-only in its current guide. Do not assume sandbox card
support. Owner financial account opening, KYC and money movement require the
human owner; tests use synthetic merchant pages and fake credentials only.

## Verification

`npm run test:wallet` covers owner isolation, provider rejection, card privacy,
exact budgets, approvals, duplicate prevention, cancellation, expiry, webhook
queue/recovery and SQL rules. `npm run test:wallet-ui` covers desktop/mobile
Settings, balances, switching, addresses and owner bank screens with mocked APIs.
`node tests/private-checkout.cjs` runs sandboxed Chromium against an intercepted
synthetic merchant with a fake card. These do not establish live issuer support.
`node scripts/check-wallet-production.mjs` inspects authenticated recovery without
creating accounts/cards or moving funds. `node scripts/preview-wallet.cjs` serves
an explicitly mocked interactive wallet inspection at localhost:8012.

References: https://docs.whop.com/api-reference/beta/cards/create-card,
https://docs.whop.com/api-reference/beta/cards/update-card,
https://docs.whop.com/developer/guides/webhooks,
https://supabase.com/docs/guides/functions/schedule-functions.
