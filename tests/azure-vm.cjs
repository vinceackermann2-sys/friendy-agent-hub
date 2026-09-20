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
assert.match(script, /timeout 20s node/);
assert.match(script, /\/home\/lingon\/workspace/);
assert.doesNotMatch(script, /console\.log/);
assert.throws(() => azure.buildRunScript('ruby', 'p 1'), /Unsupported/);
assert.throws(() => azure.buildRunScript('js', ''), /required/);
assert.throws(() => azure.buildRunScript('js', 'x'.repeat(20001)), /20KB/);

const sh = azure.buildShellScript('ls -la /etc/passwd');
const taskA=azure.buildShellScript('pwd','task-a');
const taskB=azure.buildRunScript('python','print(1)','task-b');
assert.notEqual(taskA.match(/WORKDIR=(.*)/)[1],taskB.match(/WORKDIR=(.*)/)[1],'workers use separate task directories on the same VM');
assert.match(taskA,/mktemp/);assert.match(taskB,/mktemp/);
assert.doesNotMatch(azure.buildShellScript('pwd',"../;$(malicious)"),/malicious/,'task scope never interpolates shell syntax');
assert.match(sh, /base64 -d/);
assert.doesNotMatch(sh, /\/etc\/passwd/);
assert.throws(() => azure.buildShellScript(''), /required/);
const br = azure.buildBrowserScript('https://example.com/secret-path');
assert.doesNotMatch(br, /secret-path/);
assert.throws(() => azure.buildBrowserScript('http://insecure.example'), /HTTPS/);

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
  console.log('azure-vm: ok');
})().catch((e) => { console.error(e); process.exitCode = 1; });
