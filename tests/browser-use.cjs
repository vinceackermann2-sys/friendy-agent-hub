const assert = require('node:assert/strict');
const fs = require('node:fs');
const { TOOLS } = require('../server/agents/tools');
const { browserKit } = require('../server/agents/azure-vm');

// Browser use: validated human-like actions, the owner-approved final step, the
// public-web rule, and (when Chrome is installed) the VM kit on a real page.
const ctx = { userId: 'u', sessionId: 's', trace: () => {} };
const rejects = (name, args, pattern) => assert.rejects(TOOLS[name].run(args, ctx), pattern);

(async () => {
  assert.equal(TOOLS.browser_submit.approval, true, 'the final step on a website needs the owner');
  assert.equal(TOOLS.browser_action.approval, false);
  await rejects('browser_open', { url: 'http://169.254.169.254/latest/meta-data' }, /private address/);
  await rejects('browser_open', { url: 'http://localhost:3000/admin' }, /Cannot open this address/);
  await rejects('browser_open', { url: 'file:///etc/passwd' }, /http and https/);
  await rejects('browser_action', { type: 'teleport' }, /Unsupported browser action/);
  await rejects('browser_action', { type: 'click' }, /needs a ref, or x and y/);
  await rejects('browser_action', { type: 'click', ref: 'abc' }, /element number/);
  await rejects('browser_action', { type: 'click', x: 5000, y: 10 }, /inside the 1280x900/);
  await rejects('browser_action', { type: 'select', x: 10, y: 10, value: 'Large' }, /ref of a dropdown/);
  await rejects('browser_action', { type: 'drag', ref: 3 }, /to_ref, or to_x and to_y/);
  await rejects('browser_action', { type: 'scroll', dy: 99999 }, /Invalid scroll distance/);
  await rejects('browser_action', { type: 'type', ref: 2 }, /type needs text/);
  await rejects('browser_action', { type: 'type', ref: 2, text: '4111 1111 1111 1111' }, /cannot type a payment card/);
  await rejects('browser_submit', { type: 'click', ref: 4 }, /needs a summary/);
  // A valid action reaches the live session (none is open in this test).
  await rejects('browser_action', { type: 'click', ref: 4 }, /Open a browser page before/);

  // Computer use: a virtual desktop on the VM, driven with xdotool.
  const azure = require('../server/agents/azure-vm');
  assert.equal(TOOLS.computer_submit.approval, true, 'the final step on the computer needs the owner');
  assert.equal(TOOLS.computer_action.approval, false);
  await rejects('computer_action', { action: 'launch_rockets' }, /Unsupported computer action/);
  await rejects('computer_action', { action: 'click', x: 1400, y: 10 }, /inside the 1280x900 screen/);
  await rejects('computer_action', { action: 'drag', x: 1, y: 1 }, /to_x and to_y/);
  await rejects('computer_action', { action: 'open_app', app: 'terminal' }, /browser, files and editor/);
  await rejects('computer_action', { action: 'open_app', app: 'browser', url: 'http://169.254.169.254/' }, /private address/);
  await rejects('computer_action', { action: 'key' }, /key needs a key/);
  await rejects('computer_submit', { action: 'click', x: 5, y: 5 }, /needs a summary/);
  // The Node relay path never runs a desktop natively; the hosted app uses the locked container.
  await rejects('computer_action', { action: 'screenshot' }, /own container over the live channel/);
  const desk = azure.desktopKit();
  assert.deepEqual(desk.steps({ type: 'click', x: 10, y: 20, agent: true }), [{ xdotool: ['mousemove', '10', '20'] }, { sleep: 120 }, { xdotool: ['click', '1'] }]);
  assert.deepEqual(desk.steps({ type: 'click', x: 10, y: 20, button: 2 }), [{ xdotool: ['mousemove', '10', '20'] }, { xdotool: ['click', '3'] }], 'user clicks are instant');
  assert.deepEqual(desk.steps({ type: 'type', text: '--help me', submit: true, agent: true }), [{ xdotool: ['type', '--clearmodifiers', '--delay', '35', '--file', '-'], stdin: '--help me' }, { xdotool: ['key', 'Return'] }], 'typed text goes through stdin, never the command line');
  assert.deepEqual(desk.steps({ type: 'key', key: 'Ctrl+Shift+T' }), [{ xdotool: ['key', '--clearmodifiers', 'ctrl+shift+t'] }]);
  assert.deepEqual(desk.steps({ type: 'key', key: 'ArrowLeft' }), [{ xdotool: ['key', '--clearmodifiers', 'Left'] }], 'live view key names map to X keys');
  assert.deepEqual(desk.steps({ type: 'scroll', dy: 300 }), [{ xdotool: ['click', '--repeat', '3', '--delay', '30', '5'] }]);
  assert.equal(desk.steps({ type: 'drag', x: 0, y: 0, to_x: 80, to_y: 40 }).filter((step) => step.xdotool?.[0] === 'mousemove').length, 9, 'drags move in steps');
  assert.throws(() => desk.steps({ type: 'key', key: 'rm -rf /' }), /Unknown key/);
  assert.throws(() => desk.steps({ type: 'open_app', app: 'terminal' }), /browser, files and editor/);
  await assert.rejects(azure.startDesktopRelay('u', { sessionId: 'live_desk1' }), (error) => error.code === 'DISABLED', 'the desktop never starts outside its container');

  // Vault credentials: listed by name, typed only after approval, only on the
  // approved site or window, and never returned to the model.
  const store = require('../server/store');
  const live = require('../server/agents/live');
  const saved = { listSecrets: store.listSecrets, revealSecret: store.revealSecret, forTool: live.forTool, forDesktop: live.forDesktop, agentInput: live.agentInput };
  store.listSecrets = async () => [{ id: 'sec_gh12_x', ref: 'sec_gh12', name: 'GitHub password', at: 1 }, { id: 'sec_card_y', ref: 'sec_card', name: 'Visa card number', at: 2 }];
  store.revealSecret = async (_, id) => ({ sec_gh12_x: 'hunter2-secret', sec_card_y: '4111111111111111' })[id] || '';
  const typed = [];
  const page = { id: 'live_1', url: 'https://github.com/login', title: 'Sign in', elements: ['[2] input:password "Password" (filled from the vault)'], relay: {} };
  live.forTool = async () => page;
  live.forDesktop = async () => ({ id: 'live_2', title: 'Chromium', windows: ['Bank - Chromium'], screenshot: '' });
  live.agentInput = async (s, ev) => { typed.push(ev); return s; };
  try {
    assert.equal(TOOLS.browser_fill_secret.approval, true);
    assert.equal(TOOLS.computer_fill_secret.approval, true);
    assert.deepEqual(await TOOLS.vault_list.run({}, ctx), { secrets: [{ ref: 'sec_gh12', name: 'GitHub password' }, { ref: 'sec_card', name: 'Visa card number' }] });
    const detail = JSON.parse(await TOOLS.browser_fill_secret.approvalDetail({ secret: 'sec_gh12', ref: 2, host: 'github.com' }, { userId: 'u' }));
    assert.equal(detail.summary, 'Type your saved “GitHub password” on github.com', 'the owner sees which secret goes where');
    await rejects('browser_fill_secret', { secret: 'sec_gh12', ref: 2, host: 'evil.example' }, /not evil\.example\. Nothing was typed/);
    await rejects('browser_fill_secret', { secret: 'sec_nope', ref: 2, host: 'github.com' }, /No vault secret/);
    await rejects('browser_fill_secret', { secret: 'hunter2', ref: 2, host: 'github.com' }, /vault ref/);
    assert.equal(typed.length, 0);
    const out = await TOOLS.browser_fill_secret.run({ secret: 'sec_gh12', ref: 2, host: 'github.com', submit: true }, ctx);
    assert.deepEqual({ ...typed[0] }, { type: 'type', agent: true, ref: 2, text: 'hunter2-secret', clear: true, submit: true, secret: true });
    assert.ok(!JSON.stringify(out).includes('hunter2'), 'the value never comes back to the model');
    page.url = 'https://gist.github.com/';
    await rejects('browser_fill_secret', { secret: 'sec_gh12', ref: 2, host: 'github.com' }, /not github\.com\. Nothing was typed/);
    assert.equal(typed.length, 1, 'a related subdomain does not inherit a login');
    await rejects('computer_fill_secret', { secret: 'sec_card', x: 10, y: 10 }, /window is text/);
    await rejects('computer_fill_secret', { secret: 'sec_card', x: 400, y: 300, window: 'Bank' }, /cannot be filled/);
    assert.equal(typed.length, 1, 'an old saved card number was never typed');

    // A missing credential is requested through a secure chat card; the model
    // only learns the ref of what the owner saved.
    assert.equal(TOOLS.vault_request.approval, true, 'the owner types the value, the model never does');
    assert.equal(TOOLS.vault_request.sideEffects, false, 'an unsaved request is not an unknown outcome');
    assert.deepEqual(TOOLS.vault_request.approvalCard({ name: '  GitHub   password ', host: 'https://github.com/login', reason: 'To sign in' }),
      { type: 'secret', kind: 'login', suggest: 'GitHub password', host: 'github.com', note: 'To sign in' });
    assert.deepEqual(TOOLS.vault_request.approvalCard({ name: 'Service API key', kind: 'api_key', host: 'service.example' }),
      { type: 'secret', kind: 'api_key', suggest: 'Service API key', host: 'service.example', note: '' });
    assert.throws(() => TOOLS.vault_request.approvalCard({ name: ' ' }), /short label/);
    assert.throws(() => TOOLS.vault_request.approvalCard({ name: 'Visa card number' }), /must stay with the merchant/);
    assert.deepEqual(await TOOLS.vault_request.run({ name: 'GitHub password' }, ctx), { ref: 'sec_gh12', name: 'GitHub password', saved: true });
    store.listSecrets = async () => [{ id:'sec_loginp', ref:'sec_pw12', name:'github.com password' }, { id:'sec_loginu', ref:'sec_un12', name:'github.com username' }];
    assert.deepEqual(await TOOLS.vault_request.run({ name: 'GitHub password', host: 'https://www.github.com/login', kind:'login' }, ctx),
      { ref:'sec_pw12', usernameRef:'sec_un12', name:'github.com password', saved:true }, 'the model receives only login refs');
    assert.throws(() => TOOLS.vault_request.approvalCard({ name:'Login', kind:'login' }), /valid host/);
    assert.throws(() => TOOLS.vault_request.approvalCard({ name: 'Bank PIN' }), /identity app/);
    assert.ok(require('../server/agents/tools').pickTools('log in to my bank').some((tool) => tool.name === 'vault_request'));
  } finally {
    Object.assign(store, { listSecrets: saved.listSecrets, revealSecret: saved.revealSecret });
    Object.assign(live, { forTool: saved.forTool, forDesktop: saved.forDesktop, agentInput: saved.agentInput });
  }
  // Without a live relay a secret is never sent through a Run Command script.
  await assert.rejects(live.agentInput({ id: 'x', userId: 'u', kind: 'browser', relay: null, viewers: new Set(), userControl: false }, { type: 'type', text: 'v', secret: true }), /secret was not typed/);

  const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', '/usr/bin/google-chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find((p) => fs.existsSync(p));
  let puppeteer = null;
  try { puppeteer = require('puppeteer-core'); } catch {}
  if (!chrome || !puppeteer) {
    console.log('browser and computer use: validation, approval, public-web rules, desktop steps: ok (no local Chrome, kit check skipped)');
    return;
  }
  const kit = browserKit();
  const told = [];
  kit.setAnnouncer((pointer) => told.push({ ...pointer }));
  const browser = await puppeteer.launch({ headless: true, executablePath: chrome });
  try {
    const page = (await browser.pages())[0];
    const state = {};
    await kit.setupPage(page, state);
    await page.setContent(`<title>Kit</title>
      <label>Name <input id="name"></label>
      <label>Password <input type="password" id="pw"></label>
      <label>Card <input autocomplete="cc-number"></label>
      <label>Size <select name="size"><option value="s">Small</option><option value="l">Large</option></select></label>
      <button onclick="document.getElementById('out').textContent=[document.getElementById('name').value,document.querySelector('select').value].join(' ')">Continue</button>
      <button onclick="confirm('Delete everything?') && (document.title='deleted')">Delete</button>
      <a href="https://example.com/" target="_blank">Offer</a>
      <div id="out"></div><div style="height:1600px"></div><button>Far</button>`);
    let snap = await kit.snapshot(page, state);
    const ref = (label) => Number(snap.elements.find((line) => line.includes(label)).match(/^\[(\d+)\]/)[1]);
    assert.ok(snap.elements.some((line) => /input:password "Password" \(password\/payment field/.test(line)));
    assert.ok(snap.elements.some((line) => /select "Size" = "Small"/.test(line)), 'dropdowns are named by their label');
    assert.ok(!snap.elements.some((line) => line.includes('"Far"')), 'only elements in view are listed');
    await kit.act(page, { type: 'type', ref: ref('Name'), text: 'Ada', agent: true });
    await kit.act(page, { type: 'select', ref: ref('Size'), value: 'Large', agent: true });
    await kit.act(page, { type: 'click', ref: ref('Continue'), agent: true });
    assert.equal(await page.$eval('#out', (el) => el.textContent), 'Ada l');
    // People watching see where the agent points and what it does; nothing is drawn into the page.
    assert.ok(told.some((p) => p.text === 'Typing “Ada”'), 'the live view says what the agent types');
    assert.ok(told.some((p) => p.text === 'Clicking “Continue”' && Number.isFinite(p.x) && Number.isFinite(p.y)), 'and where it clicks');
    assert.ok(told.some((p) => p.text === 'Clicking “Continue”' && p.pressed === true), 'a click shows as a press');
    assert.equal(await page.$('#__lingon_pointer'), null, 'the page the agent reads stays clean');
    told.length = 0;
    snap = await kit.snapshot(page, state);
    // Credentials are typed from the vault; their values never return in the page state.
    await kit.act(page, { type: 'type', ref: ref('Password'), text: 'hunter2-secret', clear: true, secret: true, agent: true });
    await kit.act(page, { type: 'type', ref: ref('Card'), text: '4111111111111111', clear: true, secret: true, agent: true });
    await kit.act(page, { type: 'type', ref: ref('Name'), text: 'Ada Lovelace', clear: true, secret: true, agent: true });
    assert.equal(await page.$eval('#pw', (el) => el.value), 'hunter2-secret');
    assert.ok(told.some((p) => p.text === 'Filling in a saved value'), 'a vault fill is described, not shown');
    assert.ok(!JSON.stringify(told).includes('hunter2') && !JSON.stringify(told).includes('4111') && !JSON.stringify(told).includes('Lovelace'), 'the live view never shows a vault value');
    const filled = await kit.snapshot(page, state);
    assert.equal(filled.sensitivePresent, true, 'sensitive fields suppress model screenshots');
    assert.ok(filled.elements.some((line) => /input:password "Password" \(filled from the vault\)/.test(line)));
    assert.ok(filled.elements.some((line) => /"Name" \(filled from the vault\)/.test(line)), 'a vault value in an ordinary field is hidden too');
    assert.ok(!JSON.stringify(filled).includes('hunter2') && !JSON.stringify(filled).includes('4111') && !JSON.stringify(filled).includes('Lovelace'));
    await kit.act(page, { type: 'type', ref: ref('Password'), text: 'typed by the user', clear: true });
    assert.equal(await page.$eval('#pw', (el) => el.value), 'typed by the user', 'the user can type in any field after taking over');
    assert.ok(!JSON.stringify(told).includes('typed by the user'), 'the owner’s own input is not announced');
    await kit.act(page, { type: 'click', ref: ref('Delete'), agent: true });
    snap = await kit.snapshot(page, state);
    assert.equal(snap.dialog, 'confirm: Delete everything?');
    assert.equal(snap.title, 'Kit', 'confirm dialogs are declined');
    await kit.act(page, { type: 'scroll', dy: 1400, agent: true });
    snap = await kit.snapshot(page, state);
    assert.ok(snap.scrollY > 0 && snap.elements.some((line) => line.includes('"Far"')));
    await kit.act(page, { type: 'key', key: 'Control+Home', agent: true });
    assert.equal((await kit.snapshot(page, state)).scrollY, 0);
    await assert.rejects(kit.act(page, { type: 'click', ref: 999, agent: true }), /no longer on the page/);
    await assert.rejects(kit.open(page, 'http://169.254.169.254/latest'), /public http and https/);
    console.log('browser and computer use: validation, approval, public-web rules, desktop steps, and the VM browser kit on a real page: ok');
  } finally {
    await browser.close();
  }
})().catch((e) => { console.error(e); process.exitCode = 1; });
