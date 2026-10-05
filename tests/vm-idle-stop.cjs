// How an idle VM stops: the sweep the scheduler calls once a minute must finish within
// the 25 seconds it is given, and a VM left marked stopping by a sweep that was cut off
// is settled from Azure's own power state instead of being forgotten while it runs.
// Azure and the lease store are faked.
const assert = require('node:assert/strict');

const envNames = ['AZURE_TENANT_ID','AZURE_CLIENT_ID','AZURE_CLIENT_SECRET','AZURE_SUBSCRIPTION_ID','AZURE_RESOURCE_GROUP','AZURE_AUTO_PROVISION','AZURE_DURABLE_STATE','AZURE_VM_IDLE_MINUTES','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
const beforeEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
Object.assign(process.env, {
  AZURE_TENANT_ID:'tenant', AZURE_CLIENT_ID:'client', AZURE_CLIENT_SECRET:'secret', AZURE_SUBSCRIPTION_ID:'sub', AZURE_RESOURCE_GROUP:'rg',
  AZURE_AUTO_PROVISION:'false', AZURE_DURABLE_STATE:'true', AZURE_VM_IDLE_MINUTES:'5', SUPABASE_URL:'https://db.test', SUPABASE_SERVICE_ROLE_KEY:'service',
});
const azure = require('../server/agents/azure-vm');

// The fake cloud: each VM's power in Azure (a list is shown one look at a time), and the
// lease store's row for each user.
let rows, power, calls, backup, deallocateStatus;
const reset = () => { rows = new Map(); power = new Map(); calls = []; backup = 'hang'; deallocateStatus = 202; };
const vm = (user) => azure.vmNameForUser(user);
const row = (user, fields) => rows.set(user, { user_id:user, vm_name:vm(user), power_state:'running', stop_claim_token:null, stop_claimed_at:null, idle_until:null, ...fields });
const ago = (ms) => new Date(Date.now() - ms).toISOString();
const reply = (body, status = 200, headers = {}) => ({ ok:status < 400, status, headers:{ get:(k) => headers[k.toLowerCase()] || null }, json:async () => body, text:async () => JSON.stringify(body) });
const vmOf = (url) => (url.match(/virtualMachines\/([^/?]+)/) || [])[1];
const userOf = (name) => [...rows.values()].find((r) => r.vm_name === name)?.user_id;
const oldFetch = global.fetch;
global.fetch = async (input, options = {}) => {
  const url = String(input), method = String(options.method || 'GET');
  const body = typeof options.body === 'string' && options.body.startsWith('{') ? JSON.parse(options.body) : null;
  calls.push({ url, method, body });
  if (url.includes('/rest/v1/account_deletions?')) return reply([]);
  if (url.includes('login.microsoftonline.com')) return reply({ access_token:'token', expires_in:3600 });
  if (url.includes('/rest/v1/rpc/')) {
    const name = url.split('/rpc/')[1];
    if (name === 'claim_idle_agent_vms') {
      const claimed = [...rows.values()].filter((r) => ['running','starting'].includes(r.power_state) && Date.parse(r.idle_until || 0) <= Date.now());
      for (const r of claimed) Object.assign(r, { power_state:'stopping', stop_claim_token:body.p_claim_token, stop_claimed_at:new Date().toISOString() });
      return reply(claimed.map((r) => ({ user_id:r.user_id, vm_name:r.vm_name, claim_token:body.p_claim_token })));
    }
    if (name === 'finish_agent_vm_stop') {
      const r = rows.get(body.p_user_id);
      if (!r || r.stop_claim_token !== body.p_claim_token) return reply(false);
      Object.assign(r, { power_state:body.p_success ? 'deallocated' : 'running', stop_claim_token:null, stop_claimed_at:null });
      return reply(true);
    }
    if (name === 'token_wallet_status') return reply([{ remaining:1000 }]);
    if (name === 'acquire_agent_vm_lease') return reply([{ acquired:true, power_state:'starting' }]);
    return reply(0);
  }
  if (url.includes('/rest/v1/agent_vm_instances?')) {
    const q = new URL(url).searchParams;
    const before = Date.parse(q.get('stop_claimed_at').replace(/^lt\./, ''));
    return reply([...rows.values()].filter((r) => r.power_state === 'stopping' && r.stop_claim_token && Date.parse(r.stop_claimed_at) < before)
      .map((r) => ({ user_id:r.user_id, vm_name:r.vm_name, stop_claim_token:r.stop_claim_token })));
  }
  if (url.includes('/rest/v1/agent_vm_leases')) return reply([]);
  if (url.startsWith('https://poll.test/')) return reply({ status:'Succeeded' });
  if (url.includes('Microsoft.Storage')) return url.includes('/listKeys') ? reply({ keys:[{ value:Buffer.from('storage-key').toString('base64') }] }) : reply({ id:'storage' });
  const name = vmOf(url);
  if (url.includes('/instanceView')) {
    const list = power.get(name);
    const shown = Array.isArray(list) ? (list.length > 1 ? list.shift() : list[0]) : list;
    if (!shown) return reply({ error:{ message:'not found' } }, 404);
    return reply({ statuses:[{ code:'ProvisioningState/succeeded' }, { code:`PowerState/${shown}` }] });
  }
  if (url.includes('/runCommand?')) {
    // A backup whose command never comes back within the sweep (a busy or slow VM).
    if (backup === 'hang') return new Promise(() => {});
    return reply({}, 202, { 'azure-asyncoperation':`https://poll.test/backup-${calls.length}` });
  }
  if (url.includes('/deallocate?')) {
    if (deallocateStatus === 404) return reply({ error:{ message:'not found' } }, 404);
    power.set(name, ['deallocating']);
    return reply({}, 202, { 'azure-asyncoperation':`https://poll.test/deallocate-${calls.length}` });
  }
  if (url.includes('/start?')) {
    assert.equal(power.get(name)?.[0], 'deallocated', 'a start is sent only once the stop is done');
    power.set(name, ['running']);
    return reply({}, 202, { 'azure-asyncoperation':`https://poll.test/start-${calls.length}` });
  }
  if (url.includes('/virtualMachines/')) return reply({ id:'vm', properties:{ vmId:`id-${userOf(name) || name}`, provisioningState:'Succeeded' } });
  throw new Error(`Unexpected request ${method} ${url}`);
};
// A sweep stuck on a backup that never returns leaves nothing to run, so node would exit
// quietly with success; that is the failure this test exists for.
let finished = false;
process.on('exit', () => { if (!finished) { console.error('vm idle stop: a sweep never finished'); process.exitCode = 1; } });
const deallocations = () => calls.filter((c) => c.url.includes('/deallocate?')).map((c) => vmOf(c.url));
const rpc = (name) => calls.filter((c) => c.url.endsWith(`/rpc/${name}`));
const polled = (kind) => calls.some((c) => c.url.startsWith(`https://poll.test/${kind}`));

(async () => {
  // Two idle VMs whose backups never return: the sweep sends both deallocations without
  // waiting for Azure, well inside the scheduler's 25 seconds, and leaves them stopping.
  reset();
  row('idle-a', { idle_until:ago(1000) });
  row('idle-b', { idle_until:ago(1000) });
  row('busy', { idle_until:new Date(Date.now() + 60000).toISOString() });
  power.set(vm('idle-a'), ['running']); power.set(vm('idle-b'), ['running']); power.set(vm('busy'), ['running']);
  let began = Date.now();
  let out = await azure.sweepLeases({ backupMs:300 });
  const took = Date.now() - began;
  assert.ok(took < 1500, `the sweep took ${took}ms; backups run side by side and are cut at their limit`);
  assert.deepEqual(deallocations().sort(), [vm('idle-a'), vm('idle-b')].sort(), 'only the idle VMs stop');
  assert.equal(polled('deallocate'), false, 'the sweep does not wait for the deallocation');
  assert.equal(rpc('meter_agent_vm_runtime').filter((c) => c.body.p_stop).length, 2, 'billing stops with the stop');
  assert.equal(rpc('finish_agent_vm_stop').length, 0, 'marked stopped only once Azure confirms it');
  assert.equal(rows.get('idle-a').power_state, 'stopping');
  assert.ok(out.results.some((r) => r.snapshot === false && r.error === 'AZURE_STATE_SLOW'));

  // The next sweep settles them from Azure: a finished stop is recorded; one still
  // deallocating is left alone. A stop claimed moments ago is not looked at yet.
  calls = [];
  rows.get('idle-a').stop_claimed_at = ago(60000);
  rows.get('idle-b').stop_claimed_at = ago(60000);
  power.set(vm('idle-a'), ['deallocated']);
  out = await azure.sweepLeases({ backupMs:300 });
  assert.equal(rows.get('idle-a').power_state, 'deallocated');
  assert.equal(rows.get('idle-b').power_state, 'stopping', 'still deallocating in Azure');
  assert.deepEqual(deallocations(), [], 'no second deallocation while one is in progress');
  assert.equal(out.settled, 2);

  // A sweep cut off before it sent the deallocation left the VM running and marked
  // stopping. The next sweep finds it up and stops it again.
  reset();
  backup = 'ok';
  row('cut', { power_state:'stopping', stop_claim_token:'old-claim', stop_claimed_at:ago(10 * 60000), idle_until:ago(11 * 60000) });
  power.set(vm('cut'), ['running']);
  out = await azure.sweepLeases({ backupMs:300 });
  assert.deepEqual(deallocations(), [vm('cut')], 'a VM left running is stopped');
  assert.equal(rows.get('cut').power_state, 'stopping');
  assert.notEqual(rows.get('cut').stop_claim_token, 'old-claim', 'claimed again by this sweep');
  assert.equal(calls.filter((c) => c.url.includes('/runCommand?')).length, 1, 'backed up first');

  // A VM that no longer exists is simply marked stopped.
  reset();
  deallocateStatus = 404;
  row('gone', { idle_until:ago(1000) });
  power.set(vm('gone'), ['running']);
  backup = 'ok';
  await azure.sweepLeases({ backupMs:300 });
  assert.equal(rows.get('gone').power_state, 'deallocated');

  // New work that arrives while Azure still deallocates waits for the stop to finish
  // before it starts the VM (Azure refuses a start meanwhile).
  reset();
  backup = 'ok';
  row('back', { power_state:'deallocated' });
  power.set(vm('back'), ['deallocating', 'deallocating', 'deallocated']);
  began = Date.now();
  await azure.ensureRunning('back', { create:false });
  assert.equal(calls.filter((c) => c.url.includes('/start?')).length, 1);
  assert.equal(power.get(vm('back'))[0], 'running');

  finished = true;
  console.log('vm idle stop: sweeps fit their window, stops are settled from Azure, a VM left running is stopped again: ok');
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  global.fetch = oldFetch;
  for (const name of envNames) {
    if (beforeEnv[name] === undefined) delete process.env[name];
    else process.env[name] = beforeEnv[name];
  }
});
