/* Guardrails: approvals, credits, secrets, input limits.
   Mirrors the Agents API safety shape: the model proposes, the harness disposes.
   - Secret values never enter model context (refs only).
   - Sensitive tools (github_*) require explicit frontend approval per run.
   - Credit cap enforced before any model call.
   - Input lengths capped; GitHub PATs never logged.
*/
function redact(s) {
  return String(s || '').replace(/ghp_[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/github_pat_[A-Za-z0-9_]+/g, '[redacted]')
    .replace(/AQ\.[A-Za-z0-9_\-]+/g, '[redacted]')
    .replace(/sb_secret_[A-Za-z0-9_\-]+/g, '[redacted]');
}

function checkPrompt(prompt, max = 6000) {
  if (!prompt || !String(prompt).trim()) {
    const e = new Error('prompt required');
    e.code = 'BAD_INPUT';
    throw e;
  }
  if (String(prompt).length > max) {
    const e = new Error(`prompt too long (${max} chars).`);
    e.code = 'BAD_INPUT';
    throw e;
  }
}

export { redact, checkPrompt };
