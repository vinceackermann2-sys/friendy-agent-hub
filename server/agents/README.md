# Agent runtime

Model: Gemini 3.5 (`GEMINI_API_KEY`). Sandbox: one Azure VM per user.
See [AZURE.md](AZURE.md).

The model decides tools via function calling in `vm-harness.js`. Untrusted
code runs only through Azure Run Command. Until `AZURE_*` is set, the harness
uses an isolated per-user workspace and `code_run` stays disabled.

Preserved on the Lingon side: auth, credits, memory, vault refs, approvals,
Composio apps, automations, traces.
