# App Review follow-up - 6 October 2026

## Apple's Finding

Submission `fb862201-84cf-495c-aa00-846d0ea0fe83`, version 1.0.0 (46.1), was
rejected under 2.1.0 App Completeness. Apple's message at 05:14 Stockholm time
requests information for a developer with limited review history. It does not
identify a reproduced crash. A new binary alone does not resolve the request.

Apple requests six items in a reply and App Review Notes: physical recording,
purpose/audience, access, providers, regional behavior and any regulated-service
or protected-material authorizations.

## Recording Checklist

The owner agreed to supply a genuine physical-device recording. Do not use a
simulator, generated video or marketing composite as this evidence. Wait for the
new TestFlight build 49.1; do not record an older version.

1. Update the iPhone/iPad to the latest available public OS. Record device model,
   OS version, TestFlight build and test date separately. Test both supported
   platforms where available; an iPhone video does not prove physical iPad QA.
   Do not show serial numbers or Apple ID details.
2. Use a disposable account and harmless sample data. Enable Do Not Disturb.
   Start screen recording on the Home Screen, then launch Belna visibly.
3. Show registration, Terms/AI consent and successful sign-in. Capture the
   email-code flow without exposing a personal inbox or persistent password.
4. Send "Plan a three-day study schedule". Wait for the real reply. Then ask
   "Create a text file with the plan" and open the artifact/Library item.
   Attach a harmless text file and try a short voice transcription.
5. Open Apple apps. Demonstrate optional Calendar/Reminders/Contacts connection
   and a dummy-data request. For a write, show agent approval and on-device
   confirmation. On supported devices, show Health's sharing preview or explain
   that there are no Health records. Do not expose personal contacts/health data.
6. Show Settings > Report an issue and Help & support. Private chats/files are
   not a public feed or interaction with other Belna users.
7. Show Billing/Usage and actual plan access. For paid features, use an existing
   authorized paid test account and disclose the plan. Do not make a real
   purchase for the video. In the US storefront, show Safari link-out/return
   without paying; elsewhere show the absence of purchase links. Do not
   fabricate wallet funding, identity verification or provider approval.
8. Last, delete the disposable account via Apple apps > Account > Delete my
   Belna account. Confirm and show the signed-out state. Never delete Apple's
   persistent demo account or the owner's account for this recording.
9. Attach the original MP4/MOV here with device/OS/build details and physical
   iPhone/iPad test results. Also capture actual in-use screenshots showing a
   real reply/task/artifact. These can replace AI-rendered listing composites.

Preserve a continuous original. Review any private data before uploading to
Apple. The owner controls registration and irreversible deletion on the device.

## Reviewer Information

The six-part draft is [app-review-notes.txt](app-review-notes.txt). It contains no
credentials. The demo credentials stay in Apple's Sign-In Information fields
and the protected local store. Physical recording details must replace the
pending paragraph before a final reply/resubmission. Simulator QA and the
owner's earlier build 14.1 tests are not physical QA of the new build.

The privacy policy previously omitted Whop and requested search/hosting
providers; it now identifies these recipients and optional wallet data.

New native builds after `543f343` detect StoreKit storefront. Browser digital
checkout links are enabled only for `USA`; unknown/other storefronts fail
closed. Build 46.1 lacks the native method and hides the links everywhere.
Do not claim identical purchasing behavior across regions or no external
checkout in the new build.

The owner reports Whop KYB/KYC completion and required user KYC, but no separate
Belna approval letter or contract document. Whop's published developer terms
and provider terms are references, not proof of a separate regulatory license.
Do not invent authorization. Apple decides whether further evidence is needed.
The owner explicitly chose to keep Wallet in the initial iOS release rather than
remove transfers/cards. Do not hide those features for review or claim that KYC
alone proves licensing or Belna-specific provider authorization.

## Verification and Delivery

- `npm test`, `npm run test:apple` and `npm run build` passed on 6 October.
- Production reviewer password login returned 200 and the expected isolated user;
  authenticated billing access returned 200. Credentials were not logged.
- Signed iOS build 49.1 uses native source `543f343316772ba412ed9a7b7bad063d4a64960c`.
  [GitHub run 37429260802](https://github.com/vinceackermann2-sys/friendy-agent-hub/actions/runs/37429260802)
  passed iPhone/iPad and Mac Catalyst compilation and native bridge tests.
  Xcode 26.6 uploaded the iOS archive successfully at 07:35 UTC.
- The final 3969-character six-part response was sent to Apple on 6 October
  at 10:33 AM (Stockholm time) with the supplied recording. The submission page
  confirms Messages (2), the sent response and its video attachment, with no
  pending reply draft. Matching Review Notes were saved and verified through
  the API. Device/build and registration testing are attributed to the owner.
- Supabase's migration list and dry-run are aligned; no migration remains pending.
  The two security migrations already on `main` are applied remotely.
- All three edge functions are ACTIVE: `vm-lease-sweeper` v12,
  `wallet-card-recovery` v29 and `whop-wallet-webhook` v9. Wallet recovery's
  read-only health record was successful at 07:35 UTC. Their entrypoints and
  imported wallet modules have not changed in this release, so redeployment is
  unnecessary.
- No open GitHub pull requests remain. No published history was rewritten.

- Apple processed build 49.1 as VALID, ID
  `d6086f20-3a50-43d0-94d5-f1f002300b51`. It is assigned to the existing Belna
  Device QA group; the API confirms `IN_BETA_TESTING` for internal testers.
- Build 49.1 is saved on App Store version 1.0.0 with release type `MANUAL`.
  Saving the replacement build initially changed the editable version to
  `PREPARE_FOR_SUBMISSION` while the earlier submission remained unresolved.
  After the final update and resubmission, the version and submission both
  report `WAITING_FOR_REVIEW`. Manual release remains selected.
- Signed IPA SHA-256:
  `05680d2cf8eaadee25c7958d586ec51dafd71acff50535e08a003b4da46dead8`.
- GitHub commit `813b007` contains the reviewer packet, privacy correction and
  the owner's existing alternate launcher configuration. Lovable synchronized
  that commit and deployment `220e80e2-3963-4ec8-a4dc-06dad042cdc8` published it.
  Both `https://belna.se/privacy` and the published Lovable privacy page return
  200 with the 6 October update and Whop disclosure. Production health and
  reviewer login also return 200 after deployment.

The supplied physical-device recording is attached to both the sent reply and
version Review Information. The owner directed submission as-is after the
recording gaps were explained. Supplementary footage and physical iPad QA
remain evidence gaps, not completed tests. Any additional wallet authorization
requested by Apple must come from genuine provider documentation; the owner
has not supplied such a document.

## Review Evidence and Residual Risks

- Physical iPhone QA is owner-reported; the supplied recording is attached.
  Supplementary footage and physical iPad QA remain evidence gaps.
- Wallet/provider verification evidence and an accurate financial description;
  any additional authorization Apple requests must be supplied, not fabricated.
- Valid reviewer login is preserved. Any supplementary deletion demonstration
  must use a separate disposable account.
- Matching Notes and the sent reply have the verified recording attached.
- Build 49.1 is resubmitted with manual release preserved.
- Approval is Apple's decision and cannot be guaranteed.

## Supplied Recording Audit

The owner supplied `copy_715DEC95-6AF3-4E6B-89D5-C1453B210A1D.mov`
on 6 October and confirmed physical testing was on iPhone only. File duration
is 252.934 seconds (4:13), size 60,461,105 bytes, HEVC/AAC, 886 x 1920.
SHA-256 is `1f9163eef5157ef7ac5b2f677f06685e102306971be42ed98ce32cc4c6852eaf`.
The supplied copy has re-encoding metadata; do not describe it as an unmodified
camera original. The owner reports iPhone 14 Pro, iOS 26.6.2 and build 49.1;
no physical iPad QA is claimed. Device and OS details are owner-reported, not
encoded as independently verifiable model/OS metadata in the video.

Observed content includes existing reviewer-account password login, agent
onboarding, a three-day study-plan conversation, generated text-file creation
and Library preview, Pro plan Settings, reporting/support menu entries, and
optional Apple Health permission/connection. The final frame shows the generated
file's content successfully; earlier frames show the file task still running.
Pro access and login were also verified against production without logging
credentials.

The clip starts inside Belna, not by launching it. It does not demonstrate
registration or deletion. These are explicit requirements in Apple's message,
not optional substitutes for showing a working chat. A supplementary real-device
clip was requested: Home Screen launch, registration/login with a disposable
account, and confirmed deletion returning to the signed-out state. Do not delete
the persistent App Review account used in this clip. The owner explicitly does
not want the demo account deleted; it remains intact. A disposable-account
demonstration is separate from the persistent Apple reviewer login.

The owner subsequently directed submission with the supplied recording as-is
after being informed of the missing footage, and reports registering a test
account. This is owner-reported registration testing, not registration footage
observed in the clip. The final response describes demonstrated features without
claiming the recording covers every requested flow. Account-deletion access
instructions remain because Apple requested them; the demo account is preserved.

The video is saved as an attachment on the sent App Review reply and on the
version's App Review Information. The version attachment is
`1b3fdab0-c946-45d8-9457-1e48358cdc43`; the API reports delivery `COMPLETE`
with the original 60,461,105-byte size. The matching six-part Notes and sent
reply describe the observed features and owner-reported testing without
claiming all requested video flows or physical iPad testing were demonstrated.
Other concurrent code edits are left untouched.

## Final Resubmission Status

App Store Connect's browser control initially became
unresponsive after the reply and Notes were saved. Refreshing the version page,
recovering the existing tab, creating a fresh background tab and reconnecting
browser control did not restore reliable access to the Update Review action.
Apple's documented review-item API was also attempted, but the configured key
returned 403 FORBIDDEN_ERROR; no review-item state was changed by that request.

After the owner reopened the page, browser control recovered in tab 3.
Update Review displayed an unexpected-error banner, but the submission details
showed the item had actually changed to Ready for Review and enabled Resubmit
to App Review. The final resubmit action succeeded on 6 October at 10:43 AM
Stockholm time (`2026-10-06T08:43:10.423Z`). Both the UI and API confirm
`WAITING_FOR_REVIEW` for submission `fb862201-84cf-495c-aa00-846d0ea0fe83`.
Build 49.1, manual release, the saved Notes, both attachments and the persistent
demo account are unchanged. Approval is pending, not guaranteed.

Local proof files are `supabase/.temp/apple-review-reply-sent-20261006.png`
and `supabase/.temp/apple-resubmitted-20261006.png`. The successful submission
details page was left open for the owner.

## References

- [App Review Guidelines](https://developer.apple.com/app-store/review/guidelines/)
- [Reply to App Review](https://developer.apple.com/help/app-store-connect/manage-submissions-to-app-review/reply-to-app-review-messages/)
- [Whop Developer Terms](https://whop.com/tos-developer-api)
- [Whop Provider/KYC Terms](https://whop.com/tos-rest-of-world/)
