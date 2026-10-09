# Security and bug audit — 2026-10-08

Scope: the Node backend (`server/`), the edge port Lovable serves (`src/lingon-server/`),
the vanilla frontend (`app/`), the Supabase schema and migrations, the three Supabase edge
functions, and the uncommitted working tree as of this date. Read-only review; nothing was
changed. `npm run test:security` passes, every server module passes `node --check`, no
secrets are present in tracked files, and `npm audit --omit=dev` reports one high
(source-map-js, event-loop DoS in a build-time dependency).

Severity reflects impact and how reachable the issue is. Confidence: **confirmed** means the
code path was traced end to end; **plausible** means every link was read but exploitation
depends on an external condition.

## 1. Fix first

### 1.1 Account deletion fails and locks the account for anyone with a Belna card purchase
- Severity: high · Confidence: confirmed
- `supabase/migrations/20260927190810_wallet_purchase_cards.sql:3` — `belna_wallet_purchases.user_id`
  references `belna_wallets(user_id)` with no `on delete` clause.
- `supabase/migrations/20261004133503_apple_device_connections.sql:39-45` — `delete_belna_account_data`
  deletes only `apple_devices` and `profiles`; the `profiles → belna_wallets` cascade then hits the FK
  whenever any purchase row exists (closed or cancelled included). No server code deletes purchases.
- `server/apple-auth.js:8,75` — the `account_deletions` fence row is inserted first, Stripe is cancelled,
  Composio connections removed and the Azure workspace erased, then the RPC fails with 503. Every
  `requireAuth` route afterwards answers 409 "Account deletion is pending" (`server/auth.js:49-52`) and
  nothing clears the fence (`service_role` has no delete on that table).
- Fix: migration that recreates the FK `on delete cascade` (or deletes purchases, transfers and
  `agent_vm_instances` rows inside `delete_belna_account_data` before `profiles`), plus a way to clear a
  failed fence. Add a test that deletes an account that has a purchase row.

### 1.2 Edge store fails open on connector permissions
- Severity: high · Confidence: confirmed (direct diff of the two hand-maintained stores)
- `src/lingon-server/store.js:1360-1392` — `getConnectorPermissions` catches any Supabase error and
  falls through to the empty in-memory store, returning `[]` ("nothing disabled");
  `setConnectorPermissions` swallows the upsert error and returns the list as if saved.
  `server/store.js:1655-1680` throws in both cases.
- Trigger: a transient database error during a connector tool call on the deployed edge runs an action
  the owner disabled; or the owner's "disable" is acknowledged but never persisted.
- Fix: port the Node behaviour (throw) to the edge store. Treat every permission read as fail-closed.

### 1.3 The browser purchase guard is an English/Swedish keyword match
- Severity: high · Confidence: confirmed
- `server/agents/purchase.js:17-18,33,54-69` — `browser_action` (no approval,
  `permission-policy.js:57`) is blocked from clicking only when the target label matches `FINAL_ACTION`
  or the place-order list, or the page text matches `checkoutContext`. All lists are English/Swedish.
  Coordinate clicks carry no label and are stopped only by the page-text match.
- Trigger: a German, French, Dutch or Spanish checkout ("Jetzt kaufen", "Commander", "Comprar"), or a
  one-click product page without checkout words clicked by coordinates, lets a misbehaving or injected
  worker place the order with the merchant's saved card or Shop Pay session. No approval card appears.
  `docs/website-purchases.md` promises the final click always needs a fresh owner decision.
- Fix: make the guard structural: block any click/Enter when the URL path or form action matches
  checkout patterns (`/checkout`, `/cart`, `/order`, Shopify `checkouts/`), add the major EU
  languages, and route coordinate clicks on pages with a payment/order form through `browser_submit`.

### 1.4 The live-view channel id is a bearer secret, never rotates, and is handed to the model
- Severity: high · Confidence: confirmed chain; exploitation needs the id to leak
- `src/lingon-server/agents/tools.js:69-81` — topic = `live-<HMAC(service key, "live:user:session")>`,
  stable for the life of the session, no nonce or expiry. `tools.js:53` puts `liveId: rt:<topic>` in the
  tool result; `server/agents/task-runtime.js:205-218` (`observe`) strips only the screenshot, so the
  topic lands in the model's observation text; `server/agents/conversation.js:702` does the same in chat.
- `server/agents/azure-vm.js:914-923` (browser) and `:1767-1778` (desktop) accept `watch`,
  `control {takeover:true}` and `input` from the public Realtime channel (`private:false`) with no
  signature; only `step`/`job` are HMAC-checked. The app joins with the project anon key
  (`/api/live/realtime`), so topic + anon key = watch the owner's logged-in browser, take over and type.
- Trigger: a prompt-injected page gets the agent to echo its live id into a form, email or URL; or any
  chat/task export. One leak is permanent for that user and session.
- Fix: strip `liveId`/`transport` from model-visible observations (keep them on cards only), add a
  per-run random nonce to the topic, and either use Supabase private channels with RLS or have the
  server mint a per-viewer key that signs `watch`/`control`/`input`.

## 2. Should fix

### 2.1 Prompt-injection surface in the worker
- Severity: medium-high · Confidence: confirmed (design-level)
- `server/agents/permission-policy.js:46-53` — in the default "ask for some" mode, `web_search` URLs and
  `browser_open` need no approval, right after unapproved reads of mail, memory, library, shipping
  addresses and connected apps. An injected worker can exfiltrate data in a query string.
  `tests/agent-permissions.cjs:27` asserts this behaviour.
- `server/agents/personal-tools.js:41-62` — `system_file_update` has `approval:false` and rewrites
  AGENTS.md/SOUL.md/IDENTITY.md/USER.md, which go into every worker's system prompt
  (`vm-harness.js:182-191`): injected text becomes standing instructions.
- `server/agents/automations.js:87-93,147-162` — Composio webhook payloads (inbound email bodies) are
  inlined into the worker's `instructions` rather than delivered as an untrusted observation.
- `server/agents/cards.js:9-13`, `vm-harness.js:20-31` — card image URLs are model-chosen and loaded by
  the owner's client: a tracking-pixel channel.
- Fix: require approval for model-chosen URLs with query strings once a task has read private data (or
  strip query strings), make `system_file_update` approval-gated with a diff card, deliver webhook
  payloads as observations, restrict card images to hosts read in the same task.

### 2.2 Chat coordinator bypasses the web permission policy
- Severity: medium · Confidence: confirmed
- `server/agents/conversation.js:579,689` — `COORDINATOR_TOOLS` (`web_search`, `history_search`) run via
  `d.tools[name].run` without `permissionDecision`, so the owner's "always ask" web setting and any
  deny grants never apply in chat.
- Fix: route them through `d.permission` like `appLookup`; hand off to a task when approval is required.

### 2.3 Purchase approval card shows the model's claimed total, not the page's
- Severity: medium · Confidence: confirmed
- `server/agents/purchase.js:88-91,116-127` — for saved-card, Shop Pay and payment-app purchases,
  `amount`, `currency`, `items` and address come from `args.purchase`; the page is checked only for the
  payment label string and a content hash. `cards.js:624-630` renders that amount as the total.
  Only the Belna-card path verifies totals (`private-checkout/runtime.js:55-64`).
- Fix: run the `checkoutTotals()` logic on `session.text` in `details()` and refuse unless exactly one
  page total equals `amount` and each item title is present.

### 2.4 Supabase write failures silently fall back to a non-durable store
- Severity: medium · Confidence: confirmed
- `server/store.js:1512-1524` (`insertMailMessage`) and the same pattern in `saveTurn` (1088-1101),
  `upsertMailbox` (1402-1411), `upsertMailDraft` (1631-1640), `updateMailMessage` (1536-1543),
  `upsertShopPayAccount` (1823-1832), `logToolRun`, `requestUpgrade`; mirrored in the edge store.
- Effect: `/api/mail/webhook` returns `ok:true` on a failed insert, Resend marks the mail delivered, the
  message is lost on the edge (or stranded in `data.json` on Node). Chats, drafts and Shop Pay tokens
  can be reported saved without being persisted.
- Fix: when `supaConfigured()`, throw instead of falling back (the vault already does,
  `server/store.js:309-312`) so webhooks return 5xx and the provider retries.

### 2.5 VM idle sweeper cron probably never fires on the edge deployment
- Severity: medium (Azure cost + user token metering) · Confidence: plausible, likely
- `supabase/migrations/20260923130000_vm_sweeper_trigger_token.sql:14-16` reads
  `get_server_secret('VM_SWEEP_TRIGGER_TOKEN')`. `get_server_secret` matches `name = p_name` exactly
  (`20260919100000_agent_vm_leases.sql:229-241`); the server lower-cases every lookup
  (`azure-vm.js:170`), and `20260924140000_automation_recovery.sql:31-32` moved the other two jobs to
  lowercase "because Vault stores the lowercase key". This job was never rescheduled.
- Effect: on Lovable (no Node `setInterval` sweeper) `claim_idle_agent_vms` never runs: idle VMs stay
  allocated and `meter_agent_vm_runtime` keeps charging.
- Fix: reschedule with the lowercase name (or `lower(p_name)` inside `get_server_secret`); verify in
  `cron.job_run_details`.

### 2.6 A VM can be started with no lease, so the sweeper never stops it
- Severity: medium · Confidence: confirmed by trace
- `server/agents/azure-vm.js:2645-2663` (`ensureRunning` → `startVm`) acquires no lease and writes no
  `power_state`; `:3118` (`execInSandbox` with `alreadyRunning=false`) and `:3075` call it.
  `claim_idle_agent_vms` only claims rows in `running`/`starting`; metering runs only on acquire/renew/release.
- Trigger (Node): a live session whose renewals fail (wallet at zero) lapses, the sweeper deallocates,
  the next viewer action boots the VM again with no lease, token check or metering.
- Fix: make `execInSandbox`/`startBrowserRelay` acquire and release a short lease, or have `startVm`
  upsert `power_state='starting'` and `last_lease_at`.

### 2.7 Shell agent wedges permanently on one hung command
- Severity: medium · Confidence: plausible (code-level)
- `server/agents/azure-vm.js:1162-1187` — jobs resolve on `close` (waits for inherited pipes); the 120 s
  timer kills only `bash`, not the process group; `timeout 30s podman run` lacks `-k`; jobs are acked
  before queueing, so once the queue is stuck every later job is claimed and the server throws
  `AZURE_SHELL` after 150 s instead of falling back to Run Command.
- Fix: `timeout -k 5 30s`, spawn detached and kill the group, resolve on `exit` with a hard deadline, ack
  only when the job starts.

### 2.8 Inbound mailbox lookup uses `ilike` with the sender-controlled address
- Severity: medium · Confidence: plausible
- `server/store.js:1354` / `src/lingon-server/store.js:1057` — `.ilike('address', addr)` where `addr`
  comes from the inbound To/Cc headers (`server/mail.js:456-463`). `%`, `_` and `*` are wildcards.
- Trigger: `To: a_ent%@mail.belna.se` lands in whichever single mailbox matches without knowing its
  address: unsolicited mail and prompt injection into other agents' inboxes, plus address probing.
- Fix: store lowercase and use `.eq`, or escape the wildcard characters.

### 2.9 Edge rate limiting trusts client-settable headers
- Severity: medium (depends on the hosting ingress) · Confidence: code confirmed
- `src/lingon-server/express-shim.js:198` — `ip = cf-connecting-ip || x-forwarded-for || 'ip'`. Every
  limiter keys on it, including the durable `*:ip:*` keys for signup, signin, otp, lookup, verify and the
  public withdrawal form. Behind Cloudflare `cf-connecting-ip` is trustworthy; anywhere else a fresh
  header per request bypasses every per-IP limit, and with neither header every client shares one bucket.
  The in-memory limiter is also per isolate on Workers.
- Fix: use only the header the platform guarantees; fall back to a random per-request key, not a constant.

### 2.10 Edge SSRF guard has no DNS pinning and allows `http:` page reads
- Severity: medium (bounded by platform egress isolation) · Confidence: plausible
- `src/lingon-server/connectors.js:15-16`, `shoppay.js:9`, `agents/public-web.js:39-74` —
  `hostResolvesPublic = async () => true`, `pinnedFetch = fetch`. Only literal hosts/IPs are checked per
  hop, so a name resolving to a private or metadata address is fetched; `privateIPv6` lacks
  `64:ff9b::/96`, `ff00::/8`, `2001:db8::/32` that `sandbox.js` blocks.
- Fix: resolve via DoH, verify every address, fetch by IP with `Host`/SNI set; align the IPv6 list.

### 2.11 Account deletion needs no re-authentication
- Severity: medium · Confidence: confirmed
- `server/apple-auth.js:57-81` — a bearer token plus the literal `DELETE` cancels Stripe, revokes Apple,
  purges data and deletes the auth user. A leaked access or refresh token suffices.
- Fix: require a fresh OTP or password proof within N minutes before purge.

### 2.12 Stripe webhook drift between Node and edge
- Severity: low-medium · Confidence: confirmed
- `server/index.js:768` keeps a paid tier active on `past_due`/`unpaid`; `src/lingon-server/index.js:80`
  stores Stripe's raw status (demotes). Node resolves the user via `findUserByStripeCustomer`, the edge
  via `metadata.user_id`; Node reads `obj.current_period_end`, the edge `items.data[0].current_period_end`
  (the Stripe v22 API moved it to items, so Node likely never updates it).
- Fix: one shared handler used by both runtimes; treat only `active|trialing|canceling` as paid.

## 3. Lower priority

- **Rate limits missing**: `/api/secrets/:id/reveal` (plaintext vault values), `/api/secrets` POST/DELETE,
  `/api/billing/redeem`, `/api/referrals/redeem`, `/api/composio/apps|toolkit|tools|triggers`,
  `/api/memories` GET, `/api/agent-permissions` (`server/index.js:603,620,1502-1526`). Referral codes are
  30-bit (`store.js:661-666`) and the endpoint is a validity oracle; loss is capped at one grant per account.
- **Durable limiter fails open** on RPC error (`server/durable-limit.js:16-18`); it is the only limiter on
  the edge for sign-in codes and passwords.
- **Per-email lockout**: `otp:email` 6/h and `signin:email` 10/15 min count unauthenticated failures, so
  anyone can block a victim's code delivery or password sign-in (`server/index.js:302,328,498,532`).
- **Account-existence oracle by design**: `/api/auth/lookup` and the 404 `new_account` sign-in reply.
  Document it and consider a proof-of-work or trusted-IP limiter.
- **No Content-Security-Policy** on any page while the session (access + refresh token) lives in
  `localStorage` (`app/auth.js:6-12`); inline `onerror` handlers and inline scripts remain. Node also
  answers `cors()` wide open. A single escaping slip becomes full session takeover.
- **Sign-out** (`app/app.js:10738-10749`) keeps `lingon.v1` and `lingon.v1.<uid>` (chats, memories, goals,
  local-only vault values) and leaves live/answer sockets open; `save()` strips only backend secret values.
- **JWT in WebSocket URL** on the Node path (`app/app.js:7909,7961`, `server/index.js:1620-1660`): ends up
  in proxy and server logs. The relay token travels the same way and `ws://` is accepted
  (`azure-vm.js:1336`). No `maxPayload`/rate limit on viewer or relay text messages.
- **Default EXECUTE on future SQL functions goes to PUBLIC**: `20261005120000` revokes default privileges
  for tables and sequences only. Add `alter default privileges … revoke execute on functions`.
- **Outbound mail**: subject and From display name (`agentName`, model-settable as `agent_name`) are not
  stripped of CR/LF, angle brackets or quotes, and the name is not in the approval card
  (`server/mail.js:323,336,359`); raw client `In-Reply-To`/`References` pass through.
- **Internal error text to clients**: `'Signup failed: ' + e.message` and friends
  (`server/index.js:322,340,352,413,481,514,545`), mail routes, `apple-devices.js:169`.
- **Local JSON fallback**: `writeFileSync` truncate-then-write with empty-store-on-parse-failure
  (`server/store.js:19-28`); unbounded arrays.
- **Encryption**: non-hex `ENCRYPTION_KEY` is a single unsalted SHA-256 (`store.js:31-36`); Shop Pay token
  seal has no AAD (`store.js:1977-1978`) and `decryptValue` accepts AAD-less blobs; `store.js` reads only
  `ENCRYPTION_KEY` while `apple-devices.js` and `oauth-security.js` also accept the `LINGON_` prefix; no key
  versioning.
- **Stripe customer reuse by email** (`server/stripe.js:64-73`): a recycled email attaches someone else's
  Stripe customer to the portal. Only reuse customers whose `metadata.user_id` matches.
- **Connectors/Composio**: `cfetch` and `webhookSecret()` have no timeout (`composio.js:60-64,99-106`);
  connector lookup prefix-matches names (`connectors.js:547`); MCP `readOnlyHint` is trusted for the
  approval class (`connectors.js:394-403`); `connector_call` GETs are never gated (`permission-policy.js:30-33`);
  `sseEvents` rescans the whole buffer per chunk (`connectors.js:198-227`); `siteOrigin` falls back to the
  `Host` header without `SITE_URL` (`composio.js:24-39`, `index.js` Google flow).
- **`shop_checkout` needs no approval** and posts the owner's name/address to any model-chosen merchant
  (`tools.js:934-945`, `shoppay.js:637-672`).
- **Tool schema selection** reads tool names out of the last six observations
  (`vm-harness.js:115-121`), so a page can load `mail_send`/`shop_purchase` schemas (approval still gates).
- **Private checkout capacity** is a global cap of 5 sessions across all users
  (`server/private-checkout/runtime.js:36,44,70`).
- **Whop webhook secret**: `whop-webhook.js:4,10` HMACs with the raw `ws_…` string; Standard-Webhooks
  tooling base64-decodes after the prefix (as `mail.js:421` does for `whsec_`). If Whop secrets are
  base64 payloads every delivery fails closed. Verify against Whop's SDK.
- **VM**: a Canvas tab left open renews the lease forever (`live.js:223-234`); `pc.getOrCreate` keys
  sessions by chat id only (`pc.js:32-40`); streamer signing keys sit in the browser uid's environment
  (`azure-vm.js:1120,1870`); `agent_vm_instances` has no FK to `profiles` and survives deletion.
- **Frontend latent sinks** (all mitigated or dead today): calculator `step` attribute unescaped
  (`app.js:5452`, coerced server-side), chart artifact `d.v`/`d.c` unescaped (`app.js:6180,8302`, no
  producer), agent name in the question header without `esc()` (`app.js:6105`, self-XSS only).
- **Minor logic**: `/api/mail` without `name` renames the mailbox to "Agent" (`index.js:1280`,
  `mail.js:196-204`); half-streamed messages persist with `typing:true` (`app.js:6460-6465`); wallet
  activity prefixes refunds with a minus (`app.js:7511`); OAuth nonce in `sessionStorage` fails when the
  IdP returns in another tab (`app.js:1735-1742`); `uid()` is `Math.random` and `sec_` refs are 4 chars.
- **Dependencies**: `source-map-js` < 1.2.2 (high, event-loop DoS; reachable only through build tooling).

## 4. What checked out

- Auth: Supabase JWT verified per request, user id never from the client; deletion fence enforced; OAuth
  state in `__Host-` signed cookies with timing-safe compares; native sign-in sealed to a PKCE-style
  verifier; `safeNext` canonicalised; email code flow with per-email durable limits and
  `secureFirstSignIn`/`freshSession`.
- Database: all 68 tables have RLS; every legacy policy and anon/authenticated grant removed; all 54
  functions service-role only with `search_path` set; money RPCs use advisory locks, `FOR UPDATE`, unique
  refs and idempotency keys; secrets at rest sealed (AES-256-GCM with per-user AAD for the vault).
- Payments: Stripe/Whop/Resend webhooks verify signatures over the raw body with time windows and
  dedupe; prices and plans come from `plans.js`, never the client; checkout-result and portal are
  ownership-checked; gift issuance is staff-only; transfers and Belna card purchases bind the approval to
  a server quote and re-verify the page; Shop Pay OAuth uses state + PKCE + nonce and allow-listed hosts.
- Agent boundary: approvals are enforced server-side and bound to the pending call; runaway guards;
  every task-store and personal-store query is user-scoped; vault values reach the VM only by one-time
  blob; Run Command scripts only ever receive base64 or hashed user data; `mail_send` needs approval and
  `confirm:true`.
- Node SSRF guard (`sandbox.js`): DNS-pinned connections, every redirect hop re-checked, private/metadata
  ranges blocked for v4 and v6, body and time caps.
- VM: per-user VM named by hash, ownership from auth on every ARM call, firewall blocks private/IMDS/IPv6,
  worker has no network, desktop in a rootless container with all capabilities dropped, erasure verifies
  tags and prefixes.
- Frontend: `esc()` applied consistently across about 1,500 interpolations; markdown renderer escapes
  first and allows only http(s) links; iframes use `srcdoc` with `sandbox="allow-scripts"` only; no
  `postMessage` listeners; OAuth hash callback bound to the flow nonce.
- Test coverage gaps worth closing: store-level user scoping, edge store fallbacks, edge `req.ip`,
  outbound mail header sanitisation, non-EN/SV checkout guard, amount-vs-page verification, unsigned
  Realtime `control`/`input`, lease/sweeper interplay (`vm-start.cjs` mocks the lease as always acquired).

## 5. Status after the fix pass (2026-10-08)

Fixed without changing how features work. `npm test`, the focused suites and `npm run build` pass.

| Finding | Fix | Test |
|---|---|---|
| 1.1 deletion blocked | Migration `20261008120000`: purchases cascade with the wallet, a paid request's link is cleared, the VM row is purged. Stuck accounts succeed on retry. | `tests/account-deletion-sql.cjs` |
| 1.2 edge permissions fail open | Edge store throws like the Node store. | `tests/store-fail-closed.cjs` |
| 1.3 keyword purchase guard | Other European languages and checkout URLs get the English rules, plus send/delete words. | `tests/purchase-guard-languages.cjs` |
| 1.4 live id to the model | `liveId`/`transport` removed from model observations; cards keep them. | `npm test` |
| 2.2 chat web setting | Chat searches go through the permission check; "always ask" hands off to a task. | `npm test` |
| 2.3 card total | Refused only when the page shows a currency total and none matches. | `tests/purchase-guard-languages.cjs` |
| 2.4 silent fallbacks | Mail, mailbox, draft and Shop Pay writes report failure; a post-send update never fails a sent mail. | `tests/store-fail-closed.cjs` |
| 2.5 sweeper secret | Migration `20261008121000` accepts either spelling. | needs `db push` |
| 2.6 unleased start | Recorded with the normal idle grace. | `npm test` |
| 2.7 shell agent wedge | `timeout -k`, container cleanup, process-group kill, hard deadline; build `jobs-2`. | `tests/vm-shell-agent.cjs` |
| 2.8 mailbox wildcard | Exact lowercase match. | `tests/store-fail-closed.cjs` |
| 2.10 edge ranges | IPv4/IPv6 lists aligned with Node. | manual check |
| 2.12 Stripe drift | Node stores Stripe's status and the item period end. | `npm test` |
| Lower priority | Rate limits on secrets and redeem; generic auth errors; mail header sanitising; mailbox not renamed to "Agent"; `LINGON_ENCRYPTION_KEY`; atomic local file; Composio timeouts; ambiguous connector names; SSE scan; WS `maxPayload`; frontend escaping, URL-encoded socket ids, sign-out closes live connections, half-typed replies not saved. | `npm test` |

Left unchanged because the fix would change product behaviour (decision needed):
approval for web reads after private reads (2.1), approval for `system_file_update`,
untrusted-observation delivery of automation payloads (already labelled untrusted),
re-authentication for deletion (2.11), signed or private Realtime channels, rate-limit IP source
on non-Cloudflare hosts (2.9), DNS pinning on the edge, durable limiter fail-open, per-email
lockout, the account lookup oracle, CSP, clearing local data on sign-out, JWT in the Node
WebSocket URL, `shop_checkout` approval, MCP `readOnlyHint`, GET connector calls, Stripe
customer reuse by email (Checkout customers carry no user tag), Shop Pay seal AAD, key
versioning, the global checkout capacity, the Whop secret encoding (needs Whop's SDK), the
lease renewal while a viewer is open, and default EXECUTE on future functions (a global
revoke could break extensions; every current function already revokes it).

## 6. Follow-up pass (2026-10-09)

Scope: code written or changed after section 5. That covers the Privy wallet (server, store,
routes, migrations, browser entry), streamed cards and replies, the VM speedups, mail
addresses that follow the agent's name, and Node/edge drift. Each finding below was checked
against tests, comments and docs, so behaviour a test asserts as intended was left alone.

| Finding | Fix | Test |
|---|---|---|
| Stored XSS: a learn `plot` card's function labels became the card subtitle unescaped (model- or injection-controlled) | `learnMath()` like the legend | manual check |
| Edge `composio.executeTool` took the toolkit from the passed connection, so a disabled tool ran with another app's connection | Node's tool-record check ported to the edge | `tests/composio-security.cjs` (Node + edge) |
| The task's answer channel id reached the chat model through `task_details` (same class as 1.4) | Left out of `details()`; the owner's client still gets it | `npm test` |
| A shell job or browser step the server gave up on could still run on the VM, and then again as a Run Command: the cancel marker was deleted | Marker kept (erasure clears the prefix); reading it back counts as "not taken"; a failed or timed-out send is settled by the same claim | `npm test` |
| The fast shell path failed the step on a storage error before sending, and had no timeouts | Falls back to Run Command; 8 s timeouts | `npm test` |
| The no-lease start path could create a VM: unrestored, unrecorded, no token or auto-provision check | It only starts an existing VM; creation stays with the lease | `npm test` |
| Privy wallet session (able to sign) outlived Belna sign-out and account switches in the same browser | SDK logout on owner change; sign-out also clears `privy:` keys | manual check |
| The wallet signed a request checked only against the server's own `/prepare` reply | Must also equal the request the owner reviewed (amount, address, bank, vault, kind) | `tests/privy-wallet-review.cjs` |
| Base RPC errors returned raw viem text (RPC URL with any provider key, request body) | Curated message | `npm test` |
| A subscription cancelled while `past_due` was stored as `canceling` (paid until period end) | `canceling` only from `active`/`trialing` (Node + edge) | `npm test` |
| A message sent while the boot sync ran could go to another chat (the sync switched `activeChat`), and waited forever on a stalled sync | The chat on screen stays during that window; the send targets the chat it was typed in; 8 s bound | manual check |
| Markdown: bold/italic and emoji were applied inside link addresses (a broken `<a>` that opened in the app's tab); `(…)` cut links | Only text outside tags is marked; one level of parentheses allowed | `tests/streaming-cards.cjs` |
| The opening shown above a looked-up answer skipped the internal-details check and was saved | The same check as every reply; a failing opening is taken back | `npm test` |
| Wikipedia photo misses were never cached, so a streaming card re-searched on every delta | Misses remembered 5 minutes | `npm test` |
| "learn" and "riverbank" loaded wallet tools (`earn`, `bank` substrings) | Word boundaries (Node + edge) | manual check |
| With every form of a name taken, the mailbox got a new random address on each read | The fallback already held stays | `tests/agent-mail.cjs` |
| Bank verification status from the provider rendered unescaped; answer streams stayed open after an account change; Node Stripe webhook echoed library error text | Escaped; streams synced on auth change; generic message | manual check |

Left unchanged, as they need a product or infrastructure decision:
- **Mail addresses after deletion:** an address that received mail is reserved through its
  messages, which are deleted with the account. Another owner can then claim it and receive
  that agent's password resets. A content-free tombstone (for example a hash) needs a migration.
- **Missing mail index:** `agent_mail_messages(mailbox_address, created_at)` has no index for
  the past-owner lookup.
- **Stale names move the address:** the address follows the saved name (asserted by
  `tests/agent-mail.cjs`), and every chat merges the client's agent name into that saved name.
  So a device holding an old name, or a `system_file_update`, also moves the address.
- **Prewarm billing:** a prewarmed VM no task uses is not metered, and the broader
  `VM_INTENT` words ("desktop", "node", "execute") prewarm more often.
- **Re-run trigger:** a command whose own stderr contains "Worker container … is not ready"
  is re-run; this needs a per-script sentinel.
- **Restore flag in memory:** the "restore owed" flag is per process; the on-disk marker
  covers the normal stop/start case.
- **Apple approval card:** the chat card names a delete/complete target by the model's
  `title`. The device's own review shows the real item.
- **"Help me choose" picks:** these return as plain owner messages.
- **Favicons on source chips:** loaded from result hosts (class of 2.1).
- **Send-to-email lookup:** Send to a Belna email shows that owner's public Base address,
  which is inherent to the feature.
- **Dependencies:** `npm audit --omit=dev` reports 23 moderate, all `uuid` < 11.1.1 and
  `decode-uri-component` ≤ 0.4.2 inside the Privy SDK's wallet connectors in the browser
  bundle. Neither is reachable in a meaningful way, and forcing versions could break the SDK.
