const assert = require('node:assert/strict');
const { chromium } = require('playwright');

// On phones Settings opens sections from its list; go back to the list first when a section is open.
const openSettingsTab=async(page,t)=>{await page.locator('#main .set-page, #main .settings-tabs').first().waitFor();const back=page.locator('.set-sub-head [data-act="stab"][data-t="home"]');if(await back.count())await back.click();await page.locator(`:is(.set-row,.settings-tabs button)[data-act="stab"][data-t="${t}"]`).click();};
(async () => {
  const browser = await chromium.launch();
  try {
    const context = await browser.newContext({ viewport:{ width:390, height:844 } });
    await context.addInitScript(() => {
      localStorage.setItem('lingon.session', JSON.stringify({ access_token:'ui-audit', user:{ id:'ui-audit', email:'ui-audit@example.com' } }));
      localStorage.setItem('lingon.v1', JSON.stringify({ ownerId:'ui-audit', onboarded:true, agent:{ name:'Audit', color:'lingon', pers:'Precise' }, view:'settings', settingsTab:'issue', chats:[], vault:{ secrets:[], apps:[], approvals:[], mode:'default' } }));
    });
    const submitted = [];
    await context.route('**/api/**', async route => {
      if (new URL(route.request().url()).pathname === '/api/support/submissions') {
        submitted.push(JSON.parse(route.request().postData()));
      }
      await route.fulfill({ status:200, contentType:'application/json', body:'{}' });
    });
    const page = await context.newPage();
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.goto('http://127.0.0.1:8080/app');
    await page.locator('#issue-description').fill('The chat stopped.');
    await page.locator('#issue-topic').selectOption({ label:'Chat or agent' });
    await page.locator('#issue-images').setInputFiles({ name:'screenshot.png', mimeType:'image/png', buffer:Buffer.from('screenshot') });
    await page.locator('[data-support-kind="issue"] button[type="submit"]').click();
    await page.getByText('Report submitted. Thank you.').waitFor();
    assert.equal(submitted[0].kind, 'issue');
    assert.equal(submitted[0].topic, 'Chat or agent');
    assert.equal(Buffer.from(submitted[0].images[0].data, 'base64').toString(), 'screenshot');
    await openSettingsTab(page,'support');
    assert.equal(await page.locator('a[href="mailto:support@belna.se"]').count(), 1);
    await page.locator('#feedback-name').fill('Taylor');
    await page.locator('#feedback-email').fill('taylor@example.com');
    await page.locator('#feedback-topic').fill('Suggestion');
    await page.locator('#feedback-description').fill('Please add a feature.');
    await page.locator('[data-support-kind="feedback"] button[type="submit"]').click();
    await page.getByText('Feedback submitted. Thank you.').waitFor();
    assert.equal(submitted[1].name, 'Taylor');
    assert.equal(submitted[1].email, 'taylor@example.com');
    assert.equal(submitted[1].description, 'Please add a feature.');
    assert.deepEqual(errors, []);
    await context.close();
    console.log('support UI: passed');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
