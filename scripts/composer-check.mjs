import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

let staticServer;
let base = process.env.UI_BASE;
if (!base){
  const staticRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../app');
  const mime = { '.html':'text/html; charset=utf-8', '.css':'text/css', '.js':'text/javascript', '.svg':'image/svg+xml', '.webp':'image/webp' };
  staticServer = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url, 'http://localhost').pathname);
    const filename = resolve(staticRoot, '.' + (pathname === '/' || pathname === '/app' ? '/index.html' : pathname));
    if (!filename.startsWith(staticRoot + sep)){ response.writeHead(403).end(); return; }
    try {
      const body = await readFile(filename);
      response.writeHead(200, { 'Content-Type':mime[extname(filename)] || 'application/octet-stream' }).end(body);
    } catch { response.writeHead(404).end(); }
  });
  await new Promise(done => staticServer.listen(0, '127.0.0.1', done));
  base = `http://127.0.0.1:${staticServer.address().port}`;
}
const browser = await chromium.launch();

async function check(page, formId, textareaId, width){
  const form = page.locator(formId);
  const textarea = page.locator(textareaId);
  await form.waitFor();

  let size = await form.evaluate(el => ({ height:el.getBoundingClientRect().height, width:el.getBoundingClientRect().width }));
  assert.ok(size.width > size.height * 2, `${formId} should start as a wide composer: ${JSON.stringify(size)}`);

  await textarea.fill('A'.repeat(1200) + '\n' + 'more detail\n'.repeat(30));
  const overflow = await textarea.evaluate(el => ({ height:el.getBoundingClientRect().height, scroll:el.scrollHeight, client:el.clientHeight }));
  assert.ok(overflow.height <= 181, `${textareaId} exceeds the height cap: ${JSON.stringify(overflow)}`);
  assert.ok(overflow.scroll > overflow.client, `${textareaId} should scroll long text: ${JSON.stringify(overflow)}`);

  await form.locator('input[type="file"]').setInputFiles({ name:'a-long-attachment-name-that-needs-to-clip.txt', mimeType:'text/plain', buffer:Buffer.from('attachment') });
  await form.locator('.attach-pill:not(.loading)').waitFor();
  assert.equal(await form.locator('.attach-pill').count(), 1);
  const card = await form.locator('.attach-card').first().evaluate(el => ({ width:el.getBoundingClientRect().width, height:el.getBoundingClientRect().height }));
  assert.ok(Math.abs(card.width - card.height) <= 1, `attachment card should be square: ${JSON.stringify(card)}`);
  const removePosition = await form.locator('.attach-card').first().evaluate(el => {
    const card = el.getBoundingClientRect(), button = el.querySelector('.ap-x').getBoundingClientRect();
    return { top:button.top - card.top, right:card.right - button.right };
  });
  assert.ok(removePosition.top < 12 && removePosition.right < 12, `remove button should sit at the top right: ${JSON.stringify(removePosition)}`);
  await form.evaluate(el => {
    const transfer = new DataTransfer();
    transfer.items.add(new File(['dropped'], 'dropped.txt', { type:'text/plain' }));
    el.dispatchEvent(new DragEvent('dragenter', { bubbles:true, cancelable:true, dataTransfer:transfer }));
    el.dispatchEvent(new DragEvent('dragover', { bubbles:true, cancelable:true, dataTransfer:transfer }));
    el.dispatchEvent(new DragEvent('drop', { bubbles:true, cancelable:true, dataTransfer:transfer }));
  });
  await form.locator('.attach-pill:not(.loading)').nth(1).waitFor();
  assert.equal(await form.locator('.attach-pill').count(), 2);
  await form.locator('input[type="file"]').setInputFiles({ name:'preview.svg', mimeType:'image/svg+xml', buffer:Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><rect width="100" height="100" fill="#71c7b5"/><circle cx="50" cy="50" r="28" fill="#f8c955"/></svg>') });
  await form.locator('.attach-card.has-preview img').waitFor();
  assert.ok(await form.locator('.attach-card.has-preview img').evaluate(el => el.complete && el.naturalWidth > 0), 'image thumbnail should load');
  await form.locator('input[type="file"]').setInputFiles({ name:'budget.xlsx', mimeType:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer:Buffer.from('spreadsheet') });
  await form.locator('.attach-card .file-format-icon[aria-label="excel file"]').waitFor();
  if (width === 1440 && formId === '#cform'){
    await form.locator('input[type="file"]').setInputFiles({ name:'clip.mp4', mimeType:'video/mp4', buffer:Buffer.alloc(4 * 1024 * 1024 + 1) });
    await form.locator('.attach-card:not(.loading) .file-format-icon[aria-label="video file"]').waitFor();
    assert.equal(await form.locator('.attach-card.has-preview').count(), 1, 'large video should use its format icon');
    await form.locator('.attach-card .ap-x').nth(4).click();
  }
  if (process.env.COMPOSER_SHOTS && width === 1440) await form.screenshot({ path:process.env.COMPOSER_SHOTS + '/' + formId.slice(1) + '-attachments.png' });
  await form.locator('.attach-card .ap-x').nth(3).click();
  await form.locator('.attach-card .ap-x').nth(2).click();
  assert.equal(await form.locator('.attach-card').count(), 2);
  if (formId === '#lform') assert.equal(await page.locator('#lform2 .attach-pill').count(), 0, 'files should stay in the composer where they were added');
  size = await form.evaluate(el => ({ left:el.getBoundingClientRect().left, right:el.getBoundingClientRect().right, width:el.getBoundingClientRect().width }));
  assert.ok(size.left >= -1 && size.right <= width + 1, `${formId} escapes viewport: ${JSON.stringify(size)}`);
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${formId} causes horizontal page overflow`);
  await form.locator('.ap-x').first().click();
  assert.equal(await form.locator('.attach-pill').count(), 1, 'removing a file should not submit the form');
}

try {
  for (const width of [320, 390, 1440]){
    const context = await browser.newContext({ viewport:{ width, height:800 } });
    const page = await context.newPage();
    page.on('pageerror', error => console.error('landing page error:', error.message));
    await page.goto(base);
    await page.locator('#lform').waitFor();
    if (process.env.COMPOSER_SHOTS && width === 1440) await page.screenshot({ path:process.env.COMPOSER_SHOTS + '/landing-composer.png' });
    await check(page, '#lform', '#lprompt', width);
    if (width === 390){
      await page.locator('#lform input[type="file"]').setInputFiles({ name:'large.txt', mimeType:'text/plain', buffer:Buffer.alloc(6 * 1024 * 1024, 65) });
      await page.locator('#lform .attach-pill:not(.loading)').nth(1).waitFor();
      await page.locator('#lprompt').fill('Review this file');
      await page.locator('#lform button[type="submit"]').click();
      await page.locator('#aemail').waitFor({ timeout:8000 }).catch(async error => {
        console.error('landing handoff state:', await page.evaluate(() => ({ pending:JSON.parse(localStorage.getItem('lingon.v1') || '{}').pendingPrompt, toast:document.querySelector('#toast')?.textContent, prompt:document.querySelector('#lprompt')?.value, files:document.querySelectorAll('#lform .attach-pill').length })));
        throw error;
      });
      const pending = await page.evaluate(() => JSON.parse(localStorage.getItem('lingon.v1')));
      assert.equal(pending.pendingPrompt, 'Review this file');
      assert.equal(pending.pendingPromptFiles?.[0]?.name, 'dropped.txt', 'landing attachment should reach the pending chat request');
      assert.equal(pending.pendingPromptFiles?.[1]?.name, 'large.txt');
      assert.equal(pending.pendingPromptFiles?.[1]?.dataUrl, undefined, 'large file contents should stay out of localStorage');
      const storedLength = await page.evaluate(storageId => new Promise((resolve, reject) => {
        const open = indexedDB.open('belna-composer-files', 1);
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
          const db = open.result;
          const request = db.transaction('files', 'readonly').objectStore('files').get(storageId);
          request.onsuccess = () => { db.close(); resolve(request.result?.length || 0); };
          request.onerror = () => { db.close(); reject(request.error); };
        };
      }), pending.pendingPromptFiles[1].storageId);
      assert.ok(storedLength > 6 * 1024 * 1024, 'large attachment should be preserved in browser file storage');
      await page.route('**/api/**', route => route.fulfill({ status:200, contentType:'application/json', body:'{}' }));
      await page.evaluate(() => {
        localStorage.setItem('lingon.session', JSON.stringify({ access_token:'ui-audit', user:{ id:'ui-audit', email:'ui-audit@example.invalid' } }));
        const saved = JSON.parse(localStorage.getItem('lingon.v1'));
        saved.ownerId = 'ui-audit';
        saved.onboarded = true;
        saved.agent = { name:'Audit', color:'lingon', pers:'Precise' };
        localStorage.setItem('lingon.v1', JSON.stringify(saved));
      });
      await page.reload();
      await page.locator('#cform').waitFor();
      await page.locator('.msg.user .msg-files .attach-pill').nth(1).waitFor();
      assert.equal(await page.locator('.msg.user .msg-files .attach-pill').count(), 2, 'attachments should survive sign-in and reload');
    }
    await context.close();

    const signedIn = await browser.newContext({ viewport:{ width, height:800 } });
    await signedIn.addInitScript(() => {
      localStorage.setItem('lingon.session', JSON.stringify({ access_token:'ui-audit', user:{ id:'ui-audit', email:'ui-audit@example.invalid' } }));
      localStorage.setItem('lingon.v1', JSON.stringify({ ownerId:'ui-audit', onboarded:true, agent:{ name:'Audit', color:'lingon', pers:'Precise' }, view:'chat', chats:[], vault:{ secrets:[], apps:[], approvals:[], mode:'default' } }));
    });
    await signedIn.route('**/api/**', route => route.fulfill({ status:200, contentType:'application/json', body:'{}' }));
    const chat = await signedIn.newPage();
    await chat.goto(base + (process.env.UI_CHAT_PATH || '/app'));
    await chat.locator('[data-act="newchat"]').last().click();
    if (process.env.COMPOSER_SHOTS && width === 1440) await chat.screenshot({ path:process.env.COMPOSER_SHOTS + '/chat-composer.png' });
    await check(chat, '#cform', '#cprompt', width);
    await signedIn.close();
  }
  console.log('Composer layout, text overflow, file picker, drag and drop, and removal passed at 320, 390, and 1440 px.');
} finally {
  await browser.close();
  if (staticServer) await new Promise(done => staticServer.close(done));
}
