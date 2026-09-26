const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '..', 'app', 'app.js'), 'utf8');
const start = source.indexOf('const canvasFileCache = new Map();');
const end = source.indexOf('\nfunction paintCanvas(){', start);
assert.ok(start >= 0 && end > start);
let liveId = null;
const context = vm.createContext({
  Map, TextDecoder, Uint8Array, atob,
  esc: value => String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'),
  icon: name => name,
  md: value => `<p>${String(value)}</p>`,
  state: {},
  paintLive: (body, _chat, id) => { liveId = id; body.innerHTML = 'live browser'; },
  pcConnect: () => {},
  cardNode: () => '<div>card</div>',
});
vm.runInContext(source.slice(start, end), context);

const browser = { id:'browser-1', kind:'card', card:{ type:'browser', liveId:'live-123', url:'https://example.com', status:'done' } };
const file = { id:'file-1', kind:'card', card:{ type:'file', name:'report.html', content:'<script>top.alert(1)</script>', status:'done' } };
const upload = { id:'user-1', kind:'text', files:[{ name:'notes.txt', dataUrl:'data:text/plain;base64,SGVsbG8=' }] };
const chat = { id:'chat-1', messages:[browser,file,upload], canvasSelectedMessageId:browser.id };
const gallery = context.canvasGalleryHTML(chat);
assert.match(gallery, /data-act="canvas-card" data-chat="chat-1" data-msg="browser-1"/);
assert.match(gallery, /data-act="canvas-upload" data-chat="chat-1" data-msg="user-1" data-i="0"/);

const body = { innerHTML:'' };
context.paintCanvasSelection(body, chat, browser);
assert.equal(liveId, 'live-123', 'browser card opens its own live session');
chat.canvasSelectedMessageId = file.id;
context.paintCanvasSelection(body, chat, file);
assert.match(body.innerHTML, /sandbox="allow-scripts"/);
assert.match(body.innerHTML, /&lt;script&gt;/, 'HTML file remains inside a sandboxed preview');
chat.canvasSelectedMessageId = upload.id;
chat.canvasSelectedFileIndex = 0;
context.paintCanvasSelection(body, chat, upload);
assert.match(body.innerHTML, /Hello/, 'uploaded text files render in Canvas');

const cardsStart = source.indexOf('/* ---------------- visual cards ----------------');
const cardsEnd = source.indexOf('\nfunction prevFor(', cardsStart);
assert.ok(cardsStart >= 0 && cardsEnd > cardsStart);
const cardsContext = vm.createContext({
  state:{agent:{name:'Agent'}},
  esc: context.esc,
  icon: context.icon,
  md: context.md,
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
vm.runInContext(source.match(/const liveTaskIds = \(c\) => .*\n/)[0].replace('const ', 'var '), cardsContext);
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
const runsStart = source.indexOf('function runTimelineHTML(c){');
const runsEnd = source.indexOf('\nfunction resolveCard(', runsStart);
const runsContext = vm.createContext({ icon:context.icon, esc:context.esc });
vm.runInContext(source.slice(runsStart, runsEnd), runsContext);
assert.equal(runsContext.runTimelineHTML({ messages:[{managedId:'old-browser'}], canvasRuns:[{id:'old-browser',card:{type:'browser',url:'https://en.wikipedia.org/'}}] }), '', 'legacy Canvas copy is hidden when the chat already has the card');
console.log('canvas card and file previews: ok');
