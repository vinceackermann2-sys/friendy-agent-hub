const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
const start = source.indexOf('const canvasFileCache = new Map();');
const end = source.indexOf('\nfunction paintCanvas(){', start);
assert.ok(start >= 0 && end > start);
const esc = value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
// Whether a card's task still works decides "Working now", so the real helpers are loaded.
const taskHelpers = [
  source.match(/const liveTaskIds = \(c\) => .*\r?\n/)[0].replace('const ', 'var '),
  source.match(/function cardStreams\(c, cd\)\{[\s\S]*?\nconst cardStatus = .*\r?\n/)[0].replace('const cardStatus', 'var cardStatus'),
].join('\n');
const Engine = { managed:true, isRunning:() => false };
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
  TextDecoder, atob, esc, state, Engine,
  icon: name => name,
  md: value => `<p>${String(value)}</p>`,
  $: () => null,
  cardNode: () => '<div>card</div>',
  canvasShouldShow: () => true,
  safeImg: u => /^data:image\//.test(String(u || '')) ? u : '',
  hostName: u => { try { return new URL(u).hostname; } catch { return ''; } },
  artifactInfo: cd => ({ title:cd.name, label:'Artifact', ic:'file' }),
  fmtAgo: () => 'now',
  agentPointerHTML: () => '', Mascot:{ svg:() => '' }, liveControl:false,
});
vm.runInContext(source.slice(start, end), context);
vm.runInContext(taskHelpers, context);

// A task's browser steps share one chat card (the newest shows); desktop and browser stay apart.
assert.equal(context.visualGroup({ type:'browser', taskId:'t1', liveId:'rt:a' }), 'web:t:t1');
assert.equal(context.visualGroup({ type:'browser', desktop:true, taskId:'t1' }), 'pc:t:t1');
assert.equal(context.visualGroup({ type:'browser', liveId:'rt:a' }), 'web:l:rt:a');
assert.equal(context.visualGroup({ type:'browser' }), 'web:', 'ungrouped cards group by reply');
assert.equal(context.visualGroup({ type:'file' }), '');
const history = context.canvasHistory();
assert.deepEqual(Array.from(history, r => r.m.id), ['browser-2', 'file-1', 'browser-3'],
  'the history mixes every chat, newest first; a task browser shows once; approvals keep their own tab; shell output stays hidden');
const list = context.canvasHistoryHTML();
assert.match(list, /Canvas history/);
assert.match(list, /class="appr-item canvas-entry"/, 'entries use the Approvals and Automations row layout');
assert.match(list, /data-act="canvas-card" data-chat="chat-1" data-msg="browser-2"/);
assert.doesNotMatch(list, /pc-1|npm test/, 'people never see shell commands');
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
// A finished task's browser (its stream is gone, the VM stops) shows its last screen and says
// so, instead of "connecting" and offering a takeover.
const ended = { id:'browser-rt', kind:'card', at:6000, card:{ type:'browser', liveId:'rt:live-done', taskId:'t9', url:'https://example.net', status:'done', screenshot:'data:image/jpeg;base64,AA==' } };
state.chats.push({ id:'chat-3', title:'Done', updatedAt:6000, messages:[ended], managedTasks:{ t9:{ status:'completed' } } });
const endedBody = open({ kind:'card', chatId:'chat-3', msgId:'browser-rt' });
assert.equal(endedBody.live, undefined, 'a finished task does not connect to its stream');
assert.doesNotMatch(endedBody.html, /id="livecanvas"|takeover/);
assert.match(endedBody.html, /last screen it showed/);
assert.match(endedBody.html, /src="data:image\/jpeg;base64,AA=="/);
state.chats.pop();
// A task stopped in the middle of a browser step never sends that step's last card. The
// card still says running while nothing works on it: the history does not say "Working
// now", and the entry shows the last screen instead of a live view.
const stale = { id:'browser-stale', kind:'card', at:7000, card:{ type:'browser', liveId:'rt:live-stale', taskId:'t7', url:'https://facebook.com', status:'running', note:'Working in the browser…' } };
const staleChat = { id:'chat-4', title:'Facebook', updatedAt:7000, messages:[stale], managedTasks:{ t7:{ status:'stopped' } } };
state.chats.push(staleChat);
assert.doesNotMatch(context.canvasHistoryHTML(), /Working now/, 'a stopped task\'s browser is not working');
const staleBody = open({ kind:'card', chatId:'chat-4', msgId:'browser-stale' });
assert.equal(staleBody.live, undefined, 'no live view for a stopped task');
assert.match(staleBody.html, /last screen/);
assert.match(staleBody.html, /No picture was saved/, 'no "waiting for the image" that will never come');
staleChat.managedTasks.t7.status = 'running';
assert.match(context.canvasHistoryHTML(), /Working now/, 'the same step works while its task does');
// A computer step likewise works only while its task does.
staleChat.messages.push({ id:'pc-stale', kind:'card', at:8000, card:{ type:'computer', status:'running', taskId:'t7', lines:[{ t:'$ ls' }] } });
staleChat.managedTasks.t7.status = 'failed';
assert.doesNotMatch(context.canvasHistoryHTML(), /Working now/);
assert.equal(context.canvasItemView({ kind:'card', chatId:'chat-4', msgId:'pc-stale' }), null, 'a shell step never opens in the Canvas');
state.chats.pop();
const shot = open({ kind:'card', chatId:'chat-1', msgId:'browser-3' });
assert.equal(shot.live, undefined);
assert.match(shot.html, /src="data:image\/jpeg;base64,AA=="/, 'a browser without a live session shows its picture');
const fileBody = open({ kind:'card', chatId:'chat-1', msgId:'file-1' });
assert.match(fileBody.html, /sandbox="allow-scripts"/);
assert.match(fileBody.html, /&lt;script&gt;/, 'HTML file remains inside a sandboxed preview');
assert.doesNotMatch(fileBody.html, /arti-head/, 'the Canvas title replaces the document header');
assert.equal(context.canvasItemView({ kind:'card', chatId:'chat-2', msgId:'pc-1' }), null);
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
  Engine,
});
vm.runInContext(source.slice(cardsStart, cardsEnd), cardsContext);
vm.runInContext(taskHelpers, cardsContext);
vm.runInContext(source.match(/function liveEnded\(c, cd\)\{[\s\S]*?\n\}/)[0], cardsContext);
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
// A step whose task was stopped reads as interrupted in the chat, not as working.
const stoppedChat = { id:'chat-5', messages:[], managedTasks:{ t5:{ status:'stopped' } } };
const stoppedCard = cardsContext.cardNode(stoppedChat, { id:'browser-5', card:{ type:'browser', liveId:'rt:live-5', taskId:'t5', url:'https://facebook.com', status:'running', note:'Working in the browser…' } });
assert.match(stoppedCard, /Interrupted/);
assert.doesNotMatch(stoppedCard, /Working|tdots|Open live view|is-running/);
const stoppedShell = cardsContext.cardNode(stoppedChat, { id:'pc-5', card:{ type:'computer', managed:true, taskId:'t5', status:'running', lines:[] } });
assert.match(stoppedShell, /Stopped before it finished/);
assert.doesNotMatch(stoppedShell, /tdots|Running in your workspace/);
const unsafeShot = cardsContext.cardNode(chat, { ...browser, card:{...browser.card,screenshot:'javascript:alert(1)'} });
assert.doesNotMatch(unsafeShot, /javascript:/, 'only https or data images render');
const computerCard = cardsContext.cardNode(chat, { id:'computer-1', card:{ type:'computer', managed:true, status:'done', lines:[{t:'private output'}] } });
assert.match(computerCard, /data-act="canvas-card"/);
assert.match(computerCard, /class="term mini cv-term"/, 'computer card previews its latest output');
assert.equal(cardsContext.cardNode(chat, { id:'mem-1', card:{ type:'memory', text:'likes tea', status:'done' } }), '', 'memory saves never render a chat card');
console.log('canvas history, open view and card previews: ok');
