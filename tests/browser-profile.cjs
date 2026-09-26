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
  let browser;
  try {
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
    await browser.close(); browser = null;
    browser = await runtime.connectOrLaunch(puppeteer, chrome);
    const later = await runtime.session(browser, 'live_later');
    await later.page.goto(url);
    assert.match(await later.page.evaluate(() => document.body.innerText), /Signed in/, 'website login state survives a browser restart');
    console.log('browser profile: cookies persist across tasks and browser restarts, with isolated tabs');
  } finally {
    if (browser) await browser.close().catch(() => {});
    const closed = new Promise((resolve) => server.close(resolve));
    server.closeAllConnections();
    await closed;
    const safe = root.startsWith(tempRoot + path.sep) && path.basename(root).startsWith('profile-test-');
    if (safe) fs.rmSync(root, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
  }
})().catch((error) => { console.error(error); process.exit(1); });
