// When Azure has no capacity for the VM size in the region (seen on 2026-09-30), a new VM is
// created on the next size and a stopped VM is resized before it starts. Azure is faked.
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

Object.assign(process.env, {
  AZURE_TENANT_ID:'tenant', AZURE_CLIENT_ID:'client', AZURE_CLIENT_SECRET:'secret', AZURE_SUBSCRIPTION_ID:'sub', AZURE_RESOURCE_GROUP:'rg',
  AZURE_VM_SIZE:'Standard_B2als_v2', AZURE_AUTO_PROVISION:'false',
  SUPABASE_URL:'https://db.test', SUPABASE_SERVICE_ROLE_KEY:'service',
  AZURE_SSH_PUBLIC_KEY: crypto.generateKeyPairSync('rsa', { modulusLength:2048 }).publicKey.export({ type:'spki', format:'pem' }),
});
const azure = require('../server/agents/azure-vm');

let vm, full, calls;
const reply = (body, status = 200, headers = {}) => ({ ok:status < 400, status, headers:{ get:(k) => headers[k.toLowerCase()] || null }, json:async () => body, text:async () => JSON.stringify(body) });
const polls = new Map();
const later = (result) => { const id = `https://poll.test/${polls.size + 1}`; polls.set(id, result); return reply({}, 202, { 'azure-asyncoperation':id }); };
const noRoom = { status:'Failed', error:{ message:'Allocation failed. We do not have sufficient capacity for the requested VM size in this region.' } };
global.fetch = async (input, options = {}) => {
  const url = String(input), method = String(options.method || 'GET');
  const body = typeof options.body === 'string' && options.body.startsWith('{') ? JSON.parse(options.body) : null;
  calls.push({ url, method, size:body?.properties?.hardwareProfile?.vmSize });
  if (url.includes('/rest/v1/account_deletions?')) return reply([]);
  if (url.includes('login.microsoftonline.com')) return reply({ access_token:'token', expires_in:3600 });
  if (url.startsWith('https://poll.test/')) return reply(polls.get(url));
  if (/virtualNetworks|networkSecurityGroups|networkInterfaces|publicIPAddresses|subnets/.test(url)) return method === 'GET' ? reply({ id:url.split('?')[0] }) : reply({ id:url.split('?')[0] });
  if (/\/disks\/[^/?]+\?/.test(url) && method === 'DELETE') return later({ status:'Succeeded' });
  if (/virtualMachines\/[^/?]+\?/.test(url)) {
    if (method === 'GET') return vm ? reply({ id:'vm', properties:{ vmId:'id-1', provisioningState:'Succeeded', hardwareProfile:{ vmSize:vm.size }, storageProfile:{ osDisk:{ managedDisk:{ id:`/subscriptions/sub/resourceGroups/RG/providers/Microsoft.Compute/disks/os-${vm.size}` } } } } }) : reply({ error:{ message:'not found' } }, 404);
    if (method === 'DELETE') { vm = null; return later({ status:'Succeeded' }); }
    if (method === 'PUT') {
      vm = { size:body.properties.hardwareProfile.vmSize };
      return later(full.has(vm.size) ? noRoom : { status:'Succeeded', properties:{ vmId:'id-1' } });
    }
    if (method === 'PATCH') { vm.size = body.properties.hardwareProfile.vmSize; return later({ status:'Succeeded' }); }
  }
  if (url.includes('/start?')) return later(full.has(vm.size) ? noRoom : { status:'Succeeded' });
  if (url.includes('/instanceView')) return reply({ statuses:[{ code:'ProvisioningState/succeeded' }, { code:'PowerState/running' }] });
  return reply({});
};

(async () => {
  const quiet = console.warn; console.warn = () => {};
  try {
    // A new VM: the configured size and the first fallback are full, the next one has room.
    vm = null; full = new Set(['Standard_B2als_v2', 'Standard_B2as_v2']); calls = [];
    const made = await azure.ensureVm('capacity-user', { create:true });
    assert.equal(made.vmSize, 'Standard_B2s_v2');
    assert.deepEqual(calls.filter((c) => c.method === 'PUT' && c.size).map((c) => c.size), ['Standard_B2als_v2', 'Standard_B2as_v2', 'Standard_B2s_v2']);
    assert.equal(calls.filter((c) => c.method === 'DELETE' && c.url.includes('/virtualMachines/')).length, 2, 'each failed VM is removed before the next size');
    assert.deepEqual(calls.filter((c) => c.method === 'DELETE' && c.url.includes('/disks/')).map((c) => c.url.split('/disks/')[1].split('?')[0]), ['os-Standard_B2als_v2', 'os-Standard_B2as_v2'], 'the OS disk of each failed VM is removed too');

    // A stopped VM whose size is full now: resized to the next size with room, then started.
    vm = { size:'Standard_B2als_v2' }; full = new Set(['Standard_B2als_v2']); calls = [];
    await azure.startVm('capacity-user');
    assert.equal(vm.size, 'Standard_B2as_v2');
    assert.deepEqual(calls.filter((c) => c.method === 'PATCH').map((c) => c.size), ['Standard_B2as_v2']);

    // Any other failure is not a capacity problem and is not retried on another size.
    vm = { size:'Standard_B2als_v2' }; full = new Set(); calls = [];
    const before = global.fetch;
    global.fetch = async (input, options) => (String(input).includes('/start?') ? later({ status:'Failed', error:{ message:'Quota exceeded for this subscription.' } }) : before(input, options));
    await assert.rejects(azure.startVm('capacity-user'), /Quota exceeded/);
    assert.equal(calls.filter((c) => c.method === 'PATCH').length, 0);
    global.fetch = before;
  } finally { console.warn = quiet; }
  console.log('vm capacity: a new VM falls back to the next size, a stopped VM is resized to start, other failures stay failures: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
