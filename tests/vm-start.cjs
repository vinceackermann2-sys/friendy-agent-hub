// How the VM starts for a task: which Azure calls a step costs when the VM is already
// running, when it is off, when a task starts it ahead of time, and for a shell command.
// Azure and the lease store are faked; every Run Command is a VM round trip of seconds.
const assert = require('node:assert/strict');

const envNames = ['AZURE_TENANT_ID','AZURE_CLIENT_ID','AZURE_CLIENT_SECRET','AZURE_SUBSCRIPTION_ID','AZURE_RESOURCE_GROUP','AZURE_AUTO_PROVISION','AZURE_DURABLE_STATE','AZURE_VM_IDLE_MINUTES','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
const beforeEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
Object.assign(process.env, {
  AZURE_TENANT_ID:'tenant', AZURE_CLIENT_ID:'client', AZURE_CLIENT_SECRET:'secret', AZURE_SUBSCRIPTION_ID:'sub', AZURE_RESOURCE_GROUP:'rg',
  AZURE_AUTO_PROVISION:'false', AZURE_DURABLE_STATE:'true', AZURE_VM_IDLE_MINUTES:'5', SUPABASE_URL:'https://db.test', SUPABASE_SERVICE_ROLE_KEY:'service',
});
const azure = require('../server/agents/azure-vm');

// The fake cloud: the VM's power state in Azure, the state the lease store recorded, and
// whether the worker image is ready.
let power, recorded, exists, workerReady, calls;
const reset = (state) => { ({ power, recorded, exists = true, workerReady = true } = state); calls = []; };
const reply = (body, status = 200, headers = {}) => ({ ok:status < 400, status, headers:{ get:(k) => headers[k.toLowerCase()] || null }, json:async () => body, text:async () => JSON.stringify(body) });
const polls = new Map();
const oldFetch = global.fetch;
global.fetch = async (input, options = {}) => {
  const url = String(input), method = String(options.method || 'GET');
  const body = typeof options.body === 'string' && options.body.startsWith('{') ? JSON.parse(options.body) : null;
  calls.push({ url, method, body });
  if (url.includes('/rest/v1/account_deletions?')) return reply([]);
  if (url.includes('login.microsoftonline.com')) return reply({ access_token:'token', expires_in:3600 });
  if (url.includes('/rest/v1/rpc/')) {
    const name = url.split('/rpc/')[1];
    if (name === 'token_wallet_status') return reply([{ remaining:1000 }]);
    if (name === 'acquire_agent_vm_lease') { recorded = recorded === 'running' ? 'running' : 'starting'; return reply([{ acquired:true, power_state:recorded }]); }
    if (name === 'mark_agent_vm_running') { recorded = 'running'; return reply(null, 204); }
    if (name === 'release_agent_vm_lease') return reply([{ should_stop:false, claim_token:null, idle_until:body.p_idle_until }]);
    return reply(0);
  }
  if (url.includes('/rest/v1/agent_vm_leases')) return reply([]);
  if (url.startsWith('https://poll.test/')) return reply(polls.get(url));
  if (url.includes('Microsoft.Storage')) return url.includes('/listKeys') ? reply({ keys:[{ value:Buffer.from('storage-key').toString('base64') }] }) : reply({ id:'storage' });
  if (!exists) return reply({ error:{ message:'not found' } }, 404);
  if (url.includes('/instanceView')) {
    const shown = power;
    if (power === 'starting') power = 'running'; // it boots between two looks
    return reply({ statuses:[{ code:'ProvisioningState/succeeded' }, { code:`PowerState/${shown}` }] });
  }
  if (url.includes('/start?')) {
    power = 'starting';
    const id = `https://poll.test/${calls.length}`;
    polls.set(id, { status:'Succeeded' });
    power = 'running';
    return reply({}, 202, { 'azure-asyncoperation':id });
  }
  if (url.includes('/runCommand?')) {
    const script = String(body.script[0]);
    const step = script.includes('cloud-init status') ? 'ready' : script.includes('lingon-cmd') ? 'shell' : script.includes('STATE_SAVED') ? 'snapshot' : script.includes('restored-v1') ? 'restore' : 'other';
    const kind = step !== 'restore' && script.includes('Workspace restore failed') ? `restore+${step}` : step;
    let stdout = '', stderr = '';
    if (kind === 'restore') stdout = 'STATE_RESTORED';
    if (kind === 'restore+snapshot') stdout = 'STATE_SAVED';
    if (kind === 'ready') { workerReady = true; stdout = 'READY'; }
    if (kind.endsWith('shell')) { if (workerReady) stdout = 'hello'; else stderr = 'Worker container image is not ready.'; }
    calls.at(-1).kind = kind;
    const id = `https://poll.test/${calls.length}`;
    polls.set(id, { status:'Succeeded', properties:{ output:{ value:[{ code:'ComponentStatus/StdOut/succeeded', message:stdout }, { code:'ComponentStatus/StdErr/succeeded', message:stderr }] } } });
    return reply({}, 202, { 'azure-asyncoperation':id });
  }
  if (url.includes('/virtualMachines/')) return reply({ id:'vm', properties:{ vmId:'vm-1', provisioningState:'Succeeded' } });
  throw new Error(`Unexpected request ${method} ${url}`);
};
const runCommands = () => calls.filter((c) => c.url.includes('/runCommand?')).map((c) => c.kind);
const starts = () => calls.filter((c) => c.url.includes('/start?')).length;
const rpc = (name) => calls.filter((c) => c.url.endsWith(`/rpc/${name}`));

(async () => {
  // A VM recorded as running was restored when it started: a step on it sends no restore
  // command (each cost a VM round trip on every step).
  reset({ power:'running', recorded:'running' });
  await azure.acquireLease('warm-user', { leaseId:'task:warm:1', kind:'agent' });
  assert.deepEqual(runCommands(), [], 'a running VM needs no restore command');
  assert.equal(starts(), 0);

  // A VM that is off starts with no command of its own: its disk was kept, so the restore
  // check goes with its first command, once.
  reset({ power:'deallocated', recorded:'deallocated' });
  await azure.acquireLease('cold-user', { leaseId:'task:cold:1', kind:'agent' });
  assert.equal(starts(), 1);
  assert.deepEqual(runCommands(), [], 'a started VM sends no separate restore command');
  assert.equal(recorded, 'running');
  await azure.execInSandbox('cold-user', 'shell', { command:'echo hello' }, { alreadyRunning:true, taskId:'t0' });
  await azure.execInSandbox('cold-user', 'shell', { command:'echo again' }, { alreadyRunning:true, taskId:'t0' });
  assert.deepEqual(runCommands(), ['restore+shell', 'shell'], 'the first command checks the restore, later ones do not');

  // A new VM still restores before anything runs.
  reset({ power:'deallocated', recorded:'deallocated' });
  await azure.restoreDurableState('new-vm-user');
  assert.deepEqual(runCommands(), ['restore']);
  // A backup restores a disk that never was before saving it, so it cannot replace saved files.
  reset({ power:'running', recorded:'running' });
  await azure.snapshotDurableState('backup-user');
  assert.deepEqual(runCommands(), ['restore+snapshot']);

  // Prewarm starts a VM that is off without waiting for it to boot, and leaves the usual
  // idle window so an unused VM still stops.
  reset({ power:'deallocated', recorded:'deallocated' });
  const before = Date.now();
  assert.deepEqual(await azure.prewarm('prewarm-user'), { started:true, power:'starting' });
  assert.equal(starts(), 1);
  assert.equal(calls.some((c) => c.url.startsWith('https://poll.test/')), false, 'prewarm does not wait for the boot');
  assert.deepEqual(runCommands(), []);
  const release = rpc('release_agent_vm_lease');
  assert.equal(release.length, 1);
  const idle = Date.parse(release[0].body.p_idle_until) - before;
  assert.ok(idle >= 5 * 60000 - 1000 && idle <= 5 * 60000 + 5000, `idle window ${idle}ms`);
  assert.equal(rpc('acquire_agent_vm_lease')[0].body.p_kind, 'warm');
  // The task's own lease then finds it starting: no second start request, and the restore
  // check waits for the first command.
  power = 'starting'; calls = [];
  await azure.acquireLease('prewarm-user', { leaseId:'task:prewarm:1', kind:'agent' });
  assert.equal(starts(), 0, 'a starting VM is waited for, not started again');
  assert.deepEqual(runCommands(), []);
  await azure.execInSandbox('prewarm-user', 'shell', { command:'echo hello' }, { alreadyRunning:true, taskId:'t3' });
  assert.deepEqual(runCommands(), ['restore+shell']);

  // A VM that is already up is only kept from stopping; a missing one is never touched.
  reset({ power:'running', recorded:'running' });
  assert.deepEqual(await azure.prewarm('running-user'), { started:false, power:'running' });
  assert.equal(starts(), 0);
  assert.equal(rpc('release_agent_vm_lease').length, 1);
  reset({ power:'deallocated', recorded:'deallocated', exists:false });
  assert.deepEqual(await azure.prewarm('missing-user'), { started:false, power:'missing' });
  assert.equal(calls.some((c) => c.url.includes('/rpc/')), false, 'no lease for a VM that does not exist');

  // A shell command on a ready VM is one command, with no readiness check first.
  reset({ power:'running', recorded:'running' });
  const shell = await azure.execInSandbox('shell-user', 'shell', { command:'echo hello' }, { alreadyRunning:true, taskId:'t1' });
  assert.equal(shell.stdout, 'hello');
  assert.deepEqual(runCommands(), ['shell']);
  // On a first boot still preparing the worker image, it waits for the image and runs again.
  reset({ power:'running', recorded:'running', workerReady:false });
  const first = await azure.execInSandbox('new-user', 'shell', { command:'echo hello' }, { alreadyRunning:true, taskId:'t2' });
  assert.equal(first.stdout, 'hello');
  assert.deepEqual(runCommands(), ['shell', 'ready', 'shell']);

  console.log('vm start: no restore on a running VM, restore check in the first command after a start, restore before every backup, prewarm without waiting, one command per shell step: ok');
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  global.fetch = oldFetch;
  for (const name of envNames) {
    if (beforeEnv[name] === undefined) delete process.env[name];
    else process.env[name] = beforeEnv[name];
  }
});
