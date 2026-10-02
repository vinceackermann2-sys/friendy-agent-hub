const assert = require('node:assert/strict');
const puppeteer = require('puppeteer');
const { TOOLS } = require('../server/agents/tools');

const base = process.env.BASE || 'http://127.0.0.1:8000';
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const step = (text) => console.log('• ' + text);

async function signup(prefix) {
  const email = `${prefix}${Date.now()}@example.com`;
  const response = await fetch(base + '/api/auth/signup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'AgentChat123!', terms_version: '2026-09-24' }),
  });
  const body = await response.json();
  assert.equal(response.ok, true, body.error || `signup failed (${response.status})`);
  return { access_token: body.access_token, refresh_token: body.refresh_token, user: body.user };
}

async function api(session, path, options = {}) {
  const response = await fetch(base + path, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...(options.headers || {}),
    },
  });
  const body = await response.json();
  return { response, body };
}

async function send(page, text) {
  await page.waitForSelector('#cprompt');
  await page.locator('#cprompt').fill(text);
  await page.keyboard.press('Enter');
}

async function newChat(page) {
  await page.locator('[data-act="newchat"]').click();
  await page.waitForSelector('#cprompt');
}

async function main() {
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.ok, true);
  assert.equal(health.foundry, true);
  assert.equal(health.supabase, true);

  const session = await signup('agentchat');
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  const browserErrors = [];
  await page.setViewport({ width: 1440, height: 900 });
  page.on('pageerror', (error) => browserErrors.push('PAGEERROR: ' + error.message));
  page.on('console', (message) => {
    if (message.type() !== 'error') return;
    const url = message.location()?.url || '';
    if (url.startsWith(base + '/api/github/prs')) return;
    if (!url || url.startsWith(base)) browserErrors.push('CONSOLE: ' + message.text());
  });

  try {
    await page.goto(base, { waitUntil: 'load' });
    await page.evaluate((value) => {
      localStorage.clear();
      localStorage.setItem('lingon.session', JSON.stringify(value));
    }, session);
    await page.reload({ waitUntil: 'load' });
    await page.locator('[data-act="open-app"]').click();
    await page.locator('[data-act="ob-claim"]').click();
    await page.locator('#obname').fill('Harness');
    await page.locator('[data-act="ob-next"]').click();
    await page.locator('[data-act="ob-next"]').click();
    await page.locator('[data-act="ob-done"]').click();
    await page.waitForSelector('#cprompt');
    step('Puppeteer opened and onboarded a real account');

    const marker = `orchard-${Date.now()}`;
    await send(page, `Remember that my exact project codename is ${marker}`);
    await page.waitForFunction((value) => {
      const cards = [...document.querySelectorAll('.acard')];
      return cards.some((card) => card.textContent.includes('Saved to memory') && card.textContent.includes(value));
    }, { timeout: 30000 }, marker);
    await newChat(page);
    await send(page, 'What do you remember about me?');
    await page.waitForFunction((value) => document.querySelector('#tinner')?.textContent?.includes(value), { timeout: 30000 }, marker);
    step('memory card persists and recalls across chats');

    const { body: ownMemory } = await api(session, '/api/memories');
    assert(ownMemory.memories.some((memory) => memory.text.includes(marker)));
    const other = await signup('isolated');
    const { body: otherMemory } = await api(other, '/api/memories');
    assert.equal(otherMemory.memories.some((memory) => memory.text.includes(marker)), false);
    step('memory is isolated between accounts');

    const runBuild = async () => {
      await newChat(page);
      await send(page, `Build a landing page for ${marker} with a blue hero`);
      await page.waitForSelector('.qopt', { timeout: 30000 });
      await page.locator('.qopt').click();
      const handle = await page.waitForFunction(() => {
        if (document.querySelector('.arti-frame iframe[sandbox="allow-scripts"]')) return 'done';
        if (document.querySelector('#tinner')?.textContent?.includes("couldn't generate that page")) return 'failed';
        return false;
      }, { timeout: 90000 });
      return handle.jsonValue();
    };
    let buildResult = await runBuild();
    if (buildResult === 'failed') buildResult = await runBuild();
    assert.equal(buildResult, 'done', 'page generation failed twice');
    const source = await page.$eval('.arti-frame iframe', (frame) => frame.getAttribute('srcdoc') || '');
    assert.match(source, /<html|<!doctype/i);
    await page.waitForFunction(() => [...document.querySelectorAll('.filrow b')].some((node) => node.textContent === 'your-page.html'), { timeout: 30000 });
    await page.locator('[data-act="ctab"][data-t="agent"]').click();
    await page.locator('[data-act="agenttab"][data-t="library"]').click();
    await page.waitForFunction(() => document.querySelector('#cbody')?.textContent?.includes('your-page.html'));
    step('build creates sandboxed HTML, file card, and library context');

    await page.locator('[data-act="ctab"][data-t="subagents"]').click();
    await page.waitForSelector('[data-act="ask-automation"]');
    assert.equal(await page.$$eval('#subname, #subprompt, #subtrigger, [data-act="create-subagent"]', nodes => nodes.length), 0);
    await page.locator('[data-act="ask-automation"]').click();
    assert.equal(await page.$eval('#cprompt', node => node.value), 'Help me set up an automation. I want to ');
    const { response: manualCreate } = await api(session, '/api/sub-agents', {
      method: 'POST',
      body: JSON.stringify({ name: 'Manual watcher', prompt: 'Check', trigger: { type: 'schedule', intervalMinutes: 60 } }),
    });
    assert.equal(manualCreate.status, 403);
    step('automations use agent chat and reject manual creation');

    await newChat(page);
    await send(page, 'Review my GitHub pull requests');
    await page.waitForSelector('[data-act="save-secret"]', { timeout: 30000 });
    await page.locator('[data-f="val"]').fill('ghp_invalid_harness_token');
    await page.locator('[data-act="save-secret"]').click();
    await page.waitForSelector('[data-act="approve"]', { timeout: 30000 });
    const chatBeforeApproval = await page.$eval('#tinner', (node) => node.textContent);
    assert.equal(chatBeforeApproval.includes('ghp_invalid_harness_token'), false);
    await page.locator('[data-act="approve"]').click();
    await page.waitForFunction(() => document.querySelector('#tinner')?.textContent?.includes('GitHub call failed'), { timeout: 60000 });
    const chatAfterApproval = await page.$eval('#tinner', (node) => node.textContent);
    assert.equal(chatAfterApproval.includes('ghp_invalid_harness_token'), false);
    assert(chatAfterApproval.includes('Read-only tool output'));
    step('secret, approval, and computer cards fail safely without token leakage');

    const pcRun = await api(session, '/api/pc/run', { method: 'POST', body: JSON.stringify({ code: 'process.env' }) });
    assert.equal(pcRun.response.status, 501);
    assert.match(pcRun.body.error, /disabled/i);

    const traces = [];
    const opened = await TOOLS.browser_open.run(
      { url: 'https://en.wikipedia.org/wiki/Lingonberry' },
      { signal: new AbortController().signal, trace: (entry) => traces.push(entry) },
    );
    assert.equal(opened.ok, true);
    assert.match(opened.url, /^https:\/\//);
    assert(opened.title.length > 0);
    assert(opened.screenshot?.startsWith('data:image/jpeg;base64,'));
    await assert.rejects(
      TOOLS.browser_open.run(
        { url: 'https://example.com/' },
        { signal: new AbortController().signal, trace: () => {} },
      ),
      (error) => error?.code === 'HOST_BLOCKED',
    );
    await assert.rejects(
      TOOLS.code_run.run({}, { trace: (entry) => traces.push(entry) }),
      (error) => error?.code === 'DISABLED',
    );
    step('allowlisted browser works; blocked network and arbitrary code stay denied');

    await page.setViewport({ width: 390, height: 844 });
    await page.goto(base, { waitUntil: 'load' });
    await page.waitForSelector('#cprompt');
    const mobile = await page.evaluate(() => ({
      toggle: !!document.querySelector('[data-act="togglemenu"]'),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }));
    assert.equal(mobile.toggle, true);
    assert(mobile.overflow <= 1, `mobile horizontal overflow: ${mobile.overflow}px`);
    await page.screenshot({ path: 'C:/Users/vince/AppData/Local/Temp/opencode/lingon-agent-chat-mobile.png', fullPage: true });
    step('mobile chat layout renders without horizontal overflow');

    assert.deepEqual(browserErrors, []);
    console.log('AGENT CHAT BROWSER PASS');
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error('AGENT CHAT BROWSER FAIL — ' + error.stack);
  process.exit(1);
});
