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

const cardsStart = source.indexOf('const STCHIP = {');
const cardsEnd = source.indexOf('\nfunction prevFor(', cardsStart);
assert.ok(cardsStart >= 0 && cardsEnd > cardsStart);
const cardsContext = vm.createContext({
  state:{agent:{name:'Agent'}},
  esc: context.esc,
  icon: context.icon,
});
vm.runInContext(source.slice(cardsStart, cardsEnd), cardsContext);
const browserCard = cardsContext.cardNode(chat, { ...browser, card:{...browser.card,screenshot:'data:image/jpeg;base64,AA=='} });
assert.equal((browserCard.match(/data-act="canvas-card"/g) || []).length, 1);
assert.doesNotMatch(browserCard, /<img|data:image\//, 'browser screenshot is shown only in Canvas');
const computerCard = cardsContext.cardNode(chat, { id:'computer-1', card:{ type:'computer', managed:true, status:'done', lines:[{t:'private output'}] } });
assert.equal((computerCard.match(/data-act="canvas-card"/g) || []).length, 1);
assert.doesNotMatch(computerCard, /private output|class="term"/, 'computer output is shown only in Canvas');
const runsStart = source.indexOf('function runTimelineHTML(c){');
const runsEnd = source.indexOf('\nfunction resolveCard(', runsStart);
const runsContext = vm.createContext({ icon:context.icon, esc:context.esc });
vm.runInContext(source.slice(runsStart, runsEnd), runsContext);
assert.equal(runsContext.runTimelineHTML({ messages:[{managedId:'old-browser'}], canvasRuns:[{id:'old-browser',card:{type:'browser',url:'https://en.wikipedia.org/'}}] }), '', 'legacy Canvas copy is hidden when the chat already has the card');
console.log('canvas card and file previews: ok');
