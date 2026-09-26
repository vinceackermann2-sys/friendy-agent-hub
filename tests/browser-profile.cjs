const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { browserProfileRuntime, buildBrowserSessionScript, buildBrowserRelayScript } = require('../server/agents/azure-vm');

(async () => {
  const script = buildBrowserSessionScript('inspect', { sessionId:'live_abc123', uploadUrl:'https://abc.blob.core.windows.net/shots/a.jpg?sig=test' });
  const relay = buildBrowserRelayScript({ sessionId:'live_abc123', relayUrl:'wss://app.example/ws/live-vm/live_abc123', token:'a'.repeat(40) });
  const decoded = (text) => Buffer.from(text.match(/echo '([^']+)' \| base64 -d/)[1], 'base64').toString('utf8');
  // Functions sent to the VM as text must not call the global require: the production
  // bundler rewrites those calls to __require, which does not exist on the VM.
  const azureVm = require('../server/agents/azure-vm');
  for (const name of ['browserKit', 'browserProfileRuntime', 'liveStreamer', 'desktopKit']) {
    if (azureVm[name]) assert.doesNotMatch(azureVm[name].toString(), /(^|[^.\w])require\(/, `${name} is serialized to the VM and must use the require it is given`);
  }
  assert.match(decoded(script), /profileRuntime\.connectOrLaunch/);
  assert.match(decoded(relay), /profileRuntime\.session/);
  assert.match(decoded(relay), /await page\.close\(\)/);
  assert.doesNotMatch(decoded(relay), /await browser\.close\(\)/, 'stopping one task must not close another task’s browser');
  assert.match(script, /PasswordManagerEnabled.*false/);
  assert.match(relay, /PasswordManagerEnabled.*false/);

  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((file) => fs.existsSync(file));
  if (!chrome) { console.log('browser profile: script checks passed (local Chrome unavailable)'); return; }
  const puppeteer = require('puppeteer-core');
  const tempRoot = path.resolve(__dirname, '..', '.tmp');
  fs.mkdirSync(tempRoot, { recursive: true });
  const root = fs.mkdtempSync(path.join(tempRoot, 'profile-test-'));
  const runtime = browserProfileRuntime(root, require);
  const server = http.createServer((request, response) => {
    if (request.url === '/login') response.setHeader('set-cookie', 'lingon_login=kept; HttpOnly; SameSite=Lax; Path=/');
    response.writeHead(200, { 'content-type': 'text/html' });
    response.end(`<html><body>${request.headers.cookie?.includes('lingon_login=kept') ? 'Signed in' : 'Signed out'}</body></html>`);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${server.address().port}/`;
  // The browser runs on its own. On Windows its helper processes outlive a close and keep the
  // profile locked, so the whole tree ends there, as puppeteer does.
  const close = async (target) => {
    const pid = fs.existsSync(runtime.pidFile) ? fs.readFileSync(runtime.pidFile, 'utf8').trim() : '';
    if (process.platform !== 'win32' || !pid) return target.close();
    await target.disconnect();
    const run = (cmd, args) => { try { return require('node:child_process').execFileSync(cmd, args, { encoding: 'utf8' }); } catch { return ''; } };
    run('taskkill', ['/pid', pid, '/T', '/F']);
    for (let i = 0; i < 120 && run('tasklist', ['/FI', `PID eq ${pid}`, '/NH']).includes(` ${pid} `); i++) await new Promise((resolve) => setTimeout(resolve, 500));
  };
  let browser;
  try {
    // A browser step's process ends by itself once its work is done and leaves the browser
    // running for the next step: the VM runs one command at a time, so a step that never
    // ends blocks every later one.
    const step = require('node:child_process').spawnSync(process.execPath, ['-e', [
      `const runtime = require(${JSON.stringify(require.resolve('../server/agents/azure-vm'))}).browserProfileRuntime(${JSON.stringify(root)}, require);`,
      `runtime.connectOrLaunch(require('puppeteer-core'), ${JSON.stringify(chrome)}).then((b) => b.disconnect());`,
    ].join('\n')], { cwd: path.resolve(__dirname, '..'), timeout: 40000, encoding: 'utf8' });
    assert.equal(step.error, undefined, 'a browser step ends by itself');
    assert.equal(step.status, 0, step.stderr);
    browser = await runtime.connectExisting(puppeteer);
    assert.ok(browser, 'the browser keeps running after the step ends');
    await close(browser); browser = null;
    browser = await runtime.connectOrLaunch(puppeteer, chrome);
    const first = await runtime.session(browser, 'live_first');
    await first.page.goto(`${url}login`);
    assert.equal(await first.page.evaluate(() => document.cookie), '', 'HttpOnly login cookies stay out of page scripts');
    await runtime.saveCookies(browser);
    const second = await runtime.session(browser, 'live_second');
    assert.notEqual(first.page.target()._targetId, second.page.target()._targetId, 'simultaneous tasks get separate tabs');
    await second.page.goto(url);
    assert.match(await second.page.evaluate(() => document.body.innerText), /Signed in/, 'the account profile shares website login state');
    assert.equal((await runtime.session(browser, 'live_first')).reusedPage, true);
    await close(browser); browser = null;
    browser = await runtime.connectOrLaunch(puppeteer, chrome);
    const later = await runtime.session(browser, 'live_later');
    await later.page.goto(url);
    assert.match(await later.page.evaluate(() => document.body.innerText), /Signed in/, 'website login state survives a browser restart');
    console.log('browser profile: cookies persist across tasks and browser restarts, with isolated tabs');
  } finally {
    if (browser) await close(browser).catch(() => {});
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
    const safe = root.startsWith(tempRoot + path.sep) && path.basename(root).startsWith('profile-test-');
    // A killed browser can take a while to let go of its files on Windows.
    if (safe) fs.rmSync(root, { recursive: true, force: true, maxRetries: process.platform === 'win32' ? 80 : 8, retryDelay: 500 });
  }
})().catch((error) => { console.error(error); process.exit(1); });
