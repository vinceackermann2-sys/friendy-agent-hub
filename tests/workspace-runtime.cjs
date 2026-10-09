const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const workspace = require('../server/agents/workspace-runtime');
const azure = require('../server/agents/azure-vm');
const { buildSystem } = require('../server/agents/vm-harness');
const { PGlite } = require('@electric-sql/pglite');

const app = fs.readFileSync(path.join(__dirname, '../app/app.js'), 'utf8');
const harness = fs.readFileSync(path.join(__dirname, '../server/agents/vm-harness.js'), 'utf8');
const migration = fs.readFileSync(path.join(__dirname, '../supabase/migrations/20260921203000_vm_idle_grace.sql'), 'utf8');

async function main() {
  assert.doesNotMatch(app, /\/api\/sandbox\/lease/, 'opening the app must never request a full-OS lease');
  assert.match(app, /\/api\/sandbox\/presence/);
  assert.match(app, /visibilitychange/);
  assert.doesNotMatch(app, /45000/, 'app presence must not poll or allocate compute');
  assert.match(harness, /status\(410\)/, 'legacy app VM lease endpoint must be retired');
  assert.match(harness, /workspace\.touch\(userId\)/);
  assert.match(migration, /idle_until/);
  assert.match(migration, /not exists \(/i);
  const defaultPresence = workspace.descriptor();
  assert.equal(defaultPresence.container, false, 'ordinary app presence must not allocate an external container');
  assert.equal(defaultPresence.mode, 'account-only');
  const db = new PGlite();
  try {
    await db.exec(`create role anon; create role authenticated; create role service_role;
      create table public.agent_vm_instances (
        user_id text primary key, vm_name text not null unique,
        power_state text not null default 'running', stop_claim_token text,
        stop_claimed_at timestamptz, last_lease_at timestamptz,
        created_at timestamptz not null default now(), updated_at timestamptz not null default now()
      );
      create table public.agent_vm_leases (
        user_id text not null references public.agent_vm_instances(user_id),
        lease_id text not null, kind text not null, vm_name text not null,
        expires_at timestamptz not null, primary key(user_id,lease_id)
      );`);
    await db.exec(migration);
    await db.exec("insert into agent_vm_instances(user_id,vm_name) values('owner-one','vm-one'); insert into agent_vm_leases(user_id,lease_id,kind,vm_name,expires_at) values('owner-one','tool-one','agent','vm-one',now()+interval '1 minute');");
    const released = await db.query("select * from release_agent_vm_lease('owner-one','tool-one','claim-one',now()+interval '5 minutes')");
    assert.equal(released.rows[0].should_stop, false);
    const tooEarly = await db.query("select * from claim_idle_agent_vms('claim-two',20)");
    assert.equal(tooEarly.rows.length, 0, 'VM stays warm during the short grace');
    await db.exec("update agent_vm_instances set idle_until=now()-interval '1 minute' where user_id='owner-one'");
    const due = await db.query("select * from claim_idle_agent_vms('claim-three',20)");
    assert.equal(due.rows.length, 1, 'VM becomes eligible for shutdown after grace');
  } finally { await db.close(); }

  assert.equal(workspace.endpointAllowed('https://pool.env.swedencentral.azurecontainerapps.io'), true);
  assert.equal(workspace.endpointAllowed('http://pool.env.swedencentral.azurecontainerapps.io'), false);
  assert.equal(workspace.endpointAllowed('https://evil.example'), false);
  assert.equal(workspace.endpointAllowed('https://user@pool.env.swedencentral.azurecontainerapps.io'), false);

  const first = workspace.sessionIdForUser('owner-one', { identifierSecret:'test-secret' });
  const second = workspace.sessionIdForUser('owner-two', { identifierSecret:'test-secret' });
  assert.match(first, /^ws-[a-f0-9]{40}$/);
  assert.notEqual(first, second);
  assert.ok(!first.includes('owner'));

  const transfer = 'https://private.blob.core.windows.net/agent-state/hash/workspace-v1.tar.gz?sig=test';
  const restore = azure.buildRestoreStateScript(transfer);
  const snapshot = azure.buildSnapshotStateScript(transfer);
  assert.match(restore, /tar -xzf/);
  assert.match(restore, /home\/lingon\/workspace/);
  assert.match(restore, /var\/lib\/lingon-browser\/sessions/);
  assert.match(restore, /echo STATE_RESTORED/);
  assert.match(snapshot, /x-ms-blob-type: BlockBlob/);
  assert.match(snapshot, /home\/lingon\/workspace var\/lib\/lingon-browser\/sessions/);
  assert.match(snapshot, /home\/lingon-desktop/);
  assert.match(snapshot, /tar -tzf "\$ARCHIVE"/);
  assert.match(snapshot, /echo STATE_SAVED/);
  assert.doesNotMatch(snapshot, /sig=test/, 'short-lived SAS stays encoded inside the VM script');
  assert.throws(() => azure.buildRestoreStateScript('https://evil.example/state.tar.gz'), /private workspace transfer/);
  assert.doesNotThrow(() => azure.assertStateCommandSucceeded({ stdout: 'STATE_SAVED', stderr: '' }, 'STATE_SAVED', 'AZURE_STATE_SAVE'));
  assert.throws(() => azure.assertStateCommandSucceeded({ stdout: '', stderr: '' }, 'STATE_SAVED', 'AZURE_STATE_SAVE'), { code: 'AZURE_STATE_SAVE' });
  assert.throws(() => azure.assertStateCommandSucceeded({ stdout: 'STATE_SAVED', stderr: 'upload failed' }, 'STATE_SAVED', 'AZURE_STATE_SAVE'), { code: 'AZURE_STATE_SAVE' });

  const system = await buildSystem({ agent:{agent:{name:'Mira',pers:'Calm',color:'blue'},documents:{}}, memories:[], sandbox:{mode:'azure',vmName:'private-vm',location:'swedencentral',vmSize:'B2',durableState:true} });
  assert.match(system, /Name: Mira/);
  assert.match(system, /Color: blue/);
  assert.match(system, /own mailbox on mail\.belna\.se/);
  assert.match(system, /Shopify catalog and checkout links/);
  assert.match(system, /started only for full-OS tools/);
  assert.doesNotMatch(system, /Read connection with shop_status/);

  const originalFetch = global.fetch;
  const names = ['AZURE_CONTAINER_SESSION_ENDPOINT','AZURE_CONTAINER_SESSION_PRESENCE','AZURE_CONTAINER_SESSION_ALLOW_BILLING','AZURE_TENANT_ID','AZURE_CLIENT_ID','AZURE_CLIENT_SECRET','WORKSPACE_SESSION_SECRET'];
  const before = Object.fromEntries(names.map((name) => [name, process.env[name]]));
  const calls = [];
  try {
    process.env.AZURE_CONTAINER_SESSION_ENDPOINT = 'https://pool.env.swedencentral.azurecontainerapps.io';
    process.env.AZURE_CONTAINER_SESSION_PRESENCE = 'external';
    process.env.AZURE_CONTAINER_SESSION_ALLOW_BILLING = 'true';
    process.env.AZURE_TENANT_ID = 'tenant-test';
    process.env.AZURE_CLIENT_ID = 'client-test';
    process.env.AZURE_CLIENT_SECRET = 'secret-test';
    process.env.WORKSPACE_SESSION_SECRET = 'hmac-test';
    global.fetch = async (url, options) => {
      calls.push({ url:String(url), options });
      if (String(url).includes('login.microsoftonline.com')) return { ok:true, json:async () => ({ access_token:'opaque-token', expires_in:3600 }) };
      return { ok:true, status:200, text:async () => '' };
    };
    const result = await workspace.touch('owner-one');
    assert.equal(result.warmed, true);
    assert.equal(result.containerPurpose, 'optional-warm-presence');
    assert.deepEqual(result.containerTools, []);
    assert.equal(result.containerLifecycle, 'visible-tab-plus-cooldown');
    assert.equal(result.fullOs, 'unavailable');
    assert.equal(calls.length, 2);
    assert.match(String(calls[0].options.body), /https%3A%2F%2Fdynamicsessions\.io%2F\.default/);
    assert.match(calls[1].url, /\/health\?identifier=ws-[a-f0-9]{40}$/);
    assert.equal(calls[1].options.headers.Authorization, 'Bearer opaque-token');
    assert.doesNotMatch(calls[1].url, /owner-one/);
    assert.equal(workspace.release().status, 'cooling');

    process.env.AZURE_CONTAINER_SESSION_PRESENCE = 'off';
    const disabled = await workspace.touch('owner-one');
    assert.equal(disabled.status, 'ready');
    assert.equal(disabled.container, false);
    assert.equal(calls.length, 2, 'disabled presence must not allocate a session');
  } finally {
    global.fetch = originalFetch;
    for (const name of names) {
      if (before[name] === undefined) delete process.env[name];
      else process.env[name] = before[name];
    }
  }
  console.log('workspace runtime: on-demand VM, opaque container sessions, durable state scripts and prompt identity: ok');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
