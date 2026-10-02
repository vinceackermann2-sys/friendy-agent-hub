# Agent runtime

Model: Microsoft Foundry `gpt-6-luna` at `xhigh` reasoning (`AZURE_FOUNDRY_API_KEY`). Sandbox: one Azure VM per user.
See [AZURE.md](AZURE.md).

The model decides tools via function calling in `vm-harness.js`. Untrusted
shell and code runs through Azure Run Command into a hardened worker container
inside that user's VM. Until `AZURE_*` is set, the harness uses an isolated
per-user workspace and compute tools stay disabled.

Preserved on the Lingon side: auth, credits, memory, vault refs, approvals,
Composio apps, automations, traces.

## Responsive single-chat tasks

Normal chat uses `conversation.js`. Its first model call either answers the
question or starts substantial work with `delegate_task`. Reading an existing
task's findings can require a second call. Delegation acknowledgement needs no
extra model call. There is no separate router, idle question agent, or update
model running in the background.

Only plain worker jobs that need none of the owner's accounts (building
something, running code, deep research) skip the coordinator call. Requests
about the owner's accounts, messages, purchases or a website go through it, and
it calls `composio_apps` first. That tool lists the connected apps, the apps
that can be connected, and what a connection cannot do (for example, Facebook
connects Pages only, not personal Messenger). When nothing covers the request,
the agent says so and asks before it opens the site for the owner to sign in.

It also lists, under `custom`, the owner's own connectors: remote MCP servers
and REST APIs (`server/connectors.js`, table `custom_connectors`). The owner
asks in chat and a task adds one with `connector_setup`: the worker finds the
address and sign-in in the service's docs, and a chat card shows the owner
where the key goes and takes it. There is no manual form: Settings > Secrets
only lists saved credentials and starts a chat to add one.
Workers see what one can do with `connector_tools` and use it with
`connector_call`. Requests go from
the server, not the VM, because the VM's job containers have no network. The
credential stays in the vault and is added per request; results are scrubbed
of it. GET requests and read-only MCP tools follow the connected-app read
rule, and everything else asks first.

If task storage is unavailable, ordinary chat continues with a direct answer.
The coordinator withholds delegation and task-control tools for that request
and logs the storage error, so it cannot claim background work was started.

`task-runtime.js` advances each saved task by one model or tool step. The main
reply has a separate request and cancellation scope, so asking a question does
not cancel or replay task work. Workers use the existing tools, memory ranking,
credit checks, response guards, approvals and per-user Azure VM. Opening the app
does not warm compute. A task that will need the browser or shell (it signs in,
books, fills in a form or runs code) starts the VM while its first plan is
written (`azure.prewarm`). The start request is not awaited, and the usual idle
window still stops a VM the task never uses. A step on a VM that is already
running sends no restore command. A shell or code step is one Run Command, with
no separate readiness check. `[vm] lease` logs record how long each phase of
getting a VM took.

On the hosted app (Realtime live view), a browser step goes to the live streamer
already running on the VM instead of a new Run Command. The step is broadcast on
the session's channel and signed with a per-channel key that only the server and
that streamer hold (`cmdKey`). The streamer runs it in the browser it holds and
writes the result to a private blob. Taking the step means creating its result
blob first (`If-None-Match: *`). A server that hears nothing for 2.5 seconds
creates that blob itself and runs the step as a Run Command, so a step never runs
twice. Vault fills still go by Run Command. `[vm] browser step` logs show which
way a step went. `tests/browser-steps.cjs` runs this on real Chrome.

Tasks think at medium effort, or high when they build something, drive a
website or purchase, or just had a step fail (`workerEffort`;
`AZURE_FOUNDRY_WORKER_EFFORT` sets one level for all). Read-only calls planned
in one round run at once. `/api/agent/tasks/advance` runs steps back to back
until there is something new to show (at most 6 steps or 20 seconds). Task code gets a separate working directory and each
task has a separate browser session on that VM.

The database allows two worker steps per owner at once. It serializes task VM
commands because the Azure management transport permits only one active script per
VM. Foreground replies are outside this worker limit. Existing interactive VM
operations and automation runs still share Azure's command capacity; a failed
or uncertain task action is never automatically replayed.

### Checkpoints and cards

- Revisions, execution leases and compare-and-swap writes protect against late
  model results and duplicate advance requests. All task access is owner scoped.
- Steering preserves findings and all accepted instruction changes. It discards
  planned calls and expires earlier approvals. An action already dispatched may
  finish; its outcome is recorded before applying the changed plan.
- Approvals bind the task version, call ID and complete saved arguments. The
  model does not regenerate the approved action.
- An expired in-flight tool, or uncertain side-effect result, requires an outcome
  check. An interrupted model step can recover at most twice.
- Each task gets eight planning rounds plus one result-only round. If exhausted,
  its state is `partial`, with findings retained and a **Continue task** control.
  No wall-clock timer produces a progress card or a claimed completion.
- Milestones must cite successful observations and pass duplicate-evidence
  checks. Model/context/tool/VM stage events do not produce progress cards.
  Task and foreground results have separate IDs.
- A long chat task posts updates as the agent's own messages (subtasks,
  automations and upkeep post none). When the owner has heard nothing for 20
  seconds (90 after an update) and there are new results, a small call writes
  one or two sentences from those results while the worker plans its next step,
  so the task loses no time; it may find nothing worth telling yet. An update
  written as the task finishes is dropped. Worker milestones post the same way.
  The worker's prompt does not ask for updates: asked, it kept working after it
  had the answer, or ignored the request.
- A started task is confirmed in words written for the request, in the owner's
  language, by one small call that sees only the owner's message and the task
  title. It runs after the task has started, and falls back to a short reply.
- Polls return metadata and unseen events, excluding private model state and
  previously delivered outputs. Earlier context remains readable on demand.
- Three-dot typing appears immediately for a foreground request. Worker updates
  preserve the draft, foreground status and scroll position when reading above
  the bottom. They do not switch the user's selected canvas panel.

### Deployment

Apply `supabase/migrations/20260919160000_chat_tasks.sql` after the existing VM
lease migration, **before deploying the new frontend and API routes**. Task
storage needs the Supabase server key. The functions/tables are service-only.
This change does not apply the migration or deploy production infrastructure.

Node starts the task worker from `server/index.js`. While the app is open,
`/api/agent/tasks/advance` also advances tasks immediately. Database claims make
these two paths safe to use together. A five-second recovery poll reconciles
cards/approvals changed by another worker or tab; it creates no timed updates.

For hosted execution after the browser closes, the migration schedules a
database recovery pump once per minute, using the existing `VM_SWEEP_TOKEN`
vault secret and authenticated `/api/internal/tasks-tick` endpoint. Set the
`CHAT_TASK_WORKER_URL` vault secret if that endpoint lives on a separate Node
worker host. The endpoint awaits its work; it does not rely on an untracked
background promise after returning a serverless response. Ensure that host
supports the existing Azure operation duration (a VM start and a command can
each take up to four minutes). On a shorter-lived API host, set
`CHAT_TASK_WORKER_ONLY=true` so client advance requests only read snapshots,
run a separate Node worker with this flag unset, and point
`CHAT_TASK_WORKER_URL` at that worker. A lost execution is surfaced for review after its 12-minute
claim expires. The recovery schedule is infrastructure for ad-hoc tasks; it
does not create user automations.

### Automations in a hosted deployment

Apply the sub-agent, upkeep, upkeep-worker, and `20260924140000_automation_recovery.sql`
migrations. The named Supabase cron job calls the authenticated
`/api/internal/automations-tick` endpoint when a schedule is due or a durable
automation task needs reconciliation. Set the `VM_SWEEP_TOKEN` vault secret and,
if the worker runs on another host, `AUTOMATION_WORKER_URL`. Keep the chat-task
worker configured too: automation runs use its durable task state and approvals.
The migration uses the lowercase Vault key `vm_sweep_token` for both cron pumps;
the server reads that same key when checking the bearer token.

Connected-app automations additionally need a Composio webhook subscription for
`composio.trigger.message` pointing to `/api/composio/webhook`, plus the matching
`COMPOSIO_WEBHOOK_SECRET` environment value or `composio_webhook_secret` server
secret. Creating an app automation registers its trigger instance; the app only
offers events that need no additional trigger fields. A missing webhook setup
causes creation to fail with an error instead of leaving an inert automation.
The worker also registers older enabled app automations and refreshes their
registration hourly; registration errors appear in the Automations panel.

After deployment, open Automations and use **Run now** on a built-in and a user
automation. Check its last status/result, then check `automation_runs` and the
automation chat. A scheduled run can remain `running` while the task worker owns
it; the next automation tick reconciles its terminal result. Pending approvals
pause that automation's next scheduled run until the decision is resolved.

### Verification and cost claims

`npm test` covers a foreground reply during a held worker action, duplicate
advance requests, stale results/errors, steering, stopping, approval argument
integrity, uncertain outcomes, milestone evidence, budget continuation, account
isolation and UI replay. The migration's actual SQL runs against PGlite to
verify owner isolation, claims, revisions, event cursors and VM serialization.
`npm run build` regenerates and compiles the equivalent ESM backend.

The controlled concurrency test establishes that a question does not wait for
the worker and uses one foreground model call; it is not a live latency or
model-quality benchmark. Avoided router/narrator calls and replayed work reduce
overhead. A delegated task adds coordination/storage work, so total savings
depend on the workload. Live Foundry/Azure p50/p95 latency, token spending and
answer quality still need measurement before publishing a speed or cost claim.

## Shared objectives and worker communication

Also apply `20260919180000_chat_task_teams.sql` before deploying this version.
Workers delegated by the same main-agent response share a team ID. A later
worker joins that objective only through an owner- and chat-checked
`relatedTaskId`. Unrelated tasks in the same chat remain separate.

Every worker receives the original shared goal and all accepted shared user
requirements, alongside its assigned brief. `steer_team` updates the entire
team in one transaction, invalidates planned calls and approvals, and queues
finished components for revision. New teammates inherit the latest requirements
inside the creation transaction. The chat has an **Update shared goal** control
for teams; **Change task** continues to target one component.

Before planning or dispatching a tool, workers read a compact team snapshot.
Changes to peer findings/results or messages invalidate pending plans. A peer
discovery arriving during inference causes the old answer to be discarded and
reconsidered within the work budget. An already dispatched external action can
finish; its outcome remains recorded.

Workers can use `message_peer` for questions, findings, answers and conflicts.
Findings and answers must cite successful observations from the sender's current
instruction version. Delivery is durable and idempotent, scoped to the same
owner/chat/objective, and limited to 16 incoming messages per worker. Messages
are untrusted evidence or requests for information: they cannot authorize a
tool or change owner requirements. They do not create user-facing chatter cards
or reset planning budgets. Completed peers are read through `read_peer_result`;
messages never restart them automatically.

The main agent can read the shared brief, team results and recorded evidence
before giving a combined answer. Substantial reconciliation can be delegated
as a related task. Component completion does not establish that the entire
objective is complete; the prompts require unresolved dependencies and
contradictions to be identified. There is no automatic extra model reviewer on
every result, and evidence citations alone do not prove semantic correctness.

`tests/chat-task-teams.cjs` runs the actual SQL functions and task runtime
together. It checks delivery/replay, evidence validation, shared steering,
cross-owner/objective isolation, stale results/approvals and the main agent's
two-call read-and-synthesize path. These deterministic tests verify coordination
behavior, not a measured improvement in real-model answer quality.
