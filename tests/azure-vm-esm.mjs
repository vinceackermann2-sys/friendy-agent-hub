import assert from 'node:assert/strict';

import * as edgeAzure from '../src/lingon-server/agents/azure-vm.js';
import nodeAzure from '../server/agents/azure-vm.js';

const userId = 'esm-provider-smoke-user';
assert.equal(edgeAzure.userHash(userId), nodeAzure.userHash(userId));
assert.equal(edgeAzure.vmNameForUser(userId), nodeAzure.vmNameForUser(userId));
assert.equal(edgeAzure.isAzureConfigured(), nodeAzure.isAzureConfigured());
assert.equal(typeof edgeAzure.execInSandbox, 'function');
assert.equal(edgeAzure.buildShellScript('pwd', 'security-task'), nodeAzure.buildShellScript('pwd', 'security-task'));
assert.equal(edgeAzure.browserProfileRuntime.toString(), nodeAzure.browserProfileRuntime.toString());
// The hosted app sends the same locked desktop container and streamer as the Node server.
const live = { url: 'wss://abcdefgh.supabase.co/realtime/v1/websocket', key: 'k'.repeat(40), topic: `live-${'a'.repeat(43)}`, cmdKey: 'f'.repeat(64) };
assert.equal(edgeAzure.buildDesktopSessionScript({ sessionId: 'desk_esm123', live }), nodeAzure.buildDesktopSessionScript({ sessionId: 'desk_esm123', live }));
assert.equal(edgeAzure.desktopStreamerSource(), nodeAzure.desktopStreamerSource());
await assert.rejects(edgeAzure.startDesktopRelay('esm-user'), (error) => error.code === 'DISABLED');

console.log('azure-vm esm: ok');
