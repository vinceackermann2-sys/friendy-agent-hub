const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const events = [];
const requests = [];
let holdNext = true;
let holdAfterAnswer = false;
const window = {
  Engine: {},
  LingonAuth: {
    api: async (path) => { requests.push({ path }); return { cancelled:true }; },
    apiStream: async (path, options) => {
      requests.push({ path, body:JSON.parse(options.body) });
      if (holdNext) {
        holdNext = false;
        return new Promise((resolve, reject) => {
          options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name:'AbortError' })), { once:true });
        });
      }
      if (holdAfterAnswer) {
        holdAfterAnswer = false;
        let read = false;
        return { ok:true, body:{ getReader: () => ({
          read: () => read
            ? new Promise((_, reject) => options.signal.addEventListener('abort', () => reject(Object.assign(new Error('aborted'), { name:'AbortError' })), { once:true }))
            : Promise.resolve((read = true, { value:Buffer.from('data: {"type":"message","id":"m_final","phase":"final_answer","text":"Ready"}\n\n'), done:false })),
          releaseLock: () => {},
        }) } };
      }
      let read = false;
      return { ok:true, body:{ getReader: () => ({
        read: async () => read ? { done:true } : (read = true, { value:Buffer.from('data: {"type":"done","status":"completed"}\n\n'), done:false }),
        releaseLock: () => {},
      }) } };
    },
  },
};
vm.runInNewContext(fs.readFileSync(require.resolve('../app/engine.managed.js'), 'utf8'), {
  window, AbortController, TextDecoder, Uint8Array, Buffer, crypto:webcrypto, setTimeout,
});

const rt = {
  chat:{ id:'chat-1', messages:[{ role:'user', kind:'text', text:'first' }] },
  agent:{ name:'Agent', pers:'Calm' },
  managedEvent: (event) => events.push(event),
  typing: () => ({ abort:() => {} }),
  trace: () => {},
};

(async () => {
  rt.chat.messages.push({ kind:'card', card:{ type:'progress', stage:'model', label:'Working on it', status:'done' } });
  const first = window.Engine.run(rt, 'first');
  assert.equal(window.Engine.isRunning(rt.chat.id), true);
  rt.chat.messages.push({ role:'user', kind:'text', text:'second' });
  const second = window.Engine.run(rt, 'second');
  await Promise.all([first, second]);
  assert.equal(window.Engine.isRunning(rt.chat.id), false);
  assert.equal(requests.filter((request) => request.path === '/api/agent/conversation/cancel').length, 1);
  assert.equal(requests.filter((request) => request.path === '/api/agent/conversation').length, 2);
  assert.deepEqual(requests.find((request) => request.path === '/api/agent/conversation').body.context.cards, [], 'status cards should not use model context');
  assert.equal(requests.some((request) => request.path === '/api/agent/steer'), false);
  assert.equal(requests.filter((request) => request.path === '/api/agent/conversation')[1].body.prompt, 'second');
  assert.equal(events.some((event) => event.type === 'error'), false);

  holdNext = true;
  const third = window.Engine.run(rt, 'third');
  assert.equal(window.Engine.isRunning(rt.chat.id), true);
  await window.Engine.stop(rt);
  await third;
  assert.equal(window.Engine.isRunning(rt.chat.id), false);
  assert.equal(events.filter((event) => event.type === 'stopped').length, 2);

  holdNext = true;
  const before = requests.filter((request) => request.path === '/api/agent/conversation').length;
  const fourth = window.Engine.run(rt, 'fourth');
  const fifth = window.Engine.run(rt, 'fifth');
  const sixth = window.Engine.run(rt, 'sixth');
  await Promise.all([fourth, fifth, sixth]);
  const latest = requests.filter((request) => request.path === '/api/agent/conversation').slice(before);
  assert.deepEqual(latest.map((request) => request.body.prompt), ['fourth', 'sixth']);

  holdAfterAnswer = true;
  const answered = window.Engine.run(rt, 'answered');
  for (let i = 0; i < 20 && !events.some((event) => event.type === 'message' && event.text === 'Ready'); i++) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(events.some((event) => event.type === 'message' && event.text === 'Ready'));
  assert.equal(window.Engine.isRunning(rt.chat.id), false, 'the composer is free as soon as the answer arrives');
  const followup = window.Engine.run(rt, 'followup');
  await Promise.all([answered, followup]);
  console.log('managed stream cancellation: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
