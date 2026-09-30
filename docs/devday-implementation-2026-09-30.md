# DevDay implementation and release verification

The six agreed changes are implemented for both Node and the edge runtime. Luna remains the model; Sol was not added. The release was tested in an isolated checkout based on `86c7264`, preserving unrelated mascot, layout and VM work. Database migrations were applied to the configured Supabase project and verified with real storage/database operations. Git publication does not itself confirm application deployment.

## Behavior changes

1. The original request, later owner instructions, quantities and constraints remain in planning context. Evidence-linked requirement checkpoints prevent captured requirements from disappearing. Unsupported completion becomes partial. The arbitrary 14-search cutoff was removed; stalled/runaway safeguards and explicit automation budgets remain.
2. Durable task notes retain requirements, findings, failed approaches and next actions. Source observations remain available through paged reads; owner changes invalidate old completion. These notes never grant authority.
3. PDF, DOCX and XLSX text extraction feeds conversation and tasks. Originals use private cloud storage, revisions preserve history, stale edits are rejected, and Library supports previews, downloads, history and editing the same file. Deletion queues blobs for retryable cleanup.
4. Opt-in goal work has success criteria, a next action, schedule, permitted tools and run/round budgets. PostgreSQL serializes linked runs and enforces budgets. Pausing/reconfiguring a goal stops stale work. Activity merges atomically; unchanged results stay quiet.
5. Independent permitted reads run concurrently, planning does not wait for computer prewarming, and connector compaction preserves all message metadata and pagination. Explicit pricing and usage records include model/deployment/provider, pricing version, cached tokens and duration. This is model cost attribution, not full VM/storage/connector invoice reconciliation.
6. Expiring account/action grants use exact scope by default, explicit subset scope, deny precedence and revocation. Eligible approvals can remember the exact action for seven days. Settings lists/revokes grants, and execution rechecks permissions. Retries cannot revive revoked grants.

Release testing found two more defects: unavailable-browser replies could omit the failure disclosure, and generated games could publish invalid JavaScript or add a broken optional mode. Computer failures now force a partial result with an explicit disclosure and skip a model round used solely for formatting coverage. Page generation instructions require checking interactions and callbacks. Node and edge publication parse inline JavaScript without executing it, reject oversized pages rather than truncating code, and return syntax errors for repair before publication.

## Verified release checks

- All **61 backend test scripts** passed on the release checkout, including document, permission, goal, runtime and migration tests. An existing preparation-timing test failed once near its threshold; standalone and subsequent complete runs passed. The threshold was not weakened.
- Production build passed with the new dependencies and generated edge modules.
- Existing UI checks passed: **12 routes at 5 viewport sizes**, links/navigation, signed-in settings, browser permissions, vault credentials and connector setup. Account APIs in UI checks are controlled fixtures.
- New Playwright checks passed at **1440px and 390px** for goal enable/pause, file revisions/editing and permission revocation, with browser errors and overflow checked.
- Real Supabase operations passed using a temporary account that was deleted afterward: private upload/download, document extraction/original persistence, revisions, stale-edit rejection, owner isolation, grant persistence/revocation, linked schedules, overlap prevention, run caps, pause, atomic activity and storage cleanup. Public blob access failed as expected. New tables have RLS enabled and the storage bucket is private.
- Live Luna checks passed for draft-only behavior, synthetic Gmail triage, unavailable-browser fallback and a five-item price comparison. The comparison retained five items, four correct monthly prices, five primary links and a specifically unverified price; no sending, subscription or purchasing was attempted.
- **Three latest generated games passed actual browser execution**. Checks include moves, occupied cells, terminal-state behavior and reset; two-player games also exercise wins/draws, and computer games exercise replies and reset during a pending reply. These are representative checks, not exhaustive game proofs.
- A regression test sends invalid code through the production publication tool and a worker repair cycle: only the repaired page is published. Edge parsing is checked too.

The saved initial release game failed its advertised computer reply. Of the next three games, one had a syntax error. Those attempts are retained as diagnostic artifacts; the production syntax guard and subsequent three-game verification followed these findings. Static parsing cannot prove logical correctness, and the requirement checklist is model-assisted evidence checking, not an independent proof of every fact or omitted constraint.

## Speed, cost and quality evidence

The earlier frozen-working-tree comparison used three runs per case. Drafting and Gmail were faster in that sample; all four categories had higher mean estimated costs, and browser fallback was slower. The [baseline summary](../artifacts/devday-release/benchmark-baseline-summary.json) preserves those results. Its raw sample filenames refer to earlier local artifacts in `artifacts/devday-2026`.

The final release samples below use real Luna, real public-web fallback, synthetic inbox/build persistence and actual generated HTML execution. They are staged small samples, not simultaneous randomized trials. Output size, caching and provider latency vary. Costs are configured-rate estimates, not invoiced charges.

| Final release sample | Time | Estimated model cost | Planning rounds | Status |
|---|---:|---:|---:|---|
| draft | 2.4s | $0.000225 | 1 | completed |
| gmail | 23.9s | $0.004266 | 7 | completed |
| browser-down | 12.1s | $0.005087 | 4 | partial |
| coverage-five | 14.7s | $0.003290 | 4 | completed |
| build-validated-1 | 21.0s | $0.002004 | 2 | completed |
| build-validated-2 | 25.0s | $0.002717 | 2 | completed |
| build-validated-3 | 25.2s | $0.002775 | 2 | completed |

These checks support the specific functional behavior above. They **do not establish an overall faster/cheaper result or a universal absence of answer-quality regressions**. The speed/cost acceptance criterion remains unmet. The latest game runs average more time than the earlier baseline; browser fallback remains costlier. A larger representative comparison is needed before claiming an overall performance improvement. Reliability fixes are included, with this limitation recorded explicitly.

Machine-readable evidence: [release summary](../artifacts/devday-release/release-summary.json), [real cloud checks](../artifacts/devday-release/cloud-verification.json), [generated-game checks](../artifacts/devday-release/generated-games-quality.json). Individual live outputs and initial diagnostics are saved alongside them.

## Database and remaining limits

Applied and verified, in order:

1. `20260930121726_task_files_goals_permissions.sql`
2. `20260930121729_goal_run_budget.sql`
3. `20260930121730_file_cleanup_goal_activity.sql`

The scheduler must continue running for queued storage cleanup. `MODEL_RATE_TABLE_JSON` accepts explicit model/deployment aliases with per-million input/cached/cacheWrite/output rates and a pricing version. Unknown model prices fail rather than receiving Luna prices silently.

Document extraction is text-only. Scanned PDFs need OCR; embedded images/charts/layout are not interpreted, formulas are not recalculated and dates can remain serial values. Extraction limits travel with the content. Native Office document generation is outside these changes. Real customer connectors, the deployed authenticated application and live VM cold-start latency were not fully exercised; those are not covered by the cloud fixture test.

## Reproduction

Run `npm test`, `npm run test:devday-ui` and `npm run build`. `npm run test:ui` needs the app at `UI_BASE` (default port 8080). Paid model checks are explicit: `node --env-file=<server-env> tests/worker-agent.eval.cjs --only <case> --json <output-path>`. Run `node tests/devday-generated-quality.cjs --file <saved-build-json>` for actual browser checks; multiple `--file` arguments are supported. The real cloud test is explicit: `node --env-file=<server-env> tests/devday-cloud.real.cjs`; it creates and removes only its own temporary account and files.
