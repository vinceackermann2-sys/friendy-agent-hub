# Belna for iPhone, iPad and Mac

The SwiftUI app loads the existing Belna app at `https://belna.se/app` in an
origin-restricted WKWebView. Chat, tasks, files, canvas, connected apps and
settings share the web account. The native Apple apps screen adds device
permissions, on-device review, Apple sign-in and file sharing. Requires iOS 17+
or Mac Catalyst on a compatible Mac. Build with Xcode 26 / iOS 26 SDK or later.

## Apple connections

| Connection | Agent actions | Boundaries |
| --- | --- | --- |
| Calendar | Read a date range; create, update, delete events | At most 31 days per read; paginated; recurring changes stay in Calendar |
| Reminders | Read, create, update, complete, delete | Paginated; recurring changes stay in Reminders |
| Contacts | Search a specific name; create, update, delete | Respects limited contact access; no address book export |
| Health | Steps, distance, exercise and merged sleep summary | Read-only, 1–7 days, wellness purpose; preview and consent for each result |

Mac uses its own synced Calendar, Reminders and Contacts store. It does not
reach directly into an iPhone. Health is only offered when
`HKHealthStore.isHealthDataAvailable()` returns true. Apple Notes, Mail and
Messages have no general connection in this release. The web agent can access
an online connected Apple device; the native app must remain open. Background
access, push notifications and unattended phone automations are not claimed.

`apple_devices` discovers current permissions. `apple_execute` submits one
durable command; `apple_result` retrieves its actual result. The server verifies
account ownership and encrypts private command content with AES-GCM and account
AAD. One device leases each command; running writes never replay after a crash.
The native layer checks the exact production origin, main frame, account,
permission, foreground state, expiry and whether the agent task is still active
before acting. Results erase transient content after retrieval. Chats/tasks can
retain the data the owner explicitly chose to share.

## Open and build on Mac

```sh
brew install xcodegen
cd native/apple
xcodegen generate
open Belna.xcodeproj
```

Select the Belna scheme and an iPhone simulator, attached iPhone, iPad or
“My Mac (Mac Catalyst)”. `Developer.xcconfig` and build outputs are ignored by
Git. The registered bundle ID is `se.belna.app` and the team is `6XD78664VT`.
Use an optional `Developer.xcconfig` override for another team or test app.
Never commit Apple signing keys. Local WebKit/chat storage is excluded from
device backups before the agent loads.

```sh
bash scripts/archive.sh
```

The archive script checks the SDK and signing configuration, then creates an
iOS archive using automatic signing. Use Xcode Organizer to validate and upload
to TestFlight. For Mac, archive with the Mac Catalyst destination and the
separate sandbox entitlements. There is no arbitrary HTTP/ATS exception.

The GitHub `Apple app build` workflow also supports a manually requested signed
iOS archive, a signed Mac Catalyst package and optional uploads. It runs the unsigned builds and
tests first. Configure these encrypted repository secrets only after the owner
approves the signing credential setup:

- `APPLE_DISTRIBUTION_P12_BASE64`, `APPLE_DISTRIBUTION_PASSWORD`
- `APPLE_IOS_PROFILE_BASE64` (App Store profile for `se.belna.app`)
- For Mac: `APPLE_MAC_PROFILE_BASE64`, `APPLE_MAC_INSTALLER_P12_BASE64`,
  `APPLE_MAC_INSTALLER_PASSWORD` (Mac Catalyst App Store profile and a separate
  Mac Installer Distribution certificate)
- For upload: `APPLE_ASC_KEY_ID`, `APPLE_ASC_ISSUER_ID`,
  `APPLE_ASC_PRIVATE_KEY_BASE64` (App Store Connect upload key)

The workflow creates a temporary keychain, validates the profile’s team,
bundle ID, expiry and required capabilities, then exports an IPA or Mac PKG. Mac
also verifies the archived sandbox/sign-in entitlements and package signature.
Upload is
disabled by default. Signing keys are removed from the runner on exit and are
never included in build artifacts. The signing path requires real credentials
and has passed an iOS signed archive/export and TestFlight upload on GitHub.
Mac signing setup and the signed Mac run remain pending; see the release evidence.

## Backend rollout

1. Deploy the server, edge mirror, web frontend and privacy changes together.
2. Apply `supabase/migrations/20261004110000_apple_devices.sql` and
   `supabase/migrations/20261004141615_apple_identity_tokens.sql`, then
   `supabase/migrations/20261004190000_account_deletion_fence.sql` before rolling
   out the account cleanup guards.
3. Configure server `ENCRYPTION_KEY` and the Supabase service key. The app only
   uses the existing verified account JWT; no service key is bundled.
4. Enable an hourly database job that invokes
   `public.purge_expired_apple_commands()`. Expired content is inaccessible
   immediately; this job removes ciphertext/metadata that no later request has
   cleared. No health content is sent to analytics or advertising.
5. In Supabase Auth enable the Apple provider and register the real iOS/Mac
   bundle identifier `se.belna.app` as an allowed client ID. Configure server-only
   `APPLE_TEAM_ID=6XD78664VT`, `APPLE_CLIENT_ID=se.belna.app`,
   `APPLE_SIGN_IN_KEY_ID` and `APPLE_SIGN_IN_PRIVATE_KEY` using a separate Apple
   Sign in with Apple key, never the App Store Connect upload key. `LINGON_`
   aliases are accepted by the edge runtime. The server exchanges the native
   authorization code; Supabase verifies the returned identity token and
   SHA-256 nonce challenge. Only an encrypted refresh token scoped to that
   verified account is retained, to revoke Apple's authorization on deletion.
6. On the Apple App ID enable Sign in with Apple and HealthKit for iOS. The Mac
   target has the Contacts/Calendar sandbox permissions and microphone/camera
   entitlements, and checks Health availability at runtime.

## Release status and review gates

Unsigned iPhone/iPad and Mac Catalyst builds and origin/date unit tests have
passed on GitHub’s macOS runner. Local tests cover database access, encryption,
concurrent command claims, expiry, task cancellation, auth, deletion, phone UI
and completion retry without executing a native action twice. See
`docs/apple-release.md` for the evidence and outstanding release gates.

The [latest signed iOS upload](https://github.com/vinceackermann2-sys/friendy-agent-hub/actions/runs/37213788005)
passed at commit `2f31682`, including account workspace cleanup and Apple token
revocation. Apple processed version 1.0.0 (14.1). The production API and support
page are published. App Store submission and testing real permissions, iCloud sync
and Health data on the owner's devices must pass before a release.

The first App Store build is a free companion that consumes existing account
plans. It has no digital subscription/token purchase funnel or external
purchase links. Physical merchant checkout remains part of the agent. If in-app
digital upgrades are desired, add StoreKit products, server-verified receipts,
restore and subscription lifecycle handling before enabling them. This choice
must be reflected in the App Store description and reviewer notes.

Account deletion cancels Stripe subscriptions, stops tasks/watchers, disconnects
OAuth apps, removes the account VM, its OS disk and private archive/screenshots,
erases Library files, revokes Apple sign-in tokens, removes database profile
data and deletes the auth identity. A server-only deletion record blocks new
workspace operations and keeps disk IDs for retries after partial failures.
Provider-retained archives leave deletion pending. Apple users from an older
build must sign in with Apple again if no revocable token was stored. Validate
the whole flow on a disposable production account and confirm external provider
retention before release; fixture tests do not establish live data erasure.
