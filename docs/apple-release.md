# Apple release checklist — 4 October 2026

## Recorded validation

- Apple account setup verified on 4 October 2026: team `6XD78664VT`, registered
  bundle ID `se.belna.app`, HealthKit and primary Sign in with Apple enabled.
- [Belna App Store Connect record](https://appstoreconnect.apple.com/apps/6819012393/distribution):
  iOS and macOS created; iOS listing draft saved as version 1.0.0 with manual
  release selected. No build has been uploaded or submitted for review.
- Production database migration installed and verified: Apple tables have RLS,
  direct anonymous/account access is revoked, and only the server role can call
  cleanup/deletion functions. Hourly `belna-apple-command-expiry` is active.
  The security advisor's informational “RLS without policies” finding is
  intentional for these server-only tables; permissions were verified directly.
- Encrypted Apple identity-token migration installed and verified on production:
  RLS enabled, anonymous/account access denied, server-role access allowed.
- [Latest native validation and signed export](https://github.com/vinceackermann2-sys/friendy-agent-hub/actions/runs/37210011891)
  passed iPhone/iPad and Mac Catalyst builds, origin/date/backup unit tests and
  native consent/Apple connection UI tests, then exported a signed App Store IPA
  at commit `dd43031`, including the account-deletion token-revocation changes.
  No TestFlight upload was requested in that run.

- Apple Distribution certificate and App Store iOS profile created for the
  registered app and stored as encrypted GitHub signing secrets. Certificate and
  profile expire on 4 October 2027. Replacement Developer upload key `694D2U83DF`
  was downloaded and validated; all three encrypted GitHub upload secrets are
  installed. Unusable keys `BVC3YQ7WL9` and `8WM389NL8D` are revoked.
  [First TestFlight upload run](https://github.com/vinceackermann2-sys/friendy-agent-hub/actions/runs/37212845388)
  passed native tests/signing/export; Apple rejected upload with 90683 for the
  missing `NSHealthUpdateUsageDescription`. An accurate read-only Health purpose
  string is now included. The corrected build must pass upload and processing.
- Sign in with Apple key `TWD2XB32GU` registered for Belna only, downloaded,
  validated and saved in a protected local credential directory outside Git.
  Its private key and three identifiers are installed in Lovable's encrypted
  server secrets. Lovable requires publishing before these apply on the live app.
- Supabase's native Apple provider enabled for `se.belna.app` and verified in
  the saved provider settings on 4 October 2026. Production
  `https://belna.se/api/apple/devices` still returns 404. The app changes are on
  draft PR #12 and have not reached the production site.

- `npm run build`: web client, SSR and Cloudflare server build passed.
- `node tests/apple-devices.cjs`: real PostgreSQL migration, service-only access,
  encrypted arguments/results, account isolation, single leasing, no command
  replay, expiry, cancelled task gate and result content erasure passed.
- `node tests/apple-auth.cjs`: current terms, provider-verified Apple identity and
  nonce, scoped account deletion, subscription cancellation and partial failure
  reporting passed.
- `node tests/apple-identity.cjs`: ES256 code-exchange credentials, account-scoped
  encrypted refresh tokens, Apple revocation, recovery after failure and
  service-only database permissions passed. Live Apple code exchange requires
  the production Sign in with Apple key and provider configuration.
- `node tests/apple-native-ui.cjs`: 393×852 phone UI, native connections, JWT
  transport, capability-only registration, result delivery retry and sign-out
  locking passed with fixtures. This is not real HealthKit/device data evidence.
- Existing agent permission and security boundary tests passed.
- Account erasure tests passed for scoped VM/disk/blob/Library removal, detached
  disk retries, retention failure and PostgreSQL guards against late workspace
  leases, tasks, Library writes and profile recreation. The migration is applied
  on production: four guards installed, RLS enabled, account access denied.
  Existing VM start, idle shutdown and capacity fallback tests also passed.
- [First macOS build run](https://github.com/vinceackermann2-sys/friendy-agent-hub/actions/runs/37200884775):
  iPhone/iPad and Mac Catalyst builds and unit tests passed with code signing
  disabled. Later workflow runs add native UI tests and downloadable evidence.

## Must pass before TestFlight / App Review

- Verify the TestFlight upload workflow finishes and Apple processes the build.
  The production origin is `https://belna.se`; verify the deployed API rollout.
- Test Supabase's configured native Apple provider with
  first sign-in, returning sign-in, private relay email, revoked Apple identity,
  email code/password fallback and account deletion on a disposable account.
- Publish the installed server-side Sign in with Apple signing key. The encrypted
  identity-token migration is applied. Confirm actual Apple token revocation
  on account deletion; the App Store Connect upload key cannot do this.
- Roll out both backend runtimes and the frontend. Verify the
  production Apple endpoints return 401 without an account, never 404/500.
- Verify deployed server encryption is active (local configuration is present).
- Verify actual account deletion on a disposable production account: dedicated
  VM, OS disk, private archive/screenshots, all Library revisions and auth data.
  Cloud resources are recorded before deletion so partial failures can retry.
  Provider-retained archives leave deletion pending; retention settings are not
  disabled. Verify external service retention against the privacy policy.
- Build a signed Release archive with the owner’s team and a unique incremented
  build number; validate export compliance and App Store Connect's checks.
- Test on real iPhone and Mac: permission allowed/denied/revoked, selected
  contacts, iCloud sync, foreground/background, device switching, cancellation
  while an approval sheet is open, disconnect/reconnect and network loss after
  an approved change. Never retry an uncertain write automatically.
- Test Calendar dates/time zones/DST; Reminder due times and completion; contact
  changes; Health denied/empty/partially granted scopes and overlapping sleep
  sources. Verify Health content never appears in analytics, long-term agent
  memory without an explicit save request, or an iCloud backup created by Belna.
- Test chat/streaming, agent approvals, canvas, generated files/download sharing,
  audio transcription, photo/file attachment, OAuth app connections and physical
  merchant checkout across iPhone sizes, iPad multitasking and Mac Catalyst.
- Test VoiceOver, text scaling, contrast, keyboard navigation and low connectivity.
- Supply real screenshots from the signed app, support URL/contact, privacy URL,
  reviewer account and instructions, age rating, EU trader information and
  complete App Privacy answers covering the whole web-backed app (messages,
  files, voice, photos, profiles, purchases and optional Apple data).
- Upload to TestFlight, install that exact build, then submit it for App Review.
  Approval and storefront release are separate steps.

## Draft listing

Name: Belna

Subtitle: Your personal AI agent

Description: Work with your Belna agent on iPhone, iPad and Mac. Chat, research,
create files and manage tasks with your existing account. Optionally connect
Calendar, Reminders and Contacts on your device, and review read-only Health
wellness summaries before sharing them with your agent. You control access and
approve changes. Keep Belna open for Apple app requests. The app works with the
free plan and existing account plans; digital upgrades are not sold in this app.

Support: `https://belna.se/support`, `support@belna.se`. The support route is
included in this PR and needs deployment before setting App Store Connect's
Support URL. Privacy: `https://belna.se/privacy`.

Draft reviewer notes: Sign in using the supplied reviewer account or email code.
Apple apps is the Apple logo button at the top right and is also available in
Connectors. Connecting is optional; no user data is uploaded on connection.
Calendar/Reminders/Contacts changes ask in the agent and on the device. Every
Health summary is previewed and explicitly shared for fitness/wellness only.
Notes, Mail and Messages are not general integrations. Mac reads its own synced
stores and offers Health only if HealthKit reports support. Account deletion is
in Apple apps → Account. This companion app offers no digital purchase flow.

## Apple references

- [EventKit access](https://developer.apple.com/documentation/eventkit/accessing-the-event-store)
- [HealthKit authorization](https://developer.apple.com/documentation/healthkit/authorizing-access-to-health-data)
- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Current SDK submission requirement](https://developer.apple.com/news/upcoming-requirements/?id=04282026a)
