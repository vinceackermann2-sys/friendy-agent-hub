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
  phone:'<path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 2 .7 2.9a2 2 0 0 1-.5 2.1L8.1 10a16 16 0 0 0 6 6l1.3-1.2a2 2 0 0 1 2.1-.5c.9.3 1.9.6 2.9.7a2 2 0 0 1 1.6 2Z"/>',
  wallet:'<path d="M20 7H4a2 2 0 0 1 0-4h14v4"/><path d="M20 7a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5"/><circle cx="17" cy="14" r="1.2"/>',
  laptop:'<rect x="2" y="4" width="20" height="12" rx="2"/><path d="M2 20h20"/>',
  brief:'<rect x="2" y="7" width="20" height="14" rx="2"/><path d="M16 7V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v2M2 13h20"/>',
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
  board:'<rect x="3" y="5" width="18" height="14" rx="2"/><circle cx="9" cy="10" r="1.6"/><path d="M21 15l-5-5-9 9"/>',
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
  ownerId:null,
  canvasOpen:false, canvasTab:'canvas', model:'Smart', theme:'grey',
  chats:[], pendingPrompt:null,
  vault:{ secrets:[], apps:[], approvals:[], mode:'default' },
  memory:[],
  // right-side canvas slider: canvasTab 'agent' shows the agent panel;
  // agentTab picks its content: 'appearance' | 'approvals' | 'library'
  agentTab:'appearance',
  // settings / apps rework
  settingsTab:'profiles', userMenuOpen:false,
  userProfile:null, browserProfile:{ profile:'Default', sandbox:true, allowlist:true },
});
let state;
try { state = Object.assign(fresh(), JSON.parse(localStorage.getItem(LS) || 'null')) || fresh(); }
catch (e) { state = fresh(); }
if (!state.vault) state.vault = fresh().vault;
// Canvas is never open by default — user or a fresh artifact opens it.
state.canvasOpen = false;
if (!state.agentTab) state.agentTab = 'appearance';
if (state.agentPanel) state.canvasTab = 'agent';
delete state.agentPanel;
if (!['agent', 'canvas', 'live', 'trace'].includes(state.canvasTab)) state.canvasTab = 'canvas';
if (!state.settingsTab) state.settingsTab = 'profiles';
if (!state.browserProfile) state.browserProfile = fresh().browserProfile;
// Honest apps: no fake OAuth connections exist — always empty.
state.vault.apps = [];
const save = () => localStorage.setItem(LS, JSON.stringify(state));

/* ---------------- backend-synced memory/vault (auth-scoped) ---------------- */
async function syncFromBackend() {
  if (!window.LingonAuth || !window.LingonAuth.signedIn()) return;
  try {
    const m = await window.LingonAuth.api('/api/memories');
    const seen = new Set(state.memory.map((x) => x.text));
    (m.memories || []).forEach((r) => {
      if (!seen.has(r.text)) state.memory.unshift({ id: r.id, text: r.text, src: 'account', at: r.at });
    });
  } catch {}
  try {
    const s = await window.LingonAuth.api('/api/secrets');
    const have = new Set(state.vault.secrets.map((x) => x.id));
    (s.secrets || []).forEach((r) => {
      if (!have.has(r.id)) state.vault.secrets.unshift({ id: r.id, ref: r.ref, name: r.name, at: r.at, backend: true });
    });
  } catch {}
  save();
}

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

/* ---------------- real-account guards (no fake/demo accounts) ----------------
   The agent (Engine.run / /api/*) only ever runs for a verified Supabase
   session. Local `lingon.v1` state is scoped per ownerId so one device never
   leaks chats/agents between real accounts, and no code path can claim or
   chat without a signed-in user. */
const signedIn = () => !!(window.LingonAuth && window.LingonAuth.signedIn());
const currentUserId = () => {
  try { return (window.LingonAuth && window.LingonAuth.get() && window.LingonAuth.get().user && window.LingonAuth.get().user.id) || null; }
  catch { return null; }
};
function ensureOwnerScope(){
  const uid = currentUserId();
  if (!uid) return;
  if (!state.ownerId){ state.ownerId = uid; save(); return; }
  if (state.ownerId !== uid){
    const theme = state.theme;
    const pending = state.pendingPrompt;
    state = Object.assign(fresh(), { theme, pendingPrompt: pending || null, ownerId: uid });
    save();
  }
}

function render(){
  applyTheme();
  if (!signedIn()) return renderAuth();
  ensureOwnerScope();
  if (state.onboarded && state.agent && !state.agent.provisional) return renderApp();
  if (state.pendingPrompt && (!state.onboarded || !state.agent || (state.agent && state.agent.provisional))){
    // Signed-in with a saved homepage prompt: message goes to the agent chat
    // first, then in-chat onboarding runs before the agent starts the task.
    startPendingPromptFlow();
    return;
  }
  if (state.onboarded && state.agent) return renderApp();
  return renderLanding();
}

/* ================================================================
   AUTH (real Supabase Auth via backend proxy)
================================================================ */
/* ================================================================
   AUTH — Account & Credit Usage card: Google, one-time code, password
================================================================ */
let authMode = 'signin'; // 'signin' | 'signup'
function renderAuth(){
  let lastGoogle = false;
  try { lastGoogle = localStorage.getItem('belna.lastProvider') === 'google'; } catch {}
  root.innerHTML = `
  <div class="fadeup authpage">
    <div class="auth-top"><span>Account &amp; Credit Usage</span><a href="pricing.html">Open Docs &#8599;</a></div>
    <div class="authcard">
      <h1>${state.pendingPrompt ? 'Sign up / log in to send it to your agent' : 'Log in to manage profile and billing'}</h1>
      ${state.pendingPrompt ? `<div class="kv" style="margin-top:16px;text-align:left"><div class="row"><span style="color:var(--mut)">${icon('chatb',16)}</span><div><b style="font-weight:600">${esc(state.pendingPrompt.length > 140 ? state.pendingPrompt.slice(0, 140) + '…' : state.pendingPrompt)}</b><div class="sub">Your message is saved — it will appear in the agent chat right after you sign in, before anything runs.</div></div></div></div>` : ''}
      <button class="btn gbtn" data-act="google"><span class="glogo" aria-hidden="true"><svg width="20" height="20" viewBox="0 0 48 48"><path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/><path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/><path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/><path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg></span>Continue with Google${lastGoogle ? '<span class="lastused">Last used</span>' : ''}</button>
      <div class="ordiv"><span></span>OR<span></span></div>
      <div id="authmain">
        <input class="field authfield" id="aemail" type="email" placeholder="Enter Email" autocomplete="email">
        <button class="btn authbtn" data-act="otp-send">Login with one-time code</button>
        <button class="btn ghost authbtn" data-act="pw-mode">Log in with password</button>
      </div>
      <div id="authotp" style="display:none">
        <p class="mut" style="font-size:14px;line-height:1.55">We sent a 6-digit code to <b id="otpemail"></b>.<br>It expires in a few minutes.</p>
        <input class="field authfield mono" id="acode" inputmode="numeric" autocomplete="one-time-code" maxlength="8" placeholder="123456" style="text-align:center;letter-spacing:.3em;margin-top:12px">
        <button class="btn authbtn" data-act="otp-verify">Verify code</button>
        <button class="btn ghost authbtn" data-act="auth-back">Back</button>
      </div>
      <div id="authpw" style="display:none">
        <div class="pwtitle" id="pwtitle">Welcome back</div>
        <div class="mut" style="font-size:13px;margin-top:2px" id="pwemail"></div>
        <input class="field authfield mono" id="apass" type="password" placeholder="Password (8+ chars)" autocomplete="current-password" style="margin-top:12px">
        <button class="btn authbtn" id="pwgo" data-act="pw-go">Log in with password</button>
        <button class="btn ghost authbtn" data-act="auth-back">Back</button>
      </div>
      <div class="secnote" id="amsg" style="min-height:18px;justify-content:center;margin-top:14px"></div>
      <div class="authfoot" id="authfoot">New to Belna? <button data-act="auth-mode">Create an account</button></div>
      <div><button class="backlink" data-act="back-home">← Back to home</button></div>
    </div>
  </div>`;
  authPaintMode();
  paintGoogleState();
  // Surface OAuth callback errors (?auth_error=…) inline when we land back here.
  try {
    const q = new URLSearchParams(window.location.search);
    const err = q.get('auth_error');
    if (err) {
      const m = document.getElementById('amsg');
      if (m) m.textContent = 'Sign-in failed: ' + err;
      window.history.replaceState(null, '', window.location.pathname);
    }
  } catch {}
}
function showAuthPane(id){
  ['authmain', 'authotp', 'authpw'].forEach(p => { const n = document.getElementById(p); if (n) n.style.display = p === id ? '' : 'none'; });
  const m = document.getElementById('amsg'); if (m) m.textContent = '';
}
function authPaintMode(){
  const go = document.getElementById('pwgo');
  const title = document.getElementById('pwtitle');
  const foot = document.getElementById('authfoot');
  if (authMode === 'signup'){
    if (go) go.textContent = 'Create account';
    if (title) title.textContent = 'Create your Belna account';
    if (foot) foot.innerHTML = 'Have an account? <button data-act="auth-mode">Log in</button>';
  } else {
    if (go) go.textContent = 'Log in with password';
    if (title) title.textContent = 'Welcome back';
    if (foot) foot.innerHTML = 'New to Belna? <button data-act="auth-mode">Create an account</button>';
  }
}
async function authOAuth(){
  const msg = document.getElementById('amsg');
  const btn = document.querySelector('[data-act="google"]');
  if (btn) btn.disabled = true;
  if (msg) msg.textContent = 'Redirecting to Google…';
  try {
    const r = await fetch('/api/auth/oauth-url?provider=google&next=' + encodeURIComponent('/'));
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'Google sign-in unavailable');
    if (!j.url) throw new Error('Google sign-in unavailable — no redirect URL.');
    window.location.href = j.url;
  } catch (e){
    if (btn) btn.disabled = false;
    if (msg) msg.textContent = e.message === 'Google sign-in is not configured.'
      ? 'Google sign-in is not enabled on this server yet (missing GOOGLE_CLIENT_ID). Use a one-time code or password instead.'
      : (e.message || 'Google sign-in unavailable');
  }
}
// Probe whether Google OAuth is configured so the button can explain itself
// instead of failing silently. Non-fatal — button stays clickable as fallback.
async function paintGoogleState(){
  try {
    const r = await fetch('/api/health');
    const j = await r.json().catch(() => ({}));
    const btn = document.querySelector('[data-act="google"]');
    if (!btn) return;
    if (j && j.google === false) {
      btn.title = 'Google sign-in is not enabled on this server yet';
    } else if (j && j.google === true) {
      btn.title = 'Continue with Google';
    }
  } catch {}
}
async function authOtpSend(){
  const msg = document.getElementById('amsg');
  const email = ((document.getElementById('aemail') || {}).value || '').trim();
  if (!/.+@.+\..+/.test(email)){ if (msg) msg.textContent = 'Enter a valid email first.'; return; }
  if (msg) msg.textContent = 'Sending code…';
  try {
    const r = await fetch('/api/auth/otp', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ email }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Could not send code');
    document.getElementById('otpemail').textContent = email;
    showAuthPane('authotp');
    document.getElementById('acode').focus();
  } catch (e){ if (msg) msg.textContent = e.message; }
}
async function authOtpVerify(){
  const msg = document.getElementById('amsg');
  const email = ((document.getElementById('aemail') || {}).value || '').trim();
  const token = ((document.getElementById('acode') || {}).value || '').trim();
  if (!token){ if (msg) msg.textContent = 'Enter the code from your email.'; return; }
  if (msg) msg.textContent = 'Verifying…';
  try {
    const r = await fetch('/api/auth/verify', { method:'POST', headers:{ 'Content-Type':'application/json' }, body: JSON.stringify({ email, token }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Invalid code');
    window.LingonAuth.set({ access_token: j.access_token, refresh_token: j.refresh_token, user: j.user });
    try { window.LingonConfig.userId = j.user.id; localStorage.setItem('belna.lastProvider', 'otp'); } catch {}
    await afterSignIn(j.user);
  } catch (e){ if (msg) msg.textContent = e.message; }
}

async function doAuth(kind){
  const msg = $('#amsg');
  const email = ($('#aemail').value || '').trim();
  const password = $('#apass').value || '';
  if (msg) msg.textContent = 'Working…';
  try {
    const r = await fetch('/api/auth/' + kind, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email, password }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error || 'Auth failed');
    window.LingonAuth.set({ access_token: j.access_token, refresh_token: j.refresh_token, user: j.user });
    try { window.LingonConfig.userId = j.user.id; } catch {}
    await afterSignIn(j.user);
  } catch (e) {
    if (msg) msg.textContent = e.message;
  }
}

/* Central post-auth routing (real accounts only).
   - Scopes local state to the signed-in user (no cross-account leakage).
   - If a homepage prompt is pending and the account is new (not onboarded),
     the message is placed into the agent chat FIRST, then in-chat onboarding
     (name / appearance / personality) runs BEFORE the agent starts the task.
   - Otherwise normal render. */
async function afterSignIn(user){
  try {
    ensureOwnerScope();
    if (user && user.id && state.ownerId !== user.id){ state.ownerId = user.id; }
    state.view = 'chat';
    save();
    await syncFromBackend();
    if (state.pendingPrompt && (!state.onboarded || !state.agent || state.agent.provisional)){
      const p = state.pendingPrompt;
      toast('Signed in as ' + (user.email || 'you'));
      await startPendingPromptFlow(p);
      return;
    }
    render();
    toast('Signed in as ' + (user.email || 'you'));
  } catch (e){
    console.error(e);
    render();
  }
}

/* ================================================================
   BILLING (real credits + gifts, no fake charges)
================================================================ */
let billingCache = null;
async function getBilling(){
  if (!window.LingonAuth.signedIn()) return null;
  try {
    billingCache = await window.LingonAuth.api('/api/billing');
    return billingCache;
  } catch { return billingCache; }
}
function fmtC(n){ return (Math.round(Number(n || 0) * 100) / 100).toString(); }
function planCards(b){
  const ids = ['free', 'pro', 'max'];
  const list = Array.isArray(b && b.plans) ? b.plans : ids.map((id) => (b && b.plans && b.plans[id]) || { id, name: id });
  const byId = {};
  list.forEach((p) => { if (p && p.id) byId[p.id] = p; });
  return ids.map((id) => {
    const p = byId[id] || { name: id, price: 0, was: null, credits: 0, giftUsd: 0 };
    const cur = b && b.plan === id;
    const per = p.interval === 'month' ? '/mo' : '';
    const giftTxt = p.giftUsd ? ` + $${p.giftUsd} gift card` : '';
    const btn = cur
      ? '<span class="chip green">current</span>'
      : id === 'free'
        ? '<span class="chip">default</span>'
        : `<button class="btn small" data-act="checkout" data-p="${id}">Get ${esc(p.name)}</button>`;
    return `<div class="row"><div><b>${esc(p.name)}</b> — $${p.price}${per}${p.was ? ` <s class="mut">$${p.was}</s>` : ''}<div class="sub">${fmtC(p.credits)} credits${per === '/mo' ? ' monthly' : ''}${giftTxt}</div></div>
    <div class="rgt">${btn}</div></div>`;
  }).join('');
}
function billSummary(b){
  const manage = b && b.plan !== 'free'
    ? ` <button class="btn ghost small" data-act="portal" style="margin-left:8px">Manage subscription</button>`
    : '';
  return `<div class="kv"><div class="row">
      <span style="color:var(--mut)">${icon('spark',16)}</span>
      <div><b>${esc((b.plan || 'free').toUpperCase())}</b> · ${esc(b.status || '')}<div class="sub">${fmtC(b.creditsUsed)} of ${fmtC(b.creditsGranted)} credits used</div></div>
      <div class="rgt"><span class="chip ${Number(b.credits) > 5 ? 'green' : ''}">${fmtC(b.credits)} credits left</span>${manage}</div>
    </div></div>`;
}
function paintBilling(M){
  M.innerHTML = `<div class="page"><div class="pageinner">
    <div class="phead"><h1>Billing</h1><span class="chip">credits</span></div>
    <p class="psub">Free starts with <b>20 credits</b>. Pro <b>$30/mo</b> → 60 credits monthly + $50 gift card. Max <b>$50/mo</b> → 100 credits monthly + $100 gift card. Gift codes add credits when redeemed.</p>
    <div id="billbody"><div class="row mut">Loading…</div></div>
    <div class="kv" style="margin-top:14px"><div class="row" style="background:var(--panel)">
      <input class="field mono" id="giftcode" placeholder="LNG-XXXX-XXXX-XXXX" style="flex:1">
      <button class="btn small" data-act="redeem">Redeem gift</button>
    </div></div>
    <div class="kv" id="plancards" style="margin-top:14px"></div>
  </div></div>`;
  getBilling().then((b) => {
    const el = $('#billbody');
    if (el && b) el.innerHTML = billSummary(b);
    const pc = $('#plancards');
    if (pc && b) pc.innerHTML = planCards(b);
  });
}

/* ================================================================
   LANDING
================================================================ */
/* Belna landing — mascot prop loop (briefcase / laptop / phone / wallet).
   The mascot sits in a circle card inside the headline and auto-loops the
   item it holds — no manual pills/dots. The prop badge overlaps the mascot
   like an object held in front, with a pop on every switch. */
const BELNA_ACTS = [
  { ic:'brief',  label:'holding a briefcase', mood:'idle' },
  { ic:'laptop', label:'holding a laptop', mood:'think' },
  { ic:'phone',  label:'answering phones', mood:'happy' },
  { ic:'wallet', label:'counting wallet', mood:'wow' },
];
/* Typewriter examples for the hero prompt box. */
const BELNA_PROMPTS = [
  'Ask Belna to do my taxes...',
  'Ask Belna to organize my schedule...',
  'Ask Belna to plan my move to Gothenburg...',
  'Ask Belna to research anything with sources...',
  'Ask Belna to build me a landing page...',
];
function belnaStopRotator(){ if (window.__actTimer){ clearInterval(window.__actTimer); window.__actTimer = null; } }
function belnaStopTypewriter(){ if (window.__typeTimer){ clearTimeout(window.__typeTimer); window.__typeTimer = null; } }
function belnaStopLandingFx(){ belnaStopRotator(); belnaStopTypewriter(); }
function belnaPaintHold(i){
  const a = BELNA_ACTS[i % BELNA_ACTS.length];
  const core = document.getElementById('mcore');
  const prop = document.getElementById('hprop');
  const hold = document.getElementById('mhold');
  if (!core || !prop) return;
  core.innerHTML = Mascot.svg('lingon', a.mood, 44);
  prop.innerHTML = icon(a.ic, 16);
  if (hold){
    hold.title = 'Your Belna agent, ' + a.label;
    hold.setAttribute('aria-label', 'Your Belna agent, ' + a.label);
    hold.classList.remove('swap');
    void hold.offsetWidth;
    hold.classList.add('swap');
  }
}
function belnaStartRotator(){
  belnaStopRotator();
  let i = 1;
  belnaPaintHold(0);
  window.__actTimer = setInterval(() => { belnaPaintHold(i % BELNA_ACTS.length); i++; }, 2400);
}
function belnaStartTypewriter(){
  belnaStopTypewriter();
  const ta = document.getElementById('lprompt');
  const ta2 = document.getElementById('lprompt2');
  if (!ta && !ta2) return;
  const CARET = '▏';
  let pi = 0, ci = 0, del = false;
  const setPh = txt => {
    if (ta && document.activeElement !== ta && !ta.value) ta.placeholder = txt;
    if (ta2 && document.activeElement !== ta2 && !ta2.value) ta2.placeholder = txt;
  };
  const tick = () => {
    // Pause while the user focuses either box; resume once they leave it empty.
    if ((ta && document.activeElement === ta) || (ta2 && document.activeElement === ta2)) {
      window.__typeTimer = setTimeout(tick, 1200);
      return;
    }
    const full = BELNA_PROMPTS[pi % BELNA_PROMPTS.length];
    if (!del){
      ci++;
      setPh(full.slice(0, ci) + (ci < full.length ? CARET : ''));
      if (ci >= full.length){ del = true; window.__typeTimer = setTimeout(tick, 1700); return; }
      window.__typeTimer = setTimeout(tick, 34 + Math.random() * 46);
    } else {
      ci--;
      setPh(full.slice(0, Math.max(ci, 0)) + CARET);
      if (ci <= 0){ del = false; pi++; window.__typeTimer = setTimeout(tick, 380); return; }
      window.__typeTimer = setTimeout(tick, 15);
    }
  };
  setPh(CARET);
  window.__typeTimer = setTimeout(tick, 550);
}

function renderLanding(){
  root.innerHTML = `
  <div class="fadeup">
    <div class="anav"><nav class="nav">
      <a class="abrand" href="#" data-act="top">${Mascot.logo(26)} belna</a>
      <div class="navlinks"><a href="#agent" data-act="scroll" data-t="#agent">Product</a><a href="models.html">Models</a><a href="pricing.html">Pricing</a></div>
      <div class="anav-cta">
        <button class="btn ghost small hideS" data-act="signin-nav">Sign in</button>
        <button class="btn small" data-act="open-app">Get started</button>
      </div>
    </nav></div>

    <header class="hero ahero">
      <h1>Bring anything <span class="mhold" id="mhold"><span class="mcore" id="mcore">${Mascot.svg('lingon','think',44)}</span><span class="hprop" id="hprop">${icon('laptop',16)}</span></span> to life.</h1>
      <div class="safe-note" style="margin-top:18px">Your personal AI agent</div>
      <div class="promptwrap">
        <form class="promptbox" id="lform">
          <textarea id="lprompt" rows="2" placeholder="Ask Belna to do my taxes..."></textarea>
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
    </header>

    <section class="asection" id="safety" aria-label="Safe Swedish AI">
      <h2>Safe Swedish AI</h2>
      <div class="split">
        <div>
          <p class="lede">Arche 1.0 is built on the open source Kimi K3 model, with an Agentic harness optimized for privacy and safety.</p>
          <div style="display:flex;gap:10px;margin-top:22px;flex-wrap:wrap">
            <button class="btn small" data-act="open-app">${icon('spark',14)} Get started</button>
            <a class="btn ghost small" href="models.html">Explore models</a>
          </div>
        </div>
        <div class="panel model-card">
          <div class="mc-head">
            <span class="mc-brand">${Mascot.logo(28)}<span><b>Arche 1.0</b><i>by Belna · Safe Swedish AI</i></span></span>
            <span class="chip green">real benchmarks</span>
          </div>
          <div class="mc-title">Arche 1.0 vs frontier models</div>
          <p class="mut mc-sub">Kimi K3 open weights inside the Belna harness — same scores, plus privacy.</p>
          <div class="mc-table"><table class="btable">
            <thead><tr><th>Benchmark</th><th class="star">Arche 1.0</th><th>GPT-5.6 Sol</th><th>Claude Fable 5</th><th>Claude Opus 4.8</th></tr></thead>
            <tbody>
              <tr><td>GPQA Diamond</td><td class="star">93.5</td><td><b>94.1</b></td><td>92.6</td><td>91.0</td></tr>
              <tr><td>Terminal-Bench 2.1</td><td class="star">88.3</td><td><b>88.8</b></td><td>88.0</td><td>84.6</td></tr>
              <tr><td>BrowseComp</td><td class="star"><b>91.2</b></td><td>90.4</td><td>88.0</td><td>84.3</td></tr>
              <tr><td>OSWorld-Verified</td><td class="star">84.8</td><td>83.0</td><td><b>85.0</b></td><td>83.4</td></tr>
              <tr><td>SWE-Marathon</td><td class="star"><b>42.0</b></td><td>39.0</td><td>35.0</td><td>40.0</td></tr>
            </tbody>
          </table></div>
          <p class="fineprint mc-foot">Scores: Moonshot AI Kimi K3 technical results (max reasoning effort); competitor scores as reported in the same release. Full table on the <a href="models.html">models page</a>.</p>
        </div>
      </div>
    </section>

    <section class="asection" id="agent" aria-label="Your personal AI Agent">
      <h2>Your personal AI Agent.</h2>
      <div class="split">
        <div>
          <p class="lede">If you can think it, your Agent can make it real life.</p>
          <div style="display:flex;gap:10px;margin-top:22px;flex-wrap:wrap">
            <button class="btn small" data-act="open-app">${icon('spark',14)} Claim your agent</button>
            <button class="btn ghost small" data-act="scroll" data-t="#cta">Try a prompt</button>
          </div>
        </div>
        <div class="panel">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">${Mascot.svg('lingon','happy',34)}<div><b>Example from inside the app</b><div class="mut" style="font-size:12.5px">Your agent, working for real</div></div></div>
          <div class="mockchat">
            <div class="mbub u">Plan my move to Gothenburg next month — movers, addresses, budget</div>
            <div class="mbub a"><b>Your agent</b>Done. Moving checklist with dates, 3 movers compared on price, address-change drafts, and a budget table — all on your canvas. Nothing sent without your yes.</div>
            <div class="mbub u">Also remind me to water the plants?</div>
            <div class="mbub a"><b>Your agent</b>Remembered. I'll nudge you every Sunday evening.</div>
          </div>
          <div class="chipsrow"><span class="chip">Research</span><span class="chip">Build</span><span class="chip">Remember</span></div>
        </div>
      </div>
    </section>

    <section class="cta2" id="cta" aria-label="Start">
      <div class="kicker" style="font-size:12.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--acc)">Start now</div>
      <h2>What do you want to do?</h2>
      <div class="promptwrap">
        <form class="promptbox" id="lform2">
          <textarea id="lprompt2" rows="2" placeholder="Tell your agent… e.g. Plan my week, build me a page, research a topic"></textarea>
          <div class="pb-row">
            <span class="iconbtn" style="cursor:default">${icon('plus',17)}</span>
            <span style="display:flex;gap:10px;align-items:center">
              <button type="button" class="modelchip">${icon('star',14)} Smart ▾</button>
              <button type="submit" class="micbtn" style="background:var(--ink)" title="Send">${icon('up',17)}</button>
            </span>
          </div>
        </form>
      </div>
    </section>

    <footer class="afooter"><div class="fin">
      <div><div class="abrand">${Mascot.logo(24)} belna</div><p class="mut" style="font-size:13.5px;margin-top:10px;line-height:1.6">Swedish Safe AI Agents.<br>Arche 1.0 · Kimi K3 + safety harness.</p></div>
      <div><h4>Product</h4><a href="#safety">Safe Swedish AI</a><a href="#agent">Personal Agent</a><a href="models.html">Models</a><a href="pricing.html">Pricing</a></div>
      <div><h4>Company</h4><a href="#" data-act="open-app">Get started</a><a href="#" data-act="signin-nav">Sign in</a></div>
      <div><h4>Legal</h4><a href="terms.html">Terms of Service</a><a href="privacy.html">Privacy Policy</a><a href="security.html">Security</a><a href="cookies.html">Cookie Policy</a></div>
    </div><div class="base"><span>© 2026 Belna — made in Stockholm</span><span>Arche 1.0 harness · your vault</span></div></footer>
  </div>`;
  const wire = (formId, inputId) => {
    const f = document.getElementById(formId);
    const p = document.getElementById(inputId);
    if (f && p){
      f.addEventListener('submit', e => {
        e.preventDefault();
        const v = p.value.trim();
        if (!v) return;
        p.value = '';
        landingRun(v);
      });
      p.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); f.requestSubmit(); } });
    }
  };
  wire('lform', 'lprompt');
  wire('lform2', 'lprompt2');
  belnaStartRotator();
  belnaStartTypewriter();
}

async function landingRun(prompt){
  // Homepage prompt never starts a chat on the homepage itself.
  // It is saved and handed off: signed-out → sign up / log in screen,
  // signed-in → agent chat (with in-chat onboarding first when needed).
  if (!prompt) return;
  prompt = String(prompt).trim().slice(0, 2000);
  if (!prompt) return;
  // Homepage prompt always requires a real account — no demo/sample agents.
  // Save first so sign-up / log-in can place it into the agent chat.
  state.pendingPrompt = prompt; save();
  if (!signedIn()){
    renderAuth();
    toast('Sign up or log in — your message is saved and will be sent in the agent chat.');
    try { const mm = document.getElementById('amsg'); if (mm) mm.textContent = 'Sign up or log in to send your message to your agent.'; } catch {}
    return;
  }
  ensureOwnerScope();
  if (!state.onboarded || !state.agent || state.agent.provisional){
    await startPendingPromptFlow(prompt);
    return;
  }
  // Already onboarded: open a chat and run for real.
  const c = { id: uid(), title: prompt.length > 42 ? prompt.slice(0, 42) + '…' : prompt, messages:[], trace:[], artifact:null, createdAt:Date.now() };
  state.chats.unshift(c); state.activeChat = c.id; state.view = 'chat';
  state.pendingPrompt = null; save();
  renderApp();
  await sendPromptDirect(c, prompt);
}

/* Pending homepage prompt → real account chat → in-chat onboarding → run.
   The user's message is placed in the agent chat FIRST (visible), then
   onboarding (name / appearance / personality) runs IN THE CHAT before the
   agent starts the actual request. No Engine work happens before onboarding. */
async function startPendingPromptFlow(pendingOverride){
  if (!signedIn()){
    if (typeof pendingOverride === 'string' && pendingOverride) { state.pendingPrompt = pendingOverride; save(); }
    renderAuth();
    return;
  }
  ensureOwnerScope();
  const pendingText = (typeof pendingOverride === 'string' && pendingOverride) ? pendingOverride : state.pendingPrompt;
  if (!pendingText){ render(); return; }
  if (!state.agent || state.agent.provisional){
    if (!state.agent) state.agent = { name: 'Your agent', color: 'lingon', pers: 'Playful', provisional: true, claimedAt: Date.now() };
    else if (!state.agent.provisional && !state.onboarded){ state.agent.provisional = true; }
  }
  const title = pendingText.length > 42 ? pendingText.slice(0, 42) + '…' : pendingText;
  let c = chat();
  if (!c || (c.messages && c.messages.length > 0) || c.onboarding){
    c = { id: uid(), title, messages: [], trace: [], artifact: null, createdAt: Date.now(), onboarding: true };
    state.chats.unshift(c); state.activeChat = c.id;
  } else {
    c.title = title; c.onboarding = true;
  }
  if (!c.messages.some(mm => mm.kind === 'text' && mm.role === 'user' && mm.text === pendingText)){
    c.messages.push({ id: uid(), role: 'user', kind: 'text', text: pendingText });
  }
  state.pendingPrompt = pendingText;
  state.view = 'chat'; save();
  renderApp();
  await runInChatOnboarding(c);
}

function pendingQuestion(c){
  if (!c) return null;
  for (let i = (c.messages || []).length - 1; i >= 0; i--){
    const mm = c.messages[i];
    if (mm.kind === 'card' && mm.card && mm.card.type === 'question' && mm.card.status === 'pending') return { c, m: mm };
  }
  return null;
}

async function runInChatOnboarding(c){
  if (!signedIn()){
    c.onboarding = false;
    const firstUser = (c.messages || []).find(mm => mm.role === 'user' && mm.kind === 'text');
    if (firstUser) state.pendingPrompt = firstUser.text;
    save(); renderAuth();
    toast('Sign in required — your message is saved.');
    return;
  }
  c.busy = true; c.onboarding = true; save();
  const rt = makeRT(c);
  try {
    const short = c.messages.find(mm => mm.role === 'user' && mm.kind === 'text');
    const rawShort = short ? String(short.text) : '';
    const shortTxt = rawShort.length > 90 ? rawShort.slice(0, 90) + '…' : rawShort;
    await rt.say(`Got it — I’ve put “${shortTxt}” in our chat and I’ll run it for real in a moment. First, let’s claim your agent (30 seconds) so it’s truly yours. No demo accounts — this stays tied to your signed-in account.`, { mood: 'happy' });
    await rt.say(`What should I call myself? Pick a suggestion or just type a name below.`, { mood: 'think' });
    const nameQ = rt.card({ type: 'question', q: 'Choose your agent’s name (or type your own below)', options: ['Sigge', 'Nova', 'Astrid', 'Mio'], status: 'pending' });
    nameQ.msg.card.onboarding = true;
    const nameAns = await nameQ.wait();
    let nm = String((nameAns && nameAns.choice) || '').trim().slice(0, 18) || 'Sigge';
    state.agent.name = nm; save(); paintSide(); try { paintCanvas(); } catch {}
    await rt.say(`Love it — I’m ${nm}.`, { mood: 'happy' });
    await rt.say(`How should I look? Pick a color — you can change it anytime in Settings → Profiles.`, { mood: 'think' });
    const colorNames = Mascot.keys.map(k => Mascot.PALETTE[k].name);
    const colQ = rt.card({ type: 'question', q: `Pick ${nm}’s look (or type a color name)`, options: colorNames.slice(0, 4), status: 'pending' });
    colQ.msg.card.onboarding = true;
    const colAns = await colQ.wait();
    const choiceStr = String((colAns && colAns.choice) || '');
    let colorKey = Mascot.keys.find(k => Mascot.PALETTE[k].name.toLowerCase() === choiceStr.toLowerCase())
      || Mascot.keys.find(k => k === choiceStr.toLowerCase())
      || Mascot.keys.find(k => Mascot.PALETTE[k].name.toLowerCase().includes(choiceStr.toLowerCase()));
    if (!colorKey || !Mascot.PALETTE[colorKey]) colorKey = 'lingon';
    state.agent.color = colorKey; save(); paintSide(); try { paintCanvas(); } catch {}
    await rt.say(`Looking sharp.`, { mood: 'happy' });
    const perQ = rt.card({ type: 'question', q: `Pick a character for ${nm} (or type your own)`, options: PERS.slice(), status: 'pending' });
    perQ.msg.card.onboarding = true;
    const perAns = await perQ.wait();
    let pers = String((perAns && perAns.choice) || 'Playful');
    const pm = PERS.find(p => p.toLowerCase() === pers.toLowerCase());
    pers = pm || 'Playful';
    const uidNow = currentUserId();
    state.agent = { name: nm, color: colorKey, pers, claimedAt: Date.now(), ownerId: uidNow };
    state.ownerId = uidNow || state.ownerId;
    state.onboarded = true;
    try { state.memory.unshift({ id: uid(), text: `Agent claimed and named “${nm}” — ${Mascot.PALETTE[colorKey].name.toLowerCase()}, ${pers.toLowerCase()}.`, src: 'onboarding', at: Date.now() }); } catch {}
    const pendingText = state.pendingPrompt
      || ((c.messages || []).find(mm => mm.role === 'user' && mm.kind === 'text') || {}).text
      || '';
    state.pendingPrompt = null;
    // Keep c.onboarding=true + c.busy=true through the Done message so any
    // text typed in that window is preserved in-thread (not dropped), then
    // flip onboarding off and start the user's request immediately while
    // still holding busy — no gap where a second run can slip in.
    save();
    paintSide(); try { paintCanvas(); } catch {}
    await rt.say(`Done — I’m ${nm}, all yours. Now running your request for real (no demos, no fakes).`, { mood: 'happy' });
    c.onboarding = false;
    save();
    if (pendingText){
      if (state.view !== 'chat') state.view = 'chat';
      paintSide(); paintMain();
      const rt2 = makeRT(c);
      try { await Engine.run(rt2, pendingText); }
      catch (e2){ console.error(e2); try { await rt2.say('Something went wrong on my end — please try again in a moment.'); } catch {} }
      c.busy = false; save(); paintMain(); paintSide();
    } else {
      c.busy = false; save();
      runGreet(c);
    }
  } catch (e){
    console.error(e);
    c.onboarding = false; c.busy = false; save();
    try { paintMain(); paintSide(); } catch {}
  }
}

/* Run Engine on text already present in the thread (no duplicate user bubble).
   Real accounts only. */
async function runAgentOn(c, text){
  if (!c || !text) return;
  if (!signedIn()){ state.pendingPrompt = text; save(); renderAuth(); return; }
  let waited = 0;
  while (c.busy && waited < 8000){ await sleep(200); waited += 200; }
  if (c.busy){ toast(`${(state.agent && state.agent.name) || 'Agent'} is mid-task — one thing at a time.`); return; }
  c.busy = true; save();
  if (state.view !== 'chat') state.view = 'chat';
  paintSide(); paintMain();
  const rt = makeRT(c);
  try { await Engine.run(rt, text); }
  catch (e){ console.error(e); await rt.say('Something went wrong on my end — please try again in a moment.'); }
  c.busy = false; save(); paintMain(); paintSide();
}
/* Direct send for an already-created chat (message not yet in thread). */
async function sendPromptDirect(c, text){
  if (!c || !text) return;
  if (!signedIn()){ state.pendingPrompt = text; save(); renderAuth(); return; }
  c.messages.push({ id: uid(), role: 'user', kind: 'text', text });
  if (c.title === 'New chat' || !c.title) c.title = text.length > 42 ? text.slice(0, 42) + '…' : text;
  save(); paintSide(); paintMain();
  await runAgentOn(c, text);
}

/* ================================================================
   ONBOARDING
================================================================ */
let ob = null;
const NAMES = ['Sigge','Nova','Astrid','Nisse','Mio','Saga','Otto','Vera','Lingo','Belle'];
const PERS = ['Playful','Precise','Calm','Bold'];
const THEMES = [
  { id:'grey', name:'Standard Grey', c:'#5A5D63' },
  { id:'brick', name:'Beige Red', c:'#D9483B' },
  { id:'blue', name:'Blue', c:'#4353C6' },
  { id:'yellow', name:'Yellow', c:'#C6922A' },
  { id:'green', name:'Green', c:'#5F8344' },
  { id:'pink', name:'Pink', c:'#C96B94' },
];
function applyTheme(){
  if (!THEMES.some(t => t.id === state.theme)) state.theme = 'grey';
  try { document.body.setAttribute('data-accent', state.theme); } catch {}
}

function openOnboarding(){
  // Real accounts only — no demo/sample onboarding without sign-in.
  if (!signedIn()){ renderAuth(); toast('Sign up or log in first — your agent belongs to a real account.'); return; }
  ensureOwnerScope();
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
  // Real accounts only — never create demo/sample agents.
  if (!signedIn()){
    const back0 = $('.modalback'); if (back0) back0.remove();
    renderAuth();
    toast('Sign up or log in first — no demo accounts.');
    return;
  }
  ensureOwnerScope();
  if (!ob) ob = { name: '', color: 'lingon', pers: 'Playful' };
  const uidNow = currentUserId();
  state.onboarded = true;
  state.agent = { name: (ob.name || '').trim() || 'Sigge', color: ob.color || 'lingon', pers: ob.pers || 'Playful', claimedAt: Date.now(), ownerId: uidNow };
  state.ownerId = uidNow || state.ownerId;
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
  // Real accounts only — never render the agent UI signed-out.
  if (!signedIn()){ renderAuth(); return; }
  ensureOwnerScope();
  if (!state.agent) state.agent = { name: 'Your agent', color: 'lingon', pers: 'Playful', provisional: true, claimedAt: Date.now() };
  applyTheme();
  belnaStopLandingFx();
  root.innerHTML = `
  <div class="app ${state.canvasOpen && state.view === 'chat' ? '' : 'nocanvas'}" id="app">
    <aside class="side" id="side"></aside>
    <main class="main" id="main"></main>
    <aside class="canvas" id="canvas"></aside>
  </div>`;
  paintSide(); paintMain(); paintCanvas();
}

function currentUser(){
  let sess = null;
  try { sess = window.LingonAuth && window.LingonAuth.get(); } catch {}
  // No fake fallback identity — unauthenticated callers get an explicit guest.
  const email = (sess && sess.user && sess.user.email) || '';
  const name = (state.userProfile && state.userProfile.name) || (email ? email.split('@')[0] : 'Guest');
  return { email: email || 'signed-out', name };
}
function artifactRows(){
  const rows = [];
  state.chats.forEach(c => {
    if (c.artifact) rows.push({ title: c.artifact.title, kind: c.artifact.kind, chat: c.title, chatId: c.id });
    (c.messages || []).forEach(m => {
      if (m.kind === 'card' && m.card.type === 'file') rows.push({ title: m.card.name, kind: 'file', chat: c.title, chatId: c.id, card: m.card });
    });
  });
  return rows;
}
function approvalRows(){
  const rows = [];
  state.chats.forEach(c => (c.messages || []).forEach(m => {
    if (m.kind === 'card' && m.card.type === 'approval')
      rows.push({ title: m.card.title, status: m.card.status, chat: c.title });
  }));
  return rows;
}

function paintSide(){
  const a = state.agent;
  if (!a) return;
  const u = currentUser();
  const initials = esc((u.name || 'U').slice(0, 1).toUpperCase());
  $('#side').innerHTML = `
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
    <div class="sidebottom">
      <div class="usagecard" id="usagecard"><span class="mut" style="font-size:12px">Loading usage…</span></div>
      <div class="userwrap">
        ${state.userMenuOpen ? `<div class="usermenu pop">
          <button class="sitem" data-act="nav" data-view="settings">${icon('gear',15)} Settings</button>
          <button class="sitem" data-act="nav" data-view="apps">${icon('box',15)} Apps</button>
          <button class="sitem" data-act="signout">${icon('x',15)} Sign out</button>
        </div>` : ''}
        <button class="userrow" data-act="usermenu">
          <span class="uava">${initials}</span>
          <span class="uinfo"><b>${esc(u.name)}</b><span class="umail">${esc(u.email)}</span></span>
        </button>
      </div>
    </div>`;
  // usage card: usage left + plan (real billing when signed in)
  try {
    getBilling().then(b => {
      const box = $('#usagecard');
      if (!box) return;
      if (b) box.innerHTML = `<div class="urow"><span class="chip ${Number(b.credits) > 5 ? 'green' : ''}">${fmtC(b.credits)} credits left</span><span class="uplan">${esc(String(b.plan).toUpperCase())} plan</span></div><div class="ubar"><i style="width:${Math.min(100, Math.max(0, (b.creditsGranted ? b.creditsUsed / b.creditsGranted * 100 : 0)))}%"></i></div>`;
      else box.innerHTML = `<div class="urow"><span class="chip green">20 credits left</span><span class="uplan">FREE plan</span></div><div class="ubar"><i style="width:4%"></i></div>`;
    }).catch(() => {});
  } catch {}
}

function paintMain(){
  const M = $('#main');
  if (state.view === 'chat') return paintChat(M);
  if (state.view === 'settings') return paintSettings(M);
  if (state.view === 'apps') return paintApps(M);
  // legacy views now live inside Settings tabs
  if (state.view === 'vault'){ state.view = 'settings'; state.settingsTab = 'secrets'; save(); return paintSettings(M); }
  if (state.view === 'memory'){ state.view = 'settings'; state.settingsTab = 'memory'; save(); return paintSettings(M); }
  if (state.view === 'profile'){ state.view = 'settings'; state.settingsTab = 'profiles'; save(); return paintSettings(M); }
  if (state.view === 'billing'){ state.view = 'settings'; state.settingsTab = 'billing'; save(); return paintSettings(M); }
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
      ${c.busy ? '<span class="chip">' + icon('refresh',12) + ' working…</span>' : ''}
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
  pending:'<span class="chip">waiting for you</span>',
  approved:'<span class="chip green">approved</span>',
  always:'<span class="chip green">always allowed</span>',
  denied:'<span class="chip">denied</span>',
  connected:'<span class="chip green">connected</span>',
  saved:'<span class="chip green">sealed in vault</span>',
  answered:c => `<span class="chip green">you: ${esc(c.choice)}</span>`,
  done:'<span class="chip green">done</span>',
  skipped:'<span class="chip">skipped</span>',
  expired:'<span class="chip">expired</span>',
};
const stChip = c => { const v = STCHIP[c.status]; return typeof v === 'function' ? v(c) : (v || ''); };

function cardNode(c, m){
  const k = c.id, mid = m.id, cd = m.card;
  const auto = cd.type === 'subagents' || cd.type === 'browser' || cd.type === 'computer';
  const chip = auto ? (cd.status === 'done' ? STCHIP.done : '<span class="chip">running</span>') : stChip(cd);
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
    ${hd(icon('lock',20),'var(--acc-soft)','var(--acc)','Secure credentials store','encrypted at rest · agent gets a reference only')}
    <div class="bd">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="field" style="flex:1;min-width:140px" data-f="name" placeholder="secret name" value="${esc(cd.nameVal || cd.suggest || '')}">
        <input class="field mono" style="flex:1.4;min-width:180px" data-f="val" type="password" placeholder="paste value — masked immediately" autocomplete="off">
      </div>
      <div class="secnote">${icon('shieldcheck',14)} Value never enters model context, logs or traces.</div>
    </div>
    ${pending ? `<div class="stack"><button class="btn" data-act="save-secret" data-chat="${k}" data-msg="${mid}">${icon('lock',14)} Save to vault</button><button class="btn ghost" data-act="skip-secret" data-chat="${k}" data-msg="${mid}">Skip</button></div>` : (cd.status === 'saved' ? `<div class="ft"><span class="note mono">${esc(cd.ref)} · ••••••••</span></div>` : '')}</div>`;

  if (cd.type === 'question') return `<div class="acard">
    ${hd(icon('spark',20),'var(--acc-soft)','var(--acc)','Question', state.agent.name + ' is asking')}
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
    ${hd(icon('globe',20),'var(--ink)','#fff','Browser', esc(cd.note))}
    <div class="bd"><div class="win"><div class="bar"><i></i><i></i><i></i><span class="url">${esc(cd.url)}</span></div>
    ${cd.screenshot ? `<div class="shot"><img src="${cd.screenshot}" alt="Rendered page screenshot" loading="lazy"></div>` : ''}
    <div class="scr">${cd.status === 'done' ? `<span style="color:var(--green)">${icon('check',14)}</span>` : `<span class="spin">${icon('refresh',14)}</span>`} ${esc(cd.note)}</div></div></div>
    <div class="stack">${cd.liveId ? `<button class="btn" data-act="watchlive">Watch live</button>` : ''}<button class="btn ghost" data-act="viewcanvas">Follow in canvas</button></div></div>`;

  if (cd.type === 'computer') return `<div class="acard">
    ${hd(icon('term',20),'var(--ink)','#fff','Sandboxed computer use','Agents sandbox · allowlisted network, no writes outside run')}
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
    ${hd(icon('book',20),'var(--green-soft)','var(--green)','Saved to memory','I can recall this in any chat')}
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
    hasApp: n => false,
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
  // Live-follow: browser/computer progress also renders in the canvas timeline.
  if (m.kind === 'card' && (m.card.type === 'browser' || m.card.type === 'computer')
      && state.canvasOpen && (state.canvasTab || 'canvas') === 'canvas' && isActive(c)) paintCanvas();
}

/* Run timeline: browser visits + computer runs from this chat, so users can
   follow tool use live in the canvas — same data as the chat cards. */
function runTimelineHTML(c){
  if (!c) return '';
  const runs = (c.messages || []).filter(m => m.kind === 'card' && (m.card.type === 'browser' || m.card.type === 'computer'));
  if (!runs.length) return '';
  return `<div class="runbox"><div class="runhead">${icon('box',14)} Live run — browser &amp; computer use</div>` + runs.map(m => {
    const cd = m.card;
    if (cd.type === 'browser') return `<div class="runrow"><span class="rtile">${icon('globe',14)}</span><div class="rbody">
      <div class="rurl">${esc(cd.url)}</div><div class="rnote">${cd.status === 'done' ? 'rendered' : 'opening…'} · ${esc(cd.note)}</div>
      ${cd.screenshot ? `<div class="shot"><img src="${cd.screenshot}" alt="Rendered page screenshot" loading="lazy"></div>` : ''}</div></div>`;
    return `<div class="runrow"><span class="rtile dark">${icon('term',14)}</span><div class="rbody">
      <div class="term mini">${cd.lines.map(L => `<div class="${L.cls || ''}">${esc(L.t)}</div>`).join('')}</div></div></div>`;
  }).join('') + `</div>`;
}

function resolveCard(c, m, payload, status){
  m.card.status = status;
  replaceNode(c, m); save();
  const key = wkey(c.id, m.id);
  const f = waits[key]; if (f){ delete waits[key]; f(payload); }
}

/* ---------------- send / chats (real accounts only) ---------------- */
async function sendPrompt(text){
  if (!signedIn()){ state.pendingPrompt = text; save(); renderAuth(); toast('Sign up or log in — your message is saved and will be sent after.'); return; }
  ensureOwnerScope();
  if (!state.onboarded || !state.agent || state.agent.provisional){
    state.pendingPrompt = text; save();
    await startPendingPromptFlow(text);
    return;
  }
  const c = chat(); if (!c) return;
  // Typed answers during in-chat onboarding resolve the pending question
  // instead of starting a new agent run.
  if (c.onboarding){
    const pq = pendingQuestion(c);
    c.messages.push({ id: uid(), role: 'user', kind: 'text', text });
    save();
    if (state.view !== 'chat'){ state.view = 'chat'; }
    paintSide(); paintMain();
    if (pq) resolveCard(pq.c, pq.m, { choice: String(text).trim().slice(0, 60) || text }, 'answered');
    return;
  }
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
  if (!signedIn()){ renderAuth(); return; }
  c.busy = true; save();
  Engine.greet(makeRT(c)).finally(() => { c.busy = false; save(); });
}

function newChat(){
  if (!signedIn()){ renderAuth(); toast('Sign up or log in to start a chat.'); return; }
  ensureOwnerScope();
  if (!state.onboarded || !state.agent || state.agent.provisional){
    // New accounts finish in-chat onboarding first — no empty demo chats.
    if (state.pendingPrompt) startPendingPromptFlow();
    else openOnboarding();
    return;
  }
  const c = { id: uid(), title:'New chat', messages:[], trace:[], artifact:null, createdAt:Date.now() };
  state.chats.unshift(c); state.activeChat = c.id; state.view = 'chat'; save();
  renderApp();
  runGreet(c);
}

/* ---------------- canvas + right-side agent slider ---------------- */
function agentSliderContent(){
  const t = state.agentTab || 'appearance';
  const a = state.agent;
  let body = '';
  if (t === 'appearance'){
    body = `
      <div class="aslider-sec">
        <div style="display:flex;gap:12px;align-items:center">${Mascot.svg(a.color,'happy',54)}<div><b>${esc(a.name)}</b><div><span class="chip">Arche 1.0</span></div></div></div>
        <label class="alabel">Agent name</label>
        <input class="field" id="agentname" maxlength="18" value="${esc(a.name)}">
        <label class="alabel">Mascot appearance</label>
        <div class="swatches" style="justify-content:flex-start;margin-top:8px">${Mascot.keys.map(k => `<button class="swatch ${k === a.color ? 'on' : ''}" data-act="p-color" data-c="${k}" title="${Mascot.PALETTE[k].name}"><span style="width:26px;height:26px;border-radius:50%;background:${Mascot.PALETTE[k].body};display:block"></span></button>`).join('')}</div>
        <label class="alabel">Personality</label>
        <div class="persrow" style="justify-content:flex-start">${PERS.map(p => `<button class="pers ${p === a.pers ? 'on' : ''}" data-act="p-pers" data-p="${p}">${p}</button>`).join('')}</div>
      </div>`;
  } else if (t === 'library'){
    const arts = artifactRows();
    body = `<div class="aslider-sec"><label class="alabel">Artifacts &amp; files (${arts.length})</label>
      <div class="kv">${arts.map(r => `<div class="row"><span style="color:var(--mut)">${icon(r.kind === 'file' ? 'file' : 'spark',15)}</span><div><b>${esc(r.title)}</b><div class="sub">${esc(r.kind)} · from “${esc(r.chat)}”</div></div></div>`).join('') || '<div class="row mut">No artifacts or files yet.</div>'}</div>
      <div class="secnote">${icon('shieldcheck',14)} Everything here was really generated — never simulated.</div></div>`;
  } else {
    const ap = approvalRows();
    body = `<div class="aslider-sec"><label class="alabel">Approval history (${ap.length + state.vault.approvals.length})</label>
      <div class="kv">
        ${state.vault.approvals.map(x => `<div class="row"><span style="color:var(--green)">${icon('check',15)}</span><div><b>${esc(x.label)}</b><div class="sub">always allowed · ${fmtWhen(x.at)}</div></div><div class="rgt"><button class="btn ghost small" data-act="revoke" data-id="${x.id}">Revoke</button></div></div>`).join('')}
        ${ap.map(x => `<div class="row"><span style="color:var(--mut)">${icon('shieldcheck',15)}</span><div><b>${esc(x.title)}</b><div class="sub">${esc(x.status)} · “${esc(x.chat)}”</div></div></div>`).join('') || (state.vault.approvals.length ? '' : '<div class="row mut">No approvals yet — sensitive actions will pause for you here.</div>')}
      </div></div>`;
  }
  return `<div class="aslider fill">
    <div class="atabs">
      <button class="${t === 'appearance' ? 'on' : ''}" data-act="agenttab" data-t="appearance">Appearance</button>
      <button class="${t === 'approvals' ? 'on' : ''}" data-act="agenttab" data-t="approvals">Approvals</button>
      <button class="${t === 'library' ? 'on' : ''}" data-act="agenttab" data-t="library">Library</button>
    </div>${body}</div>`;
}

/* Live tab helpers: newest live browser session id for this chat. */
function liveIdFor(c){
  if (!c) return null;
  for (let i = (c.messages || []).length - 1; i >= 0; i--){
    const m = c.messages[i];
    if (m.kind === 'card' && m.card.type === 'browser' && m.card.liveId) return m.card.liveId;
  }
  return null;
}
function computerLinesFor(c){
  const out = [];
  (c && c.messages || []).forEach(m => {
    if (m.kind === 'card' && m.card.type === 'computer') (m.card.lines || []).forEach(L => out.push(L));
  });
  return out.slice(-14);
}
function pcIdFor(c){
  if (!c) return null;
  for (let i = (c.messages || []).length - 1; i >= 0; i--){
    const m = c.messages[i];
    if (m.kind === 'card' && m.card.type === 'computer' && m.card.pcId) return m.card.pcId;
  }
  return null;
}

/* Live view client: one WS per tab render. Frames paint the <img>; state
   messages drive the blue working glow; input forwards only in takeover. */
let liveWS = null, liveIdShown = null, liveControl = false;
let pcWS = null, pcIdShown = null;
function liveClose(){
  try { liveWS && liveWS.close(); } catch {}
  try { pcWS && pcWS.close(); } catch {}
  liveWS = null; liveIdShown = null; liveControl = false; pcWS = null; pcIdShown = null;
}
function paintLive(body, c){
  const id = liveIdFor(c);
  const terms = computerLinesFor(c);
  if (!id){
    if (liveIdShown) liveClose();
    body.innerHTML = `<div class="cempty">${Mascot.svg(state.agent.color,'idle',80,'mascot-bob')}<div style="font-weight:700;margin-top:12px">No live session</div><div class="mut2">Ask for research and the agent's real browser appears here — watch it, take over, hand back.</div></div>`;
    return;
  }
  const poster = (c.messages || []).reduce((acc, m) => (m.kind === 'card' && m.card.type === 'browser' && m.card.screenshot) ? m.card.screenshot : acc, '');
  window.__liveFrames = 0;
  body.innerHTML = `
    <div class="livewrap" id="livewrap">
      <div class="livebar"><span class="url" id="liveurl">connecting…</span><span class="chip purple" id="livestate">connecting</span></div>
      <div class="liveview" id="liveview">
        <img id="liveimg" alt="Live browser"${poster ? ` src="${poster}"` : ''}>
        <div class="bigcursor" id="bigcursor"></div>
      </div>
      <div class="pctitle">${icon('term',13)} Computer — live sandbox terminal</div>
      <div class="term mini" id="pcout" style="margin-top:6px">${terms.length ? terms.map(L => `<div class="${L.cls || ''}">${esc(L.t)}</div>`).join('') : '<div class="mut">No runs yet in this chat.</div>'}</div>
      <div class="pcinput" id="pcinput" style="display:none"><input class="field mono" id="pccmd" placeholder="Type JS — runs for real in the sandbox (e.g. console.log(input.prs.length))"><button class="btn small" data-act="pcrun">Run</button></div>
      <div class="controlbar">
        <span class="cava">${Mascot.svg(state.agent.color,'idle',34)}</span>
        <div class="cinfo"><b id="livestatus">Agent browser</b><div class="sub" id="livesub">streaming the real page</div></div>
        <button class="btn small" data-act="takeover" id="takebtn">Take over</button>
        <button class="btn ghost small" data-act="closestop-live">Close</button>
      </div>
    </div>`;
  liveConnect(id);
}
function liveConnect(id){
  if (liveWS && liveIdShown === id){ pcConnect(); return; }
  liveClose();
  const sess = window.LingonAuth && window.LingonAuth.get();
  if (!sess || !sess.access_token){ $('#livestate').textContent = 'sign in expired'; return; }
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(proto + '//' + location.host + '/ws/live/' + id + '?token=' + encodeURIComponent(sess.access_token));
  liveWS = ws; liveIdShown = id; liveControl = false;
  const img = () => $('#liveimg'), wrap = () => $('#livewrap'), st = () => $('#livestate');
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.frame && img()){ img().src = 'data:image/jpeg;base64,' + m.frame; window.__liveFrames = (window.__liveFrames || 0) + 1; }
    if (m.hello && $('#liveurl')) $('#liveurl').textContent = m.url || m.hello;
    if (m.state) liveState(m.state, m);
  };
  ws.onclose = () => { if (st()){ st().textContent = 'session ended'; } const b = $('#takebtn'); if (b){ b.disabled = true; } };
  const view = $('#liveview'), cur = $('#bigcursor');
  let lastMove = 0;
  const pos = (e) => {
    const r = view.getBoundingClientRect();
    return { x: Math.round((e.clientX - r.left) * (1280 / r.width)), y: Math.round((e.clientY - r.top) * (900 / r.height)) };
  };
  view.onmousemove = (e) => {
    const r = view.getBoundingClientRect();
    cur.style.left = (e.clientX - r.left) + 'px'; cur.style.top = (e.clientY - r.top) + 'px';
    const now = Date.now();
    if (liveControl && ws.readyState === 1 && now - lastMove > 80){ lastMove = now; const p = pos(e); liveSend({ type: 'move', ...p }); }
  };
  view.onclick = (e) => { if (!liveControl || ws.readyState !== 1) return; const p = pos(e); liveSend({ type: 'click', ...p }); };
  view.onwheel = (e) => { if (!liveControl || ws.readyState !== 1) return; e.preventDefault(); liveSend({ type: 'scroll', dy: Math.round(e.deltaY) }); };
  document.onkeydown = (e) => {
    if (!liveControl || !liveWS || liveWS.readyState !== 1) return;
    if (e.target && /INPUT|TEXTAREA/.test(e.target.tagName)) return;
    if (e.key.length === 1) liveSend({ type: 'type', text: e.key });
    else if (['Enter', 'Backspace', 'Tab', 'Escape', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Delete'].includes(e.key)){ e.preventDefault(); liveSend({ type: 'key', key: e.key }); }
  };
  pcConnect();
}
/* Computer stream: appends real sandbox output lines as runs happen. */
function pcConnect(){
  const c = chat();
  const pcId = pcIdFor(c);
  const out = $('#pcout');
  if (!pcId || !out) return;
  if (pcWS && pcIdShown === pcId) return;
  try { pcWS && pcWS.close(); } catch {}
  const sess = window.LingonAuth && window.LingonAuth.get();
  if (!sess || !sess.access_token) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(proto + '//' + location.host + '/ws/pc/' + pcId + '?token=' + encodeURIComponent(sess.access_token));
  pcWS = ws; pcIdShown = pcId;
  ws.onmessage = (ev) => {
    let m; try { m = JSON.parse(ev.data); } catch { return; }
    if (m.hello && m.log && out) out.innerHTML = m.log.map(L => `<div class="${esc(L.cls || '')}">${esc(L.t)}</div>`).join('');
    if (Array.isArray(m.out) && out){
      if (out.querySelector('.mut') && out.children.length <= 1) out.innerHTML = '';
      m.out.forEach(L => { out.insertAdjacentHTML('beforeend', `<div class="${esc(L.cls || '')}">${esc(L.t)}</div>`); });
      out.scrollTop = out.scrollHeight;
    }
    if (m.state) liveState(m.state === 'user' ? 'user' : m.state);
  };
}
function liveState(s, m){
  const wrap = $('#livewrap'), st = $('#livestate'), sub = $('#livesub'), btn = $('#takebtn');
  if (m && m.url && $('#liveurl')) $('#liveurl').textContent = m.url;
  if (m && m.title && $('#livesub') && !liveControl) sub.textContent = m.title;
  if (wrap) wrap.classList.toggle('working', s === 'working' && !liveControl);
  if (st) st.textContent = liveControl ? 'you drive' : s;
  if (btn) btn.textContent = liveControl ? 'Give back' : 'Take over';
  if (sub && liveControl) sub.textContent = 'you hold the mouse & keyboard — agent waits';
}
async function liveTakeover(){
  const c = chat();
  const id = liveIdShown, pcId = pcIdFor(c);
  if (!id && !pcId){ toast('No live session in this chat yet.'); return; }
  const want = !liveControl;
  try {
    if (id) await window.LingonAuth.api('/api/live/takeover', { method: 'POST', body: JSON.stringify({ liveId: id, on: want }) });
    if (pcId) await window.LingonAuth.api('/api/live/takeover', { method: 'POST', body: JSON.stringify({ pcId, on: want }) });
    liveControl = want;
    const pi = $('#pcinput'); if (pi) pi.style.display = want ? 'flex' : 'none';
    pcConnect();
    liveState(want ? 'user' : 'idle');
    toast(want ? 'You drive browser + computer — the agent waits.' : 'Agent drives again.');
  } catch (e) { toast(e.message); }
}
async function liveSend(ev){
  // Input goes over REST (auth-checked); frames come over WS.
  const id = liveIdShown; if (!id) return;
  try {
    const j = await window.LingonAuth.api('/api/live/input', { method: 'POST', body: JSON.stringify({ liveId: id, ev }) });
    if (j.url && $('#liveurl')) $('#liveurl').textContent = j.url;
  } catch {}
}
function paintCanvas(){
  const cv = $('#canvas'); if (!cv) return;
  if (state.canvasTab === 'live'){ /* keep socket across repaints of the same session */ }
  else if (liveWS) liveClose();
  const c = chat();
  const top = state.canvasTab || 'canvas';
  const liveId = liveIdFor(c);
  cv.innerHTML = `
    <div class="atabs ttop">
      <button class="agent ${top === 'agent' ? 'on' : ''}" data-act="ctab" data-t="agent" title="Agent panel">${Mascot.svg(state.agent.color,'idle',22)}<span>${esc(state.agent.name)}</span></button>
      <button class="${top === 'canvas' ? 'on' : ''}" data-act="ctab" data-t="canvas">${icon('board',14)} Canvas</button>
      <button class="${top === 'live' ? 'on' : ''}" data-act="ctab" data-t="live">${icon('globe',14)} Live${liveId ? '<span class="livedot"></span>' : ''}</button>
      <button class="${top === 'trace' ? 'on' : ''}" data-act="ctab" data-t="trace">${icon('list',14)} Trace <span class="cnt">${(c && c.trace || []).length}</span></button>
    </div>
    <div class="cbody" id="cbody"></div>`;
  const body = $('#cbody');
  if (top === 'agent'){
    body.innerHTML = agentSliderContent();
    const an = $('#agentname');
    if (an) an.addEventListener('change', e => {
      const v = e.target.value.trim(); if (!v) return;
      state.agent.name = v; save(); paintSide(); paintCanvas();
      toast('Renamed — they answer to ' + v + ' now.');
    });
    return;
  }
  if (state.canvasTab === 'trace'){
    body.innerHTML = (c && c.trace && c.trace.length)
      ? `<div class="tools" style="border:none;padding:0">${c.trace.map(t => `<div class="tline">${icon(t.ic,13)}<span>${esc(t.t)}</span></div>`).join('')}</div>`
      : `<div class="cempty">${Mascot.svg(state.agent.color,'think',70,'mascot-bob')}<div class="mut2">Every tool call, guardrail and sub-agent step will appear here.</div></div>`;
    return;
  }
  if (top === 'live'){
    paintLive(body, c);
    return;
  }
  const a = c && c.artifact;
  const run = runTimelineHTML(c);
  if (!a){
    body.innerHTML = run || `<div class="cempty">${Mascot.svg(state.agent.color,'idle',80,'mascot-bob')}<div style="font-weight:700;margin-top:12px">The canvas</div><div class="mut2">Charts, live pages, diffs and plans I create will render here while we chat.</div></div>`;
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
    body.innerHTML = run + `<div class="arti-head"><b>${esc(a.title)}</b><span class="chip green">live</span></div><div class="arti-frame"><iframe sandbox="allow-scripts" srcdoc="${esc(a.html)}"></iframe></div>`;
    return;
  }
  if (a.kind === 'code'){
    body.innerHTML = run + `<div class="arti-head"><b>${esc(a.title)}</b><button class="btn ghost tiny" data-act="copycode">${icon('copy',13)} Copy</button></div><div class="codebox" id="codebox">${esc(a.code)}</div>`;
    return;
  }
  if (a.kind === 'plan'){
    body.innerHTML = run + `<div class="planbox"><div class="ct" style="font-weight:800;margin-bottom:10px">${esc(a.title)}</div><div class="md">${a.items.map(i => `<p>${md(i).replace(/<\/?p>/g,'')}</p>`).join('')}</div></div>`;
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
        <span style="color:var(--mut)">${icon('lock',16)}</span>
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
    body = `<div class="kv"><div class="row mut">No connected apps. GitHub works via a personal access token saved in Secrets (real read-only API) — there is no fake OAuth here. Gmail isn't connected.</div></div>`;
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
    <div class="phead"><h1>Memory</h1><span class="chip">${icon('book',12)} ${state.memory.length} stored</span></div>
    <p class="psub">What ${esc(state.agent.name)} remembers across chats. Delete anything, anytime.</p>
    <div class="kv">${state.memory.map(m => `<div class="row">
      <span style="color:var(--mut)">${icon('book',16)}</span>
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
    state.agent.name = v; save(); paintSide(); paintCanvas(); toast('Renamed — they answer to ' + v + ' now.');
  });
}

/* ---------------- Settings (profiles / secrets / memory / browser / billing) ---------------- */
function settingsSecretsBody(v){
  return `
    <div class="warnband">${icon('shieldcheck',18)}<div><b>The agent never sees your secrets.</b>Values are masked everywhere in chat and traces; the model receives references like <span class="mono">sec_••••</span> only. Reveal below is for your eyes alone, on this device.</div></div>
    <div class="kv">
      ${v.secrets.map(s => `<div class="row">
        <span style="color:var(--mut)">${icon('lock',16)}</span>
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
}
function paintSettings(M){
  const a = state.agent;
  const u = currentUser();
  const tab = state.settingsTab || 'profiles';
  let body = '';
  if (tab === 'profiles'){
    body = `
    <div class="profiletop">
      <div><span class="uava big">${esc((u.name || 'U').slice(0, 1).toUpperCase())}</span></div>
      <div class="info">
        <label class="alabel">Display name</label>
        <input class="field" id="uname" value="${esc(u.name)}" maxlength="40" style="max-width:280px;font-weight:700">
        <div class="sub" style="margin-top:6px">${esc(u.email)} · Arche 1.0 · your data is never shared with other users</div>
      </div>
    </div>
    <div class="psec"><h3>${icon('spark',15)} Your agent</h3>
      <div class="profiletop">
        <div id="pmascot">${Mascot.svg(a.color,'happy',90,'mascot-bob')}</div>
        <div class="info">
          <input class="field" id="pname" value="${esc(a.name)}" maxlength="18" style="max-width:220px;font-weight:700">
          <div class="swatches" style="justify-content:flex-start;margin-top:14px">${Mascot.keys.map(k => `<button class="swatch ${k === a.color ? 'on' : ''}" data-act="p-color" data-c="${k}"><span style="width:26px;height:26px;border-radius:50%;background:${Mascot.PALETTE[k].body};display:block"></span></button>`).join('')}</div>
          <div class="persrow" style="justify-content:flex-start">${PERS.map(p => `<button class="pers ${p === a.pers ? 'on' : ''}" data-act="p-pers" data-p="${p}">${p}</button>`).join('')}</div>
        </div>
      </div>
    </div>
    <div class="psec"><h3 style="color:var(--acc)">${icon('alert',15)} Danger zone</h3>
      <div class="kv"><div class="row"><div><b>Release this agent</b><div class="sub">Deletes chats, vault, memory and the claim on this device.</div></div>
      <div class="rgt"><button class="btn soft small" data-act="reset">Release</button></div></div></div>
    </div>`;
  } else if (tab === 'theme'){
    const cur = THEMES.find(t => t.id === (state.theme || 'grey')) || THEMES[0];
    body = `<p class="psub">Accent color for highlights, selections and card headers. Standard Grey is the default — everything stays neutral until you pick a color.</p>
    <div class="kv"><div class="row" style="align-items:flex-start"><span style="color:var(--mut)">${icon('star',16)}</span>
      <div style="flex:1"><b>Accent color</b><div class="sub">Current: ${esc(cur.name)} · applies instantly</div>
        <div class="swatches" style="justify-content:flex-start;margin-top:12px">${THEMES.map(t => `<button class="swatch ${cur.id === t.id ? 'on' : ''}" data-act="theme" data-v="${t.id}" title="${t.name}"><span style="width:26px;height:26px;border-radius:50%;background:${t.c};display:block"></span></button>`).join('')}</div>
      </div></div></div>`;
  } else if (tab === 'secrets'){
    body = settingsSecretsBody(state.vault);
  } else if (tab === 'memory'){
    body = `<div class="kv">${state.memory.map(m => `<div class="row">
      <span style="color:var(--mut)">${icon('book',16)}</span>
      <div><b style="font-weight:600">${esc(m.text)}</b><div class="sub">${esc(m.src)} · ${fmtWhen(m.at)}</div></div>
      <div class="rgt"><button class="iconbtn" data-act="delmem" data-id="${m.id}">${icon('trash',14)}</button></div></div>`).join('') || '<div class="row mut">Nothing remembered yet.</div>'}</div>`;
  } else if (tab === 'browser'){
    const bp = state.browserProfile || { profile:'Default', sandbox:true, allowlist:true };
    body = `<div class="kv">
      <div class="row"><span style="color:var(--mut)">${icon('globe',16)}</span><div><b>Profile</b><div class="sub">Sandboxed browser identity for this device</div></div>
      <div class="rgt"><input class="field" id="bprof" value="${esc(bp.profile)}" style="max-width:180px"></div></div>
      <div class="row"><span style="color:var(--green)">${icon('shieldcheck',16)}</span><div><b> Sandboxed harness</b><div class="sub">Browser, code and computer use stay contained — every step visible in Trace.</div></div>
      <div class="rgt"><button class="btn ${bp.sandbox ? '' : 'ghost'} small" data-act="btoggle" data-k="sandbox">${bp.sandbox ? 'On' : 'Off'}</button></div></div>
      <div class="row"><span style="color:var(--mut)">${icon('list',16)}</span><div><b>Allowlisted network</b><div class="sub">Only approved hosts are fetched server-side.</div></div>
      <div class="rgt"><button class="btn ${bp.allowlist ? '' : 'ghost'} small" data-act="btoggle" data-k="allowlist">${bp.allowlist ? 'On' : 'Off'}</button></div></div>
    </div>`;
  } else if (tab === 'billing'){
    body = `<div id="billbody"><div class="row mut">Loading…</div></div>
      <div class="kv" style="margin-top:14px"><div class="row" style="background:var(--panel)">
      <input class="field mono" id="giftcode" placeholder="LNG-XXXX-XXXX-XXXX" style="flex:1">
      <button class="btn small" data-act="redeem">Redeem gift</button></div></div>
      <div class="kv" id="plancards" style="margin-top:14px"></div>`;
  }
  M.innerHTML = `<div class="page"><div class="pageinner">
    <div class="phead"><h1>Settings</h1><span style="display:flex;gap:8px;align-items:center"><span class="chip">${icon('gear',12)} Arche 1.0</span><button class="btn ghost small" data-act="nav" data-view="chat">Back to chat</button></span></div>
    <p class="psub">User profiles, secrets, memory, browser profile and billing — all scoped to your account, never shared.</p>
    <div class="seg">
      <button class="${tab === 'profiles' ? 'on' : ''}" data-act="stab" data-t="profiles">${icon('user',14)} Profiles</button>
      <button class="${tab === 'theme' ? 'on' : ''}" data-act="stab" data-t="theme">${icon('star',14)} Theme</button>
      <button class="${tab === 'secrets' ? 'on' : ''}" data-act="stab" data-t="secrets">${icon('key',14)} Secrets</button>
      <button class="${tab === 'memory' ? 'on' : ''}" data-act="stab" data-t="memory">${icon('book',14)} Memory</button>
      <button class="${tab === 'browser' ? 'on' : ''}" data-act="stab" data-t="browser">${icon('globe',14)} Browser</button>
      <button class="${tab === 'billing' ? 'on' : ''}" data-act="stab" data-t="billing">${icon('spark',14)} Billing</button>
    </div>
    ${body}
  </div></div>`;
  const pn = $('#pname');
  if (pn) pn.addEventListener('change', e => {
    const v = e.target.value.trim(); if (!v) return;
    state.agent.name = v; save(); paintSide(); paintCanvas(); toast('Renamed — they answer to ' + v + ' now.');
  });
  const un = $('#uname');
  if (un) un.addEventListener('change', e => {
    const v = e.target.value.trim(); if (!v) return;
    state.userProfile = Object.assign({}, state.userProfile, { name: v }); save(); paintSide(); toast('Profile updated.');
  });
  const bp = $('#bprof');
  if (bp) bp.addEventListener('change', e => {
    state.browserProfile.profile = e.target.value.trim() || 'Default'; save(); toast('Browser profile saved.');
  });
  if (tab === 'billing'){
    getBilling().then((b) => {
      const elb = $('#billbody');
      if (elb && b) elb.innerHTML = billSummary(b);
      const pc = $('#plancards');
      if (pc && b) pc.innerHTML = planCards(b);
    });
  }
}

/* ---------------- Apps (real connections only, never faked) ---------------- */
function paintApps(M){
  const hasGH = state.vault.secrets.some(s => s.name === 'github_token');
  M.innerHTML = `<div class="page"><div class="pageinner">
    <div class="phead"><h1>Apps</h1><span style="display:flex;gap:8px;align-items:center"><span class="chip">real connections only</span><button class="btn ghost small" data-act="nav" data-view="chat">Back to chat</button></span></div>
    <p class="psub">Connect apps to extend Arche 1.0. Nothing here is simulated — unconnected apps simply do nothing until you connect them.</p>
    <div class="kv">
      <div class="row"><span style="color:var(--ink)">${icon('git',18)}</span>
        <div><b>GitHub</b><div class="sub">${hasGH ? 'PAT sealed in Secrets · read-only PR reviews' : 'Needs a fine-grained PAT in Secrets (Contents + Pull requests, read-only)'}</div></div>
        <div class="rgt">${hasGH ? '<span class="chip green">connected</span>' : '<button class="btn small" data-act="goto-secrets">Connect</button>'}</div></div>
      <div class="row"><span style="color:var(--acc)">${icon('mail',18)}</span>
        <div><b>Gmail</b><div class="sub">OAuth not configured in this build — inbox stays untouched, nothing simulated</div></div>
        <div class="rgt"><span class="chip">not connected</span></div></div>
      <div class="row"><span style="color:var(--mut)">${icon('box',18)}</span>
        <div><b>More apps</b><div class="sub">New connectors appear here only when a real OAuth or token flow exists</div></div>
        <div class="rgt"><span class="chip">soon</span></div></div>
    </div>
  </div></div>`;
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
  if (act === 'scroll'){ e.preventDefault(); const t = $(b.dataset.t); if (t) t.scrollIntoView({ behavior:'smooth' }); return; }
  if (act === 'open-app'){
    belnaStopLandingFx();
    if (!signedIn()){ renderAuth(); toast('Sign up or log in to meet your agent.'); return; }
    ensureOwnerScope();
    if (state.onboarded && state.agent && !state.agent.provisional){ renderApp(); }
    else if (state.pendingPrompt){ await startPendingPromptFlow(); }
    else { openOnboarding(); }
    return;
  }
  if (act === 'top'){ e.preventDefault(); window.scrollTo({ top:0, behavior:'smooth' }); return; }
  if (act === 'back-home'){ belnaStopLandingFx(); renderLanding(); return; }
  if (act === 'signin-nav'){
    e.preventDefault(); belnaStopLandingFx();
    if (signedIn()){
      ensureOwnerScope();
      if (state.onboarded && state.agent && !state.agent.provisional){ renderApp(); }
      else if (state.pendingPrompt){ await startPendingPromptFlow(); }
      else { renderLanding(); }
    } else { renderAuth(); }
    return;
  }
  if (act === 'claim'){
    belnaStopLandingFx();
    if (!signedIn()){ renderAuth(); toast('Sign in first, then claim your agent — your message is saved.'); return; }
    ensureOwnerScope();
    if (state.onboarded && state.agent && !state.agent.provisional){ renderApp(); if (state.pendingPrompt){ const p = state.pendingPrompt; state.pendingPrompt = null; save(); sendPrompt(p); } }
    else if (state.pendingPrompt){ await startPendingPromptFlow(); }
    else { openOnboarding(); }
    return;
  }
  // No demo/sample-agent path: every agent requires a real signed-in account.
  if (act === 'skip-claim'){
    if (!signedIn()){ renderAuth(); toast('Sign up or log in — demo accounts are disabled.'); return; }
    ensureOwnerScope();
    if (state.pendingPrompt){ await startPendingPromptFlow(); return; }
    openOnboarding(); return;
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
  if (act === 'nav'){
    if (!signedIn()){ renderAuth(); return; }
    state.view = b.dataset.view; state.userMenuOpen = false; save(); renderApp(); return;
  }
  if (act === 'usermenu'){ state.userMenuOpen = !state.userMenuOpen; save(); paintSide(); return; }
  if (act === 'stab'){ state.settingsTab = b.dataset.t; save(); paintSettings($('#main')); return; }
  if (act === 'theme'){ state.theme = b.dataset.v || 'grey'; save(); applyTheme(); paintSide(); if ($('#canvas')) paintCanvas(); if (state.view === 'settings' && $('#main')) paintSettings($('#main')); toast('Accent: ' + ((THEMES.find(t => t.id === state.theme) || THEMES[0]).name)); return; }
  if (act === 'goto-secrets'){ state.view = 'settings'; state.settingsTab = 'secrets'; save(); renderApp(); return; }
  if (act === 'btoggle'){ state.browserProfile[b.dataset.k] = !state.browserProfile[b.dataset.k]; save(); paintSettings($('#main')); return; }
  if (act === 'agentpanel'){
    state.canvasTab = 'agent';
    state.canvasOpen = true; const app = $('#app'); if (app) app.classList.remove('nocanvas');
    save(); paintCanvas(); return;
  }
  if (act === 'agenttab'){ state.agentTab = b.dataset.t; state.canvasTab = 'agent'; save(); paintCanvas(); return; }
  if (act === 'newchat'){ newChat(); return; }
  if (act === 'openchat'){
    if (!signedIn()){ renderAuth(); return; }
    state.activeChat = b.dataset.id; state.view = 'chat'; save(); renderApp(); return;
  }
  if (act === 'delchat'){
    e.stopPropagation();
    state.chats = state.chats.filter(x => x.id !== b.dataset.id);
    if (state.activeChat === b.dataset.id) state.activeChat = state.chats[0] ? state.chats[0].id : null;
    save(); renderApp(); return;
  }
  if (act === 'togglecanvas'){ state.canvasOpen = !state.canvasOpen; save(); $('#app').classList.toggle('nocanvas', !state.canvasOpen); paintCanvas(); return; }
  if (act === 'ctab'){ state.canvasTab = b.dataset.t; paintCanvas(); return; }
  if (act === 'viewcanvas'){ state.canvasOpen = true; state.canvasTab = 'canvas'; $('#app') && $('#app').classList.remove('nocanvas'); paintCanvas(); return; }
  if (act === 'watchlive'){ state.canvasOpen = true; state.canvasTab = 'live'; $('#app') && $('#app').classList.remove('nocanvas'); save(); paintCanvas(); return; }
  if (act === 'takeover'){ liveTakeover(); return; }
  if (act === 'pcrun'){
    const code = ($('#pccmd').value || '').trim();
    if (!code){ toast('Type some JS first.'); return; }
    const c = chat(); const pcId = pcIdFor(c);
    if (!pcId){ toast('No computer session in this chat yet.'); return; }
    $('#pccmd').value = '';
    try {
      const j = await window.LingonAuth.api('/api/pc/input', { method: 'POST', body: JSON.stringify({ pcId, code }) });
      const out = $('#pcout');
      if (out && j.stdout !== undefined){
        if (out.querySelector('.mut') && out.children.length <= 1) out.innerHTML = '';
        String(j.stdout).split('\n').filter(Boolean).forEach(t => out.insertAdjacentHTML('beforeend', `<div class="g">${esc(t)}</div>`));
        if (!String(j.stdout).trim()) out.insertAdjacentHTML('beforeend', `<div class="mut">ok (no output)</div>`);
        out.scrollTop = out.scrollHeight;
      }
      if (!j.ok) toast(j.error || 'Run failed');
    } catch (e) { toast(e.message); }
    return;
  }
  if (act === 'closestop-live'){
    const id = liveIdShown;
    if (id){ window.LingonAuth.api('/api/live/stop', { method: 'POST', body: JSON.stringify({ liveId: id }) }).catch(() => {}); }
    liveClose(); state.canvasTab = 'canvas'; save(); paintCanvas(); return;
  }
  if (act === 'openbrowser'){ toast('For safety, browsing stays contained in the sandbox window above.'); return; }
  if (act === 'artmenu'){ toast('Artifact saved — find it in Vault → Library.'); return; }
  if (act === 'chip'){
    if (!signedIn()){ state.pendingPrompt = b.dataset.t; save(); renderAuth(); return; }
    sendPrompt(b.dataset.t); return;
  }
  if (act === 'copycode'){ const t = $('#codebox'); if (t) navigator.clipboard && navigator.clipboard.writeText(t.textContent); toast('Copied'); return; }

  /* card resolutions (real accounts only — no anonymous approvals) */
  if (act === 'approve' && m){ if (!signedIn()){ renderAuth(); return; } resolveCard(c, m, { ok:true }, 'approved'); return; }
  if (act === 'deny' && m){ if (!signedIn()){ renderAuth(); return; } resolveCard(c, m, { ok:false }, 'denied'); return; }
  if (act === 'always' && m){
    state.vault.approvals.push({ id: uid(), key: m.card.key, label: m.card.title, at: Date.now() });
    save(); resolveCard(c, m, { ok:true, always:true }, 'always'); return;
  }
  if (act === 'connect' && m){
    // No fake OAuth: GitHub uses a PAT in Secrets; Gmail is not connected.
    resolveCard(c, m, { ok:false }, 'denied');
    toast(m.card.app === 'github' ? 'No OAuth here — save a GitHub PAT in Secrets instead.' : 'Gmail is not connected.');
    return;
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
  if (act === 'qopt' && m){ if (!signedIn()){ renderAuth(); return; } m.card.choice = b.dataset.o; resolveCard(c, m, { choice: b.dataset.o }, 'answered'); return; }
  if (act === 'download' && m){ dl(m.card.name, m.card.content); return; }

  /* vault / settings page */
  if (act === 'vtab'){ state.vaultTab = b.dataset.t; paintVault($('#main')); return; }
  const repaintSettings = () => {
    if (state.view === 'settings' && $('#main')) paintSettings($('#main'));
    else if ($('#main') && state.view === 'vault') paintVault($('#main'));
    if ($('#canvas')) paintCanvas();
  };
  if (act === 'reveal'){ const s = state.vault.secrets.find(x => x.id === b.dataset.id); if (s) s.revealed = !s.revealed; repaintSettings(); return; }
  if (act === 'delsecret'){ state.vault.secrets = state.vault.secrets.filter(x => x.id !== b.dataset.id); save(); repaintSettings(); paintSide(); toast('Secret deleted'); return; }
  if (act === 'addsecret'){
    const n = $('#vname').value.trim(), v = $('#vval').value;
    if (!n || !v){ toast('Name and value required.'); return; }
    const ref = 'sec_' + uid().slice(0, 4);
    state.vault.secrets.push({ id: ref, ref, name: n, value: v, at: Date.now() });
    save(); repaintSettings(); paintSide(); toast('Sealed in vault — agent gets ' + ref + ' only'); return;
  }
  if (act === 'toggleapp'){
    toast('No app connections to toggle — Apps is empty by design.');
    return;
  }
  if (act === 'signin'){ doAuth('signin'); return; }
  if (act === 'signup'){ doAuth('signup'); return; }
  if (act === 'pw-go'){ doAuth(authMode === 'signup' ? 'signup' : 'signin'); return; }
  if (act === 'google'){ authOAuth(); return; }
  if (act === 'pw-mode'){ const em = ((document.getElementById('aemail') || {}).value || '').trim(); const pe = document.getElementById('pwemail'); if (pe) pe.textContent = em; showAuthPane('authpw'); return; }
  if (act === 'auth-back'){ showAuthPane('authmain'); return; }
  if (act === 'auth-mode'){ authMode = authMode === 'signin' ? 'signup' : 'signin'; authPaintMode(); return; }
  if (act === 'otp-send'){ authOtpSend(); return; }
  if (act === 'otp-verify'){ authOtpVerify(); return; }
  if (act === 'signout'){
    window.LingonAuth.set(null);
    state.view = 'chat';
    render();
    return;
  }
  if (act === 'redeem'){
    const code = (($('#giftcode') || {}).value || '').trim();
    if (!code){ toast('Paste a gift code first.'); return; }
    try {
      const j = await window.LingonAuth.api('/api/billing/redeem', { method: 'POST', body: JSON.stringify({ code }) });
      billingCache = j.billing;
      toast(`Redeemed ${fmtC(j.credits)} credits ($${j.amount} gift).`);
      if (state.view === 'settings') paintSettings($('#main')); else paintBilling($('#main'));
      paintSide();
    } catch (e) { toast(e.message); }
    return;
  }
  if (act === 'checkout'){
    try {
      const j = await window.LingonAuth.api('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan: b.dataset.p }) });
      if (j.url) { window.location.href = j.url; return; }
      toast(j.note || 'Checkout started.');
    } catch (e) { toast(e.message); }
    return;
  }
  if (act === 'portal'){
    try {
      const j = await window.LingonAuth.api('/api/billing/portal', { method: 'POST', body: JSON.stringify({}) });
      if (j.url) { window.location.href = j.url; return; }
    } catch (e) { toast(e.message); }
    return;
  }
  if (act === 'upgrade'){
    try {
      const j = await window.LingonAuth.api('/api/billing/upgrade', { method: 'POST', body: JSON.stringify({ plan: b.dataset.p }) });
      if (j.url) { window.location.href = j.url; return; }
      toast(j.note || 'Request recorded.');
    } catch (e) { toast(e.message); }
    return;
  }
  if (act === 'revoke'){ state.vault.approvals = state.vault.approvals.filter(x => x.id !== b.dataset.id); save(); repaintSettings(); toast('Revoked — it will ask again'); return; }
  if (act === 'pmode'){ state.vault.mode = b.dataset.m; save(); repaintSettings(); return; }
  if (act === 'delmem'){ state.memory = state.memory.filter(x => x.id !== b.dataset.id); save(); repaintSettings(); paintSide(); return; }
  if (act === 'dlfile'){ const f = window.__fileRows && window.__fileRows[+b.dataset.i]; if (f) dl(f.name, f.content); return; }

  /* profile / appearance (shared by Settings + right slider) */
  if (act === 'p-color'){ state.agent.color = b.dataset.c; save(); paintSide(); paintCanvas(); if (state.view === 'settings') paintSettings($('#main')); else if (state.view === 'profile' && $('#main')) paintProfile($('#main')); return; }
  if (act === 'p-pers'){ state.agent.pers = b.dataset.p; save(); paintCanvas(); if (state.view === 'settings') paintSettings($('#main')); else if (state.view === 'profile' && $('#main')) paintProfile($('#main')); return; }
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

/* ---------------- boot (OAuth hash callback first) ---------------- */
async function bootHash(){
  // returns 'error' | 'google' | 'none' so boot can route correctly
  try {
    const q = new URLSearchParams(window.location.search);
    const err = q.get('auth_error');
    if (err){ window.history.replaceState(null, '', window.location.pathname); return 'error:' + err; }
    const h = window.location.hash || '';
    const m = h.match(/access_token=([^&]+)/);
    if (m){
      const r = h.match(/refresh_token=([^&]+)/);
      const access_token = decodeURIComponent(m[1]);
      const refresh_token = r ? decodeURIComponent(r[1]) : '';
      window.history.replaceState(null, '', window.location.pathname);
      window.LingonAuth.set({ access_token, refresh_token, user: null });
      try {
        const me = await window.LingonAuth.api('/api/auth/me');
        window.LingonAuth.set({ access_token, refresh_token, user: me.user });
        try { window.LingonConfig.userId = me.user.id; localStorage.setItem('belna.lastProvider', 'google'); } catch {}
        try { await syncFromBackend(); } catch {}
        // Route Google sign-ins through the same post-auth flow so a homepage
        // prompt lands in the agent chat with in-chat onboarding first.
        try { ensureOwnerScope(); if (me.user && me.user.id) { state.ownerId = me.user.id; state.view = 'chat'; save(); } } catch {}
        if (state.pendingPrompt && (!state.onboarded || !state.agent || state.agent.provisional)){
          setTimeout(() => { toast('Signed in as ' + me.user.email); startPendingPromptFlow(); }, 400);
        } else {
          setTimeout(() => toast('Signed in as ' + me.user.email), 400);
        }
        return 'google';
      } catch {
        window.LingonAuth.set(null);
        return 'error:Could not complete sign-in. Please try again.';
      }
    }
  } catch {}
  return 'none';
}
bootHash().then((st) => {
  expirePending();
  applyTheme();
  if (st && String(st).startsWith('error:')) {
    const msg = String(st).slice(6);
    // Land on the auth card so the failure is visible in context.
    renderAuth();
    const m = document.getElementById('amsg');
    if (m) m.textContent = 'Sign-in failed: ' + msg;
    else setTimeout(() => toast('Sign-in failed: ' + msg), 400);
    return;
  }
  if (st === 'google'){
    // afterSignIn routing already kicked off in bootHash (incl. pending prompt
    // → chat + in-chat onboarding). Just ensure correct view if no pending.
    if (state.pendingPrompt && (!state.onboarded || !state.agent || state.agent.provisional)){
      // startPendingPromptFlow already running via timeout above; ensure render fallback
      if (!document.getElementById('app')) renderApp();
    } else {
      render();
    }
    try {
      const q = new URLSearchParams(window.location.search);
      const f = q.get('billing');
      if (f) {
        window.history.replaceState(null, '', window.location.pathname);
        if (f === 'success') setTimeout(() => toast('Payment complete — your monthly credits are on the way. See Billing.'), 800);
        else if (f === 'cancelled') setTimeout(() => toast('Checkout cancelled — no charge made.'), 800);
        else if (f === 'portal') setTimeout(() => toast('Subscription updated.'), 800);
      }
    } catch {}
    return;
  }
  // No OAuth callback: signed-in users with a pending homepage prompt go
  // straight to chat + in-chat onboarding (message first, then setup).
  if (signedIn()){
    ensureOwnerScope();
    if (state.pendingPrompt && (!state.onboarded || !state.agent || state.agent.provisional)){
      startPendingPromptFlow();
      return;
    }
  }
  render();
  try {
    const q = new URLSearchParams(window.location.search);
    const f = q.get('billing');
    if (f) {
      window.history.replaceState(null, '', window.location.pathname);
      if (f === 'success') setTimeout(() => toast('Payment complete — your monthly credits are on the way. See Billing.'), 800);
      else if (f === 'cancelled') setTimeout(() => toast('Checkout cancelled — no charge made.'), 800);
      else if (f === 'portal') setTimeout(() => toast('Subscription updated.'), 800);
    }
  } catch {}
});
})();
