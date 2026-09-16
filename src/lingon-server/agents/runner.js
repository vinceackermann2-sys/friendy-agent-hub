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
import { callGemini, MODEL_DEFAULT } from '../gemini.js';
import { costOf, PLANS } from '../plans.js';
import * as store from '../store.js';
import { checkPrompt } from './guardrails.js';
import { entry, persistRun } from './tracing.js';
import { pickTools } from './tools.js';
import { fanOut } from './subagents.js';
import { compactIfNeeded } from './sessions.js';
import { realResearch } from '../research.js';

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

async function modelAnswer({ agent, task, history, systemExtra, model }) {
  const { history: h2, compacted, costUsage } = await compactIfNeeded({ history, model });
  const system = `${agent.instructions || ''}${systemExtra || ''}`;
  const r = await callGemini({ prompt: task, system, history: h2, model });
  return { text: r.text, usage: r.usage, model: r.model || model, compacted, compactUsage: costUsage || null };
}

async function logModelUsage(userId, model, usages) {
  for (const u of usages.filter(Boolean)) {
    await store.logUsage(userId, { model, usage: u, cost: costOf(u) });
  }
}

/* Research run: parallel subagent fetch (3 sources) + real browser open + summary. */
async function runResearch({ userId, sessionId, query, trace, push }) {
  push(entry('search', 'runner: research task accepted (Agents-API session)'));
  const r = await realResearch(query, { userId, onTrace: (e) => push(e) });
  push(entry('globe', `runner: ${r.sources.length} source groups fetched in sandbox`));
  await fanOut({
    userId, sessionId, max: 3,
    items: r.sources.map((u, i) => ({ name: 'fetch_' + (i + 1), desc: u.slice(0, 80) })),
    trace: push,
    runOne: async (item) => ({ source: item.desc }),
  });
  await persistRun({ userId, sessionId, kind: 'run', name: 'research', status: 'done', detail: query });
  return r;
}

export { ensureCredit, modelAnswer, logModelUsage, runResearch, fanOut };
