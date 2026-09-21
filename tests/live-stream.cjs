const assert = require('node:assert/strict');
const vm = require('node:vm');
const azure = require('../server/agents/azure-vm');
const live = require('../server/agents/live');

const token = 'abcdefghijklmnopqrstuvwxyz0123456789ABCDEF';
const relayScript = azure.buildBrowserRelayScript({
  sessionId: 'live_test',
  relayUrl: 'wss://app.example.test/ws/live-vm/live_test?token=secret',
  token,
});
const encodedRunner = (relayScript.match(/echo '([^']+)' \| base64 -d >/i) || [])[1];
assert.ok(encodedRunner, 'relay runner is embedded in the VM bootstrap command');
const runner = Buffer.from(encodedRunner, 'base64').toString('utf8');
assert.doesNotThrow(() => new vm.Script(runner), 'VM relay runner is valid JavaScript');
assert.match(runner, /Page\.startScreencast/);
assert.match(runner, /Page\.screencastFrame/);
assert.match(runner, /node_modules\/ws/);
assert.match(runner, /command\.type/);
assert.match(azure.buildBrowserRelayStopScript('live_test'), /relay\.pid/);
assert.throws(() => azure.buildBrowserRelayScript({ sessionId:'live_test', relayUrl:'https://bad.test', token }), /ws:\/\/ or wss:\/\//);

const before = process.env.LINGON_PUBLIC_ORIGIN;
process.env.LINGON_PUBLIC_ORIGIN = 'https://app.example.test';
const relayUrl = live.relayUrlFor({ id:'live_test', relayToken:token });
assert.match(relayUrl, /^wss:\/\/app\.example\.test\/ws\/live-vm\/live_test\?token=/);
if (before === undefined) delete process.env.LINGON_PUBLIC_ORIGIN;
else process.env.LINGON_PUBLIC_ORIGIN = before;

console.log('live browser screencast relay: ok');
