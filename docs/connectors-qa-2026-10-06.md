# Connector verification — 6 October 2026

Status: three source fixes verified. Web/server publication and current physical
TestFlight data checks remain pending. No native binary was changed or uploaded.

## Fixes

- Public API requests omitted `User-Agent`. A real GitHub request returned 403
  without it and 200 with `Belna/1.0`. All custom connector transports now supply
  an application identifier unless a caller supplied one. GitHub documents this
  requirement in its [REST API guide](https://docs.github.com/en/rest/using-the-rest-api/getting-started-with-the-rest-api#user-agent).
- Returning from provider sign-in in Safari could leave a waiting agent stuck
  when WKWebView's polling timer was suspended or had expired. Connections now
  refresh on browser visibility/focus and the existing native
  `belna-apple-changed` scene-activation event. Waiting tasks resume once. The
  pending sign-in is scoped to the account that started it.
- The chat coordinator sometimes refused native Apple requests despite an
  online connected device, because only task workers have `apple_execute`.
  Explicit Apple app action requests now reach the worker directly, preserving
  the full request and its constraints. Device discovery and the existing
  server/device approval gates still apply.

Source changes are in `app/app.js`, `server/connectors.js`, and
`server/agents/conversation.js`; their generated public/edge copies were synced.

## Evidence

- Full `npm test` passed, including authentication, security boundaries,
  connector permissions, owner isolation and agent task execution.
- `npm run test:apple` passed. Native web UI was also rerun after the changes.
- `npm run test:connectors` passed, including Safari return after polling expiry,
  the native scene-activation event and prevention of duplicate task approvals.
- `node tests/connectors-ui.cjs` passed with the local static test server.
- `node tests/chat-agent.cjs` passed for both Node and generated edge runtimes,
  including regression cases for all four Apple apps and Swedish requests.
- Production client/SSR/Cloudflare build passed. No macOS/iOS native compilation
  was performed on this Windows host.
- A live authenticated production check reproduced the API header failure and
  confirmed Calendar, Reminders and Contacts agent/broker delivery with explicit
  native bridge fixtures. All disposable accounts were deleted.
- The corrected app running locally used the real production Supabase database,
  Azure Foundry model, Composio hosted sign-in service, public GitHub REST API and
  [DeepWiki MCP server](https://mcp.deepwiki.com/). The real agent discovered and
  called the REST and MCP connectors and returned their actual responses.
- Calendar, Reminders, Contacts and Health passed the real
  model → authenticated command broker → phone browser bridge → result retrieval
  path. Random fixture values were returned to the agent; commands executed
  once and encrypted result content was erased on retrieval. Health's agent
  approval was required and granted only for the disposable fixture.
- The 393×852 native web UI displayed the four Apple connections and both real
  custom connectors without horizontal overflow or JavaScript errors.

Local evidence is in `artifacts/connectors-verification/summary.json`, with the
raw `routing-fixed/production.json` and `health-final/production.json` reports.
The summary combines successful checks from these two runs. The first run's
Health check failed because its assertion did not accept the correctly formatted
`7,319`; the corrected focused run passed approval, execution, value delivery
and result erasure. Test data and account identifiers remain in ignored local
artifacts, not in committed documentation.

## Limits and remaining checks

The Apple OS layer was a named fixture. This proves the real agent and transport
can use the connectors, but does not prove EventKit, Contacts or HealthKit access
on the owner's physical TestFlight installation. An owner-confirmed basic device
check from 4 October is recorded separately in `apple-qa-2026-10-04.md`; the owner
has not supplied a new physical data result during this verification.

Composio offered 36 apps and returned a real hosted Gmail sign-in link. Provider
consent was not completed, so real authenticated Gmail/other OAuth account data
has not been verified here. No private account credentials were invented or used.

Publish the web/server fixes before claiming they are active in TestFlight.
Then verify actual data on the device while Belna remains open; test permission
denial/revocation, background/foreground return, disconnect/reconnect and approved
disposable writes. Health requires its real native sharing preview. Never retry
an uncertain write automatically.

## Reproduction

Run local regressions with `npm run test:connectors`, `npm run test:apple` and
`node tests/chat-agent.cjs`.

The opt-in live test requires the configured server credentials and
`LIVE_CONNECTOR_TEST=1`, then `npm run test:connectors-live`. `VERIFY_BASE` selects
the app backend, `VERIFY_OUT` selects the ignored evidence directory, and
`VERIFY_FILTER=health.summary` runs the focused Health transport case.
The test creates and deletes disposable accounts, calls public external services,
uses real model tokens and labels its Apple fixtures explicitly. Local backend
verification disabled automation, chat-worker and VM idle-watcher loops to avoid
processing unrelated accounts. No VM was provisioned for these connector tests.
