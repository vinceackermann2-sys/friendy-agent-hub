const assert = require('node:assert/strict');
const fs = require('node:fs');
const { createCoordinator } = require('../server/agents/conversation');
const { buildSystem } = require('../server/agents/vm-harness');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const commonPrefixLength = (left, right) => {
  let i = 0;
  while (i < left.length && i < right.length && left[i] === right[i]) i++;
  return i;
};

async function preparationBenchmark() {
  const delay = 80;
  const startedOperations = new Set();
  const pending = name => { startedOperations.add(name); return wait(delay); };
  const coordinator = createCoordinator({
    ensureCredit: () => pending('credit'),
    store: {
      searchMemories: async () => { await pending('memory'); return []; },
      syncAgentContext: async () => { await pending('context'); return { agent:{}, documents:{} }; },
      listChatMessages: async () => { await pending('history'); return []; },
      saveTurn: async () => {},
    },
    azure: { getSandbox: async () => { await pending('sandbox'); return { mode:'local' }; } },
    tasks: { summaries: async () => { await pending('tasks'); return []; } },
    buildSystem: async () => '',
    rank: (items) => items,
    model: async () => ({ text:'ok' }),
    schemas: [], tools: {}, logUsage: async () => {}, protect: (_, text) => text,
    finishMemory: async () => [], reportError: () => {},
  });
  const started = performance.now();
  const run = coordinator.run({ userId:'user', chatId:'chat', requestId:'request', prompt:'hello', onEvent:() => {} });
  assert.deepEqual([...startedOperations].sort(),['context','credit','history','memory','sandbox','tasks'],'all preparation starts before any delayed operation resolves');
  await run;
  const elapsed = performance.now() - started;
  return elapsed;
}

async function promptCacheCheck() {
  const sandbox = { mode:'azure', vmName:'vm-a', location:'sweden', vmSize:'D2' };
  const first = await buildSystem({
    agent:{agent:{name:'Anna',pers:'Calm'},documents:{identity:'Identity A',soul:'Soul A',user:'User A',agents:'Agents A'}},
    memories:[{id:'m1',category:'long_term',text:'Memory A'}], sandbox,
  });
  const second = await buildSystem({
    agent:{agent:{name:'Ben',pers:'Bold'},documents:{identity:'Identity B',soul:'Soul B',user:'User B',agents:'Agents B'}},
    memories:[{id:'m2',category:'user',text:'Memory B'}], sandbox,
  });
  const prefix = commonPrefixLength(first, second);
  assert.ok(prefix > 1500, `stable system prefix is too short: ${prefix}`);
  for (const file of ['IDENTITY.md','SOUL.md','USER.md','AGENTS.md','MEMORY.md']) assert.match(first, new RegExp(file.replace('.', '\\.')));
  assert.match(first, /Name: Anna/);
  assert.match(first, /Memory A/);
  assert.ok(first.length <= 11800);
  return prefix;
}

(async () => {
  const elapsed = await preparationBenchmark();
  const prefix = await promptCacheCheck();
  const transport = fs.readFileSync(require.resolve('../app/engine.managed.js'), 'utf8');
  const worker = fs.readFileSync(require.resolve('../server/agents/conversation.js'), 'utf8');
  assert.doesNotMatch(transport, /sleep\(3000\)/, 'task transport must not add a fixed three-second pause');
  assert.match(worker, /tasks\.tick\(\{drain:true\}\)/, 'background task worker should continue ready steps in one pass');
  console.log(`agent performance: preparation ${elapsed.toFixed(1)}ms, stable prompt prefix ${prefix} chars`);
})().catch((error) => { console.error(error); process.exitCode = 1; });
