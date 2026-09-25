const assert = require('node:assert/strict');
const Module = require('node:module');

// The harness now only serves workspace presence and status. Chat runs through
// conversation.js (see chat-tasks.cjs); the retired single-loop routes answer 410
// so an out-of-date client reloads instead of starting a second agent loop.
const harnessPath = require.resolve('../server/agents/vm-harness');
let vmCalls = [];
const fakeAzure = { isAzureConfigured: () => true,
  getSandbox: async () => ({ mode: 'azure', vmName: 'test-vm' }),
  statusForUser: async () => ({ state: 'deallocated' }),
  acquireLease: async () => { vmCalls.push('acquire'); },
  renewLease: async () => {}, releaseLease: async () => { vmCalls.push('release'); },
};
const fakeWorkspace = { descriptor: () => ({ mode: 'managed', ready: true }), touch: async () => ({ mode: 'managed', ready: true }), release: () => ({ released: true }) };
const mocks = { './azure-vm': fakeAzure, './workspace-runtime': fakeWorkspace };
const originalLoad = Module._load;
Module._load = function(request, parent, isMain) {
  if (parent?.filename === harnessPath && Object.hasOwn(mocks, request)) return mocks[request];
  return originalLoad.call(this, request, parent, isMain);
};
const harness = require(harnessPath);
Module._load = originalLoad;

function response() {
  return {
    status(code) { this.statusCode = code; return this; },
    json(value) { this.body = value; this.statusCode ??= 200; return this; },
  };
}
const call = async (method, path, body = {}) => {
  const res = response();
  await harness.handle({ method, originalUrl: path, user: { id: 'user-a' }, body }, res);
  return res;
};

(async () => {
  assert.equal(harness.runAgentTurn, undefined, 'the single-loop agent is retired');
  for (const path of ['/api/chat', '/api/chat/stream', '/api/agent/run', '/api/agent/resume', '/api/agent/steer', '/api/agent/cancel']) {
    const res = await call('POST', path, { chatId: 'chat-a', prompt: 'Hello' });
    assert.equal(res.statusCode, 410, `${path} is retired`);
    assert.match(res.body.error, /Reload the app/);
  }
  const presence = await call('POST', '/api/sandbox/presence', { action: 'touch' });
  assert.deepEqual(presence.body, { mode: 'managed', ready: true });
  const status = await call('GET', '/api/agent/status');
  assert.equal(status.body.sandbox, 'azure');
  assert.equal(status.body.pending, undefined);
  assert.equal((await call('GET', '/api/sandbox/status')).body.state, 'deallocated');
  assert.equal((await call('POST', '/api/sandbox/lease')).statusCode, 410);
  assert.equal((await call('POST', '/api/agent/unknown')).statusCode, 404);
  assert.deepEqual(vmCalls, [], 'app presence and status never start the VM');
  console.log('vm-harness latency and lazy VM: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
