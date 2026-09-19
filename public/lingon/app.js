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
const fmtBytes = n => n < 1024 ? n + ' B' : n < 1024 * 1024 ? (n / 1024).toFixed(1) + ' KB' : (n / 1024 / 1024).toFixed(1) + ' MB';
const fmtWhen = ts => {
  const d = Date.now() - ts;
  if (d < 60e3) return 'now';
  if (d < 3600e3) return Math.floor(d / 60e3) + 'm';
  if (d < 86400e3) return Math.floor(d / 3600e3) + 'h';
  return new Date(ts).toLocaleDateString();
};
const fmtNext = ts => {
  const d = Number(ts) - Date.now();
  if (d <= 60e3) return 'in under 1m';
  if (d < 3600e3) return `in ${Math.ceil(d / 60e3)}m`;
  if (d < 86400e3) return `in ${Math.ceil(d / 3600e3)}h`;
  return `on ${new Date(ts).toLocaleDateString()}`;
};
async function copyText(text){
  if (navigator.clipboard && window.isSecureContext) return navigator.clipboard.writeText(String(text || ''));
  const t = document.createElement('textarea');
  t.value = String(text || ''); t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
  document.body.appendChild(t); t.select();
  try { document.execCommand('copy'); } finally { t.remove(); }
}

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
  menu:'<path d="M4 7h16M4 12h16M4 17h16"/>',
  alert:'<path d="M10.3 3.8L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.8a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  chatb:'<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2Z"/>',
  clock:'<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  copy:'<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
  attach:'<path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.49"/>',
  folder:'<path d="M3 6a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2-2Z"/>',
  card:'<rect x="1" y="4" width="22" height="16" rx="2"/><path d="M1 10h22"/>',
  gift:'<rect x="3" y="8" width="18" height="4" rx="1"/><path d="M12 8v13"/><path d="M19 12v7a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2v-7"/><path d="M7.5 8a2.5 2.5 0 0 1 0-5A4.8 8 0 0 1 12 8a4.8 8 0 0 1 4.5-5 2.5 2.5 0 0 1 0 5"/>',
};
const icon = (n, s = 16) => `<svg class="ic" width="${s}" height="${s}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${IC[n] || ''}</svg>`;

/* ---------------- file attachments (pending per promptbox) ---------------- */
let pendingFiles = []; // [{name, size, type, dataUrl}]
const MAX_ATTACH = 5;
const MAX_FILE_MB = 10;
function addFiles(fileList){
  for (const f of fileList){
    if (pendingFiles.length >= MAX_ATTACH){ toast(`Max ${MAX_ATTACH} files`); break; }
    if (f.size > MAX_FILE_MB * 1024 * 1024){ toast(`${f.name} exceeds ${MAX_FILE_MB} MB`); continue; }
    if (pendingFiles.some(p => p.name === f.name && p.size === f.size)) continue;
    const reader = new FileReader();
    reader.onload = () => {
      pendingFiles.push({ name: f.name, size: f.size, type: f.type, dataUrl: reader.result });
      paintAttachPills();
    };
    reader.readAsDataURL(f);
  }
}
function removeFile(idx){ pendingFiles.splice(idx, 1); paintAttachPills(); }
function clearFiles(){ pendingFiles = []; paintAttachPills(); }
function paintAttachPills(){
  document.querySelectorAll('.attach-pills').forEach(el => {
    if (!pendingFiles.length){ el.innerHTML = ''; return; }
    el.innerHTML = pendingFiles.map((f, i) =>
      `<span class="attach-pill">${icon('file',12)}<span class="ap-name">${esc(f.name.length > 20 ? f.name.slice(0,17)+'…' : f.name)}</span><span class="ap-size">${fmtBytes(f.size)}</span><button class="ap-x" data-act="rmfile" data-idx="${i}">${icon('x',10)}</button></span>`
    ).join('');
  });
}
function wirePromptBox(form, textarea, opts){
  if (!form || !textarea) return;
  // Hidden file input
  let fileInput = form.querySelector('input[type="file"]');
  if (!fileInput){
    fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.multiple = true; fileInput.style.display = 'none';
    fileInput.className = 'attach-input';
    form.appendChild(fileInput);
  }
  fileInput.onchange = () => { if (fileInput.files.length) addFiles(fileInput.files); fileInput.value = ''; };
  // Plus button triggers file picker
  const plus = form.querySelector('.iconbtn[data-act="attach"]');
  if (plus) plus.onclick = e => { e.preventDefault(); fileInput.click(); };
  // Drag & drop on the entire promptbox
  const box = form.closest('.promptbox') || form;
  box.addEventListener('dragover', e => { e.preventDefault(); e.stopPropagation(); box.classList.add('dragover'); });
  box.addEventListener('dragleave', e => { e.preventDefault(); box.classList.remove('dragover'); });
  box.addEventListener('drop', e => { e.preventDefault(); box.classList.remove('dragover'); if (e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  // Paste files from clipboard
  textarea.addEventListener('paste', e => {
    const items = e.clipboardData && e.clipboardData.items;
    if (!items) return;
    const files = [];
    for (const it of items){ if (it.kind === 'file'){ const f = it.getAsFile(); if (f) files.push(f); } }
    if (files.length) addFiles(files);
  });
}

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
  subAgents:[], triggerOptions:{ schedules:[15,60,360,1440], apps:[] },
  // Composio connected apps (Belna Apps) — loaded from /api/composio/apps
  composioApps:[], composioLoading:false, appQuery:'', appFilter:'all',
  // right-side canvas: canvasTab 'agent' | 'canvas' | 'trace' | 'subagents' | 'mail' | 'wallet';
  // agentTab picks agent-panel content: 'appearance' | 'approvals' | 'library'
  agentTab:'appearance', walletTab:'wallet', mailTab:'inbox',
  // settings / apps rework
  settingsTab:'profiles', userMenuOpen:false,
  userProfile:null, browserProfile:{ profile:'Default', sandbox:true, allowlist:true },
});
let state;
let mobileNavOpen = false;
try { state = Object.assign(fresh(), JSON.parse(localStorage.getItem(LS) || 'null')) || fresh(); }
catch (e) { state = fresh(); }
if (!state.vault) state.vault = fresh().vault;
// Canvas is never open by default — user or a fresh artifact opens it.
state.canvasOpen = false;
if (!state.agentTab || state.agentTab === 'subagents') state.agentTab = 'appearance';
if (state.agentPanel) state.canvasTab = 'agent';
delete state.agentPanel;
// Migrate legacy nested sub-agents tab to its own top-level tab next to Trace.
if (state.canvasTab === 'agent' && state.agentTab === 'subagents') state.canvasTab = 'subagents';
if (!['agent', 'canvas', 'trace', 'subagents', 'mail', 'wallet'].includes(state.canvasTab)) state.canvasTab = 'canvas';
if (!state.walletTab) state.walletTab = 'wallet';
if (!state.mailTab) state.mailTab = 'inbox';
if (!state.settingsTab) state.settingsTab = 'profiles';
if (!state.browserProfile) state.browserProfile = fresh().browserProfile;
if (!Array.isArray(state.subAgents)) state.subAgents = [];
if (!state.triggerOptions) state.triggerOptions = fresh().triggerOptions;
if (!Array.isArray(state.composioApps)) state.composioApps = [];
if (typeof state.appQuery !== 'string') state.appQuery = '';
if (!state.appFilter) state.appFilter = 'all';
// Honest apps: no fake OAuth connections exist — always empty.
state.vault.apps = [];
const save = () => localStorage.setItem(LS, JSON.stringify(state));
const taskRuns = new Map();

// Remove implementation details left in conversations by older app versions.
const legacyInternalCopy = /(?:powered by \*\*Arche|live backend|through (?:my|the) backend|backend vault|Supabase Auth|Supabase-backed|Agents-API|asking Gemini|summarized with Gemini|generated by Gemini|sandboxed harness|model context)/i;
const neutralInternalReply = `I can't provide or speculate about internal implementation, system, or provider details. I can explain my capabilities and privacy protections at a high level, or help with your task.`;
let scrubbedLegacyChat = false;
for (const c of state.chats || []) {
  if (c.coordinatorRuns) { c.coordinatorRuns = 0; scrubbedLegacyChat = true; }
  if (c.busy && !c.onboarding) { c.busy = false; scrubbedLegacyChat = true; }
  if (c.activeTask && c.activeTask.status === 'running') {
    c.activeTask.status = 'interrupted';
    c.activeTask.finishedAt = Date.now();
    c.busy = false;
    const delegation = (c.messages || []).find((m) => m.id === c.activeTask.cardMessageId && m.kind === 'card');
    if (delegation?.card) {
      delegation.card.status = 'interrupted';
      for (const worker of delegation.card.agents || []) { worker.status = 'interrupted'; worker.note = 'page reloaded'; }
    }
    scrubbedLegacyChat = true;
  }
  for (const m of c.messages || []) {
    if (m.kind === 'text' && m.role === 'agent' && legacyInternalCopy.test(String(m.text || ''))) {
      m.text = neutralInternalReply;
      scrubbedLegacyChat = true;
    }
    if (m.kind === 'tools' && Array.isArray(m.items)) {
      const kept = m.items.filter((item) => !legacyInternalCopy.test(`${item.t || ''} ${item.d || ''}`));
      if (kept.length !== m.items.length) {
        m.items = kept;
        scrubbedLegacyChat = true;
      }
    }
  }
  if (Array.isArray(c.trace)) {
    const kept = c.trace.filter((item) => !legacyInternalCopy.test(String(item.t || '')));
    if (kept.length !== c.trace.length) {
      c.trace = kept;
      scrubbedLegacyChat = true;
    }
  }
}
if (scrubbedLegacyChat) save();

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
  try {
    const [agents, options, automationChats] = await Promise.all([
      window.LingonAuth.api('/api/sub-agents'),
      window.LingonAuth.api('/api/trigger-options'),
      window.LingonAuth.api('/api/automation-chats'),
    ]);
    state.subAgents = Array.isArray(agents.subAgents) ? agents.subAgents : [];
    state.triggerOptions = options || fresh().triggerOptions;
    try {
      const aj = await window.LingonAuth.api('/api/composio/apps');
      if (Array.isArray(aj.apps)) state.composioApps = aj.apps;
    } catch {}
    for (const remote of automationChats.chats || []) {
      const messages = (remote.messages || []).map((m) => ({
        id:m.id,
        role:m.role === 'assistant' ? 'agent' : m.role,
        kind:m.kind || 'text',
        text:m.text || '',
        automation:true,
      }));
      const existing = state.chats.find((item) => item.id === remote.id);
      const mapped = {
        id:remote.id,
        title:remote.title || 'Sub-agent',
        messages,
        trace:[], artifact:null,
        createdAt:new Date(remote.created_at || remote.createdAt || Date.now()).getTime(),
        updatedAt:new Date(remote.updated_at || remote.updatedAt || Date.now()).getTime(),
        source:'automation',
        subAgentId:remote.sub_agent_id || remote.subAgentId,
      };
      if (existing) Object.assign(existing, mapped);
      else state.chats.unshift(mapped);
    }
    state.chats.sort((a, b) => Number(b.updatedAt || b.createdAt || 0) - Number(a.updatedAt || a.createdAt || 0));
  } catch {}
  try { await ensureMailbox(); } catch {}
  save();
}

async function refreshSubAgents(repaint = true) {
  if (!signedIn()) return;
  try {
    const [agents, options] = await Promise.all([
      window.LingonAuth.api('/api/sub-agents'),
      window.LingonAuth.api('/api/trigger-options'),
    ]);
    state.subAgents = Array.isArray(agents.subAgents) ? agents.subAgents : [];
    state.triggerOptions = options || state.triggerOptions;
    if (state.subAgentComposer) {
      const nameInput = $('#subname');
      const promptInput = $('#subprompt');
      if (nameInput) state.subAgentDraftName = nameInput.value;
      if (promptInput) state.subAgentDraft = promptInput.value;
    }
    save();
    if (repaint && state.canvasOpen && state.canvasTab === 'subagents') paintCanvas();
  } catch (e) { toast(e.message || 'Could not load sub-agents.'); }
}

/* ---------------- Belna Apps via Composio (per-user OAuth) ---------------- */
async function refreshComposioApps() {
  if (!signedIn()) return;
  state.composioLoading = true;
  if (state.view === 'apps' && $('#main')) paintApps($('#main'));
  try {
    const j = await window.LingonAuth.api('/api/composio/apps');
    if (Array.isArray(j.apps)) state.composioApps = j.apps;
  } catch (e) {
    toast(e.message || 'Could not load apps.');
  } finally {
    state.composioLoading = false;
    save();
    if (state.view === 'apps' && $('#main')) paintApps($('#main'));
    try {
      const o = await window.LingonAuth.api('/api/trigger-options');
      state.triggerOptions = o || state.triggerOptions;
      save();
    } catch {}
  }
}

async function connectComposioApp(toolkit, authConfigId) {
  try {
    toast(`Opening ${toolkit} connection…`);
    const j = await window.LingonAuth.api('/api/composio/connect', {
      method: 'POST',
      body: JSON.stringify({ toolkit, authConfigId }),
    });
    if (j.redirectUrl) {
      window.open(j.redirectUrl, '_blank', 'noopener');
      toast('Finish signing in, then press Refresh.');
    }
  } catch (e) {
    toast(e.message || 'Could not start connection.');
  }
}

async function disconnectComposioApp(app) {
  if (!app || !app.connectedAccountId) return;
  if (!window.confirm(`Disconnect ${app.name}? Your agent will lose access until you reconnect.`)) return;
  try {
    await window.LingonAuth.api('/api/composio/disconnect', {
      method: 'POST',
      body: JSON.stringify({ connectedAccountId: app.connectedAccountId }),
    });
    state.composioApps = state.composioApps.map((a) =>
      a.toolkit === app.toolkit ? { ...a, connected: false, connectedAccountId: null, status: 'NOT_CONNECTED' } : a
    );
    save();
    paintApps($('#main'));
    toast(`${app.name} disconnected.`);
  } catch (e) {
    toast(e.message || 'Could not disconnect.');
  }
}

function composioAppByToolkit(toolkit) {
  return (state.composioApps || []).find((a) => a.toolkit === String(toolkit || '').toLowerCase()) || null;
}

function subAgentTriggerLabel(subAgent) {
  const trigger = subAgent?.trigger || {};
  if (trigger.type === 'schedule') {
    const minutes = Number(trigger.intervalMinutes || 0);
    if (minutes === 1440) return 'Every day';
    if (minutes === 10080) return 'Every week';
    if (minutes >= 60 && minutes % 60 === 0) return `Every ${minutes / 60}h`;
    return `Every ${minutes}m`;
  }
  if (trigger.type === 'app') {
    const opt = (state.triggerOptions?.apps || []).find((a) => a.id === trigger.app);
    const label = opt ? opt.name : String(trigger.app || 'app');
    return `${label} · ${trigger.event}`;
  }
  if (trigger.type === 'subagent') {
    const source = state.subAgents.find((item) => item.id === trigger.sourceAgentId);
    return `After ${source ? source.name : 'sub-agent'}`;
  }
  return 'Trigger';
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
let sandboxLeaseId = null;
let sandboxLeaseTimer = null;
function sandboxLeaseRequest(action) {
  if (!sandboxLeaseId || !window.LingonAuth || !window.LingonAuth.signedIn()) return Promise.resolve(null);
  return window.LingonAuth.api('/api/sandbox/lease', {
    method: 'POST',
    body: JSON.stringify({ action, leaseId: sandboxLeaseId, kind: 'app' }),
  }).catch(() => null);
}
function startSandboxLease() {
  if (!signedIn()) return;
  if (!sandboxLeaseId) sandboxLeaseId = 'app_' + Math.random().toString(36).slice(2) + '_' + Date.now().toString(36);
  if (sandboxLeaseTimer) return;
  sandboxLeaseRequest('acquire');
  sandboxLeaseTimer = setInterval(() => {
    if (signedIn()) sandboxLeaseRequest('renew');
    else stopSandboxLease();
  }, 25000);
}
function stopSandboxLease() {
  if (sandboxLeaseTimer) { clearInterval(sandboxLeaseTimer); sandboxLeaseTimer = null; }
  const id = sandboxLeaseId;
  sandboxLeaseId = null;
  if (!id) return;
  try {
    const sess = window.LingonAuth && window.LingonAuth.get && window.LingonAuth.get();
    const token = sess && sess.access_token;
    if (token) fetch('/api/sandbox/lease', { method: 'POST', keepalive: true, headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify({ action: 'release', leaseId: id, kind: 'app' }) }).catch(() => {});
  } catch {}
}
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
  if (!signedIn()) {
    stopSandboxLease();
    const appRoute = window.location.pathname.replace(/\/+$/, '') === '/app';
    return state.pendingPrompt || appRoute ? renderAuth() : renderLanding();
  }
  ensureOwnerScope();
  startSandboxLease();
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
   AUTH — Sign-in / Sign-up card: Google, one-time code, password
================================================================ */
let authMode = 'signin'; // 'signin' | 'signup'
function renderAuth(){
  let lastGoogle = false;
  try { lastGoogle = localStorage.getItem('belna.lastProvider') === 'google'; } catch {}
  root.innerHTML = `
  <div class="fadeup authpage">
    <div class="auth-top"><span>Account &amp; Credit Usage</span><a href="/pricing">Open Docs &#8599;</a></div>
    <div class="authcard">
      <h1>${state.pendingPrompt ? 'Sign up / log in to send it to your agent' : 'Log in to manage profile and billing'}</h1>
      ${state.pendingPrompt ? `<div class="kv" style="margin-top:16px;text-align:left"><div class="row"><span style="color:var(--mut)">${icon('chatb',16)}</span><div><b style="font-weight:600">${esc(state.pendingPrompt.length > 140 ? state.pendingPrompt.slice(0, 140) + '…' : state.pendingPrompt)}</b><div class="sub">Your message is saved — it will appear in the agent chat right after you sign in, before anything runs.</div></div></div></div>` : ''}
      <button class="btn gbtn" data-act="google"><span class="glogo" aria-hidden="true"><svg width="20" height="20" xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" xml:space="preserve" overflow="hidden" viewBox="0 0 268.152 273.883"><defs><linearGradient id="google__a"><stop offset="0" stop-color="#0fbc5c"/><stop offset="1" stop-color="#0cba65"/></linearGradient><linearGradient id="google__g"><stop offset=".231" stop-color="#0fbc5f"/><stop offset=".312" stop-color="#0fbc5f"/><stop offset=".366" stop-color="#0fbc5e"/><stop offset=".458" stop-color="#0fbc5d"/><stop offset=".54" stop-color="#12bc58"/><stop offset=".699" stop-color="#28bf3c"/><stop offset=".771" stop-color="#38c02b"/><stop offset=".861" stop-color="#52c218"/><stop offset=".915" stop-color="#67c30f"/><stop offset="1" stop-color="#86c504"/></linearGradient><linearGradient id="google__h"><stop offset=".142" stop-color="#1abd4d"/><stop offset=".248" stop-color="#6ec30d"/><stop offset=".312" stop-color="#8ac502"/><stop offset=".366" stop-color="#a2c600"/><stop offset=".446" stop-color="#c8c903"/><stop offset=".54" stop-color="#ebcb03"/><stop offset=".616" stop-color="#f7cd07"/><stop offset=".699" stop-color="#fdcd04"/><stop offset=".771" stop-color="#fdce05"/><stop offset=".861" stop-color="#ffce0a"/></linearGradient><linearGradient id="google__f"><stop offset=".316" stop-color="#ff4c3c"/><stop offset=".604" stop-color="#ff692c"/><stop offset=".727" stop-color="#ff7825"/><stop offset=".885" stop-color="#ff8d1b"/><stop offset="1" stop-color="#ff9f13"/></linearGradient><linearGradient id="google__b"><stop offset=".231" stop-color="#ff4541"/><stop offset=".312" stop-color="#ff4540"/><stop offset=".458" stop-color="#ff4640"/><stop offset=".54" stop-color="#ff473f"/><stop offset=".699" stop-color="#ff5138"/><stop offset=".771" stop-color="#ff5b33"/><stop offset=".861" stop-color="#ff6c29"/><stop offset="1" stop-color="#ff8c18"/></linearGradient><linearGradient id="google__d"><stop offset=".408" stop-color="#fb4e5a"/><stop offset="1" stop-color="#ff4540"/></linearGradient><linearGradient id="google__c"><stop offset=".132" stop-color="#0cba65"/><stop offset=".21" stop-color="#0bb86d"/><stop offset=".297" stop-color="#09b479"/><stop offset=".396" stop-color="#08ad93"/><stop offset=".477" stop-color="#0aa6a9"/><stop offset=".568" stop-color="#0d9cc6"/><stop offset=".667" stop-color="#1893dd"/><stop offset=".769" stop-color="#258bf1"/><stop offset=".859" stop-color="#3086ff"/></linearGradient><linearGradient id="google__e"><stop offset=".366" stop-color="#ff4e3a"/><stop offset=".458" stop-color="#ff8a1b"/><stop offset=".54" stop-color="#ffa312"/><stop offset=".616" stop-color="#ffb60c"/><stop offset=".771" stop-color="#ffcd0a"/><stop offset=".861" stop-color="#fecf0a"/><stop offset=".915" stop-color="#fecf08"/><stop offset="1" stop-color="#fdcd01"/></linearGradient><linearGradient xlink:href="#google__a" id="google__s" x1="219.7" x2="254.467" y1="329.535" y2="329.535" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#google__b" id="google__m" cx="109.627" cy="135.862" r="71.46" fx="109.627" fy="135.862" gradientTransform="matrix(-1.93688 1.043 1.45573 2.55542 290.525 -400.634)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#google__c" id="google__n" cx="45.259" cy="279.274" r="71.46" fx="45.259" fy="279.274" gradientTransform="matrix(-3.5126 -4.45809 -1.69255 1.26062 870.8 191.554)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#google__d" id="google__l" cx="304.017" cy="118.009" r="47.854" fx="304.017" fy="118.009" gradientTransform="matrix(2.06435 0 0 2.59204 -297.679 -151.747)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#google__e" id="google__o" cx="181.001" cy="177.201" r="71.46" fx="181.001" fy="177.201" gradientTransform="matrix(-.24858 2.08314 2.96249 .33417 -255.146 -331.164)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#google__f" id="google__p" cx="207.673" cy="108.097" r="41.102" fx="207.673" fy="108.097" gradientTransform="matrix(-1.2492 1.34326 -3.89684 -3.4257 880.501 194.905)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#google__g" id="google__r" cx="109.627" cy="135.862" r="71.46" fx="109.627" fy="135.862" gradientTransform="matrix(-1.93688 -1.043 1.45573 -2.55542 290.525 838.683)" gradientUnits="userSpaceOnUse"/><radialGradient xlink:href="#google__h" id="google__j" cx="154.87" cy="145.969" r="71.46" fx="154.87" fy="145.969" gradientTransform="matrix(-.0814 -1.93722 2.92674 -.11625 -215.135 632.86)" gradientUnits="userSpaceOnUse"/><filter id="google__q" width="1.097" height="1.116" x="-.048" y="-.058" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation="1.701"/></filter><filter id="google__k" width="1.033" height="1.02" x="-.017" y="-.01" color-interpolation-filters="sRGB"><feGaussianBlur stdDeviation=".242"/></filter><clipPath id="google__i" clipPathUnits="userSpaceOnUse"><path d="M371.378 193.24H237.083v53.438h77.167c-1.241 7.563-4.026 15.003-8.105 21.786-4.674 7.773-10.451 13.69-16.373 18.196-17.74 13.498-38.42 16.258-52.783 16.258-36.283 0-67.283-23.286-79.285-54.928-.484-1.149-.805-2.335-1.197-3.507a81.115 81.115 0 0 1-4.101-25.448c0-9.226 1.569-18.057 4.43-26.398 11.285-32.897 42.985-57.467 80.179-57.467 7.481 0 14.685.884 21.517 2.648a77.668 77.668 0 0 1 33.425 18.25l40.834-39.712c-24.839-22.616-57.219-36.32-95.844-36.32-30.878 0-59.386 9.553-82.748 25.7-18.945 13.093-34.483 30.625-44.97 50.985-9.753 18.879-15.094 39.8-15.094 62.294 0 22.495 5.35 43.633 15.103 62.337v.126c10.302 19.857 25.368 36.954 43.678 49.988 15.997 11.386 44.68 26.551 84.031 26.551 22.63 0 42.687-4.051 60.375-11.644 12.76-5.478 24.065-12.622 34.301-21.804 13.525-12.132 24.117-27.139 31.347-44.404 7.23-17.265 11.097-36.79 11.097-57.957 0-9.858-.998-19.87-2.689-28.968Z"/></clipPath></defs><g clip-path="url(#google__i)" transform="matrix(.95792 0 0 .98525 -90.174 -78.856)"><path fill="url(#google__j)" d="M92.076 219.958c.148 22.14 6.501 44.983 16.117 63.424v.127c6.949 13.392 16.445 23.97 27.26 34.452l65.327-23.67c-12.36-6.235-14.246-10.055-23.105-17.026-9.054-9.066-15.802-19.473-20.004-31.677h-.17l.17-.127c-2.765-8.058-3.037-16.613-3.14-25.503Z" filter="url(#google__k)"/><path fill="url(#google__l)" d="M237.083 79.025c-6.456 22.526-3.988 44.421 0 57.161 7.457.006 14.64.888 21.45 2.647a77.662 77.662 0 0 1 33.424 18.25l41.88-40.726c-24.81-22.59-54.667-37.297-96.754-37.332Z" filter="url(#google__k)"/><path fill="url(#google__m)" d="M236.943 78.847c-31.67 0-60.91 9.798-84.871 26.359a145.533 145.533 0 0 0-24.332 21.15c-1.904 17.744 14.257 39.551 46.262 39.37 15.528-17.936 38.495-29.542 64.056-29.542l.07.002-1.044-57.335c-.048 0-.093-.004-.14-.004Z" filter="url(#google__k)"/><path fill="url(#google__n)" d="m341.475 226.379-28.268 19.285c-1.24 7.562-4.028 15.002-8.107 21.786-4.674 7.772-10.45 13.69-16.373 18.196-17.702 13.47-38.328 16.244-52.687 16.255-14.842 25.102-17.444 37.675 1.043 57.934 22.877-.016 43.157-4.117 61.046-11.796 12.931-5.551 24.388-12.792 34.761-22.097 13.706-12.295 24.442-27.503 31.769-45 7.327-17.497 11.245-37.282 11.245-58.734Z" filter="url(#google__k)"/><path fill="#3086ff" d="M234.996 191.21v57.498h136.006c1.196-7.874 5.152-18.064 5.152-26.5 0-9.858-.996-21.899-2.687-30.998Z" filter="url(#google__k)"/><path fill="url(#google__o)" d="M128.39 124.327c-8.394 9.119-15.564 19.326-21.249 30.364-9.753 18.879-15.094 41.83-15.094 64.324 0 .317.026.627.029.944 4.32 8.224 59.666 6.649 62.456 0-.004-.31-.039-.613-.039-.924 0-9.226 1.57-16.026 4.43-24.367 3.53-10.289 9.056-19.763 16.123-27.926 1.602-2.031 5.875-6.397 7.121-9.016.475-.997-.862-1.557-.937-1.908-.083-.393-1.876-.077-2.277-.37-1.275-.929-3.8-1.414-5.334-1.845-3.277-.921-8.708-2.953-11.725-5.06-9.536-6.658-24.417-14.612-33.505-24.216Z" filter="url(#google__k)"/><path fill="url(#google__p)" d="M162.099 155.857c22.112 13.301 28.471-6.714 43.173-12.977l-25.574-52.664a144.74 144.74 0 0 0-26.543 14.504c-12.316 8.512-23.192 18.9-32.176 30.72Z" filter="url(#google__q)"/><path fill="url(#google__r)" d="M171.099 290.222c-29.683 10.641-34.33 11.023-37.062 29.29a144.806 144.806 0 0 0 16.792 13.984c15.996 11.386 46.766 26.551 86.118 26.551.046 0 .09-.004.137-.004v-59.157l-.094.002c-14.736 0-26.512-3.843-38.585-10.527-2.977-1.648-8.378 2.777-11.123.799-3.786-2.729-12.9 2.35-16.183-.938Z" filter="url(#google__k)"/><path fill="url(#google__s)" d="M219.7 299.023v59.996c5.506.64 11.236 1.028 17.247 1.028 6.026 0 11.855-.307 17.52-.872v-59.748a105.119 105.119 0 0 1-17.477 1.461c-5.932 0-11.7-.686-17.29-1.865Z" filter="url(#google__k)" opacity=".5"/></g></svg></span>Continue with Google${lastGoogle ? '<span class="lastused">Last used</span>' : ''}</button>
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
function pctOff(p){
  const was = Number(p && p.was), price = Number(p && p.price);
  if (!was || !(was > price) || !isFinite(was) || !isFinite(price)) return '';
  const pct = Math.round((was - price) / was * 100);
  return `<span class="pct-off">-${pct}%</span>`;
}
/* Extra-credit tiers for the "PURCHASED CREDITS" dropdown (credits → +$/mo). */
const EXTRA_CREDIT_TIERS = [
  { credits: 0, price: 0 },
  { credits: 50, price: 15 },
  { credits: 100, price: 30 },
  { credits: 200, price: 45 },
  { credits: 300, price: 60 },
  { credits: 500, price: 75 },
  { credits: 750, price: 100 },
  { credits: 1000, price: 125 },
];
function extraTierLabel(t){
  if (!t || !t.credits) return 'None';
  return `${t.credits} credits — +$${t.price}`;
}
function giftCardHtml(p){
  const amt = Number(p.giftUsd || 0);
  if (!amt) return '';
  return `<div class="gift-strip"><span class="gift-thumb">$${amt}</span>`
    + `<span class="gift-strip-text">+ FREE $${amt} gift card</span></div>`;
}
function creditSliderHtml(p){
  const id = String(p.id || '');
  if (id !== 'pro' && id !== 'max') return '';
  const basePrice = Number(p.price || 0), baseCredits = Number(p.credits || 0);
  const opts = EXTRA_CREDIT_TIERS.map((t, i) =>
    `<button type="button" class="credit-opt${i === 0 ? ' sel' : ''}" role="option" aria-selected="${i === 0 ? 'true' : 'false'}" data-credits="${t.credits}" data-price="${t.price}"><span>${extraTierLabel(t)}</span><span class="tick">✓</span></button>`
  ).join('');
  return `<div class="credit-add" data-base-price="${basePrice}" data-base-credits="${baseCredits}" data-plan="${esc(id)}">`
    + `<label class="credit-select-label">PURCHASED CREDITS</label>`
    + `<div class="credit-select" data-plan="${esc(id)}" data-extra-credits="0" data-extra-price="0">`
    + `<button type="button" class="credit-select-btn" aria-haspopup="listbox" aria-expanded="false"><span class="credit-select-val">None</span><span class="chev"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><path d="M4 6l4 4 4-4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg></span></button>`
    + `<div class="credit-select-menu" role="listbox">${opts}</div>`
    + `</div>`
    + `<div class="credit-add-sub"><span class="credit-add-total">Total ${baseCredits} credits · $${basePrice}/mo</span></div></div>`;
}
function extraCreditsFor(plan){
  const sel = plan && document.querySelector(`.credit-select[data-plan="${plan}"]`);
  if (sel) return { credits: Math.max(0, parseFloat(sel.dataset.extraCredits || '0')), price: Math.max(0, parseFloat(sel.dataset.extraPrice || '0')) };
  const slider = plan && document.querySelector(`.credit-slider[data-plan="${plan}"]`);
  if (slider) { const c = Math.max(0, parseFloat(slider.value || '0')); return { credits: c, price: c * 0.5 }; }
  return { credits: 0, price: 0 };
}
function wireBillingSliders(root){
  if (!root || !root.querySelectorAll) return;
  root.querySelectorAll('.credit-add').forEach((box) => {
    const slider = box.querySelector('.credit-slider');
    if (slider && !slider.dataset.wired) {
      slider.dataset.wired = '1';
      const val = box.querySelector('.credit-add-val');
      const total = box.querySelector('.credit-add-total');
      const basePrice = parseFloat(box.dataset.basePrice || '0');
      const baseCredits = parseFloat(box.dataset.baseCredits || '0');
      const paint = () => {
        const extra = parseFloat(slider.value || '0');
        const extraCost = extra * 0.5;
        if (val) val.textContent = '+' + extra + ' credits' + (extra ? ' (+$' + extraCost.toFixed(extraCost % 1 ? 2 : 0) + '/mo)' : '');
        if (total) total.textContent = 'Total ' + (baseCredits + extra) + ' credits · $' + (basePrice + extraCost).toFixed((basePrice + extraCost) % 1 ? 2 : 0) + '/mo';
      };
      slider.addEventListener('input', paint);
      paint();
    }
    const sel = box.querySelector('.credit-select');
    if (sel && !sel.dataset.wired) {
      sel.dataset.wired = '1';
      const btn = sel.querySelector('.credit-select-btn');
      const val = sel.querySelector('.credit-select-val');
      const total = box.querySelector('.credit-add-total');
      const basePrice = parseFloat(box.dataset.basePrice || '0');
      const baseCredits = parseFloat(box.dataset.baseCredits || '0');
      const fmt = (n) => String(Math.round(Number(n || 0) * 100) / 100);
      const paint = () => {
        const extra = parseFloat(sel.dataset.extraCredits || '0');
        const cost = parseFloat(sel.dataset.extraPrice || '0');
        const opt = sel.querySelector(`.credit-opt[data-credits="${extra}"][data-price="${cost}"]`);
        if (val) val.textContent = opt ? opt.querySelector('span').textContent : (extra ? `${fmt(extra)} credits — +$${fmt(cost)}` : 'None');
        if (total) total.textContent = 'Total ' + fmt(baseCredits + extra) + ' credits · $' + fmt(basePrice + cost) + '/mo';
        if (btn) btn.setAttribute('aria-expanded', sel.classList.contains('open') ? 'true' : 'false');
      };
      if (btn) btn.addEventListener('click', (e) => {
        e.stopPropagation();
        document.querySelectorAll('.credit-select.open').forEach((o) => { if (o !== sel) { o.classList.remove('open'); } });
        sel.classList.toggle('open');
        paint();
      });
      sel.querySelectorAll('.credit-opt').forEach((opt) => {
        opt.addEventListener('click', (e) => {
          e.stopPropagation();
          sel.dataset.extraCredits = opt.dataset.credits || '0';
          sel.dataset.extraPrice = opt.dataset.price || '0';
          sel.querySelectorAll('.credit-opt').forEach((o) => { o.classList.remove('sel'); o.setAttribute('aria-selected', 'false'); });
          opt.classList.add('sel');
          opt.setAttribute('aria-selected', 'true');
          sel.classList.remove('open');
          paint();
        });
      });
      paint();
    }
  });
  if (!document.documentElement.dataset.creditSelectWired) {
    document.documentElement.dataset.creditSelectWired = '1';
    document.addEventListener('click', () => {
      let changed = false;
      document.querySelectorAll('.credit-select.open').forEach((o) => { o.classList.remove('open'); changed = true; });
      if (changed) document.querySelectorAll('.credit-select-btn').forEach((b) => b.setAttribute('aria-expanded', 'false'));
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') document.querySelectorAll('.credit-select.open').forEach((o) => o.classList.remove('open'));
    });
  }
}
function planCards(b){
  const ids = ['free', 'pro', 'max'];
  const list = Array.isArray(b && b.plans) ? b.plans : ids.map((id) => (b && b.plans && b.plans[id]) || { id, name: id });
  const byId = {};
  list.forEach((p) => { if (p && p.id) byId[p.id] = p; });
  const pFree = byId.free || { id: 'free', name: 'Free', price: 0, was: null, credits: 20, giftUsd: 0 };
  const pPro = byId.pro || { id: 'pro', name: 'Pro', price: 30, was: 50, credits: 60, giftUsd: 50, interval: 'month' };
  const pMax = byId.max || { id: 'max', name: 'Max', price: 50, was: 100, credits: 100, giftUsd: 100, interval: 'month' };
  const isCur = (id) => b && b.plan === id;
  const curChip = '<span class="chip green plan-state">current</span>';
  const freeBtn = isCur('free')
    ? curChip
    : '<span class="chip plan-state">default</span>';
  const proBtn = isCur('pro')
    ? curChip
    : `<button class="btn" data-act="checkout" data-p="pro">Get ${esc(pPro.name || 'Pro')}</button>`;
  const maxBtn = isCur('max')
    ? curChip
    : `<button class="btn ghost" data-act="checkout" data-p="max">Get ${esc(pMax.name || 'Max')}</button>`;
  const proPrice = `$${pPro.price}${pPro.was ? ` <s>$${pPro.was}</s>` : ''} ${pctOff(pPro)}<span class="mut" style="font-size:14px">/mo</span>`;
  const maxPrice = `$${pMax.price}${pMax.was ? ` <s>$${pMax.was}</s>` : ''} ${pctOff(pMax)}<span class="mut" style="font-size:14px">/mo</span>`;
  return `<div class="pcards">`
    + `<div class="pcard"><div class="pname">${esc(pFree.name || 'Free')}</div><div class="pprice">$${pFree.price}</div>`
    + `<p class="pdesc">${fmtC(pFree.credits)} starter credits. Sign in and start.</p>`
    + `<ul><li><span>✓</span>Have your own agent</li></ul>`
    + freeBtn + `</div>`
    + `<div class="pcard pop"><span class="poptag">MOST POPULAR</span><div class="pname">${esc(pPro.name || 'Pro')}</div><div class="pprice">${proPrice}</div>`
    + `<p class="pdesc">${fmtC(pPro.credits)} credits every month.</p>`
    + `<ul><li><span>✓</span>Everything in Free</li><li><span>✓</span>${fmtC(pPro.credits)} credits monthly</li><li><span>✓</span>Priority harness capacity</li></ul>`
    + creditSliderHtml(pPro) + proBtn + giftCardHtml(pPro) + `</div>`
    + `<div class="pcard"><div class="pname">${esc(pMax.name || 'Max')}</div><div class="pprice">${maxPrice}</div>`
    + `<p class="pdesc">${fmtC(pMax.credits)} credits every month.</p>`
    + `<ul><li><span>✓</span>Everything in Pro</li><li><span>✓</span>${fmtC(pMax.credits)} credits monthly</li><li><span>✓</span>Highest harness capacity</li></ul>`
    + creditSliderHtml(pMax) + maxBtn + giftCardHtml(pMax) + `</div>`
    + `</div>`;
}
function billSummary(b){
  const manage = b && b.plan !== 'free'
    ? ` <button class="btn ghost small" data-act="portal" style="margin-left:8px">Manage subscription</button>`
    : '';
  const pct = b.creditsGranted ? Math.min(100, Math.max(0, b.creditsUsed / b.creditsGranted * 100)) : 0;
  const remaining = Number(b.credits) || 0;
  const barColor = remaining > 5 ? 'var(--green)' : remaining > 0 ? '#f5a623' : '#e74c3c';
  return `<div class="kv">
    <div class="row"><span style="color:var(--mut)">${icon('spark',16)}</span>
      <div style="flex:1"><b>${esc((b.plan || 'free').toUpperCase())}</b> plan · <span style="color:var(--soft)">${esc(b.status || 'active')}</span>${manage}
      </div>
      <div class="rgt"><span class="chip ${remaining > 5 ? 'green' : ''}">${fmtC(b.credits)} credits left</span></div>
    </div>
    <div style="padding:4px 0 8px">
      <div style="display:flex;justify-content:space-between;font-size:12px;color:var(--mut);margin-bottom:6px"><span>Credit usage</span><span>${fmtC(b.creditsUsed)} / ${fmtC(b.creditsGranted)}</span></div>
      <div class="ubar" style="height:8px;border-radius:99px;background:var(--line2);overflow:hidden"><i style="display:block;height:100%;background:${barColor};border-radius:99px;width:${pct}%"></i></div>
    </div>
  </div>`;
}
function paintBilling(M){
  M.innerHTML = `<div class="page"><div class="pageinner">
    <div class="phead"><h1>Billing</h1><span class="chip">${icon('card',12)} credits</span></div>
    <p class="psub">Free starts with <b>20 credits</b> — have your own agent. Pro <b>$30/mo</b> → 60 credits monthly. Max <b>$50/mo</b> → 100 credits monthly. Add extra credits with the dropdown. Gift codes add credits when redeemed.</p>
    <div id="billbody"><div class="row mut">Loading…</div></div>
    <div id="plancards" style="margin-top:18px"></div>
    <div class="kv billing-redeem"><div class="row">
      <span class="billing-redeem-icon">${icon('gift',18)}</span>
      <input class="field mono" id="giftcode" placeholder="LNG-XXXX-XXXX-XXXX">
      <button class="btn small" data-act="redeem">${icon('gift',14)} Redeem gift</button>
    </div></div>
  </div></div>`;
  getBilling().then((b) => {
    const el = $('#billbody');
    if (el && b) el.innerHTML = billSummary(b);
    const pc = $('#plancards');
    if (pc && b) { pc.innerHTML = planCards(b); wireBillingSliders(pc); }
  });
}

/* ================================================================
   LANDING
================================================================ */
/* Belna landing — headline mascot circle hosts Mascot.loop(): a self-contained
   4-action SVG animation (mail → phone → laptop → wallet) on a 16s pure-CSS
   infinite loop that plays automatically. No JS rotator / prop badge needed. */
/* Typewriter examples for the hero prompt box. */
const BELNA_PROMPTS = [
  'Ask Belna to do my taxes...',
  'Ask Belna to organize my schedule...',
  'Ask Belna to plan my move to Gothenburg...',
  'Ask Belna to research anything with sources...',
  'Ask Belna to build me a landing page...',
];
function belnaStopRotator(){ /* headline loop is pure CSS — nothing to stop */ }
function belnaStopTypewriter(){ if (window.__typeTimer){ clearTimeout(window.__typeTimer); window.__typeTimer = null; } }
function belnaStopLandingFx(){ belnaStopRotator(); belnaStopTypewriter(); }
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

/* Star-sky SVG background for the hero section (hand-drawn constellations, moon, planet). */
const STAR_SKY_SVG = `<svg viewBox="0 0 1672 941" preserveAspectRatio="xMidYMid slice">
<defs>
<filter id="handDrawn" x="-8%" y="-8%" width="116%" height="116%"><feTurbulence type="fractalNoise" baseFrequency=".012" numOctaves="1" seed="14" result="noise"/><feDisplacementMap in="SourceGraphic" in2="noise" scale=".35" xChannelSelector="R" yChannelSelector="G"/></filter>
<filter id="moonTexture" x="-20%" y="-20%" width="140%" height="140%"><feTurbulence type="fractalNoise" baseFrequency=".24" numOctaves="2" seed="4" result="noise"/><feComposite in="noise" in2="SourceGraphic" operator="in" result="texture"/><feBlend in="SourceGraphic" in2="texture" mode="multiply"/></filter>
<symbol id="star4" viewBox="-12 -12 24 24"><path d="M0-8 C1-3 2-1 8 0 C2 1 1 2 0 8 C-1 2-2 1-8 0 C-2-1-1-2 0-8Z" fill="none" stroke="currentColor" stroke-width="1.4"/></symbol>
<symbol id="star8" viewBox="-16 -16 32 32"><path d="M0-15 L1-3 L4-1 L15 0 L4 1 L2 4 L0 15 L-1 4 L-4 1 L-15 0 L-4-1 L-1-4 Z" fill="none" stroke="currentColor" stroke-width="1.25"/><path d="M-10-10 L-2-2 M10-10 L2-2 M-10 10 L-2 2 M10 10 L2 2" fill="none" stroke="currentColor" stroke-width=".8" opacity=".68"/></symbol>
<symbol id="small-cross" viewBox="-8 -8 16 16"><path d="M0-7 L0 7 M-7 0 L7 0 M-5-5 L5 5 M5-5 L-5 5" fill="none" stroke="currentColor" stroke-width="1.0"/></symbol>
</defs>
<g fill="var(--ink)"><circle cx="20" cy="58" r="1.2"/><circle cx="58" cy="64" r="1.6"/><circle cx="95" cy="71" r="2"/><circle cx="113" cy="96" r="1.4"/><circle cx="281" cy="72" r="1.5"/><circle cx="327" cy="31" r="2.8"/><circle cx="479" cy="100" r="1.8"/><circle cx="586" cy="29" r="1.2"/><circle cx="413" cy="187" r="1.1"/><circle cx="252" cy="192" r="1.2"/><circle cx="81" cy="279" r="1.5"/><circle cx="135" cy="258" r="1.2"/><circle cx="97" cy="217" r="1.4"/></g>
<circle cx="254" cy="109" r="6.5" class="soft-dot"/><circle cx="112" cy="351" r="5.4" class="soft-dot" opacity=".78"/>
<g transform="translate(198 59)" style="color:var(--ink)" class="hand twinkle-a"><use href="#star8" x="-19" y="-19" width="38" height="38"/></g>
<g transform="translate(304 149)" style="color:var(--ink)" class="hand twinkle-b"><use href="#small-cross" x="-10" y="-10" width="20" height="20"/></g>
<g transform="translate(409 68)" style="color:var(--ink)" class="hand twinkle-c"><use href="#star4" x="-13" y="-13" width="26" height="26"/></g>
<g class="hand"><path d="M40 153 L124 190 L190 230 L211 295" fill="none" stroke="var(--ink)" stroke-width="1.35" stroke-dasharray="1.35 6"/><path d="M40 153 L124 190 L190 230 L211 295" fill="none" stroke="var(--ink)" stroke-width=".5" opacity=".34"/><use href="#star4" x="31" y="144" width="18" height="18" style="color:var(--ink)"/><use href="#star4" x="116" y="182" width="17" height="17" style="color:var(--ink)"/><use href="#star4" x="182" y="222" width="17" height="17" style="color:var(--ink)"/><use href="#star4" x="202" y="286" width="18" height="18" style="color:var(--ink)"/></g>
<g transform="translate(62 463)" style="color:var(--ink)" class="hand twinkle-b"><use href="#star8" x="-18" y="-18" width="36" height="36"/></g>
<g fill="var(--ink)"><circle cx="31" cy="556" r="1.1"/><circle cx="90" cy="543" r="1.2"/><circle cx="143" cy="543" r="1.7"/><circle cx="43" cy="592" r="2.2"/><circle cx="101" cy="626" r="1.3"/><circle cx="197" cy="654" r="1.4"/><circle cx="204" cy="684" r="1.25"/></g>
<g transform="translate(166 607)" style="color:var(--ink)" class="hand"><use href="#small-cross" x="-9" y="-9" width="18" height="18"/></g>
<circle cx="271" cy="658" r="5.9" class="soft-dot" opacity=".83"/>
<path d="M-42 638 C54 647 136 675 191 718 C244 759 271 815 269 900" fill="none" stroke="var(--ink)" stroke-width="1.35" stroke-dasharray="1.35 6.2" opacity=".88" class="hand"/>
<circle cx="197" cy="745" r="4.4" fill="var(--ink)"/><circle cx="78" cy="820" r="5.8" class="soft-dot" opacity=".72"/>
<g transform="translate(100 749)" style="color:var(--ink)" class="hand"><use href="#small-cross" x="-10" y="-10" width="20" height="20"/></g>
<g fill="var(--ink)"><circle cx="21" cy="746" r="1.1"/><circle cx="40" cy="777" r="2.1"/><circle cx="94" cy="848" r="1.5"/><circle cx="133" cy="873" r="1.4"/><circle cx="289" cy="783" r="1.25"/><circle cx="330" cy="824" r="2"/><circle cx="343" cy="882" r="1.8"/><circle cx="376" cy="761" r="1.1"/><circle cx="431" cy="870" r="1.8"/><circle cx="516" cy="835" r="1.5"/></g>
<g transform="translate(392 805)" style="color:var(--ink)" class="hand"><use href="#small-cross" x="-9" y="-9" width="18" height="18"/></g>
<g fill="var(--ink)"><circle cx="1136" cy="73" r="1.6"/><circle cx="1167" cy="37" r="3.1"/><circle cx="1264" cy="30" r="1.2"/><circle cx="1272" cy="58" r="1.2"/><circle cx="1404" cy="157" r="1.4"/><circle cx="1518" cy="59" r="1.6"/><circle cx="1579" cy="88" r="1.2"/><circle cx="1618" cy="105" r="1.1"/><circle cx="1543" cy="98" r="1.2"/><circle cx="1358" cy="204" r="1.2"/><circle cx="1310" cy="235" r="1.1"/></g>
<circle cx="1458" cy="171" r="5.7" class="soft-dot"/>
<g transform="translate(1321 105)" class="hand"><path d="M-20-37 C-3-42 18-33 27-17 C39 5 30 31 8 39 C-11 46 -31 36 -39 18 C-24 28 -7 26 5 16 C18 4 19-14 10-26 C3-34 -8-38 -20-37 Z" fill="var(--ink)" opacity=".92" filter="url(#moonTexture)"/><path d="M-21-38 C-2-43 19-34 29-18 C42 4 32 32 9 40 C-10 47 -32 37 -41 18" fill="none" stroke="var(--ink)" stroke-width="1.0" opacity=".68"/></g>
<g transform="translate(1457 61)" style="color:var(--ink)" class="hand twinkle-a"><use href="#star4" x="-9" y="-9" width="18" height="18"/></g>
<g transform="translate(1360 268)" style="color:var(--ink)" class="hand twinkle-c"><use href="#small-cross" x="-11" y="-11" width="22" height="22"/></g>
<path d="M1674 150 C1612 163 1559 191 1514 229 C1476 262 1446 306 1437 359" fill="none" stroke="var(--ink)" stroke-width="1.3" stroke-dasharray="1.2 6.4" opacity=".84" class="hand"/>
<circle cx="1494" cy="251" r="5.2" fill="var(--ink)"/>
<g transform="translate(1574 304) rotate(-18)" class="hand"><ellipse cx="0" cy="0" rx="35" ry="8.5" fill="none" stroke="var(--ink)" stroke-width="1.5"/><circle cx="0" cy="0" r="14.5" fill="var(--blue)" opacity=".9"/><path d="M-11 -8 C-3 -13 5 -13 12 -6" fill="none" stroke="#8eafc7" stroke-width="1.0" opacity=".76"/></g>
<g fill="var(--ink)"><circle cx="1610" cy="436" r="1.2"/><circle cx="1570" cy="450" r="1.1"/><circle cx="1613" cy="464" r="1.45"/></g>
<g transform="translate(1556 507)" style="color:var(--ink)" class="hand twinkle-b"><use href="#star8" x="-17" y="-17" width="34" height="34"/></g>
<g fill="var(--ink)"><circle cx="1611" cy="579" r="2"/><circle cx="1431" cy="697" r="1.7"/><circle cx="1325" cy="739" r="1.1"/></g>
<g class="hand"><path d="M1458 624 L1485 601 L1541 677 L1609 696 L1601 755 L1518 728 L1541 677" fill="none" stroke="var(--ink)" stroke-width="1.3" stroke-dasharray="1.2 6" opacity=".88"/><use href="#star4" x="1449" y="615" width="18" height="18" style="color:var(--ink)"/><use href="#star4" x="1476" y="592" width="19" height="19" style="color:var(--ink)"/><use href="#star4" x="1532" y="668" width="18" height="18" style="color:var(--ink)"/><use href="#star4" x="1600" y="687" width="19" height="19" style="color:var(--ink)"/><use href="#star4" x="1592" y="746" width="18" height="18" style="color:var(--ink)"/><use href="#star4" x="1509" y="719" width="18" height="18" style="color:var(--ink)"/></g>
<g transform="translate(1395 807)" style="color:var(--ink)" class="hand twinkle-a"><use href="#star8" x="-20" y="-20" width="40" height="40"/></g>
<circle cx="1547" cy="850" r="6.2" class="soft-dot" opacity=".86"/>
<g fill="var(--ink)"><circle cx="1222" cy="821" r="1.1"/><circle cx="1270" cy="823" r="1.6"/><circle cx="1354" cy="863" r="2.3"/><circle cx="1442" cy="843" r="1.15"/><circle cx="1490" cy="871" r="1.4"/><circle cx="1608" cy="810" r="1.5"/><circle cx="1605" cy="876" r="1.2"/></g>
<g transform="translate(1233 864)" style="color:var(--ink)" class="hand"><use href="#small-cross" x="-7" y="-7" width="14" height="14"/></g>
<g class="mid-sky">
<g fill="var(--ink)"><circle cx="700" cy="80" r="1.4"/><circle cx="760" cy="52" r="1.1"/><circle cx="890" cy="66" r="1.8"/><circle cx="950" cy="120" r="1.2"/><circle cx="690" cy="200" r="1.1"/><circle cx="980" cy="240" r="1.5"/><circle cx="720" cy="340" r="1.2"/><circle cx="960" cy="380" r="1.1"/><circle cx="680" cy="480" r="1.6"/><circle cx="990" cy="500" r="1.2"/><circle cx="740" cy="620" r="1.1"/><circle cx="950" cy="640" r="1.7"/><circle cx="700" cy="760" r="1.3"/><circle cx="970" cy="790" r="1.2"/><circle cx="800" cy="880" r="1.6"/><circle cx="900" cy="900" r="1.1"/></g>
<circle cx="836" cy="140" r="5.6" class="soft-dot"/><circle cx="730" cy="450" r="4.6" class="soft-dot" opacity=".8"/><circle cx="940" cy="560" r="5.2" class="soft-dot" opacity=".85"/><circle cx="810" cy="770" r="5.8" class="soft-dot" opacity=".75"/>
<g transform="translate(836 290)" style="color:var(--ink)" class="hand twinkle-a"><use href="#star8" x="-18" y="-18" width="36" height="36"/></g>
<g transform="translate(748 560)" style="color:var(--ink)" class="hand twinkle-b"><use href="#star4" x="-12" y="-12" width="24" height="24"/></g>
<g transform="translate(930 680)" style="color:var(--ink)" class="hand twinkle-c"><use href="#star4" x="-11" y="-11" width="22" height="22"/></g>
<g transform="translate(860 440)" style="color:var(--ink)" class="hand twinkle-b"><use href="#small-cross" x="-9" y="-9" width="18" height="18"/></g>
<g transform="translate(780 800)" style="color:var(--ink)" class="hand"><use href="#small-cross" x="-8" y="-8" width="16" height="16"/></g>
<g class="hand"><path d="M700 200 L768 250 L836 290 L900 350 L930 430" fill="none" stroke="var(--ink)" stroke-width="1.3" stroke-dasharray="1.3 6"/><use href="#star4" x="691" y="191" width="18" height="18" style="color:var(--ink)"/><use href="#star4" x="759" y="241" width="17" height="17" style="color:var(--ink)"/><use href="#star4" x="921" y="421" width="18" height="18" style="color:var(--ink)"/></g>
<g transform="translate(905 130) rotate(-16)" class="hand"><ellipse cx="0" cy="0" rx="24" ry="6" fill="none" stroke="var(--ink)" stroke-width="1.4"/><circle cx="0" cy="0" r="10" fill="var(--blue)" opacity=".9"/></g>
</g>
</svg>`;

function renderLanding(){
  root.innerHTML = `
  <div class="fadeup">
    <div class="anav"><nav class="nav">
      <a class="abrand" href="/" data-act="top">belna</a>
      <div class="navlinks"><a href="/#agent" data-act="scroll" data-t="#agent">Product</a><a href="/research">Research</a><a href="/pricing">Pricing</a></div>
      <div class="anav-cta">
        <a class="btn ghost small" href="/" data-act="signin-nav">Sign in</a>
        <a class="btn small" href="/#cta" data-act="open-app">Get started</a>
      </div>
    </nav></div>

    <div class="hero-wrap">
    <div class="belna-stars" aria-hidden="true">${STAR_SKY_SVG}</div>
    <header class="hero ahero">
      <h1>Bring anything <span class="mhold" id="mhold" title="Your Belna agent at work — handling mail, calls, laptop work and counting" aria-label="Your Belna agent at work — handling mail, calls, laptop work and counting">${Mascot.loop()}</span> to life.</h1>
      <div class="safe-note" style="margin-top:18px">Your personal AI agent</div>
      <div class="promptwrap">
        <form class="promptbox" id="lform">
          <textarea id="lprompt" rows="2" placeholder="Ask Belna to do my taxes..."></textarea>
          <div class="attach-pills"></div>
          <div class="pb-row">
            <span class="iconbtn" data-act="attach" title="Attach files">${icon('plus',17)}</span>
            <span style="display:flex;gap:10px;align-items:center">
              <button type="submit" class="micbtn" title="Send">${icon('up',17)}</button>
            </span>
          </div>
        </form>
      </div>
    </header>
    </div>

    <section class="agent-compare" id="why-belna" aria-label="Why choose a personal Belna agent">
      <div class="compare-grid">
        <article class="compare-side compare-old">
          <div class="compare-copy">
            <span class="compare-kicker">Other AI apps</span>
            <h2>You get more threads,<br><span>more work and more costs.</span></h2>
          </div>
           <div class="thread-cloud" aria-hidden="true">
             <div class="thread-col tc-one">
               <div class="thread-track">
                 <div class="thread-set">
                   <span>${icon('chatb',14)} Budget spreadsheet...</span>
                   <span>${icon('chatb',14)} Newsletter cleanup</span>
                   <span>${icon('chatb',14)} Email to landlord</span>
                   <span>${icon('chatb',14)} Same doc, next section</span>
                   <span>${icon('chatb',14)} Untitled</span>
                   <span>${icon('chatb',14)} Follow up on refund</span>
                 </div>
                 <div class="thread-set">
                   <span>${icon('chatb',14)} Budget spreadsheet...</span>
                   <span>${icon('chatb',14)} Newsletter cleanup</span>
                   <span>${icon('chatb',14)} Email to landlord</span>
                   <span>${icon('chatb',14)} Same doc, next section</span>
                   <span>${icon('chatb',14)} Untitled</span>
                   <span>${icon('chatb',14)} Follow up on refund</span>
                 </div>
               </div>
             </div>
             <div class="thread-col tc-two">
               <div class="thread-track">
                 <div class="thread-set">
                   <span>${icon('chatb',14)} Budget spreadsheet...</span>
                   <span>${icon('chatb',14)} Find that document</span>
                   <span>${icon('chatb',14)} Summarize this PDF</span>
                   <span>${icon('chatb',14)} Draft client follow-up</span>
                   <span>${icon('chatb',14)} What did we decide?</span>
                   <span>${icon('chatb',14)} Meeting prep</span>
                 </div>
                 <div class="thread-set">
                   <span>${icon('chatb',14)} Budget spreadsheet...</span>
                   <span>${icon('chatb',14)} Find that document</span>
                   <span>${icon('chatb',14)} Summarize this PDF</span>
                   <span>${icon('chatb',14)} Draft client follow-up</span>
                   <span>${icon('chatb',14)} What did we decide?</span>
                   <span>${icon('chatb',14)} Meeting prep</span>
                 </div>
               </div>
             </div>
             <div class="thread-col tc-three">
               <div class="thread-track">
                 <div class="thread-set">
                   <span>${icon('chatb',14)} Weekly status update</span>
                   <span>${icon('chatb',14)} New chat</span>
                   <span>${icon('chatb',14)} Trip planning</span>
                   <span>${icon('chatb',14)} Quick question</span>
                   <span>${icon('chatb',14)} Another new chat</span>
                   <span>${icon('chatb',14)} Where was that file?</span>
                 </div>
                 <div class="thread-set">
                   <span>${icon('chatb',14)} Weekly status update</span>
                   <span>${icon('chatb',14)} New chat</span>
                   <span>${icon('chatb',14)} Trip planning</span>
                   <span>${icon('chatb',14)} Quick question</span>
                   <span>${icon('chatb',14)} Another new chat</span>
                   <span>${icon('chatb',14)} Where was that file?</span>
                 </div>
               </div>
             </div>
          </div>
        </article>

        <article class="compare-side compare-belna">
          <div class="compare-copy">
            <span class="compare-kicker">With Belna</span>
            <h2>You get one personal agent<br><span>that does the work.</span></h2>
          </div>
          <div class="agent-system" aria-hidden="true">
            <span class="orbit-ring orbit-one"></span>
            <span class="orbit-ring orbit-two"></span>
            <span class="orbit-ring orbit-three"></span>
            <span class="orbit-agent oa-one">${Mascot.svg('lingon','happy',64)}</span>
            <span class="orbit-agent oa-two">${Mascot.svg('blueberry','think',58)}</span>
             <span class="orbit-agent oa-three">${Mascot.svg('moss','happy',54)}</span>
             <span class="orbit-agent oa-four">${Mascot.svg('rose','idle',50)}</span>
             <div class="compare-mascot">${Mascot.laptop()}</div>
           </div>
        </article>
      </div>
    </section>

    <section class="asection" id="safety" aria-label="Safe Swedish AI">
      <h2>Safe Swedish AI</h2>
      <div class="split">
        <div>
          <p class="lede">Arche 1.0 is built on the open source Kimi K3 model, with an Agentic harness optimized for privacy and safety.</p>

        </div>
        <div class="panel model-card">
          <div class="mc-head">
            <span class="mc-brand">${Mascot.logo(28)}<span><b>Arche 1.0</b><i>by Belna · Safe Swedish AI</i></span></span>
          </div>
          <div class="mc-title">Arche 1.0 vs frontier models</div>
          <div class="mc-table"><table class="btable">
            <thead><tr><th>Benchmark</th><th class="star">Arche 1.0</th><th>GPT-5.6 Sol</th><th>Claude Opus 5</th><th>Claude Fable 5</th><th>Claude Opus 4.8</th></tr></thead>
            <tbody>
              <tr><td>GPQA Diamond</td><td class="star">93.5</td><td>94.1</td><td>93.8</td><td>92.6</td><td>91.0</td></tr>
              <tr><td>Terminal-Bench 2.1</td><td class="star">88.3</td><td>88.8</td><td>87.5</td><td>88.0</td><td>84.6</td></tr>
              <tr><td>BrowseComp</td><td class="star">91.2</td><td>90.4</td><td>89.1</td><td>88.0</td><td>84.3</td></tr>
              <tr><td>OSWorld-Verified</td><td class="star">84.8</td><td>83.0</td><td>84.2</td><td>85.0</td><td>83.4</td></tr>
              <tr><td>SWE-Marathon</td><td class="star">42.0</td><td>39.0</td><td>41.0</td><td>35.0</td><td>40.0</td></tr>
            </tbody>
          </table></div>
          <div class="fineprint mc-foot"><span>Full results and methodology in <a href="/research-arche-1-0">Research → Arche 1.0</a></span><span class="mc-foot-brand">${Mascot.logo(20)} BELNA</span></div>
        </div>
      </div>
    </section>

    <section class="asection" id="agent" aria-label="Your personal AI Agent">
      <h2>Your personal AI Agent.</h2>
      <div class="split">
        <div>
          <p class="lede">If you can think it, your Agent can make it real life.</p>

        </div>
        <div class="panel">
          <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px">${Mascot.svg('lingon','happy',34)}<div><b>Example from inside the app</b><div class="mut" style="font-size:12.5px">Your agent, working for real</div></div></div>
          <div class="mockchat">
            <div class="mbub u">Plan my move to Gothenburg next month — movers, addresses, budget</div>
            <div class="mbub a"><b>Your agent</b>Done. Moving checklist with dates, 3 movers compared on price, address-change drafts, and a budget table — all on your canvas. Nothing sent without your yes.</div>
            <div class="mbub u">Also remind me to water the plants?</div>
            <div class="mbub a"><b>Your agent</b>Remembered. I'll nudge you every Sunday evening.</div>
          </div>
        </div>
      </div>
    </section>

    <section class="cta2" id="cta" aria-label="Start">
      <div class="kicker" style="font-size:12.5px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:var(--acc)">Start now</div>
      <h2>What do you want to do?</h2>
      <div class="promptwrap">
        <form class="promptbox" id="lform2">
          <textarea id="lprompt2" rows="2" placeholder="Tell your agent… e.g. Plan my week, build me a page, research a topic"></textarea>
          <div class="attach-pills"></div>
          <div class="pb-row">
            <span class="iconbtn" data-act="attach" title="Attach files">${icon('plus',17)}</span>
            <span style="display:flex;gap:10px;align-items:center">
              <button type="submit" class="micbtn" title="Send">${icon('up',17)}</button>
            </span>
          </div>
        </form>
      </div>
    </section>

    <footer class="afooter"><div class="fin">
      <div><div class="abrand">belna</div></div>
      <div><h4>Product</h4><a href="/#safety">Safe Swedish AI</a><a href="/#agent">Personal Agent</a><a href="/research">Research</a><a href="/pricing">Pricing</a></div>
      <div><h4>Company</h4><a href="/#cta" data-act="open-app">Get started</a><a href="/" data-act="signin-nav">Sign in</a></div>
      <div><h4>Legal</h4><a href="/terms">Terms of Service</a><a href="/privacy">Privacy Policy</a><a href="/security">Security</a><a href="/cookies">Cookie Policy</a></div>
    </div><div class="base"><span>© 2026 Belna — Swedish Safe AI Agents</span><span><a href="/">Home</a> · <a href="/research">Research</a> · <a href="/pricing">Pricing</a> · <a href="/terms">Terms</a> · <a href="/privacy">Privacy</a></span></div></footer>
  </div>`;
  const wire = (formId, inputId) => {
    const f = document.getElementById(formId);
    const p = document.getElementById(inputId);
    if (f && p){
      f.addEventListener('submit', e => {
        e.preventDefault();
        const v = p.value.trim();
        if (!v && !pendingFiles.length) return;
        p.value = '';
        clearFiles();
        landingRun(v);
      });
      p.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); f.requestSubmit(); } });
    }
  };
  wire('lform', 'lprompt');
  wire('lform2', 'lprompt2');
  wirePromptBox(document.getElementById('lform'), document.getElementById('lprompt'));
  wirePromptBox(document.getElementById('lform2'), document.getElementById('lprompt2'));
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
    try { ensureMailbox(nm); } catch {}
    try { state.memory.unshift({ id: uid(), text: `Agent claimed and named “${nm}” — ${Mascot.PALETTE[colorKey].name.toLowerCase()}, ${pers.toLowerCase()}.`, src: 'onboarding', at: Date.now() }); } catch {}
    const pendingText = state.pendingPrompt
      || ((c.messages || []).find(mm => mm.role === 'user' && mm.kind === 'text') || {}).text
      || '';
    state.pendingPrompt = null;
    // Complete onboarding before handing the request to the interruptible
    // coordinator. The delegated worker owns the long-running task state.
    save();
    paintSide(); try { paintCanvas(); } catch {}
    await rt.say(`Done — I’m ${nm}, all yours. Now running your request for real (no demos, no fakes).`, { mood: 'happy' });
    c.onboarding = false;
    save();
    if (pendingText){
      if (state.view !== 'chat') state.view = 'chat';
      c.busy = false;
      paintSide(); paintMain();
      await runAgentOn(c, pendingText);
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

function runningTask(c){
  return c && c.activeTask && c.activeTask.status === 'running' ? c.activeTask : null;
}

function updateDelegation(c, task, status, note){
  if (!c || !task || !task.cardMessageId) return;
  const m = (c.messages || []).find((message) => message.id === task.cardMessageId);
  if (!m || m.kind !== 'card' || m.card.type !== 'subagents') return;
  m.card.status = status;
  const worker = m.card.agents && m.card.agents[0];
  if (worker) { worker.status = status; worker.note = note || status; }
  replaceNode(c, m);
}

function stopDelegatedTask(c, status = 'interrupted'){
  const task = runningTask(c);
  if (!task) return null;
  const run = taskRuns.get(c.id);
  if (run && run.taskId === task.id) run.controller.abort();
  taskRuns.delete(c.id);
  task.status = status;
  task.finishedAt = Date.now();
  updateDelegation(c, task, status, status === 'interrupted' ? 'interrupted by you' : status);
  save();
  return task;
}

async function launchDelegatedTask(c, prompt, options = {}){
  const controller = new AbortController();
  const task = {
    id: uid(), kind: options.kind || Engine.taskKind(prompt) || 'general',
    prompt, status: 'running', startedAt: Date.now(), updates: options.updates || [],
  };
  c.activeTask = task;
  c.busy = false;
  const rt = makeRT(c);
  const delegation = rt.card({
    type: 'subagents', status: 'pending',
    agents: [{ name: `${task.kind} worker`, desc: String(prompt).slice(0, 120), status: 'running' }],
  });
  task.cardMessageId = delegation.msg.id;
  taskRuns.set(c.id, { taskId: task.id, controller });
  save(); paintSide(); paintMain();

  const intro = options.openedNewChat
    ? `I opened a new chat for this separate task and delegated the work to a sub-agent. The other task can keep running, and I'm available here while this worker continues.`
    : options.updated
      ? `Understood. I interrupted the previous worker and delegated the updated instructions to a fresh sub-agent. I'm still available while it runs.`
      : `I've delegated the work to a sub-agent so I stay available here. You can ask questions, change direction, or stop it at any time while it runs.`;
  await rt.say(intro, { mood: 'think' });
  if (controller.signal.aborted) return;

  try {
    await Engine.runTask(rt, prompt, { ...task, signal: controller.signal });
    if (c.activeTask?.id !== task.id || controller.signal.aborted) return;
    task.status = 'done'; task.finishedAt = Date.now();
    updateDelegation(c, task, 'done', 'completed');
  } catch (e) {
    if (controller.signal.aborted || e?.name === 'AbortError') return;
    console.error(e);
    if (c.activeTask?.id === task.id) {
      task.status = 'failed'; task.finishedAt = Date.now();
      updateDelegation(c, task, 'failed', 'failed');
      await rt.say('The delegated worker could not complete that task. I am still available, and you can retry or change the instructions.', { mood: 'think' });
    }
  } finally {
    const run = taskRuns.get(c.id);
    if (run?.taskId === task.id) taskRuns.delete(c.id);
    save(); paintMain(); paintSide();
  }
}

/* Run Engine on text already present in the thread (no duplicate user bubble).
   Real accounts only. */
async function runAgentOn(c, text){
  if (!c || !text) return;
  if (!signedIn()){ state.pendingPrompt = text; save(); renderAuth(); return; }
  if (state.view !== 'chat') state.view = 'chat';
  if (Engine.isTask(text)) {
    launchDelegatedTask(c, text);
    return;
  }
  c.coordinatorRuns = Number(c.coordinatorRuns || 0) + 1; save();
  paintSide(); paintMain();
  const rt = makeRT(c);
  try { await Engine.run(rt, text); }
  catch (e){ console.error(e); await rt.say('Something went wrong on my end — please try again in a moment.'); }
  c.coordinatorRuns = Math.max(0, Number(c.coordinatorRuns || 1) - 1); save(); paintMain(); paintSide();
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
  { id:'brick', name:'Classic Blue', c:'#3B6DD9' },
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
  const colors = ['#4A7FD4','#E8B33C','#5B6EE1','#6FBF73','#9B6BD3'];
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
  try { ensureMailbox(state.agent.name); } catch {}
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
  <div class="app ${state.canvasOpen && state.view === 'chat' ? '' : 'nocanvas'} ${mobileNavOpen ? 'mobile-nav-open' : ''}" id="app">
    <button class="mobile-nav-toggle" data-act="togglemenu" aria-label="${mobileNavOpen ? 'Close navigation' : 'Open navigation'}" aria-expanded="${mobileNavOpen}">${icon(mobileNavOpen ? 'x' : 'menu',20)}</button>
    <button class="side-scrim" data-act="togglemenu" aria-label="Close navigation"></button>
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
    <button class="sidebrand" data-act="nav" data-view="chat" title="Belna — back to chat">${Mascot.logo(28)}<span>belna</span></button>
    <button class="btn" style="margin:8px 4px 4px" data-act="newchat">${icon('plus',15)} New chat</button>
    <div class="slabel">Chats</div>
    <div style="overflow-y:auto;flex:1">
      ${state.chats.slice(0, 12).map(c => `
        <button class="sitem chatitem ${c.id === state.activeChat && state.view === 'chat' ? 'on' : ''}" data-act="openchat" data-id="${c.id}">
          ${icon(c.source === 'automation' ? 'clock' : 'chatb',14)}<span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(c.title)}</span>
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
  // usage card: credit usage meter (real billing when signed in)
  try {
    getBilling().then(b => {
      const box = $('#usagecard');
      if (!box) return;
      if (b) {
        const pct = b.creditsGranted ? Math.min(100, Math.max(0, b.creditsUsed / b.creditsGranted * 100)) : 0;
        const remaining = Number(b.credits) || 0;
        const barColor = remaining > 5 ? 'var(--green)' : remaining > 0 ? '#f5a623' : '#e74c3c';
        box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:11px;font-weight:700;color:var(--mut)">Credit usage</span><span class="uplan">${esc(String(b.plan).toUpperCase())}</span></div><div class="ubar"><i style="width:${pct}%;background:${barColor}"></i></div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><span class="chip ${remaining > 5 ? 'green' : ''}" style="font-size:11px">${fmtC(b.credits)} left</span><span style="font-size:11px;color:var(--mut)">${fmtC(b.creditsUsed)} / ${fmtC(b.creditsGranted)}</span></div>`;
      } else {
        box.innerHTML = `<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px"><span style="font-size:11px;font-weight:700;color:var(--mut)">Credit usage</span><span class="uplan">FREE</span></div><div class="ubar"><i style="width:4%;background:var(--green)"></i></div><div style="display:flex;justify-content:space-between;align-items:center;margin-top:6px"><span class="chip green" style="font-size:11px">20 left</span><span style="font-size:11px;color:var(--mut)">0 / 20</span></div>`;
      }
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
        case 'subagents': return 'Sub-agent working · available';
        case 'browser': return 'Browsing';
        case 'computer': return 'Using the sandbox';
      }
    }
  }
  if (runningTask(c)) return 'Sub-agent working · available';
  return c.coordinatorRuns ? 'Replying' : c.busy ? 'Working' : 'Available';
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
      ${c.source === 'automation' ? `<span class="chip">${icon('clock',12)} sub-agent</span>` : ''}
      ${runningTask(c) ? '<span class="chip green">' + icon('box',12) + ' delegated · agent available</span>' : (c.coordinatorRuns ? '<span class="chip">' + icon('refresh',12) + ' replying…</span>' : '')}
      <span class="sp"></span>
      ${Engine.managed ? `<button class="btn ghost tiny" data-act="managed-resume">Reconnect</button><button class="btn ghost tiny" data-act="managed-stop">Stop</button>` : ''}
      <button class="iconbtn" data-act="togglecanvas" title="Toggle canvas">${icon('panel',16)}</button>
    </div>
    <div class="thread" id="thread"><div class="threadinner" id="tinner">
      ${c.messages.map(m => msgNode(c, m).outerHTML).join('')}
    </div></div>
    <div class="composerwrap"><div class="composer">
      ${c.replyingTo ? `<div class="reply-draft"><span><b>Replying to ${c.replyingTo.role === 'user' ? 'yourself' : esc(state.agent.name)}</b><small>${esc(c.replyingTo.text)}</small></span><button type="button" class="iconbtn" data-act="cancelreply" data-chat="${c.id}" title="Cancel reply" aria-label="Cancel reply">${icon('x',14)}</button></div>` : ''}
      <form class="promptbox" id="cform">
        <textarea id="cprompt" rows="1" placeholder="Ask ${esc(state.agent.name)} anything…"></textarea>
        <div class="attach-pills"></div>
        <div class="pb-row">
          <span class="iconbtn" data-act="attach" title="Attach files">${icon('plus',16)}</span>
          <span style="display:flex;gap:10px;align-items:center">
            <button type="submit" class="micbtn" title="Send">${icon('up',17)}</button>
          </span>
        </div>
      </form>
    </div></div>`;
  const th = $('#thread'); th.scrollTop = th.scrollHeight;
  updateFloat();
  $('#cform').addEventListener('submit', e => { e.preventDefault(); const v = $('#cprompt').value.trim(); if (v || pendingFiles.length){ $('#cprompt').value = ''; sendPrompt(v, pendingFiles.slice()); clearFiles(); } });
  $('#cprompt').addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey){ e.preventDefault(); $('#cform').requestSubmit(); } });
  wirePromptBox($('#cform'), $('#cprompt'));
}

const REACTIONS = [
  { emoji:'👍', label:'Thumbs up' },
  { emoji:'👎', label:'Thumbs down' },
  { emoji:'❤️', label:'Heart' },
  { emoji:'💩', label:'Poop' },
];
function replyPreviewHTML(m){
  if (!m.replyTo) return '';
  const who = m.replyTo.role === 'user' ? 'You' : state.agent.name;
  return `<div class="reply-preview"><b>${esc(who)}</b><span>${esc(m.replyTo.text)}</span></div>`;
}
function messageActionsHTML(c, m){
  const active = new Set(Array.isArray(m.reactions) ? m.reactions : []);
  const attrs = `data-chat="${c.id}" data-msg="${m.id}"`;
  const chosen = REACTIONS.filter((r) => active.has(r.emoji)).map((r) => `<button class="reaction-pill on" data-act="reactmsg" ${attrs} data-emoji="${r.emoji}" title="Remove ${r.label}" aria-label="Remove ${r.label}">${r.emoji}</button>`).join('');
  return `${chosen ? `<div class="message-reactions">${chosen}</div>` : ''}<div class="message-actions" aria-label="Message actions">
    <button data-act="replymsg" ${attrs} title="Reply">${icon('chatb',13)}<span>Reply</span></button>
    <button data-act="copymsg" ${attrs} title="Copy">${icon('copy',13)}<span>Copy</span></button>
    <span class="reaction-options">${REACTIONS.map((r) => `<button class="reaction-choice ${active.has(r.emoji) ? 'on' : ''}" data-act="reactmsg" ${attrs} data-emoji="${r.emoji}" title="${r.label}" aria-label="${r.label}">${r.emoji}</button>`).join('')}</span>
  </div>`;
}
function msgNode(c, m){
  if (m.kind === 'text' && m.role === 'user'){
    const filesHtml = (m.files && m.files.length) ? `<div class="msg-files">${m.files.map(f => `<span class="attach-pill sent">${icon('file',12)}<span class="ap-name">${esc(f.name.length > 24 ? f.name.slice(0,21)+'…' : f.name)}</span><span class="ap-size">${fmtBytes(f.size)}</span></span>`).join('')}</div>` : '';
    return el(`<div class="msg user" data-mid="${m.id}"><div class="message-stack"><div class="bub">${replyPreviewHTML(m)}${filesHtml}${esc(m.text)}</div>${messageActionsHTML(c, m)}</div></div>`);
  }
  if (m.kind === 'text')
    return el(`<div class="msg agent" data-mid="${m.id}"><div class="ava">${Mascot.svg(state.agent.color, m.mood || 'idle', 30)}</div><div class="body message-stack"><div class="bub md">${replyPreviewHTML(m)}${md(m.text)}</div>${messageActionsHTML(c, m)}</div></div>`);
  if (m.kind === 'tools')
    return el(`<div class="msg agent" data-mid="${m.id}"><div class="ava" style="visibility:hidden">${Mascot.svg(state.agent.color,'idle',30)}</div><div class="body"><div class="tools">${m.items.map(t => tlineHTML(t)).join('')}</div></div></div>`);
  if (m.kind === 'chips')
    return el('<div style="display:none"></div>');
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
  const chip = auto
    ? (cd.status === 'done' ? STCHIP.done : cd.status === 'interrupted' ? '<span class="chip">interrupted</span>' : cd.status === 'failed' ? '<span class="chip">failed</span>' : '<span class="chip">running</span>')
    : stChip(cd);
  const hd = (ic, bg, fg, title, sub) => `<div class="hd"><div class="tile" style="background:${bg};color:${fg}">${ic}</div><div><b>${title}</b><div class="sub">${sub}</div></div><div class="st">${chip}</div></div>`;
  const pending = cd.status === 'pending';

  if (cd.type === 'approval' && cd.managedCallId) return `<div class="acard">
    ${hd(icon('shieldcheck',20),'var(--acc-soft)','var(--acc)',esc(cd.title),'Approve this exact action')}
    <div class="bd"><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(cd.detail)}</pre></div>
    ${pending ? `<div class="stack"><button class="btn" data-act="managed-allow" data-chat="${k}" data-msg="${mid}">Allow</button><button class="btn ghost" data-act="managed-deny" data-chat="${k}" data-msg="${mid}">Deny</button></div>` : ''}</div>`;

  if (cd.type === 'approval') return `<div class="acard">
    ${hd(icon('shieldcheck',20),'var(--acc-soft)','var(--acc)',`Allow ${esc(state.agent.name)}: ${esc(cd.title)}`,'Action approval')}
    <div class="bd"><span class="mut">${esc(cd.detail)}</span><div class="secnote" style="color:var(--mut)">${icon('box',13)} Restricted action — credentials remain protected.</div></div>
    ${pending ? `<div class="stack"><button class="btn" data-act="approve" data-chat="${k}" data-msg="${mid}">${icon('check',15)} Allow</button><button class="btn green" data-act="always" data-chat="${k}" data-msg="${mid}">Always allow</button><button class="btn soft" data-act="deny" data-chat="${k}" data-msg="${mid}">Deny</button></div>` : `<div class="ft"><span class="note">${icon('shield',12)} logged in trace</span></div>`}</div>`;

  if (cd.type === 'connect'){
    const app = cd.app === 'github' ? { n:'GitHub', ic:icon('git',20), fg:'var(--ink)' } : { n:'Gmail', ic:icon('mail',20), fg:'var(--acc)' };
    return `<div class="acard">${hd(app.ic,'#fff',app.fg, app.n,'Connector')}
    <div class="bd mut">I'll ask only for the permissions I need. Credentials remain protected.</div>
    ${pending ? `<div class="stack"><button class="btn" data-act="connect" data-chat="${k}" data-msg="${mid}">Connect</button><button class="btn ghost" data-act="deny-connect" data-chat="${k}" data-msg="${mid}">Not now</button></div>` : `<div class="ft"><span class="note">${icon('lock',12)} manage in Vault</span></div>`}</div>`;
  }

  if (cd.type === 'secret') return `<div class="acard">
    ${hd(icon('lock',20),'var(--acc-soft)','var(--acc)','Secure credentials store','encrypted at rest · scoped to your account')}
    <div class="bd">
      <div style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="field" style="flex:1;min-width:140px" data-f="name" placeholder="secret name" value="${esc(cd.nameVal || cd.suggest || '')}">
        <input class="field mono" style="flex:1.4;min-width:180px" data-f="val" type="password" placeholder="paste value — masked immediately" autocomplete="off">
      </div>
      <div class="secnote">${icon('shieldcheck',14)} Value is never displayed in chat, logs, or activity history.</div>
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
    ${hd(icon('box',20),'var(--line2)','var(--mut)',cd.agents.length === 1 ? 'Delegated task' : 'Parallel tasks',cd.agents.length === 1 ? 'main agent remains available' : 'working concurrently')}
    <div class="bd">${cd.agents.map(a => `<div class="subrow">
      <div><span class="nm">${esc(a.name)}</span><div class="ds">${esc(a.desc)}</div></div>
      <span class="stt">${a.status === 'running' ? `<span class="spin">${icon('refresh',13)}</span> running` : a.status === 'done' ? `<span style="color:var(--green)">${icon('check',13)}</span> ${esc(a.note || 'done')}` : a.status === 'interrupted' || a.status === 'failed' ? `<span style="color:var(--soft)">${icon('x',13)}</span> ${esc(a.note || a.status)}` : `<span style="color:var(--soft)">${icon('clock',13)}</span> queued`}</span>
    </div>`).join('')}</div></div>`;

  if (cd.type === 'browser') return `<div class="acard">
    ${hd(icon('globe',20),'var(--ink)','#fff','Browser', esc(cd.note))}
    <div class="bd"><div class="win"><div class="bar"><i></i><i></i><i></i><span class="url">${esc(cd.url)}</span></div>
    ${cd.screenshot ? `<div class="shot"><img src="${cd.screenshot}" alt="Rendered page screenshot" loading="lazy"></div>` : ''}
    <div class="scr">${cd.status === 'done' ? `<span style="color:var(--green)">${icon('check',14)}</span>` : `<span class="spin">${icon('refresh',14)}</span>`} ${esc(cd.note)}</div></div></div>
    <div class="stack">${cd.liveId ? `<button class="btn" data-act="watchlive">Watch live</button>` : ''}<button class="btn ghost" data-act="viewcanvas">Follow in canvas</button></div></div>`;

  if (cd.type === 'computer') return `<div class="acard">
    ${hd(icon('term',20),'var(--ink)','#fff',cd.managed ? 'Agent tool output' : 'Read-only tool output',cd.managed ? 'Actual managed sandbox or search result' : 'Computed from the approved API response')}
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
    managedEvent(event){
      if (event.type === 'heartbeat') return;
      if (event.type === 'session') c.managedStatus = event.status;
      if (event.type === 'paused') c.managedStatus = 'paused';
      if (event.type === 'done') c.managedStatus = event.status;
      if (event.type === 'trace') { rt.trace(event.trace.ic || 'box', event.trace.t); return; }
      if (event.type === 'artifact') { rt.artifact(event.artifact); return; }
      if (event.type === 'decision') {
        const m = c.messages.find(x => x.card?.managedCallId === event.callId);
        if (m) { m.card.status = event.status; m.card.choice = event.answer; if(event.ref)m.card.ref=event.ref; replaceNode(c,m); }
      }
      if (event.type === 'message' || event.type === 'message_delta') {
        let m = c.messages.find(x => x.managedId === event.id);
        if (!m) { m = { id:uid(), managedId:event.id, role:'agent', kind:'text', text:'' }; c.messages.push(m); append(msgNode(c,m)); }
        m.text = event.type === 'message_delta' ? m.text + event.delta : event.text;
        replaceNode(c,m);
      }
      if (event.type === 'card') {
        let m = c.messages.find(x => x.managedId === event.id);
        const card = { ...event.card, managedCallId:event.callId };
        if (!m) { m = { id:uid(), managedId:event.id, kind:'card', card }; c.messages.push(m); append(msgNode(c,m)); }
        else { m.card = card; replaceNode(c,m); }
        if (card.type === 'memory' && !state.memory.some(x => x.text === card.text)) rt.remember(card.text, 'account');
      }
      if (event.type === 'error') {
        c.managedStatus = 'failed';
        const m = { id:uid(), role:'agent', kind:'text', text:event.error, mood:'think' };
        c.messages.push(m); append(msgNode(c,m));
        rt.trace('alert', event.error);
      }
      save();
      if (['done','paused','error'].includes(event.type) && active()) { paintMain(); paintSide(); }
    },
    recall: () => state.memory.slice(),
    hasApp: n => false,
    hasSecret: n => state.vault.secrets.some(s => s.name === n),
    secretRef: n => { const s = state.vault.secrets.find(s => s.name === n); return s ? s.ref : 'sec_••••'; },
    openSubAgents(prompt){
      state.subAgentDraft = String(prompt || '').slice(0, 4000);
      state.subAgentComposer = true;
      state.canvasTab = 'subagents'; state.canvasOpen = true;
      const app = $('#app'); if (app) app.classList.remove('nocanvas');
      save(); paintCanvas(); refreshSubAgents();
    },
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
    chips(){ /* suggestion chips removed — no-op for backward compat */ },
    // iPhone-style typing indicator: an agent bubble with ONLY three dots.
    // Shows instantly (no wait) and stays until replaced by real content.
    // Returns a live handle so callers can stream updates without waiting
    // for the final answer: handle.append(delta) / handle.update(fullText) /
    // handle.done(finalText). Works even if the chat is not active.
    typing(opts){
      const m = { id: uid(), role:'agent', kind:'text', text:'', mood:(opts || {}).mood || 'idle', typing: true };
      c.messages.push(m);
      let node = null;
      let bodyEl = null;
      if (active()){
        node = msgNode(c, m);
        append(node);
        bodyEl = node.querySelector('.md');
        if (bodyEl) bodyEl.innerHTML = '<span class="tdots" aria-label="typing"><i></i><i></i><i></i></span>';
        scroll();
      }
      let full = '';
      let raf = 0;
      const nextFrame = (fn) => {
        if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(fn);
        return setTimeout(fn, 0);
      };
      const cancelFrame = (id) => {
        if (typeof cancelAnimationFrame === 'function') return cancelAnimationFrame(id);
        return clearTimeout(id);
      };
      const paint = () => {
        raf = 0;
        if (!bodyEl || !bodyEl.isConnected) return;
        if (!full) {
          bodyEl.innerHTML = '<span class="tdots" aria-label="typing"><i></i><i></i><i></i></span>';
        } else {
          bodyEl.innerHTML = md(full);
        }
        scroll();
      };
      const schedule = () => {
        // Coalesce rapid deltas into one paint per frame — updates stream
        // in live without re-render thrash or artificial waiting.
        if (raf) return;
        raf = nextFrame(paint);
      };
      return {
        msg: m,
        append(delta){
          full += String(delta == null ? '' : delta);
          m.text = full;
          if (bodyEl && bodyEl.isConnected) schedule();
          return full;
        },
        update(text){
          full = String(text == null ? '' : text);
          m.text = full;
          if (bodyEl && bodyEl.isConnected) schedule();
          else if (!active()) save();
          return full;
        },
        done(text, doneOpts){
          if (raf) { cancelFrame(raf); raf = 0; }
          if (text != null) { full = String(text); m.text = full; }
          delete m.typing;
          if (doneOpts && doneOpts.mood) m.mood = doneOpts.mood;
          if (active()){
            // Re-render through the normal node so markdown, avatar and
            // actions are identical to a finished message.
            const fresh = msgNode(c, m);
            if (node && node.isConnected) node.replaceWith(fresh);
            else append(fresh);
            updateFloat();
            scroll();
          }
          save();
          return m;
        },
        abort(){
          if (raf) { cancelFrame(raf); raf = 0; }
          const i = c.messages.indexOf(m);
          if (i >= 0) c.messages.splice(i, 1);
          try { if (node && node.isConnected) node.remove(); } catch {}
          save();
        },
      };
    },
    async say(text, opts){
      // Instant send: bubble + three dots appear synchronously, then the
      // text paints without the old 500ms artificial wait.
      const handle = rt.typing(opts);
      const full = String(text == null ? '' : text);
      if (!full) return handle.done('', opts), undefined;
      if (!active()){
        handle.done(full, opts);
        return;
      }
      // Fast progressive paint for non-streamed answers. Chunked (not
      // per-token sleeps) so long answers appear quickly and never block
      // subsequent sends.
      const chunks = full.match(/(\s+|[^\s]+\s*)/g) || [full];
      let acc = '';
      const yieldFrame = () => new Promise((r) => {
        if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(() => r());
        return setTimeout(r, 0);
      });
      for (let i = 0; i < chunks.length; i++){
        acc += chunks[i];
        handle.update(acc);
        // Yield to the browser every few chunks so the dots/text animate
        // smoothly; no fixed 500ms/16ms waits.
        if (i % 6 === 5) await yieldFrame();
      }
      handle.done(acc, opts);
    },
    async tools(items){
      // No artificial waiting: log tool lines instantly so the chat never
      // stalls on status messages. The "Working on your request" pseudo
      // status is dropped — the typing dots are the only pending signal.
      const list = (items || []).filter((it) => {
        const t = String(it && it.t || '').toLowerCase();
        return t !== 'working on your request';
      });
      if (!list.length) return;
      const m = { id: uid(), kind:'tools', items: [] }; c.messages.push(m);
      const n = active() ? msgNode(c, m) : null; if (n) append(n);
      for (const it of list){
        m.items.push(it);
        if (n){ n.querySelector('.tools').insertAdjacentHTML('beforeend', tlineHTML(it)); scroll(); }
        rt.trace(it.ic, it.t + (it.d ? ' · ' + it.d : ''));
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
        wait: (signal) => new Promise((resolve, reject) => {
          if (signal?.aborted) {
            const error = new Error('Task interrupted'); error.name = 'AbortError'; reject(error); return;
          }
          const onAbort = () => {
            delete waits[key];
            m.card.status = 'interrupted'; replaceNode(c, m); save();
            const error = new Error('Task interrupted'); error.name = 'AbortError'; reject(error);
          };
          if (signal) signal.addEventListener('abort', onAbort, { once: true });
          waits[key] = (payload) => {
            if (signal) signal.removeEventListener('abort', onAbort);
            resolve(payload);
          };
        }),
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
async function sendPrompt(text, files){
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
    c.messages.push({ id: uid(), role: 'user', kind: 'text', text, files: files && files.length ? files : undefined, replyTo: c.replyingTo || undefined });
    c.replyingTo = null;
    save();
    if (state.view !== 'chat'){ state.view = 'chat'; }
    paintSide(); paintMain();
    if (pq) resolveCard(pq.c, pq.m, { choice: String(text).trim().slice(0, 60) || text }, 'answered');
    return;
  }
  const currentTask = runningTask(c);
  const route = Engine.routeMessage(currentTask, text);
  if (route === 'new-chat') {
    const next = { id: uid(), title: text.length > 42 ? text.slice(0, 42) + '…' : text, messages:[], trace:[], artifact:null, createdAt:Date.now() };
    next.messages.push({ id: uid(), role:'user', kind:'text', text, files: files && files.length ? files : undefined, replyTo: c.replyingTo || undefined });
    c.replyingTo = null;
    state.chats.unshift(next); state.activeChat = next.id; state.view = 'chat';
    save(); renderApp();
    launchDelegatedTask(next, text, { openedNewChat: true });
    return;
  }
  if (c.messages.filter(m => m.role === 'user').length === 0) c.title = text.length > 42 ? text.slice(0, 42) + '…' : text;
  c.messages.push({ id: uid(), role:'user', kind:'text', text, files: files && files.length ? files : undefined, replyTo: c.replyingTo || undefined });
  c.replyingTo = null;
  save();
  if (state.view !== 'chat'){ state.view = 'chat'; }
  paintSide(); paintMain();
  if (route === 'interrupt') {
    stopDelegatedTask(c);
    await makeRT(c).say(`Stopped. The delegated worker has been interrupted, and I'm ready for your next message.`, { mood: 'idle' });
    paintMain(); paintSide();
    return;
  }
  if (route === 'update-task') {
    const previous = stopDelegatedTask(c);
    const updatedPrompt = `${previous.prompt}\n\nUser update: ${text}`;
    launchDelegatedTask(c, updatedPrompt, {
      kind: previous.kind, updated: true,
      updates: [...(previous.updates || []), text],
    });
    return;
  }
  if (currentTask) {
    c.coordinatorRuns = Number(c.coordinatorRuns || 0) + 1; save(); paintMain();
    try { await Engine.respondWhileWorking(makeRT(c), text, currentTask); }
    finally {
      c.coordinatorRuns = Math.max(0, Number(c.coordinatorRuns || 1) - 1);
      save(); paintMain(); paintSide();
    }
    return;
  }
  await runAgentOn(c, text);
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
        <div style="display:flex;gap:12px;align-items:center">${Mascot.svg(a.color,'happy',54)}<div><b>${esc(a.name)}</b><div><span class="chip">Arche 1.0</span></div>${mailCache && mailCache.address ? `<div class="sub mono" style="margin-top:4px">${esc(mailCache.address)}</div>` : ''}</div></div>
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
      </div>`;
  } else if (t === 'approvals') {
    const ap = approvalRows();
    body = `<div class="aslider-sec"><label class="alabel">Approval history (${ap.length + state.vault.approvals.length})</label>
      <div class="kv">
        ${state.vault.approvals.map(x => `<div class="row"><span style="color:var(--green)">${icon('check',15)}</span><div><b>${esc(x.label)}</b><div class="sub">always allowed · ${fmtWhen(x.at)}</div></div><div class="rgt"><button class="btn ghost small" data-act="revoke" data-id="${x.id}">Revoke</button></div></div>`).join('')}
        ${ap.map(x => `<div class="row"><span style="color:var(--mut)">${icon('shieldcheck',15)}</span><div><b>${esc(x.title)}</b><div class="sub">${esc(x.status)} · “${esc(x.chat)}”</div></div></div>`).join('') || (state.vault.approvals.length ? '' : '<div class="row mut">No approvals yet — sensitive actions will pause for you here.</div>')}
      </div></div>`;
  }
  return `<div class="aslider fill">
    <div class="seg canvas-seg">
      <button class="${t === 'appearance' ? 'on' : ''}" data-act="agenttab" data-t="appearance">${icon('user',14)} Appearance</button>
      <button class="${t === 'approvals' ? 'on' : ''}" data-act="agenttab" data-t="approvals">${icon('shieldcheck',14)} Approvals</button>
      <button class="${t === 'library' ? 'on' : ''}" data-act="agenttab" data-t="library">${icon('file',14)} Library</button>
    </div>${body}</div>`;
}

/* Sub Agents panel — now a top-level canvas tab next to Trace. */
function subAgentsTabContent(){
  const agents = state.subAgents || [];
  const kind = state.subAgentTriggerType || 'schedule';
  const apps = state.triggerOptions?.apps || [];
  const scheduleOptions = state.triggerOptions?.schedules || [15,60,360,1440];
  const triggerFields = kind === 'schedule'
    ? `<label class="alabel">Run every</label><select class="field" id="subinterval">${scheduleOptions.map((minutes) => `<option value="${minutes}" ${Number(state.subAgentDraftInterval || 60) === Number(minutes) ? 'selected' : ''}>${minutes === 1440 ? 'Day' : minutes === 10080 ? 'Week' : minutes === 60 ? '1 hour' : minutes >= 60 ? (minutes / 60) + ' hours' : minutes + ' minutes'}</option>`).join('')}</select>`
    : kind === 'app'
      ? (apps.length ? `<label class="alabel">Connected app event (via Composio)</label><select class="field" id="subappevent">${apps.flatMap((app) => app.events.map((event) => `<option value="${esc(app.id + ':' + event)}">${esc(app.name)} · ${esc(event)}</option>`)).join('')}</select>` : `<div class="trigger-empty">${icon('box',16)} No connected apps yet. <button data-act="nav" data-view="apps">Open Apps</button></div>`)
      : `<label class="alabel">After this sub-agent completes</label><select class="field" id="subsource">${agents.map((agent) => `<option value="${agent.id}">${esc(agent.name)}</option>`).join('') || '<option value="">Create another sub-agent first</option>'}</select>`;
  return `<div class="aslider-sec subagents-panel">
    <div class="subagent-intro"><span class="trigger-mark">${icon('clock',18)}</span><div><b>Automated chats</b><p>Each sub-agent has its own chat and runs on a schedule, a connected-app event, or after another sub-agent. App events fire via Composio webhooks.</p></div></div>
    <button class="btn small" data-act="new-subagent">${icon(state.subAgentComposer ? 'x' : 'plus',14)} ${state.subAgentComposer ? 'Close setup' : 'New sub-agent'}</button>
    ${state.subAgentComposer ? `<div class="trigger-form">
      <label class="alabel">Name</label><input class="field" id="subname" maxlength="60" placeholder="Daily brief" value="${esc(state.subAgentDraftName || '')}">
      <label class="alabel">Automation task</label><textarea class="field" id="subprompt" rows="4" placeholder="What should this sub-agent check, decide, or prepare?">${esc(state.subAgentDraft || '')}</textarea>
      <label class="alabel">Trigger</label><select class="field" id="subtrigger"><option value="schedule" ${kind === 'schedule' ? 'selected' : ''}>Schedule</option><option value="app" ${kind === 'app' ? 'selected' : ''}>Connected app</option><option value="subagent" ${kind === 'subagent' ? 'selected' : ''}>Another sub-agent</option></select>
      <div id="triggerfields">${triggerFields}</div>
      <div class="trigger-safety">${icon('shieldcheck',14)} Runs in an isolated, account-scoped sandbox. Chains stop after four handoffs.</div>
      <button class="btn small" data-act="create-subagent" ${kind === 'app' && !apps.length || kind === 'subagent' && !agents.length ? 'disabled' : ''}>Create automation</button>
    </div>` : ''}
    <div class="subagent-list">${agents.map((agent) => `<article class="subagent-card ${agent.enabled ? '' : 'paused'}">
      <button class="subagent-main" data-act="open-subagent" data-id="${agent.id}"><span class="subagent-orb">${Mascot.svg(state.agent.color,'idle',30)}</span><span><b>${esc(agent.name)}</b><small>${esc(subAgentTriggerLabel(agent))}</small></span></button>
      <div class="subagent-meta"><span class="chip ${agent.lastStatus === 'done' ? 'green' : ''}">${agent.enabled ? (agent.lastStatus || 'ready') : 'paused'}</span>${agent.nextRunAt ? `<span>next ${fmtNext(new Date(agent.nextRunAt).getTime())}</span>` : ''}</div>
      ${agent.lastError ? `<div class="trigger-error">${esc(agent.lastError)}</div>` : ''}
      <div class="subagent-actions"><button class="btn ghost tiny" data-act="run-subagent" data-id="${agent.id}" ${agent.enabled ? '' : 'disabled'}>${icon('up',12)} Run now</button><button class="btn ghost tiny" data-act="toggle-subagent" data-id="${agent.id}">${agent.enabled ? 'Pause' : 'Enable'}</button><button class="iconbtn" data-act="delete-subagent" data-id="${agent.id}" title="Delete">${icon('trash',13)}</button></div>
    </article>`).join('') || '<div class="trigger-empty">No sub-agents yet. Create one to watch a schedule, app event, or another automation.</div>'}</div>
  </div>`;
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
      <div class="pctitle">${icon('term',13)} Read-only tool output</div>
      <div class="term mini" id="pcout" style="margin-top:6px">${terms.length ? terms.map(L => `<div class="${L.cls || ''}">${esc(L.t)}</div>`).join('') : '<div class="mut">No runs yet in this chat.</div>'}</div>
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
  const id = liveIdShown;
  if (!id){ toast('No live browser session in this chat yet.'); return; }
  const want = !liveControl;
  try {
    await window.LingonAuth.api('/api/live/takeover', { method: 'POST', body: JSON.stringify({ liveId: id, on: want }) });
    liveControl = want;
    pcConnect();
    liveState(want ? 'user' : 'idle');
    toast(want ? 'You drive the browser — the agent waits.' : 'Agent drives again.');
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
let mailCache = null;
async function ensureMailbox(name){
  if (!window.LingonAuth || !window.LingonAuth.signedIn()) return mailCache;
  const agentName = String(name || (state.agent && state.agent.name) || 'Agent').trim();
  try {
    mailCache = await window.LingonAuth.api('/api/mail/ensure', { method:'POST', body: JSON.stringify({ agentName }) });
  } catch (e) {
    mailCache = Object.assign({ error: e.message, configured:false, address:null, messages:[], drafts:[], unread:0 }, mailCache || {});
  }
  return mailCache;
}
async function getMail(force, folder){
  if (!window.LingonAuth || !window.LingonAuth.signedIn()) return mailCache;
  const tab = folder || state.mailTab || 'inbox';
  if (mailCache && !force && mailCache.folder === tab && tab !== 'write') return mailCache;
  try {
    const name = (state.agent && state.agent.name) || '';
    if (tab === 'write') {
      mailCache = await window.LingonAuth.api('/api/mail?folder=inbox&name=' + encodeURIComponent(name));
      mailCache.folder = 'write';
    } else {
      mailCache = await window.LingonAuth.api('/api/mail?folder=' + encodeURIComponent(tab) + '&name=' + encodeURIComponent(name));
    }
  } catch (e) {
    mailCache = Object.assign({ error: e.message, configured:false, address:null, messages:[], drafts:[], unread:0, folder: tab }, mailCache || {});
  }
  return mailCache;
}
async function openMailMessage(id){
  const j = await window.LingonAuth.api('/api/mail/messages/' + encodeURIComponent(id));
  mailCache = mailCache || {};
  mailCache.selected = j.message;
  if (mailCache.messages) mailCache.messages = mailCache.messages.map((m) => m.id === id ? Object.assign({}, m, { isRead:true }) : m);
  if (mailCache.unread > 0) mailCache.unread -= 1;
  return j.message;
}
function mailListRows(m){
  const who = m.folder === 'sent' ? (m.to || []).join(', ') : (m.fromName ? m.fromName + ' · ' + m.from : m.from);
  return `<button class="mail-row ${m.isRead ? '' : 'unread'}" data-act="m-open" data-id="${esc(m.id)}">
    <span class="mail-dot"></span>
    <span class="mail-meta"><b>${esc(m.subject || '(no subject)')}</b><small>${esc(who || '')}</small><small class="mail-preview">${esc(m.preview || '')}</small></span>
    <span class="mail-when">${fmtWhen(m.at)}</span>
  </button>`;
}
function mailComposeBody(prefill){
  const p = prefill || mailCache && mailCache.compose || {};
  return `<div class="mail-compose">
    <label class="alabel">To</label>
    <input class="field" id="m-to" type="email" placeholder="name@example.com" value="${esc(p.to || '')}">
    <label class="alabel">Subject</label>
    <input class="field" id="m-subject" maxlength="200" value="${esc(p.subject || '')}">
    <label class="alabel">Message</label>
    <textarea class="field" id="m-body" rows="8" placeholder="Written as ${esc((state.agent && state.agent.name) || 'your agent')}…">${esc(p.body || '')}</textarea>
    <input type="hidden" id="m-reply" value="${esc(p.inReplyTo || '')}">
    <input type="hidden" id="m-draft" value="${esc(p.draftId || '')}">
    <div class="mail-actions">
      <button class="btn small" data-act="m-send">${icon('up',14)} Send</button>
      <button class="btn ghost small" data-act="m-draft">${icon('file',14)} Save draft</button>
    </div>
  </div>`;
}
function mailReader(msg){
  if (!msg) return '';
  const who = msg.fromName ? esc(msg.fromName) + ' &lt;' + esc(msg.from) + '&gt;' : esc(msg.from || '');
  return `<div class="mail-read">
    <div class="mail-read-head">
      <button class="btn ghost small" data-act="m-back">${icon('aur',14)} Back</button>
      <button class="btn ghost small" data-act="m-reply" data-id="${esc(msg.id)}">${icon('mail',14)} Reply</button>
    </div>
    <h3>${esc(msg.subject || '(no subject)')}</h3>
    <div class="sub">${who} · ${fmtWhen(msg.at)}</div>
    <div class="sub">To ${esc((msg.to || []).join(', '))}</div>
    <div class="mail-body">${esc(msg.bodyText || '').replace(/\n/g, '<br>')}</div>
  </div>`;
}
function paintMail(body){
  const tab = state.mailTab || 'inbox';
  const m = mailCache;
  const unread = m && m.unread ? m.unread : 0;
  let inner = `<div class="cempty">${icon('mail',28)}<div class="mut2">Loading mail…</div></div>`;
  if (m) {
    if (m.selected && tab !== 'write') inner = mailReader(m.selected);
    else if (tab === 'write') inner = mailComposeBody(m.compose);
    else if (tab === 'drafts') {
      const drafts = m.drafts || [];
      inner = drafts.length
        ? `<div class="mail-list">${drafts.map((d) => `<button class="mail-row" data-act="m-edit-draft" data-id="${esc(d.id)}"><span class="mail-meta"><b>${esc(d.subject || '(no subject)')}</b><small>${esc((d.to || []).join(', ') || 'No recipient')}</small></span></button>`).join('')}</div>`
        : `<div class="cempty">${icon('file',28)}<div class="mut2">No drafts.</div></div>`;
    } else {
      const rows = m.messages || [];
      inner = rows.length
        ? `<div class="mail-list">${rows.map(mailListRows).join('')}</div>`
        : `<div class="cempty">${icon('mail',28)}<div style="font-weight:700;margin-top:12px">${tab === 'sent' ? 'Nothing sent yet' : 'Inbox is empty'}</div><div class="mut2">${m.address ? 'Anyone can write to ' + esc(m.address) : 'Claim the mailbox to start receiving.'}</div></div>`;
    }
  }
  const banner = m && m.configured === false
    ? `<div class="warnband">${icon('mail',18)}<div><b>Mailbox is reserved. Sending needs RESEND_API_KEY.</b>${esc(m.receivingHint || 'Add the MX record Resend shows for mail.belna.se.')}</div></div>`
    : '';
  body.innerHTML = `<div class="aslider fill mail-panel">
    <div class="mail-address">
      <span>${icon('mail',16)}</span>
      <div><b>${esc((state.agent && state.agent.name) || 'Agent')}’s mail</b><div class="sub mono">${esc((m && m.address) || 'Allocating…')}</div></div>
      <div class="rgt">${m && m.address ? `<button class="iconbtn" data-act="m-copy" title="Copy address">${icon('copy',14)}</button>` : ''}<button class="iconbtn" data-act="m-refresh" title="Refresh">${icon('refresh',14)}</button></div>
    </div>
    ${banner}
    <div class="seg canvas-seg">
      <button class="${tab === 'inbox' ? 'on' : ''}" data-act="mtab" data-t="inbox">${icon('mail',14)} Inbox${unread ? ` <span class="cnt">${unread}</span>` : ''}</button>
      <button class="${tab === 'sent' ? 'on' : ''}" data-act="mtab" data-t="sent">${icon('up',14)} Sent</button>
      <button class="${tab === 'drafts' ? 'on' : ''}" data-act="mtab" data-t="drafts">${icon('file',14)} Drafts</button>
      <button class="${tab === 'write' ? 'on' : ''}" data-act="mtab" data-t="write">${icon('plus',14)} Write</button>
    </div>
    ${inner}
  </div>`;
  centerActiveSeg(body);
  if (!m) getMail(true, tab).then(() => { if (state.canvasTab === 'mail' && $('#cbody')) paintMail($('#cbody')); });
}

let walletCache = null;
async function getWallet(force){
  if (!window.LingonAuth || !window.LingonAuth.signedIn()) return walletCache;
  if (walletCache && !force) return walletCache;
  try { walletCache = await window.LingonAuth.api('/api/wallet'); } catch (e) {
    walletCache = Object.assign({ error: e.message, configured:false, card:{ status:'none' }, balances:[], activity:[] }, walletCache || {});
  }
  return walletCache;
}
function shortAddr(a){
  const s = String(a || '');
  return s.length > 12 ? s.slice(0, 6) + '…' + s.slice(-4) : s;
}
function walletCardFace(w){
  const a = state.agent || {};
  const card = (w && w.card) || {};
  const last4 = card.last4 ? String(card.last4) : '••••';
  const status = card.status || 'none';
  const stLabel = status === 'active' ? 'Active' : status === 'pending_kyc' ? 'KYC' : status === 'pending' ? 'Attached' : status === 'frozen' ? 'Frozen' : 'Ready';
  return `<div class="awallet-card ${status}">
    <div class="awallet-card-top"><span>${icon('wallet',14)} ${esc(a.name || 'Agent')} card</span><span class="chip">${esc(stLabel)}</span></div>
    <div class="awallet-card-chip"></div>
    <div class="awallet-card-no">•••• •••• •••• ${esc(last4)}</div>
    <div class="awallet-card-bot">
      <div><small>Holder</small><b>${esc(card.holderName || a.name || 'Agent')}</b></div>
      <div><small>Tied to</small><b class="mono">${esc(shortAddr(w && w.address))}</b></div>
    </div>
  </div>`;
}
function walletOverviewBody(w){
  const ready = !!(w && w.address);
  const a = state.agent || {};
  const bals = (w && w.balances) || [];
  const balRows = bals.map((b) => `<div class="row"><span style="color:var(--mut)">${icon('wallet',15)}</span><div><b>${esc(String(b.asset || '').toUpperCase())}</b><div class="sub">${esc(b.chain || w.chain || 'base')}</div></div><div class="rgt"><b>${esc(b.amount || '0')}</b>${b.usd ? `<div class="sub">$${esc(b.usd)}</div>` : ''}</div></div>`).join('')
    || `<div class="row mut">${ready ? 'No on-chain balance yet — send USDC on Base to this address.' : 'Create the wallet to see balances.'}</div>`;
  return `
    <div class="warnband">${icon('shieldcheck',18)}<div><b>How ${esc(a.name || 'your agent')} spends</b>1. They ask in chat (“buy X for $Y”). 2. You tap Allow. 3. The wallet sends coins, or the card may charge that amount only. They never get the card number or the key.</div></div>
    <div class="kv">
      <div class="row"><span style="color:var(--mut)">${icon('wallet',16)}</span>
        <div><b>${ready ? esc(a.name || 'Agent') + '’s wallet' : 'No wallet yet'}</b><div class="sub mono">${ready ? esc(w.address) : (w && w.configured === false ? 'Add PRIVY_APP_ID and PRIVY_APP_SECRET on the server' : 'Create a Privy wallet for this agent')}</div></div>
        <div class="rgt">${ready ? `<button class="iconbtn" data-act="w-copy" title="Copy address">${icon('copy',14)}</button>` : `<button class="btn small" data-act="w-ensure">${icon('plus',14)} Create wallet</button>`}</div>
      </div>
      <div class="row"><span style="color:var(--mut)">${icon('shield',16)}</span>
        <div><b>Daily spend cap</b><div class="sub">USDC the agent may send after you approve</div></div>
        <div class="rgt"><input class="field" id="wlimit" type="number" min="1" max="500" step="1" value="${esc(w && w.dailyLimitUsd != null ? w.dailyLimitUsd : 50)}" style="max-width:88px"> <button class="btn ghost small" data-act="w-limit">Save</button></div>
      </div>
      <div class="row"><span style="color:var(--green)">${icon('check',16)}</span>
        <div><b>Remaining today</b><div class="sub">$${esc((w && w.spentTodayUsd) || 0)} used</div></div>
        <div class="rgt"><b>$${(w && w.remainingTodayUsd != null) ? esc(w.remainingTodayUsd) : '—'}</b></div>
      </div>
    </div>
    <label class="alabel">Balances</label>
    <div class="kv">${balRows}</div>
    ${ready ? `<div class="psec"><label class="alabel">Send (you confirm)</label>
      <div class="kv"><div class="row" style="background:var(--panel);flex-wrap:wrap;gap:8px">
        <select class="field" id="wasset" style="max-width:110px"><option value="usdc">USDC</option><option value="eth">ETH</option></select>
        <input class="field" id="wamt" placeholder="0.00" style="max-width:110px">
        <input class="field mono" id="wto" placeholder="0x…" style="flex:1;min-width:160px">
        <button class="btn small" data-act="w-send">${icon('up',14)} Send</button>
      </div></div></div>` : ''}
    <label class="alabel">Activity</label>
    <div class="kv">${((w && w.activity) || []).map((t) => `<div class="row"><span style="color:var(--mut)">${icon('wallet',15)}</span><div><b>${esc(t.kind)} · ${esc(t.asset)} ${esc(t.amount)}</b><div class="sub">${esc(t.to || '')} · ${esc(t.status)}</div></div><div class="rgt"><span class="chip">${esc(t.status)}</span></div></div>`).join('') || '<div class="row mut">No transfers yet.</div>'}</div>`;
}
function walletCardBody(w){
  const card = (w && w.card) || { status:'none' };
  const bill = card.billing || {};
  const attached = card.status && card.status !== 'none';
  const buys = (w && w.purchases) || [];
  return `
    ${walletCardFace(w)}
    <div class="warnband">${icon('card',18)}<div><b>Stripe one-time virtual cards.</b>You approve in chat → Stripe Issuing mints a single-use Visa locked to that amount. The agent only sees last four. You reveal the digits here to finish checkout. The model never gets the number.</div></div>
    <div class="kv">
      <div class="row"><span style="color:var(--mut)">${icon('card',16)}</span>
        <div><b>${attached ? 'Standing card attached' : 'Attach the agent card'}</b><div class="sub">${w && w.address ? ('Wallet ' + esc(shortAddr(w.address))) : 'Create the wallet first'}</div></div>
        <div class="rgt">${attached ? `<span class="chip green">${esc(card.status)}</span>` : `<button class="btn small" data-act="w-card" ${w && w.address ? '' : 'disabled'}>${icon('card',14)} Attach card</button>`}</div>
      </div>
    </div>
    <label class="alabel">Billing (for Stripe Issuing)</label>
    <div class="kv"><div class="row" style="background:var(--panel);flex-wrap:wrap;gap:8px">
      <input class="field" id="w-line1" placeholder="Street" value="${esc(bill.line1 || '')}" style="flex:1;min-width:140px">
      <input class="field" id="w-city" placeholder="City" value="${esc(bill.city || '')}" style="max-width:140px">
      <input class="field" id="w-postal" placeholder="ZIP" value="${esc(bill.postal || '')}" style="max-width:90px">
      <input class="field" id="w-country" placeholder="US" value="${esc(bill.country || 'US')}" style="max-width:70px">
      <button class="btn ghost small" data-act="w-billing">Save</button>
    </div></div>
    <label class="alabel">One-time virtual cards</label>
    <div class="kv">${buys.map((p) => `<div class="row"><span style="color:var(--mut)">${icon('card',15)}</span><div><b>$${esc(p.amount)} at ${esc(p.merchant)}</b><div class="sub">${p.issuing ? 'Stripe virtual · ' : ''}${p.last4 ? '•••• ' + esc(p.last4) : 'no last4'} · ${esc(p.reason || 'approved in chat')}${p.issuingError ? ' · ' + esc(p.issuingError) : ''}</div></div><div class="rgt">${p.issuing ? `<button class="btn ghost small" data-act="w-reveal" data-id="${esc(p.id)}">Reveal</button>` : ''}<span class="chip">${esc(p.status)}</span></div></div>`).join('') || '<div class="row mut">None yet. Approve a purchase in chat and Stripe will mint a one-time card.</div>'}
    </div>
    <div id="issuing-reveal" class="issuing-reveal" hidden>
      <label class="alabel">Card number (you only)</label><div id="issuing-number" class="issuing-el"></div>
      <div class="issuing-row"><div><label class="alabel">Expiry</label><div id="issuing-exp" class="issuing-el"></div></div><div><label class="alabel">CVC</label><div id="issuing-cvc" class="issuing-el"></div></div></div>
    </div>`;
}
function loadStripeJs(){
  return new Promise((resolve, reject) => {
    if (window.Stripe) return resolve(window.Stripe);
    const s = document.createElement('script');
    s.src = 'https://js.stripe.com/v3/';
    s.onload = () => resolve(window.Stripe);
    s.onerror = () => reject(new Error('Could not load Stripe.'));
    document.head.appendChild(s);
  });
}
async function revealStripeCard(purchaseId){
  const w = walletCache;
  const buy = ((w && w.purchases) || []).find((p) => p.id === purchaseId);
  if (!buy || !buy.stripeCardId) throw new Error('No Stripe virtual card on that purchase.');
  if (!w.stripePk) throw new Error('Add STRIPE_PUBLISHABLE_KEY to the server to reveal the card.');
  const StripeCtor = await loadStripeJs();
  const stripe = StripeCtor(w.stripePk);
  const nonceRes = await stripe.createEphemeralKeyNonce({ issuingCard: buy.stripeCardId });
  const ek = await window.LingonAuth.api('/api/wallet/purchases/' + encodeURIComponent(purchaseId) + '/ephemeral', { method:'POST', body: JSON.stringify({ nonce: nonceRes.nonce }) });
  const box = $('#issuing-reveal');
  if (box) box.hidden = false;
  const elements = stripe.elements();
  const opts = { issuingCard: buy.stripeCardId, nonce: nonceRes.nonce, ephemeralKeySecret: ek.secret };
  ['issuing-number','issuing-exp','issuing-cvc'].forEach((id) => { const n = document.getElementById(id); if (n) n.innerHTML = ''; });
  if ($('#issuing-number')) elements.create('issuingCardNumberDisplay', opts).mount('#issuing-number');
  if ($('#issuing-exp')) elements.create('issuingCardExpiryDisplay', opts).mount('#issuing-exp');
  if ($('#issuing-cvc')) elements.create('issuingCardCvcDisplay', opts).mount('#issuing-cvc');
}

function paintWallet(body){
  const tab = state.walletTab || 'wallet';
  const w = walletCache;
  const err = w && w.error ? `<div class="trigger-error">${esc(w.error)}</div>` : '';
  const inner = !w
    ? `<div class="cempty">${icon('wallet',28)}<div class="mut2">Loading wallet…</div></div>`
    : tab === 'card' ? walletCardBody(w) : walletOverviewBody(w);
  body.innerHTML = `<div class="aslider fill wallet-panel">
    <div class="seg canvas-seg">
      <button class="${tab === 'wallet' ? 'on' : ''}" data-act="wtab" data-t="wallet">${icon('wallet',14)} Wallet</button>
      <button class="${tab === 'card' ? 'on' : ''}" data-act="wtab" data-t="card">${icon('card',14)} Card</button>
      <button class="iconbtn" data-act="w-refresh" title="Refresh" style="margin-left:auto">${icon('refresh',14)}</button>
    </div>${err}${inner}</div>`;
  centerActiveSeg(body);
  if (!w) getWallet(true).then(() => { if (state.canvasTab === 'wallet' && $('#cbody')) paintWallet($('#cbody')); });
}

function paintCanvas(){
  const cv = $('#canvas'); if (!cv) return;
  // Migrate legacy 'live' tab to 'canvas'
  if (state.canvasTab === 'live') state.canvasTab = 'canvas';
  if (!state._showLiveInCanvas) state._showLiveInCanvas = false;
  if (!(state.canvasTab === 'canvas' && state._showLiveInCanvas)){ if (liveWS) liveClose(); }
  const c = chat();
  const top = state.canvasTab || 'canvas';
  const liveId = liveIdFor(c);
  cv.innerHTML = `
    <div class="canvas-resize" id="canvasResize"></div>
    <div class="canvas-head">
      <div class="seg canvas-seg">
        <button class="${top === 'agent' ? 'on' : ''}" data-act="ctab" data-t="agent" title="Agent panel">${Mascot.svg(state.agent.color,'idle',18)}<span>${esc(state.agent.name)}</span></button>
        <button class="${top === 'canvas' ? 'on' : ''}" data-act="ctab" data-t="canvas">${icon('board',14)} Canvas${liveId ? '<span class="livedot"></span>' : ''}</button>
        <button class="${top === 'trace' ? 'on' : ''}" data-act="ctab" data-t="trace">${icon('list',14)} Trace <span class="cnt">${(c && c.trace || []).length}</span></button>
        <button class="${top === 'subagents' ? 'on' : ''}" data-act="ctab" data-t="subagents">${icon('clock',14)} Sub Agents <span class="cnt">${(state.subAgents || []).length}</span></button>
        <button class="${top === 'mail' ? 'on' : ''}" data-act="ctab" data-t="mail">${icon('mail',14)} Mail${mailCache && mailCache.unread ? ` <span class="cnt">${mailCache.unread}</span>` : ''}</button>
        <button class="${top === 'wallet' ? 'on' : ''}" data-act="ctab" data-t="wallet">${icon('wallet',14)} Wallet</button>
      </div>
      <button class="canvas-close" data-act="togglecanvas" aria-label="Close canvas">${icon('x',16)}</button>
    </div>
    <div class="cbody" id="cbody"></div>`;
  initCanvasResize();
  centerActiveSeg(cv);
  const body = $('#cbody');
  if (top === 'mail'){
    paintMail(body);
    return;
  }
  if (top === 'wallet'){
    paintWallet(body);
    return;
  }
  if (top === 'agent'){
    body.innerHTML = agentSliderContent();
    centerActiveSeg(body);
    const an = $('#agentname');
    if (an) an.addEventListener('change', e => {
      const v = e.target.value.trim(); if (!v) return;
      state.agent.name = v; save(); paintSide(); paintMain(); paintCanvas();
      ensureMailbox(v).then(() => { if (state.canvasTab === 'agent' && $('#cbody')) paintCanvas(); });
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
  if (state.canvasTab === 'subagents'){
    body.innerHTML = subAgentsTabContent();
    refreshSubAgents(false);
    return;
  }
  if (top === 'live'){
    state.canvasTab = 'canvas'; state._showLiveInCanvas = true;
    paintLive(body, c);
    return;
  }
  // Show live session in canvas tab when flagged or when there's an active live session but no artifact
  if (state._showLiveInCanvas && liveIdFor(c)){
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

/* ---------------- canvas drag-to-resize ---------------- */
function initCanvasResize(){
  const handle = $('#canvasResize');
  const cv = $('#canvas');
  if (!handle || !cv) return;
  let dragging = false, startX = 0, startW = 0;
  handle.addEventListener('mousedown', function(e){
    e.preventDefault();
    dragging = true;
    startX = e.clientX;
    startW = cv.offsetWidth;
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
    function onMove(e2){
      if (!dragging) return;
      const delta = startX - e2.clientX;
      const newW = Math.min(1200, Math.max(420, startW + delta));
      cv.style.width = newW + 'px';
    }
    function onUp(){
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    }
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  });
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
    <div class="warnband">${icon('shieldcheck',18)}<div><b>Your secrets remain protected.</b>Values are masked in chat and activity history. Reveal below is for your eyes alone, on this device.</div></div>
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
    const connected = (state.composioApps || []).filter((a) => a.connected);
    body = `<div class="warnband">${icon('shieldcheck',18)}<div><b>Apps moved to their own home.</b>Connections are per-account OAuth via Composio — Belna never sees your passwords. Manage everything under Apps.</div></div>
    <div class="kv">
      ${connected.map((a) => `<div class="row">
        <img src="${esc(a.logo || '')}" alt="" style="width:26px;height:26px;border-radius:8px" onerror="this.style.display='none'">
        <div><b>${esc(a.name || a.toolkit)}</b><div class="sub">connected · powers chat, sub-agents and triggers</div></div>
        <div class="rgt"><span class="chip green">connected</span></div></div>`).join('') || '<div class="row mut">No apps connected yet.</div>'}
      <div class="row" style="background:var(--panel)"><div><b>Connect apps</b><div class="sub">${connected.length} connected · ${(state.composioApps || []).length} available</div></div>
      <div class="rgt"><button class="btn small" data-act="nav" data-view="apps">Open Apps</button></div></div>
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
    state.agent.name = v; save(); paintSide(); paintCanvas();
    ensureMailbox(v);
    toast('Renamed — they answer to ' + v + ' now.');
  });
}

/* ---------------- Settings (profiles / secrets / memory / browser / billing) ---------------- */
function settingsSecretsBody(v){
  return `
    <div class="warnband">${icon('shieldcheck',18)}<div><b>Your secrets remain protected.</b>Values are masked in chat and activity history. Reveal below is for your eyes alone, on this device.</div></div>
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
function settingsMemoryBody(){
  return `<section class="memory-root">
      <div class="memory-root-main">
        <span class="memory-root-icon">${icon('folder',22)}</span>
        <div><span class="memory-kicker">Root memory</span><b class="mono">/memory</b><p>Account-scoped notes your agent uses across your chats.</p></div>
        <span class="chip green">${state.memory.length} remembered</span>
      </div>
      <div class="memory-items">${state.memory.map(m => `<div class="memory-entry">
        <span class="memory-file-icon">${icon('file',16)}</span>
        <div class="memory-entry-copy"><b>${esc(m.text)}</b><div>${esc(m.src || 'account')} · ${fmtWhen(m.at)}</div></div>
        <button class="iconbtn" data-act="delmem" data-id="${m.id}" title="Delete memory">${icon('trash',14)}</button>
      </div>`).join('') || `<div class="memory-empty"><span class="memory-file-icon">${icon('book',16)}</span><div><b>Nothing remembered yet</b><p>Ask your agent to remember a preference or detail and it will appear here.</p></div></div>`}</div>
    </section>`;
}
function centerActiveSeg(container){
  const tabs = container && container.querySelector('.seg');
  const active = tabs && tabs.querySelector('.on');
  if (!tabs || !active) return;
  requestAnimationFrame(() => {
    tabs.scrollLeft = Math.max(0, active.offsetLeft - (tabs.clientWidth - active.offsetWidth) / 2);
  });
}
function centerActiveSettingsTab(container){ centerActiveSeg(container); }
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
    body = settingsMemoryBody();
  } else if (tab === 'browser'){
    const bp = state.browserProfile || { profile:'Default', sandbox:true, allowlist:true };
    body = `<div class="kv">
      <div class="row"><span style="color:var(--mut)">${icon('globe',16)}</span><div><b>Profile</b><div class="sub">Sandboxed browser identity for this device</div></div>
      <div class="rgt"><input class="field" id="bprof" value="${esc(bp.profile)}" style="max-width:180px"></div></div>
    </div>`;
  } else if (tab === 'billing'){
    body = `<div id="billbody"><div class="row mut">Loading…</div></div>
      <div id="plancards" style="margin-top:18px"></div>
      <div class="kv billing-redeem"><div class="row">
        <span class="billing-redeem-icon">${icon('gift',18)}</span>
        <input class="field mono" id="giftcode" placeholder="LNG-XXXX-XXXX-XXXX">
        <button class="btn small" data-act="redeem">${icon('gift',14)} Redeem gift</button>
      </div></div>`;
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
      <button class="${tab === 'billing' ? 'on' : ''}" data-act="stab" data-t="billing">${icon('card',14)} Billing</button>
    </div>
    ${body}
  </div></div>`;
  centerActiveSettingsTab(M);
  const pn = $('#pname');
  if (pn) pn.addEventListener('change', e => {
    const v = e.target.value.trim(); if (!v) return;
    state.agent.name = v; save(); paintSide(); paintCanvas();
    ensureMailbox(v);
    toast('Renamed — they answer to ' + v + ' now.');
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
      if (pc && b) { pc.innerHTML = planCards(b); wireBillingSliders(pc); }
    });
  }
}

/* ---------------- Apps — Belna connected apps via Composio ---------------- */
function paintApps(M){
  const apps = Array.isArray(state.composioApps) ? state.composioApps : [];
  const q = String(state.appQuery || '').toLowerCase().trim();
  const filter = state.appFilter || 'all';
  const connectedCount = apps.filter((a) => a.connected).length;

  let list = apps;
  if (filter === 'connected') list = list.filter((a) => a.connected);
  if (filter === 'available') list = list.filter((a) => !a.connected);
  if (q) {
    list = list.filter((a) =>
      String(a.name || '').toLowerCase().includes(q) ||
      String(a.toolkit || '').toLowerCase().includes(q) ||
      String(a.description || '').toLowerCase().includes(q)
    );
  }

  const cards = list.map((a) => {
    const logo = a.logo
      ? `<img src="${esc(a.logo)}" alt="" loading="lazy" onerror="this.style.display='none'">`
      : `<span class="app-fallback">${esc(String(a.name || a.toolkit || '?').slice(0, 1).toUpperCase())}</span>`;
    return `<article class="app-card ${a.connected ? 'is-connected' : ''}">
      <div class="app-top"><span class="app-logo">${logo}</span>
        ${a.connected ? '<span class="chip green">connected</span>' : '<span class="chip">not connected</span>'}
      </div>
      <b>${esc(a.name || a.toolkit)}</b>
      <p>${esc(String(a.description || 'Connect to let your Belna agent act on it.').slice(0, 140))}</p>
      <div class="app-actions">
        ${a.connected
          ? `<button class="btn ghost small" data-act="disconnect-app" data-toolkit="${esc(a.toolkit)}">Disconnect</button>
             <button class="btn small" data-act="automate-app" data-toolkit="${esc(a.toolkit)}">Automate</button>`
          : `<button class="btn small" data-act="connect-app" data-toolkit="${esc(a.toolkit)}" data-auth="${esc(a.authConfigId || '')}">Connect</button>`}
      </div>
    </article>`;
  }).join('');

  M.innerHTML = `<div class="page"><div class="pageinner apps-page">
    <div class="phead apps-head">
      <div class="apps-title">
        <span class="apps-mascot">${Mascot.logo(34)}</span>
        <div><h1>Apps</h1><div class="apps-sub">${connectedCount} connected · ${apps.length} available · <span class="belna-accent">belna</span> secure connections</div></div>
      </div>
      <span style="display:flex;gap:8px;align-items:center">
        <button class="btn ghost small" data-act="refresh-apps">${icon('refresh',14)} Refresh</button>
        <button class="btn ghost small" data-act="nav" data-view="chat">Back to chat</button>
      </span>
    </div>
    <div class="apps-hero">
      <div><b>Connect once — your agent does the work.</b><p>Secure per-account OAuth handled by Composio. Belna never sees your passwords, tokens stay with your account, and you can disconnect anytime. Connected apps power chat actions, sub-agents and triggers.</p></div>
      <span class="chip acc">${icon('shieldcheck',12)} OAuth · per-user isolation</span>
    </div>
    <div class="apps-toolbar">
      <input class="field apps-search" id="appquery" placeholder="Search apps — gmail, github, slack…" value="${esc(state.appQuery || '')}">
      <div class="seg apps-filter">
        <button class="${filter === 'all' ? 'on' : ''}" data-act="app-filter" data-f="all">All</button>
        <button class="${filter === 'connected' ? 'on' : ''}" data-act="app-filter" data-f="connected">Connected (${connectedCount})</button>
        <button class="${filter === 'available' ? 'on' : ''}" data-act="app-filter" data-f="available">Available</button>
      </div>
    </div>
    ${state.composioLoading ? '<div class="row mut" style="padding:18px">Loading your apps…</div>' : ''}
    ${!state.composioLoading && !apps.length ? `<div class="kv"><div class="row mut">App connections are not configured yet. The server needs COMPOSIO_API_KEY.</div></div>` : ''}
    ${!state.composioLoading && apps.length && !list.length ? '<div class="kv"><div class="row mut">No apps match your search.</div></div>' : ''}
    <div class="apps-grid">${cards}</div>
    <p class="fineprint">Trouble after connecting? Press Refresh — Composio confirms the connection, then chat, sub-agents and triggers can use it immediately.</p>
  </div></div>`;
  const input = $('#appquery');
  if (input) {
    input.addEventListener('input', (e) => {
      state.appQuery = e.target.value;
      save();
      const pos = e.target.selectionStart;
      paintApps($('#main'));
      const again = $('#appquery');
      if (again) { again.focus(); try { again.setSelectionRange(pos, pos); } catch {} }
    });
  }
  if (!apps.length && !state.composioLoading && signedIn()) refreshComposioApps();
}

/* ================================================================
   GLOBAL EVENTS
================================================================ */
window.addEventListener('resize', () => {
  if (state.view === 'settings' && $('#main')) centerActiveSettingsTab($('#main'));
});
window.addEventListener('focus', () => {
  startSandboxLease();
  if (signedIn() && state.onboarded) syncFromBackend().then(() => { if ($('#side')) paintSide(); if (state.view === 'chat' && $('#main')) paintMain(); });
});
window.addEventListener('pagehide', () => stopSandboxLease());
document.addEventListener('change', (e) => {
  if (e.target && e.target.id === 'subtrigger') {
    state.subAgentDraft = (($('#subprompt') || {}).value || '');
    state.subAgentDraftName = (($('#subname') || {}).value || '');
    state.subAgentTriggerType = e.target.value;
    save(); paintCanvas();
  }
  if (e.target && e.target.id === 'subinterval') {
    state.subAgentDraftInterval = Number(e.target.value || 60);
    save();
  }
});
document.addEventListener('click', async e => {
  const b = e.target.closest('[data-act]');
  if (!b) return;
  const act = b.dataset.act;
  const c = state.chats.find(x => x.id === b.dataset.chat);
  const m = c && c.messages.find(x => x.id === b.dataset.msg);

  if (act === 'rmfile'){ removeFile(+b.dataset.idx); return; }
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
  if (act === 'togglemenu'){ mobileNavOpen = !mobileNavOpen; renderApp(); return; }
  if (act === 'nav'){
    if (!signedIn()){ renderAuth(); return; }
    mobileNavOpen = false; state.view = b.dataset.view; state.userMenuOpen = false; save(); renderApp();
    if (state.view === 'apps') refreshComposioApps();
    return;
  }
  if (act === 'refresh-apps'){ refreshComposioApps(); return; }
  if (act === 'app-filter'){ state.appFilter = b.dataset.f || 'all'; save(); paintApps(document.getElementById('main')); return; }
  if (act === 'connect-app'){ connectComposioApp(b.dataset.toolkit, b.dataset.auth); return; }
  if (act === 'disconnect-app'){ disconnectComposioApp(composioAppByToolkit(b.dataset.toolkit)); return; }
  if (act === 'automate-app'){
    const _tk = String(b.dataset.toolkit || '').toLowerCase();
    state.canvasTab = 'subagents'; state.canvasOpen = true;
    state.subAgentComposer = true; state.subAgentTriggerType = 'app';
    save(); paintCanvas(); refreshSubAgents();
    toast(_tk ? ('Pick a ' + _tk + ' event for the trigger.') : 'Pick a connected-app event.');
    return;
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
  if (act === 'agenttab'){
    state.agentTab = b.dataset.t; state.canvasTab = 'agent'; save(); paintCanvas();
    return;
  }
  if (act === 'new-subagent'){
    state.subAgentComposer = !state.subAgentComposer;
    if (!state.subAgentComposer) { state.subAgentDraft = ''; state.subAgentDraftName = ''; }
    save(); paintCanvas(); return;
  }
  if (act === 'open-subagents'){
    state.canvasTab = 'subagents'; state.canvasOpen = true;
    const app = $('#app'); if (app) app.classList.remove('nocanvas');
    save(); paintCanvas(); refreshSubAgents(); return;
  }
  if (act === 'create-subagent'){
    const name = (($('#subname') || {}).value || '').trim();
    const prompt = (($('#subprompt') || {}).value || '').trim();
    const type = (($('#subtrigger') || {}).value || 'schedule');
    let trigger;
    if (type === 'schedule') trigger = { type, intervalMinutes:Number((($('#subinterval') || {}).value) || 60) };
    if (type === 'app') {
      const _ae = String((($('#subappevent') || {}).value) || ''); const _ci = _ae.indexOf(':'); const app = _ci >= 0 ? _ae.slice(0, _ci) : _ae; const event = _ci >= 0 ? _ae.slice(_ci + 1) : '';
      trigger = { type, app, event };
    }
    if (type === 'subagent') trigger = { type, sourceAgentId:(($('#subsource') || {}).value) || '' };
    if (!name || !prompt){ toast('Name and automation task are required.'); return; }
    b.disabled = true;
    try {
      const result = await window.LingonAuth.api('/api/sub-agents', { method:'POST', body:JSON.stringify({ name, prompt, trigger, enabled:true }) });
      state.subAgents.unshift(result.subAgent);
      state.subAgentComposer = false; state.subAgentDraft = ''; state.subAgentDraftName = ''; save(); paintCanvas();
      toast(`${result.subAgent.name} is watching for its trigger.`);
    } catch (err) { b.disabled = false; toast(err.message); }
    return;
  }
  if (act === 'toggle-subagent'){
    const agent = state.subAgents.find((item) => item.id === b.dataset.id); if (!agent) return;
    try {
      const result = await window.LingonAuth.api('/api/sub-agents/' + encodeURIComponent(agent.id), { method:'PATCH', body:JSON.stringify({ enabled:!agent.enabled }) });
      Object.assign(agent, result.subAgent); save(); paintCanvas();
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === 'run-subagent'){
    const agent = state.subAgents.find((item) => item.id === b.dataset.id); if (!agent) return;
    b.disabled = true; b.innerHTML = `${icon('refresh',12)} Running…`;
    try {
      const result = await window.LingonAuth.api('/api/sub-agents/' + encodeURIComponent(agent.id) + '/run', { method:'POST', body:'{}' });
      await syncFromBackend();
      state.activeChat = result.chatId || agent.chatId; state.view = 'chat'; save(); renderApp();
      toast(`${agent.name} completed its run.`);
    } catch (err) { b.disabled = false; toast(err.message); }
    return;
  }
  if (act === 'open-subagent'){
    const agent = state.subAgents.find((item) => item.id === b.dataset.id); if (!agent) return;
    await syncFromBackend();
    if (!state.chats.some((item) => item.id === agent.chatId)) state.chats.unshift({ id:agent.chatId, title:agent.name, messages:[], trace:[], artifact:null, source:'automation', subAgentId:agent.id, createdAt:Date.now() });
    state.activeChat = agent.chatId; state.view = 'chat'; save(); renderApp(); return;
  }
  if (act === 'delete-subagent'){
    const agent = state.subAgents.find((item) => item.id === b.dataset.id); if (!agent) return;
    if (!window.confirm(`Delete ${agent.name}? Its automation chat will remain in history.`)) return;
    try {
      await window.LingonAuth.api('/api/sub-agents/' + encodeURIComponent(agent.id), { method:'DELETE' });
      state.subAgents = state.subAgents.filter((item) => item.id !== agent.id); save(); paintCanvas(); toast('Sub-agent deleted.');
    } catch (err) { toast(err.message); }
    return;
  }
  if (act === 'newchat'){ mobileNavOpen = false; newChat(); return; }
  if (act === 'openchat'){
    if (!signedIn()){ renderAuth(); return; }
    mobileNavOpen = false; state.activeChat = b.dataset.id; state.view = 'chat'; save(); renderApp(); return;
  }
  if (act === 'delchat'){
    e.stopPropagation();
    const deleting = state.chats.find(x => x.id === b.dataset.id);
    if (deleting) stopDelegatedTask(deleting);
    state.chats = state.chats.filter(x => x.id !== b.dataset.id);
    if (state.activeChat === b.dataset.id) state.activeChat = state.chats[0] ? state.chats[0].id : null;
    save(); renderApp(); return;
  }
  if (act === 'togglecanvas'){ state.canvasOpen = !state.canvasOpen; save(); $('#app').classList.toggle('nocanvas', !state.canvasOpen); paintCanvas(); return; }
  if (act === 'ctab'){ state.canvasTab = b.dataset.t; if (b.dataset.t !== 'canvas') state._showLiveInCanvas = false; save(); paintCanvas(); if (b.dataset.t === 'subagents') refreshSubAgents(); if (b.dataset.t === 'wallet') getWallet(true).then(() => { if (state.canvasTab === 'wallet' && $('#cbody')) paintWallet($('#cbody')); }); if (b.dataset.t === 'mail') getMail(true, state.mailTab).then(() => { if (state.canvasTab === 'mail' && $('#cbody')) paintMail($('#cbody')); }); return; }
  if (act === 'mtab'){
    state.mailTab = b.dataset.t || 'inbox';
    if (mailCache) mailCache.selected = null;
    if (state.mailTab === 'write' && mailCache) mailCache.compose = { to:'', subject:'', body:'' };
    save();
    if ($('#cbody')) paintMail($('#cbody'));
    if (state.mailTab !== 'write') getMail(true, state.mailTab).then(() => { if (state.canvasTab === 'mail' && $('#cbody')) paintMail($('#cbody')); });
    return;
  }
  if (act === 'm-refresh'){ getMail(true, state.mailTab === 'write' ? 'inbox' : state.mailTab).then(() => { if ($('#cbody')) paintMail($('#cbody')); }); return; }
  if (act === 'm-copy'){
    const addr = mailCache && mailCache.address;
    if (!addr){ toast('No address yet.'); return; }
    copyText(addr).then(() => toast('Copied ' + addr)).catch(() => toast('Could not copy'));
    return;
  }
  if (act === 'm-open'){
    openMailMessage(b.dataset.id).then(() => { if ($('#cbody')) paintMail($('#cbody')); }).catch((err) => toast(err.message));
    return;
  }
  if (act === 'm-back'){
    if (mailCache) mailCache.selected = null;
    if ($('#cbody')) paintMail($('#cbody'));
    return;
  }
  if (act === 'm-reply'){
    const msg = mailCache && mailCache.selected;
    if (!msg) return;
    state.mailTab = 'write';
    mailCache.selected = null;
    mailCache.compose = {
      to: msg.direction === 'outbound' ? (msg.to || []).join(', ') : msg.from,
      subject: /^re:/i.test(msg.subject || '') ? msg.subject : 'Re: ' + (msg.subject || ''),
      body: '',
      inReplyTo: msg.messageId || msg.id,
    };
    save();
    if ($('#cbody')) paintMail($('#cbody'));
    return;
  }
  if (act === 'm-edit-draft'){
    const draft = ((mailCache && mailCache.drafts) || []).find((d) => d.id === b.dataset.id);
    if (!draft) return;
    state.mailTab = 'write';
    mailCache.compose = { to: (draft.to || []).join(', '), subject: draft.subject, body: draft.bodyText, draftId: draft.id, inReplyTo: draft.inReplyTo };
    save();
    if ($('#cbody')) paintMail($('#cbody'));
    return;
  }
  if (act === 'm-draft'){
    const to = (($('#m-to') || {}).value || '').trim();
    const subject = (($('#m-subject') || {}).value || '').trim();
    const bodyTxt = (($('#m-body') || {}).value || '').trim();
    const draftId = (($('#m-draft') || {}).value || '').trim();
    window.LingonAuth.api('/api/mail/drafts', { method:'POST', body: JSON.stringify({ id: draftId || undefined, to, subject, body: bodyTxt }) }).then((j) => {
      toast('Draft saved.');
      if (mailCache) mailCache.compose = Object.assign({}, mailCache.compose, { draftId: j.draft && j.draft.id });
    }).catch((err) => toast(err.message));
    return;
  }
  if (act === 'm-send'){
    const to = (($('#m-to') || {}).value || '').trim();
    const subject = (($('#m-subject') || {}).value || '').trim();
    const bodyTxt = (($('#m-body') || {}).value || '').trim();
    const inReplyTo = (($('#m-reply') || {}).value || '').trim();
    const draftId = (($('#m-draft') || {}).value || '').trim();
    if (!to || !subject || !bodyTxt){ toast('To, subject and message are required.'); return; }
    if (!window.confirm('Send this email as ' + ((state.agent && state.agent.name) || 'your agent') + '?')) return;
    b.disabled = true;
    window.LingonAuth.api('/api/mail/send', { method:'POST', body: JSON.stringify({ to, subject, body: bodyTxt, inReplyTo: inReplyTo || undefined, draftId: draftId || undefined, agentName: (state.agent && state.agent.name) || '', confirm:true }) }).then((j) => {
      mailCache = j.mailbox || mailCache;
      state.mailTab = 'sent';
      save();
      if ($('#cbody')) paintMail($('#cbody'));
      toast('Sent from ' + ((mailCache && mailCache.address) || 'the agent mailbox') + '.');
    }).catch((err) => { b.disabled = false; toast(err.message); });
    return;
  }
  if (act === 'wtab'){ state.walletTab = b.dataset.t || 'wallet'; save(); if ($('#cbody')) paintWallet($('#cbody')); return; }
  if (act === 'w-refresh'){ getWallet(true).then(() => { if ($('#cbody')) paintWallet($('#cbody')); }); return; }
  if (act === 'w-copy'){
    const addr = walletCache && walletCache.address;
    if (!addr){ toast('No wallet address yet.'); return; }
    copyText(addr).then(() => toast('Wallet address copied')).catch(() => toast('Could not copy'));
    return;
  }
  if (act === 'w-ensure'){
    b.disabled = true;
    window.LingonAuth.api('/api/wallet/ensure', { method:'POST', body:'{}' }).then((j) => {
      walletCache = j; if ($('#cbody')) paintWallet($('#cbody')); toast('Agent wallet is ready.');
    }).catch((err) => { b.disabled = false; toast(err.message); });
    return;
  }
  if (act === 'w-card'){
    b.disabled = true;
    window.LingonAuth.api('/api/wallet/card', { method:'POST', body: JSON.stringify({ holderName: (state.agent && state.agent.name) || '' }) }).then((j) => {
      walletCache = j.wallet || j; state.walletTab = 'card'; save(); if ($('#cbody')) paintWallet($('#cbody')); toast('Card attached to the agent wallet.');
    }).catch((err) => { b.disabled = false; toast(err.message); });
    return;
  }
  if (act === 'w-billing'){
    const billing = { line1: (($('#w-line1')||{}).value||'').trim(), city: (($('#w-city')||{}).value||'').trim(), postal: (($('#w-postal')||{}).value||'').trim(), country: (($('#w-country')||{}).value||'US').trim() };
    window.LingonAuth.api('/api/wallet/billing', { method:'POST', body: JSON.stringify({ billing, holderName: (state.agent && state.agent.name) || '' }) }).then((j) => {
      walletCache = j; if ($('#cbody')) paintWallet($('#cbody')); toast('Billing saved for Stripe Issuing.');
    }).catch((err) => toast(err.message));
    return;
  }
  if (act === 'w-reveal'){
    revealStripeCard(b.dataset.id).catch((err) => toast(err.message));
    return;
  }
  if (act === 'w-limit'){
    const n = Number((($('#wlimit') || {}).value) || 0);
    window.LingonAuth.api('/api/wallet/limit', { method:'POST', body: JSON.stringify({ dailyLimitUsd: n }) }).then((j) => {
      walletCache = j; if ($('#cbody')) paintWallet($('#cbody')); toast('Daily spend cap saved.');
    }).catch((err) => toast(err.message));
    return;
  }
  if (act === 'w-send'){
    const to = (($('#wto') || {}).value || '').trim();
    const amount = Number((($('#wamt') || {}).value) || 0);
    const asset = (($('#wasset') || {}).value) || 'usdc';
    if (!to || !(amount > 0)){ toast('Enter a destination and amount.'); return; }
    if (!window.confirm('Send ' + amount + ' ' + asset.toUpperCase() + ' from the agent wallet? This cannot be undone.')) return;
    b.disabled = true;
    window.LingonAuth.api('/api/wallet/transfer', { method:'POST', body: JSON.stringify({ to, amount, asset, confirm:true }) }).then((j) => {
      walletCache = j.wallet || walletCache; if ($('#cbody')) paintWallet($('#cbody')); toast('Sent.');
    }).catch((err) => { b.disabled = false; toast(err.message); });
    return;
  }
  if (act === 'viewcanvas'){ state.canvasOpen = true; state.canvasTab = 'canvas'; $('#app') && $('#app').classList.remove('nocanvas'); paintCanvas(); return; }
  if (act === 'watchlive'){ state.canvasOpen = true; state.canvasTab = 'canvas'; state._showLiveInCanvas = true; $('#app') && $('#app').classList.remove('nocanvas'); save(); paintCanvas(); return; }
  if (act === 'takeover'){ liveTakeover(); return; }
  if (act === 'closestop-live'){
    const id = liveIdShown;
    if (id){ window.LingonAuth.api('/api/live/stop', { method: 'POST', body: JSON.stringify({ liveId: id }) }).catch(() => {}); }
    liveClose(); state._showLiveInCanvas = false; state.canvasTab = 'canvas'; save(); paintCanvas(); return;
  }
  if (act === 'openbrowser'){ toast('For safety, browsing stays contained in the sandbox window above.'); return; }
  if (act === 'artmenu'){ toast('Artifact saved — find it in Vault → Library.'); return; }
  if (act === 'replymsg' && c && m){
    const draft = ($('#cprompt') || {}).value || '';
    c.replyingTo = { id:m.id, role:m.role === 'user' ? 'user' : 'agent', text:String(m.text || '').replace(/\s+/g, ' ').trim().slice(0, 220) };
    save(); paintChat($('#main'));
    if ($('#cprompt')) { $('#cprompt').value = draft; $('#cprompt').focus(); }
    return;
  }
  if (act === 'cancelreply' && c){
    const draft = ($('#cprompt') || {}).value || '';
    c.replyingTo = null; save(); paintChat($('#main'));
    if ($('#cprompt')) { $('#cprompt').value = draft; $('#cprompt').focus(); }
    return;
  }
  if (act === 'copymsg' && m){
    try { await copyText(m.text); toast('Message copied'); } catch { toast('Could not copy message'); }
    return;
  }
  if (act === 'reactmsg' && c && m){
    const emoji = b.dataset.emoji;
    if (!REACTIONS.some((r) => r.emoji === emoji)) return;
    const reactions = new Set(Array.isArray(m.reactions) ? m.reactions : []);
    reactions.has(emoji) ? reactions.delete(emoji) : reactions.add(emoji);
    m.reactions = [...reactions]; save(); replaceNode(c, m); return;
  }
  if (act === 'copycode'){ const t = $('#codebox'); if (t) await copyText(t.textContent); toast('Copied'); return; }

  /* card resolutions (real accounts only — no anonymous approvals) */
  if (act === 'managed-stop') { await Engine.stop(makeRT(chat())); return; }
  if (act === 'managed-resume') { await Engine.resume(makeRT(chat())); return; }
  if (m?.card?.managedCallId && ['save-secret','skip-secret'].includes(act)) {
    if (!signedIn()) { renderAuth(); return; }
    if(act === 'save-secret') {
      const node=document.querySelector(`[data-mid="${m.id}"]`);
      const input=node.querySelector('[data-f="val"]');
      if(!input.value) { toast('Enter the credential value.'); return; }
      b.disabled=true;
      try {
        await window.LingonAuth.api('/api/secrets',{method:'POST',body:JSON.stringify({name:m.card.suggest,value:input.value})});
        input.value='';
      } catch(err) {b.disabled=false;toast(err.message);return;}
    }
    await Engine.resume(makeRT(c),{callId:m.card.managedCallId,allow:act==='save-secret'});
    b.disabled=false;return;
  }
  if (m?.card?.managedCallId && ['managed-allow','managed-deny','qopt'].includes(act)) {
    if (!signedIn()) { renderAuth(); return; }
    b.disabled = true;
    const allow = act !== 'managed-deny';
    await Engine.resume(makeRT(c), { callId:m.card.managedCallId, allow, answer:act === 'qopt' ? b.dataset.o : undefined });
    b.disabled = false;
    replaceNode(c,m); save(); return;
  }
  if (act === 'approve' && m){ if (!signedIn()){ renderAuth(); return; } resolveCard(c, m, { ok:true }, 'approved'); return; }
  if (act === 'deny' && m){ if (!signedIn()){ renderAuth(); return; } resolveCard(c, m, { ok:false }, 'denied'); return; }
  if (act === 'always' && m){
    state.vault.approvals.push({ id: uid(), key: m.card.key, label: m.card.title, at: Date.now() });
    save(); resolveCard(c, m, { ok:true, always:true }, 'always'); return;
  }
  if (act === 'connect' && m){
    resolveCard(c, m, { ok:false }, 'denied');
    state.view = 'apps'; save(); renderApp(); refreshComposioApps();
    toast('Connect that app under Apps — secure OAuth, no tokens to paste.');
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
  if (act === 'download' && m){
    if (m.card.managedArtifactId) { try { await Engine.download(c.id, m.card); } catch (err) { toast(err.message); } }
    else dl(m.card.name, m.card.content);
    return;
  }

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
    state.view = 'apps'; save(); renderApp(); refreshComposioApps();
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
    stopSandboxLease();
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
      const plan = b.dataset.p;
      const ex = extraCreditsFor(plan);
      const j = await window.LingonAuth.api('/api/billing/checkout', { method: 'POST', body: JSON.stringify({ plan, extraCredits: ex.credits, extraPrice: ex.price }) });
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
      const plan = b.dataset.p;
      const ex = extraCreditsFor(plan);
      const j = await window.LingonAuth.api('/api/billing/upgrade', { method: 'POST', body: JSON.stringify({ plan, extraCredits: ex.credits, extraPrice: ex.price }) });
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
  if (act === 'p-color'){ state.agent.color = b.dataset.c; save(); paintSide(); paintCanvas(); if (state.view === 'chat') paintMain(); if (state.view === 'settings') paintSettings($('#main')); else if (state.view === 'profile' && $('#main')) paintProfile($('#main')); return; }
  if (act === 'p-pers'){ state.agent.pers = b.dataset.p; save(); paintSide(); paintCanvas(); if (state.view === 'chat') paintMain(); if (state.view === 'settings') paintSettings($('#main')); else if (state.view === 'profile' && $('#main')) paintProfile($('#main')); return; }
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
