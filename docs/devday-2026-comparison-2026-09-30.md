# OpenAI DevDay 2026 compared with Lingon / Belna

Reviewed 30 September 2026. Local baseline: `86c7264` plus the existing uncommitted working-tree changes. This is a source-based assessment, not a production benchmark or an implementation. No application code, cloud resources, credentials, dependencies, or Git history were changed for this review.

**Recommendation: strengthen the current runtime, selectively reuse the open components, and benchmark a managed runtime behind an adapter.** We already have much of the necessary product foundation. The most immediate gains appear to be evidence-based completion, better long-task context, reliable document delivery, richer autonomy rules, and model-aware cost accounting. A wholesale cloud migration is not yet justified by the evidence.

I read the [complete supplied recap](https://openai.com/sv-SE/index/devday-2026-recap/), followed the main technical announcements into documentation, inspected relevant public repositories and selected implementation files, and compared them with our current backend. Public source availability, open-source licensing, paid API access, and a hosted product are different things. Several components below predate DevDay; they are relevant building blocks, not all newly released code.

**What is actually reusable**

| Component | What is public and how it works | Fit for us |
|---|---|---|
| [Codex CLI and runtime](https://github.com/openai/codex) | Apache-2.0. A local executable implements the agent runtime; model inference still needs a supported service. | Study execution, interruption, permission, context, and event handling. Potential optional coding worker, not a free model or a complete hosted SaaS. |
| [Codex TypeScript SDK](https://github.com/openai/codex/tree/main/sdk/typescript) | Part of Codex. Spawns the CLI and consumes JSONL events. `runStreamed` yields progress; saved thread IDs support continuation. [Implementation](https://github.com/openai/codex/blob/main/sdk/typescript/src/thread.ts). | Useful for isolated build/repository jobs on a Node worker. It cannot spawn a native CLI inside our edge runtime. This is different from the Agents SDK. |
| [Codex app-server](https://learn.chatgpt.com/docs/app-server) | Open-source Codex component. Bidirectional RPC exposes threads, turns, approvals, history, and incremental events to a rich client. | Strong reference for our task/event contract. Current docs explicitly describe the app-server command and WebSocket transport as experimental and unsupported for production workloads; do not expose it as our production API without a separate readiness assessment. |
| [Agents SDK, TypeScript](https://github.com/openai/openai-agents-js) and [Python](https://github.com/openai/openai-agents-python) | MIT libraries. The application runs the loop and configures tools, handoffs, guardrails, session persistence, and tracing. JS also includes sandbox and realtime-agent abstractions. | Evaluate selected primitives or a separate worker. We already implement many of these responsibilities. JS documents Cloudflare Workers support as experimental; provider compatibility and durable recovery remain integration work. |
| [OpenAI MCP Extensions](https://github.com/openai/mcp-extensions) | Apache-2.0; TypeScript/Python SDKs, protocol spec, and Bits & Bolts sample. Extends MCP Apps with sidebar/panel/file entrypoints, forms, resources, and model/UI context exchange. | Most directly useful new public UI integration. Could expose Belna goals, task results, and documents inside ChatGPT. It does not automatically add these surfaces to our own app. |
| [MCP Apps](https://github.com/modelcontextprotocol/ext-apps) | Open specification and SDK for server-provided embedded interfaces. Its LICENSE describes an Apache-2.0 transition with remaining MIT contributions and CC-BY-4.0 documentation. | Useful interoperability target for Canvas. Start with the shared protocol, then optional host-specific extensions. |
| [Plugins](https://github.com/openai/plugins) and [skills](https://github.com/openai/skills) | Public packages combine instructions/resources and optional MCP connections. Check each package's license. The skills repository now says it is deprecated and directs users to plugins, despite still appearing in the official open-source index. | Implement a small, versioned skill catalog; reuse selected licensed examples. Installing a package does not grant access to its connected services. |
| [Codex universal environment](https://github.com/openai/codex-universal) | Published Docker environment and setup scripts with configurable language runtimes. OpenAI lists it among open components, but GitHub did not identify a repository-wide license in this review. | Reference for reproducible worker images. Resolve redistribution terms before copying substantial material; a public repository alone is insufficient evidence. Avoid a much larger image unless its packages are needed. |
| [Codex Security CLI / TS SDK](https://github.com/openai/codex-security) | Apache-2.0 scanner tooling with security-policy generation, scans, findings, validation, and remediation workflows. Still depends on model access; some capabilities require additional access. | Useful engineering tool for this repository's tenant isolation, secrets, browser broker, payments, and connector boundaries. This is separate from Security Cloud. |
| [OpenAI Cookbook](https://github.com/openai/openai-cookbook) | MIT examples, including Agents API applications referenced in its guide. Example application code is reusable; the hosted services it calls are separate. | Adapt targeted examples for approvals, incident response, and document workflows. Do not adopt a sample's storage as a production durability guarantee. |
| [MCP Triggers & Events](https://github.com/modelcontextprotocol/experimental-ext-triggers-events) | Apache-2.0 incubation repository. Its README explicitly labels the protocol work experimental. OpenAI now documents its supported integration subset. | Add an adapter behind our existing event abstraction. Pin the protocol version and retain current Composio/webhook support. |

The [official open-source inventory](https://learn.chatgpt.com/docs/open-source) explicitly distinguishes Codex cloud and the IDE extension from the open components. I found no published source release for dots, the managed Agents API service, Decisions inference, GPT-6.1 Sol weights, or Private Intelligence in the reviewed material. They should be evaluated as hosted capabilities, not libraries we can copy or self-host.

**Our current starting point**

The actual source is ahead of parts of the older September 21 audit. Avoid rebuilding features already added:

- [conversation.js](C:/lingon/server/agents/conversation.js:198) already separates responsive chat from background work, loads saved history, maintains an earlier-chat summary, and lets users steer ongoing tasks.
- [task-runtime.js](C:/lingon/server/agents/task-runtime.js:153) already persists checkpoints, uses leases and revisions, reconciles uncertain actions, handles approvals, runs independent reads together, and coordinates bounded task teams.
- [automations.js](C:/lingon/server/agents/automations.js:146) already routes scheduled and app-triggered work through that durable task runtime. [upkeep.js](C:/lingon/server/agents/upkeep.js:5) includes memory, relationships, ideas, goal study, reflection, and quiet review with restricted tool sets.
- [compute lifecycle](C:/lingon/docs/compute-lifecycle.md:1) separates account state from demand-based Azure compute, with browser continuity, private backups, and idle shutdown. The browser already has a persistent live transport; the remaining command bottleneck is narrower than “everything starts a new browser.”
- [connectors.js](C:/lingon/server/connectors.js:1) supports custom REST/MCP connections, credential brokerage, tool restrictions, and transport handling. [tools.js](C:/lingon/server/agents/tools.js:477) already has capability discovery.
- [sync-lingon.mjs](C:/lingon/scripts/sync-lingon.mjs:1) now generates many shared modules for the Node and edge targets. Any new adapter still needs to work across both deployment paths, but the copies are not all manually maintained.

These are source-level findings. Production configuration, deployment freshness, and real workload outcomes were not checked.

**The improvements I would prioritize**

| Priority | Improvement | Expected benefit | Relative effort |
|---|---|---|---|
| 1 | Correctness-based evaluations and explicit completion criteria | Prevent attractive but incomplete or unsupported answers | Small–medium |
| 2 | Durable task memory and evidence references | Better long research, fewer repeated calls, reliable handoffs | Medium |
| 3 | Model/provider cost accounting, then selective Sol evaluation | Better quality where useful without losing cost visibility | Medium |
| 4 | Durable binary artifacts and document ingestion | Real PDF/DOCX/XLSX workflows and cross-device delivery | Medium–large |
| 5 | Goal-linked autonomy policies and event-driven follow-through | More useful work while the user is away | Medium–large |
| 6 | Persistent command executor and reproducible environments | Lower tool overhead and better recovery | Large |
| 7 | Structured skills, tool discovery, and bounded programmatic calls | Less prompt bloat and fewer model round trips | Medium |
| 8 | A Belna MCP plugin with selected rich UI | Additional product distribution and reusable surfaces | Medium |
| Experiment | Managed Agents API worker | Potentially reduce harness maintenance | Medium pilot; large migration |

These are engineering judgments, not measured savings or implementation estimates in days.

**1. Fix what we reward and what “completed” means**

The [research evaluation](C:/lingon/tests/research-agent.eval.mjs:23) uses a `HEDGE` regex, and [its scoring](C:/lingon/tests/research-agent.eval.mjs:116) marks matching uncertainty language as an “excuse.” Some case checks count prices, addresses, or answer structure. Those are useful presentation checks, but they do not establish source correctness. A truthful report of an inaccessible source can fail while invented but well-formatted details can satisfy those checks.

Keep the expectation that the agent tries available retrieval methods. Grade separately whether it tried, whether its claims are supported, whether it fulfilled each requested part, and whether its uncertainty matches the evidence. Include inaccessible pages, stale prices, conflicting sources, and malicious content. OpenAI's [agent evaluation guidance](https://developers.openai.com/api/docs/guides/agent-evals) similarly emphasizes tracing tool choice, handoffs, instruction adherence, and repeatable datasets.

There is also a concrete task-state issue to improve. [task-runtime.js](C:/lingon/server/agents/task-runtime.js:83) sets a 14-call research limit. At that threshold it removes further research options and asks for a final answer; [the no-call completion path](C:/lingon/server/agents/task-runtime.js:593) marks the task completed unless the separate overall limit was reached. Thus reaching the research threshold does not itself produce a partial status or prove the requested coverage was achieved.

Add a small requirements ledger: requested deliverables, evidence gathered, unresolved claims, and verified output links. Use time/token budgets and diminishing-return signals alongside the existing runaway protection. Permit a bounded additional retrieval when one missing primary source decides the outcome. Explicitly label genuinely partial results. For artifacts, validate the actual file instead of relying on publication alone; the [read-context tool guidance](C:/lingon/server/agents/task-runtime.js:68) currently discourages reading generated files back to check them.

Acceptance: a task can truthfully finish with an unresolved detail; an unsupported required detail cannot silently pass as verified; a published artifact must also open and contain the requested content.

**2. Improve task context without discarding our existing memory**

We already summarize older chat messages and store durable personal memory. The specific gap is long-task working state. [Task observations](C:/lingon/server/agents/task-runtime.js:89) use a recent window and character clipping; older observations become short lines. [foundry.js](C:/lingon/server/foundry.js:219) also bounds history and serializes the selected context into messages. This is a pragmatic cache-friendly design, but text shortening can lose a qualifier, a source association, or a failed approach that matters later.

Add a structured task checkpoint containing verified facts with source/observation IDs, current plan, unresolved questions, rejected approaches, and exact user constraints. Keep full evidence outside the prompt and retrieve it by ID. Continue treating retrieved text and summaries as data, with owner changes separately represented.

OpenAI's [Responses compaction](https://developers.openai.com/api/docs/guides/compaction) can preserve continuation state through opaque compaction items. Its standalone endpoint returns the complete canonical next window, not just one summary item. Evaluate it where the provider/model supports it; do not assume Azure exposes the same feature. Our current wrapper does not carry arbitrary typed response items through the loop, so this needs a real adapter change.

For personal memory, [memory.js](C:/lingon/server/agents/memory.js:11) currently ranks mainly by lexical overlap, importance, and age. Test multilingual and paraphrased retrieval before adding hybrid semantic search. Preserve existing supersession and deletion behavior rather than simply injecting more memories.

Acceptance: after a long task or restart, the agent retains the owner's constraints, cites the original evidence, and does not repeat already completed work just because it left the prompt window.

**3. Evaluate stronger models selectively, after fixing cost attribution**

Our [Foundry provider](C:/lingon/server/foundry.js:5) defaults to Luna. Foreground chat uses low reasoning; [workers](C:/lingon/server/agents/task-runtime.js:22) already use medium/high according to capabilities and failures. A recommendation to stop running every task at xhigh would be stale.

Test GPT-6.1 Sol on difficult research synthesis, code generation, browser recovery, and final reconciliation. Keep Luna as the baseline for straightforward chat and low-complexity steps. OpenAI positions [Sol](https://developers.openai.com/api/docs/models/gpt-6.1-sol) as a cost/quality alternative to Astra; that is not evidence that it is cheaper than our current Luna workload or better on every Belna task.

First fix [costOf](C:/lingon/server/plans.js:74): it has one special model-prefix rate set and otherwise uses global default rates. Adding a more expensive model without an explicit rate mapping could misattribute internal costs. Track provider, deployment alias, resolved model, region, service tier, input/output/cache categories, and price-version date. Preserve customer entitlements while separately enforcing a real internal cost ceiling. Raw token allowances alone do not normalize different model costs.

Our provider only accepts Azure hostnames and constructs Azure routes. Direct OpenAI, Decisions, or Agents API access requires a separate provider implementation, not changing a model-name string. Verify the actual Azure deployment catalog before planning an in-place Sol switch.

Ultrafast is an optional latency experiment after profiling. [Its guide](https://developers.openai.com/api/docs/guides/ultrafast-mode) recommends persistent WebSockets for frequent tool calls and currently limits regional processing to US/global. Faster generation will not remove our VM startup, external site, or Azure command delays. No savings or end-to-end speedup is established here.

**4. Make documents and artifacts first-class product objects**

[prepareAttachments](C:/lingon/server/agents/attachments.js:35) directly extracts text and selected images; unsupported binary formats can reach the model as metadata only. [Library storage](C:/lingon/server/personal-store.js:137) already provides persistent IDs and account-scoped records, but media is stored as data URLs capped at 6 MB. We have a Library; the improvement is its file architecture and editing lifecycle.

Use object storage for binaries, with metadata, immutable versions, signed downloads, extraction status, owner checks, and source/task links in the database. Add PDF/DOCX/XLSX extraction and a secure workspace-file delivery route. Give Canvas a stable artifact ID and version instead of making the chat payload carry the file.

For living documents, record which source subscriptions refresh an artifact and use revision/ETag checks so an agent cannot overwrite a user's newer edit. Start with one useful format, such as a continuously updated research brief or goals dashboard, before building an entire collaborative office suite.

OpenAI's [artifact design](https://developers.openai.com/api/docs/guides/agents-api/environments/files) distinguishes workspace files from published copies that outlive compute. Its hosted Artifacts API does not publish files from self-hosted environments; an Azure-backed Agents API integration would still need our delivery service. The [MCP extension SDK](https://github.com/openai/mcp-extensions/blob/main/typescript/README.md) demonstrates resource reads, version metadata, subscriptions, and file viewers that could inform this design.

Acceptance: upload a PDF, extract and cite its content, generate a spreadsheet, close the browser, stop compute, and retrieve the correct file from another device. Concurrent edits must produce a resolvable conflict.

**5. Turn goals into bounded ongoing responsibilities**

[Dots](https://openai.com/index/introducing-dots/) combines continuing goals, a computer, feedback, connected apps, and user controls. Its disclosed proactive research uses read-only connected-app tools; the product does not establish that every background opportunity authorizes an external action. Its custom rules and activity review are relevant design references, not proof that its private implementation can be recreated from public source.

Our [goal records](C:/lingon/server/personal-store.js:26) currently expose title, category, status, steps, and source chat. Our upkeep routines already study goals and stay quiet in some no-change cases. Extend these with an explicit goal-to-task link, next permitted action, completion evidence, wake condition, cost/time allowance, and notification preference. Let the owner see “why I woke up,” what changed, what was done, and what decision remains.

Extend the current [permission policy](C:/lingon/server/agents/permission-policy.js:11) with scoped grants: account, resource, operation, destination, amount/limit when relevant, expiry, and revocation. Preserve exact-action approvals already in the task runtime. A grant to draft recurring updates should not become a grant to publish arbitrary messages. This is a product improvement to coarse connector/web settings, not a claim that all current enforcement is absent or bypassed.

Implement goal budgets across the whole task tree, including retries and maintenance. Start with useful read-only work and reviewable drafts. Add quiet hours and meaningful-change notifications at the delivery layer. Do not keep every VM running just to make an agent feel available; account state and scheduling can remain active while compute sleeps.

**6. Adopt MCP Events as an adapter, with the current version boundary explicit**

OpenAI's [MCP Events integration](https://developers.openai.com/plugins/build/mcp-events) uses discovery, subscription/unsubscription, persistent filters, callback verification, signed webhooks, stable event IDs, and refresh/revocation. It requires MCP protocol `2026-07-28` and supports a subset of a draft; its docs exclude polling, streaming, and some draft control notifications. Events can arrive out of order.

Our [MCP client](C:/lingon/server/connectors.js:27) uses `2025-06-18`. Our [automation dispatcher](C:/lingon/server/agents/automations.js:180) already consumes app events and deduplicates when event IDs exist. Add negotiated event capability support and translate deliveries into that existing path. For a Belna plugin, expose events outward too: task completed, artifact updated, or goal needs input.

Use durable inbox/outbox records, per-account subscriptions, signature verification, bounded retries, and idempotent downstream writes. Do not assume an HTTP acknowledgement means the resulting task completed. Keep event receipt separate from authorization to act. A single replayed event must not produce duplicate tasks or purchases.

**7. Improve tool and skill composition**

Our [capability search](C:/lingon/server/agents/tools.js:477) scores keyword overlap and returns eight matches. We already avoid loading every schema, so the opportunity is better discovery quality and interoperable metadata. Use capability namespaces, real account availability, multilingual synonyms, and versioned schemas. Evaluate difficult paraphrases and unavailable-account cases.

OpenAI [tool search](https://developers.openai.com/api/docs/guides/tools-tool-search) supports deferred schemas and client-owned discovery; its context placement is designed to preserve caching. This is a hosted API feature, not a standalone open-source search engine. Our provider currently normalizes all declarations into function tools, so native tool-search support requires feature negotiation and response-item handling.

[Programmatic tool calling](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling) executes coordination JavaScript in an isolated V8 runtime. It can filter or join results before returning a smaller result to the model. It has no general filesystem, Node environment, or direct network access. This could reduce round trips for “retrieve these records, group them, calculate totals.” Start with bounded reads; keep sends, purchases, approvals, and final evidence validation in explicit paths. Our parallel-read support already captures part of the benefit.

Add a small skill registry with name, description, version, allowed capabilities, and full instructions loaded only when selected. Our current “skill review” upkeep writes procedures into AGENTS.md; it is not a versioned skill-package loader. Package repeated research, document generation, and connector workflows instead of continually lengthening the system prompt. Use the current [plugin packaging format](https://developers.openai.com/plugins/build/plugins) and inspect licenses per package.

**8. Modernize the remaining compute transport**

The existing Azure browser relay is an asset. Shell/code and fallback paths still use [Azure Run Command](C:/lingon/server/agents/azure-vm.js:2577); the runtime documentation notes command serialization per VM. Extend a persistent executor protocol to shell/code, with job IDs, output streaming, cancellation, bounded queues, reconnect/resume, and durable acknowledgement. Keep ambiguous write outcomes in review rather than replaying them.

The Agents API [self-hosted executor](https://developers.openai.com/api/docs/guides/agents-api/environments/self-hosted) is a concrete reference: `codex exec-server` establishes outbound connections and reconnects. If adopting that service, retain tenant isolation and our existing VM lifecycle. Its executor requires a restricted environment key; this is a deliberate credential design change, not equivalent to our current networkless worker container. The full application API key must remain outside the sandbox.

[Codex Cloud](https://learn.chatgpt.com/docs/cloud) also demonstrates reusable prepared environments with separate task workspaces. Apply that pattern to our worker images: pinned image digests, tested package sets, versioned manifests, and explicit update/rollback. Keep browser identity persistent per user while task scratch spaces remain isolated. Benchmark first-use preparation, warm command time, restore failures, and queue wait separately.

**Managed runtime choices**

| Choice | What it would own | What we still own | Recommendation |
|---|---|---|---|
| Current Responses + our harness | We control both orchestration and execution | Entire product and operational loop | Keep as baseline; apply the improvements above. |
| Agents SDK in our worker | SDK assists loop, handoffs, sessions, tracing | Hosting, persistence integration, policies, billing, tenant boundaries | Selective reuse or isolated trial, not a mandatory rewrite. |
| Codex SDK / app-server | Codex executable runs a richer local harness | Process lifecycle, isolation, provider/auth integration, product contracts | Trial for specialized jobs; respect app-server maturity limits. |
| Agents API with no environment | OpenAI runs the managed harness | Our function tools and product state | Smallest read-only pilot; no Azure executor migration needed. |
| Agents API with our Azure environment | OpenAI runs the harness; our executor runs commands | Azure lifecycle, files, policies, credentials, product state | Next pilot only if operational/data requirements fit. |
| Agents API with hosted computer | OpenAI supplies harness and browser environment | Product integration, approvals UI, retention, outcome checks | Read-only browser test first; not a direct replacement for payment execution. |
| Bedrock Managed Agents | Harness/inference in Bedrock, execution through AWS or self-hosted compute | Product integration and AWS operating model | Defer absent a concrete AWS requirement. |

The [Agents API overview](https://developers.openai.com/api/docs/guides/agents-api/overview) currently documents US-only session data residency and no ZDR, including when execution is self-hosted. Moving only the executor to Azure does not move the harness or inference there. [Bedrock's comparison](https://developers.openai.com/api/docs/guides/agents-api/bedrock-managed-agents) also warns that shared concepts do not imply matching API contracts or feature availability.

The new [hosted computer-use API](https://developers.openai.com/api/docs/guides/agents-api/tools/computer-use) requires approval for new website origins, even public ones. The same guide explicitly says origin approval does not enforce confirmation before individual consequential actions. It recommends restricting such resources or using a browser runtime you control when confirmation must be guaranteed. This matters directly to our shopping, mail, and payment tools. Login/browser continuity must also be tested; recycling the hosted environment clears its browser state.

Keep one authoritative task record in our database and map it to the vendor session. Translate vendor progress into our existing UI contract. Route tools through our permission/credential layer, preserve request IDs, and reconcile before retrying uncertain actions. Do not run two independent orchestrators over the same side-effecting task.

**Decisions API: promising, but not yet a migration dependency**

The [recap](https://openai.com/sv-SE/index/devday-2026-recap/) describes a limited-preview API that answers user-defined questions from a finite set of choices using text or image context. I could verify that announcement, but did not locate a public endpoint/schema, detailed pricing, or an open-source implementation in the official documentation searches. Those details remain unverified.

Potential Belna applications: routing a request to answer/research/browser work, classifying incoming event relevance, and deciding whether a change merits a notification. Start in shadow mode against our existing routing. Keep an “uncertain” path and normal model fallback. Never make a classifier the authority for account access, spending, or a claim that a task is complete. It would be counterproductive to add a paid classifier before every trivial turn without proving it saves more work than it adds.

**Product and distribution opportunities**

The [plugin extensions documentation](https://developers.openai.com/plugins/build/extensions) supports a concrete distribution experiment: a Belna sidebar for goals and tasks, a conversation panel for a running job, and viewers for durable artifacts. Start by exposing narrow tools such as list goals, read task, read artifact, and create a user-requested task. Reuse our backend and account isolation. Treat connecting Belna to ChatGPT and rendering third-party MCP Apps inside Belna as two separate integrations with different security and UX work.

Full voice conversation is a later candidate. We currently transcribe microphone input into text. The open [Agents SDK](https://github.com/openai/openai-agents-js) provides realtime-agent abstractions and browser WebRTC examples. Benchmark interruption, task steering, multilingual speech, and cost before replacing the simpler input flow. Tool execution should still cross our existing permission boundary.

Sign in with ChatGPT is worth considering for onboarding, but [website integration](https://developers.openai.com/siwc/website) is documented as a limited commercial trial. Identity sign-in does not import chat history. The separate [ChatGPT plan-usage flow](https://developers.openai.com/siwc/token-sharing-open-source) covers open-source/local apps and directs paid or remotely hosted apps to an interest form. Our hosted service should not assume users' ChatGPT subscriptions can fund our API calls.

**Coverage of the rest of the recap**

Every announcement is accounted for below; these are prioritization decisions, not claims that every feature is open source. [Recap](https://openai.com/sv-SE/index/devday-2026-recap/).

| Announcement | Decision for Belna |
|---|---|
| dots | Borrow continuing-goal and user-control patterns. |
| GPT-6.1 Sol | Benchmark selectively after cost mapping. |
| Ultrafast | Profile first; optional premium latency experiment. |
| Private Intelligence | Evaluate against actual enterprise requirements. |
| Codex cloud | Borrow reproducible environment practices. |
| Refreshed Codex CLI | Reuse runtime ideas; optional coding worker. |
| Code review | Useful engineering workflow, not core product replacement. |
| Codex Security Cloud | Consider scheduled repository review separately. |
| Decisions API | Shadow routing experiment when verified and accessible. |
| Agents API computer use | Pilot with explicit browser-policy constraints. |
| Bedrock Managed Agents | Defer AWS migration. |
| Plugin extensions | Strong distribution experiment. |
| Plugin creation/submission/discovery | Package a focused integration before pursuing ranking. |
| Sites with connected plugins | Useful prototype channel; preserve our product backend. |
| MCP Events | Add a versioned adapter. |
| ChatGPT Space | Inform future shared-workspace design. |
| Living pages | Prioritize durable, refreshable artifacts. |
| Collaborative presentations | Later; file lifecycle comes first. |
| Teams and shared tasks | Later; distinguish human memberships from our agent teams. |
| Slack and Teams | Candidate inbound channels with identity mapping. |
| Meetings | Later; meeting-to-draft workflow rather than recording infrastructure first. |
| Shareable profiles | Later distribution feature. |
| Sign in with ChatGPT | Access-gated onboarding experiment. |
| New Pro tier | Tooling purchase decision, not application infrastructure. |
| OpenAI Marketplace | Later commercial channel if eligible. |

For Private Intelligence, [Private Safety Processing](https://developers.openai.com/api/docs/guides/private-safety-processing) describes customer-controlled encrypted safety records and hardware-attested automated review. It does not remove our own chat/log/storage responsibilities, prove our current deployment has ZDR, or make Agents API sessions ZDR-compatible. Private Inference remains a separately announced preview; no deployable open implementation was established here.

For engineering security, [Security Cloud setup](https://learn.chatgpt.com/docs/security/setup) documents repository scans, commit monitoring, threat-model review, and proposed fixes. The open CLI is another route. A useful pilot would target connector SSRF boundaries, secret handling, cross-account access, browser submissions, webhook replay, and billing idempotency. Assess findings and reproduction evidence before enabling automatic fixes. No scan, installation, or scheduled automation was started by this review.

**How to decide whether an adoption is actually better**

Build a repeatable comparison from our existing chat, worker, research, permission, and browser tests. Use a fixed dataset plus a separately labeled live-web set. Suggested first batch: simple chat, broad research, conflicting sources, long task continuation, unavailable connectors, document generation, browser sign-in, cancellation, worker crash, repeated event delivery, and multi-agent reconciliation.

Measure task success with evidence, unsupported-claim rate, correct uncertainty, time to first useful response, total p50/p95 completion time, repeated calls, approval burden, resume success, and total cost per successful outcome. Include root and child model calls, cache costs, VM/storage time, connector fees, and recovery overhead. Add hard gates for tenant isolation and duplicate side effects.

Use structured spans with task/turn/tool/approval IDs, provider/model/prompt versions, timing, and cost. Our [tracing wrapper](C:/lingon/server/agents/tracing.js:1) persists tool-run records, while task events carry additional detail; consolidate them into a queryable end-to-end view. The managed API offers [session events and trace export](https://developers.openai.com/api/docs/guides/agents-api/observability), but best-effort usage fields may be missing or updated, so reconcile billing rather than treating the first event as final.

Start with evaluation fixes, task evidence, artifact handling, and explicit cost mapping. Then run two separate experiments: Sol on the current harness, and an Agents API read-only worker. This isolates model gains from orchestration gains. Keep the current provider available for rollback. Expand only when the measured benefit survives recovery, permission, and cost checks.

No tests or paid model benchmarks were run for this documentation-only assessment. Public documentation was checked as of the review date; account access, Azure model availability, production latency, actual contract pricing, and customer-region requirements remain to be verified before implementation.
