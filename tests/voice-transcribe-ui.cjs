const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { startAppServer } = require('./helpers/app-server.cjs');
const { prepareAudio, transcribeAudio } = require('../server/foundry');

(async () => {
  const server = await startAppServer();
  const args = ['--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream'];
  if (process.env.VOICE_TEST_AUDIO) args.push('--use-file-for-fake-audio-capture=' + process.env.VOICE_TEST_AUDIO);
  const browser = await chromium.launch({ args });
  try {
    for (const width of [1280, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 }, permissions: ['microphone'] });
      await context.addInitScript(() => {
        localStorage.setItem('lingon.session', JSON.stringify({ access_token: 'voice-test', user: { id: 'owner', email: 'qa@example.invalid' } }));
        localStorage.setItem('lingon.v1', JSON.stringify({ ownerId: 'owner', onboarded: true,
          agent: { name: 'QA', color: 'lingon', pers: 'Precise' }, view: 'chat', activeChat: 'chat',
          chats: [{ id: 'chat', title: 'Voice test', messages: [], trace: [] }],
          vault: { secrets: [], apps: [], approvals: [], mode: 'default' } }));
      });
      const source = fs.readFileSync(require.resolve('../app/app.js'), 'utf8');
      const end = source.lastIndexOf('})();');
      const instrumented = source.slice(0, end) + 'window.__voiceTest = {startVoice,finishVoice,stopVoice,toggleVoice,voiceIn,state,paintMain};\n' + source.slice(end);
      await context.route(/\/(?:lingon\/)?app\.js(?:\?.*)?$/, route => route.fulfill({ contentType: 'text/javascript', body: instrumented }));
      let requests = 0, mode = 'success', release, transcript = 'Please buy apples tomorrow.';
      await context.route('**/api/**', async route => {
        const path = new URL(route.request().url()).pathname;
        let data = {};
        if (path === '/api/voice/transcribe') {
          requests++;
          assert.equal(route.request().headers().authorization, 'Bearer voice-test');
          const body = route.request().postDataJSON(), audio = prepareAudio(body);
          assert.equal(Buffer.from(audio.data, 'base64').readUInt32BE(0), 0x1a45dfa3, 'the browser recording reaches the provider as valid WebM');
          if (mode === 'delayed') await new Promise(resolve => { release = resolve; });
          if (mode === 'failure') return route.fulfill({ status: 502, json: { error: 'Couldn’t transcribe that.' } });
          if (process.env.VOICE_TEST_LIVE === '1' && mode === 'success') {
            const out = await transcribeAudio(body); transcript = out.text;
            assert.match(transcript, /buy apples tomorrow/i, 'real recorded speech is recognized');
          }
          data = { text: transcript };
        } else if (path === '/api/client-state') data = { profile: null, chats: [], durable: true };
        else if (path === '/api/auth/me') data = { user: { id: 'owner', email: 'qa@example.invalid' } };
        await route.fulfill({ json: data });
      });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      await page.goto(server.base + '/app');
      await page.locator('#cprompt').fill('Existing draft.');
      // Real getUserMedia + MediaRecorder + FileReader, using Chromium's fake microphone.
      await page.locator('#cvoice').click();
      await page.waitForFunction(() => window.__voiceTest.voiceIn.on);
      await page.waitForTimeout(process.env.VOICE_TEST_LIVE === '1' ? 7000 : 500);
      await page.locator('#cvoice').click();
      await page.waitForFunction(() => !window.__voiceTest.voiceIn.busy);
      assert.equal(requests, 1);
      assert.equal(await page.locator('#cprompt').inputValue(), 'Existing draft. ' + transcript);
      assert.equal(await page.locator('#cvoice').isEnabled(), true);
      assert.equal(await page.evaluate(() => window.__voiceTest.voiceIn.stream), null);

      // Stop remains busy until the final chunk arrives. A second click cannot
      // start another recorder or send the same audio twice.
      mode = 'fixture';
      const beforeStop = requests;
      assert.deepEqual(await page.evaluate(async () => {
        const test = window.__voiceTest;
        let stops = 0, tracksStopped = 0;
        const rec = { mimeType: 'audio/webm;codecs=opus', state: 'recording', stop() {
          stops++; this.state = 'inactive';
          setTimeout(() => {
            const bytes = new Uint8Array(300); bytes.set([0x1a, 0x45, 0xdf, 0xa3]);
            this.ondataavailable?.({ data: new Blob([bytes], { type: this.mimeType }) });
            this.onstop?.();
          }, 20);
        } };
        rec.ondataavailable = e => test.voiceIn.chunks.push(e.data);
        Object.assign(test.voiceIn, { rec, on: true, chunks: [], stream: { getTracks: () => [{ stop: () => tracksStopped++ }] } });
        const finish = test.finishVoice(); test.toggleVoice(); await test.finishVoice(); await finish;
        return { stops, tracksStopped, busy: test.voiceIn.busy };
      }), { stops: 1, tracksStopped: 1, busy: false });
      assert.equal(requests, beforeStop + 1);

      // An empty recording, a recorder error and a missing stop event all
      // release the microphone without uploading partial audio.
      const beforeFailures = requests;
      for (const failure of ['empty', 'error', 'timeout']) {
        assert.deepEqual(await page.evaluate(async failure => {
          const test = window.__voiceTest, schedule = window.setTimeout;
          let tracksStopped = 0;
          window.setTimeout = (fn, ms, ...args) => schedule(fn, ms === 5000 ? 25 : ms, ...args);
          const rec = { mimeType: 'audio/webm', state: 'recording', stop() {
            this.state = 'inactive';
            if (failure === 'error') queueMicrotask(() => this.onerror?.());
            if (failure === 'empty') queueMicrotask(() => this.onstop?.());
          } };
          Object.assign(test.voiceIn, { rec, on: true, chunks: [], stream: { getTracks: () => [{ stop: () => tracksStopped++ }] } });
          await test.finishVoice(); window.setTimeout = schedule;
          return { tracksStopped, busy: test.voiceIn.busy, on: test.voiceIn.on };
        }, failure), { tracksStopped: 1, busy: false, on: false });
      }
      assert.equal(requests, beforeFailures);

      // Two start clicks share one permission request. Leaving chat before it
      // resolves must stop the newly granted stream without recording anything.
      assert.deepEqual(await page.evaluate(async () => {
        const test = window.__voiceTest, original = navigator.mediaDevices.getUserMedia;
        let calls = 0, stopped = 0, grant;
        navigator.mediaDevices.getUserMedia = () => { calls++; return new Promise(resolve => { grant = resolve; }); };
        const pending = test.startVoice(); test.toggleVoice(); test.stopVoice();
        grant({ getTracks: () => [{ stop: () => stopped++ }] }); await pending;
        navigator.mediaDevices.getUserMedia = original;
        return { calls, stopped, on: test.voiceIn.on, starting: test.voiceIn.starting };
      }), { calls: 1, stopped: 1, on: false, starting: false });

      // Permission denial leaves the button ready for retry.
      await page.evaluate(async () => {
        const original = navigator.mediaDevices.getUserMedia;
        navigator.mediaDevices.getUserMedia = async () => { throw new DOMException('Denied', 'NotAllowedError'); };
        await window.__voiceTest.startVoice(); navigator.mediaDevices.getUserMedia = original;
      });
      assert.equal(await page.locator('#cvoice').isEnabled(), true);

      // Failure releases the microphone and lets another recording start.
      mode = 'failure';
      await page.locator('#cvoice').click();
      await page.waitForFunction(() => window.__voiceTest.voiceIn.on);
      await page.waitForTimeout(350);
      await page.locator('#cvoice').click();
      await page.waitForFunction(() => !window.__voiceTest.voiceIn.busy);
      assert.equal(await page.locator('#cvoice').isEnabled(), true);
      assert.equal(await page.evaluate(() => window.__voiceTest.voiceIn.stream), null);

      // A delayed response must not overwrite a draft in a new chat.
      mode = 'delayed';
      await page.locator('#cvoice').click();
      await page.waitForFunction(() => window.__voiceTest.voiceIn.on);
      await page.waitForTimeout(350);
      await page.locator('#cvoice').click();
      await page.waitForFunction(() => window.__voiceTest.voiceIn.abort !== null);
      await page.evaluate(() => {
        const t = window.__voiceTest;
        t.state.chats.unshift({ id: 'other', title: 'Other chat', messages: [], trace: [] });
        t.state.activeChat = 'other'; t.paintMain();
      });
      await page.locator('#cprompt').fill('Other chat draft.');
      release();
      await page.waitForTimeout(100);
      assert.equal(await page.locator('#cprompt').inputValue(), 'Other chat draft.');
      assert.deepEqual(errors, []);
      await context.close();
      console.log(`Voice ${width}px: recording, ${process.env.VOICE_TEST_LIVE === '1' ? 'real Azure transcription' : 'upload'}, draft append, permission races, failure retry and chat cancellation passed`);
    }
  } finally { await browser.close(); await server.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
