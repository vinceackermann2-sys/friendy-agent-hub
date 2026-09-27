const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
const start = source.indexOf('const canvasFileCache = new Map();');
const end = source.indexOf('\nfunction paintCanvas(){', start);
assert.ok(start >= 0 && end > start);
const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// The Canvas is one history for the workspace: two chats feed the same list.
const browser = { id:'browser-1', kind:'card', at:1000, card:{ type:'browser', liveId:'live-123', taskId:'t1', url:'https://example.com', status:'done', screenshot:'data:image/jpeg;base64,AA==' } };
const browserLater = { id:'browser-2', kind:'card', at:3000, card:{ type:'browser', liveId:'live-123', taskId:'t1', url:'https://example.com/b', status:'done' } };
const snapshot = { id:'browser-3', kind:'card', at:500, card:{ type:'browser', url:'https://example.org', status:'done', screenshot:'data:image/jpeg;base64,AA==' } };
const file = { id:'file-1', kind:'card', at:2000, card:{ type:'file', name:'report.html', content:'<script>top.alert(1)</script>', status:'done' } };
const upload = { id:'user-1', kind:'text', files:[{ name:'notes.txt', dataUrl:'data:text/plain;base64,SGVsbG8=' }] };
const computer = { id:'pc-1', kind:'card', at:5000, card:{ type:'computer', status:'done', lines:[{ t:'$ npm test' }, { t:'ok' }] } };
const approval = { id:'ap-1', kind:'card', at:4000, card:{ type:'approval', title:'Web access', status:'pending' } };
const chatA = { id:'chat-1', title:'Flights', updatedAt:3000, messages:[snapshot, browser, file, upload, browserLater] };
const chatB = { id:'chat-2', title:'Repo', updatedAt:5000, messages:[approval, computer] };
const chat = chatA;
const state = { chats:[chatA, chatB], agent:{ name:'Agent', color:'lingon' } };
const context = vm.createContext({
  TextDecoder, atob, esc, state,
  icon: name => name,
  md: value => `<p>${String(value)}</p>`,
  $: () => null,
  cardNode: () => '<div>card</div>',
  cardStreams: () => false,
  canvasShouldShow: () => true,
  safeImg: u => /^data:image\//.test(String(u || '')) ? u : '',
  hostName: u => { try { return new URL(u).hostname; } catch { return ''; } },
  artifactInfo: cd => ({ title:cd.name, label:'Artifact', ic:'file' }),
  fmtAgo: () => 'now',
  agentPointerHTML: () => '', Mascot:{ svg:() => '' },
});
vm.runInContext(source.slice(start, end), context);

const history = context.canvasHistory();
assert.deepEqual(Array.from(history, r => r.m.id), ['pc-1', 'browser-2', 'file-1', 'browser-3'],
  'the history mixes every chat, newest first; a task browser shows once; approvals keep their own tab');
const list = context.canvasHistoryHTML();
assert.match(list, /Canvas history/);
assert.match(list, /class="appr-item canvas-entry"/, 'entries use the Approvals and Automations row layout');
assert.match(list, /data-act="canvas-card" data-chat="chat-1" data-msg="browser-2"/);
assert.match(list, /data-act="canvas-card" data-chat="chat-2" data-msg="pc-1"/);
assert.doesNotMatch(list, /ap-1/);
state.chats = [];
assert.match(context.canvasHistoryHTML(), /Nothing here yet/);
state.chats = [chatA, chatB];

// Opening an entry shows it large: a live browser plays its session, the rest render in full.
const open = ref => context.canvasItemBody(ref, context.canvasItemView(ref));
const live = open({ kind:'card', chatId:'chat-1', msgId:'browser-2' });
assert.equal(live.live, 'live-123', 'a browser with a live session plays it');
assert.equal(live.key, 'live:live-123', 'card updates never restart a live view');
assert.match(live.html, /id="livecanvas"/);
const shot = open({ kind:'card', chatId:'chat-1', msgId:'browser-3' });
assert.equal(shot.live, undefined);
assert.match(shot.html, /src="data:image\/jpeg;base64,AA=="/, 'a browser without a live session shows its picture');
const fileBody = open({ kind:'card', chatId:'chat-1', msgId:'file-1' });
assert.match(fileBody.html, /sandbox="allow-scripts"/);
assert.match(fileBody.html, /&lt;script&gt;/, 'HTML file remains inside a sandboxed preview');
assert.doesNotMatch(fileBody.html, /arti-head/, 'the Canvas title replaces the document header');
assert.match(open({ kind:'card', chatId:'chat-2', msgId:'pc-1' }).html, /npm test/);
assert.match(open({ kind:'upload', chatId:'chat-1', msgId:'user-1', fileIndex:0 }).html, /Hello/, 'uploaded text files render in Canvas');
assert.equal(context.canvasItemView({ kind:'card', chatId:'gone', msgId:'x' }), null, 'a deleted chat falls back to the history');
assert.match(context.canvasViewHeadHTML(context.canvasItemView({ kind:'card', chatId:'chat-1', msgId:'file-1' })), /data-act="canvas-back"[\s\S]*data-act="canvas-wide"/, 'an open entry goes back to the history or shows bigger');

const cardsStart = source.indexOf('/* ---------------- visual cards ----------------');
const cardsEnd = source.indexOf('\nfunction prevFor(', cardsStart);
assert.ok(cardsStart >= 0 && cardsEnd > cardsStart);
const cardsContext = vm.createContext({
  state:{agent:{name:'Agent'}},
  esc,
  icon: name => name,
  md: value => `<p>${String(value)}</p>`,
  fmtBytes: n => `${n} B`,
  humanizeSlug: s => String(s || ''),
  composioAppByToolkit: () => null,
  appLogoHtml: () => '',
  GMAIL_MARK: '<svg></svg>',
  mailCache: null,
  liveCardFrame: null,
  syncCardLive: () => { cardsContext.synced = (cardsContext.synced || 0) + 1; },
  agentPointerHTML: (id, compact) => `<span class="agent-ptr${compact ? ' compact' : ''}" data-live="${id}"></span>`,
  setTimeout: (fn) => fn(),
});
vm.runInContext(source.slice(cardsStart, cardsEnd), cardsContext);
vm.runInContext(source.match(/const liveTaskIds = \(c\) => .*\r?\n/)[0].replace('const ', 'var '), cardsContext);
vm.runInContext(source.match(/function cardStreams\(c, cd\)\{[\s\S]*?\n\}/)[0], cardsContext);
const browserCard = cardsContext.cardNode(chat, { ...browser, card:{...browser.card,screenshot:'data:image/jpeg;base64,AA=='} });
// Chat cards preview their work; the full live view still opens in Canvas on request.
assert.match(browserCard, /<img src="data:image\/jpeg;base64,AA=="/, 'browser card previews its screenshot');
assert.match(browserCard, /data-act="canvas-card" data-chat="chat-1" data-msg="browser-1"/);
assert.match(browserCard, /Open live view/);
// While its task works, the chat card plays the task's live browser instead of the last screenshot.
const liveChat = { id:'chat-1', messages:[], managedTasks:{ t1:{ status:'running' } } };
const liveBrowser = { id:'browser-2', card:{ type:'browser', liveId:'rt:live-abc', taskId:'t1', url:'https://example.com', status:'done', screenshot:'data:image/jpeg;base64,AA==' } };
const liveCard = cardsContext.cardNode(liveChat, liveBrowser);
assert.match(liveCard, /class="cv-live" data-live="rt:live-abc"/, 'a working task streams live in its chat card');
assert.match(liveCard, /cv-live-badge/);
assert.match(liveCard, /class="agent-ptr compact" data-live="rt:live-abc"/, 'the live card shows where the agent works');
assert.match(liveCard, /Working/);
assert.equal(cardsContext.synced, 1, 'rendering a live card connects its stream');
liveChat.managedTasks.t1.status = 'completed';
const doneCard = cardsContext.cardNode(liveChat, liveBrowser);
assert.doesNotMatch(doneCard, /cv-live/, 'a finished task keeps its last screenshot');
assert.doesNotMatch(doneCard, /agent-ptr/);
assert.doesNotMatch(source, /No runs yet in this chat|class="pctitle"/, 'the live view has no tool-output terminal');
assert.match(doneCard, /<img src="data:image\/jpeg;base64,AA=="/);
const unsafeShot = cardsContext.cardNode(chat, { ...browser, card:{...browser.card,screenshot:'javascript:alert(1)'} });
assert.doesNotMatch(unsafeShot, /javascript:/, 'only https or data images render');
const computerCard = cardsContext.cardNode(chat, { id:'computer-1', card:{ type:'computer', managed:true, status:'done', lines:[{t:'private output'}] } });
assert.match(computerCard, /data-act="canvas-card"/);
assert.match(computerCard, /class="term mini cv-term"/, 'computer card previews its latest output');
assert.equal(cardsContext.cardNode(chat, { id:'mem-1', card:{ type:'memory', text:'likes tea', status:'done' } }), '', 'memory saves never render a chat card');
console.log('canvas history, open view and card previews: ok');
