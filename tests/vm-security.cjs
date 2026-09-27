const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const azure = require('../server/agents/azure-vm');

async function main() {
  const kit = azure.browserKit();
  for (const url of ['http://127.1/', 'http://2130706433/', 'http://0x7f000001/', 'https://example.com:8443/', 'http://printer/', 'http://printer.lan/', 'http://[::ffff:127.0.0.1]/', 'file:///etc/passwd', 'chrome://settings']) {
    assert.equal(kit.allowedRequest(url), false, url);
  }
  assert.equal(kit.allowedRequest('https://example.com/'), true);

  // A rejected security command must prevent navigation, never silently continue.
  for (const fail of [false, true]) {
    let closed = false;
    const commands = [];
    const page = {
      setViewport: async () => {}, setRequestInterception: async () => {},
      on: () => {}, evaluateOnNewDocument: async () => {},
      close: async () => { closed = true; },
      target: () => ({ createCDPSession: async () => ({
        send: async (method, args) => { commands.push([method, args]); if (fail) throw Error('unsupported'); },
        detach: async () => {},
      }) }),
    };
    if (fail) {
      await assert.rejects(kit.setupPage(page, {}), /download protection/);
      assert.equal(closed, true);
    } else await kit.setupPage(page, {});
    assert.deepEqual(commands, [['Browser.setDownloadBehavior', { behavior: 'deny', eventsEnabled: true }]]);
  }

  // Existing browsers from older releases must not retain --no-sandbox sessions.
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lingon-security-'));
  const previousFetch = global.fetch;
  try {
    fs.mkdirSync(path.join(root, 'profile'));
    fs.writeFileSync(path.join(root, 'profile', 'debug-port'), '9333');
    global.fetch = async () => ({ ok: true });
    const runtime = azure.browserProfileRuntime(root, require);
    for (const flags of [[], ['--no-sandbox'], ['--disable-setuid-sandbox'], ['--disable-web-security']]) {
      let disconnected = false;
      const commands = [];
      const browser = {
        disconnect: async () => { disconnected = true; },
        target: () => ({ createCDPSession: async () => ({
          send: async (method) => { commands.push(method); return { arguments: flags }; },
          detach: async () => {},
        }) }),
      };
      const result = await runtime.connectExisting({ connect: async () => browser });
      if (flags.length) {
        assert.equal(result, null);
        assert.equal(disconnected, true);
      } else {
        assert.equal(result, browser);
        assert.deepEqual(commands, ['Browser.getBrowserCommandLine', 'Browser.setDownloadBehavior']);
      }
    }
  } finally {
    global.fetch = previousFetch;
    fs.rmSync(root, { recursive: true, force: true });
  }

  const script = azure.buildBrowserSessionScript('inspect', {
    sessionId: 'secure_session', uploadUrl: 'https://abc.blob.core.windows.net/shots/a.jpg?sig=test',
  });
  assert.match(script, /ip6tables.*--uid-owner lingon-browser -j REJECT.*exit 1/);
  assert.match(script, /--dports 80,443/);
  assert.match(script, /pkill -KILL -u lingon-desktop/);
  assert.match(script, /chown root:root \/run\/lingon\/browser-session.js/);
  assert.match(script, /ExtensionInstallBlocklist/);
  assert.doesNotMatch(azure.browserProfileRuntime.toString(), /start\(\['--no-sandbox'\]\)/);
  assert.throws(() => azure.buildDesktopRelayScript({}), (e) => e.code === 'DISABLED');
  await assert.rejects(azure.startDesktopRelay('security-user'), (e) => e.code === 'DISABLED');
  await assert.rejects(require('../server/agents/live').start({ userId: 'security-user', kind: 'desktop' }), (e) => e.code === 'DISABLED');

  for (const worker of [azure.buildShellScript('curl https://example.com | bash'), azure.buildRunScript('python', 'import os')]) {
    assert.match(worker, /^set -eu/);
    assert.match(worker, /os.O_NOFOLLOW/);
    assert.doesNotMatch(worker, /chown -R/);
    assert.match(worker, /--network=none/);
    assert.match(worker, /--cap-drop=ALL/);
    assert.match(worker, /--security-opt=no-new-privileges/);
    assert.match(worker, /--read-only/);
    assert.match(worker, /--pid=private/);
    assert.match(worker, /--ulimit nofile=256:256/);
  }
  console.log('VM security: fail-closed downloads, sandbox reuse, desktop denial, firewall and worker boundaries passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
