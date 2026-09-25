// Live evaluation of the chat agent (the fast coordinator) against the real model.
// Not part of `npm test`: it spends tokens. Storage, tasks and memory are stubbed;
// the model, system prompt, tool schemas and web search are real.
//   node tests/chat-agent.eval.cjs [--runs 2] [--only clock] [--server path/to/server]
require('dotenv').config();
const path = require('node:path');
const args = process.argv.slice(2);
const flag = (name, fallback) => { const i = args.indexOf(`--${name}`); return i >= 0 ? args[i + 1] : fallback; };
const serverDir = path.resolve(flag('server', path.join(__dirname, '..', 'server')));
const runs = Number(flag('runs', 2));
const only = flag('only', '');
const concurrency = Number(flag('concurrency', 4));

const { createCoordinator } = require(path.join(serverDir, 'agents', 'conversation'));
const harness = require(path.join(serverDir, 'agents', 'vm-harness'));
const { TOOLS } = require(path.join(serverDir, 'agents', 'tools'));
const foundry = require(path.join(serverDir, 'foundry'));

const TZ = 'Europe/Stockholm';
const now = () => new Date();
const fmt = (d, o, tz = TZ) => new Intl.DateTimeFormat('en-US', { timeZone: tz, ...o }).format(d);
const weekday = (offsetDays = 0, tz = TZ) => fmt(new Date(Date.now() + offsetDays * 864e5), { weekday: 'long' }, tz);
const monthDay = (offsetDays = 0, tz = TZ) => new Date(Date.now() + offsetDays * 864e5);
function mentionsDate(text, d, tz = TZ) {
  const day = Number(fmt(d, { day: 'numeric' }, tz)), month = fmt(d, { month: 'long' }, tz), short = fmt(d, { month: 'short' }, tz);
  const iso = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  const sv = ['januari','februari','mars','april','maj','juni','juli','augusti','september','oktober','november','december'][Number(iso.slice(5, 7)) - 1];
  return new RegExp(`(${month}|${short}|${sv})\\.?\\s+${day}\\b|\\b${day}(st|nd|rd|th)?\\s+(of\\s+)?(${month}|${short}|${sv})|${iso}`, 'i').test(text);
}
function hourNear(text, tz = TZ) {
  const h = Number(fmt(now(), { hour: '2-digit', hourCycle: 'h23' }, tz));
  const found = [...text.matchAll(/\b(\d{1,2})[:.](\d{2})\b/g)].map(m => Number(m[1]));
  const pm = /\bpm\b/i.test(text);
  return found.some(x => [x, pm && x < 12 ? x + 12 : x].some(v => Math.abs(v - h) <= 1 || Math.abs(v - h) === 23));
}
const daysUntil = (month, day) => {
  const today = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now()) + 'T00:00:00Z');
  let target = new Date(Date.UTC(today.getUTCFullYear(), month - 1, day));
  if (target < today) target = new Date(Date.UTC(today.getUTCFullYear() + 1, month - 1, day));
  return Math.round((target - today) / 864e5);
};
const year = () => fmt(now(), { year: 'numeric' });

// expect: 'answer' | 'task' | 'any'. check(result) returns an error string or ''.
const CASES = [
  { id: 'clock.date', prompt: "What's today's date?", expect: 'answer',
    check: r => mentionsDate(r.text, now()) && r.text.includes(weekday()) ? '' : `wrong date: ${r.text}` },
  { id: 'clock.time', prompt: 'What time is it right now?', expect: 'answer',
    check: r => hourNear(r.text) ? '' : `wrong time: ${r.text}` },
  { id: 'clock.tomorrow', prompt: 'What day of the week is it tomorrow?', expect: 'answer',
    check: r => r.text.includes(weekday(1)) ? '' : `expected ${weekday(1)}: ${r.text}` },
  { id: 'clock.christmas', prompt: 'How many days until Christmas Day?', expect: 'answer',
    check: r => new RegExp(`\\b${daysUntil(12, 25)}\\b`).test(r.text) ? '' : `expected ${daysUntil(12, 25)}: ${r.text}` },
  { id: 'clock.swedish', prompt: 'Hej! Vilket datum är det idag?', expect: 'answer',
    check: r => mentionsDate(r.text, now()) ? '' : `wrong date: ${r.text}` },
  { id: 'clock.nextweek', prompt: 'What is the date next Monday?', expect: 'answer',
    check: r => { const wd = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'].indexOf(weekday()); const add = ((1 - wd + 7) % 7) || 7; return mentionsDate(r.text, monthDay(add)) ? '' : `expected ${fmt(monthDay(add), { month: 'long', day: 'numeric' })}: ${r.text}`; } },
  { id: 'know.capital', prompt: 'Capital of Australia?', expect: 'answer',
    check: r => /canberra/i.test(r.text) ? '' : r.text },
  { id: 'know.poem', prompt: 'Write a four-line poem about lingonberries.', expect: 'answer',
    check: r => r.text.split('\n').filter(l => l.trim()).length >= 4 ? '' : `short poem: ${r.text}` },
  { id: 'know.math', prompt: 'If I save 350 kr a week, how much do I have after a year?', expect: 'answer',
    check: r => /18[\s,.]?200/.test(r.text) ? '' : r.text },
  { id: 'lookup.news', prompt: 'Who won the most recent Formula 1 Grand Prix?', expect: 'any',
    check: r => r.route === 'task' || r.searched ? '' : `answered without search: ${r.text}` },
  { id: 'work.site', prompt: 'Go to timewarpdev.com and tell me what the main headline says', expect: 'task' },
  { id: 'work.game', prompt: 'Make me a tic tac toe game', expect: 'task' },
  { id: 'work.trip', prompt: 'Plan a 3 day trip to Rome for next weekend and find hotels under 150 euro', expect: 'task', allowAsk: true,
    check: r => !r.instructions || !/\b20(2[0-5])\b/.test(r.instructions) ? '' : `stale year in brief: ${r.instructions}` },
  { id: 'work.watch', prompt: 'Keep an eye on the price of AirPods Pro and tell me if it drops below 2000 kr', expect: 'task' },
  { id: 'work.spreadsheet', prompt: 'Put together a spreadsheet of the 10 biggest Swedish companies by revenue', expect: 'task' },
  { id: 'chat.capability', prompt: 'What can you do for me?', expect: 'answer',
    check: r => r.text.length > 40 ? '' : r.text },
  { id: 'chat.style', prompt: 'hi!', expect: 'answer',
    check: r => r.text.length < 220 && !/great question|happy to help|how can i assist/i.test(r.text) ? '' : `stiff or long greeting: ${r.text}` },
  // Read-only account lookups answer in chat from the tool data.
  { id: 'app.shop', prompt: 'How much can I still spend with Shop Pay today?', expect: 'answer',
    tools: { shop_status: () => ({ connected: true, dailyLimit: 5000, spentToday: 1250, remainingToday: 3750, currency: 'SEK', recentOrders: [] }) },
    check: r => /3[\s,.]?750/.test(r.text) && r.fns.includes('shop_status') ? '' : `wrong budget: ${r.text}` },
  { id: 'app.mailbox', prompt: 'Did you get any new email?', expect: 'answer',
    tools: { mail_status: () => ({ address: 'everest@mail.belna.se', unread: 1, sendReady: true }),
      mail_list: () => ({ folder: 'inbox', messages: [{ id: 'mail_1', from: 'Anna Berg <anna@studio.se>', subject: 'Moodboard for the launch', receivedAt: '2026-09-25T07:12:00Z', unread: true, preview: 'Hi! Here is the moodboard we talked about.' }] }) },
    check: r => /anna/i.test(r.text) && /moodboard/i.test(r.text) ? '' : `missed the email: ${r.text}` },
  { id: 'app.connected', prompt: 'Which apps have I connected?', expect: 'answer',
    tools: { composio_apps: () => ([{ toolkit: 'gmail', status: 'ACTIVE' }, { toolkit: 'googlecalendar', status: 'ACTIVE' }]) },
    check: r => /gmail/i.test(r.text) && /calendar/i.test(r.text) ? '' : `missed connected apps: ${r.text}` },
  { id: 'app.gmail', prompt: 'Summarize the latest emails in my Gmail', expect: 'task' },
  // Product questions are answered from read_doc, not guessed.
  { id: 'doc.billing', prompt: 'How much is Pro and how many tokens does it include?', expect: 'answer',
    check: r => /\$?50/.test(r.text) && /100\s*(million|M)/i.test(r.text) ? '' : `wrong plan facts: ${r.text}` },
  { id: 'doc.approvals', prompt: 'Will you ever buy something without asking me first?', expect: 'answer',
    check: r => /approv|ask|confirm/i.test(r.text) && !/\byes\b[^.]*without asking/i.test(r.text) ? '' : `unclear approval answer: ${r.text}` },
  { id: 'memory.remember', prompt: 'Remember that I am vegetarian', expect: 'answer',
    check: r => r.text.length > 0 && r.text.length < 300 ? '' : `odd memory reply: ${r.text}` },
  // Without the per-message extraction call, the agent itself must save durable facts.
  { id: 'memory.implicit', prompt: 'A quick fact about me: my exact project codename is project-4417.', expect: 'answer',
    check: r => r.fns.includes('memory_write') ? '' : `did not save the fact: ${r.fns.join(',') || 'no calls'}` },
  // Older context survives through the running summary.
  { id: 'summary.recall', prompt: "What's my dog called again?", expect: 'answer',
    summary: 'The owner has a border collie named Pixel who is afraid of thunder. They are planning a hiking trip to Abisko in October.',
    history: [['user', 'Can you suggest a good rain jacket?'], ['agent', 'A Fjällräven Keb Eco-Shell is a solid pick.'], ['user', 'Thanks'], ['agent', 'Anytime.']],
    check: r => /pixel/i.test(r.text) ? '' : `lost the summary: ${r.text}` },
  // A message cut off by the owner's next one is handled together with it.
  { id: 'interrupt.merge', interrupt: ['Book a table at Pizzeria Bella tonight', 'Actually make it 4 people at 7pm'], expect: 'any',
    // A clarifying question about the restaurant is fine, but it must be in English.
    check: r => { const all = `${r.text} ${r.instructions}`; if (r.route === 'ask') return /bella/i.test(all) && !/\b(vilken|eller|gäller)\b/i.test(all) ? '' : `bad question: ${all}`;
      return /bella/i.test(all) && /\b(4|four)\b/i.test(all) ? '' : `dropped part of the request: ${all}`; } },
  // The owner writes in English from a Swedish time zone: the reply stays in English.
  { id: 'chat.language', prompt: 'Any tips for a rainy Sunday?', expect: 'answer',
    check: r => /\b(the|and|you)\b/i.test(r.text) && !/\b(och|du|att)\b/i.test(r.text) ? '' : `wrong language: ${r.text}` },
];

function stubs(calls, c) {
  const tasks = {
    summaries: async () => [],
    create: async (t) => { calls.task = t; return { id: 'task_1', state: { title: t.title, status: 'queued', version: 1, events: [] }, revision: 1 }; },
    view: (row) => ({ id: row.id, title: row.state.title, status: row.state.status }),
  };
  const tools = { ...TOOLS };
  for (const name of Object.keys(tools)) if (!['web_search'].includes(name)) tools[name] = { run: async () => ({ items: [], note: 'Nothing stored yet.' }) };
  // Writes answer the way the real store does, with the saved row.
  tools.memory_write = { run: async (args) => ({ id: 'mem_eval', text: String(args.text || ''), category: args.category || 'long_term', status: 'active' }) };
  tools.memory_update = { run: async (args) => ({ id: args.id || 'mem_eval', text: String(args.text || ''), status: 'active' }) };
  for (const [name, fn] of Object.entries(c.tools || {})) tools[name] = { run: async (args) => fn(args) };
  return { tasks, tools };
}

async function runCase(c, variant) {
  const calls = { model: 0, input: 0, cached: 0, output: 0 };
  const events = [];
  const { tasks, tools } = stubs(calls, c);
  let timing = {};
  const model = async (opts) => {
    calls.model++;
    const r = await foundry.callFoundryWithTools(opts);
    calls.input += Number(r.usage?.input_tokens) || 0;
    calls.cached += Number(r.usage?.input_tokens_details?.cached_tokens) || 0;
    calls.output += Number(r.usage?.output_tokens) || 0;
    for (const f of r.functionCalls || []) (calls.fns ||= []).push(f.name);
    return r;
  };
  const coordinator = createCoordinator({ tasks, model, schemas: harness.TOOL_SCHEMAS, tools, azure: { getSandbox: async () => ({ mode: 'azure', vmName: 'vm-eval', location: 'swedencentral', vmSize: 'B2s' }) },
    store: { listMemories: async () => [], saveTurn: async () => {},
      listChatMessages: async () => (c.history || []).map(([role, text], i) => ({ id: `h${i}`, role, text, created_at: new Date(Date.now() - (60 - i) * 60_000).toISOString() })),
      latestChatSummary: async () => (c.summary ? { text: c.summary, metadata: {} } : null) },
    permission: async () => ({ required: false }),
    buildSystem: harness.buildSystem, memoryContext: harness.memoryContext, ensureCredit: async () => {}, logUsage: async () => {},
    checkPrompt: () => {}, protect: (_, s) => s, rank: x => x, finishMemory: async () => [],
    reasoningEffort: foundry.CHAT_REASONING_EFFORT, reportTiming: t => { timing = t; }, reportError: () => {} });
  const started = Date.now();
  let error = '';
  const context = { agent: { name: 'Everest', pers: 'Calm' }, timeZone: TZ, userMessageId: 'msg_1' };
  try {
    if (c.interrupt) {
      // Two messages through the real request handler: the second arrives while the
      // first reply is still being written, as when the owner adds a correction.
      const res = () => ({ writeHead() { return this; }, flushHeaders() {}, write(chunk) { const m = /^data: (.*)\n\n$/s.exec(chunk); if (m) events.push(JSON.parse(m[1])); return true; },
        end() { return this; }, on() {}, off() {}, status() { return this; }, json() { return this; } });
      const post = (prompt, requestId) => coordinator.handle({ originalUrl: '/api/agent/conversation', method: 'POST', user: { id: `eval-${variant}` },
        body: { chatId: `eval-${c.id}-${variant}`, requestId, prompt: prompt, context } }, res());
      const first = post(c.interrupt[0], 'first');
      await new Promise((r) => setTimeout(r, 400));
      await Promise.all([first, post(c.interrupt[1], 'second')]);
    } else {
      await coordinator.run({ userId: `eval-${variant}`, chatId: `eval-${c.id}`, requestId: `${c.id}-${variant}-${Math.random().toString(36).slice(2)}`,
        prompt: c.prompt, history: [], context, onEvent: e => events.push(e) });
    }
  } catch (e) { error = e.message; }
  const final = events.filter(e => e.type === 'message').at(-1);
  const route = calls.task ? 'task' : events.some(e => e.card?.ask) ? 'ask' : 'answer';
  const result = { id: c.id, route, text: final?.text || events.find(e => e.card?.ask)?.card.q || '', instructions: calls.task?.instructions || '', searched: (calls.fns || []).includes('web_search'),
    ms: Date.now() - started, firstTokenMs: timing.firstTokenMs ?? null, modelCalls: calls.model, input: calls.input, cached: calls.cached, output: calls.output, fns: calls.fns || [], error };
  const problems = [];
  if (error) problems.push(`error: ${error}`);
  if (c.expect !== 'any' && route !== c.expect && !((c.expect === 'answer' || c.allowAsk) && route === 'ask')) problems.push(`route ${route}, expected ${c.expect}`);
  if (/could not complete that answer/i.test(result.text)) problems.push('gave up');
  if (result.output > 3000 || result.ms > 20000) problems.push(`runaway: ${result.output} output tokens in ${result.ms}ms`);
  if (route === 'task' && !result.instructions.trim()) problems.push('task started without a brief');
  // A dead end: the agent refuses work its tasks can do, or sends the owner to do it.
  if (/\b(can[’']?t|cannot|unable to|not able to|don[’']?t have (?:access|a live))\b[^.]{0,40}\b(open|verify|access|browse|visit|check|see|clock|tell|find)\b|\b(paste|check your (?:device|phone))\b/i.test(result.text)) problems.push(`dead end: ${result.text.slice(0, 200)}`);
  if (!error && c.check) { const p = c.check(result); if (p) problems.push(p.slice(0, 300)); }
  result.pass = !problems.length;
  result.problems = problems;
  return result;
}

(async () => {
  if (!foundry.isConfigured?.() && !process.env.AZURE_FOUNDRY_API_KEY) throw new Error('Foundry is not configured.');
  const selected = CASES.filter(c => !only || c.id.startsWith(only));
  const jobs = [];
  for (let i = 0; i < runs; i++) for (const c of selected) jobs.push([c, i]);
  const results = [];
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, jobs.length) }, async () => {
    while (next < jobs.length) {
      const [c, i] = jobs[next++];
      const r = await runCase(c, i);
      results.push(r);
      console.log(`${r.pass ? 'PASS' : 'FAIL'} ${r.id} [${r.route}] ${r.ms}ms calls=${r.modelCalls} fns=${r.fns.join(',') || '-'}${r.pass ? '' : '\n     ' + r.problems.join('\n     ')}`);
    }
  }));
  const sum = (k) => results.reduce((a, r) => a + (r[k] || 0), 0);
  const sorted = results.map(r => r.ms).sort((a, b) => a - b);
  const pct = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
  const answered = results.filter(r => r.route === 'answer').map(r => r.ms).sort((a, b) => a - b);
  const summary = {
    server: serverDir, model: foundry.MODEL_DEFAULT, effort: foundry.CHAT_REASONING_EFFORT,
    passed: `${results.filter(r => r.pass).length}/${results.length}`,
    p50ms: pct(0.5), p90ms: pct(0.9), answerP50ms: answered[Math.floor(answered.length / 2)] ?? null,
    avgInput: Math.round(sum('input') / results.length), avgCached: Math.round(sum('cached') / results.length), avgOutput: Math.round(sum('output') / results.length),
    avgModelCalls: +(sum('modelCalls') / results.length).toFixed(2),
  };
  console.log(JSON.stringify(summary, null, 2));
  const out = flag('out', '');
  if (out) require('node:fs').writeFileSync(out, JSON.stringify({ summary, results }, null, 2));
})().catch(e => { console.error(e); process.exit(1); });
