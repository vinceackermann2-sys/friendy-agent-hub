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
  const selfArchitecture = /(?:\b(?:your|agent's|lingon's|arche's|this (?:app|agent)'?s)\s+(?:model|provider|backend|database|api|architecture|infrastructure|stack|framework|source code|implementation)\b|\b(?:what|which)\s+(?:ai|model|provider|backend|database|api|framework|stack)\b.{0,40}\b(?:do|does|are|is)\s+(?:you|lingon|arche|this (?:app|agent))\b|\b(?:are|is|do|does)\s+(?:you|lingon|arche|belna|this (?:app|agent))\s+(?:use|using|run|running|rely|relying|built|powered|based|hosted)\s+(?:on\s+|by\s+|with\s+|in\s+)?(?:gpt|chatgpt|openai|claude|anthropic|gemini|google|grok|kimi|llama|mistral|azure|microsoft|supabase|lovable|composio|firecrawl|aws|amazon|cloudflare|ai\b|llms?\b|an? (?:ai|llm|language model|model)\b)|\bis this (?:app|agent)\s+(?:using|built|powered|based|hosted)\b|\bhow (?:are|were) you (?:built|made|hosted|run)\b|\b(?:are you|is (?:lingon|arche))\s+(?:gpt|chatgpt|claude|gemini|grok|kimi|llama)\b|\b(?:how (?:do you|does (?:lingon|arche|belna|the agent|this (?:app|agent))) (?:work|run|operate) (?:internally|technically|under the hood)|(?:what|which).{0,20}(?:powers|runs|hosts) (?:you|lingon|arche|this (?:app|agent))|who (?:powers|built|made) (?:you|lingon|arche)|under the hood)\b)/i;
  return hiddenInstructions.test(text) || selfArchitecture.test(text);
}

// Only statements about the agent itself count. Work written for the owner talks about
// their own systems ("we move our database this weekend", "our API", "this app runs on
// Node"), and replacing it with a refusal threw away drafts they asked for.
function containsInternalDisclosure(answer) {
  const text = String(answer || '');
  return /\b(?:i(?:'m| am)|lingon|belna|this agent|the agent)\s+(?:is\s+|was\s+)?(?:powered by|built (?:on|with)|based on|hosted (?:on|by)|running on|runs? (?:on|inside))\b/i.test(text)
    || /\bmy\s+(?:underlying\s+)?(?:backend|provider|infrastructure|tech stack|system prompt|developer (?:message|instructions)|hidden instructions|harness)\b/i.test(text)
    || /\bmy\s+(?:underlying\s+)?(?:language\s+)?model\s+(?:is|was|comes|runs|uses)\b/i.test(text)
    || /\bi\s+(?:use|rely on|call|run on)\s+(?:gpt|chatgpt|claude|gemini|grok|kimi|llama|openai|anthropic|supabase|azure|foundry|composio|firecrawl|lovable)\b/i.test(text)
    || /\b(?:i am|i'm)\s+(?:gpt|chatgpt|claude|gemini|grok|kimi|llama)\b/i.test(text)
    || /\b(?:system prompt|developer message|hidden instructions)\s+(?:says|contains|is|are|instructs?)\b/i.test(text);
}

function protectAgentResponse(prompt, answer) {
  if (asksAboutInternalDetails(prompt) || containsInternalDisclosure(answer)) return INTERNAL_DETAILS_REPLY;
  return String(answer || '');
}

export { redact, checkPrompt, asksAboutInternalDetails, protectAgentResponse, INTERNAL_DETAILS_REPLY };
