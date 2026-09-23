const assert = require('node:assert/strict');
const Module = require('node:module');

const harnessPath = require.resolve('../server/agents/vm-harness');
const defer = () => {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
};

let calls = [];
let vmCalls = [];
let releaseMemory = defer();
let modelReplies = [];
let modelCall = async () => modelReplies.shift();
const fakeFoundry = { MODEL_DEFAULT: 'test-model', MODEL_FALLBACK: 'test-model',
  stableTail: require('../server/foundry').stableTail,
  callFoundryWithTools: (options) => modelCall(options) };
const fakeRunner = { ensureCredit: async () => {}, logModelUsage: async () => {} };
const fakeTools = { TOOLS: { shell: { name: 'shell', approval: false, run: async (_, ctx) => {
  assert.equal(ctx.vmReady, true, 'VM tools should reuse the confirmed agent lease');
  calls.push('tool');
  return { stdout: 'ok' };
} } }, pickTools: (prompt) => /command/i.test(prompt) ? [{ name:'shell' }] : [] };
const fakeGuardrails = { checkPrompt: () => {}, protectAgentResponse: (_, text) => text };
const fakeMemory = { rankMemories: () => [], maybeExtract: async () => {
  calls.push('memory-start');
  await releaseMemory.promise;
  calls.push('memory-end');
  return { saved: [] };
} };
const fakeStore = { listMemories: async () => [], syncAgentContext: async (_, agent) => ({ agent, documents:{} }), saveTurn: async () => {}, logToolRun: async () => {} };
const fakeAzure = { isAzureConfigured: () => true,
  getSandbox: async () => ({ mode: 'azure', vmName: 'test-vm' }),
  acquireLease: async (_, { leaseId }) => { vmCalls.push(['acquire', leaseId]); },
  renewLease: async () => {},
  releaseLease: async (_, { leaseId }) => { vmCalls.push(['release', leaseId]); },
};
const mocks = { '../foundry': fakeFoundry, './runner': fakeRunner, './tools': fakeTools,
  './tracing': { entry: (_, text) => ({ t: text }) }, './guardrails': fakeGuardrails,
  './memory': fakeMemory, '../store': fakeStore, './azure-vm': fakeAzure };
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename === harnessPath && Object.hasOwn(mocks, request)) return mocks[request];
  return originalLoad.call(this, request, parent, isMain);
};
const { runAgentTurn, handle } = require(harnessPath);
Module._load = originalLoad;

function response() {
  const done = defer();
  return {
    done: done.promise, headersSent: false, writableEnded: false, chunks: [],
    writeHead() { this.headersSent = true; return this; },
    flushHeaders() {},
    write(chunk) { this.chunks.push(chunk); return true; },
    end() { this.writableEnded = true; done.resolve(); return this; },
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; done.resolve(); return this; },
  };
}

(async () => {
  modelCall = async (options) => {
    const reply = modelReplies.shift();
    if (options.onDelta && reply?.text && !(reply.functionCalls || []).length) {
      for (const part of String(reply.text).match(/(\s+|[^\s]+)/g) || [reply.text]) options.onDelta(part);
    }
    return reply;
  };
  modelReplies = [{ text: 'Fast answer', functionCalls: [], usage: null }];
  const answerReady = defer();
  const events = [];
  const turn = runAgentTurn({ userId: 'user-a', chatId: 'chat-a', prompt: 'A simple question', onEvent: (event) => {
    events.push(event);
    if (event.type === 'message') answerReady.resolve();
  } });
  await answerReady.promise;
  assert.equal(vmCalls.length, 0, 'plain chat must not start the VM');
  assert.equal(events.find((event) => event.type === 'message').text, 'Fast answer');
  const deltas = events.filter((event) => event.type === 'message_delta').map((event) => event.delta).join('');
  assert.equal(deltas, 'Fast answer');
  assert.ok(events.findIndex((event) => event.type === 'message_delta') < events.findIndex((event) => event.type === 'message'), 'tokens arrive before the final card');
  assert.ok(events.some((event) => event.type === 'progress' && event.stage === 'model'));
  assert.ok(calls.includes('memory-start'));
  assert.ok(!calls.includes('memory-end'), 'answer must arrive before memory extraction finishes');
  releaseMemory.resolve();
  await turn;

  calls = [];
  vmCalls = [];
  releaseMemory = defer();
  releaseMemory.resolve();
  modelReplies = [
    { text: '', functionCalls: [{ name: 'shell', args: { command: 'pwd' } }], usage: null },
    { text: 'Tool answer', functionCalls: [], usage: null },
  ];
  const toolEvents = [];
  await runAgentTurn({ userId: 'user-a', chatId: 'chat-a', prompt: 'Run a command', onEvent: (event) => toolEvents.push(event) });
  assert.deepEqual(vmCalls.map(([kind]) => kind), ['acquire', 'release']);
  assert.ok(calls.indexOf('tool') >= 0);
  assert.ok(toolEvents.some((event) => event.type === 'progress' && event.stage === 'vm'));
  assert.equal(toolEvents.filter((event) => event.type === 'message').length, 1);

  const firstStarted = defer();
  const secondStarted = defer();
  const finishSecond = defer();
  let modelCount = 0;
  modelCall = ({ signal }) => {
    modelCount++;
    if (modelCount === 1) {
      firstStarted.resolve();
      return new Promise((_, reject) => signal.addEventListener('abort', () => reject(Object.assign(new Error('interrupted'), { name: 'AbortError' })), { once: true }));
    }
    secondStarted.resolve();
    return finishSecond.promise;
  };
  const first = response();
  const second = response();
  const firstRequest = handle({ method: 'POST', originalUrl: '/api/agent/run', user: { id: 'user-a' }, body: { chatId: 'chat-a', requestId: 'old', prompt: 'Old' } }, first);
  await firstStarted.promise;
  const secondRequest = handle({ method: 'POST', originalUrl: '/api/agent/run', user: { id: 'user-a' }, body: { chatId: 'chat-a', requestId: 'new', prompt: 'New' } }, second);
  await secondStarted.promise;
  const cancel = response();
  await handle({ method: 'POST', originalUrl: '/api/agent/cancel', user: { id: 'user-a' }, body: { chatId: 'chat-a', requestId: 'old' } }, cancel);
  assert.equal(cancel.body.cancelled, false, 'a late cancel must not interrupt the newer turn');
  finishSecond.resolve({ text: 'Latest answer', functionCalls: [], usage: null });
  await Promise.all([firstRequest, secondRequest]);
  assert.ok(second.chunks.join('').includes('Latest answer'));
  console.log('vm-harness latency and lazy VM: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
