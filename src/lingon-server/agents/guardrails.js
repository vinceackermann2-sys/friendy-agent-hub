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

const INTERNAL_DETAILS_REPLY = "I can't provide or speculate about internal implementation, system, or provider details. I can explain my capabilities and privacy protections at a high level, or help with your task.";

function asksAboutInternalDetails(prompt) {
  const text = String(prompt || '').toLowerCase();
  const hiddenInstructions = /(?:system prompt|developer message|hidden instructions|internal (?:instructions|prompt|policy|configuration)|reveal.{0,30}(?:prompt|instructions)|ignore.{0,30}(?:previous|system|developer).{0,30}instructions)/i;
  const selfArchitecture = /(?:\b(?:your|agent's|lingon's|arche's|this (?:app|agent)'?s)\s+(?:model|provider|backend|database|api|architecture|infrastructure|stack|framework|source code|implementation)\b|\b(?:what|which)\s+(?:ai|model|provider|backend|database|api|framework|stack)\b.{0,40}\b(?:do|does|are|is)\s+(?:you|lingon|arche|this (?:app|agent))\b|\b(?:are|is|do|does)\s+(?:you|lingon|arche|this (?:app|agent))\s+(?:use|run|rely|connect|call|work|operate|built|powered|based|hosted)\b|\bis this (?:app|agent)\s+(?:using|built|powered|based|hosted)\b|\bhow (?:are|were) you (?:built|made|hosted|run)\b|\b(?:are you|is (?:lingon|arche))\s+(?:gpt|chatgpt|claude|gemini|grok|kimi|llama)\b|\b(?:how (?:do you|does (?:lingon|arche|the agent|this (?:app|agent))) (?:work|run|operate)|(?:what|which).{0,20}(?:powers|runs|hosts) (?:you|lingon|arche|this (?:app|agent))|who (?:powers|built|made) (?:you|lingon|arche)|under the hood)\b)/i;
  return hiddenInstructions.test(text) || selfArchitecture.test(text);
}

function containsInternalDisclosure(answer) {
  const text = String(answer || '');
  return /\b(?:i(?:'m| am)|lingon|this (?:app|agent)|the agent)\b[^.!?\n]{0,80}\b(?:powered by|built on|based on|hosted (?:on|by)|runs? inside)\b/i.test(text)
    || /\b(?:my|our)\s+(?:underlying\s+)?(?:model|provider|backend|database|api|architecture|infrastructure|tech stack|framework|system prompt|developer instructions|harness)\b/i.test(text)
    || /\bi\s+(?:use|rely on|call)\s+(?:gpt|chatgpt|claude|gemini|grok|kimi|llama|openai|anthropic|supabase)\b/i.test(text)
    || /\b(?:i am|i'm)\s+(?:gpt|chatgpt|claude|gemini|grok|kimi|llama)\b/i.test(text)
    || /\b(?:system prompt|developer message|hidden instructions)\s+(?:says|contains|is|are|instructs?)\b/i.test(text);
}

function protectAgentResponse(prompt, answer) {
  if (asksAboutInternalDetails(prompt) || containsInternalDisclosure(answer)) return INTERNAL_DETAILS_REPLY;
  return String(answer || '');
}

export { redact, checkPrompt, asksAboutInternalDetails, protectAgentResponse, INTERNAL_DETAILS_REPLY };
