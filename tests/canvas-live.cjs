const assert = require('node:assert/strict');
const live = require('../server/agents/live');
const { TOOLS } = require('../server/agents/tools');
const { emitResultCard } = require('../server/agents/vm-harness');

const original = { forTool:live.forTool, navigate:live.navigate, agentInput:live.agentInput };
const session = { id:'live-test', url:'about:blank', title:'', screenshot:'' };
const calls = [];
live.forTool = async (_userId, _sessionId, _trace, create) => {
  calls.push(create === false ? 'reuse' : 'open');
  return session;
};
live.navigate = async (_session, url) => Object.assign(session, { url, title:'Example', screenshot:'data:image/jpeg;base64,AA==' });
live.agentInput = async (_session, event) => { calls.push(event.type); return Object.assign(session, { title:'Next page' }); };

(async () => {
  const ctx = { userId:'user', sessionId:'chat', trace:() => {} };
  const opened = await TOOLS.browser_open.run({ url:'https://en.wikipedia.org/' }, ctx);
  assert.equal(opened.liveId, 'live-test');
  const next = await TOOLS.browser_action.run({ type:'scroll', dy:200 }, ctx);
  assert.equal(next.liveId, opened.liveId);
  assert.deepEqual(calls, ['open','reuse','scroll']);
  const cards = [];
  emitResultCard(event => cards.push(event), 'browser_open', 'call', opened);
  assert.equal(cards[0].card.liveId, 'live-test', 'browser card carries the exact session to open');
  const shown = await TOOLS.canvas_show.run({ title:'Notes', format:'md', content:'Hello' }, ctx);
  emitResultCard(event => cards.push(event), 'canvas_show', 'canvas-call', shown);
  assert.equal(cards[1].card.type, 'canvas');
  assert.equal(cards[1].card.content, 'Hello');
  console.log('canvas live session cards: ok');
})().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => Object.assign(live, original));
