# Agents harness — Codex pattern, Gemini-backed (adapted)

We follow the Agents API shape from https://openai.com/sv-SE/index/introducing-the-agents-api/
(single call: task + model + tools + environment → session), adapted to our stack:
model = Gemini (our key), environment = self-hosted sandbox, vault = refs-only,
plus our extras (Supabase Auth, per-account billing, gift cards).

| Agents API concept | Our implementation |
|---|---|
| `sessions.create({agent:{model,tools,multi_agent}, vault_ids, environment, input})` | `Runner` in `server/agents/runner.js` (`/api/chat`, `/api/build`, `/api/research`); `sessionId` passed through, compaction in `sessions.js` |
| Environment (openai_hosted / own / partner) | `sandbox.js`: self-hosted, no shell, allowlisted hosts, in-memory artifacts in sandboxed iframes |
| Tools (MCP, function, built-in web search) + tool search + programmatic calling | `tools.js`: `web_search`, `github_prs`, `github_diff`, `build_page`, `memory_write`; `pickTools()` loads relevant defs; `runParallel()` runs independent calls concurrently |
| Multi-agent (`max_concurrent_subagents`) | `subagents.js` `fanOut()` max 3, each with own context; research fans out per source |
| Vault (`vault_ids`) | Vault secrets sealed server-side; model receives `sec_••••` refs only |
| Sandboxes (code, files, artifacts) | No arbitrary exec. HTML artifacts via `build_page`, files as chat cards, diffs read-only |
| Compaction (long sessions) | `sessions.js`: oldest turns summarized via Gemini, session continues |
| Tracing | `tracing.js` + `tool_runs` table; every run returns `trace[]` rendered in the Trace tab |
| Pay for tokens + tools | `plans.js` + `api_usage`: real token metering, Free $10 / Pro $30→$20+$50 gift / Max $50→$50+$100 gift |

Sensitive tools (`github_*`) pause for frontend approval cards before the PAT is
used (per-request `X-GitHub-Token`, never logged, never sent to the model).
