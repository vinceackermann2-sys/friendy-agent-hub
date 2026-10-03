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
import { costOf, pricingFor, PLANS } from '../plans.js';
import * as store from '../store.js';
import { checkPrompt } from './guardrails.js';
import { entry, persistRun } from './tracing.js';
import { pickTools } from './tools.js';
import { fanOut } from './subagents.js';
import { compactIfNeeded } from './sessions.js';
import { realResearch } from '../research.js';

// Chat and task turns see the owner's local time. The per-turn block goes after the
// cached prompt prefix, so a changing clock never invalidates the cache.
function userTimeZone(value) {
  const zone = String(value || '').trim().slice(0, 64);
  if (!zone) return 'UTC';
  try { new Intl.DateTimeFormat('en-US', { timeZone: zone }); return zone; } catch { return 'UTC'; }
}
// The owner's country, from their time zone, so product searches show local stores and
// prices. Empty when the zone does not name one country.
const ZONE_COUNTRY = { Stockholm:'SE', Oslo:'NO', Copenhagen:'DK', Helsinki:'FI', Reykjavik:'IS', London:'GB', Dublin:'IE', Berlin:'DE', Paris:'FR',
  Madrid:'ES', Amsterdam:'NL', Rome:'IT', Lisbon:'PT', Warsaw:'PL', Vienna:'AT', Zurich:'CH', Brussels:'BE', Prague:'CZ', Tallinn:'EE', Riga:'LV', Vilnius:'LT',
  Toronto:'CA', Vancouver:'CA', Montreal:'CA', Edmonton:'CA', Winnipeg:'CA', Halifax:'CA', Sydney:'AU', Melbourne:'AU', Brisbane:'AU', Perth:'AU', Adelaide:'AU', Auckland:'NZ' };
const US_ZONE = /^America\/(?:New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Indiana|Kentucky|Boise)|^Pacific\/Honolulu$/;
function timeZoneCountry(value) {
  const zone = userTimeZone(value);
  if (US_ZONE.test(zone)) return 'US';
  return ZONE_COUNTRY[zone.split('/').pop()] || '';
}

function runtimeContext({ timeZone, now = new Date() } = {}) {
  const zone = userTimeZone(timeZone);
  const format = (date, options) => new Intl.DateTimeFormat('en-US', { timeZone: zone, ...options }).format(date);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'shortOffset' }).formatToParts(now).find((p) => p.type === 'timeZoneName')?.value || 'GMT';
  const days = Array.from({ length: 14 }, (_, i) => format(new Date(now.getTime() + i * 864e5), { weekday: 'short', month: 'short', day: 'numeric' })).join('; ');
  return `Current time: ${format(now, { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}, ${format(now, { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })} in ${zone} (${offset}). The year is ${format(now, { year: 'numeric' })}. Next 14 days: ${days}. Use this clock for every date, time and relative-date question ("today", "tomorrow", "next weekend") and write absolute dates in task briefs; never infer the date from training data.`;
}

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

async function modelAnswer({ agent, task, history, replyTo, systemExtra, model, signal, onDelta, attachments }) {
  const direct = currentTimeAnswer(task);
  if (direct) {
    // Keep streaming UX consistent even for instant clock answers:
    // emit in small chunks so the bubble updates instead of popping in.
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
  const r = await callFoundry({ prompt: replyContext + task, system, history: h2, model, signal, onDelta, attachments });
  return { text: r.text, usage: r.usage, model: r.model || model, compacted, compactUsage: costUsage || null };
}

async function logModelUsage(userId, model, usages) {
  for (const entry of usages.filter(Boolean)) {
    const u={...entry,model:entry.model || model};
    await store.logUsage(userId, { model: u.model || model, usage: {...u,pricing:pricingFor(u)},cost:costOf(u) });
  }
}

// Keep small supporting calls on the same accounting contract as chat and tasks.
// Provider errors carry usage when work was accepted before failure/cancellation.
async function callBilledModel(userId, options, { model, logUsage: bill, ensureCredit: credit }) {
  if (credit) await credit(userId);
  let result;
  try { result = await model(options); }
  catch (error) {
    if (error.usage) await bill(userId, [error.usage]);
    throw error;
  }
  if (result.usage) await bill(userId, [result.usage]);
  return result;
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

export { ensureCredit, modelAnswer, logModelUsage, callBilledModel, runResearch, fanOut, runtimeClock, runtimeContext, userTimeZone, timeZoneCountry, currentTimeAnswer };
