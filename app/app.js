/* ============ Lingon — personal agent app ============ */
(() => {
'use strict';

/* ---------------- utils ---------------- */
const $  = s => document.querySelector(s);
const $$ = s => Array.from(document.querySelectorAll(s));
const el = h => { const t = document.createElement('template'); t.innerHTML = h.trim(); return t.content.firstElementChild; };
const sleep = ms => new Promise(r => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2, 10);
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
const fmtBytes = n => n < 1024 ? n + ' B' : (n / 1024).toFixed(1) + ' KB';
const fmtWhen = ts => {
  const d = Date.now() - ts;
  if (d < 60e3) return 'now';
  if (d < 3600e3) return Math.floor(d / 60e3) + 'm';
  if (d < 86400e3) return Math.floor(d / 3600e3) + 'h';
  return new Date(ts).toLocaleDateString();
};

/* ---------------- icons ---------------- */
const IC = {
  plus:'<path d="M12 5v14M5 12h14"/>',
  up:'<path d="M12 19V5M5 12l7-7 7 7"/>',
  mic:'<path d="M12 2a3 3 0 0 1 3 3v7a3 3 0 0 1-6 0V5a3 3 0 0 1 3-3Z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/>',
  search:'<circle cx="11" cy="11" r="7"/><path d="M21 21l-4.3-4.3"/>',
  globe:'<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3c2.5 2.6 4 5.6 4 9s-1.5 6.4-4 9c-2.5-2.6-4-5.6-4-9s1.5-6.4 4-9Z"/>',
  term:'<path d="M4 17l6-5-6-5M12 19h8"/>',
  file:'<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"/><path d="M14 2v6h6"/>',
  lock:'<rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>',
  shield:'<path d="M12 22s8-3 8-10V5l-8-3-8 3v7c0 7 8 10 8 10Z"/>',
  shieldcheck:'<path d="M12 22s8-3 8-10V5l-8-3-8 3v7c0 7 8 10 8 10Z"/><path d="M9 12l2 2 4-4"/>',
  spark:'<path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9Z"/><path d="M19 16l.8 2.2L22 19l-2.2.8L19 22l-.8-2.2L16 19l2.2-.8Z"/>',
  book:'<path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20"/><path d="M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2Z"/>',
  box:'<path d="M21 8l-9-5-9 5v8l9 5 9-5V8Z"/><path d="M3 8l9 5 9-5M12 21v-8"/>',
  chart:'<path d="M3 3v18h18"/><path d="M8 17v-5M13 17V7M18 17v-8"/>',
  code:'<path d="M16 18l6-6-6-6M8 6l-6 6 6 6"/>',
  mail:'<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 6l-10 7L2 6"/>',
  git:'<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="6" r="3"/><path d="M6 9v6M18 9a9 9 0 0 1-9 9"/>',
  check:'<path d="M20 6L9 17l-5-5"/>',
  x:'<path d="M18 6L6 18M6 6l12 12"/>',
  gear:'<circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M19.1 4.9L17 7M7 17l-2.1 2.1"/>',
  trash:'<path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6"/>',
  down:'<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
  eye:'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/>',
  eyeoff:'<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8Z"/><circle cx="12" cy="12" r="3"/><path d="M3 3l18 18"/>',
  dice:'<path d="M16 3h5v5M4 20L21 3M21 16v5h-5M15 15l6 6M4 4l5 5"/>',
  aur:'<path d="M7 17L17 7M7 7h10v10"/>',
  panel:'<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M15 3v18"/>',
  list:'<path d="M8 6h13M8 12h13M8 18h13M3.5 6h.01M3.5 12h.01M3.5 18h.01"/>',
  key:'<circle cx="7.5" cy="15.5" r="4"/><path d="M11 12L21 2M18 5l3 3"/>',
  star:'<path d="M12 2l3.1 6.3 6.9 1-5 4.9 1.2 6.8L12 17.8 5.8 21l1.2-6.8-5-4.9 6.9-1Z"/>',
  user:'<path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  refresh:'<path d="M23 4v6h-6M1 20v-6h6"/><path d="M3.5 9a9 9 0 0 1 15-3.5L23 10M20.5 15a9 9 0 0 1-15 3.5L1 14"/>',
  alert:'<path d="M10.3 3.8L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  chatb:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy:'<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
};
const icon = (n, s = 16) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[n] || ''}</svg>`;

/* ---------------- markdown-lite ---------------- */
function md(src){
  const s = esc(src)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>');
  return s.split(/\n{2,}/).map(b => {
    const lines = b.split('\n');
    if (lines.every(l => /^\s*[-•]\s*/.test(l)))
      return '<ul>' + lines.map(l => '<li>' + l.replace(/^\s*[-•]\s*/, '') + '</li>').join('') + '</ul>';
    return '<p>' + lines.join('<br>') + '</p>';
  }).join('');
}

/* ---------------- state ---------------- */
const LS = 'lingon.v1';
const fresh = () => ({
  onboarded:false, agent:null, view:'chat', activeChat:null,
  canvasOpen:true, canvasTab:'canvas', model:'Smart',
  chats:[], pendingPrompt:null,
  vault:{ secrets:[], apps:[], approvals:[], mode:'default' },
  memory:[],
});
let state;
try { state = Object.assign(fresh(), JSON.parse(localStorage.getItem(LS) || 'null')) || fresh(); }
catch (e) { state = fresh(); }
if (!state.vault) state.vault = fresh().vault;
const save = () => localStorage.setItem(LS, JSON.stringify(state));

function expirePending(){
  state.chats.forEach(c => (c.messages || []).forEach(m => {
    if (m.kind === 'card' && m.card.status === 'pending') m.card.status = 'expired';
  }));
}

/* ---------------- toast ---------------- */
let toastT;
function toast(msg){
  let t = $('#toast');
  if (!t){ t = el('<div id="toast"></div>'); document.body.appendChild(t); }
  t.textContent = msg; t.style.display = 'flex';
  clearTimeout(toastT); toastT = setTimeout(() => { t.style.display = 'none'; }, 2600);
}

/* ---------------- waits (card promises) ---------------- */
const waits = {};
const wkey = (chatId, msgId) => chatId + '/' + msgId;

const root = document.getElementById('root');
const chat = () => state.chats.find(c => c.id === state.activeChat);
const isActive = c => state.view === 'chat' && state.activeChat === c.id;

function render(){
  if (state.onboarded && state.agent) renderApp(); else renderLanding();
}

/* ================================================================
   LANDING
================================================================ */
function renderLanding(){
  root.innerHTML = `
  <div class="fadeup">
    <nav class="nav">
      <div class="logo">${Mascot.logo(26)} Lingon</div>
      <div class="navlinks"><span data-act="scroll" data-t="#feat">Product</span><span data-act="scroll" data-t="#sec">Security</span><span data-act="scroll" data-t="#feat">Docs</span></div>
      <button class="btn small" data-act="open-app">Open app</button>
    </nav>
    <section class="hero">
      <div class="badge">${icon('spark',14)} Personal agents, claimed &amp; named by you</div>
      <h1>An agent that's<br>actually yours.</h1>
      <p class="sub">Claim it. Name it. Teach it. Lingon runs on the OpenAI Agents API behind a sandboxed harness — browser, code, files, sub-agents — while your secrets stay sealed in your vault.</p>
      <div class="promptwrap">
        <div class="sitter">${Mascot.svg('lingon','wave',84,'mascot-bob')}</div>
        <form class="promptbox" id="lform">
          <textarea id="lprompt" rows="2" placeholder="Ask your agent anything… e.g. Research which Swedish party people say they'll vote for on social media"></textarea>
          <div class="pb-row">
            <span class="iconbtn" style="cursor:default">${icon('plus',17)}</span>
            <span style="display:flex;gap:10px;align-items:center">
              <button type="button" class="modelchip">${icon('star',14)} Smart ▾</button>
              <button type="button" class="micbtn" data-act="mic">${icon('mic',17)}</button>
              <button type="submit" class="micbtn" style="background:var(--ink)" title="Send">${icon('up',17)}</button>
            </span>
          </div>
        </form>
      </div>
      <div class="landing-thread" id="lthread"></div>
      <div class="hintline">${icon('spark',13)} Try “review my GitHub pull requests” or “build me a landing page”</div>
    </section>

    <section class="features" id="feat">
      <h2>Everything a personal agent should be</h2>
      <p class="fsub">Rich action cards in chat, a live canvas on the right, and a vault that keeps you in control.</p>
      <div class="grid3">
        <div class="fcard"><div class="fic">${icon('shieldcheck',19)}</div><h3>Approvals &amp; sealed vault</h3><p>New actions wait for your yes. Secrets are encrypted and masked — the agent only ever receives a reference, never the value.</p></div>
        <div class="fcard"><div class="fic" style="background:var(--purple-soft);color:var(--purple)">${icon('panel',19)}</div><h3>Visual canvas</h3><p>Charts, live pages, diffs and plans render beside your chat, with a full trace of every tool call and sub-agent.</p></div>
        <div class="fcard"><div class="fic" style="background:var(--green-soft);color:var(--green)">${icon('box',19)}</div><h3>Sub-agents &amp; sandbox</h3><p>Parallel workers fan out across the web while everything runs in a sandboxed Codex-style harness with an allowlisted network.</p></div>
        <div class="fcard"><div class="fic" style="background:var(--purple-soft);color:var(--purple)">${icon('book',19)}</div><h3>Memory that sticks</h3><p>Your agent remembers preferences and projects across chats — and you can inspect or delete every memory.</p></div>
        <div class="fcard"><div class="fic">${icon('globe',19)}</div><h3>Browser &amp; computer use</h3><p>Watch it browse and type in a contained window, step by step, never hidden behind the curtain.</p></div>
        <div class="fcard"><div class="fic" style="background:var(--green-soft);color:var(--green)">${icon('user',19)}</div><h3>Claimed, named, yours</h3><p>One person claims each agent. You name it, pick its color and character — it answers to you alone.</p></div>
      </div>
    </section>

    <section class="secband" id="sec"><div class="inner">
      <div>
        <h2>Built so you can trust it with real life</h2>
        <p>An agent that acts in the world must be boringly safe. Lingon splits what the model <em>wants</em> from what your vault <em>allows</em> — and shows its work.</p>
      </div>
      <div class="seclist">
        <div class="row">${icon('lock',17)}<div><b>Secrets never enter the model</b><span>Values are encrypted at rest; the agent gets masked references like sec_••••.</span></div></div>
        <div class="row">${icon('shieldcheck',17)}<div><b>Approvals by default</b><span>Sensitive actions pause for your yes — or an explicit always-allow you can revoke.</span></div></div>
        <div class="row">${icon('box',17)}<div><span style="margin:0"><b>Sandboxed harness</b><br><span>Code, browser and computer use run contained, with a full visible trace.</span></span></div></div>
      </div>
    </div></section>

    <footer><span>© 2026 Lingon — made with ${icon('spark',12)} in Stockholm</span><span>Agents API · sandboxed harness · your vault</span></footer>
  </div>`;
  $('#lform').addEventListener('submit', e => { e.preventDefault(); landingRun($('#lprompt').value.trim()); });
  $('#lprompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); $('#lform').requestSubmit(); } });
}

async function landingRun(prompt){
  if (!prompt) return;
  const th = $('#lthread'); th.innerHTML = '';
  th.appendChild(el(`<div class="msg user"><div class="bub">${esc(prompt)}</div></div>`));
  const an = el(`<div class="msg agent"><div class="ava">${Mascot.svg('lingon','think',30)}</div><div class="body"><div class="md"><span class="tdots"><i></i><i></i><i></i></span></div></div></div>`);
  th.appendChild(an);
  await sleep(700);
  const body = an.querySelector('.md');
  const text = Engine.preview(prompt);
  const m = { text:'' };
  for (const tok of text.split(/(\s+)/)){
    m.text += tok; body.innerHTML = md(m.text);
    await sleep(14);
  }
  an.querySelector('.ava').innerHTML = Mascot.svg('lingon','happy',30);
  const card = el(`
  <div class="acard" style="margin-top:16px">
    <div class="hd"><div class="aic red">${Mascot.svg('lingon','wave',26)}</div>
      <div><b>I'd love to do this for real</b><div class="sub">Claim me — name me, make me yours — and I'll run this with the full harness.</div></div></div>
    <div class="ft" style="padding-top:12px"><button class="btn ghost small" data-act="skip-claim">Use a sample agent</button><button class="btn" data-act="claim">${icon('spark',15)} Claim your agent</button></div>
  </div>`);
  th.appendChild(card);
  state.pendingPrompt = prompt; save();
  card.scrollIntoView({ behavior:'smooth', block:'center' });
}

/* ================================================================
   ONBOARDING
================================================================ */
let ob = null;
const NAMES = ['Sigge','Nova','Astrid','Nisse','Mio','Saga','Otto','Vera','Lingo','Belle'];
const PERS = ['Playful','Precise','Calm','Bold'];

function openOnboarding(){
  ob = { step:0, name:'', color:'lingon', pers:'Playful' };
  const back = el('<div class="modalback"><div class="modal" id="modal"></div></div>');
  document.body.appendChild(back);
  obStep();
}
function obStep(){
  const M = $('#modal');
  const dots = `<div class="ob-dots">${[0,1,2,3].map(i => `<i class="${i <= ob.step ? 'on' : ''}"></i>`).join('')}</div>`;
  let html = '';
  if (ob.step === 0){
    html = `<h2 style="text-align:center">Say hej to your agent</h2>
      <p class="msub" style="text-align:center">Unclaimed, unnamed, and waiting for exactly one person: you.</p>
      <div class="ob-stage" id="obstage">${Mascot.svg(ob.color,'wave',150,'mascot-bob')}</div>
      <div class="mfoot" style="justify-content:center"><button class="btn" data-act="ob-claim">${icon('spark',15)} Claim this agent</button></div>${dots}`;
  } else if (ob.step === 1){
    html = `<h2 style="text-align:center">Name them</h2>
      <p class="msub" style="text-align:center">Anything goes — they'll answer to it forever after.</p>
      <div class="ob-stage">${Mascot.svg(ob.color,'happy',96,'mascot-bob')}</div>
      <div class="ob-name-row"><input class="field" id="obname" maxlength="18" placeholder="Untitled agent" value="${esc(ob.name)}"><button class="iconbtn" data-act="ob-dice" title="Surprise me" style="flex:none;width:46px;height:46px">${icon('dice',18)}</button></div>
      <div class="mfoot"><button class="btn ghost" data-act="ob-back">Back</button><button class="btn" data-act="ob-next">Continue</button></div>${dots}`;
  } else if (ob.step === 2){
    html = `<h2 style="text-align:center">Make them yours</h2>
      <p class="msub" style="text-align:center">Pick a color and a character. You can change both later.</p>
      <div class="ob-stage">${Mascot.svg(ob.color,'idle',110,'mascot-bob')}</div>
      <div class="swatches">${Mascot.keys.map(k => `<button class="swatch ${k === ob.color ? 'on' : ''}" data-act="ob-color" data-c="${k}" title="${Mascot.PALETTE[k].name}"><span style="width:30px;height:30px;border-radius:50%;background:${Mascot.PALETTE[k].body};display:block"></span></button>`).join('')}</div>
      <div class="persrow">${PERS.map(p => `<button class="pers ${p === ob.pers ? 'on' : ''}" data-act="ob-pers" data-p="${p}">${p}</button>`).join('')}</div>
      <div class="mfoot"><button class="btn ghost" data-act="ob-back">Back</button><button class="btn" data-act="ob-next">Continue</button></div>${dots}`;
  } else {
    html = `<h2 style="text-align:center">How ${esc(ob.name || 'your agent')} keeps you safe</h2>
      <div class="safetylist">
        <div class="row">${icon('lock',16)}<span><b>Sealed vault.</b> Secrets are encrypted; the agent only receives masked references.</span></div>
        <div class="row">${icon('shieldcheck',16)}<span><b>Approvals.</b> Sensitive actions pause for your yes, unless you always-allow them.</span></div>
        <div class="row">${icon('box',16)}<span><b>Sandbox.</b> Browser, code and computer use run contained — every step visible in the trace.</span></div>
        <div class="row">${icon('book',16)}<span><b>Memory you control.</b> It remembers across chats; you can review and delete anything.</span></div>
      </div>
      <div class="mfoot"><button class="btn ghost" data-act="ob-back">Back</button><button class="btn" data-act="ob-done">Enter Lingon ${icon('aur',15)}</button></div>${dots}`;
  }
  M.innerHTML = html;
  if (ob.step === 1) $('#obname').focus();
}
function confetti(){
  const st = $('#obstage') || $('#modal');
  const colors = ['#E15A46','#E8B33C','#5B6EE1','#6FBF73','#9B6BD3'];
  for (let i = 0; i < 18; i++){
    const c = el(`<span class="confetti" style="left:50%;top:40%;background:${colors[i % 5]};--dx:${(Math.random()*260-130)|0}px;--dy:${(Math.random()*200-60)|0}px"></span>`);
    st.appendChild(c); setTimeout(() => c.remove(), 950);
  }
}
function finalizeOnboarding(){
  state.onboarded = true;
  state.agent = { name: ob.name.trim() || 'Sigge', color: ob.color, pers: ob.pers, claimedAt: Date.now() };
  state.memory.unshift({ id: uid(), text: `Agent claimed and named “${state.agent.name}” — ${Mascot.PALETTE[state.agent.color].name.toLowerCase()}, ${state.agent.pers.toLowerCase()}.`, src:'onboarding', at: Date.now() });
  const c = { id: uid(), title:'First chat', messages:[], trace:[], artifact:null, createdAt:Date.now() };
  state.chats.unshift(c); state.activeChat = c.id; state.view = 'chat';
  const prompt = state.pendingPrompt; state.pendingPrompt = null;
  save();
  const back = $('.modalback'); if (back) back.remove();
  render();
  if (prompt) sendPrompt(prompt); else runGreet(c);
}

/* ================================================================
   APP SHELL
================================================================ */
function renderApp(){
  root.innerHTML = `
  <div class="app ${state.canvasOpen && state.view === 'chat' ? '' : 'nocanvas'}" id="app">
    <aside class="side" id="side"></aside>
    <main class="main" id="main"></main>
    <aside class="canvas" id="canvas"></aside>
  </div>`;
  paintSide(); paintMain(); paintCanvas();
}

function paintSide(){
  const a = state.agent;
  const filesN = state.chats.reduce((n, c) => n + c.messages.filter(m => m.kind === 'card' && m.card.type === 'file').length, 0);
  $('#side').innerHTML = `
    <div class="agentchip" data-act="nav" data-view="profile">
      ${Mascot.svg(a.color,'idle',34)}
      <div><b>${esc(a.name)}</b><div class="st"><i></i>claimed · online</div></div>
    </div>
    <button class="btn" style="margin:8px 4px 4px" data-act="newchat">${icon('plus',15)} New chat</button>
    <div class="slabel">Chats</div>
    <div style="overflow-y:auto;flex:1">
      ${state.chats.slice(0, 12).map(c => `
        <button class="sitem chatitem ${c.id === state.activeChat && state.view === 'chat' ? 'on' : ''}" data-act="openchat" data-id="${c.id}">
          ${icon('chatb',14)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</span>
          <span class="when">${fmtWhen(c.createdAt)}</span>
          <span class="del" data-act="delchat" data-id="${c.id}" title="Delete chat">${icon('trash',13)}</span>
        </button>`).join('') || '<div class="empty" style="padding:20px">No chats yet</div>'}
    </div>
    <div class="slabel">Your agent</div>
    <button class="sitem ${state.view === 'profile' ? 'on' : ''}" data-act="nav" data-view="profile">${icon('user',15)} Profile</button>
    <button class="sitem ${state.view === 'vault' ? 'on' : ''}" data-act="nav" data-view="vault">${icon('lock',15)} Vault <span class="cnt">${state.vault.secrets.length + state.vault.apps.length + filesN}</span></button>
    <button class="sitem ${state.view === 'memory' ? 'on' : ''}" data-act="nav" data-view="memory">${icon('book',15)} Memory <span class="cnt">${state.memory.length}</span></button>
    <div class="foot">
      <div class="badge">${icon('shieldcheck',13)} Sandboxed harness · Agents API</div>
    </div>`;
}

function paintMain(){
  const M = $('#main');
  if (state.view === 'chat') return paintChat(M);
  if (state.view === 'vault') return paintVault(M);
  if (state.view === 'memory') return paintMemory(M);
  if (state.view === 'profile') return paintProfile(M);
  return paintChat(M);
}

/* floating agent status (chat only) */
function statusFor(c){
  if (!c) return '';
  for (let i = c.messages.length - 1; i >= 0; i--){
    const m = c.messages[i];
    if (m.kind === 'card' && m.card.status === 'pending'){
      switch (m.card.type){
        case 'approval': return 'Needs approval';
        case 'connect': return 'Connecting';
        case 'secret': return 'Waiting for a secret';
        case 'question': return 'Asking you';
        case 'subagents': return 'Running sub-agents';
        case 'browser': return 'Browsing';
        case 'computer': return 'Using the sandbox';
      }
    }
  }
  return c.busy ? 'Working' : '';
}
function updateFloat(){
  const s = $('#floatstatus');
  if (s) s.textContent = statusFor(chat());
}

/* ---------------- chat view ---------------- */
function paintChat(M){
  const c = chat();
  if (!c){
    M.innerHTML = `<div class="empty" style="margin:auto">${Mascot.svg(state.agent.color,'idle',90,'mascot-bob')}<div style="margin-top:14px;font-weight:700">No chat open</div><div class="t2">Start one and ${esc(state.agent.name)} is on it.</div><button class="btn" data-act="newchat">${icon('plus',15)} New chat</button></div>`;
    return;
  }
  M.innerHTML = `
    <div class="floathead"><div class="fav">${Mascot.svg(state.agent.color,'idle',40)}</div><div class="pill">${esc(state.agent.name)}<span class="st" id="floatstatus"></span></div></div>
    <div class="chathead">
      <span class="ttl">${esc(c.title)}</span>
      ${c.busy ? '<span class="chip purple">' + icon('refresh',12) + ' working…</span>' : ''}
      <span class="sp"></span>
      <button class="iconbtn" data-act="togglecanvas" title="Toggle canvas">${icon('panel',16)}</button>
    </div>
    <div class="thread" id="thread"><div class="threadinner" id="tinner">
      ${c.messages.map(m => msgNode(c, m).outerHTML).join('')}
    </div></div>
    <div class="composerwrap"><div class="composer">
      <form class="promptbox" id="cform">
        <textarea id="cprompt" rows="1" placeholder="Ask ${esc(state.agent.name)} anything…"></textarea>
        <div class="pb-row">
          <span class="iconbtn" style="cursor:default">${icon('plus',16)}</span>
          <span style="display:flex;gap:10px;align-items:center">
            <button type="button" class="modelchip" data-act="model">${icon('star',13)} ${state.model} ▾</button>
            <button type="submit" class="micbtn" style="background:var(--ink)" title="Send">${icon('up',17)}</button>
          </span>
        </div>
      </form>
    </div></div>`;
  const th = $('#thread'); th.scrollTop = th.scrollHeight;
  updateFloat();
  $('#cform').addEventListener('submit', e => { e.preventDefault(); const v = $('#cprompt').value.trim(); if (v){ $('#cprompt').value = ''; sendPrompt(v); } });
  $('#cprompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); $('#cform').requestSubmit(); } });
}

function msgNode(c, m){
  if (m.kind === 'text' && m.role === 'user')
    return el(`<div class="msg user" data-mid="${m.id}"><div class="bub">${esc(m.text)}</div></div>`);
  if (m.kind === 'text')
    return el(`<div class="msg agent" data-mid="${m.id}"><div class="ava">${Mascot.svg(state.agent.color, m.mood || 'idle', 30)}</div><div class="body"><div class="md">${md(m.text)}</div></div></div>`);
  if (m.kind === 'tools')
    return el(`<div class="msg agent" data-mid="${m.id}"><div class="ava" style="visibility:hidden">${Mascot.svg(state.agent.color,'idle',30)}</div><div class="body"><div class="tools">${m.items.map(t => tlineHTML(t)).join('')}</div></div></div>`);
  if (m.kind === 'chips')
    return el(`<div class="msg" data-mid="${m.id}"><div class="chipsrow" style="margin-left:42px">${m.items.map(i => `<button class="chip" data-act="chip" data-t="${esc(i)}">${esc(i)}</button>`).join('')}</div></div>`);
  if (m.kind === 'card')
    return el(`<div class="msg agent" data-mid="${m.id}"><div class="ava" style="visibility:hidden">${Mascot.svg(state.agent.color,'idle',30)}</div><div class="body">${cardNode(c, m)}</div></div>`);
  return el('<div></div>');
}
const tlineHTML = t => `<div class="tline">${icon(t.ic,14)}<span>${esc(t.t)}</span>${t.d ? `<span class="d">${esc(t.d)}</span>` : ''}</div>`;

/* ---------------- cards ---------------- */
const STCHIP = {
  pending:'<span class="chip acc">waiting for you</span>',
  approved:'<span class="chip green">approved</span>',
  always:'<span class="chip green">always allowed</span>',
  denied:'<span class="chip" style="background:var(--acc-soft);color:var(--acc)">denied</span>',
  connected:'<span class="chip green">connected</span>',
  saved:'<span class="chip green">sealed in vault</span>',
  answered:c => `<span class="chip purple">you: ${esc(c.choice)}</span>`,
  done:'<span class="chip green">done</span>',
  skipped:'<span class="chip">skipped</span>',
  expired:'<span class="chip">expired</span>',
};
const stChip = c => { const v = STCHIP[c.status]; return typeof v === 'function' ? v(c) : (v || ''); };

function cardNode(c, m){
  const k = c.id, mid = m.id, cd = m.card;
  const auto = cd.type === 'subagents' || cd.type === 'browser' || cd.type === 'computer';
  const chip = auto ? (cd.status === 'done' ? STCHIP.done : '<span class="chip purple">running</span>') : stChip(cd);
  const hd = (ic, bg, fg, title, sub) => `<div class="hd"><div class="tile" style="background:${bg};color:${fg}">${ic}</div><div><b>${title}</b><div class="sub">${sub}</div></div><div class="st">${chip}</div></div>`;
  const pending = cd.status === 'pending';

  if (cd.type === 'approval') return `<div class="acard">
    ${hd(icon('shieldcheck',20),'var(--acc-soft)','var(--acc)',`Allow ${esc(state.agent.name)}: ${esc(cd.title)}`,'Action approval · sandboxed')}
    <div class="bd"><span class="mut">${esc(cd.detail)}</span><div class="secnote" style="color:var(--mut)">${icon('box',13)} Runs in the sandboxed harness — secrets stay masked refs.</div></div>
    ${pending ? `<div class="stack"><button class="btn" data-act="approve" data-chat="${k}" data-msg="${mid}">${icon('check',15)} Allow</button><button class="btn green" data-act="always" data-chat="${k}" data-msg="${mid}">Always allow</button><button class="btn soft" data-act="deny" data-chat="${k}" data-msg="${mid}">Deny</button></div>` : `<div class="ft"><span class="note">${icon('shield',12)} logged in trace</span></div>`}</div>`;

  if (cd.type === 'connect'){
    const app = cd.app === 'github' ? { n:'GitHub', ic:icon('git',20), fg:'var(--ink)' } : { n:'Gmail', ic:icon('mail',20), fg:'var(--acc)' };
    return `<div class="acard">${hd(app.ic,'#fff',app.fg, app.n,'Connector')}
    <div class="bd mut">I'll ask only for the scopes I need. Credentials go straight to your vault — never through my context.</div>
    ${pending ? `<div class="stack"><button class="btn" data-act="connect" data-chat="${k}" data-msg="${mid}">Connect</button><button class="btn ghost" data-act="deny-connect" data-chat="${k}" data-msg="${mid}">Not now</button></div>` : `<div class="ft"><span class="note">${icon('lock',12)} manage in Vault</span></div>`}</div>`;
  }

  if (cd.type === 'secret') return `<div class="acard">
    ${hd(icon('lock',20),'var(--purple-soft)','var(--purple)','Secure credentials store','encrypted at rest · agent gets a reference only')}
    <div class="bd">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="field" style="flex:1;min-width:140px" data-f="name" placeholder="secret name" value="${esc(cd.nameVal || cd.suggest || '')}">
        <input class="field mono" style="flex:1.4;min-width:180px" data-f="val" type="password" placeholder="paste value — masked immediately" autocomplete="off">
      </div>
      <div class="secnote">${icon('shieldcheck',14)} Value never enters model context, logs or traces.</div>
    </div>
    ${pending ? `<div class="stack"><button class="btn" data-act="save-secret" data-chat="${k}" data-msg="${mid}">${icon('lock',14)} Save to vault</button><button class="btn ghost" data-act="skip-secret" data-chat="${k}" data-msg="${mid}">Skip</button></div>` : (cd.status === 'saved' ? `<div class="ft"><span class="note mono">${esc(cd.ref)} · ••••••••</span></div>` : '')}</div>`;

  if (cd.type === 'question') return `<div class="acard">
    ${hd(icon('spark',20),'var(--purple-soft)','var(--purple)','Question', state.agent.name + ' is asking')}
    <div class="bd"><b>${esc(cd.q)}</b>
    <div class="qopts" style="margin-top:10px">${cd.options.map(o => {
      const on = cd.status === 'answered' && cd.choice === o;
      const dim = cd.status === 'answered' && cd.choice !== o;
      return pending
        ? `<button class="qopt" data-act="qopt" data-chat="${k}" data-msg="${mid}" data-o="${esc(o)}">${esc(o)}<span class="tick">${icon('check',12)}</span></button>`
        : `<span class="qopt ${on ? 'on' : 'dim'}" style="cursor:default">${esc(o)}<span class="tick">${icon('check',12)}</span></span>`;
    }).join('')}</div></div></div>`;

  if (cd.type === 'subagents') return `<div class="acard">
    ${hd(icon('box',20),'var(--line2)','var(--mut)','Parallel sub-agents','spawned in sandboxed harness')}
    <div class="bd">${cd.agents.map(a => `<div class="subrow">
      <div><span class="nm">${esc(a.name)}</span><div class="ds">${esc(a.desc)}</div></div>
      <span class="stt">${a.status === 'running' ? `<span class="spin">${icon('refresh',13)}</span> running` : a.status === 'done' ? `<span style="color:var(--green)">${icon('check',13)}</span> ${esc(a.note || 'done')}` : `<span style="color:var(--soft)">${icon('clock',13)}</span> queued`}</span>
    </div>`).join('')}</div></div>`;

  if (cd.type === 'browser') return `<div class="acard">
    ${hd(icon('globe',20),'#EAF1FB','#2F6FDB','Browser', esc(cd.note))}
    <div class="bd"><div class="win"><div class="bar"><i></i><i></i><i></i><span class="url">${esc(cd.url)}</span></div>
    <div class="scr">${cd.status === 'done' ? `<span style="color:var(--green)">${icon('check',14)}</span>` : `<span class="spin">${icon('refresh',14)}</span>`} ${esc(cd.note)}</div></div></div>
    <div class="stack"><button class="btn ghost" data-act="openbrowser">Open browser</button></div></div>`;

  if (cd.type === 'computer') return `<div class="acard">
    ${hd(icon('term',20),'var(--ink)','#fff','Sandboxed computer use','Codex-style harness · no writes outside sandbox')}
    <div class="bd"><div class="term">${cd.lines.map(L => `<div class="${L.cls || ''}">${esc(L.t)}</div>`).join('')}${cd.status === 'running' ? '<div class="tdots"><i></i><i></i><i></i></div>' : ''}</div></div></div>`;

  if (cd.type === 'file') return `<div class="acard"><div class="filrow">
    <div class="fic">${icon('file',17)}</div>
    <div><b>${esc(cd.name)}</b><div class="sz">${fmtBytes(cd.size || 0)} · saved to Files</div></div>
    <div class="acts"><button class="iconbtn" data-act="download" data-chat="${k}" data-msg="${mid}" title="Download">${icon('down',15)}</button></div>
  </div></div>`;

  if (cd.type === 'artifact') return `<div class="acard">
    <div class="bd" style="padding-top:14px">${prevFor(c, cd)}</div>
    <div class="filrow" style="border-top:1px solid var(--line2);padding-top:12px">
      <div class="fic" style="background:var(--green-soft);color:var(--green)">${icon('spark',16)}</div>
      <div><b>${esc(cd.title)}</b><div class="sz">Artifact</div></div>
      <div class="acts"><button class="iconbtn" data-act="viewcanvas" title="View on canvas">${icon('panel',14)}</button><button class="dotmenu" data-act="artmenu" title="More">•••</button></div>
    </div></div>`;

  if (cd.type === 'memory') return `<div class="acard">
    ${hd(icon('book',20),'var(--purple-soft)','var(--purple)','Saved to memory','I can recall this in any chat')}
    <div class="bd">${esc(cd.text)}</div></div>`;

  return '';
}

function prevFor(c, cd){
  const a = c.artifact;
  if (!a || a.title !== cd.title) return '';
  if (a.kind === 'html') return `<div class="prev"><iframe sandbox="allow-scripts" srcdoc="${esc(a.html)}"></iframe></div>`;
  if (a.kind === 'chart'){
    const max = Math.max.apply(null, a.data.map(d => d.v));
    return `<div class="prev"><div class="minibars">${a.data.map(d => `<i style="height:${Math.round(d.v / max * 100)}%;background:${d.c}"></i>`).join('')}</div></div>`;
  }
  if (a.kind === 'code') return `<div class="prev"><div class="minicode">${esc(a.code.split('\n').slice(0, 6).join('\n'))}</div></div>`;
  if (a.kind === 'plan') return `<div class="prev"><div class="miniplan">${a.items.slice(0, 3).map(i => `<span>• ${esc(i.replace(/\*\*/g,''))}</span>`).join('')}</div></div>`;
  return '';
}

/* ---------------- runtime for the engine ---------------- */
function makeRT(c){
  const active = () => isActive(c);
  const threadInner = () => $('#tinner');
  const scroll = () => { const t = $('#thread'); if (t) t.scrollTop = t.scrollHeight; };
  const append = n => { if (active() && threadInner()){ threadInner().appendChild(n); scroll(); updateFloat(); } };

  const rt = {
    chat: c, agent: state.agent, vault: state.vault,
    isFirst: c.messages.filter(m => m.role === 'user').length <= 1,
    recall: () => state.memory.slice(),
    hasApp: n => state.vault.apps.includes(n),
    hasSecret: n => state.vault.secrets.some(s => s.name === n),
    secretRef: n => { const s = state.vault.secrets.find(s => s.name === n); return s ? s.ref : 'sec_••••'; },
    remember(text, src){ state.memory.unshift({ id: uid(), text, src: src || 'chat', at: Date.now() }); save(); },
    trace(ic, t){
      c.trace = c.trace || []; c.trace.push({ ic, t, at: Date.now() });
      if (active() && state.canvasTab === 'trace') paintCanvas();
      save();
    },
    artifact(a){
      c.artifact = a; state.canvasOpen = true; state.canvasTab = 'canvas';
      const app = $('#app'); if (app) app.classList.remove('nocanvas');
      paintCanvas(); save();
    },
    chips(items){ const m = { id: uid(), kind:'chips', items }; c.messages.push(m); append(msgNode(c, m)); save(); },
    async say(text, opts){
      const m = { id: uid(), role:'agent', kind:'text', text:'', mood:(opts || {}).mood || 'idle' };
      c.messages.push(m);
      if (active()){
        const n = msgNode(c, m); append(n);
        const body = n.querySelector('.md');
        body.innerHTML = '<span class="tdots"><i></i><i></i><i></i></span>';
        await sleep(500);
        for (const tok of text.split(/(\s+)/)){ m.text += tok; body.innerHTML = md(m.text); scroll(); await sleep(16); }
        n.querySelector('.ava').innerHTML = Mascot.svg(state.agent.color, m.mood, 30);
      } else m.text = text;
      save();
    },
    async tools(items){
      const m = { id: uid(), kind:'tools', items: [] }; c.messages.push(m);
      const n = active() ? msgNode(c, m) : null; if (n) append(n);
      for (const it of items){
        m.items.push(it);
        if (n){ n.querySelector('.tools').insertAdjacentHTML('beforeend', tlineHTML(it)); scroll(); }
        rt.trace(it.ic, it.t + (it.d ? ' · ' + it.d : ''));
        await sleep(650);
      }
      save();
    },
    card(data){
      if (!data.status) data.status = 'pending';
      const m = { id: uid(), kind:'card', card: data }; c.messages.push(m);
      const n = active() ? msgNode(c, m) : null; if (n) append(n);
      save();
      const key = wkey(c.id, m.id);
      return {
        msg: m,
        update(fn){ fn(m.card); replaceNode(c, m); save(); },
        wait: () => new Promise(res => { waits[key] = res; }),
        resolve(p){ const f = waits[key]; if (f){ delete waits[key]; f(p); } },
      };
    },
  };
  return rt;
}

function replaceNode(c, m){
  const old = document.querySelector(`[data-mid="${m.id}"]`);
  if (old) old.replaceWith(msgNode(c, m));
  updateFloat();
}

function resolveCard(c, m, payload, status){
  m.card.status = status;
  replaceNode(c, m); save();
  const key = wkey(c.id, m.id);
  const f = waits[key]; if (f){ delete waits[key]; f(payload); }
}

/* ---------------- send / chats ---------------- */
async function sendPrompt(text){
  const c = chat(); if (!c) return;
  let waited = 0;
  while (c.busy && waited < 8000){ await sleep(200); waited += 200; }
  if (c.busy){ toast(`${state.agent.name} is mid-task — one thing at a time.`); return; }
  c.busy = true;
  if (c.messages.filter(m => m.role === 'user').length === 0) c.title = text.length > 42 ? text.slice(0, 42) + '…' : text;
  c.messages.push({ id: uid(), role:'user', kind:'text', text });
  save();
  if (state.view !== 'chat'){ state.view = 'chat'; }
  paintSide(); paintMain();
  const rt = makeRT(c);
  try { await Engine.run(rt, text); }
  catch (e){ console.error(e); await rt.say('Something went wrong on my end — please try again in a moment.'); }
  c.busy = false; save(); paintMain(); paintSide();
}

function runGreet(c){
  c.busy = true; save();
  Engine.greet(makeRT(c)).finally(() => { c.busy = false; save(); });
}

function newChat(){
  const c = { id: uid(), title:'New chat', messages:[], trace:[], artifact:null, createdAt:Date.now() };
  state.chats.unshift(c); state.activeChat = c.id; state.view = 'chat'; save();
  renderApp();
  runGreet(c);
}

/* ---------------- canvas ---------------- */
function paintCanvas(){
  const cv = $('#canvas'); if (!cv) return;
  const c = chat();
  cv.innerHTML = `
    <div class="ctabs">
      <button class="ctab ${state.canvasTab === 'canvas' ? 'on' : ''}" data-act="ctab" data-t="canvas">${icon('panel',14)} Canvas</button>
      <button class="ctab ${state.canvasTab === 'trace' ? 'on' : ''}" data-act="ctab" data-t="trace">${icon('list',14)} Trace <span class="cnt">${(c && c.trace || []).length}</span></button>
    </div>
    <div class="cbody" id="cbody"></div>`;
  const body = $('#cbody');
  if (state.canvasTab === 'trace'){
    body.innerHTML = (c && c.trace && c.trace.length)
      ? `<div class="tools" style="border:none;padding:0">${c.trace.map(t => `<div class="tline">${icon(t.ic,13)}<span>${esc(t.t)}</span></div>`).join('')}</div>`
      : `<div class="cempty">${Mascot.svg(state.agent.color,'think',70,'mascot-bob')}<div class="mut2">Every tool call, guardrail and sub-agent step will appear here.</div></div>`;
    return;
  }
  const a = c && c.artifact;
  if (!a){
    body.innerHTML = `<div class="cempty">${Mascot.svg(state.agent.color,'idle',80,'mascot-bob')}<div style="font-weight:700;margin-top:12px">The canvas</div><div class="mut2">Charts, live pages, diffs and plans I create will render here while we chat.</div></div>`;
    return;
  }
  if (a.kind === 'chart'){
    const max = Math.max.apply(null, a.data.map(d => d.v));
    body.innerHTML = `<div class="chartbox"><div class="ct">${esc(a.title)}</div><div class="cs">n = 1,392 qualifying comments · last 30 days</div>
      <div class="bars">${a.data.map((d, i) => `<div class="bcol"><span class="v">${d.v}%</span><div class="bar" style="height:${Math.round(d.v / max * 100)}%;background:${d.c};animation-delay:${i * 60}ms"></div><span class="l">${esc(d.l)}</span></div>`).join('')}</div>
      <div class="chartfoot">${esc(a.foot)}</div></div>`;
    return;
  }
  if (a.kind === 'html'){
    body.innerHTML = `<div class="arti-head"><b>${esc(a.title)}</b><span class="chip green">live</span></div><div class="arti-frame"><iframe sandbox="allow-scripts" srcdoc="${esc(a.html)}"></iframe></div>`;
    return;
  }
  if (a.kind === 'code'){
    body.innerHTML = `<div class="arti-head"><b>${esc(a.title)}</b><button class="btn ghost tiny" data-act="copycode">${icon('copy',13)} Copy</button></div><div class="codebox" id="codebox">${esc(a.code)}</div>`;
    return;
  }
  if (a.kind === 'plan'){
    body.innerHTML = `<div class="planbox"><div class="ct" style="font-weight:800;margin-bottom:10px">${esc(a.title)}</div><div class="md">${a.items.map(i => `<p>${md(i).replace(/<\/?p>/g,'')}</p>`).join('')}</div></div>`;
    return;
  }
}

/* ---------------- pages ---------------- */
function fileRows(){
  const rows = [];
  state.chats.forEach(c => c.messages.forEach(m => {
    if (m.kind === 'card' && m.card.type === 'file') rows.push({ ...m.card, chat: c.title });
  }));
  return rows;
}

function paintVault(M){
  const v = state.vault;
  const tab = state.vaultTab || 'secrets';
  let body = '';

  if (tab === 'secrets'){
    body = `
    <div class="warnband">${icon('shieldcheck',18)}<div><b>The agent never sees your secrets.</b>Values are masked everywhere in chat and traces; the model receives references like <span class="mono">sec_••••</span> only. Reveal below is for your eyes alone, on this device.</div></div>
    <div class="kv">
      ${v.secrets.map(s => `<div class="row">
        <span style="color:var(--purple)">${icon('lock',16)}</span>
        <div><b class="mono">${esc(s.name)}</b><div class="sub">${esc(s.ref)} · added ${fmtWhen(s.at)}</div></div>
        <div class="rgt">
          <span class="mono mut" data-rev="${s.id}" style="letter-spacing:.08em">${s.revealed ? esc(s.value) : '•••• •••• ••••'}</span>
          <button class="iconbtn" data-act="reveal" data-id="${s.id}" title="Reveal (only you)">${s.revealed ? icon('eyeoff',14) : icon('eye',14)}</button>
          <button class="iconbtn" data-act="delsecret" data-id="${s.id}" title="Delete">${icon('trash',14)}</button>
        </div></div>`).join('') || '<div class="row mut">No secrets yet — the secrets box in chat adds them here.</div>'}
      <div class="row" style="background:var(--panel)">
        <input class="field" id="vname" placeholder="name" style="max-width:170px">
        <input class="field mono" id="vval" type="password" placeholder="value" style="flex:1">
        <button class="btn small" data-act="addsecret">${icon('plus',14)} Add</button>
      </div>
    </div>`;
  } else if (tab === 'apps'){
    body = `<div class="kv">
      ${['github','gmail'].map(a => { const on = v.apps.includes(a); return `<div class="row">
        <span class="tile" style="width:38px;height:38px;border-radius:11px;color:${a === 'github' ? 'var(--ink)' : 'var(--acc)'}">${icon(a === 'github' ? 'git' : 'mail',17)}</span>
        <div><b>${a === 'github' ? 'GitHub' : 'Gmail'}</b><div class="sub">${on ? 'connected · tokens sealed' : 'not connected'}</div></div>
        <div class="rgt"><button class="btn ${on ? 'ghost' : ''} small" data-act="toggleapp" data-app="${a}">${on ? 'Disconnect' : 'Connect'}</button></div></div>`; }).join('')}
    </div>`;
  } else if (tab === 'approved'){
    body = `<div class="kv">
      ${v.approvals.map(a => `<div class="row">
        <span style="color:var(--green)">${icon('check',16)}</span>
        <div><b>${esc(a.label)}</b><div class="sub">always allowed · ${fmtWhen(a.at)}</div></div>
        <div class="rgt"><button class="btn ghost small" data-act="revoke" data-id="${a.id}">Revoke</button></div></div>`).join('') || '<div class="row mut">No always-allow rules. Approvals pause for you each time.</div>'}
      <div class="radio ${v.mode === 'default' ? 'on' : ''}" data-act="pmode" data-m="default"><span class="dot"></span><div><b>Default</b><div class="sub mut">Standard rules — sensitive actions ask first.</div></div>${v.mode === 'default' ? '<span class="chip green" style="margin-left:auto">current</span>' : ''}</div>
      <div class="radio ${v.mode === 'ask' ? 'on' : ''}" data-act="pmode" data-m="ask"><span class="dot"></span><div><b>Ask always</b><div class="sub mut">Confirm before every app and browsing action.</div></div>${v.mode === 'ask' ? '<span class="chip green" style="margin-left:auto">current</span>' : ''}</div>
    </div>`;
  } else {
    const rows = fileRows();
    body = `<div class="kv">${rows.map((f, i) => `<div class="row">
      <span style="color:var(--mut)">${icon('file',16)}</span>
      <div><b>${esc(f.name)}</b><div class="sub">${fmtBytes(f.size || 0)} · from “${esc(f.chat)}”</div></div>
      <div class="rgt"><button class="btn ghost small" data-act="dlfile" data-i="${i}">${icon('down',14)} Download</button></div></div>`).join('') || '<div class="row mut">No files yet — artifacts the agent produces land here.</div>'}</div>`;
  }

  M.innerHTML = `<div class="page"><div class="pageinner">
    <div class="phead"><h1>Vault</h1><span class="chip green">${icon('lock',12)} encrypted at rest</span></div>
    <p class="psub">Secrets, apps, approved actions and your file library — owned by you, never revealed to the agent.</p>
    <div class="seg">
      <button class="${tab === 'apps' ? 'on' : ''}" data-act="vtab" data-t="apps">${icon('box',14)} Apps</button>
      <button class="${tab === 'secrets' ? 'on' : ''}" data-act="vtab" data-t="secrets">${icon('key',14)} Secrets</button>
      <button class="${tab === 'approved' ? 'on' : ''}" data-act="vtab" data-t="approved">${icon('shieldcheck',14)} Approved</button>
      <button class="${tab === 'library' ? 'on' : ''}" data-act="vtab" data-t="library">${icon('file',14)} Library</button>
    </div>
    ${body}
  </div></div>`;
  window.__fileRows = fileRows();
}


function paintMemory(M){
  M.innerHTML = `<div class="page"><div class="pageinner">
    <div class="phead"><h1>Memory</h1><span class="chip purple">${icon('book',12)} ${state.memory.length} stored</span></div>
    <p class="psub">What ${esc(state.agent.name)} remembers across chats. Delete anything, anytime.</p>
    <div class="kv">${state.memory.map(m => `<div class="row">
      <span style="color:var(--purple)">${icon('book',16)}</span>
      <div><b style="font-weight:600">${esc(m.text)}</b><div class="sub">${esc(m.src)} · ${fmtWhen(m.at)}</div></div>
      <div class="rgt"><button class="iconbtn" data-act="delmem" data-id="${m.id}">${icon('trash',14)}</button></div></div>`).join('') || '<div class="row mut">Nothing remembered yet.</div>'}</div>
  </div></div>`;
}

function paintProfile(M){
  const a = state.agent;
  M.innerHTML = `<div class="page"><div class="pageinner">
    <div class="phead"><h1>Profile</h1><span class="chip acc">${icon('spark',12)} claimed by you</span></div>
    <p class="psub">One agent, one person. Rename or restyle any time — it stays yours.</p>
    <div class="profiletop">
      <div id="pmascot">${Mascot.svg(a.color,'happy',110,'mascot-bob')}</div>
      <div class="info">
        <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap">
          <input class="field" id="pname" value="${esc(a.name)}" maxlength="18" style="max-width:220px;font-weight:700">
          <span class="chip green">${icon('check',12)} claimed ${new Date(a.claimedAt).toLocaleDateString()}</span>
        </div>
        <div class="swatches" style="justify-content:flex-start;margin-top:16px">${Mascot.keys.map(k => `<button class="swatch ${k === a.color ? 'on' : ''}" data-act="p-color" data-c="${k}"><span style="width:26px;height:26px;border-radius:50%;background:${Mascot.PALETTE[k].body};display:block"></span></button>`).join('')}</div>
        <div class="persrow" style="justify-content:flex-start">${PERS.map(p => `<button class="pers ${p === a.pers ? 'on' : ''}" data-act="p-pers" data-p="${p}">${p}</button>`).join('')}</div>
      </div>
    </div>
    <div class="psec"><h3 style="color:var(--acc)">${icon('alert',15)} Danger zone</h3>
      <div class="kv"><div class="row"><div><b>Release this agent</b><div class="sub">Deletes chats, vault, memory and the claim on this device.</div></div>
      <div class="rgt"><button class="btn soft small" data-act="reset">Release</button></div></div></div>
    </div>
  </div></div>`;
  $('#pname').addEventListener('change', e => {
    const v = e.target.value.trim(); if (!v) return;
    state.agent.name = v; save(); paintSide(); toast('Renamed — they answer to ' + v + ' now.');
  });
}

/* ================================================================
   GLOBAL EVENTS
================================================================ */
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const c = state.chats.find(x => x.id === b.dataset.chat);
  const m = c && c.messages.find(x => x.id === b.dataset.msg);

  if (act === 'mic'){ toast('Voice input is coming soon.'); return; }
  if (act === 'model'){ state.model = state.model === 'Smart' ? 'Fast' : 'Smart'; save(); b.innerHTML = icon('star',13) + ' ' + state.model + ' ▾'; toast('Model: ' + state.model); return; }
  if (act === 'scroll'){ const t = $(b.dataset.t); if (t) t.scrollIntoView({ behavior:'smooth' }); return; }
  if (act === 'open-app'){ state.onboarded ? renderApp() : openOnboarding(); return; }
  if (act === 'claim'){ openOnboarding(); return; }
  if (act === 'skip-claim'){
    ob = { step:0, name:'Sigge', color:'lingon', pers:'Playful' };
    finalizeOnboarding(); return;
  }

  /* onboarding */
  if (act === 'ob-claim'){ confetti(); ob.step = 1; obStep(); return; }
  if (act === 'ob-dice'){ ob.name = NAMES[Math.floor(Math.random() * NAMES.length)]; $('#obname').value = ob.name; return; }
  if (act === 'ob-back'){ ob.step = Math.max(0, ob.step - 1); obStep(); return; }
  if (act === 'ob-next'){
    if (ob.step === 1){ const v = $('#obname').value.trim(); ob.name = v || ob.name || NAMES[0]; }
    ob.step++; obStep(); return;
  }
  if (act === 'ob-color'){ ob.color = b.dataset.c; obStep(); return; }
  if (act === 'ob-pers'){ ob.pers = b.dataset.p; obStep(); return; }
  if (act === 'ob-done'){ finalizeOnboarding(); return; }

  /* navigation */
  if (act === 'nav'){ state.view = b.dataset.view; save(); renderApp(); return; }
  if (act === 'newchat'){ newChat(); return; }
  if (act === 'openchat'){ state.activeChat = b.dataset.id; state.view = 'chat'; save(); renderApp(); return; }
  if (act === 'delchat'){
    e.stopPropagation();
    state.chats = state.chats.filter(x => x.id !== b.dataset.id);
    if (state.activeChat === b.dataset.id) state.activeChat = state.chats[0] ? state.chats[0].id : null;
    save(); renderApp(); return;
  }
  if (act === 'togglecanvas'){ state.canvasOpen = !state.canvasOpen; save(); $('#app').classList.toggle('nocanvas', !state.canvasOpen); paintCanvas(); return; }
  if (act === 'ctab'){ state.canvasTab = b.dataset.t; paintCanvas(); return; }
  if (act === 'viewcanvas'){ state.canvasOpen = true; state.canvasTab = 'canvas'; $('#app') && $('#app').classList.remove('nocanvas'); paintCanvas(); return; }
  if (act === 'openbrowser'){ toast('For safety, browsing stays contained in the sandbox window above.'); return; }
  if (act === 'artmenu'){ toast('Artifact saved — find it in Vault → Library.'); return; }
  if (act === 'chip'){ sendPrompt(b.dataset.t); return; }
  if (act === 'copycode'){ const t = $('#codebox'); if (t) navigator.clipboard && navigator.clipboard.writeText(t.textContent); toast('Copied'); return; }

  /* card resolutions */
  if (act === 'approve' && m){ resolveCard(c, m, { ok:true }, 'approved'); return; }
  if (act === 'deny' && m){ resolveCard(c, m, { ok:false }, 'denied'); return; }
  if (act === 'always' && m){
    state.vault.approvals.push({ id: uid(), key: m.card.key, label: m.card.title, at: Date.now() });
    save(); resolveCard(c, m, { ok:true, always:true }, 'always'); return;
  }
  if (act === 'connect' && m){
    m.card.status = 'connecting'; replaceNode(c, m);
    await sleep(900);
    if (!state.vault.apps.includes(m.card.app)) state.vault.apps.push(m.card.app);
    resolveCard(c, m, { ok:true }, 'connected'); paintSide(); return;
  }
  if (act === 'deny-connect' && m){ resolveCard(c, m, { ok:false }, 'denied'); return; }
  if (act === 'skip-secret' && m){ resolveCard(c, m, { ok:false }, 'skipped'); return; }
  if (act === 'save-secret' && m){
    const node = document.querySelector(`[data-mid="${m.id}"]`);
    const name = (node.querySelector('[data-f="name"]').value || '').trim();
    const val = node.querySelector('[data-f="val"]').value;
    if (!name || !val){ toast('Give the secret a name and a value first.'); return; }
    const ref = 'sec_' + uid().slice(0, 4);
    state.vault.secrets.push({ id: ref, ref, name, value: val, at: Date.now() });
    m.card.ref = ref; m.card.nameVal = name;
    save(); resolveCard(c, m, { ok:true }, 'saved'); paintSide(); return;
  }
  if (act === 'qopt' && m){ m.card.choice = b.dataset.o; resolveCard(c, m, { choice: b.dataset.o }, 'answered'); return; }
  if (act === 'download' && m){ dl(m.card.name, m.card.content); return; }

  /* vault page */
  if (act === 'vtab'){ state.vaultTab = b.dataset.t; paintVault($('#main')); return; }
  if (act === 'reveal'){ const s = state.vault.secrets.find(x => x.id === b.dataset.id); s.revealed = !s.revealed; paintVault($('#main')); return; }
  if (act === 'delsecret'){ state.vault.secrets = state.vault.secrets.filter(x => x.id !== b.dataset.id); save(); paintVault($('#main')); paintSide(); toast('Secret deleted'); return; }
  if (act === 'addsecret'){
    const n = $('#vname').value.trim(), v = $('#vval').value;
    if (!n || !v){ toast('Name and value required.'); return; }
    const ref = 'sec_' + uid().slice(0, 4);
    state.vault.secrets.push({ id: ref, ref, name: n, value: v, at: Date.now() });
    save(); paintVault($('#main')); paintSide(); toast('Sealed in vault — agent gets ' + ref + ' only'); return;
  }
  if (act === 'toggleapp'){
    const a = b.dataset.app;
    state.vault.apps = state.vault.apps.includes(a) ? state.vault.apps.filter(x => x !== a) : state.vault.apps.concat(a);
    save(); paintVault($('#main')); paintSide(); return;
  }
  if (act === 'revoke'){ state.vault.approvals = state.vault.approvals.filter(x => x.id !== b.dataset.id); save(); paintVault($('#main')); toast('Revoked — it will ask again'); return; }
  if (act === 'pmode'){ state.vault.mode = b.dataset.m; save(); paintVault($('#main')); return; }
  if (act === 'delmem'){ state.memory = state.memory.filter(x => x.id !== b.dataset.id); save(); paintMemory($('#main')); paintSide(); return; }
  if (act === 'dlfile'){ const f = window.__fileRows && window.__fileRows[+b.dataset.i]; if (f) dl(f.name, f.content); return; }

  /* profile */
  if (act === 'p-color'){ state.agent.color = b.dataset.c; save(); paintProfile($('#main')); paintSide(); return; }
  if (act === 'p-pers'){ state.agent.pers = b.dataset.p; save(); paintProfile($('#main')); return; }
  if (act === 'reset'){
    if (confirm('Release this agent? This deletes the claim, chats, vault and memory on this device.')){
      localStorage.removeItem(LS); location.reload();
    }
    return;
  }
});

function dl(name, content){
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([content || ''], { type:'text/plain' }));
  a.download = name; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
  toast('Downloading ' + name);
}

/* ---------------- boot ---------------- */
expirePending();
if (state.onboarded && state.agent) renderApp(); else renderLanding();
})();
