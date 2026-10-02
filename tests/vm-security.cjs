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
  assert.doesNotMatch(script, /iptables -I OUTPUT -m owner --uid-owner lingon-desktop -j REJECT/, 'no blanket block: the desktop runs in its guarded container');
  // The old native desktop relay stays closed on every path.
  await assert.rejects(azure.startDesktopRelay('security-user'), (e) => e.code === 'DISABLED');
  await assert.rejects(require('../server/agents/live').start({ userId: 'security-user', kind: 'desktop' }), (e) => e.code === 'DISABLED');

  // The computer: the whole desktop runs in one locked, rootless container.
  const live = { url: 'wss://abcdefgh.supabase.co/realtime/v1/websocket', key: 'k'.repeat(40), topic: `live-${'a'.repeat(43)}`, cmdKey: 'f'.repeat(64) };
  assert.throws(() => azure.buildDesktopSessionScript({ sessionId: 'desk_security', live: { ...live, cmdKey: '' } }), (e) => e.code === 'BAD_INPUT', 'no desktop without signed steps');
  const desktop = azure.buildDesktopSessionScript({ sessionId: 'desk_security', live });
  const run = desktop.split('\n').find((line) => / podman run /.test(line));
  assert.match(desktop, /^set -eu/);
  assert.match(run, /^systemd-run --scope .*-p MemoryMax=2G -p CPUQuota=150% -p TasksMax=768 -- runuser -u lingon-desktop -- /, 'rootless, as lingon-desktop, with limits');
  for (const flag of ['--cap-drop=ALL', '--security-opt=no-new-privileges', '--read-only', '--user 1000:1000', '--ipc=private', '--pid=private', '--uts=private',
    '--network=slirp4netns:enable_ipv6=false,allow_host_loopback=false', '--tmpfs /tmp:rw,nosuid,nodev,noexec']) assert.ok(run.includes(flag), flag);
  assert.doesNotMatch(run, /--privileged|--network=host|--pid=host|--ipc=host|--userns=host|seccomp=unconfined|apparmor=unconfined|docker\.sock|podman\.sock/);
  assert.doesNotMatch(run, /--cap-add/, 'no capabilities');
  // Chromium's sandbox gets chroot from a seccomp profile (podman's default plus chroot), not a capability.
  assert.match(run, /--security-opt=seccomp=\/etc\/lingon\/desktop-seccomp\.json/);
  const mounts = [...run.matchAll(/--volume '?([^ ']+)'?/g)].map((m) => m[1]);
  assert.deepEqual(mounts, ['/var/lib/lingon-desktop/home:/home/desktop:rw,noexec,nosuid,nodev', '/run/lingon/desktop/desk_security/desktop.js:/opt/lingon/desktop.js:ro'], 'only its own home and its code');
  // Its traffic leaves as lingon-desktop, so the browser's firewall applies to it too.
  assert.match(desktop, /--uid-owner lingon-desktop -d "\$NET" -j REJECT/);
  assert.match(desktop, /ip6tables -C OUTPUT -m owner --uid-owner lingon-desktop -j REJECT/);
  assert.match(desktop, /--uid-owner lingon-desktop -p tcp -m multiport ! --dports 80,443 -j REJECT/);
  assert.match(desktop, /while iptables -D OUTPUT -m owner --uid-owner lingon-desktop -j REJECT/);
  assert.ok(desktop.indexOf('--uid-owner lingon-desktop -d "$NET"') < desktop.indexOf(' podman run '), 'firewall before the container');
  // Another task's desktop still in use is never removed: this session waits its turn.
  const busy = desktop.indexOf('echo DESKTOP_BUSY'), evict = desktop.indexOf('ps -a -q --filter label=lingon.desktop=1');
  assert.ok(busy > 0 && busy < evict, 'the in-use check comes before other desktops are removed');
  assert.match(desktop, /stat -c %Y '\/var\/lib\/lingon-desktop\/home\/\.lingon-in-use'\) \)\)" -lt 300 \]; then echo DESKTOP_BUSY; exit 0; fi/);
  assert.match(azure.desktopStreamerSource(), /\.lingon-in-use/, 'the desktop marks itself in use on each step');
  // The image has no way to change user and no terminal; the browser keeps its sandbox.
  const image = azure.desktopContainerfile();
  assert.match(image, /find \/ -xdev -perm \/6000 -type f -exec chmod a-s/);
  assert.match(image, /rm -f \/usr\/bin\/x-terminal-emulator/);
  assert.match(image, /^USER 1000:1000$/m);
  assert.match(image, /DownloadRestrictions/);
  const streamer = azure.desktopStreamerSource();
  assert.doesNotMatch(streamer, /--no-sandbox|disable-setuid-sandbox|disable-namespace-sandbox/);
  assert.match(streamer, /timingSafeEqual/);
  assert.match(streamer, /p\.event && p\.event\.secret\)\) return false/, 'vault values never reach the computer');
  assert.doesNotMatch(azure.desktopStreamerSource().match(/const env = \{[^}]*\}/)[0], /PAYLOAD/, 'apps never get the launch payload');
  // Ubuntu 22.04's podman (3.4), as found on a live VM: no --pull=missing, rm -t or tmpfs uid=,
  // and rootless podman must not start in the command runner's root-only folder.
  const provider = require('fs').readFileSync(require.resolve('../server/agents/azure-vm'), 'utf8');
  assert.doesNotMatch(provider, /--pull=missing| rm -f (-a )?-t |,uid=\d/);
  assert.ok(desktop.indexOf("'cd /'") < 0 && desktop.split('\n').indexOf('cd /') < desktop.indexOf(' podman '), 'podman starts from /');
  // The print service a Chromium snap brought is stopped, and new VMs do not install that snap.
  assert.match(desktop, /snap stop --disable cups/);
  assert.doesNotMatch(Buffer.from(azure.cloudInit(azure.azureConfig()), 'base64').toString('utf8'), /snap install chromium/);

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
  console.log('VM security: fail-closed downloads, sandbox reuse, locked desktop container, firewall and worker boundaries passed');
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
