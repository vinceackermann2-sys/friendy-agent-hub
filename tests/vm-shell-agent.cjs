// The VM's shell agent and the server that sends it jobs, run against each other: a signed job
// goes over a fake channel to the real agent code, which runs it (process faked) and reports
// to a fake blob store the server reads. A forged or replayed job never runs, and a VM with
// no agent falls back to a VM command.
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');

const envNames = ['AZURE_TENANT_ID','AZURE_CLIENT_ID','AZURE_CLIENT_SECRET','AZURE_SUBSCRIPTION_ID','AZURE_RESOURCE_GROUP','SUPABASE_URL','SUPABASE_SERVICE_ROLE_KEY'];
const beforeEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
Object.assign(process.env, { AZURE_TENANT_ID:'tenant', AZURE_CLIENT_ID:'client', AZURE_CLIENT_SECRET:'secret', AZURE_SUBSCRIPTION_ID:'sub', AZURE_RESOURCE_GROUP:'rg', SUPABASE_URL:'https://db.test', SUPABASE_SERVICE_ROLE_KEY:'service' });
const azure = require('../server/agents/azure-vm');

const live = { url:'wss://abcdefghijkl.supabase.co/realtime/v1/websocket', key:'k'.repeat(40), topic:`live-${'t'.repeat(43)}`, cmdKey:'c'.repeat(64) };
const reply = (body, status = 200) => ({ ok:status < 400, status, headers:{ get:() => null }, json:async () => body, text:async () => JSON.stringify(body) });

// The agent, started with fake modules. Its channel is a captured socket.
let socket = null, ran = [];
class FakeSocket extends EventEmitter { constructor(url) { super(); this.url = url; this.readyState = 1; this.sent = []; socket = this; setImmediate(() => this.emit('open')); } send(m) { this.sent.push(JSON.parse(m)); } }
const spawn = (bin, args, opts) => {
  const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); child.kill = () => {};
  ran.push({ bin, script: files.get(args[0]), env: opts.env });
  setImmediate(() => { child.stdout.emit('data', 'hello\n'); child.close = true; child.emit('close', 0); });
  return child;
};
const files = new Map();
const fakeFs = { writeFileSync:(f, d) => files.set(f, String(d)), rmSync:(f) => files.delete(f) };
const timers = [];
const realInterval = global.setInterval;
global.setInterval = (fn, ms) => { const t = realInterval(fn, ms); timers.push(t); return t; };
const modules = { process:{ exit:() => {} }, fs:fakeFs, child_process:{ spawn }, crypto:require('crypto'), '/opt/lingon/node_modules/ws':FakeSocket };
azure.shellAgent({ ...live }, (name) => modules[name]);
global.setInterval = realInterval;

// Azure Storage and the channel. A job broadcast reaches the agent only while it listens.
const blobs = new Map();
let listening = true, broadcasts = [];
const oldFetch = global.fetch;
global.fetch = async (input, options = {}) => {
  const url = String(input), method = String(options.method || 'GET');
  if (url.includes('login.microsoftonline.com')) return reply({ access_token:'token', expires_in:3600 });
  if (url.includes('Microsoft.Storage')) return url.includes('/listKeys') ? reply({ keys:[{ value:Buffer.from('storage-key').toString('base64') }] }) : reply({ id:'storage' });
  if (url.includes('/realtime/v1/api/broadcast')) {
    const message = JSON.parse(options.body).messages[0];
    broadcasts.push(message);
    if (listening) setImmediate(() => socket.emit('message', JSON.stringify({ topic:`realtime:${live.topic}`, event:'broadcast', payload:{ type:'broadcast', event:message.event, payload:message.payload } })));
    return reply({}, 202);
  }
  if (url.includes('.blob.core.windows.net/')) {
    const key = url.split('?')[0];
    if (method === 'PUT') {
      if (options.headers?.['If-None-Match'] === '*' && blobs.has(key)) return reply({}, 409);
      blobs.set(key, String(options.body)); return reply({}, 201);
    }
    if (method === 'DELETE') { blobs.delete(key); return reply({}, 202); }
    return blobs.has(key) ? reply(JSON.parse(blobs.get(key))) : reply({}, 404);
  }
  throw new Error(`Unexpected request ${method} ${url}`);
};

(async () => {
  await new Promise((r) => setImmediate(r));
  assert.equal(socket.sent[0].event, 'phx_join', 'the agent joins its channel');
  assert.equal(socket.sent[0].topic, `realtime:${live.topic}`);

  // A signed job runs once, in a clean environment, and its output comes back.
  const out = await azure.shellAgentJob('agent-user', 'echo hello', live, { ackMs:200 });
  assert.deepEqual(out, { stdout:'hello', stderr:'' });
  assert.equal(ran.length, 1);
  assert.equal(ran[0].script, 'echo hello');
  assert.equal(JSON.stringify(ran[0].env).includes(live.cmdKey), false, 'the job never sees the key');
  assert.equal(blobs.size, 0, 'the result blob is removed');

  // The same job sent again (a replay) is ignored.
  const replay = broadcasts.at(-1).payload;
  socket.emit('message', JSON.stringify({ event:'broadcast', payload:{ event:'job', payload:replay } }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ran.length, 1, 'a replayed job does not run again');

  // A job signed with another key, or with its script changed, is ignored; the server then
  // claims the result blob itself and returns null, so the caller uses a VM command.
  assert.equal(await azure.shellAgentJob('agent-user', 'echo forged', { ...live, cmdKey:'d'.repeat(64) }, { ackMs:150 }), null);
  const signed = { ...broadcasts.at(-2).payload, id:'tampered-1', script:'rm -rf /' };
  socket.emit('message', JSON.stringify({ event:'broadcast', payload:{ event:'job', payload:signed } }));
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(ran.length, 1, 'neither a forged nor a changed job runs');

  // No agent on the VM (it just started): null after the short wait, nothing ran.
  listening = false;
  const started = Date.now();
  assert.equal(await azure.shellAgentJob('agent-user', 'echo nobody', live, { ackMs:150 }), null);
  assert.ok(Date.now() - started < 2000);
  assert.equal(ran.length, 1);

  // The launch keeps the key out of the command line and the environment.
  const launch = azure.shellAgentLaunch(live);
  assert.equal(launch.includes(live.cmdKey), false, 'the key is only in the base64 payload file');
  assert.match(launch, /umask 077/);
  console.log('vm shell agent: signed jobs run once with a clean environment; forged, changed and replayed jobs never run; no agent falls back: ok');
})().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => {
  for (const t of timers) clearInterval(t);
  global.fetch = oldFetch;
  for (const name of envNames) {
    if (beforeEnv[name] === undefined) delete process.env[name];
    else process.env[name] = beforeEnv[name];
  }
});
