const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright');

// Full browser regression with isolated auth/API fixtures; no live accounts or work.
const app = path.join(__dirname, '..', 'app');
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://localhost');
  const name = ['/', '/app'].includes(url.pathname) ? 'index.html' : path.basename(url.pathname);
  const file = path.join(app, name);
  if (!fs.existsSync(file)) { res.writeHead(404); res.end(); return; }
  res.setHeader('Content-Type', name.endsWith('.js') ? 'text/javascript' : name.endsWith('.css') ? 'text/css' : 'text/html');
  res.end(fs.readFileSync(file));
});
const session = { access_token:'test-access', refresh_token:'test-refresh', user:{ id:'onboarding-user', email:'vince@example.test' } };
const readState = page => page.evaluate(() => JSON.parse(localStorage.getItem('lingon.v1')));

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = process.env.ONBOARDING_BASE_URL || `http://127.0.0.1:${server.address().port}`;
  const browser = await chromium.launch({ headless:true });
  try {
    for (const mode of ['signin', 'signup', 'oauth']) {
      const context = await browser.newContext({ viewport:{width:1440,height:1000} });
      const page = await context.newPage();
      const errors = [], runs = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => {
        const endpoint = new URL(route.request().url()).pathname;
        let body = {};
        if (endpoint === '/api/auth/' + mode) body = session;
        if (endpoint === '/api/auth/me') body = {user:session.user};
        if (endpoint === '/api/auth/google/enabled') body = {enabled:true};
        if (endpoint === '/api/agent/tasks') body = {tasks:[]};
        if (endpoint === '/api/sandbox/presence') body = {status:'ready', mode:'account-only', warmed:false, container:false};
        if (endpoint === '/api/agent/conversation') {
          runs.push(route.request().postDataJSON());
          return route.fulfill({ contentType:'text/event-stream', body:'data: {"type":"done","status":"completed"}\n\n' });
        }
        await route.fulfill({json:body});
      });
      await page.goto(base + '/app');
      if (mode !== 'signin') {
        await page.evaluate(() => localStorage.setItem('lingon.v1', JSON.stringify({pendingPrompt:'Research electric bikes'})));
        await page.reload();
      }
      if (mode === 'oauth') {
        await page.goto(base + '/app?oauth=1#access_token=test-access&refresh_token=test-refresh');
      } else {
        await page.fill('#aemail', session.user.email);
        await page.click('[data-act="pw-mode"]');
        if (mode === 'signup') await page.click('[data-act="auth-mode"]');
        await page.fill('#apass', 'test-password');
        await page.check('#authlegal');
        await page.click('#pwgo');
      }
      await page.waitForSelector('[data-onboarding-name]');
      assert.deepEqual(await page.locator('button.qopt').allTextContents().then(items => items.map(s=>s.trim())), ['Alex','Rosa','Tao']);
      assert.match(await page.locator('#thread').innerText(), /Hi! (?:I’ve saved your request|Let’s set up your personal agent)/);
      assert.equal(runs.length, 0);
      const chatId = (await readState(page)).activeChat;
      await page.click('[data-act="newchat"]');
      await page.click('[data-act="usermenu"]');
      await page.click('[data-act="nav"][data-view="settings"]');
      await page.keyboard.press('Escape');
      assert.equal((await readState(page)).activeChat, chatId);
      assert.equal((await readState(page)).view, 'chat');
      if (mode === 'signin') {
        await page.fill('[name="agentName"]', '  Sora  ');
        await page.reload();
        assert.equal(await page.inputValue('[name="agentName"]'), '  Sora  ');
        await page.press('[name="agentName"]', 'Enter');
      } else if (mode === 'signup') {
        await page.fill('#cprompt', 'Sora');
        await page.click('#csend');
      } else await page.click('[data-o="Rosa"]');
      await page.waitForSelector('button.qopt .mascot');
      assert.equal(await page.locator('button.qopt .mascot').count(), 7);
      assert.equal((await readState(page)).activeChat, chatId, 'answer must not create a new chat');
      await page.reload();
      await page.waitForSelector('[data-o="Rosehip"]');
      assert.equal((await readState(page)).onboarded, false);
      assert.equal(runs.length, 0, 'request waits until the name and color are chosen');
      await page.click('[data-o="Rosehip"]');
      await page.waitForSelector('.canvas-tabs [data-t="canvas"].on');
      await page.waitForFunction(() => /own secure computer/.test(document.querySelector('#thread')?.innerText || ''));
      assert.match(await page.locator('#thread').innerText(), /own secure computer/);
      assert.equal(await page.locator('button.qopt').count(), 0, 'no expression/personality step');
      assert.equal(await page.locator('[data-act="open-passport"]').count(), 0, 'no start chatting card');
      assert.doesNotMatch(await page.locator('#thread').innerText(), /Start chatting|\bHej\b/);
      const final = await readState(page);
      assert.equal(final.onboarded, true);
      assert.equal(final.agent.name, mode === 'oauth' ? 'Rosa' : 'Sora');
      assert.equal(final.agent.color, 'rose');
      assert.equal(final.canvasTab, 'canvas');
      if (mode === 'signin') assert.equal(runs.length, 0, 'setup without a saved request stays ready for chat');
      else {
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).chats.some(c=>c.managedStatus === 'completed'));
        assert.equal(runs.length, 1, 'saved request starts when color is chosen');
        assert.equal(runs[0].prompt, 'Research electric bikes');
        assert.match(await page.locator('#thread').innerText(), /getting started on your request now/);
      }
      assert.equal(await page.locator('.canvas-tabs [data-t="passport"]').count(), 0);
      assert.equal(await page.locator('.canvas-tabs [data-t="library"]').count(), 0);
      await page.waitForFunction(() => {
        const text = document.querySelector('.agent-hero-status')?.textContent || '';
        return /Available|Agent ready/.test(text) && !/Disconnected/.test(text);
      });
      if (!await page.locator('[data-act="nav"][data-view="settings"]').count()) await page.click('[data-act="usermenu"]');
      await page.click('[data-act="nav"][data-view="settings"]');
      assert.equal(await page.locator('[data-act="stab"][data-t="library"]').count(), 0);
      assert.equal(await page.locator('[data-act="stab"][data-t="theme"]').count(), 0);
      assert.match(await page.locator('.psec').allInnerTexts().then(items => items.join('\n')), /Theme[\s\S]*Chat color/);
      await page.click('[data-act="open-library"]');
      await page.waitForSelector('.lib-head h1');
      assert.equal(await page.locator('.lib-head h1').innerText(), 'All artifacts');
      assert.equal(await page.locator('[data-act="libcat"][data-cat="memory"]').count(), 0, 'memory lives under System files only');
      await page.click('[data-act="nav"][data-view="chat"]');
      // A React route remount replaces the host without re-executing scripts.
      await page.evaluate(async () => {
        const next = document.createElement('div'); next.id = 'root';
        document.getElementById('root').replaceWith(next);
        await window.LingonAppRuntime.mount(next);
      });
      await page.waitForSelector('#app');
      await page.reload();
      await page.waitForSelector('#app');
      assert.equal(await page.locator('[data-onboarding-name]').count(), 0);
      assert.equal(runs.length, mode === 'signin' ? 0 : 1, 'refresh must not repeat the request');
      assert.deepEqual(errors, []);
      console.log(`${mode}: onboarding, resume, canvas and remount passed`);
      await context.close();
    }
  } finally { await browser.close(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); server.close(); process.exitCode = 1; });
