# Hosted funding correction — 3 October 2026

Whop's deposits API returns a hosted URL containing the account slug. Its current
hosted page sends that slug directly to account, permission and deposit APIs,
which require a `biz_` resource ID. The adapter now builds `/deposit/biz_.../`
only after confirming the deposits response belongs to the owner's account.

Both card callbacks documented at
https://docs.whop.com/elements/latest/wallet/deposit open that hosted page in the
owner's existing wallet dialog. The frame supports payment, forms and sign-in
popups, with retry, back to funding methods and a separate-tab link. Wallet
balance refreshes while funding is open; opening the form never credits money.
The sidebar's Wallet / Existing controls save the same owner-scoped preference
as Settings, preserve the selected method on errors, and support keyboard use.

Regression coverage includes the broken slug response, desktop/mobile switching,
reload and failed saves, both card events, visible interactive funding frames,
retry/back/close and the actual Whop SDK. Live public inspection reproduced the
slug failure and confirmed the corrected page loads inside the desktop/mobile
popup. No live card payment was submitted.

# Money controls verification — 2 October 2026

Send opens an owner-only dialog, alongside Add money and Withdraw.
Send reviews a USD transfer to another connected Belna Wallet's confirmed
sign-in email. Its rolling allowance is $50 per 24 hours. Editing the draft
invalidates the quote; an uncertain submission retains the same quote for a
status check, including after closing and reopening the dialog.

Only exact Supabase `P0001` refusals (`QUOTE_NOT_FOUND`, `QUOTE_EXPIRED` or
`TRANSFER_LIMIT`) return `transferNotStarted: true` and release the draft for a
new review. Transport failures and unexpected database errors retain the
original quote for Check transfer status. `tests/wallet-transfer-rejections.cjs`
covers this distinction in both runtimes; `tests/wallet-money-ui.cjs` covers
the owner's recovery controls.

Earning, Get paid and payment-link creation have been removed from the app,
agent tools and connected-wallet API. Existing financial activity remains visible.
Sending is a real Whop ledger transfer between account IDs: the recipient’s
confirmed Belna email is a lookup in Belna, not a provider destination or an
email claim link. Both users need existing connected Belna Wallets. Arbitrary
Whop emails and external crypto addresses are not supported. Historical
personal-wallet notes below describe the retired integration.

Embedded money forms wait for SDK readiness, keep a visible frame container,
show a retry for loading failures or stalls, and destroy old frames on retry
or close. Desktop/mobile regression checks use interactive cross-origin frames;
the optional `WHOP_ELEMENTS_SDK_SOURCE` runs them with the actual Whop SDK.

`npm test`, `npm run test:wallet`, `UI_BASE=http://127.0.0.1:8000 npm run
test:wallet-ui` and the production build pass. Read-only live inspection confirmed
provider account and checkout reads, transfer/card-funding capabilities, and
visible funding and bank-withdrawal forms. Live withdrawals are enabled; card
applications and agent card issuing remain disabled. No live payment, deposit,
transfer or withdrawal was submitted, so completed money movement is not proven
by these UI checks.

# Connected wallet correction — 30 September 2026

Belna Wallet now uses connected Whop sub-accounts (`biz_`), with each card assigned
to the verified human owner (`user_`). New setup does not use personal OAuth.

The service-only `whop_connected_wallet_config` Vault secret supplies the company
API key, platform account ID, environment and feature switches to both the app
and recovery worker. The worker no longer hardcodes a previous platform account.
Never expose these settings through `VITE_` variables.

The owner creates the wallet in Wallet settings. `prepare_connected_whop_wallet`
archives their previous personal mapping, retains OAuth tokens and the older
business archive, and rejects switching while a money movement remains pending.
Provider funds are never transferred by the migration. The previous personal
balance remains accessible on Whop. Identity and issuer approval remain separate.

Local checks cover the connected adapter, configuration, owner isolation,
repeated setup, pending-payment guards, database permissions, card controls and
purchase recovery. Live credentials, webhook configuration and issuer approval
must be verified separately; local checks do not prove card issuance.

Consumer card setup mounts Whop's Verifications KYC component with
`kind: individual` and a fifteen-minute, account-scoped token restricted to
`identity:read` and `identity:write`. The Cards list is not a consumer
verification entry point: its current Verify button starts `kind: business`
regardless of the approved individual KYC on that account. The company key must
include both identity permissions. Card details still use the private card
component after issuance. Identity approval and card issuing approval remain
separate; do not present the former as proof that a consumer card was issued.

Whop publishes an international consumer program with personal-use terms:
https://whop.com/intl-card-consumer-terms/ and regional restrictions:
https://docs.whop.com/whop-finance/supported-regions.
The `biz_` prefix identifies a connected account, not the holder's legal entity
type. Never collect business registration from consumers merely to get through
the Cards widget's KYB flow. The relevant component documentation is
https://docs.whop.com/elements/latest/verifications/overview.

The sections below retain the history of the previous integrations.

# Belna Wallet production setup

Belna connects each human owner's personal Whop `user_` wallet through public
OAuth with PKCE. Deposits, cards, transfers, balance and withdrawals use that
owner's encrypted OAuth credentials. The company key cannot impersonate them.

## Personal wallet release — 29 September 2026

The private OAuth app `app_EsliBHi4tywWVQ` is configured as Public with callback
`https://belna.se/app`. The service-only `whop_personal_wallet_config` Vault secret
contains its public settings and the shared token encryption key. Tokens, refresh
leases and single-use callback state are service-only and bound to both owners.

Migration `20260929180000_personal_whop_wallets.sql` is applied. Connecting a
personal wallet archives the previous business wallet; funds are not transferred
automatically. Previous business wallets are no longer displayed in Belna. The
archive retains their financial records; the migration refuses changes while
existing money movements remain unsettled.

Whop's live `POST /cards` for the owner's `user_id` returned HTTP 400:
"Card applications are only supported for accounts, not user wallets." Its
card-issuing tutorial likewise uses connected `biz_` accounts. Personal card
applications and agent card checkout are therefore disabled behind separate
`WHOP_PERSONAL_CARD_APPLICATIONS_ENABLED` and
`WHOP_PERSONAL_CARD_ISSUING_ENABLED` flags. Do not enable either until Whop
confirms a supported consumer-card route and a live card application and
purchase are verified. The existing company-card flags do not enable this.
The app shows the provider limitation instead of claiming an application is
under review. Existing business-card balances and cards are not moved into
the personal wallet.

Add money and Withdraw embed Whop's elements using short-lived owner tokens.
Get paid creates a reviewed transfer request payable by another connected Belna
personal wallet. It does not provide public merchant card checkout. Personal
activity excludes owned business accounts. Card details appear only in the
owner's Whop element or the private purchase executor, never agent outputs.

The database migration and recovery/webhook workers are deployed. Authenticated
recovery returned HTTP 200 with personal-wallet support healthy. Automated tests
exercise PKCE, ownership, application transitions, exact-budget purchases,
cancellation, SQL and desktop/mobile UI. These checks do not establish live
consumer card eligibility, issuance or successful merchant payment. The live
provider response currently blocks new personal cards altogether.

The sections below document the retained legacy connected-account integration.

## Deployment status — 28 September 2026

- Eight wallet migrations are deployed to Supabase `alikzitdkdiatimjygdz`
  (Arche). Wallet records and purchase claims have service-only RLS.
- `whop-wallet-webhook` and `wallet-card-recovery` are deployed. TimeWarp's
  enabled connected-account webhook subscribes to five card transaction events.
  Its signing secret and the recovery provider key are stored in Supabase.
- Authenticated recovery returned HTTP 200 after reading the live TimeWarp
  account. Anonymous requests return 401. The latest check has one connected live
  wallet, zero pending purchases and zero queued events. The pre-issuer
  "No Rain account found" response on GET cards is treated as an empty card list;
  other provider failures still block recovery. This proves provider authentication;
  it does not prove card issuance, cancellation or a real transaction event.
- The minute recovery schedule is enabled through Vault's
  `wallet_recovery_enabled=true`. An automatic scheduled run was verified with
  a fresh successful live heartbeat. The application additionally requires a
  successful recovery heartbeat less than three minutes old.
- TimeWarp's twelve-scope "Belna App Server Wallet and Withdrawals" key was saved
  as `WHOP_COMPANY_API_KEY` in the Lingon Agent Helper Lovable project. It adds
  the three bank withdrawal scopes to the previous wallet scopes and expires
  28 September 2027. `WHOP_PLATFORM_ACCOUNT_ID` and `WHOP_SANDBOX=false` are saved.
  A signed-in request on the published site now authenticates against the live
  TimeWarp platform account. Owner wallet setup has created a connected account.
- The private checkout source, agent session bridge and owner-only bank challenge
  screen are implemented and tested with a fake card in an isolated browser.
  The dedicated Azure host passed authenticated HTTPS health with a sandboxed
  browser; anonymous health returned 401. Its server token exists only on that
  host, in Supabase Vault and as a Lovable server secret. The checkout origin is
  also saved in Lovable. No Whop or app execution credential goes to the payment
  host. The host is not yet tested from an actual issuer-approved purchase.
- The wallet source release and edge-compatible provider/checkout requests are
  published on `belna.se`. Signed-in Wallet and Settings views load. Owner card
  applications and withdrawal UI are enabled. At the owner's explicit request,
  `WHOP_CARD_ISSUING_ENABLED=true` is configured for live manual checkout testing.
  The isolated host passes authenticated browser health. Each owner still needs
  issuer approval, an active wallet, sufficient funds and explicit purchase
  approval. Actual issuer card creation, closure and merchant orders remain
  unverified until the owner's manual tests complete.

Secrets belong only in server stores; never use VITE_ variables or chat.
Lovable preview receives secret changes immediately, while the live app requires
publishing. Supabase runs wallet storage and recovery; the application API runs
in Lovable's server runtime. Dashboard sign-in alone does not configure it.

## Owner experience

Identity completion is read from Whop's account verification summary, separately
from the card issuer's approval. An approved identity with no issuer account moves
to card connection; it does not enable card spending. Approved profiles have no
verification session URL, so Verify returns current wallet status instead of
opening another identity check. Wallet settings and the Payments panel refresh
on return from the provider, check pending setup for two minutes while visible,
and provide a Check status button. Only verification status leaves the adapter;
legal names, birth dates, documents and verification session links are excluded
from wallet snapshots.
The existing account-read permission is sufficient; reading private profiles from
GET /verifications is unnecessary and is rejected by the production wallet key.

Settings → Wallet retains both Belna Wallet and Existing card connections,
with Active/Inactive status, switching and saved shipping addresses. Switching
preserves balances, history and signed-in merchant sessions. The agent rechecks
that the approved method and address are still active before buying. An owner who never
chose a method keeps paying with Shop Pay or a card saved at the merchant, as
before Belna Wallet; a saved choice, including Off, is respected. Creating a
wallet requires a confirmed email address, since money sent to the wallet is
addressed to it.

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

Payment links create an inline checkout plan using `plan.company_id`, the owner's
connected account, and validate the returned owner, USD currency, one-time plan
and exact amount before sharing its URL. The initial live unpaid $1 link test
was rejected because `checkout_configuration:create` alone is insufficient.
On 29 September, the owner approved adding `plan:create`, `access_pass:create`,
`access_pass:update` and `checkout_configuration:basic:read` to the existing app
server key. The owner completed Whop's additional email security check, and the
saved key now has sixteen scopes. Live deposit and embedded bank setup screens
load for the owner's wallet, and an unpaid $1 checkout link was successfully
created from the published app. Completed funding and payouts still need real funds.

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
approval once. Unknown outcomes cannot be automatically retried. A purchase closed
before any card was issued no longer holds the allowance; recovery still cancels
a card issued for it late. The delivery address counts as shown when every
approved part (recipient, street, postal code, city) is on the checkout page,
ignoring spacing and punctuation.

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

1. A consenting owner must create their wallet, complete KYC and receive issuer
   approval themselves. Do not infer connected-account card access from the
   team-member dashboard or promise every country is eligible.
2. Check live signed card event ingestion/deduplication, issuer cancellation,
   later capture/refund, connection-card cleanup and recovery failures. The owner
   authorized enabling Vault `wallet_recovery_enabled` for live manual testing;
   synthetic recovery tests and live scheduled heartbeat checks passed.
   Monitor queue age and unresolved attempts; current recovery processes five
   queued events and up to 100 pending cards per run.
3. With explicit merchant/item/maximum-budget approval, test a small purchase,
   decline, expiry, owner pause, bank challenge and unknown outcome. The owner
   authorized `WHOP_CARD_ISSUING_ENABLED=true` before these live tests so they can
   perform them themselves. Missing or stale
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
