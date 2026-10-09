const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startAppServer } = require('./helpers/app-server.cjs');

// Full browser regression with isolated auth/API fixtures; no live accounts or work.
const session = { access_token:'test-access', refresh_token:'test-refresh', user:{ id:'onboarding-user', email:'vince@example.test' } };
const readState = page => page.evaluate(() => JSON.parse(localStorage.getItem('lingon.v1')));

(async () => {
  const server = await startAppServer();
  const base = process.env.ONBOARDING_BASE_URL || server.base;
  const browser = await chromium.launch({ headless:true });
  try {
    for (const mode of ['signin', 'signup', 'oauth', 'mobile']) {
      const mobile = mode === 'mobile';
      const context = await browser.newContext({ viewport:mobile ? {width:393,height:852} : {width:1440,height:1000}, reducedMotion:mobile ? 'reduce' : 'no-preference' });
      const page = await context.newPage();
      const errors = [], runs = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.route('**/api/**', async route => {
        const endpoint = new URL(route.request().url()).pathname;
        let body = {};
        if (endpoint === '/api/auth/' + mode) body = session;
        if (endpoint === '/api/auth/me') body = {user:session.user};
        if (endpoint === '/api/auth/lookup') body = {exists:mode === 'signin'};
        if (endpoint === '/api/auth/google/enabled') body = {enabled:true};
        if (endpoint === '/api/composio/apps') body = {apps:[{toolkit:'gmail',name:'Gmail',connected:false,accounts:[]}]};
        if (endpoint === '/api/composio/connector/gmail') body = {permissions:[],accounts:[]};
        if (endpoint === '/api/agent/tasks') body = {tasks:[]};
        if (endpoint === '/api/sandbox/presence') body = {status:'ready', mode:'account-only', warmed:false, container:false};
        if (endpoint === '/api/agent/conversation') {
          runs.push(route.request().postDataJSON());
          return route.fulfill({ contentType:'text/event-stream', body:'data: {"type":"done","status":"completed"}\n\n' });
        }
        await route.fulfill({json:body});
      });
      await page.goto(base + '/app');
      if (mode !== 'signin' && !mobile) {
        await page.evaluate(() => localStorage.setItem('lingon.v1', JSON.stringify({pendingPrompt:'Research electric bikes'})));
        await page.reload();
      }
      if (mobile) {
        await page.evaluate(sess => localStorage.setItem('lingon.session', JSON.stringify(sess)), session);
        await page.reload();
      } else if (mode === 'oauth') {
        // Only the tab that started Google sign-in accepts the returned session.
        await page.evaluate(() => sessionStorage.setItem('belna.oauthFlow', 'onboarding-flow-0123456789'));
        await page.goto(base + '/app?oauth=1#access_token=test-access&refresh_token=test-refresh&flow=onboarding-flow-0123456789');
      } else {
        // A homepage prompt opens on Sign up; otherwise Log in.
        assert.equal(await page.innerText('.authtabs .on'), mode === 'signup' ? 'Sign up' : 'Log in');
        await page.fill('#aemail', session.user.email);
        await page.fill('#apass', 'test-password');
        await page.check('#authlegal');
        assert.equal(await page.innerText('#pwgo'), mode === 'signup' ? 'Create account' : 'Log in');
        await page.click('#pwgo');
      }
      if (mode === 'signin') {
        await page.waitForSelector('.onboarding-speech.is-speaking .onboarding-dots');
        assert.equal(await page.locator('.onboarding-dots i').count(), 3, 'agent shows three typing dots before its welcome');
        assert.equal(await page.locator('[data-onboarding-output]').first().textContent(), '', 'typing starts before the text arrives');
        const welcome = (await readState(page)).chats.find(c => c.onboarding).messages.find(m => m.onboardingSpeech);
        assert.equal(welcome.onboardingSpeaker, '', 'the au pair starts without a name');
        assert.match(welcome.text, /personal au pair, always at your service/);
        assert.ok((await page.locator('[data-onboarding-output]').first().innerText()).length < welcome.text.length, 'welcome is not shown instantly');
        assert.equal(await page.locator('[data-onboarding-name]').count(), 0, 'choices wait for the welcome');
        await page.waitForSelector('[data-onboarding-output]');
        await page.waitForTimeout(300);
        const typed = await page.locator('[data-onboarding-output]').first().innerText();
        assert.ok(typed.length > 0 && typed.length < welcome.text.length, 'text is progressively revealed');
      }
      await page.waitForSelector('[data-onboarding-step="name"]');
      assert.equal(await page.locator('.onboarding-journey').count(), 0, 'no numbered onboarding strip');
      assert.deepEqual(await page.locator('button.qopt').allTextContents().then(items => items.map(s=>s.trim())), ['Alex','Rosa','Tao']);
      assert.match(await page.locator('#thread').innerText(), /Hi there! I’m your personal au pair/);
      assert.equal(runs.length, 0);
      const chatId = (await readState(page)).activeChat;
      if (!mobile) {
        await page.click('[data-act="newchat"]');
        await page.click('[data-act="usermenu"]');
        await page.click('[data-act="nav"][data-view="settings"]');
        await page.keyboard.press('Escape');
      }
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
      if (mode === 'signin') {
        await page.waitForSelector('.onboarding-speech.is-speaking .onboarding-dots');
        assert.equal(await page.locator('.onboarding-speech.is-speaking [data-onboarding-output]').textContent(), '', 'the next personal reply also starts with typing dots');
        assert.equal(await page.locator('[data-onboarding-step="userName"]').count(), 0, 'next question waits for the reply');
      }
      await page.waitForSelector('[data-onboarding-step="userName"]');
      assert.match(await page.locator('#thread').innerText(), /nice, I like it! Now, what should I call you/);
      await page.fill('[data-onboarding-step="userName"] input', '  Vince  ');
      await page.reload();
      await page.waitForSelector('[data-onboarding-step="userName"]');
      assert.equal(await page.inputValue('[data-onboarding-step="userName"] input'), '  Vince  ', 'preferred name draft survives refresh');
      assert.equal(await page.locator('.onboarding-speech.is-speaking').count(), 0, 'completed replies do not replay');
      await page.press('[data-onboarding-step="userName"] input', 'Enter');
      await page.waitForSelector('button.qopt .mascot');
      assert.equal(await page.locator('button.qopt .mascot').count(), 5);
      assert.equal((await readState(page)).activeChat, chatId, 'answer must not create a new chat');
      await page.reload();
      await page.waitForSelector('[data-o="Orchid"]');
      assert.equal((await readState(page)).onboarded, false);
      assert.equal(runs.length, 0, 'request waits throughout personalization');
      await page.click('[data-o="Orchid"]');
      await page.waitForSelector('.onboarding-theme-choices');
      // Saves land just after the next frame, so the stored state is read once it has caught up.
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1'))?.agent?.color === 'rose', null, { timeout:3000 }).catch(() => {});
      assert.equal((await readState(page)).agent.color, 'rose', 'agent color updates before setup ends');
      assert.equal((await readState(page)).userProfile.name, 'Vince');
      assert.equal(await page.locator('.onboarding-theme-choices button').count(), 6);
      await page.click('.onboarding-theme-choices [data-o="Sky"]');
      await page.waitForSelector('[data-act="onboarding-connectors"]');
      assert.match(await page.locator('#thread').innerText(), /speed of light[\s\S]*your universe[\s\S]*care about most/);
      assert.equal((await readState(page)).onboarded, mobile, 'normal animation waits for the final reply; reduced motion finishes without extra clicks');
      assert.equal((await readState(page)).theme, 'blue');
      assert.equal(await page.locator('body').getAttribute('data-accent'), 'blue');
      assert.equal(runs.length, 0);
      // Connectors are a real optional detour, with a saved return to setup.
      await page.click('[data-act="onboarding-connectors"]');
      await page.waitForSelector('.apps-toolbar h1');
      assert.equal(await page.locator('.apps-toolbar h1').innerText(), 'Connectors');
      await page.click('[data-act="toggle-connector"][data-toolkit="gmail"]');
      await page.waitForSelector('.conn-row.is-open');
      await page.reload();
      await page.waitForSelector('.onboarding-return');
      assert.equal((await readState(page)).onboarded, mobile);
      assert.equal(runs.length, 0, 'opening connectors never starts the pending request');
      await page.click('[data-act="onboarding-return"]');
      await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).onboarded);
      assert.match(await page.locator('#thread').innerText(), /connect your apps at any time[\s\S]*Vince[\s\S]*What do you want to work on\?/);
      assert.equal(await page.locator('[data-act="onboarding-start"], .onboarding-ready, .onboarding-journey').count(), 0, 'setup ends in conversation without a numbered strip or final card');
      assert.doesNotMatch(await page.locator('#thread').innerText(), /Let’s get started|Level 1 unlocked/);
      if (mobile) assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'mobile setup has no horizontal overflow');
      assert.equal(await page.locator('button.qopt').count(), 0, 'no expression/personality step');
      assert.equal(await page.locator('[data-act="open-passport"]').count(), 0, 'no start chatting card');
      assert.doesNotMatch(await page.locator('#thread').innerText(), /Start chatting|\bHej\b/);
      const final = await readState(page);
      assert.equal(final.onboarded, true);
      assert.equal(final.agent.name, mode === 'oauth' || mobile ? 'Rosa' : 'Sora');
      assert.equal(final.agent.color, 'rose');
      assert.equal(final.agent.pers, undefined, 'setup does not assign a personality preset');
      assert.equal(final.canvasTab, 'canvas');
      assert.equal(final.userProfile.name, 'Vince');
      assert.equal(final.theme, 'blue');
      if (mode === 'signin' || mobile) assert.equal(runs.length, 0, 'setup without a saved request stays ready for chat');
      else {
        await page.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).chats.some(c=>c.managedStatus === 'completed'));
        assert.equal(runs.length, 1, 'saved request starts when the final animated question finishes');
        assert.equal(runs[0].prompt, 'Research electric bikes');
        assert.match(await page.locator('#thread').innerText(), /getting started on your request now/);
      }
      if (mobile) {
        await page.reload();
        await page.waitForSelector('#app:not(.is-onboarding)');
        assert.equal((await readState(page)).userProfile.name, 'Vince');
        assert.deepEqual(errors, []);
        console.log('mobile: reduced-motion setup, connector detour, theme, completion and refresh passed');
        await context.close();
        continue;
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
      assert.equal(await page.locator('[data-act="p-pers"]').count(), 0, 'settings has no personality presets');
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
    // An interrupted two-question setup keeps its agent, then asks for the new
    // personal details instead of silently finishing or repeating old choices.
    const legacyContext = await browser.newContext({ reducedMotion:'reduce' });
    await legacyContext.addInitScript(sess => {
      localStorage.setItem('lingon.session', JSON.stringify(sess));
      localStorage.setItem('lingon.v1', JSON.stringify({ownerId:sess.user.id,onboarded:false,
        agent:{name:'Mira',color:'rose',provisional:true},view:'chat',activeChat:'legacy-setup',chats:[{
          id:'legacy-setup',title:'Meet your agent',onboarding:true,onboardingWelcomed:true,onboardingAnswers:{name:'Mira',color:'rose'},trace:[],messages:[{
            id:'old-question',kind:'card',card:{type:'question',step:'color',q:'Pick a color',options:['Orchid'],onboarding:true,status:'pending'},
          }],
        }]}));
    }, session);
    await legacyContext.route('**/api/**', route => route.fulfill({json:new URL(route.request().url()).pathname === '/api/auth/me' ? {user:session.user} : {}}));
    const legacyPage = await legacyContext.newPage();
    await legacyPage.goto(base + '/app');
    await legacyPage.waitForSelector('[data-onboarding-step="userName"]');
    assert.equal(await legacyPage.locator('[data-mid="old-question"]').count(), 0);
    assert.equal((await readState(legacyPage)).agent.name, 'Mira');
    assert.equal((await readState(legacyPage)).agent.color, 'rose');
    await legacyPage.fill('[name="agentName"]', 'Alice');
    await legacyPage.press('[name="agentName"]', 'Enter');
    await legacyPage.waitForSelector('.onboarding-theme-choices');
    assert.equal(await legacyPage.locator('.onboarding-mascot-choices').count(), 0, 'a saved color is kept');
    await legacyPage.click('[data-o="Apricot"]');
    await legacyPage.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).onboarded);
    assert.match(await legacyPage.locator('#thread').innerText(), /What do you want to work on\?/);
    assert.equal((await readState(legacyPage)).userProfile.name, 'Alice');
    assert.equal((await readState(legacyPage)).theme, 'yellow');
    await legacyContext.close();
    console.log('legacy: interrupted setup migrates without losing names or colors');
    const previousContext = await browser.newContext({ reducedMotion:'no-preference' });
    await previousContext.addInitScript(sess => {
      localStorage.setItem('lingon.session', JSON.stringify(sess));
      localStorage.setItem('lingon.v1', JSON.stringify({ownerId:sess.user.id,onboarded:false,
        agent:{name:'Nova',color:'rose',provisional:true},userProfile:{name:'Alice'},theme:'blue',view:'chat',activeChat:'previous-setup',chats:[{
          id:'previous-setup',title:'Meet your agent',onboarding:true,trace:[],onboardingAnswers:{version:2,name:'Nova',userName:'Alice',color:'rose',theme:'blue'},messages:[
            {id:'universe',role:'agent',kind:'text',text:'Your universe.',onboardingSpeech:true,onboardingDone:true},
            {id:'old-final',role:'agent',kind:'text',text:'Let’s get started doing something exciting!',onboardingSpeech:true,onboardingSpeaker:'Nova',onboardingAfter:'universe',onboardingDone:true},
            {id:'old-ready',kind:'card',card:{type:'onboarding-ready',onboarding:true,onboardingAfter:'old-final',status:'pending'}},
          ],
        }]}));
    }, session);
    await previousContext.route('**/api/**', route => route.fulfill({json:new URL(route.request().url()).pathname === '/api/auth/me' ? {user:session.user} : {}}));
    const previousPage = await previousContext.newPage();
    await previousPage.goto(base + '/app');
    await previousPage.waitForSelector('.onboarding-dots');
    assert.equal(await previousPage.locator('[data-mid="old-ready"]').count(), 0, 'old completion card is removed when resuming');
    assert.equal((await readState(previousPage)).onboarded, false, 'updated final question plays before setup completes');
    await previousPage.waitForFunction(() => JSON.parse(localStorage.getItem('lingon.v1')).onboarded);
    assert.match(await previousPage.locator('#thread').innerText(), /Alice[\s\S]*What do you want to work on\?/);
    assert.doesNotMatch(await previousPage.locator('#thread').innerText(), /Let’s get started/);
    assert.equal((await readState(previousPage)).agent.name, 'Nova');
    await previousContext.close();
    console.log('previous preview: final card migrates into an animated question and automatic handoff');
  } finally { await browser.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
