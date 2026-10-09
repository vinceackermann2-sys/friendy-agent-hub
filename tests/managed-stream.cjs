const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { webcrypto } = require('node:crypto');

const events = [];
const requests = [];
let holdNext = true;
let holdAfterAnswer = false;
let scripted = null;
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
      if (scripted) {
        const frames = scripted; scripted = null;
        return { ok:true, body:{ getReader: () => ({
          read: async () => frames.length ? { value:Buffer.from(`data: ${JSON.stringify(frames.shift())}\n\n`), done:false } : { done:true },
          releaseLock: () => {},
        }) } };
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

  // A started task brings its own working dots, so the reply's typing dots go at once,
  // not when the confirmation arrives: two sets of dots never show together.
  const order = [];
  const plain = { typing: rt.typing, managedEvent: rt.managedEvent };
  rt.typing = () => { order.push('dots'); return { abort:() => order.push('dots gone') }; };
  rt.managedTask = () => order.push('task');
  rt.managedEvent = (event) => { if (event.type === 'message') order.push('message'); };
  scripted = [{ type:'task', task:{ id:'t1', status:'queued', events:[] } }, { type:'message', id:'a1', phase:'final_answer', text:'Lisbon it is.' }, { type:'done', status:'completed' }];
  await window.Engine.run(rt, 'hotels');
  assert.deepEqual(order, ['dots', 'dots gone', 'task', 'message']);
  // A card being drawn replaces the dots. Finished with its reply already streaming, no dots
  // come back; finished before its reply (written by a second call), the dots wait below it.
  const card = { type:'present', kind:'list', title:'Lisbon' };
  for (const [frames, expected] of [
    [[{ type:'card_delta', id:'c1', card }, { type:'message_delta', id:'r1', delta:'Start in Alfama.' }, { type:'card', id:'c1', card }, { type:'message', id:'r1', phase:'final_answer', text:'Start in Alfama.' }, { type:'done', status:'completed' }],
      ['dots', 'dots gone', 'card_delta', 'message_delta', 'card', 'message']],
    [[{ type:'card_delta', id:'c2', card }, { type:'card', id:'c2', card }, { type:'message_delta', id:'a2', delta:'Alfama first.' }, { type:'message', id:'a2', phase:'final_answer', text:'Alfama first.' }, { type:'done', status:'completed' }],
      ['dots', 'dots gone', 'card_delta', 'card', 'dots', 'dots gone', 'message_delta', 'message']],
  ]) {
    order.length = 0;
    rt.managedEvent = (event) => { if (event.type !== 'done' && event.type !== 'session') order.push(event.type); };
    scripted = frames;
    await window.Engine.run(rt, 'lisbon');
    assert.deepEqual(order, expected);
  }
  Object.assign(rt, plain);
  console.log('managed stream cancellation: ok');
})().catch((error) => { console.error(error); process.exitCode = 1; });
