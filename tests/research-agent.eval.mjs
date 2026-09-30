// Live end-to-end eval of research requests on the code belna.se runs (the edge build in
// src/lingon-server): chat reply -> task -> worker -> final answer, with the real model,
// real web search and real page reads. Storage is in memory; no VM, no connected apps.
// Each answer is checked for completeness and for excuses about sources.
// Not part of `npm test`: it spends tokens.
//   node tests/research-agent.eval.mjs [--only pm] [--debug]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
require('dotenv').config();
// No account data: storage, the VM and connected apps stay off for this run.
for (const key of Object.keys(process.env)) if (/^(LINGON_)?SUPABASE_|^AZURE_(SUBSCRIPTION|TENANT|CLIENT|RESOURCE)|^COMPOSIO/.test(key)) delete process.env[key];

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const debug = args.includes('--debug');
const edge = (p) => import(new URL(`../src/lingon-server/${p}`, import.meta.url));
const [{ createCoordinator }, { createTaskRuntime }, { TOOLS }, harness, docs, runner, foundry, { permissionDecision }] = await Promise.all([
  edge('agents/conversation.js'), edge('agents/task-runtime.js'), edge('agents/tools.js'), edge('agents/vm-harness.js'),
  edge('agents/product-docs.js'), edge('agents/runner.js'), edge('foundry.js'), edge('agents/permission-policy.js')]);

const TZ = 'Europe/Stockholm';
// Honest gaps are reported as partial; phrasing alone is never a quality failure.
const count = (re, text) => (String(text).match(re) || []).length;
const CASES = [
  { id: 'pm', prompt: 'What are the 5 best project management tools for a small agency, and what does each cost per user per month?',
    check: (t,r) => (count(/(\$|€|£|kr|USD|EUR)\s?\d|\d+(\.\d+)?\s?(\$|€|kr|USD|EUR)/g, t+' '+r.cardText) >= 5 ? '' : 'fewer than 5 prices') },
  { id: 'site', prompt: 'What does timewarpdev.com offer? Give me the main features.',
    check: (t) => (/timewarp/i.test(t) && t.length > 250 ? '' : 'thin site summary') },
  { id: 'news', prompt: 'What are the 3 biggest AI news stories from this week?',
    check: (t) => (count(/^\s*(\d+[.)]|[-*•])\s+/gm, t) >= 3 || /present/.test(t) ? '' : 'fewer than 3 stories') },
  { id: 'restaurants', prompt: 'Find 8 highly rated Italian restaurants on Södermalm in Stockholm, with their addresses.',
    check: (t, r) => (count(/\d{1,3}[A-Z]?\b[^\n]{0,30}(gatan|vägen|gränd|torg|plan|backe|väg|gata)|(gatan|vägen|gränd|torg|backe|väg|gata)\s+\d/gi, t + ' ' + r.cardText) >= 8 ? '' : 'fewer than 8 addresses') },
  { id: 'spotify', prompt: "What were Spotify's revenue and operating income in its most recent quarterly report?",
    check: (t) => (/(revenue|intäkt)/i.test(t) && count(/€\s?\d|\d[\d.,]*\s?(billion|million|bn|m)\b/gi, t) >= 2 ? '' : 'missing the figures') },
  { id: 'compare', prompt: 'Compare the pricing plans of Notion, ClickUp and Asana.',
    check: (t, r) => (r.cards.includes('present') || /\|.*\|/.test(t) ? '' : 'no comparison table') },
  { id: 'article', prompt: 'Summarize this article for me: https://en.wikipedia.org/wiki/Lingonberry',
    check: (t) => (/vaccinium/i.test(t) && t.length > 400 ? '' : 'thin summary') },
  { id: 'swedish', prompt: 'Vad kostar ett 30-dagarsbiljett för vuxen på SL just nu?',
    check: (t) => (/\d[\d\s]*\s?kr/i.test(t) && /\b(och|är|för|kostar)\b/i.test(t) ? '' : 'no price in Swedish') },
];

function records() {
  const rows = new Map(), clone = (x) => (x == null ? x : structuredClone(x));
  return {
    get: async (u, id) => clone(rows.get(id)),
    list: async (u, c) => [...rows.values()].filter((r) => r.user_id === u && r.chat_id === c).map(clone),
    team: async (u, id) => { const a = rows.get(id); return [...rows.values()].filter((r) => (r.state.teamId || r.id) === (a.state.teamId || a.id)).map(clone); },
    due: async () => [],
    create: async (row) => { row.revision = 1; rows.set(row.id, clone(row)); return clone(row); },
    claim: async (u, id, token) => { const r = rows.get(id); if (!r || r.lease) return null; r.lease = token; r.revision++; return clone(r); },
    write: async (row, state, token) => { const r = rows.get(row.id); if (r.revision !== row.revision || (token && token !== r.lease)) return null; r.state = clone(state); r.revision++; return clone(r); },
    release: async (u, id, token) => { const r = rows.get(id); if (r?.lease === token) r.lease = null; },
    messagePeer: async () => ({ ok: false }),
    rows,
  };
}

async function runCase(c) {
  const usage = { calls: 0, input: 0, output: 0 }, fns = [];
  const model = async (opts) => {
    usage.calls++;
    const r = await foundry.callFoundryWithTools(opts);
    usage.input += Number(r.usage?.input_tokens) || 0; usage.output += Number(r.usage?.output_tokens) || 0;
    for (const f of r.functionCalls || []) fns.push(f.name);
    if (debug) console.log(`  [${c.id}] -> ${(r.functionCalls || []).map((f) => `${f.name}(${JSON.stringify(f.args).slice(0, 90)})`).join(' ') || String(r.text).slice(0, 100).replace(/\n/g, ' ')}`);
    return r;
  };
  const rec = records();
  const sandbox = { mode: 'local' };
  const common = { ensureCredit: async () => {}, logUsage: async () => {}, checkPrompt: () => {}, protect: (_, s) => s };
  // The VM browser is off in this run; it behaves as in production: it returns the page, slowly.
  const { readPage } = await edge('agents/public-web.js');
  const slowBrowser = { ...TOOLS.browser_open, run: async ({ url }) => {
    await new Promise((resolve) => setTimeout(resolve, 8000));
    const page = await readPage(url, { maxChars: 3000 });
    return { ok: true, url: page.url, title: page.title, text: page.text, elements: [] };
  } };
  const tasks = createTaskRuntime({ records: rec, model, clock: runner.runtimeContext, schemas: [...harness.TOOL_SCHEMAS, docs.READ_DOC_SCHEMA], selectSchemas: harness.selectToolSchemas,
    // Clicks and typing need the VM: they fail cleanly here, as an unavailable tool would.
    tools: { ...TOOLS, read_doc: docs.READ_DOC_TOOL, browser_open: slowBrowser, computer_screenshot: slowBrowser,
      browser_action: { ...TOOLS.browser_action, run: async () => ({ ok: false, error: 'Clicking and typing are not available in this test; read pages with web_search urls.' }) },
      browser_submit: { ...TOOLS.browser_submit, run: async () => ({ ok: false, error: 'Not available in this test.' }) } }, azure: { getSandbox: async () => sandbox, acquireLease: async () => {}, renewLease: async () => {}, releaseLease: async () => {} },
    buildSystem: harness.buildSystem, emitResultCard: harness.emitResultCard, memory: { list: async () => [], search: async () => [], rank: (x) => x, finish: async () => [] }, ...common });
  const coordinator = createCoordinator({ tasks, model, schemas: harness.TOOL_SCHEMAS, tools: TOOLS, azure: { getSandbox: async () => sandbox },
    store: { listMemories: async () => [], saveTurn: async () => {} }, buildSystem: harness.buildSystem, memoryContext: harness.memoryContext, permission: permissionDecision,
    rank: (x) => x, finishMemory: async () => [], reasoningEffort: foundry.CHAT_REASONING_EFFORT, ...common });
  const events = [], started = Date.now();
  let error = '';
  try {
    await coordinator.run({ userId: 'eval', chatId: `eval-${c.id}`, requestId: `${c.id}-${Date.now()}`, prompt: c.prompt, history: [],
      context: { agent: { name: 'Everest', pers: 'Calm' }, timeZone: TZ, userMessageId: 'm1' }, onEvent: (e) => events.push(e) });
  } catch (e) { error = e.message; }
  const replyMs = Date.now() - started;
  const task = [...rec.rows.values()][0];
  let denied = 0;
  // The worker runs to its answer; approvals are declined so nothing acts outside the test.
  // Every task in the objective advances, as the production worker does, including subtasks.
  for (let i = 0; task && i < 80; i++) {
    const waiting = [...rec.rows.values()].find((r) => r.state.status === 'waiting_approval' && r.state.approval);
    if (waiting) { denied++; await tasks.control('eval', waiting.id, { action: 'decide', callId: waiting.state.approval.id, allow: false, version: waiting.state.version, requestId: `deny-${denied}` }, waiting.chat_id); continue; }
    if (!['queued', 'running', 'waiting_peers'].includes(rec.rows.get(task.id).state.status)) break;
    const ready = [...rec.rows.values()].filter((r) => ['queued', 'running', 'waiting_peers'].includes(r.state.status));
    for (const r of ready) await tasks.step('eval', r.id);
  }
  const state = task ? rec.rows.get(task.id).state : null;
  const cards = [...events.filter((e) => e.type === 'card').map((e) => e.card), ...(state?.events || []).filter((e) => e.type === 'card').map((e) => e.card)];
  const answer = state ? String(state.result || '') : String(events.filter((e) => e.type === 'message').at(-1)?.text || '');
  const cardText = cards.map((card) => JSON.stringify(card.items || card.rows || '')).join(' ');
  const r = { id: c.id, route: task ? 'task' : 'answer', status: state?.status || 'answered', replyMs, totalMs: Date.now() - started, ...usage, denied, cards: cards.map((x) => x.type), fns, answer, cardText, error };
  const problems = [];
  if (error) problems.push(`error: ${error}`);
  if (task && state.status !== 'completed') problems.push(`task ${state.status}`);
  if (!answer.trim()) problems.push('no answer');

  const p = c.check(answer, r); if (p) problems.push(p);
  r.pass = !problems.length; r.problems = problems;
  return r;
}

console.log(`research eval on the edge build: ${foundry.MODEL_DEFAULT}, chat ${foundry.CHAT_REASONING_EFFORT}, worker ${foundry.REASONING_EFFORT}`);
// Two cases at a time: bursts of searches get a machine rate-limited by free search.
const selected = CASES.filter((c) => !only || c.id.startsWith(only)), results = [];
const concurrency = Number(args.includes('--concurrency') ? args[args.indexOf('--concurrency') + 1] : 2);
let next = 0;
await Promise.all(Array.from({ length: Math.min(concurrency, selected.length) }, async () => { while (next < selected.length) results.push(await runCase(selected[next++])); }));
for (const r of results) {
  console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} [${r.route}/${r.status}] reply ${(r.replyMs / 1000).toFixed(1)}s total ${(r.totalMs / 1000).toFixed(1)}s calls=${r.calls} in=${r.input} out=${r.output} cards=${r.cards.join(',') || '-'} tools=${[...new Set(r.fns)].join(',')}`);
  if (!r.pass) console.log(`     ${r.problems.join('\n     ')}`);
  console.log(`     > ${r.answer.replace(/\s+/g, ' ').slice(0, 700)}`);
}
console.log(`passed ${results.filter((r) => r.pass).length}/${results.length}; avg input ${Math.round(results.reduce((a, r) => a + r.input, 0) / results.length)} tokens`);

if(results.some(r=>!r.pass))process.exitCode=1;
