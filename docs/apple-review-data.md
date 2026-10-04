# Belna App Store review preparation

Prepared from the shipped native app and web-backed service on 4 October 2026.
This is a reviewable draft, not submitted App Privacy answers. The web view's
account, agent, uploads and wallet features must be covered alongside Apple apps.
Use [Apple's data definitions](https://developer.apple.com/app-store/app-privacy-details/)
when entering the final answers. Optional connections still need disclosure
when their results are retained in the owner's chat, tasks or Library.

## App Privacy draft

The account stores content under its user ID, so treat the retained data below
as linked to the user. App Functionality is the primary purpose. Confirm any
additional provider use before submitting; server processing and provider
contracts both matter. The native manifest currently covers Apple scopes,
email/phone, user ID and other content; reconcile the whole-app categories below
with that manifest and the final App Store answers before the release build.

| Data category to review | Actual feature / evidence | Proposed disclosure |
| --- | --- | --- |
| Name, Email Address, Phone Number | Account/profile, saved shipping recipient, selected contact results | Linked; App Functionality |
| Physical Address | Saved shipping addresses for physical merchant purchases | Linked; App Functionality |
| Health, Fitness | Explicitly shared sleep/steps/distance/exercise summaries | Linked; App Functionality; no advertising or tracking |
| Contacts | Requested matching contacts; connecting alone does not export them | Linked; App Functionality |
| Other User Content | Chats, tasks, Calendar/Reminders results, memories, documents, Library and workspace files | Linked; App Functionality; review Product Personalization for saved preferences/memory |
| Photos or Videos | Image/file uploads saved to Library and used for agent requests | Linked; App Functionality |
| Audio Data | Voice transcription sent to Microsoft Azure; verify provider retention | App Functionality; confirm linkage/retention with the provider |
| Emails or Text Messages | Optional connected email actions and task results | Linked; App Functionality |
| User ID, Device ID | Account ID; randomly generated device registration retained for command routing | Linked; App Functionality |
| Purchase History | Subscription/token records and merchant purchase records | Linked; App Functionality |
| Payment Info, Other Financial Info | Wallet/payment method metadata, balances and transactions; audit provider-hosted verification and secure checkout separately | Confirm full scope; App Functionality |
| Search History, Browsing History | Agent search/browser tasks, stored results and private browser workspace | Review retained records and Apple's open-web exception; App Functionality |
| Product Interaction / Other Usage Data | Model usage, token accounting and task activity | Linked where stored against the account; App Functionality |
| Other Diagnostic Data | IP/browser information and security/error logs described in the privacy policy | Confirm provider logging, linkage and retention; App Functionality |

No advertising/tracking SDK was found in the app code. The native manifest sets
tracking false. Confirm hosting, AI, OAuth, payments and other provider practices
before answering “not used for tracking” for the whole service. Do not infer
that no data is collected merely because a payment or verification form is
hosted by a provider. Apple's payment exception requires both external entry
and no developer access to that payment information.

The arbitrary text/voice feature does not by itself mean every sensitive data
category is deliberately collected. Declare the specific data asked for by
dedicated features, plus Other User Content and Audio Data as appropriate.

## Review information still needed

- A dedicated reviewer account with a working password and no private owner data.
  Email-code-only access is inconvenient for a reviewer; validate the supplied
  login independently before submitting. Store review credentials privately.
- Owner contact first/last name, email and phone, supplied for Apple's reviewer.
- Accurate age-rating answers for AI-generated content and agent web access.
  Do not choose a rating before reviewing the current Apple questionnaire.
- EU trader status and any required verified business details. The developer
  account is individual; that alone does not settle trader status.
- Actual screenshots from the app on required iPhone/iPad and Mac display sizes.
  Browser screenshots and simulator consent fixture screens are test evidence,
  not a substitute for screenshots of the working signed app.
- Real-device validation of Apple sign-in, permission revocation, iCloud sync,
  Health summaries, downloads, attachments, voice, cancellation and uncertain
  writes. Test account deletion with a disposable account, including its VM,
  disk, archives, Library revisions, Apple authorization and auth identity.

## Current saved drafts

App Store Connect: Belna, bundle `se.belna.app`, team `6XD78664VT`, iOS and macOS
version 1.0.0, manual release. iOS build 14.1 is processed and selected in the
release draft. Support is `https://belna.se/support`; privacy is
`https://belna.se/privacy`. TestFlight instructions are saved. No tester
invitations, App Review submission or storefront release have been sent.

Mac uses its own synced Calendar, Reminders and Contacts. The app does not
remotely read an iPhone store. Health is available only when HealthKit reports
support. Requests need Belna in the foreground. Notes, Mail and Messages have
no general native connector. These limits are reflected in the saved drafts.
