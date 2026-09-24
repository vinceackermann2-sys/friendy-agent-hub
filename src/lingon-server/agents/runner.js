/* Runner — single entry mirroring Agents API sessions.create():
     Runner.run({ userId, sessionId, agent, task, history, tools,
                  environment: 'self-hosted-sandbox', vault: 'refs-only',
                  githubPat })
   - Picks relevant tools (tool search), fans out subagents (max 3),
   - enforces guardrails + credits, compacts long sessions,
   - returns { output, trace, usage } with every step traceable.
   Model: Microsoft Foundry (server key). Shape: Agents API. Extras: auth, vault refs,
   approvals (frontend-gated for github_*), billing, Supabase persistence.
*/
import { callFoundry, MODEL_DEFAULT } from '../foundry.js';
import { costOf, PLANS } from '../plans.js';
import * as store from '../store.js';
import { checkPrompt } from './guardrails.js';
import { entry, persistRun } from './tracing.js';
import { pickTools } from './tools.js';
import { fanOut } from './subagents.js';
import { compactIfNeeded } from './sessions.js';
import { realResearch } from '../research.js';

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
  const sub = await store.getSubscription(userId);
  const paid = ['active', 'canceling', 'trialing'].includes(sub.status)
    && (!sub.current_period_end || new Date(sub.current_period_end).getTime() > Date.now());
  const plan = paid && PLANS[sub.plan] ? sub.plan : 'free';
  const wallet = await store.getTokenWallet(userId, plan, sub.current_period_end);
  if (wallet.remaining <= 0) {
    const e = new Error(`You've used your available tokens. Your monthly allowance resets ${wallet.resetAt || 'at your next billing cycle'}. Upgrade under Billing or add a token pack under Usage.`);
    e.code = 'NO_CREDIT';
    e.upgrade_required = true;
    throw e;
  }
}

async function modelAnswer({ agent, task, history, replyTo, systemExtra, model, signal, onDelta }) {
  const direct = currentTimeAnswer(task);
  if (direct) {
    if (typeof onDelta === 'function') {
      const parts = String(direct).match(/(\s+|[^\s]+)/g) || [direct];
      let full = '';
      for (const p of parts) {
        full += p;
        try { onDelta(p, full); } catch {}
      }
    }
    return { text: direct, usage: null, model: 'server-clock', compacted: false, compactUsage: null, direct: true };
  }
  const { history: h2, compacted, costUsage } = await compactIfNeeded({ history, model });
  // The clock changes every second, so it goes last to keep the instructions a cacheable prefix.
  const system = `${agent.instructions || ''}${systemExtra || ''}\n\n${runtimeClock()}`;
  const replyContext = replyTo && replyTo.text
    ? `[The user is replying to this ${replyTo.role === 'user' ? 'user' : 'assistant'} message: ${String(replyTo.text).slice(0, 500)}]\n\n`
    : '';
  const r = await callFoundry({ prompt: replyContext + task, system, history: h2, model, signal, onDelta });
  return { text: r.text, usage: r.usage, model: r.model || model, compacted, compactUsage: costUsage || null };
}

async function logModelUsage(userId, model, usages) {
  for (const u of usages.filter(Boolean)) {
    await store.logUsage(userId, { model: u.model || model, usage: u, cost: costOf(u) });
  }
}

/* Research run: parallel subagent fetch (3 sources) + real browser open + summary. */
async function runResearch({ userId, sessionId, query, trace, push, signal }) {
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

export { ensureCredit, modelAnswer, logModelUsage, runResearch, fanOut, runtimeClock, currentTimeAnswer };
