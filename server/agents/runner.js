/* Runner — single entry mirroring Agents API sessions.create():
     Runner.run({ userId, sessionId, agent, task, history, tools,
                  environment: 'self-hosted-sandbox', vault: 'refs-only',
                  githubPat })
   - Picks relevant tools (tool search), fans out subagents (max 3),
   - enforces guardrails + credits, compacts long sessions,
   - returns { output, trace, usage } with every step traceable.
   Model: Gemini (our key). Shape: Agents API. Extras: auth, vault refs,
   approvals (frontend-gated for github_*), billing, Supabase persistence.
*/
const { callGemini, MODEL_DEFAULT } = require('../gemini');
const { costOf, PLANS } = require('../plans');
const store = require('../store');
const { checkPrompt } = require('./guardrails');
const { entry, persistRun } = require('./tracing');
const { pickTools } = require('./tools');
const { fanOut } = require('./subagents');
const { compactIfNeeded } = require('./sessions');

function runtimeClock(now = new Date()) {
  const iso = now.toISOString();
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(now);
  return `RUNTIME CLOCK: The authoritative current date is ${date}. The authoritative current UTC timestamp is ${iso}. Use this clock for all date and time reasoning; never infer the current date from training data.`;
}

function currentTimeAnswer(task, now = new Date()) {
  const text = String(task || '').trim().toLowerCase().replace(/[?.!]+$/g, '');
  const asksForClock = /^(?:(?:what|which)\s+(?:is\s+)?(?:the\s+)?(?:current\s+)?(?:date|day|month|year)(?:\s+is\s+it)?(?:\s+(?:today|now))?|what\s+time\s+is\s+it(?:\s+now)?|what(?:'s|\s+is)\s+today'?s\s+date|today'?s\s+date|date\s+today|current\s+(?:date|time|year))$/i.test(text);
  if (!asksForClock) return null;
  const date = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', weekday: 'long', year: 'numeric', month: 'long', day: 'numeric',
  }).format(now);
  const time = new Intl.DateTimeFormat('en-US', {
    timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
  }).format(now);
  return `Today is ${date}. The current time is ${time} UTC.`;
}

async function ensureCredit(userId) {
  await store.ensureFreeGrant(userId);
  const granted = await store.grantsTotal(userId);
  const used = await store.creditsUsed(userId);
  if (used >= granted - 1e-9) {
    const e = new Error(`You're out of credits (${used.toFixed(1)} of ${granted.toFixed(0)} used). Upgrade your plan or redeem a gift card under Billing.`);
    e.code = 'NO_CREDIT';
    e.upgrade_required = true;
    throw e;
  }
}

async function modelAnswer({ agent, task, history, replyTo, systemExtra, model, signal }) {
  const direct = currentTimeAnswer(task);
  if (direct) return { text: direct, usage: null, model: 'server-clock', compacted: false, compactUsage: null, direct: true };
  const { history: h2, compacted, costUsage } = await compactIfNeeded({ history, model });
  const system = `${runtimeClock()}\n\n${agent.instructions || ''}${systemExtra || ''}`;
  const replyContext = replyTo && replyTo.text
    ? `[The user is replying to this ${replyTo.role === 'user' ? 'user' : 'assistant'} message: ${String(replyTo.text).slice(0, 500)}]\n\n`
    : '';
  const r = await callGemini({ prompt: replyContext + task, system, history: h2, model, signal });
  return { text: r.text, usage: r.usage, model: r.model || model, compacted, compactUsage: costUsage || null };
}

async function logModelUsage(userId, model, usages) {
  for (const u of usages.filter(Boolean)) {
    await store.logUsage(userId, { model, usage: u, cost: costOf(u) });
  }
}

/* Research run: parallel subagent fetch (3 sources) + real browser open + summary. */
async function runResearch({ userId, sessionId, query, trace, push, signal }) {
  const { realResearch } = require('../research');
  push(entry('search', 'research task accepted'));
  const r = await realResearch(query, { userId, signal, onTrace: (e) => push(e) });
  push(entry('globe', `${r.sources.length} source groups checked`));
  await fanOut({
    userId, sessionId, max: 3,
    items: r.sources.map((u, i) => ({ name: 'fetch_' + (i + 1), desc: u.slice(0, 80) })),
    trace: push,
    runOne: async (item) => ({ source: item.desc }),
  });
  await persistRun({ userId, sessionId, kind: 'run', name: 'research', status: 'done', detail: query });
  return r;
}

module.exports = { ensureCredit, modelAnswer, logModelUsage, runResearch, fanOut, runtimeClock, currentTimeAnswer };
