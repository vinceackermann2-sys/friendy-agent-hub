// Live evaluation of background task workers at their configured reasoning effort
// (xhigh by default). Not part of `npm test`: it spends tokens and takes minutes.
// The model, worker prompt, tool schemas, web search and product docs are real; task
// storage is in memory, and VM tools (browser, shell) fail, so no VM starts.
//   node tests/worker-agent.eval.cjs [--only clock]
require('dotenv').config();
const store = require('../server/store');
// No account data is read or written: permissions and host memory are fixed here.
store.getAgentPermissions = async () => ({ web: 'ask_some', connectors: 'ask_some', knownHosts: ['timewarpdev.com'] });
store.rememberBrowserHost = async () => {};
const { createTaskRuntime } = require('../server/agents/task-runtime');
const harness = require('../server/agents/vm-harness');
const { TOOLS } = require('../server/agents/tools');
const { READ_DOC_SCHEMA, READ_DOC_TOOL } = require('../server/agents/product-docs');
const { runtimeContext } = require('../server/agents/runner');
const { definitionFor } = require('../server/agents/upkeep');
const { AUTOMATION_SYSTEM } = require('../server/agents/automations');
const foundry = require('../server/foundry');

const args = process.argv.slice(2);
const only = args.includes('--only') ? args[args.indexOf('--only') + 1] : '';
const TZ = 'Europe/Stockholm';
const clone = (x) => (x == null ? x : structuredClone(x));
const fmt = (d, o) => new Intl.DateTimeFormat('en-US', { timeZone: TZ, ...o }).format(d);
const daysUntil = (month, day) => {
  const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()) + 'T00:00:00Z');
  return Math.round((Date.UTC(today.getUTCFullYear(), month - 1, day) - today) / 864e5);
};
const nextFriday = () => { const d = new Date(); for (let i = 1; i <= 7; i++) { const x = new Date(d.getTime() + i * 864e5); if (fmt(x, { weekday: 'long' }) === 'Friday') return x; } };
// Internals the owner should never see in a delivered answer.
const LEAKS = /\b(observation|obs_[a-z0-9]|tool call|web_search|read_doc|report_milestone|function call|worker|subtask)\b/i;

const CASES = [
  { id: 'clock', instructions: "What is the date next Friday, and how many days are left until New Year's Eve?",
    check: (r) => {
      const f = nextFriday();
      const day = Number(fmt(f, { day: 'numeric' })), month = fmt(f, { month: 'long' });
      const okDate = new RegExp(`${month}\\s+${day}\\b|\\b${day}\\s+${month}`, 'i').test(r.result);
      const okDays = new RegExp(`\\b${daysUntil(12, 31)}\\b`).test(r.result);
      return okDate && okDays ? '' : `expected ${month} ${day} and ${daysUntil(12, 31)} days`;
    } },
  { id: 'docs', instructions: 'How much does the Max plan cost per month and how many tokens does it include?',
    check: (r) => /\$?100/.test(r.result) && /200\s*(million|M)/i.test(r.result) ? '' : 'wrong plan facts' },
  { id: 'itinerary', instructions: 'Plan a relaxed 3-day Rome itinerary for Friday October 2 to Sunday October 4 with a rough daily budget in euros.',
    check: (r) => /€|eur/i.test(r.result) && /(fri|sat|sun)/i.test(r.result) ? '' : 'no budget or days' },
  { id: 'draft', instructions: 'Draft a short, friendly email to my landlord asking them to fix the dripping kitchen tap this week. Only draft it; do not send anything.',
    check: (r) => /tap|faucet/i.test(r.result) && !r.calls.includes('mail_send') ? '' : 'missing draft or tried to send' },
  { id: 'browser-down', instructions: 'Open timewarpdev.com in the browser and tell me the main headline on the page.',
    check: (r) => (r.calls.filter((n) => n === 'browser_open').length <= 2 ? '' : `retried the broken browser ${r.calls.filter((n) => n === 'browser_open').length} times`) },
  // Heartbeat: the daily goal study tells the owner about a concrete next step once, and
  // stays silent when there is no active goal.
  { id: 'heartbeat-goal', upkeep: 'study', signal: ['I really need to book a hut for the Abisko hike in October', 'Budget is 6000 kr for three nights'],
    tools: { goal_list: () => ({ goals: [{ id: 'g1', title: 'Hike in Abisko in October', status: 'active', steps: [{ text: 'Book a hut for three nights', done: false }, { text: 'Buy train tickets', done: false }] }] }),
      // Local search has no provider key; this stands in for real results so the case tests the notify decision.
      web_search: () => [{ url: 'search:abisko huts', ok: true, text: JSON.stringify({ results: [
        { title: 'Abiskojaure mountain cabin | STF', url: 'https://www.swedishtouristassociation.com/facilities/stf-abiskojaure-mountain-cabin/', snippet: 'Open until 2026-10-11. Beds from SEK 540 per night for members, SEK 690 for non-members. Book online; October weekdays usually have space.' },
        { title: 'Night train Stockholm–Abisko | SJ', url: 'https://www.sj.se/en/trains/abisko', snippet: 'Night trains run daily to Abisko Östra; October tickets from SEK 895 open for booking 90 days ahead.' }] }) }] },
    check: (r) => r.notes.length === 1 && r.notes[0].message.length <= 600 && /abisko/i.test(r.notes[0].message) ? '' : `expected one relevant note, got ${JSON.stringify(r.notes)}` },
  { id: 'heartbeat-quiet', upkeep: 'study', signal: ['I want to learn more about sourdough someday'],
    tools: { goal_list: () => ({ goals: [] }) },
    check: (r) => (r.notes.length === 0 ? '' : `notified without an active goal: ${JSON.stringify(r.notes)}`) },
];

function records() {
  const rows = new Map();
  return {
    rows,
    get: async (u, id) => clone(rows.get(id)),
    list: async (u, c) => [...rows.values()].filter((r) => r.user_id === u && r.chat_id === c).map(clone),
    team: async (u, id) => { const a = rows.get(id); return [...rows.values()].filter((r) => (r.state.teamId || r.id) === (a.state.teamId || a.id)).map(clone); },
    due: async () => [],
    create: async (row) => { row.revision = 1; rows.set(row.id, clone(row)); return clone(row); },
    claim: async (u, id, token) => { const r = rows.get(id); if (!r || r.lease) return null; r.lease = token; r.revision++; return clone(r); },
    write: async (row, state, token) => { const r = rows.get(row.id); if (r.revision !== row.revision || (token && token !== r.lease)) return null; r.state = clone(state); r.revision++; return clone(r); },
    release: async (u, id, token) => { const r = rows.get(id); if (r?.lease === token) r.lease = null; },
    messagePeer: async () => ({ ok: false }),
  };
}

async function runCase(c) {
  const rec = records(), calls = [], usage = { input: 0, output: 0, rounds: 0 };
  const broken = async () => { throw new Error('The browser could not start: the virtual computer is unavailable.'); };
  const tools = { ...TOOLS, read_doc: READ_DOC_TOOL };
  for (const name of ['browser_open', 'browser_action', 'browser_submit', 'computer_screenshot', 'computer_action', 'shell', 'code_run']) tools[name] = { ...TOOLS[name], run: broken };
  for (const name of Object.keys(tools).filter((n) => /^memory_|^system_file_|^goal_|^library_|^trigger_/.test(n))) tools[name] = { ...tools[name], run: async () => ({ ok: true, items: [] }) };
  for (const [name, fn] of Object.entries(c.tools || {})) tools[name] = { ...tools[name], run: async (args) => fn(args) };
  const notes = [];
  const runtime = createTaskRuntime({ records: rec, clock: runtimeContext, notify: async (userId, note) => { notes.push(note); }, schemas: [...harness.TOOL_SCHEMAS, READ_DOC_SCHEMA], selectSchemas: harness.selectToolSchemas, tools,
    azure: { getSandbox: async () => ({ mode: 'azure', vmName: 'vm-eval', location: 'swedencentral', vmSize: 'B2s' }), acquireLease: async () => {}, renewLease: async () => {}, releaseLease: async () => {} },
    memory: { list: async () => [], rank: (x) => x, finish: async () => [] }, buildSystem: harness.buildSystem, emitResultCard: harness.emitResultCard,
    checkPrompt: () => {}, ensureCredit: async () => {}, protect: (_, s) => s, logUsage: async () => {},
    model: async (opts) => {
      usage.rounds++;
      if (process.env.DEBUG) console.log(`  [${c.id}] round ${usage.rounds} tools=${opts.tools.map((t) => t.name).join(',')} choice=${opts.toolChoice}\n    history tail: ${opts.history.slice(-2).map((h) => h.text.slice(0, 160).replace(/\s+/g, ' ')).join(' | ')}\n    prompt: ${opts.prompt.slice(-200).replace(/\s+/g, ' ')}`);
      const r = await foundry.callFoundryWithTools(opts);
      if (process.env.DEBUG) console.log(`    -> ${(r.functionCalls || []).map((f) => `${f.name}(${JSON.stringify(f.args).slice(0, 80)})`).join(' ') || r.text.slice(0, 120)}`);
      usage.input += Number(r.usage?.input_tokens) || 0; usage.output += Number(r.usage?.output_tokens) || 0;
      for (const f of r.functionCalls || []) calls.push(f.name);
      return r;
    } });
  const started = Date.now();
  // Upkeep runs are built the way automations.js builds them.
  const def = c.upkeep ? definitionFor(c.upkeep) : null;
  const instructions = def
    ? `${AUTOMATION_SYSTEM}\n\n[Scheduled check-in at ${new Date().toISOString()}. New signal: ${JSON.stringify({ recentUserMessages: c.signal.map((text) => ({ at: new Date().toISOString(), text })) })}]\n\nAutomation task: ${def.prompt}`
    : c.instructions;
  const context = def
    ? { automation: true, upkeep: c.upkeep, allowedTools: def.allowedTools, maxRounds: def.maxRounds || 3, agent: { agent: { name: 'Everest', pers: 'Precise' } }, timeZone: TZ, originalPrompt: def.prompt }
    : { agent: { agent: { name: 'Everest', pers: 'Calm' } }, timeZone: TZ, originalPrompt: c.instructions };
  let row = await runtime.create({ userId: 'eval', chatId: `eval-${c.id}`, requestKey: c.id, title: c.id, instructions, history: [], context });
  // The owner declines every approval, so the worker has to finish with what it can do.
  let denied = 0;
  // Every task in the objective advances, as the production worker does: a parent that
  // started a parallel subtask waits for it and then combines the result.
  for (let i = 0; i < 60; i++) {
    const waiting = [...rec.rows.values()].find((r) => r.state.status === 'waiting_approval' && r.state.approval);
    if (waiting && denied < 10) {
      denied++;
      await runtime.control('eval', waiting.id, { action: 'decide', callId: waiting.state.approval.id, allow: false, version: waiting.state.version, requestId: `deny-${denied}` }, waiting.chat_id);
      continue;
    }
    if (!['queued', 'running', 'waiting_peers'].includes(rec.rows.get(row.id).state.status)) break;
    const ready = [...rec.rows.values()].filter((r) => ['queued', 'running', 'waiting_peers'].includes(r.state.status));
    if (!ready.length) break;
    for (const r of ready) await runtime.step('eval', r.id);
  }
  const state = rec.rows.get(row.id).state;
  const result = String(state.result || '');
  if (process.env.DEBUG) for (const o of state.observations) console.log(`  [${c.id}] ${o.name} ok=${o.ok}: ${o.text.slice(0, 300)}`);
  const r = { id: c.id, status: state.status, result, calls, denied, notes, ms: Date.now() - started, ...usage };
  const problems = [];
  if (!['completed', 'partial'].includes(state.status)) problems.push(`status ${state.status}`);
  if (!result.trim()) problems.push('no result');
  // What the owner reads: the delivered answer, or for upkeep only its notifications.
  const shown = c.upkeep ? notes.map((n) => n.message).join('\n') : result;
  if (LEAKS.test(shown)) problems.push(`leaks internals: ${shown.match(LEAKS)[0]}`);
  const first = shown.split(/(?<=[.!?])\s|\n/)[0] || '';
  if (first.length > 300) problems.push('does not lead with a short outcome');
  const p = c.check?.(r); if (p) problems.push(p);
  r.pass = !problems.length; r.problems = problems;
  return r;
}

(async () => {
  console.log(`worker eval: ${foundry.MODEL_DEFAULT} at ${foundry.REASONING_EFFORT} effort`);
  const results = await Promise.all(CASES.filter((c) => !only || c.id.startsWith(only)).map(runCase));
  for (const r of results) {
    console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} [${r.status}] ${(r.ms / 1000).toFixed(1)}s rounds=${r.rounds} in=${r.input} out=${r.output} denied=${r.denied} calls=${r.calls.join(',') || '-'}`);
    if (!r.pass) console.log(`     ${r.problems.join('\n     ')}`);
    console.log(`     > ${r.result.replace(/\s+/g, ' ').slice(0, 400)}`);
    for (const note of r.notes) console.log(`     notify_owner > ${note.message}`);
  }
  console.log(`passed ${results.filter((r) => r.pass).length}/${results.length}`);
})().catch((e) => { console.error(e); process.exit(1); });
