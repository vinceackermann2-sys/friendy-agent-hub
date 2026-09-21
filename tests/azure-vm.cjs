const assert = require('node:assert/strict');
const azure = require('../server/agents/azure-vm');

assert.equal(azure.isAzureConfigured(), false);
const missing = azure.missingAzureFields(azure.azureConfig());
assert.ok(missing.includes('tenantId'));
assert.ok(missing.includes('subscriptionId'));

const a = azure.vmNameForUser('user-a');
const b = azure.vmNameForUser('user-b');
assert.match(a, /^lingon-sb-[a-f0-9]{24}$/);
assert.notEqual(a, b);
assert.equal(azure.vmNameForUser('user-a'), a);

const wa = azure.localWorkspaceForUser('user-a');
const wb = azure.localWorkspaceForUser('user-b');
assert.notEqual(wa, wb);
assert.doesNotThrow(() => azure.assertLocalPath('user-a', 'notes.txt'));
assert.throws(() => azure.assertLocalPath('user-a', '..\\..\\server\\.env'), /escapes/);

const script = azure.buildRunScript('js', 'console.log(1)');
assert.match(script, /base64 -d/);
assert.match(script, /podman run --rm/);
assert.match(script, /--network=none/);
assert.match(script, /--cap-drop=ALL/);
assert.match(script, /--read-only/);
assert.match(script, /--volume \"\$WORKDIR:\/workspace:rw\"/);
assert.match(script, /--memory=512m/);
assert.match(script, /\/home\/lingon\/workspace/);
assert.doesNotMatch(script, /console\.log/);
assert.throws(() => azure.buildRunScript('ruby', 'p 1'), /Unsupported/);
assert.throws(() => azure.buildRunScript('js', ''), /required/);
assert.throws(() => azure.buildRunScript('js', 'x'.repeat(20001)), /20KB/);

const sh = azure.buildShellScript('ls -la /etc/passwd');
const init = Buffer.from(azure.cloudInit(azure.azureConfig()), 'base64').toString('utf8');
assert.match(init, /podman/);
assert.match(init, /lingon-worker/);
assert.match(init, /worker\/Containerfile/);
const taskA=azure.buildShellScript('pwd','task-a');
const taskB=azure.buildRunScript('python','print(1)','task-b');
assert.notEqual(taskA.match(/WORKDIR=(.*)/)[1],taskB.match(/WORKDIR=(.*)/)[1],'workers use separate task directories on the same VM');
assert.match(taskA,/mktemp/);assert.match(taskB,/mktemp/);
assert.doesNotMatch(azure.buildShellScript('pwd',"../;$(malicious)"),/malicious/,'task scope never interpolates shell syntax');
assert.match(sh, /base64 -d/);
assert.match(sh, /podman run --rm/);
assert.match(sh, /--network=none/);
assert.match(sh, /--security-opt=no-new-privileges/);
assert.doesNotMatch(sh, /\/etc\/passwd/);
assert.throws(() => azure.buildShellScript(''), /required/);
const sessionBrowser = azure.buildBrowserSessionScript('navigate', { sessionId:'chat-a', url:'https://example.com/secret-path', uploadUrl:'https://abc.blob.core.windows.net/shots/a.jpg?sig=test' });
const browserRunner = Buffer.from(sessionBrowser.match(/echo '([^']+)' \| base64 -d/)[1], 'base64').toString('utf8');
assert.match(browserRunner, /--remote-debugging-port/);
assert.match(browserRunner, /puppeteer\.connect/);
assert.match(browserRunner, /browser\.process\(\)\?\.unref/);
assert.match(browserRunner, /request\.abort/);
assert.match(sessionBrowser, /install -d -m 700 -o lingon-browser/);
assert.match(sessionBrowser, /runuser -u lingon-browser -- env .* node \/tmp\/lingon-browser-session\.js/);
assert.throws(() => azure.buildBrowserSessionScript('navigate', { sessionId:'chat-a', url:'http://insecure.example', uploadUrl:'https://abc.blob.core.windows.net/shots/a.jpg?sig=test' }), /HTTPS/);

(async () => {
  const sb = await azure.getSandbox('user-a');
  assert.equal(sb.mode, 'local');
  assert.equal(sb.provider, 'local-per-user-fallback');
  assert.ok(sb.missingAzureFields.length >= 5);
  try {
    await azure.execInSandbox('user-a', 'code_run', { language: 'js', code: 'process.env' });
    assert.fail('code_run must fail closed without Azure');
  } catch (e) {
    assert.equal(e.code, 'DISABLED');
  }
  try {
    await azure.execInSandbox('user-a', 'shell', { command: 'id' });
    assert.fail('shell must fail closed without Azure');
  } catch (e) {
    assert.equal(e.code, 'DISABLED');
  }

  // A status probe is read-only even when auto-provisioning is enabled. It may
  // inspect a missing VM, but opening the app or polling status must not issue
  // an ARM create/PUT request.
  const envNames = ['AZURE_TENANT_ID','AZURE_CLIENT_ID','AZURE_CLIENT_SECRET','AZURE_SUBSCRIPTION_ID','AZURE_RESOURCE_GROUP','AZURE_AUTO_PROVISION'];
  const beforeEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]]));
  const oldFetch = global.fetch;
  const armCalls = [];
  try {
    process.env.AZURE_TENANT_ID = 'tenant-test';
    process.env.AZURE_CLIENT_ID = 'client-test';
    process.env.AZURE_CLIENT_SECRET = 'secret-test';
    process.env.AZURE_SUBSCRIPTION_ID = 'subscription-test';
    process.env.AZURE_RESOURCE_GROUP = 'rg-test';
    process.env.AZURE_AUTO_PROVISION = 'true';
    global.fetch = async (url, options = {}) => {
      armCalls.push({ url:String(url), method:String(options.method || 'GET') });
      if (String(url).includes('login.microsoftonline.com')) return { ok:true, status:200, json:async () => ({ access_token:'token-test', expires_in:3600 }) };
      return { ok:false, status:404, headers:{ get:() => null }, json:async () => ({ error:{ message:'not found' } }) };
    };
    const status = await azure.statusForUser('status-only-user');
    assert.equal(status.vm.error, 'AZURE_VM_MISSING');
    assert.equal(armCalls.some((call) => call.method === 'PUT'), false);
  } finally {
    global.fetch = oldFetch;
    for (const name of envNames) {
      if (beforeEnv[name] === undefined) delete process.env[name];
      else process.env[name] = beforeEnv[name];
    }
  }
  console.log('azure-vm: ok');
})().catch((e) => { console.error(e); process.exitCode = 1; });
