import assert from 'node:assert/strict';

import * as edgeAzure from '../src/lingon-server/agents/azure-vm.js';
import nodeAzure from '../server/agents/azure-vm.js';

const userId = 'esm-provider-smoke-user';
assert.equal(edgeAzure.userHash(userId), nodeAzure.userHash(userId));
assert.equal(edgeAzure.vmNameForUser(userId), nodeAzure.vmNameForUser(userId));
assert.equal(edgeAzure.isAzureConfigured(), nodeAzure.isAzureConfigured());
assert.equal(typeof edgeAzure.execInSandbox, 'function');

console.log('azure-vm esm: ok');
