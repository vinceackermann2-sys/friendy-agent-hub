# Production verification follow-up

The deployed app at https://belna.se matched the first release's frontend and reported `gpt-6-luna`. Real authenticated checks used two newly created verification accounts, their own files/goals/grants and real Luna calls. Both accounts were removed afterward. No customer connectors were used.

The first live run found two application defects: the text MIME matcher treated Office ZIP files as XML, corrupting originals before cloud persistence; Library history requests could overwrite loaded content with an earlier loading state. Office originals now remain data URLs, and Library updates merge the current cache. The new UI regression uses metadata-only cloud responses and exercises both response orderings. It fails against the old implementation and passes with the fix.

Two initial harness assumptions were corrected: another account's version history returns 404, and the agent list property is `subAgents`. A history button becomes hidden after repaint, so the harness waits for attachment before continuing. These corrections are separate from the application fixes.

All 61 backend scripts, the production build and the new desktop/mobile regression passed after the fixes. The first build retry required stopping the local preview, which held a Windows directory lock; no source change was needed.

The rebuilt Cloudflare preview passed all eight verification groups: deployed assets/health/authentication gates, file revisions/stale edits/private storage/account isolation, scoped permissions/expiry/foreign revocation, goal linking/bounds/pause, real UI interactions at 1440px and 390px, a draft-only Luna response, all six requested facts from PDF/DOCX/XLSX, and a real bounded goal run with activity. Every original attachment round-tripped byte-for-byte, all three formats extracted text, and cleanup completed. The preview used compatibility date 2026-09-28 because the installed local workerd does not support the production build's 2026-09-30 date. Production configuration was unchanged.

Evidence: [initial live diagnostic](../artifacts/devday-release/production-initial.json) and [fixed Cloudflare preview](../artifacts/devday-release/edge-fixed.json). The production rerun and autonomous scheduler check follow publication of the fixes.

The earlier speed/cost comparison remains mixed. These functional checks do not establish universal answer quality or an overall cost/latency improvement. Real customer OAuth actions, live VM cold-start latency and scanned-document OCR remain outside this follow-up's live coverage.

Reproduce with `node --env-file=<server-env> tests/devday-production.real.cjs`. This explicit paid test creates temporary accounts, uses production APIs/Playwright/Luna, and removes its own data in `finally`. `VERIFY_BASE` and `VERIFY_OUT` select a local runtime and separate evidence directory; the autonomous scheduler check runs only against production. Do not add this paid verification to the default unit-test command.
